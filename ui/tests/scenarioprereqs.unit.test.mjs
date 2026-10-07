import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTokenSteps, planCacheSteps, CACHE_TTL_MS } from '../src/utils/scenarioPrereqs.js';

const T0 = 1_000_000;

test('token: clicking 429 first runs steps 1-4', () => {
  assert.deepEqual(
    planTokenSteps({ target: 3, lastStep: -1, seqStartAt: null, lastCallAt: null, now: T0 }),
    { action: 'run', steps: [0, 1, 2, 3], fresh: true },
  );
});

test('token: clicking step 1 on a clean window runs only step 1', () => {
  assert.deepEqual(
    planTokenSteps({ target: 0, lastStep: -1, seqStartAt: null, lastCallAt: null, now: T0 }),
    { action: 'run', steps: [0], fresh: true },
  );
});

test('token: continuing a recent run only fills the gap', () => {
  assert.deepEqual(
    planTokenSteps({ target: 3, lastStep: 1, seqStartAt: T0, lastCallAt: T0 + 5_000, now: T0 + 10_000 }),
    { action: 'run', steps: [2, 3], fresh: false },
  );
});

test('token: the next step in sequence runs alone', () => {
  assert.deepEqual(
    planTokenSteps({ target: 1, lastStep: 0, seqStartAt: T0, lastCallAt: T0, now: T0 + 4_000 }),
    { action: 'run', steps: [1], fresh: false },
  );
});

test('token: repeating 429 while the window is full stays a single call', () => {
  assert.deepEqual(
    planTokenSteps({ target: 3, lastStep: 3, seqStartAt: T0, lastCallAt: T0 + 12_000, now: T0 + 20_000 }),
    { action: 'run', steps: [3], fresh: false },
  );
});

test('token: going back to step 1 while the window is still full asks to wait', () => {
  const plan = planTokenSteps({ target: 0, lastStep: 3, seqStartAt: T0, lastCallAt: T0 + 12_000, now: T0 + 20_000 });
  assert.equal(plan.action, 'wait');
  assert.equal(plan.waitMs, 60_000 + 3_000 - 8_000);
});

test('token: a stale run that would age out mid-way asks to wait instead of continuing', () => {
  // step 1 was 50 s ago: steps 2-4 would take ~15 s, so step 1 ages out before the 429 step
  const plan = planTokenSteps({ target: 3, lastStep: 0, seqStartAt: T0, lastCallAt: T0, now: T0 + 50_000 });
  assert.equal(plan.action, 'wait');
});

test('token: once the window has drained the run restarts from step 1', () => {
  assert.deepEqual(
    planTokenSteps({ target: 2, lastStep: 3, seqStartAt: T0, lastCallAt: T0 + 10_000, now: T0 + 80_000 }),
    { action: 'run', steps: [0, 1, 2], fresh: true },
  );
});

test('cache: Seed always runs alone', () => {
  assert.deepEqual(planCacheSteps({ target: 0, seededAt: null, now: T0 }), [0]);
  assert.deepEqual(planCacheSteps({ target: 0, seededAt: T0 - 1000, now: T0 }), [0]);
});

test('cache: Hit without a seed seeds first', () => {
  assert.deepEqual(planCacheSteps({ target: 1, seededAt: null, now: T0 }), [0, 1]);
});

test('cache: Hit after a recent seed runs alone', () => {
  assert.deepEqual(planCacheSteps({ target: 1, seededAt: T0 - 60_000, now: T0 }), [1]);
});

test('cache: Hit near TTL expiry re-seeds', () => {
  assert.deepEqual(planCacheSteps({ target: 1, seededAt: T0 - (CACHE_TTL_MS - 30_000), now: T0 }), [0, 1]);
});
