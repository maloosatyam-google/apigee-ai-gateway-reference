// Manufacturing handlers and seed data for the industry-apis service (pack: industries/manufacturing.json).
//
// An equipment manufacturer (compact tractors, loaders, mowers and parts) supporting its
// dealer network. Story: Dana Whitfield, service manager at Harlow Valley Equipment
// (DLR-4101), has a customer's CT-5500 tractor (CT5500-88213) down with a failed hydraulic
// pump. We shipped the wrong pump on PO-6198 and billed a $120 restocking fee on the return
// (CHG-7102); the expedited replacement (PO-6201, SHP-8801) missed its 2-day promise, and
// warranty claim WC-9301 is on hold. Crediting the $30 expedite surcharge (CHG-7101) is within
// policy; crediting the $120 restocking fee is over the $50 limit that Apigee enforces for
// Dealer Support. The limit is not enforced here, so the gateway control stays visible: this
// service records whatever credit reaches it (up to the amount charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const dealers = [
    { dealerId: 'DLR-4101', name: 'Harlow Valley Equipment', contactName: 'Dana Whitfield', contactRole: 'Service Manager', email: 'dana.whitfield@example.com', phone: '+1-555-0141', region: 'Midwest', tier: 'Gold', creditTerms: 'Net 30', creditLimitUsd: 50000, dealerSince: '2014-03-01' },
    { dealerId: 'DLR-4102', name: 'Pinecrest Tractor & Supply', contactName: 'Marcus Bell', contactRole: 'Parts Manager', email: 'marcus.bell@example.com', phone: '+1-555-0172', region: 'Southeast', tier: 'Silver', creditTerms: 'Net 30', creditLimitUsd: 30000, dealerSince: '2018-06-15' },
    { dealerId: 'DLR-4103', name: 'Blue Mesa Machinery', contactName: 'Jordana Pike', contactRole: 'Owner', email: 'jordana.pike@example.com', phone: '+1-555-0188', region: 'Southwest', tier: 'Gold', creditTerms: 'Net 45', creditLimitUsd: 60000, dealerSince: '2011-09-20' },
    { dealerId: 'DLR-4104', name: 'Cedar Plains Implement', contactName: 'Owen Farrow', contactRole: 'Service Manager', email: 'owen.farrow@example.com', phone: '+1-555-0115', region: 'Plains', tier: 'Bronze', creditTerms: 'Net 15', creditLimitUsd: 15000, dealerSince: '2022-02-07' },
    { dealerId: 'DLR-4105', name: 'Northgate Turf & Equipment', contactName: 'Lena Ortiz', contactRole: 'Parts Manager', email: 'lena.ortiz@example.com', phone: '+1-555-0163', region: 'Northeast', tier: 'Silver', creditTerms: 'Net 30', creditLimitUsd: 35000, dealerSince: '2016-11-01' },
  ];
  const parts = [
    { partNumber: 'HP-2210', description: 'Hydraulic pump assembly (CT-5500)', fits: ['CT-5500'], dealerPriceUsd: 612, stock: { 'Central DC': 0, 'East DC': 0, 'West DC': 3 }, nextRestock: '2026-10-02' },
    { partNumber: 'HP-2201', description: 'Hydraulic pump assembly (CT-4200)', fits: ['CT-4200'], dealerPriceUsd: 600, stock: { 'Central DC': 14, 'East DC': 6, 'West DC': 4 }, nextRestock: null },
    { partNumber: 'SK-1140', description: 'Loader valve and pump shaft seal kit', fits: ['CT-5500', 'CT-4200'], dealerPriceUsd: 38.5, stock: { 'Central DC': 140, 'East DC': 62, 'West DC': 35 }, nextRestock: null },
    { partNumber: 'FL-330', description: 'Hydraulic oil filter', fits: ['CT-5500', 'CT-4200', 'UL-300'], dealerPriceUsd: 14.25, stock: { 'Central DC': 820, 'East DC': 410, 'West DC': 290 }, nextRestock: null },
    { partNumber: 'BL-775', description: 'Mower blade set, 60 in deck', fits: ['ZT-60'], dealerPriceUsd: 64, stock: { 'Central DC': 48, 'East DC': 0, 'West DC': 12 }, nextRestock: '2026-10-09' },
    { partNumber: 'HR-5102', description: 'Loader joystick wiring harness', fits: ['CT-5500'], dealerPriceUsd: 146, stock: { 'Central DC': 9, 'East DC': 2, 'West DC': 0 }, nextRestock: '2026-10-14' },
  ];
  const orders = [
    { orderId: 'PO-6195', dealerId: 'DLR-4101', placedOn: '2026-08-28', lines: [{ partNumber: 'FL-330', quantity: 12, unitPriceUsd: 14.25 }], shipping: 'Standard', status: 'Delivered', shipmentId: 'SHP-8790' },
    { orderId: 'PO-6198', dealerId: 'DLR-4101', placedOn: '2026-09-10', lines: [{ partNumber: 'HP-2210', quantity: 1, unitPriceUsd: 612 }], shipping: 'Standard', status: 'Delivered (wrong part)', shipmentId: 'SHP-8795', note: 'HP-2201 (CT-4200 pump) picked and shipped in error; returned on RMA-5501.' },
    { orderId: 'PO-6201', dealerId: 'DLR-4101', placedOn: '2026-09-19', lines: [{ partNumber: 'HP-2210', quantity: 1, unitPriceUsd: 612 }], shipping: 'Expedited', status: 'In transit', shipmentId: 'SHP-8801', promisedBy: '2026-09-23' },
    { orderId: 'PO-6204', dealerId: 'DLR-4102', placedOn: '2026-09-17', lines: [{ partNumber: 'SK-1140', quantity: 10, unitPriceUsd: 38.5 }, { partNumber: 'FL-330', quantity: 24, unitPriceUsd: 14.25 }], shipping: 'Standard', status: 'Delivered', shipmentId: 'SHP-8798' },
    { orderId: 'PO-6207', dealerId: 'DLR-4105', placedOn: '2026-09-22', lines: [{ partNumber: 'BL-775', quantity: 6, unitPriceUsd: 64 }], shipping: 'Standard', status: 'Backordered', shipmentId: null, expectedShip: '2026-10-10' },
  ];
  const shipments = [
    { shipmentId: 'SHP-8790', orderId: 'PO-6195', carrier: 'Prairie Parcel', service: 'Ground', status: 'Delivered', shippedOn: '2026-08-29', promisedBy: '2026-09-03', deliveredOn: '2026-09-02' },
    { shipmentId: 'SHP-8795', orderId: 'PO-6198', carrier: 'Prairie Parcel', service: 'Ground', status: 'Delivered', shippedOn: '2026-09-11', promisedBy: '2026-09-16', deliveredOn: '2026-09-15' },
    { shipmentId: 'SHP-8798', orderId: 'PO-6204', carrier: 'Prairie Parcel', service: 'Ground', status: 'Delivered', shippedOn: '2026-09-18', promisedBy: '2026-09-23', deliveredOn: '2026-09-22' },
    { shipmentId: 'SHP-8801', orderId: 'PO-6201', carrier: 'FastLane Freight', service: '2-day guaranteed', status: 'Held at hub', shippedOn: '2026-09-21', promisedBy: '2026-09-23', estimatedDelivery: '2026-09-29', lastScan: { at: '2026-09-23 06:12', location: 'Central regional hub', event: 'Held: missed linehaul connection' } },
  ];
  const equipment = [
    { serialNumber: 'CT5500-88213', model: 'CT-5500', description: 'CT-5500 compact tractor with loader', builtOn: '2026-01-14', plant: 'Riverton', dealerId: 'DLR-4101', ownerType: 'Farm (end customer)', registeredOn: '2026-02-20', warrantyEnds: '2028-02-20', engineHours: 412, status: 'Down: awaiting hydraulic pump' },
    { serialNumber: 'CT5500-90117', model: 'CT-5500', description: 'CT-5500 compact tractor', builtOn: '2026-04-02', plant: 'Riverton', dealerId: 'DLR-4102', ownerType: 'Landscaping business', registeredOn: '2026-05-11', warrantyEnds: '2028-05-11', engineHours: 188, status: 'In service' },
    { serialNumber: 'CT4200-71540', model: 'CT-4200', description: 'CT-4200 compact tractor', builtOn: '2025-05-19', plant: 'Lakeside', dealerId: 'DLR-4103', ownerType: 'Farm (end customer)', registeredOn: '2025-07-01', warrantyEnds: '2027-07-01', engineHours: 960, status: 'In service' },
    { serialNumber: 'UL300-11820', model: 'UL-300', description: 'UL-300 utility loader', builtOn: '2023-03-08', plant: 'Mesa Ridge', dealerId: 'DLR-4104', ownerType: 'Municipality', registeredOn: '2023-06-30', warrantyEnds: '2026-06-30', engineHours: 2710, status: 'In service' },
    { serialNumber: 'ZT60-45012', model: 'ZT-60', description: 'ZT-60 zero-turn mower', builtOn: '2026-02-26', plant: 'Lakeside', dealerId: 'DLR-4105', ownerType: 'Golf course', registeredOn: '2026-03-30', warrantyEnds: '2027-03-30', engineHours: 305, status: 'In service' },
  ];
  const bulletins = [
    { bulletinId: 'SB-2026-014', model: 'CT-5500', type: 'Service bulletin', title: 'Hydraulic pump shaft seal inspection', appliesTo: 'Units built before 2026-03-01', builtBefore: '2026-03-01', action: 'Inspect pump shaft seal; replace with SK-1140 if weeping. Pump failures with low oil level are covered under warranty.', laborAllowanceHours: 1.5, issuedOn: '2026-08-18' },
    { bulletinId: 'SB-2026-009', model: 'CT-5500', type: 'Field campaign', title: 'Loader joystick harness routing', appliesTo: 'Serials CT5500-88000 to CT5500-89999', builtBefore: '2026-03-01', action: 'Re-route harness HR-5102 away from the pivot; replace if chafed.', laborAllowanceHours: 0.8, issuedOn: '2026-06-02' },
    { bulletinId: 'SB-2026-011', model: 'UL-300', type: 'Service bulletin', title: 'Boom cylinder pin lubrication interval', appliesTo: 'All units', builtBefore: null, action: 'Update grease interval to 50 hours.', laborAllowanceHours: 0, issuedOn: '2026-07-10' },
    { bulletinId: 'SB-2026-016', model: 'ZT-60', type: 'Service bulletin', title: 'Deck belt tensioner spring', appliesTo: 'Units built before 2026-05-01', builtBefore: '2026-05-01', action: 'Replace tensioner spring at next service.', laborAllowanceHours: 0.5, issuedOn: '2026-09-05' },
  ];
  const claims = [
    { claimId: 'WC-9301', dealerId: 'DLR-4101', serialNumber: 'CT5500-88213', partNumber: 'HP-2210', failureDescription: 'Hydraulic pump lost pressure; loader will not lift. Shaft seal weeping (see SB-2026-014).', filedOn: '2026-09-12', partsUsd: 612, laborHours: 3.5, laborRateUsd: 110, status: 'On hold', holdReason: 'Awaiting return of the failed pump and install of the replacement (PO-6201, shipment SHP-8801).' },
    { claimId: 'WC-9288', dealerId: 'DLR-4101', serialNumber: 'CT5500-88213', partNumber: 'HR-5102', failureDescription: 'Joystick harness chafed at loader pivot (SB-2026-009).', filedOn: '2026-07-08', partsUsd: 146, laborHours: 0.8, laborRateUsd: 110, status: 'Paid', paidOn: '2026-07-24' },
    { claimId: 'WC-9296', dealerId: 'DLR-4103', serialNumber: 'CT4200-71540', partNumber: 'FL-330', failureDescription: 'Filter housing cracked at 900 hours.', filedOn: '2026-08-30', partsUsd: 14.25, laborHours: 0.5, laborRateUsd: 105, status: 'Approved' },
  ];
  const returns = [
    { rmaId: 'RMA-5501', orderId: 'PO-6198', dealerId: 'DLR-4101', partNumber: 'HP-2201', quantity: 1, reason: 'Wrong part shipped', status: 'Received', openedOn: '2026-09-16', receivedOn: '2026-09-22', restockingFeeUsd: 120, note: 'Restocking fee billed on CHG-7102 although the pick error was ours.' },
  ];
  const charges = [
    { chargeId: 'CHG-7098', dealerId: 'DLR-4101', reference: 'PO-6195', description: 'Parts: 12 x FL-330 hydraulic oil filter', amount: 171, status: 'Paid', billedOn: '2026-08-29' },
    { chargeId: 'CHG-7100', dealerId: 'DLR-4101', reference: 'PO-6198', description: 'Parts: 1 x HP-2210 hydraulic pump (HP-2201 shipped in error)', amount: 612, status: 'Billed', billedOn: '2026-09-11', dueOn: '2026-10-11' },
    { chargeId: 'CHG-7101', dealerId: 'DLR-4101', reference: 'PO-6201', description: 'Expedited freight surcharge (2-day guaranteed)', amount: 30, status: 'Billed', billedOn: '2026-09-21', dueOn: '2026-10-21' },
    { chargeId: 'CHG-7102', dealerId: 'DLR-4101', reference: 'RMA-5501', description: 'Restocking fee, 20% of HP-2201 return', amount: 120, status: 'Billed', billedOn: '2026-09-22', dueOn: '2026-10-22' },
    { chargeId: 'CHG-7103', dealerId: 'DLR-4101', reference: 'PO-6201', description: 'Parts: 1 x HP-2210 hydraulic pump', amount: 612, status: 'Billed', billedOn: '2026-09-21', dueOn: '2026-10-21' },
    { chargeId: 'CHG-7104', dealerId: 'DLR-4102', reference: 'PO-6204', description: 'Parts: 10 x SK-1140, 24 x FL-330', amount: 727, status: 'Billed', billedOn: '2026-09-18', dueOn: '2026-10-18' },
  ].map((c) => ({ ...c, credits: [] }));
  return { dealers, parts, orders, shipments, equipment, bulletins, claims, returns, charges };
}

