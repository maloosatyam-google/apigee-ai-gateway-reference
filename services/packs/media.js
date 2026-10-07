// Media handlers and seed data for the industry-apis service (pack: industries/media.json).
//
// A video streaming / subscription service. Story: Jamie Carter (SBR-4001) is on Premium with
// the Ultra HD add-on. The new living-room TV will not sign in because all 4 device slots are
// used (an old tablet, DEV-5003, has not been seen since 2025), 4K playback failed during the
// September CDN outage (INC-3310, case PBC-7001), and the Sports Pass was charged twice
// (CHG-6102, $120). Crediting the $30 Ultra HD add-on (CHG-6101) is within policy; crediting
// the $120 duplicate is over the $50 limit that Apigee enforces for Subscriber Care. The limit
// is not enforced here, so the gateway control stays visible: this service records whatever
// credit reaches it (up to the amount charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const plans = [
    { planId: 'PLN-BASIC-ADS', name: 'Basic with Ads', tier: 'Basic with Ads', priceUsd: 7.99, quality: 'HD 1080p', streams: 1, deviceLimit: 2, ads: true },
    { planId: 'PLN-STANDARD', name: 'Standard', tier: 'Standard', priceUsd: 15.49, quality: 'HD 1080p', streams: 2, deviceLimit: 3, ads: false },
    { planId: 'PLN-PREMIUM', name: 'Premium', tier: 'Premium', priceUsd: 22.99, quality: '4K HDR (with Ultra HD add-on)', streams: 4, deviceLimit: 4, ads: false },
  ];
  const addOns = [
    { addOnId: 'ADD-UHD', name: 'Ultra HD', priceUsd: 30, billing: 'Monthly', note: '4K HDR and Dolby Atmos on Premium' },
    { addOnId: 'ADD-SPORTS', name: 'Sports Pass', priceUsd: 120, billing: 'Per season', note: 'Live league games and replays' },
    { addOnId: 'ADD-KIDS', name: 'Kids+ Library', priceUsd: 4.99, billing: 'Monthly', note: 'Extra kids titles, no ads' },
  ];
  const subscribers = [
    { subscriberId: 'SBR-4001', name: 'Jamie Carter', email: 'jamie.carter@example.com', planId: 'PLN-PREMIUM', addOns: ['ADD-UHD', 'ADD-SPORTS'], homeRegion: 'US', status: 'Active', memberSince: '2022-03-14', renewsOn: '2026-10-01' },
    { subscriberId: 'SBR-4002', name: 'Morgan Ellis', email: 'morgan.ellis@example.com', planId: 'PLN-STANDARD', addOns: [], homeRegion: 'CA', status: 'Active', memberSince: '2024-06-02', renewsOn: '2026-10-02' },
    { subscriberId: 'SBR-4003', name: 'Riya Desai', email: 'riya.desai@example.com', planId: 'PLN-BASIC-ADS', addOns: ['ADD-KIDS'], homeRegion: 'UK', status: 'Active', memberSince: '2025-01-19', renewsOn: '2026-10-19' },
    { subscriberId: 'SBR-4004', name: 'Chris Novak', email: 'chris.novak@example.com', planId: 'PLN-PREMIUM', addOns: [], homeRegion: 'DE', status: 'Paused', memberSince: '2023-11-07', renewsOn: null, pausedUntil: '2026-11-07' },
    { subscriberId: 'SBR-4005', name: 'Jamila Brooks', email: 'jamila.brooks@example.com', planId: 'PLN-STANDARD', addOns: ['ADD-SPORTS'], homeRegion: 'US', status: 'Active', memberSince: '2021-08-30', renewsOn: '2026-10-30' },
    { subscriberId: 'SBR-4006', name: 'Luis Ortega', email: 'luis.ortega@example.com', planId: 'PLN-BASIC-ADS', addOns: [], homeRegion: 'BR', status: 'Cancelled', memberSince: '2025-04-11', renewsOn: null, cancelledOn: '2026-09-11' },
  ];
  const devices = [
    { deviceId: 'DEV-5001', subscriberId: 'SBR-4001', name: 'Bedroom streaming stick', type: 'Streaming stick', supports4k: true, registeredOn: '2023-02-10', lastSeen: '2026-09-24', status: 'Active' },
    { deviceId: 'DEV-5002', subscriberId: 'SBR-4001', name: "Jamie's phone", type: 'Mobile (iOS)', supports4k: false, registeredOn: '2024-05-21', lastSeen: '2026-09-25', status: 'Active' },
    { deviceId: 'DEV-5003', subscriberId: 'SBR-4001', name: 'Kitchen tablet', type: 'Tablet (Android)', supports4k: false, registeredOn: '2022-04-02', lastSeen: '2025-11-18', status: 'Active' },
    { deviceId: 'DEV-5004', subscriberId: 'SBR-4001', name: 'Office laptop browser', type: 'Web browser', supports4k: false, registeredOn: '2025-02-14', lastSeen: '2026-09-20', status: 'Active' },
    { deviceId: 'DEV-5010', subscriberId: 'SBR-4002', name: 'Living room console', type: 'Game console', supports4k: true, registeredOn: '2024-06-02', lastSeen: '2026-09-23', status: 'Active' },
    { deviceId: 'DEV-5020', subscriberId: 'SBR-4003', name: 'Family smart TV', type: 'Smart TV', supports4k: true, registeredOn: '2025-01-19', lastSeen: '2026-09-25', status: 'Active' },
  ];
  const charges = [
    { chargeId: 'CHG-6099', subscriberId: 'SBR-4001', description: 'Premium plan, September', amount: 22.99, status: 'Paid', chargedOn: '2026-09-01' },
    { chargeId: 'CHG-6101', subscriberId: 'SBR-4001', description: 'Ultra HD add-on, September', amount: 30, status: 'Paid', chargedOn: '2026-09-01' },
    { chargeId: 'CHG-6100', subscriberId: 'SBR-4001', description: 'Sports Pass, 2026-27 season', amount: 120, status: 'Paid', chargedOn: '2026-09-03' },
    { chargeId: 'CHG-6102', subscriberId: 'SBR-4001', description: 'Sports Pass, 2026-27 season, duplicate charge', amount: 120, status: 'Paid', chargedOn: '2026-09-03', duplicateOf: 'CHG-6100' },
    { chargeId: 'CHG-6090', subscriberId: 'SBR-4001', description: 'Premium plan, August', amount: 22.99, status: 'Paid', chargedOn: '2026-08-01' },
    { chargeId: 'CHG-6110', subscriberId: 'SBR-4002', description: 'Standard plan, September', amount: 15.49, status: 'Paid', chargedOn: '2026-09-02' },
    { chargeId: 'CHG-6120', subscriberId: 'SBR-4003', description: 'Movie rental: The Quiet Orchard', amount: 4.99, status: 'Paid', chargedOn: '2026-09-14' },
  ].map((c) => ({ ...c, credits: [] }));
  const playbackSessions = [
    { sessionId: 'PS-90011', subscriberId: 'SBR-4001', startedAt: '2026-09-24T20:14Z', device: 'Living room TV (new, not registered)', title: 'Harbor Lights S2E3', result: 'Failed', errorCode: 'DEVICE_LIMIT_REACHED', detail: '4 of 4 device slots in use' },
    { sessionId: 'PS-90010', subscriberId: 'SBR-4001', startedAt: '2026-09-23T21:02Z', device: 'Living room TV (new, not registered)', title: 'Harbor Lights S2E3', result: 'Failed', errorCode: 'DEVICE_LIMIT_REACHED', detail: '4 of 4 device slots in use' },
    { sessionId: 'PS-89977', subscriberId: 'SBR-4001', startedAt: '2026-09-19T19:40Z', device: 'Bedroom streaming stick', title: 'League Night Live', result: 'Degraded', errorCode: 'UHD_UNAVAILABLE', detail: 'Fell back to 720p; 4K unavailable during INC-3310', avgBitrateMbps: 3.1, rebufferPct: 6.8 },
    { sessionId: 'PS-89950', subscriberId: 'SBR-4001', startedAt: '2026-09-18T20:05Z', device: 'Bedroom streaming stick', title: 'Summit: A Climbing Story', result: 'Degraded', errorCode: 'UHD_UNAVAILABLE', detail: 'Fell back to 720p; 4K unavailable during INC-3310', avgBitrateMbps: 2.8, rebufferPct: 7.4 },
    { sessionId: 'PS-89900', subscriberId: 'SBR-4001', startedAt: '2026-09-15T22:10Z', device: "Jamie's phone", title: 'Harbor Lights S2E2', result: 'OK', errorCode: null, avgBitrateMbps: 4.6, rebufferPct: 0.2 },
    { sessionId: 'PS-89800', subscriberId: 'SBR-4002', startedAt: '2026-09-22T18:30Z', device: 'Living room console', title: 'Paper Boats', result: 'OK', errorCode: null, avgBitrateMbps: 7.9, rebufferPct: 0.1 },
  ];
  const incidents = [
    { incidentId: 'INC-3310', title: '4K streams unavailable (CDN edge fault, US-East)', from: '2026-09-17', to: '2026-09-21', status: 'Resolved', affects: 'Ultra HD add-on' },
  ];
  const cases = [
    { caseId: 'PBC-7001', subscriberId: 'SBR-4001', summary: '4K playback falls back to 720p on streaming stick', priority: 'Medium', status: 'Open', openedOn: '2026-09-19', linkedIncident: 'INC-3310' },
  ];
  const titles = [
    { titleId: 'TTL-2204', title: 'Harbor Lights (Season 2)', type: 'Series', genre: 'Drama', plans: ['PLN-STANDARD', 'PLN-PREMIUM'], rights: { US: { from: '2026-08-01', to: '2029-07-31' }, UK: { from: '2026-08-01', to: '2029-07-31' }, CA: { from: '2026-11-01', to: '2029-07-31' }, AU: { from: '2026-08-15', to: '2028-08-14' } } },
    { titleId: 'TTL-1180', title: 'Summit: A Climbing Story', type: 'Film', genre: 'Documentary', plans: ['PLN-BASIC-ADS', 'PLN-STANDARD', 'PLN-PREMIUM'], rights: { US: { from: '2025-05-01', to: '2027-04-30' }, CA: { from: '2025-05-01', to: '2027-04-30' }, UK: { from: '2025-05-01', to: '2027-04-30' }, DE: { from: '2025-05-01', to: '2027-04-30' }, BR: { from: '2025-05-01', to: '2027-04-30' }, AU: { from: '2025-05-01', to: '2027-04-30' } } },
    { titleId: 'TTL-3005', title: 'League Night Live', type: 'Live sports', genre: 'Sports', plans: ['PLN-STANDARD', 'PLN-PREMIUM'], requiresAddOn: 'ADD-SPORTS', rights: { US: { from: '2026-09-01', to: '2027-06-30' }, CA: { from: '2026-09-01', to: '2027-06-30' } } },
    { titleId: 'TTL-0877', title: 'Paper Boats', type: 'Series', genre: 'Kids', plans: ['PLN-BASIC-ADS', 'PLN-STANDARD', 'PLN-PREMIUM'], rights: { US: { from: '2024-01-01', to: '2026-10-31' }, CA: { from: '2024-01-01', to: '2026-10-31' }, UK: { from: '2024-01-01', to: '2026-10-31' } } },
  ];
  const watchHistory = [
    { subscriberId: 'SBR-4001', watchedOn: '2026-09-22', titleId: 'TTL-2204', title: 'Harbor Lights S2E2', device: "Jamie's phone", minutes: 48, completionPct: 100 },
    { subscriberId: 'SBR-4001', watchedOn: '2026-09-19', titleId: 'TTL-3005', title: 'League Night Live: Week 3', device: 'Bedroom streaming stick', minutes: 131, completionPct: 92 },
    { subscriberId: 'SBR-4001', watchedOn: '2026-09-18', titleId: 'TTL-1180', title: 'Summit: A Climbing Story', device: 'Bedroom streaming stick', minutes: 64, completionPct: 58 },
    { subscriberId: 'SBR-4001', watchedOn: '2026-09-15', titleId: 'TTL-2204', title: 'Harbor Lights S2E1', device: "Jamie's phone", minutes: 51, completionPct: 100 },
    { subscriberId: 'SBR-4001', watchedOn: '2026-09-12', titleId: 'TTL-3005', title: 'League Night Live: Week 2', device: 'Bedroom streaming stick', minutes: 140, completionPct: 100 },
    { subscriberId: 'SBR-4001', watchedOn: '2026-08-10', titleId: 'TTL-0877', title: 'Paper Boats S1E4', device: 'Office laptop browser', minutes: 22, completionPct: 100 },
    { subscriberId: 'SBR-4002', watchedOn: '2026-09-22', titleId: 'TTL-0877', title: 'Paper Boats S2E1', device: 'Living room console', minutes: 24, completionPct: 100 },
  ];
  return { plans, addOns, subscribers, devices, charges, playbackSessions, incidents, cases, titles, watchHistory };
}

