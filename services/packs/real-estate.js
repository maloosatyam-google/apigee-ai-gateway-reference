// Real Estate handlers and seed data for the industry-apis service (pack: industries/real-estate.json).
//
// A property developer and manager: residential sales of new units plus leasing of apartments
// and retail space. Story: Jamie Carter (CUS-4101) bought unit HVR-1204 at Harbor View
// Residences (reservation RSV-6101). The pre-handover inspection found a kitchen leak
// (MNT-8101), so handover is not booked yet, and although the September installment was paid
// on time a $120 late-payment penalty was charged (CHG-2202). Waiving the $30 access-card fee
// (CHG-2201) is within policy; waiving the $120 penalty is over the $50 limit that Apigee
// enforces for Sales & Leasing. The limit is not enforced here, so the gateway control stays
// visible: this service records whatever waiver reaches it (up to the amount charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

const PROJECT_NAMES = { HVR: 'Harbor View Residences', PKT: 'Parkside Towers', CGL: 'Cedar Grove Lofts', MKS: 'Market Square' };

function build() {
  const customers = [
    { customerId: 'CUS-4101', name: 'Jamie Carter', email: 'jamie.carter@example.com', type: 'Buyer', status: 'Active', customerSince: '2025-11-08' },
    { customerId: 'CUS-4102', name: 'Morgan Ellis', email: 'morgan.ellis@example.com', type: 'Tenant', status: 'Active', customerSince: '2024-11-01' },
    { customerId: 'CUS-4103', name: 'Taylor Reyes', email: 'taylor.reyes@example.com', type: 'Buyer', status: 'Active', customerSince: '2026-09-10' },
    { customerId: 'CUS-4104', name: 'Jamila Brooks', email: 'jamila.brooks@example.com', type: 'Prospect', status: 'Active', customerSince: '2026-09-18' },
    { customerId: 'CUS-4105', name: 'Robin Alvarez', email: 'robin@mapleoakbakery.example.com', type: 'Retail tenant', company: 'Maple & Oak Bakery LLC', status: 'Active', customerSince: '2024-04-01' },
    { customerId: 'CUS-4106', name: 'Casey Nguyen', email: 'casey.nguyen@example.com', type: 'Buyer', status: 'Handed over', customerSince: '2025-02-14' },
  ];
  const units = [
    { unitId: 'HVR-1204', projectId: 'HVR', floor: 12, bedrooms: 2, sizeSqft: 1080, use: 'Sale', listPriceUsd: 612000, status: 'Sold', handoverReady: false, view: 'Harbor' },
    { unitId: 'HVR-1507', projectId: 'HVR', floor: 15, bedrooms: 2, sizeSqft: 1110, use: 'Sale', listPriceUsd: 648000, status: 'Available', handoverReady: true, view: 'Harbor' },
    { unitId: 'HVR-0903', projectId: 'HVR', floor: 9, bedrooms: 2, sizeSqft: 1040, use: 'Sale', listPriceUsd: 579000, status: 'Available', handoverReady: true, view: 'City' },
    { unitId: 'HVR-1802', projectId: 'HVR', floor: 18, bedrooms: 3, sizeSqft: 1520, use: 'Sale', listPriceUsd: 915000, status: 'Available', handoverReady: true, view: 'Harbor' },
    { unitId: 'HVR-0601', projectId: 'HVR', floor: 6, bedrooms: 1, sizeSqft: 720, use: 'Sale', listPriceUsd: 398000, status: 'Sold', handoverReady: true, view: 'City' },
    { unitId: 'PKT-0801', projectId: 'PKT', floor: 8, bedrooms: 1, sizeSqft: 690, use: 'Sale', listPriceUsd: 365000, status: 'Available', handoverReady: false, view: 'Park', completion: '2027-Q2' },
    { unitId: 'PKT-1102', projectId: 'PKT', floor: 11, bedrooms: 2, sizeSqft: 1010, use: 'Sale', listPriceUsd: 542000, status: 'Reserved', handoverReady: false, view: 'Park', completion: '2027-Q2' },
    { unitId: 'CGL-0305', projectId: 'CGL', floor: 3, bedrooms: 1, sizeSqft: 760, use: 'Lease', rentUsd: 2150, status: 'Leased', handoverReady: true },
    { unitId: 'CGL-0412', projectId: 'CGL', floor: 4, bedrooms: 2, sizeSqft: 1020, use: 'Lease', rentUsd: 2890, status: 'Available', handoverReady: true },
    { unitId: 'MKS-G02', projectId: 'MKS', floor: 0, bedrooms: 0, sizeSqft: 1450, use: 'Lease', rentUsd: 6400, status: 'Leased', handoverReady: true },
    { unitId: 'MKS-G05', projectId: 'MKS', floor: 0, bedrooms: 0, sizeSqft: 980, use: 'Lease', rentUsd: 4700, status: 'Available', handoverReady: true },
  ];
  const reservations = [
    { reservationId: 'RSV-6101', customerId: 'CUS-4101', unitId: 'HVR-1204', stage: 'Contracted', reservedOn: '2025-11-08', contractSignedOn: '2025-12-02', priceUsd: 612000, handover: { status: 'Not scheduled', blockedBy: 'Open snag MNT-8101 (kitchen leak)' } },
    { reservationId: 'RSV-6102', customerId: 'CUS-4103', unitId: 'PKT-1102', stage: 'Reserved', reservedOn: '2026-09-10', holdExpires: '2026-09-24', priceUsd: 542000, handover: { status: 'Off-plan, expected 2027-Q2' } },
    { reservationId: 'RSV-6099', customerId: 'CUS-4106', unitId: 'HVR-0601', stage: 'Handed over', reservedOn: '2025-02-14', contractSignedOn: '2025-03-01', priceUsd: 398000, handover: { status: 'Completed', date: '2026-08-20' } },
  ];
  const paymentSchedules = {
    'RSV-6101': [
      { milestone: 'Reservation deposit', dueDate: '2025-11-08', amountUsd: 10000, status: 'Paid', paidOn: '2025-11-08' },
      { milestone: 'Contract signing (10%)', dueDate: '2025-12-02', amountUsd: 51200, status: 'Paid', paidOn: '2025-12-02' },
      { milestone: 'Installment 1 (structure complete)', dueDate: '2026-03-01', amountUsd: 18500, status: 'Paid', paidOn: '2026-02-27' },
      { milestone: 'Installment 2', dueDate: '2026-06-01', amountUsd: 18500, status: 'Paid', paidOn: '2026-05-30' },
      { milestone: 'Installment 3 (September)', dueDate: '2026-09-01', amountUsd: 18500, status: 'Paid', paidOn: '2026-09-01', note: 'Bank posted 2026-09-03; late penalty CHG-2202 applied in error' },
      { milestone: 'Balance at handover', dueDate: 'On handover', amountUsd: 495300, status: 'Due', note: 'Mortgage drawdown on key release' },
    ],
    'RSV-6102': [
      { milestone: 'Reservation deposit', dueDate: '2026-09-10', amountUsd: 10000, status: 'Paid', paidOn: '2026-09-10' },
      { milestone: 'Contract signing (10%)', dueDate: '2026-10-10', amountUsd: 44200, status: 'Due' },
    ],
    'RSV-6099': [
      { milestone: 'Full price', dueDate: '2026-08-20', amountUsd: 398000, status: 'Paid', paidOn: '2026-08-20' },
    ],
  };
  const charges = [
    { chargeId: 'CHG-2200', customerId: 'CUS-4101', description: 'Installment 3 (September), HVR-1204', amount: 18500, status: 'Paid', postedOn: '2026-09-03' },
    { chargeId: 'CHG-2201', customerId: 'CUS-4101', description: 'Replacement access card fee (card defective on issue)', amount: 30, status: 'Paid', postedOn: '2026-09-12' },
    { chargeId: 'CHG-2202', customerId: 'CUS-4101', description: 'Late-payment penalty, installment 3', amount: 120, status: 'Paid', postedOn: '2026-09-04', note: 'Installment paid 2026-09-01; bank posting delay' },
    { chargeId: 'CHG-2210', customerId: 'CUS-4102', description: 'Rent, CGL-0305 (September)', amount: 2150, status: 'Paid', postedOn: '2026-09-01' },
    { chargeId: 'CHG-2211', customerId: 'CUS-4102', description: 'Rent, CGL-0305 (October)', amount: 2150, status: 'Due', postedOn: '2026-09-25', dueOn: '2026-10-01' },
    { chargeId: 'CHG-2220', customerId: 'CUS-4105', description: 'Rent and service charge, MKS-G02 (September)', amount: 7180, status: 'Paid', postedOn: '2026-09-01' },
  ].map((c) => ({ ...c, waivers: [] }));
  const leases = [
    { leaseId: 'LSE-7101', customerId: 'CUS-4102', unitId: 'CGL-0305', type: 'Residential', rentUsd: 2150, depositUsd: 4300, start: '2024-11-01', end: '2026-10-31', renewalWindowOpens: '2026-08-01', renewalRentUsd: 2215, status: 'Active' },
    { leaseId: 'LSE-7102', customerId: 'CUS-4105', unitId: 'MKS-G02', type: 'Retail', rentUsd: 6400, serviceChargeUsd: 780, depositUsd: 19200, start: '2024-04-01', end: '2027-03-31', renewalWindowOpens: '2026-10-01', renewalRentUsd: 6650, status: 'Active' },
  ];
  const maintenance = [
    { requestId: 'MNT-8101', customerId: 'CUS-4101', unitId: 'HVR-1204', issue: 'Kitchen sink leak found at pre-handover inspection', priority: 'High', status: 'Open', openedOn: '2026-09-19', snag: true },
    { requestId: 'MNT-8102', customerId: 'CUS-4102', unitId: 'CGL-0305', issue: 'Air conditioning not cooling', priority: 'Medium', status: 'In progress', openedOn: '2026-09-21' },
    { requestId: 'MNT-8103', customerId: 'CUS-4105', unitId: 'MKS-G02', issue: 'Storefront shutter motor noisy', priority: 'Low', status: 'Scheduled', openedOn: '2026-09-15', visit: '2026-09-29' },
  ];
  return { customers, units, reservations, paymentSchedules, charges, leases, maintenance };
}

