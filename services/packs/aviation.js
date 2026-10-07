// Aviation handlers and seed data for the industry-apis service (pack: industries/aviation.json).
//
// An airline. Story: Morgan Blake (PAX-4101, Gold) was booked on FL214 Boston to Denver on
// 2026-09-24 (PNR K7QX2M). The flight was cancelled for crew availability and Morgan was
// auto-rebooked on tonight's FL218 in middle seat 31E, losing the paid aisle seat 12A. The
// checked bag (BAG-0077120) went ahead on FL216 and is waiting at Denver, and a $120 change
// fee (CHG-6102) was charged in error on the involuntary rebooking. Refunding the $30 seat
// fee (CHG-6101) is within policy; refunding the $120 change fee is over the $50 limit that
// Apigee enforces for Passenger Services. The limit is not enforced here, so the gateway
// control stays visible: this service records whatever refund reaches it (up to the amount
// charged).
//
// Demo "today" is 2026-09-25, like the generic services. All data is fictional, in USD.

'use strict';

const { ToolError, money, maskEmail } = require('./common');

const TODAY = '2026-09-25';

function build() {
  const passengers = [
    { passengerId: 'PAX-4101', name: 'Morgan Blake', email: 'morgan.blake@example.com', frequentFlyerNo: 'FF-88341010', tier: 'Gold', homeAirport: 'DEN', memberSince: '2019-03-14' },
    { passengerId: 'PAX-4102', name: 'Priya Shah', email: 'priya.shah@example.com', frequentFlyerNo: 'FF-88341022', tier: 'Silver', homeAirport: 'JFK', memberSince: '2022-07-02' },
    { passengerId: 'PAX-4103', name: 'Daniel Ortiz', email: 'daniel.ortiz@example.com', frequentFlyerNo: 'FF-88341035', tier: 'Platinum', homeAirport: 'ORD', memberSince: '2014-11-20' },
    { passengerId: 'PAX-4104', name: 'Grace Kim', email: 'grace.kim@example.com', frequentFlyerNo: 'FF-88341047', tier: 'Member', homeAirport: 'SFO', memberSince: '2026-01-08' },
    { passengerId: 'PAX-4105', name: 'Morgana Ellis', email: 'morgana.ellis@example.com', frequentFlyerNo: 'FF-88341059', tier: 'Silver', homeAirport: 'BOS', memberSince: '2021-05-30' },
  ];
  const flights = [
    { flightNumber: 'FL214', route: 'BOS-DEN', date: '2026-09-24', scheduledDeparture: '18:05', scheduledArrival: '21:10', aircraft: 'A321neo', status: 'Cancelled', reason: 'Crew availability (duty-time limit after inbound delay)', gate: null, openSeats: [] },
    { flightNumber: 'FL216', route: 'BOS-DEN', date: '2026-09-25', scheduledDeparture: '07:10', scheduledArrival: '10:15', estimatedArrival: '10:02', aircraft: 'A321neo', status: 'Landed', gate: 'B22', openSeats: [] },
    { flightNumber: 'FL220', route: 'BOS-DEN', date: '2026-09-25', scheduledDeparture: '13:15', scheduledArrival: '16:20', aircraft: '737-800', status: 'On time', gate: 'B18', openSeats: ['9D', '27C'] },
    { flightNumber: 'FL218', route: 'BOS-DEN', date: '2026-09-25', scheduledDeparture: '19:40', scheduledArrival: '22:45', aircraft: 'A321neo', status: 'On time', gate: 'B24', openSeats: ['12C', '14A', '23F'] },
    { flightNumber: 'FL305', route: 'JFK-MIA', date: '2026-09-25', scheduledDeparture: '09:30', scheduledArrival: '12:40', estimatedDeparture: '10:55', aircraft: '737-800', status: 'Delayed', reason: 'Air traffic control flow program at MIA', gate: 'C7', openSeats: ['4A', '18B'] },
    { flightNumber: 'FL512', route: 'DEN-SFO', date: '2026-09-28', scheduledDeparture: '08:20', scheduledArrival: '10:05', aircraft: 'A320', status: 'Scheduled', gate: null, openSeats: ['7A', '15F', '22C'] },
    { flightNumber: 'FL741', route: 'ORD-SEA', date: '2026-09-26', scheduledDeparture: '11:00', scheduledArrival: '13:35', aircraft: '737 MAX 8', status: 'Scheduled', gate: null, openSeats: ['2A', '11D'] },
  ];
  const bookings = [
    {
      pnr: 'K7QX2M', passengerId: 'PAX-4101', cabin: 'Economy', status: 'Ticketed', bookedOn: '2026-08-30',
      segments: [
        { segment: 1, flightNumber: 'FL214', date: '2026-09-24', seat: '12A', status: 'Cancelled' },
        { segment: 2, flightNumber: 'FL218', date: '2026-09-25', seat: '31E', status: 'Confirmed', note: 'Auto-rebooked after FL214 cancellation' },
        { segment: 3, flightNumber: 'FL512', date: '2026-09-28', seat: '7A', status: 'Confirmed' },
      ],
      bags: ['BAG-0077120'],
    },
    {
      pnr: 'R2LM8T', passengerId: 'PAX-4102', cabin: 'Economy', status: 'Ticketed', bookedOn: '2026-09-10',
      segments: [{ segment: 1, flightNumber: 'FL305', date: '2026-09-25', seat: '21C', status: 'Confirmed' }], bags: [],
    },
    {
      pnr: 'H9PD4W', passengerId: 'PAX-4103', cabin: 'First', status: 'Ticketed', bookedOn: '2026-09-01',
      segments: [{ segment: 1, flightNumber: 'FL741', date: '2026-09-26', seat: '2C', status: 'Confirmed' }], bags: ['BAG-0077188'],
    },
  ];
  const bags = [
    {
      bagTag: 'BAG-0077120', pnr: 'K7QX2M', passengerId: 'PAX-4101', checkedAt: 'BOS', checkedOn: '2026-09-24', originalFlight: 'FL214',
      status: 'Delayed', currentLocation: 'DEN baggage service office', lastScan: '2026-09-25 10:31 DEN, off FL216',
      note: 'Not returned after FL214 cancellation; forwarded on FL216 and held at DEN.', claimId: null,
    },
    {
      bagTag: 'BAG-0077188', pnr: 'H9PD4W', passengerId: 'PAX-4103', checkedAt: 'ORD', checkedOn: null, originalFlight: 'FL741',
      status: 'Not yet checked', currentLocation: null, lastScan: null, claimId: null,
    },
  ];
  const miles = [
    { passengerId: 'PAX-4101', balance: 48210, tier: 'Gold', tierMilesYtd: 41300, nextTier: 'Platinum', nextTierAt: 75000, credits: [] },
    { passengerId: 'PAX-4102', balance: 12640, tier: 'Silver', tierMilesYtd: 26100, nextTier: 'Gold', nextTierAt: 40000, credits: [] },
    { passengerId: 'PAX-4103', balance: 212880, tier: 'Platinum', tierMilesYtd: 96400, nextTier: null, nextTierAt: null, credits: [] },
    { passengerId: 'PAX-4104', balance: 3120, tier: 'Member', tierMilesYtd: 3120, nextTier: 'Silver', nextTierAt: 20000, credits: [] },
    { passengerId: 'PAX-4105', balance: 18950, tier: 'Silver', tierMilesYtd: 22400, nextTier: 'Gold', nextTierAt: 40000, credits: [] },
  ];
  const charges = [
    { chargeId: 'CHG-6100', pnr: 'K7QX2M', description: 'Round-trip fare BOS-DEN-SFO, Economy', amount: 348, chargedOn: '2026-08-30' },
    { chargeId: 'CHG-6101', pnr: 'K7QX2M', description: 'Seat selection 12A (aisle), FL214', amount: 30, chargedOn: '2026-08-30', note: 'Seat lost when FL214 was cancelled' },
    { chargeId: 'CHG-6102', pnr: 'K7QX2M', description: 'Same-day change fee, FL214 to FL218', amount: 120, chargedOn: '2026-09-24', note: 'Charged on an involuntary rebooking' },
    { chargeId: 'CHG-6103', pnr: 'K7QX2M', description: 'First checked bag, FL214', amount: 35, chargedOn: '2026-09-24' },
    { chargeId: 'CHG-6110', pnr: 'R2LM8T', description: 'One-way fare JFK-MIA, Economy', amount: 179, chargedOn: '2026-09-10' },
    { chargeId: 'CHG-6120', pnr: 'H9PD4W', description: 'One-way fare ORD-SEA, First', amount: 612, chargedOn: '2026-09-01' },
  ].map((c) => ({ ...c, refunds: [] }));
  const cases = [
    { caseId: 'CASE-7001', passengerId: 'PAX-4102', subject: 'Missed connection after FL305 delay last month', priority: 'Medium', status: 'Open', openedOn: '2026-09-02' },
  ];
  const claims = [];
  return { passengers, flights, bookings, bags, miles, charges, cases, claims };
}

