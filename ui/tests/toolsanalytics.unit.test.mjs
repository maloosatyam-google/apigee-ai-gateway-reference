import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolsAnalytics, classifyStatus, personaForApp, toolsStatsUrl, identityFor } from '../server/toolsAnalytics.js';

const dim = (proxy, app, status, calls, latency) => ({
  name: `${proxy},${app},${status}`,
  individualNames: [proxy, app, status],
  metrics: [
    { name: 'sum(message_count)', values: [String(calls)] },
    { name: 'avg(total_response_time)', values: [String(latency)] },
  ],
});
const stats = (dims) => ({ environments: [{ name: 'prod', dimensions: dims }] });

test('status classes follow how the MCP proxies use them', () => {
  assert.equal(classifyStatus('200'), 'ok');
  assert.equal(classifyStatus('401'), 'denied');
  assert.equal(classifyStatus('403'), 'denied');
  assert.equal(classifyStatus('400'), 'rejected');
  assert.equal(classifyStatus('429'), 'throttled');
  assert.equal(classifyStatus('502'), 'error');
});

test('apps map to personas; missing app is "No credential"', () => {
  assert.equal(personaForApp('Unified Sales App').persona, 'Sales Agent');
  assert.equal(personaForApp('Unified Loans App').persona, 'Loans Agent');
  assert.deepEqual(personaForApp('Unified Admin alexdemo App'), { persona: 'Admin (alexdemo)', key: 'admin', handle: 'alexdemo' });
  assert.equal(personaForApp('(not set)').persona, 'No credential');
});

test('aggregates KPIs, servers, personas and statuses; ignores non-MCP proxies', () => {
  const out = buildToolsAnalytics(stats([
    dim('mcp', 'Unified Sales App', '200', 60, 600),
    dim('mcp', 'Unified Sales App', '401', 4, 100),
    dim('servicenow-mcp', '(not set)', '401', 3, 2),
    dim('bigquery-mcp', 'Unified Admin alexdemo App', '400', 1, 2),
    dim('ai-gateway-v1', 'Unified Sales App', '200', 999, 1), // not a tool server
  ]));
  assert.equal(out.kpis.totalCalls, 68);
  assert.equal(out.kpis.okCalls, 60);
  assert.equal(out.kpis.deniedCalls, 7);
  assert.equal(out.kpis.rejectedCalls, 1);
  assert.equal(out.kpis.successRate, 88.2);
  // weighted latency: (60*600 + 4*100 + 3*2 + 1*2) / 68
  assert.equal(out.kpis.avgLatencyMs, Math.round((36000 + 400 + 6 + 2) / 68));
  assert.deepEqual(out.byServer.map((s) => s.proxy), ['mcp', 'servicenow-mcp', 'bigquery-mcp']);
  assert.equal(out.byServer[0].label, 'Enterprise APIs (Customer Service & Insights tools)');
  const sales = out.byPersona.find((p) => p.persona === 'Sales Agent');
  assert.deepEqual([sales.calls, sales.ok, sales.denied], [64, 60, 4]);
  assert.deepEqual(out.byStatus[0], { status: '200', calls: 60, class: 'ok' });
});

test('handle restricts to one admin user (User view)', () => {
  const out = buildToolsAnalytics(stats([
    dim('mcp', 'Unified Admin alexdemo App', '200', 5, 100),
    dim('mcp', 'Unified Admin someoneelse App', '200', 9, 100),
    dim('mcp', 'Unified Sales App', '200', 9, 100),
  ]), { handle: 'AlexDemo' });
  assert.equal(out.kpis.totalCalls, 5);
  assert.equal(out.byPersona.length, 1);
});

test('empty / malformed stats produce zeroed KPIs with null rates', () => {
  const out = buildToolsAnalytics({});
  assert.equal(out.kpis.totalCalls, 0);
  assert.equal(out.kpis.successRate, null);
  assert.equal(out.kpis.avgLatencyMs, null);
  assert.deepEqual(out.byServer, []);
});

test('stats URL filters to the three MCP proxies in the requested env', () => {
  const url = toolsStatsUrl({ org: 'o', env: 'dev', apigeeTimeRange: 'x~y' });
  assert.match(url, /environments\/dev\/stats\/apiproxy,developer_app,developer_email,response_status_code\?/);
  assert.match(decodeURIComponent(url), /apiproxy in 'mcp','bigquery-mcp','servicenow-mcp'/);
});

const dim4 = (proxy, app, email, status, calls, latency = 100) => ({
  name: `${proxy},${app},${email},${status}`,
  individualNames: [proxy, app, email, status],
  metrics: [
    { name: 'sum(message_count)', values: [String(calls)] },
    { name: 'avg(total_response_time)', values: [String(latency)] },
  ],
});

test('identity: admin apps are the person, shared agent apps are the persona', () => {
  assert.equal(identityFor('Unified Admin jordanlee App', 'jordan.lee@example.com').userKey, 'jordan.lee@example.com');
  assert.equal(identityFor('Unified Sales App', 'owner@gmail.com').userKey, 'persona:sales_agent');
  assert.equal(identityFor('Unified Loans App', 'owner@gmail.com').userLabel, 'Loans Agent (shared agent key)');
  assert.equal(identityFor('(not set)', '(not set)').userKey, 'none');
});

test('user filter narrows KPIs but the users list stays complete', () => {
  const s = stats([
    dim4('mcp', 'Unified Admin jordanlee App', 'jordan.lee@example.com', '200', 10),
    dim4('mcp', 'Unified Admin alexdemo App', 'admin@example.com', '200', 5),
    dim4('mcp', 'Unified Admin alexdemo App', 'admin@example.com', '403', 1),
    dim4('mcp', 'Unified Sales App', 'owner@gmail.com', '200', 7),
    dim4('mcp', '(not set)', '(not set)', '401', 3),
  ]);
  const all = buildToolsAnalytics(s);
  assert.equal(all.kpis.totalCalls, 26);
  assert.deepEqual(all.users.map((u) => [u.key, u.calls]), [
    ['jordan.lee@example.com', 10], ['persona:sales_agent', 7], ['admin@example.com', 6], ['none', 3],
  ]);
  const one = buildToolsAnalytics(s, { user: 'ADMIN@example.com' });
  assert.equal(one.kpis.totalCalls, 6);
  assert.equal(one.kpis.deniedCalls, 1);
  assert.equal(one.users.length, 4);
  assert.equal(buildToolsAnalytics(s, { user: 'persona:sales_agent' }).kpis.totalCalls, 7);
  assert.equal(buildToolsAnalytics(s, { user: 'all' }).kpis.totalCalls, 26);
});
