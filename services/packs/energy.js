// Energy handlers and seed data for the industry-apis service (pack: industries/energy.json).
//
// An electricity & gas utility. Story: Jamie Carter (ACC-4001) lost power for 14 hours in
// storm outage OUT-8801; autopay failed while the power was out and a $30 late-payment fee
// (BL-6101) followed. The smart meter (MTR-7001) stopped reporting in August, so the
// September bill added a $120 catch-up charge (BL-6102) based on estimated reads. Crediting
// the $30 fee is within policy; crediting the $120 charge is over the $50 limit that Apigee
// enforces for Customer Ops. The limit is not enforced here, so the gateway control stays
// visible: this service records whatever credit reaches it (up to the amount billed).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const customers = [
    { accountId: 'ACC-4001', name: 'Jamie Carter', email: 'jamie.carter@example.com', serviceAddress: '14 Birch Street, Lakeside', segment: 'Residential', tariff: 'Standard Time-of-Use', fuels: ['Electricity', 'Gas'], autopay: true, status: 'Active', customerSince: '2019-04-11' },
    { accountId: 'ACC-4002', name: 'Morgan Blake', email: 'morgan.blake@example.com', serviceAddress: '203 Harbor Road, Apt 12, Lakeside', segment: 'Residential', tariff: 'Standard Fixed', fuels: ['Electricity'], autopay: false, status: 'Active', customerSince: '2022-08-01' },
    { accountId: 'ACC-4003', name: 'Riley Adams', email: 'riley.adams@example.com', serviceAddress: '7 Quarry Lane, Hillcrest', segment: 'Residential', tariff: 'Green Tariff 100', fuels: ['Electricity', 'Gas'], autopay: true, status: 'Active', customerSince: '2017-02-20' },
    { accountId: 'ACC-4004', name: 'Northside Bakery', email: 'accounts@northside-bakery.example.com', serviceAddress: '51 Market Square, Lakeside', segment: 'Small Business', tariff: 'Small Business Demand', fuels: ['Electricity', 'Gas'], autopay: true, status: 'Active', customerSince: '2015-06-03' },
    { accountId: 'ACC-4005', name: 'Jamie Ortiz', email: 'jamie.ortiz@example.com', serviceAddress: '96 Cedar Court, Brookfield', segment: 'Residential', tariff: 'Solar Net Metering', fuels: ['Electricity'], autopay: true, status: 'Active', customerSince: '2021-11-15' },
    { accountId: 'ACC-4006', name: 'Casey Nguyen', email: 'casey.nguyen@example.com', serviceAddress: '3 Willow Row, Hillcrest', segment: 'Residential', tariff: 'Standard Fixed', fuels: ['Electricity', 'Gas'], autopay: false, status: 'Active', customerSince: '2024-01-09' },
  ];
  const meters = [
    { meterId: 'MTR-7001', accountId: 'ACC-4001', fuel: 'Electricity', type: 'Smart (AMI)', commsStatus: 'Not reporting since 2026-08-03', lastActualRead: '2026-08-02' },
    { meterId: 'MTR-7002', accountId: 'ACC-4001', fuel: 'Gas', type: 'Smart (AMR)', commsStatus: 'OK', lastActualRead: '2026-09-20' },
    { meterId: 'MTR-7003', accountId: 'ACC-4002', fuel: 'Electricity', type: 'Smart (AMI)', commsStatus: 'OK', lastActualRead: '2026-09-21' },
    { meterId: 'MTR-7004', accountId: 'ACC-4003', fuel: 'Electricity', type: 'Smart (AMI)', commsStatus: 'OK', lastActualRead: '2026-09-22' },
    { meterId: 'MTR-7005', accountId: 'ACC-4003', fuel: 'Gas', type: 'Legacy dial', commsStatus: 'Manual reads', lastActualRead: '2026-07-18' },
    { meterId: 'MTR-7006', accountId: 'ACC-4004', fuel: 'Electricity', type: 'Smart (AMI), demand', commsStatus: 'OK', lastActualRead: '2026-09-23' },
    { meterId: 'MTR-7007', accountId: 'ACC-4005', fuel: 'Electricity', type: 'Smart (AMI), bidirectional', commsStatus: 'OK', lastActualRead: '2026-09-22' },
  ];
  const readings = [
    { meterId: 'MTR-7001', date: '2026-06-02', kind: 'Actual', reading: 48210, usage: 612, unit: 'kWh' },
    { meterId: 'MTR-7001', date: '2026-07-02', kind: 'Actual', reading: 48905, usage: 695, unit: 'kWh' },
    { meterId: 'MTR-7001', date: '2026-08-02', kind: 'Actual', reading: 49588, usage: 683, unit: 'kWh' },
    { meterId: 'MTR-7001', date: '2026-09-02', kind: 'Estimated', reading: 50548, usage: 960, unit: 'kWh', note: 'Estimated: meter not reporting; based on last winter profile' },
    { meterId: 'MTR-7002', date: '2026-08-20', kind: 'Actual', reading: 11842, usage: 18, unit: 'therms' },
    { meterId: 'MTR-7002', date: '2026-09-20', kind: 'Actual', reading: 11863, usage: 21, unit: 'therms' },
    { meterId: 'MTR-7003', date: '2026-09-21', kind: 'Actual', reading: 20417, usage: 402, unit: 'kWh' },
    { meterId: 'MTR-7004', date: '2026-09-22', kind: 'Actual', reading: 66120, usage: 540, unit: 'kWh' },
    { meterId: 'MTR-7005', date: '2026-09-18', kind: 'Estimated', reading: 9310, usage: 24, unit: 'therms', note: 'Access issue at property' },
    { meterId: 'MTR-7007', date: '2026-09-22', kind: 'Actual', reading: 15877, usage: -118, unit: 'kWh', note: 'Net export (solar)' },
  ];
  const bills = [
    { billId: 'BL-6099', accountId: 'ACC-4001', description: 'August energy bill (electricity + gas)', amount: 142.6, status: 'Paid', issuedOn: '2026-08-05', paidOn: '2026-08-20' },
    { billId: 'BL-6100', accountId: 'ACC-4001', description: 'September energy bill (electricity + gas, estimated read)', amount: 176.4, status: 'Due', issuedOn: '2026-09-05', dueOn: '2026-10-05' },
    { billId: 'BL-6101', accountId: 'ACC-4001', description: 'Late-payment fee (autopay failed 2026-09-16 during outage OUT-8801)', amount: 30, status: 'Paid', issuedOn: '2026-09-17', paidOn: '2026-09-18' },
    { billId: 'BL-6102', accountId: 'ACC-4001', description: 'Estimated-read catch-up charge (MTR-7001, 277 kWh)', amount: 120, status: 'Paid', issuedOn: '2026-09-05', paidOn: '2026-09-10' },
    { billId: 'BL-6110', accountId: 'ACC-4002', description: 'September electricity bill', amount: 71.35, status: 'Due', issuedOn: '2026-09-06', dueOn: '2026-10-06' },
    { billId: 'BL-6120', accountId: 'ACC-4003', description: 'September energy bill (electricity + gas)', amount: 118.9, status: 'Paid', issuedOn: '2026-09-07', paidOn: '2026-09-15' },
    { billId: 'BL-6130', accountId: 'ACC-4004', description: 'September business energy bill', amount: 1284.55, status: 'Overdue', issuedOn: '2026-08-06', dueOn: '2026-09-05' },
    { billId: 'BL-6140', accountId: 'ACC-4006', description: 'September energy bill (electricity + gas)', amount: 212.8, status: 'Overdue', issuedOn: '2026-08-08', dueOn: '2026-09-08' },
  ].map((b) => ({ ...b, credits: [] }));
  const outages = [
    { outageId: 'OUT-8801', area: 'Lakeside', cause: 'Storm damage: tree on 12 kV feeder F-22', status: 'Restored', startedAt: '2026-09-15T18:40', restoredAt: '2026-09-16T08:55', durationHours: 14.3, customersAffected: 4210, accounts: ['ACC-4001', 'ACC-4002', 'ACC-4004'] },
    { outageId: 'OUT-8815', area: 'Hillcrest', cause: 'Transformer T-118 overload under investigation', status: 'Crew on site', startedAt: '2026-09-25T07:20', estimatedRestoration: '2026-09-25T13:00', customersAffected: 86, accounts: ['ACC-4003', 'ACC-4006'] },
  ];
  const cases = [
    { caseId: 'CASE-9001', accountId: 'ACC-4001', subject: 'Smart meter MTR-7001 not communicating', status: 'Open', openedOn: '2026-08-10' },
  ];
  const paymentPlans = [
    { planId: 'PP-3001', accountId: 'ACC-4006', months: 6, monthlyUsd: 35.47, status: 'Active', startedOn: '2026-09-10' },
  ];
  const enrolments = [
    { enrolmentId: 'PRG-5001', accountId: 'ACC-4001', programme: 'Smart Thermostat Rewards', status: 'Active', since: '2025-06-01' },
    { enrolmentId: 'PRG-5002', accountId: 'ACC-4001', programme: 'Solar Net Metering', status: 'Application: awaiting interconnection study', since: '2026-09-01' },
    { enrolmentId: 'PRG-5003', accountId: 'ACC-4003', programme: 'Green Tariff 100', status: 'Active', since: '2023-03-01' },
    { enrolmentId: 'PRG-5004', accountId: 'ACC-4005', programme: 'Solar Net Metering', status: 'Active', since: '2022-01-10' },
  ];
  const rereads = [];
  const outageReports = [];
  const moves = [];
  return { customers, meters, readings, bills, outages, cases, paymentPlans, enrolments, rereads, outageReports, moves };
}