const nf = (what, id) => new ToolError(404, 'NOT_FOUND', `${what} ${id} not found`);
const findPassenger = (db, id) => db.passengers.find((x) => x.passengerId === id) || (() => { throw nf('Passenger', id); })();
const findBooking = (db, pnr) => db.bookings.find((x) => x.pnr === String(pnr).toUpperCase()) || (() => { throw nf('Booking', pnr); })();
const findFlight = (db, n) => db.flights.find((x) => x.flightNumber === String(n).toUpperCase()) || (() => { throw nf('Flight', n); })();
const findBag = (db, tag) => db.bags.find((x) => x.bagTag === String(tag).toUpperCase()) || (() => { throw nf('Bag', tag); })();
const refundable = (c) => money(c.amount - c.refunds.reduce((s, r) => s + r.amount, 0));
const nextSegment = (b) => b.segments.find((s) => s.status === 'Confirmed');
const withFlight = (db, s) => {
  const f = db.flights.find((x) => x.flightNumber === s.flightNumber);
  return { ...s, route: f?.route, departure: f?.scheduledDeparture, flightStatus: f?.status };
};

const ROUTES = ['BOS-DEN', 'JFK-MIA', 'DEN-SFO', 'ORD-SEA', 'BOS-LHR'];
const PERIOD = (p) => (p === 'last_90d' ? 'last_90d' : 'last_30d');

