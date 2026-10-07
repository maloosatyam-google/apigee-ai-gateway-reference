// IT Services handlers and seed data for the industry-apis service (pack: industries/it.json).
//
// A managed IT services provider (MSP). Story: Dana Whitfield (CON-4101), IT manager at
// Harborline Freight (CLI-210), lost email for six hours on Tuesday after a mail gateway patch
// we applied (change CHG-3307). The P1 incident (INC-8802) got its first response after 72
// minutes against a 15-minute SLA. Crediting the $30 emergency callout fee (BIL-7701) is within
// policy; crediting the $120 September Priority Support add-on (BIL-7702) is over the $50 limit
// that Apigee enforces for Client Success. The limit is not enforced here, so the gateway
// control stays visible: this service records whatever credit reaches it (up to the amount
// charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const clients = [
    { clientId: 'CLI-210', name: 'Harborline Freight', segment: 'Mid-market', supportTier: 'Priority', contract: { contractId: 'MSA-2210', services: ['Managed Service Desk', 'Cloud Operations', 'Cybersecurity'], monthlyFeeUsd: 18400, term: '2025-04-01 to 2028-03-31', renewalNoticeBy: '2027-12-31' }, accountManager: 'Morgan Blake' },
    { clientId: 'CLI-211', name: 'Cedar Row Dental Group', segment: 'SMB', supportTier: 'Standard', contract: { contractId: 'MSA-2211', services: ['Managed Service Desk'], monthlyFeeUsd: 3900, term: '2026-01-01 to 2027-12-31', renewalNoticeBy: '2027-09-30' }, accountManager: 'Riley Chen' },
    { clientId: 'CLI-212', name: 'Northgate Engineering', segment: 'Enterprise', supportTier: 'Premier', contract: { contractId: 'MSA-2212', services: ['Managed Service Desk', 'Cloud Operations', 'Cybersecurity', 'Projects & Consulting'], monthlyFeeUsd: 64200, term: '2024-07-01 to 2027-06-30', renewalNoticeBy: '2027-03-31' }, accountManager: 'Morgan Blake' },
    { clientId: 'CLI-213', name: 'Bluewater Credit Union', segment: 'Mid-market', supportTier: 'Priority', contract: { contractId: 'MSA-2213', services: ['Managed Service Desk', 'Cybersecurity'], monthlyFeeUsd: 12800, term: '2025-10-01 to 2027-09-30', renewalNoticeBy: '2027-06-30' }, accountManager: 'Casey Patel' },
  ];
  const contacts = [
    { contactId: 'CON-4101', name: 'Dana Whitfield', title: 'IT Manager', clientId: 'CLI-210', email: 'dana.whitfield@harborline.example', role: 'Primary technical contact', contactSince: '2025-04-01' },
    { contactId: 'CON-4102', name: 'Leo Martins', title: 'Finance Director', clientId: 'CLI-210', email: 'leo.martins@harborline.example', role: 'Billing contact', contactSince: '2025-04-01' },
    { contactId: 'CON-4103', name: 'Danielle Price', title: 'Practice Manager', clientId: 'CLI-211', email: 'danielle.price@cedarrow.example', role: 'Primary contact', contactSince: '2026-01-05' },
    { contactId: 'CON-4104', name: 'Arjun Mehta', title: 'Head of Infrastructure', clientId: 'CLI-212', email: 'arjun.mehta@northgate.example', role: 'Primary technical contact', contactSince: '2024-07-01' },
    { contactId: 'CON-4105', name: 'Grace Okoye', title: 'CIO', clientId: 'CLI-213', email: 'grace.okoye@bluewater.example', role: 'Executive sponsor', contactSince: '2025-10-01' },
  ];
  const slaTargets = {
    Standard: { P1: { respondMin: 60, resolveHrs: 8 }, P2: { respondMin: 120, resolveHrs: 16 }, P3: { respondMin: 480, resolveHrs: 40 }, P4: { respondMin: 960, resolveHrs: 80 } },
    Priority: { P1: { respondMin: 15, resolveHrs: 4 }, P2: { respondMin: 30, resolveHrs: 8 }, P3: { respondMin: 240, resolveHrs: 24 }, P4: { respondMin: 480, resolveHrs: 72 } },
    Premier: { P1: { respondMin: 10, resolveHrs: 2 }, P2: { respondMin: 20, resolveHrs: 6 }, P3: { respondMin: 120, resolveHrs: 16 }, P4: { respondMin: 480, resolveHrs: 48 } },
  };
  const incidents = [
    { incidentId: 'INC-8802', clientId: 'CLI-210', reportedBy: 'CON-4101', summary: 'Email down company-wide after mail gateway patch', priority: 'P1', status: 'Resolved', openedAt: '2026-09-22 08:05', firstResponseMin: 72, resolvedAt: '2026-09-22 14:10', resolutionHrs: 6.1, linkedChange: 'CHG-3307', rootCause: 'Patch KB-2291 broke TLS on the mail gateway; rolled back', escalated: false },
    { incidentId: 'INC-8803', clientId: 'CLI-210', reportedBy: 'CON-4101', summary: 'Warehouse label printers offline in Bay 4', priority: 'P2', status: 'Open', openedAt: '2026-09-24 16:40', firstResponseMin: 22, assignedTo: 'Field Services', escalated: false },
    { incidentId: 'INC-8790', clientId: 'CLI-210', reportedBy: 'CON-4101', summary: 'New starter laptop build for 3 supervisors', priority: 'P4', status: 'Resolved', openedAt: '2026-09-10 09:12', firstResponseMin: 95, resolvedAt: '2026-09-12 15:30', resolutionHrs: 54.3, escalated: false },
    { incidentId: 'INC-8811', clientId: 'CLI-211', reportedBy: 'CON-4103', summary: 'Imaging workstation cannot reach file share', priority: 'P2', status: 'Open', openedAt: '2026-09-25 08:20', firstResponseMin: 41, escalated: false },
    { incidentId: 'INC-8815', clientId: 'CLI-212', reportedBy: 'CON-4104', summary: 'VPN concentrator failover test', priority: 'P3', status: 'Resolved', openedAt: '2026-09-18 11:00', firstResponseMin: 12, resolvedAt: '2026-09-18 13:45', resolutionHrs: 2.8, escalated: false },
  ];
  const charges = [
    { chargeId: 'BIL-7700', clientId: 'CLI-210', description: 'Managed services fee (September)', amount: 18400, status: 'Invoiced', invoicedOn: '2026-09-01' },
    { chargeId: 'BIL-7701', clientId: 'CLI-210', description: 'Emergency after-hours callout (INC-8802)', amount: 30, status: 'Invoiced', invoicedOn: '2026-09-23', relatedIncident: 'INC-8802' },
    { chargeId: 'BIL-7702', clientId: 'CLI-210', description: 'Priority Support add-on (September)', amount: 120, status: 'Invoiced', invoicedOn: '2026-09-01' },
    { chargeId: 'BIL-7698', clientId: 'CLI-210', description: 'Office suite licences, 48 seats (September)', amount: 1056, status: 'Invoiced', invoicedOn: '2026-09-01' },
    { chargeId: 'BIL-7710', clientId: 'CLI-211', description: 'Managed services fee (September)', amount: 3900, status: 'Invoiced', invoicedOn: '2026-09-01' },
    { chargeId: 'BIL-7711', clientId: 'CLI-211', description: 'On-site visit (imaging workstation)', amount: 95, status: 'Pending', invoicedOn: null },
  ].map((c) => ({ ...c, credits: [] }));
  const licences = [
    { licenceId: 'LIC-3301', clientId: 'CLI-210', product: 'Office suite (Business Standard)', seats: 48, assigned: 48, unitPriceUsd: 22, billing: 'Monthly', renewsOn: '2026-10-01' },
    { licenceId: 'LIC-3302', clientId: 'CLI-210', product: 'Endpoint protection (EDR)', seats: 60, assigned: 53, unitPriceUsd: 6.5, billing: 'Annual', renewsOn: '2027-04-01' },
    { licenceId: 'LIC-3303', clientId: 'CLI-210', product: 'Backup for cloud mail', seats: 48, assigned: 48, unitPriceUsd: 3, billing: 'Monthly', renewsOn: '2026-10-01' },
    { licenceId: 'LIC-3310', clientId: 'CLI-211', product: 'Office suite (Business Basic)', seats: 18, assigned: 15, unitPriceUsd: 7, billing: 'Monthly', renewsOn: '2026-10-01' },
    { licenceId: 'LIC-3320', clientId: 'CLI-212', product: 'Office suite (Enterprise E3)', seats: 420, assigned: 402, unitPriceUsd: 36, billing: 'Annual', renewsOn: '2027-07-01' },
  ];
  const changes = [
    { changeId: 'CHG-3307', clientId: 'CLI-210', requestedBy: 'Cloud Operations', summary: 'Apply security patch KB-2291 to mail gateway', risk: 'Low', type: 'Standard', status: 'Rolled back', window: '2026-09-22 06:00-07:00', approvals: ['Auto-approved (standard change)'], linkedIncidents: ['INC-8802'], postImplementationReview: 'Scheduled 2026-09-29' },
    { changeId: 'CHG-3308', clientId: 'CLI-210', requestedBy: 'CON-4101', summary: 'Add Bay 5 warehouse Wi-Fi access points', risk: 'Medium', type: 'Normal', status: 'Awaiting CAB', window: '2026-10-03 20:00-23:00', approvals: ['Client approved'], linkedIncidents: [] },
    { changeId: 'CHG-3312', clientId: 'CLI-212', requestedBy: 'CON-4104', summary: 'Firewall rule review Q3', risk: 'Low', type: 'Normal', status: 'Completed', window: '2026-09-14 21:00-22:00', approvals: ['Client approved', 'CAB approved'], linkedIncidents: [] },
  ];
  const projects = [
    {
      projectId: 'PRJ-510', clientId: 'CLI-210', name: 'Harborline cloud migration', lead: 'Taylor Brooks', status: 'Amber', budgetUsd: 86000, startDate: '2026-06-02', targetGoLive: '2026-11-20',
      milestones: [
        { milestone: 'Discovery and design sign-off', due: '2026-07-10', status: 'Complete', completedOn: '2026-07-08' },
        { milestone: 'Landing zone build', due: '2026-08-21', status: 'Complete', completedOn: '2026-08-26' },
        { milestone: 'File server migration (wave 1)', due: '2026-09-18', status: 'Slipped', revisedDue: '2026-10-02', note: 'Paused for the mail outage recovery' },
        { milestone: 'ERP migration (wave 2)', due: '2026-10-30', status: 'Not started' },
        { milestone: 'Hypercare and handover', due: '2026-11-20', status: 'Not started' },
      ],
    },
    {
      projectId: 'PRJ-514', clientId: 'CLI-212', name: 'Northgate zero-trust rollout', lead: 'Sasha Novak', status: 'Green', budgetUsd: 240000, startDate: '2026-05-04', targetGoLive: '2027-01-29',
      milestones: [
        { milestone: 'Identity provider consolidation', due: '2026-07-31', status: 'Complete', completedOn: '2026-07-29' },
        { milestone: 'Device posture checks', due: '2026-10-16', status: 'In progress' },
      ],
    },
  ];
  return { clients, contacts, slaTargets, incidents, charges, licences, changes, projects };
}

