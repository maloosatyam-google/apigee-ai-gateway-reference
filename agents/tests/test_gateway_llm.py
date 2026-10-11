import json

import httpx
import pytest
from google.adk.models.llm_request import LlmRequest
from google.genai import types

from app import gateway_llm
from app.gateway_llm import (
    GatewayLlm,
    build_request_body,
    classify_llm_error,
    gateway_telemetry,
    is_first_turn,
    offered_tool_names,
    parse_response_body,
    token_counts,
)
from app.recorder import RunRecorder


def _request(contents, tools=True, system="Be helpful."):
  cfg = types.GenerateContentConfig(system_instruction=system)
  if tools:
    cfg.tools = [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="getOrderStatus",
                    description="Get order status",
                    parameters=types.Schema(
                        type="OBJECT",
                        properties={"orderId": types.Schema(type="STRING")},
                        required=["orderId"],
                    ),
                ),
                types.FunctionDeclaration(name="issueRefund", description="Refund"),
            ]
        )
    ]
  return LlmRequest(model="auto", contents=contents, config=cfg)


USER = types.Content(role="user", parts=[types.Part(text="Where is ORD-1042?")])
SIG = b"\x01\x02signature\xff"
MODEL_CALL = types.Content(
    role="model",
    parts=[types.Part(function_call=types.FunctionCall(name="getOrderStatus", args={"orderId": "ORD-1042"}), thought_signature=SIG)],
)
TOOL_RESULT = types.Content(
    role="user",
    parts=[types.Part(function_response=types.FunctionResponse(name="getOrderStatus", response={"status": "Delayed"}))],
)


def test_body_uses_rest_camel_case_and_system_instruction():
  body = build_request_body(_request([USER]))
  assert body["systemInstruction"] == {"parts": [{"text": "Be helpful."}]}
  assert body["contents"][0] == {"role": "user", "parts": [{"text": "Where is ORD-1042?"}]}
  decl = body["tools"][0]["functionDeclarations"][0]
  assert decl["name"] == "getOrderStatus"
  assert decl["parameters"]["required"] == ["orderId"]
  assert "generationConfig" not in body


def test_body_round_trips_thought_signature():
  body = build_request_body(_request([USER, MODEL_CALL, TOOL_RESULT]))
  part = body["contents"][1]["parts"][0]
  assert part["functionCall"]["name"] == "getOrderStatus"
  # Bytes go out base64-encoded and must decode back to the same signature.
  back = types.Part.model_validate_json(json.dumps(part))
  assert back.thought_signature == SIG
  assert body["contents"][2]["parts"][0]["functionResponse"]["response"] == {"status": "Delayed"}


def test_generation_config_is_passed_through():
  req = _request([USER])
  req.config.temperature = 0.2
  req.config.max_output_tokens = 512
  body = build_request_body(req)
  assert body["generationConfig"] == {"temperature": 0.2, "maxOutputTokens": 512}


def test_first_turn_detection():
  assert is_first_turn(_request([USER]))
  assert not is_first_turn(_request([USER, MODEL_CALL, TOOL_RESULT]))
  assert not is_first_turn(_request([]))


def test_offered_tool_names():
  assert offered_tool_names(_request([USER])) == ["getOrderStatus", "issueRefund"]
  assert offered_tool_names(_request([USER], tools=False)) == []


APIGEE_BODY = {
    "candidates": [
        {
            "content": {
                "role": "model",
                "parts": [{"functionCall": {"name": "getOrderStatus", "args": {"orderId": "ORD-1042"}, "id": "call_1"}, "thoughtSignature": "AY89a19S3m64"}],
            },
            "finishReason": "STOP",
        }
    ],
    "usageMetadata": {"promptTokenCount": 40, "candidatesTokenCount": 21, "totalTokenCount": 61, "thoughtsTokenCount": 9, "someFutureField": 1},
    "modelVersion": "gemini-3.5-flash-lite",
    "createTime": "2026-09-27T10:25:54.144540Z",
    "responseId": "abc",
    "unknownTopLevel": {"x": 1},
}


def test_parse_tolerates_unknown_fields_and_decodes_signature():
  parsed = parse_response_body(json.dumps(APIGEE_BODY))
  part = parsed.candidates[0].content.parts[0]
  assert part.function_call.name == "getOrderStatus"
  assert isinstance(part.thought_signature, bytes) and part.thought_signature
  assert parsed.usage_metadata.prompt_token_count == 40


def test_token_counts_bill_thinking_as_output():
  parsed = parse_response_body(json.dumps(APIGEE_BODY))
  assert token_counts(parsed.usage_metadata) == {"prompt": 40, "output": 30, "thoughts": 9, "total": 70}
  assert token_counts(None)["total"] == 0


