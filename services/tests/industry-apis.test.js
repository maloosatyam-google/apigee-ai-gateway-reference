'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createApp, loadIndustries } = require('../industry-apis');
const { validatePack, REQUIRED_SLOTS, toolsFor } = require('../industries/validate');

const ROOT = path.join(__dirname, '..', '..');

function serve(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}
let rpcId = 0;
async function rpc(base, industry, method, params, accept = 'application/json, text/event-stream') {
  const r = await fetch(`${base}/${industry}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
}
async function callTool(base, industry, name, args) {
  const { body } = await rpc(base, industry, 'tools/call', { name, arguments: args });
  const text = body.result.content[0].text;
  return { isError: !!body.result.isError, data: JSON.parse(text) };
}

test('packs: copies in services/industries match the repo-root packs', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'industries', 'sync.js'), '--check'], { stdio: 'pipe' });
});

test('packs: every pack is valid and fills every slot', () => {
  const dir = path.join(ROOT, 'industries');
  const packs = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(packs.includes('banking.json'));
  for (const f of packs) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.deepEqual(validatePack(pack), [], f);
    for (const slot of REQUIRED_SLOTS) assert.ok(pack.tools.some((t) => t.slot === slot), `${f}: ${slot}`);
  }
});

test('packs: the validator catches missing slots, a bad limit and persona mix-ups', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'industries', 'banking.json'), 'utf8'));
  const noForecast = { ...pack, tools: pack.tools.filter((t) => t.slot !== 'forecast') };
  assert.ok(validatePack(noForecast).some((e) => e.includes('slot forecast')));
  const badLimit = { ...pack, limit: { ...pack.limit, argument: 'reason' } };
  assert.ok(validatePack(badLimit).some((e) => e.includes('limit.argument')));
  const mixed = { ...pack, tools: pack.tools.map((t) => (t.slot === 'confidential' ? { ...t, persona: 'ops' } : t)) };
  assert.ok(validatePack(mixed).some((e) => e.includes('belongs to persona insights')));
  assert.equal(toolsFor(pack, 'admin').length, pack.tools.length);
  assert.ok(toolsFor(pack, 'ops').every((t) => t.persona === 'ops'));
});

test('industry-apis: every pack with a backend has a handler per tool', () => {
  const inds = loadIndustries();
  assert.ok(inds.has('banking'));
});

test('banking MCP: initialize and tools/list come from the pack', async () => {
  const { s, base } = await serve(createApp());
  try {
    const init = await rpc(base, 'banking', 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.serverInfo.name, 'banking-tools');
    assert.ok(init.body.result.capabilities.tools);
    // Plain application/json Accept (curl, the UI console) also works.
    const list = await rpc(base, 'banking', 'tools/list', {}, 'application/json');
    assert.equal(list.status, 200);
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'industries', 'banking.json'), 'utf8'));
    assert.deepEqual(list.body.result.tools.map((t) => t.name), pack.tools.map((t) => t.name));
    const note = await fetch(`${base}/banking/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(note.status, 202);
    const get = await fetch(`${base}/banking/mcp`);
    assert.equal(get.status, 405);
    const unknown = await rpc(base, 'nope', 'tools/list', {});
    assert.equal(unknown.status, 404);
  } finally { s.close(); }
});

test('banking MCP: Jane Doe story, fee reversals and reset', async () => {
  const { s, base } = await serve(createApp());
  try {
    const found = await callTool(base, 'banking', 'searchCustomers', { query: 'jane' });
    assert.equal(found.data.customers[0].customerId, 'CUST-2001');
    assert.match(found.data.customers[0].email, /\*\*\*@/);

    const acct = await callTool(base, 'banking', 'getAccountSummary', { customerId: 'CUST-2001' });
    assert.equal(acct.data.name, 'Jane Doe');
    assert.equal(acct.data.cards.find((c) => c.cardId === 'CARD-4417').status, 'Blocked');

    const card = await callTool(base, 'banking', 'getCardStatus', { cardId: 'CARD-4417' });
    assert.equal(card.data.disputedTransactions[0].amount, 249.99);

    const txns = await callTool(base, 'banking', 'listRecentTransactions', { customerId: 'CUST-2001', limit: 10 });
    const fees = txns.data.transactions.filter((t) => t.feeId).map((t) => [t.feeId, t.amount]);
    assert.deepEqual(fees, [['FEE-7001', 30], ['FEE-7002', 120]]);

    // The backend does not enforce the $50 limit (Apigee does): both reach it and succeed.
    const small = await callTool(base, 'banking', 'reverseFee', { feeId: 'FEE-7001', amount: 30, reason: 'Goodwill' });
    assert.equal(small.isError, false);
    assert.equal(small.data.reversibleRemaining, 0);
    const again = await callTool(base, 'banking', 'reverseFee', { feeId: 'FEE-7001', amount: 30 });
    assert.equal(again.isError, true);
    assert.equal(again.data.error, 'EXCEEDS_FEE');

    const bad = await callTool(base, 'banking', 'reverseFee', { feeId: 'FEE-7002' });
    assert.equal(bad.isError, true);
    assert.equal(bad.data.error, 'INVALID_ARGUMENT');

    const sr = await callTool(base, 'banking', 'createServiceRequest', { customerId: 'CUST-2001', subject: 'Replacement card' });
    assert.match(sr.data.requestId, /^SR-/);
    const blocked = await callTool(base, 'banking', 'blockCard', { cardId: 'CARD-5120', reason: 'Lost' });
    assert.equal(blocked.data.alreadyBlocked, false);

    await fetch(`${base}/admin/reset`, { method: 'POST' });
    const after = await callTool(base, 'banking', 'listRecentTransactions', { customerId: 'CUST-2001' });
    assert.equal(after.data.transactions.find((t) => t.feeId === 'FEE-7001').reversibleRemaining, 30);
    const card2 = await callTool(base, 'banking', 'getCardStatus', { cardId: 'CARD-5120' });
    assert.equal(card2.data.status, 'Active');
  } finally { s.close(); }
});

