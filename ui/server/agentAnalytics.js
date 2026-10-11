// Agent analytics: the Agent Showcase agents' history, shared by ui/server.js and the Vite dev
// middleware.
//
// Sources, both already recorded by Apigee for every call; no proxy change is needed:
//   - Apigee Analytics (stats API). The agent service is the only caller of the gateway that
//     uses Python HTTP clients: its model calls carry User-Agent python-httpx/*, and ADK's MCP
//     client sends google-adk/*. The standard `useragent` dimension therefore picks out agent
//     traffic from UI, curl and playground traffic, all the way back to the first agent run.
//     Which agent made the call comes from the proxy (model calls: llm-passthrough-v1 is the
//     agent without AI governance, ai-gateway-v1 the governed agent) or from the app whose key
//     was used (MCP calls: the Support & Sales app is the governed agent, a Unified Admin app
//     the baseline agent).
//   - Cloud Logging, for which MCP tool was called. Apigee Analytics has no tool dimension;
//     the MCP proxies log the JSON-RPC body. ADK's MCP client adds "_meta" to the params of
//     every tools/call and the UI's MCP playground does not, so "_meta" marks agent tool calls.
//
// Cost is priced from the ai-model-rates KVM rate card (USD per 1M tokens) for both agents, the
// same card the Agent Showcase uses. Semantic-cache hits are not billed.

import { MCP_PROXIES } from './toolsAnalytics.js';
import { parseToolLogEntry } from './toolLogs.js';
import { GCP_PROJECT_ID, APIGEE_ORG } from './deployConfig.js';

export const AGENT_SIDES = ['baseline', 'governed'];
export const LLM_PROXIES = { 'llm-passthrough-v1': 'baseline', 'ai-gateway-v1': 'governed' };
export const AGENT_RANGES = { '24h': { hours: 24, timeUnit: 'hour' }, '7d': { hours: 168, timeUnit: 'day' }, '30d': { hours: 720, timeUnit: 'day' } };

const AGENT_UA_RE = /^(python-httpx|google-adk|agent-showcase)\b/i;
// Both agents call the same `mcp` proxy; the key decides the product and so the tools. Label it
// by the product each agent's key maps to, not by the proxy.
const SERVER_LABELS = {
  baseline: {
    mcp: 'Business tools: all 12, unrestricted',
    'bigquery-mcp': 'BigQuery analytics data',
    'servicenow-mcp': 'ServiceNow IT records',
  },
  governed: {
    mcp: 'Business tools: 7 authorized for customer service',
    'bigquery-mcp': 'BigQuery analytics data',
    'servicenow-mcp': 'ServiceNow IT records',
  },
};

// Tools on the governed agent's key: the Customer Service Tools MCP product
// (apigee/products/customer_service_tools_mcp.json; a unit test keeps this list in sync).
// The baseline agent's Enterprise Tools MCP key, BigQuery and ServiceNow reach every tool.
export const GOVERNED_TOOLS = ['searchCustomers', 'getCustomer', 'listCustomerOrders', 'getOrderStatus', 'getProductPrice', 'createSupportCase', 'issueRefund'];
const SERVER_ORDER = ['mcp', 'bigquery-mcp', 'servicenow-mcp'];
const NO_MODEL_ORDER = ['Reused answer (cache)', 'Blocked before a model'];

/** Whether an agent's key can reach a tool (server + tool name). */
export function toolAvailable(side, server, tool) {
  return side === 'baseline' || (server === 'mcp' && GOVERNED_TOOLS.includes(tool));
}

/** Whether an agent's key can reach an MCP server. */
export function serverAvailable(side, proxy) {
  return side === 'baseline' || proxy === 'mcp';
}

/**
 * Give both agents the same rows in the same order, so the two columns line up: every model,
 * outcome, MCP server and tool either agent has appears on both sides (zero, or "not on this
 * key" when that agent's key cannot reach it). Order: by both agents' calls combined.
 */
