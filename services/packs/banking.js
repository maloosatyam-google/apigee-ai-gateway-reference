// Banking handlers and seed data for the industry-apis service (pack: industries/banking.json).
//
// Story: Jane Doe (CUST-2001) had her credit card CARD-4417 blocked after a disputed $249.99
// online charge (fraud alert FA-3301). She also has an auto loan (LN-5501) and a scheduled
// card payment (PAY-8802). A $30 late fee (FEE-7001) can be reversed within policy; waiving the $120
// annual fee (FEE-7002) is over the $50 limit that Apigee enforces for Support & Sales.
// The limit is not enforced here, so the gateway control stays visible: this service records
// whatever reversal reaches it (up to the fee amount).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const customers = [
    { customerId: 'CUST-2001', name: 'Jane Doe', email: 'jane.doe@example.com', segment: 'Premier', city: 'Springfield', customerSince: '2016-04-11', riskRating: 'Low' },
    { customerId: 'CUST-2002', name: 'John Smith', email: 'john.smith@example.com', segment: 'Affluent', city: 'Riverton', customerSince: '2019-08-02', riskRating: 'Low' },
    { customerId: 'CUST-2003', name: 'Maria Garcia', email: 'maria.garcia@example.com', segment: 'Mass', city: 'Lakeside', customerSince: '2021-01-19', riskRating: 'Medium' },
    { customerId: 'CUST-2004', name: 'Wei Chen', email: 'wei.chen@example.com', segment: 'Small Business', city: 'Fairview', customerSince: '2017-06-30', riskRating: 'Low' },
    { customerId: 'CUST-2005', name: 'Alex Johnson', email: 'alex.johnson@example.com', segment: 'Mass', city: 'Springfield', customerSince: '2023-03-07', riskRating: 'High' },
    { customerId: 'CUST-2006', name: 'Sam Taylor', email: 'sam.taylor@example.com', segment: 'Affluent', city: 'Brookfield', customerSince: '2020-10-14', riskRating: 'Low' },
    { customerId: 'CUST-2007', name: 'Chris Lee', email: 'chris.lee@example.com', segment: 'Mass', city: 'Riverton', customerSince: '2022-05-21', riskRating: 'Medium' },
    { customerId: 'CUST-2008', name: 'Pat Morgan', email: 'pat.morgan@example.com', segment: 'Premier', city: 'Lakeside', customerSince: '2014-12-01', riskRating: 'Low' },
  ];
  const accounts = [
    { accountId: 'ACC-3001', customerId: 'CUST-2001', type: 'Checking', balance: 4820.15, status: 'Open' },
    { accountId: 'ACC-3002', customerId: 'CUST-2001', type: 'Savings', balance: 18250.0, status: 'Open' },
    { accountId: 'ACC-3003', customerId: 'CUST-2002', type: 'Checking', balance: 9310.42, status: 'Open' },
    { accountId: 'ACC-3004', customerId: 'CUST-2003', type: 'Checking', balance: 612.08, status: 'Open' },
    { accountId: 'ACC-3005', customerId: 'CUST-2004', type: 'Business Checking', balance: 42780.9, status: 'Open' },
    { accountId: 'ACC-3006', customerId: 'CUST-2005', type: 'Checking', balance: -84.5, status: 'Overdrawn' },
    { accountId: 'ACC-3007', customerId: 'CUST-2006', type: 'Savings', balance: 27500.0, status: 'Open' },
    { accountId: 'ACC-3008', customerId: 'CUST-2007', type: 'Checking', balance: 1440.33, status: 'Open' },
    { accountId: 'ACC-3009', customerId: 'CUST-2008', type: 'Checking', balance: 15020.77, status: 'Open' },
  ];
  const cards = [
    { cardId: 'CARD-4417', customerId: 'CUST-2001', type: 'Credit', product: 'Rewards Platinum', last4: '4417', status: 'Blocked', blockReason: 'Suspicious activity', blockedOn: '2026-09-23', creditLimit: 10000, balance: 2349.99 },
    { cardId: 'CARD-4418', customerId: 'CUST-2001', type: 'Debit', product: 'Everyday Debit', last4: '4418', status: 'Active', blockReason: null, blockedOn: null, creditLimit: null, balance: null },
    { cardId: 'CARD-5120', customerId: 'CUST-2002', type: 'Credit', product: 'Rewards Gold', last4: '5120', status: 'Active', blockReason: null, blockedOn: null, creditLimit: 7500, balance: 1210.4 },
    { cardId: 'CARD-5231', customerId: 'CUST-2003', type: 'Credit', product: 'Classic', last4: '5231', status: 'Active', blockReason: null, blockedOn: null, creditLimit: 2000, balance: 1880.0 },
    { cardId: 'CARD-5342', customerId: 'CUST-2004', type: 'Credit', product: 'Business Card', last4: '5342', status: 'Active', blockReason: null, blockedOn: null, creditLimit: 25000, balance: 6420.15 },
    { cardId: 'CARD-5453', customerId: 'CUST-2005', type: 'Credit', product: 'Classic', last4: '5453', status: 'Active', blockReason: null, blockedOn: null, creditLimit: 1500, balance: 1492.3 },
  ];
  const transactions = [
    { txnId: 'TXN-9001', customerId: 'CUST-2001', date: '2026-09-24', description: 'Late payment fee', amount: 30, type: 'Fee', cardId: 'CARD-4417', feeId: 'FEE-7001', disputed: false },
    { txnId: 'TXN-9002', customerId: 'CUST-2001', date: '2026-09-22', description: 'ELECTROSHOP ONLINE', amount: 249.99, type: 'Purchase', cardId: 'CARD-4417', feeId: null, disputed: true },
    { txnId: 'TXN-9003', customerId: 'CUST-2001', date: '2026-09-21', description: 'City Grocers', amount: 86.4, type: 'Purchase', cardId: 'CARD-4417', feeId: null, disputed: false },
    { txnId: 'TXN-9004', customerId: 'CUST-2001', date: '2026-09-20', description: 'Metro Transit', amount: 2.75, type: 'Purchase', cardId: 'CARD-4418', feeId: null, disputed: false },
    { txnId: 'TXN-9005', customerId: 'CUST-2001', date: '2026-09-18', description: 'Corner Cafe', amount: 6.5, type: 'Purchase', cardId: 'CARD-4418', feeId: null, disputed: false },
    { txnId: 'TXN-9006', customerId: 'CUST-2001', date: '2026-09-15', description: 'Annual card fee', amount: 120, type: 'Fee', cardId: 'CARD-4417', feeId: 'FEE-7002', disputed: false },
    { txnId: 'TXN-9007', customerId: 'CUST-2001', date: '2026-09-12', description: 'Payroll deposit', amount: -3200, type: 'Credit', cardId: null, feeId: null, disputed: false },
    { txnId: 'TXN-9008', customerId: 'CUST-2001', date: '2026-09-10', description: 'Online Bookstore', amount: 38.2, type: 'Purchase', cardId: 'CARD-4417', feeId: null, disputed: false },
    { txnId: 'TXN-9009', customerId: 'CUST-2001', date: '2026-09-05', description: 'Home Utilities', amount: 142.6, type: 'Bill payment', cardId: null, feeId: null, disputed: false },
    { txnId: 'TXN-9010', customerId: 'CUST-2002', date: '2026-09-23', description: 'Airline Tickets', amount: 612.0, type: 'Purchase', cardId: 'CARD-5120', feeId: null, disputed: false },
    { txnId: 'TXN-9011', customerId: 'CUST-2003', date: '2026-09-19', description: 'Overlimit fee', amount: 25, type: 'Fee', cardId: 'CARD-5231', feeId: 'FEE-7003', disputed: false },
    { txnId: 'TXN-9012', customerId: 'CUST-2005', date: '2026-09-17', description: 'Overdraft fee', amount: 35, type: 'Fee', cardId: null, feeId: 'FEE-7004', disputed: false },
  ];
  const fees = transactions
    .filter((t) => t.feeId)
    .map((t) => ({ feeId: t.feeId, customerId: t.customerId, description: t.description, amount: t.amount, chargedOn: t.date, reversals: [] }));
  const serviceRequests = [
    { requestId: 'SR-6001', customerId: 'CUST-2001', subject: 'Dispute: ELECTROSHOP ONLINE $249.99', priority: 'High', status: 'Open', openedOn: '2026-09-23' },
    { requestId: 'SR-6002', customerId: 'CUST-2003', subject: 'Credit limit increase request', priority: 'Low', status: 'Open', openedOn: '2026-09-20' },
  ];
  const payments = [
    { paymentId: 'PAY-8801', customerId: 'CUST-2001', type: 'Transfer', fromAccount: 'ACC-3001', payee: 'Own savings (ACC-3002)', amount: 500, status: 'Completed', scheduledFor: '2026-09-15', sentOn: '2026-09-15' },
    { paymentId: 'PAY-8802', customerId: 'CUST-2001', type: 'Card payment', fromAccount: 'ACC-3001', payee: 'Rewards Platinum card (CARD-4417)', amount: 2349.99, status: 'Scheduled', scheduledFor: '2026-10-05', sentOn: null, note: 'Card is blocked; payment will post to the replacement card' },
    { paymentId: 'PAY-8803', customerId: 'CUST-2004', type: 'Wire', fromAccount: 'ACC-3005', payee: 'Northwind Supplies', amount: 12800, status: 'Pending review', scheduledFor: '2026-09-25', sentOn: null },
  ];
  const loans = [
    { loanId: 'LN-5501', customerId: 'CUST-2001', product: 'Auto', originalAmount: 24000, balance: 13482.6, ratePct: 6.4, monthlyPayment: 468.12, lastPaymentOn: '2026-09-10', nextPaymentDue: '2026-10-10', maturity: '2029-06-10', status: 'Current', daysPastDue: 0 },
    { loanId: 'LN-5502', customerId: 'CUST-2002', product: 'Mortgage', originalAmount: 420000, balance: 356210.44, ratePct: 5.1, monthlyPayment: 2280.5, lastPaymentOn: '2026-09-01', nextPaymentDue: '2026-10-01', maturity: '2051-03-01', status: 'Current', daysPastDue: 0 },
    { loanId: 'LN-5503', customerId: 'CUST-2005', product: 'Personal', originalAmount: 8000, balance: 5120.0, ratePct: 13.9, monthlyPayment: 272.4, lastPaymentOn: '2026-07-20', nextPaymentDue: '2026-08-20', maturity: '2028-08-20', status: 'Delinquent', daysPastDue: 36 },
  ];
  const fraudAlerts = [
    { alertId: 'FA-3301', customerId: 'CUST-2001', cardId: 'CARD-4417', txnId: 'TXN-9002', raisedOn: '2026-09-22', riskScore: 0.91, reasons: ['Card not present', 'New merchant', 'Amount 6x typical'], status: 'Open', resolution: null },
    { alertId: 'FA-3302', customerId: 'CUST-2006', cardId: null, txnId: null, raisedOn: '2026-09-14', riskScore: 0.64, reasons: ['New device login'], status: 'Closed', resolution: 'Genuine transaction' },
  ];
  return { customers, accounts, cards, transactions, fees, serviceRequests, payments, loans, fraudAlerts };
}

