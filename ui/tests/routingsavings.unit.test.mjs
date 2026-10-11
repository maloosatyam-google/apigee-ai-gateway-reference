import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBenchmarkModel, computeRoutingSavings } from '../src/utils/routingSavings.js';

const RATES = {
  default: { input: 99, output: 999 }, // fallback entry, never a benchmark
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 },
  'claude-opus-5-5': { input: 15, output: 75 },
  'claude-haiku-5-5': { input: 1, output: 5 },
};

test('benchmark is the highest output rate, ignoring the default entry', () => {
  assert.deepEqual(findBenchmarkModel(RATES), { model: 'claude-opus-5-5', input: 15, output: 75 });
});

test('benchmark tie on output breaks on input rate', () => {
  const b = findBenchmarkModel({ a: { input: 1, output: 5 }, b: { input: 2, output: 5 } });
  assert.equal(b.model, 'b');
});

test('no usable rate card -> null', () => {
  assert.equal(findBenchmarkModel(null), null);
  assert.equal(findBenchmarkModel({ default: { input: 1, output: 1 } }), null);
  assert.equal(computeRoutingSavings([{ model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0 }], {}), null);
});

test('savings = benchmark-priced tokens minus actual cost, summed over rows', () => {
  const rows = [
    // 1M in + 1M out on flash-lite: actual 0.5, baseline 90 -> saves 89.5
    { model: 'gemini-3.5-flash-lite', inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0.5 },
    // Opus itself saves nothing
    { model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 1000, costUsd: 0.09 },
  ];
  const s = computeRoutingSavings(rows, RATES);
  assert.equal(s.benchmarkModel, 'claude-opus-5-5');
  assert.ok(Math.abs(s.savingsUsd - 89.5) < 1e-9);
  assert.ok(Math.abs(s.actualUsd - 0.59) < 1e-9);
  assert.ok(Math.abs(s.baselineUsd - 90.09) < 1e-9);
});

test('rows never contribute negative savings; token-less rows are skipped', () => {
  const rows = [
    { model: 'weird', inputTokens: 10, outputTokens: 10, costUsd: 100 },
    { model: 'unknown-model', inputTokens: 0, outputTokens: 0, costUsd: 0 },
  ];
  const s = computeRoutingSavings(rows, RATES);
  assert.equal(s.savingsUsd, 0);
  assert.equal(computeRoutingSavings([rows[1]], RATES), null);
});