const handlers = {
  searchPassengers(db, { query }) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) throw new ToolError(400, 'INVALID_ARGUMENT', 'query must be at least 2 characters');
    const hits = db.passengers.filter((p) =>
      p.name.toLowerCase().includes(q) || p.passengerId.toLowerCase() === q || p.email.toLowerCase().startsWith(q));
    return {
      count: hits.length,
      passengers: hits.map((p) => ({ passengerId: p.passengerId, name: p.name, email: maskEmail(p.email), tier: p.tier, homeAirport: p.homeAirport })),
    };
  },

  getPassengerProfile(db, { passengerId }) {
    const p = findPassenger(db, passengerId);
    const bookings = db.bookings.filter((b) => b.passengerId === p.passengerId);
    return {
      ...p, email: maskEmail(p.email),
      bookings: bookings.map((b) => {
        const next = nextSegment(b);
        return { pnr: b.pnr, cabin: b.cabin, nextFlight: next ? withFlight(db, next) : null, disrupted: b.segments.some((s) => s.status === 'Cancelled') };
      }),
      openCases: db.cases.filter((c) => c.passengerId === p.passengerId && c.status === 'Open'),
      openBagClaims: db.claims.filter((c) => c.passengerId === p.passengerId),
    };
  },

  getBookingRecord(db, { pnr }) {
    const b = findBooking(db, pnr);
    const p = findPassenger(db, b.passengerId);
    return {
      ...b, passengerName: p.name,
      segments: b.segments.map((s) => withFlight(db, s)),
      bags: b.bags.map((tag) => { const g = findBag(db, tag); return { bagTag: g.bagTag, status: g.status, currentLocation: g.currentLocation }; }),
    };
  },

  getFlightStatus(db, { flightNumber }) {
    const f = findFlight(db, flightNumber);
    const { openSeats, ...rest } = f;
    const out = { ...rest, seatsAvailable: openSeats.length };
    if (f.status === 'Cancelled') {
      out.alternatives = db.flights
        .filter((x) => x.route === f.route && x.flightNumber !== f.flightNumber && x.openSeats.length && x.status !== 'Landed')
        .map((x) => ({ flightNumber: x.flightNumber, date: x.date, departure: x.scheduledDeparture, seatsAvailable: x.openSeats.length }));
      out.passengerRights = 'Involuntary change: no change fees apply; seat fees for lost seats are refundable.';
    }
    return out;
  },

  rebookPassenger(db, { pnr, flightNumber }) {
    const b = findBooking(db, pnr);
    const target = findFlight(db, flightNumber);
    const seg = nextSegment(b);
    if (!seg) throw new ToolError(409, 'NO_UNFLOWN_SEGMENT', `${b.pnr} has no unflown segment to rebook`);
    const current = findFlight(db, seg.flightNumber);
    if (target.flightNumber === current.flightNumber) throw new ToolError(409, 'SAME_FLIGHT', `${b.pnr} is already on ${target.flightNumber}`);
    if (target.route !== current.route) throw new ToolError(409, 'ROUTE_MISMATCH', `${target.flightNumber} flies ${target.route}, not ${current.route}`);
    if (['Cancelled', 'Landed', 'Departed'].includes(target.status)) throw new ToolError(409, 'FLIGHT_UNAVAILABLE', `${target.flightNumber} is ${target.status}`);
    if (!target.openSeats.length) throw new ToolError(409, 'FLIGHT_FULL', `${target.flightNumber} has no open seats; offer the standby list`);
    const seat = target.openSeats.shift();
    if (seg.seat) current.openSeats.push(seg.seat);
    const from = seg.flightNumber;
    Object.assign(seg, { flightNumber: target.flightNumber, date: target.date, seat, note: `Rebooked from ${from} on ${TODAY}` });
    return { pnr: b.pnr, segment: seg.segment, from, to: target.flightNumber, date: target.date, departure: target.scheduledDeparture, seat, changeFee: 0, currency: 'USD', status: 'Confirmed' };
  },

  changeSeatAssignment(db, { pnr, seat }) {
    const b = findBooking(db, pnr);
    const seg = nextSegment(b);
    if (!seg) throw new ToolError(409, 'NO_UNFLOWN_SEGMENT', `${b.pnr} has no unflown segment`);
    const f = findFlight(db, seg.flightNumber);
    const want = String(seat).toUpperCase();
    if (!f.openSeats.includes(want)) throw new ToolError(409, 'SEAT_UNAVAILABLE', `${want} is not open on ${f.flightNumber}; open seats: ${f.openSeats.join(', ') || 'none'}`);
    f.openSeats = f.openSeats.filter((s) => s !== want);
    const previous = seg.seat;
    if (previous) f.openSeats.push(previous);
    seg.seat = want;
    return { pnr: b.pnr, flightNumber: f.flightNumber, previousSeat: previous, newSeat: want, fee: 0, currency: 'USD', note: 'No charge: disruption re-seat.' };
  },

  traceDelayedBaggage(db, { bagTag }) {
    const g = findBag(db, bagTag);
    const p = findPassenger(db, g.passengerId);
    const nextStep = g.claimId ? `Claim ${g.claimId} filed; courier delivery booked.`
      : g.status === 'Delayed' ? 'File a delayed-bag claim to have it delivered, or collect it at the DEN baggage office.' : 'No action needed.';
    return { ...g, passengerName: p.name, nextStep };
  },

  fileBaggageClaim(db, { bagTag, deliveryAddress = '' }) {
    const g = findBag(db, bagTag);
    if (g.status !== 'Delayed') throw new ToolError(409, 'BAG_NOT_DELAYED', `${g.bagTag} is ${g.status}; claims are only for delayed bags`);
    if (g.claimId) throw new ToolError(409, 'CLAIM_EXISTS', `${g.bagTag} already has claim ${g.claimId}`);
    const claim = {
      claimId: `BCL-${5301 + db.claims.length}`, bagTag: g.bagTag, passengerId: g.passengerId, filedOn: TODAY,
      deliveryAddress: String(deliveryAddress || 'Passenger home address on file').slice(0, 200),
      deliveryWindow: '2026-09-25 18:00-22:00', interimExpenseAllowanceUsd: 50, status: 'Delivery booked',
    };
    db.claims.push(claim);
    g.claimId = claim.claimId;
    g.status = 'Out for delivery';
    return claim;
  },

  getMileageBalance(db, { passengerId }) {
    const p = findPassenger(db, passengerId);
    const m = db.miles.find((x) => x.passengerId === p.passengerId);
    return {
      passengerId: p.passengerId, name: p.name, frequentFlyerNo: p.frequentFlyerNo, ...m,
      milesToNextTier: m.nextTierAt ? m.nextTierAt - m.tierMilesYtd : 0,
    };
  },

  creditBonusMiles(db, { passengerId, miles, reason = '' }) {
    const p = findPassenger(db, passengerId);
    const m = db.miles.find((x) => x.passengerId === p.passengerId);
    const credit = { creditId: `MC-${p.passengerId.slice(4)}-${m.credits.length + 1}`, miles, reason: String(reason).slice(0, 200), postedOn: TODAY };
    m.credits.push(credit);
    m.balance += miles;
    return { passengerId: p.passengerId, ...credit, newBalance: m.balance, note: 'Goodwill miles do not count toward tier status.' };
  },

  listBookingCharges(db, { pnr }) {
    const b = findBooking(db, pnr);
    const rows = db.charges.filter((c) => c.pnr === b.pnr).map((c) => ({ ...c, refundableRemaining: refundable(c) }));
    return { pnr: b.pnr, passengerId: b.passengerId, currency: 'USD', totalCharged: money(rows.reduce((t, c) => t + c.amount, 0)), charges: rows };
  },

  refundFareCharge(db, { chargeId, amount, reason = '' }) {
    const c = db.charges.find((x) => x.chargeId === String(chargeId).toUpperCase());
    if (!c) throw nf('Charge', chargeId);
    if (!(amount > 0)) throw new ToolError(400, 'INVALID_AMOUNT', 'amount must be a positive number');
    const remaining = refundable(c);
    if (amount > remaining) throw new ToolError(409, 'EXCEEDS_CHARGE', `Only ${remaining} USD of ${c.chargeId} can be refunded`);
    const r = {
      refundId: `RF-${c.chargeId.slice(4)}-${c.refunds.length + 1}`, amount: money(amount), currency: 'USD',
      reason: String(reason).slice(0, 200), status: 'Approved', postedOn: TODAY, arrivesIn: '5-7 business days to the original card',
    };
    c.refunds.push(r);
    return { chargeId: c.chargeId, pnr: c.pnr, description: c.description, ...r, refundableRemaining: money(remaining - amount) };
  },

  openPassengerCase(db, { passengerId, subject, priority = 'Medium' }) {
    const p = findPassenger(db, passengerId);
    const c = { caseId: `CASE-${7001 + db.cases.length}`, passengerId: p.passengerId, subject: String(subject).slice(0, 120), priority, status: 'Open', openedOn: TODAY };
    db.cases.push(c);
    return { ...c, firstResponseWithin: priority === 'High' ? '4 hours' : '2 business days' };
  },

  getOnTimePerformance(_db, { period }) {
    const p = PERIOD(period);
    const hubs = [
      ['BOS', 78.4, 80.1, 1.9], ['DEN', 74.2, 76.8, 2.6], ['JFK', 71.5, 73.0, 2.2], ['ORD', 76.9, 78.2, 1.7], ['SFO', 81.3, 83.0, 1.1],
    ].map(([hub, onTimeDeparturePct, onTimeArrivalPct, cancellationPct]) => ({ hub, onTimeDeparturePct, onTimeArrivalPct, cancellationPct }));
    return {
      period: p, flightsOperated: p === 'last_90d' ? 41820 : 13960, networkOnTimeArrivalPct: p === 'last_90d' ? 79.6 : 78.1,
      previousPeriodPct: p === 'last_90d' ? 80.4 : 81.0, hubs,
      topDelayCauses: [{ cause: 'Late inbound aircraft', sharePct: 34 }, { cause: 'Crew availability', sharePct: 21 }, { cause: 'ATC / weather', sharePct: 19 }, { cause: 'Maintenance', sharePct: 14 }, { cause: 'Ground handling', sharePct: 12 }],
      note: 'Crew-availability cancellations up at DEN and BOS this month.',
    };
  },

  getLoadFactorTrends(_db, { months = 6 }) {
    const series = [
      ['2025-10', 2.41, 1.99], ['2025-11', 2.33, 1.87], ['2025-12', 2.52, 2.16], ['2026-01', 2.28, 1.78],
      ['2026-02', 2.19, 1.74], ['2026-03', 2.46, 2.05], ['2026-04', 2.50, 2.08], ['2026-05', 2.61, 2.22],
      ['2026-06', 2.74, 2.44], ['2026-07', 2.81, 2.53], ['2026-08', 2.79, 2.49], ['2026-09', 2.58, 2.20],
    ].slice(-months).map(([month, seatsM, passengersM]) => ({ month, seatsM, passengersM, loadFactorPct: money((passengersM / seatsM) * 100) }));
    return {
      months: series.length, series,
      byRoute: [
        { route: 'BOS-DEN', loadFactorPct: 88.2 }, { route: 'JFK-MIA', loadFactorPct: 91.4 }, { route: 'DEN-SFO', loadFactorPct: 84.7 },
        { route: 'ORD-SEA', loadFactorPct: 79.9 }, { route: 'BOS-LHR', loadFactorPct: 86.3 },
      ],
      trend: 'Summer peak at 90%; September softening on transcon leisure routes.',
    };
  },

  getDisruptionCostSummary(_db, { period }) {
    const p = PERIOD(period);
    const f = p === 'last_90d' ? 3.2 : 1;
    const byCause = [
      ['Crew availability', 2.84], ['Weather / ATC', 2.11], ['Maintenance', 1.62], ['Late inbound aircraft', 1.05],
    ].map(([cause, costUsdM]) => ({ cause, costUsd: Math.round(costUsdM * 1e6 * f) }));
    return {
      period: p, currency: 'USD', disruptedPassengers: Math.round(38400 * f),
      costBreakdownUsd: { rebooking: Math.round(2.1e6 * f), hotelsAndMeals: Math.round(1.9e6 * f), compensationAndRefunds: Math.round(2.6e6 * f), bagDelivery: Math.round(0.4e6 * f), goodwillMilesValue: Math.round(0.62e6 * f) },
      byCause, note: 'Crew-driven cancellations are the largest and fastest-growing cost.',
    };
  },

  getBaggageMishandlingRates(_db, { period }) {
    const p = PERIOD(period);
    const hubs = [['BOS', 6.1, 5.2], ['DEN', 7.4, 6.0], ['JFK', 8.2, 7.9], ['ORD', 6.8, 6.9], ['SFO', 4.9, 5.1]]
      .map(([hub, per1k, previousPer1k]) => ({ hub, per1k, previousPer1k }));
    return {
      period: p, networkPer1k: p === 'last_90d' ? 6.4 : 6.8, previousPer1k: p === 'last_90d' ? 6.1 : 6.0, hubs,
      byCause: [{ cause: 'Transfer / misconnect', sharePct: 44 }, { cause: 'Flight cancellation', sharePct: 23 }, { cause: 'Loading error', sharePct: 18 }, { cause: 'Tagging error', sharePct: 9 }, { cause: 'Other', sharePct: 6 }],
      medianReturnHours: 26,
    };
  },

  getFrequentFlyerMetrics(_db, { period }) {
    const p = PERIOD(period);
    const f = p === 'last_90d' ? 3 : 1;
    return {
      period: p,
      activeMembersByTier: [{ tier: 'Member', members: 4120000 }, { tier: 'Silver', members: 318000 }, { tier: 'Gold', members: 96400 }, { tier: 'Platinum', members: 21800 }],
      milesEarnedM: 1840 * f, milesRedeemedM: 1310 * f, breakagePct: 17.5, awardSeatSharePct: 7.8, goodwillMilesM: 42 * f,
      note: 'Goodwill miles issued up 38% with disruption volumes. Aggregated, no member records.',
    };
  },

  getCabinSatisfactionScores(_db, { period }) {
    const p = PERIOD(period);
    return {
      period: p,
      byCabin: [{ cabin: 'First', nps: 52, csat: 4.5 }, { cabin: 'Premium Economy', nps: 38, csat: 4.2 }, { cabin: 'Economy', nps: 18, csat: 3.8 }],
      byJourneyStage: [{ stage: 'Booking', csat: 4.3 }, { stage: 'Check-in', csat: 4.1 }, { stage: 'Boarding', csat: 3.9 }, { stage: 'Onboard', csat: 4.0 }, { stage: 'Disruption handling', csat: 2.9 }, { stage: 'Baggage', csat: 3.4 }],
      responses: p === 'last_90d' ? 61200 : 20400,
      note: 'Disruption handling is the lowest-scoring stage; NPS falls 41 pts for passengers with a cancellation.',
    };
  },

  getRouteProfitability(_db, { route }) {
    const all = [
      { route: 'BOS-DEN', passengers: 412000, revenueUsd: 98.6e6, operatingCostUsd: 86.1e6 },
      { route: 'JFK-MIA', passengers: 688000, revenueUsd: 121.4e6, operatingCostUsd: 101.9e6 },
      { route: 'DEN-SFO', passengers: 356000, revenueUsd: 61.2e6, operatingCostUsd: 58.4e6 },
      { route: 'ORD-SEA', passengers: 281000, revenueUsd: 64.8e6, operatingCostUsd: 66.3e6 },
      { route: 'BOS-LHR', passengers: 198000, revenueUsd: 154.7e6, operatingCostUsd: 128.2e6 },
    ].map((r) => ({ ...r, marginPct: money(((r.revenueUsd - r.operatingCostUsd) / r.revenueUsd) * 100), revenuePerPassengerUsd: money(r.revenueUsd / r.passengers) }));
    return { classification: 'Confidential', currency: 'USD', period: 'FY2026 YTD', routes: route && ROUTES.includes(route) ? all.filter((r) => r.route === route) : all };
  },

  runPassengerDemandForecast(_db, { horizonMonths = 3 }) {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'].slice(0, horizonMonths);
    const base = { 'BOS-DEN': 34000, 'JFK-MIA': 58000, 'DEN-SFO': 29500, 'ORD-SEA': 23000, 'BOS-LHR': 16500 };
    const season = [0.97, 0.94, 1.06, 0.9, 0.88, 1.02, 1.03, 1.08, 1.15, 1.2, 1.18, 1.0];
    const forecast = months.map((month, i) => {
      const byRoute = ROUTES.map((r) => {
        const expected = Math.round(base[r] * season[i] * (1 + 0.004 * (i + 1)));
        return { route: r, expectedPassengers: expected, low: Math.round(expected * 0.92), high: Math.round(expected * 1.07) };
      });
      return { month, totalPassengers: byRoute.reduce((t, x) => t + x.expectedPassengers, 0), expectedLoadFactorPct: money(82 + 8 * (season[i] - 0.9)), byRoute };
    });
    return { horizonMonths, model: 'booking-curve v3 (demo)', forecast, driver: 'Holiday peak in December; Miami leisure demand strongest' };
  },
};

module.exports = { build, handlers, TODAY };
