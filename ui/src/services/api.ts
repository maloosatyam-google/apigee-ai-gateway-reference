// All endpoints below are served by the UI's own backend (`ui/server.js`) on a
// relative path, so no gateway host, project ID, or credential is embedded here.
// Credentials are resolved server-side from the Apigee Management API.

export async function fetchModelRates(env: 'dev' | 'prod' = 'prod'): Promise<{
  status: string;
  env: string;
  org: string;
  map: string;
  rates: import('../types').RateCardDictionary;
  updatedAt: string;
}> {
  const response = await fetch(`/api/kvm/rates?env=${env}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch model rates (${response.status})`);
  }
  return response.json();
}

export async function updateModelRates(env: 'dev' | 'prod', rates: import('../types').RateCardDictionary): Promise<{
  status: string;
  env: string;
  message: string;
  rates: import('../types').RateCardDictionary;
  updatedAt: string;
}> {
  const response = await fetch('/api/kvm/rates', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ env, rates }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update model rates (${response.status})`);
  }
  return response.json();
}

export async function fetchDeveloperBalance(dev?: string): Promise<{
  status: string;
  developer: string;
  org: string;
  data: {
    wallets?: Array<{
      balance: {
        currencyCode: string;
        units: string;
        nanos: number;
      };
      lastCreditTime?: string;
    }>;
  };
}> {
  const query = dev ? `?dev=${encodeURIComponent(dev)}` : '';
  const response = await fetch(`/api/monetization/balance${query}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch developer balance (${response.status})`);
  }
  return response.json();
}

export async function creditDeveloperBalance(units: number | string, dev?: string): Promise<{
  status: string;
  developer: string;
  credited: string;
  transactionId: string;
  data: any;
}> {
  const response = await fetch('/api/monetization/credit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ units: String(units), developer: dev }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to credit developer balance (${response.status})`);
  }
  return response.json();
}

export async function fetchRatePlans(): Promise<{
  status: string;
  ratePlans: import('../types').RatePlanInfo[];
}> {
  const response = await fetch('/api/monetization/rateplans');
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch rate plans (${response.status})`);
  }
  return response.json();
}

export async function fetchDeveloperSubscriptions(dev?: string): Promise<{
  status: string;
  developer: string;
  subscriptions: import('../types').DeveloperSubscription[];
}> {
  const query = dev ? `?dev=${encodeURIComponent(dev)}` : '';
  const response = await fetch(`/api/monetization/subscriptions${query}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch developer subscriptions (${response.status})`);
  }
  return response.json();
}

export async function subscribeDeveloper(apiproduct: string, dev?: string): Promise<{
  status: string;
  data: any;
}> {
  const response = await fetch('/api/monetization/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiproduct, developer: dev }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to subscribe developer (${response.status})`);
  }
  return response.json();
}

export async function fetchDeveloperMonetizationConfig(dev?: string): Promise<{
  status: string;
  developer: string;
  config: import('../types').DeveloperMonetizationConfig;
}> {
  const query = dev ? `?dev=${encodeURIComponent(dev)}` : '';
  const response = await fetch(`/api/monetization/config${query}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch developer monetization config (${response.status})`);
  }
  return response.json();
}

export async function updateDeveloperMonetizationConfig(
  billingType: 'PREPAID' | 'POSTPAID',
  dev?: string
): Promise<{
  status: string;
  developer: string;
  config: import('../types').DeveloperMonetizationConfig;
}> {
  const response = await fetch('/api/monetization/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingType, developer: dev }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update developer monetization config (${response.status})`);
  }
  return response.json();
}

