import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentUserAgent,
  mcpSideForApp,
  isRefusedByKey,
  llmOutcome,
  mcpOutcome,
  buildAgentAnalytics,
  agentStatsUrls,
  agentToolsFilter,
  statsTimeRange,
  parseAgentToolEntry,
  handleAgentAnalytics,
  GOVERNED_TOOLS,
} from '../server/agentAnalytics.js';

const RATES = {
  'gemini-3.1-pro-preview': { input: 1.25, output: 5 },
  'gemini-3-flash-preview': { input: 0.15, output: 0.6 },
};

// One stats dimension in the timeUnit shape the Apigee stats API returns.
const dim = (names, metrics, ts = 1790467200000) => ({
  name: names.join(','),
  individualNames: names,
  metrics: Object.entries(metrics).map(([name, v]) => ({ name, values: [{ timestamp: ts, value: String(v) }] })),
});
const stats = (dims) => ({ environments: [{ name: 'prod', dimensions: dims }] });

test('agent traffic is recognised by the agent service user agents only', () => {
  assert.equal(isAgentUserAgent('python-httpx/0.28.1'), true);
  assert.equal(isAgentUserAgent('google-adk/2.10.0 gl-python/3.12.14'), true);
  assert.equal(isAgentUserAgent('node'), false);
  assert.equal(isAgentUserAgent('curl/8.7.1'), false);
  assert.equal(isAgentUserAgent('Python-urllib/3.9'), false);
  assert.equal(isAgentUserAgent('Mozilla/5.0 (Macintosh)'), false);
  assert.equal(isAgentUserAgent('(not set)'), false);
});

test('MCP calls belong to an agent by the key used', () => {
  assert.equal(mcpSideForApp('Unified Sales App'), 'governed');
  assert.equal(mcpSideForApp('Unified Admin alexdemo App'), 'baseline');
  assert.equal(mcpSideForApp('(not set)'), null);
  assert.equal(mcpSideForApp('Unified Loans App'), null);
});

test('outcomes from status codes', () => {
  assert.equal(llmOutcome('200', 'MISS'), 'ok');
  assert.equal(llmOutcome('200', 'HIT'), 'cached');
  assert.equal(llmOutcome('429', '(not set)'), 'limited');
  assert.equal(llmOutcome('400', '(not set)'), 'blocked');
  assert.equal(llmOutcome('504', '(not set)'), 'error');
  assert.equal(mcpOutcome('202'), 'ok');
  assert.equal(mcpOutcome('403'), 'denied');
  assert.equal(mcpOutcome('429'), 'limited');
  assert.equal(mcpOutcome('500'), 'error');
});

