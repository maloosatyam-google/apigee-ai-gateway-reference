/**
 * Semantic-cache KPIs (hit rate + estimated savings) for the Analytics dashboard.
 *
 * Plain JS (typed by the sibling .d.ts) so tests/cacheanalytics.unit.test.mjs imports
 * the code AnalyticsDashboard.tsx actually runs, instead of a pasted copy.
 *
 * Only HIT and MISS count toward the rate; DISABLED and (not set) traffic is excluded,
 * and a scope with no measured cache traffic reports `null` (rendered as an em dash),
 * never a flattering 0% or 100%.
 */
export function computeScopedCacheKPIs({
  viewMode,
  userFilter,
  currentUserEmail,
  calls,
  spend,
  fleetData,
  scopedUserEmails = [],
}) {
  if (viewMode === 'admin' && userFilter === 'all' && fleetData?.kpis) {
    return {
      cacheSavings:
        fleetData.kpis.cacheCostSavingsUsd == null
          ? null
          : Number(fleetData.kpis.cacheCostSavingsUsd).toFixed(2),
      cacheHitRate:
        fleetData.kpis.cacheHitRate == null ? null : Math.round(fleetData.kpis.cacheHitRate),
    };
  }

  const targetEmails = new Set();
  if (viewMode === 'user') {
    targetEmails.add(String(currentUserEmail || '').toLowerCase());
  } else if (userFilter !== 'all') {
    targetEmails.add(String(userFilter).toLowerCase());
  } else {
    // Admin, all users, but no fleet KPIs: aggregate every user in scope.
    scopedUserEmails.forEach((email) => targetEmails.add(String(email).toLowerCase()));
  }

  let userHits = 0;
  let userMisses = 0;
  let hasMeasuredCache = false;

  if (fleetData?.userCacheStats) {
    targetEmails.forEach((email) => {
      const stat = fleetData.userCacheStats?.[email];
      if (stat) {
        userHits += stat.hits || 0;
        userMisses += stat.misses || 0;
        if ((stat.hits || 0) + (stat.misses || 0) > 0) {
          hasMeasuredCache = true;
        }
      }
    });
  }

  const userMeasured = userHits + userMisses;
  const cacheHitRate =
    hasMeasuredCache && userMeasured > 0 ? Math.round((userHits / userMeasured) * 100) : null;

  let cacheSavings = null;
  if (cacheHitRate !== null && userHits > 0) {
    const modelCalls = Math.max(1, calls - userHits);
    let costPerModelCall = calls > 0 && spend > 0 ? spend / modelCalls : 0;
    if (costPerModelCall === 0 && fleetData?.kpis?.totalSpendUsd && fleetData?.kpis?.totalCalls) {
      const fleetHits = fleetData.kpis.cacheHitCount || 0;
      const fleetModelCalls = Math.max(1, fleetData.kpis.totalCalls - fleetHits);
      costPerModelCall = fleetData.kpis.totalSpendUsd / fleetModelCalls;
    }
    cacheSavings = (costPerModelCall * userHits).toFixed(2);
  }

  return { cacheSavings, cacheHitRate };
}