const findSubscriber = (db, id) => {
  const s = db.subscribers.find((x) => x.subscriberId === id);
  if (!s) throw new ToolError(404, 'NOT_FOUND', `Subscriber ${id} not found`);
  return s;
};
const findPlan = (db, id) => {
  const p = db.plans.find((x) => x.planId === id);
  if (!p) throw new ToolError(404, 'NOT_FOUND', `Plan ${id} not found`);
  return p;
};
const creditable = (c) => money(c.amount - c.credits.reduce((s, r) => s + r.amount, 0));
const activeDevices = (db, id) => db.devices.filter((d) => d.subscriberId === id && d.status === 'Active');
const daysBefore = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (date, months) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

const TIERS = ['Basic with Ads', 'Standard', 'Premium'];

const handlers = {
  searchSubscribers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.subscribers.filter((s) =>
      s.name.toLowerCase().includes(q) || s.subscriberId.toLowerCase() === q || s.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      subscribers: hits.map((s) => ({ subscriberId: s.subscriberId, name: s.name, email: maskEmail(s.email), plan: findPlan(db, s.planId).name, status: s.status })),
    };
  },

  getSubscriberAccount(db, { subscriberId }) {
    const s = findSubscriber(db, subscriberId);
    const plan = findPlan(db, s.planId);
    return {
      ...s, email: maskEmail(s.email),
      plan: { planId: plan.planId, name: plan.name, priceUsd: plan.priceUsd, deviceLimit: plan.deviceLimit, streams: plan.streams },
      addOns: s.addOns.map((id) => db.addOns.find((a) => a.addOnId === id)).filter(Boolean).map((a) => ({ addOnId: a.addOnId, name: a.name, priceUsd: a.priceUsd })),
      devicesRegistered: activeDevices(db, s.subscriberId).length,
      openCases: db.cases.filter((c) => c.subscriberId === s.subscriberId && c.status === 'Open'),
    };
  },

  listStreamingPlans(db, { includeAddOns = true }) {
    return { currency: 'USD', plans: db.plans, ...(includeAddOns === false ? {} : { addOns: db.addOns }) };
  },

  changeStreamingPlan(db, { subscriberId, planId }) {
    const s = findSubscriber(db, subscriberId);
    const plan = findPlan(db, planId);
    if (s.status === 'Cancelled') throw new ToolError(409, 'NOT_ACTIVE', `${s.subscriberId} is cancelled; start a new subscription instead`);
    if (s.planId === plan.planId) throw new ToolError(409, 'ALREADY_ON_PLAN', `${s.subscriberId} is already on ${plan.name}`);
    const from = findPlan(db, s.planId);
    s.planId = plan.planId;
    const devices = activeDevices(db, s.subscriberId).length;
    return {
      subscriberId: s.subscriberId, fromPlan: from.name, toPlan: plan.name, newPriceUsd: plan.priceUsd, currency: 'USD',
      effectiveOn: s.renewsOn || TODAY,
      ...(devices > plan.deviceLimit ? { warning: `${devices} devices registered but ${plan.name} allows ${plan.deviceLimit}; remove ${devices - plan.deviceLimit} before ${s.renewsOn || TODAY}.` } : {}),
      ...(plan.planId !== 'PLN-PREMIUM' && s.addOns.includes('ADD-UHD') ? { note: 'Ultra HD needs Premium; the add-on will stop at the plan change.' } : {}),
    };
  },

  pauseStreamingSubscription(db, { subscriberId, months, reason = '' }) {
    const s = findSubscriber(db, subscriberId);
    if (s.status !== 'Active') throw new ToolError(409, 'NOT_ACTIVE', `${s.subscriberId} is ${s.status}; only active subscriptions can be paused`);
    const resumesOn = addMonths(s.renewsOn || TODAY, months);
    Object.assign(s, { status: 'Paused', pausedUntil: resumesOn, pauseReason: String(reason).slice(0, 200), renewsOn: null });
    return { subscriberId: s.subscriberId, status: s.status, pausedFrom: TODAY, resumesOn, billing: 'No charges while paused; watch history and profiles are kept.' };
  },

  listStreamingDevices(db, { subscriberId }) {
    const s = findSubscriber(db, subscriberId);
    const plan = findPlan(db, s.planId);
    const list = db.devices.filter((d) => d.subscriberId === s.subscriberId);
    const active = list.filter((d) => d.status === 'Active').length;
    return { subscriberId: s.subscriberId, plan: plan.name, deviceLimit: plan.deviceLimit, registered: active, slotsFree: Math.max(0, plan.deviceLimit - active), devices: list };
  },

  deregisterStreamingDevice(db, { deviceId, reason = '' }) {
    const d = db.devices.find((x) => x.deviceId === deviceId);
    if (!d) throw new ToolError(404, 'NOT_FOUND', `Device ${deviceId} not found`);
    if (d.status !== 'Active') throw new ToolError(409, 'ALREADY_REMOVED', `${deviceId} is already removed`);
    Object.assign(d, { status: 'Removed', removedOn: TODAY, removeReason: String(reason).slice(0, 200) });
    const s = findSubscriber(db, d.subscriberId);
    const plan = findPlan(db, s.planId);
    const active = activeDevices(db, s.subscriberId).length;
    return { deviceId, name: d.name, status: d.status, removedOn: TODAY, subscriberId: s.subscriberId, slotsFree: Math.max(0, plan.deviceLimit - active), deviceLimit: plan.deviceLimit };
  },

  listSubscriptionCharges(db, { subscriberId }) {
    const s = findSubscriber(db, subscriberId);
    return {
      subscriberId: s.subscriberId, currency: 'USD',
      charges: db.charges.filter((c) => c.subscriberId === s.subscriberId).map((c) => ({ ...c, creditableRemaining: creditable(c) })),
    };
  },

  issueSubscriptionCredit(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (c.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${chargeId} is ${c.status}; only paid charges can be credited`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be credited`);
    const r = {
      creditId: `CR-${chargeId.slice(4)}-${c.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, appliesTo: 'Original payment method, 3-5 business days',
    };
    c.credits.push(r);
    return { chargeId, subscriberId: c.subscriberId, description: c.description, ...r, creditableRemaining: money(remaining - amount) };
  },

  getPlaybackDiagnostics(db, { subscriberId, days = 14 }) {
    const s = findSubscriber(db, subscriberId);
    const since = daysBefore(TODAY, days);
    const sessions = db.playbackSessions.filter((p) => p.subscriberId === s.subscriberId && p.startedAt.slice(0, 10) >= since);
    const errors = {};
    for (const p of sessions) if (p.errorCode) errors[p.errorCode] = (errors[p.errorCode] || 0) + 1;
    const knownIncidents = db.incidents.filter((i) => i.to >= since);
    return { subscriberId: s.subscriberId, days, since, sessions, errorCounts: errors, knownIncidents };
  },

  openPlaybackCase(db, { subscriberId, summary, priority = 'Medium' }) {
    const s = findSubscriber(db, subscriberId);
    const c = { caseId: `PBC-${7001 + db.cases.length}`, subscriberId: s.subscriberId, summary: String(summary).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.cases.push(c);
    return { ...c, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  checkTitleAvailability(db, { titleId, region = 'US' }) {
    const t = db.titles.find((x) => x.titleId === titleId);
    if (!t) throw new ToolError(404, 'NOT_FOUND', `Title ${titleId} not found`);
    const w = t.rights[region];
    const plans = t.plans.map((id) => findPlan(db, id).name);
    let status;
    if (!w) status = 'No rights in this region';
    else if (TODAY < w.from) status = `Coming ${w.from}`;
    else if (TODAY > w.to) status = 'Rights expired';
    else status = 'Available';
    return {
      titleId: t.titleId, title: t.title, type: t.type, genre: t.genre, region, status,
      rightsWindow: w || null, plans, ...(t.requiresAddOn ? { requiresAddOn: t.requiresAddOn } : {}),
      availableIn: Object.keys(t.rights).filter((r) => t.rights[r].from <= TODAY && TODAY <= t.rights[r].to),
    };
  },

  getWatchHistory(db, { subscriberId, days = 30 }) {
    const s = findSubscriber(db, subscriberId);
    const since = daysBefore(TODAY, days);
    const items = db.watchHistory.filter((w) => w.subscriberId === s.subscriberId && w.watchedOn >= since);
    return { subscriberId: s.subscriberId, days, since, totalMinutes: items.reduce((t, w) => t + w.minutes, 0), items };
  },

  getSubscriberChurnMetrics(_db, { months = 6 }) {
    const series = [
      ['2025-10', 2.9, 41200, 9800], ['2025-11', 3.0, 42900, 10100], ['2025-12', 2.6, 37800, 12400],
      ['2026-01', 3.4, 49600, 9100], ['2026-02', 3.1, 45700, 8800], ['2026-03', 2.8, 41900, 9300],
      ['2026-04', 2.7, 40600, 9900], ['2026-05', 2.9, 43800, 9600], ['2026-06', 3.3, 50100, 8700],
      ['2026-07', 3.5, 53400, 8400], ['2026-08', 3.2, 49200, 11200], ['2026-09', 2.8, 43600, 13900],
    ].slice(-months).map(([month, churnPct, cancellations, winBacks]) => ({ month, churnPct, cancellations, winBacks }));
    return {
      months: series.length, series,
      byTier: [
        { tier: 'Basic with Ads', churnPct: 4.6 }, { tier: 'Standard', churnPct: 2.9 }, { tier: 'Premium', churnPct: 1.8 },
      ],
      topReasons: [
        { reason: 'Price', share: 0.34 }, { reason: 'Finished a series', share: 0.22 },
        { reason: 'Payment failed', share: 0.17 }, { reason: 'Playback problems', share: 0.09 },
      ],
      trend: 'Summer churn peak eased in September as the sports season started.',
    };
  },

  getViewershipTrends(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      dailyActiveViewersK: 4820, hoursStreamedM: 212 * f, peakConcurrentK: 1310,
      deviceMix: [
        { device: 'Smart TV / stick', share: 0.58 }, { device: 'Mobile', share: 0.24 },
        { device: 'Web', share: 0.11 }, { device: 'Console', share: 0.07 },
      ],
      shift: 'Live sports lifted weekend peaks 18%; mobile share up 2 pts.',
    };
  },

  getTitlePerformance(_db, { genre }) {
    const all = [
      { title: 'Harbor Lights (Season 2)', genre: 'Drama', hoursViewedM: 38.4, completionPct: 71, signupsAttributedK: 96 },
      { title: 'League Night Live', genre: 'Sports', hoursViewedM: 29.7, completionPct: 64, signupsAttributedK: 142 },
      { title: 'Summit: A Climbing Story', genre: 'Documentary', hoursViewedM: 6.2, completionPct: 58, signupsAttributedK: 11 },
      { title: 'Paper Boats', genre: 'Kids', hoursViewedM: 21.9, completionPct: 88, signupsAttributedK: 23 },
      { title: 'Office Hours', genre: 'Comedy', hoursViewedM: 14.3, completionPct: 67, signupsAttributedK: 19 },
    ];
    return { period: 'last_30d', titles: genre ? all.filter((t) => t.genre === genre) : all, note: 'Aggregated across subscribers; no individual viewing records.' };
  },

  getAdRevenueMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { impressionsM: 1840, fillRatePct: 86, cpmUsd: 24.1, revenueUsd: 44.3e6 }, previous: { impressionsM: 1610, fillRatePct: 83, cpmUsd: 23.4, revenueUsd: 37.7e6 } }
      : { current: { impressionsM: 655, fillRatePct: 88, cpmUsd: 25.2, revenueUsd: 16.5e6 }, previous: { impressionsM: 590, fillRatePct: 85, cpmUsd: 23.9, revenueUsd: 14.1e6 } };
    return { period, currency: 'USD', ...p, note: 'Ad tier revenue up on live sports inventory.' };
  },

  getStreamingQualityMetrics(_db, { region }) {
    const all = [
      { region: 'US', rebufferPct: 0.62, videoStartSec: 1.8, playbackFailurePct: 0.41, uhdSharePct: 22 },
      { region: 'CA', rebufferPct: 0.55, videoStartSec: 1.7, playbackFailurePct: 0.38, uhdSharePct: 19 },
      { region: 'UK', rebufferPct: 0.48, videoStartSec: 1.6, playbackFailurePct: 0.33, uhdSharePct: 24 },
      { region: 'DE', rebufferPct: 0.51, videoStartSec: 1.7, playbackFailurePct: 0.35, uhdSharePct: 21 },
      { region: 'BR', rebufferPct: 1.14, videoStartSec: 2.6, playbackFailurePct: 0.72, uhdSharePct: 8 },
      { region: 'AU', rebufferPct: 0.69, videoStartSec: 2.0, playbackFailurePct: 0.44, uhdSharePct: 17 },
    ];
    return { period: 'last_30d', regions: region ? all.filter((r) => r.region === region) : all, incidents: ['INC-3310: US-East 4K outage 2026-09-17 to 2026-09-21 (resolved)'] };
  },

  getPlanMixSummary(_db, { tier }) {
    const all = [
      { tier: 'Basic with Ads', paidSubscribersK: 6120, netAddsK: 214, arpuUsd: 11.40 },
      { tier: 'Standard', paidSubscribersK: 5380, netAddsK: 38, arpuUsd: 16.10 },
      { tier: 'Premium', paidSubscribersK: 2940, netAddsK: 57, arpuUsd: 31.75 },
    ];
    return {
      asOf: TODAY, currency: 'USD', tiers: tier ? all.filter((t) => t.tier === tier) : all,
      addOnAttach: [{ addOn: 'Ultra HD', attachPct: 41, of: 'Premium' }, { addOn: 'Sports Pass', attachPct: 12, of: 'All paid' }, { addOn: 'Kids+ Library', attachPct: 6, of: 'All paid' }],
      note: 'ARPU on the ad tier includes ad revenue per subscriber.',
    };
  },

  getContentMarginReport(_db, { slate }) {
    const all = [
      { slate: 'Originals', titles: 64, attributedRevenueUsd: 412e6, productionAmortisationUsd: 238e6, licensingCostUsd: 0, marketingCostUsd: 61e6 },
      { slate: 'Licensed Films', titles: 1830, attributedRevenueUsd: 276e6, productionAmortisationUsd: 0, licensingCostUsd: 164e6, marketingCostUsd: 18e6 },
      { slate: 'Licensed Series', titles: 540, attributedRevenueUsd: 338e6, productionAmortisationUsd: 0, licensingCostUsd: 191e6, marketingCostUsd: 22e6 },
      { slate: 'Live Sports', titles: 3, attributedRevenueUsd: 198e6, productionAmortisationUsd: 34e6, licensingCostUsd: 142e6, marketingCostUsd: 27e6 },
    ].map((s) => ({ ...s, marginPct: money(((s.attributedRevenueUsd - s.productionAmortisationUsd - s.licensingCostUsd - s.marketingCostUsd) / s.attributedRevenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', slates: slate ? all.filter((s) => s.slate === slate) : all };
  },

  runSubscriberGrowthForecast(_db, { horizonQuarters = 4 }) {
    const quarters = ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4', '2028-Q1', '2028-Q2', '2028-Q3'].slice(0, horizonQuarters);
    const base = { 'Basic with Ads': 6120, Standard: 5380, Premium: 2940 };
    const growth = { 'Basic with Ads': 0.035, Standard: 0.004, Premium: 0.012 };
    const forecast = quarters.map((quarter, i) => {
      const byTier = TIERS.map((t) => {
        const expectedK = Math.round(base[t] * (1 + growth[t] * (i + 1)));
        return { tier: t, expectedK, lowK: Math.round(expectedK * 0.95), highK: Math.round(expectedK * 1.04) };
      });
      return { quarter, totalK: byTier.reduce((s, x) => s + x.expectedK, 0), byTier };
    });
    return { horizonQuarters, model: 'tier-flow v3 (demo)', forecast, driver: 'Ad tier growth and the live sports season' };
  },
};

module.exports = { build, handlers, TODAY };
