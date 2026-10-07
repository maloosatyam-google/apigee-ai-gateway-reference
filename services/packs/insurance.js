// Insurance handlers and seed data for the industry-apis service (pack: industries/insurance.json).
//
// A personal lines (auto, home, renters) insurer. Story: Jamie Carter (CUS-4101) filed a
// hail-damage claim (CLM-7301) on the auto policy POL-88120, but it is stuck awaiting photos
// because the claims-portal upload failed (case CASE-5001). An autopay outage added a $30
// late-payment fee (BILL-6101) and then charged the September premium twice (BILL-6102, $120).
// Refunding the $30 fee is within policy; refunding the $120 duplicate is over the $50 limit
// that Apigee enforces for Claims & Service. The limit is not enforced here, so the gateway
// control stays visible: this service records whatever refund reaches it (up to the amount paid).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const policyholders = [
    { customerId: 'CUS-4101', name: 'Jamie Carter', email: 'jamie.carter@example.com', state: 'CO', customerSince: '2021-11-01', autopay: true, status: 'Active' },
    { customerId: 'CUS-4102', name: 'Morgan Ellis', email: 'morgan.ellis@example.com', state: 'TX', customerSince: '2018-04-15', autopay: true, status: 'Active' },
    { customerId: 'CUS-4103', name: 'Avery Brooks', email: 'avery.brooks@example.com', state: 'GA', customerSince: '2024-02-20', autopay: false, status: 'Active' },
    { customerId: 'CUS-4104', name: 'Riley Kim', email: 'riley.kim@example.com', state: 'CA', customerSince: '2019-07-08', autopay: true, status: 'Active' },
    { customerId: 'CUS-4105', name: 'Jamie Moreno', email: 'jamie.moreno@example.com', state: 'AZ', customerSince: '2026-06-03', autopay: false, status: 'Lapsed' },
  ];
  const policies = [
    {
      policyId: 'POL-88120', customerId: 'CUS-4101', line: 'Auto', status: 'Active', termStart: '2026-05-01', termEnd: '2026-11-01', monthlyPremium: 120,
      risk: '2022 compact SUV, garaged in Denver, CO', drivers: [{ name: 'Jamie Carter', yearsLicensed: 14 }],
      coverages: [
        { coverage: 'Bodily injury liability', limit: '$100,000 / $300,000', deductible: null },
        { coverage: 'Property damage liability', limit: '$100,000', deductible: null },
        { coverage: 'Collision', limit: 'Actual cash value', deductible: 1000 },
        { coverage: 'Comprehensive (hail, theft, glass, fire)', limit: 'Actual cash value', deductible: 500 },
        { coverage: 'Rental reimbursement', limit: '$40/day, 30 days', deductible: null },
      ],
      endorsements: ['Roadside assistance', 'Full glass (no deductible for windshield repair)'], exclusions: ['Rideshare driving', 'Racing'],
    },
    {
      policyId: 'POL-88121', customerId: 'CUS-4101', line: 'Renters', status: 'Active', termStart: '2026-01-15', termEnd: '2027-01-15', monthlyPremium: 18,
      risk: 'Apartment, Denver, CO',
      coverages: [
        { coverage: 'Personal property', limit: '$30,000', deductible: 250 },
        { coverage: 'Personal liability', limit: '$300,000', deductible: null },
        { coverage: 'Loss of use', limit: '$9,000', deductible: null },
      ],
      endorsements: ['Replacement cost on contents'], exclusions: ['Flood', 'Earthquake'],
    },
    {
      policyId: 'POL-88130', customerId: 'CUS-4102', line: 'Home', status: 'Active', termStart: '2026-04-01', termEnd: '2027-04-01', monthlyPremium: 214,
      risk: 'Single-family home, Austin, TX',
      coverages: [
        { coverage: 'Dwelling', limit: '$420,000', deductible: 2500 },
        { coverage: 'Personal property', limit: '$210,000', deductible: 2500 },
        { coverage: 'Personal liability', limit: '$300,000', deductible: null },
      ],
      endorsements: ['Water backup $10,000'], exclusions: ['Flood', 'Wear and tear'],
    },
    {
      policyId: 'POL-88140', customerId: 'CUS-4103', line: 'Auto', status: 'Active', termStart: '2026-08-20', termEnd: '2027-02-20', monthlyPremium: 164,
      risk: '2019 sedan, Atlanta, GA', drivers: [{ name: 'Avery Brooks', yearsLicensed: 6 }],
      coverages: [
        { coverage: 'Bodily injury liability', limit: '$50,000 / $100,000', deductible: null },
        { coverage: 'Collision', limit: 'Actual cash value', deductible: 500 },
        { coverage: 'Comprehensive (hail, theft, glass, fire)', limit: 'Actual cash value', deductible: 500 },
      ],
      endorsements: [], exclusions: ['Rideshare driving'],
    },
    {
      policyId: 'POL-88150', customerId: 'CUS-4104', line: 'Home', status: 'Active', termStart: '2026-07-08', termEnd: '2027-07-08', monthlyPremium: 298,
      risk: 'Single-family home, Sacramento, CA',
      coverages: [
        { coverage: 'Dwelling', limit: '$610,000', deductible: 5000 },
        { coverage: 'Personal liability', limit: '$500,000', deductible: null },
      ],
      endorsements: ['Wildfire defensible-space credit'], exclusions: ['Flood', 'Earthquake'],
    },
    {
      policyId: 'POL-88160', customerId: 'CUS-4105', line: 'Auto', status: 'Lapsed', termStart: '2026-06-03', termEnd: '2026-12-03', monthlyPremium: 139,
      risk: '2017 pickup, Phoenix, AZ', drivers: [{ name: 'Jamie Moreno', yearsLicensed: 9 }],
      coverages: [{ coverage: 'Bodily injury liability', limit: '$25,000 / $50,000', deductible: null }],
      endorsements: [], exclusions: [], lapsedOn: '2026-09-03', lapseReason: 'Non-payment',
    },
  ];
  const claims = [
    {
      claimId: 'CLM-7301', policyId: 'POL-88120', customerId: 'CUS-4101', lossType: 'Hail', incidentDate: '2026-09-16', reportedOn: '2026-09-18',
      stage: 'Awaiting inspection', adjuster: 'Dana Whitfield', coverage: 'Comprehensive', deductible: 500, estimateUsd: 2850,
      outstanding: ['Damage photos (portal upload failed on 2026-09-19, see CASE-5001)', 'Adjuster inspection'], payments: [], inspection: null,
    },
    {
      claimId: 'CLM-7290', policyId: 'POL-88121', customerId: 'CUS-4101', lossType: 'Theft', incidentDate: '2026-03-04', reportedOn: '2026-03-05',
      stage: 'Closed - paid', adjuster: 'Leo Grant', coverage: 'Personal property', deductible: 250, estimateUsd: 1100,
      outstanding: [], payments: [{ paymentId: 'CP-7290-1', amount: 850, paidOn: '2026-03-19' }], inspection: null,
    },
    {
      claimId: 'CLM-7310', policyId: 'POL-88130', customerId: 'CUS-4102', lossType: 'Water damage', incidentDate: '2026-09-10', reportedOn: '2026-09-11',
      stage: 'Estimate approved', adjuster: 'Dana Whitfield', coverage: 'Dwelling', deductible: 2500, estimateUsd: 9400,
      outstanding: ['Contractor invoice'], payments: [{ paymentId: 'CP-7310-1', amount: 4000, paidOn: '2026-09-22' }], inspection: { date: '2026-09-14', timeWindow: 'Morning', status: 'Completed' },
    },
    {
      claimId: 'CLM-7315', policyId: 'POL-88140', customerId: 'CUS-4103', lossType: 'Collision', incidentDate: '2026-09-21', reportedOn: '2026-09-21',
      stage: 'Under review', adjuster: 'Leo Grant', coverage: 'Collision', deductible: 500, estimateUsd: null,
      outstanding: ['Police report', 'Repair estimate'], payments: [], inspection: null,
    },
  ];
  const bills = [
    { billId: 'BILL-6099', customerId: 'CUS-4101', policyId: 'POL-88120', description: 'Auto premium, August', amount: 120, status: 'Paid', paidOn: '2026-08-01' },
    { billId: 'BILL-6100', customerId: 'CUS-4101', policyId: 'POL-88120', description: 'Auto premium, September', amount: 120, status: 'Paid', paidOn: '2026-09-08', note: 'Autopay retried after the 2026-09-01 outage' },
    { billId: 'BILL-6101', customerId: 'CUS-4101', policyId: 'POL-88120', description: 'Late-payment fee (autopay outage)', amount: 30, status: 'Paid', paidOn: '2026-09-08' },
    { billId: 'BILL-6102', customerId: 'CUS-4101', policyId: 'POL-88120', description: 'Auto premium, September, duplicate charge', amount: 120, status: 'Paid', paidOn: '2026-09-09', duplicateOf: 'BILL-6100' },
    { billId: 'BILL-6103', customerId: 'CUS-4101', policyId: 'POL-88121', description: 'Renters premium, September', amount: 18, status: 'Paid', paidOn: '2026-09-15' },
    { billId: 'BILL-6104', customerId: 'CUS-4101', policyId: 'POL-88120', description: 'Auto premium, October', amount: 120, status: 'Due', dueOn: '2026-10-01' },
    { billId: 'BILL-6110', customerId: 'CUS-4102', policyId: 'POL-88130', description: 'Home premium, September', amount: 214, status: 'Paid', paidOn: '2026-09-01' },
    { billId: 'BILL-6120', customerId: 'CUS-4103', policyId: 'POL-88140', description: 'Auto premium, September', amount: 164, status: 'Paid', paidOn: '2026-09-20' },
  ].map((b) => ({ ...b, refunds: [] }));
  const cases = [
    { caseId: 'CASE-5001', customerId: 'CUS-4101', subject: 'Claim photo upload fails with error 500 (CLM-7301)', priority: 'High', status: 'Open', openedOn: '2026-09-19' },
    { caseId: 'CASE-5002', customerId: 'CUS-4102', subject: 'Update mortgagee on home policy', priority: 'Low', status: 'Closed', openedOn: '2026-08-02' },
  ];
  const renewals = [
    { policyId: 'POL-88120', renewalDate: '2026-11-01', currentMonthly: 120, renewalMonthly: 131, changes: ['Regional hail rate increase (+6%)', 'Vehicle age discount (-2%)', 'Claims-free discount kept: CLM-7301 is a comprehensive (not at-fault) claim'], offerExpires: '2026-10-25' },
    { policyId: 'POL-88121', renewalDate: '2027-01-15', currentMonthly: 18, renewalMonthly: 19, changes: ['Contents inflation adjustment (+4%)'], offerExpires: '2027-01-05' },
    { policyId: 'POL-88130', renewalDate: '2027-04-01', currentMonthly: 214, renewalMonthly: null, changes: [], note: 'Renewal offers are issued 45 days before the renewal date.' },
    { policyId: 'POL-88140', renewalDate: '2027-02-20', currentMonthly: 164, renewalMonthly: null, changes: [], note: 'Renewal offers are issued 45 days before the renewal date.' },
    { policyId: 'POL-88150', renewalDate: '2027-07-08', currentMonthly: 298, renewalMonthly: null, changes: [], note: 'Renewal offers are issued 45 days before the renewal date.' },
  ];
  const idCards = [];
  return { policyholders, policies, claims, bills, cases, renewals, idCards };
}

