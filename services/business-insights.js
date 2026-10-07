// Business Insights API: aggregates only (revenue, support metrics, churn cohorts, margins, forecast).
// Runs on Cloud Run behind the Apigee proxy `business-insights-v1` (/business-insights/v1).
// Computed from the same seed as customer-service, so the numbers tell the same story
// (e.g. the recent rise in late deliveries shows up as a CSAT dip here).
// No endpoint returns an individual customer's name, email or phone.

'use strict';

const express = require('express');
const { build, TODAY, DAY, iso, money } = require('./shared/seed');

const db = build();
const app = express();
app.use(express.json({ limit: '32kb' }));

const err = (res, status, code, message) => res.status(status).json({ error: code, message });
const REGIONS = ['APAC', 'EMEA', 'AMER'];
const SEGMENTS = ['Consumer', 'Small Business', 'Enterprise'];
const customerById = Object.fromEntries(db.customers.map((c) => [c.customerId, c]));

/** 'last_30d' | 'last_90d' | 'last_180d' -> days. */
function periodDays(p) {
  const m = /^last_(30|90|180)d$/.exec(p || 'last_90d');
  return m ? Number(m[1]) : null;
}
const monthKey = (d) => d.slice(0, 7);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/insights/revenue', (req, res) => {
  const days = periodDays(req.query.period);
  if (!days) return err(res, 400, 'INVALID_PERIOD', 'period must be last_30d, last_90d or last_180d');
  const { region, segment } = req.query;
  if (region && !REGIONS.includes(region)) return err(res, 400, 'INVALID_REGION', `region must be one of ${REGIONS.join(', ')}`);
  if (segment && !SEGMENTS.includes(segment)) return err(res, 400, 'INVALID_SEGMENT', `segment must be one of ${SEGMENTS.join(', ')}`);
  const since = iso(TODAY - days * DAY);
  const rows = db.orders.filter((o) => {
    const c = customerById[o.customerId];
    return o.placedOn >= since && (!region || c.region === region) && (!segment || c.segment === segment);
  });
  const byMonth = {};
  const byCategory = {};
  for (const o of rows) {
    const k = monthKey(o.placedOn);
    byMonth[k] = byMonth[k] || { month: k, orders: 0, revenue: 0 };
    byMonth[k].orders += 1;
    byMonth[k].revenue = money(byMonth[k].revenue + o.total);
    for (const it of o.items) {
      const cat = db.products.find((p) => p.sku === it.sku).category;
      byCategory[cat] = money((byCategory[cat] || 0) + it.unitPrice * it.quantity * (1 - o.discountPct / 100));
    }
  }
  const revenue = money(rows.reduce((s, o) => s + o.total, 0));
  res.json({
    period: req.query.period || 'last_90d', region: region || 'All', segment: segment || 'All', currency: 'USD',
    totalRevenue: revenue, orders: rows.length, averageOrderValue: rows.length ? money(revenue / rows.length) : 0,
    monthly: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: Object.entries(byCategory).map(([category, rev]) => ({ category, revenue: rev })).sort((a, b) => b.revenue - a.revenue),
  });
});

