/**
 * Ask Apigee -- insights (read-only analytics and audit-log questions).
 *
 * Answers "who spent the most", "which tools were blocked", "why did my call
 * fail" from the same sources the Analytics tab uses: Apigee Analytics custom
 * dimensions (dc_*) for the AI Gateway, standard dimensions for the MCP
 * proxies, the ai-model-rates KVM for prices, and the `apigee` Cloud Logging
 * log the proxies write per call.
 *
 * Shape mirrors adminAgentCore.js / adminAgentService.js: everything that can
 * be pure is exported and unit-tested; I/O goes through an injected `fetchImpl`
 * and `getToken` (see createInsights).
 *
 * Scoping is enforced HERE, not by the model: in the user view `scopeEmail` is
 * set by the server from the caller's identity and overrides whatever `user`
 * the model asked for, so a user can never read someone else's data by asking.
 */
import { statsTimeRange } from './agentAnalytics.js';
import { buildToolsAnalytics, toolsStatsUrl } from './toolsAnalytics.js';
import { buildToolLogs, parseToolLogEntry, toolLogsFilter } from './toolLogs.js';
import { GCP_PROJECT_ID, APIGEE_ORG } from './deployConfig.js';

export const AI_PROXY = 'ai-gateway-v1';
export const INSIGHT_RANGES = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
export const USAGE_GROUPS = ['user', 'model', 'user_model'];
export const CALL_OUTCOMES = ['all', 'errors', 'blocked', 'ok'];
export const MAX_ROWS = 25;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MODEL_RE = /^[A-Za-z0-9._@-]{1,100}$/;
const TOOL_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const TRACKING_RE = /^[A-Za-z0-9._:-]{4,120}$/;

const isAbsent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const metric = (dim, name) => num(dim.metrics?.find((m) => m.name === name)?.values?.[0]);
const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---------------------------------------------------------------------------
// Argument normalisation (shared by the tool validators)
// ---------------------------------------------------------------------------

export function normalizeRange(value, fallback = '24h') {
  const v = String(value || fallback).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(INSIGHT_RANGES, v)) {
    throw new Error(`Unknown time range "${value}". Use one of: ${Object.keys(INSIGHT_RANGES).join(', ')}.`);
  }
  return v;
}

export function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'all') return '';
  if (!EMAIL_RE.test(v)) throw new Error(`"${value}" is not an email address.`);
  return v;
}

export function normalizeModel(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!MODEL_RE.test(v)) throw new Error(`"${value}" is not a valid model id.`);
  return v;
}

export function normalizeTool(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!TOOL_RE.test(v)) throw new Error(`"${value}" is not a valid tool name.`);
  return v;
}

export function normalizeTrackingId(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!TRACKING_RE.test(v)) throw new Error(`"${value}" is not a valid tracking id.`);
  return v;
}

export function normalizeLimit(value, fallback = 10) {
  const n = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_ROWS);
}

/** The effective user filter: a scoped (user-view) caller can only ever see themselves. */
export function effectiveUser(requested, scopeEmail) {
  if (scopeEmail) return String(scopeEmail).toLowerCase();
  return requested || '';
}

// ---------------------------------------------------------------------------
// Usage (AI Gateway spend / tokens)
// ---------------------------------------------------------------------------

/** Rate-card entry for a model: longest matching key wins, then `default`. */
export function rateFor(model, rates = {}) {
  const key = Object.keys(rates)
    .filter((k) => k !== 'default' && (model === k || String(model).startsWith(k)))
    .sort((a, b) => b.length - a.length)[0];
  return (key ? rates[key] : null) || rates[model] || rates.default || {};
}

export function usageStatsUrl({ org, env, timeRange }) {
  const filter = encodeURIComponent(`(apiproxy eq '${AI_PROXY}')`);
  return (
    `https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/stats/dc_user_email,dc_model_name` +
    '?select=sum(message_count),sum(is_error),sum(dc_prompt_token_count),sum(dc_candidates_token_count)' +
    `&timeRange=${encodeURIComponent(timeRange)}&filter=${filter}`
  );
}

export function cacheStatsUrl({ org, env, timeRange }) {
  const filter = encodeURIComponent(`(apiproxy eq '${AI_PROXY}')`);
  return (
    `https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/stats/dc_user_email,dc_cache_status` +
    `?select=sum(message_count)&timeRange=${encodeURIComponent(timeRange)}&filter=${filter}`
  );
}

