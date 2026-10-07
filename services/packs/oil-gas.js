// Oil & Gas handlers and seed data for the industry-apis service (pack: industries/oil-gas.json).
//
// A downstream oil & gas marketing company: retail fuel stations and dealers, fleet fuel cards,
// household and commercial LPG, B2B lubricants and customer service cases. Story: Casey Donovan
// (CUS-5101) runs Donovan Bakery & Deliveries with three fleet-card vans and a commercial LPG
// connection (LPG-6101). The $30 card replacement fee was charged twice (TXN-7702), a $120
// overnight fill-up on the Van 1 card (FC-8801) at a station 200 miles away is disputed
// (TXN-7705), and the bakery's LPG refill (BKG-9301) is late after a depot stock-out. Crediting
// the $30 duplicate is within policy; crediting the $120 is over the $50 limit that Apigee
// enforces for Retail & LPG, so the agent opens a service case for finance approval instead.
// The limit is not enforced here, so the gateway control stays visible: this service records
// whatever credit reaches it (up to the amount still creditable).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const customers = [
    { customerId: 'CUS-5101', name: 'Casey Donovan', company: 'Donovan Bakery & Deliveries', email: 'casey@donovanbakery.example.com', segment: 'Small business', city: 'Riverton', customerSince: '2022-04-11', fleetCreditLimitUsd: 6000, billingCycle: 'Monthly, statement on the 1st', lubricantAccount: true },
    { customerId: 'CUS-5102', name: 'Priya Raman', company: null, email: 'priya.raman@example.com', segment: 'Household LPG', city: 'Riverton', customerSince: '2019-11-02', fleetCreditLimitUsd: 0, billingCycle: 'Pay on delivery', lubricantAccount: false },
    { customerId: 'CUS-5103', name: 'Marcus Bell', company: 'Bell Haulage Ltd', email: 'accounts@bellhaulage.example.com', segment: 'Commercial fleet', city: 'Port Calder', customerSince: '2017-06-19', fleetCreditLimitUsd: 85000, billingCycle: 'Fortnightly', lubricantAccount: true },
    { customerId: 'CUS-5104', name: 'Elena Kovac', company: null, email: 'elena.kovac@example.com', segment: 'Household LPG', city: 'Westbrook', customerSince: '2021-02-08', fleetCreditLimitUsd: 0, billingCycle: 'Pay on delivery', lubricantAccount: false },
    { customerId: 'CUS-5105', name: 'Tomas Reyes', company: 'Reyes Auto Workshop', email: 'tomas@reyesauto.example.com', segment: 'Lubricants B2B', city: 'Riverton', customerSince: '2020-09-14', fleetCreditLimitUsd: 0, billingCycle: 'Net 30', lubricantAccount: true },
    { customerId: 'CUS-5106', name: 'Kasey Lindqvist', company: 'Lindqvist Landscaping', email: 'kasey@lindqvist.example.com', segment: 'Small business', city: 'Westbrook', customerSince: '2024-03-01', fleetCreditLimitUsd: 4000, billingCycle: 'Monthly, statement on the 1st', lubricantAccount: false },
  ];
  const cards = [
    { cardId: 'FC-8801', customerId: 'CUS-5101', label: 'Van 1 (RVT-4471)', last4: '4471', status: 'Active', products: ['Diesel'], dailyLimitUsd: 250, issuedOn: '2024-01-15' },
    { cardId: 'FC-8802', customerId: 'CUS-5101', label: 'Van 2 (RVT-4472)', last4: '4472', status: 'Blocked', products: ['Diesel'], dailyLimitUsd: 250, issuedOn: '2024-01-15', blockedOn: '2026-09-09', blockReason: 'Reported lost' },
    { cardId: 'FC-8803', customerId: 'CUS-5101', label: 'Van 2 (RVT-4472), replacement', last4: '9038', status: 'Active', products: ['Diesel'], dailyLimitUsd: 250, issuedOn: '2026-09-10', replaces: 'FC-8802' },
    { cardId: 'FC-8804', customerId: 'CUS-5101', label: 'Van 3 (RVT-5120)', last4: '5120', status: 'Active', products: ['Diesel', 'Unleaded'], dailyLimitUsd: 250, issuedOn: '2025-05-02' },
    { cardId: 'FC-8810', customerId: 'CUS-5103', label: 'Truck pool A', last4: '7710', status: 'Active', products: ['Diesel'], dailyLimitUsd: 1200, issuedOn: '2023-03-20' },
    { cardId: 'FC-8820', customerId: 'CUS-5106', label: 'Crew pickup', last4: '2290', status: 'Active', products: ['Unleaded'], dailyLimitUsd: 200, issuedOn: '2024-03-04' },
  ];
  const transactions = [
    { transactionId: 'TXN-7701', customerId: 'CUS-5101', cardId: 'FC-8803', date: '2026-09-10', type: 'Fee', description: 'Card replacement fee (FC-8803)', amount: 30, status: 'Posted' },
    { transactionId: 'TXN-7702', customerId: 'CUS-5101', cardId: 'FC-8803', date: '2026-09-11', type: 'Fee', description: 'Card replacement fee (FC-8803), duplicate charge', amount: 30, status: 'Posted', duplicateOf: 'TXN-7701' },
    { transactionId: 'TXN-7703', customerId: 'CUS-5101', cardId: 'FC-8801', date: '2026-09-14', type: 'Fuel', description: 'Diesel 31.2 gal', outletId: 'RO-2101', gallons: 31.2, amount: 118.25, status: 'Posted' },
    { transactionId: 'TXN-7704', customerId: 'CUS-5101', cardId: 'FC-8804', date: '2026-09-16', type: 'Fuel', description: 'Diesel 27.5 gal', outletId: 'RO-2102', gallons: 27.5, amount: 104.23, status: 'Posted' },
    { transactionId: 'TXN-7705', customerId: 'CUS-5101', cardId: 'FC-8801', date: '2026-09-19', time: '03:12', type: 'Fuel', description: 'Diesel 31.7 gal', outletId: 'RO-2109', gallons: 31.7, amount: 120, status: 'Disputed', note: 'Customer says Van 1 was parked at the bakery overnight; RO-2109 is about 200 miles from Riverton. Possible card skimming.' },
    { transactionId: 'TXN-7706', customerId: 'CUS-5101', cardId: 'FC-8803', date: '2026-09-21', type: 'Fuel', description: 'Diesel 29.0 gal', outletId: 'RO-2103', gallons: 29.0, amount: 110.20, status: 'Posted' },
    { transactionId: 'TXN-7720', customerId: 'CUS-5103', cardId: 'FC-8810', date: '2026-09-22', type: 'Fuel', description: 'Diesel 142.0 gal', outletId: 'RO-2105', gallons: 142.0, amount: 532.50, status: 'Posted' },
    { transactionId: 'TXN-7730', customerId: 'CUS-5106', cardId: 'FC-8820', date: '2026-09-20', type: 'Fuel', description: 'Unleaded 18.4 gal', outletId: 'RO-2104', gallons: 18.4, amount: 62.38, status: 'Posted' },
  ].map((t) => ({ ...t, credits: [] }));
  const outlets = [
    { outletId: 'RO-2101', name: 'Harborview Service Station', city: 'Riverton', dealer: 'Harborview Fuels LLC', operation: 'Dealer-owned, dealer-operated', hours: '05:00-23:00', prices: { Unleaded: 3.49, Premium: 4.19, Diesel: 3.79 }, outOfStock: [], services: ['Convenience store', 'Air and water', 'Fleet card'] },
    { outletId: 'RO-2102', name: 'Maple Junction Fuels', city: 'Riverton', dealer: 'Maple Junction Retail Inc', operation: 'Company-owned, dealer-operated', hours: '24 hours', prices: { Unleaded: 3.45, Premium: 4.15, Diesel: 3.79, Autogas: 2.29 }, outOfStock: ['Premium'], services: ['Car wash', 'Fleet card', 'LPG cylinder exchange'] },
    { outletId: 'RO-2103', name: 'Eastgate Highway Plaza', city: 'Riverton', dealer: 'Eastgate Travel Centers', operation: 'Company-owned, company-operated', hours: '24 hours', prices: { Unleaded: 3.52, Premium: 4.22, Diesel: 3.80, CNG: 2.65 }, outOfStock: [], services: ['Truck lanes', 'Restaurant', 'Fleet card', 'Lubricant bay'] },
    { outletId: 'RO-2104', name: 'Westbrook Corner Station', city: 'Westbrook', dealer: 'Corner Fuel Partners', operation: 'Dealer-owned, dealer-operated', hours: '06:00-22:00', prices: { Unleaded: 3.39, Diesel: 3.72 }, outOfStock: [], services: ['Convenience store', 'Fleet card'] },
    { outletId: 'RO-2105', name: 'Port Calder Truck Stop', city: 'Port Calder', dealer: 'Calder Logistics Fuel', operation: 'Company-owned, dealer-operated', hours: '24 hours', prices: { Diesel: 3.75, Unleaded: 3.44 }, outOfStock: [], services: ['Truck lanes', 'Showers', 'Fleet card', 'DEF at the pump'] },
    { outletId: 'RO-2109', name: 'Ridgeback Junction Fuel Stop', city: 'Ridgeback', dealer: 'Ridgeback Junction Retail', operation: 'Dealer-owned, dealer-operated', hours: '24 hours, unattended 00:00-05:00', prices: { Unleaded: 3.58, Diesel: 3.79 }, outOfStock: [], services: ['Pay at pump', 'Fleet card'], note: 'Card-reader tampering reported on pump 4 on 2026-09-21; dealer audit open.' },
  ];
  const connections = [
    { connectionId: 'LPG-6101', customerId: 'CUS-5101', type: 'Commercial', address: '14 Mill Lane, Riverton', cylinderSize: '100 lb', cylinders: 2, status: 'Active', safetyInspectionDue: '2027-03-01', lastRefill: '2026-09-02', pricePerCylinderUsd: 118 },
    { connectionId: 'LPG-6102', customerId: 'CUS-5102', type: 'Household', address: '7 Orchard Row, Riverton', cylinderSize: '20 lb', cylinders: 1, status: 'Active', safetyInspectionDue: '2027-01-15', lastRefill: '2026-08-21', pricePerCylinderUsd: 27 },
    { connectionId: 'LPG-6103', customerId: 'CUS-5104', type: 'Household', address: '22 Birch Close, Westbrook', cylinderSize: '20 lb', cylinders: 2, status: 'Suspended', suspendedReason: 'Safety inspection overdue (due 2026-08-31)', safetyInspectionDue: '2026-08-31', lastRefill: '2026-07-30', pricePerCylinderUsd: 27 },
    { connectionId: 'LPG-6104', customerId: 'CUS-5106', type: 'Commercial', address: '3 Depot Road, Westbrook', cylinderSize: '100 lb', cylinders: 1, status: 'Active', safetyInspectionDue: '2027-05-10', lastRefill: '2026-09-12', pricePerCylinderUsd: 118 },
  ];
  const bookings = [
    { bookingId: 'BKG-9301', connectionId: 'LPG-6101', customerId: 'CUS-5101', cylinders: 2, bookedOn: '2026-09-20', promisedDate: '2026-09-23', eta: '2026-09-26', status: 'Delayed', depot: 'Westbrook LPG Plant', delayReason: 'Bulk LPG stock-out at Westbrook LPG Plant after a late rail delivery; refills resumed 2026-09-24.' },
    { bookingId: 'BKG-9288', connectionId: 'LPG-6101', customerId: 'CUS-5101', cylinders: 2, bookedOn: '2026-08-29', promisedDate: '2026-09-02', eta: '2026-09-02', status: 'Delivered', depot: 'Westbrook LPG Plant', deliveredOn: '2026-09-02' },
    { bookingId: 'BKG-9295', connectionId: 'LPG-6104', customerId: 'CUS-5106', cylinders: 1, bookedOn: '2026-09-10', promisedDate: '2026-09-12', eta: '2026-09-12', status: 'Delivered', depot: 'Westbrook LPG Plant', deliveredOn: '2026-09-12' },
  ];
  const skus = [
    { sku: 'LUB-15W40-5G', name: 'Heavy-duty diesel engine oil 15W-40, 5 gal pail', priceUsd: 72, inStock: 340 },
    { sku: 'LUB-5W30-12Q', name: 'Synthetic blend motor oil 5W-30, case of 12 qt', priceUsd: 64, inStock: 210 },
    { sku: 'LUB-ATF-1G', name: 'Automatic transmission fluid, 1 gal', priceUsd: 21, inStock: 480 },
    { sku: 'LUB-GREASE-35LB', name: 'Multipurpose lithium grease, 35 lb keg', priceUsd: 138, inStock: 0, restockOn: '2026-10-06' },
  ];
  const lubeOrders = [
    { orderId: 'LO-4401', customerId: 'CUS-5101', placedOn: '2026-07-18', lines: [{ sku: 'LUB-15W40-5G', quantity: 3, priceUsd: 72 }], totalUsd: 216, status: 'Delivered', deliveredOn: '2026-07-21' },
    { orderId: 'LO-4402', customerId: 'CUS-5105', placedOn: '2026-09-22', lines: [{ sku: 'LUB-5W30-12Q', quantity: 20, priceUsd: 64 }, { sku: 'LUB-ATF-1G', quantity: 24, priceUsd: 21 }], totalUsd: 1784, status: 'Dispatched', dispatchedFrom: 'Riverton Depot', deliveryBy: '2026-09-26' },
    { orderId: 'LO-4403', customerId: 'CUS-5103', placedOn: '2026-09-24', lines: [{ sku: 'LUB-15W40-5G', quantity: 40, priceUsd: 72 }], totalUsd: 2880, status: 'Picking', dispatchedFrom: 'Port Calder Terminal', deliveryBy: '2026-09-29' },
  ];
  const cases = [
    { caseId: 'CASE-3001', customerId: 'CUS-5101', subject: 'Bakery LPG refill BKG-9301 not delivered on promised date', category: 'LPG delivery', relatedId: 'BKG-9301', priority: 'High', status: 'Open', openedOn: '2026-09-23' },
    { caseId: 'CASE-3002', customerId: 'CUS-5104', subject: 'Request safety inspection to restore LPG supply', category: 'LPG delivery', relatedId: 'LPG-6103', priority: 'Medium', status: 'Open', openedOn: '2026-09-02' },
  ];
  return { customers, cards, transactions, outlets, connections, bookings, skus, lubeOrders, cases };
}

