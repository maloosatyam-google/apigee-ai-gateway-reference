import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walletUsd, applyLedgerToBalance, recordDebit, fetchApigeeWallet } from '../server/walletLedger.js';

const here = dirname(fileURLToPath(import.meta.url));
const wallet = (units, nanos = 0, lastCreditTime = '1000') => ({
  balance: { currencyCode: 'USD', units: String(units), nanos },
  lastCreditTime,
});

test('walletUsd converts Money units/nanos and returns null when absent', () => {
  assert.equal(walletUsd(wallet(12, 500000000)), 12.5);
  assert.equal(walletUsd(null), null);
  assert.equal(walletUsd({}), null);
});

test('recordDebit derives start/remaining from the Apigee wallet and chains across requests', () => {
  const ledger = new Map();
  const w = wallet(50);
  const r1 = recordDebit(ledger, 'Dev@X.com', 0.25, w);
  assert.equal(r1.balanceSource, 'apigee');
  assert.equal(r1.startBalanceUsd, 50);
  assert.equal(r1.remainingBalanceUsd, 49.75);
  const r2 = recordDebit(ledger, 'dev@x.com', 0.5, w); // same dev, case-insensitive
  assert.equal(r2.startBalanceUsd, 49.75);
  assert.equal(r2.remainingBalanceUsd, 49.25);
  assert.equal(r2.totalDebitedSessionUsd, 0.75);
});

test('recordDebit never invents a balance when Apigee is unavailable', () => {
  const ledger = new Map();
  const r = recordDebit(ledger, 'dev@x.com', 1, null);
  assert.equal(r.balanceSource, 'unavailable');
  assert.equal(r.startBalanceUsd, null);
  assert.equal(r.remainingBalanceUsd, null);
  // the debit is still recorded so /balance stays consistent once Apigee is readable
  assert.equal(ledger.get('dev@x.com').debitedUsd, 1);
});

test('a new Apigee credit/settlement (lastCreditTime change) clears pending debits', () => {
  const ledger = new Map();
  recordDebit(ledger, 'dev@x.com', 2, wallet(50, 0, 't1'));
  const r = recordDebit(ledger, 'dev@x.com', 1, wallet(48, 0, 't2'));
  assert.equal(r.startBalanceUsd, 48);
  assert.equal(r.remainingBalanceUsd, 47);
  assert.equal(r.totalDebitedSessionUsd, 1);
});

test('applyLedgerToBalance subtracts pending debits from the Apigee balance payload', () => {
  const ledger = new Map();
  recordDebit(ledger, 'dev@x.com', 1.25, wallet(10, 0, 't1'));
  const data = { wallets: [wallet(10, 0, 't1')] };
  applyLedgerToBalance(ledger, 'DEV@x.com', data);
  assert.equal(walletUsd(data.wallets[0]), 8.75);
  // unknown developer: untouched
  const other = { wallets: [wallet(10)] };
  applyLedgerToBalance(ledger, 'nobody@x.com', other);
  assert.equal(walletUsd(other.wallets[0]), 10);
});

test('fetchApigeeWallet returns the primary wallet, or null on error / non-OK / no token', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ wallets: [wallet(7)] }) });
  assert.equal(walletUsd(await fetchApigeeWallet({ org: 'o', dev: 'd', token: 't', fetchImpl: ok })), 7);
  const notOk = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await fetchApigeeWallet({ org: 'o', dev: 'd', token: 't', fetchImpl: notOk }), null);
  const boom = async () => { throw new Error('net'); };
  assert.equal(await fetchApigeeWallet({ org: 'o', dev: 'd', token: 't', fetchImpl: boom }), null);
  assert.equal(await fetchApigeeWallet({ org: 'o', dev: 'd', token: '', fetchImpl: ok }), null);
});

test('no hardcoded starting balance: client does not send one, servers use the shared ledger', () => {
  const client = readFileSync(join(here, '../src/services/apigeeClient.ts'), 'utf8');
  assert.ok(!/rawApigeeBalanceUsd/.test(client), 'client must not supply the starting balance');
  assert.ok(!/prepaid-balance'\]\s*\|\|\s*'\d/.test(client), 'client must not default the balance header');
  for (const f of ['../server.js', '../vite.config.ts']) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.ok(!/rawApigeeBalanceUsd/.test(src), `${f} must not accept a client-supplied balance`);
    assert.match(src, /fetchApigeeWallet\(/, `${f} must read the balance from Apigee`);
    assert.match(src, /recordDebit\(sessionLedgerByDev/, `${f} must use the shared ledger`);
  }
});
