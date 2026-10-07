export interface UserCacheStat {
  hits?: number;
  misses?: number;
  disabled?: number;
  notSet?: number;
}

export interface CacheKpiFleetData {
  kpis?: {
    cacheCostSavingsUsd?: number | null;
    cacheHitRate?: number | null;
    cacheHitCount?: number | null;
    totalSpendUsd?: number | null;
    totalCalls?: number | null;
  } | null;
  userCacheStats?: Record<string, UserCacheStat> | null;
}

export interface ScopedCacheKpiInput {
  viewMode: string;
  userFilter: string;
  currentUserEmail: string;
  calls: number;
  spend: number;
  fleetData?: CacheKpiFleetData | null;
  /** Users aggregated when viewMode is admin, userFilter is 'all' and fleet KPIs are absent. */
  scopedUserEmails?: string[];
}

export function computeScopedCacheKPIs(input: ScopedCacheKpiInput): {
  cacheSavings: string | null;
  cacheHitRate: number | null;
};