export function alignSides(out, rates) {
  const [b, g] = [out.baseline, out.governed];
  const total = (list, key) => {
    const m = new Map();
    for (const side of [b, g]) for (const x of list(side)) m.set(key(x), (m.get(key(x)) || 0) + (x.calls || 0));
    return m;
  };

  // Models: real models by combined calls, then the no-model buckets.
  const modelCalls = total((x) => x.llm.models, (x) => x.model);
  const models = [...modelCalls.keys()].sort((x, y) => {
    const nx = NO_MODEL_ORDER.indexOf(x);
    const ny = NO_MODEL_ORDER.indexOf(y);
    if (nx !== ny) return nx - ny; // -1 (real model) first
    return modelCalls.get(y) - modelCalls.get(x) || x.localeCompare(y);
  });
  // Outcome statuses: by HTTP code.
  const statuses = [...new Set([b, g].flatMap((x) => x.llm.statuses.map((st) => st.status)))].sort((x, y) => Number(x) - Number(y));
  // Servers: fixed order, only those either agent called.
  const serverSet = new Set([b, g].flatMap((x) => x.mcp.servers.map((sv) => sv.proxy)));
  const servers = [...SERVER_ORDER.filter((x) => serverSet.has(x)), ...[...serverSet].filter((x) => !SERVER_ORDER.includes(x)).sort()];
  // Tools: by combined calls, then name.
  const toolCalls = total((x) => x.tools, (x) => `${x.server}::${x.tool}`);
  const tools = [...toolCalls.keys()].sort((x, y) => toolCalls.get(y) - toolCalls.get(x) || x.split('::')[1].localeCompare(y.split('::')[1]));

  const aligned = {};
  for (const side of AGENT_SIDES) {
    const d = out[side];
    const byModel = new Map(d.llm.models.map((m) => [m.model, m]));
    const byStatus = new Map(d.llm.statuses.map((st) => [st.status, st]));
    const byServer = new Map(d.mcp.servers.map((sv) => [sv.proxy, sv]));
    const byTool = new Map(d.tools.map((t) => [`${t.server}::${t.tool}`, t]));
    aligned[side] = {
      ...d,
      llm: {
        ...d.llm,
        models: models.map((model) => byModel.get(model) || {
          model, noModel: NO_MODEL_ORDER.includes(model), calls: 0, cached: 0, failed: 0, input: 0, output: 0,
          rate: rateFor(model, rates), costUsd: NO_MODEL_ORDER.includes(model) ? null : 0,
        }),
        statuses: statuses.map((status) => byStatus.get(status) || { status, calls: 0, label: STATUS_LABELS[side][status] || `HTTP ${status}` }),
      },
      mcp: {
        ...d.mcp,
        servers: servers.map((proxy) => ({
          ...(byServer.get(proxy) || { proxy, label: mcpServerLabel(side, proxy), calls: 0, ok: 0, denied: 0, limited: 0, rejected: 0, error: 0, avgLatencyMs: null }),
          available: serverAvailable(side, proxy),
        })),
      },
      tools: tools.map((k) => {
        const [server, tool] = k.split('::');
        return {
          ...(byTool.get(k) || { tool, server, serverLabel: mcpServerLabel(side, server), calls: 0, ok: 0, blocked: 0, failed: 0, avgBackendMs: null, lastUsed: null }),
          available: toolAvailable(side, server, tool),
        };
      }),
    };
  }
  return aligned;
}

/** Display name of an MCP server for one agent. */
export function mcpServerLabel(side, proxy) {
  return SERVER_LABELS[side]?.[proxy] || proxy;
}

const absent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';

/** True when a User-Agent belongs to the agent service. */
export function isAgentUserAgent(ua) {
  return !absent(ua) && AGENT_UA_RE.test(String(ua));
}

/** Which agent made an MCP call, from the app whose key it used; null if no key was checked. */
export function mcpSideForApp(app) {
  if (absent(app)) return null;
  if (/^Unified Sales App$/i.test(app) || /sales/i.test(app)) return 'governed';
  if (/^Unified Admin .+ App$/i.test(app)) return 'baseline';
  return null;
}

