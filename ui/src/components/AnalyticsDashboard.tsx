import React, { useState, useMemo, useEffect } from 'react';
import {
  Coins,
  Wallet,
  Sparkles,
  Database,
  Bot,
  Zap,
  Filter,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  TableProperties,
  Info,
  User,
  ScrollText,
} from 'lucide-react';
import { GatewaySettings, UserConsumptionRecord, UserMonetizationAttribution } from '../types';
import { DEFAULT_SSO_USER } from '../services/defaultSettings';
import { DonutPieChart, DonutSlice } from './DonutPieChart';
import { CallLogsModal } from './CallLogsModal';
import { fetchFleetAnalytics, fetchModelRates, FleetAnalyticsResponse, fetchDeveloperAttributions } from '../services/api';
import { computeRoutingSavings } from '../utils/routingSavings';
import { computeScopedCacheKPIs } from '../utils/cacheKpis';
import { term, usePersonaVoice } from '../utils/voice';

export interface AnalyticsDashboardProps {
  settings: GatewaySettings;
  viewMode?: 'admin' | 'user';
  timeRange?: '24h' | '7d' | '30d';
  /** Apigee environment whose analytics are shown. Dev analytics is enabled as of 2026-09-25. */
  env?: 'prod' | 'dev';
  setLoading?: (loading: boolean) => void;
  registerRefresh?: (fn: () => void) => void;
  userFilter?: string;
  onUserFilterChange?: (user: string) => void;
  onUserListChange?: (users: { email: string; name?: string }[]) => void;
}

type SortField = 'userEmail' | 'model' | 'totalTraffic' | 'inputTokens' | 'outputTokens' | 'costUsd';

const formatTokens = (num: number): string => {
  if (!num || num <= 0) return '0';
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  }
  return num.toLocaleString();
};

const formatCost = (usd: number): string => {
  if (!usd || usd <= 0) return '$0.00';
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
};

