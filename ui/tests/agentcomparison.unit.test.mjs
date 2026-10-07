/**
 * Agent comparison ledger (src/utils/agentShowcase.js): per-agent input/output tokens, models
 * used with KVM-priced cost, and MCP tools accessed, accumulated across runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { NO_MODEL, addToLedger, emptyLedger, emptyRun, formatTokens, ledgerView, reduceShowcaseEvent, toolOutcome } from '../src/utils/agentShowcase.js';

const RATES = {
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-3-flash-preview': { input: 0.15, output: 0.6 },
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
};

const llm = (side, model, prompt, output, extra = {}) => ({
  type: 'llm_step', side, step: 1, via: 'apigee', model, requested_model: 'auto', status: 200,
  tokens: { prompt, output, thoughts: 0, total: prompt + output }, billable: true, cache: null, t_ms: 1, ...extra,
});
const call = (side, name, rpc_id, server) => ({ type: 'tool_call', side, name, rpc_id, args: {}, server, t_ms: 2 });
const result = (side, name, rpc_id, http_status, is_error = false) => ({ type: 'tool_result', side, name, rpc_id, http_status, is_error, latency_ms: 5, result: {}, t_ms: 3 });

function runWith(events) {
  let run = reduceShowcaseEvent(emptyRun(), { type: 'run', run_id: 'r1', prompt: 'p', sides: ['baseline', 'governed'] });
  for (const e of events) run = reduceShowcaseEvent(run, e);
  return reduceShowcaseEvent(run, { type: 'done' });
}

const RUN = runWith([
  { type: 'tools_offered', side: 'baseline', tools: Array.from({ length: 24 }, (_, i) => `t${i}`) },
  { type: 'tools_offered', side: 'governed', tools: Array.from({ length: 7 }, (_, i) => `t${i}`) },
  llm('baseline', 'gemini-3.1-pro-preview', 100000, 2000),
  call('baseline', 'getOrderStatus', 1, 'Enterprise Tools'),
  result('baseline', 'getOrderStatus', 1, 200),
  call('baseline', 'issueRefund', 2, 'Enterprise Tools'),
  result('baseline', 'issueRefund', 2, 200),
  llm('baseline', 'gemini-3.1-pro-preview', 30000, 500),
  llm('governed', 'gemini-3.1-flash-lite', 1000, 100, { cache: 'MISS' }),
  call('governed', 'getOrderStatus', 1, 'Customer Service Tools'),
  result('governed', 'getOrderStatus', 1, 200),
  call('governed', 'issueRefund', 2, 'Customer Service Tools'),
  result('governed', 'issueRefund', 2, 403, true),
  llm('governed', 'gemini-3-flash-preview', 1500, 200),
  llm('governed', 'gemini-3-flash-preview', 900, 50, { billable: false, cache: 'HIT' }),
  llm('governed', 'gemini-3-flash-preview', 0, 0, { status: 429 }),
]);

test('ledger: per-model tokens exclude cache hits and failed calls, and count them', () => {
  const l = addToLedger(emptyLedger(), RUN);
  assert.equal(l.runs, 1);
  assert.deepEqual(l.sides.governed.models['gemini-3-flash-preview'], { calls: 3, cached: 1, failed: 1, input: 1500, output: 200 });
  assert.deepEqual(l.sides.baseline.models['gemini-3.1-pro-preview'], { calls: 2, cached: 0, failed: 0, input: 130000, output: 2500 });
});

test('ledger: MCP tools with server and outcome (403 refund limit counts as blocked)', () => {
  const l = addToLedger(emptyLedger(), RUN);
  assert.deepEqual(l.sides.governed.tools.issueRefund, { server: 'Customer Service Tools', calls: 1, ok: 0, blocked: 1, error: 0 });
  assert.deepEqual(l.sides.baseline.tools.issueRefund, { server: 'Enterprise Tools', calls: 1, ok: 1, blocked: 0, error: 0 });
  assert.equal(l.sides.baseline.toolsOffered, 24);
  assert.equal(l.sides.governed.toolsOffered, 7);
});

test('ledger: accumulates across runs', () => {
  const l = addToLedger(addToLedger(emptyLedger(), RUN), RUN);
  assert.equal(l.runs, 2);
  assert.equal(l.sides.baseline.runs, 2);
  assert.equal(l.sides.baseline.models['gemini-3.1-pro-preview'].input, 260000);
  assert.equal(l.sides.governed.tools.getOrderStatus.calls, 2);
});

test('ledger view: prices each model from the KVM rates and totals the side', () => {
  const l = addToLedger(emptyLedger(), RUN);
  const b = ledgerView(l.sides.baseline, RATES);
  const g = ledgerView(l.sides.governed, RATES);
  // 130000/1e6*1.25 + 2500/1e6*5 = 0.1625 + 0.0125
  assert.ok(Math.abs(b.totals.costUsd - 0.175) < 1e-9);
  assert.equal(b.totals.inputTokens, 130000);
  assert.equal(b.totals.outputTokens, 2500);
  const lite = g.models.find((m) => m.model === 'gemini-3.1-flash-lite');
  assert.ok(Math.abs(lite.costUsd - (1000 / 1e6 * 0.075 + 100 / 1e6 * 0.3)) < 1e-12);
  assert.deepEqual(lite.rate, { input: 0.075, output: 0.3 });
  assert.equal(g.totals.toolCalls, 2);
  assert.equal(g.totals.toolsBlocked, 1);
  assert.equal(g.totals.cachedCalls, 1);
  assert.ok(b.totals.costUsd > g.totals.costUsd * 10);
});

test('ledger view: a model missing from the rate card is reported, never guessed', () => {
  const l = addToLedger(emptyLedger(), runWith([llm('governed', 'mystery-model', 1000, 10)]));
  const v = ledgerView(l.sides.governed, RATES);
  assert.equal(v.models[0].costUsd, null);
  assert.deepEqual(v.unpriced, ['mystery-model']);
  assert.equal(v.totals.costUsd, 0);
});

test('ledger: sides that did not run are not counted', () => {
  let run = reduceShowcaseEvent(emptyRun(), { type: 'run', run_id: 'r2', prompt: 'p', sides: ['governed'] });
  run = reduceShowcaseEvent(run, llm('governed', 'gemini-3.1-flash-lite', 10, 1));
  const l = addToLedger(emptyLedger(), run);
  assert.equal(l.sides.baseline.runs, 0);
  assert.equal(l.sides.governed.runs, 1);
});

test('toolOutcome and formatTokens', () => {
  assert.equal(toolOutcome({ result: null }), 'error');
  assert.equal(toolOutcome({ result: { http_status: 429, is_error: true } }), 'blocked');
  assert.equal(toolOutcome({ result: { http_status: 200, is_error: true } }), 'error');
  assert.equal(toolOutcome({ result: { http_status: 200, is_error: false } }), 'ok');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(2700), '2.7k');
  assert.equal(formatTokens(132000), '132k');
  assert.equal(formatTokens(2_500_000), '2.50M');
});

test('ledger: a call stopped at the gateway before any model ran is its own unpriced row, not a model', () => {
  const run = runWith([
    llm('governed', 'auto', 0, 0, { status: 400, model: null }),
    llm('governed', 'gemini-3-flash-preview', 1000, 100),
  ]);
  const l = addToLedger(emptyLedger(), run);
  assert.deepEqual(l.sides.governed.models[NO_MODEL], { calls: 1, cached: 0, failed: 1, input: 0, output: 0 });
  assert.equal(l.sides.governed.models.auto, undefined);
  const v = ledgerView(l.sides.governed, RATES);
  const row = v.models.find((m) => m.model === NO_MODEL);
  assert.equal(row.noModel, true);
  assert.equal(row.costUsd, 0);
  assert.equal(v.modelsUsed, 1);
  assert.deepEqual(v.unpriced, []);
});

test('burst: rows report answered vs stopped by the token quota, tokens and quota used', async () => {
  const { burstTotals } = await import('../src/utils/agentShowcase.js');
  const gov = (events) => {
    let run = reduceShowcaseEvent(emptyRun(), { type: 'run', run_id: `b${Math.random()}`, prompt: 'p', sides: ['governed'] });
    for (const e of events) run = reduceShowcaseEvent(run, e);
    return reduceShowcaseEvent(run, { type: 'done' });
  };
  const answered = gov([
    llm('governed', 'gemini-3-flash-preview', 2000, 300, { token_quota_used_pct: 40 }),
    llm('governed', 'gemini-3-flash-preview', 2500, 200, { token_quota_used_pct: 72.4 }),
    { type: 'final', side: 'governed', text: 'ok', error: null },
    { type: 'run_finished', side: 'governed', t_ms: 9000 },
  ]);
  const stopped = gov([
    llm('governed', 'gemini-3-flash-preview', 2000, 300, { token_quota_used_pct: 95 }),
    llm('governed', 'auto', 0, 0, { status: 429, model: null }),
    { type: 'governance_event', side: 'governed', kind: 'token_quota', detail: 'Token quota exceeded' },
    { type: 'final', side: 'governed', text: '', error: 'Token quota exceeded' },
    { type: 'run_finished', side: 'governed', t_ms: 5000 },
  ]);
  const t = burstTotals([answered, stopped], RATES);
  assert.equal(t.finished, 1);
  assert.equal(t.stopped, 1);
  assert.equal(t.running, 0);
  assert.equal(t.queued, 0);
  assert.equal(t.rows[0].outcome, 'done');
  assert.equal(t.rows[0].tokens, 5000);
  assert.equal(t.rows[0].quotaUsedPct, 72.4);
  assert.equal(t.rows[1].outcome, 'quota');
  assert.equal(t.rows[1].quotaDetail, 'Token quota exceeded');
  assert.equal(t.rows[1].error, null);
  assert.equal(t.tokens, 7300);
  // Burst runs are governed-only: the ledger skips the idle baseline side.
  const l = addToLedger(addToLedger(emptyLedger(), answered), stopped);
  assert.equal(l.sides.baseline.runs, 0);
  assert.equal(l.sides.governed.runs, 2);
});
