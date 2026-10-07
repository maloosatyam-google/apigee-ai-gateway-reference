// Public Sector handlers and seed data for the industry-apis service (pack: industries/public-sector.json).
//
// A city/state services portal. Story: Jordan Ellis (RES-4101) applied for a home extension
// building permit (PMT-2201) and paid $30 for expedited review, but the review missed its
// 10-day target and the portal charged the $120 plan-review fee twice (PAY-6602). The pothole
// Jordan reported on Maple Avenue (SDR-7701) is also past its repair target. Refunding the $30
// expedited-review fee (PAY-6601) is within policy; refunding the $120 duplicate is over the
// $50 limit that Apigee enforces for Citizen Services. The limit is not enforced here, so the
// gateway control stays visible: this service records whatever refund reaches it (up to the
// amount paid).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const residents = [
    { residentId: 'RES-4101', name: 'Jordan Ellis', email: 'jordan.ellis@example.org', address: '14 Maple Avenue', district: 'Northside', preferredChannel: 'Online', accountSince: '2021-03-14', verified: true },
    { residentId: 'RES-4102', name: 'Maria Santos', email: 'maria.santos@example.org', address: '220 River Road, Apt 5', district: 'Riverside', preferredChannel: 'Phone', accountSince: '2019-07-02', verified: true },
    { residentId: 'RES-4103', name: 'Kofi Mensah', email: 'kofi.mensah@example.org', address: '8 Station Street', district: 'Central', preferredChannel: 'Online', accountSince: '2023-01-19', verified: true },
    { residentId: 'RES-4104', name: 'Linh Tran', email: 'linh.tran@example.org', address: '41 Oak Crescent', district: 'Eastgate', preferredChannel: 'In person', accountSince: '2024-05-08', verified: false },
    { residentId: 'RES-4105', name: 'Jordana Whitfield', email: 'jordana.whitfield@example.org', address: '3 Hill View Close', district: 'Northside', preferredChannel: 'Online', accountSince: '2022-11-30', verified: true },
  ];
  const permits = [
    { applicationId: 'PMT-2201', residentId: 'RES-4101', permitType: 'Building', description: 'Single-storey rear home extension', siteAddress: '14 Maple Avenue', submittedOn: '2026-09-04', track: 'Expedited (10 working days)', stage: 'Plan review', targetDecision: '2026-09-18', missingDocuments: [], reviewerNote: 'Structural calculations under review; expedited target missed because of reviewer backlog.' },
    { applicationId: 'PMT-2202', residentId: 'RES-4101', permitType: 'Dropped kerb', description: 'Dropped kerb for driveway', siteAddress: '14 Maple Avenue', submittedOn: '2026-06-10', track: 'Standard (20 working days)', stage: 'Approved', targetDecision: '2026-07-08', decidedOn: '2026-07-01', missingDocuments: [] },
    { applicationId: 'PMT-2210', residentId: 'RES-4102', permitType: 'Street event', description: 'Block party, River Road (north end)', siteAddress: 'River Road', submittedOn: '2026-09-12', track: 'Standard (20 working days)', stage: 'Consultation', targetDecision: '2026-10-09', missingDocuments: ['Public liability insurance certificate'] },
    { applicationId: 'PMT-2215', residentId: 'RES-4103', permitType: 'Tree works', description: 'Crown reduction of front-garden oak', siteAddress: '8 Station Street', submittedOn: '2026-09-20', track: 'Standard (20 working days)', stage: 'Received', targetDecision: '2026-10-16', missingDocuments: ['Arborist report'] },
  ];
  const licences = [
    { licenceId: 'LIC-3301', holderId: 'RES-4101', holder: 'Jordan Ellis', type: 'Home food business', tradingName: 'Ellis Home Bakery', status: 'Active', issuedOn: '2025-10-15', expiresOn: '2026-10-15', renewalFeeUsd: 85 },
    { licenceId: 'LIC-3302', holderId: 'RES-4103', holder: 'Kofi Mensah', type: 'Mobile food vendor', tradingName: 'Station Street Grill', status: 'Expired', issuedOn: '2025-08-01', expiresOn: '2026-08-01', renewalFeeUsd: 140 },
    { licenceId: 'LIC-3303', holderId: 'RES-4105', holder: 'Jordana Whitfield', type: 'Street trading', tradingName: 'Hill View Flowers', status: 'Suspended', issuedOn: '2026-02-01', expiresOn: '2027-02-01', renewalFeeUsd: 110, note: 'Suspended pending pitch inspection' },
    { licenceId: 'LIC-3304', holderId: 'RES-4102', holder: 'Maria Santos', type: 'Childminder registration', tradingName: 'Riverside Little Steps', status: 'Expired', issuedOn: '2025-03-01', expiresOn: '2026-03-01', renewalFeeUsd: 60 },
  ];
  const claims = [
    { claimId: 'CLM-5501', residentId: 'RES-4101', programme: 'Home Energy Assistance', submittedOn: '2026-09-08', status: 'Awaiting documents', documentsOutstanding: ['Proof of household income (last 3 months)'], awardUsdPerMonth: null, nextPaymentOn: null, decisionDueBy: '2026-10-08' },
    { claimId: 'CLM-5502', residentId: 'RES-4104', programme: 'Childcare Subsidy', submittedOn: '2026-07-21', status: 'Approved', documentsOutstanding: [], awardUsdPerMonth: 420, nextPaymentOn: '2026-10-01' },
    { claimId: 'CLM-5503', residentId: 'RES-4102', programme: 'Housing Assistance', submittedOn: '2026-08-30', status: 'Under assessment', documentsOutstanding: [], awardUsdPerMonth: null, nextPaymentOn: null, decisionDueBy: '2026-10-14' },
    { claimId: 'CLM-5504', residentId: 'RES-4103', programme: 'Senior Transport', submittedOn: '2026-05-02', status: 'Declined', documentsOutstanding: [], awardUsdPerMonth: null, nextPaymentOn: null, reason: 'Applicant under the age threshold' },
  ];
  const defects = [
    { reportId: 'SDR-7701', residentId: 'RES-4101', defectType: 'Pothole', location: 'Maple Avenue, outside no. 14', details: 'Deep pothole in the eastbound lane, cyclists swerving', reportedOn: '2026-09-02', targetDate: '2026-09-16', status: 'Scheduled', crew: 'Roads crew N2', scheduledFor: '2026-09-30' },
    { reportId: 'SDR-7702', residentId: 'RES-4102', defectType: 'Streetlight out', location: 'River Road, lamp post RR-18', details: 'Light out for three nights', reportedOn: '2026-09-19', targetDate: '2026-09-26', status: 'Assigned', crew: 'Lighting crew 1' },
    { reportId: 'SDR-7703', residentId: 'RES-4103', defectType: 'Graffiti', location: 'Station Street underpass', details: 'Offensive graffiti on the north wall', reportedOn: '2026-09-10', targetDate: '2026-09-12', status: 'Completed', crew: 'Cleansing crew C', completedOn: '2026-09-11' },
    { reportId: 'SDR-7704', residentId: 'RES-4104', defectType: 'Blocked drain', location: 'Oak Crescent, corner with Elm Way', details: 'Water pooling after rain', reportedOn: '2026-09-23', targetDate: '2026-10-07', status: 'Received', crew: null },
  ];
  const appointments = [
    { appointmentId: 'APT-9101', residentId: 'RES-4104', service: 'Benefits advice', date: '2026-09-28', time: '10:30', location: 'Civic Centre, Desk 4', status: 'Booked' },
    { appointmentId: 'APT-9102', residentId: 'RES-4102', service: 'Licensing desk', date: '2026-10-02', time: '14:00', location: 'Civic Centre, Desk 2', status: 'Booked' },
  ];
  const payments = [
    { paymentId: 'PAY-6600', residentId: 'RES-4101', description: 'Building permit plan-review fee (PMT-2201)', reference: 'PMT-2201', amount: 120, status: 'Paid', paidOn: '2026-09-04', method: 'Card' },
    { paymentId: 'PAY-6601', residentId: 'RES-4101', description: 'Expedited review fee (PMT-2201), 10-day target missed', reference: 'PMT-2201', amount: 30, status: 'Paid', paidOn: '2026-09-04', method: 'Card' },
    { paymentId: 'PAY-6602', residentId: 'RES-4101', description: 'Building permit plan-review fee (PMT-2201), duplicate charge', reference: 'PMT-2201', amount: 120, status: 'Paid', paidOn: '2026-09-04', method: 'Card', duplicateOf: 'PAY-6600' },
    { paymentId: 'PAY-6603', residentId: 'RES-4101', description: 'Home food business licence fee (LIC-3301)', reference: 'LIC-3301', amount: 85, status: 'Paid', paidOn: '2025-10-15', method: 'Card' },
    { paymentId: 'PAY-6604', residentId: 'RES-4101', description: 'Dropped kerb permit fee (PMT-2202)', reference: 'PMT-2202', amount: 75, status: 'Paid', paidOn: '2026-06-10', method: 'Card' },
    { paymentId: 'PAY-6610', residentId: 'RES-4102', description: 'Street event permit fee (PMT-2210)', reference: 'PMT-2210', amount: 60, status: 'Paid', paidOn: '2026-09-12', method: 'Bank transfer' },
  ].map((p) => ({ ...p, refunds: [] }));
  const referrals = [
    { referralId: 'CWR-8801', residentId: 'RES-4102', subject: 'Housing assistance and rent arrears support', priority: 'Medium', status: 'Assigned', caseworker: 'Case team Riverside', openedOn: '2026-09-15' },
  ];
  return { residents, permits, licences, claims, defects, appointments, payments, referrals };
}