def test_gateway_telemetry():
  t = gateway_telemetry({
      "X-Gateway-Model": "gemini-3.5-flash-lite", "x-auto-routed": "true",
      "x-gateway-router-category": "simple", "x-gateway-router-confidence": "0.99",
      "x-gateway-cache-status": "MISS", "x-gateway-cost-usd": "0.000009", "x-request-id": "r1",
  })
  assert t["model"] == "gemini-3.5-flash-lite"
  assert t["auto_routed"] is True
  assert t["route_category"] == "simple"
  assert t["cache"] == "MISS"
  assert t["gateway_cost_usd"] == pytest.approx(0.000009)
  assert gateway_telemetry({"x-gateway-cached": "true"})["cache"] == "HIT"


@pytest.mark.parametrize(
    "status,body,kind",
    [
        (400, '{"fault":{"faultstring":"Model armor template filter matched.","detail":{"errorcode":"steps.sanitize.user.prompt.FilterMatched"}}}', "model_armor"),
        (429, '{"fault":{"faultstring":"Token quota exceeded","detail":{"errorcode":"policies.llmtokenquota.QuotaViolation"}}}', "token_quota"),
        (429, '{"error":{"code":429,"message":"RESOURCE_EXHAUSTED","status":"RESOURCE_EXHAUSTED"}}', "upstream_capacity"),
        # The real Vertex body (seen through the pass-through): the status carries the code.
        (429, '{"error":{"code":429,"message":"Resource exhausted. Please try again later.","status":"RESOURCE_EXHAUSTED"}}', "upstream_capacity"),
        (401, '{"fault":{"faultstring":"Invalid ApiKey","detail":{"errorcode":"oauth.v2.InvalidApiKey"}}}', "access_denied"),
        (500, "boom", "error"),
    ],
)
def test_classify_llm_error(status, body, kind):
  assert classify_llm_error(status, body)[0] == kind


def _mock_client(handler):
  return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def captured(monkeypatch):
  seen = {}

  def use(handler):
    def wrapped(request):
      seen.setdefault("requests", []).append(request)
      return handler(request)

    monkeypatch.setattr(gateway_llm, "_http_client", _mock_client(wrapped))
    return seen

  return use


async def _drain(rec):
  out = []
  while not rec.queue.empty():
    out.append(rec.queue.get_nowait())
  return out


async def test_apigee_adapter_records_step_and_sends_cache_on_first_turn(captured):
  seen = captured(lambda r: httpx.Response(
      200, json=APIGEE_BODY,
      headers={"x-gateway-model": "gemini-3.5-flash-lite", "x-auto-routed": "true", "x-gateway-router-category": "simple", "x-gateway-cache-status": "MISS"},
  ))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(recorder=rec, api_key="k", identity_token="jwt", run_id="run-1", agent_id="cs-governed")
  responses = [r async for r in llm.generate_content_async(_request([USER]))]

  req = seen["requests"][0]
  assert str(req.url).endswith("/ai/v1/auto")
  assert req.headers["x-apikey"] == "k"
  assert req.headers["authorization"] == "Bearer jwt"
  assert req.headers["use-cache"] == "true"
  assert responses[0].content.parts[0].function_call.name == "getOrderStatus"

  events = await _drain(rec)
  types_ = [e["type"] for e in events]
  assert types_ == ["tools_offered", "llm_step", "governance_event"]
  step = events[1]
  assert step["model"] == "gemini-3.5-flash-lite"
  assert step["function_calls"] == ["getOrderStatus"]
  assert step["billable"] is True
  assert events[2]["kind"] == "routed"


async def test_apigee_adapter_no_cache_header_after_tool_result(captured):
  seen = captured(lambda r: httpx.Response(200, json=APIGEE_BODY))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a")
  _ = [r async for r in llm.generate_content_async(_request([USER, MODEL_CALL, TOOL_RESULT]))]
  assert "use-cache" not in seen["requests"][0].headers


async def test_cache_hit_is_not_billable(captured):
  captured(lambda r: httpx.Response(200, json=APIGEE_BODY, headers={"x-gateway-cache-status": "HIT"}))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a")
  _ = [r async for r in llm.generate_content_async(_request([USER]))]
  events = await _drain(rec)
  step = next(e for e in events if e["type"] == "llm_step")
  assert step["cache"] == "HIT" and step["billable"] is False
  assert any(e["type"] == "governance_event" and e["kind"] == "cache_hit" for e in events)
  assert rec.totals.cache_hits == 1


async def test_model_armor_block_yields_error_response(captured):
  captured(lambda r: httpx.Response(400, json={"fault": {"faultstring": "Model armor template filter matched.", "detail": {"errorcode": "steps.sanitize.user.prompt.FilterMatched"}}}))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a")
  responses = [r async for r in llm.generate_content_async(_request([USER]))]
  assert responses[0].error_code == "HTTP_400"
  events = await _drain(rec)
  gov = [e for e in events if e["type"] == "governance_event"]
  assert gov[0]["kind"] == "model_armor"


