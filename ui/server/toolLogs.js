// Tool-call logs for the Tools Gateway analytics section, shared by ui/server.js and
// the Vite dev middleware.
//
// Source: Cloud Logging entries written by ML-CloudLogging in the MCP proxies. Each
// entry carries the raw JSON-RPC request and response, so the method and the tool
// name (params.name) are known per call. Apigee Analytics can't tell you the tool:
// the MCP proxies have no DataCapture for it.
//
// Caller attribution: an entry names the caller only if the proxy's logging policy
// records developer.email / developer.app.name (added to the repo-managed proxies).
// Entries without it are counted as "unattributed" and are excluded from a
// per-user view rather than guessed.

import { MCP_PROXIES, identityFor } from './toolsAnalytics.js';
import { GCP_PROJECT_ID } from './deployConfig.js';

const SERVER_LABELS = {
  mcp: 'Enterprise APIs',
  'bigquery-mcp': 'BigQuery',
  'servicenow-mcp': 'ServiceNow',
};

export const LOG_WINDOWS = { '24h': 24, '7d': 168, '30d': 720 };
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const USER_KEY_RE = /^(persona:(sales_agent|loans_agent)|none|app:[A-Za-z0-9 ._-]{1,80})$/;
const MAX_TEXT = 4000;

const clip = (s, n = MAX_TEXT) => {
  const str = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  return str.length > n ? `${str.slice(0, n)}… (${str.length - n} more chars)` : str;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const absent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';

/** Parse a JSON-RPC body; tolerates streamable-HTTP SSE framing ("data: {...}"). */
export function parseJsonRpc(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* maybe SSE */ }
  const data = trimmed
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Faults leave responseStatusCode empty in the log; infer the code from the fault. */
function statusFromFault(faultName) {
  if (!faultName) return null;
  if (/Quota|SpikeArrest|RateLimit/i.test(faultName)) return 429;
  if (/ApiKey|Unauthori|InvalidAccessToken|Token/i.test(faultName)) return 401;
  if (/RaiseFault|MethodNotAllowed/i.test(faultName)) return 400;
  return null;
}

/**
 * Outcome of one call:
 *  ok | tool_error (200, result.isError) | rpc_error (JSON-RPC error object)
 *  denied (401/403) | rejected (400/404/405) | throttled (429) | error
 */
export function classifyToolCall(httpStatus, response) {
  const s = Number(httpStatus);
  // A 403 carrying a JSON-RPC tool result passed the gateway: the tool's REST proxy refused it
  // on a business rule (e.g. REFUND_LIMIT), which is a tool error, not an access denial.
  if (s === 403 && response?.result?.isError === true) return 'tool_error';
  if (s === 401 || s === 403) return 'denied';
  if (s === 429) return 'throttled';
  if (s === 400 || s === 404 || s === 405) return 'rejected';
  if (s >= 200 && s < 300) {
    if (response?.error) return 'rpc_error';
    if (response?.result?.isError === true) return 'tool_error';
    return 'ok';
  }
  return 'error';
}

/** One Cloud Logging entry -> one row for the UI. Returns null for non-MCP entries. */
export function parseToolLogEntry(entry) {
  const p = entry?.jsonPayload || {};
  const server = p.apiProxyName;
  if (!MCP_PROXIES.includes(server)) return null;
  const req = parseJsonRpc(p.requestContent);
  const res = parseJsonRpc(p.responseContent);
  const method = typeof req?.method === 'string' ? req.method : '';
  const tool = method === 'tools/call' && typeof req?.params?.name === 'string' ? req.params.name : '';
  const httpStatus = Number(p.responseStatusCode) || statusFromFault(p.faultName) || null;
  const sent = num(p.targetSentStartTimeEpoch);
  const recv = num(p.targetReceivedEndTimeEpoch);
  const app = absent(p.developerApp) ? '' : p.developerApp;
  const email = absent(p.developerEmail) ? '' : p.developerEmail;
  const id = app ? identityFor(app, email) : null;
  const rpcErr = res?.error?.message || '';
  const toolErrText =
    res?.result?.isError === true ? clip(res.result.content?.map?.((c) => c?.text).filter(Boolean).join(' ') || '', 300) : '';

  return {
    timestamp: entry.timestamp || null,
    trackingId: p.trackingId || '',
    env: p.environmentName || '',
    server,
    serverLabel: SERVER_LABELS[server] || server,
    method: method || (p.requestVerb ? `HTTP ${p.requestVerb}` : ''),
    tool,
    arguments: tool ? clip(req?.params?.arguments ?? {}, 600) : '',
    httpStatus,
    outcome: httpStatus ? classifyToolCall(httpStatus, res) : p.faultName ? 'error' : 'error',
    faultName: p.faultName || '',
    errorMessage: rpcErr || toolErrText || p.errorMessage || '',
    backendMs: sent && recv >= sent ? recv - sent : null,
    attributed: Boolean(id),
    userKey: id?.userKey || '',
    userLabel: id?.userLabel || '',
    persona: id?.persona || '',
    request: clip(p.requestContent || ''),
    response: clip(p.responseContent || ''),
  };
}

/**
 * Filter + aggregate parsed rows.
 * @param {ReturnType<typeof parseToolLogEntry>[]} rows
 * @param {{ user?: string, tool?: string, server?: string, includeProtocol?: boolean, limit?: number }} opts
 */
export function buildToolLogs(rows, opts = {}) {
  const user = opts.user && opts.user !== 'all' ? String(opts.user).toLowerCase() : null;
  const all = rows.filter(Boolean);
  const scoped = all.filter((r) => (!opts.server || r.server === opts.server));
  const userScoped = user ? scoped.filter((r) => r.attributed && r.userKey.toLowerCase() === user) : scoped;
  const unattributed = user ? scoped.filter((r) => !r.attributed).length : 0;

  // "Tools used": tools/call only, independent of the tool filter so the list stays complete.
  const tools = new Map();
  for (const r of userScoped) {
    if (!r.tool) continue;
    const k = `${r.server}::${r.tool}`;
    const t = tools.get(k) || { tool: r.tool, server: r.server, serverLabel: r.serverLabel, calls: 0, ok: 0, failed: 0, blocked: 0, msSum: 0, msN: 0, lastUsed: null };
    t.calls += 1;
    if (r.outcome === 'ok') t.ok += 1;
    else if (r.outcome === 'denied' || r.outcome === 'throttled' || r.outcome === 'rejected') t.blocked += 1;
    else t.failed += 1;
    if (r.backendMs != null) { t.msSum += r.backendMs; t.msN += 1; }
    if (!t.lastUsed || (r.timestamp && r.timestamp > t.lastUsed)) t.lastUsed = r.timestamp;
    tools.set(k, t);
  }
  const byTool = [...tools.values()]
    .map(({ msSum, msN, ...t }) => ({ ...t, avgBackendMs: msN ? Math.round(msSum / msN) : null }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  let entries = userScoped;
  if (!opts.includeProtocol) entries = entries.filter((r) => r.tool);
  if (opts.tool) entries = entries.filter((r) => r.tool === opts.tool);
  const limit = opts.limit ?? 200;

  return {
    scanned: all.length,
    matched: entries.length,
    unattributed,
    attributedShare: all.length ? Math.round((all.filter((r) => r.attributed).length / all.length) * 100) : 0,
    byTool,
    entries: entries.slice(0, limit),
  };
}

/** Cloud Logging filter for the MCP proxies in one env since a time. Inputs are pre-validated. */
export function toolLogsFilter({ project, env, sinceIso }) {
  const proxies = MCP_PROXIES.map((p) => `"${p}"`).join(' OR ');
  return [
    `logName="projects/${project}/logs/apigee"`,
    `timestamp>="${sinceIso}"`,
    `jsonPayload.apiProxyName=(${proxies})`,
    `jsonPayload.environmentName="${env}"`,
  ].join(' AND ');
}

/**
 * Validate query params. Returns { ok: true, value } or { ok: false, error }.
 * Everything that reaches the Cloud Logging filter is allowlisted.
 */
export function parseToolLogsQuery(searchParams) {
  const env = searchParams.get('env') === 'dev' ? 'dev' : 'prod';
  const window = searchParams.get('window') || '24h';
  if (!Object.prototype.hasOwnProperty.call(LOG_WINDOWS, window)) return { ok: false, error: 'Invalid window parameter' };
  const server = searchParams.get('server') || '';
  if (server && !MCP_PROXIES.includes(server)) return { ok: false, error: 'Invalid server parameter' };
  const tool = searchParams.get('tool') || '';
  if (tool && !/^[A-Za-z0-9_.:-]{1,100}$/.test(tool)) return { ok: false, error: 'Invalid tool parameter' };
  const user = (searchParams.get('user') || '').trim();
  if (user && user !== 'all' && !EMAIL_RE.test(user) && !USER_KEY_RE.test(user)) {
    return { ok: false, error: 'Invalid user parameter' };
  }
  return {
    ok: true,
    value: { env, window, server, tool, user, includeProtocol: searchParams.get('protocol') === '1' },
  };
}

/** GET /api/logs/tools?env&window&server&tool&user&protocol=1 */
export async function handleToolLogs(req, res, { parsedUrl, getToken, project = GCP_PROJECT_ID, fetchImpl = fetch }) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const q = parseToolLogsQuery(parsedUrl.searchParams);
  if (!q.ok) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: q.error }));
    return;
  }
  const token = await getToken();
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
    return;
  }
  const { env, window, server, tool, user, includeProtocol } = q.value;
  const sinceIso = new Date(Date.now() - LOG_WINDOWS[window] * 3600 * 1000).toISOString();
  const filter = toolLogsFilter({ project, env, sinceIso });

  try {
    const raw = [];
    let pageToken;
    // Up to 3 pages of 1000: enough for demo traffic, bounded for latency.
    for (let i = 0; i < 3; i += 1) {
      const r = await fetchImpl('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNames: [`projects/${project}`], filter, orderBy: 'timestamp desc', pageSize: 1000, pageToken }),
      });
      if (!r.ok) {
        const detail = await r.text();
        res.statusCode = r.status;
        res.end(JSON.stringify({ error: 'Cloud Logging query failed', detail: detail.slice(0, 500) }));
        return;
      }
      const data = await r.json();
      raw.push(...(data.entries || []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    const out = buildToolLogs(raw.map(parseToolLogEntry), { user, tool, server, includeProtocol });
    const consoleUrl =
      `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(filter)}?project=${project}`;
    res.end(JSON.stringify({ status: 'ok', env, window, truncated: Boolean(pageToken), consoleUrl, ...out }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
