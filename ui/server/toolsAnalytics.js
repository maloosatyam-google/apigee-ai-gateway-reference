// Tools (MCP) analytics, shared by ui/server.js and the Vite dev middleware.
//
// Source: Apigee Analytics standard dimensions only (apiproxy, developer_app,
// developer_email, response_status_code, total_response_time), filtered to the MCP
// proxies. No proxy change is needed, so it covers the UI-managed `mcp` proxy as well
// as the repo-managed bigquery-mcp / servicenow-mcp. Which *tool* was called comes
// from Cloud Logging instead (see toolLogs.js): the JSON-RPC body is logged there.

export const MCP_PROXIES = ['mcp', 'bigquery-mcp', 'servicenow-mcp'];

// Capability-first names (what the server does, not its proxy name).
const SERVER_LABELS = {
  mcp: 'Enterprise APIs (Customer Service & Insights tools)',
  'bigquery-mcp': 'BigQuery analytics',
  'servicenow-mcp': 'ServiceNow records',
};

const isAbsent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';

/** Map an Apigee developer app name to the persona it represents. */
export function personaForApp(app) {
  if (isAbsent(app)) return { persona: 'No credential', key: 'none' };
  const admin = /^Unified Admin (.+) App$/i.exec(app);
  if (admin) return { persona: `Admin (${admin[1]})`, key: 'admin', handle: admin[1].toLowerCase() };
  if (/sales/i.test(app)) return { persona: 'Sales Agent', key: 'sales_agent' };
  if (/loans?/i.test(app)) return { persona: 'Loans Agent', key: 'loans_agent' };
  return { persona: app, key: 'other' };
}

/**
 * Classify an HTTP status the way the MCP proxies use them:
 * 2xx ok; 401/403 denied (no key / not entitled); 400 rejected (method not allowed,
 * malformed JSON-RPC); 429 throttled; anything else an error.
 */
export function classifyStatus(code) {
  const c = Number(code);
  if (c >= 200 && c < 300) return 'ok';
  if (c === 401 || c === 403) return 'denied';
  if (c === 400) return 'rejected';
  if (c === 429) return 'throttled';
  return 'error';
}

/**
 * Who a call belongs to, for the user filter. Admin apps are per user, so the app's
 * developer email is the person. The Sales / Loans apps are shared agent keys owned by
 * one demo developer, so they are reported as the agent persona, not that owner.
 */
export function identityFor(app, email) {
  const who = personaForApp(app);
  if (who.key === 'admin') {
    const mail = !isAbsent(email) ? String(email).toLowerCase() : `${who.handle}@(unknown)`;
    return { userKey: mail, userLabel: !isAbsent(email) ? String(email) : who.persona, persona: who.persona };
  }
  if (who.key === 'sales_agent' || who.key === 'loans_agent') {
    return { userKey: `persona:${who.key}`, userLabel: `${who.persona} (shared agent key)`, persona: who.persona };
  }
  if (who.key === 'none') return { userKey: 'none', userLabel: 'No credential', persona: who.persona };
  return { userKey: `app:${app}`, userLabel: String(app), persona: who.persona };
}

const metric = (dim, name) => Number(dim.metrics?.find((m) => m.name === name)?.values?.[0] || 0);

/**
 * Pure aggregation of an Apigee stats response for
 * dimensions apiproxy,developer_app,developer_email,response_status_code (or the older
 * three-dimension form without developer_email) with
 * select=sum(message_count),avg(total_response_time).
 * @param {any} statsJson
 * @param {{ handle?: string, user?: string }} [opts]
 *   handle: restrict to one admin user's app (User view).
 *   user:   restrict to one identity key from `users` (Admin view user filter).
 */
export function buildToolsAnalytics(statsJson, opts = {}) {
  const dims = statsJson?.environments?.[0]?.dimensions || [];
  const handle = opts.handle ? String(opts.handle).toLowerCase() : null;
  const userFilter = opts.user && opts.user !== 'all' ? String(opts.user).toLowerCase() : null;
  const users = new Map();

  const servers = new Map();
  const personas = new Map();
  const statuses = new Map();
  const totals = { calls: 0, ok: 0, denied: 0, rejected: 0, throttled: 0, error: 0, latencySum: 0 };

  for (const dim of dims) {
    const parts = dim.individualNames || String(dim.name || '').split(',');
    const [proxy, app, email, status] = parts.length >= 4 ? parts : [parts[0], parts[1], null, parts[2]];
    if (!MCP_PROXIES.includes(proxy)) continue;
    const calls = metric(dim, 'sum(message_count)');
    if (calls <= 0) continue;
    const who = personaForApp(app);
    if (handle && who.handle !== handle) continue;
    const id = identityFor(app, email);
    const u = users.get(id.userKey) || { key: id.userKey, label: id.userLabel, persona: id.persona, calls: 0 };
    u.calls += calls;
    users.set(id.userKey, u);
    if (userFilter && id.userKey.toLowerCase() !== userFilter) continue;
    const latency = metric(dim, 'avg(total_response_time)');
    const cls = classifyStatus(status);

    totals.calls += calls;
    totals[cls] += calls;
    totals.latencySum += latency * calls;

    const s = servers.get(proxy) || { proxy, label: SERVER_LABELS[proxy] || proxy, calls: 0, ok: 0, denied: 0, rejected: 0, throttled: 0, error: 0, latencySum: 0 };
    s.calls += calls; s[cls] += calls; s.latencySum += latency * calls;
    servers.set(proxy, s);

    const pKey = who.persona;
    const p = personas.get(pKey) || { persona: who.persona, key: who.key, calls: 0, ok: 0, denied: 0, rejected: 0, throttled: 0, error: 0, servers: new Set() };
    p.calls += calls; p[cls] += calls; p.servers.add(proxy);
    personas.set(pKey, p);

    const st = String(status);
    statuses.set(st, (statuses.get(st) || 0) + calls);
  }

  const finish = ({ latencySum, ...rest }) => ({
    ...rest,
    avgLatencyMs: rest.calls > 0 ? Math.round(latencySum / rest.calls) : null,
  });

  return {
    kpis: {
      totalCalls: totals.calls,
      successRate: totals.calls > 0 ? Math.round((totals.ok / totals.calls) * 1000) / 10 : null,
      okCalls: totals.ok,
      deniedCalls: totals.denied,
      rejectedCalls: totals.rejected,
      throttledCalls: totals.throttled,
      errorCalls: totals.error,
      avgLatencyMs: totals.calls > 0 ? Math.round(totals.latencySum / totals.calls) : null,
    },
    byServer: [...servers.values()].map(finish).sort((a, b) => b.calls - a.calls),
    byPersona: [...personas.values()]
      .map((p) => ({ ...p, servers: [...p.servers].sort() }))
      .sort((a, b) => b.calls - a.calls),
    users: [...users.values()].sort((a, b) => b.calls - a.calls),
    byStatus: [...statuses.entries()]
      .map(([status, calls]) => ({ status, calls, class: classifyStatus(status) }))
      .sort((a, b) => b.calls - a.calls),
  };
}

/** Build the Apigee stats URL for the MCP proxies. */
export function toolsStatsUrl({ org, env, apigeeTimeRange }) {
  const filter = encodeURIComponent(`(apiproxy in ${MCP_PROXIES.map((p) => `'${p}'`).join(',')})`);
  return `https://apigee.googleapis.com/v1/organizations/${org}/environments/${env}/stats/apiproxy,developer_app,developer_email,response_status_code?select=sum(message_count),avg(total_response_time)&timeRange=${encodeURIComponent(apigeeTimeRange)}&filter=${filter}`;
}
