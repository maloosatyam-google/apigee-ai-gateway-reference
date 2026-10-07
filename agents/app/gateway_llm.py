"""GatewayLlm: one ADK model adapter for both agents.

ADK's built-in Gemini client cannot target Apigee's `/ai/v1/auto` path and does
not surface HTTP response headers, which is where the gateway reports the
routed model, cache status and cost. This adapter speaks the Gemini REST shape
(`generateContent`) over httpx, so the SAME code serves both arms:

  - mode="apigee": POST {gateway}/ai/v1/auto with the persona key + user JWT.
  - mode="vertex": POST Vertex AI directly with the service's ADC token, one
    pinned model. No gateway, no routing, no cache, no Model Armor, no quota.

Each call records one `llm_step` event (model, tokens, latency, cache, status).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator, Literal, Optional

import httpx
from google.adk.models.base_llm import BaseLlm
from google.adk.models._capabilities import LlmCapabilities
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import PrivateAttr

from .config import settings
from .recorder import RunRecorder

logger = logging.getLogger(__name__)

# GenerateContentConfig fields that belong in the REST `generationConfig` block.
_GENERATION_FIELDS = (
    "temperature",
    "top_p",
    "top_k",
    "candidate_count",
    "max_output_tokens",
    "stop_sequences",
    "seed",
    "response_mime_type",
    "thinking_config",
)

_RETRY_DELAY_S = 2.0
_CAPACITY_RETRIES = 2

_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
  global _http_client
  if _http_client is None:
    _http_client = httpx.AsyncClient(timeout=settings.llm_timeout_s)
  return _http_client


# -- pure helpers (unit tested) ----------------------------------------------


def _dump(model: Any) -> Any:
  return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def _system_instruction(value: Any) -> Optional[dict[str, Any]]:
  if value is None:
    return None
  if isinstance(value, str):
    return {"parts": [{"text": value}]} if value else None
  if isinstance(value, types.Content):
    return _dump(value)
  if isinstance(value, types.Part):
    return {"parts": [_dump(value)]}
  if isinstance(value, list):
    parts = []
    for item in value:
      if isinstance(item, str):
        parts.append({"text": item})
      elif isinstance(item, types.Part):
        parts.append(_dump(item))
    return {"parts": parts} if parts else None
  return None


def build_request_body(llm_request: LlmRequest) -> dict[str, Any]:
  """Gemini REST body for an ADK LlmRequest."""
  body: dict[str, Any] = {"contents": [_dump(c) for c in llm_request.contents]}
  cfg = llm_request.config
  if cfg is None:
    return body
  si = _system_instruction(cfg.system_instruction)
  if si:
    body["systemInstruction"] = si
  tools = [_dump(t) for t in (cfg.tools or []) if isinstance(t, types.Tool)]
  if tools:
    body["tools"] = tools
  if cfg.tool_config is not None:
    body["toolConfig"] = _dump(cfg.tool_config)
  gen = {}
  for name in _GENERATION_FIELDS:
    value = getattr(cfg, name, None)
    if value is not None:
      gen[name] = value
  if gen:
    body["generationConfig"] = _dump(types.GenerateContentConfig(**gen))
  return body


def offered_tool_names(llm_request: LlmRequest) -> list[str]:
  names: list[str] = []
  cfg = llm_request.config
  for tool in (cfg.tools or []) if cfg else []:
    if isinstance(tool, types.Tool):
      for fd in tool.function_declarations or []:
        if fd.name:
          names.append(fd.name)
  return names


def is_first_turn(llm_request: LlmRequest) -> bool:
  """True when the last content is the user's own text (no tool results yet).

  The gateway keys the semantic cache and Model Armor on the TEXT of the last
  content. After a tool call the last content is a functionResponse with no
  text, so caching there would key every tool follow-up on an empty prompt.
  The cache is therefore only requested on the first turn.
  """
  if not llm_request.contents:
    return False
  last = llm_request.contents[-1]
  if last.role != "user" or not last.parts:
    return False
  has_text = any(p.text for p in last.parts)
  has_fn = any(p.function_response for p in last.parts)
  return has_text and not has_fn


def parse_response_body(text: str) -> types.GenerateContentResponse:
  """Parse a Gemini REST response, tolerating fields the SDK does not know.

  genai models forbid extra fields, so unknown keys are pruned first, then the
  body is validated in JSON mode so base64 bytes (thoughtSignature) decode.
  """
  data = json.loads(text)
  try:
    from google.genai import _common  # pylint: disable=g-import-not-at-top

    _common._remove_extra_fields(types.GenerateContentResponse, data)  # pylint: disable=protected-access
  except Exception:  # pragma: no cover - best effort only
    pass
  return types.GenerateContentResponse.model_validate_json(json.dumps(data))


def _int(value: Any) -> Optional[int]:
  try:
    return int(value) if value not in (None, "") else None
  except (TypeError, ValueError):
    return None


def _float(value: Any) -> Optional[float]:
  try:
    return float(value) if value not in (None, "") else None
  except (TypeError, ValueError):
    return None


def token_counts(usage: Optional[types.GenerateContentResponseUsageMetadata]) -> dict[str, int]:
  if usage is None:
    return {"prompt": 0, "output": 0, "thoughts": 0, "total": 0}
  prompt = usage.prompt_token_count or 0
  candidates = usage.candidates_token_count or 0
  thoughts = usage.thoughts_token_count or 0
  # Thinking tokens are billed as output tokens.
  output = candidates + thoughts
  return {"prompt": prompt, "output": output, "thoughts": thoughts, "total": prompt + output}


def gateway_telemetry(headers: httpx.Headers | dict[str, str]) -> dict[str, Any]:
  """The x-gateway-* headers the AI Gateway returns, normalized."""
  h = {k.lower(): v for k, v in dict(headers).items()}
  cache = (h.get("x-gateway-cache-status") or "").upper() or None
  if not cache and h.get("x-gateway-cached") == "true":
    cache = "HIT"
  return {
      "model": h.get("x-gateway-model") or None,
      "auto_routed": h.get("x-auto-routed") == "true",
      "route_category": h.get("x-gateway-router-category") or h.get("x-gateway-category") or None,
      "router_confidence": _float(h.get("x-gateway-router-confidence")),
      "cache": cache,
      "gateway_cost_usd": _float(h.get("x-gateway-cost-usd")),
      "token_quota_status": h.get("x-gateway-token-quota-status") or None,
      "token_quota_used_pct": _float(h.get("x-gateway-token-quota-used-pct")),
      "budget_status": h.get("x-gateway-budget-status") or None,
      "request_id": h.get("x-request-id") or None,
  }


def classify_llm_error(status: int, body_text: str) -> tuple[str, str]:
  """(governance kind, human message) for a failed model call."""
  message = body_text
  errorcode = ""
  upstream_status = ""
  try:
    data = json.loads(body_text)
    if isinstance(data, dict) and "fault" in data:
      message = data["fault"].get("faultstring", body_text)
      errorcode = (data["fault"].get("detail") or {}).get("errorcode", "")
    elif isinstance(data, dict) and "error" in data:
      err = data["error"]
      message = err.get("message", body_text) if isinstance(err, dict) else str(err)
      upstream_status = str(err.get("status", "")) if isinstance(err, dict) else ""
  except (ValueError, AttributeError):
    pass
  lowered = f"{errorcode} {message}".lower()
  if "sanitize" in lowered or "model armor" in lowered or "filtermatched" in lowered:
    return "model_armor", message
  if status == 429:
    # An Apigee policy answers with a `fault`; Vertex itself answers with `error`
    # (status RESOURCE_EXHAUSTED, message "Resource exhausted..."): model capacity.
    if not errorcode and (
        upstream_status == "RESOURCE_EXHAUSTED" or "resource_exhausted" in lowered or "resource exhausted" in lowered
    ):
      return "upstream_capacity", message
    if "budget" in lowered:
      return "budget", message
    return "token_quota", message
  if status in (401, 403):
    return "access_denied", message
  return "error", message


# -- the adapter -------------------------------------------------------------


class GatewayLlm(BaseLlm):
  """ADK model that calls Gemini through Apigee (/auto or the pass-through) or Vertex directly."""

  mode: Literal["apigee", "passthrough", "vertex"] = "apigee"

  _recorder: RunRecorder | None = PrivateAttr(default=None)
  _headers: dict[str, str] = PrivateAttr(default_factory=dict)
  _token_provider: Any = PrivateAttr(default=None)
  # Ask /auto for the semantic cache on the first turn. Off for the quota burst,
  # so every run spends real tokens.
  _use_cache: bool = PrivateAttr(default=True)

  @property
  def capabilities(self) -> LlmCapabilities:
    return LlmCapabilities(output_schema_and_tools=False)

  @classmethod
  def for_apigee(
      cls, *, recorder: RunRecorder, api_key: str, identity_token: str, run_id: str, agent_id: str,
      use_cache: bool = True,
  ) -> "GatewayLlm":
    llm = cls(model="auto", mode="apigee")
    llm._recorder = recorder
    llm._use_cache = use_cache
    llm._headers = {
        "x-apikey": api_key,
        "Authorization": f"Bearer {identity_token}",
        "x-session-id": run_id,
        "x-agent-id": agent_id,
    }
    return llm

  @classmethod
  def for_passthrough(
      cls, *, recorder: RunRecorder, api_key: str, identity_token: str, run_id: str, agent_id: str, model: str,
      use_cache: bool = True,
  ) -> "GatewayLlm":
    """Pinned model via llm-passthrough-v1: key check, analytics and logs only."""
    llm = cls(model=model, mode="passthrough")
    llm._recorder = recorder
    # Sent exactly like the governed side so the two requests differ only in URL and key;
    # llm-passthrough-v1 has no cache, so the header has no effect there.
    llm._use_cache = use_cache
    llm._headers = {
        "x-apikey": api_key,
        "Authorization": f"Bearer {identity_token}",
        "x-session-id": run_id,
        "x-agent-id": agent_id,
    }
    return llm

  @classmethod
  def for_vertex(cls, *, recorder: RunRecorder, token_provider: Any, model: str) -> "GatewayLlm":
    llm = cls(model=model, mode="vertex")
    llm._recorder = recorder
    llm._token_provider = token_provider
    return llm

  def _url(self) -> str:
    host = settings.gateway_host.rstrip("/")
    if self.mode == "apigee":
      return f"{host}/ai/v1/auto"
    if self.mode == "passthrough":
      return f"{host}/passthrough/v1/models/{self.model}:generateContent"
    loc = settings.vertex_location
    vhost = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    return (
        f"https://{vhost}/v1/projects/{settings.gcp_project}/locations/{loc}"
        f"/publishers/google/models/{self.model}:generateContent"
    )

  async def _post(self, url: str, body: dict[str, Any], headers: dict[str, str]) -> httpx.Response:
    """POST once; a read timeout is retried once (a slow model turn, not a decision)."""
    try:
      return await _client().post(url, json=body, headers=headers)
    except httpx.TimeoutException:
      logger.warning("model call timed out after %ss; retrying once: %s", settings.llm_timeout_s, url)
      return await _client().post(url, json=body, headers=headers)

  def _sends_cache_header(self, first_turn: bool) -> bool:
    return self.mode in ("apigee", "passthrough") and first_turn and self._use_cache

  async def _request_headers(self, first_turn: bool) -> dict[str, str]:
    headers = {"Content-Type": "application/json", **self._headers}
    if self.mode == "vertex":
      token = await self._token_provider()
      headers["Authorization"] = f"Bearer {token}"
    elif self._sends_cache_header(first_turn):
      headers["use-cache"] = "true"
    return headers

  async def generate_content_async(
      self, llm_request: LlmRequest, stream: bool = False
  ) -> AsyncGenerator[LlmResponse, None]:
    rec = self._recorder
    step = rec.next_llm_step() if rec else 0
    if rec:
      rec.tools_offered(offered_tool_names(llm_request))
    first_turn = is_first_turn(llm_request)
    body = build_request_body(llm_request)
    headers = await self._request_headers(first_turn)
    url = self._url()

    started = time.monotonic()
    res: httpx.Response | None = None
    transport_error = ""
    transport_kind = "upstream_timeout"
    try:
      res = await self._post(url, body, headers)
      for attempt in range(_CAPACITY_RETRIES):
        if not (res.status_code == 429 and "RESOURCE_EXHAUSTED" in res.text and "fault" not in res.text):
          break
        # Upstream capacity blip, not a governance decision: back off and retry.
        await asyncio.sleep(_RETRY_DELAY_S * (2 ** attempt))
        res = await self._post(url, body, headers)
    except httpx.TimeoutException:
      transport_error = f"The model did not answer within {int(settings.llm_timeout_s)}s (tried twice)."
    except httpx.TransportError as exc:
      transport_error = f"Model call failed: {type(exc).__name__}: {exc}"
      transport_kind = "error"
    latency_ms = int((time.monotonic() - started) * 1000)

    if res is None:
      # No HTTP answer at all: record the failed call so the timeline and the
      # comparison show it, instead of the run silently ending without a reply.
      if rec:
        rec.llm_step(
            step=step,
            via={"apigee": "apigee", "passthrough": "apigee_passthrough"}.get(self.mode, "vertex_direct"),
            endpoint=url, requested_model=self.model, model=self.model, status=504,
            latency_ms=latency_ms, first_turn=first_turn,
            cache_requested=self._sends_cache_header(first_turn),
            tokens=token_counts(None), billable=False, error=transport_error,
        )
        rec.governance(transport_kind, transport_error, where="llm", status=504)
      yield LlmResponse(error_code="HTTP_504", error_message=transport_error)
      return

    tele = gateway_telemetry(res.headers) if self.mode != "vertex" else {
        "model": self.model, "auto_routed": False, "route_category": None,
        "router_confidence": None, "cache": None, "gateway_cost_usd": None,
        "token_quota_status": None, "token_quota_used_pct": None,
        "budget_status": None, "request_id": res.headers.get("x-request-id"),
    }
    base_event = {
        "step": step,
        "via": {"apigee": "apigee", "passthrough": "apigee_passthrough"}.get(self.mode, "vertex_direct"),
        "endpoint": url,
        "requested_model": self.model,
        "status": res.status_code,
        "latency_ms": latency_ms,
        "first_turn": first_turn,
        "cache_requested": self._sends_cache_header(first_turn),
        **tele,
    }

    if res.status_code != 200:
      kind, message = classify_llm_error(res.status_code, res.text)
      if rec:
        rec.llm_step(**base_event, tokens=token_counts(None), billable=False, error=message)
        rec.governance(kind, message, where="llm", status=res.status_code)
      yield LlmResponse(error_code=f"HTTP_{res.status_code}", error_message=message)
      return

    parsed = parse_response_body(res.text)
    llm_response = LlmResponse.create(parsed)
    served = tele.get("model") or parsed.model_version or ("cache" if tele.get("cache") == "HIT" else self.model)
    calls = [p.function_call.name for p in (llm_response.content.parts if llm_response.content and llm_response.content.parts else []) if p.function_call]
    cache_hit = tele.get("cache") == "HIT"
    if rec:
      rec.llm_step(
          **{**base_event, "model": served},
          tokens=token_counts(parsed.usage_metadata),
          # A semantic-cache hit is served by the gateway without a model call.
          billable=not cache_hit,
          function_calls=calls,
      )
      if cache_hit:
        rec.governance("cache_hit", "Answered from the semantic cache; no model call.", where="llm")
      elif tele.get("auto_routed") and tele.get("route_category"):
        rec.governance(
            "routed",
            f"Auto-routed '{tele['route_category']}' to {served}.",
            where="llm",
        )
    yield llm_response