const findContact = (db, id) => {
  const c = db.contacts.find((x) => x.contactId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Contact ${id} not found`);
  return c;
};
const clientOf = (db, contact) => db.clients.find((x) => x.clientId === contact.clientId);
const creditable = (c) => money(c.amount - c.credits.reduce((s, r) => s + r.amount, 0));
const targetFor = (db, client, priority) => db.slaTargets[client.supportTier][priority];
const withSla = (db, client, i) => {
  const t = targetFor(db, client, i.priority);
  return { ...i, responseTargetMin: t.respondMin, responseMet: i.firstResponseMin <= t.respondMin, resolutionTargetHrs: t.resolveHrs, ...(i.resolutionHrs !== undefined ? { resolutionMet: i.resolutionHrs <= t.resolveHrs } : {}) };
};

const SERVICE_LINES = ['Managed Service Desk', 'Cloud Operations', 'Cybersecurity', 'Projects & Consulting'];

const handlers = {
  searchClientContacts(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.contacts.filter((c) => {
      const client = clientOf(db, c);
      return c.name.toLowerCase().includes(q) || c.contactId.toLowerCase() === q || c.email.toLowerCase().startsWith(q) || client.name.toLowerCase().includes(q);
    });
    return {
      count: hits.length,
      contacts: hits.map((c) => ({ contactId: c.contactId, name: c.name, title: c.title, client: clientOf(db, c).name, email: maskEmail(c.email) })),
    };
  },

  getClientContact(db, { contactId }) {
    const c = findContact(db, contactId);
    const client = clientOf(db, c);
    return {
      ...c, email: maskEmail(c.email),
      client: { clientId: client.clientId, name: client.name, segment: client.segment, supportTier: client.supportTier, accountManager: client.accountManager },
      contract: client.contract,
      openIncidents: db.incidents.filter((i) => i.clientId === client.clientId && i.status === 'Open').map((i) => ({ incidentId: i.incidentId, summary: i.summary, priority: i.priority, openedAt: i.openedAt })),
    };
  },

  listServiceIncidents(db, { contactId, status = 'All' }) {
    const client = clientOf(db, findContact(db, contactId));
    const rows = db.incidents.filter((i) => i.clientId === client.clientId && (status === 'All' || i.status === status));
    return { clientId: client.clientId, client: client.name, supportTier: client.supportTier, status, incidents: rows.map((i) => withSla(db, client, i)) };
  },

  logServiceIncident(db, { contactId, summary, priority = 'P3' }) {
    const c = findContact(db, contactId);
    const client = clientOf(db, c);
    const t = targetFor(db, client, priority);
    const inc = { incidentId: `INC-${8816 + db.incidents.length - 5}`, clientId: client.clientId, reportedBy: c.contactId, summary: String(summary).slice(0, 160), priority, status: 'Open', openedAt: `${TODAY} 10:00`, escalated: false };
    db.incidents.push(inc);
    return { ...inc, client: client.name, responseTargetMin: t.respondMin, resolutionTargetHrs: t.resolveHrs };
  },

  escalateServiceIncident(db, { incidentId, reason = '' }) {
    const i = db.incidents.find((x) => x.incidentId === incidentId);
    if (!i) throw new ToolError(404, 'NOT_FOUND', `Incident ${incidentId} not found`);
    if (i.status === 'Closed') throw new ToolError(409, 'INCIDENT_CLOSED', `${incidentId} is closed; open a new incident instead`);
    if (i.escalated) throw new ToolError(409, 'ALREADY_ESCALATED', `${incidentId} was already escalated on ${i.escalatedOn}`);
    Object.assign(i, { escalated: true, escalatedOn: TODAY, escalationReason: String(reason).slice(0, 200), escalatedTo: 'Duty service delivery manager' });
    return {
      incidentId, summary: i.summary, priority: i.priority, status: i.status, escalated: true, escalatedTo: i.escalatedTo, escalatedOn: TODAY,
      nextStep: i.status === 'Resolved' ? 'Major incident review with root-cause report within 3 business days.' : 'Duty manager will contact the client within 1 hour.',
    };
  },

  getSlaStatus(db, { contactId }) {
    const client = clientOf(db, findContact(db, contactId));
    const month = TODAY.slice(0, 7);
    const rows = db.incidents.filter((i) => i.clientId === client.clientId && i.openedAt.startsWith(month)).map((i) => withSla(db, client, i));
    const breaches = rows.filter((r) => !r.responseMet || r.resolutionMet === false).map((r) => ({
      incidentId: r.incidentId, priority: r.priority,
      breach: [!r.responseMet && `first response ${r.firstResponseMin} min vs ${r.responseTargetMin} min target`, r.resolutionMet === false && `resolution ${r.resolutionHrs} h vs ${r.resolutionTargetHrs} h target`].filter(Boolean).join('; '),
    }));
    const met = rows.filter((r) => r.responseMet && r.resolutionMet !== false).length;
    return {
      clientId: client.clientId, client: client.name, supportTier: client.supportTier, month,
      targets: db.slaTargets[client.supportTier],
      incidentsThisMonth: rows.length, attainmentPct: rows.length ? money((met / rows.length) * 100) : 100,
      breaches,
      creditPolicy: breaches.length ? 'A P1 breach makes the Priority Support add-on and related callout fees eligible for an SLA credit.' : 'No breaches this month; no SLA credit due.',
    };
  },

  listServiceCharges(db, { contactId }) {
    const client = clientOf(db, findContact(db, contactId));
    return {
      clientId: client.clientId, client: client.name, currency: 'USD',
      charges: db.charges.filter((c) => c.clientId === client.clientId).map((c) => ({ ...c, creditableRemaining: creditable(c) })),
    };
  },

  issueSlaCredit(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (c.status !== 'Invoiced') throw new ToolError(409, 'NOT_INVOICED', `${chargeId} is ${c.status}; only invoiced charges can be credited`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be credited`);
    const r = {
      creditId: `CR-${chargeId.slice(4)}-${c.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, appliesTo: 'Next monthly invoice (October)',
    };
    c.credits.push(r);
    return { chargeId, clientId: c.clientId, description: c.description, ...r, creditableRemaining: money(remaining - amount) };
  },

  listSoftwareLicences(db, { contactId }) {
    const client = clientOf(db, findContact(db, contactId));
    return {
      clientId: client.clientId, client: client.name, currency: 'USD',
      licences: db.licences.filter((l) => l.clientId === client.clientId).map((l) => ({ ...l, unassigned: l.seats - l.assigned, monthlyCostUsd: money(l.seats * l.unitPriceUsd) })),
    };
  },

  adjustLicenceSeats(db, { licenceId, seats, reason = '' }) {
    const l = db.licences.find((x) => x.licenceId === licenceId);
    if (!l) throw new ToolError(404, 'NOT_FOUND', `Licence ${licenceId} not found`);
    if (seats < l.assigned) throw new ToolError(409, 'SEATS_IN_USE', `${licenceId} has ${l.assigned} seats assigned; unassign users before going below that`);
    if (seats === l.seats) throw new ToolError(409, 'NO_CHANGE', `${licenceId} already has ${seats} seats`);
    const previous = l.seats;
    Object.assign(l, { seats, lastChange: { on: TODAY, from: previous, to: seats, reason: String(reason).slice(0, 200) } });
    return {
      licenceId, product: l.product, previousSeats: previous, seats, effective: TODAY,
      monthlyCostUsd: money(seats * l.unitPriceUsd), proratedAdjustmentUsd: money((seats - previous) * l.unitPriceUsd * (6 / 30)),
      note: 'Prorated on the next invoice.',
    };
  },

  submitChangeRequest(db, { contactId, summary, risk = 'Low', preferredWindow }) {
    const c = findContact(db, contactId);
    const ch = {
      changeId: `CHG-${3313 + db.changes.length - 3}`, clientId: c.clientId, requestedBy: c.contactId, summary: String(summary).slice(0, 160), risk,
      type: risk === 'Low' ? 'Standard' : 'Normal', status: risk === 'Low' ? 'Scheduled' : 'Awaiting CAB',
      window: preferredWindow || 'Next available maintenance window', approvals: ['Client requested'], linkedIncidents: [],
    };
    db.changes.push(ch);
    return { ...ch, nextCab: risk === 'Low' ? null : '2026-09-29 10:00', submittedOn: TODAY };
  },

  getChangeRequestStatus(db, { changeId }) {
    const ch = db.changes.find((x) => x.changeId === changeId);
    if (!ch) throw new ToolError(404, 'NOT_FOUND', `Change request ${changeId} not found`);
    return ch;
  },

  getProjectMilestones(db, { projectId }) {
    const p = db.projects.find((x) => x.projectId === projectId);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `Project ${projectId} not found`);
    const done = p.milestones.filter((m) => m.status === 'Complete').length;
    return { ...p, client: db.clients.find((c) => c.clientId === p.clientId)?.name, currency: 'USD', completePct: Math.round((done / p.milestones.length) * 100) };
  },

  getIncidentMetrics(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      byPriority: [
        { priority: 'P1', incidents: 14 * f, mttrMin: 38, mttrHrs: 4.6 }, { priority: 'P2', incidents: 212 * f, mttrMin: 24, mttrHrs: 7.1 },
        { priority: 'P3', incidents: 1840 * f, mttrMin: 96, mttrHrs: 19.4 }, { priority: 'P4', incidents: 3120 * f, mttrMin: 210, mttrHrs: 41.8 },
      ],
      repeatIncidentPct: 8.4, firstContactResolutionPct: 71,
      note: period === 'last_90d' ? '90-day view: P1 volume flat.' : 'P1 response time up 11 min after two change-caused outages in September.',
    };
  },

  getSlaAttainment(_db, { period = 'last_30d' }) {
    const rows = [
      ['Managed Service Desk', 96.8, 97.4, 21], ['Cloud Operations', 98.9, 99.2, 4],
      ['Cybersecurity', 99.3, 99.1, 2], ['Projects & Consulting', 91.5, 93.0, 6],
    ].map(([serviceLine, attainmentPct, previousPct, breaches]) => ({ serviceLine, attainmentPct, previousPct, breaches }));
    return {
      period, serviceLines: rows,
      byTier: [{ tier: 'Standard', attainmentPct: 97.9 }, { tier: 'Priority', attainmentPct: 95.6 }, { tier: 'Premier', attainmentPct: 99.1 }],
      creditsIssuedUsd: period === 'last_90d' ? 14820 : 5360,
      note: 'Priority-tier P1 response is the main miss. Aggregated; no client records.',
    };
  },

  getEngineerUtilisation(_db, { period = 'last_30d' }) {
    return {
      period,
      teams: [
        { team: 'Service Desk L1/L2', engineers: 64, billableUtilisationPct: 81, benchPct: 3, overtimeHrs: 410 },
        { team: 'Cloud Operations', engineers: 28, billableUtilisationPct: 88, benchPct: 1, overtimeHrs: 236 },
        { team: 'Security Operations', engineers: 19, billableUtilisationPct: 76, benchPct: 6, overtimeHrs: 88 },
        { team: 'Projects & Consulting', engineers: 34, billableUtilisationPct: 69, benchPct: 14, overtimeHrs: 52 },
      ],
      target: { billableUtilisationPct: 78 },
      shift: 'Cloud Operations over target for 3 months running; consulting bench rising.',
    };
  },

  getChangeSuccessRates(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { changes: 3910, successPct: 97.6, emergencyPct: 5.1, causedIncidents: 41 }, previous: { changes: 3620, successPct: 98.1, emergencyPct: 4.4, causedIncidents: 33 } }
      : { current: { changes: 1340, successPct: 96.9, emergencyPct: 6.2, causedIncidents: 17 }, previous: { changes: 1285, successPct: 98.0, emergencyPct: 4.8, causedIncidents: 10 } };
    return { period, ...p, note: 'Standard patch changes caused most change-related incidents this month.' };
  },

  getLicenceComplianceSummary() {
    return {
      asOf: TODAY,
      productFamilies: [
        { family: 'Office suite', seats: 18420, assigned: 16980, shelfwarePct: 7.8, overDeployedClients: 3 },
        { family: 'Endpoint protection', seats: 21300, assigned: 19650, shelfwarePct: 7.7, overDeployedClients: 1 },
        { family: 'Backup', seats: 15200, assigned: 14880, shelfwarePct: 2.1, overDeployedClients: 0 },
        { family: 'Design & CAD', seats: 940, assigned: 781, shelfwarePct: 16.9, overDeployedClients: 0 },
      ],
      note: 'Aggregated across all clients; no client records.',
    };
  },

  getClientHealthScores(_db, { segment }) {
    const all = [
      { segment: 'SMB', clients: 142, nps: 41, renewalRiskPct: 12.7, escalationsLast30d: 9 },
      { segment: 'Mid-market', clients: 58, nps: 33, renewalRiskPct: 15.5, escalationsLast30d: 14 },
      { segment: 'Enterprise', clients: 17, nps: 47, renewalRiskPct: 5.9, escalationsLast30d: 3 },
    ];
    return { asOf: TODAY, segments: segment ? all.filter((s) => s.segment === segment) : all, note: 'Aggregated; no client contacts.' };
  },

  getDeliveryMarginReport(_db, { serviceLine }) {
    const all = [
      { serviceLine: 'Managed Service Desk', revenueUsd: 14.2e6, deliveryCostUsd: 9.6e6, slaCreditsUsd: 0.18e6 },
      { serviceLine: 'Cloud Operations', revenueUsd: 11.8e6, deliveryCostUsd: 6.9e6, slaCreditsUsd: 0.05e6 },
      { serviceLine: 'Cybersecurity', revenueUsd: 7.4e6, deliveryCostUsd: 4.1e6, slaCreditsUsd: 0.02e6 },
      { serviceLine: 'Projects & Consulting', revenueUsd: 6.1e6, deliveryCostUsd: 4.7e6, slaCreditsUsd: 0.04e6 },
    ].map((s) => ({ ...s, grossMarginPct: money(((s.revenueUsd - s.deliveryCostUsd - s.slaCreditsUsd) / s.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', serviceLines: serviceLine ? all.filter((s) => s.serviceLine === serviceLine) : all };
  },

  runCapacityForecast(_db, { horizonMonths = 3 }) {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'].slice(0, horizonMonths);
    const base = { 'Managed Service Desk': [9800, 10240], 'Cloud Operations': [4420, 4310], Cybersecurity: [2900, 3040], 'Projects & Consulting': [5100, 5780] };
    const forecast = months.map((month, i) => {
      const byServiceLine = SERVICE_LINES.map((s) => {
        const demandHrs = Math.round(base[s][0] * (1 + 0.025 * (i + 1)));
        const capacityHrs = base[s][1];
        return { serviceLine: s, demandHrs, capacityHrs, gapHrs: capacityHrs - demandHrs };
      });
      return { month, totalDemandHrs: byServiceLine.reduce((t, x) => t + x.demandHrs, 0), byServiceLine };
    });
    return { horizonMonths, model: 'ticket-flow v3 (demo)', forecast, driver: 'Two Enterprise onboardings in Q4 and rising cloud workloads' };
  },
};

module.exports = { build, handlers, TODAY };