app.get('/insights/support', (req, res) => {
  const days = periodDays(req.query.period);
  if (!days) return err(res, 400, 'INVALID_PERIOD', 'period must be last_30d, last_90d or last_180d');
  const since = iso(TODAY - days * DAY);
  const prevSince = iso(TODAY - 2 * days * DAY);
  const stats = (list) => {
    const rated = list.filter((k) => k.csat != null);
    const resolved = list.filter((k) => k.resolutionHours != null);
    return {
      cases: list.length,
      csat: rated.length ? Math.round((rated.reduce((s, k) => s + k.csat, 0) / rated.length) * 10) / 10 : null,
      avgResolutionHours: resolved.length ? Math.round(resolved.reduce((s, k) => s + k.resolutionHours, 0) / resolved.length) : null,
    };
  };
  const cur = db.cases.filter((k) => k.openedOn >= since);
  const prev = db.cases.filter((k) => k.openedOn >= prevSince && k.openedOn < since);
  const topics = {};
  for (const k of cur) topics[k.subject] = (topics[k.subject] || 0) + 1;
  const lateOrders = db.orders.filter((o) => o.status === 'Delayed').length;
  res.json({
    period: req.query.period || 'last_90d',
    current: stats(cur),
    previous: stats(prev),
    topIssues: Object.entries(topics).map(([subject, count]) => ({ subject, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    openLateOrders: lateOrders,
    note: 'CSAT is 1-5. Previous = the period of equal length before the current one.',
  });
});

app.get('/insights/churn', (req, res) => {
  const { segment } = req.query;
  if (segment && !SEGMENTS.includes(segment)) return err(res, 400, 'INVALID_SEGMENT', `segment must be one of ${SEGMENTS.join(', ')}`);
  const since = iso(TODAY - 60 * DAY);
  const cohorts = {};
  for (const c of db.customers) {
    if (segment && c.segment !== segment) continue;
    const recentOrders = db.orders.filter((o) => o.customerId === c.customerId && o.placedOn >= since);
    const late = recentOrders.some((o) => o.status === 'Delayed');
    const badCases = db.cases.filter((k) => k.customerId === c.customerId && k.csat != null && k.csat < 3).length;
    const score = (late ? 2 : 0) + Math.min(badCases, 2) + (recentOrders.length === 0 ? 2 : 0);
    const risk = score >= 2 ? 'High' : score >= 1 ? 'Medium' : 'Low';
    const key = `${c.segment}|${c.tier}`;
    cohorts[key] = cohorts[key] || { segment: c.segment, tier: c.tier, customers: 0, High: 0, Medium: 0, Low: 0, revenueAtRisk: 0 };
    cohorts[key].customers += 1;
    cohorts[key][risk] += 1;
    if (risk === 'High') cohorts[key].revenueAtRisk = money(cohorts[key].revenueAtRisk + c.lifetimeValue);
  }
  res.json({
    segment: segment || 'All', currency: 'USD',
    cohorts: Object.values(cohorts).sort((a, b) => b.High - a.High || b.Medium - a.Medium),
    drivers: ['Late deliveries in the last 60 days', 'Support cases rated below 3', 'No orders in the last 60 days'],
    note: 'Cohort counts only. Individual customers are not listed.',
  });
});

app.get('/insights/products/:sku/margin', (req, res) => {
  const p = db.products.find((x) => x.sku === req.params.sku);
  if (!p) return err(res, 404, 'NOT_FOUND', `Product ${req.params.sku} not found`);
  const lines = db.orders.flatMap((o) => o.items.filter((it) => it.sku === p.sku).map((it) => ({ ...it, discountPct: o.discountPct })));
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const avgDiscount = lines.length ? Math.round((lines.reduce((s, l) => s + l.discountPct, 0) / lines.length) * 10) / 10 : 0;
  const netPrice = money(p.listPrice * (1 - avgDiscount / 100));
  res.json({
    sku: p.sku, name: p.name, category: p.category, currency: 'USD',
    listPrice: p.listPrice, unitCost: p.unitCost, averageDiscountPct: avgDiscount, averageNetPrice: netPrice,
    grossMarginPct: Math.round(((netPrice - p.unitCost) / netPrice) * 1000) / 10,
    unitsSold180d: units, grossProfit180d: money(units * (netPrice - p.unitCost)),
    confidential: true,
  });
});

app.post('/insights/forecast', (req, res) => {
  const { metric, horizonWeeks = 8, segment } = req.body || {};
  if (!['revenue', 'orders', 'support_cases'].includes(metric)) return err(res, 400, 'INVALID_METRIC', 'metric must be revenue, orders or support_cases');
  const h = Number(horizonWeeks);
  if (!Number.isInteger(h) || h < 1 || h > 12) return err(res, 400, 'INVALID_HORIZON', 'horizonWeeks must be an integer from 1 to 12');
  if (segment && !SEGMENTS.includes(segment)) return err(res, 400, 'INVALID_SEGMENT', `segment must be one of ${SEGMENTS.join(', ')}`);
  // Weekly history for the last 12 weeks, then a damped linear trend. Deterministic.
  const weekly = [];
  for (let w = 11; w >= 0; w--) {
    const from = iso(TODAY - (w + 1) * 7 * DAY);
    const to = iso(TODAY - w * 7 * DAY);
    const inWeek = (d) => d >= from && d < to;
    let v;
    if (metric === 'support_cases') v = db.cases.filter((k) => inWeek(k.openedOn)).length;
    else {
      const os = db.orders.filter((o) => inWeek(o.placedOn) && (!segment || customerById[o.customerId].segment === segment));
      v = metric === 'orders' ? os.length : money(os.reduce((s, o) => s + o.total, 0));
    }
    weekly.push({ weekStarting: from, actual: v });
  }
  const n = weekly.length;
  const xs = weekly.map((_, i) => i);
  const ys = weekly.map((w) => w.actual);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const forecast = [];
  for (let i = 1; i <= h; i++) {
    const x = n - 1 + i;
    const point = Math.max(0, my + slope * 0.6 * (x - mx));
    const band = Math.max(1, Math.abs(point) * (0.1 + 0.02 * i));
    const r = (v) => (metric === 'revenue' ? money(v) : Math.round(v * 10) / 10);
    forecast.push({ weekStarting: iso(TODAY + (i - 1) * 7 * DAY), expected: r(point), low: r(Math.max(0, point - band)), high: r(point + band) });
  }
  res.json({ metric, segment: segment || 'All', horizonWeeks: h, model: 'damped-linear-trend', history: weekly, forecast });
});

app.use((_req, res) => err(res, 404, 'NOT_FOUND', 'Unknown resource'));

const port = process.env.PORT || 8080;
if (require.main === module) app.listen(port, () => console.log(`business-insights listening on ${port}`));
module.exports = app;