/**
 * Pure aggregation of the dc_user_email,dc_model_name stats response.
 * Prices each (user, model) cell at the KVM rate card, exactly like
 * /api/analytics/fleet-stats, then groups and ranks.
 */
export function aggregateUsage(statsJson, rates = {}, { user = '', model = '', groupBy = 'user', limit = 10, cacheJson = null } = {}) {
  const dims = statsJson?.environments?.[0]?.dimensions || [];
  const groups = new Map();
  const totals = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const users = new Set();
  const models = new Set();

  for (const dim of dims) {
    const parts = dim.individualNames || String(dim.name || '').split(',');
    const rawUser = parts[0];
    const rawModel = parts[1];
    const calls = metric(dim, 'sum(message_count)');
    if (calls <= 0) continue;
    const email = isAbsent(rawUser) ? '(anonymous)' : String(rawUser).toLowerCase();
    const mdl = isAbsent(rawModel) || rawModel === '{flow.model}' ? '(blocked before a model)' : rawModel;
    if (user && email !== user) continue;
    if (model && mdl !== model) continue;

    const errors = metric(dim, 'sum(is_error)');
    const pt = metric(dim, 'sum(dc_prompt_token_count)');
    const ct = metric(dim, 'sum(dc_candidates_token_count)');
    const r = rateFor(mdl, rates);
    const cost = mdl.startsWith('(') ? 0 : (pt / 1e6) * (r.input ?? 0.15) + (ct / 1e6) * (r.output ?? 0.6);

    totals.calls += calls;
    totals.errors += errors;
    totals.inputTokens += pt;
    totals.outputTokens += ct;
    totals.costUsd += cost;
    users.add(email);
    models.add(mdl);

    const key = groupBy === 'model' ? mdl : groupBy === 'user_model' ? `${email} · ${mdl}` : email;
    const g = groups.get(key) || {
      key,
      ...(groupBy !== 'model' ? { user: email } : {}),
      ...(groupBy !== 'user' ? { model: mdl } : {}),
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    g.calls += calls;
    g.errors += errors;
    g.inputTokens += pt;
    g.outputTokens += ct;
    g.costUsd += cost;
    groups.set(key, g);
  }

  // Cache hit rate (HIT / (HIT + MISS)); DISABLED and "(not set)" are not misses.
  let hits = 0;
  let misses = 0;
  for (const dim of cacheJson?.environments?.[0]?.dimensions || []) {
    const parts = dim.individualNames || String(dim.name || '').split(',');
    const email = isAbsent(parts[0]) ? '(anonymous)' : String(parts[0]).toLowerCase();
    if (user && email !== user) continue;
    const status = String(parts[1] || '').toUpperCase();
    const n = metric(dim, 'sum(message_count)');
    if (status === 'HIT') hits += n;
    else if (status === 'MISS') misses += n;
  }

  const round = (g) => ({
    ...g,
    totalTokens: g.inputTokens + g.outputTokens,
    costUsd: Number(g.costUsd.toFixed(4)),
    errorRate: g.calls ? Number(((g.errors / g.calls) * 100).toFixed(1)) : 0,
  });
  const rows = [...groups.values()].map(round).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);

  return {
    totals: {
      ...round(totals),
      distinctUsers: users.size,
      distinctModels: models.size,
      cacheHitRate: hits + misses > 0 ? Number(((hits / (hits + misses)) * 100).toFixed(1)) : null,
      cacheHits: hits,
    },
    groupBy,
    rows: rows.slice(0, limit),
    moreRows: Math.max(0, rows.length - limit),
  };
}

// ---------------------------------------------------------------------------
// Call logs + failure explanation
// ---------------------------------------------------------------------------

export function callLogsFilter({ project, env, sinceIso, user = '', model = '', trackingId = '' }) {
  const parts = [
    `logName="projects/${project}/logs/apigee"`,
    `timestamp>="${sinceIso}"`,
    `jsonPayload.apiProxyName="${AI_PROXY}"`,
  ];
  if (env) parts.push(`jsonPayload.environmentName="${env}"`);
  if (user) parts.push(`jsonPayload.userEmail="${user}"`);
  // Model Armor faults before the target model resolves; match either field.
  if (model) parts.push(`(jsonPayload.model="${model}" OR jsonPayload.requestedModel="${model}")`);
  if (trackingId) parts.push(`jsonPayload.trackingId="${trackingId}"`);
  return parts.join(' AND ');
}

