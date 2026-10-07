import test from 'node:test';
import assert from 'node:assert/strict';
// The real comparators MonetizationManager.tsx renders with. These used to be pasted
// into this file, so the suite kept passing even if the component's sort changed.
import {
  sortDeveloperList,
  sortAttributionTable,
  defaultAttributionSortDirection,
} from '../src/utils/monetizationSort.js';

// Test suite for Developer List Sorting & Attribution Table Column Sorting logic

const SAMPLE_ATTRIBUTIONS = [
  {
    userEmail: 'priyanka@google.com',
    name: 'Priyanka',
    tier: 'Engineering and IT',
    badge: 'Prepaid Wallet',
    billingType: 'PREPAID',
    totalConsumedUsd: 0.00,
    totalCalls: 1,
    totalTokens: 116,
    currentBalanceUsd: 20.00,
  },
  {
    userEmail: 'ingrid@google.com',
    name: 'Ingrid',
    tier: 'Customer Support and Sales',
    badge: 'Prepaid Wallet',
    billingType: 'PREPAID',
    totalConsumedUsd: 0.00,
    totalCalls: 0,
    totalTokens: 0,
    currentBalanceUsd: 20.00,
  },
  {
    userEmail: 'avery.grant@example.com',
    name: 'Avery Grant',
    tier: 'Engineering and IT',
    badge: 'Prepaid Wallet',
    billingType: 'PREPAID',
    totalConsumedUsd: 0.00,
    totalCalls: 1,
    totalTokens: 279,
    currentBalanceUsd: 19.55,
  },
  {
    userEmail: 'yara.gibson@example.com',
    name: 'Yara Gibson',
    tier: 'Engineering and IT',
    badge: 'Prepaid Wallet',
    billingType: 'PREPAID',
    totalConsumedUsd: 0.26,
    totalCalls: 28,
    totalTokens: 38400,
    currentBalanceUsd: 118.95,
  },
  {
    userEmail: 'postpaid.corp@company.com',
    name: 'Corporate Postpaid User',
    tier: 'Customer Support and Sales',
    badge: 'Postpaid Plan',
    billingType: 'POSTPAID',
    totalConsumedUsd: 15.50,
    totalCalls: 120,
    totalTokens: 500000,
    currentBalanceUsd: 0.00,
  },
];

test('Developer list sorts alphabetically by developer name', () => {
  const devs = SAMPLE_ATTRIBUTIONS.map((a) => ({
    email: a.userEmail,
    name: a.name,
    badge: a.badge,
  }));
  const sorted = sortDeveloperList(devs);

  assert.equal(sorted[0].name, 'Avery Grant');
  assert.equal(sorted[1].name, 'Corporate Postpaid User');
  assert.equal(sorted[2].name, 'Ingrid');
  assert.equal(sorted[3].name, 'Priyanka');
  assert.equal(sorted[4].name, 'Yara Gibson');
});

test('Table sorts by User & Persona (name)', () => {
  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'name', 'asc');
  assert.equal(asc[0].name, 'Avery Grant');
  assert.equal(asc[asc.length - 1].name, 'Yara Gibson');

  const desc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'name', 'desc');
  assert.equal(desc[0].name, 'Yara Gibson');
  assert.equal(desc[desc.length - 1].name, 'Avery Grant');
});

test('Table sorts by Total Consumed (numerical spend)', () => {
  const desc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'consumed', 'desc');
  // Highest spend is Corporate Postpaid User ($15.50), then Yara Gibson ($0.26)
  assert.equal(desc[0].name, 'Corporate Postpaid User');
  assert.equal(desc[1].name, 'Yara Gibson');

  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'consumed', 'asc');
  assert.equal(asc[asc.length - 1].name, 'Corporate Postpaid User');
});

test('Table sorts by Active Balance', () => {
  const desc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'balance', 'desc');
  // Highest balance is Yara Gibson ($118.95)
  assert.equal(desc[0].name, 'Yara Gibson');

  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'balance', 'asc');
  // Lowest balance is Corporate Postpaid User ($0.00)
  assert.equal(asc[0].name, 'Corporate Postpaid User');
});

test('Table sorts by Billing Mode', () => {
  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'billing', 'asc');
  assert.equal(asc[0].billingType, 'POSTPAID');

  const desc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'billing', 'desc');
  assert.equal(desc[0].billingType, 'PREPAID');
});

test('MonetizationManager delegates to the shared sort module (no private copy)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/MonetizationManager.tsx', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/utils\/monetizationSort'/);
  assert.match(src, /sortAttributionTable\(userAttributions, attributionSortColumn, attributionSortDirection\)/);
  assert.match(src, /sortDeveloperList\(list\)/);
  assert.doesNotMatch(src, /case 'quota': \{/, 'a private copy of the attribution comparator is back in the component');
});

test('Table sorts by Entitlement Tier (badge first, then name)', () => {
  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'tier', 'asc');
  assert.equal(asc[0].badge, 'Postpaid Plan');
  // Within the same badge, rows fall back to name order.
  assert.deepEqual(
    asc.slice(1).map((r) => r.name),
    ['Avery Grant', 'Ingrid', 'Priyanka', 'Yara Gibson']
  );
});

test('Table sorts by Wallet Status & Quota (share of allocation spent)', () => {
  const desc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'quota', 'desc');
  // Postpaid: 15.50 / (15.50 + 0) = 100% spent.
  assert.equal(desc[0].name, 'Corporate Postpaid User');
  assert.equal(desc[1].name, 'Yara Gibson');
  // Zero-spend rows tie on 0% and 0 USD, so they are ordered by name (reversed for desc).
  assert.deepEqual(desc.slice(2).map((r) => r.name), ['Priyanka', 'Ingrid', 'Avery Grant']);
});

test('Consumed ties break on tokens before name', () => {
  const asc = sortAttributionTable(SAMPLE_ATTRIBUTIONS, 'consumed', 'asc');
  assert.deepEqual(asc.slice(0, 3).map((r) => r.name), ['Ingrid', 'Priyanka', 'Avery Grant']);
});

test('Sorting never mutates the input and tolerates missing fields', () => {
  const rows = [{ userEmail: 'b@x.com' }, { userEmail: 'a@x.com', name: '' }];
  const snapshot = JSON.stringify(rows);
  for (const col of ['name', 'tier', 'billing', 'consumed', 'balance', 'quota']) {
    const out = sortAttributionTable(rows, col, 'asc');
    assert.equal(out.length, 2);
  }
  assert.equal(JSON.stringify(rows), snapshot);
  assert.deepEqual(sortAttributionTable(rows, 'name', 'asc').map((r) => r.userEmail), ['a@x.com', 'b@x.com']);
});

test('First click on a numeric column sorts high-to-low; text columns A-Z', () => {
  for (const col of ['consumed', 'balance', 'quota']) assert.equal(defaultAttributionSortDirection(col), 'desc');
  for (const col of ['name', 'tier', 'billing']) assert.equal(defaultAttributionSortDirection(col), 'asc');
});
