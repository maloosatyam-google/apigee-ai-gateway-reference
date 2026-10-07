'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cs = require('../customer-service');
const bi = require('../business-insights');

function serve(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}
async function call(base, path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

test('customer-service: demo anchor order ORD-1042 is late and belongs to Jane Doe', async () => {
  const { s, base } = await serve(cs);
  try {
    const o = await call(base, '/orders/ORD-1042');
    assert.equal(o.status, 200);
    assert.equal(o.body.status, 'Delayed');
    assert.equal(o.body.customerId, 'CUST-1001');
    assert.ok(o.body.daysLate > 0);
    const c = await call(base, '/customers/CUST-1001');
    assert.equal(c.body.name, 'Jane Doe');
    assert.equal(c.body.tier, 'Gold');
    const search = await call(base, '/customers?q=jane');
    assert.match(search.body.customers[0].email, /\*\*\*@/, 'search results mask email');
  } finally { s.close(); }
});

test('customer-service: price has no cost/margin; cases and refunds work', async () => {
  const { s, base } = await serve(cs);
  try {
    const p = await call(base, '/products/DEV-HUB/price?tier=Gold');
    assert.equal(p.body.maxDiscountPct, 10);
    assert.equal(p.body.unitCost, undefined);
    const k = await call(base, '/cases', 'POST', { customerId: 'CUST-1001', orderId: 'ORD-1042', subject: 'Late delivery' });
    assert.equal(k.status, 201);
    const r = await call(base, '/orders/ORD-1042/refunds', 'POST', { amount: 25, reason: 'Late delivery' });
    assert.equal(r.status, 201);
    assert.equal(r.body.refundableRemaining, 119);
    const over = await call(base, '/orders/ORD-1042/refunds', 'POST', { amount: 500 });
    assert.equal(over.status, 409);
    await call(base, '/admin/reset', 'POST');
    const after = await call(base, '/orders/ORD-1042');
    assert.equal(after.body.refunds.length, 0);
  } finally { s.close(); }
});

test('business-insights: aggregates only, and the late-delivery story shows up', async () => {
  const { s, base } = await serve(bi);
  try {
    const sup = await call(base, '/insights/support?period=last_30d');
    assert.equal(sup.status, 200);
    assert.ok(sup.body.current.csat < sup.body.previous.csat, 'CSAT dips in the last 30 days');
    assert.equal(sup.body.topIssues[0].subject, 'Late delivery');
    const churn = await call(base, '/insights/churn');
    assert.ok(!JSON.stringify(churn.body).includes('@'), 'no emails in churn output');
    assert.ok(!JSON.stringify(churn.body).includes('Jane'), 'no names in churn output');
    const rev = await call(base, '/insights/revenue?period=last_90d&region=APAC');
    assert.ok(rev.body.totalRevenue > 0);
    const m = await call(base, '/insights/products/DEV-HUB/margin');
    assert.ok(m.body.unitCost > 0 && m.body.grossMarginPct > 0);
    const f = await call(base, '/insights/forecast', 'POST', { metric: 'revenue', horizonWeeks: 4 });
    assert.equal(f.body.forecast.length, 4);
    const bad = await call(base, '/insights/forecast', 'POST', { metric: 'revenue', horizonWeeks: 40 });
    assert.equal(bad.status, 400);
  } finally { s.close(); }
});