/**
 * An agent MCP call with no app that the gateway refused on a server only the baseline agent's
 * key reaches. The governed agent connects to BigQuery and ServiceNow too; Apigee rejects its key
 * there (401 InvalidApiKeyForGivenResource) before resolving an app, so Analytics records no app.
 * The baseline agent's key is valid there and initialize needs no key, so these are the governed
 * agent's refused tools/list calls.
 */
export function isRefusedByKey(proxy, status) {
  return (proxy === 'bigquery-mcp' || proxy === 'servicenow-mcp') && (Number(status) === 401 || Number(status) === 403);
}

/** Rate-card lookup tolerant of version suffixes (claude-haiku-5-5). */
export function rateFor(model, rates) {
  if (!rates || absent(model)) return null;
  for (const c of [model, String(model).split('@')[0]]) {
    const r = rates[c];
    if (r && Number.isFinite(Number(r.input)) && Number.isFinite(Number(r.output))) return { input: Number(r.input), output: Number(r.output) };
  }
  return null;
}

/** Model-call outcome from the HTTP status (and cache status for a 200). */
export function llmOutcome(status, cacheStatus) {
  const s = Number(status);
  if (s >= 200 && s < 300) return String(cacheStatus).toUpperCase() === 'HIT' ? 'cached' : 'ok';
  if (s === 429) return 'limited';
  if (s === 400 || s === 401 || s === 403) return 'blocked';
  return 'error';
}

/** MCP-call outcome from the HTTP status. */
export function mcpOutcome(status) {
  const s = Number(status);
  if (s >= 200 && s < 300) return 'ok';
  if (s === 401 || s === 403) return 'denied';
  if (s === 429) return 'limited';
  if (s === 400 || s === 404 || s === 405) return 'rejected';
  return 'error';
}

const STATUS_LABELS = {
  baseline: { 400: 'Rejected by the model provider', 403: 'Refused by the model provider', 429: 'Rate limited by the model provider', 504: 'Model call timed out' },
  governed: { 400: 'Blocked: prompt attack or unsafe request', 403: 'Blocked: not authorized', 429: 'Stopped: usage limit reached', 504: 'Model call timed out' },
};

/** Every metric of one stats dimension as [{ ts, value }], for timeUnit and plain responses. */
function metricSeries(dim, name) {
  const m = dim.metrics?.find((x) => x.name === name);
  if (!m) return [];
  return (m.values || []).map((v) => (typeof v === 'object' && v !== null ? { ts: Number(v.timestamp) || 0, value: Number(v.value) || 0 } : { ts: 0, value: Number(v) || 0 }));
}

function dimParts(dim, n) {
  const parts = dim.individualNames || String(dim.name || '').split(',');
  return parts.length >= n ? parts : [...parts, ...Array(n - parts.length).fill('(not set)')];
}

const emptyLlm = () => ({ calls: 0, ok: 0, cached: 0, blocked: 0, limited: 0, error: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latencySum: 0, models: new Map(), statuses: new Map() });
const emptyMcp = () => ({ calls: 0, ok: 0, denied: 0, limited: 0, rejected: 0, error: 0, latencySum: 0, servers: new Map() });
const emptyBucket = () => ({ llmCalls: 0, mcpCalls: 0, tokens: 0, costUsd: 0 });

/**
 * Pure aggregation.
 * @param {{ llmStats: any, mcpStats: any, rates: Record<string, any> | null, toolRows?: any[] }} input
 *   llmStats: stats/apiproxy,useragent,dc_model_name,response_status_code,dc_cache_status
 *             select=sum(message_count),sum(dc_prompt_token_count),sum(dc_candidates_token_count),avg(total_response_time)
 *   mcpStats: stats/apiproxy,useragent,developer_app,response_status_code
 *             select=sum(message_count),avg(total_response_time)
 *   toolRows: parseToolLogEntry() rows for agent tools/call entries.
 */
