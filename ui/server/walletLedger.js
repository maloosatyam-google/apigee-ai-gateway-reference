// Session wallet ledger shared by server.js (Cloud Run) and vite.config.ts (npm run dev).
//
// Apigee settles prepaid-wallet debits from Analytics roughly every 15 minutes, so the
// balance it reports lags real traffic. The ledger records per-developer debits made
// since the last settlement and subtracts them from the balance Apigee reports.
//
// The starting balance ALWAYS comes from Apigee
// (GET /v1/organizations/{org}/developers/{dev}/balance). It is never invented and never
// taken from the browser: if Apigee cannot be read, balances are returned as null and the
// UI hides the balance chips rather than showing a made-up number.
//
// ledger: Map<emailLowerCase, { debitedUsd: number, lastCreditTimeSeen: string }>

const round6 = (n) => Number(n.toFixed(6));

/** Money { units, nanos } of the primary wallet -> USD number, or null if absent. */
export function walletUsd(wallet) {
  if (!wallet || !wallet.balance) return null;
  const units = Number(wallet.balance.units || 0);
  const nanos = Number(wallet.balance.nanos || 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return units + nanos / 1e9;
}

/**
 * Drops the developer's pending debits when Apigee has recorded a new credit /
 * settlement since we last looked (lastCreditTime changed). Returns the live entry
 * (or undefined if the developer has none).
 */
function reconcile(ledger, devKey, wallet) {
  const entry = ledger.get(devKey);
  if (!entry) return undefined;
  const creditTime = String(wallet?.lastCreditTime || '');
  if (entry.lastCreditTimeSeen && creditTime && entry.lastCreditTimeSeen !== creditTime) {
    ledger.delete(devKey);
    return undefined;
  }
  if (creditTime) entry.lastCreditTimeSeen = creditTime;
  return entry;
}

/** Mutates the Apigee balance payload's primary wallet to subtract pending session debits. */
export function applyLedgerToBalance(ledger, dev, data) {
  const wallet = data?.wallets?.[0];
  const rawUsd = walletUsd(wallet);
  if (rawUsd === null) return data;
  const entry = reconcile(ledger, String(dev).toLowerCase(), wallet);
  if (!entry) return data;
  const effectiveUsd = Math.max(0, rawUsd - entry.debitedUsd);
  const units = Math.floor(effectiveUsd);
  wallet.balance.units = String(units);
  wallet.balance.nanos = Math.round((effectiveUsd - units) * 1e9);
  return data;
}

/**
 * Records a debit against the developer's session ledger.
 *
 * `wallet` is the primary wallet fetched from Apigee for this request (or null if the
 * fetch failed). The debit is always recorded so later /balance reads stay consistent,
 * but start/remaining balances are only computed from a real Apigee balance.
 */
export function recordDebit(ledger, dev, amountUsd, wallet) {
  const devKey = String(dev).toLowerCase();
  const amount = Math.max(0, Number(amountUsd) || 0);
  let entry = wallet ? reconcile(ledger, devKey, wallet) : ledger.get(devKey);
  if (!entry) {
    entry = { debitedUsd: 0, lastCreditTimeSeen: String(wallet?.lastCreditTime || '') };
    ledger.set(devKey, entry);
  }
  const priorDebitedUsd = entry.debitedUsd;
  entry.debitedUsd = round6(priorDebitedUsd + amount);

  const rawUsd = walletUsd(wallet);
  const startBalanceUsd = rawUsd === null ? null : Math.max(0, round6(rawUsd - priorDebitedUsd));
  const remainingBalanceUsd = startBalanceUsd === null ? null : Math.max(0, round6(startBalanceUsd - amount));
  return {
    developer: devKey,
    debitedThisRequestUsd: amount,
    totalDebitedSessionUsd: entry.debitedUsd,
    balanceSource: rawUsd === null ? 'unavailable' : 'apigee',
    startBalanceUsd,
    remainingBalanceUsd,
  };
}

/** Fetches the developer's primary prepaid wallet from Apigee, or null on any failure. */
export async function fetchApigeeWallet({ org, dev, token, fetchImpl = fetch }) {
  if (!token) return null;
  try {
    const res = await fetchImpl(
      `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/balance`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const wallet = data?.wallets?.[0];
    return walletUsd(wallet) === null ? null : wallet;
  } catch {
    return null;
  }
}
