// Deterministic seed data shared by the customer-service and business-insights services.
// Generic on purpose (no company name, no industry): customers, products, orders, cases.
// Same seed => same data on every cold start, so demo scripts are repeatable.

'use strict';

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Jane', 'Arjun', 'Mei', 'Carlos', 'Aisha', 'Tom', 'Priya', 'Lukas', 'Sofia', 'Kenji',
  'Fatima', 'Noah', 'Ananya', 'Liam', 'Chloe', 'Omar', 'Hana', 'Daniel', 'Zara', 'Ethan',
  'Isabel', 'Ravi', 'Grace', 'Mateo', 'Yuki', 'Olivia', 'Samir', 'Emma', 'Wei', 'Lucas'];
const LAST = ['Doe', 'Sharma', 'Chen', 'Garcia', 'Khan', 'Wilson', 'Nair', 'Becker', 'Rossi', 'Tanaka',
  'Ali', 'Brown', 'Iyer', 'Murphy', 'Martin', 'Hassan', 'Kim', 'Lee', 'Ahmed', 'Clark',
  'Santos', 'Menon', 'Taylor', 'Lopez', 'Sato', 'Walker', 'Patel', 'Novak', 'Zhang', 'Silva'];
const CITIES = [
  ['Singapore', 'APAC'], ['Sydney', 'APAC'], ['Mumbai', 'APAC'], ['Tokyo', 'APAC'],
  ['London', 'EMEA'], ['Berlin', 'EMEA'], ['Dubai', 'EMEA'], ['Madrid', 'EMEA'],
  ['New York', 'AMER'], ['Toronto', 'AMER'], ['Austin', 'AMER'], ['São Paulo', 'AMER'],
];
const TIERS = ['Standard', 'Standard', 'Standard', 'Gold', 'Gold', 'Platinum'];
const SEGMENTS = ['Consumer', 'Consumer', 'Small Business', 'Enterprise'];

// Generic catalogue: plans, devices, accessories, services. unitCost is confidential (insights only).
const PRODUCTS = [
  { sku: 'PLN-BASIC', name: 'Basic Plan (monthly)', category: 'Subscriptions', listPrice: 19.0, unitCost: 6.5 },
  { sku: 'PLN-PRO', name: 'Pro Plan (monthly)', category: 'Subscriptions', listPrice: 49.0, unitCost: 14.0 },
  { sku: 'PLN-TEAM', name: 'Team Plan (annual, per seat)', category: 'Subscriptions', listPrice: 399.0, unitCost: 110.0 },
  { sku: 'DEV-HUB', name: 'Smart Hub', category: 'Devices', listPrice: 129.0, unitCost: 71.0 },
  { sku: 'DEV-CAM', name: 'Indoor Camera', category: 'Devices', listPrice: 89.0, unitCost: 52.0 },
  { sku: 'DEV-SENSOR', name: 'Motion Sensor (2-pack)', category: 'Devices', listPrice: 39.0, unitCost: 17.0 },
  { sku: 'ACC-MOUNT', name: 'Wall Mount Kit', category: 'Accessories', listPrice: 15.0, unitCost: 4.0 },
  { sku: 'ACC-BATT', name: 'Backup Battery', category: 'Accessories', listPrice: 29.0, unitCost: 11.0 },
  { sku: 'ACC-CABLE', name: 'Power Cable (2 m)', category: 'Accessories', listPrice: 9.0, unitCost: 2.2 },
  { sku: 'SVC-SETUP', name: 'Professional Setup', category: 'Services', listPrice: 79.0, unitCost: 45.0 },
  { sku: 'SVC-CARE', name: 'Care Plus (1 year)', category: 'Services', listPrice: 59.0, unitCost: 12.0 },
  { sku: 'SVC-RUSH', name: 'Express Delivery', category: 'Services', listPrice: 25.0, unitCost: 18.0 },
];

/** Discount a sales/support rep may offer, by customer tier (percent). */
const TIER_DISCOUNT = { Standard: 5, Gold: 10, Platinum: 15 };

const CASE_TOPICS = [
  ['Late delivery', 'Shipping'], ['Device not connecting', 'Technical'], ['Billing question', 'Billing'],
  ['Wrong item received', 'Shipping'], ['Cancel subscription', 'Account'], ['Refund request', 'Billing'],
  ['Setup appointment', 'Technical'], ['Damaged on arrival', 'Shipping'],
];

const DAY = 86400000;
// Fixed "today" so dates never drift between runs. Months are relative to this.
const TODAY = Date.UTC(2026, 8, 25); // 2026-09-25

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function money(n) { return Math.round(n * 100) / 100; }