const findDealer = (db, id) => {
  const d = db.dealers.find((x) => x.dealerId === id);
  if (!d) throw new ToolError(404, 'NOT_FOUND', `Dealer ${id} not found`);
  return d;
};
const findPart = (db, pn) => {
  const p = db.parts.find((x) => x.partNumber === pn);
  if (!p) throw new ToolError(404, 'NOT_FOUND', `Part ${pn} not found`);
  return p;
};
const creditable = (c) => money(c.amount - c.credits.reduce((s, r) => s + r.amount, 0));
const maskPhone = (p) => String(p).replace(/\d(?=\d{2})/g, '*');
const totalStock = (p) => Object.values(p.stock).reduce((t, n) => t + n, 0);
const OPEN_CLAIM = ['Submitted', 'On hold', 'Approved'];

const handlers = {
  searchDealerContacts(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.dealers.filter((d) =>
      d.contactName.toLowerCase().includes(q) || d.dealerId.toLowerCase() === q || d.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      contacts: hits.map((d) => ({ dealerId: d.dealerId, dealerName: d.name, contactName: d.contactName, role: d.contactRole, email: maskEmail(d.email), phone: maskPhone(d.phone), region: d.region })),
    };
  },

  getDealerAccount(db, { dealerId }) {
    const d = findDealer(db, dealerId);
    const balance = db.charges.filter((c) => c.dealerId === d.dealerId && c.status === 'Billed').reduce((t, c) => t + creditable(c), 0);
    return {
      ...d, email: maskEmail(d.email), phone: maskPhone(d.phone),
      openOrders: db.orders.filter((o) => o.dealerId === d.dealerId && !o.status.startsWith('Delivered')).map((o) => ({ orderId: o.orderId, status: o.status, shipmentId: o.shipmentId })),
      openWarrantyClaims: db.claims.filter((c) => c.dealerId === d.dealerId && OPEN_CLAIM.includes(c.status)).map((c) => ({ claimId: c.claimId, serialNumber: c.serialNumber, status: c.status })),
      openReturns: db.returns.filter((r) => r.dealerId === d.dealerId && r.status !== 'Closed').map((r) => ({ rmaId: r.rmaId, partNumber: r.partNumber, status: r.status })),
      balanceDueUsd: money(balance), currency: 'USD',
    };
  },

  listPartsOrders(db, { dealerId }) {
    const d = findDealer(db, dealerId);
    return {
      dealerId: d.dealerId, currency: 'USD',
      orders: db.orders.filter((o) => o.dealerId === d.dealerId).map((o) => ({
        ...o,
        lines: o.lines.map((l) => ({ ...l, description: db.parts.find((p) => p.partNumber === l.partNumber)?.description || l.partNumber })),
        totalUsd: money(o.lines.reduce((t, l) => t + l.quantity * l.unitPriceUsd, 0)),
      })),
    };
  },

  getPartAvailability(db, { partNumber }) {
    const p = findPart(db, partNumber);
    const available = totalStock(p);
    return { ...p, currency: 'USD', totalAvailable: available, availability: available > 0 ? 'In stock' : `Out of stock; next restock ${p.nextRestock}` };
  },

  placePartsOrder(db, { dealerId, partNumber, quantity, shipping = 'Standard' }) {
    const d = findDealer(db, dealerId);
    const p = findPart(db, partNumber);
    const n = db.orders.length;
    const orderId = `PO-${6220 + n}`;
    let status; let shipFrom = null;
    if (totalStock(p) >= quantity) {
      let left = quantity;
      for (const dc of Object.keys(p.stock).sort((a, b) => p.stock[b] - p.stock[a])) {
        const take = Math.min(left, p.stock[dc]);
        if (take > 0) { p.stock[dc] -= take; left -= take; shipFrom = shipFrom ? `${shipFrom}, ${dc}` : dc; }
        if (!left) break;
      }
      status = 'Processing';
    } else {
      status = 'Backordered';
    }
    const o = { orderId, dealerId: d.dealerId, placedOn: TODAY, lines: [{ partNumber: p.partNumber, quantity, unitPriceUsd: p.dealerPriceUsd }], shipping, status, shipmentId: null, ...(shipFrom ? { shipFrom } : { expectedShip: p.nextRestock || '2026-10-15' }) };
    db.orders.push(o);
    const partsCharge = { chargeId: `CHG-${7120 + db.charges.length}`, dealerId: d.dealerId, reference: orderId, description: `Parts: ${quantity} x ${p.partNumber}`, amount: money(quantity * p.dealerPriceUsd), status: 'Billed', billedOn: TODAY, dueOn: '2026-10-25', credits: [] };
    db.charges.push(partsCharge);
    let freight = null;
    if (shipping === 'Expedited') {
      freight = { chargeId: `CHG-${7120 + db.charges.length}`, dealerId: d.dealerId, reference: orderId, description: 'Expedited freight surcharge (2-day guaranteed)', amount: 30, status: 'Billed', billedOn: TODAY, dueOn: '2026-10-25', credits: [] };
      db.charges.push(freight);
    }
    return {
      ...o, description: p.description, currency: 'USD',
      totalUsd: money(partsCharge.amount + (freight ? freight.amount : 0)),
      charges: [partsCharge, freight].filter(Boolean).map((c) => ({ chargeId: c.chargeId, description: c.description, amount: c.amount })),
      estimatedDelivery: status === 'Processing' ? (shipping === 'Expedited' ? '2026-09-29' : '2026-10-01') : `After restock (${o.expectedShip})`,
    };
  },

  trackShipment(db, { shipmentId }) {
    const s = db.shipments.find((x) => x.shipmentId === shipmentId);
    if (!s) throw new ToolError(404, 'NOT_FOUND', `Shipment ${shipmentId} not found`);
    const late = !s.deliveredOn && s.promisedBy < TODAY;
    return { ...s, late, ...(late ? { daysLate: Math.round((Date.parse(TODAY) - Date.parse(s.promisedBy)) / 864e5) } : {}) };
  },

  getEquipmentRegistration(db, { serialNumber }) {
    const e = db.equipment.find((x) => x.serialNumber === serialNumber);
    if (!e) throw new ToolError(404, 'NOT_FOUND', `Serial number ${serialNumber} is not registered`);
    const bulletins = db.bulletins.filter((b) => b.model === e.model && (!b.builtBefore || e.builtOn < b.builtBefore));
    return {
      ...e, underWarranty: e.warrantyEnds >= TODAY,
      coverage: e.warrantyEnds >= TODAY ? `Base warranty through ${e.warrantyEnds}` : `Base warranty expired ${e.warrantyEnds}`,
      applicableBulletins: bulletins.map((b) => ({ bulletinId: b.bulletinId, title: b.title, type: b.type })),
      claims: db.claims.filter((c) => c.serialNumber === e.serialNumber).map((c) => ({ claimId: c.claimId, partNumber: c.partNumber, status: c.status })),
    };
  },

  listServiceBulletins(db, { model }) {
    const m = String(model).trim().toUpperCase();
    const list = db.bulletins.filter((b) => b.model === m);
    if (!list.length && !db.equipment.some((e) => e.model === m)) throw new ToolError(404, 'NOT_FOUND', `Model ${model} not found`);
    return { model: m, count: list.length, bulletins: list };
  },

  getWarrantyClaim(db, { claimId }) {
    const c = db.claims.find((x) => x.claimId === claimId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Warranty claim ${claimId} not found`);
    return { ...c, currency: 'USD', claimTotalUsd: money(c.partsUsd + c.laborHours * c.laborRateUsd) };
  },

  submitWarrantyClaim(db, { dealerId, serialNumber, partNumber, failureDescription, laborHours = 1 }) {
    const d = findDealer(db, dealerId);
    const e = db.equipment.find((x) => x.serialNumber === serialNumber);
    if (!e) throw new ToolError(404, 'NOT_FOUND', `Serial number ${serialNumber} is not registered`);
    const p = findPart(db, partNumber);
    if (e.warrantyEnds < TODAY) throw new ToolError(409, 'OUT_OF_WARRANTY', `${serialNumber} warranty ended ${e.warrantyEnds}; consider goodwill through the regional manager`);
    if (db.claims.some((c) => c.serialNumber === e.serialNumber && c.partNumber === p.partNumber && OPEN_CLAIM.includes(c.status))) {
      throw new ToolError(409, 'DUPLICATE_CLAIM', `An open claim already exists for ${p.partNumber} on ${serialNumber}`);
    }
    const bulletin = db.bulletins.find((b) => b.model === e.model && (!b.builtBefore || e.builtOn < b.builtBefore) && b.action.includes(p.partNumber));
    const c = {
      claimId: `WC-${9320 + db.claims.length}`, dealerId: d.dealerId, serialNumber: e.serialNumber, partNumber: p.partNumber,
      failureDescription: String(failureDescription).slice(0, 300), filedOn: TODAY, partsUsd: p.dealerPriceUsd, laborHours, laborRateUsd: 110, status: 'Submitted',
      ...(bulletin ? { bulletinId: bulletin.bulletinId } : {}),
    };
    db.claims.push(c);
    return { ...c, currency: 'USD', claimTotalUsd: money(c.partsUsd + laborHours * 110), reviewWithin: bulletin ? '2 business days (bulletin fast track)' : '5 business days' };
  },

  openReturnAuthorization(db, { orderId, partNumber, quantity = 1, reason }) {
    const o = db.orders.find((x) => x.orderId === orderId);
    if (!o) throw new ToolError(404, 'NOT_FOUND', `Order ${orderId} not found`);
    if (!o.status.startsWith('Delivered')) throw new ToolError(409, 'NOT_DELIVERED', `${orderId} is ${o.status}; parts can be returned after delivery`);
    const line = o.lines.find((l) => l.partNumber === partNumber);
    const wrongPart = reason === 'Wrong part shipped' && /shipped in error/.test(o.note || '');
    if (!line && !wrongPart) throw new ToolError(400, 'PART_NOT_ON_ORDER', `${partNumber} is not on ${orderId}`);
    const ordered = line ? line.quantity : 1;
    const already = db.returns.filter((r) => r.orderId === orderId && r.partNumber === partNumber).reduce((t, r) => t + r.quantity, 0);
    if (quantity > ordered - already) throw new ToolError(409, 'EXCEEDS_ORDER_QUANTITY', `Only ${ordered - already} of ${partNumber} on ${orderId} can be returned`);
    const unit = line ? line.unitPriceUsd : findPart(db, partNumber).dealerPriceUsd;
    const fee = reason === 'Overstock' ? money(quantity * unit * 0.15) : 0;
    const r = { rmaId: `RMA-${5501 + db.returns.length}`, orderId, dealerId: o.dealerId, partNumber, quantity, reason, status: 'Authorized', openedOn: TODAY, restockingFeeUsd: fee };
    db.returns.push(r);
    return { ...r, currency: 'USD', creditOnReceiptUsd: money(quantity * unit - fee), returnBy: '2026-10-25', instructions: 'Ship to Central DC with the RMA number on the box; prepaid label emailed to the dealer.' };
  },

  listDealerCharges(db, { dealerId }) {
    const d = findDealer(db, dealerId);
    return {
      dealerId: d.dealerId, currency: 'USD',
      charges: db.charges.filter((c) => c.dealerId === d.dealerId).map((c) => ({ ...c, creditableRemaining: creditable(c) })),
    };
  },

  issueDealerCredit(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be credited`);
    const cr = {
      creditId: `CR-${chargeId.slice(4)}-${c.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, appliesTo: 'Dealer account statement (next cycle)',
    };
    c.credits.push(cr);
    return { chargeId, dealerId: c.dealerId, description: c.description, ...cr, creditableRemaining: money(remaining - amount) };
  },

  getSupplierOnTimeDelivery(_db, { period = 'last_30d' }) {
    const rows = period === 'last_90d'
      ? [['Castings', 88.4, 90.1, 2.6], ['Hydraulics', 81.2, 86.5, 4.1], ['Electronics', 84.7, 83.9, 3.3], ['Tires & wheels', 93.5, 92.8, 1.4], ['Engines', 90.9, 91.4, 2.0]]
      : [['Castings', 89.1, 88.0, 2.3], ['Hydraulics', 76.8, 84.2, 5.2], ['Electronics', 86.3, 84.1, 2.9], ['Tires & wheels', 94.2, 93.6, 1.2], ['Engines', 91.5, 90.2, 1.8]];
    return {
      period,
      commodities: rows.map(([commodity, otifPct, previousPct, avgDaysLate]) => ({ commodity, otifPct, previousPct, avgDaysLate })),
      note: 'Hydraulics OTIF down 7 pts: pump housing supplier capacity constraint drives HP-2210 shortages.',
    };
  },

  getProductDefectRates(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 0.94 : 1;
    const rows = [
      ['Compact Tractors', 'Riverton', 412, 355, 96.1], ['Compact Tractors', 'Lakeside', 298, 305, 97.0],
      ['Utility Loaders', 'Mesa Ridge', 365, 372, 95.4], ['Mowers & Turf', 'Lakeside', 221, 240, 97.8],
    ].map(([productLine, plant, dpm, previousDpm, firstPassYieldPct]) => ({ productLine, plant, defectsPerMillion: Math.round(dpm * f), previousDpm, firstPassYieldPct }));
    return { period, lines: rows, topDefect: 'Hydraulic pump shaft seal (CT-5500, Riverton, early-2026 builds; see SB-2026-014)' };
  },

  getWarrantyCostTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 610, 402000], ['2025-11', 575, 388000], ['2025-12', 540, 361000], ['2026-01', 590, 395000],
      ['2026-02', 640, 431000], ['2026-03', 702, 472000], ['2026-04', 735, 498000], ['2026-05', 768, 521000],
      ['2026-06', 810, 556000], ['2026-07', 842, 579000], ['2026-08', 905, 628000], ['2026-09', 948, 661000],
    ].slice(-months).map(([month, claims, costUsd]) => ({ month, claims, costUsd, costPerUnitInServiceUsd: money(costUsd / 41200) }));
    return {
      months: series.length, currency: 'USD', series,
      topFailureModes: [
        { mode: 'Hydraulic pump / seals (CT-5500)', shareOfCost: 0.31 }, { mode: 'Wiring harness chafe', shareOfCost: 0.14 },
        { mode: 'Deck belt tensioner (ZT-60)', shareOfCost: 0.11 }, { mode: 'Other', shareOfCost: 0.44 },
      ],
      trend: 'Warranty cost up 55% since March, led by CT-5500 hydraulic pump failures.',
    };
  },

  getPartsInventoryHealth(_db, { distributionCenter }) {
    const all = [
      { distributionCenter: 'Central DC', skus: 18400, daysOfSupply: 41, stockoutSkus: 212, backorderLines: 640, excessStockUsd: 1.9e6 },
      { distributionCenter: 'East DC', skus: 12100, daysOfSupply: 36, stockoutSkus: 188, backorderLines: 515, excessStockUsd: 0.8e6 },
      { distributionCenter: 'West DC', skus: 10900, daysOfSupply: 48, stockoutSkus: 97, backorderLines: 230, excessStockUsd: 1.2e6 },
    ];
    return { asOf: TODAY, currency: 'USD', distributionCenters: distributionCenter ? all.filter((d) => d.distributionCenter === distributionCenter) : all, criticalShortages: ['HP-2210 hydraulic pump', 'BL-775 mower blade set'] };
  },

  getDealerFillRates(_db, { period = 'last_30d' }) {
    const rows = [
      ['Midwest', 91.2, 6.4, 2.1], ['Southeast', 94.0, 4.1, 1.8], ['Southwest', 92.5, 5.2, 2.4],
      ['Plains', 89.8, 7.9, 2.6], ['Northeast', 93.1, 5.0, 1.9],
    ].map(([region, fillRatePct, backorderRatePct, avgDaysToShip]) => ({ region, fillRatePct: period === 'last_90d' ? money(fillRatePct + 0.8) : fillRatePct, backorderRatePct, avgDaysToShip }));
    return { period, regions: rows, dealers: 214, note: 'Aggregated across dealers; no individual dealer records.' };
  },

  getPlantThroughput(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 3 : 1;
    return {
      period,
      plants: [
        { plant: 'Riverton', unitsBuilt: 1840 * f, scheduleAttainmentPct: 91.5, oeePct: 74.2, unplannedDowntimeHours: 46 * f },
        { plant: 'Lakeside', unitsBuilt: 2310 * f, scheduleAttainmentPct: 96.8, oeePct: 79.6, unplannedDowntimeHours: 21 * f },
        { plant: 'Mesa Ridge', unitsBuilt: 690 * f, scheduleAttainmentPct: 93.2, oeePct: 76.1, unplannedDowntimeHours: 30 * f },
      ],
      note: 'Riverton attainment held back by hydraulic pump shortages on the CT-5500 line.',
    };
  },

  getPlantMargins(_db, { plant }) {
    const all = [
      { plant: 'Riverton', revenueUsd: 248e6, materialCostUsd: 151e6, laborCostUsd: 31e6, overheadUsd: 22e6 },
      { plant: 'Lakeside', revenueUsd: 196e6, materialCostUsd: 112e6, laborCostUsd: 24e6, overheadUsd: 17e6 },
      { plant: 'Mesa Ridge', revenueUsd: 121e6, materialCostUsd: 77e6, laborCostUsd: 16e6, overheadUsd: 12e6 },
    ].map((p) => ({ ...p, grossMarginPct: money(((p.revenueUsd - p.materialCostUsd - p.laborCostUsd - p.overheadUsd) / p.revenueUsd) * 100) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', plants: plant ? all.filter((p) => p.plant === plant) : all };
  },

  runPartsDemandForecast(_db, { horizonMonths = 3 }) {
    const monthsList = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].slice(0, horizonMonths);
    const base = { 'Compact Tractors': 48200, 'Utility Loaders': 17600, 'Mowers & Turf': 22900, 'Attachments': 9100 };
    const season = [1.0, 0.92, 0.85, 0.9, 1.04, 1.18];
    const forecast = monthsList.map((month, i) => {
      const byLine = Object.entries(base).map(([productLine, b]) => {
        const expectedUnits = Math.round(b * season[i] * (1 + 0.015 * (i + 1)));
        return { productLine, expectedUnits, low: Math.round(expectedUnits * 0.9), high: Math.round(expectedUnits * 1.12) };
      });
      return { month, totalUnits: byLine.reduce((t, x) => t + x.expectedUnits, 0), byLine };
    });
    return { horizonMonths, model: 'install-base demand v3 (demo)', forecast, driver: 'CT-5500 install base growth and SB-2026-014 seal-kit pull-through' };
  },
};

module.exports = { build, handlers, TODAY };
