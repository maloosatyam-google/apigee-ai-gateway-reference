// Customer Service API: customers, orders, pricing, cases, refunds.
// Runs on Cloud Run behind the Apigee proxy `customer-service-v1` (/customer-service/v1).
// The $50 refund limit is enforced by Apigee, not here, so the gateway control is visible;
// this service just records whatever refund reaches it.

'use strict';

const express = require('express');
const { build, TIER_DISCOUNT, TODAY, iso, money } = require('./shared/seed');

let db = build();
const app = express();
app.use(express.json({ limit: '64kb' }));

const err = (res, status, code, message) => res.status(status).json({ error: code, message });
const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
const summary = (c) => ({
  customerId: c.customerId, name: c.name, email: maskEmail(c.email), tier: c.tier, segment: c.segment, city: c.city,
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/customers', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return err(res, 400, 'INVALID_QUERY', 'q must be at least 2 characters');
  const hits = db.customers.filter(
    (c) => c.name.toLowerCase().includes(q) || c.customerId.toLowerCase() === q || c.email.startsWith(q)
  );
  res.json({ count: hits.length, customers: hits.slice(0, 10).map(summary) });
});

app.get('/customers/:id', (req, res) => {
  const c = db.customers.find((x) => x.customerId === req.params.id);
  if (!c) return err(res, 404, 'NOT_FOUND', `Customer ${req.params.id} not found`);
  const orders = db.orders.filter((o) => o.customerId === c.customerId);
  const openCases = db.cases.filter((k) => k.customerId === c.customerId && k.status === 'Open');
  res.json({
    ...c,
    allowedDiscountPct: TIER_DISCOUNT[c.tier],
    orderCount: orders.length,
    openCases: openCases.map((k) => ({ caseId: k.caseId, subject: k.subject, priority: k.priority })),
  });
});

app.get('/customers/:id/orders', (req, res) => {
  const c = db.customers.find((x) => x.customerId === req.params.id);
  if (!c) return err(res, 404, 'NOT_FOUND', `Customer ${req.params.id} not found`);
  const orders = db.orders
    .filter((o) => o.customerId === c.customerId)
    .sort((a, b) => b.placedOn.localeCompare(a.placedOn))
    .map((o) => ({ orderId: o.orderId, placedOn: o.placedOn, status: o.status, total: o.total, currency: o.currency }));
  res.json({ customerId: c.customerId, count: orders.length, orders });
});

app.get('/orders/:id', (req, res) => {
  const o = db.orders.find((x) => x.orderId === req.params.id);
  if (!o) return err(res, 404, 'NOT_FOUND', `Order ${req.params.id} not found`);
  const daysLate =
    o.status === 'Delayed' ? Math.round((TODAY - Date.parse(o.promisedDelivery)) / 86400000) : 0;
  const refunded = money(o.refunds.reduce((s, r) => s + r.amount, 0));
  res.json({ ...o, daysLate, refundedTotal: refunded, refundableRemaining: money(o.total - refunded) });
});

app.get('/products/:sku/price', (req, res) => {
  const p = db.products.find((x) => x.sku === req.params.sku);
  if (!p) return err(res, 404, 'NOT_FOUND', `Product ${req.params.sku} not found`);
  const tier = req.query.tier || 'Standard';
  if (!(tier in TIER_DISCOUNT)) return err(res, 400, 'INVALID_TIER', 'tier must be Standard, Gold or Platinum');
  const pct = TIER_DISCOUNT[tier];
  // Deliberately no unitCost / margin here: that lives in the insights API.
  res.json({
    sku: p.sku, name: p.name, category: p.category, currency: 'USD',
    listPrice: p.listPrice, tier, maxDiscountPct: pct, lowestPrice: money(p.listPrice * (1 - pct / 100)),
  });
});

app.post('/cases', (req, res) => {
  const { customerId, orderId, subject, priority = 'Medium', description = '' } = req.body || {};
  if (!customerId || !subject) return err(res, 400, 'INVALID_CASE', 'customerId and subject are required');
  if (!db.customers.some((c) => c.customerId === customerId)) return err(res, 404, 'NOT_FOUND', `Customer ${customerId} not found`);
  if (orderId && !db.orders.some((o) => o.orderId === orderId)) return err(res, 404, 'NOT_FOUND', `Order ${orderId} not found`);
  if (!['Low', 'Medium', 'High'].includes(priority)) return err(res, 400, 'INVALID_PRIORITY', 'priority must be Low, Medium or High');
  const k = {
    caseId: `CASE-${5000 + db.cases.length}`, customerId, orderId: orderId || null, subject: String(subject).slice(0, 120),
    description: String(description).slice(0, 1000), category: 'General', priority, status: 'Open',
    openedOn: iso(TODAY), resolutionHours: null, csat: null,
  };
  db.cases.push(k);
  res.status(201).json(k);
});

app.post('/orders/:id/refunds', (req, res) => {
  const o = db.orders.find((x) => x.orderId === req.params.id);
  if (!o) return err(res, 404, 'NOT_FOUND', `Order ${req.params.id} not found`);
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || '').slice(0, 200);
  if (!Number.isFinite(amount) || amount <= 0) return err(res, 400, 'INVALID_AMOUNT', 'amount must be a positive number');
  const remaining = money(o.total - o.refunds.reduce((s, r) => s + r.amount, 0));
  if (amount > remaining) return err(res, 409, 'EXCEEDS_ORDER', `Only ${remaining} USD is refundable on ${o.orderId}`);
  const refund = { refundId: `RF-${o.orderId.slice(4)}-${o.refunds.length + 1}`, amount: money(amount), currency: 'USD', reason, status: 'Approved', issuedOn: iso(TODAY) };
  o.refunds.push(refund);
  res.status(201).json({ orderId: o.orderId, ...refund, refundableRemaining: money(remaining - amount) });
});

// Restores the seed data between demos. Not exposed through Apigee.
app.post('/admin/reset', (_req, res) => {
  db = build();
  res.json({ reset: true });
});

app.use((_req, res) => err(res, 404, 'NOT_FOUND', 'Unknown resource'));

const port = process.env.PORT || 8080;
if (require.main === module) app.listen(port, () => console.log(`customer-service listening on ${port}`));
module.exports = app;