const findCustomer = (db, id) => {
  const c = db.customers.find((x) => x.customerId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Customer ${id} not found`);
  return c;
};
const findUnit = (db, id) => {
  const u = db.units.find((x) => x.unitId === id);
  if (!u) throw new ToolError(404, 'NOT_FOUND', `Unit ${id} not found`);
  return u;
};
const findReservation = (db, id) => {
  const r = db.reservations.find((x) => x.reservationId === id);
  if (!r) throw new ToolError(404, 'NOT_FOUND', `Reservation ${id} not found`);
  return r;
};
const findLease = (db, id) => {
  const l = db.leases.find((x) => x.leaseId === id);
  if (!l) throw new ToolError(404, 'NOT_FOUND', `Lease ${id} not found`);
  return l;
};
const waivable = (c) => money(c.amount - c.waivers.reduce((s, w) => s + w.amount, 0));
const addMonths = (date, months) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const unitView = (u) => ({ ...u, project: PROJECT_NAMES[u.projectId], currency: 'USD', ...(u.listPriceUsd ? { pricePerSqftUsd: money(u.listPriceUsd / u.sizeSqft) } : {}) });

const PROJECTS = ['Harbor View Residences', 'Parkside Towers', 'Cedar Grove Lofts', 'Market Square'];

const handlers = {
  searchPropertyBuyers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.customers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.customerId.toLowerCase() === q || c.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      customers: hits.map((c) => ({ customerId: c.customerId, name: c.name, email: maskEmail(c.email), type: c.type, status: c.status })),
    };
  },

  getBuyerProfile(db, { customerId }) {
    const c = findCustomer(db, customerId);
    const due = db.charges.filter((x) => x.customerId === c.customerId && x.status === 'Due').reduce((t, x) => t + x.amount, 0);
    return {
      ...c, email: maskEmail(c.email),
      reservations: db.reservations.filter((r) => r.customerId === c.customerId).map((r) => ({ reservationId: r.reservationId, unitId: r.unitId, stage: r.stage, handover: r.handover.status })),
      leases: db.leases.filter((l) => l.customerId === c.customerId).map((l) => ({ leaseId: l.leaseId, unitId: l.unitId, end: l.end, status: l.status })),
      balanceDueUsd: money(due),
      openMaintenance: db.maintenance.filter((m) => m.customerId === c.customerId && m.status !== 'Closed'),
    };
  },

  getUnitDetails(db, { unitId }) {
    return unitView(findUnit(db, unitId));
  },

  checkUnitInventory(db, { projectId, bedrooms }) {
    const list = db.units.filter((u) => u.projectId === projectId && u.status === 'Available' && (bedrooms === undefined || u.bedrooms === bedrooms));
    return { projectId, project: PROJECT_NAMES[projectId], available: list.length, units: list.map(unitView) };
  },

  getReservationStatus(db, { reservationId }) {
    const r = findReservation(db, reservationId);
    const sched = db.paymentSchedules[r.reservationId] || [];
    const paid = sched.filter((m) => m.status === 'Paid').reduce((t, m) => t + m.amountUsd, 0);
    const buyer = db.customers.find((c) => c.customerId === r.customerId);
    return { ...r, buyer: buyer?.name, project: PROJECT_NAMES[r.unitId.slice(0, 3)], currency: 'USD', paidToDateUsd: money(paid), outstandingUsd: money(r.priceUsd - paid) };
  },

  holdUnitReservation(db, { customerId, unitId }) {
    const c = findCustomer(db, customerId);
    const u = findUnit(db, unitId);
    if (u.use !== 'Sale') throw new ToolError(409, 'NOT_FOR_SALE', `${unitId} is a lease unit; use a lease application instead`);
    if (u.status !== 'Available') throw new ToolError(409, 'UNIT_UNAVAILABLE', `${unitId} is ${u.status.toLowerCase()}`);
    u.status = 'Reserved';
    const r = { reservationId: `RSV-${6101 + db.reservations.length}`, customerId: c.customerId, unitId: u.unitId, stage: 'Reserved', reservedOn: TODAY, holdExpires: addDays(TODAY, 14), priceUsd: u.listPriceUsd, handover: { status: 'Not scheduled' } };
    db.reservations.push(r);
    db.paymentSchedules[r.reservationId] = [
      { milestone: 'Reservation deposit', dueDate: addDays(TODAY, 3), amountUsd: 10000, status: 'Due' },
      { milestone: 'Contract signing (10%)', dueDate: r.holdExpires, amountUsd: money(u.listPriceUsd * 0.1 - 10000), status: 'Due' },
    ];
    return { ...r, project: PROJECT_NAMES[u.projectId], currency: 'USD', depositDueUsd: 10000, depositDueBy: addDays(TODAY, 3) };
  },

  getPaymentSchedule(db, { reservationId }) {
    const r = findReservation(db, reservationId);
    const milestones = db.paymentSchedules[r.reservationId] || [];
    const paid = milestones.filter((m) => m.status === 'Paid').reduce((t, m) => t + m.amountUsd, 0);
    const outstanding = milestones.filter((m) => m.status !== 'Paid').reduce((t, m) => t + m.amountUsd, 0);
    return { reservationId: r.reservationId, unitId: r.unitId, currency: 'USD', milestones, paidToDateUsd: money(paid), outstandingUsd: money(outstanding) };
  },

  getLeaseAgreement(db, { leaseId }) {
    const l = findLease(db, leaseId);
    const tenant = db.customers.find((c) => c.customerId === l.customerId);
    return { ...l, tenant: tenant?.name, project: PROJECT_NAMES[l.unitId.slice(0, 3)], currency: 'USD', renewalWindowOpen: TODAY >= l.renewalWindowOpens && TODAY <= l.end };
  },

  renewTenantLease(db, { leaseId, months }) {
    const l = findLease(db, leaseId);
    if (l.status !== 'Active') throw new ToolError(409, 'NOT_ACTIVE', `${leaseId} is ${l.status}`);
    if (TODAY < l.renewalWindowOpens) throw new ToolError(409, 'RENEWAL_WINDOW_CLOSED', `Renewal window for ${leaseId} opens ${l.renewalWindowOpens}`);
    const previous = { end: l.end, rentUsd: l.rentUsd };
    Object.assign(l, { end: addMonths(l.end, months), rentUsd: l.renewalRentUsd, renewedOn: TODAY });
    return { leaseId, unitId: l.unitId, previous, newEnd: l.end, newRentUsd: l.rentUsd, termMonths: months, currency: 'USD', renewedOn: TODAY };
  },

  logMaintenanceRequest(db, { customerId, unitId, issue, priority = 'Medium' }) {
    const c = findCustomer(db, customerId);
    const u = findUnit(db, unitId);
    const linked = db.reservations.some((r) => r.customerId === c.customerId && r.unitId === u.unitId) || db.leases.some((l) => l.customerId === c.customerId && l.unitId === u.unitId);
    if (!linked) throw new ToolError(403, 'NOT_UNIT_OCCUPANT', `${c.customerId} is not the buyer or tenant of ${u.unitId}`);
    const m = { requestId: `MNT-${8101 + db.maintenance.length}`, customerId: c.customerId, unitId: u.unitId, issue: String(issue).slice(0, 200), priority, status: 'Open', openedOn: TODAY, snag: !u.handoverReady };
    db.maintenance.push(m);
    return { ...m, firstResponseWithin: priority === 'High' ? '4 hours' : priority === 'Medium' ? '1 business day' : '3 business days' };
  },

  scheduleUnitHandover(db, { reservationId, date }) {
    const r = findReservation(db, reservationId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError(400, 'INVALID_ARGUMENT', 'date must be YYYY-MM-DD');
    if (date <= TODAY) throw new ToolError(400, 'INVALID_ARGUMENT', 'date must be after today');
    if (r.stage !== 'Contracted') throw new ToolError(409, 'NOT_CONTRACTED', `${reservationId} is ${r.stage}; only contracted reservations can be handed over`);
    const openSnags = db.maintenance.filter((m) => m.unitId === r.unitId && m.snag && m.status !== 'Closed');
    r.handover = { status: 'Scheduled', date, bookedOn: TODAY, conditions: openSnags.length ? `Keys released once ${openSnags.map((m) => m.requestId).join(', ')} are closed` : 'None' };
    return { reservationId, unitId: r.unitId, ...r.handover, openSnags: openSnags.map((m) => ({ requestId: m.requestId, issue: m.issue, status: m.status })) };
  },

  getStatementOfAccount(db, { customerId }) {
    const c = findCustomer(db, customerId);
    const lines = db.charges.filter((x) => x.customerId === c.customerId).map((x) => ({ ...x, waivableRemaining: waivable(x) }));
    const credits = lines.reduce((t, x) => t + x.waivers.reduce((s, w) => s + w.amount, 0), 0);
    const due = lines.filter((x) => x.status === 'Due').reduce((t, x) => t + x.amount, 0);
    return { customerId: c.customerId, name: c.name, currency: 'USD', asOf: TODAY, charges: lines, creditsUsd: money(credits), balanceDueUsd: money(due - credits) };
  },

  waiveStatementCharge(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (c.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${chargeId} is ${c.status}; only paid charges can be waived`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = waivable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be waived`);
    const w = {
      waiverId: `WV-${chargeId.slice(4)}-${c.waivers.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, appliedAs: 'Credit on statement of account',
    };
    c.waivers.push(w);
    return { chargeId, customerId: c.customerId, description: c.description, ...w, waivableRemaining: money(remaining - amount) };
  },

  getSalesVelocity(_db, { months = 6 }) {
    const series = [
      ['2025-10', 41, 3, 548], ['2025-11', 38, 2, 551], ['2025-12', 29, 4, 549],
      ['2026-01', 33, 2, 556], ['2026-02', 36, 3, 560], ['2026-03', 47, 2, 566],
      ['2026-04', 52, 3, 571], ['2026-05', 49, 5, 574], ['2026-06', 44, 4, 572],
      ['2026-07', 39, 3, 575], ['2026-08', 42, 2, 579], ['2026-09', 51, 3, 584],
    ].slice(-months).map(([month, unitsSold, cancellations, avgPricePerSqftUsd]) => ({ month, unitsSold, cancellations, avgPricePerSqftUsd }));
    return {
      months: series.length, currency: 'USD', series,
      byProject: [{ project: 'Harbor View Residences', share: 0.58 }, { project: 'Parkside Towers', share: 0.42 }],
      trend: 'September sales up 21% month on month; Parkside off-plan launch pulling demand.',
    };
  },

  getProjectAbsorptionRates(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const rows = [
      { project: 'Harbor View Residences', totalUnits: 320, released: 300, sold: 262, soldInPeriod: 29 * f },
      { project: 'Parkside Towers', totalUnits: 410, released: 220, sold: 118, soldInPeriod: 22 * f },
    ].map((p) => ({ ...p, absorptionPct: money((p.sold / p.released) * 100), monthsOfInventory: money((p.released - p.sold) / (p.soldInPeriod / f)) }));
    return { period, projects: rows, note: 'Harbor View near sell-out; Parkside releasing phase 2 in Q4.' };
  },

  getPortfolioOccupancy(_db, { asset }) {
    const all = [
      { asset: 'Cedar Grove Lofts', type: 'Residential', units: 240, leased: 226, avgDaysVacant: 18 },
      { asset: 'Market Square', type: 'Retail', units: 36, leased: 31, avgDaysVacant: 74 },
    ].map((a) => ({ ...a, vacant: a.units - a.leased, occupancyPct: money((a.leased / a.units) * 100) }));
    return { asOf: TODAY, assets: asset ? all.filter((a) => a.asset === asset) : all, note: 'Aggregated; no individual tenant records.' };
  },

  getRentRollSummary(_db, { asset }) {
    const all = [
      { asset: 'Cedar Grove Lofts', monthlyInPlaceRentUsd: 541800, monthlyMarketRentUsd: 572400, avgRentPerSqftUsd: 2.71, expiries: { '2026-Q4': 38, '2027-Q1': 29, '2027-Q2': 41, '2027-Q3': 33 } },
      { asset: 'Market Square', monthlyInPlaceRentUsd: 168900, monthlyMarketRentUsd: 176300, avgRentPerSqftUsd: 4.62, expiries: { '2026-Q4': 2, '2027-Q1': 4, '2027-Q2': 3, '2027-Q3': 1 } },
    ].map((a) => ({ ...a, lossToLeasePct: money(((a.monthlyMarketRentUsd - a.monthlyInPlaceRentUsd) / a.monthlyMarketRentUsd) * 100) }));
    return { asOf: TODAY, currency: 'USD', assets: asset ? all.filter((a) => a.asset === asset) : all, note: 'Aggregated rent roll; no tenant-level detail.' };
  },

  getCollectionsAging(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const billed = { buyerInstallmentsUsd: 4.82e6 * f, tenantRentUsd: 0.71e6 * f };
    const collected = { buyerInstallmentsUsd: 4.61e6 * f, tenantRentUsd: 0.68e6 * f };
    return {
      period, currency: 'USD', billed, collected,
      collectionRatePct: money(((collected.buyerInstallmentsUsd + collected.tenantRentUsd) / (billed.buyerInstallmentsUsd + billed.tenantRentUsd)) * 100),
      arrearsUsd: { '0-30d': 186000, '31-60d': 64000, '61-90d': 21000, '90d+': 12500 },
      note: 'Late-penalty disputes up after a bank posting delay on 2026-09-01 installments.',
    };
  },

  getMaintenanceSlaMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { requests: 1284, firstResponseHoursMedian: 5.2, resolutionDaysMedian: 3.4, slaMetPct: 88, handoverSnagsPerUnit: 2.9 }
      : { requests: 468, firstResponseHoursMedian: 6.1, resolutionDaysMedian: 3.9, slaMetPct: 84, handoverSnagsPerUnit: 3.4 };
    return { period, ...p, topCategories: ['Plumbing', 'HVAC', 'Doors and locks'], note: 'Harbor View handover snags rising; plumbing is the top category.' };
  },

  getProjectMarginReport(_db, { project }) {
    const all = [
      { project: 'Harbor View Residences', revenueUsd: 186.4e6, landCostUsd: 31.2e6, constructionCostUsd: 98.7e6, sellingCostUsd: 7.9e6 },
      { project: 'Parkside Towers', revenueUsd: 212.8e6, landCostUsd: 42.5e6, constructionCostUsd: 121.3e6, sellingCostUsd: 9.4e6 },
      { project: 'Cedar Grove Lofts', revenueUsd: 7.1e6, landCostUsd: 0, constructionCostUsd: 2.6e6, sellingCostUsd: 0.4e6 },
      { project: 'Market Square', revenueUsd: 2.3e6, landCostUsd: 0, constructionCostUsd: 0.9e6, sellingCostUsd: 0.2e6 },
    ].map((p) => ({ ...p, grossMarginPct: money(((p.revenueUsd - p.landCostUsd - p.constructionCostUsd - p.sellingCostUsd) / p.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', basis: 'Development projects: projected lifetime; rental assets: FY2026 YTD NOI basis', projects: project ? all.filter((p) => p.project === project) : all };
  },

  runHomeDemandForecast(_db, { horizonQuarters = 4 }) {
    const quarters = ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4', '2028-Q1', '2028-Q2', '2028-Q3'].slice(0, horizonQuarters);
    const base = { 'Harbor View Residences': 34, 'Parkside Towers': 68, 'Cedar Grove Lofts': 41, 'Market Square': 3 };
    const forecast = quarters.map((quarter, i) => {
      const byProject = PROJECTS.map((p) => {
        const trend = p === 'Harbor View Residences' ? -0.18 : 0.05;
        const expected = Math.max(0, Math.round(base[p] * (1 + trend * (i + 1))));
        return { project: p, measure: p === 'Cedar Grove Lofts' || p === 'Market Square' ? 'lease-ups' : 'unit sales', expected, low: Math.round(expected * 0.85), high: Math.round(expected * 1.12) };
      });
      return { quarter, byProject };
    });
    return { horizonQuarters, model: 'absorption-flow v3 (demo)', forecast, driver: 'Harbor View sell-out and Parkside phase 2 release' };
  },
};

module.exports = { build, handlers, TODAY };