const findCustomer = (db, id) => {
  const c = db.customers.find((x) => x.customerId === id);
  if (!c) throw new ToolError(404, 'NOT_FOUND', `Customer ${id} not found`);
  return c;
};
const creditable = (t) => money(t.amount - t.credits.reduce((s, c) => s + c.amount, 0));
const outletName = (db, id) => db.outlets.find((o) => o.outletId === id)?.name;
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const OPEN_BOOKING = ['Booked', 'Delayed', 'Out for delivery'];

const handlers = {
  searchFuelCustomers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.customers.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q) || c.customerId.toLowerCase() === q || c.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      customers: hits.map((c) => ({ customerId: c.customerId, name: c.name, company: c.company, email: maskEmail(c.email), segment: c.segment, city: c.city })),
    };
  },

  getFuelCustomerAccount(db, { customerId }) {
    const c = findCustomer(db, customerId);
    const unbilled = db.transactions.filter((t) => t.customerId === c.customerId && t.date >= '2026-09-01').reduce((s, t) => s + creditable(t), 0);
    return {
      ...c, email: maskEmail(c.email),
      fleetCards: db.cards.filter((k) => k.customerId === c.customerId).map(({ cardId, label, last4, status }) => ({ cardId, label, last4, status })),
      lpgConnections: db.connections.filter((k) => k.customerId === c.customerId).map(({ connectionId, type, cylinderSize, cylinders, status }) => ({ connectionId, type, cylinderSize, cylinders, status })),
      currentCycleChargesUsd: money(unbilled),
      openCases: db.cases.filter((k) => k.customerId === c.customerId && k.status !== 'Closed'),
    };
  },

  listFleetCardTransactions(db, { customerId, cardId }) {
    const c = findCustomer(db, customerId);
    if (cardId && !db.cards.some((k) => k.cardId === cardId && k.customerId === c.customerId)) throw new ToolError(404, 'NOT_FOUND', `Card ${cardId} not found for ${c.customerId}`);
    const txns = db.transactions.filter((t) => t.customerId === c.customerId && (!cardId || t.cardId === cardId));
    return {
      customerId: c.customerId, currency: 'USD',
      transactions: txns.map((t) => ({ ...t, outletName: t.outletId ? outletName(db, t.outletId) : undefined, creditableRemaining: creditable(t) })),
    };
  },

  blockFleetCard(db, { cardId, reason, issueReplacement = true }) {
    const card = db.cards.find((k) => k.cardId === cardId);
    if (!card) throw new ToolError(404, 'NOT_FOUND', `Card ${cardId} not found`);
    if (card.status === 'Blocked') throw new ToolError(409, 'ALREADY_BLOCKED', `${cardId} is already blocked (since ${card.blockedOn})`);
    Object.assign(card, { status: 'Blocked', blockedOn: TODAY, blockReason: String(reason).slice(0, 200) });
    const out = { cardId, label: card.label, status: card.status, blockedOn: TODAY, reason: card.blockReason };
    if (issueReplacement !== false) {
      const n = 8830 + db.cards.length;
      const repl = { ...card, cardId: `FC-${n}`, last4: String(n * 7).slice(-4), label: `${card.label.replace(/, replacement$/, '')}, replacement`, status: 'Active', issuedOn: TODAY, replaces: cardId };
      delete repl.blockedOn; delete repl.blockReason;
      db.cards.push(repl);
      const fraud = /skim|fraud|disput|compromis|stolen/i.test(String(reason));
      out.replacement = { cardId: repl.cardId, last4: repl.last4, arrivesBy: addDays(TODAY, 4), fee: fraud ? 'Waived (suspected fraud)' : '30 USD card replacement fee' };
    }
    return out;
  },

  creditFleetCardCharge(db, { transactionId, amount, reason = '' }) {
    const t = db.transactions.find((x) => x.transactionId === transactionId);
    if (!t) throw new ToolError(404, 'NOT_FOUND', `Transaction ${transactionId} not found`);
    if (!['Posted', 'Disputed'].includes(t.status)) throw new ToolError(409, 'NOT_CREDITABLE', `${transactionId} is ${t.status}`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(t);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_TRANSACTION', `Only ${remaining} USD of ${transactionId} can be credited`);
    const c = {
      creditId: `CR-${transactionId.slice(4)}-${t.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Applied', postedOn: TODAY, appearsOn: 'October fleet statement',
    };
    t.credits.push(c);
    return { transactionId, customerId: t.customerId, cardId: t.cardId, description: t.description, ...c, creditableRemaining: money(remaining - amount) };
  },

  findRetailOutlets(db, { city, product }) {
    const q = String(city).trim().toLowerCase();
    const hits = db.outlets.filter((o) => o.city.toLowerCase() === q && (!product || (product in o.prices && !o.outOfStock.includes(product))));
    return {
      city, product: product || 'any', count: hits.length,
      outlets: hits.map((o) => ({ outletId: o.outletId, name: o.name, hours: o.hours, price: product ? o.prices[product] : undefined, products: Object.keys(o.prices).filter((p) => !o.outOfStock.includes(p)) })),
      ...(hits.length ? {} : { note: `No outlets found in ${city}. Cities served: ${[...new Set(db.outlets.map((o) => o.city))].join(', ')}.` }),
    };
  },

  getRetailOutletDetails(db, { outletId }) {
    const o = db.outlets.find((x) => x.outletId === outletId);
    if (!o) throw new ToolError(404, 'NOT_FOUND', `Outlet ${outletId} not found`);
    return { ...o, currency: 'USD', priceUnit: 'per gallon (CNG per GGE)', pricesAsOf: TODAY };
  },

  getLpgConnection(db, { connectionId }) {
    const c = db.connections.find((x) => x.connectionId === connectionId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `LPG connection ${connectionId} not found`);
    return { ...c, currency: 'USD', openBookings: db.bookings.filter((b) => b.connectionId === c.connectionId && OPEN_BOOKING.includes(b.status)) };
  },

  bookLpgCylinderRefill(db, { connectionId, cylinders = 1 }) {
    const c = db.connections.find((x) => x.connectionId === connectionId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `LPG connection ${connectionId} not found`);
    if (c.status !== 'Active') throw new ToolError(409, 'CONNECTION_SUSPENDED', `${connectionId} is ${c.status}: ${c.suspendedReason || 'contact support'}`);
    const open = db.bookings.find((b) => b.connectionId === c.connectionId && OPEN_BOOKING.includes(b.status));
    if (open) throw new ToolError(409, 'BOOKING_OPEN', `${connectionId} already has open booking ${open.bookingId} (ETA ${open.eta})`);
    if (cylinders > c.cylinders) throw new ToolError(400, 'INVALID_ARGUMENT', `${connectionId} has only ${c.cylinders} cylinder(s)`);
    const lead = c.type === 'Commercial' ? 2 : 3;
    const b = { bookingId: `BKG-${9302 + db.bookings.length}`, connectionId: c.connectionId, customerId: c.customerId, cylinders, bookedOn: TODAY, promisedDate: addDays(TODAY, lead), eta: addDays(TODAY, lead), status: 'Booked', depot: 'Westbrook LPG Plant' };
    db.bookings.push(b);
    return { ...b, amountDueUsd: money(cylinders * c.pricePerCylinderUsd), currency: 'USD', payment: 'Pay on delivery or on account' };
  },

  trackLpgDelivery(db, { bookingId }) {
    const b = db.bookings.find((x) => x.bookingId === bookingId);
    if (!b) throw new ToolError(404, 'NOT_FOUND', `Booking ${bookingId} not found`);
    return { ...b, daysLate: b.status === 'Delayed' ? Math.round((Date.parse(b.eta) - Date.parse(b.promisedDate)) / 86400000) : 0 };
  },

  placeLubricantOrder(db, { customerId, sku, quantity }) {
    const c = findCustomer(db, customerId);
    if (!c.lubricantAccount) throw new ToolError(409, 'NO_LUBRICANT_ACCOUNT', `${c.customerId} has no B2B lubricant account`);
    const s = db.skus.find((x) => x.sku === sku);
    if (!s) throw new ToolError(404, 'NOT_FOUND', `SKU ${sku} not found`);
    if (s.inStock < quantity) throw new ToolError(409, 'OUT_OF_STOCK', `Only ${s.inStock} of ${sku} in stock${s.restockOn ? `; restock on ${s.restockOn}` : ''}`);
    s.inStock -= quantity;
    const o = { orderId: `LO-${4404 + db.lubeOrders.length - 3}`, customerId: c.customerId, placedOn: TODAY, lines: [{ sku, name: s.name, quantity, priceUsd: s.priceUsd }], totalUsd: money(quantity * s.priceUsd), status: 'Received', dispatchedFrom: 'Riverton Depot', deliveryBy: addDays(TODAY, 3) };
    db.lubeOrders.push(o);
    return { ...o, currency: 'USD', billedTo: `${c.company || c.name} lubricant account` };
  },

  getLubricantOrderStatus(db, { orderId }) {
    const o = db.lubeOrders.find((x) => x.orderId === orderId);
    if (!o) throw new ToolError(404, 'NOT_FOUND', `Lubricant order ${orderId} not found`);
    return { ...o, currency: 'USD', lines: o.lines.map((l) => ({ ...l, name: db.skus.find((s) => s.sku === l.sku)?.name })) };
  },

  openFuelServiceCase(db, { customerId, subject, category = 'Other', relatedId, disputedAmount, priority = 'Medium' }) {
    const c = findCustomer(db, customerId);
    if (disputedAmount !== undefined && !(disputedAmount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'disputedAmount must be a positive number');
    const k = {
      caseId: `CASE-${3001 + db.cases.length}`, customerId: c.customerId, subject: String(subject).slice(0, 160), category,
      ...(relatedId ? { relatedId: String(relatedId) } : {}), priority, openedOn: TODAY,
      status: disputedAmount ? 'Pending finance approval' : 'Open',
      ...(disputedAmount ? { disputedAmountUsd: money(disputedAmount), approvalQueue: 'Finance - fleet card disputes', decisionWithin: '3 business days' } : {}),
    };
    db.cases.push(k);
    return { ...k, firstResponseWithin: priority === 'High' ? '4 hours' : '1 business day' };
  },

  getStationThroughput(_db, { months = 6 }) {
    const series = [
      ['2025-10', 41200, 5100, 28900, 1450], ['2025-11', 39800, 4900, 29300, 1480], ['2025-12', 40600, 5300, 27100, 1520],
      ['2026-01', 36900, 4500, 27800, 1490], ['2026-02', 35400, 4300, 28200, 1510], ['2026-03', 39100, 4800, 30100, 1560],
      ['2026-04', 40800, 5000, 30600, 1580], ['2026-05', 43900, 5400, 31200, 1610], ['2026-06', 46100, 5800, 31900, 1640],
      ['2026-07', 47800, 6100, 31400, 1660], ['2026-08', 47200, 6000, 32300, 1690], ['2026-09', 43600, 5500, 32800, 1710],
    ].slice(-months).map(([month, unleadedKGal, premiumKGal, dieselKGal, autogasKGal]) => ({ month, unleadedKGal, premiumKGal, dieselKGal, autogasKGal }));
    return {
      months: series.length, unit: 'thousand gallons', series,
      byRegion: [{ region: 'North', share: 0.29 }, { region: 'South', share: 0.24 }, { region: 'East', share: 0.27 }, { region: 'West', share: 0.20 }],
      avgPerOutletKGalPerMonth: 61.4,
      trend: 'Gasoline easing after the summer peak; diesel up 4% year on year on fleet growth.',
    };
  },

  getDepotStockLevels(_db, { depot }) {
    const all = [
      { depot: 'Northfield Terminal', products: [{ product: 'Unleaded', stockKGal: 8400, daysCover: 9.1 }, { product: 'Diesel', stockKGal: 6900, daysCover: 8.4 }, { product: 'Premium', stockKGal: 1100, daysCover: 10.2 }], inboundNext7dKGal: 9800 },
      { depot: 'Port Calder Terminal', products: [{ product: 'Unleaded', stockKGal: 12600, daysCover: 11.3 }, { product: 'Diesel', stockKGal: 10900, daysCover: 10.6 }, { product: 'Premium', stockKGal: 1600, daysCover: 12.0 }], inboundNext7dKGal: 14200 },
      { depot: 'Riverton Depot', products: [{ product: 'Unleaded', stockKGal: 2100, daysCover: 4.8 }, { product: 'Diesel', stockKGal: 1900, daysCover: 4.1 }, { product: 'Lubricants (k gal)', stockKGal: 96, daysCover: 21 }], inboundNext7dKGal: 3600 },
      { depot: 'Westbrook LPG Plant', products: [{ product: 'LPG bulk', stockKGal: 410, daysCover: 2.6 }, { product: 'Filled cylinders (k units)', stockKGal: 7.8, daysCover: 1.9 }], inboundNext7dKGal: 1250, alert: 'Below 3 days of cover after the 2026-09-21 rail delay; recovering.' },
    ];
    return { asOf: TODAY, depots: depot ? all.filter((d) => d.depot === depot) : all };
  },

  getLpgDeliveryPerformance(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const regions = [
      { region: 'North', bookings: 18400 * f, onTimePct: 94.1, avgLeadDays: 1.8, backlog: 410 },
      { region: 'South', bookings: 15200 * f, onTimePct: 92.7, avgLeadDays: 2.0, backlog: 520 },
      { region: 'East', bookings: 16900 * f, onTimePct: 93.5, avgLeadDays: 1.9, backlog: 460 },
      { region: 'West', bookings: 12100 * f, onTimePct: period === 'last_90d' ? 88.9 : 81.4, avgLeadDays: period === 'last_90d' ? 2.4 : 3.1, backlog: 1940 },
    ];
    return { period, regions, commercialOnTimePct: period === 'last_90d' ? 91.2 : 88.6, note: 'West slipped after the Westbrook LPG Plant stock-out (2026-09-21 to 09-24).' };
  },

  getFleetCardSpendSummary(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const segments = [
      { segment: 'Small business', accounts: 4120, activeCards: 11800, spendUsd: 4.6e6 * f, gallonsK: 1240 * f, disputeRatePer1k: 2.9 },
      { segment: 'Commercial fleet', accounts: 610, activeCards: 18400, spendUsd: 21.8e6 * f, gallonsK: 5810 * f, disputeRatePer1k: 1.4 },
      { segment: 'Public sector', accounts: 95, activeCards: 3900, spendUsd: 3.1e6 * f, gallonsK: 830 * f, disputeRatePer1k: 0.8 },
    ];
    return { period, currency: 'USD', segments, suspectedSkimmingCases: period === 'last_90d' ? 41 : 17, note: 'Disputes clustered at unattended overnight pumps. Aggregated, no customer records.' };
  },

  getDealerNetworkScorecard(_db, { region }) {
    const all = [
      { region: 'North', outlets: 412, dealerOperatedPct: 78, dryOutHoursPer100: 3.1, auditCompliancePct: 96.2, avgRating: 4.3 },
      { region: 'South', outlets: 338, dealerOperatedPct: 82, dryOutHoursPer100: 4.4, auditCompliancePct: 94.8, avgRating: 4.1 },
      { region: 'East', outlets: 376, dealerOperatedPct: 74, dryOutHoursPer100: 2.7, auditCompliancePct: 97.0, avgRating: 4.4 },
      { region: 'West', outlets: 291, dealerOperatedPct: 85, dryOutHoursPer100: 6.8, auditCompliancePct: 92.1, avgRating: 3.9, flags: ['Pump card-reader tampering at 3 unattended sites'] },
    ];
    return { asOf: TODAY, regions: region ? all.filter((r) => r.region === region) : all };
  },

  getFuelComplaintTrends(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    const rows = [
      ['LPG delivery', 2140 * f, 1620 * f, 38, 11], ['Fleet card dispute', 860 * f, 710 * f, 52, 7], ['Billing', 1310 * f, 1290 * f, 29, 9],
      ['Station service', 940 * f, 980 * f, 22, 5], ['Fuel quality', 120 * f, 135 * f, 70, 3], ['Lubricants', 210 * f, 190 * f, 31, 4],
    ].map(([category, cases, previous, avgResolutionHours, repeatPct]) => ({ category, cases, previous, avgResolutionHours, repeatPct }));
    return { period, categories: rows, note: 'LPG delivery complaints up 32% with the West region stock-out; fleet card disputes up 21%.' };
  },

  getProductMarginWaterfall(_db, { product }) {
    const all = [
      { product: 'Unleaded', refineryGate: 2.18, freightAndTerminal: 0.14, taxes: 0.62, dealerMargin: 0.21, companyMargin: 0.34 },
      { product: 'Premium', refineryGate: 2.46, freightAndTerminal: 0.14, taxes: 0.62, dealerMargin: 0.29, companyMargin: 0.68 },
      { product: 'Diesel', refineryGate: 2.41, freightAndTerminal: 0.15, taxes: 0.68, dealerMargin: 0.19, companyMargin: 0.36 },
      { product: 'LPG', refineryGate: 0.92, freightAndTerminal: 0.31, taxes: 0.18, dealerMargin: 0.24, companyMargin: 0.66 },
    ].map((p) => ({ ...p, retailPrice: money(p.refineryGate + p.freightAndTerminal + p.taxes + p.dealerMargin + p.companyMargin) }));
    return { classification: 'Confidential', currency: 'USD', unit: 'per gallon', period: 'September 2026 month to date', products: product ? all.filter((p) => p.product === product) : all };
  },

  runFuelDemandForecast(_db, { horizonMonths = 3 }) {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'].slice(0, horizonMonths);
    const base = { Unleaded: 41800, Premium: 5200, Diesel: 33100, LPG: 6900 };
    const season = { Unleaded: [-0.02, -0.04, -0.03, -0.11, -0.14, -0.06, -0.02, 0.05, 0.1, 0.13, 0.12, 0.03], Premium: [-0.02, -0.04, 0, -0.12, -0.15, -0.07, -0.03, 0.05, 0.11, 0.15, 0.13, 0.03], Diesel: [0.01, 0.02, -0.02, -0.01, 0, 0.03, 0.04, 0.05, 0.06, 0.05, 0.07, 0.08], LPG: [0.08, 0.22, 0.35, 0.41, 0.33, 0.15, 0.02, -0.08, -0.12, -0.14, -0.12, -0.04] };
    const forecast = months.map((month, i) => {
      const byProduct = Object.keys(base).map((p) => {
        const expected = Math.round(base[p] * (1 + season[p][i]));
        return { product: p, expectedKGal: expected, low: Math.round(expected * 0.93), high: Math.round(expected * 1.06) };
      });
      return { month, totalKGal: byProduct.reduce((t, x) => t + x.expectedKGal, 0), byProduct };
    });
    return { horizonMonths, model: 'seasonal demand v3 (demo)', forecast, driver: 'Winter LPG heating demand and steady diesel fleet growth' };
  },
};

module.exports = { build, handlers, TODAY };