/** One Cloud Logging entry from ai-gateway-v1 -> a compact row. */
export function parseCallEntry(entry) {
  const p = entry?.jsonPayload || {};
  const start = num(p.clientReceivedStartTimeEpoch);
  const end = num(p.clientReceivedEndTimeEpoch);
  const status = num(p.responseStatusCode) || num(p.errorStatusCode);
  const row = {
    timestamp: entry?.timestamp || null,
    trackingId: p.trackingId || '',
    env: p.environmentName || '',
    user: isAbsent(p.userEmail) ? '' : String(p.userEmail).toLowerCase(),
    model: isAbsent(p.model) ? '' : p.model,
    requestedModel: isAbsent(p.requestedModel) ? '' : p.requestedModel,
    autoRouted: String(p.autoRouted || '') === 'true',
    routerCategory: isAbsent(p.routerCategory) ? '' : p.routerCategory,
    cached: String(p.cached || '') === 'true',
    status,
    faultName: isAbsent(p.faultName) ? '' : p.faultName,
    errorMessage: isAbsent(p.errorMessage) ? '' : clip(p.errorMessage, 300),
    budgetStatus: isAbsent(p.budgetStatus) ? '' : p.budgetStatus,
    totalTokens: num(p.totalTokens),
    costUsd: num(p.costUsd),
    latencyMs: start > 0 && end >= start ? end - start : null,
    prompt: clip(isAbsent(p.prompt) ? '' : p.prompt, 160),
  };
  row.outcome = callOutcome(row);
  return row;
}

/** ok | blocked (our governance said no) | error (anything else that failed). */
export function callOutcome(row) {
  if (row.status >= 200 && row.status < 300) return 'ok';
  const cat = classifyFailure(row).category;
  return GOVERNANCE_CATEGORIES.has(cat) ? 'blocked' : 'error';
}

const GOVERNANCE_CATEGORIES = new Set([
  'model_armor_prompt',
  'model_armor_response',
  'token_quota',
  'budget',
  'wallet',
  'not_entitled',
  'prompt_too_long',
]);

/**
 * Why a call failed, in terms an admin can act on.
 *
 * Driven by the fault name and message the proxy logs (ML-CloudLogging), with
 * the HTTP status as the tie-breaker. `owner` is the admin persona that can fix
 * it (matches adminRoles.js), and `guardrail` is the GuardrailControl id from
 * the catalog when one applies, so the agent can pull its details.
 */
