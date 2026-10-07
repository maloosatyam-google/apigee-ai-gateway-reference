/**
 * Pure sorting rules for the Admin Console developer list and the
 * User & Persona attribution table (MonetizationManager.tsx).
 *
 * Plain JS (typed by the sibling .d.ts) so that tests/monetizationsorting.unit.test.mjs
 * can import the exact code the component runs under `node --test`, instead of
 * carrying a pasted copy that silently drifts from it.
 */

const displayName = (row) => (row.name || row.userEmail || '').toLowerCase();

/** Developers sorted by display name, then email, so equal names keep a stable order. */
export function sortDeveloperList(devs) {
  return [...devs].sort((a, b) => {
    const nameA = (a.name || a.email).toLowerCase();
    const nameB = (b.name || b.email).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    return cmp !== 0 ? cmp : a.email.localeCompare(b.email);
  });
}

/** Share of the allocation already spent: consumed / (consumed + balance). */
function spentFraction(row) {
  const consumed = Number(row.totalConsumedUsd) || 0;
  const total = consumed + (Number(row.currentBalanceUsd) || 0);
  return total > 0 ? consumed / total : 0;
}

/** Default direction when a column is first selected: numbers high-to-low, text A-Z. */
export function defaultAttributionSortDirection(column) {
  return column === 'consumed' || column === 'balance' || column === 'quota' ? 'desc' : 'asc';
}

export function sortAttributionTable(rows, column, direction) {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (column) {
      case 'name':
        cmp = displayName(a).localeCompare(displayName(b));
        if (cmp === 0) cmp = (a.userEmail || '').localeCompare(b.userEmail || '');
        break;
      case 'tier':
        cmp = (a.badge || a.tier || '').toLowerCase().localeCompare((b.badge || b.tier || '').toLowerCase());
        if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b));
        break;
      case 'billing':
        cmp = (a.billingType || '').localeCompare(b.billingType || '');
        if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b));
        break;
      case 'consumed':
        cmp = (Number(a.totalConsumedUsd) || 0) - (Number(b.totalConsumedUsd) || 0);
        if (cmp === 0) cmp = (Number(a.totalTokens) || 0) - (Number(b.totalTokens) || 0);
        if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b));
        break;
      case 'balance':
        cmp = (Number(a.currentBalanceUsd) || 0) - (Number(b.currentBalanceUsd) || 0);
        if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b));
        break;
      case 'quota':
        cmp = spentFraction(a) - spentFraction(b);
        if (cmp === 0) cmp = (Number(a.totalConsumedUsd) || 0) - (Number(b.totalConsumedUsd) || 0);
        if (cmp === 0) cmp = displayName(a).localeCompare(displayName(b));
        break;
      default:
        cmp = 0;
    }
    return direction === 'asc' ? cmp : -cmp;
  });
}