// Mini Area Sparkline Component (Inspired by Semrush Domain Analytics Sparklines)
const AreaSparkline: React.FC<{
  data: number[];
  color?: string;
  id: string;
}> = ({ data, color = '#3b82f6', id }) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 120;
  const height = 28;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 6) - 3;
    return { x, y };
  });

  const lineD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
  const areaD = `${lineD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-7 overflow-visible">
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          {/* style, not the stopColor/stroke attributes: attributes cannot resolve the theme's var() colours. */}
          <stop offset="0%" style={{ stopColor: color }} stopOpacity="0.3" />
          <stop offset="100%" style={{ stopColor: color }} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${id})`} />
      <path d={lineD} fill="none" style={{ stroke: color }} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  settings,
  viewMode = 'admin',
  timeRange = '24h',
  env = 'prod',
  setLoading: controlledSetLoading,
  registerRefresh,
  userFilter: controlledUserFilter,
  onUserFilterChange: controlledOnUserFilterChange,
  onUserListChange,
}) => {
  const [, setInternalLoading] = useState(false);
  const setLoading = controlledSetLoading ?? setInternalLoading;

  // Analytics speaks in the voice of the admin persona picked top-right:
  // platform = operations, finance = spend, ai_coe = adoption and model mix.
  const { voice, speaker, sp } = usePersonaVoice('admin');
  const requestsWord = sp({ technical: 'calls', finance: 'requests', ai_coe: 'requests' });
  const fetchFailedMsg = sp({
    technical: 'Apigee Analytics stats query failed',
    finance: 'Could not load the spend figures',
    ai_coe: 'Could not load the usage figures',
  });

  const [internalUserFilter, setInternalUserFilter] = useState<string>('all');
  const userFilter = controlledUserFilter ?? internalUserFilter;
  const setUserFilter = (u: string) => {
    if (controlledOnUserFilterChange) {
      controlledOnUserFilterChange(u);
    } else {
      setInternalUserFilter(u);
    }
  };

  const [modelFilter, setModelFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('costUsd');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [distributionMode, setDistributionMode] = useState<'spend' | 'tokens'>('spend');

  const currentUserEmail = settings.ssoUser?.email || settings.userEmail || DEFAULT_SSO_USER.email;

  const [fleetData, setFleetData] = useState<FleetAnalyticsResponse | null>(null);
  const [attributions, setAttributions] = useState<UserMonetizationAttribution[]>([]);
  // Rate card of the selected env, used only for the Smart Routing "saved up to" baseline.
  const [rateCard, setRateCard] = useState<import('../types').RateCardDictionary | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Ledger row whose per-call audit trail is open. Null == modal closed.
  const [logsTarget, setLogsTarget] = useState<{ userEmail: string; model: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [fleetRes, attrRes, ratesRes] = await Promise.allSettled([
        fetchFleetAnalytics(timeRange, env),
        fetchDeveloperAttributions(),
        fetchModelRates(env),
      ]);
      if (ratesRes.status === 'fulfilled' && ratesRes.value?.rates) {
        setRateCard(ratesRes.value.rates);
      }
      if (fleetRes.status === 'fulfilled') {
        setFleetData(fleetRes.value);
      } else {
        setFetchError(fleetRes.reason?.message || fetchFailedMsg);
      }
      if (attrRes.status === 'fulfilled' && attrRes.value.attributions) {
        setAttributions(attrRes.value.attributions);
      }
    } catch (err: any) {
      setFetchError(err.message || fetchFailedMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [timeRange, env]);

  useEffect(() => {
    if (registerRefresh) {
      registerRefresh(loadData);
    }
  }, [registerRefresh, timeRange, env]);

  // Analytics Management API data.
  //
  // The fleet-stats endpoint can emit MORE THAN ONE row for the same
  // (userEmail, model) pair: the Analytics-indexed row and the wallet
  // reconciliation row for spend that analytics has not indexed yet. Left as-is
  // those pairs produce duplicate React keys in the ledger table, which breaks
  // list reconciliation and leaves stale <tr> nodes in the DOM whenever the row
  // set shrinks (e.g. when the user filter is applied). Collapse them here so
  // every (userEmail, model) pair appears exactly once with summed totals.
  const allConsumptionRecords: UserConsumptionRecord[] = useMemo(() => {
    const rows = fleetData?.consumptionRows || [];
    const merged = new Map<string, UserConsumptionRecord>();

    rows.forEach((row) => {
      const key = `${row.userEmail.toLowerCase()}__${row.model}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row });
        return;
      }
      existing.totalTraffic += row.totalTraffic;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.costUsd += row.costUsd;
      // undefined means "not recorded", so only produce a number when at least one side has one.
      if (row.errorCount !== undefined || existing.errorCount !== undefined) {
        existing.errorCount = (existing.errorCount ?? 0) + (row.errorCount ?? 0);
      }
      existing.isUnauthenticated = Boolean(existing.isUnauthenticated) && Boolean(row.isUnauthenticated);
    });

    return Array.from(merged.values());
  }, [fleetData]);

  // Authoritative user/developer list based strictly on Developer Management API
  const userList = useMemo(() => {
    const map = new Map<string, { email: string; name?: string }>();
    attributions.forEach((a) => {
      map.set(a.userEmail.toLowerCase(), { email: a.userEmail, name: a.name });
    });
    if (map.size === 0 && currentUserEmail) {
      map.set(currentUserEmail.toLowerCase(), { email: currentUserEmail, name: currentUserEmail.split('@')[0] });
    }
    return Array.from(map.values()).sort((a, b) => {
      const nameA = (a.name || a.email).toLowerCase();
      const nameB = (b.name || b.email).toLowerCase();
      const cmp = nameA.localeCompare(nameB);
      return cmp !== 0 ? cmp : a.email.localeCompare(b.email);
    });
  }, [attributions, currentUserEmail]);

  useEffect(() => {
    if (onUserListChange && userList.length > 0) {
      onUserListChange(userList);
    }
  }, [userList, onUserListChange]);

  // Active consumption records based on Admin Fleet vs Personal User viewMode and userFilter
  const activeConsumptionRecords: UserConsumptionRecord[] = useMemo(() => {
    if (viewMode === 'user') {
      return allConsumptionRecords.filter(
        (r) => r.userEmail.toLowerCase() === currentUserEmail.toLowerCase()
      );
    }
    if (userFilter && userFilter !== 'all') {
      return allConsumptionRecords.filter(
        (r) => r.userEmail.toLowerCase() === userFilter.toLowerCase()
      );
    }
    return allConsumptionRecords;
  }, [allConsumptionRecords, viewMode, currentUserEmail, userFilter]);

  // Available Balance: Added together for Admin View (All Users) or individual for selected user / user view
  const availableBalanceData = useMemo(() => {
    if (viewMode === 'user') {
      const match = attributions.find(
        (u) => u.userEmail.toLowerCase() === currentUserEmail.toLowerCase()
      );
      const bal = match ? match.currentBalanceUsd : 0;
      const isPrepaid = match ? match.billingType === 'PREPAID' : true;
      const handle = currentUserEmail.split('@')[0] || currentUserEmail;
      return {
        amount: Number(bal || 0).toFixed(2),
        exactAmount: Number(bal || 0).toFixed(6).replace(/(\.\d{2,}?)0+$/, '$1'),
        badge: isPrepaid ? 'Prepaid' : sp({ technical: 'Postpaid', finance: 'Invoiced', ai_coe: 'Invoiced' }),
        subtitle: sp({
          technical: `My developer wallet (${handle})`,
          finance: `My prepaid credit (${handle})`,
          ai_coe: `My AI credit (${handle})`,
        }),
        sparkline: bal > 0 ? [bal, bal, bal, bal, bal] : [0, 0, 0, 0, 0],
      };
    }

    if (userFilter !== 'all') {
      const match = attributions.find(
        (u) => u.userEmail.toLowerCase() === userFilter.toLowerCase()
      );
      const bal = match ? match.currentBalanceUsd : 0;
      const isPrepaid = match ? match.billingType === 'PREPAID' : true;
      const handle = userFilter.split('@')[0] || userFilter;
      return {
        amount: Number(bal || 0).toFixed(2),
        exactAmount: Number(bal || 0).toFixed(6).replace(/(\.\d{2,}?)0+$/, '$1'),
        badge: isPrepaid ? 'Prepaid' : sp({ technical: 'Postpaid', finance: 'Invoiced', ai_coe: 'Invoiced' }),
        subtitle: isPrepaid
          ? sp({
              technical: `Prepaid wallet, blocks at $0 (${handle})`,
              finance: `Prepaid credit left (${handle})`,
              ai_coe: `AI credit left (${handle})`,
            })
          : sp({
              technical: `Postpaid rate plan (${handle})`,
              finance: `Invoiced monthly (${handle})`,
              ai_coe: `Billed monthly (${handle})`,
            }),
        sparkline: bal > 0 ? [bal, bal, bal, bal, bal] : [0, 0, 0, 0, 0],
      };
    }

    // Admin view with All Users (Fleet Total): Sum of all developers added together
    const totalPool = attributions.reduce((acc, u) => acc + (u.currentBalanceUsd || 0), 0);
    const userCount = attributions.length || userList.length || 1;
    return {
      amount: Number(totalPool || 0).toFixed(2),
      exactAmount: Number(totalPool || 0).toFixed(6).replace(/(\.\d{2,}?)0+$/, '$1'),
      badge: sp({ technical: 'Pool', finance: 'Combined', ai_coe: 'Combined' }),
      subtitle: sp({
        technical: `Sum of ${userCount} developer wallet${userCount === 1 ? '' : 's'}`,
        finance: `Credit across ${userCount} user${userCount === 1 ? '' : 's'}`,
        ai_coe: `AI credit across ${userCount} user${userCount === 1 ? '' : 's'}`,
      }),
      sparkline: totalPool > 0 ? [totalPool, totalPool, totalPool, totalPool, totalPool] : [0, 0, 0, 0, 0],
    };
  }, [viewMode, userFilter, currentUserEmail, attributions, userList, speaker]);

  // Overall KPI card summary stats directly from Management API or computed for filtered View.
  //
  // slaHealth / faultCount are `null` when the window genuinely has nothing to report, and the
  // cards render an em dash. They must never fall back to a flattering literal: this panel
  // previously hardcoded `slaHealth: 100, faultCount: 0` for every scoped view, so an individual
  // user showed a perfect 100% while the fleet showed 54%, even while that same user was being
  // blocked by Model Armor and token quotas.
  const aggregatedStats = useMemo(() => {
    if (viewMode === 'admin' && userFilter === 'all' && fleetData?.kpis) {
      return {
        totalCalls: fleetData.kpis.totalCalls.toLocaleString(),
        totalTokens: formatTokens(fleetData.kpis.totalTokens),
        totalSpend: fleetData.kpis.totalSpendUsd.toFixed(2),
        cacheSavings:
          fleetData.kpis.cacheCostSavingsUsd == null
            ? null
            : fleetData.kpis.cacheCostSavingsUsd.toFixed(2),
        cacheHitRate: fleetData.kpis.cacheHitRate == null ? null : Math.round(fleetData.kpis.cacheHitRate),
        slaHealth: fleetData.kpis.slaHealth == null ? null : Math.round(fleetData.kpis.slaHealth),
        faultCount: fleetData.kpis.isErrorCount ?? null,
      };
    }
    let calls = 0;
    let tokens = 0;
    let spend = 0;
    // Counted separately from `calls`: synthetic wallet-reconciliation rows have no error signal,
    // so including them in the denominator would dilute the rate towards a false 100%.
    let measuredCalls = 0;
    let errors = 0;
    let hasErrorData = false;

    activeConsumptionRecords.forEach((r) => {
      calls += r.totalTraffic;
      tokens += r.inputTokens + r.outputTokens;
      spend += r.costUsd;

      measuredCalls += r.totalTraffic;
      if (r.errorCount !== undefined) {
        hasErrorData = true;
        errors += r.errorCount;
      }
    });

    const canReportSla = hasErrorData && measuredCalls > 0;

    // Real scoped cache metrics from the dc_user_email,dc_cache_status dimension
    // (rule and its tests: utils/cacheKpis + tests/cacheanalytics.unit.test.mjs).
    const { cacheSavings: userCacheSavings, cacheHitRate: userCacheHitRate } = computeScopedCacheKPIs({
      viewMode,
      userFilter,
      currentUserEmail,
      calls,
      spend,
      fleetData,
      scopedUserEmails: activeConsumptionRecords.map((r) => r.userEmail),
    });

    return {
      totalCalls: calls.toLocaleString(),
      totalTokens: formatTokens(tokens),
      totalSpend: spend.toFixed(2),
      cacheSavings: userCacheSavings,
      cacheHitRate: userCacheHitRate,
      slaHealth: canReportSla ? Math.round((1 - errors / measuredCalls) * 100) : null,
      faultCount: hasErrorData ? errors : null,
    };
  }, [viewMode, userFilter, fleetData, activeConsumptionRecords, currentUserEmail]);

  // Dynamic Routing & Model Volume Stats
  const routingStats = useMemo(() => {
    if (viewMode === 'admin' && userFilter === 'all' && fleetData?.routing) {
      return {
        flashCalls: fleetData.routing.flashCalls,
        proCalls: fleetData.routing.proOpusCalls,
        flashPercent: fleetData.routing.flashPercent,
        proPercent: fleetData.routing.proOpusPercent,
      };
    }

    let flashCalls = 0;
    let proCalls = 0;
    activeConsumptionRecords.forEach((r) => {
      if (r.tier === 'high') {
        proCalls += r.totalTraffic;
      } else {
        flashCalls += r.totalTraffic;
      }
    });

    const total = flashCalls + proCalls || 1;
    const flashPercent = Number(((flashCalls / total) * 100).toFixed(1));
    const proPercent = Number(((proCalls / total) * 100).toFixed(1));

    return {
      flashCalls,
      proCalls,
      flashPercent,
      proPercent,
    };
  }, [viewMode, userFilter, fleetData, activeConsumptionRecords]);

  // Potential savings vs. sending every call in scope to the most expensive model on the
  // rate card (see utils/routingSavings). Scoped like the rest of the page (view + user filter).
  const routingSavings = useMemo(
    () => computeRoutingSavings(activeConsumptionRecords, rateCard),
    [activeConsumptionRecords, rateCard],
  );

  // Per-model aggregations specifically for the 2 Pie Charts
  const modelStatsForPies = useMemo(() => {
    const modelMap = new Map<string, {
      model: string;
      provider: string;
      tier: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
      color: string;
      badge: string;
    }>();

    const colorPalette: Record<string, { color: string; badge: string }> = {
      'claude-opus-4-5@20251101': { color: '#9333ea', badge: 'Op' }, // Purple
      'claude-opus-4-5': { color: '#9333ea', badge: 'Op' },          // Purple
      'claude-haiku-4-5@20251001': { color: '#0d9488', badge: 'Hk' }, // Teal-600
      'claude-haiku-4-5': { color: '#0d9488', badge: 'Hk' },         // Teal-600
      'gemini-3-flash-preview': { color: '#2563eb', badge: 'Gf' },   // Blue
      'gemini-2.5-flash': { color: '#0284c7', badge: 'F2' },         // Sky
      'gemini-3.1-flash-lite': { color: '#059669', badge: 'Fl' },    // Emerald
      // Warm colours deliberately: these two are priced above the Pro models, so they should
      // not sit in the cool green/blue range the cheap Flash models use.
      'gemini-3.7-flash': { color: '#ea580c', badge: 'F7' },         // Orange-600
      'gemini-3.8-flash': { color: '#c2410c', badge: 'F8' },         // Orange-700
      'gemini-3.1-pro-preview': { color: '#4f46e5', badge: 'Pr' },   // Indigo
      'gemini-2.5-pro': { color: '#6366f1', badge: 'P2' },          // Indigo-500
      'unknown-model': { color: '#94a3b8', badge: 'BL' },           // Slate-400 (Blocked / Unrouted)
    };

    activeConsumptionRecords.forEach((r) => {
      // Only include records that have traffic
      if (r.totalTraffic <= 0) return;

      // Filter out non-model calls (blocked pre-flow calls, unrouted faults).
      // These are already accounted for in the Request Success Rate & Errors Logged counters.
      if (r.model === 'unknown-model' || r.model === '{flow.model}' || r.model === 'null') return;

      // Normalize model name (e.g. claude-opus-4-5@20251101 -> claude-opus-4-5)
      const normalizedModel = r.model.replace(/@\d+$/, '');
      const existing = modelMap.get(normalizedModel);
      const rowTokens = r.inputTokens + r.outputTokens;
      const meta = colorPalette[normalizedModel] || colorPalette[r.model] || { color: '#d97706', badge: normalizedModel.slice(0, 2).toUpperCase() };
      if (existing) {
        existing.calls += r.totalTraffic;
        existing.inputTokens += r.inputTokens;
        existing.outputTokens += r.outputTokens;
        existing.totalTokens += rowTokens;
        existing.cost += r.costUsd;
      } else {
        modelMap.set(normalizedModel, {
          model: normalizedModel,
          provider: r.provider,
          tier: r.tier,
          calls: r.totalTraffic,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: rowTokens,
          cost: r.costUsd,
          color: meta.color,
          badge: meta.badge,
        });
      }
    });

    return Array.from(modelMap.values())
      .filter((m) => m.calls > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [activeConsumptionRecords]);

  // Pie Chart 1: Model vs Cost Slices.
  // Every model with traffic and non-zero spend is shown. Do NOT reintroduce a
  // minimum-cost threshold here: it silently drops models that the Tokens view
  // still lists, and leaves the legend unable to account for the donut total.
  const costSlices: DonutSlice[] = useMemo(() => {
    const totalCost = modelStatsForPies.reduce((acc, m) => acc + m.cost, 0);
    return modelStatsForPies
      .filter((m) => m.calls > 0 && m.cost > 0)
      .map((m) => ({
        id: m.model,
        label: m.model,
        badge: m.badge,
        sublabel: sp({
          technical: `${m.provider} • ${m.tier.toUpperCase()} tier`,
          finance: `${m.provider} • ${m.tier === 'high' ? 'Premium price' : m.tier === 'medium' ? 'Mid-price' : 'Low-cost'}`,
          ai_coe: `${m.provider} • ${m.tier === 'high' ? 'Premium model' : m.tier === 'medium' ? 'Mid-tier model' : 'Everyday model'}`,
        }),
        value: m.cost,
        // Sub-cent spend is common on flash-tier models; $0.00 would be misleading.
        formattedValue:
          m.cost > 0 && m.cost < 0.01
            ? `$${m.cost.toFixed(4)} USD`
            : `$${m.cost.toFixed(2)} USD`,
        percentage: totalCost > 0 ? (m.cost / totalCost) * 100 : 0,
        color: m.color,
      }));
  }, [modelStatsForPies, speaker]);

  // Pie Chart 2: Model vs Token Volume Slices (only models that have actual traffic and non-zero tokens)
  const tokenSlices: DonutSlice[] = useMemo(() => {
    const totalTokens = modelStatsForPies.reduce((acc, m) => acc + m.totalTokens, 0);
    return [...modelStatsForPies]
      .filter((m) => m.calls > 0 && m.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((m) => {
        const formatted = m.totalTokens >= 1_000_000
          ? `${(m.totalTokens / 1e6).toFixed(1)}M`
          : m.totalTokens.toLocaleString();
        const inFormatted = m.inputTokens >= 1_000_000
          ? `${(m.inputTokens / 1e6).toFixed(1)}M`
          : m.inputTokens.toLocaleString();
        const outFormatted = m.outputTokens >= 1_000_000
          ? `${(m.outputTokens / 1e6).toFixed(1)}M`
          : m.outputTokens.toLocaleString();
        return {
          id: m.model,
          label: m.model,
          badge: m.badge,
          sublabel: sp({
            technical: `${m.provider} • prompt ${inFormatted} | completion ${outFormatted}`,
            finance: `${m.provider} • In: ${inFormatted} | Out: ${outFormatted}`,
            ai_coe: `${m.provider} • read ${inFormatted} | written ${outFormatted}`,
          }),
          value: m.totalTokens,
          formattedValue: formatted,
          percentage: totalTokens > 0 ? (m.totalTokens / totalTokens) * 100 : 0,
          color: m.color,
        };
      });
  }, [modelStatsForPies, speaker]);

  const totalModelTraffic = useMemo(() => {
    return modelStatsForPies.reduce((sum, m) => sum + m.calls, 0);
  }, [modelStatsForPies]);

  // Dynamic Sparkline points based on actual model traffic distribution from Management API
  const sparklineCalls = useMemo(() => {
    if (modelStatsForPies.length === 0) return [1, 2, 3, 5, 8];
    const points = modelStatsForPies.map((m) => m.calls).reverse();
    return points.length >= 2 ? points : [...points, ...points];
  }, [modelStatsForPies]);

  const sparklineTokens = useMemo(() => {
    if (modelStatsForPies.length === 0) return [10, 20, 50, 100];
    const points = modelStatsForPies.map((m) => Math.round(m.totalTokens / 1000)).reverse();
    return points.length >= 2 ? points : [...points, ...points];
  }, [modelStatsForPies]);

  const sparklineSpend = useMemo(() => {
    if (modelStatsForPies.length === 0) return [1, 3, 5, 10];
    const points = modelStatsForPies.map((m) => Math.round(m.cost * 100)).reverse();
    return points.length >= 2 ? points : [...points, ...points];
  }, [modelStatsForPies]);

  // Unique model options for dropdown filter (only models that have traffic in active view)
  const uniqueModels = useMemo(() => {
    return Array.from(new Set(activeConsumptionRecords.filter((r) => r.totalTraffic > 0).map((r) => r.model))).sort();
  }, [activeConsumptionRecords]);

  useEffect(() => {
    if (modelFilter !== 'all' && !uniqueModels.includes(modelFilter)) {
      setModelFilter('all');
    }
  }, [uniqueModels, modelFilter]);

  // Filtered & Sorted Consumption Rows for the Consumption Dashboard Table (only rows with traffic)
  const displayedConsumptionRows = useMemo(() => {
    let rows = activeConsumptionRecords.filter((r) => r.totalTraffic > 0);

    if (modelFilter !== 'all') {
      rows = rows.filter((r) => r.model === modelFilter);
    }

    return [...rows].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [activeConsumptionRecords, modelFilter, sortField, sortOrder]);

  // Summary Totals for the Consumption Table Footer
  const tableTotals = useMemo(() => {
    let traffic = 0;
    let inTokens = 0;
    let outTokens = 0;
    let cost = 0;
    displayedConsumptionRows.forEach((r) => {
      traffic += r.totalTraffic;
      inTokens += r.inputTokens;
      outTokens += r.outputTokens;
      cost += r.costUsd;
    });

    const totTokens = inTokens + outTokens;
    return {
      traffic: traffic.toLocaleString(),
      inTokens: formatTokens(inTokens),
      outTokens: formatTokens(outTokens),
      totalTokens: formatTokens(totTokens),
      cost: cost < 0.01 && cost > 0 ? cost.toFixed(4) : cost.toFixed(2),
    };
  }, [displayedConsumptionRows]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  return (
    <div className="h-full bg-slate-50 text-slate-900 overflow-y-auto p-4 sm:px-6 sm:py-5 space-y-5">

      {fetchError && (
        <div className="max-w-7xl mx-auto p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
          <span>{fetchError}</span>
          <button type="button" onClick={() => loadData()} className="underline font-semibold cursor-pointer ml-2">{sp({ technical: 'Retry query', finance: 'Try again', ai_coe: 'Try again' })}</button>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        {/* SECTION 1: UNIFIED GATEWAY ANALYTICS STRIP (Inspired by Semrush "Domain Analytics") */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          {/* Header with Purple Underline Accent */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="border-b-2 border-purple-500 inline-flex items-center gap-2 pb-1 font-bold text-sm text-slate-900">
              <span>
                {viewMode === 'user'
                  ? sp({ technical: 'My Gateway Traffic', finance: 'My AI spend', ai_coe: 'My model usage' })
                  : sp({ technical: 'AI Gateway Operations', finance: 'AI spend and usage', ai_coe: 'AI adoption and model mix' })}
              </span>
              <span
                title={
                  viewMode === 'user'
                    ? sp({
                        technical:
                          'My own traffic through the AI proxy with my developer key: success rate, 4xx/5xx faults, tokens against my quota, wallet burn and semantic cache hits. Open a ledger row for my per-call log.',
                        finance:
                          'What my AI use has cost, how much prepaid credit I have left, and how much answer reuse and automatic model choice saved me.',
                        ai_coe:
                          'Which models I have been using, how often a lower-cost model was picked for me, and whether any of my requests were blocked.',
                      })
                    : sp({
                        technical:
                          'Live Apigee Analytics for the AI proxy in this environment. Watch reliability (success rate, 4xx policy blocks vs 5xx backend faults), load shed by the semantic cache, the auto-routing split between Flash and Pro/Opus targets, and token and wallet burn per developer. Open any ledger row for the per-call Cloud Logging trail, including which policy faulted.',
                        finance:
                          'Live AI spend for this environment: what has been spent, how much prepaid credit is left, what automatic model choice and answer reuse saved, and which users and models the money went to. Open any row in the table to see the cost of each request.',
                        ai_coe:
                          'Live view of how teams use AI: which models they use, how much goes to premium versus low-cost models, how often automatic model choice steps in, and how many requests the safety controls blocked. Open any row to see individual requests, including blocked ones.',
                      })
                }
              >
                <Info className="w-3.5 h-3.5 text-slate-400 hover:text-purple-500 cursor-pointer" />
              </span>
            </div>

            <div className="flex items-center gap-2.5 text-xs text-slate-500 font-sans flex-wrap">
              {viewMode === 'user' ? (
                <>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                    <User className="w-3 h-3 text-blue-600" />
                    {currentUserEmail}
                  </span>
                  <span>•</span>
                </>
              ) : (
                <>
                  {/* Admin User Filter Dropdown */}
                  <div className="flex items-center bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 text-xs shadow-xs">
                    <User className="w-3.5 h-3.5 text-purple-600 mr-1.5 shrink-0" />
                    <span className="text-slate-500 mr-1 text-[11px] font-semibold">{sp({ technical: 'Developer:', finance: 'User:', ai_coe: 'User:' })}</span>
                    <select
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                      className="bg-transparent text-slate-800 text-xs font-mono focus:outline-none cursor-pointer max-w-[190px] sm:max-w-[220px] truncate"
                      title={sp({
                        technical: 'Scope every panel to one developer, or show fleet totals',
                        finance: 'See spend for one user, or everyone combined',
                        ai_coe: 'See model usage for one user, or everyone',
                      })}
                    >
                      <option value="all">{sp({ technical: 'All developers (fleet)', finance: 'All users', ai_coe: 'All users' })}</option>
                      {userList.map((u) => (
                        <option key={u.email} value={u.email}>
                          {u.name ? `${u.name} (${u.email})` : u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span>•</span>
                </>
              )}
              <span className="flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full animate-pulse ${env === 'dev' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {env === 'dev'
                  ? sp({ technical: 'Development', business: term(voice, 'devEnv') })
                  : sp({ technical: 'Production', business: term(voice, 'prodEnv') })}
              </span>
              <span>•</span>
              <span className="font-mono text-[11px] text-slate-500">
                {sp({ technical: 'Analytics lag ~1m', finance: 'Updated 1m ago', ai_coe: 'Updated 1m ago' })}
              </span>
            </div>
          </div>

          {/* 6-Column Metric Strip with Sparklines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            {/* Col 1: Request Success Rate */}
            <div className="p-3 sm:px-4 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                <span>{sp({ technical: 'Request Success Rate', finance: 'Requests answered', ai_coe: 'Requests served' })}</span>
                <span
                  title={sp({
                    technical:
                      'Share of proxy requests that returned 2xx (100% minus the error rate). 4xx are policy blocks: 401 bad key or model not on the product, 403 prepaid wallet empty, 400 Model Armor or schema, 429 token quota. 5xx are target or proxy faults. Both count against it; open a ledger row to see which policy faulted. Shows a dash when no error data was recorded for this scope and window.',
                    finance:
                      'Share of requests that got an answer. A falling rate usually means people are hitting their budgets or usage limits, or a provider is failing. Shows a dash when nothing was recorded for this period.',
                    ai_coe:
                      'Share of requests that got an answer. Requests stopped by safety controls or usage limits count against it, so a dip is a signal to check what teams are asking for and whether their limits fit. Shows a dash when nothing was recorded for this period.',
                  })}
                >
                  <Info className="w-3 h-3 text-slate-400 hover:text-purple-500 cursor-pointer" />
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <div className="w-11 h-11 rounded-full bg-teal-50 border-2 border-teal-500 flex items-center justify-center font-mono font-bold text-sm text-teal-600 shadow-xs">
                  {aggregatedStats.slaHealth === null ? '—' : `${Math.round(aggregatedStats.slaHealth)}%`}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    {aggregatedStats.faultCount === null
                      ? sp({ technical: 'No error data', finance: 'No data', ai_coe: 'No data' })
                      : aggregatedStats.faultCount === 0
                        ? sp({ technical: 'Healthy', finance: 'All answered', ai_coe: 'All served' })
                        : sp({ technical: 'Faults logged', finance: 'Some not answered', ai_coe: 'Some blocked' })}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {aggregatedStats.faultCount === null
                      ? sp({ technical: 'No error signal this window', finance: 'Not recorded for this period', ai_coe: 'Not recorded for this period' })
                      : aggregatedStats.faultCount === 0
                        ? sp({ technical: 'No 4xx or 5xx responses', finance: 'Nothing blocked or failed', ai_coe: 'No blocks or failures' })
                        : sp({
                            technical: `${aggregatedStats.faultCount} 4xx/5xx responses`,
                            finance: `${aggregatedStats.faultCount} got no answer`,
                            ai_coe: `${aggregatedStats.faultCount} blocked or failed`,
                          })}
                  </div>
                </div>
              </div>
            </div>

            {/* Col 2: Available Balance */}
            <div className="p-3 sm:px-4 space-y-1 min-w-0 overflow-hidden">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="truncate">{sp({ technical: 'Wallet Balance', finance: 'Prepaid credit left', ai_coe: 'Credit left' })}</span>
                <span
                  title={sp({
                    technical:
                      'Apigee Monetization prepaid wallet balance. When a wallet reaches zero the monetization limits check rejects that developer\'s calls until it is topped up.',
                    finance:
                      'Prepaid credit still available. When it runs out, AI requests stop until it is topped up, so read it against the spend trend to judge runway.',
                    ai_coe:
                      'Prepaid credit still available. When it runs out, those users lose AI access until it is topped up.',
                  })}
                  className="shrink-0"
                >
                  <Wallet className="w-3.5 h-3.5 text-emerald-500" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                <span
                  className="text-2xl font-bold font-mono text-emerald-600 tracking-tight"
                  title={`${sp({ technical: 'Exact wallet balance', finance: 'Exact amount', ai_coe: 'Exact amount' })}: $${availableBalanceData.exactAmount} USD`}
                >
                  ${availableBalanceData.amount}
                </span>
                <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200 shrink-0 whitespace-nowrap">
                  {availableBalanceData.badge}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 leading-tight" title={availableBalanceData.subtitle}>
                {availableBalanceData.subtitle}
              </div>
              {/* Mini Area Sparkline */}
              <div className="pt-0.5">
                <AreaSparkline data={availableBalanceData.sparkline} color="#10b981" id="balance" />
              </div>
            </div>

            {/* Col 3: Total Model Calls */}
            <div className="p-3 sm:px-4 space-y-1 min-w-0 overflow-hidden">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="truncate">{sp({ technical: 'Total Model Calls', finance: 'AI requests', ai_coe: 'AI requests' })}</span>
                <span
                  className="shrink-0"
                  title={sp({
                    technical:
                      'Requests that reached the AI proxy in this window, including ones blocked by policy. The green figure is the share that ran on Flash-tier targets, auto-routed or pinned by persona.',
                    finance:
                      'Number of AI requests in this period. The green figure is the share that ran on low-cost models, which keeps the cost per request down.',
                    ai_coe:
                      'Number of AI requests in this period. The green figure is the share handled by everyday low-cost models rather than premium ones.',
                  })}
                >
                  <Bot className="w-3.5 h-3.5 text-blue-500" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                <span className="text-2xl font-bold font-mono text-blue-600">
                  {aggregatedStats.totalCalls}
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 shrink-0">
                  {routingStats.flashPercent}% {sp({ technical: 'Flash tier', finance: 'low-cost', ai_coe: 'low-cost' })}
                </span>
              </div>
              {/* Mini Area Sparkline */}
              <div className="pt-1">
                <AreaSparkline data={sparklineCalls} color="rgb(var(--c-blue-500, 59 130 246))" id="calls" />
              </div>
            </div>

            {/* Col 4: Total Token Volume */}
            <div className="p-3 sm:px-4 space-y-1 min-w-0 overflow-hidden">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="truncate">{sp({ technical: 'Token Volume', finance: 'Usage volume', ai_coe: 'Tokens used' })}</span>
                <span
                  className="shrink-0"
                  title={sp({
                    technical:
                      'Prompt plus completion tokens, as counted by the LLM token quota policies. Sustained growth here is what turns into 429s once developers reach their per-minute or monthly quota.',
                    finance:
                      'Tokens are the unit AI models charge by: text read plus text written. More tokens means more spend.',
                    ai_coe:
                      'Tokens measure model usage: text read plus text written. Team usage limits are set in tokens, so this shows how close teams run to them.',
                  })}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                <span className="text-2xl font-bold font-mono text-purple-600">
                  {aggregatedStats.totalTokens}
                </span>
                <span className="text-[11px] font-medium text-slate-500 shrink-0">
                  {sp({ technical: 'in + out', finance: 'tokens', ai_coe: 'tokens' })}
                </span>
              </div>
              {/* Mini Area Sparkline */}
              <div className="pt-1">
                <AreaSparkline data={sparklineTokens} color="rgb(var(--c-purple-600, 147 51 234))" id="tokens" />
              </div>
            </div>

            {/* Col 5: Total Enterprise Spend */}
            <div className="p-3 sm:px-4 space-y-1 min-w-0 overflow-hidden">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="truncate">
                  {viewMode === 'user'
                    ? sp({ technical: 'My Metered Spend', finance: 'My spend', ai_coe: 'My AI spend' })
                    : sp({ technical: 'Metered Spend', finance: 'Total AI spend', ai_coe: 'AI spend' })}
                </span>
                <span
                  className="shrink-0"
                  title={sp({
                    technical:
                      'Token cost priced from the KVM rate card and debited from developer wallets by the rate plans. Semantic cache hits never reach a model, so they add nothing here.',
                    finance:
                      'Total charged for AI in this period at current model prices. Answers reused from earlier requests are not charged.',
                    ai_coe:
                      'What AI use cost in this period. Premium models usually drive most of it; see the model split for the mix.',
                  })}
                >
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                <span className="text-2xl font-bold font-mono text-emerald-600">
                  ${aggregatedStats.totalSpend}
                </span>
                <span className="text-[11px] font-sans text-slate-500 font-medium shrink-0">
                  USD
                </span>
              </div>
              {/* Mini Area Sparkline */}
              <div className="pt-1">
                <AreaSparkline data={sparklineSpend} color="#059669" id="spend" />
              </div>
            </div>

            {/* Col 6: Semantic Cache Savings */}
            <div className="p-3 sm:px-4 space-y-1 min-w-0 overflow-hidden">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="truncate">{sp({ technical: 'Cache Savings', finance: 'Saved by reuse', ai_coe: 'Answers reused' })}</span>
                <Database className="w-3.5 h-3.5 text-teal-500 shrink-0" />
              </div>
              <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                <span className="text-2xl font-bold font-mono text-teal-600">
                  {aggregatedStats.cacheSavings === null ? '—' : `$${aggregatedStats.cacheSavings}`}
                </span>
                <span
                  className="text-[11px] font-semibold text-emerald-600 shrink-0"
                  title={
                    aggregatedStats.cacheHitRate === null
                      ? sp({
                          technical:
                            'No cacheable traffic (HIT or MISS) in this window, so no hit ratio. DISABLED and (not set) requests are excluded; check the semantic cache policy is enabled for these personas.',
                          finance:
                            'No repeat questions that could reuse an answer were seen in this period, so nothing was saved this way.',
                          ai_coe: 'No repeat questions were seen in this period, so no answers were reused.',
                        })
                      : sp({
                          technical:
                            'Hit ratio from the dc_cache_status dimension: HIT / (HIT + MISS). Every hit is answered by the semantic cache lookup without calling the model backend, so it is load shed from the models and from token quota. The $ figure is the model cost avoided.',
                          finance:
                            'Share of repeat questions answered from a saved answer instead of paying the model again. The dollar figure is what those answers would have cost.',
                          ai_coe:
                            'Share of repeat questions answered from a saved answer. Reuse gives people faster, consistent answers and leaves more of their usage limit for new work.',
                        })
                  }
                >
                  {aggregatedStats.cacheHitRate === null
                    ? sp({ technical: 'No cache data', finance: 'No reuse data', ai_coe: 'No reuse data' })
                    : sp({
                        technical: `${aggregatedStats.cacheHitRate}% hit ratio`,
                        finance: `${aggregatedStats.cacheHitRate}% reused`,
                        ai_coe: `${aggregatedStats.cacheHitRate}% reused`,
                      })}
                </span>
              </div>
              {/* No sparkline here. It used to render a hardcoded [8,11,14…38] series that
                  always sloped upward regardless of actual cache behaviour. */}
              <div className="pt-1 h-[26px]" />
            </div>
          </div>
        </div>

        {/* SECTION 2: DUAL EXECUTIVE PANELS (Inspired by Semrush "Position Tracking" & "On Page SEO Checker") */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* PANEL 1: Auto-Routing Policy & Complexity Audit (like Semrush Site Audit & Position Tracking) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 flex flex-col justify-between">
            <div>
              {/* Header with Purple Underline Accent */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="border-b-2 border-purple-500 inline-flex items-center gap-2 pb-1 font-bold text-sm text-slate-900">
                    <Zap className="w-4 h-4 text-purple-500 shrink-0" />
                    <span>{sp({ technical: 'Auto-Routing Distribution', finance: 'Savings from automatic model choice', ai_coe: 'Automatic model choice' })}</span>
                    <span
                      title={sp({
                        technical:
                          'How model calls split between Flash-tier and Pro/Opus-tier targets, whether auto-routed by the complexity classifier or pinned by the persona. A rising premium share with flat traffic usually means a routing rule or a persona allow-list changed. The badge compares metered cost with sending every call to the most expensive model on the rate card.',
                        finance:
                          'How much of the work ran on low-cost models versus premium ones. The green badge is the saving versus sending every request to the most expensive model, calculated from real usage and current prices.',
                        ai_coe:
                          'How requests split between everyday low-cost models and premium models, whether chosen automatically or fixed per team. Use it to check premium models are going to the work that needs them.',
                      })}
                    >
                      <Info className="w-3.5 h-3.5 text-slate-400 hover:text-purple-500 cursor-pointer" />
                    </span>
                  </div>
                </div>
                {/* Was `flashPercent * 0.55`, presented as a savings percentage. The 0.55 had
                    no basis — it was not a price ratio between the tiers and not measured.
                    Report the routing split itself, which is a real quantity. */}
                {/* The gauge already shows the low-cost split, so the badge reports money instead:
                    savings vs. an all-benchmark-model baseline, computed from real tokens. */}
                <div
                  className="text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 shrink-0"
                  title={
                    routingSavings
                      ? sp({
                          technical: `Baseline: every call in scope sent to ${routingSavings.benchmarkModel}, the highest rate on the KVM rate card = $${routingSavings.baselineUsd.toFixed(2)}. Metered: $${routingSavings.actualUsd.toFixed(2)}. The difference is what routing saved.`,
                          finance: `If every request here had used ${routingSavings.benchmarkModel}, the most expensive model, it would have cost $${routingSavings.baselineUsd.toFixed(2)}. Actual cost: $${routingSavings.actualUsd.toFixed(2)}. The difference is the saving from automatic model choice.`,
                          ai_coe: `Sending every request to ${routingSavings.benchmarkModel}, the top premium model, would have cost $${routingSavings.baselineUsd.toFixed(2)}. With the current model mix it cost $${routingSavings.actualUsd.toFixed(2)}.`,
                        })
                      : sp({
                          technical: 'Needs token traffic in scope and a loaded KVM rate card to compute the baseline.',
                          finance: 'Needs some usage and the model price list to estimate savings.',
                          ai_coe: 'Needs some usage and model prices to compare the mix.',
                        })
                  }
                >
                  {routingSavings
                    ? `⚡ Saved up to $${routingSavings.savingsUsd.toFixed(2)}`
                    : sp({ technical: '⚡ No routing data', finance: '⚡ No data yet', ai_coe: '⚡ No data yet' })}
                </div>
              </div>

              {/* Site Health Style Semi-Circle Arc & Split Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center pt-4">
                {/* Arc Gauge */}
                <div className="flex flex-col items-center justify-center p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="relative w-32 h-20 flex items-end justify-center overflow-hidden">
                    <svg viewBox="0 0 100 55" className="w-full h-full">
                      <path
                        d="M 10 50 A 40 40 0 0 1 90 50"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="12"
                      />
                      <path
                        d="M 10 50 A 40 40 0 0 1 90 50"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray="126"
                        strokeDashoffset={126 * (1 - (routingStats.flashPercent ?? 0) / 100)}
                      />
                    </svg>
                    <div className="absolute bottom-1 font-mono font-bold text-lg text-slate-900">
                      {routingStats.flashPercent === null ? '—' : `${routingStats.flashPercent}%`}
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-600 mt-1">
                    {sp({ technical: 'Routed to Flash tier', finance: 'On low-cost models', ai_coe: 'On everyday models' })}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {sp({ technical: 'Flash Lite & Flash targets', finance: 'Fast, low-cost models', ai_coe: 'Flash Lite and Flash models' })}
                  </div>
                </div>

                {/* Right Breakdown Cards */}
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{sp({ technical: 'Flash targets (low cost)', finance: 'Low-cost models', ai_coe: 'Everyday models' })}</div>
                      <div className="text-xs text-slate-600 font-sans">{sp({ technical: 'Default target, lowest latency', finance: 'Lowest cost per request', ai_coe: 'Simple, fast tasks' })}</div>
                    </div>
                    <div className="text-right shrink-0 whitespace-nowrap">
                      <div className="font-mono font-bold text-emerald-600 text-sm">
                        {routingStats.flashCalls.toLocaleString()}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {routingStats.flashPercent}% {sp({ technical: 'of calls', finance: 'of requests', ai_coe: 'of requests' })}
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{sp({ technical: 'Pro / Opus targets (premium)', finance: 'Premium models', ai_coe: 'Premium models' })}</div>
                      <div className="text-xs text-slate-600 font-sans">{sp({ technical: 'Complex prompts, higher latency', finance: 'Highest cost per request', ai_coe: 'Complex work and reasoning' })}</div>
                    </div>
                    <div className="text-right shrink-0 whitespace-nowrap">
                      <div className="font-mono font-bold text-purple-600 text-sm">
                        {routingStats.proCalls.toLocaleString()}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {routingStats.proPercent}% {sp({ technical: 'of calls', finance: 'of requests', ai_coe: 'of requests' })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stacked Multi-Colored Volume Bar (Inspired by Semrush "Crawled Pages") */}
              <div className="pt-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{sp({ technical: 'Calls by Routing Target', finance: 'Requests by model', ai_coe: 'Model mix' })}</span>
                  <span className="font-mono font-bold text-slate-900">{totalModelTraffic.toLocaleString()} {requestsWord}</span>
                </div>
                <div className="w-full h-3 rounded-full overflow-hidden flex bg-slate-100 shadow-inner">
                  {[...modelStatsForPies].sort((a, b) => b.calls - a.calls).map((m) => {
                    const pct = totalModelTraffic > 0 ? (m.calls / totalModelTraffic) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={m.model}
                        className="h-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: m.color }}
                        title={`${m.model}: ${m.calls.toLocaleString()} ${requestsWord} (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>

                {/* Dynamic Legend Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono pt-1">
                  {[...modelStatsForPies]
                    .sort((a, b) => b.calls - a.calls)
                    .slice(0, 4)
                    .map((m) => {
                      const pct = totalModelTraffic > 0 ? ((m.calls / totalModelTraffic) * 100).toFixed(0) : '0';
                      return (
                        <div key={m.model} className="flex items-center gap-1.5 text-slate-600">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                          <span className="truncate">{m.model.replace('@20251101', '').replace('gemini-', 'G-')} {pct}%</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* PANEL 2: Model Spend & Token Breakdown (Inspired by Semrush "On Page SEO Checker") */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 flex flex-col justify-between">
            <div>
              {/* Header with Purple Underline Accent & Toggle Pills */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="border-b-2 border-purple-500 inline-flex items-center gap-2 pb-1 font-bold text-sm text-slate-900">
                    <Coins className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>
                      {viewMode === 'user'
                        ? sp({ technical: 'My Traffic by Model', finance: 'My spend by model', ai_coe: 'My usage by model' })
                        : sp({ technical: 'Spend & Tokens by Model', finance: 'Spend by model', ai_coe: 'Usage by model' })}
                    </span>
                    <span
                      title={sp({
                        technical:
                          'Metered spend and token volume per model target, from Apigee Analytics. High tokens with low spend is a cheap target doing the heavy lifting; the reverse usually means a persona pinned to a premium model. Toggle between Spend and Tokens.',
                        finance:
                          'Where the AI money went, model by model. Compare Spend with Usage: a model with a big share of spend but a small share of usage is expensive per request and a candidate for cheaper routing.',
                        ai_coe:
                          'Which models people actually use and what each costs. Compare Usage with Spend to see whether premium models take more of the budget than the work justifies.',
                      })}
                    >
                      <Info className="w-3.5 h-3.5 text-slate-400 hover:text-purple-500 cursor-pointer" />
                    </span>
                  </div>
                </div>

                {/* View Switcher: Spend ($ USD) vs Token Volume */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setDistributionMode('spend')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      distributionMode === 'spend'
                        ? 'bg-white text-emerald-600 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Spend ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDistributionMode('tokens')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      distributionMode === 'tokens'
                        ? 'bg-white text-purple-600 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {sp({ technical: 'Tokens', finance: 'Usage', ai_coe: 'Usage' })}
                  </button>
                </div>
              </div>

              {/* Dynamic Donut Chart + Categorized 2-Letter Badges */}
              <div className="pt-2">
                {distributionMode === 'spend' ? (
                  <DonutPieChart
                    data={costSlices}
                    totalFormatted={`$${aggregatedStats.totalSpend}`}
                    totalLabel={sp({ technical: 'Metered', finance: 'Total spend', ai_coe: 'Total spend' })}
                    unitLabel={sp({ technical: 'USD metered', finance: 'USD', ai_coe: 'USD' })}
                    centerBadgeColor="text-emerald-600"
                    borderless={true}
                  />
                ) : (
                  <DonutPieChart
                    data={tokenSlices}
                    totalFormatted={aggregatedStats.totalTokens}
                    totalLabel={sp({ technical: 'Total tokens', finance: 'Total usage', ai_coe: 'Total usage' })}
                    unitLabel={sp({ technical: 'in + out', finance: 'tokens', ai_coe: 'tokens' })}
                    centerBadgeColor="text-purple-600"
                    borderless={true}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: CONSUMPTION DASHBOARD TABLE (Inspired by Semrush "Backlink Audit" Data Table) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          {/* Table Header with Purple Underline Accent */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="border-b-2 border-purple-500 inline-flex items-center gap-2 pb-1 font-bold text-sm text-slate-900">
                <TableProperties className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  {viewMode === 'admin'
                    ? userFilter === 'all'
                      ? sp({ technical: 'Token & Cost Ledger by Developer and Model', finance: 'Spend by user and model', ai_coe: 'Usage by user and model' })
                      : sp({ technical: `Token & Cost Ledger for ${userFilter}`, finance: `Spend for ${userFilter}`, ai_coe: `Usage for ${userFilter}` })
                    : sp({ technical: `My Ledger for ${currentUserEmail}`, finance: `My spend for ${currentUserEmail}`, ai_coe: `My usage for ${currentUserEmail}` })}
                </span>
                <span
                  title={sp({
                    technical:
                      'One row per developer and model target: calls, prompt and completion tokens and metered cost from Apigee Analytics, merged with wallet reconciliation rows Analytics has not indexed yet. View logs opens the per-call Cloud Logging trail with status codes and the faulting policy.',
                    finance:
                      'Who is spending, and on which model. Sort by cost to find the biggest spenders; open a row to see the cost of each request.',
                    ai_coe:
                      'Which people use which models, and how heavily. Open a row to see individual requests, including any the safety controls blocked.',
                  })}
                >
                  <Info className="w-3.5 h-3.5 text-slate-400 hover:text-purple-500 cursor-pointer" />
                </span>
              </div>
            </div>

            {/* Filter Toolbar: ONLY Model Filter */}
            <div className="flex items-center gap-2.5">
              {/* Model Dropdown Filter */}
              <div className="flex items-center bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs shadow-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
                <span className="text-slate-500 mr-1.5 text-[11px]">Model:</span>
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className="bg-transparent text-slate-800 text-xs font-mono focus:outline-none cursor-pointer"
                >
                  <option value="all">{sp({ technical: 'All targets', finance: 'All models', ai_coe: 'All models' })} ({uniqueModels.length})</option>
                  {uniqueModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Clean Enterprise Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider font-semibold select-none">
                  {/* User Email */}
                  <th
                    onClick={() => handleSort('userEmail')}
                    className="pb-3 cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center gap-1">
                      <span>{sp({ technical: 'Developer', finance: 'User', ai_coe: 'User' })}</span>
                      {sortField === 'userEmail' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Model */}
                  <th
                    onClick={() => handleSort('model')}
                    className="pb-3 cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center gap-1">
                      <span>Model</span>
                      {sortField === 'model' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Total Traffic (Sum) */}
                  <th
                    onClick={() => handleSort('totalTraffic')}
                    className="pb-3 text-right cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{sp({ technical: 'Calls', finance: 'Requests', ai_coe: 'Requests' })}</span>
                      {sortField === 'totalTraffic' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Input Token (Sum) */}
                  <th
                    onClick={() => handleSort('inputTokens')}
                    className="pb-3 text-right cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{sp({ technical: 'Prompt tokens', finance: 'Tokens in', ai_coe: 'Tokens in' })}</span>
                      {sortField === 'inputTokens' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Output Token (Sum) */}
                  <th
                    onClick={() => handleSort('outputTokens')}
                    className="pb-3 text-right cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{sp({ technical: 'Completion tokens', finance: 'Tokens out', ai_coe: 'Tokens out' })}</span>
                      {sortField === 'outputTokens' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Cost (Sum) */}
                  <th
                    onClick={() => handleSort('costUsd')}
                    className="pb-3 text-right cursor-pointer hover:text-slate-900 transition"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{sp({ technical: 'Metered cost', finance: 'Cost', ai_coe: 'Cost' })}</span>
                      {sortField === 'costUsd' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-purple-500" /> : <ChevronDown className="w-3.5 h-3.5 text-purple-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Audit trail drill-down (not sortable) */}
                  <th className="pb-3 text-right">
                    <span>{sp({ technical: 'Logs', finance: 'Detail', ai_coe: 'Requests' })}</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {displayedConsumptionRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                      {sp({
                        technical: 'No ledger rows for this model filter in this window. Clear the filter or widen the time range.',
                        finance: 'No spend on this model in this period.',
                        ai_coe: 'Nobody used this model in this period.',
                      })}
                    </td>
                  </tr>
                ) : (
                  displayedConsumptionRows.map((row) => {
                    const isCurrentUser =
                      row.userEmail.toLowerCase() === currentUserEmail.toLowerCase();

                    return (
                      <tr
                        key={`${row.userEmail}__${row.model}`}
                        className={`hover:bg-slate-50 transition group ${
                          isCurrentUser ? 'bg-blue-50/40' : ''
                        }`}
                      >
                        {/* User Email */}
                        <td className="py-3 font-medium text-slate-800 flex items-center gap-2 font-sans">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isCurrentUser
                                ? 'bg-blue-500 ring-2 ring-blue-200'
                                : row.isUnauthenticated
                                ? 'bg-slate-400'
                                : 'bg-emerald-500'
                            }`}
                          />
                          <span className="truncate">{row.userEmail}</span>
                          {isCurrentUser && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                              You
                            </span>
                          )}
                        </td>

                        {/* Model & Provider Badge */}
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{row.model}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {row.provider}
                            </span>
                          </div>
                        </td>

                        {/* Total Traffic (Sum) */}
                        <td className="py-3 text-right text-slate-800">
                          <span className="font-bold">{row.totalTraffic.toLocaleString()}</span>
                          <span className="text-[10px] text-slate-500 font-sans ml-1">{requestsWord}</span>
                        </td>

                        {/* Input Token (Sum) */}
                        <td
                          className="py-3 text-right text-slate-600 font-mono"
                          title={`${row.inputTokens.toLocaleString()} tokens`}
                        >
                          {formatTokens(row.inputTokens)}
                        </td>

                        {/* Output Token (Sum) */}
                        <td
                          className="py-3 text-right text-slate-600 font-mono"
                          title={`${row.outputTokens.toLocaleString()} tokens`}
                        >
                          {formatTokens(row.outputTokens)}
                        </td>

                        {/* Cost (Sum) */}
                        <td className="py-3 text-right">
                          <span className="text-emerald-600 font-bold font-mono">
                            {formatCost(row.costUsd)}
                          </span>
                          <span className="text-[10px] text-slate-500 font-sans ml-1">USD</span>
                        </td>

                        {/* Per-call audit trail for this user + model pair */}
                        <td className="py-3 text-right">
                          <button
                            onClick={() =>
                              setLogsTarget({ userEmail: row.userEmail, model: row.model })
                            }
                            title={sp({
                              technical: `Per-call log for ${row.userEmail} on ${row.model}: status, faulting policy, tokens, latency`,
                              finance: `Cost of each request by ${row.userEmail} on ${row.model}`,
                              ai_coe: `Every request by ${row.userEmail} to ${row.model}, including blocked ones`,
                            })}
                            className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold text-blue-600 hover:underline cursor-pointer"
                          >
                            <ScrollText className="w-3.5 h-3.5" />
                            {sp({ technical: 'View logs', finance: 'View costs', ai_coe: 'View requests' })}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Table Totals Summary Footer */}
              {displayedConsumptionRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-mono text-xs bg-slate-50 font-bold">
                    <td className="py-3 text-slate-700 font-sans">
                      Total ({displayedConsumptionRows.length}{sp({ technical: ' rows', finance: '', ai_coe: '' })})
                    </td>
                    <td className="py-3 text-slate-500 font-sans">
                      {sp({ technical: 'All targets in filter', finance: 'All models shown', ai_coe: 'All models shown' })}
                    </td>
                    <td className="py-3 text-right text-slate-900">
                      {tableTotals.traffic} <span className="text-[10px] text-slate-500 font-sans font-normal">{requestsWord}</span>
                    </td>
                    <td className="py-3 text-right text-slate-700">
                      {tableTotals.inTokens}
                    </td>
                    <td className="py-3 text-right text-slate-700">
                      {tableTotals.outTokens}
                    </td>
                    <td className="py-3 text-right text-emerald-600 text-sm">
                      ${tableTotals.cost} <span className="text-[10px] text-slate-500 font-sans font-normal">USD</span>
                    </td>
                    {/* Logs column has no meaningful total. */}
                    <td className="py-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        {/*
          Per-call audit trail for a single ledger row. Keyed on the target and
          the dashboard range so React remounts it on each open -- that re-seeds
          the window selector from `timeRange` without an extra sync effect,
          which would otherwise fire a second Cloud Logging query on the stale
          window every time the modal opened.
        */}
        {logsTarget && (
          <CallLogsModal
            key={`${logsTarget.userEmail}|${logsTarget.model}|${timeRange}`}
            isOpen
            onClose={() => setLogsTarget(null)}
            userEmail={logsTarget.userEmail}
            model={logsTarget.model}
            initialWindow={timeRange}
          />
        )}
      </div>
    </div>
  );
};