const findCustomer = (db, id) => {
  const c = db.customers.find((x) => x.customerId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Customer ${id} not found`);
  return c;
};
const findCard = (db, id) => {
  const c = db.cards.find((x) => x.cardId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Card ${id} not found`);
  return c;
};
const cardView = (c) => ({
  cardId: c.cardId, type: c.type, product: c.product, last4: c.last4, status: c.status,
  blockReason: c.blockReason, blockedOn: c.blockedOn,
  ...(c.creditLimit ? { creditLimit: c.creditLimit, balance: c.balance, availableCredit: money(c.creditLimit - c.balance) } : {}),
});
const feeRemaining = (f) => money(f.amount - f.reversals.reduce((s, r) => s + r.amount, 0));

const handlers = {
  searchCustomers(db, { query }) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_QUERY', 'query must be at least 2 characters');
    const hits = db.customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.customerId.toLowerCase() === q || c.email.startsWith(q),
    );
    return {
      count: hits.length,
      customers: hits.slice(0, 10).map((c) => ({ customerId: c.customerId, name: c.name, email: maskEmail(c.email), segment: c.segment, city: c.city })),
    };
  },

  getAccountSummary(db, { customerId }) {
    const c = findCustomer(db, customerId);
    return {
      customerId: c.customerId, name: c.name, email: maskEmail(c.email), segment: c.segment, city: c.city, customerSince: c.customerSince,
      accounts: db.accounts.filter((a) => a.customerId === c.customerId).map(({ customerId: _, ...a }) => ({ ...a, currency: 'USD' })),
      cards: db.cards.filter((k) => k.customerId === c.customerId).map(cardView),
      openServiceRequests: db.serviceRequests
        .filter((r) => r.customerId === c.customerId && r.status === 'Open')
        .map(({ requestId, subject, priority, openedOn }) => ({ requestId, subject, priority, openedOn })),
    };
  },

  listRecentTransactions(db, { customerId, limit = 10 }) {
    const c = findCustomer(db, customerId);
    const txns = db.transactions
      .filter((t) => t.customerId === c.customerId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
      .map(({ customerId: _, feeId, ...t }) => {
        const out = { ...t, currency: 'USD' };
        if (feeId) {
          const f = db.fees.find((x) => x.feeId === feeId);
          Object.assign(out, { feeId, reversibleRemaining: feeRemaining(f) });
        }
        return out;
      });
    return { customerId: c.customerId, count: txns.length, transactions: txns };
  },

  getCardStatus(db, { cardId }) {
    const k = findCard(db, cardId);
    const disputed = db.transactions.filter((t) => t.cardId === k.cardId && t.disputed);
    return {
      ...cardView(k), customerId: k.customerId, currency: 'USD',
      disputedTransactions: disputed.map(({ txnId, date, description, amount }) => ({ txnId, date, description, amount })),
    };
  },

  blockCard(db, { cardId, reason }) {
    const k = findCard(db, cardId);
    if (k.status === 'Blocked') {
      return { cardId: k.cardId, status: 'Blocked', alreadyBlocked: true, blockReason: k.blockReason, blockedOn: k.blockedOn };
    }
    Object.assign(k, { status: 'Blocked', blockReason: reason, blockedOn: TODAY });
    return { cardId: k.cardId, status: 'Blocked', alreadyBlocked: false, blockReason: reason, blockedOn: TODAY, replacementCard: 'Ordered, arrives in 3-5 business days' };
  },

  createServiceRequest(db, { customerId, subject, priority = 'Medium' }) {
    const c = findCustomer(db, customerId);
    const r = {
      requestId: `SR-${6001 + db.serviceRequests.length}`, customerId: c.customerId,
      subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY,
    };
    db.serviceRequests.push(r);
    return r;
  },

  reverseFee(db, { feeId, amount, reason = '' }) {
    const f = db.fees.find((x) => x.feeId === feeId);
    if (!f) throw new ToolError(404, 'NOT_FOUND', `Fee ${feeId} not found`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = feeRemaining(f);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_FEE', `Only ${remaining} USD of ${feeId} can be reversed`);
    const rev = {
      reversalId: `REV-${feeId.slice(4)}-${f.reversals.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY,
    };
    f.reversals.push(rev);
    return { feeId, customerId: f.customerId, description: f.description, ...rev, reversibleRemaining: money(remaining - amount) };
  },

  getPaymentStatus(db, { paymentId }) {
    const p = db.payments.find((x) => x.paymentId === paymentId);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `Payment ${paymentId} not found`);
    return { ...p, currency: 'USD' };
  },

  cancelScheduledPayment(db, { paymentId, reason = '' }) {
    const p = db.payments.find((x) => x.paymentId === paymentId);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `Payment ${paymentId} not found`);
    if (p.status !== 'Scheduled') throw new ToolError(409, 'NOT_CANCELLABLE', `${paymentId} is ${p.status}; only scheduled payments can be cancelled`);
    Object.assign(p, { status: 'Cancelled', cancelledOn: TODAY, cancelReason: String(reason).slice(0, 200) });
    return { ...p, currency: 'USD' };
  },

  getLoanDetails(db, { loanId }) {
    const l = db.loans.find((x) => x.loanId === loanId);
    if (!l) throw new ToolError(404, 'NOT_FOUND', `Loan ${loanId} not found`);
    return { ...l, currency: 'USD', paidOffPct: money((1 - l.balance / l.originalAmount) * 100) };
  },

  getLoanPayoffQuote(db, { loanId, payoffDate = '2026-10-01' }) {
    const l = db.loans.find((x) => x.loanId === loanId);
    if (!l) throw new ToolError(404, 'NOT_FOUND', `Loan ${loanId} not found`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payoffDate) || payoffDate < TODAY) {
      throw new ToolError(400, 'INVALID_ARGUMENT', `payoffDate must be YYYY-MM-DD on or after ${TODAY}`);
    }
    const days = Math.round((Date.parse(payoffDate) - Date.parse(l.lastPaymentOn)) / 86400000);
    const perDiem = money((l.balance * l.ratePct) / 100 / 365);
    const interest = money(perDiem * days);
    return {
      loanId, payoffDate, currency: 'USD', principal: l.balance, accruedInterest: interest, perDiemInterest: perDiem,
      daysOfInterest: days, prepaymentFee: 0, payoffAmount: money(l.balance + interest), validUntil: payoffDate,
    };
  },

  listFraudAlerts(db, { customerId }) {
    const c = findCustomer(db, customerId);
    const alerts = db.fraudAlerts.filter((a) => a.customerId === c.customerId).map(({ customerId: _, ...a }) => {
      const t = a.txnId && db.transactions.find((x) => x.txnId === a.txnId);
      return t ? { ...a, transaction: { date: t.date, description: t.description, amount: t.amount } } : a;
    });
    return { customerId: c.customerId, open: alerts.filter((a) => a.status === 'Open').length, alerts };
  },

  resolveFraudAlert(db, { alertId, resolution }) {
    const a = db.fraudAlerts.find((x) => x.alertId === alertId);
    if (!a) throw new ToolError(404, 'NOT_FOUND', `Alert ${alertId} not found`);
    if (a.status !== 'Open') throw new ToolError(409, 'ALREADY_RESOLVED', `${alertId} was already resolved: ${a.resolution}`);
    Object.assign(a, { status: 'Closed', resolution, resolvedOn: TODAY });
    const next = resolution === 'Confirmed fraud'
      ? 'Charge moved to fraud claims; the customer is not liable. Keep the card blocked and issue a replacement.'
      : 'Alert closed. The card can be unblocked if the customer asks.';
    return { alertId, status: a.status, resolution, resolvedOn: TODAY, nextStep: next };
  },

  getDisputeMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { disputes: 1284, per1kTransactions: 1.9, avgResolutionDays: 11.2, writtenOffUsd: 48210 }, previous: { disputes: 1046, per1kTransactions: 1.6, avgResolutionDays: 9.8, writtenOffUsd: 39870 } }
      : { current: { disputes: 472, per1kTransactions: 2.1, avgResolutionDays: 12.4, writtenOffUsd: 18940 }, previous: { disputes: 361, per1kTransactions: 1.6, avgResolutionDays: 9.6, writtenOffUsd: 13120 } };
    return {
      period, currency: 'USD', ...p,
      changePct: money(((p.current.disputes - p.previous.disputes) / p.previous.disputes) * 100),
      topMerchantCategories: [
        { category: 'Online electronics', share: 0.34 },
        { category: 'Travel', share: 0.18 },
        { category: 'Subscriptions', share: 0.15 },
        { category: 'Food delivery', share: 0.09 },
      ],
      note: 'Aggregated across the card portfolio; no individual customer records.',
    };
  },

  getDelinquencyTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 2.1, 0.8, 1.6], ['2025-11', 2.0, 0.8, 1.6], ['2025-12', 2.2, 0.8, 1.7],
      ['2026-01', 2.3, 0.9, 1.7], ['2026-02', 2.3, 0.9, 1.8], ['2026-03', 2.2, 0.9, 1.8],
      ['2026-04', 2.4, 0.9, 1.8], ['2026-05', 2.5, 1.0, 1.9], ['2026-06', 2.6, 1.0, 1.9],
      ['2026-07', 2.8, 1.1, 2.0], ['2026-08', 3.0, 1.1, 2.0], ['2026-09', 3.2, 1.2, 2.1],
    ].slice(-months).map(([month, cards30, cards90, loans30]) => ({ month, cardsDpd30Pct: cards30, cardsDpd90Pct: cards90, personalLoansDpd30Pct: loans30 }));
    return { months: series.length, series, trend: 'Card 30+ DPD rising for 5 straight months; personal loans stable.' };
  },

  getSegmentProfitability(_db, { segment }) {
    const all = [
      { segment: 'Mass', customers: 412000, revenueUsd: 186.4e6, costToServeUsd: 98.2e6, creditLossesUsd: 41.7e6 },
      { segment: 'Affluent', customers: 96000, revenueUsd: 142.9e6, costToServeUsd: 44.1e6, creditLossesUsd: 12.3e6 },
      { segment: 'Premier', customers: 21000, revenueUsd: 118.6e6, costToServeUsd: 31.8e6, creditLossesUsd: 4.9e6 },
      { segment: 'Small Business', customers: 38000, revenueUsd: 97.2e6, costToServeUsd: 39.5e6, creditLossesUsd: 15.8e6 },
    ].map((s) => ({ ...s, marginPct: money(((s.revenueUsd - s.costToServeUsd - s.creditLossesUsd) / s.revenueUsd) * 100) }));
    const rows = segment ? all.filter((s) => s.segment === segment) : all;
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', segments: rows };
  },

  getDepositTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 18.2, 24.1, 9.4], ['2025-11', 18.4, 24.3, 9.6], ['2025-12', 18.9, 24.2, 9.9],
      ['2026-01', 18.6, 24.6, 10.3], ['2026-02', 18.5, 24.9, 10.8], ['2026-03', 18.7, 25.1, 11.2],
      ['2026-04', 18.4, 25.4, 11.7], ['2026-05', 18.1, 25.6, 12.3], ['2026-06', 17.9, 25.7, 12.9],
      ['2026-07', 17.6, 25.8, 13.4], ['2026-08', 17.4, 25.9, 13.9], ['2026-09', 17.2, 26.0, 14.3],
    ].slice(-months).map(([month, checking, savings, term]) => ({ month, checkingUsdBn: checking, savingsUsdBn: savings, termDepositsUsdBn: term }));
    return { months: series.length, currency: 'USD', series, trend: 'Money moving from checking into term deposits as rates stay high.' };
  },

  getLoanPortfolioSummary(_db, { product }) {
    const all = [
      { product: 'Auto', balanceUsdM: 3120, avgRatePct: 6.8, originationsUsdM30d: 142, prepaymentsUsdM30d: 38, dpd30Pct: 1.9 },
      { product: 'Mortgage', balanceUsdM: 18450, avgRatePct: 5.3, originationsUsdM30d: 410, prepaymentsUsdM30d: 96, dpd30Pct: 0.7 },
      { product: 'Personal', balanceUsdM: 1260, avgRatePct: 12.9, originationsUsdM30d: 88, prepaymentsUsdM30d: 21, dpd30Pct: 3.4 },
      { product: 'Small Business', balanceUsdM: 2840, avgRatePct: 8.1, originationsUsdM30d: 115, prepaymentsUsdM30d: 19, dpd30Pct: 2.2 },
    ];
    return { currency: 'USD', asOf: TODAY, products: product ? all.filter((x) => x.product === product) : all };
  },

  getChannelUsage(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      transactionsM: { mobile: 41.2 * f, web: 12.6 * f, branch: 2.1 * f, atm: 6.4 * f },
      serviceContactsK: { chat: 188 * f, contactCenter: 142 * f, branch: 61 * f, email: 24 * f },
      shift: 'Mobile up 4 pts vs last period; branch transactions down 9%.',
    };
  },

  getFraudLossMetrics(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { current: { alerts: 9120, confirmedFraudPct: 18.4, lossesUsd: 1.92e6 }, previous: { alerts: 8210, confirmedFraudPct: 16.9, lossesUsd: 1.61e6 } }
      : { current: { alerts: 3310, confirmedFraudPct: 19.8, lossesUsd: 0.71e6 }, previous: { alerts: 2890, confirmedFraudPct: 17.1, lossesUsd: 0.55e6 } };
    return {
      period, currency: 'USD', ...p,
      byChannel: [
        { channel: 'Card not present', share: 0.58 }, { channel: 'Account takeover', share: 0.21 },
        { channel: 'Card present', share: 0.12 }, { channel: 'Check', share: 0.09 },
      ],
      note: 'Aggregated; no individual customer records.',
    };
  },

  runCreditLossForecast(_db, { horizonMonths = 3 }) {
    const base = 6.9e6;
    const forecast = Array.from({ length: horizonMonths }, (_, i) => {
      const expected = Math.round(base * (1 + 0.035 * (i + 1)));
      const d = new Date(Date.UTC(2026, 9 + i, 1)); // October 2026 onwards
      return { month: d.toISOString().slice(0, 7), expectedLossUsd: expected, low: Math.round(expected * 0.9), high: Math.round(expected * 1.12) };
    });
    return { portfolio: 'Cards', currency: 'USD', horizonMonths, model: 'roll-rate v3 (demo)', forecast, driver: 'Rising 30+ DPD and online-electronics disputes' };
  },
};

module.exports = { build, handlers, TODAY };