const findHolder = (db, id) => {
  const c = db.policyholders.find((x) => x.customerId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Customer ${id} not found`);
  return c;
};
const findPolicy = (db, id) => {
  const p = db.policies.find((x) => x.policyId === id);
  if (!p) throw new ToolError(404, 'NOT_FOUND', `Policy ${id} not found`);
  return p;
};
const findClaim = (db, id) => {
  const c = db.claims.find((x) => x.claimId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Claim ${id} not found`);
  return c;
};
const refundable = (b) => money(b.amount - b.refunds.reduce((s, r) => s + r.amount, 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isOpenClaim = (c) => !c.stage.startsWith('Closed');
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const LINES = ['Auto', 'Home', 'Renters', 'Umbrella'];

const handlers = {
  searchPolicyholders(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.policyholders.filter((c) =>
      c.name.toLowerCase().includes(q) || c.customerId.toLowerCase() === q || c.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      policyholders: hits.map((c) => ({ customerId: c.customerId, name: c.name, email: maskEmail(c.email), state: c.state, status: c.status })),
    };
  },

  getPolicyholderProfile(db, { customerId }) {
    const c = findHolder(db, customerId);
    const pols = db.policies.filter((p) => p.customerId === c.customerId);
    const due = db.bills.filter((b) => b.customerId === c.customerId && b.status === 'Due').reduce((t, b) => t + b.amount, 0);
    return {
      ...c, email: maskEmail(c.email),
      policiesInForce: pols.filter((p) => p.status === 'Active').map((p) => ({ policyId: p.policyId, line: p.line, monthlyPremium: p.monthlyPremium })),
      openClaims: db.claims.filter((x) => x.customerId === c.customerId && isOpenClaim(x)).map((x) => ({ claimId: x.claimId, lossType: x.lossType, stage: x.stage })),
      balanceDueUsd: money(due),
      openCases: db.cases.filter((x) => x.customerId === c.customerId && x.status === 'Open'),
    };
  },

  listPolicies(db, { customerId }) {
    const c = findHolder(db, customerId);
    return {
      customerId: c.customerId, currency: 'USD',
      policies: db.policies.filter((p) => p.customerId === c.customerId).map(({ coverages, endorsements, exclusions, ...p }) => p),
    };
  },

  getPolicyCoverage(db, { policyId }) {
    const p = findPolicy(db, policyId);
    return { policyId: p.policyId, line: p.line, status: p.status, risk: p.risk, currency: 'USD', coverages: p.coverages, endorsements: p.endorsements, exclusions: p.exclusions };
  },

  getClaimStatus(db, { claimId }) {
    const c = findClaim(db, claimId);
    const paid = c.payments.reduce((t, x) => t + x.amount, 0);
    return {
      ...c, currency: 'USD', paidToDateUsd: money(paid),
      expectedPayoutUsd: c.estimateUsd ? money(Math.max(0, c.estimateUsd - c.deductible)) : null,
    };
  },

  fileInsuranceClaim(db, { policyId, lossType, incidentDate, description = '' }) {
    const p = findPolicy(db, policyId);
    if (p.status !== 'Active') throw new ToolError(409, 'POLICY_NOT_ACTIVE', `${policyId} is ${p.status}; claims need an active policy`);
    if (!isDate(incidentDate)) throw new ToolError(400, 'INVALID_ARGUMENT', 'incidentDate must be YYYY-MM-DD');
    if (incidentDate > TODAY) throw new ToolError(400, 'INVALID_ARGUMENT', 'incidentDate cannot be in the future');
    if (incidentDate < p.termStart) throw new ToolError(409, 'OUTSIDE_POLICY_TERM', `${policyId} started on ${p.termStart}`);
    const autoOnly = ['Collision', 'Glass'];
    if (autoOnly.includes(lossType) && p.line !== 'Auto') throw new ToolError(409, 'NOT_COVERED', `${lossType} claims need an auto policy`);
    const glassFree = lossType === 'Glass' && p.endorsements.some((e) => e.startsWith('Full glass'));
    const cov = p.coverages.find((x) => (lossType === 'Collision' ? x.coverage === 'Collision' : x.coverage.startsWith('Comprehensive') || x.coverage === 'Dwelling' || x.coverage === 'Personal property'));
    const claim = {
      claimId: `CLM-${7301 + db.claims.length + 20}`, policyId: p.policyId, customerId: p.customerId, lossType, incidentDate, reportedOn: TODAY,
      stage: 'Reported', adjuster: 'Unassigned', coverage: cov ? cov.coverage : 'To be determined', deductible: glassFree ? 0 : (cov?.deductible ?? 0),
      estimateUsd: null, outstanding: ['Damage photos', lossType === 'Theft' ? 'Police report' : 'Repair estimate'], payments: [], inspection: null,
      description: String(description).slice(0, 300),
    };
    db.claims.push(claim);
    return { ...claim, nextStep: 'An adjuster will contact the policyholder within 1 business day.' };
  },

  scheduleAdjusterInspection(db, { claimId, preferredDate, timeWindow = 'Morning' }) {
    const c = findClaim(db, claimId);
    if (!isOpenClaim(c)) throw new ToolError(409, 'CLAIM_CLOSED', `${claimId} is ${c.stage}`);
    if (!isDate(preferredDate)) throw new ToolError(400, 'INVALID_ARGUMENT', 'preferredDate must be YYYY-MM-DD');
    if (preferredDate < TODAY) throw new ToolError(400, 'INVALID_ARGUMENT', 'preferredDate must be today or later');
    if (preferredDate > addDays(TODAY, 30)) throw new ToolError(409, 'NO_AVAILABILITY', 'Inspections can be booked up to 30 days ahead');
    const day = new Date(`${preferredDate}T00:00:00Z`).getUTCDay();
    const date = day === 0 ? addDays(preferredDate, 1) : day === 6 ? addDays(preferredDate, 2) : preferredDate;
    c.inspection = { inspectionId: `INSP-${claimId.slice(4)}`, date, timeWindow, status: 'Booked', adjuster: c.adjuster, bookedOn: TODAY };
    c.stage = 'Inspection booked';
    c.outstanding = c.outstanding.filter((o) => o !== 'Adjuster inspection');
    return { claimId, ...c.inspection, note: date !== preferredDate ? 'No weekend inspections; moved to the next business day.' : 'The adjuster can take the damage photos on site.' };
  },

  addPolicyDriver(db, { policyId, driverName, yearsLicensed }) {
    const p = findPolicy(db, policyId);
    if (p.line !== 'Auto') throw new ToolError(409, 'NOT_AUTO_POLICY', `${policyId} is a ${p.line} policy; drivers can only be added to auto policies`);
    if (p.status !== 'Active') throw new ToolError(409, 'POLICY_NOT_ACTIVE', `${policyId} is ${p.status}`);
    const name = String(driverName).trim();
    if (p.drivers.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw new ToolError(409, 'ALREADY_LISTED', `${name} is already a driver on ${policyId}`);
    const surcharge = yearsLicensed < 3 ? 48 : yearsLicensed < 5 ? 29 : 14;
    const before = p.monthlyPremium;
    p.drivers.push({ name, yearsLicensed });
    p.monthlyPremium = money(before + surcharge);
    return { policyId, endorsementId: `END-${policyId.slice(4)}-${p.drivers.length}`, effective: TODAY, drivers: p.drivers, monthlyPremiumBefore: before, monthlyPremiumAfter: p.monthlyPremium, currency: 'USD' };
  },

  listPremiumBills(db, { customerId }) {
    const c = findHolder(db, customerId);
    return {
      customerId: c.customerId, currency: 'USD',
      bills: db.bills.filter((b) => b.customerId === c.customerId).map((b) => ({ ...b, refundableRemaining: b.status === 'Paid' ? refundable(b) : 0 })),
    };
  },

  issuePremiumRefund(db, { billId, amount, reason = '' }) {
    const b = db.bills.find((x) => x.billId === billId);
    if (!b) throw new ToolError(404, 'NOT_FOUND', `Bill ${billId} not found`);
    if (b.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${billId} is ${b.status}; only paid bills can be refunded`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(b);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_BILL', `Only ${remaining} USD of ${billId} can be refunded`);
    const r = {
      refundId: `RF-${billId.slice(5)}-${b.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: '3-5 business days to the original payment method',
    };
    b.refunds.push(r);
    return { billId, customerId: b.customerId, description: b.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  openServiceCase(db, { customerId, subject, priority = 'Medium' }) {
    const c = findHolder(db, customerId);
    const k = { caseId: `CASE-${5001 + db.cases.length}`, customerId: c.customerId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.cases.push(k);
    return { ...k, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  issueProofOfInsurance(db, { policyId }) {
    const p = findPolicy(db, policyId);
    if (p.line !== 'Auto') throw new ToolError(409, 'NOT_AUTO_POLICY', `${policyId} is a ${p.line} policy; ID cards are for auto policies`);
    if (p.status !== 'Active') throw new ToolError(409, 'POLICY_NOT_ACTIVE', `${policyId} is ${p.status}; no proof of insurance can be issued`);
    const card = {
      cardId: `IDC-${policyId.slice(4)}-${db.idCards.length + 1}`, policyId, insured: db.policyholders.find((c) => c.customerId === p.customerId)?.name,
      vehicle: p.risk, drivers: p.drivers.map((d) => d.name), validFrom: TODAY, validTo: p.termEnd, issuedOn: TODAY, delivery: 'Mobile wallet and email',
    };
    db.idCards.push(card);
    return card;
  },

  getRenewalQuote(db, { policyId }) {
    const p = findPolicy(db, policyId);
    if (p.status !== 'Active') throw new ToolError(409, 'POLICY_NOT_ACTIVE', `${policyId} is ${p.status}; it will not renew`);
    const r = db.renewals.find((x) => x.policyId === p.policyId);
    if (!r) throw new ToolError(404, 'NOT_FOUND', `No renewal offer for ${policyId}`);
    return {
      policyId: p.policyId, line: p.line, currency: 'USD', ...r,
      changePct: r.renewalMonthly ? money(((r.renewalMonthly - r.currentMonthly) / r.currentMonthly) * 100) : null,
    };
  },

  getClaimsFrequencyTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 5.1, 1.9, 0.8], ['2025-11', 5.4, 2.1, 0.8], ['2025-12', 6.2, 2.6, 0.9],
      ['2026-01', 6.0, 2.9, 0.9], ['2026-02', 5.6, 2.4, 0.8], ['2026-03', 5.2, 2.2, 0.9],
      ['2026-04', 5.5, 3.1, 0.8], ['2026-05', 6.1, 4.0, 0.9], ['2026-06', 6.4, 4.4, 0.8],
      ['2026-07', 5.9, 3.2, 0.9], ['2026-08', 5.8, 2.8, 0.8], ['2026-09', 7.3, 3.9, 0.9],
    ].slice(-months).map(([month, auto, home, renters]) => ({ month, claimsPer1kPolicies: { Auto: auto, Home: home, Renters: renters } }));
    return {
      months: series.length, series, policiesInForce: 1284000,
      trend: 'September auto frequency up 26% on hail in the Central and Mountain regions; home spikes each spring storm season.',
    };
  },

  getLossRatioSummary(_db, { period = 'last_30d' }) {
    const rows = (period === 'last_90d'
      ? [['Auto', 402e6, 291e6, 0.69], ['Home', 318e6, 221e6, 0.74], ['Renters', 21e6, 9.8e6, 0.45], ['Umbrella', 14e6, 5.1e6, 0.41]]
      : [['Auto', 136e6, 108e6, 0.70], ['Home', 107e6, 68e6, 0.71], ['Renters', 7.1e6, 3.2e6, 0.46], ['Umbrella', 4.7e6, 1.5e6, 0.38]]
    ).map(([line, earnedPremiumUsd, incurredLossesUsd, previous]) => ({
      line, earnedPremiumUsd, incurredLossesUsd, lossRatioPct: money((incurredLossesUsd / earnedPremiumUsd) * 100), previousPct: money(previous * 100),
    }));
    return { period, currency: 'USD', lines: rows, note: period === 'last_90d' ? '90-day view includes the June hail events.' : 'Auto loss ratio up on September hail claims.' };
  },

  getPolicyRetentionMetrics(_db, { line }) {
    const all = [
      { line: 'Auto', retentionPct: 86.4, previousPct: 87.9, lapsesPer1k: 11.2, topReasons: ['Price increase at renewal', 'Non-payment', 'Vehicle sold'] },
      { line: 'Home', retentionPct: 90.8, previousPct: 91.2, lapsesPer1k: 6.4, topReasons: ['Home sold', 'Price increase at renewal'] },
      { line: 'Renters', retentionPct: 78.1, previousPct: 77.5, lapsesPer1k: 18.9, topReasons: ['Moved', 'Non-payment'] },
      { line: 'Umbrella', retentionPct: 93.5, previousPct: 93.0, lapsesPer1k: 3.1, topReasons: ['Underlying policy cancelled'] },
    ];
    return { asOf: TODAY, lines: line ? all.filter((l) => l.line === line) : all, note: 'Aggregated; no individual policyholder records.' };
  },

  getCatastropheExposure(_db, { region }) {
    const all = [
      { region: 'Central', policies: 402000, insuredValueUsd: 61.2e9, perils: { hail: 'High', wind: 'High', wildfire: 'Low', flood: 'Medium' }, openCatClaims: 3120 },
      { region: 'Mountain', policies: 188000, insuredValueUsd: 29.4e9, perils: { hail: 'High', wind: 'Medium', wildfire: 'High', flood: 'Low' }, openCatClaims: 1840 },
      { region: 'Southeast', policies: 371000, insuredValueUsd: 54.8e9, perils: { hail: 'Medium', wind: 'High', wildfire: 'Low', flood: 'High' }, openCatClaims: 620 },
      { region: 'West', policies: 323000, insuredValueUsd: 71.5e9, perils: { hail: 'Low', wind: 'Low', wildfire: 'High', flood: 'Low' }, openCatClaims: 210 },
    ];
    return { asOf: TODAY, currency: 'USD', regions: region ? all.filter((r) => r.region === region) : all, note: 'Mid-September hail event (CAT-2609) drives open claims in Central and Mountain.' };
  },

  getClaimsCycleTimes(_db, { period = 'last_30d' }) {
    const rows = [
      ['Auto', 3.8, 6.1, 11.4, 9.9], ['Home', 5.2, 9.7, 24.6, 22.1], ['Renters', 2.1, 3.4, 8.2, 8.5],
    ].map(([line, daysToInspection, daysToEstimate, daysToPayment, previousDaysToPayment]) => ({ line, daysToInspection, daysToEstimate, daysToPayment, previousDaysToPayment }));
    return {
      period, lines: rows, photoUploadFailureRatePct: period === 'last_90d' ? 1.9 : 4.6,
      note: 'Auto days-to-payment up 1.5 days: hail volume plus claims-portal photo upload failures.',
    };
  },

  getFraudReferralMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { claimsClosed: 51200, siuReferrals: 1330, confirmedFraudPct: 21.4, savingsUsd: 7.9e6 }, previous: { claimsClosed: 48900, siuReferrals: 1190, confirmedFraudPct: 20.1, savingsUsd: 6.8e6 } }
      : { current: { claimsClosed: 18400, siuReferrals: 512, confirmedFraudPct: 22.7, savingsUsd: 3.1e6 }, previous: { claimsClosed: 16100, siuReferrals: 402, confirmedFraudPct: 19.8, savingsUsd: 2.2e6 } };
    return { period, currency: 'USD', ...p, topPatterns: ['Staged hail damage on older vehicles', 'Inflated contractor invoices'], note: 'Aggregated; no claim-level records.' };
  },

  getUnderwritingProfitability(_db, { line }) {
    const all = [
      { line: 'Auto', earnedPremiumUsd: 1.62e9, incurredLossesUsd: 1.13e9, expensesUsd: 0.41e9 },
      { line: 'Home', earnedPremiumUsd: 1.27e9, incurredLossesUsd: 0.93e9, expensesUsd: 0.33e9 },
      { line: 'Renters', earnedPremiumUsd: 0.084e9, incurredLossesUsd: 0.038e9, expensesUsd: 0.029e9 },
      { line: 'Umbrella', earnedPremiumUsd: 0.056e9, incurredLossesUsd: 0.022e9, expensesUsd: 0.014e9 },
    ].map((l) => {
      const combined = ((l.incurredLossesUsd + l.expensesUsd) / l.earnedPremiumUsd) * 100;
      return { ...l, combinedRatioPct: money(combined), underwritingMarginPct: money(100 - combined) };
    });
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', lines: line ? all.filter((l) => l.line === line) : all };
  },

  runLossReserveForecast(_db, { horizonQuarters = 2 }) {
    const quarters = ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4', '2028-Q1', '2028-Q2', '2028-Q3'].slice(0, horizonQuarters);
    const base = { Auto: 292e6, Home: 238e6, Renters: 9.9e6, Umbrella: 5.6e6 };
    const seasonal = [1.0, 0.94, 1.12, 1.05];
    const forecast = quarters.map((quarter, i) => {
      const byLine = LINES.map((l) => {
        const expected = Math.round(base[l] * seasonal[i % 4] * (1 + 0.015 * (i + 1)));
        return { line: l, expectedIncurredUsd: expected, low: Math.round(expected * 0.9), high: Math.round(expected * 1.14) };
      });
      return { quarter, totalExpectedUsd: byLine.reduce((t, x) => t + x.expectedIncurredUsd, 0), byLine };
    });
    return { horizonQuarters, currency: 'USD', model: 'chain-ladder + cat load v3 (demo)', forecast, driver: 'Hail frequency in Central/Mountain and repair-cost inflation' };
  },
};

module.exports = { build, handlers, TODAY };