export function classifyFailure(row) {
  const fault = String(row?.faultName || '');
  const msg = String(row?.errorMessage || '');
  const blob = `${fault} ${msg}`.toLowerCase();
  const status = Number(row?.status) || 0;
  const make = (category, title, explanation, fix, owner, guardrail = '') => ({
    category,
    title,
    explanation,
    fix,
    owner,
    ...(guardrail ? { guardrail } : {}),
  });

  if (status >= 200 && status < 300) {
    return make('none', 'Succeeded', 'The call succeeded.', '', '');
  }
  if (/filtermatched|model ?armor|sanitize/.test(blob)) {
    const responseSide = /response/.test(blob) || Boolean(row?.model);
    const pi = /pimatchesfound: ?true/.test(blob);
    const sdp = /sdpmatchesfound: ?true/.test(blob);
    const rai = /raimatchesfound: ?true/.test(blob);
    const filters = [pi && 'prompt-injection / jailbreak', sdp && 'sensitive data (PII)', rai && 'responsible-AI (harmful content)']
      .filter(Boolean)
      .join(', ');
    return responseSide
      ? make(
          'model_armor_response',
          'Model Armor blocked the response',
          `The model answered, but Model Armor screened the answer and stopped it${filters ? ` (${filters} filter)` : ''}.`,
          'Usually intended. If it is a false positive, the AI CoE can tune the Model Armor template or response screening for that tier.',
          'AI CoE',
          'ai-armor'
        )
      : make(
          'model_armor_prompt',
          'Model Armor blocked the prompt',
          `Model Armor screened the prompt before any model saw it and blocked it${filters ? ` (${filters} filter)` : ''}. No tokens were spent.`,
          'Rephrase the prompt. If it is a false positive, the AI CoE can tune the Model Armor template for that tier.',
          'AI CoE',
          'ai-armor'
        );
  }
  if (/budget/.test(blob)) {
    return make(
      'budget',
      'Spending cap reached',
      'The tier\'s spending cap for the current period is used up, so the gateway stopped the call before it reached a model.',
      'Wait for the cap to reset, or ask Finance to raise the spending cap on that tier.',
      'Finance',
      'ai-quota'
    );
  }
  if (/monetization|prepaid|balance|wallet|insufficient/.test(blob)) {
    return make(
      'wallet',
      'Prepaid wallet empty',
      'The developer\'s prepaid wallet does not have enough credit for this call.',
      'Finance can top up the wallet (Admin Console → Finance → Prepaid credit).',
      'Finance',
      'ai-quota'
    );
  }
  if (/promptTokenLimit|prompt token limit|prompttokenlimit/i.test(blob)) {
    return make(
      'prompt_too_long',
      'Prompt too long',
      'The prompt is larger than the per-request token limit for this tier.',
      'Shorten the prompt, or ask the AI CoE to raise the prompt token limit.',
      'AI CoE',
      'ai-quota'
    );
  }
  if (/quotaviolation|llmtokenquota|ltq-|token quota|tokens? per/.test(blob) || (status === 429 && !/resource_exhausted|resource exhausted/.test(blob))) {
    return make(
      'token_quota',
      'Token quota exceeded',
      'This caller used up the tokens their tier allows per minute for that model, so the gateway returned 429.',
      'Wait a minute and retry, or ask the AI CoE to raise the token quota for that model on the tier.',
      'AI CoE',
      'ai-quota'
    );
  }
  if (/resource_exhausted|resource exhausted|error-code-429/.test(blob)) {
    return make(
      'upstream_capacity',
      'Model provider out of capacity',
      'Vertex AI itself was temporarily out of capacity (RESOURCE_EXHAUSTED). This is not our governance.',
      'Retry shortly. Auto-routing to another model avoids it.',
      'Platform'
    );
  }
  if (/invalidapikeyforgivenresource|apiproductmismatch|not entitled|operation not allowed|nomatchingoperation/i.test(blob)) {
    return make(
      'not_entitled',
      'Model not allowed for this tier',
      'The caller\'s tier does not include that model, so the gateway refused the call.',
      'Use a model the tier allows, or ask the AI CoE to add it to the tier.',
      'AI CoE',
      'ai-auth'
    );
  }
  if (/invalidapikey|failedtoresolveapikey|apikeynotapproved|consumer key|api key/i.test(blob)) {
    return make(
      'api_key',
      'API key rejected',
      'The API key was missing, wrong, revoked, or not approved.',
      'Use a valid key from an approved app (Admin Console → Personas).',
      'Platform',
      'ai-auth'
    );
  }
  if (/caller identity|jwt|email claim|missinguseremail/.test(blob) || status === 401) {
    return make(
      'identity',
      'No caller identity',
      'The request carried no identity token with an email, which the gateway needs to attribute and meter the call.',
      'Send a JWT with an email claim (the console does this automatically).',
      'Platform'
    );
  }
  if (/oasvalidation|schema/.test(blob) || status === 400) {
    return make(
      'bad_request',
      'Request rejected as malformed',
      'The request body did not match the gateway\'s API schema.',
      'Fix the request shape; the error message names the offending field.',
      'Platform'
    );
  }
  if (/stream/.test(blob)) {
    return make('streaming', 'Streaming not supported', 'This gateway route does not support streaming responses.', 'Use the non-streaming endpoint.', 'Platform');
  }
  if (status >= 500) {
    return make('upstream_error', 'Upstream error', `The model provider or a backend failed (HTTP ${status}).`, 'Retry; if it persists, check the provider status.', 'Platform');
  }
  return make('unknown', 'Unclassified failure', `HTTP ${status || 'unknown'}${fault ? `, fault ${fault}` : ''}.`, 'Open the call in Cloud Logging for details.', 'Platform');
}

