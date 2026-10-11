/**
 * Agent Showcase unit tests: the client reducer/pricing (src/utils/agentShowcase.js) and
 * the server route (server/agentShowcase.js) with fake Apigee, ID-token and agent-service
 * dependencies. The live path is covered by agents/scripts/smoke_live.py.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import {
  BASELINE_MODELS,
  SHOWCASE_SCENARIOS,
  addToScoreboard,
  emptyRun,
  emptyScoreboard,
  formatMs,
  formatUsd,
  parseSseChunk,
  priceSteps,
  rateFor,
  ratio,
  reduceShowcaseEvent,
  sideSummary,
  alignedKeys,
  isRefusedHop,
  visibleItems,
  NO_MODEL,
} from '../src/utils/agentShowcase.js';
import { callerEmail, createAgentShowcaseService, parseRunBody } from '../server/agentShowcase.js';

test('refused tool servers show in the timeline once per server without the protocol view', () => {
  const hop = (method, server, status) => ({ kind: 'hop', method, server, status, endpoint: '', latency_ms: 30, t_ms: 0 });
  const items = [
    hop('initialize', 'bigquery', 200),
    hop('tools/list', 'mcp', 200),
    hop('tools/list', 'bigquery', 401),
    hop('tools/list', 'servicenow', 401),
    { kind: 'llm', step: 1 },
    hop('tools/list', 'bigquery', 401),
    hop('tools/list', 'servicenow', 403),
  ];
  assert.equal(isRefusedHop(items[2]), true);
  assert.equal(isRefusedHop(items[0]), false);
  assert.equal(isRefusedHop(items[1]), false);
  const shown = visibleItems(items, false);
  assert.deepEqual(shown.map((x) => (x.kind === 'hop' ? `${x.server}:${x.status}` : x.kind)), ['bigquery:401', 'servicenow:401', 'llm']);
  assert.equal(visibleItems(items, true).length, items.length);
});

const RATES = {
  'gemini-3.5-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-3.6-flash': { input: 0.15, output: 0.6 },
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
  'claude-haiku-5-5': { input: 1.0, output: 5.0 },
};

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

test('parseSseChunk returns complete events and keeps the partial tail', () => {
  const { events, rest } = parseSseChunk('data: {"type":"run"}\n\n: keep-alive\n\ndata: {"type":"do');
  assert.deepEqual(events, [{ type: 'run' }]);
  assert.equal(rest, 'data: {"type":"do');
  const next = parseSseChunk(rest + 'ne"}\n\n');
  assert.deepEqual(next.events, [{ type: 'done' }]);
  assert.equal(next.rest, '');
});

test('parseSseChunk skips malformed events', () => {
  assert.deepEqual(parseSseChunk('data: {oops\n\ndata: {"a":1}\n\n').events, [{ a: 1 }]);
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function play(events) {
  return events.reduce(reduceShowcaseEvent, emptyRun());
}

const RUN = [
  { type: 'run', run_id: 'r1', prompt: 'Where is ORD-1042?', sides: ['baseline', 'governed'] },
  { side: 'governed', type: 'run_started', label: 'With Apigee', llm: 'Apigee AI Gateway /auto', mcp_servers: ['Business tools MCP'], t_ms: 0 },
  { side: 'governed', type: 'tools_offered', tools: ['getOrderStatus', 'issueRefund'], count: 2, t_ms: 300 },
  { side: 'governed', type: 'llm_step', step: 1, model: 'gemini-3.5-flash-lite', status: 200, billable: true, cache: 'MISS', tokens: { prompt: 1000, output: 20 }, t_ms: 2000 },
  { side: 'governed', type: 'governance_event', kind: 'routed', detail: "Auto-routed 'simple'", t_ms: 2000 },
  { side: 'governed', type: 'tool_call', rpc_id: 3, name: 'issueRefund', args: { amount: 120 }, t_ms: 2001 },
  { side: 'governed', type: 'tool_result', rpc_id: 3, name: 'issueRefund', is_error: true, http_status: 403, latency_ms: 80, result: { error: 'REFUND_LIMIT' }, t_ms: 2100 },
  { side: 'governed', type: 'governance_event', kind: 'refund_limit', detail: 'Refunds over $50 need supervisor approval.', t_ms: 2100 },
  { side: 'governed', type: 'llm_step', step: 2, model: 'gemini-3.6-flash', status: 200, billable: true, cache: 'DISABLED', tokens: { prompt: 2000, output: 100 }, t_ms: 3500 },
  { side: 'governed', type: 'final', text: 'I opened a case.', error: null, t_ms: 3500 },
  { side: 'governed', type: 'metrics', e2e_ms: 3500, llm_steps: 2, tool_calls: 1, tokens: { prompt: 3000, output: 120, thoughts: 0, total: 3120 }, t_ms: 3500 },
  { side: 'governed', type: 'run_finished', t_ms: 3500 },
];

test('reducer builds the governed timeline and pairs tool results with calls', () => {
  const run = play(RUN);
  const g = run.sides.governed;
  assert.equal(run.runId, 'r1');
  assert.equal(g.status, 'done');
  assert.equal(g.llm, 'Apigee AI Gateway /auto');
  assert.deepEqual(g.toolsOffered, ['getOrderStatus', 'issueRefund']);
  assert.deepEqual(g.items.map((i) => i.kind), ['llm', 'governance', 'tool', 'governance', 'llm']);
  const tool = g.items[2];
  assert.equal(tool.call.name, 'issueRefund');
  assert.equal(tool.result.http_status, 403);
  // The timeline item keeps kind 'governance'; the event's own kind moves to govKind.
  assert.equal(g.items[3].govKind, 'refund_limit');
  assert.deepEqual(g.governance.map((e) => e.kind), ['routed', 'refund_limit']);
  assert.equal(g.answer, 'I opened a case.');
  assert.equal(g.finishedMs, 3500);
  assert.equal(run.sides.baseline.status, 'running');
});

test('reducer marks a side as error when the run ends with an error', () => {
  const run = play([
    { type: 'run', run_id: 'r2', sides: ['governed'] },
    { side: 'governed', type: 'llm_step', step: 1, model: null, status: 400, billable: false, tokens: { prompt: 0, output: 0 }, error: 'Model armor', t_ms: 300 },
    { side: 'governed', type: 'final', text: '', error: 'Model armor template filter matched.', t_ms: 300 },
    { side: 'governed', type: 'run_finished', t_ms: 301 },
    { type: 'done' },
  ]);
  assert.equal(run.sides.governed.status, 'error');
  assert.equal(run.sides.baseline.status, 'idle');
  assert.equal(run.status, 'done');
});

test('reducer ignores unknown events and sides', () => {
  const before = play(RUN.slice(0, 1));
  assert.equal(reduceShowcaseEvent(before, { side: 'nobody', type: 'final' }), before);
  assert.equal(reduceShowcaseEvent(before, { side: 'governed', type: 'mystery' }), before);
  assert.equal(reduceShowcaseEvent(before, null), before);
});

// ---------------------------------------------------------------------------
// Pricing and summaries
// ---------------------------------------------------------------------------

test('rateFor strips version suffixes and rejects unknown models', () => {
  assert.deepEqual(rateFor('claude-haiku-5-5', RATES), { input: 1.0, output: 5.0 });
  assert.equal(rateFor('mystery-model', RATES), null);
  assert.equal(rateFor(null, RATES), null);
});

test('priceSteps uses the same rate card for both sides and skips cache hits and failures', () => {
  const items = [
    { kind: 'llm', model: 'gemini-3.1-pro-preview', status: 200, billable: true, tokens: { prompt: 132_000, output: 300 } },
    { kind: 'llm', model: 'gemini-3.5-flash-lite', status: 200, billable: false, cache: 'HIT', tokens: { prompt: 1200, output: 20 } },
    { kind: 'llm', model: null, status: 400, billable: false, tokens: { prompt: 0, output: 0 } },
    { kind: 'llm', model: 'mystery', status: 200, billable: true, tokens: { prompt: 10, output: 10 } },
    { kind: 'hop', status: 200 },
  ];
  const { usd, unpriced } = priceSteps(items, RATES);
  assert.ok(Math.abs(usd - (0.132 * 1.25 + 0.0003 * 5)) < 1e-9);
  assert.deepEqual(unpriced, ['mystery']);
});

test('sideSummary reports cost, tools and governance for the comparison card', () => {
  const s = sideSummary(play(RUN).sides.governed, RATES);
  const expected = (1000 / 1e6) * 0.075 + (20 / 1e6) * 0.3 + (2000 / 1e6) * 0.15 + (100 / 1e6) * 0.6;
  assert.ok(Math.abs(s.costUsd - expected) < 1e-12);
  assert.equal(s.e2eMs, 3500);
  assert.equal(s.llmSteps, 2);
  assert.equal(s.toolsOffered, 2);
  assert.deepEqual(s.toolsCalled, ['issueRefund']);
  assert.equal(s.toolErrors, 1);
  assert.deepEqual(s.models, ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  assert.deepEqual(s.governance, ['routed', 'refund_limit']);
});

test('scoreboard accumulates per side', () => {
  const sum = { costUsd: 0.01, e2eMs: 1000, promptTokens: 10, outputTokens: 2, toolsCalled: ['a'], governance: ['routed'], cacheHits: 1 };
  const b = addToScoreboard(addToScoreboard(emptyScoreboard(), { governed: sum, baseline: sum }), { governed: sum });
  assert.equal(b.runs, 2);
  assert.equal(b.sides.governed.runs, 2);
  assert.equal(b.sides.baseline.runs, 1);
  assert.ok(Math.abs(b.sides.governed.costUsd - 0.02) < 1e-12);
  assert.equal(b.sides.governed.cacheHits, 2);
});

test('formatting helpers', () => {
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(0.000123), '$0.00012');
  assert.equal(formatUsd(0.1654), '$0.1654');
  assert.equal(formatUsd(NaN), '—');
  assert.equal(formatMs(640), '640 ms');
  assert.equal(formatMs(13973), '14.0 s');
  assert.equal(ratio(10, 2), 5);
  assert.equal(ratio(10, 0), null);
});

test('scenarios: eight, numbered, plain customer voice with no tool names', () => {
  assert.equal(SHOWCASE_SCENARIOS.length, 8);
  assert.deepEqual(SHOWCASE_SCENARIOS.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7, 8]);
  const toolNames = /getOrderStatus|issueRefund|createSupportCase|getProductMargins|searchCustomers/;
  for (const s of SHOWCASE_SCENARIOS) assert.doesNotMatch(s.prompt, toolNames, s.id);
  // Scenario 2 must repeat scenario 1 verbatim, or the semantic cache cannot hit.
  assert.equal(SHOWCASE_SCENARIOS[1].prompt, SHOWCASE_SCENARIOS[0].prompt);
  // Scenario 8 runs the ungoverned agent on the cheapest allowed model.
  const cheap = SHOWCASE_SCENARIOS.find((s) => s.id === 'cheaper-model');
  assert.equal(cheap.baselineModel, 'gemini-3.5-flash-lite');
  assert.ok(BASELINE_MODELS.some((m) => m.id === cheap.baselineModel));
  // ...and always asks for a fresh answer, so the routed stronger model shows.
  assert.equal(cheap.useCache, false);
});

// ---------------------------------------------------------------------------
// Server route
// ---------------------------------------------------------------------------

test('parseRunBody validates prompt, sides and profile', () => {
  assert.deepEqual(parseRunBody({ prompt: '  hi  ' }), { prompt: 'hi', sides: ['baseline', 'governed'], profileId: 'customer_service', useCache: true, baselineModel: null, industry: null });
  assert.equal(parseRunBody({ prompt: 'hi', industry: 'banking' }).industry, 'banking');
  assert.equal(parseRunBody({ prompt: 'hi', industry: 'Banking; drop' }).industry, null);
  assert.equal(parseRunBody({ prompt: 'hi', baselineModel: 'gemini-3.6-flash' }).baselineModel, 'gemini-3.6-flash');
  assert.equal(parseRunBody({ prompt: 'hi', baselineModel: 'gpt-4o; drop' }).baselineModel, null);
  assert.equal(parseRunBody({ prompt: 'hi', useCache: false }).useCache, false);
  assert.deepEqual(parseRunBody({ prompt: 'hi', sides: ['governed', 'x'] }).sides, ['governed']);
  assert.throws(() => parseRunBody({ prompt: '' }), (e) => e.status === 400);
  assert.throws(() => parseRunBody({ prompt: 'hi', sides: ['x'] }), (e) => e.status === 400);
  assert.throws(() => parseRunBody({ prompt: 'x'.repeat(4001) }), (e) => e.status === 400);
});

test('callerEmail prefers the IAP header', () => {
  assert.equal(callerEmail({ headers: { 'x-goog-authenticated-user-email': 'accounts.google.com:a@b.com' } }, 'd@x.com'), 'a@b.com');
  assert.equal(callerEmail({ headers: {} }, 'd@x.com'), 'd@x.com');
});

function fakeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = headers;
  return req;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    chunks: [],
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    listeners: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    flushHeaders() { this.headersSent = true; },
    write(c) { this.headersSent = true; this.chunks.push(Buffer.from(c).toString()); return true; },
    end(c) { if (c) this.chunks.push(String(c)); this.headersSent = true; this.writableEnded = true; },
    on(ev, fn) { this.listeners[ev] = fn; },
  };
  return res;
}

function service(overrides = {}) {
  const calls = [];
  const svc = createAgentShowcaseService({
    getToken: async () => 'gcp-token',
    provision: async () => ({ apiKeys: { admin: 'ADMIN_KEY', sales_agent: 'SALES_KEY' } }),
    getIdentityToken: async (aud) => `id-token-for-${aud}`,
    serviceUrl: 'https://svc.example',
    defaultEmail: 'demo@example.com',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = Readable.from([Buffer.from('data: {"type":"run","run_id":"r"}\n\n'), Buffer.from('data: {"type":"done"}\n\n')]);
      return { ok: true, status: 200, body };
    },
    ...overrides,
  });
  return { svc, calls };
}

test('run: forwards identity and persona keys server-side and pipes the SSE stream', async () => {
  const { svc, calls } = service();
  const res = fakeRes();
  await svc.handleRequest(
    fakeReq({ body: { prompt: 'Where is ORD-1042?' }, headers: { 'x-goog-authenticated-user-email': 'accounts.google.com:user@example.com', 'x-goog-iap-jwt-assertion': 'IAP_JWT' } }),
    res,
    new URL('http://x/api/agent-showcase/run'),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  assert.match(res.chunks.join(''), /"type":"done"/);
  const { url, init } = calls[0];
  assert.equal(url, 'https://svc.example/v1/showcase/run');
  assert.equal(init.headers.Authorization, 'Bearer id-token-for-https://svc.example');
  assert.equal(init.headers['X-Showcase-Identity-Token'], 'IAP_JWT');
  assert.equal(init.headers['X-Showcase-User-Email'], 'user@example.com');
  assert.equal(init.headers['X-Showcase-Governed-Key'], 'SALES_KEY');
  assert.equal(init.headers['X-Showcase-Baseline-Key'], 'ADMIN_KEY');
  assert.deepEqual(JSON.parse(init.body), { prompt: 'Where is ORD-1042?', sides: ['baseline', 'governed'], profile_id: 'customer_service', use_cache: true });
  // Keys never reach the browser.
  assert.doesNotMatch(res.chunks.join(''), /SALES_KEY|ADMIN_KEY/);
});

test('run: mints a stand-in identity token when there is no IAP assertion', async () => {
  const { svc, calls } = service();
  await svc.handleRequest(fakeReq({ body: { prompt: 'hi' } }), fakeRes(), new URL('http://x/api/agent-showcase/run'));
  const jwt = calls[0].init.headers['X-Showcase-Identity-Token'];
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.equal(payload.email, 'demo@example.com');
});

test('run: missing persona key is a 409 with a clear message, and nothing is called', async () => {
  const { svc, calls } = service({ provision: async () => ({ apiKeys: { admin: 'A', sales_agent: '' } }) });
  const res = fakeRes();
  await svc.handleRequest(fakeReq({ body: { prompt: 'hi' } }), res, new URL('http://x/api/agent-showcase/run'));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.chunks.join('')).error, /Support & Sales/);
  assert.equal(calls.length, 0);
});

test('run: upstream validation errors come back as JSON', async () => {
  const { svc } = service({ fetchImpl: async () => ({ ok: false, status: 400, text: async () => '{"detail":"Missing API key for the baseline side."}' }) });
  const res = fakeRes();
  await svc.handleRequest(fakeReq({ body: { prompt: 'hi' } }), res, new URL('http://x/api/agent-showcase/run'));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.chunks.join('')).error, /baseline side/);
});

test('run: bad body is a 400 and GET is a 405', async () => {
  const { svc } = service();
  const res = fakeRes();
  await svc.handleRequest(fakeReq({ body: { prompt: '' } }), res, new URL('http://x/api/agent-showcase/run'));
  assert.equal(res.statusCode, 400);
  const res2 = fakeRes();
  await svc.handleRequest(fakeReq({ method: 'GET' }), res2, new URL('http://x/api/agent-showcase/run'));
  assert.equal(res2.statusCode, 405);
});

test('persona keys are cached per user', async () => {
  let n = 0;
  const { svc } = service({ provision: async () => { n += 1; return { apiKeys: { admin: 'A', sales_agent: 'S' } }; } });
  await svc.personaKeys('a@x.com');
  await svc.personaKeys('a@x.com');
  await svc.personaKeys('b@x.com');
  assert.equal(n, 2);
});

test('unknown sub-route is a JSON 404', async () => {
  const { svc } = service();
  const res = fakeRes();
  await svc.handleRequest(fakeReq({ method: 'GET' }), res, new URL('http://x/api/agent-showcase/nope'));
  assert.equal(res.statusCode, 404);
});

test('route is mounted in both server.js and vite.config.ts', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const vite = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  for (const src of [server, vite]) {
    assert.match(src, /createAgentShowcaseService/);
    assert.match(src, /\/api\/agent-showcase/);
  }
});

test('alignedKeys lists the same rows on both sides, stopped-before-a-model last', () => {
  const a = [{ model: 'pro' }, { model: 'flash' }];
  const b = [{ model: NO_MODEL }, { model: 'flash' }, { model: 'lite' }];
  assert.deepEqual(alignedKeys(a, b, 'model'), ['pro', 'flash', 'lite', NO_MODEL]);
  assert.deepEqual(alignedKeys([], [], 'name'), []);
});
