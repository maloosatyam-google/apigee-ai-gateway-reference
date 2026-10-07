// Travel handlers and seed data for the industry-apis service (pack: industries/travel.json).
//
// A hotel & hospitality group (four fictional properties). Story: Jamie Collins (GST-4001),
// a Gold loyalty member, is mid-stay at Harbor Downtown (RSV-2201). The air conditioning in
// room 1412 failed (guest case GC-9001), the $120 room upgrade fee was posted twice
// (CHG-7102 duplicates CHG-7100) and the August stay at Seaside Resort (RSV-2150) never
// earned its loyalty points. Crediting the $30 minibar charge (CHG-7101) is within policy;
// crediting the $120 duplicate is over the $50 limit that Apigee enforces for Guest Services.
// The limit is not enforced here, so the gateway control stays visible: this service records
// whatever credit reaches it (up to the amount charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const properties = [
    {
      propertyId: 'HTL-DT', name: 'Harbor Downtown', city: 'Harbor City', rooms: 320,
      roomTypes: {
        'Queen Standard': { rate: 169, total: 180, booked: 171, free: ['0808', '1015'] },
        'King Deluxe': { rate: 209, total: 110, booked: 104, free: ['1418', '1506', '1622'] },
        'Junior Suite': { rate: 329, total: 30, booked: 30, free: [] },
      },
    },
    {
      propertyId: 'HTL-SR', name: 'Seaside Resort', city: 'Coral Bay', rooms: 240,
      roomTypes: {
        'Queen Standard': { rate: 229, total: 120, booked: 98, free: ['0212', '0214', '0310'] },
        'King Deluxe': { rate: 279, total: 90, booked: 81, free: ['0520', '0611'] },
        'Junior Suite': { rate: 449, total: 30, booked: 26, free: ['0801'] },
      },
    },
    {
      propertyId: 'HTL-RM', name: 'Ridge Mountain Lodge', city: 'Pine Ridge', rooms: 140,
      roomTypes: {
        'Queen Standard': { rate: 149, total: 80, booked: 52, free: ['108', '112', '204'] },
        'King Deluxe': { rate: 189, total: 45, booked: 30, free: ['301', '305'] },
        'Junior Suite': { rate: 299, total: 15, booked: 9, free: ['401'] },
      },
    },
    {
      propertyId: 'HTL-LC', name: 'Lakeside Conference Hotel', city: 'Lakeview', rooms: 410,
      roomTypes: {
        'Queen Standard': { rate: 139, total: 260, booked: 244, free: ['0417', '0521'] },
        'King Deluxe': { rate: 179, total: 120, booked: 118, free: ['0903'] },
        'Junior Suite': { rate: 289, total: 30, booked: 22, free: ['1201'] },
      },
    },
  ];
  const guests = [
    { guestId: 'GST-4001', name: 'Jamie Collins', email: 'jamie.collins@example.com', tier: 'Gold', memberSince: '2019-03-11', preferences: ['High floor', 'Feather-free pillows'], status: 'Active' },
    { guestId: 'GST-4002', name: 'Morgan Ellis', email: 'morgan.ellis@example.com', tier: 'Platinum', memberSince: '2016-07-02', preferences: ['Quiet room', 'Early check-in'], status: 'Active' },
    { guestId: 'GST-4003', name: 'Ana Lopez', email: 'ana.lopez@example.com', tier: 'Silver', memberSince: '2022-05-19', preferences: ['Ocean view'], status: 'Active' },
    { guestId: 'GST-4004', name: 'Chris Tanaka', email: 'chris.tanaka@example.com', tier: 'Member', memberSince: '2025-11-30', preferences: [], status: 'Active' },
    { guestId: 'GST-4005', name: 'Jameson Reid', email: 'jameson.reid@example.com', tier: 'Silver', memberSince: '2021-02-14', preferences: ['Accessible room'], status: 'Active' },
  ];
  const reservations = [
    { reservationId: 'RSV-2201', guestId: 'GST-4001', propertyId: 'HTL-DT', roomType: 'King Deluxe', room: '1412', checkIn: '2026-09-23', checkOut: '2026-09-27', nightlyRate: 189, rateType: 'Flexible', status: 'In house', pointsPosted: false },
    { reservationId: 'RSV-2150', guestId: 'GST-4001', propertyId: 'HTL-SR', roomType: 'Queen Standard', room: '0214', checkIn: '2026-08-14', checkOut: '2026-08-17', nightlyRate: 260, rateType: 'Flexible', status: 'Completed', pointsPosted: false },
    { reservationId: 'RSV-2120', guestId: 'GST-4001', propertyId: 'HTL-DT', roomType: 'Queen Standard', room: '0911', checkIn: '2026-06-02', checkOut: '2026-06-04', nightlyRate: 175, rateType: 'Corporate', status: 'Completed', pointsPosted: true },
    { reservationId: 'RSV-2210', guestId: 'GST-4001', propertyId: 'HTL-RM', roomType: 'Junior Suite', room: null, checkIn: '2026-12-18', checkOut: '2026-12-21', nightlyRate: 299, rateType: 'Flexible', status: 'Confirmed', pointsPosted: false },
    { reservationId: 'RSV-2202', guestId: 'GST-4002', propertyId: 'HTL-LC', roomType: 'King Deluxe', room: '0907', checkIn: '2026-09-24', checkOut: '2026-09-26', nightlyRate: 179, rateType: 'Corporate', status: 'In house', pointsPosted: false },
    { reservationId: 'RSV-2203', guestId: 'GST-4003', propertyId: 'HTL-SR', roomType: 'King Deluxe', room: null, checkIn: '2026-10-03', checkOut: '2026-10-07', nightlyRate: 249, rateType: 'Advance purchase', status: 'Confirmed', pointsPosted: false },
    { reservationId: 'RSV-2204', guestId: 'GST-4004', propertyId: 'HTL-DT', roomType: 'Queen Standard', room: '0722', checkIn: '2026-09-18', checkOut: '2026-09-20', nightlyRate: 169, rateType: 'Flexible', status: 'Completed', pointsPosted: true },
    { reservationId: 'RSV-2205', guestId: 'GST-4005', propertyId: 'HTL-RM', roomType: 'Queen Standard', room: null, checkIn: '2026-09-26', checkOut: '2026-09-28', nightlyRate: 149, rateType: 'Flexible', status: 'Confirmed', pointsPosted: false },
  ];
  const charges = [
    { chargeId: 'CHG-7098', reservationId: 'RSV-2201', date: '2026-09-23', description: 'Room night, King Deluxe', category: 'Room', amount: 189 },
    { chargeId: 'CHG-7099', reservationId: 'RSV-2201', date: '2026-09-24', description: 'Room night, King Deluxe', category: 'Room', amount: 189 },
    { chargeId: 'CHG-7100', reservationId: 'RSV-2201', date: '2026-09-23', description: 'Room upgrade to King Deluxe (stay)', category: 'Upgrade', amount: 120 },
    { chargeId: 'CHG-7101', reservationId: 'RSV-2201', date: '2026-09-24', description: 'Minibar', category: 'Minibar', amount: 30, note: 'Guest says the minibar was not used' },
    { chargeId: 'CHG-7102', reservationId: 'RSV-2201', date: '2026-09-24', description: 'Room upgrade to King Deluxe (stay), duplicate posting', category: 'Upgrade', amount: 120, duplicateOf: 'CHG-7100' },
    { chargeId: 'CHG-7103', reservationId: 'RSV-2201', date: '2026-09-24', description: 'Valet parking', category: 'Parking', amount: 45 },
    { chargeId: 'CHG-7110', reservationId: 'RSV-2202', date: '2026-09-24', description: 'Room night, King Deluxe', category: 'Room', amount: 179 },
    { chargeId: 'CHG-7111', reservationId: 'RSV-2202', date: '2026-09-24', description: 'Lakeside Grill dinner', category: 'Dining', amount: 64 },
    { chargeId: 'CHG-7120', reservationId: 'RSV-2204', date: '2026-09-18', description: 'Room night, Queen Standard', category: 'Room', amount: 169 },
    { chargeId: 'CHG-7121', reservationId: 'RSV-2204', date: '2026-09-19', description: 'Room night, Queen Standard', category: 'Room', amount: 169 },
  ].map((c) => ({ ...c, credits: [] }));
  const payments = [
    { reservationId: 'RSV-2201', date: '2026-09-23', description: 'Deposit, card ending 4417', amount: 189 },
    { reservationId: 'RSV-2204', date: '2026-09-20', description: 'Card ending 0932', amount: 338 },
  ];
  const loyalty = [
    { guestId: 'GST-4001', tier: 'Gold', points: 48250, nightsThisYear: 21, nextTier: 'Platinum at 40 nights', postings: [{ date: '2026-06-04', reservationId: 'RSV-2120', points: 4375, description: 'Stay at Harbor Downtown' }] },
    { guestId: 'GST-4002', tier: 'Platinum', points: 212400, nightsThisYear: 58, nextTier: null, postings: [] },
    { guestId: 'GST-4003', tier: 'Silver', points: 12900, nightsThisYear: 9, nextTier: 'Gold at 20 nights', postings: [] },
    { guestId: 'GST-4004', tier: 'Member', points: 3380, nightsThisYear: 2, nextTier: 'Silver at 10 nights', postings: [{ date: '2026-09-20', reservationId: 'RSV-2204', points: 3380, description: 'Stay at Harbor Downtown' }] },
    { guestId: 'GST-4005', tier: 'Silver', points: 18750, nightsThisYear: 12, nextTier: 'Gold at 20 nights', postings: [] },
  ];
  const cases = [
    { caseId: 'GC-9001', reservationId: 'RSV-2201', guestId: 'GST-4001', subject: 'Air conditioning not cooling in room 1412', priority: 'High', status: 'Open', openedOn: '2026-09-24', owner: 'Engineering' },
  ];
  const amenityBookings = [
    { bookingId: 'AMN-3301', reservationId: 'RSV-2202', amenity: 'Dinner reservation', date: '2026-09-25', price: 0, status: 'Booked' },
  ];
  return { properties, guests, reservations, charges, payments, loyalty, cases, amenityBookings };
}

