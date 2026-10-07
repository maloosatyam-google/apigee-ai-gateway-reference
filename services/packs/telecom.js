// Telecom handlers and seed data for the industry-apis service (pack: industries/telecom.json).
//
// A mobile and home internet provider. Story: Jamie Carter (ACC-4101) bought an EU travel pass
// (RP-3301) before a trip to Portugal, but it failed to activate (ticket TT-6101), so line
// LN-7001 was billed $120 of pay-per-use roaming (CHG-9102). Autopay also failed during a
// payment outage on 2026-09-05, adding a $30 late fee (CHG-9101), and the home fiber line
// (LN-7003) is slow because of a node fault in ZIP 30301 (OUT-5501). Crediting the $30 late
// fee is within policy; crediting the $120 overage is over the $50 limit that Apigee enforces
// for Customer Care. The limit is not enforced here, so the gateway control stays visible:
// this service records whatever credit reaches it (up to the charge amount).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';
const NEXT_CYCLE = '2026-10-01';

const maskPhone = (p) => String(p).replace(/\d(?=\d{4})/g, '*');

function build() {
  const subscribers = [
    { accountId: 'ACC-4101', name: 'Jamie Carter', email: 'jamie.carter@example.net', phone: '5550100141', segment: 'Consumer', zipCode: '30301', autopay: 'Failed 2026-09-05, retried OK 2026-09-08', customerSince: '2019-04-11', status: 'Active' },
    { accountId: 'ACC-4102', name: 'Priya Desai', email: 'priya.desai@example.net', phone: '5550100262', segment: 'Consumer', zipCode: '30305', autopay: 'On', customerSince: '2022-01-20', status: 'Active' },
    { accountId: 'ACC-4103', name: 'Marcus Bell', email: 'marcus.bell@example.net', phone: '5550100377', segment: 'Prepaid', zipCode: '30310', autopay: 'Off', customerSince: '2025-06-02', status: 'Active' },
    { accountId: 'ACC-4104', name: 'Elena Ruiz', email: 'elena.ruiz@example.com', phone: '5550100488', segment: 'Business', zipCode: '30303', autopay: 'On', customerSince: '2017-09-14', status: 'Active' },
    { accountId: 'ACC-4105', name: 'Tom Nguyen', email: 'tom.nguyen@example.net', phone: '5550100519', segment: 'Consumer', zipCode: '30318', autopay: 'On', customerSince: '2024-03-30', status: 'Suspended (non-payment)' },
    { accountId: 'ACC-4106', name: 'Jamila Hassan', email: 'jamila.hassan@example.com', phone: '5550100623', segment: 'Business', zipCode: '30301', autopay: 'On', customerSince: '2021-11-08', status: 'Active' },
  ];
  const plans = [
    { planCode: 'UNL-ESS', name: 'Unlimited Essentials', kind: 'Mobile', monthlyUsd: 55, includes: 'Unlimited talk, text and data; roaming pay-per-use' },
    { planCode: 'UNL-PLUS', name: 'Unlimited Plus', kind: 'Mobile', monthlyUsd: 70, includes: 'Unlimited talk, text and data; 5 roaming days a month; 50 GB hotspot' },
    { planCode: 'BASIC-10', name: 'Basic 10 GB', kind: 'Mobile', monthlyUsd: 35, includes: '10 GB data, unlimited talk and text' },
    { planCode: 'FIB-500', name: 'Fiber 500', kind: 'Home internet', monthlyUsd: 60, includes: '500 Mbps symmetrical fiber' },
    { planCode: 'FIB-1G', name: 'Fiber 1 Gig', kind: 'Home internet', monthlyUsd: 80, includes: '1 Gbps symmetrical fiber, mesh Wi-Fi' },
  ];
  const lines = [
    { lineId: 'LN-7001', accountId: 'ACC-4101', kind: 'Mobile', user: 'Jamie Carter', number: '5550100141', planCode: 'UNL-ESS', simType: 'Physical SIM', iccid: '8901260000000017001', status: 'Active', activatedOn: '2019-04-11' },
    { lineId: 'LN-7002', accountId: 'ACC-4101', kind: 'Mobile', user: 'Alex Carter', number: '5550100142', planCode: 'BASIC-10', simType: 'Physical SIM', iccid: '8901260000000017002', status: 'Active', activatedOn: '2023-08-19' },
    { lineId: 'LN-7003', accountId: 'ACC-4101', kind: 'Home internet', user: 'Jamie Carter', serviceAddress: '12 Maple Row, 30301', planCode: 'FIB-500', simType: null, status: 'Degraded (area outage)', activatedOn: '2022-05-03' },
    { lineId: 'LN-7010', accountId: 'ACC-4102', kind: 'Mobile', user: 'Priya Desai', number: '5550100262', planCode: 'UNL-PLUS', simType: 'eSIM', iccid: '8901260000000017010', status: 'Active', activatedOn: '2022-01-20' },
    { lineId: 'LN-7020', accountId: 'ACC-4103', kind: 'Mobile', user: 'Marcus Bell', number: '5550100377', planCode: 'BASIC-10', simType: 'Physical SIM', iccid: '8901260000000017020', status: 'Active', activatedOn: '2025-06-02' },
    { lineId: 'LN-7030', accountId: 'ACC-4104', kind: 'Mobile', user: 'Elena Ruiz', number: '5550100488', planCode: 'UNL-PLUS', simType: 'eSIM', iccid: '8901260000000017030', status: 'Active', activatedOn: '2017-09-14' },
    { lineId: 'LN-7031', accountId: 'ACC-4104', kind: 'Home internet', user: 'Elena Ruiz', serviceAddress: '400 Commerce St, 30303', planCode: 'FIB-1G', simType: null, status: 'Active', activatedOn: '2020-02-10' },
    { lineId: 'LN-7040', accountId: 'ACC-4105', kind: 'Mobile', user: 'Tom Nguyen', number: '5550100519', planCode: 'UNL-ESS', simType: 'eSIM', iccid: '8901260000000017040', status: 'Suspended', activatedOn: '2024-03-30' },
  ];
  const usage = [
    { lineId: 'LN-7001', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 18.4, minutes: 412, texts: 960, roaming: [{ country: 'Portugal', dates: '2026-09-14 to 2026-09-20', dataGb: 1.9, minutes: 38, billing: 'Pay-per-use (travel pass RP-3301 did not activate)', chargedUsd: 120 }] },
    { lineId: 'LN-7002', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 8.7, dataCapGb: 10, minutes: 190, texts: 2210, roaming: [] },
    { lineId: 'LN-7003', cycle: '2026-09-01 to 2026-09-30', downloadedGb: 612, avgSpeedMbps: 138, planSpeedMbps: 500, note: 'Speeds down since 2026-09-23 (area outage OUT-5501)' },
    { lineId: 'LN-7010', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 31.2, minutes: 280, texts: 540, roaming: [{ country: 'Canada', dates: '2026-09-03 to 2026-09-05', dataGb: 0.8, minutes: 12, billing: 'Included roaming days (3 of 5)', chargedUsd: 0 }] },
    { lineId: 'LN-7020', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 9.9, dataCapGb: 10, minutes: 610, texts: 300, roaming: [] },
    { lineId: 'LN-7030', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 22.5, minutes: 1310, texts: 410, roaming: [] },
    { lineId: 'LN-7031', cycle: '2026-09-01 to 2026-09-30', downloadedGb: 1480, avgSpeedMbps: 910, planSpeedMbps: 1000 },
    { lineId: 'LN-7040', cycle: '2026-09-01 to 2026-09-30', domesticDataGb: 2.1, minutes: 40, texts: 88, roaming: [] },
  ];
  const charges = [
    { chargeId: 'CHG-9100', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7001', description: 'Unlimited Essentials, September', amount: 55 },
    { chargeId: 'CHG-9101', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: null, description: 'Late payment fee (autopay failed 2026-09-05)', amount: 30 },
    { chargeId: 'CHG-9102', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7001', description: 'Pay-per-use roaming, Portugal 2026-09-14 to 2026-09-20', amount: 120 },
    { chargeId: 'CHG-9103', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7002', description: 'Basic 10 GB, September', amount: 35 },
    { chargeId: 'CHG-9104', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7003', description: 'Fiber 500, September', amount: 60 },
    { chargeId: 'CHG-9105', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7001', description: 'Device instalment 15 of 24 (Nova X5)', amount: 25 },
    { chargeId: 'CHG-9106', accountId: 'ACC-4101', billId: 'BILL-2609-4101', lineId: 'LN-7001', description: 'EU 10-day travel pass (RP-3301)', amount: 35 },
    { chargeId: 'CHG-9110', accountId: 'ACC-4102', billId: 'BILL-2609-4102', lineId: 'LN-7010', description: 'Unlimited Plus, September', amount: 70 },
    { chargeId: 'CHG-9120', accountId: 'ACC-4104', billId: 'BILL-2609-4104', lineId: 'LN-7030', description: 'Unlimited Plus, September', amount: 70 },
    { chargeId: 'CHG-9121', accountId: 'ACC-4104', billId: 'BILL-2609-4104', lineId: 'LN-7031', description: 'Fiber 1 Gig, September', amount: 80 },
  ].map((c) => ({ ...c, credits: [] }));
  const bills = [
    { billId: 'BILL-2609-4101', accountId: 'ACC-4101', cycle: '2026-09', issuedOn: '2026-09-21', dueOn: '2026-10-12', status: 'Open' },
    { billId: 'BILL-2609-4102', accountId: 'ACC-4102', cycle: '2026-09', issuedOn: '2026-09-21', dueOn: '2026-10-12', status: 'Open' },
    { billId: 'BILL-2609-4104', accountId: 'ACC-4104', cycle: '2026-09', issuedOn: '2026-09-21', dueOn: '2026-10-12', status: 'Open' },
  ];
  const roamingPasses = [
    { passId: 'RP-3301', lineId: 'LN-7001', passType: 'EU 10-day', priceUsd: 35, purchasedOn: '2026-09-13', status: 'Failed to activate', note: 'Provisioning error; see TT-6101' },
    { passId: 'RP-3290', lineId: 'LN-7010', passType: 'Americas 7-day', priceUsd: 25, purchasedOn: '2026-07-02', status: 'Expired' },
  ];
  const outages = [
    { outageId: 'OUT-5501', zipCodes: ['30301', '30302'], service: 'Fiber', type: 'Node degradation (optical amplifier fault)', impact: 'Speeds reduced to 20-40% of plan', startedAt: '2026-09-23T07:40Z', estimatedRestore: '2026-09-26T18:00Z', status: 'Crew on site' },
    { outageId: 'MNT-5510', zipCodes: ['30318'], service: 'Mobile', type: 'Planned 5G radio upgrade', impact: 'Brief drops to LTE 01:00-04:00', startedAt: '2026-09-27T01:00Z', estimatedRestore: '2026-09-27T04:00Z', status: 'Scheduled' },
  ];
  const tickets = [
    { ticketId: 'TT-6101', accountId: 'ACC-4101', subject: 'EU travel pass did not activate in Portugal', priority: 'Medium', status: 'Open', openedOn: '2026-09-15' },
    { ticketId: 'TT-6102', accountId: 'ACC-4104', subject: 'Static IP request for office fiber', priority: 'Low', status: 'Resolved', openedOn: '2026-09-02' },
  ];
  const visits = [
    { visitId: 'TV-8801', lineId: 'LN-7031', date: '2026-08-14', window: 'Afternoon', status: 'Completed', note: 'Mesh node added' },
  ];
  const devices = [
    { lineId: 'LN-7001', device: 'Nova X5 128 GB', financedUsd: 600, monthlyUsd: 25, termMonths: 24, paymentsMade: 15, startedOn: '2025-07-01' },
    { lineId: 'LN-7010', device: 'Pixelate 9 256 GB', financedUsd: 840, monthlyUsd: 35, termMonths: 24, paymentsMade: 20, startedOn: '2024-12-01' },
    { lineId: 'LN-7030', device: 'Nova X6 Pro 512 GB', financedUsd: 1080, monthlyUsd: 45, termMonths: 24, paymentsMade: 4, startedOn: '2026-05-01' },
  ];
  return { subscribers, plans, lines, usage, charges, bills, roamingPasses, outages, tickets, visits, devices };
}

const findAccount = (db, id) => {
  const s = db.subscribers.find((x) => x.accountId === id);
  if (!s) throw new ToolError(404, 'NOT_FOUND', `Account ${id} not found`);
  return s;
};
const findLine = (db, id) => {
  const l = db.lines.find((x) => x.lineId === id);
  if (!l) throw new ToolError(404, 'NOT_FOUND', `Line ${id} not found`);
  return l;
};
const planOf = (db, code) => db.plans.find((p) => p.planCode === code);
const creditable = (c) => money(c.amount - c.credits.reduce((s, r) => s + r.amount, 0));
const publicLine = (db, l) => ({ ...l, number: l.number ? maskPhone(l.number) : undefined, iccid: l.iccid ? maskPhone(l.iccid) : undefined, plan: planOf(db, l.planCode)?.name });

const PASS_PRICES = { 'EU 10-day': 35, 'Americas 7-day': 25, 'Global 30-day': 90 };
const SEGMENTS = ['Consumer', 'Business', 'Prepaid'];

const handlers = {
  searchWirelessAccounts(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const digits = q.replace(/\D/g, '');
    const hits = db.subscribers.filter((s) =>
      s.name.toLowerCase().includes(q) || s.accountId.toLowerCase() === q || s.email.toLowerCase().startsWith(q)
      || (digits.length >= 4 && s.phone.includes(digits)));
    return {
      count: hits.length,
      subscribers: hits.map((s) => ({ accountId: s.accountId, name: s.name, email: maskEmail(s.email), phone: maskPhone(s.phone), segment: s.segment, status: s.status })),
    };
  },

  getWirelessAccount(db, { accountId }) {
    const s = findAccount(db, accountId);
    const bill = db.bills.find((b) => b.accountId === s.accountId && b.status === 'Open');
    const due = db.charges.filter((c) => c.accountId === s.accountId && bill && c.billId === bill.billId).reduce((t, c) => t + creditable(c), 0);
    return {
      ...s, email: maskEmail(s.email), phone: maskPhone(s.phone),
      lines: db.lines.filter((l) => l.accountId === s.accountId).map((l) => ({ lineId: l.lineId, kind: l.kind, user: l.user, plan: planOf(db, l.planCode)?.name, status: l.status })),
      balanceDueUsd: money(due), billDueOn: bill?.dueOn || null,
      openTickets: db.tickets.filter((t) => t.accountId === s.accountId && t.status === 'Open'),
    };
  },

  listServiceLines(db, { accountId }) {
    const s = findAccount(db, accountId);
    return { accountId: s.accountId, lines: db.lines.filter((l) => l.accountId === s.accountId).map((l) => publicLine(db, l)) };
  },

  getLineUsage(db, { lineId }) {
    const l = findLine(db, lineId);
    const u = db.usage.find((x) => x.lineId === l.lineId) || { cycle: '2026-09-01 to 2026-09-30' };
    return { lineId: l.lineId, kind: l.kind, plan: planOf(db, l.planCode)?.name, ...u, roamingPasses: db.roamingPasses.filter((p) => p.lineId === l.lineId) };
  },

  getBillBreakdown(db, { accountId }) {
    const s = findAccount(db, accountId);
    const bill = db.bills.find((b) => b.accountId === s.accountId);
    if (!bill) return { accountId: s.accountId, bill: null, note: 'No bill issued yet this cycle.' };
    const items = db.charges.filter((c) => c.billId === bill.billId).map((c) => ({ ...c, creditableRemaining: creditable(c) }));
    return {
      accountId: s.accountId, currency: 'USD', ...bill,
      charges: items,
      totalUsd: money(items.reduce((t, c) => t + c.amount, 0)),
      creditsAppliedUsd: money(items.reduce((t, c) => t + (c.amount - c.creditableRemaining), 0)),
      amountDueUsd: money(items.reduce((t, c) => t + c.creditableRemaining, 0)),
    };
  },

  issueBillCredit(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be credited`);
    const r = {
      creditId: `CR-${chargeId.slice(4)}-${c.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Applied', postedOn: TODAY, appearsOn: 'Current bill (BILL due 2026-10-12)',
    };
    c.credits.push(r);
    return { chargeId, accountId: c.accountId, description: c.description, ...r, creditableRemaining: money(remaining - amount) };
  },

  changeRatePlan(db, { lineId, planCode }) {
    const l = findLine(db, lineId);
    const to = planOf(db, planCode);
    if (!to) throw new ToolError(404, 'NOT_FOUND', `Plan ${planCode} not found`);
    if (l.status.startsWith('Suspended')) throw new ToolError(409, 'LINE_SUSPENDED', `${lineId} is suspended; settle the balance first`);
    if (to.kind !== l.kind) throw new ToolError(409, 'PLAN_NOT_COMPATIBLE', `${to.name} is a ${to.kind.toLowerCase()} plan; ${lineId} is ${l.kind.toLowerCase()}`);
    if (l.planCode === to.planCode) throw new ToolError(409, 'ALREADY_ON_PLAN', `${lineId} is already on ${to.name}`);
    const from = planOf(db, l.planCode);
    l.pendingPlanCode = to.planCode;
    l.pendingFrom = NEXT_CYCLE;
    return { lineId, fromPlan: from.name, toPlan: to.name, includes: to.includes, effectiveOn: NEXT_CYCLE, monthlyChangeUsd: money(to.monthlyUsd - from.monthlyUsd), requestedOn: TODAY };
  },

  addRoamingPass(db, { lineId, passType }) {
    const l = findLine(db, lineId);
    if (l.kind !== 'Mobile') throw new ToolError(409, 'NOT_MOBILE', `${lineId} is not a mobile line`);
    if (l.status !== 'Active') throw new ToolError(409, 'LINE_NOT_ACTIVE', `${lineId} is ${l.status}`);
    const p = { passId: `RP-${3301 + db.roamingPasses.length + 10}`, lineId, passType, priceUsd: PASS_PRICES[passType], purchasedOn: TODAY, status: 'Ready (activates on first use abroad)' };
    db.roamingPasses.push(p);
    return { ...p, currency: 'USD', note: 'Provisioned and verified on the network; charge appears on the next bill.' };
  },

  checkNetworkOutage(db, { zipCode }) {
    const z = String(zipCode).trim();
    if (!/^\d{5}$/.test(z)) throw new ToolError(400, 'INVALID_ARGUMENT', 'zipCode must be 5 digits');
    const hits = db.outages.filter((o) => o.zipCodes.includes(z));
    return { zipCode: z, asOf: `${TODAY}T09:00Z`, count: hits.length, events: hits, summary: hits.length ? `${hits.length} known event(s) in ${z}` : `No known outages or maintenance in ${z}` };
  },

  openTroubleTicket(db, { accountId, subject, priority = 'Medium' }) {
    const s = findAccount(db, accountId);
    const t = { ticketId: `TT-${6101 + db.tickets.length}`, accountId: s.accountId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.tickets.push(t);
    return { ...t, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  scheduleTechnicianVisit(db, { lineId, preferredDate, window = 'Morning' }) {
    const l = findLine(db, lineId);
    if (l.kind !== 'Home internet') throw new ToolError(409, 'NOT_HOME_INTERNET', `${lineId} is a ${l.kind.toLowerCase()} line; technician visits are for home internet`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) throw new ToolError(400, 'INVALID_ARGUMENT', 'preferredDate must be YYYY-MM-DD');
    if (preferredDate < TODAY) throw new ToolError(400, 'INVALID_ARGUMENT', `preferredDate must be on or after ${TODAY}`);
    if (db.visits.some((v) => v.date === preferredDate && v.window === window && v.status === 'Booked')) throw new ToolError(409, 'SLOT_TAKEN', `${preferredDate} ${window} is fully booked`);
    const zip = db.subscribers.find((s) => s.accountId === l.accountId)?.zipCode;
    const outage = db.outages.find((o) => o.zipCodes.includes(zip) && o.service === 'Fiber');
    const v = { visitId: `TV-${8801 + db.visits.length}`, lineId, accountId: l.accountId, date: preferredDate, window, arrival: window === 'Morning' ? '08:00-12:00' : '13:00-17:00', status: 'Booked', bookedOn: TODAY };
    db.visits.push(v);
    return { ...v, note: outage ? `Area outage ${outage.outageId} expected fixed by ${outage.estimatedRestore}; the technician will check in-home equipment after that.` : 'Technician will call 30 minutes before arrival.' };
  },

  swapSimCard(db, { lineId, simType = 'eSIM', reason = '' }) {
    const l = findLine(db, lineId);
    if (l.kind !== 'Mobile') throw new ToolError(409, 'NOT_MOBILE', `${lineId} is not a mobile line`);
    if (l.status !== 'Active') throw new ToolError(409, 'LINE_NOT_ACTIVE', `${lineId} is ${l.status}`);
    const oldIccid = l.iccid;
    l.iccid = `89012600000000${String(Number(oldIccid.slice(-5)) + 500).padStart(5, '0')}`;
    l.simType = simType;
    return {
      lineId, simType, oldIccid: maskPhone(oldIccid), newIccid: maskPhone(l.iccid), reason: String(reason).slice(0, 200), swappedOn: TODAY,
      nextStep: simType === 'eSIM' ? 'Activation QR code sent to the account email; the old SIM stops working once the eSIM is installed.' : 'New SIM ships in 1-2 business days; the old SIM works until it is activated.',
    };
  },

  getDeviceInstallment(db, { lineId }) {
    const l = findLine(db, lineId);
    const d = db.devices.find((x) => x.lineId === l.lineId);
    if (!d) return { lineId, financed: false, note: 'No device financing on this line (bring-your-own device).' };
    const payoff = money(d.financedUsd - d.monthlyUsd * d.paymentsMade);
    return { lineId, financed: true, currency: 'USD', ...d, remainingPayments: d.termMonths - d.paymentsMade, payoffUsd: payoff, upgradeEligible: d.paymentsMade >= 12, upgradeRule: 'Upgrade after 12 payments; the remaining balance is waived on trade-in in good condition.' };
  },

  getArpuTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 51.8, 4.212, 218.2], ['2025-11', 51.9, 4.225, 219.3], ['2025-12', 52.6, 4.261, 224.1],
      ['2026-01', 52.1, 4.248, 221.3], ['2026-02', 52.3, 4.259, 222.7], ['2026-03', 52.7, 4.271, 225.1],
      ['2026-04', 52.9, 4.283, 226.6], ['2026-05', 53.2, 4.294, 228.4], ['2026-06', 53.6, 4.302, 230.6],
      ['2026-07', 54.4, 4.318, 234.9], ['2026-08', 54.9, 4.331, 237.8], ['2026-09', 55.3, 4.347, 240.4],
    ].slice(-months).map(([month, arpuUsd, subscribersM, serviceRevenueUsdM]) => ({ month, arpuUsd, subscribersM, serviceRevenueUsdM }));
    return {
      months: series.length, series,
      bySegment: [{ segment: 'Consumer', arpuUsd: 54.1 }, { segment: 'Business', arpuUsd: 71.8 }, { segment: 'Prepaid', arpuUsd: 31.4 }],
      trend: 'ARPU up on Unlimited Plus migrations and summer roaming; prepaid flat.',
    };
  },

  getChurnRiskSummary(_db, { segment }) {
    const all = [
      { segment: 'Consumer', monthlyChurnPct: 0.92, atRisk: 61200, topDrivers: ['Bill shock (roaming, fees)', 'Competitor promo', 'Home internet speed'] },
      { segment: 'Business', monthlyChurnPct: 0.61, atRisk: 8400, topDrivers: ['Contract end', 'Coverage in new office'] },
      { segment: 'Prepaid', monthlyChurnPct: 3.4, atRisk: 47800, topDrivers: ['Low top-up balance', 'Data cap reached'] },
    ];
    return { asOf: TODAY, segments: segment ? all.filter((s) => s.segment === segment) : all, note: 'Aggregated; no individual subscriber records.' };
  },

  getNetworkQualityMetrics(_db, { region }) {
    const all = [
      { region: 'North', droppedCallPct: 0.58, median5gDownMbps: 312, fiberAvailabilityPct: 99.62, outageMinutesPer1k: 41, note: 'Fiber node fault in 30301 since 2026-09-23' },
      { region: 'South', droppedCallPct: 0.49, median5gDownMbps: 344, fiberAvailabilityPct: 99.91, outageMinutesPer1k: 12 },
      { region: 'East', droppedCallPct: 0.66, median5gDownMbps: 287, fiberAvailabilityPct: 99.88, outageMinutesPer1k: 18 },
      { region: 'West', droppedCallPct: 0.44, median5gDownMbps: 361, fiberAvailabilityPct: 99.93, outageMinutesPer1k: 9 },
    ];
    return { period: 'last_30d', regions: region ? all.filter((r) => r.region === region) : all };
  },

  getPortingActivity(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const cur = { portIns: 38400 * f, portOuts: 33100 * f, grossAdds: 96200 * f };
    return {
      period, ...cur, netPortsIn: cur.portIns - cur.portOuts,
      previous: { portIns: 35900 * f, portOuts: 34800 * f },
      byChannel: [{ channel: 'Online', sharePct: 46 }, { channel: 'Retail stores', sharePct: 34 }, { channel: 'Telesales', sharePct: 12 }, { channel: 'Dealers', sharePct: 8 }],
    };
  },

  getCareContactMetrics(_db, { period = 'last_30d' }) {
    return {
      period,
      contactsPer1kSubs: period === 'last_90d' ? 118 : 126,
      firstContactResolutionPct: 71, digitalSharePct: 58, avgHandleTimeMin: 7.4,
      topReasons: [
        { reason: 'Bill explanation / unexpected charges', sharePct: 27 }, { reason: 'Roaming problems', sharePct: 14 },
        { reason: 'Home internet speed', sharePct: 13 }, { reason: 'Plan change', sharePct: 11 }, { reason: 'Device and SIM', sharePct: 9 },
      ],
      shift: 'Roaming contacts up 40% after the travel-pass provisioning fault; bill-shock contacts follow.',
    };
  },

  getRoamingRevenueMetrics(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3.4 : 1;
    const zones = [
      { zone: 'EU', passesSold: 41200, passRevenueUsd: 1.44e6, payPerUseRevenueUsd: 0.61e6, activationFailurePct: 2.8 },
      { zone: 'Americas', passesSold: 28700, passRevenueUsd: 0.72e6, payPerUseRevenueUsd: 0.22e6, activationFailurePct: 0.4 },
      { zone: 'Rest of world', passesSold: 6300, passRevenueUsd: 0.57e6, payPerUseRevenueUsd: 0.31e6, activationFailurePct: 0.6 },
    ].map((z) => ({ ...z, passesSold: Math.round(z.passesSold * f), passRevenueUsd: money(z.passRevenueUsd * f), payPerUseRevenueUsd: money(z.payPerUseRevenueUsd * f) }));
    return { period, currency: 'USD', zones, note: 'EU activation failures spiked 2026-09-10 to 2026-09-18 (provisioning fault).' };
  },

  getPlanMarginAnalysis(_db, { planFamily }) {
    const all = [
      { planFamily: 'Unlimited', subscribers: 2.41e6, revenueUsd: 1.62e9, networkCostUsd: 0.58e9, subsidyCostUsd: 0.31e9 },
      { planFamily: 'Metered', subscribers: 0.88e6, revenueUsd: 0.37e9, networkCostUsd: 0.11e9, subsidyCostUsd: 0.05e9 },
      { planFamily: 'Fiber', subscribers: 0.61e6, revenueUsd: 0.49e9, networkCostUsd: 0.21e9, subsidyCostUsd: 0.02e9 },
      { planFamily: 'Prepaid', subscribers: 0.45e6, revenueUsd: 0.17e9, networkCostUsd: 0.07e9, subsidyCostUsd: 0.0 },
    ].map((p) => ({ ...p, marginPct: money(((p.revenueUsd - p.networkCostUsd - p.subsidyCostUsd) / p.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', planFamilies: planFamily ? all.filter((p) => p.planFamily === planFamily) : all };
  },

  runNetAddsForecast(_db, { horizonQuarters = 2 }) {
    const quarters = ['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4', '2028-Q1', '2028-Q2', '2028-Q3'].slice(0, horizonQuarters);
    const base = { Consumer: 3.12e6, Business: 0.74e6, Prepaid: 0.49e6 };
    const growth = { Consumer: 0.006, Business: 0.011, Prepaid: -0.004 };
    const forecast = quarters.map((quarter, i) => {
      const bySegment = SEGMENTS.map((s) => {
        const expected = Math.round(base[s] * (1 + growth[s] * (i + 1)));
        return { segment: s, expected, netAdds: Math.round(base[s] * growth[s]), low: Math.round(expected * 0.985), high: Math.round(expected * 1.012) };
      });
      return { quarter, total: bySegment.reduce((t, x) => t + x.expected, 0), bySegment };
    });
    return { horizonQuarters, model: 'cohort-churn v3 (demo)', forecast, driver: 'Business fiber bundles and lower consumer churn' };
  },
};

module.exports = { build, handlers, TODAY };
