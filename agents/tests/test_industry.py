"""Industry packs in the Agent Showcase: profile selection and the local proxy stand-in."""

import json
from collections import deque
from pathlib import Path

import pytest

from app import mcp_transport
from app.gateway_sim import SimulatedGatewayTransport, decide, filter_tools_list, tools_for
from app.mcp_transport import RecordingTransport, classify_tool_outcome
from app.profiles import (
    BIGQUERY_MCP,
    CUSTOMER_SERVICE,
    INDUSTRY_DIR,
    INDUSTRY_PACKS,
    SERVICENOW_MCP,
    profile_for,
)
from app.recorder import RunRecorder

_httpx = mcp_transport._httpx
BANKING = INDUSTRY_PACKS["banking"]


def test_packs_are_in_sync_with_the_repo_source():
  # In the repo the source is industries/; in the Docker build only the copy exists.
  src = Path(__file__).resolve().parents[2] / "industries"
  if not src.is_dir():
    pytest.skip("industries/ not in the build context")
  for path in src.glob("*.json"):
    assert (INDUSTRY_DIR / path.name).read_text() == path.read_text(), "run: node industries/sync.js"


def test_banking_profile_swaps_instruction_and_business_mcp_only():
  p = profile_for("customer_service", "banking")
  assert p.industry == "banking" and p.id == CUSTOMER_SERVICE.id
  assert p.instruction == BANKING["showcase"]["instruction"] and "bank" in p.instruction
  for side in ("baseline", "governed"):
    servers = p.sides[side].mcp_servers
    assert [s.path for s in servers] == ["/banking/mcp", "/bigquery/mcp", "/servicenow/mcp"]
    assert servers[0].industry == "banking" and servers[0].label == "Banking tools MCP"
    assert servers[1] is BIGQUERY_MCP and servers[2] is SERVICENOW_MCP
    # Only the key and model route differ between sides, as in the generic profile.
    assert p.sides[side].llm == CUSTOMER_SERVICE.sides[side].llm
    assert p.sides[side].key_role == CUSTOMER_SERVICE.sides[side].key_role


@pytest.mark.parametrize("industry", [None, "", "real-estate-development", "unknown"])
def test_no_pack_keeps_the_generic_profile(industry):
  assert profile_for("customer_service", industry) is CUSTOMER_SERVICE


def test_tools_for_personas():
  ops, admin = tools_for(BANKING, "ops"), tools_for(BANKING, "admin")
  assert "reverseFee" in ops and "getSegmentProfitability" not in ops
  assert admin == {t["name"] for t in BANKING["tools"]} and ops < admin


def test_decide_mirrors_the_proxy():
  now = 1000.0
  # Governed key: a tool outside its product -> 401.
  status, body, _ = decide(BANKING, "ops", "getSegmentProfitability", {}, deque(), now)
  assert status == 401 and body["fault"]["detail"]["errorcode"] == "oauth.v2.InvalidApiKeyForGivenResource"
  # Over the limit -> 403 JSON-RPC tool error with the pack's code.
  status, body, headers = decide(BANKING, "ops", "reverseFee", {"feeId": "FEE-7002", "amount": 120}, deque(), now)
  assert status == 403 and headers == {"x-gateway-limit": "FEE_REVERSAL_LIMIT"}
  err = json.loads(body["result"]["content"][0]["text"])
  assert err["error"] == "FEE_REVERSAL_LIMIT" and err["requested"] == 120 and err["enforcedBy"] == "Apigee"
  # Within the limit, and the admin key has no limit.
  assert decide(BANKING, "ops", "reverseFee", {"feeId": "FEE-7001", "amount": 30}, deque(), now) is None
  assert decide(BANKING, "admin", "reverseFee", {"feeId": "FEE-7002", "amount": 120}, deque(), now) is None
  # Per-minute quota: forecast is tight even for admin; old calls expire.
  quota = next(t["quotaPerMin"] for t in BANKING["tools"] if t["name"] == "runCreditLossForecast")
  full = deque([now - 1] * quota)
  assert decide(BANKING, "admin", "runCreditLossForecast", {}, full, now)[0] == 429
  assert decide(BANKING, "admin", "runCreditLossForecast", {}, deque([now - 61] * quota), now) is None


def test_filter_tools_list():
  body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "reverseFee"}, {"name": "getSegmentProfitability"}]}}).encode()
  out = json.loads(filter_tools_list(body, tools_for(BANKING, "ops")))
  assert [t["name"] for t in out["result"]["tools"]] == ["reverseFee"]
  assert filter_tools_list(b"not json", set()) == b"not json"


def test_business_limit_is_classified():
  text = json.dumps({"error": "FEE_REVERSAL_LIMIT", "message": "Fee reversals over $50 need supervisor approval.", "enforcedBy": "Apigee"})
  assert classify_tool_outcome(403, text, None) == ("business_limit", "Fee reversals over $50 need supervisor approval.")
  # A backend error that merely mentions a limit is not a gateway decision.
  assert classify_tool_outcome(200, json.dumps({"error": "CREDIT_LIMIT"}), None) is None


class _Upstream(_httpx.AsyncBaseTransport):
  """Stands in for the local industry-apis: lists every tool, answers every call."""

  def __init__(self):
    self.calls = []

  async def handle_async_request(self, request):
    rpc = json.loads(request.content)
    self.calls.append(rpc["method"])
    if rpc["method"] == "tools/list":
      result = {"tools": [{"name": t["name"]} for t in BANKING["tools"]]}
    else:
      result = {"content": [{"type": "text", "text": "{\"ok\":true}"}], "isError": False}
    return _httpx.Response(200, headers={"content-type": "application/json"}, json={"jsonrpc": "2.0", "id": rpc["id"], "result": result})


async def _post(transport, body):
  async with _httpx.AsyncClient(transport=transport) as client:
    return await client.post("http://localhost:8091/banking/mcp", json=body)


async def test_governed_side_through_recorder_and_simulated_proxy():
  import asyncio
  queue = asyncio.Queue()
  upstream = _Upstream()
  transport = RecordingTransport(RunRecorder("governed", queue), "Banking tools MCP", SimulatedGatewayTransport(BANKING, "ops", upstream))

  listed = (await _post(transport, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})).json()
  assert {t["name"] for t in listed["result"]["tools"]} == tools_for(BANKING, "ops")

  # The 403 limit reaches the agent as a tool error (HTTP 200) and never hits the backend.
  r = await _post(transport, {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "reverseFee", "arguments": {"feeId": "FEE-7002", "amount": 120}}})
  assert r.status_code == 200 and r.json()["id"] == 2 and r.json()["result"]["isError"] is True
  assert upstream.calls == ["tools/list"]

  events = []
  while not queue.empty():
    events.append(queue.get_nowait())
  gov = [e for e in events if e.get("type") == "governance_event"]
  assert gov and gov[-1]["kind"] == "business_limit"


def test_api_lists_industries_and_checks_the_slug():
  from fastapi.testclient import TestClient
  from app import main
  client = TestClient(main.app)
  assert "banking" in client.get("/v1/profiles").json()["industries"]
  headers = {"X-Showcase-Identity-Token": "jwt", "X-Showcase-Governed-Key": "gov", "X-Showcase-Baseline-Key": "base"}
  r = client.post("/v1/showcase/run", json={"prompt": "hi", "industry": "Bad Slug!"}, headers=headers)
  assert r.status_code == 422