function build() {
  const r = rng(20260925);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  const customers = Array.from({ length: 150 }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length];
    const [city, region] = CITIES[i % CITIES.length];
    const id = `CUST-${String(1001 + i)}`;
    return {
      customerId: id,
      name: `${first} ${last}`,
      email: `${first}.${last}@example.com`.toLowerCase(),
      phone: `+1-555-01${String(10 + i).padStart(2, '0')}`,
      tier: i === 0 ? 'Gold' : pick(TIERS),
      segment: pick(SEGMENTS),
      city,
      region,
      customerSince: iso(TODAY - Math.floor(200 + r() * 1400) * DAY),
      lifetimeValue: 0,
    };
  });

  const statuses = ['Delivered', 'Delivered', 'Delivered', 'Delivered', 'Shipped', 'Processing'];
  const orders = [];
  for (let i = 0; i < 1500; i++) {
    const customer = customers[i < customers.length ? i : Math.floor(r() * customers.length)];
    const daysAgo = Math.floor(r() * 180);
    const lineCount = 1 + Math.floor(r() * 3);
    const items = [];
    for (let l = 0; l < lineCount; l++) {
      const p = pick(PRODUCTS);
      if (items.some((it) => it.sku === p.sku)) continue;
      const qty = p.category === 'Accessories' ? 1 + Math.floor(r() * 3) : 1;
      items.push({ sku: p.sku, name: p.name, quantity: qty, unitPrice: p.listPrice });
    }
    const discountPct = r() < 0.35 ? TIER_DISCOUNT[customer.tier] : 0;
    const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const total = money(subtotal * (1 - discountPct / 100));
    let status = daysAgo > 14 ? 'Delivered' : pick(statuses);
    const placed = TODAY - daysAgo * DAY;
    const promised = placed + 5 * DAY;
    orders.push({
      orderId: `ORD-${1000 + i}`,
      customerId: customer.customerId,
      placedOn: iso(placed),
      status,
      items,
      discountPct,
      total,
      currency: 'USD',
      promisedDelivery: iso(promised),
      deliveredOn: status === 'Delivered' ? iso(promised - Math.floor(r() * 2) * DAY) : null,
      carrier: pick(['FastShip', 'ParcelGo', 'SwiftPost']),
      trackingNumber: `TRK${Math.floor(100000000 + r() * 899999999)}`,
      refunds: [],
    });
  }

  // Demo anchor: ORD-1042 belongs to Jane Doe (CUST-1001), is late and stuck in transit.
  const o = orders[42];
  Object.assign(o, {
    customerId: 'CUST-1001',
    placedOn: iso(TODAY - 9 * DAY),
    promisedDelivery: iso(TODAY - 4 * DAY),
    status: 'Delayed',
    deliveredOn: null,
    items: [
      { sku: 'DEV-HUB', name: 'Smart Hub', quantity: 1, unitPrice: 129.0 },
      { sku: 'ACC-MOUNT', name: 'Wall Mount Kit', quantity: 1, unitPrice: 15.0 },
    ],
    discountPct: 0,
    total: 144.0,
    delayReason: 'Held at regional sorting centre (weather)',
    newEstimatedDelivery: iso(TODAY + 2 * DAY),
  });
  // A few more late orders in the last 30 days, which drive the satisfaction dip in insights.
  for (const idx of [12, 27, 55, 61, 77, 160, 233, 410, 518, 702, 901, 1203]) {
    const lo = orders[idx];
    lo.placedOn = iso(TODAY - (8 + (idx % 6)) * DAY);
    lo.promisedDelivery = iso(TODAY - (3 + (idx % 3)) * DAY);
    lo.status = 'Delayed';
    lo.deliveredOn = null;
    lo.delayReason = 'Carrier capacity shortage';
  }

  for (const c of customers) {
    c.lifetimeValue = money(orders.filter((x) => x.customerId === c.customerId).reduce((s, x) => s + x.total, 0));
  }

  const cases = [];
  for (let i = 0; i < 500; i++) {
    const [subject, category] = pick(CASE_TOPICS);
    const daysAgo = Math.floor(r() * 180);
    // Recent 30 days: more shipping cases and lower CSAT (the story analysts uncover).
    const recent = daysAgo < 30;
    const finalSubject = recent && r() < 0.55 ? 'Late delivery' : subject;
    const finalCategory = finalSubject === 'Late delivery' ? 'Shipping' : category;
    const csatBase = finalCategory === 'Shipping' ? (recent ? 2.6 : 3.8) : 4.3;
    cases.push({
      caseId: `CASE-${5000 + i}`,
      customerId: pick(customers).customerId,
      subject: finalSubject,
      category: finalCategory,
      priority: pick(['Low', 'Medium', 'Medium', 'High']),
      status: daysAgo < 5 ? 'Open' : 'Resolved',
      openedOn: iso(TODAY - daysAgo * DAY),
      resolutionHours: daysAgo < 5 ? null : Math.round((recent ? 30 : 16) + r() * 20),
      csat: daysAgo < 5 ? null : Math.max(1, Math.min(5, Math.round((csatBase + (r() - 0.5) * 1.6) * 10) / 10)),
    });
  }

  return { customers, products: PRODUCTS, orders, cases };
}

module.exports = { build, TIER_DISCOUNT, TODAY, DAY, iso, money };
