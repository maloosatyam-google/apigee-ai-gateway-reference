// Education handlers and seed data for the industry-apis service (pack: industries/education.json).
//
// An online learning platform (EdTech). Story: Sam Rivera (STU-3001) is 62% through Applied
// Data Science (DS-201). Project 2 (SUB-8801) is overdue because the upload page failed
// (ticket TKT-6001), and the September instalment was charged twice (INV-5102, $120).
// Refunding the $30 late-enrolment fee (INV-5101) is within policy; refunding the $120
// duplicate is over the $50 limit that Apigee enforces for Student Services. The limit is not
// enforced here, so the gateway control stays visible: this service records whatever refund
// reaches it (up to the amount paid).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const students = [
    { studentId: 'STU-3001', name: 'Sam Rivera', email: 'sam.rivera@example.edu', programme: 'Data Science', cohort: '2026-Spring', status: 'Active', studentSince: '2025-09-02' },
    { studentId: 'STU-3002', name: 'Priya Nair', email: 'priya.nair@example.edu', programme: 'UX Design', cohort: '2026-Spring', status: 'Active', studentSince: '2026-01-12' },
    { studentId: 'STU-3003', name: 'Jordan Lee', email: 'jordan.lee@example.edu', programme: 'Cloud & DevOps', cohort: '2025-Fall', status: 'Active', studentSince: '2025-08-18' },
    { studentId: 'STU-3004', name: 'Mei Chen', email: 'mei.chen@example.edu', programme: 'Digital Marketing', cohort: '2026-Spring', status: 'Paused', studentSince: '2026-02-03' },
    { studentId: 'STU-3005', name: 'Samantha Okafor', email: 'samantha.okafor@example.edu', programme: 'Data Science', cohort: '2026-Fall', status: 'Active', studentSince: '2026-09-01' },
  ];
  const courses = [
    { courseId: 'DS-101', title: 'Python Foundations', programme: 'Data Science', format: 'Self-paced', instructor: 'Dr. Alex Morgan', weeks: 6, seats: 500, enrolled: 412, feeUsd: 240, prerequisites: [] },
    { courseId: 'DS-201', title: 'Applied Data Science', programme: 'Data Science', format: 'Cohort, live sessions Tue/Thu', instructor: 'Dr. Alex Morgan', weeks: 12, seats: 120, enrolled: 118, feeUsd: 480, prerequisites: ['DS-101'] },
    { courseId: 'CS-305', title: 'Cloud Architecture', programme: 'Cloud & DevOps', format: 'Cohort, live sessions Mon/Wed', instructor: 'Taylor Brooks', weeks: 10, seats: 80, enrolled: 71, feeUsd: 420, prerequisites: ['DS-101'] },
    { courseId: 'UX-110', title: 'UX Design Basics', programme: 'UX Design', format: 'Self-paced', instructor: 'Riley Chen', weeks: 8, seats: 300, enrolled: 244, feeUsd: 260, prerequisites: [] },
    { courseId: 'MKT-120', title: 'Digital Marketing Essentials', programme: 'Digital Marketing', format: 'Self-paced', instructor: 'Casey Patel', weeks: 6, seats: 300, enrolled: 187, feeUsd: 220, prerequisites: [] },
    { courseId: 'CS-410', title: 'Kubernetes in Production', programme: 'Cloud & DevOps', format: 'Cohort, live sessions Fri', instructor: 'Taylor Brooks', weeks: 8, seats: 40, enrolled: 40, feeUsd: 460, prerequisites: ['CS-305'] },
  ];
  const enrolments = [
    { enrolmentId: 'ENR-7001', studentId: 'STU-3001', courseId: 'DS-201', status: 'Active', progressPct: 62, enrolledOn: '2026-07-06', nextDeadline: '2026-09-28 (Project 2, overdue)' },
    { enrolmentId: 'ENR-7002', studentId: 'STU-3001', courseId: 'DS-101', status: 'Completed', progressPct: 100, enrolledOn: '2026-03-02', completedOn: '2026-04-20', finalGrade: 'A-' },
    { enrolmentId: 'ENR-7004', studentId: 'STU-3001', courseId: 'MKT-120', status: 'Active', progressPct: 8, enrolledOn: '2026-09-15', nextDeadline: '2026-10-02 (Module 1 quiz)' },
    { enrolmentId: 'ENR-7003', studentId: 'STU-3002', courseId: 'UX-110', status: 'Active', progressPct: 45, enrolledOn: '2026-08-04', nextDeadline: '2026-09-30 (Wireframe review)' },
    { enrolmentId: 'ENR-7005', studentId: 'STU-3003', courseId: 'CS-305', status: 'Active', progressPct: 70, enrolledOn: '2026-07-13', nextDeadline: '2026-10-01 (Lab 6)' },
  ];
  const submissions = [
    { submissionId: 'SUB-8799', studentId: 'STU-3001', courseId: 'DS-201', title: 'Quiz 3: Probability', dueDate: '2026-09-12', status: 'Graded', grade: 84 },
    { submissionId: 'SUB-8800', studentId: 'STU-3001', courseId: 'DS-201', title: 'Project 1: Exploratory analysis', dueDate: '2026-08-29', status: 'Graded', grade: 91 },
    { submissionId: 'SUB-8801', studentId: 'STU-3001', courseId: 'DS-201', title: 'Project 2: Regression model', dueDate: '2026-09-22', status: 'Overdue', grade: null, note: 'Upload failed on 2026-09-22 (see TKT-6001)' },
    { submissionId: 'SUB-8802', studentId: 'STU-3001', courseId: 'DS-201', title: 'Quiz 4: Model evaluation', dueDate: '2026-10-06', status: 'Not started', grade: null },
    { submissionId: 'SUB-8810', studentId: 'STU-3002', courseId: 'UX-110', title: 'Wireframe review', dueDate: '2026-09-30', status: 'Submitted', grade: null },
  ];
  const invoices = [
    { invoiceId: 'INV-5100', studentId: 'STU-3001', description: 'DS-201 instalment 3 of 4 (September)', amount: 120, status: 'Paid', paidOn: '2026-09-01' },
    { invoiceId: 'INV-5101', studentId: 'STU-3001', description: 'Late-enrolment fee (MKT-120)', amount: 30, status: 'Paid', paidOn: '2026-09-15' },
    { invoiceId: 'INV-5102', studentId: 'STU-3001', description: 'DS-201 instalment 3 of 4 (September), duplicate charge', amount: 120, status: 'Paid', paidOn: '2026-09-02', duplicateOf: 'INV-5100' },
    { invoiceId: 'INV-5099', studentId: 'STU-3001', description: 'DS-201 instalment 2 of 4 (August)', amount: 120, status: 'Paid', paidOn: '2026-08-01' },
    { invoiceId: 'INV-5110', studentId: 'STU-3002', description: 'UX-110 course fee', amount: 260, status: 'Paid', paidOn: '2026-08-04' },
  ].map((i) => ({ ...i, refunds: [] }));
  const tickets = [
    { ticketId: 'TKT-6001', studentId: 'STU-3001', subject: 'Project 2 upload fails with error 500', priority: 'High', status: 'Open', openedOn: '2026-09-22' },
  ];
  const certificates = [
    { certificateId: 'CERT-44120', studentId: 'STU-3001', courseId: 'DS-101', issuedOn: '2026-04-22', verificationCode: 'VX7-44120-DS101' },
  ];
  const applications = [
    { applicationId: 'APP-9001', applicant: 'Samantha Okafor', programme: 'Data Science (Professional Certificate)', term: '2026-Fall', stage: 'Documents review', missingDocuments: ['Transcript from previous college'], decisionBy: '2026-10-10' },
    { applicationId: 'APP-9002', applicant: 'Diego Alvarez', programme: 'Cloud & DevOps', term: '2026-Fall', stage: 'Offer made', missingDocuments: [], decisionBy: '2026-09-20', offerExpires: '2026-10-05' },
  ];
  return { students, courses, enrolments, submissions, invoices, tickets, certificates, applications };
}