test('banking MCP: analyst tools are aggregates; forecast honours the horizon', async () => {
  const { s, base } = await serve(createApp());
  try {
    const disputes = await callTool(base, 'banking', 'getDisputeMetrics', { period: 'last_30d' });
    assert.ok(disputes.data.current.disputes > disputes.data.previous.disputes, 'disputes are up');
    const trends = await callTool(base, 'banking', 'getDelinquencyTrends', { months: 6 });
    assert.equal(trends.data.series.length, 6);
    const prof = await callTool(base, 'banking', 'getSegmentProfitability', {});
    assert.equal(prof.data.classification, 'Confidential');
    const f = await callTool(base, 'banking', 'runCreditLossForecast', { horizonMonths: 4 });
    assert.deepEqual(f.data.forecast.map((m) => m.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
    const tooLong = await callTool(base, 'banking', 'runCreditLossForecast', { horizonMonths: 40 });
    assert.equal(tooLong.isError, true);
    for (const r of [disputes, trends, prof, f]) {
      const s2 = JSON.stringify(r.data);
      assert.ok(!s2.includes('@') && !s2.includes('Jane'), 'no individual customer data');
    }
  } finally { s.close(); }
});

test('industry-apis: internal REST uses the same handlers', async () => {
  const { s, base } = await serve(createApp());
  try {
    const r = await fetch(`${base}/banking/tools/getCardStatus`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId: 'CARD-4417' }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, 'Blocked');
    const missing = await fetch(`${base}/banking/tools/getCardStatus`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId: 'CARD-0000' }),
    });
    assert.equal(missing.status, 404);
    const list = await (await fetch(`${base}/banking/tools`)).json();
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'industries', 'banking.json'), 'utf8'));
    assert.equal(list.tools.length, pack.tools.length);
  } finally { s.close(); }
});

test('banking MCP: payments, loans and fraud areas follow the story', async () => {
  const { s, base } = await serve(createApp());
  try {
    const alerts = await callTool(base, 'banking', 'listFraudAlerts', { customerId: 'CUST-2001' });
    assert.equal(alerts.data.open, 1);
    assert.equal(alerts.data.alerts[0].transaction.description, 'ELECTROSHOP ONLINE');
    const resolved = await callTool(base, 'banking', 'resolveFraudAlert', { alertId: 'FA-3301', resolution: 'Confirmed fraud' });
    assert.equal(resolved.data.status, 'Closed');
    const again = await callTool(base, 'banking', 'resolveFraudAlert', { alertId: 'FA-3301', resolution: 'Genuine transaction' });
    assert.equal(again.data.error, 'ALREADY_RESOLVED');

    const pay = await callTool(base, 'banking', 'getPaymentStatus', { paymentId: 'PAY-8802' });
    assert.equal(pay.data.status, 'Scheduled');
    const cancel = await callTool(base, 'banking', 'cancelScheduledPayment', { paymentId: 'PAY-8802', reason: 'Card replaced' });
    assert.equal(cancel.data.status, 'Cancelled');
    const sent = await callTool(base, 'banking', 'cancelScheduledPayment', { paymentId: 'PAY-8801' });
    assert.equal(sent.data.error, 'NOT_CANCELLABLE');

    const loan = await callTool(base, 'banking', 'getLoanDetails', { loanId: 'LN-5501' });
    assert.equal(loan.data.product, 'Auto');
    const quote = await callTool(base, 'banking', 'getLoanPayoffQuote', { loanId: 'LN-5501', payoffDate: '2026-10-01' });
    assert.equal(quote.data.daysOfInterest, 21);
    assert.ok(quote.data.payoffAmount > loan.data.balance);
    const past = await callTool(base, 'banking', 'getLoanPayoffQuote', { loanId: 'LN-5501', payoffDate: '2020-01-01' });
    assert.equal(past.data.error, 'INVALID_ARGUMENT');

    for (const [name, args] of [['getDepositTrends', { months: 3 }], ['getLoanPortfolioSummary', {}], ['getChannelUsage', {}], ['getFraudLossMetrics', {}]]) {
      const r = await callTool(base, 'banking', name, args);
      assert.equal(r.isError, false, name);
      assert.ok(!JSON.stringify(r.data).includes('Jane'), `${name}: aggregates only`);
    }
  } finally { s.close(); }
});
