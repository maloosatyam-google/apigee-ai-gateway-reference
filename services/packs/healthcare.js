// Healthcare handlers and seed data for the industry-apis service (pack: industries/healthcare.json).
//
// Patient services at a fictional multi-clinic provider: appointments, referrals, refill status,
// billing statements, insurance claims and telehealth. No clinical detail beyond generic visit
// types. Story: Jamie Carter (PT-4001) had a telehealth follow-up on 2026-09-18 (APT-5002) that
// never connected (video platform incident INC-118) and was then charged a $30 no-show fee
// (STM-2201). The $120 urgent care copay from 2026-09-10 (claim CLM-7701) was charged twice
// (STM-2203). Refunding the $30 fee is within policy; refunding the $120 duplicate is over the
// $50 limit that Apigee enforces for Patient Support. The limit is not enforced here, so the
// gateway control stays visible: this service records whatever refund reaches it (up to the
// amount paid).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const providers = [
    { providerId: 'PRV-11', name: 'Dr. Ana Brooks', role: 'Family medicine', clinic: 'Northside Clinic' },
    { providerId: 'PRV-12', name: 'Dr. Omar Haddad', role: 'Family medicine', clinic: 'Riverside Clinic' },
    { providerId: 'PRV-21', name: 'Dr. Lena Park', role: 'Urgent care', clinic: 'Eastside Urgent Care' },
    { providerId: 'PRV-31', name: 'Chris Nolan, PT', role: 'Physical therapy', clinic: 'Northside Rehab Center' },
  ];
  const patients = [
    { patientId: 'PT-4001', name: 'Jamie Carter', email: 'jamie.carter@example.com', insurancePlan: 'Silver PPO (fictional)', memberId: 'MBR-88120431', primaryProviderId: 'PRV-11', preferredClinic: 'Northside Clinic', patientSince: '2021-03-15', status: 'Active' },
    { patientId: 'PT-4002', name: 'Morgan Diaz', email: 'morgan.diaz@example.com', insurancePlan: 'Gold HMO (fictional)', memberId: 'MBR-77310988', primaryProviderId: 'PRV-12', preferredClinic: 'Riverside Clinic', patientSince: '2019-11-02', status: 'Active' },
    { patientId: 'PT-4003', name: 'Taylor Nguyen', email: 'taylor.nguyen@example.com', insurancePlan: 'Bronze EPO (fictional)', memberId: 'MBR-66024517', primaryProviderId: 'PRV-11', preferredClinic: 'Northside Clinic', patientSince: '2024-06-20', status: 'Active' },
    { patientId: 'PT-4004', name: 'Riley Foster', email: 'riley.foster@example.com', insurancePlan: 'Self-pay', memberId: null, primaryProviderId: 'PRV-12', preferredClinic: 'Riverside Clinic', patientSince: '2026-02-11', status: 'Active' },
    { patientId: 'PT-4005', name: 'Avery Jameson', email: 'avery.jameson@example.com', insurancePlan: 'Silver PPO (fictional)', memberId: 'MBR-88455102', primaryProviderId: 'PRV-11', preferredClinic: 'Northside Clinic', patientSince: '2023-09-05', status: 'Inactive' },
  ];
  const appointments = [
    { appointmentId: 'APT-5001', patientId: 'PT-4001', providerId: 'PRV-21', visitType: 'Urgent care visit', mode: 'In-person', start: '2026-09-10 17:40', status: 'Completed', claimId: 'CLM-7701' },
    { appointmentId: 'APT-5002', patientId: 'PT-4001', providerId: 'PRV-11', visitType: 'Follow-up visit', mode: 'Telehealth', start: '2026-09-18 14:00', status: 'Marked no-show', note: 'Video session failed to connect (platform incident INC-118)', claimId: 'CLM-7702' },
    { appointmentId: 'APT-5003', patientId: 'PT-4001', providerId: 'PRV-11', visitType: 'Follow-up visit', mode: 'Telehealth', start: '2026-09-29 15:30', status: 'Scheduled', note: 'Rebooked after APT-5002' },
    { appointmentId: 'APT-5004', patientId: 'PT-4001', providerId: 'PRV-11', visitType: 'Lab work', mode: 'In-person', start: '2026-10-14 08:15', status: 'Scheduled' },
    { appointmentId: 'APT-5010', patientId: 'PT-4002', providerId: 'PRV-12', visitType: 'Annual wellness visit', mode: 'In-person', start: '2026-09-30 09:00', status: 'Scheduled' },
    { appointmentId: 'APT-5011', patientId: 'PT-4003', providerId: 'PRV-11', visitType: 'Follow-up visit', mode: 'Telehealth', start: '2026-10-02 11:00', status: 'Scheduled' },
  ];
  const slots = [
    { slotId: 'SLOT-9101', providerId: 'PRV-11', start: '2026-09-28 16:00', mode: 'Telehealth', visitType: 'Follow-up visit', booked: false },
    { slotId: 'SLOT-9104', providerId: 'PRV-11', start: '2026-09-30 09:30', mode: 'Telehealth', visitType: 'Follow-up visit', booked: false },
    { slotId: 'SLOT-9105', providerId: 'PRV-11', start: '2026-10-01 13:00', mode: 'In-person', visitType: 'Follow-up visit', booked: true },
    { slotId: 'SLOT-9106', providerId: 'PRV-11', start: '2026-10-06 10:00', mode: 'In-person', visitType: 'Annual wellness visit', booked: false },
    { slotId: 'SLOT-9201', providerId: 'PRV-12', start: '2026-10-01 08:30', mode: 'In-person', visitType: 'Annual wellness visit', booked: false },
    { slotId: 'SLOT-9301', providerId: 'PRV-31', start: '2026-10-05 17:00', mode: 'In-person', visitType: 'Physical therapy session', booked: false },
  ];
  const referrals = [
    { referralId: 'REF-3301', patientId: 'PT-4001', specialty: 'Physical Therapy', referredBy: 'Dr. Lena Park', receivingClinic: 'Northside Rehab Center', createdOn: '2026-09-10', visitsRequested: 6, authorizationStatus: 'Pending insurance authorization', authorizationExpectedBy: '2026-09-30', nextStep: 'Book the first session once authorization is approved (open slot SLOT-9301).' },
    { referralId: 'REF-3302', patientId: 'PT-4002', specialty: 'Imaging', referredBy: 'Dr. Omar Haddad', receivingClinic: 'Riverside Imaging Center', createdOn: '2026-09-02', visitsRequested: 1, authorizationStatus: 'Approved', authorizationNumber: 'AUTH-55190', nextStep: 'Patient to schedule with the imaging center.' },
  ];
  const prescriptions = [
    { prescriptionId: 'RX-8801', patientId: 'PT-4001', medication: 'Allergy relief tablet 10 mg', prescriber: 'Dr. Ana Brooks', refillsRemaining: 2, lastFilled: '2026-09-22', status: 'Ready for pickup', pharmacy: 'Northside Pharmacy' },
    { prescriptionId: 'RX-8802', patientId: 'PT-4001', medication: 'Vitamin D3 1000 IU', prescriber: 'Dr. Ana Brooks', refillsRemaining: 1, lastFilled: '2026-08-20', status: 'Active', pharmacy: 'Northside Pharmacy' },
    { prescriptionId: 'RX-8803', patientId: 'PT-4001', medication: 'Ibuprofen 600 mg', prescriber: 'Dr. Lena Park', refillsRemaining: 0, lastFilled: '2026-09-10', status: 'No refills left', pharmacy: 'Eastside Pharmacy' },
    { prescriptionId: 'RX-8810', patientId: 'PT-4002', medication: 'Allergy relief tablet 10 mg', prescriber: 'Dr. Omar Haddad', refillsRemaining: 3, lastFilled: '2026-09-01', status: 'Active', pharmacy: 'Riverside Pharmacy' },
  ];
  const statements = [
    { statementId: 'STM-2200', patientId: 'PT-4001', description: 'Office visit copay (2026-08-12, Dr. Ana Brooks)', amount: 25, status: 'Paid', paidOn: '2026-08-12' },
    { statementId: 'STM-2201', patientId: 'PT-4001', description: 'Missed-appointment (no-show) fee, telehealth visit 2026-09-18', amount: 30, status: 'Paid', paidOn: '2026-09-19', appointmentId: 'APT-5002' },
    { statementId: 'STM-2202', patientId: 'PT-4001', description: 'Urgent care copay (2026-09-10)', amount: 120, status: 'Paid', paidOn: '2026-09-10', claimId: 'CLM-7701' },
    { statementId: 'STM-2203', patientId: 'PT-4001', description: 'Urgent care copay (2026-09-10), duplicate charge', amount: 120, status: 'Paid', paidOn: '2026-09-11', claimId: 'CLM-7701', duplicateOf: 'STM-2202' },
    { statementId: 'STM-2204', patientId: 'PT-4001', description: 'Lab work, patient share (estimate)', amount: 45, status: 'Due', dueOn: '2026-10-20' },
    { statementId: 'STM-2210', patientId: 'PT-4002', description: 'Imaging, patient share', amount: 80, status: 'Paid', paidOn: '2026-09-05' },
  ].map((s) => ({ ...s, refunds: [] }));
  const claims = [
    { claimId: 'CLM-7701', patientId: 'PT-4001', visit: 'Urgent care visit, 2026-09-10', provider: 'Eastside Urgent Care', submittedOn: '2026-09-11', status: 'Processed', billedUsd: 420, allowedUsd: 300, planPaidUsd: 180, patientResponsibilityUsd: 120, note: 'Patient copay $120 (collected twice: STM-2202 and STM-2203).' },
    { claimId: 'CLM-7702', patientId: 'PT-4001', visit: 'Telehealth follow-up visit, 2026-09-18', provider: 'Northside Clinic', submittedOn: '2026-09-19', status: 'Voided', billedUsd: 0, allowedUsd: 0, planPaidUsd: 0, patientResponsibilityUsd: 0, note: 'Visit not completed; claim voided.' },
    { claimId: 'CLM-7710', patientId: 'PT-4002', visit: 'Imaging, 2026-09-04', provider: 'Riverside Imaging Center', submittedOn: '2026-09-05', status: 'Paid', billedUsd: 610, allowedUsd: 400, planPaidUsd: 320, patientResponsibilityUsd: 80 },
    { claimId: 'CLM-7711', patientId: 'PT-4003', visit: 'Office visit, 2026-09-15', provider: 'Northside Clinic', submittedOn: '2026-09-16', status: 'Denied', billedUsd: 180, allowedUsd: 0, planPaidUsd: 0, patientResponsibilityUsd: 0, denialReason: 'Coverage could not be verified; resubmission requested.' },
  ];
  const inquiries = [
    { inquiryId: 'INQ-6601', patientId: 'PT-4001', subject: 'Telehealth visit on 2026-09-18 never connected', statementId: null, priority: 'Medium', status: 'Open', openedOn: '2026-09-18' },
  ];
  return { providers, patients, appointments, slots, referrals, prescriptions, statements, claims, inquiries };
}