async def test_vertex_adapter_uses_direct_url_and_adc(captured):
  seen = captured(lambda r: httpx.Response(200, json={**APIGEE_BODY, "modelVersion": "gemini-3.1-pro-preview"}))
  rec = RunRecorder("baseline")

  async def token():
    return "adc-token"

  llm = GatewayLlm.for_vertex(recorder=rec, token_provider=token, model="gemini-3.1-pro-preview")
  _ = [r async for r in llm.generate_content_async(_request([USER]))]
  req = seen["requests"][0]
  assert "aiplatform.googleapis.com" in str(req.url)
  assert str(req.url).endswith("/models/gemini-3.1-pro-preview:generateContent")
  assert req.headers["authorization"] == "Bearer adc-token"
  assert "x-apikey" not in req.headers and "use-cache" not in req.headers
  step = next(e for e in await _drain(rec) if e["type"] == "llm_step")
  assert step["via"] == "vertex_direct" and step["model"] == "gemini-3.1-pro-preview"


async def test_passthrough_adapter_goes_through_apigee_without_governance(captured):
  seen = captured(lambda r: httpx.Response(
      200,
      json={**APIGEE_BODY, "modelVersion": "gemini-3.1-pro-preview"},
      headers={"x-gateway-model": "gemini-3.1-pro-preview", "x-gateway-mode": "passthrough", "x-gateway-cost-usd": "0.012000"},
  ))
  rec = RunRecorder("baseline")
  llm = GatewayLlm.for_passthrough(
      recorder=rec, api_key="admin-key", identity_token="jwt", run_id="r1", agent_id="cs-baseline",
      model="gemini-3.1-pro-preview",
  )
  _ = [r async for r in llm.generate_content_async(_request([USER]))]
  req = seen["requests"][0]
  assert str(req.url).endswith("/passthrough/v1/models/gemini-3.1-pro-preview:generateContent")
  assert req.headers["x-apikey"] == "admin-key"
  assert req.headers["authorization"] == "Bearer jwt"
  assert req.headers["x-session-id"] == "r1"
  # Same header as the governed side on the first turn (the pass-through has no cache, so it is inert).
  assert req.headers["use-cache"] == "true"
  events = await _drain(rec)
  step = next(e for e in events if e["type"] == "llm_step")
  assert step["via"] == "apigee_passthrough"
  assert step["model"] == "gemini-3.1-pro-preview" and step["cache_requested"] is True
  assert step["gateway_cost_usd"] == 0.012
  assert not [e for e in events if e["type"] == "governance_event"]


async def test_read_timeout_is_retried_once_then_succeeds(captured):
  calls = {"n": 0}

  def handler(request):
    calls["n"] += 1
    if calls["n"] == 1:
      raise httpx.ReadTimeout("slow", request=request)
    return httpx.Response(200, json={**APIGEE_BODY, "modelVersion": "gemini-3.1-pro-preview"})

  captured(handler)
  rec = RunRecorder("baseline")
  llm = GatewayLlm.for_passthrough(
      recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a", model="gemini-3.1-pro-preview",
  )
  responses = [r async for r in llm.generate_content_async(_request([USER]))]
  assert calls["n"] == 2
  assert responses[0].error_code is None
  step = next(e for e in await _drain(rec) if e["type"] == "llm_step")
  assert step["status"] == 200


async def test_repeated_timeout_is_recorded_as_failed_step(captured):
  def handler(request):
    raise httpx.ReadTimeout("slow", request=request)

  seen = captured(handler)
  rec = RunRecorder("baseline")
  llm = GatewayLlm.for_passthrough(
      recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a", model="gemini-3.1-pro-preview",
  )
  responses = [r async for r in llm.generate_content_async(_request([USER]))]
  assert len(seen["requests"]) == 2
  assert responses[0].error_code == "HTTP_504"
  events = await _drain(rec)
  step = next(e for e in events if e["type"] == "llm_step")
  assert step["status"] == 504 and step["billable"] is False
  assert step["model"] == "gemini-3.1-pro-preview" and step["tokens"]["prompt"] == 0
  gov = [e for e in events if e["type"] == "governance_event"]
  assert gov[0]["kind"] == "upstream_timeout"


async def test_apigee_adapter_skips_cache_when_disabled(captured):
  seen = captured(lambda r: httpx.Response(200, json=APIGEE_BODY))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(
      recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a", use_cache=False,
  )
  _ = [r async for r in llm.generate_content_async(_request([USER]))]
  assert "use-cache" not in seen["requests"][0].headers
  step = next(e for e in await _drain(rec) if e["type"] == "llm_step")
  assert step["cache_requested"] is False


async def test_passthrough_skips_cache_header_when_disabled(captured):
  seen = captured(lambda r: httpx.Response(200, json=APIGEE_BODY, headers={"x-gateway-mode": "passthrough"}))
  rec = RunRecorder("baseline")
  llm = GatewayLlm.for_passthrough(
      recorder=rec, api_key="admin-key", identity_token="jwt", run_id="r1", agent_id="cs-baseline",
      model="gemini-3.1-pro-preview", use_cache=False,
  )
  _ = [r async for r in llm.generate_content_async(_request([USER]))]
  assert "use-cache" not in seen["requests"][0].headers
