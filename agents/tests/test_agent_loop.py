"""Offline end-to-end: a real ADK LlmAgent loop driven by GatewayLlm.

The HTTP layer is mocked, a plain Python tool stands in for MCP. This proves
ADK accepts the adapter's responses, runs the tool, and sends the tool result
back (with the thought signature) on the next model call.
"""

import json

import httpx
from google.adk.agents import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from app import gateway_llm
from app.agent import final_text
from app.gateway_llm import GatewayLlm
from app.recorder import RunRecorder


def get_order_status(order_id: str) -> dict:
  """Get the status of an order."""
  return {"orderId": order_id, "status": "Delayed"}


async def test_adk_loop_with_gateway_llm(monkeypatch):
  calls = []

  def handler(request):
    body = json.loads(request.content)
    calls.append(body)
    if len(calls) == 1:
      return httpx.Response(200, json={
          "candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": "get_order_status", "args": {"order_id": "ORD-1042"}}, "thoughtSignature": "c2lnbmF0dXJl"}]}, "finishReason": "STOP"}],
          "usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 10, "totalTokenCount": 60},
      }, headers={"x-gateway-model": "gemini-3.1-flash-lite", "x-gateway-cache-status": "MISS"})
    return httpx.Response(200, json={
        "candidates": [{"content": {"role": "model", "parts": [{"text": "Your order is delayed."}]}, "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": 80, "candidatesTokenCount": 8, "totalTokenCount": 88},
    }, headers={"x-gateway-model": "gemini-3-flash-preview"})

  monkeypatch.setattr(gateway_llm, "_http_client", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
  rec = RunRecorder("governed")
  llm = GatewayLlm.for_apigee(recorder=rec, api_key="k", identity_token="jwt", run_id="r", agent_id="a")
  agent = LlmAgent(name="customer_service_agent", model=llm, instruction="Help the customer.", tools=[get_order_status])
  runner = InMemoryRunner(agent=agent, app_name="t")
  session = await runner.session_service.create_session(app_name="t", user_id="u")

  answer = ""
  async for event in runner.run_async(user_id="u", session_id=session.id, new_message=types.Content(role="user", parts=[types.Part(text="Where is ORD-1042?")])):
    if event.is_final_response():
      answer = final_text(event.content) or answer

  assert answer == "Your order is delayed."
  assert len(calls) == 2
  # Second call carries the model's function call (with signature) and the tool result.
  second = calls[1]["contents"]
  fc_part = next(p for c in second for p in c["parts"] if "functionCall" in p)
  assert fc_part.get("thoughtSignature")
  fr = next(p for c in second for p in c["parts"] if "functionResponse" in p)
  assert fr["functionResponse"]["response"]["status"] == "Delayed"
  assert "Help the customer." in json.dumps(calls[0]["systemInstruction"])
  m = rec.metrics_payload()
  assert m["llm_steps"] == 2
  assert m["tokens"]["prompt"] == 130
  assert set(m["by_model"]) == {"gemini-3.1-flash-lite", "gemini-3-flash-preview"}
