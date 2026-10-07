// Retail handlers and seed data for the industry-apis service (pack: industries/retail.json).
//
// An omnichannel fashion and home retailer (stores + online, store pickup, loyalty, gift
// cards). Story: Morgan Blake (MEM-4001), a Gold loyalty member, had home order WEB-58210
// arrive two days late despite paying for express shipping, and the ceramic table lamp in it
// arrived cracked (LN-60013, $120, case CASE-3101). Store-pickup order WEB-58244 at the
// Riverside store is ready but the hold expires tomorrow while Morgan is travelling.
// Refunding the $30 express shipping fee (LN-60011) is within policy; refunding the $120 lamp
// is over the $50 limit that Apigee enforces for Customer Service. The limit is not enforced
// here, so the gateway control stays visible: this service records whatever refund reaches
// it (up to the amount paid for the line).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const shoppers = [
    { customerId: 'MEM-4001', name: 'Morgan Blake', email: 'morgan.blake@example.com', tier: 'Gold', points: 8420, homeStoreId: 'STR-12', memberSince: '2021-04-17', status: 'Active' },
    { customerId: 'MEM-4002', name: 'Riley Santos', email: 'riley.santos@example.com', tier: 'Silver', points: 2310, homeStoreId: 'STR-07', memberSince: '2023-11-02', status: 'Active' },
    { customerId: 'MEM-4003', name: 'Avery Thompson', email: 'avery.thompson@example.com', tier: 'Bronze', points: 640, homeStoreId: 'STR-12', memberSince: '2025-06-21', status: 'Active' },
    { customerId: 'MEM-4004', name: 'Morgan Ellis', email: 'morgan.ellis@example.com', tier: 'Silver', points: 3975, homeStoreId: 'STR-19', memberSince: '2022-02-08', status: 'Active' },
    { customerId: 'MEM-4005', name: 'Jamie Park', email: 'jamie.park@example.com', tier: 'Platinum', points: 21560, homeStoreId: 'STR-07', memberSince: '2019-09-30', status: 'Active' },
    { customerId: 'MEM-4006', name: 'Casey Nguyen', email: 'casey.nguyen@example.com', tier: 'Bronze', points: 120, homeStoreId: 'STR-19', memberSince: '2026-08-14', status: 'Suspended' },
  ];
  const stores = [
    { storeId: 'STR-07', name: 'Downtown', city: 'Lakeview', hours: '9:00-21:00' },
    { storeId: 'STR-12', name: 'Riverside', city: 'Lakeview', hours: '10:00-20:00' },
    { storeId: 'STR-19', name: 'Northgate Mall', city: 'Fairmont', hours: '10:00-21:00' },
  ];
  const products = [
    { sku: 'HD-LAMP-CER', name: 'Ceramic table lamp, sage', category: 'Home Decor', price: 120, stock: { 'STR-07': 3, 'STR-12': 0, 'STR-19': 1, ONLINE: 42 } },
    { sku: 'BB-DUVET-LIN-Q', name: 'Linen duvet cover, queen, oat', category: 'Bedding & Bath', price: 89, stock: { 'STR-07': 6, 'STR-12': 4, 'STR-19': 2, ONLINE: 118 } },
    { sku: 'WW-COAT-WOOL-M', name: 'Wool-blend wrap coat, camel, M', category: 'Womenswear', price: 180, stock: { 'STR-07': 2, 'STR-12': 1, 'STR-19': 0, ONLINE: 27 } },
    { sku: 'FW-BOOT-ANK-8', name: 'Leather ankle boots, black, size 8', category: 'Footwear', price: 140, stock: { 'STR-07': 5, 'STR-12': 0, 'STR-19': 3, ONLINE: 64 } },
    { sku: 'MW-KNIT-MER-L', name: 'Merino crew knit, navy, L', category: 'Menswear', price: 65, stock: { 'STR-07': 9, 'STR-12': 7, 'STR-19': 4, ONLINE: 210 } },
    { sku: 'HD-THROW-BOU', name: 'Boucle throw blanket, ivory', category: 'Home Decor', price: 55, stock: { 'STR-07': 0, 'STR-12': 0, 'STR-19': 0, ONLINE: 0 }, restockDate: '2026-10-09' },
  ];
  const orders = [
    { orderId: 'WEB-58210', customerId: 'MEM-4001', placedOn: '2026-09-17', channel: 'Online', fulfilment: 'Ship to home', status: 'Delivered', promisedBy: '2026-09-19', deliveredOn: '2026-09-21', payment: 'Visa ending 4417' },
    { orderId: 'WEB-58244', customerId: 'MEM-4001', placedOn: '2026-09-20', channel: 'Online', fulfilment: 'Store pickup', status: 'Ready for pickup', payment: 'Gift card GC-7731-0042 + Visa ending 4417',
      pickup: { storeId: 'STR-12', readyOn: '2026-09-22', holdUntil: '2026-09-26', pickupCode: 'Sent by SMS', extensions: 0 } },
    { orderId: 'POS-31877', customerId: 'MEM-4001', placedOn: '2026-08-30', channel: 'Store STR-12', fulfilment: 'In store', status: 'Completed', payment: 'Visa ending 4417' },
    { orderId: 'WEB-58190', customerId: 'MEM-4002', placedOn: '2026-09-14', channel: 'Online', fulfilment: 'Ship to home', status: 'In transit', promisedBy: '2026-09-26', payment: 'Mastercard ending 2208' },
    { orderId: 'WEB-58261', customerId: 'MEM-4005', placedOn: '2026-09-23', channel: 'Online', fulfilment: 'Store pickup', status: 'Picking', payment: 'Amex ending 1009',
      pickup: { storeId: 'STR-07', readyOn: null, holdUntil: null, pickupCode: 'Not yet issued', extensions: 0 } },
    { orderId: 'WEB-58102', customerId: 'MEM-4004', placedOn: '2026-09-05', channel: 'Online', fulfilment: 'Store pickup', status: 'Collected', payment: 'Visa ending 7730',
      pickup: { storeId: 'STR-19', readyOn: '2026-09-07', holdUntil: '2026-09-14', pickupCode: 'Used', extensions: 0, collectedOn: '2026-09-09' } },
  ];
  const lines = [
    { lineId: 'LN-60011', orderId: 'WEB-58210', type: 'Fee', description: 'Express shipping (2-day)', qty: 1, amount: 30, returnable: false, note: 'Delivered 2026-09-21, two days after the promised date' },
    { lineId: 'LN-60012', orderId: 'WEB-58210', type: 'Item', sku: 'BB-DUVET-LIN-Q', description: 'Linen duvet cover, queen, oat', qty: 1, amount: 89, returnable: true },
    { lineId: 'LN-60013', orderId: 'WEB-58210', type: 'Item', sku: 'HD-LAMP-CER', description: 'Ceramic table lamp, sage', qty: 1, amount: 120, returnable: true, note: 'Reported cracked on arrival (CASE-3101)' },
    { lineId: 'LN-60021', orderId: 'WEB-58244', type: 'Item', sku: 'WW-COAT-WOOL-M', description: 'Wool-blend wrap coat, camel, M', qty: 1, amount: 180, returnable: true },
    { lineId: 'LN-60022', orderId: 'WEB-58244', type: 'Item', sku: 'FW-BOOT-ANK-8', description: 'Leather ankle boots, black, size 8', qty: 1, amount: 140, returnable: true },
    { lineId: 'LN-59870', orderId: 'POS-31877', type: 'Item', sku: 'MW-KNIT-MER-L', description: 'Merino crew knit, navy, L (gift)', qty: 1, amount: 65, returnable: true },
    { lineId: 'LN-59990', orderId: 'WEB-58190', type: 'Item', sku: 'BB-DUVET-LIN-Q', description: 'Linen duvet cover, queen, oat', qty: 2, amount: 178, returnable: true },
    { lineId: 'LN-60031', orderId: 'WEB-58261', type: 'Item', sku: 'WW-COAT-WOOL-M', description: 'Wool-blend wrap coat, camel, M', qty: 1, amount: 180, returnable: true },
    { lineId: 'LN-59701', orderId: 'WEB-58102', type: 'Item', sku: 'FW-BOOT-ANK-8', description: 'Leather ankle boots, black, size 8', qty: 1, amount: 140, returnable: true },
  ].map((l) => ({ ...l, refunds: [], returnId: null }));
  const returns = [
    { returnId: 'RMA-9101', lineId: 'LN-59701', customerId: 'MEM-4004', method: 'Store drop-off', status: 'Received', openedOn: '2026-09-12', reason: 'Too small' },
  ];
  lines.find((l) => l.lineId === 'LN-59701').returnId = 'RMA-9101';
  const giftCards = [
    { cardId: 'GC-7731-0042', customerId: 'MEM-4001', status: 'Active', issuedOn: '2025-12-20', initialValue: 150, balance: 25, expires: 'Never',
      redemptions: [{ on: '2026-03-08', orderId: 'POS-30112', amount: 75 }, { on: '2026-09-20', orderId: 'WEB-58244', amount: 50 }] },
    { cardId: 'GC-7731-0078', customerId: 'MEM-4002', status: 'Active', issuedOn: '2026-05-10', initialValue: 100, balance: 100, expires: 'Never', redemptions: [] },
    { cardId: 'GC-7731-0105', customerId: null, status: 'Frozen', issuedOn: '2026-09-01', initialValue: 250, balance: 250, expires: 'Never', redemptions: [], note: 'Frozen after suspected fraud report' },
  ];
  const cases = [
    { caseId: 'CASE-3101', customerId: 'MEM-4001', subject: 'Ceramic lamp arrived cracked (WEB-58210)', priority: 'High', status: 'Open', openedOn: '2026-09-22' },
    { caseId: 'CASE-3102', customerId: 'MEM-4002', subject: 'Where is my order WEB-58190?', priority: 'Low', status: 'Open', openedOn: '2026-09-24' },
  ];
  const rewards = [
    { rewardId: 'RW-GOLD-15', customerId: 'MEM-4001', title: '15% off one full-price item', expires: '2026-10-31' },
    { rewardId: 'RW-BDAY-20', customerId: 'MEM-4001', title: '$20 birthday reward', expires: '2026-10-15' },
    { rewardId: 'RW-SIL-10', customerId: 'MEM-4002', title: '10% off one full-price item', expires: '2026-11-30' },
  ];
  return { shoppers, stores, products, orders, lines, returns, giftCards, cases, rewards };
}