export function buildAgentAnalytics({ llmStats, mcpStats, rates, toolRows = [] }) {
  const sides = Object.fromEntries(AGENT_SIDES.map((s) => [s, { llm: emptyLlm(), mcp: emptyMcp(), tools: new Map() }]));
  const series = new Map();
  const bucket = (ts) => {
    const b = series.get(ts) || { ts, baseline: emptyBucket(), governed: emptyBucket() };
    series.set(ts, b);
    return b;
  };
  const unpriced = new Set();
  let handshakes = 0;

  for (const dim of llmStats?.environments?.[0]?.dimensions || []) {
    const [proxy, ua, rawModel, status, cacheStatus] = dimParts(dim, 5);
    const side = LLM_PROXIES[proxy];
    if (!side || !isAgentUserAgent(ua)) continue;
    const counts = metricSeries(dim, 'sum(message_count)');
    const input = metricSeries(dim, 'sum(dc_prompt_token_count)');
    const output = metricSeries(dim, 'sum(dc_candidates_token_count)');
    const latency = metricSeries(dim, 'avg(total_response_time)');
    const outcome = llmOutcome(status, cacheStatus);
    const model = absent(rawModel) ? (outcome === 'cached' ? 'Reused answer (cache)' : 'Blocked before a model') : rawModel;
    const rate = outcome === 'ok' ? rateFor(rawModel, rates) : null;
    if (outcome === 'ok' && !rate && !absent(rawModel)) unpriced.add(rawModel);
    const L = sides[side].llm;

    counts.forEach((c, i) => {
      if (c.value <= 0) return;
      const inTok = input[i]?.value || 0;
      const outTok = output[i]?.value || 0;
      const cost = rate ? (inTok * rate.input + outTok * rate.output) / 1e6 : 0;
      L.calls += c.value;
      L[outcome] += c.value;
      L.inputTokens += inTok;
      L.outputTokens += outTok;
      L.costUsd += cost;
      L.latencySum += (latency[i]?.value || 0) * c.value;

      const m = L.models.get(model) || { model, noModel: absent(rawModel), calls: 0, cached: 0, failed: 0, input: 0, output: 0, rate: rateFor(rawModel, rates), costUsd: 0 };
      m.calls += c.value;
      if (outcome === 'cached') m.cached += c.value;
      if (outcome !== 'ok' && outcome !== 'cached') m.failed += c.value;
      m.input += inTok;
      m.output += outTok;
      m.costUsd += cost;
      L.models.set(model, m);

      if (outcome !== 'ok' && outcome !== 'cached') {
        const st = String(status);
        L.statuses.set(st, (L.statuses.get(st) || 0) + c.value);
      }
      const b = bucket(c.ts)[side];
      b.llmCalls += c.value;
      b.tokens += inTok + outTok;
      b.costUsd += cost;
    });
  }

  for (const dim of mcpStats?.environments?.[0]?.dimensions || []) {
    const [proxy, ua, app, status] = dimParts(dim, 4);
    if (!MCP_PROXIES.includes(proxy) || !isAgentUserAgent(ua)) continue;
    const counts = metricSeries(dim, 'sum(message_count)');
    const latency = metricSeries(dim, 'avg(total_response_time)');
    const side = mcpSideForApp(app) || (isRefusedByKey(proxy, status) ? 'governed' : null);
    if (!side) {
      // initialize / notifications/initialized: the MCP proxies accept the handshake without a key.
      handshakes += counts.reduce((a, c) => a + c.value, 0);
      continue;
    }
    const cls = mcpOutcome(status);
    const M = sides[side].mcp;
    counts.forEach((c, i) => {
      if (c.value <= 0) return;
      const lat = (latency[i]?.value || 0) * c.value;
      M.calls += c.value;
      M[cls] += c.value;
      M.latencySum += lat;
      const s = M.servers.get(proxy) || { proxy, label: mcpServerLabel(side, proxy), calls: 0, ok: 0, denied: 0, limited: 0, rejected: 0, error: 0, latencySum: 0 };
      s.calls += c.value;
      s[cls] += c.value;
      s.latencySum += lat;
      M.servers.set(proxy, s);
      bucket(c.ts)[side].mcpCalls += c.value;
    });
  }

  for (const r of toolRows) {
    if (!r || !r.tool) continue;
    const s = mcpSideForApp(r.appName);
    if (!s) continue;
    const k = `${r.server}::${r.tool}`;
    const t = sides[s].tools.get(k) || { tool: r.tool, server: r.server, serverLabel: mcpServerLabel(s, r.server), calls: 0, ok: 0, blocked: 0, failed: 0, msSum: 0, msN: 0, lastUsed: null };
    t.calls += 1;
    if (r.outcome === 'ok') t.ok += 1;
    else if (r.outcome === 'denied' || r.outcome === 'throttled' || r.outcome === 'rejected' || r.outcome === 'tool_error') t.blocked += 1;
    else t.failed += 1;
    if (r.backendMs != null) { t.msSum += r.backendMs; t.msN += 1; }
    if (!t.lastUsed || (r.timestamp && r.timestamp > t.lastUsed)) t.lastUsed = r.timestamp;
    sides[s].tools.set(k, t);
  }

  const avg = (sum, n) => (n > 0 ? Math.round(sum / n) : null);
  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  const out = {};
  for (const s of AGENT_SIDES) {
    const { llm: L, mcp: M, tools } = sides[s];
    out[s] = {
      llm: {
        calls: L.calls, ok: L.ok, cached: L.cached, blocked: L.blocked, limited: L.limited, error: L.error,
        inputTokens: L.inputTokens, outputTokens: L.outputTokens, costUsd: round6(L.costUsd),
        avgLatencyMs: avg(L.latencySum, L.calls),
        models: [...L.models.values()].map((m) => ({ ...m, costUsd: m.noModel ? null : round6(m.costUsd) })).sort((a, b) => b.calls - a.calls),
        statuses: [...L.statuses.entries()]
          .map(([status, calls]) => ({ status, calls, label: STATUS_LABELS[s][status] || `HTTP ${status}` }))
          .sort((a, b) => b.calls - a.calls),
      },
      mcp: {
        calls: M.calls, ok: M.ok, denied: M.denied, limited: M.limited, rejected: M.rejected, error: M.error,
        avgLatencyMs: avg(M.latencySum, M.calls),
        servers: [...M.servers.values()].map(({ latencySum, ...x }) => ({ ...x, avgLatencyMs: avg(latencySum, x.calls) })).sort((a, b) => b.calls - a.calls),
      },
      tools: [...tools.values()]
        .map(({ msSum, msN, ...t }) => ({ ...t, avgBackendMs: avg(msSum, msN) }))
        .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
    };
  }
  return {
    sides: alignSides(out, rates),
    handshakes,
    series: [...series.values()]
      .filter((b) => b.ts > 0)
      .map((b) => ({ ...b, baseline: { ...b.baseline, costUsd: round6(b.baseline.costUsd) }, governed: { ...b.governed, costUsd: round6(b.governed.costUsd) } }))
      .sort((a, b) => a.ts - b.ts),
    unpriced: [...unpriced].sort(),
  };
}