const findGuest = (db, id) => {
  const g = db.guests.find((x) => x.guestId === id);
  if (!g) throw new ToolError(404, 'NOT_FOUND', `Guest ${id} not found`);
  return g;
};
const findReservation = (db, id) => {
  const r = db.reservations.find((x) => x.reservationId === id);
  if (!r) throw new ToolError(404, 'NOT_FOUND', `Reservation ${id} not found`);
  return r;
};
const findProperty = (db, id) => {
  const p = db.properties.find((x) => x.propertyId === id);
  if (!p) throw new ToolError(404, 'NOT_FOUND', `Property ${id} not found`);
  return p;
};
const propertyName = (db, id) => db.properties.find((p) => p.propertyId === id)?.name || id;
const creditable = (c) => money(c.amount - c.credits.reduce((s, r) => s + r.amount, 0));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const TIER_BONUS = { Member: 0, Silver: 0.1, Gold: 0.25, Platinum: 0.5 };
const AMENITY_PRICE = { 'Spa treatment': 140, 'Dinner reservation': 0, 'Late checkout': 40, 'Valet parking': 45 };
const PROPERTY_NAMES = ['Harbor Downtown', 'Seaside Resort', 'Ridge Mountain Lodge', 'Lakeside Conference Hotel'];

const handlers = {
  searchHotelGuests(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.guests.filter((g) =>
      g.name.toLowerCase().includes(q) || g.guestId.toLowerCase() === q || g.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      guests: hits.map((g) => ({ guestId: g.guestId, name: g.name, email: maskEmail(g.email), tier: g.tier, status: g.status })),
    };
  },

  getGuestProfile(db, { guestId }) {
    const g = findGuest(db, guestId);
    const stay = db.reservations.find((r) => r.guestId === g.guestId && r.status === 'In house');
    return {
      ...g, email: maskEmail(g.email),
      currentStay: stay ? { reservationId: stay.reservationId, property: propertyName(db, stay.propertyId), room: stay.room, roomType: stay.roomType, checkOut: stay.checkOut } : null,
      upcomingReservations: db.reservations.filter((r) => r.guestId === g.guestId && r.status === 'Confirmed').length,
      openCases: db.cases.filter((c) => c.guestId === g.guestId && c.status === 'Open'),
    };
  },

  listGuestReservations(db, { guestId }) {
    const g = findGuest(db, guestId);
    return {
      guestId: g.guestId, currency: 'USD',
      reservations: db.reservations.filter((r) => r.guestId === g.guestId)
        .map((r) => ({ ...r, property: propertyName(db, r.propertyId), nights: daysBetween(r.checkIn, r.checkOut) })),
    };
  },

  checkRoomAvailability(db, { propertyId, checkIn = TODAY, nights = 1 }) {
    const p = findProperty(db, propertyId);
    if (!DATE_RE.test(checkIn)) throw new ToolError(400, 'INVALID_ARGUMENT', 'checkIn must be YYYY-MM-DD');
    if (checkIn < TODAY) throw new ToolError(400, 'INVALID_ARGUMENT', `checkIn cannot be before ${TODAY}`);
    const weekend = [5, 6].includes(new Date(`${checkIn}T00:00:00Z`).getUTCDay());
    return {
      propertyId: p.propertyId, name: p.name, checkIn, checkOut: addDays(checkIn, nights), nights, currency: 'USD',
      roomTypes: Object.entries(p.roomTypes).map(([roomType, t]) => {
        const nightlyRate = weekend ? money(t.rate * 1.15) : t.rate;
        const roomsLeft = Math.max(0, t.total - t.booked);
        return { roomType, roomsLeft, nightlyRate, totalUsd: money(nightlyRate * nights), available: roomsLeft > 0 };
      }),
    };
  },

  extendHotelStay(db, { reservationId, nights }) {
    const r = findReservation(db, reservationId);
    if (!['In house', 'Confirmed'].includes(r.status)) throw new ToolError(409, 'NOT_EXTENDABLE', `${reservationId} is ${r.status}; only in-house or confirmed stays can be extended`);
    const t = findProperty(db, r.propertyId).roomTypes[r.roomType];
    if (t.booked >= t.total) throw new ToolError(409, 'NO_AVAILABILITY', `No ${r.roomType} rooms left at ${propertyName(db, r.propertyId)} for the extra nights`);
    const previousCheckOut = r.checkOut;
    r.checkOut = addDays(r.checkOut, nights);
    t.booked += 1;
    return {
      reservationId, property: propertyName(db, r.propertyId), room: r.room, previousCheckOut, newCheckOut: r.checkOut,
      addedNights: nights, nightlyRate: r.nightlyRate, addedCostUsd: money(r.nightlyRate * nights), currency: 'USD',
    };
  },

  cancelHotelReservation(db, { reservationId, reason = '' }) {
    const r = findReservation(db, reservationId);
    if (r.status !== 'Confirmed') throw new ToolError(409, 'NOT_CANCELLABLE', `${reservationId} is ${r.status}; only upcoming confirmed reservations can be cancelled`);
    const nights = daysBetween(r.checkIn, r.checkOut);
    const daysOut = daysBetween(TODAY, r.checkIn);
    let feeUsd = 0; let rule = 'Flexible rate: free cancellation up to 48 hours before check-in.';
    if (r.rateType === 'Advance purchase') { feeUsd = money(r.nightlyRate * nights); rule = 'Advance purchase rate: non-refundable.'; }
    else if (daysOut < 2) { feeUsd = r.nightlyRate; rule = 'Inside 48 hours: one night is charged.'; }
    Object.assign(r, { status: 'Cancelled', cancelledOn: TODAY, cancelReason: String(reason).slice(0, 200), cancellationFeeUsd: feeUsd });
    const t = findProperty(db, r.propertyId).roomTypes[r.roomType];
    t.booked = Math.max(0, t.booked - 1);
    return { reservationId, property: propertyName(db, r.propertyId), checkIn: r.checkIn, status: r.status, cancellationFeeUsd: feeUsd, currency: 'USD', rule, confirmation: `CXL-${reservationId.slice(4)}` };
  },

  requestRoomChange(db, { reservationId, reason, roomType }) {
    const r = findReservation(db, reservationId);
    if (r.status !== 'In house') throw new ToolError(409, 'NOT_IN_HOUSE', `${reservationId} is ${r.status}; room changes are for in-house guests`);
    const target = roomType || r.roomType;
    const p = findProperty(db, r.propertyId);
    const t = p.roomTypes[target];
    if (!t || !t.free.length) throw new ToolError(409, 'NO_ROOM_AVAILABLE', `No clean ${target} room free at ${p.name} right now`);
    const fromRoom = r.room;
    const toRoom = t.free.shift();
    Object.assign(r, { room: toRoom, roomType: target });
    const move = { fromRoom, toRoom, roomType: target, reason: String(reason).slice(0, 200), movedOn: TODAY, extraChargeUsd: 0 };
    r.roomMoves = [...(r.roomMoves || []), move];
    return { reservationId, property: p.name, ...move, keysReady: 'New keys at the front desk; luggage assistance on request.' };
  },

  getGuestFolio(db, { reservationId }) {
    const r = findReservation(db, reservationId);
    const charges = db.charges.filter((c) => c.reservationId === r.reservationId);
    const paid = db.payments.filter((p) => p.reservationId === r.reservationId);
    const chargesTotal = charges.reduce((s, c) => s + c.amount, 0);
    const creditsTotal = charges.reduce((s, c) => s + c.credits.reduce((t, x) => t + x.amount, 0), 0);
    const paidTotal = paid.reduce((s, p) => s + p.amount, 0);
    return {
      reservationId, guestId: r.guestId, property: propertyName(db, r.propertyId), status: r.status, currency: 'USD',
      charges: charges.map((c) => ({ ...c, creditableRemaining: creditable(c) })),
      payments: paid,
      totals: { chargesUsd: money(chargesTotal), creditsUsd: money(creditsTotal), paymentsUsd: money(paidTotal), balanceUsd: money(chargesTotal - creditsTotal - paidTotal) },
    };
  },

  issueFolioCredit(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === chargeId);
    if (!c) throw new ToolError(404, 'NOT_FOUND', `Charge ${chargeId} not found`);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = creditable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${chargeId} can be credited`);
    const cr = {
      creditId: `CR-${chargeId.slice(4)}-${c.credits.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Posted', postedOn: TODAY,
    };
    c.credits.push(cr);
    return { chargeId, reservationId: c.reservationId, description: c.description, ...cr, creditableRemaining: money(remaining - amount) };
  },

  getLoyaltyBalance(db, { guestId }) {
    const g = findGuest(db, guestId);
    const acct = db.loyalty.find((l) => l.guestId === g.guestId);
    if (!acct) throw new ToolError(404, 'NOT_FOUND', `${guestId} has no loyalty account`);
    const missing = db.reservations.filter((r) => r.guestId === g.guestId && r.status === 'Completed' && !r.pointsPosted).map((r) => r.reservationId);
    return { guestId: g.guestId, name: g.name, ...acct, postings: acct.postings.slice(-5), staysMissingPoints: missing };
  },

  creditMissingStayPoints(db, { reservationId }) {
    const r = findReservation(db, reservationId);
    if (r.status !== 'Completed') throw new ToolError(409, 'STAY_NOT_COMPLETED', `${reservationId} is ${r.status}; points post after checkout`);
    if (r.pointsPosted) throw new ToolError(409, 'ALREADY_POSTED', `Points for ${reservationId} were already posted`);
    const acct = db.loyalty.find((l) => l.guestId === r.guestId);
    if (!acct) throw new ToolError(404, 'NOT_FOUND', `${r.guestId} has no loyalty account`);
    const nights = daysBetween(r.checkIn, r.checkOut);
    const roomSpend = r.nightlyRate * nights;
    const points = Math.round(roomSpend * 10 * (1 + (TIER_BONUS[acct.tier] || 0)));
    r.pointsPosted = true;
    acct.points += points;
    acct.nightsThisYear += nights;
    const posting = { date: TODAY, reservationId, points, description: `Missing stay credit: ${propertyName(db, r.propertyId)}` };
    acct.postings.push(posting);
    return { guestId: r.guestId, ...posting, basis: `${roomSpend} USD room spend x 10 pts + ${Math.round((TIER_BONUS[acct.tier] || 0) * 100)}% ${acct.tier} bonus`, newBalance: acct.points, nightsThisYear: acct.nightsThisYear };
  },

  bookHotelAmenity(db, { reservationId, amenity, date = TODAY }) {
    const r = findReservation(db, reservationId);
    if (!['In house', 'Confirmed'].includes(r.status)) throw new ToolError(409, 'NOT_ACTIVE', `${reservationId} is ${r.status}; amenities are for current or upcoming stays`);
    if (!DATE_RE.test(date)) throw new ToolError(400, 'INVALID_ARGUMENT', 'date must be YYYY-MM-DD');
    if (date < r.checkIn || date > r.checkOut) throw new ToolError(409, 'OUTSIDE_STAY', `${date} is outside the stay (${r.checkIn} to ${r.checkOut})`);
    if (amenity === 'Late checkout' && date !== r.checkOut) throw new ToolError(409, 'OUTSIDE_STAY', `Late checkout is only on the departure day, ${r.checkOut}`);
    if (db.amenityBookings.some((a) => a.reservationId === reservationId && a.amenity === amenity && a.date === date && a.status === 'Booked')) {
      throw new ToolError(409, 'ALREADY_BOOKED', `${amenity} is already booked for ${date}`);
    }
    const tier = findGuest(db, r.guestId).tier;
    const price = amenity === 'Late checkout' && ['Gold', 'Platinum'].includes(tier) ? 0 : AMENITY_PRICE[amenity];
    const b = { bookingId: `AMN-${3301 + db.amenityBookings.length}`, reservationId, amenity, date, price, status: 'Booked' };
    db.amenityBookings.push(b);
    if (price > 0) db.charges.push({ chargeId: `CHG-${7200 + db.charges.length}`, reservationId, date, description: amenity, category: 'Amenity', amount: price, credits: [] });
    const detail = { 'Late checkout': 'Checkout moved to 2 pm.', 'Spa treatment': '60-minute treatment, time confirmed by the spa.', 'Dinner reservation': 'Table held at 7:30 pm.', 'Valet parking': 'Valet for the night.' }[amenity];
    return { ...b, currency: 'USD', detail, note: price === 0 && amenity === 'Late checkout' ? `${tier} benefit: no charge.` : undefined };
  },

  logGuestComplaint(db, { reservationId, subject, priority = 'Medium' }) {
    const r = findReservation(db, reservationId);
    const c = { caseId: `GC-${9001 + db.cases.length}`, reservationId, guestId: r.guestId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY, owner: 'Duty manager' };
    db.cases.push(c);
    return { ...c, followUpWithin: priority === 'High' ? '1 hour' : '1 business day' };
  },

  getOccupancyTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 74.2, 182, 135], ['2025-11', 68.9, 171, 118], ['2025-12', 71.5, 196, 140],
      ['2026-01', 61.3, 158, 97], ['2026-02', 65.8, 164, 108], ['2026-03', 72.4, 177, 128],
      ['2026-04', 75.1, 185, 139], ['2026-05', 78.6, 192, 151], ['2026-06', 83.9, 214, 180],
      ['2026-07', 88.2, 231, 204], ['2026-08', 86.7, 226, 196], ['2026-09', 81.4, 209, 170],
    ].slice(-months).map(([month, occupancyPct, adrUsd, revparUsd]) => ({ month, occupancyPct, adrUsd, revparUsd }));
    return { months: series.length, currency: 'USD', series, trend: 'Summer peak above last year; September softening at the resort, conference demand up.' };
  },

  getRevparByProperty(_db, { period = 'last_30d' }) {
    const f = period === 'last_90d' ? 1.04 : 1;
    const rows = [
      ['Harbor Downtown', 88.1, 201, 84.6], ['Seaside Resort', 79.4, 268, 91.2],
      ['Ridge Mountain Lodge', 66.2, 171, 61.8], ['Lakeside Conference Hotel', 84.7, 162, 80.3],
    ].map(([property, occupancyPct, adrUsd, previousOccupancyPct]) => ({
      property, occupancyPct, adrUsd: money(adrUsd * f), revparUsd: money((occupancyPct / 100) * adrUsd * f), previousOccupancyPct,
    }));
    return { period, currency: 'USD', properties: rows, note: 'Seaside Resort occupancy down 11.8 pts as school holidays ended.' };
  },

  getBookingChannelMix(_db, { period = 'last_30d' }) {
    return {
      period,
      channels: [
        { channel: 'Direct (web and app)', roomNightSharePct: 41, commissionPct: 0 },
        { channel: 'Online travel agencies', roomNightSharePct: 29, commissionPct: 17 },
        { channel: 'Corporate negotiated', roomNightSharePct: 16, commissionPct: 3 },
        { channel: 'Groups and events', roomNightSharePct: 10, commissionPct: 5 },
        { channel: 'Call centre', roomNightSharePct: 4, commissionPct: 0 },
      ],
      commissionCostUsd: period === 'last_90d' ? 2.9e6 : 0.98e6,
      shift: 'Direct share up 3 pts after the loyalty app relaunch.',
    };
  },

  getCancellationRates(_db, { property }) {
    const all = [
      { property: 'Harbor Downtown', cancellationPct: 14.2, noShowPct: 2.1, byRateType: { Flexible: 18.9, 'Advance purchase': 3.2, Corporate: 11.4 } },
      { property: 'Seaside Resort', cancellationPct: 21.7, noShowPct: 1.4, byRateType: { Flexible: 27.3, 'Advance purchase': 4.1, Corporate: 9.8 } },
      { property: 'Ridge Mountain Lodge', cancellationPct: 17.5, noShowPct: 1.9, byRateType: { Flexible: 22.0, 'Advance purchase': 3.6, Corporate: 8.2 } },
      { property: 'Lakeside Conference Hotel', cancellationPct: 9.8, noShowPct: 3.4, byRateType: { Flexible: 12.1, 'Advance purchase': 2.7, Corporate: 10.5 } },
    ];
    return { asOf: TODAY, properties: property ? all.filter((p) => p.property === property) : all, note: 'Aggregated; no individual guest records.' };
  },

  getGuestSatisfactionIndex(_db, { period = 'last_30d' }) {
    const rows = [
      ['Harbor Downtown', 84, 38, ['Room temperature', 'Billing errors', 'Elevator waits']],
      ['Seaside Resort', 89, 52, ['Pool crowding', 'Dining wait times']],
      ['Ridge Mountain Lodge', 91, 57, ['Wi-Fi speed']],
      ['Lakeside Conference Hotel', 82, 31, ['Check-in queues', 'Meeting-room AV']],
    ].map(([property, satisfactionScore, nps, topComplaintThemes]) => ({ property, satisfactionScore, nps, topComplaintThemes }));
    return { period, properties: rows, note: period === 'last_90d' ? '90-day view includes the summer peak.' : 'Harbor Downtown down 3 pts: HVAC faults on floors 12-15 and duplicate folio postings.' };
  },

  getLoyaltyTierMetrics() {
    return {
      asOf: TODAY, currency: 'USD',
      tiers: [
        { tier: 'Member', members: 412000, roomNightSharePct: 22, repeatStayPct: 18 },
        { tier: 'Silver', members: 96000, roomNightSharePct: 19, repeatStayPct: 37 },
        { tier: 'Gold', members: 41000, roomNightSharePct: 24, repeatStayPct: 58 },
        { tier: 'Platinum', members: 8600, roomNightSharePct: 15, repeatStayPct: 74 },
      ],
      pointsLiabilityUsd: 18.4e6,
      note: 'Aggregated; no individual member records.',
    };
  },

  getPropertyMargins(_db, { property }) {
    const all = [
      { property: 'Harbor Downtown', roomRevenueUsd: 24.8e6, fnbRevenueUsd: 6.1e6, operatingCostUsd: 19.2e6 },
      { property: 'Seaside Resort', roomRevenueUsd: 21.3e6, fnbRevenueUsd: 9.4e6, operatingCostUsd: 20.6e6 },
      { property: 'Ridge Mountain Lodge', roomRevenueUsd: 7.9e6, fnbRevenueUsd: 2.6e6, operatingCostUsd: 7.7e6 },
      { property: 'Lakeside Conference Hotel', roomRevenueUsd: 19.6e6, fnbRevenueUsd: 11.8e6, operatingCostUsd: 22.9e6 },
    ].map((p) => {
      const total = p.roomRevenueUsd + p.fnbRevenueUsd;
      return { ...p, gopUsd: money(total - p.operatingCostUsd), gopMarginPct: money(((total - p.operatingCostUsd) / total) * 100) };
    });
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', properties: property ? all.filter((p) => p.property === property) : all };
  },

  runOccupancyForecast(_db, { horizonMonths = 3 }) {
    const base = { 'Harbor Downtown': [86, 204], 'Seaside Resort': [72, 241], 'Ridge Mountain Lodge': [69, 176], 'Lakeside Conference Hotel': [83, 165] };
    const season = [0.97, 0.92, 0.95, 0.84, 0.88, 0.96, 1.0, 1.03, 1.08, 1.12, 1.1, 1.0];
    const forecast = Array.from({ length: horizonMonths }, (_, i) => {
      const month = addDays('2026-10-01', i * 31).slice(0, 7);
      const s = season[i % season.length];
      const byProperty = PROPERTY_NAMES.map((p) => {
        const occupancyPct = money(Math.min(98, base[p][0] * s));
        return { property: p, occupancyPct, low: money(occupancyPct * 0.93), high: money(Math.min(99, occupancyPct * 1.05)), adrUsd: money(base[p][1] * (0.9 + 0.1 * s)) };
      });
      return { month, byProperty };
    });
    return { horizonMonths, model: 'pickup-curve v3 (demo)', currency: 'USD', forecast, driver: 'Conference bookings on the books and holiday demand at the lodge' };
  },
};

module.exports = { build, handlers, TODAY };
