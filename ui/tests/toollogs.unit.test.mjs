import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonRpc,
  classifyToolCall,
  parseToolLogEntry,
  buildToolLogs,
  toolLogsFilter,
  parseToolLogsQuery,
} from '../server/toolLogs.js';

const entry = (p, ts = '2026-09-25T10:00:00Z') => ({ timestamp: ts, jsonPayload: { environmentName: 'prod', ...p } });
const call = (tool, args = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
const ok = (text = '{}', isError = false) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], isError } });

test('JSON-RPC parsing handles plain JSON, SSE framing and garbage', () => {
  assert.equal(parseJsonRpc('{"method":"ping"}').method, 'ping');
  assert.equal(parseJsonRpc('event: message\ndata: {"id":3,"result":{}}\n\n').id, 3);
  assert.equal(parseJsonRpc('<!DOCTYPE html>'), null);
  assert.equal(parseJsonRpc(''), null);
});

test('outcome classification', () => {
  assert.equal(classifyToolCall(200, { result: { isError: false } }), 'ok');
  assert.equal(classifyToolCall(200, { result: { isError: true } }), 'tool_error');
  assert.equal(classifyToolCall(200, { error: { code: -32601 } }), 'rpc_error');
  assert.equal(classifyToolCall(401, null), 'denied');
  assert.equal(classifyToolCall(403, null), 'denied');
  assert.equal(classifyToolCall(403, { result: { isError: true } }), 'tool_error'); // REFUND_LIMIT business rule
  assert.equal(classifyToolCall(404, null), 'rejected');
  assert.equal(classifyToolCall(429, null), 'throttled');
  assert.equal(classifyToolCall(502, null), 'error');
});

test('entry parsing: tool name, args, backend latency, fault-inferred status', () => {
  const r = parseToolLogEntry(entry({
    apiProxyName: 'mcp', trackingId: 't1',
    requestContent: call('getOrderStatus', { orderId: 'ORD-1042' }), responseContent: ok('{"status":"Delayed"}'),
    responseStatusCode: '200', targetSentStartTimeEpoch: '1000', targetReceivedEndTimeEpoch: '1250',
  }));
  assert.equal(r.tool, 'getOrderStatus');
  assert.equal(r.method, 'tools/call');
  assert.equal(r.arguments, '{"orderId":"ORD-1042"}');
  assert.equal(r.outcome, 'ok');
  assert.equal(r.backendMs, 250);
  assert.equal(r.attributed, false);

  const q = parseToolLogEntry(entry({ apiProxyName: 'mcp', requestContent: call('runForecast'), responseStatusCode: '', faultName: 'QuotaViolation' }));
  assert.equal(q.httpStatus, 429);
  assert.equal(q.outcome, 'throttled');

  const k = parseToolLogEntry(entry({ apiProxyName: 'bigquery-mcp', requestContent: '{"method":"tools/list"}', responseStatusCode: '', faultName: 'FailedToResolveAPIKey' }));
  assert.equal(k.outcome, 'denied');
  assert.equal(k.tool, '');

  assert.equal(parseToolLogEntry(entry({ apiProxyName: 'ai-gateway-v1' })), null);
});

test('caller attribution when the proxy logs developer fields', () => {
  const r = parseToolLogEntry(entry({
    apiProxyName: 'servicenow-mcp', requestContent: call('listIncidents'), responseContent: ok(), responseStatusCode: '200',
    developerApp: 'Unified Admin jordanlee App', developerEmail: 'jordan.lee@example.com',
  }));
  assert.equal(r.attributed, true);
  assert.equal(r.userKey, 'jordan.lee@example.com');
  const s = parseToolLogEntry(entry({
    apiProxyName: 'mcp', requestContent: call('x'), responseContent: ok(), responseStatusCode: '200',
    developerApp: 'Unified Sales App', developerEmail: 'owner@gmail.com',
  }));
  assert.equal(s.userKey, 'persona:sales_agent');
});

test('aggregation: tools used, protocol calls hidden by default, user + tool filters', () => {
  const rows = [
    parseToolLogEntry(entry({ apiProxyName: 'mcp', requestContent: call('a'), responseContent: ok(), responseStatusCode: '200', developerApp: 'Unified Admin jordanlee App', developerEmail: 'jordan.lee@example.com' }, '2026-09-25T10:00:03Z')),
    parseToolLogEntry(entry({ apiProxyName: 'mcp', requestContent: call('a'), responseContent: ok('boom', true), responseStatusCode: '200' }, '2026-09-25T10:00:02Z')),
    parseToolLogEntry(entry({ apiProxyName: 'mcp', requestContent: call('b'), responseStatusCode: '403' }, '2026-09-25T10:00:01Z')),
    parseToolLogEntry(entry({ apiProxyName: 'mcp', requestContent: '{"method":"tools/list"}', responseContent: '{"result":{}}', responseStatusCode: '200' })),
  ];
  const all = buildToolLogs(rows);
  assert.equal(all.scanned, 4);
  assert.equal(all.matched, 3); // tools/list hidden
  assert.deepEqual(all.byTool.map((t) => [t.tool, t.calls, t.ok, t.failed, t.blocked]), [['a', 2, 1, 1, 0], ['b', 1, 0, 0, 1]]);
  assert.equal(all.byTool[0].lastUsed, '2026-09-25T10:00:03Z');
  assert.equal(buildToolLogs(rows, { includeProtocol: true }).matched, 4);
  assert.equal(buildToolLogs(rows, { tool: 'b' }).entries.length, 1);

  const one = buildToolLogs(rows, { user: 'JORDAN.LEE@example.com' });
  assert.equal(one.matched, 1);
  assert.equal(one.unattributed, 3);
  assert.deepEqual(one.byTool.map((t) => t.tool), ['a']);
});

test('filter and query validation keep the Cloud Logging filter safe', () => {
  const f = toolLogsFilter({ project: 'p', env: 'prod', sinceIso: '2026-01-01T00:00:00Z' });
  assert.match(f, /jsonPayload\.apiProxyName=\("mcp" OR "bigquery-mcp" OR "servicenow-mcp"\)/);
  assert.match(f, /jsonPayload\.environmentName="prod"/);
  const q = (s) => parseToolLogsQuery(new URLSearchParams(s));
  assert.equal(q('env=dev&window=7d').value.env, 'dev');
  assert.equal(q('env=evil').value.env, 'prod');
  assert.equal(q('window=1y').ok, false);
  assert.equal(q('server=ai-gateway-v1').ok, false);
  assert.equal(q('tool=a" OR 1').ok, false);
  assert.equal(q('user=jordan.lee@example.com').ok, true);
  assert.equal(q('user=persona:sales_agent').ok, true);
  assert.equal(q('user=x" OR "y').ok, false);
  assert.equal(q('protocol=1').value.includeProtocol, true);
});