const findShopper = (db, id) => {
  const s = db.shoppers.find((x) => x.customerId === id);
  if (!s) throw new ToolError(404, 'NOT_FOUND', `Shopper ${id} not found`);
  return s;
};
const findOrder = (db, id) => {
  const o = db.orders.find((x) => x.orderId === id);
  if (!o) throw new ToolError(404, 'NOT_FOUND', `Order ${id} not found`);
  return o;
};
const findLine = (db, id) => {
  const l = db.lines.find((x) => x.lineId === id);
  if (!l) throw new ToolError(404, 'NOT_FOUND', `Order line ${id} not found`);
  return l;
};
const refundable = (l) => money(l.amount - l.refunds.reduce((s, r) => s + r.amount, 0));
const orderTotal = (db, orderId) => money(db.lines.filter((l) => l.orderId === orderId).reduce((t, l) => t + l.amount, 0));
const storeName = (db, id) => db.stores.find((s) => s.storeId === id)?.name || id;
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const TIER_NEXT = { Bronze: ['Silver', 2000], Silver: ['Gold', 6000], Gold: ['Platinum', 15000], Platinum: [null, null] };

const CATEGORIES = ['Womenswear', 'Menswear', 'Footwear', 'Home Decor', 'Bedding & Bath'];

const handlers = {
  searchShoppers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.shoppers.filter((s) =>
      s.name.toLowerCase().includes(q) || s.customerId.toLowerCase() === q || s.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      shoppers: hits.map((s) => ({ customerId: s.customerId, name: s.name, email: maskEmail(s.email), tier: s.tier, homeStore: storeName(db, s.homeStoreId), status: s.status })),
    };
  },

  getShopperProfile(db, { customerId }) {
    const s = findShopper(db, customerId);
    const orders = db.orders.filter((o) => o.customerId === s.customerId).sort((a, b) => b.placedOn.localeCompare(a.placedOn));
    return {
      ...s, email: maskEmail(s.email), homeStore: storeName(db, s.homeStoreId),
      recentOrders: orders.slice(0, 3).map((o) => ({ orderId: o.orderId, placedOn: o.placedOn, fulfilment: o.fulfilment, status: o.status, totalUsd: orderTotal(db, o.orderId) })),
      giftCards: db.giftCards.filter((g) => g.customerId === s.customerId).map((g) => ({ cardId: g.cardId, balance: g.balance, status: g.status })),
      openCases: db.cases.filter((c) => c.customerId === s.customerId && c.status === 'Open'),
    };
  },

  listShopperOrders(db, { customerId }) {
    const s = findShopper(db, customerId);
    return {
      customerId: s.customerId, currency: 'USD',
      orders: db.orders.filter((o) => o.customerId === s.customerId).map((o) => ({
        orderId: o.orderId, placedOn: o.placedOn, channel: o.channel, fulfilment: o.fulfilment, status: o.status,
        totalUsd: orderTotal(db, o.orderId), items: db.lines.filter((l) => l.orderId === o.orderId && l.type === 'Item').length,
        ...(o.pickup ? { pickupStore: storeName(db, o.pickup.storeId), holdUntil: o.pickup.holdUntil } : {}),
        ...(o.deliveredOn ? { promisedBy: o.promisedBy, deliveredOn: o.deliveredOn } : {}),
      })),
    };
  },

  getOrderLines(db, { orderId }) {
    const o = findOrder(db, orderId);
    return {
      orderId: o.orderId, customerId: o.customerId, status: o.status, fulfilment: o.fulfilment, payment: o.payment, currency: 'USD',
      ...(o.promisedBy ? { promisedBy: o.promisedBy } : {}), ...(o.deliveredOn ? { deliveredOn: o.deliveredOn } : {}),
      lines: db.lines.filter((l) => l.orderId === o.orderId).map((l) => ({ ...l, refundableRemaining: refundable(l) })),
      totalUsd: orderTotal(db, o.orderId),
    };
  },

  checkStoreInventory(db, { sku, storeId }) {
    const p = db.products.find((x) => x.sku === sku);
    if (!p) throw new ToolError(404, 'NOT_FOUND', `SKU ${sku} not found`);
    if (storeId && !db.stores.some((s) => s.storeId === storeId)) throw new ToolError(404, 'NOT_FOUND', `Store ${storeId} not found`);
    const locations = Object.entries(p.stock)
      .filter(([loc]) => !storeId || loc === storeId)
      .map(([loc, onHand]) => ({ location: loc === 'ONLINE' ? 'Online warehouse' : `${storeName(db, loc)} (${loc})`, onHand, available: onHand > 0 }));
    return { sku: p.sku, name: p.name, category: p.category, priceUsd: p.price, locations, ...(p.restockDate ? { restockDate: p.restockDate } : {}), asOf: TODAY };
  },

  initiateMerchReturn(db, { lineId, reason = '', method = 'Store drop-off' }) {
    const l = findLine(db, lineId);
    if (!l.returnable) throw new ToolError(409, 'NOT_RETURNABLE', `${lineId} (${l.description}) is a fee and cannot be returned; refund it instead`);
    if (l.returnId) throw new ToolError(409, 'ALREADY_RETURNED', `${lineId} already has return ${l.returnId}`);
    const o = findOrder(db, l.orderId);
    if (!['Delivered', 'Completed', 'Collected'].includes(o.status)) throw new ToolError(409, 'NOT_DELIVERED', `${o.orderId} is ${o.status}; items can be returned after delivery or pickup`);
    const r = { returnId: `RMA-${9101 + db.returns.length}`, lineId, customerId: o.customerId, method, status: 'Authorized', openedOn: TODAY, reason: String(reason).slice(0, 200) };
    db.returns.push(r);
    l.returnId = r.returnId;
    return {
      ...r, orderId: o.orderId, item: l.description, amountUsd: l.amount,
      nextStep: method === 'Mail' ? 'A prepaid label was emailed; drop the parcel at any carrier point within 30 days.' : 'Bring the item and the RMA code to any store within 30 days.',
      refundNote: 'The refund is issued separately once approved.',
    };
  },

  refundOrderLine(db, { lineId, amount, reason = '' }) {
    const l = findLine(db, lineId);
    const o = findOrder(db, l.orderId);
    if (o.status === 'Cancelled') throw new ToolError(409, 'ORDER_CANCELLED', `${o.orderId} is cancelled`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(l);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_LINE_AMOUNT', `Only ${remaining} USD of ${lineId} can be refunded`);
    const r = {
      refundId: `RF-${lineId.slice(3)}-${l.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: '3-5 business days to the original payment method',
    };
    l.refunds.push(r);
    return { lineId, orderId: o.orderId, customerId: o.customerId, description: l.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  getLoyaltyRewards(db, { customerId }) {
    const s = findShopper(db, customerId);
    const [nextTier, threshold] = TIER_NEXT[s.tier];
    return {
      customerId: s.customerId, name: s.name, tier: s.tier, points: s.points,
      pointsValueUsd: money(s.points / 100),
      nextTier, pointsToNextTier: nextTier ? Math.max(0, threshold - s.points) : null,
      rewards: db.rewards.filter((r) => r.customerId === s.customerId),
      expiringSoon: s.tier === 'Gold' ? { points: 1200, on: '2026-10-31' } : null,
    };
  },

  grantLoyaltyPoints(db, { customerId, points, reason = '' }) {
    const s = findShopper(db, customerId);
    if (s.status !== 'Active') throw new ToolError(409, 'ACCOUNT_NOT_ACTIVE', `${customerId} is ${s.status}; points cannot be added`);
    s.points += points;
    return { customerId: s.customerId, pointsAdded: points, newBalance: s.points, reason: String(reason).slice(0, 200), grantedOn: TODAY, transactionId: `PTS-${customerId.slice(4)}-${s.points}` };
  },

  getStorePickupStatus(db, { orderId }) {
    const o = findOrder(db, orderId);
    if (!o.pickup) throw new ToolError(409, 'NOT_PICKUP_ORDER', `${orderId} is a ${o.fulfilment.toLowerCase()} order, not a store pickup`);
    const store = db.stores.find((s) => s.storeId === o.pickup.storeId);
    return {
      orderId: o.orderId, customerId: o.customerId, status: o.status, store: { ...store },
      ...o.pickup,
      items: db.lines.filter((l) => l.orderId === o.orderId).map((l) => l.description),
      ...(o.pickup.holdUntil && o.status === 'Ready for pickup' ? { note: `Unclaimed orders are returned to stock after ${o.pickup.holdUntil} and refunded.` } : {}),
    };
  },

  extendStorePickupHold(db, { orderId, days }) {
    const o = findOrder(db, orderId);
    if (!o.pickup) throw new ToolError(409, 'NOT_PICKUP_ORDER', `${orderId} is not a store pickup order`);
    if (o.status !== 'Ready for pickup') throw new ToolError(409, 'NOT_ON_HOLD', `${orderId} is ${o.status}; only orders ready for pickup can be held longer`);
    if (o.pickup.extensions >= 2) throw new ToolError(409, 'MAX_EXTENSIONS', `${orderId} has already been extended twice`);
    const from = o.pickup.holdUntil < TODAY ? TODAY : o.pickup.holdUntil;
    o.pickup.holdUntil = addDays(from, days);
    o.pickup.extensions += 1;
    return { orderId, store: storeName(db, o.pickup.storeId), newHoldUntil: o.pickup.holdUntil, extensions: o.pickup.extensions, extendedOn: TODAY };
  },

  getGiftCardBalance(db, { cardId }) {
    const g = db.giftCards.find((x) => x.cardId === cardId);
    if (!g) throw new ToolError(404, 'NOT_FOUND', `Gift card ${cardId} not found`);
    return { ...g, currency: 'USD', registeredTo: g.customerId || 'Unregistered' };
  },

  openCustomerCase(db, { customerId, subject, priority = 'Medium' }) {
    const s = findShopper(db, customerId);
    const c = { caseId: `CASE-${3101 + db.cases.length}`, customerId: s.customerId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.cases.push(c);
    return { ...c, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  getCategorySalesTrends(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 2.9 : 1;
    const rows = [
      ['Womenswear', 4.82, 3.1, 0.38], ['Menswear', 2.41, 1.4, 0.34], ['Footwear', 1.96, 5.8, 0.41],
      ['Home Decor', 2.73, 9.2, 0.52], ['Bedding & Bath', 1.58, -2.4, 0.47],
    ].map(([cat, salesM, growthPct, onlineShare]) => ({ category: cat, netSalesUsd: money(salesM * f * 1e6), growthVsPreviousPct: growthPct, onlineSharePct: Math.round(onlineShare * 100) }));
    return {
      period, currency: 'USD', categories: rows,
      totals: { netSalesUsd: money(rows.reduce((t, r) => t + r.netSalesUsd, 0)), orders: Math.round(162400 * f), averageOrderValueUsd: 83.6 },
      trend: 'Home Decor leads growth on autumn refresh; Bedding & Bath soft after the summer promotion.',
    };
  },

  getReturnRateMetrics(_db, { period = 'last_30d' }) {
    const rows = [
      ['Womenswear', 24.1, 22.8], ['Menswear', 15.3, 15.9], ['Footwear', 18.7, 17.2], ['Home Decor', 9.6, 6.9], ['Bedding & Bath', 7.2, 7.4],
    ].map(([cat, returnRatePct, previousPct]) => ({ category: cat, returnRatePct, previousPct }));
    return {
      period, categories: rows,
      topReasons: [
        { reason: 'Fit / size', sharePct: 41 }, { reason: 'Changed mind', sharePct: 22 },
        { reason: 'Damaged in transit', sharePct: 14 }, { reason: 'Not as described', sharePct: 11 }, { reason: 'Late delivery', sharePct: 7 },
      ],
      note: period === 'last_90d' ? '90-day view smooths the back-to-school peak.' : 'Home Decor returns up 2.7 pts, driven by transit damage on ceramics.',
    };
  },

  getStockHealthSummary(_db, { category }) {
    const all = [
      { category: 'Womenswear', weeksOfCover: 9.4, sellThroughPct: 61, outOfStockPct: 3.8, agedStockPct: 12 },
      { category: 'Menswear', weeksOfCover: 11.2, sellThroughPct: 54, outOfStockPct: 2.1, agedStockPct: 17 },
      { category: 'Footwear', weeksOfCover: 7.1, sellThroughPct: 66, outOfStockPct: 6.4, agedStockPct: 8 },
      { category: 'Home Decor', weeksOfCover: 5.8, sellThroughPct: 72, outOfStockPct: 7.9, agedStockPct: 5 },
      { category: 'Bedding & Bath', weeksOfCover: 13.6, sellThroughPct: 47, outOfStockPct: 1.6, agedStockPct: 21 },
    ];
    return { asOf: TODAY, categories: category ? all.filter((c) => c.category === category) : all, note: 'Home Decor is under-stocked going into the holidays; Bedding & Bath carries the most aged stock.' };
  },

  getLoyaltyProgramMetrics(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      activeMembers: { total: 1284000, byTier: { Bronze: 812000, Silver: 318000, Gold: 131000, Platinum: 23000 } },
      memberShareOfSalesPct: 68, repeatPurchaseRatePct: 44,
      pointsIssuedM: 96 * f, pointsRedeemedM: 71 * f, outstandingPointsLiabilityUsd: 5.9e6,
      shift: 'Gold members buy 2.3x as often as non-members; redemption up 5 pts after the birthday reward launch.',
    };
  },

  getOmnichannelFulfilment(_db, { period = 'last_30d' }) {
    const p = period === 'last_90d'
      ? { orders: 471000, shipToHomePct: 58, storePickupPct: 29, shipFromStorePct: 13, onTimeDeliveryPct: 93.1, uncollectedPickupPct: 4.2 }
      : { orders: 162400, shipToHomePct: 56, storePickupPct: 31, shipFromStorePct: 13, onTimeDeliveryPct: 91.4, uncollectedPickupPct: 4.8 };
    return { period, ...p, averagePickupReadyHours: 5.6, note: 'Express on-time rate dipped to 86% after the regional carrier delay (Sep 17-21).' };
  },

  getMarkdownPerformance(_db, { season = 'Summer 2026' }) {
    const s = season === 'Spring 2026'
      ? { averageMarkdownPct: 28, sellThroughAfterMarkdownPct: 81, clearanceUnitsLeft: 18400, markdownCostUsd: 3.2e6 }
      : { averageMarkdownPct: 34, sellThroughAfterMarkdownPct: 74, clearanceUnitsLeft: 41200, markdownCostUsd: 4.7e6 };
    return {
      season, currency: 'USD', ...s,
      byCategory: [
        { category: 'Womenswear', averageMarkdownPct: s.averageMarkdownPct + 4 }, { category: 'Menswear', averageMarkdownPct: s.averageMarkdownPct },
        { category: 'Footwear', averageMarkdownPct: s.averageMarkdownPct - 3 }, { category: 'Home Decor', averageMarkdownPct: s.averageMarkdownPct - 12 },
        { category: 'Bedding & Bath', averageMarkdownPct: s.averageMarkdownPct + 2 },
      ],
    };
  },

  getCategoryMarginReport(_db, { category }) {
    const all = [
      { category: 'Womenswear', revenueUsd: 48.2e6, cogsUsd: 21.7e6, markdownCostUsd: 5.1e6 },
      { category: 'Menswear', revenueUsd: 24.1e6, cogsUsd: 11.3e6, markdownCostUsd: 2.4e6 },
      { category: 'Footwear', revenueUsd: 19.6e6, cogsUsd: 9.8e6, markdownCostUsd: 1.6e6 },
      { category: 'Home Decor', revenueUsd: 27.3e6, cogsUsd: 11.2e6, markdownCostUsd: 1.1e6 },
      { category: 'Bedding & Bath', revenueUsd: 15.8e6, cogsUsd: 7.9e6, markdownCostUsd: 1.9e6 },
    ].map((c) => ({ ...c, grossMarginPct: money(((c.revenueUsd - c.cogsUsd - c.markdownCostUsd) / c.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', categories: category ? all.filter((c) => c.category === category) : all };
  },

  runHolidayDemandForecast(_db, { horizonWeeks = 4 }) {
    const base = { Womenswear: 58000, Menswear: 31000, Footwear: 22000, 'Home Decor': 36000, 'Bedding & Bath': 19000 };
    const forecast = Array.from({ length: horizonWeeks }, (_, i) => {
      const weekOf = addDays('2026-11-02', i * 7);
      const byCategory = CATEGORIES.map((c) => {
        const expected = Math.round(base[c] * (1 + 0.09 * (i + 1)));
        return { category: c, expectedUnits: expected, low: Math.round(expected * 0.87), high: Math.round(expected * 1.12) };
      });
      return { weekOf, totalUnits: byCategory.reduce((t, x) => t + x.expectedUnits, 0), byCategory };
    });
    return { horizonWeeks, model: 'seasonal-uplift v3 (demo)', forecast, driver: 'Holiday gifting, Home Decor demand and store-pickup growth' };
  },
};

module.exports = { build, handlers, TODAY };