const findAccount = (db, id) => {
  const c = db.customers.find((x) => x.accountId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Account ${id} not found`);
  return c;
};
const creditable = (b) => money(b.amount - b.credits.reduce((s, r) => s + r.amount, 0));
const balanceDue = (db, id) => money(db.bills.filter((b) => b.accountId === id && (b.status === 'Due' || b.status === 'Overdue')).reduce((t, b) => t + creditable(b), 0));
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const SEGMENTS = ['Residential', 'Small Business', 'Commercial & Industrial', 'Community Solar'];
const REGIONS = ['North', 'South', 'East', 'West'];
const PROGRAMME_RULES = {
  'EV Off-Peak': { needsSmartElectric: true, note: 'Off-peak rate 11pm-6am applies from the next bill cycle.' },
  'Solar Net Metering': { needsSmartElectric: true, note: 'Starts after the interconnection study and bidirectional meter install.' },
  'Green Tariff 100': { needsSmartElectric: false, note: '100% renewable supply from the next bill cycle.' },
  'Smart Thermostat Rewards': { needsSmartElectric: false, note: 'Rewards paid as bill credits after each summer season.' },
};

const handlers = {
  searchUtilityCustomers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.customers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.accountId.toLowerCase() === q || c.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      customers: hits.map((c) => ({ accountId: c.accountId, name: c.name, email: maskEmail(c.email), segment: c.segment, status: c.status })),
    };
  },

  getUtilityAccount(db, { accountId }) {
    const c = findAccount(db, accountId);
    return {
      ...c, email: maskEmail(c.email),
      meters: db.meters.filter((m) => m.accountId === c.accountId).map(({ meterId, fuel, type, commsStatus }) => ({ meterId, fuel, type, commsStatus })),
      balanceDueUsd: balanceDue(db, c.accountId),
      paymentPlan: db.paymentPlans.find((p) => p.accountId === c.accountId && p.status === 'Active') || null,
      openCases: db.cases.filter((k) => k.accountId === c.accountId && k.status === 'Open'),
    };
  },

  listMeterReadings(db, { accountId, fuel = 'Electricity' }) {
    const c = findAccount(db, accountId);
    const meters = db.meters.filter((m) => m.accountId === c.accountId && m.fuel === fuel);
    if (!meters.length) return { accountId: c.accountId, fuel, meters: [], note: `No ${fuel.toLowerCase()} meter on this account.` };
    return {
      accountId: c.accountId, fuel,
      meters: meters.map((m) => ({
        ...m,
        readings: db.readings.filter((r) => r.meterId === m.meterId).sort((a, b) => b.date.localeCompare(a.date)),
        pendingReread: db.rereads.find((r) => r.meterId === m.meterId && r.status === 'Booked') || null,
      })),
    };
  },

  requestMeterReread(db, { meterId, reason = '' }) {
    const m = db.meters.find((x) => x.meterId === meterId);
    if (!m) throw new ToolError(404, 'NOT_FOUND', `Meter ${meterId} not found`);
    if (db.rereads.some((r) => r.meterId === meterId && r.status === 'Booked')) throw new ToolError(409, 'REREAD_ALREADY_BOOKED', `A re-read of ${meterId} is already booked`);
    const remote = m.commsStatus === 'OK';
    const r = {
      rereadId: `RR-${2001 + db.rereads.length}`, meterId, accountId: m.accountId, method: remote ? 'Remote read' : 'Field visit',
      scheduledFor: remote ? TODAY : addDays(TODAY, 3), window: remote ? 'Within 2 hours' : '8am-12pm',
      status: 'Booked', reason: String(reason).slice(0, 200), bookedOn: TODAY,
    };
    db.rereads.push(r);
    return { ...r, nextStep: 'Any bill based on estimated reads is recalculated automatically once the actual read is in.' };
  },

  listUtilityBills(db, { accountId }) {
    const c = findAccount(db, accountId);
    return {
      accountId: c.accountId, currency: 'USD', balanceDueUsd: balanceDue(db, c.accountId),
      bills: db.bills.filter((b) => b.accountId === c.accountId).map((b) => ({ ...b, creditableRemaining: creditable(b) })),
    };
  },

  applyBillCredit(db, { billId, amount, reason = '' }) {
    const b = db.bills.find((x) => x.billId === billId);
    if (!b) throw new ToolError(404, 'NOT_FOUND', `Bill ${billId} not found`);
    if (b.status === 'Void') throw new ToolError(409, 'BILL_VOID', `${billId} is void and cannot be credited`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(b);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_BILL', `Only ${remaining} USD of ${billId} can be credited`);
    const cr = {
      creditId: `CR-${billId.slice(3)}-${b.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Applied', postedOn: TODAY,
      appliesTo: b.status === 'Paid' ? 'Account credit, used against the next bill' : 'Reduces this bill',
    };
    b.credits.push(cr);
    return { billId, accountId: b.accountId, description: b.description, ...cr, creditableRemaining: money(remaining - amount) };
  },

  getPowerOutageStatus(db, { accountId }) {
    const c = findAccount(db, accountId);
    const hits = db.outages.filter((o) => o.accounts.includes(c.accountId)).map(({ accounts, ...o }) => o);
    return {
      accountId: c.accountId, serviceAddress: c.serviceAddress,
      current: hits.filter((o) => o.status !== 'Restored'),
      recent: hits.filter((o) => o.status === 'Restored'),
      reports: db.outageReports.filter((r) => r.accountId === c.accountId),
      compensationNote: hits.some((o) => (o.durationHours || 0) >= 12) ? 'An outage over 12 hours may qualify for goodwill credits and fee waivers.' : null,
    };
  },

  reportPowerOutage(db, { accountId, description, hazard = false }) {
    const c = findAccount(db, accountId);
    const known = db.outages.find((o) => o.status !== 'Restored' && o.accounts.includes(c.accountId));
    const r = {
      reportId: `OR-${4101 + db.outageReports.length}`, accountId: c.accountId, serviceAddress: c.serviceAddress,
      description: String(description).slice(0, 200), hazard: hazard === true, reportedAt: `${TODAY}T10:05`,
      linkedOutage: known ? known.outageId : null,
      status: hazard === true ? 'Emergency crew dispatched' : known ? 'Linked to known outage' : 'New fault logged; crew assigned',
    };
    db.outageReports.push(r);
    return { ...r, estimatedRestoration: known ? known.estimatedRestoration : `${TODAY}T16:00`, safety: hazard === true ? 'Stay 10 m away from downed lines; leave the property if you smell gas.' : undefined };
  },

  checkPaymentPlanEligibility(db, { accountId }) {
    const c = findAccount(db, accountId);
    const due = balanceDue(db, c.accountId);
    const active = db.paymentPlans.find((p) => p.accountId === c.accountId && p.status === 'Active');
    const eligible = due >= 50 && !active;
    return {
      accountId: c.accountId, balanceDueUsd: due, eligible,
      reason: active ? `Already on plan ${active.planId}` : due < 50 ? 'Balance under $50: pay in full' : 'Eligible',
      options: eligible ? [3, 6, 12].map((m) => ({ months: m, monthlyUsd: money(due / m), fees: 'None' })) : [],
    };
  },

  arrangeBillPaymentPlan(db, { accountId, months }) {
    const c = findAccount(db, accountId);
    const due = balanceDue(db, c.accountId);
    const active = db.paymentPlans.find((p) => p.accountId === c.accountId && p.status === 'Active');
    if (active) throw new ToolError(409, 'PLAN_EXISTS', `${c.accountId} already has payment plan ${active.planId}`);
    if (due < 50) throw new ToolError(409, 'BALANCE_TOO_LOW', `Balance due is ${due} USD; plans need at least 50 USD`);
    const p = { planId: `PP-${3001 + db.paymentPlans.length}`, accountId: c.accountId, months, totalUsd: due, monthlyUsd: money(due / months), status: 'Active', startedOn: TODAY, firstInstalmentOn: '2026-10-05' };
    db.paymentPlans.push(p);
    return { ...p, currency: 'USD', note: 'Late-payment fees are paused while instalments are paid on time.' };
  },

  scheduleSupplyTransfer(db, { accountId, newAddress, moveDate }) {
    const c = findAccount(db, accountId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate)) throw new ToolError(400, 'INVALID_ARGUMENT', 'moveDate must be YYYY-MM-DD');
    if (moveDate < TODAY) throw new ToolError(409, 'DATE_IN_PAST', 'moveDate must be today or later');
    const m = {
      moveId: `MV-${1501 + db.moves.length}`, accountId: c.accountId, fromAddress: c.serviceAddress, toAddress: String(newAddress).slice(0, 200),
      moveDate, finalReadOn: moveDate, supplyStartsOn: moveDate, fuels: c.fuels, status: 'Scheduled', bookedOn: TODAY,
    };
    db.moves.push(m);
    return { ...m, finalBill: 'Issued within 5 business days of the final read.' };
  },

  getCleanEnergyEnrolment(db, { accountId }) {
    const c = findAccount(db, accountId);
    return {
      accountId: c.accountId, tariff: c.tariff,
      enrolments: db.enrolments.filter((e) => e.accountId === c.accountId),
      available: Object.keys(PROGRAMME_RULES).filter((p) => !db.enrolments.some((e) => e.accountId === c.accountId && e.programme === p)),
    };
  },

  enrollCleanEnergyProgramme(db, { accountId, programme }) {
    const c = findAccount(db, accountId);
    if (db.enrolments.some((e) => e.accountId === c.accountId && e.programme === programme)) throw new ToolError(409, 'ALREADY_ENROLLED', `${c.accountId} is already in ${programme}`);
    const rule = PROGRAMME_RULES[programme];
    const smart = db.meters.some((m) => m.accountId === c.accountId && m.fuel === 'Electricity' && m.type.startsWith('Smart'));
    if (rule.needsSmartElectric && !smart) throw new ToolError(409, 'SMART_METER_REQUIRED', `${programme} needs a smart electricity meter`);
    const e = { enrolmentId: `PRG-${5001 + db.enrolments.length}`, accountId: c.accountId, programme, status: 'Active from next bill cycle', since: TODAY };
    db.enrolments.push(e);
    return { ...e, note: rule.note };
  },

  getOutageReliabilityMetrics(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const regions = [
      ['North', 38.2, 0.31, 21.5], ['South', 29.7, 0.24, 17.9], ['East', 64.8, 0.42, 48.1], ['West', 33.1, 0.27, 19.4],
    ].map(([region, saidiMin, saifi, saidiExMedMin]) => ({
      region, saidiMin: money(saidiMin * f), saifi: money(saifi * f), caidiMin: money(saidiMin / saifi), saidiExMajorEventsMin: money(saidiExMedMin * f),
    }));
    return {
      period, regions, majorEventDays: period === 'last_90d' ? 3 : 1,
      note: 'East includes the 2026-09-15 storm (feeder F-22); excluding major event days it is within target.',
    };
  },

  getEnergyConsumptionTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 812, 4.9], ['2025-11', 866, 7.8], ['2025-12', 941, 10.6], ['2026-01', 968, 11.9],
      ['2026-02', 902, 10.2], ['2026-03', 838, 7.4], ['2026-04', 776, 4.8], ['2026-05', 801, 3.1],
      ['2026-06', 914, 2.2], ['2026-07', 1012, 1.9], ['2026-08', 998, 2.0], ['2026-09', 889, 2.7],
    ].slice(-months).map(([month, electricityGWh, gasMillionTherms]) => ({ month, electricityMWh: electricityGWh * 1000, gasTherms: Math.round(gasMillionTherms * 1e6) }));
    return {
      months: series.length, series,
      bySegment: [
        { segment: 'Residential', electricityShare: 0.41, gasShare: 0.58 }, { segment: 'Small Business', electricityShare: 0.17, gasShare: 0.14 },
        { segment: 'Commercial & Industrial', electricityShare: 0.39, gasShare: 0.28 }, { segment: 'Community Solar', electricityShare: 0.03, gasShare: 0 },
      ],
      trend: 'Summer peak up 4% year on year (EV charging and heat); gas demand flat.',
    };
  },

  getGridAssetHealth(_db, { assetClass }) {
    const all = [
      { assetClass: 'Transformers', total: 18420, good: 14210, fair: 3380, poor: 710, critical: 120, overdueInspections: 264 },
      { assetClass: 'Feeders', total: 612, good: 431, fair: 142, poor: 33, critical: 6, overdueInspections: 18 },
      { assetClass: 'Substations', total: 84, good: 61, fair: 19, poor: 4, critical: 0, overdueInspections: 2 },
      { assetClass: 'Gas Mains', total: 3150, good: 2280, fair: 690, poor: 160, critical: 20, overdueInspections: 41, unit: 'miles' },
    ].map((a) => ({ ...a, healthIndex: money(((a.good * 1 + a.fair * 0.6 + a.poor * 0.25) / a.total) * 100) }));
    return { asOf: TODAY, assets: assetClass ? all.filter((a) => a.assetClass === assetClass) : all, note: 'Critical transformers cluster in the East region; replacement programme on track for 2027.' };
  },

  getUtilityArrearsSummary(_db, { segment }) {
    const all = [
      { segment: 'Residential', accountsInArrears: 38420, arrearsUsd: 21.6e6, over90DaysPct: 27, onPaymentPlanPct: 34 },
      { segment: 'Small Business', accountsInArrears: 4120, arrearsUsd: 6.9e6, over90DaysPct: 31, onPaymentPlanPct: 22 },
      { segment: 'Commercial & Industrial', accountsInArrears: 310, arrearsUsd: 8.4e6, over90DaysPct: 18, onPaymentPlanPct: 12 },
      { segment: 'Community Solar', accountsInArrears: 540, arrearsUsd: 0.3e6, over90DaysPct: 9, onPaymentPlanPct: 41 },
    ];
    return { asOf: TODAY, currency: 'USD', segments: segment ? all.filter((s) => s.segment === segment) : all, note: 'Aggregated; no individual customer records.' };
  },

  getCleanEnergyUptake(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      newEnrolments: { solarNetMetering: 640 * f, evOffPeak: 1180 * f, greenTariff100: 920 * f, smartThermostatRewards: 1510 * f },
      activeTotals: { solarNetMetering: 28400, evOffPeak: 41200, greenTariff100: 63800, smartThermostatRewards: 88900 },
      solarExportMWh: 21400 * f, interconnectionBacklog: 1320,
      shift: 'EV off-peak sign-ups up 22% on the previous period; solar interconnection backlog growing.',
    };
  },

  getMeterReadAccuracy(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { bills: 3.12e6, actualReadPct: 96.4, estimatedPer1k: 36, commsFailuresPer1k: 11.8, rebillsPer1k: 4.1 }, previous: { bills: 3.08e6, actualReadPct: 97.1, estimatedPer1k: 29, commsFailuresPer1k: 9.2, rebillsPer1k: 3.6 } }
      : { current: { bills: 1.05e6, actualReadPct: 95.8, estimatedPer1k: 42, commsFailuresPer1k: 13.5, rebillsPer1k: 4.6 }, previous: { bills: 1.04e6, actualReadPct: 97.0, estimatedPer1k: 30, commsFailuresPer1k: 9.6, rebillsPer1k: 3.7 } };
    return { period, ...p, note: 'Estimated reads up after a firmware issue on one smart-meter batch and the September storm. Aggregated.' };
  },

  getTariffSegmentMargin(_db, { segment }) {
    const all = [
      { segment: 'Residential', customers: 1.21e6, revenueUsd: 1.46e9, wholesaleCostUsd: 0.71e9, networkCostUsd: 0.49e9 },
      { segment: 'Small Business', customers: 142000, revenueUsd: 0.41e9, wholesaleCostUsd: 0.19e9, networkCostUsd: 0.12e9 },
      { segment: 'Commercial & Industrial', customers: 9800, revenueUsd: 0.98e9, wholesaleCostUsd: 0.62e9, networkCostUsd: 0.24e9 },
      { segment: 'Community Solar', customers: 28400, revenueUsd: 0.05e9, wholesaleCostUsd: 0.01e9, networkCostUsd: 0.03e9 },
    ].map((s) => ({ ...s, marginPct: money(((s.revenueUsd - s.wholesaleCostUsd - s.networkCostUsd) / s.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', segments: segment ? all.filter((s) => s.segment === segment) : all };
  },

  runGridLoadForecast(_db, { horizonWeeks = 4 }) {
    const base = { North: 2140, South: 1860, East: 2610, West: 1720 };
    const forecast = Array.from({ length: horizonWeeks }, (_, i) => {
      const weekStarting = addDays('2026-09-28', i * 7);
      const byRegion = REGIONS.map((region) => {
        const peakMW = Math.round(base[region] * (1 - 0.015 * i));
        return { region, peakMW, low: Math.round(peakMW * 0.93), high: Math.round(peakMW * 1.06) };
      });
      return { weekStarting, systemPeakMW: byRegion.reduce((t, x) => t + x.peakMW, 0), byRegion };
    });
    return { horizonWeeks, model: 'weather-adjusted load v3 (demo)', forecast, driver: 'Cooling load easing into autumn; EV charging adds evening peak' };
  },
};

module.exports = { build, handlers, TODAY, SEGMENTS };
