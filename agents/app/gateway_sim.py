"""Local preview only: stands in for the industry Apigee MCP proxy (e.g. banking-mcp).

When INDUSTRY_APIS_LOCAL is set, the industry MCP server is the local industry-apis
service, which applies no governance. This transport makes the same decisions the
generated proxy makes in Apigee, so the showcase story can be previewed before deploy:

  - tools/list  -> only the tools on the key's product (governed = ops, baseline = admin)
  - tools/call  -> 401 for a tool outside the product, 429 over the per-tool quota,
                   403 with a JSON-RPC tool error over the pack's business limit

It mirrors simulateGateway in ui/src/utils/industryPacks.js. Never used in prod: the
real proxy decides there.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from typing import Any, Callable, Optional

try:  # mcp>=2 uses httpx2; mcp 1.x uses httpx. Same API.
  import httpx2 as _httpx
except ImportError:  # pragma: no cover
  import httpx as _httpx

from .mcp_transport import parse_rpc

# Shared across runs, like the Apigee quota counters (per persona + tool).
_CALLS: dict[tuple[str, str], deque] = defaultdict(deque)


def tools_for(pack: dict[str, Any], persona: str) -> set[str]:
  return {t["name"] for t in pack["tools"] if persona == "admin" or t["persona"] == persona}


def decide(
    pack: dict[str, Any], persona: str, tool_name: str, args: dict[str, Any],
    recent: deque, now: float,
) -> Optional[tuple[int, dict[str, Any], dict[str, str]]]:
  """(status, body, headers) when the simulated proxy stops the call, else None."""
  tool = next((t for t in pack["tools"] if t["name"] == tool_name), None)
  if tool and tool_name not in tools_for(pack, persona):
    return 401, {"fault": {"faultstring": "Invalid ApiKey for given resource",
                           "detail": {"errorcode": "oauth.v2.InvalidApiKeyForGivenResource"}}}, {}
  if tool:
    quota = 100 if persona == "admin" and tool["slot"] != "forecast" else tool["quotaPerMin"]
    while recent and now - recent[0] >= 60:
      recent.popleft()
    if len(recent) >= quota:
      return 429, {"fault": {"faultstring": f"Rate limit quota violation. Quota limit exceeded. Identifier : {tool_name}",
                             "detail": {"errorcode": "policies.ratelimit.QuotaViolation"}}}, {}
  limit = pack["limit"]
  try:
    amount = float((args or {}).get(limit["argument"]))
  except (TypeError, ValueError):
    amount = None
  if tool_name == limit["tool"] and persona == limit["persona"] and amount is not None and amount > limit["max"]:
    shown = int(amount) if amount.is_integer() else amount
    err = {"status": 403, "error": limit["code"], "message": f"{limit['message']} Requested ${shown}.",
           "limit": limit["max"], "requested": shown, "enforcedBy": "Apigee"}
    body = {"jsonrpc": "2.0", "id": None, "result": {"isError": True, "content": [{"type": "text", "text": json.dumps(err)}]}}
    return 403, body, {"x-gateway-limit": limit["code"]}
  return None


def filter_tools_list(body: bytes, allowed: set[str]) -> bytes:
  try:
    data = json.loads(body or b"")
    tools = data["result"]["tools"]
  except (ValueError, KeyError, TypeError):
    return body
  data["result"]["tools"] = [t for t in tools if t.get("name") in allowed]
  return json.dumps(data).encode()


class SimulatedGatewayTransport(_httpx.AsyncBaseTransport):

  def __init__(self, pack: dict[str, Any], persona: str, inner: Any = None, clock: Callable[[], float] = time.monotonic):
    self._pack = pack
    self._persona = persona
    self._inner = inner or _httpx.AsyncHTTPTransport()
    self._clock = clock

  async def handle_async_request(self, request):  # type: ignore[override]
    rpc = parse_rpc(request.content) if request.method == "POST" else None
    method = (rpc or {}).get("method", "")
    if method == "tools/call":
      params = rpc.get("params") or {}
      name = params.get("name", "")
      recent = _CALLS[(f"{self._pack['id']}:{self._persona}", name)]
      now = self._clock()
      stop = decide(self._pack, self._persona, name, params.get("arguments") or {}, recent, now)
      if stop:
        status, body, headers = stop
        if "jsonrpc" in body:
          body = {**body, "id": rpc.get("id")}
        return _httpx.Response(status_code=status, headers={"content-type": "application/json", **headers},
                               content=json.dumps(body).encode(), request=request)
      recent.append(now)
    response = await self._inner.handle_async_request(request)
    if method != "tools/list" or not response.headers.get("content-type", "").lower().startswith("application/json"):
      return response
    raw = await response.aread()
    headers = [(k, v) for k, v in response.headers.items() if k.lower() not in {"content-length", "content-encoding", "transfer-encoding"}]
    return _httpx.Response(status_code=response.status_code, headers=headers,
                           content=filter_tools_list(raw, tools_for(self._pack, self._persona)), request=request)

  async def aclose(self) -> None:
    await self._inner.aclose()