export interface FleetAnalyticsResponse {
  status: string;
  source: string;
  org: string;
  env: string;
  timeRange: string;
  apigeeTimeRange: string;
  metaData?: {
    notices?: string[];
  };
  kpis: {
    totalCalls: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalSpendUsd: number;
    /**
     * Both `null` when the window contains no measurable cache activity. Derived from the
     * `dc_cache_status` dimension (HIT / MISS / DISABLED); `DISABLED` and `(not set)` are
     * excluded from the denominator rather than counted as misses. Never substitute a
     * default — these were previously a hardcoded 29.4% and 35%-of-spend.
     */
    cacheCostSavingsUsd: number | null;
    cacheHitRate: number | null;
    /** Cache calls that hit, and the HIT+MISS denominator. `null` when nothing was measured. */
    cacheHitCount?: number | null;
    cacheMeasuredCalls?: number | null;
    /** `null` when the window had no traffic at all — do not substitute a default. */
    slaHealth: number | null;
    avgLatencyMs: number;
    isErrorCount: number;
    /**
     * Subset of `isErrorCount` that carries a `dc_user_email` and can therefore be broken down
     * per user. Reports 0 for time windows recorded before the proxy's `DefaultFaultRule` was
     * added, even when `isErrorCount` is non-zero.
     */
    attributedErrorCount?: number;
  };
  routing: {
    flashCalls: number;
    /** `null` when there was no traffic — there is no routing split to report. */
    flashPercent: number | null;
    proOpusCalls: number;
    proOpusPercent: number | null;
  };
  consumptionRows: import('../types').UserConsumptionRecord[];
  userCacheStats?: Record<string, {
    hits: number;
    misses: number;
    disabled?: number;
    notSet?: number;
  }>;
}

export async function fetchFleetAnalytics(
  timeRange: '24h' | '7d' | '30d' = '24h',
  env: 'dev' | 'prod' = 'prod'
): Promise<FleetAnalyticsResponse> {
  const response = await fetch(`/api/analytics/fleet-stats?timeRange=${timeRange}&env=${env}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch fleet analytics (${response.status})`);
  }
  return response.json();
}