test('buildAgentAnalytics splits, prices and ignores non-agent traffic', () => {
  const m = (count, pt, ct, rt) => ({ 'sum(message_count)': count, 'sum(dc_prompt_token_count)': pt, 'sum(dc_candidates_token_count)': ct, 'avg(total_response_time)': rt });
  const llm = stats([
    dim(['llm-passthrough-v1', 'python-httpx/0.28.1', 'gemini-3.1-pro-preview', '200', 'DISABLED'], m(2, 264000, 400, 10000)),
    dim(['llm-passthrough-v1', 'python-httpx/0.28.1', 'gemini-3.1-pro-preview', '429', '(not set)'], m(1, 0, 0, 1000)),
    dim(['ai-gateway-v1', 'python-httpx/0.28.1', 'gemini-3-flash-preview', '200', 'MISS'], m(3, 6000, 900, 3000)),
    dim(['ai-gateway-v1', 'python-httpx/0.28.1', 'null', '200', 'HIT'], m(1, 2000, 100, 800)),
    dim(['ai-gateway-v1', 'python-httpx/0.28.1', 'null', '429', '(not set)'], m(2, 0, 0, 200)),
    // UI chat traffic on the same proxy: not an agent.
    dim(['ai-gateway-v1', 'node', 'gemini-3-flash-preview', '200', 'MISS'], m(50, 99999, 9999, 1000)),
  ]);
  const mm = (count, rt) => ({ 'sum(message_count)': count, 'avg(total_response_time)': rt });
  const mcp = stats([
    dim(['mcp', 'google-adk/2.10.0 gl-python/3.12.14', 'Unified Admin a App', '200'], mm(4, 100)),
    dim(['bigquery-mcp', 'google-adk/2.10.0 gl-python/3.12.14', 'Unified Admin a App', '200'], mm(2, 150)),
    dim(['mcp', 'google-adk/2.10.0 gl-python/3.12.14', 'Unified Sales App', '200'], mm(5, 90)),
    dim(['mcp', 'google-adk/2.10.0 gl-python/3.12.14', 'Unified Sales App', '403'], mm(1, 80)),
    dim(['mcp', 'google-adk/2.10.0 gl-python/3.12.14', '(not set)', '202'], mm(6, 20)),
    dim(['mcp', 'node', 'Unified Sales App', '200'], mm(40, 50)),
  ]);
  const toolRows = [
    { tool: 'getOrderStatus', server: 'mcp', outcome: 'ok', backendMs: 100, timestamp: '2026-09-27T10:00:00Z', appName: 'Unified Sales App' },
    { tool: 'issueRefund', server: 'mcp', outcome: 'tool_error', backendMs: 50, timestamp: '2026-09-27T10:01:00Z', appName: 'Unified Sales App' },
    { tool: 'run_query', server: 'bigquery-mcp', outcome: 'ok', backendMs: 200, timestamp: '2026-09-27T10:02:00Z', appName: 'Unified Admin a App' },
    { tool: 'ignored', server: 'mcp', outcome: 'ok', backendMs: 1, timestamp: null, appName: '' },
  ];
  const out = buildAgentAnalytics({ llmStats: llm, mcpStats: mcp, rates: RATES, toolRows });
  const b = out.sides.baseline;
  const g = out.sides.governed;

  assert.equal(b.llm.calls, 3);
  assert.equal(b.llm.limited, 1);
  assert.equal(b.llm.inputTokens, 264000);
  assert.equal(b.llm.costUsd, (264000 * 1.25 + 400 * 5) / 1e6);
  assert.deepEqual(b.llm.statuses.map((s) => [s.status, s.calls]), [['429', 1]]);

  assert.equal(g.llm.calls, 6); // node traffic excluded
  assert.equal(g.llm.cached, 1);
  assert.equal(g.llm.limited, 2);
  assert.equal(g.llm.costUsd, (6000 * 0.15 + 900 * 0.6) / 1e6); // cache hit not billed
  assert.equal(g.llm.models.find((x) => x.model === 'Reused answer (cache)').costUsd, null);
  assert.equal(g.llm.statuses[0].label, 'Stopped: usage limit reached');

  assert.equal(b.mcp.calls, 6);
  assert.deepEqual(b.mcp.servers.map((s) => s.proxy), ['mcp', 'bigquery-mcp']);
  // Same `mcp` proxy, labelled by the product each agent's key maps to.
  assert.equal(b.mcp.servers[0].label, 'Business tools: all 12, unrestricted');
  assert.equal(g.mcp.servers[0].label, 'Business tools: 7 authorized for customer service');
  assert.equal(g.tools[0].serverLabel, 'Business tools: 7 authorized for customer service');
  assert.equal(g.mcp.calls, 6);
  assert.equal(g.mcp.denied, 1);
  assert.equal(out.handshakes, 6);

  // Both agents get the same tool rows in the same order; tools off a key are marked.
  assert.deepEqual(g.tools.map((t) => t.tool), b.tools.map((t) => t.tool));
  assert.deepEqual(g.tools.map((t) => [t.tool, t.calls, t.ok, t.blocked, t.available]), [
    ['getOrderStatus', 1, 1, 0, true], ['issueRefund', 1, 0, 1, true], ['run_query', 0, 0, 0, false],
  ]);
  assert.deepEqual(b.tools.map((t) => [t.tool, t.calls, t.available]), [['getOrderStatus', 0, true], ['issueRefund', 0, true], ['run_query', 1, true]]);
  // Same models, outcomes and servers on both sides, same order.
  assert.deepEqual(g.llm.models.map((m) => m.model), b.llm.models.map((m) => m.model));
  assert.deepEqual(b.llm.models.map((m) => m.model), ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'Reused answer (cache)', 'Blocked before a model']); // 3 calls each: name order
  assert.deepEqual(b.llm.statuses.map((x) => [x.status, x.calls]), [['429', 1]]);
  assert.deepEqual(g.mcp.servers.map((x) => [x.proxy, x.available, x.calls]), [['mcp', true, 6], ['bigquery-mcp', false, 0]]);

  assert.equal(out.series.length, 1);
  assert.equal(out.series[0].baseline.llmCalls, 3);
  assert.equal(out.series[0].governed.mcpCalls, 6);
  assert.deepEqual(out.unpriced, []);
});

test('governed agent refused on BigQuery / ServiceNow (401, no app) counts as its blocked calls', () => {
  assert.equal(isRefusedByKey('bigquery-mcp', '401'), true);
  assert.equal(isRefusedByKey('servicenow-mcp', '403'), true);
  assert.equal(isRefusedByKey('mcp', '401'), false);
  assert.equal(isRefusedByKey('bigquery-mcp', '200'), false);
  const mm = (count, rt) => ({ 'sum(message_count)': count, 'avg(total_response_time)': rt });
  const ua = 'google-adk/2.10.0 gl-python/3.12.14';
  const mcp = stats([
    dim(['bigquery-mcp', ua, 'Unified Admin a App', '200'], mm(3, 150)),
    dim(['bigquery-mcp', ua, '(not set)', '200'], mm(2, 20)), // initialize: handshake
    dim(['bigquery-mcp', ua, '(not set)', '401'], mm(4, 60)),
    dim(['servicenow-mcp', ua, '(not set)', '401'], mm(4, 40)),
    dim(['servicenow-mcp', 'curl/8.7.1', '(not set)', '401'], mm(9, 40)), // not an agent
  ]);
  const out = buildAgentAnalytics({ llmStats: stats([]), mcpStats: mcp, rates: RATES, toolRows: [] });
  const g = out.sides.governed;
  assert.equal(g.mcp.calls, 8);
  assert.equal(g.mcp.denied, 8);
  assert.deepEqual(g.mcp.servers.map((x) => [x.proxy, x.available, x.calls, x.denied]), [['bigquery-mcp', false, 4, 4], ['servicenow-mcp', false, 4, 4]]);
  assert.equal(out.sides.baseline.mcp.calls, 3);
  assert.equal(out.handshakes, 2);
});

