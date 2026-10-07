"""MCP transport shim: records every gateway hop and normalizes Apigee denials.

Apigee answers some tool calls with a non-2xx HTTP status:

  - 403 + a JSON-RPC *result* with isError=true (e.g. REFUND_LIMIT), or
  - 401/429 + an Apigee *fault* body (tool not on the key's product, quota).

The MCP client treats any status >= 400 whose body is not a JSON-RPC *error* as
a generic "Server returned an error response", which would hide the reason from
the model. This transport rewrites both cases into a 200 JSON-RPC result with
isError=true that carries the gateway's own message, so the agent can explain
the refusal in its answer. It also emits tool_call / tool_result / gateway_hop
events with HTTP status and latency for the timeline.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Optional

try:  # mcp>=2 uses httpx2; mcp 1.x uses httpx. Same API.
  import httpx2 as _httpx
except ImportError:  # pragma: no cover
  import httpx as _httpx

from .recorder import RunRecorder

_DROP_HEADERS = {"content-length", "content-encoding", "transfer-encoding"}


# -- pure helpers (unit tested) ----------------------------------------------


def parse_rpc(content: bytes) -> Optional[dict[str, Any]]:
  try:
    data = json.loads(content or b"")
  except ValueError:
    return None
  return data if isinstance(data, dict) and data.get("jsonrpc") == "2.0" else None


def result_text(result: Any) -> str:
  if not isinstance(result, dict):
    return ""
  texts = [c.get("text", "") for c in result.get("content") or [] if isinstance(c, dict)]
  return "\n".join(t for t in texts if t)


def normalize(status: int, body: bytes, rpc_id: Any, method: str) -> tuple[int, bytes, dict[str, Any]]:
  """Return (status, body, info) with Apigee denials rewritten as tool errors.

  info = {"is_error", "text", "fault_code", "fault_message", "rewritten"}.
  """
  info: dict[str, Any] = {"is_error": status >= 400, "text": "", "fault_code": None, "fault_message": None, "rewritten": False}
  try:
    data = json.loads(body or b"")
  except ValueError:
    data = None

  if isinstance(data, dict) and data.get("jsonrpc") == "2.0":
    if "result" in data:
      info["is_error"] = bool((data.get("result") or {}).get("isError"))
      info["text"] = result_text(data.get("result"))
      if status >= 400:
        info["rewritten"] = True
        return 200, body, info
    elif "error" in data:
      err = data.get("error") or {}
      info["is_error"] = True
      info["text"] = err.get("message", "")
    return status, body, info

  if status >= 400 and method == "tools/call" and isinstance(data, dict) and "fault" in data:
    fault = data.get("fault") or {}
    code = (fault.get("detail") or {}).get("errorcode") or f"HTTP_{status}"
    message = fault.get("faultstring") or "Rejected by the gateway"
    payload = {"error": code, "message": message, "httpStatus": status, "enforcedBy": "Apigee"}
    text = json.dumps(payload)
    rewritten = {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {"content": [{"type": "text", "text": text}], "isError": True},
    }
    info.update(is_error=True, text=text, fault_code=code, fault_message=message, rewritten=True)
    return 200, json.dumps(rewritten).encode(), info

  return status, body, info


def classify_tool_outcome(http_status: int, text: str, fault_code: Optional[str]) -> Optional[tuple[str, str]]:
  """(governance kind, detail) for a gateway-enforced tool outcome, else None."""
  code = (fault_code or "").lower()
  lowered = text.lower()
  if "refund_limit" in lowered:
    message = text
    try:
      message = json.loads(text).get("message", text)
    except (ValueError, AttributeError):
      pass
    return "refund_limit", message
  # Industry packs' limits (e.g. FEE_REVERSAL_LIMIT), raised by the industry MCP proxy.
  try:
    payload = json.loads(text)
  except (ValueError, TypeError):
    payload = None
  if isinstance(payload, dict) and payload.get("enforcedBy") == "Apigee" and str(payload.get("error", "")).endswith("_LIMIT"):
    return "business_limit", payload.get("message") or payload["error"]
  if http_status == 429 or "quota" in code or "spikearrest" in code:
    return "rate_limited", "Tool call rate limit reached for this key."
  if http_status in (401, 403) and ("invalidapikeyforgivenresource" in code or "apikey" in code):
    return "tool_denied", "This tool is not on the key's API product."
  if http_status in (401, 403):
    return "access_denied", text or f"HTTP {http_status}"
  return None


# -- transport ---------------------------------------------------------------


class RecordingTransport(_httpx.AsyncBaseTransport):

  def __init__(self, recorder: RunRecorder, server_label: str, inner: Any = None):
    self._inner = inner or _httpx.AsyncHTTPTransport()
    self._rec = recorder
    self._server = server_label

  async def handle_async_request(self, request):  # type: ignore[override]
    rpc = parse_rpc(request.content) if request.method == "POST" else None
    method = (rpc or {}).get("method", "")
    rpc_id = (rpc or {}).get("id")
    params = (rpc or {}).get("params") or {}
    tool_name = params.get("name") if method == "tools/call" else None

    if tool_name:
      self._rec.tool_call(
          rpc_id=rpc_id, name=tool_name, args=params.get("arguments") or {},
          server=self._server, endpoint=str(request.url),
      )

    started = time.monotonic()
    response = await self._inner.handle_async_request(request)

    content_type = response.headers.get("content-type", "").lower()
    if rpc is None or rpc_id is None or not content_type.startswith("application/json"):
      if method and rpc_id is None:
        pass  # notifications: nothing to record
      return response

    raw = await response.aread()
    latency_ms = int((time.monotonic() - started) * 1000)
    request_id = response.headers.get("x-request-id")
    status, body, info = normalize(response.status_code, raw, rpc_id, method)

    if tool_name:
      display: Any = info["text"]
      try:
        display = json.loads(info["text"])
      except (ValueError, TypeError):
        pass
      self._rec.emit(
          "tool_result", rpc_id=rpc_id, name=tool_name, is_error=info["is_error"],
          http_status=response.status_code, latency_ms=latency_ms, result=display,
          server=self._server, request_id=request_id,
      )
      outcome = classify_tool_outcome(response.status_code, info["text"], info["fault_code"])
      if outcome:
        self._rec.governance(outcome[0], outcome[1], where="tool", tool=tool_name, status=response.status_code)
    else:
      detail: dict[str, Any] = {}
      if method == "tools/list":
        try:
          detail["tools"] = len((json.loads(raw).get("result") or {}).get("tools") or [])
        except (ValueError, AttributeError):
          pass
      self._rec.emit(
          "gateway_hop", method=method, server=self._server, endpoint=str(request.url),
          status=response.status_code, latency_ms=latency_ms, request_id=request_id, **detail,
      )

    headers = [(k, v) for k, v in response.headers.items() if k.lower() not in _DROP_HEADERS]
    return _httpx.Response(status_code=status, headers=headers, content=body, request=request)

  async def aclose(self) -> None:
    await self._inner.aclose()


def recording_client_factory(
    recorder: RunRecorder, server_label: str, inner_factory: Optional[Callable[[], Any]] = None,
) -> Callable[..., Any]:
  """An httpx_client_factory for StreamableHTTPConnectionParams.

  `inner_factory` builds the transport under the recorder for each client (local preview:
  gateway_sim.SimulatedGatewayTransport); default is the network transport.
  """

  def factory(headers: dict[str, str] | None = None, timeout: Any = None, auth: Any = None):
    kwargs: dict[str, Any] = {"transport": RecordingTransport(recorder, server_label, inner_factory() if inner_factory else None)}
    if headers is not None:
      kwargs["headers"] = headers
    if timeout is not None:
      kwargs["timeout"] = timeout
    if auth is not None:
      kwargs["auth"] = auth
    return _httpx.AsyncClient(**kwargs)

  return factory
