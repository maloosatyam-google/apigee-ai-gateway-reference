/**
 * Ask Apigee finance tools: wallets, rate plans and the dev rate card.
 *
 * Driven against an in-memory fake of the Apigee management API so the
 * important properties are checked without credentials: the rate card is only
 * ever written in the dev environment, revert restores it byte for byte, a
 * wallet top-up is capped and reverts with a matching debit, and each write is
 * refused for an admin persona that does not own it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TOPUP_USD, validateToolArgs, buildFunctionDeclarations } from '../server/adminAgentCore.js';
import { createAdminAgentService } from '../server/adminAgentService.js';

const RATE_RAW = JSON.stringify({
  'gemini-3.6-flash': { input: 0.5, output: 3, provider: 'google' },
  default: { input: 0.15, output: 0.6 },
});

function fakeApigee() {
  const calls = [];
  let rateValue = RATE_RAW;
  let balance = 10;
  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes('/keyvaluemaps/ai-model-rates/entries/rate_card')) {
      if (method === 'GET') return json(200, { name: 'rate_card', value: rateValue });
      rateValue = body.value;
      return json(200, body);
    }
    if (url.endsWith('/balance:credit')) {
      const units = Number(body.transactionAmount.units) + body.transactionAmount.nanos / 1e9;
      balance += units;
      return json(200, { wallets: [{ balance: { currencyCode: 'USD', units: String(Math.floor(balance)), nanos: Math.round((balance % 1) * 1e9) } }] });
    }
    if (url.endsWith('/balance:adjust')) {
      // Apigee: a positive adjustment decreases the balance.
      balance -= Number(body.adjustment.units) + body.adjustment.nanos / 1e9;
      return json(200, {});
    }
    if (url.endsWith('/balance')) {
      if (url.includes('nobody%40example.com')) return json(404, { error: { message: 'not found' } });
      return json(200, { wallets: [{ balance: { currencyCode: 'USD', units: String(Math.floor(balance)), nanos: 0 } }] });
    }
    if (url.endsWith('/monetizationConfig')) return json(200, { billingType: 'PREPAID' });
    if (url.includes('/rateplans')) {
      return json(200, {
        ratePlans: [
          { name: 'rp1', displayName: 'Pay as you go', state: 'PUBLISHED', currencyCode: 'USD', billingPeriod: 'MONTHLY', consumptionPricingRates: [{ start: 0, fee: { units: '0', nanos: 1000000 } }] },
        ],
      });
    }
    return json(404, {});
  };
  return { fetchImpl, calls, getRate: () => rateValue, getBalance: () => balance };
}

function service(fake) {
  let n = 0;
  return createAdminAgentService({
    getToken: async () => 'tok',
    fetchImpl: fake.fetchImpl,
    randomHex: () => (++n).toString(16).padStart(8, '0'),
    insights: {},
    logger: { warn() {}, error() {} },
  });
}

test('finance tools are declared for admins only', () => {
  const admin = buildFunctionDeclarations('admin').map((d) => d.name);
  for (const n of ['get_wallet', 'list_rate_plans', 'topup_wallet', 'update_dev_rate_card']) assert.ok(admin.includes(n));
  const user = buildFunctionDeclarations('user').map((d) => d.name);
  assert.ok(!user.includes('topup_wallet'));
});

test('topup_wallet is capped and needs a real email', () => {
  assert.deepEqual(validateToolArgs('topup_wallet', { developer: 'A@B.com', amountUsd: '$25' }), { developer: 'a@b.com', amountUsd: 25 });
  assert.throws(() => validateToolArgs('topup_wallet', { developer: 'a@b.com', amountUsd: MAX_TOPUP_USD + 1 }));
  assert.throws(() => validateToolArgs('topup_wallet', { developer: 'a@b.com', amountUsd: 0 }));
  assert.throws(() => validateToolArgs('topup_wallet', { developer: 'not-an-email', amountUsd: 5 }));
});

test('update_dev_rate_card needs a price and rejects nonsense', () => {
  assert.throws(() => validateToolArgs('update_dev_rate_card', { model: 'gemini-3.6-flash' }));
  assert.throws(() => validateToolArgs('update_dev_rate_card', { model: 'x', output: -1 }));
  assert.deepEqual(validateToolArgs('update_dev_rate_card', { model: 'gemini-3.6-flash', output: 4 }), { model: 'gemini-3.6-flash', output: 4 });
});

test('update_dev_rate_card writes the dev KVM only and reverts byte-exact', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const events = [];
  const out = await svc._internals.executeTool({ name: 'update_dev_rate_card', args: { model: 'gemini-3.6-flash', output: 4 } }, events, 'finance');
  assert.equal(out.applied, true);
  const writes = fake.calls.filter((c) => c.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /\/environments\/dev\/keyvaluemaps\/ai-model-rates\//);
  assert.equal(JSON.parse(fake.getRate())['gemini-3.6-flash'].output, 4);
  assert.equal(JSON.parse(fake.getRate())['gemini-3.6-flash'].provider, 'google', 'other fields survive');
  const change = events.find((e) => e.type === 'change').change;
  assert.equal(change.kind, 'rate_card');
  assert.equal(change.env, 'dev');

  await svc._internals.revertChange(change.changeId, 'finance');
  assert.equal(fake.getRate(), RATE_RAW);
  assert.ok(fake.calls.every((c) => c.method === 'GET' || /\/environments\/dev\//.test(c.url)), 'nothing touched prod');
});

test('update_dev_rate_card refuses an unknown key and lists the real ones', async () => {
  const svc = service(fakeApigee());
  const out = await svc._internals.executeTool({ name: 'update_dev_rate_card', args: { model: 'gpt-9', input: 1 } }, [], 'platform');
  assert.match(out.error, /not on the dev rate card.*gemini-3.6-flash/);
});

test('AI CoE may not top up wallets or change prices', async () => {
  const svc = service(fakeApigee());
  const a = await svc._internals.executeTool({ name: 'topup_wallet', args: { developer: 'a@b.com', amountUsd: 5 } }, [], 'ai_coe');
  assert.match(a.error, /cannot change wallet/);
  const b = await svc._internals.executeTool({ name: 'update_dev_rate_card', args: { model: 'gemini-3.6-flash', input: 1 } }, [], 'ai_coe');
  assert.match(b.error, /cannot change pricing/);
});

test('topup_wallet credits, records a change, and revert debits the same amount', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const events = [];
  await svc._internals.executeTool({ name: 'topup_wallet', args: { developer: 'a@b.com', amountUsd: 12.5 } }, events, 'finance');
  assert.equal(fake.getBalance(), 22.5);
  const change = events.find((e) => e.type === 'change').change;
  assert.equal(change.kind, 'wallet');
  assert.equal(change.diff[0].before, '$10.00');
  assert.equal(change.diff[0].after, '$22.50');

  await svc._internals.revertChange(change.changeId, 'finance');
  assert.equal(fake.getBalance(), 10);
  const adjust = fake.calls.find((c) => c.url.endsWith('/balance:adjust'));
  // Positive adjustment = debit (Apigee's convention for an under-charge).
  assert.equal(adjust.body.adjustment.units, '12');
  assert.equal(adjust.body.adjustment.nanos, 500000000);
});

test('get_wallet reports a missing developer plainly', async () => {
  const svc = service(fakeApigee());
  const out = await svc._internals.executeTool({ name: 'get_wallet', args: { developer: 'nobody@example.com' } }, [], 'finance');
  assert.match(out.error, /No developer/);
});

test('list_rate_plans projects fees into dollars', async () => {
  const svc = service(fakeApigee());
  const out = await svc._internals.executeTool({ name: 'list_rate_plans', args: {} }, [], 'finance');
  assert.ok(out.ratePlans.length >= 1);
  assert.equal(out.ratePlans[0].consumptionRates[0].feeUsd, 0.001);
});