/** Apigee stats time range "MM/DD/YYYY HH:MM~MM/DD/YYYY HH:MM" (UTC) ending now. */
export function statsTimeRange(hours, now = new Date()) {
  const start = new Date(now.getTime() - hours * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${fmt(start)}~${fmt(now)}`;
}

/** The two Apigee stats URLs. */
export function agentStatsUrls({ org, env, timeRange, timeUnit }) {
  const base = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/stats`;
  const q = (select, proxies) =>
    `?select=${select}&timeRange=${encodeURIComponent(timeRange)}&timeUnit=${timeUnit}` +
    `&filter=${encodeURIComponent(`(apiproxy in ${proxies.map((p) => `'${p}'`).join(',')})`)}`;
  return {
    llm: `${base}/apiproxy,useragent,dc_model_name,response_status_code,dc_cache_status` +
      q('sum(message_count),sum(dc_prompt_token_count),sum(dc_candidates_token_count),avg(total_response_time)', Object.keys(LLM_PROXIES)),
    mcp: `${base}/apiproxy,useragent,developer_app,response_status_code` + q('sum(message_count),avg(total_response_time)', MCP_PROXIES),
  };
}

/** Cloud Logging filter for agent tool calls (tools/call with ADK's "_meta"). Inputs are pre-validated. */
export function agentToolsFilter({ project, env, sinceIso }) {
  return [
    `logName="projects/${project}/logs/apigee"`,
    `timestamp>="${sinceIso}"`,
    `jsonPayload.apiProxyName=(${MCP_PROXIES.map((p) => `"${p}"`).join(' OR ')})`,
    `jsonPayload.environmentName="${env}"`,
    'jsonPayload.requestContent:"tools/call"',
    'jsonPayload.requestContent:"_meta"',
  ].join(' AND ');
}

/** parseToolLogEntry plus the raw app name, which decides the agent. */
export function parseAgentToolEntry(entry) {
  const row = parseToolLogEntry(entry);
  if (!row) return null;
  const app = entry?.jsonPayload?.developerApp;
  return { ...row, appName: absent(app) ? '' : String(app) };
}

/** GET /api/analytics/agent-stats?env=prod|dev&timeRange=24h|7d|30d */
export async function handleAgentAnalytics(req, res, { parsedUrl, getToken, org = APIGEE_ORG, project = GCP_PROJECT_ID, fetchImpl = fetch, now = () => new Date() }) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const env = parsedUrl.searchParams.get('env') === 'dev' ? 'dev' : 'prod';
  const timeRange = parsedUrl.searchParams.get('timeRange') || '7d';
  const range = AGENT_RANGES[timeRange];
  if (!range) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid timeRange parameter' }));
    return;
  }
  const token = await getToken();
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
    return;
  }
  const auth = { Authorization: `Bearer ${token}` };
  const t = now();
  const urls = agentStatsUrls({ org, env, timeRange: statsTimeRange(range.hours, t), timeUnit: range.timeUnit });
  const sinceIso = new Date(t.getTime() - range.hours * 3600 * 1000).toISOString();
  const filter = agentToolsFilter({ project, env, sinceIso });

  async function toolEntries() {
    const raw = [];
    let pageToken;
    for (let i = 0; i < 3; i += 1) {
      const r = await fetchImpl('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNames: [`projects/${project}`], filter, orderBy: 'timestamp desc', pageSize: 1000, pageToken }),
      });
      if (!r.ok) return { rows: [], error: `Cloud Logging returned ${r.status}`, truncated: false };
      const data = await r.json();
      raw.push(...(data.entries || []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return { rows: raw.map(parseAgentToolEntry).filter(Boolean), error: null, truncated: Boolean(pageToken) };
  }

  try {
    const [llmRes, mcpRes, kvmRes, tools] = await Promise.all([
      fetchImpl(urls.llm, { headers: auth }),
      fetchImpl(urls.mcp, { headers: auth }),
      fetchImpl(`https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/keyvaluemaps/ai-model-rates/entries/rate_card`, { headers: auth }).catch(() => null),
      toolEntries().catch((err) => ({ rows: [], error: err.message, truncated: false })),
    ]);
    if (!llmRes.ok || !mcpRes.ok) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Apigee stats returned ${llmRes.ok ? mcpRes.status : llmRes.status}` }));
      return;
    }
    let rates = null;
    let ratesError = null;
    if (kvmRes && kvmRes.ok) {
      try {
        const kvm = await kvmRes.json();
        rates = typeof kvm.value === 'string' ? JSON.parse(kvm.value) : kvm.value || null;
      } catch {
        ratesError = 'rate card is not valid JSON';
      }
    } else {
      ratesError = `rate card returned ${kvmRes ? kvmRes.status : 'no response'}`;
    }
    const out = buildAgentAnalytics({ llmStats: await llmRes.json(), mcpStats: await mcpRes.json(), rates, toolRows: tools.rows });
    res.end(JSON.stringify({
      env, timeRange, timeUnit: range.timeUnit, since: sinceIso, until: t.toISOString(),
      ratesError, toolsError: tools.error, toolsTruncated: tools.truncated,
      toolsConsoleUrl: `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(filter)}?project=${project}`,
      ...out,
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