/** Filter, count and rank parsed call rows. Pure. */
export function buildCallLogSummary(rows, { outcome = 'all', limit = 10, includePrompts = false } = {}) {
  const all = rows.filter(Boolean);
  const counts = { total: all.length, ok: 0, blocked: 0, error: 0 };
  const reasons = new Map();
  for (const r of all) {
    counts[r.outcome] += 1;
    if (r.outcome !== 'ok') {
      const c = classifyFailure(r);
      const x = reasons.get(c.category) || { category: c.category, title: c.title, owner: c.owner, count: 0, lastSeen: null };
      x.count += 1;
      if (!x.lastSeen || (r.timestamp && r.timestamp > x.lastSeen)) x.lastSeen = r.timestamp;
      reasons.set(c.category, x);
    }
  }
  const wanted =
    outcome === 'errors' ? all.filter((r) => r.outcome !== 'ok') : outcome === 'all' ? all : all.filter((r) => r.outcome === outcome);
  const entries = wanted.slice(0, limit).map((r) => {
    const { prompt, ...rest } = r;
    const c = r.outcome === 'ok' ? null : classifyFailure(r);
    return {
      ...rest,
      ...(includePrompts && prompt ? { prompt } : {}),
      // The classified explanation, not the raw Model Armor string: the model
      // otherwise reads "PIMatchesFound" (prompt injection) as PII.
      ...(c ? { reason: c.title, explanation: c.explanation, owner: c.owner, errorMessage: undefined } : {}),
    };
  });
  return {
    counts,
    failureReasons: [...reasons.values()].sort((a, b) => b.count - a.count),
    matched: wanted.length,
    entries,
  };
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

export function createInsights({
  getToken,
  fetchImpl = (...args) => globalThis.fetch(...args),
  org = APIGEE_ORG,
  project = GCP_PROJECT_ID,
  now = () => Date.now(),
} = {}) {
  async function authed(url, init = {}) {
    const token = await getToken();
    if (!token) throw new Error('Could not obtain a GCP access token.');
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  }

  async function readRates(env) {
    const r = await authed(
      `https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/keyvaluemaps/ai-model-rates/entries/rate_card`
    ).catch(() => null);
    if (!r?.ok) return {};
    try {
      return typeof r.json?.value === 'string' ? JSON.parse(r.json.value) : r.json?.value || {};
    } catch {
      return {};
    }
  }

  async function listLogs(filter, maxEntries = 500) {
    const raw = [];
    let pageToken;
    while (raw.length < maxEntries) {
      const r = await authed('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        body: JSON.stringify({
          resourceNames: [`projects/${project}`],
          filter,
          orderBy: 'timestamp desc',
          pageSize: Math.min(1000, maxEntries - raw.length),
          pageToken,
        }),
      });
      if (!r.ok) throw new Error(`Cloud Logging query failed (HTTP ${r.status}).`);
      raw.push(...(r.json?.entries || []));
      pageToken = r.json?.nextPageToken;
      if (!pageToken) break;
    }
    return { raw, truncated: Boolean(pageToken) };
  }

  const sinceIso = (range) => new Date(now() - INSIGHT_RANGES[range] * 3600 * 1000).toISOString();

  /** AI Gateway calls, tokens and spend, grouped by user / model. */
  async function queryUsage({ env = 'prod', range = '24h', user = '', model = '', groupBy = 'user', limit = 10, scopeEmail = '' }) {
    const timeRange = statsTimeRange(INSIGHT_RANGES[range], new Date(now()));
    const who = effectiveUser(user, scopeEmail);
    const [stats, cache, rates] = await Promise.all([
      authed(usageStatsUrl({ org, env, timeRange })),
      authed(cacheStatsUrl({ org, env, timeRange })).catch(() => null),
      readRates(env),
    ]);
    if (!stats.ok) throw new Error(`Apigee Analytics returned HTTP ${stats.status}.`);
    const out = aggregateUsage(stats.json, rates, {
      user: who,
      model,
      groupBy: scopeEmail && groupBy !== 'model' ? 'model' : groupBy,
      limit,
      cacheJson: cache?.ok ? cache.json : null,
    });
    return { env, range, ...(who ? { user: who } : {}), ...(model ? { model } : {}), ...out, source: 'Apigee Analytics (ai-gateway-v1), priced at the ai-model-rates KVM' };
  }

  /** MCP tool traffic by server / persona / status, plus per-tool detail from the logs. */
  async function queryToolUsage({ env = 'prod', range = '24h', user = '', tool = '', limit = 10, scopeEmail = '' }) {
    const who = effectiveUser(user, scopeEmail);
    const timeRange = statsTimeRange(INSIGHT_RANGES[range], new Date(now()));
    const logRange = range === '1h' ? '24h' : range;
    const [stats, logs] = await Promise.all([
      authed(toolsStatsUrl({ org, env, apigeeTimeRange: timeRange })),
      listLogs(toolLogsFilter({ project, env, sinceIso: sinceIso(logRange) }), 1000).catch(() => null),
    ]);
    if (!stats.ok) throw new Error(`Apigee Analytics returned HTTP ${stats.status}.`);
    const agg = buildToolsAnalytics(stats.json, who ? { user: who } : {});
    const detail = logs ? buildToolLogs(logs.raw.map(parseToolLogEntry), { user: who, tool, limit }) : null;
    return {
      env,
      range,
      ...(who ? { user: who } : {}),
      kpis: agg.kpis,
      byServer: agg.byServer.slice(0, limit),
      byPersona: scopeEmail ? undefined : agg.byPersona.slice(0, limit),
      byStatus: agg.byStatus.slice(0, limit),
      ...(detail
        ? {
            byTool: detail.byTool.slice(0, limit),
            recentCalls: detail.entries.slice(0, Math.min(limit, 10)).map((e) => ({
              timestamp: e.timestamp,
              server: e.serverLabel,
              tool: e.tool,
              outcome: e.outcome,
              httpStatus: e.httpStatus,
              user: scopeEmail ? undefined : e.userLabel,
              errorMessage: e.errorMessage ? clip(e.errorMessage, 200) : undefined,
            })),
            logsWindow: logRange,
            logsTruncated: logs.truncated,
          }
        : { note: 'Per-tool detail unavailable (Cloud Logging query failed).' }),
    };
  }

  /** Recent AI Gateway calls from Cloud Logging, with a failure breakdown. */
  async function searchCallLogs({ env = 'prod', range = '24h', user = '', model = '', outcome = 'all', limit = 10, scopeEmail = '' }) {
    const who = effectiveUser(user, scopeEmail);
    const filter = callLogsFilter({ project, env, sinceIso: sinceIso(range), user: who, model });
    const { raw, truncated } = await listLogs(filter, 500);
    const rows = raw.map(parseCallEntry);
    // Prompts are only ever returned to the person who wrote them.
    const out = buildCallLogSummary(rows, { outcome, limit, includePrompts: Boolean(scopeEmail) });
    return { env, range, ...(who ? { user: who } : {}), ...(model ? { model } : {}), outcome, truncated, ...out };
  }

  /**
   * Explain one failure (by tracking id) or the most recent failures for a
   * user / model. Returns the classified reasons plus what to do about them.
   */
  async function explainFailure({ env = 'prod', range = '24h', user = '', model = '', trackingId = '', scopeEmail = '' }) {
    const who = effectiveUser(user, scopeEmail);
    const filter = callLogsFilter({ project, env, sinceIso: sinceIso(trackingId ? '30d' : range), user: who, model, trackingId });
    const { raw } = await listLogs(filter, trackingId ? 5 : 300);
    const rows = raw.map(parseCallEntry);
    const failed = rows.filter((r) => r.outcome !== 'ok');
    if (trackingId && rows.length === 0) {
      return { found: false, message: `No call with tracking id ${trackingId}${who ? ` for ${who}` : ''} in the last 30 days.` };
    }
    if (failed.length === 0) {
      return {
        found: false,
        callsChecked: rows.length,
        message: `No failed calls${who ? ` for ${who}` : ''}${model ? ` on ${model}` : ''} in the last ${range}.`,
      };
    }
    const byCategory = new Map();
    for (const r of failed) {
      const c = classifyFailure(r);
      const x = byCategory.get(c.category) || { ...c, count: 0, examples: [] };
      x.count += 1;
      if (x.examples.length < 3) {
        x.examples.push({
          timestamp: r.timestamp,
          trackingId: r.trackingId,
          status: r.status,
          model: r.model || r.requestedModel,
          ...(scopeEmail ? {} : { user: r.user }),
          // Raw Model Armor strings are already decoded into the explanation.
          ...(c.category.startsWith('model_armor') ? {} : { detail: r.errorMessage ? clip(r.errorMessage, 200) : r.faultName }),
        });
      }
      byCategory.set(c.category, x);
    }
    return {
      found: true,
      callsChecked: rows.length,
      failedCalls: failed.length,
      reasons: [...byCategory.values()].sort((a, b) => b.count - a.count),
    };
  }

  return { queryUsage, queryToolUsage, searchCallLogs, explainFailure };
}