const findStudent = (db, id) => {
  const s = db.students.find((x) => x.studentId === id);
  if (!s) throw new ToolError(404, 'NOT_FOUND', `Student ${id} not found`);
  return s;
};
const findCourse = (db, id) => {
  const c = db.courses.find((x) => x.courseId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Course ${id} not found`);
  return c;
};
const refundable = (i) => money(i.amount - i.refunds.reduce((s, r) => s + r.amount, 0));
const courseTitle = (db, id) => db.courses.find((c) => c.courseId === id)?.title || id;
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const PROGRAMMES = ['Data Science', 'Cloud & DevOps', 'UX Design', 'Digital Marketing'];

const handlers = {
  searchStudents(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.students.filter((s) =>
      s.name.toLowerCase().includes(q) || s.studentId.toLowerCase() === q || s.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      students: hits.map((s) => ({ studentId: s.studentId, name: s.name, email: maskEmail(s.email), programme: s.programme, status: s.status })),
    };
  },

  getStudentProfile(db, { studentId }) {
    const s = findStudent(db, studentId);
    const active = db.enrolments.filter((e) => e.studentId === s.studentId && e.status === 'Active');
    const owed = db.invoices.filter((i) => i.studentId === s.studentId && i.status === 'Due').reduce((t, i) => t + i.amount, 0);
    return {
      ...s, email: maskEmail(s.email),
      activeEnrolments: active.map((e) => ({ enrolmentId: e.enrolmentId, courseId: e.courseId, title: courseTitle(db, e.courseId), progressPct: e.progressPct })),
      balanceDueUsd: money(owed),
      openTickets: db.tickets.filter((t) => t.studentId === s.studentId && t.status === 'Open'),
    };
  },

  listEnrolments(db, { studentId }) {
    const s = findStudent(db, studentId);
    return {
      studentId: s.studentId,
      enrolments: db.enrolments.filter((e) => e.studentId === s.studentId).map((e) => ({ ...e, title: courseTitle(db, e.courseId) })),
    };
  },

  getCourseDetails(db, { courseId }) {
    const c = findCourse(db, courseId);
    return { ...c, currency: 'USD', seatsLeft: c.seats - c.enrolled, nextStart: c.format.startsWith('Cohort') ? '2026-10-12' : 'Any time' };
  },

  enrollInCourse(db, { studentId, courseId }) {
    const s = findStudent(db, studentId);
    const c = findCourse(db, courseId);
    if (db.enrolments.some((e) => e.studentId === s.studentId && e.courseId === c.courseId && e.status === 'Active')) {
      throw new ToolError(409, 'ALREADY_ENROLLED', `${s.studentId} is already enrolled in ${c.courseId}`);
    }
    const done = new Set(db.enrolments.filter((e) => e.studentId === s.studentId && e.status === 'Completed').map((e) => e.courseId));
    const missing = c.prerequisites.filter((p) => !done.has(p));
    if (missing.length) throw new ToolError(409, 'PREREQUISITES_MISSING', `${c.courseId} needs ${missing.join(', ')} first`);
    if (c.enrolled >= c.seats) throw new ToolError(409, 'COURSE_FULL', `${c.courseId} is full; the learner can join the waitlist`);
    c.enrolled += 1;
    const e = { enrolmentId: `ENR-${7001 + db.enrolments.length + 5}`, studentId: s.studentId, courseId: c.courseId, status: 'Active', progressPct: 0, enrolledOn: TODAY, nextDeadline: 'Orientation, 2026-10-12' };
    db.enrolments.push(e);
    const inv = { invoiceId: `INV-${5120 + db.invoices.length}`, studentId: s.studentId, description: `${c.courseId} course fee`, amount: c.feeUsd, status: 'Due', dueOn: '2026-10-09', refunds: [] };
    db.invoices.push(inv);
    return { ...e, title: c.title, invoice: { invoiceId: inv.invoiceId, amount: inv.amount, currency: 'USD', dueOn: inv.dueOn } };
  },

  dropCourse(db, { enrolmentId, reason = '' }) {
    const e = db.enrolments.find((x) => x.enrolmentId === enrolmentId);
    if (!e) throw new ToolError(404, 'NOT_FOUND', `Enrolment ${enrolmentId} not found`);
    if (e.status !== 'Active') throw new ToolError(409, 'NOT_ACTIVE', `${enrolmentId} is ${e.status}; only active enrolments can be dropped`);
    Object.assign(e, { status: 'Withdrawn', withdrawnOn: TODAY, withdrawReason: String(reason).slice(0, 200) });
    const c = findCourse(db, e.courseId);
    c.enrolled = Math.max(0, c.enrolled - 1);
    const refundEligible = e.progressPct <= 10;
    return { ...e, title: c.title, refundPolicy: refundEligible ? 'Within the 10% progress window: the course fee can be refunded.' : 'Past 10% progress: no course-fee refund.' };
  },

  getAssignmentStatus(db, { studentId, courseId }) {
    const s = findStudent(db, studentId);
    const c = findCourse(db, courseId);
    const subs = db.submissions.filter((x) => x.studentId === s.studentId && x.courseId === c.courseId);
    const graded = subs.filter((x) => typeof x.grade === 'number');
    return {
      studentId: s.studentId, courseId: c.courseId, title: c.title,
      assignments: subs,
      averageGrade: graded.length ? money(graded.reduce((t, x) => t + x.grade, 0) / graded.length) : null,
      nextDue: subs.filter((x) => x.status !== 'Graded' && x.status !== 'Submitted').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null,
    };
  },

  grantDeadlineExtension(db, { submissionId, days, reason = '' }) {
    const sub = db.submissions.find((x) => x.submissionId === submissionId);
    if (!sub) throw new ToolError(404, 'NOT_FOUND', `Submission ${submissionId} not found`);
    if (sub.status === 'Graded' || sub.status === 'Submitted') throw new ToolError(409, 'ALREADY_SUBMITTED', `${submissionId} is already ${sub.status.toLowerCase()}`);
    const from = sub.dueDate < TODAY ? TODAY : sub.dueDate;
    Object.assign(sub, { dueDate: addDays(from, days), status: 'Extended', extensionReason: String(reason).slice(0, 200) });
    return { submissionId, title: sub.title, newDueDate: sub.dueDate, status: sub.status, grantedOn: TODAY };
  },

  listInvoices(db, { studentId }) {
    const s = findStudent(db, studentId);
    return {
      studentId: s.studentId, currency: 'USD',
      invoices: db.invoices.filter((i) => i.studentId === s.studentId).map((i) => ({ ...i, refundableRemaining: refundable(i) })),
    };
  },

  issueTuitionRefund(db, { invoiceId, amount, reason = '' }) {
    const i = db.invoices.find((x) => x.invoiceId === invoiceId);
    if (!i) throw new ToolError(404, 'NOT_FOUND', `Invoice ${invoiceId} not found`);
    if (i.status !== 'Paid') throw new ToolError(409, 'NOT_PAID', `${invoiceId} is ${i.status}; only paid invoices can be refunded`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(i);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_INVOICE', `Only ${remaining} USD of ${invoiceId} can be refunded`);
    const r = {
      refundId: `RF-${invoiceId.slice(4)}-${i.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: '3-5 business days to the original card',
    };
    i.refunds.push(r);
    return { invoiceId, studentId: i.studentId, description: i.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  createSupportTicket(db, { studentId, subject, priority = 'Medium' }) {
    const s = findStudent(db, studentId);
    const t = { ticketId: `TKT-${6001 + db.tickets.length}`, studentId: s.studentId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.tickets.push(t);
    return { ...t, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  getCertificateStatus(db, { studentId, courseId }) {
    const s = findStudent(db, studentId);
    const c = findCourse(db, courseId);
    const cert = db.certificates.find((x) => x.studentId === s.studentId && x.courseId === c.courseId);
    if (cert) return { studentId: s.studentId, courseId: c.courseId, title: c.title, status: 'Issued', ...cert };
    const e = db.enrolments.find((x) => x.studentId === s.studentId && x.courseId === c.courseId);
    if (!e) return { studentId: s.studentId, courseId: c.courseId, title: c.title, status: 'Not enrolled' };
    return { studentId: s.studentId, courseId: c.courseId, title: c.title, status: 'Not yet earned', progressPct: e.progressPct, remaining: `Finish the course (${100 - e.progressPct}% left) with a passing grade in every project.` };
  },

  getApplicationStatus(db, { applicationId }) {
    const a = db.applications.find((x) => x.applicationId === applicationId);
    if (!a) throw new ToolError(404, 'NOT_FOUND', `Application ${applicationId} not found`);
    return a;
  },

  getEnrolmentTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 3120, 18400, 410], ['2025-11', 2980, 18650, 395], ['2025-12', 2410, 18320, 520],
      ['2026-01', 4870, 19880, 360], ['2026-02', 3940, 20640, 372], ['2026-03', 3510, 21100, 401],
      ['2026-04', 3220, 21260, 455], ['2026-05', 2990, 21180, 498], ['2026-06', 2760, 20910, 540],
      ['2026-07', 3380, 21340, 470], ['2026-08', 4120, 22480, 430], ['2026-09', 5260, 24110, 452],
    ].slice(-months).map(([month, newEnrolments, activeLearners, withdrawals]) => ({ month, newEnrolments, activeLearners, withdrawals }));
    return {
      months: series.length, series,
      byProgramme: [
        { programme: 'Data Science', share: 0.38 }, { programme: 'Cloud & DevOps', share: 0.27 },
        { programme: 'UX Design', share: 0.19 }, { programme: 'Digital Marketing', share: 0.16 },
      ],
      trend: 'Fall intake strongest in three years; Data Science leads growth.',
    };
  },

  getCourseCompletionRates(_db, { period = 'last_30d' }) {
    const rows = [
      ['DS-101', 78, 74, 91], ['DS-201', 61, 66, 84], ['CS-305', 69, 68, 88],
      ['UX-110', 72, 70, 93], ['MKT-120', 54, 58, 89], ['CS-410', 81, 79, 90],
    ].map(([courseId, completionPct, previousPct, passPct]) => ({ courseId, completionPct, previousPct, passPct }));
    return {
      period, courses: rows,
      note: period === 'last_90d' ? '90-day view smooths the September cohort start.' : 'DS-201 completion down 5 pts after the Project 2 upload outage.',
    };
  },

  getDropoutRiskSummary(_db, { programme }) {
    const all = [
      { programme: 'Data Science', atRisk: 412, atRiskPct: 6.1, topDrivers: ['Missed 2+ deadlines', 'No login in 10 days', 'Payment failed'] },
      { programme: 'Cloud & DevOps', atRisk: 238, atRiskPct: 4.4, topDrivers: ['Lab environment issues', 'No login in 10 days'] },
      { programme: 'UX Design', atRisk: 151, atRiskPct: 3.9, topDrivers: ['Portfolio review backlog', 'No login in 10 days'] },
      { programme: 'Digital Marketing', atRisk: 196, atRiskPct: 7.2, topDrivers: ['Self-paced drift', 'Payment failed'] },
    ];
    return { asOf: TODAY, programmes: programme ? all.filter((p) => p.programme === programme) : all, note: 'Aggregated; no individual learner records.' };
  },

  getAdmissionsFunnel(_db, { term = '2026-Fall' }) {
    const f = term === '2026-Spring'
      ? { applications: 6420, offers: 4180, acceptances: 3050, enrolled: 2810 }
      : { applications: 8910, offers: 5760, acceptances: 4390, enrolled: 3870 };
    return {
      term, ...f,
      offerRatePct: money((f.offers / f.applications) * 100),
      yieldPct: money((f.enrolled / f.offers) * 100),
      pendingDocuments: term === '2026-Fall' ? 312 : 0,
    };
  },

  getLearnerEngagement(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      weeklyActiveLearners: 17620,
      videoMinutesK: 2140 * f, forumPostsK: 38 * f, liveSessionAttendancePct: 71,
      mobileSharePct: 44,
      shift: 'Mobile up 6 pts; live-session attendance down 3 pts in cohort courses.',
    };
  },

  getAssessmentIntegrityMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { submissions: 142300, plagiarismPer1k: 6.2, aiWritingPer1k: 14.8, proctoringIncidentsPer1k: 2.1 }, previous: { submissions: 131900, plagiarismPer1k: 6.5, aiWritingPer1k: 9.7, proctoringIncidentsPer1k: 2.3 } }
      : { current: { submissions: 51200, plagiarismPer1k: 5.9, aiWritingPer1k: 16.3, proctoringIncidentsPer1k: 1.9 }, previous: { submissions: 47300, plagiarismPer1k: 6.4, aiWritingPer1k: 11.2, proctoringIncidentsPer1k: 2.2 } };
    return { period, ...p, note: 'AI-writing flags up sharply; plagiarism flat. Aggregated, no learner records.' };
  },

  getProgrammeProfitability(_db, { programme }) {
    const all = [
      { programme: 'Data Science', learners: 9160, revenueUsd: 21.4e6, deliveryCostUsd: 8.9e6, marketingCostUsd: 4.1e6 },
      { programme: 'Cloud & DevOps', learners: 6510, revenueUsd: 15.8e6, deliveryCostUsd: 7.2e6, marketingCostUsd: 2.9e6 },
      { programme: 'UX Design', learners: 4580, revenueUsd: 7.6e6, deliveryCostUsd: 3.1e6, marketingCostUsd: 1.8e6 },
      { programme: 'Digital Marketing', learners: 3860, revenueUsd: 5.2e6, deliveryCostUsd: 2.0e6, marketingCostUsd: 1.9e6 },
    ].map((p) => ({ ...p, marginPct: money(((p.revenueUsd - p.deliveryCostUsd - p.marketingCostUsd) / p.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', programmes: programme ? all.filter((p) => p.programme === programme) : all };
  },

  runEnrolmentForecast(_db, { horizonTerms = 2 }) {
    const terms = ['2027-Spring', '2027-Fall', '2028-Spring', '2028-Fall', '2029-Spring', '2029-Fall'].slice(0, horizonTerms);
    const base = { 'Data Science': 1520, 'Cloud & DevOps': 1080, 'UX Design': 760, 'Digital Marketing': 610 };
    const forecast = terms.map((term, i) => {
      const byProgramme = PROGRAMMES.map((p) => {
        const expected = Math.round(base[p] * (1 + 0.06 * (i + 1)));
        return { programme: p, expected, low: Math.round(expected * 0.88), high: Math.round(expected * 1.1) };
      });
      return { term, total: byProgramme.reduce((t, x) => t + x.expected, 0), byProgramme };
    });
    return { horizonTerms, model: 'cohort-flow v2 (demo)', forecast, driver: 'Strong Fall intake and Data Science demand' };
  },
};

module.exports = { build, handlers, TODAY };