const findResident = (db, id) => {
  const r = db.residents.find((x) => x.residentId === id);
  if (!r) throw new ToolError(404, 'NOT_FOUND', `Resident ${id} not found`);
  return r;
};
const refundable = (p) => money(p.amount - p.refunds.reduce((s, r) => s + r.amount, 0));
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const PROGRAMMES = ['Housing Assistance', 'Home Energy Assistance', 'Childcare Subsidy', 'Senior Transport'];
const PERMIT_FEES = { Building: 120, 'Dropped kerb': 75, 'Street event': 60, 'Tree works': 40, 'Skip on street': 35 };
const PERMIT_DAYS = { Building: 28, 'Dropped kerb': 28, 'Street event': 28, 'Tree works': 21, 'Skip on street': 5 };
const REPAIR_DAYS = { Pothole: 14, 'Streetlight out': 7, Graffiti: 2, 'Blocked drain': 14 };
const DESKS = { 'Permit counter': 'Civic Centre, Desk 1', 'Licensing desk': 'Civic Centre, Desk 2', 'Records & certificates': 'Civic Centre, Desk 3', 'Benefits advice': 'Civic Centre, Desk 4' };

const handlers = {
  searchResidents(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.residents.filter((r) =>
      r.name.toLowerCase().includes(q) || r.residentId.toLowerCase() === q || r.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      residents: hits.map((r) => ({ residentId: r.residentId, name: r.name, email: maskEmail(r.email), district: r.district, verified: r.verified })),
    };
  },

  getResidentAccount(db, { residentId }) {
    const r = findResident(db, residentId);
    const mine = (list) => list.filter((x) => x.residentId === r.residentId);
    return {
      ...r, email: maskEmail(r.email),
      openPermitApplications: mine(db.permits).filter((p) => !['Approved', 'Refused', 'Withdrawn'].includes(p.stage))
        .map((p) => ({ applicationId: p.applicationId, permitType: p.permitType, stage: p.stage, targetDecision: p.targetDecision })),
      benefitClaims: mine(db.claims).map((c) => ({ claimId: c.claimId, programme: c.programme, status: c.status })),
      openStreetDefectReports: mine(db.defects).filter((d) => d.status !== 'Completed')
        .map((d) => ({ reportId: d.reportId, defectType: d.defectType, status: d.status, overdue: d.targetDate < TODAY })),
      licences: db.licences.filter((l) => l.holderId === r.residentId).map((l) => ({ licenceId: l.licenceId, type: l.type, status: l.status, expiresOn: l.expiresOn })),
      upcomingAppointments: mine(db.appointments).filter((a) => a.status === 'Booked' && a.date >= TODAY),
      openReferrals: mine(db.referrals).filter((c) => c.status !== 'Closed'),
    };
  },

  getPermitApplicationStatus(db, { applicationId }) {
    const p = db.permits.find((x) => x.applicationId === applicationId);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `Permit application ${applicationId} not found`);
    const decided = ['Approved', 'Refused', 'Withdrawn'].includes(p.stage);
    return { ...p, pastTarget: !decided && p.targetDecision < TODAY, daysPastTarget: !decided && p.targetDecision < TODAY ? daysBetween(p.targetDecision, TODAY) : 0 };
  },

  submitPermitApplication(db, { residentId, permitType, siteAddress, description = '' }) {
    const r = findResident(db, residentId);
    const open = db.permits.find((p) => p.residentId === r.residentId && p.permitType === permitType && p.siteAddress === siteAddress && !['Approved', 'Refused', 'Withdrawn'].includes(p.stage));
    if (open) throw new ToolError(409, 'DUPLICATE_APPLICATION', `${open.applicationId} is already open for a ${permitType} permit at ${siteAddress}`);
    const p = {
      applicationId: `PMT-${2216 + db.permits.length}`, residentId: r.residentId, permitType, description: String(description).slice(0, 200),
      siteAddress: String(siteAddress).slice(0, 120), submittedOn: TODAY, track: 'Standard', stage: 'Received',
      targetDecision: addDays(TODAY, PERMIT_DAYS[permitType]), missingDocuments: [],
    };
    db.permits.push(p);
    const pay = { paymentId: `PAY-${6620 + db.payments.length}`, residentId: r.residentId, description: `${permitType} permit fee (${p.applicationId})`, reference: p.applicationId, amount: PERMIT_FEES[permitType], status: 'Due', dueOn: addDays(TODAY, 7), refunds: [] };
    db.payments.push(pay);
    return { ...p, feeDue: { paymentId: pay.paymentId, amount: pay.amount, currency: 'USD', dueOn: pay.dueOn } };
  },

  getLicenceDetails(db, { licenceId }) {
    const l = db.licences.find((x) => x.licenceId === licenceId);
    if (!l) throw new ToolError(404, 'NOT_FOUND', `Licence ${licenceId} not found`);
    const daysToExpiry = daysBetween(TODAY, l.expiresOn);
    return { ...l, currency: 'USD', daysToExpiry, renewable: (l.status === 'Active' || l.status === 'Expired') && daysToExpiry > -90 && daysToExpiry <= 60 };
  },

  renewBusinessLicence(db, { licenceId }) {
    const l = db.licences.find((x) => x.licenceId === licenceId);
    if (!l) throw new ToolError(404, 'NOT_FOUND', `Licence ${licenceId} not found`);
    if (l.status === 'Suspended') throw new ToolError(409, 'LICENCE_SUSPENDED', `${licenceId} is suspended; it cannot be renewed until the suspension is lifted`);
    const daysToExpiry = daysBetween(TODAY, l.expiresOn);
    if (daysToExpiry < -90) throw new ToolError(409, 'RENEWAL_WINDOW_CLOSED', `${licenceId} expired more than 90 days ago; a new application is needed`);
    if (daysToExpiry > 60) throw new ToolError(409, 'TOO_EARLY_TO_RENEW', `${licenceId} can be renewed from 60 days before expiry (${addDays(l.expiresOn, -60)})`);
    const from = l.expiresOn > TODAY ? l.expiresOn : TODAY;
    Object.assign(l, { status: 'Active', expiresOn: addDays(from, 365), renewedOn: TODAY });
    const pay = { paymentId: `PAY-${6620 + db.payments.length}`, residentId: l.holderId, description: `${l.type} licence renewal (${l.licenceId})`, reference: l.licenceId, amount: l.renewalFeeUsd, status: 'Due', dueOn: addDays(TODAY, 14), refunds: [] };
    db.payments.push(pay);
    return { licenceId: l.licenceId, tradingName: l.tradingName, status: l.status, newExpiry: l.expiresOn, renewedOn: TODAY, feeDue: { paymentId: pay.paymentId, amount: pay.amount, currency: 'USD', dueOn: pay.dueOn } };
  },

  getBenefitClaimStatus(db, { claimId }) {
    const c = db.claims.find((x) => x.claimId === claimId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Benefit claim ${claimId} not found`);
    return { ...c, currency: 'USD', nextStep: c.documentsOutstanding.length ? `Upload: ${c.documentsOutstanding.join('; ')}` : c.status === 'Approved' ? 'No action needed' : 'Awaiting assessor decision' };
  },

  reportStreetDefect(db, { residentId, defectType, location, details = '' }) {
    const r = findResident(db, residentId);
    const d = {
      reportId: `SDR-${7701 + db.defects.length}`, residentId: r.residentId, defectType, location: String(location).slice(0, 160),
      details: String(details).slice(0, 300), reportedOn: TODAY, targetDate: addDays(TODAY, REPAIR_DAYS[defectType]), status: 'Received', crew: null,
    };
    db.defects.push(d);
    return { ...d, message: `Logged. Target repair within ${REPAIR_DAYS[defectType]} days.` };
  },

  getStreetDefectReport(db, { reportId }) {
    const d = db.defects.find((x) => x.reportId === reportId);
    if (!d) throw new ToolError(404, 'NOT_FOUND', `Street defect report ${reportId} not found`);
    const overdue = d.status !== 'Completed' && d.targetDate < TODAY;
    return { ...d, overdue, daysOverdue: overdue ? daysBetween(d.targetDate, TODAY) : 0 };
  },

  bookServiceAppointment(db, { residentId, service, date }) {
    const r = findResident(db, residentId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new ToolError(400, 'INVALID_ARGUMENT', 'date must be YYYY-MM-DD');
    if (date <= TODAY) throw new ToolError(409, 'DATE_NOT_AVAILABLE', `Appointments can be booked from ${addDays(TODAY, 1)}`);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) throw new ToolError(409, 'DATE_NOT_AVAILABLE', 'The service centre is closed at weekends');
    if (db.appointments.some((a) => a.residentId === r.residentId && a.date === date && a.status === 'Booked')) {
      throw new ToolError(409, 'ALREADY_BOOKED', `${r.residentId} already has an appointment on ${date}`);
    }
    const taken = db.appointments.filter((a) => a.date === date && a.service === service).length;
    const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:30', '14:00', '14:30', '15:00'];
    const a = { appointmentId: `APT-${9101 + db.appointments.length}`, residentId: r.residentId, service, date, time: times[taken % times.length], location: DESKS[service], status: 'Booked' };
    db.appointments.push(a);
    return { ...a, bring: 'Photo ID and any reference numbers for your case' };
  },

  listFeePayments(db, { residentId }) {
    const r = findResident(db, residentId);
    return {
      residentId: r.residentId, currency: 'USD',
      payments: db.payments.filter((p) => p.residentId === r.residentId).map((p) => ({ ...p, refundableRemaining: p.status === 'Paid' ? refundable(p) : 0 })),
    };
  },

  refundPermitFee(db, { paymentId, amount, reason = '' }) {
    const p = db.payments.find((x) => x.paymentId === paymentId);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `Payment ${paymentId} not found`);
    if (p.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${paymentId} is ${p.status}; only paid fees can be refunded`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(p);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_PAYMENT', `Only ${remaining} USD of ${paymentId} can be refunded`);
    const r = {
      refundId: `RF-${paymentId.slice(4)}-${p.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: `3-5 business days to the original ${p.method === 'Card' ? 'card' : 'account'}`,
    };
    p.refunds.push(r);
    return { paymentId, residentId: p.residentId, description: p.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  openCaseworkerReferral(db, { residentId, subject, priority = 'Medium' }) {
    const r = findResident(db, residentId);
    const c = { referralId: `CWR-${8801 + db.referrals.length}`, residentId: r.residentId, subject: String(subject).slice(0, 160), priority, status: 'Open', caseworker: `Case team ${r.district}`, openedOn: TODAY };
    db.referrals.push(c);
    return { ...c, firstContactWithin: priority === 'High' ? '1 business day' : '3 business days' };
  },

  getServiceRequestVolumes(_db, { months = 6 }) {
    const series = [
      ['2025-10', 3820, 1210, 2940, 5120], ['2025-11', 3410, 1080, 3120, 5890], ['2025-12', 2760, 940, 3460, 6420],
      ['2026-01', 3050, 1720, 3880, 7110], ['2026-02', 3290, 1490, 3610, 6680], ['2026-03', 4180, 1360, 3240, 5240],
      ['2026-04', 4720, 1290, 2980, 4610], ['2026-05', 5140, 1340, 2870, 4330], ['2026-06', 5380, 1410, 2790, 4120],
      ['2026-07', 5210, 1260, 2860, 3980], ['2026-08', 4960, 1190, 3010, 4240], ['2026-09', 5470, 1330, 3390, 4870],
    ].slice(-months).map(([month, permits, licences, benefits, streetDefects]) => ({ month, permits, licences, benefits, streetDefects, total: permits + licences + benefits + streetDefects }));
    return {
      months: series.length, series,
      byChannel: [{ channel: 'Online portal', share: 0.64 }, { channel: 'Phone', share: 0.22 }, { channel: 'In person', share: 0.09 }, { channel: 'Email', share: 0.05 }],
      trend: 'Permit requests up 43% since March (building season); benefit requests rising ahead of winter.',
    };
  },

  getPermitProcessingTimes(_db, { period = 'last_30d' }) {
    const rows = period === 'last_90d'
      ? [['Building', 24, 41, 71, 78], ['Dropped kerb', 17, 26, 88, 90], ['Street event', 19, 27, 84, 85], ['Tree works', 14, 22, 90, 91], ['Skip on street', 3, 5, 94, 95]]
      : [['Building', 27, 46, 62, 76], ['Dropped kerb', 16, 25, 89, 88], ['Street event', 18, 26, 86, 84], ['Tree works', 13, 21, 91, 90], ['Skip on street', 3, 4, 96, 94]];
    return {
      period, currency: 'USD',
      permitTypes: rows.map(([permitType, medianDays, p90Days, withinTargetPct, previousWithinTargetPct]) => ({ permitType, medianDays, p90Days, withinTargetPct, previousWithinTargetPct })),
      expeditedWithinTargetPct: period === 'last_90d' ? 68 : 54,
      note: 'Building plan-review backlog: expedited reviews meeting the 10-day target fell to 54% this month.',
    };
  },

  getBenefitUptakeRates(_db, { programme }) {
    const all = [
      { programme: 'Housing Assistance', estimatedEligibleHouseholds: 18400, activeClaims: 13250 },
      { programme: 'Home Energy Assistance', estimatedEligibleHouseholds: 26100, activeClaims: 14880 },
      { programme: 'Childcare Subsidy', estimatedEligibleHouseholds: 9700, activeClaims: 7470 },
      { programme: 'Senior Transport', estimatedEligibleHouseholds: 12300, activeClaims: 10210 },
    ].map((p) => ({ ...p, uptakePct: money((p.activeClaims / p.estimatedEligibleHouseholds) * 100) }));
    return {
      asOf: TODAY, programmes: programme ? all.filter((p) => p.programme === programme) : all,
      topBarriers: ['Proof-of-income documents', 'Unaware of eligibility', 'Online form abandonment at step 4'],
      note: 'Aggregated; no individual resident records.',
    };
  },

  getChannelShiftMetrics(_db, { period = 'last_30d' }) {
    const cur = period === 'last_90d' ? { online: 63, phone: 23, inPerson: 10, email: 4 } : { online: 66, phone: 21, inPerson: 9, email: 4 };
    const prev = period === 'last_90d' ? { online: 57, phone: 27, inPerson: 12, email: 4 } : { online: 61, phone: 24, inPerson: 11, email: 4 };
    return {
      period, currency: 'USD', sharePct: cur, previousSharePct: prev,
      costPerTransactionUsd: { online: 0.42, phone: 4.8, inPerson: 11.6, email: 3.1 },
      digitalCompletionPct: 81, assistedDigitalSessions: period === 'last_90d' ? 2140 : 760,
      shift: 'Online share up 5 pts; phone volume down after the permit tracker launched.',
    };
  },

  getStreetRepairBacklog(_db, { defectType }) {
    const all = [
      { defectType: 'Pothole', open: 612, pastTargetPct: 34, medianAgeDays: 11, worstDistrict: 'Northside' },
      { defectType: 'Streetlight out', open: 188, pastTargetPct: 18, medianAgeDays: 5, worstDistrict: 'Riverside' },
      { defectType: 'Graffiti', open: 94, pastTargetPct: 9, medianAgeDays: 2, worstDistrict: 'Central' },
      { defectType: 'Blocked drain', open: 141, pastTargetPct: 22, medianAgeDays: 8, worstDistrict: 'Eastgate' },
    ];
    return { asOf: TODAY, defectTypes: defectType ? all.filter((d) => d.defectType === defectType) : all, note: 'Northside pothole backlog driven by a crew shortage since August.' };
  },

  getResidentSatisfactionScores(_db, { period = 'last_30d' }) {
    const rows = [
      ['Permits', 3.6, 3.9, 4.1], ['Licensing', 4.2, 4.2, 1.2], ['Benefits', 3.8, 3.7, 2.6],
      ['Street services', 3.3, 3.6, 5.4], ['Appointments', 4.5, 4.4, 0.8],
    ].map(([service, csat, previousCsat, complaintsPer1k]) => ({ service, csatOutOf5: csat, previousCsatOutOf5: previousCsat, complaintsPer1k }));
    return { period, responses: period === 'last_90d' ? 11840 : 4120, services: rows, note: 'Permits and street services down: late expedited reviews and overdue pothole repairs. Aggregated, no resident records.' };
  },

  getProgrammeCostBreakdown(_db, { programme }) {
    const all = [
      { programme: 'Housing Assistance', cases: 13250, budgetUsd: 96.0e6, spendToDateUsd: 71.4e6, adminCostUsd: 6.2e6 },
      { programme: 'Home Energy Assistance', cases: 14880, budgetUsd: 22.5e6, spendToDateUsd: 13.9e6, adminCostUsd: 2.4e6 },
      { programme: 'Childcare Subsidy', cases: 7470, budgetUsd: 41.0e6, spendToDateUsd: 33.8e6, adminCostUsd: 2.9e6 },
      { programme: 'Senior Transport', cases: 10210, budgetUsd: 8.6e6, spendToDateUsd: 6.1e6, adminCostUsd: 1.1e6 },
    ].map((p) => ({ ...p, costPerCaseUsd: money((p.spendToDateUsd + p.adminCostUsd) / p.cases), budgetUsedPct: money((p.spendToDateUsd / p.budgetUsd) * 100), adminSharePct: money((p.adminCostUsd / (p.spendToDateUsd + p.adminCostUsd)) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD (9 months)', programmes: programme ? all.filter((p) => p.programme === programme) : all };
  },

  runCaseloadForecast(_db, { horizonMonths = 3 }) {
    const base = { 'Housing Assistance': 13250, 'Home Energy Assistance': 14880, 'Childcare Subsidy': 7470, 'Senior Transport': 10210 };
    const growth = { 'Housing Assistance': 0.012, 'Home Energy Assistance': 0.06, 'Childcare Subsidy': 0.008, 'Senior Transport': 0.004 };
    const forecast = Array.from({ length: horizonMonths }, (_, i) => {
      const month = addDays('2026-10-01', 31 * i).slice(0, 7);
      const byProgramme = PROGRAMMES.map((p) => {
        const expected = Math.round(base[p] * (1 + growth[p] * (i + 1)));
        return { programme: p, expected, low: Math.round(expected * 0.93), high: Math.round(expected * 1.08) };
      });
      return { month, total: byProgramme.reduce((t, x) => t + x.expected, 0), byProgramme };
    });
    return { horizonMonths, model: 'caseload-flow v3 (demo)', forecast, driver: 'Winter heating season lifts Home Energy Assistance claims' };
  },
};

module.exports = { build, handlers, TODAY };
