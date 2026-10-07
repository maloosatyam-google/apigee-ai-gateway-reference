import json

import pytest

from app import mcp_transport
from app.mcp_transport import (
    RecordingTransport,
    classify_tool_outcome,
    normalize,
    parse_rpc,
    recording_client_factory,
)
from app.recorder import RunRecorder

_httpx = mcp_transport._httpx

REFUND_403 = json.dumps({
    "id": 3, "jsonrpc": "2.0",
    "result": {"content": [{"type": "text", "text": json.dumps({"error": "REFUND_LIMIT", "message": "Refunds over $50 need supervisor approval. Requested $120.", "limit": 50, "requested": 120, "enforcedBy": "Apigee"})}], "isError": True},
}).encode()
FAULT_401 = json.dumps({"fault": {"faultstring": "Invalid ApiKey for given resource", "detail": {"errorcode": "oauth.v2.InvalidApiKeyForGivenResource"}}}).encode()
OK_200 = json.dumps({"id": 5, "jsonrpc": "2.0", "result": {"content": [{"type": "text", "text": "{\"orderId\":\"ORD-1042\",\"status\":\"Delayed\"}"}], "isError": False}}).encode()


def test_parse_rpc():
  assert parse_rpc(b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}')["method"] == "tools/list"
  assert parse_rpc(b"not json") is None
  assert parse_rpc(b'{"hello":1}') is None


def test_403_jsonrpc_result_becomes_200():
  status, body, info = normalize(403, REFUND_403, 3, "tools/call")
  assert status == 200 and body == REFUND_403
  assert info["is_error"] and info["rewritten"]
  assert "REFUND_LIMIT" in info["text"]


def test_apigee_fault_on_tool_call_becomes_tool_error():
  status, body, info = normalize(401, FAULT_401, 7, "tools/call")
  assert status == 200
  msg = json.loads(body)
  assert msg["id"] == 7 and msg["result"]["isError"] is True
  payload = json.loads(msg["result"]["content"][0]["text"])
  assert payload == {"error": "oauth.v2.InvalidApiKeyForGivenResource", "message": "Invalid ApiKey for given resource", "httpStatus": 401, "enforcedBy": "Apigee"}


def test_fault_on_non_tool_method_is_left_alone():
  status, body, _ = normalize(401, FAULT_401, 1, "tools/list")
  assert status == 401 and body == FAULT_401


def test_success_passes_through():
  status, body, info = normalize(200, OK_200, 5, "tools/call")
  assert status == 200 and body == OK_200 and not info["is_error"]


@pytest.mark.parametrize(
    "status,text,code,kind",
    [
        (403, '{"error":"REFUND_LIMIT","message":"Refunds over $50 need supervisor approval."}', None, "refund_limit"),
        (401, "", "oauth.v2.InvalidApiKeyForGivenResource", "tool_denied"),
        (429, "", "policies.ratelimit.QuotaViolation", "rate_limited"),
        (200, '{"status":"Delayed"}', None, None),
    ],
)
def test_classify_tool_outcome(status, text, code, kind):
  outcome = classify_tool_outcome(status, text, code)
  assert (outcome[0] if outcome else None) == kind


def _mock(handler):
  return _httpx.MockTransport(handler)


async def _events(rec):
  out = []
  while not rec.queue.empty():
    out.append(rec.queue.get_nowait())
  return out


async def test_transport_records_tool_call_and_refund_limit():
  rec = RunRecorder("governed")
  transport = RecordingTransport(rec, "Business tools MCP", inner=_mock(
      lambda r: _httpx.Response(403, content=REFUND_403, headers={"content-type": "application/json", "x-request-id": "rq"})))
  client = _httpx.AsyncClient(transport=transport)
  res = await client.post("https://gw/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "issueRefund", "arguments": {"orderId": "ORD-1042", "issueRefundBody": {"amount": 120}}}})
  assert res.status_code == 200
  events = await _events(rec)
  assert [e["type"] for e in events] == ["tool_call", "tool_result", "governance_event"]
  assert events[0]["name"] == "issueRefund"
  assert events[1]["http_status"] == 403 and events[1]["is_error"] is True
  assert events[1]["result"]["error"] == "REFUND_LIMIT"
  assert events[2]["kind"] == "refund_limit"
  assert rec.totals.tools_called == ["issueRefund"]


async def test_transport_records_handshake_hops():
  rec = RunRecorder("baseline")
  body = json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "a"}, {"name": "b"}]}}).encode()
  transport = RecordingTransport(rec, "BigQuery MCP", inner=_mock(
      lambda r: _httpx.Response(200, content=body, headers={"content-type": "application/json"})))
  client = _httpx.AsyncClient(transport=transport)
  await client.post("https://gw/bigquery/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
  # Notifications carry no id and are not recorded.
  await client.post("https://gw/bigquery/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
  events = await _events(rec)
  assert len(events) == 1
  assert events[0]["type"] == "gateway_hop" and events[0]["tools"] == 2 and events[0]["server"] == "BigQuery MCP"


def test_factory_accepts_mcp_signature():
  rec = RunRecorder("governed")
  client = recording_client_factory(rec, "x")(headers={"x-apikey": "k"}, timeout=_httpx.Timeout(5.0), auth=None)
  assert client.headers["x-apikey"] == "k"
