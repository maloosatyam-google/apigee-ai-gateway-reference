/**
 * Ask Apigee insights: analytics / audit-log tools.
 *
 * Covers the logic that decides what a user may see and how a failure is
 * explained. The failure samples are copied from real prod log entries
 * (faultName + errorMessage + status) so a classifier regression shows up here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateUsage,
  buildCallLogSummary,
  callLogsFilter,
  classifyFailure,
  createInsights,
  effectiveUser,
  normalizeEmail,
  normalizeRange,
  parseCallEntry,
  rateFor,
} from '../server/insights.js';
import {
  INSIGHT_TOOL_NAMES,
  buildFunctionDeclarations,
  validateToolArgs,
  userSystemInstruction,
} from '../server/adminAgentCore.js';
import { callerEmailFrom, createAdminAgentService } from '../server/adminAgentService.js';

const dim = (names, metrics) => ({
  individualNames: names,
  metrics: Object.entries(metrics).map(([name, v]) => ({ name, values: [String(v)] })),
});

const STATS = {
  environments: [
    {
      dimensions: [
        dim(['alice@example.com', 'gemini-3-flash-preview'], {
          'sum(message_count)': 10,
          'sum(is_error)': 1,
          'sum(dc_prompt_token_count)': 1_000_000,
          'sum(dc_candidates_token_count)': 0,
        }),
        dim(['bob@example.com', 'claude-opus-4-5@20251101'], {
          'sum(message_count)': 2,
          'sum(is_error)': 0,
          'sum(dc_prompt_token_count)': 0,
          'sum(dc_candidates_token_count)': 1_000_000,
        }),
        dim(['(not set)', '(not set)'], {
          'sum(message_count)': 3,
          'sum(is_error)': 3,
          'sum(dc_prompt_token_count)': 0,
          'sum(dc_candidates_token_count)': 0,
        }),
      ],
    },
  ],
};
const RATES = {
  'gemini-3-flash-preview': { input: 0.5, output: 3 },
  'claude-opus-4-5': { input: 5, output: 25 },
  default: { input: 0.15, output: 0.6 },
};

test('rateFor picks the longest matching key, then default', () => {
  assert.equal(rateFor('claude-opus-4-5@20251101', RATES).output, 25);
  assert.equal(rateFor('mystery-model', RATES).output, 0.6);
});

test('aggregateUsage prices at the rate card and ranks by spend', () => {
  const out = aggregateUsage(STATS, RATES, { groupBy: 'user' });
  assert.equal(out.totals.calls, 15);
  assert.equal(out.totals.errors, 4);
  assert.equal(out.rows[0].user, 'bob@example.com');
  assert.equal(out.rows[0].costUsd, 25);
  assert.equal(out.rows[1].costUsd, 0.5);
  // A call blocked before any model was chosen costs nothing.
  assert.equal(out.rows.find((r) => r.user === '(anonymous)').costUsd, 0);
});

test('aggregateUsage filters to one user and groups by model', () => {
  const out = aggregateUsage(STATS, RATES, { user: 'alice@example.com', groupBy: 'model' });
  assert.equal(out.totals.distinctUsers, 1);
  assert.deepEqual(out.rows.map((r) => r.model), ['gemini-3-flash-preview']);
});

test('aggregateUsage computes cache hit rate from HIT and MISS only', () => {
  const cacheJson = {
    environments: [
      {
        dimensions: [
          dim(['alice@example.com', 'HIT'], { 'sum(message_count)': 3 }),
          dim(['alice@example.com', 'MISS'], { 'sum(message_count)': 1 }),
          dim(['alice@example.com', 'DISABLED'], { 'sum(message_count)': 50 }),
        ],
      },
    ],
  };
  const out = aggregateUsage(STATS, RATES, { cacheJson });
  assert.equal(out.totals.cacheHitRate, 75);
});

test('effectiveUser: a scoped caller can only ever see themselves', () => {
  assert.equal(effectiveUser('bob@example.com', 'alice@example.com'), 'alice@example.com');
  assert.equal(effectiveUser('', 'Alice@Example.com'), 'alice@example.com');
  assert.equal(effectiveUser('bob@example.com', ''), 'bob@example.com');
});

test('argument normalisers reject anything that could rewrite a filter', () => {
  assert.throws(() => normalizeEmail('a@b.com" OR "1"="1'));
  assert.throws(() => normalizeRange('90d'));
  assert.equal(normalizeEmail('all'), '');
  assert.equal(normalizeRange(undefined), '24h');
});

test('callLogsFilter scopes to the AI proxy and quotes only validated values', () => {
  const f = callLogsFilter({ project: 'p', env: 'prod', sinceIso: '2026-01-01T00:00:00Z', user: 'a@b.com', model: 'm' });
  assert.match(f, /jsonPayload.apiProxyName="ai-gateway-v1"/);
  assert.match(f, /jsonPayload.userEmail="a@b.com"/);
  assert.match(f, /jsonPayload.requestedModel="m"/);
});

// Real prod samples (faultName, errorMessage, status).
const SAMPLES = [
  ['FilterMatched', 'Model armor template filter matched. Policy caught the offending text. filter matched: RAIMatchesFound: false, SDPMatchesFound: false, PIMatchesFound: true', 400, 'model_armor_prompt'],
  ['RaiseFault', 'Raising fault. Fault name : RF-MissingUserEmail', 401, 'identity'],
  ['LLMTokenQuotaViolation', 'Rate limit LLM Token quota violation. Quota limit exceeded. Identifier : x@y.com', 429, 'token_quota'],
  ['InvalidApiKey', 'Invalid ApiKey', 401, 'api_key'],
  ['InvalidApiKeyForGivenResource', 'Invalid ApiKey for given resource', 401, 'not_entitled'],
  ['RaiseFault', 'Developer budget exhausted for this interval.', 429, 'budget'],
  ['', 'Monetization limit exceeded or prepaid balance exhausted', 403, 'wallet'],
  ['', 'Resource exhausted. Please try again later. error-code-429', 429, 'upstream_capacity'],
];

for (const [faultName, errorMessage, status, expected] of SAMPLES) {
  test(`classifyFailure: ${faultName || '(no fault)'} ${status} -> ${expected}`, () => {
    const c = classifyFailure({ faultName, errorMessage, status });
    assert.equal(c.category, expected);
    assert.ok(c.explanation && c.fix && c.owner, 'every failure says what, how to fix, and who owns it');
  });
}

test('classifyFailure names the Model Armor filter that matched', () => {
  const c = classifyFailure({ faultName: 'FilterMatched', errorMessage: 'PIMatchesFound: true, SDPMatchesFound: true', status: 400 });
  assert.match(c.explanation, /prompt-injection/);
  assert.match(c.explanation, /sensitive data/);
  assert.equal(c.guardrail, 'ai-armor');
});

test('parseCallEntry + buildCallLogSummary count outcomes and hide prompts by default', () => {
  const entries = [
    { timestamp: '2026-01-02T00:00:00Z', jsonPayload: { userEmail: 'a@b.com', model: 'm', responseStatusCode: '200', prompt: 'hello' } },
    { timestamp: '2026-01-01T00:00:00Z', jsonPayload: { userEmail: 'a@b.com', errorStatusCode: '429', faultName: 'LLMTokenQuotaViolation', errorMessage: 'quota', prompt: 'secret' } },
    { timestamp: '2026-01-01T00:00:00Z', jsonPayload: { userEmail: 'a@b.com', errorStatusCode: '502', errorMessage: 'bad gateway' } },
  ].map(parseCallEntry);
  const out = buildCallLogSummary(entries, { outcome: 'errors' });
  assert.deepEqual(out.counts, { total: 3, ok: 1, blocked: 1, error: 1 });
  assert.equal(out.matched, 2);
  assert.equal(out.entries[0].reason, 'Token quota exceeded');
  assert.ok(!('prompt' in out.entries[0]));
  const own = buildCallLogSummary(entries, { outcome: 'blocked', includePrompts: true });
  assert.equal(own.entries[0].prompt, 'secret');
});

test('createInsights.searchCallLogs pins the Cloud Logging filter to the scoped caller', async () => {
  const seen = [];
  const ins = createInsights({
    getToken: async () => 't',
    fetchImpl: async (url, init) => {
      seen.push(JSON.parse(init.body).filter);
      return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [] }) };
    },
  });
  await ins.searchCallLogs({ user: 'bob@example.com', scopeEmail: 'alice@example.com' });
  assert.match(seen[0], /userEmail="alice@example.com"/);
  assert.doesNotMatch(seen[0], /bob@example.com/);
});

// ---------------------------------------------------------------------------
// Tool declarations, validation and the user-view boundary
// ---------------------------------------------------------------------------

test('user view is offered the insight tools only, with no user filter', () => {
  const decls = buildFunctionDeclarations('user');
  assert.deepEqual(decls.map((d) => d.name).sort(), [...INSIGHT_TOOL_NAMES].sort());
  for (const d of decls) assert.ok(!('user' in (d.parameters.properties || {})), `${d.name} must not take a user`);
});

test('admin view gets the insight tools as well as the config tools', () => {
  const names = buildFunctionDeclarations('admin').map((d) => d.name);
  for (const n of INSIGHT_TOOL_NAMES) assert.ok(names.includes(n));
  assert.ok(names.includes('update_dev_product'));
});

test('validateToolArgs whitelists insight arguments', () => {
  assert.deepEqual(validateToolArgs('query_usage', { range: '7d', groupBy: 'model', limit: 99 }), {
    env: 'prod',
    range: '7d',
    groupBy: 'model',
    limit: 25,
  });
  assert.throws(() => validateToolArgs('search_call_logs', { outcome: 'everything' }));
  assert.throws(() => validateToolArgs('explain_failure', { trackingId: 'x" OR 1' }));
  assert.throws(() => validateToolArgs('query_usage', { env: 'staging' }));
});

test('callerEmailFrom reads the IAP header and falls back to the default', () => {
  assert.equal(
    callerEmailFrom({ headers: { 'x-goog-authenticated-user-email': 'accounts.google.com:Alice@Example.com' } }, 'x@y.com'),
    'alice@example.com'
  );
  assert.equal(callerEmailFrom({ headers: {} }, 'X@Y.com'), 'x@y.com');
});

test('userSystemInstruction names the caller and forbids changes', () => {
  const s = userSystemInstruction('alice@example.com');
  assert.match(s, /alice@example.com/);
  assert.match(s, /cannot change anything/);
});

function fakeService() {
  const calls = [];
  const insights = {
    queryUsage: async (a) => (calls.push(['queryUsage', a]), { env: 'prod', range: '24h', totals: { calls: 1, totalTokens: 10, costUsd: 0.01 }, rows: [] }),
    queryToolUsage: async (a) => (calls.push(['queryToolUsage', a]), { env: 'prod', range: '24h', kpis: { totalCalls: 0 } }),
    searchCallLogs: async (a) => (calls.push(['searchCallLogs', a]), { range: '24h', counts: { total: 0, blocked: 0, error: 0 } }),
    explainFailure: async (a) => (calls.push(['explainFailure', a]), { found: false, message: 'none' }),
  };
  const service = createAdminAgentService({
    getToken: async () => '',
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '', headers: new Map() }),
    insights,
    logger: { warn() {}, error() {} },
  });
  return { service, calls };
}

test('executeTool (user view) refuses config tools even if the model asks', async () => {
  const { service } = fakeService();
  const events = [];
  const out = await service._internals.executeTool({ name: 'update_dev_product', args: {} }, events, 'platform', {
    scope: 'user',
    email: 'alice@example.com',
  });
  assert.match(out.error, /only available to admins/);
});

test('executeTool (user view) pins insight queries to the caller', async () => {
  const { service, calls } = fakeService();
  const events = [];
  await service._internals.executeTool({ name: 'query_usage', args: { user: 'bob@example.com' } }, events, 'platform', {
    scope: 'user',
    email: 'alice@example.com',
  });
  assert.equal(calls[0][1].scopeEmail, 'alice@example.com');
  assert.ok(events.some((e) => e.type === 'insight' && e.kind === 'usage'));
});

test('executeTool (admin view) passes the requested user through unscoped', async () => {
  const { service, calls } = fakeService();
  await service._internals.executeTool({ name: 'search_call_logs', args: { user: 'bob@example.com', outcome: 'errors' } }, [], 'platform', {
    scope: 'admin',
  });
  assert.equal(calls[0][1].user, 'bob@example.com');
  assert.equal(calls[0][1].scopeEmail, '');
});