test('unpriced models are reported, not guessed', () => {
  const llm = stats([dim(['ai-gateway-v1', 'python-httpx/0.28.1', 'mystery-model', '200', 'MISS'], { 'sum(message_count)': 1, 'sum(dc_prompt_token_count)': 10, 'sum(dc_candidates_token_count)': 1, 'avg(total_response_time)': 5 })]);
  const out = buildAgentAnalytics({ llmStats: llm, mcpStats: stats([]), rates: RATES });
  assert.deepEqual(out.unpriced, ['mystery-model']);
  assert.equal(out.sides.governed.llm.costUsd, 0);
});

test('stats URLs and log filter', () => {
  const u = agentStatsUrls({ org: 'o', env: 'prod', timeRange: '09/20/2026 00:00~09/27/2026 00:00', timeUnit: 'day' });
  assert.match(u.llm, /stats\/apiproxy,useragent,dc_model_name,response_status_code,dc_cache_status\?/);
  assert.match(u.llm, /timeUnit=day/);
  assert.match(decodeURIComponent(u.llm), /apiproxy in 'llm-passthrough-v1','ai-gateway-v1'/);
  assert.match(decodeURIComponent(u.mcp), /apiproxy in 'mcp','bigquery-mcp','servicenow-mcp'/);
  const f = agentToolsFilter({ project: 'p', env: 'dev', sinceIso: '2026-09-20T00:00:00.000Z' });
  assert.match(f, /jsonPayload.environmentName="dev"/);
  assert.match(f, /requestContent:"_meta"/);
  assert.equal(statsTimeRange(24, new Date('2026-09-27T10:05:00Z')), '09/26/2026 10:05~09/27/2026 10:05');
});

test('parseAgentToolEntry keeps the app name', () => {
  const row = parseAgentToolEntry({
    timestamp: '2026-09-27T10:00:00Z',
    jsonPayload: {
      apiProxyName: 'mcp', developerApp: 'Unified Sales App', responseStatusCode: '200',
      requestContent: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getOrderStatus","arguments":{},"_meta":{}}}',
      responseContent: '{"jsonrpc":"2.0","id":3,"result":{"content":[],"isError":false}}',
    },
  });
  assert.equal(row.tool, 'getOrderStatus');
  assert.equal(row.appName, 'Unified Sales App');
  assert.equal(row.outcome, 'ok');
});

test('handleAgentAnalytics validates the range and degrades when logs fail', async () => {
  const mkRes = () => ({ statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
  const bad = mkRes();
  await handleAgentAnalytics({}, bad, { parsedUrl: new URL('http://x/?timeRange=1y'), getToken: async () => 't' });
  assert.equal(bad.statusCode, 400);

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('logging.googleapis.com')) return { ok: false, status: 429, json: async () => ({}) };
    if (String(url).includes('keyvaluemaps')) return { ok: true, status: 200, json: async () => ({ value: JSON.stringify(RATES) }) };
    return { ok: true, status: 200, json: async () => stats([]) };
  };
  const res = mkRes();
  await handleAgentAnalytics({}, res, { parsedUrl: new URL('http://x/?env=dev&timeRange=24h'), getToken: async () => 't', fetchImpl, now: () => new Date('2026-09-27T10:00:00Z') });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.env, 'dev');
  assert.equal(body.timeUnit, 'hour');
  assert.equal(body.toolsError, 'Cloud Logging returned 429');
  assert.equal(body.ratesError, null);
  assert.ok(calls.some((c) => c.includes('/environments/dev/stats/')));
});

test('GOVERNED_TOOLS matches the Customer Service Tools MCP product', async () => {
  const { readFile } = await import('node:fs/promises');
  const product = JSON.parse(await readFile(new URL('../../apigee/products/customer_service_tools_mcp.json', import.meta.url), 'utf8'));
  const tools = product.payloadOperationGroup.operationConfigs
    .flatMap((c) => c.operations.map((o) => o.operation))
    .filter((o) => o.startsWith('tools/call/'))
    .map((o) => o.slice('tools/call/'.length));
  assert.deepEqual([...tools].sort(), [...GOVERNED_TOOLS].sort());
});