export async function fetchDeveloperAttributions(): Promise<{
  status: string;
  attributions: import('../types').UserMonetizationAttribution[];
}> {
  const response = await fetch('/api/monetization/attributions');
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch developer attributions (${response.status})`);
  }
  return response.json();
}

/** Lookback windows accepted by /api/logs/calls. */
export type CallLogWindow = '1h' | '24h' | '7d' | '30d';

/**
 * A single gateway transaction as recorded by the ML-CloudLogging policy.
 * Emitted from PostClientFlow, so blocked and failed calls appear here too --
 * those carry a non-2xx `status` and a populated `faultName`.
 */
export interface CallLogEntry {
  timestamp: string | null;
  trackingId: string;
  userEmail: string;
  model: string;
  provider: string;
  prompt: string;
  response: string;
  status: number;
  costUsd: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  autoRouted: boolean;
  cached: boolean;
  latencyMs: number | null;
  faultName: string;
  errorMessage: string;
  pathSuffix: string;
  environment: string;
}

export interface CallLogsResponse {
  status: string;
  count: number;
  window: CallLogWindow;
  entries: CallLogEntry[];
  /** Deep link to the same filter in the Cloud Logging console. */
  consoleUrl: string;
}

export async function fetchCallLogs(
  userEmail: string,
  model: string,
  window: CallLogWindow = '24h'
): Promise<CallLogsResponse> {
  const params = new URLSearchParams({ user: userEmail, model, window });
  const response = await fetch(`/api/logs/calls?${params.toString()}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch call logs (${response.status})`);
  }
  return response.json();
}

export async function fetchAiProducts(env: 'dev' | 'prod' = 'prod'): Promise<{
  status: string;
  env?: 'dev' | 'prod';
  products: import('../types').ApiProduct[];
  defaults: Record<string, import('../types').ApiProduct>;
}> {
  const response = await fetch(`/api/products?env=${env}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch AI products (${response.status})`);
  }
  return response.json();
}

/** Saves to the Dev sandbox product. The server refuses env=prod (prod changes go through a PR). */
export async function updateAiProduct(
  name: string,
  product: import('../types').ApiProduct,
  env: 'dev' | 'prod' = 'dev',
): Promise<{
  status: string;
  product: import('../types').ApiProduct;
}> {
  const response = await fetch(`/api/products?env=${env}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, product, env }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update product ${name} (${response.status})`);
  }
  return response.json();
}

/** Dev only: re-clones the current prod tier(s) into the Dev sandbox products. */
export async function resetAiProduct(
  name: string = 'all',
  env: 'dev' | 'prod' = 'dev',
): Promise<{
  status: string;
  message: string;
  results: Array<{ name: string; ok: boolean; data?: any }>;
  defaults: Record<string, import('../types').ApiProduct>;
}> {
  const response = await fetch(`/api/products/reset?env=${env}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, env }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to reset product defaults (${response.status})`);
  }
  return response.json();
}


// ---- Tools (MCP) analytics --------------------------------------------------
// Shape produced by ui/server/toolsAnalytics.js#buildToolsAnalytics.
export interface ToolsBreakdownCounts {
  calls: number;
  ok: number;
  denied: number;
  rejected: number;
  throttled: number;
  error: number;
}
export interface ToolsAnalyticsResponse {
  env: 'dev' | 'prod';
  kpis: {
    totalCalls: number;
    successRate: number | null;
    okCalls: number;
    deniedCalls: number;
    rejectedCalls: number;
    throttledCalls: number;
    errorCalls: number;
    avgLatencyMs: number | null;
  };
  byServer: Array<ToolsBreakdownCounts & { proxy: string; label: string; avgLatencyMs: number | null }>;
  byPersona: Array<ToolsBreakdownCounts & { persona: string; key: string; servers: string[] }>;
  byStatus: Array<{ status: string; calls: number; class: string }>;
  /** Everyone who called a tool server in the window (for the user filter); unaffected by `user`. */
  users?: Array<{ key: string; label: string; persona: string; calls: number }>;
}

export async function fetchToolsAnalytics(
  timeRange: '24h' | '7d' | '30d' = '24h',
  env: 'dev' | 'prod' = 'prod',
  handle?: string,
  user?: string,
): Promise<ToolsAnalyticsResponse> {
  const q = new URLSearchParams({ timeRange, env });
  if (handle) q.set('handle', handle);
  if (user && user !== 'all') q.set('user', user);
  const response = await fetch(`/api/analytics/tools-stats?${q}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch tools analytics (${response.status})`);
  }
  return response.json();
}

// ---- Tool-call logs (Cloud Logging) ------------------------------------------
// Shape produced by ui/server/toolLogs.js#buildToolLogs.
export type ToolCallOutcome = 'ok' | 'tool_error' | 'rpc_error' | 'denied' | 'rejected' | 'throttled' | 'error';
export interface ToolCallLogEntry {
  timestamp: string | null;
  trackingId: string;
  env: string;
  server: string;
  serverLabel: string;
  method: string;
  tool: string;
  arguments: string;
  httpStatus: number | null;
  outcome: ToolCallOutcome;
  faultName: string;
  errorMessage: string;
  backendMs: number | null;
  attributed: boolean;
  userKey: string;
  userLabel: string;
  persona: string;
  request: string;
  response: string;
}
export interface ToolUsageRow {
  tool: string;
  server: string;
  serverLabel: string;
  calls: number;
  ok: number;
  failed: number;
  blocked: number;
  lastUsed: string | null;
  avgBackendMs: number | null;
}
export interface ToolLogsResponse {
  status: string;
  env: 'dev' | 'prod';
  window: '24h' | '7d' | '30d';
  truncated: boolean;
  consoleUrl: string;
  scanned: number;
  matched: number;
  unattributed: number;
  attributedShare: number;
  byTool: ToolUsageRow[];
  entries: ToolCallLogEntry[];
}

export async function fetchToolLogs(params: {
  window: '24h' | '7d' | '30d';
  env: 'dev' | 'prod';
  user?: string;
  server?: string;
  tool?: string;
  includeProtocol?: boolean;
}): Promise<ToolLogsResponse> {
  const q = new URLSearchParams({ window: params.window, env: params.env });
  if (params.user && params.user !== 'all') q.set('user', params.user);
  if (params.server) q.set('server', params.server);
  if (params.tool) q.set('tool', params.tool);
  if (params.includeProtocol) q.set('protocol', '1');
  const response = await fetch(`/api/logs/tools?${q}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch tool logs (${response.status})`);
  }
  return response.json();
}