const findPatient = (db, id) => {
  const p = db.patients.find((x) => x.patientId === id);
  if (!p) throw new ToolError(404, 'NOT_FOUND', `Patient ${id} not found`);
  return p;
};
const provider = (db, id) => db.providers.find((p) => p.providerId === id) || { providerId: id, name: id };
const withProvider = (db, a) => {
  const p = provider(db, a.providerId);
  return { ...a, provider: p.name, clinic: p.clinic };
};
const refundable = (s) => money(s.amount - s.refunds.reduce((t, r) => t + r.amount, 0));
const maskMember = (m) => (m ? `${m.slice(0, 4)}****${m.slice(-3)}` : null);
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const SERVICE_LINES = ['Primary Care', 'Urgent Care', 'Orthopedics', 'Imaging', 'Physical Therapy'];

const handlers = {
  searchPatients(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.patients.filter((p) =>
      p.name.toLowerCase().includes(q) || p.patientId.toLowerCase() === q || p.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      patients: hits.map((p) => ({ patientId: p.patientId, name: p.name, email: maskEmail(p.email), preferredClinic: p.preferredClinic, status: p.status })),
    };
  },

  getPatientProfile(db, { patientId }) {
    const p = findPatient(db, patientId);
    const upcoming = db.appointments.filter((a) => a.patientId === p.patientId && a.status === 'Scheduled')
      .sort((a, b) => a.start.localeCompare(b.start));
    const due = db.statements.filter((s) => s.patientId === p.patientId && s.status === 'Due').reduce((t, s) => t + s.amount, 0);
    return {
      ...p, email: maskEmail(p.email), memberId: maskMember(p.memberId),
      primaryProvider: provider(db, p.primaryProviderId).name,
      upcomingAppointments: upcoming.map((a) => ({ appointmentId: a.appointmentId, visitType: a.visitType, mode: a.mode, start: a.start })),
      balanceDueUsd: money(due),
      openInquiries: db.inquiries.filter((i) => i.patientId === p.patientId && i.status === 'Open'),
    };
  },

  listAppointments(db, { patientId }) {
    const p = findPatient(db, patientId);
    return {
      patientId: p.patientId,
      appointments: db.appointments.filter((a) => a.patientId === p.patientId)
        .sort((a, b) => a.start.localeCompare(b.start)).map((a) => withProvider(db, a)),
      openSlotsWithPrimaryProvider: db.slots.filter((s) => s.providerId === p.primaryProviderId && !s.booked)
        .map((s) => withProvider(db, { slotId: s.slotId, providerId: s.providerId, start: s.start, mode: s.mode, visitType: s.visitType })),
    };
  },

  bookAppointment(db, { patientId, slotId, note = '' }) {
    const p = findPatient(db, patientId);
    const s = db.slots.find((x) => x.slotId === slotId);
    if (!s) throw new ToolError(404, 'NOT_FOUND', `Slot ${slotId} not found`);
    if (s.booked) throw new ToolError(409, 'SLOT_TAKEN', `${slotId} is already booked; pick another open slot`);
    if (p.status !== 'Active') throw new ToolError(409, 'PATIENT_INACTIVE', `${p.patientId} is inactive; reactivate the record first`);
    s.booked = true;
    const a = {
      appointmentId: `APT-${5020 + db.appointments.length}`, patientId: p.patientId, providerId: s.providerId,
      visitType: s.visitType, mode: s.mode, start: s.start, status: 'Scheduled', note: String(note).slice(0, 200), bookedOn: TODAY,
    };
    db.appointments.push(a);
    return { ...withProvider(db, a), reminder: 'Confirmation sent; reminder 24 hours before the visit.' };
  },

  rescheduleAppointment(db, { appointmentId, slotId, reason = '' }) {
    const a = db.appointments.find((x) => x.appointmentId === appointmentId);
    if (!a) throw new ToolError(404, 'NOT_FOUND', `Appointment ${appointmentId} not found`);
    if (a.status !== 'Scheduled') throw new ToolError(409, 'NOT_SCHEDULED', `${appointmentId} is ${a.status}; only scheduled appointments can be moved`);
    const s = db.slots.find((x) => x.slotId === slotId);
    if (!s) throw new ToolError(404, 'NOT_FOUND', `Slot ${slotId} not found`);
    if (s.booked) throw new ToolError(409, 'SLOT_TAKEN', `${slotId} is already booked; pick another open slot`);
    if (s.providerId !== a.providerId) throw new ToolError(409, 'DIFFERENT_PROVIDER', `${slotId} is with a different provider; book a new appointment instead`);
    const previousStart = a.start;
    s.booked = true;
    Object.assign(a, { start: s.start, mode: s.mode, rescheduledOn: TODAY, rescheduleReason: String(reason).slice(0, 200) });
    return { ...withProvider(db, a), previousStart };
  },

  getReferralStatus(db, { referralId }) {
    const r = db.referrals.find((x) => x.referralId === referralId);
    if (!r) throw new ToolError(404, 'NOT_FOUND', `Referral ${referralId} not found`);
    return r;
  },

  getRefillStatus(db, { patientId }) {
    const p = findPatient(db, patientId);
    return { patientId: p.patientId, prescriptions: db.prescriptions.filter((x) => x.patientId === p.patientId) };
  },

  requestPrescriptionRefill(db, { prescriptionId }) {
    const rx = db.prescriptions.find((x) => x.prescriptionId === prescriptionId);
    if (!rx) throw new ToolError(404, 'NOT_FOUND', `Prescription ${prescriptionId} not found`);
    if (rx.status === 'Ready for pickup' || rx.status === 'Refill requested') throw new ToolError(409, 'REFILL_IN_PROGRESS', `${prescriptionId} is already ${rx.status.toLowerCase()}`);
    if (rx.refillsRemaining < 1) throw new ToolError(409, 'NO_REFILLS_LEFT', `${prescriptionId} has no refills left; the prescriber must renew it`);
    rx.refillsRemaining -= 1;
    Object.assign(rx, { status: 'Refill requested', requestedOn: TODAY, readyBy: addDays(TODAY, 2) });
    return { prescriptionId, medication: rx.medication, status: rx.status, pharmacy: rx.pharmacy, readyBy: rx.readyBy, refillsRemaining: rx.refillsRemaining };
  },

  listPatientStatements(db, { patientId }) {
    const p = findPatient(db, patientId);
    return {
      patientId: p.patientId, currency: 'USD',
      statements: db.statements.filter((s) => s.patientId === p.patientId).map((s) => ({ ...s, refundableRemaining: s.status === 'Paid' ? refundable(s) : 0 })),
    };
  },

  refundPatientCharge(db, { statementId, amount, reason = '' }) {
    const s = db.statements.find((x) => x.statementId === statementId);
    if (!s) throw new ToolError(404, 'NOT_FOUND', `Statement ${statementId} not found`);
    if (s.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${statementId} is ${s.status}; only paid statements can be refunded`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(s);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_STATEMENT', `Only ${remaining} USD of ${statementId} can be refunded`);
    const r = {
      refundId: `PRF-${statementId.slice(4)}-${s.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: '5-7 business days to the original payment method',
    };
    s.refunds.push(r);
    return { statementId, patientId: s.patientId, description: s.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  getVisitClaimStatus(db, { claimId }) {
    const c = db.claims.find((x) => x.claimId === claimId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Claim ${claimId} not found`);
    return { ...c, currency: 'USD' };
  },

  openBillingInquiry(db, { patientId, subject, statementId, priority = 'Medium' }) {
    const p = findPatient(db, patientId);
    if (statementId && !db.statements.some((s) => s.statementId === statementId && s.patientId === p.patientId)) {
      throw new ToolError(404, 'NOT_FOUND', `Statement ${statementId} not found for ${p.patientId}`);
    }
    const i = {
      inquiryId: `INQ-${6601 + db.inquiries.length}`, patientId: p.patientId, subject: String(subject).slice(0, 120),
      statementId: statementId || null, priority, status: 'Open', openedOn: TODAY,
    };
    db.inquiries.push(i);
    return { ...i, firstResponseWithin: priority === 'High' ? '1 business day' : '3 business days' };
  },

  getTelehealthVisitLink(db, { appointmentId }) {
    const a = db.appointments.find((x) => x.appointmentId === appointmentId);
    if (!a) throw new ToolError(404, 'NOT_FOUND', `Appointment ${appointmentId} not found`);
    if (a.mode !== 'Telehealth') throw new ToolError(409, 'NOT_TELEHEALTH', `${appointmentId} is an in-person visit`);
    if (a.status !== 'Scheduled') throw new ToolError(409, 'NOT_SCHEDULED', `${appointmentId} is ${a.status}; no join link is available`);
    const p = provider(db, a.providerId);
    return {
      appointmentId, visitType: a.visitType, start: a.start, provider: p.name,
      joinUrl: `https://telehealth.example.com/visit/${appointmentId.toLowerCase()}`,
      checkInOpens: '15 minutes before the start time',
      deviceTestUrl: 'https://telehealth.example.com/device-test',
      fallback: 'If video does not connect within 5 minutes, the provider calls the phone number on file.',
    };
  },

  getAppointmentVolumeTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 41200, 2310, 9.4], ['2025-11', 39800, 2140, 9.8], ['2025-12', 37600, 1880, 10.6],
      ['2026-01', 44900, 2960, 11.2], ['2026-02', 42700, 2510, 10.1], ['2026-03', 43800, 2480, 9.7],
      ['2026-04', 42100, 2290, 9.1], ['2026-05', 41500, 2210, 8.8], ['2026-06', 40300, 2050, 8.5],
      ['2026-07', 40900, 2120, 8.9], ['2026-08', 43600, 2570, 9.6], ['2026-09', 45800, 2830, 10.3],
    ].slice(-months).map(([month, completedVisits, newPatients, avgDaysToNextAvailable]) => ({ month, completedVisits, newPatients, avgDaysToNextAvailable }));
    return {
      months: series.length, series,
      byServiceLine: [
        { serviceLine: 'Primary Care', share: 0.46 }, { serviceLine: 'Urgent Care', share: 0.22 },
        { serviceLine: 'Orthopedics', share: 0.12 }, { serviceLine: 'Imaging', share: 0.11 }, { serviceLine: 'Physical Therapy', share: 0.09 },
      ],
      trend: 'Fall volume up; days to next available creeping up in Primary Care.',
    };
  },

  getNoShowRates(_db, { period = 'last_30d' }) {
    const rows = [
      ['Primary Care', 'In-person', 6.8, 7.1, 3.2], ['Primary Care', 'Telehealth', 9.4, 5.9, 2.1],
      ['Urgent Care', 'In-person', 1.2, 1.3, 0.4], ['Orthopedics', 'In-person', 5.1, 5.4, 2.8],
      ['Imaging', 'In-person', 4.3, 4.6, 3.9], ['Physical Therapy', 'In-person', 11.2, 10.8, 4.4],
    ].map(([serviceLine, mode, noShowPct, previousPct, lateCancelPct]) => ({ serviceLine, mode, noShowPct, previousPct, lateCancelPct }));
    return {
      period, rates: rows,
      note: period === 'last_90d' ? '90-day view smooths the September telehealth incident.' : 'Telehealth no-shows up 3.5 pts after video incident INC-118 (sessions that never connected were marked no-show).',
    };
  },

  getReferralLeakageSummary(_db, { specialty }) {
    const all = [
      { specialty: 'Orthopedics', referrals: 1840, inNetworkPct: 78, avgDaysToAuthorization: 4.2 },
      { specialty: 'Imaging', referrals: 3120, inNetworkPct: 84, avgDaysToAuthorization: 2.1 },
      { specialty: 'Physical Therapy', referrals: 1460, inNetworkPct: 66, avgDaysToAuthorization: 6.8 },
      { specialty: 'Dermatology', referrals: 920, inNetworkPct: 58, avgDaysToAuthorization: 3.5 },
    ].map((r) => ({ ...r, outOfNetworkPct: 100 - r.inNetworkPct }));
    return { asOf: TODAY, specialties: specialty ? all.filter((r) => r.specialty === specialty) : all, note: 'Aggregated; no individual patient records.' };
  },

  getClaimDenialMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { claims: 118400, denialRatePct: 8.9, previousDenialRatePct: 8.4, daysInAR: 44 }
      : { claims: 40700, denialRatePct: 9.6, previousDenialRatePct: 8.7, daysInAR: 46 };
    return {
      period, ...p,
      topDenialReasons: [
        { reason: 'Eligibility / coverage not verified', sharePct: 31 }, { reason: 'Missing prior authorization', sharePct: 24 },
        { reason: 'Coding or documentation mismatch', sharePct: 19 }, { reason: 'Duplicate claim', sharePct: 9 }, { reason: 'Timely filing', sharePct: 5 },
      ],
      note: 'Aggregated; no individual claims.',
    };
  },

  getPatientSatisfactionScores(_db, { period = 'last_30d' }) {
    const rows = [
      ['Primary Care', 4.5, 52], ['Urgent Care', 4.1, 38], ['Orthopedics', 4.4, 49], ['Imaging', 4.6, 57], ['Physical Therapy', 4.7, 63],
    ].map(([serviceLine, avgRating, nps]) => ({ serviceLine, avgRating, nps }));
    return {
      period, responses: period === 'last_90d' ? 21400 : 7350, serviceLines: rows,
      byChannel: [{ channel: 'In-person', nps: 54 }, { channel: 'Telehealth', nps: period === 'last_90d' ? 47 : 39 }, { channel: 'Patient portal', nps: 44 }],
      topComplaint: 'Telehealth connection problems and billing clarity.',
    };
  },

  getTelehealthAdoption(_db, { period = 'last_30d' }) {
    return period === 'last_90d'
      ? { period, telehealthSharePct: 23, connectionSuccessPct: 96.1, avgVisitMinutes: 17, previousSharePct: 21, note: 'Steady growth in follow-up visits.' }
      : { period, telehealthSharePct: 22, connectionSuccessPct: 92.4, avgVisitMinutes: 16, previousSharePct: 24, note: 'Connection success dipped during incident INC-118 (2026-09-18).' };
  },

  getServiceLineMargins(_db, { serviceLine }) {
    const all = [
      { serviceLine: 'Primary Care', visits: 231000, netRevenueUsd: 38.2e6, operatingCostUsd: 35.1e6 },
      { serviceLine: 'Urgent Care', visits: 110400, netRevenueUsd: 24.6e6, operatingCostUsd: 20.3e6 },
      { serviceLine: 'Orthopedics', visits: 60200, netRevenueUsd: 41.8e6, operatingCostUsd: 30.9e6 },
      { serviceLine: 'Imaging', visits: 55100, netRevenueUsd: 33.5e6, operatingCostUsd: 22.7e6 },
      { serviceLine: 'Physical Therapy', visits: 45300, netRevenueUsd: 9.4e6, operatingCostUsd: 8.8e6 },
    ].map((s) => ({ ...s, marginPct: money(((s.netRevenueUsd - s.operatingCostUsd) / s.netRevenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', serviceLines: serviceLine ? all.filter((s) => s.serviceLine === serviceLine) : all };
  },

  runPatientVolumeForecast(_db, { horizonMonths = 3 }) {
    const monthsList = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].slice(0, horizonMonths);
    const base = { 'Primary Care': 21400, 'Urgent Care': 10300, Orthopedics: 5600, Imaging: 5100, 'Physical Therapy': 4200 };
    const seasonal = [1.02, 1.04, 0.97, 1.08, 1.03, 1.01];
    const forecast = monthsList.map((month, i) => {
      const byServiceLine = SERVICE_LINES.map((sl) => {
        const expected = Math.round(base[sl] * seasonal[i] * (1 + 0.01 * (i + 1)));
        return { serviceLine: sl, expected, low: Math.round(expected * 0.92), high: Math.round(expected * 1.07) };
      });
      return { month, total: byServiceLine.reduce((t, x) => t + x.expected, 0), byServiceLine };
    });
    return { horizonMonths, model: 'visit-demand v3 (demo)', forecast, driver: 'Respiratory season and January plan resets' };
  },
};

module.exports = { build, handlers, TODAY };
