import React, { useEffect, useMemo, useState } from 'react';
import {
  Info, Wrench, ShieldCheck, ShieldX, Ban, Timer, Server, Users, User, ScrollText,
  ExternalLink, ChevronDown, ChevronRight, Hammer, RefreshCw,
} from 'lucide-react';
import {
  fetchToolsAnalytics, ToolsAnalyticsResponse, fetchToolLogs, ToolLogsResponse, ToolCallOutcome,
} from '../services/api';
import { speak, term, usePersonaVoice, Speaker } from '../utils/voice';

export interface ToolsAnalyticsProps {
  env: 'prod' | 'dev';
  timeRange: '24h' | '7d' | '30d';
  viewMode: 'admin' | 'user';
  currentUserEmail: string;
  setLoading?: (loading: boolean) => void;
  registerRefresh?: (fn: () => void) => void;
  /** Shared with the AI Gateway section when the value is a user email (or 'all'). */
  userFilter?: string;
  onUserFilterChange?: (value: string) => void;
}

// Segment colours shared by the stacked bars and the legend. Labels follow the admin speaker:
// platform sees the status code, finance/ai_coe see the outcome in plain words.
const segments = (sp: Speaker): Array<{ key: 'ok' | 'denied' | 'rejected' | 'throttled' | 'error'; label: string; color: string }> => [
  { key: 'ok', label: speak(sp, { technical: 'Allowed (2xx)', finance: 'Allowed', ai_coe: 'Allowed' }), color: 'bg-emerald-500' },
  { key: 'denied', label: speak(sp, { technical: 'Denied (401/403)', finance: 'No access', ai_coe: 'Team not allowed' }), color: 'bg-rose-500' },
  { key: 'rejected', label: speak(sp, { technical: 'Rejected (400)', finance: 'Action blocked', ai_coe: 'Action not allowed' }), color: 'bg-amber-500' },
  { key: 'throttled', label: speak(sp, { technical: 'Throttled (429)', finance: 'Usage limit hit', ai_coe: 'Fair-use limit hit' }), color: 'bg-orange-500' },
  { key: 'error', label: speak(sp, { technical: 'Backend error (5xx)', finance: 'Failed', ai_coe: 'Failed' }), color: 'bg-slate-500' },
];

const outcomeStyle = (sp: Speaker): Record<ToolCallOutcome, { label: string; cls: string }> => ({
  ok: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  tool_error: { label: speak(sp, { technical: 'Tool error', finance: 'Tool failed', ai_coe: 'Tool failed' }), cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  rpc_error: { label: speak(sp, { technical: 'JSON-RPC error', finance: 'Request error', ai_coe: 'Request error' }), cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  denied: { label: speak(sp, { technical: 'Denied', finance: 'No access', ai_coe: 'No access' }), cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  rejected: { label: speak(sp, { technical: 'Rejected', finance: 'Not allowed', ai_coe: 'Not allowed' }), cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  throttled: { label: speak(sp, { technical: 'Throttled', finance: 'Limit hit', ai_coe: 'Limit hit' }), cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  error: { label: speak(sp, { technical: 'Error', finance: 'Failed', ai_coe: 'Failed' }), cls: 'bg-slate-100 text-slate-700 border-slate-300' },
});

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const StackedBar: React.FC<{ row: Record<string, number>; total: number; speaker: Speaker }> = ({ row, total, speaker }) => (
  <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-100">
    {segments(speaker).map((s) =>
      row[s.key] > 0 ? (
        <div key={s.key} className={s.color} style={{ width: `${(row[s.key] / total) * 100}%` }} title={`${s.label}: ${row[s.key]}`} />
      ) : null,
    )}
  </div>
);

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const prettyJson = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

export const ToolsAnalytics: React.FC<ToolsAnalyticsProps> = ({
  env,
  timeRange,
  viewMode,
  currentUserEmail,
  setLoading,
  registerRefresh,
  userFilter: sharedUserFilter,
  onUserFilterChange,
}) => {
  const [data, setData] = useState<ToolsAnalyticsResponse | null>(null);
  // Analytics speaks in the voice of the admin persona picked top-right:
  // platform = MCP verdicts and faults, finance = who uses what, ai_coe = tool adoption and blocks.
  const { voice, speaker, sp } = usePersonaVoice('admin');
  const SEGMENTS = segments(speaker);
  const OUTCOME_STYLE = outcomeStyle(speaker);
  const usesWord = sp({ technical: 'calls', finance: 'uses', ai_coe: 'uses' });
  const [error, setError] = useState<string | null>(null);
  // User view: only the signed-in user's own Unified Admin app ("Unified Admin <handle> App").
  const handle = viewMode === 'user' ? currentUserEmail.split('@')[0] : undefined;

  // Admin view user filter: 'all' | user email | persona:<key> | none.
  const [adminUser, setAdminUser] = useState<string>(() =>
    sharedUserFilter && (sharedUserFilter === 'all' || isEmail(sharedUserFilter)) ? sharedUserFilter : 'all',
  );
  useEffect(() => {
    if (sharedUserFilter && (sharedUserFilter === 'all' || isEmail(sharedUserFilter))) setAdminUser(sharedUserFilter);
  }, [sharedUserFilter]);
  const changeUser = (v: string) => {
    setAdminUser(v);
    // Only people carry over to the AI Gateway section; shared agent personas have no email there.
    if (v === 'all' || isEmail(v)) onUserFilterChange?.(v);
  };
  const effectiveUser = viewMode === 'user' ? currentUserEmail.toLowerCase() : adminUser;

  // Logs state
  const [logs, setLogs] = useState<ToolLogsResponse | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [serverFilter, setServerFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [includeProtocol, setIncludeProtocol] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading?.(true);
    setError(null);
    try {
      setData(await fetchToolsAnalytics(timeRange, env, handle, viewMode === 'admin' ? adminUser : undefined));
    } catch (e: any) {
      setError(e.message || sp({
        technical: 'Apigee Analytics query for the MCP proxies failed',
        finance: 'Could not load tool usage',
        ai_coe: 'Could not load tool adoption figures',
      }));
    } finally {
      setLoading?.(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      setLogs(await fetchToolLogs({
        window: timeRange,
        env,
        user: effectiveUser,
        server: serverFilter || undefined,
        tool: toolFilter || undefined,
        includeProtocol,
      }));
    } catch (e: any) {
      setLogsError(e.message || sp({
        technical: 'Cloud Logging query for MCP tool calls failed',
        finance: 'Could not load tool use history',
        ai_coe: 'Could not load tool use history',
      }));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    load();
    registerRefresh?.(() => { load(); loadLogs(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, timeRange, handle, adminUser, viewMode]);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, timeRange, effectiveUser, serverFilter, toolFilter, includeProtocol]);

  const userOptions = useMemo(() => {
    const list = data?.users || [];
    if (adminUser !== 'all' && !list.some((u) => u.key === adminUser)) {
      return [{ key: adminUser, label: adminUser, persona: '', calls: 0 }, ...list];
    }
    return list;
  }, [data, adminUser]);

  const k = data?.kpis;
  const kpiCards = [
    {
      label: sp({ technical: 'MCP Tool Calls', finance: 'Tool uses', ai_coe: 'Tool uses' }),
      value: k ? k.totalCalls.toLocaleString() : '—',
      sub: sp({ technical: 'tools/call through the proxies', finance: 'across all connectors', ai_coe: 'across all teams' }),
      icon: Wrench,
      tone: 'text-slate-900',
    },
    {
      label: sp({ technical: 'Success Rate', finance: 'Allowed', ai_coe: 'Allowed' }),
      value: k?.successRate == null ? '—' : `${k.successRate}%`,
      sub: k ? sp({ technical: `${k.okCalls} 2xx calls`, finance: `${k.okCalls} uses went through`, ai_coe: `${k.okCalls} uses allowed` }) : '',
      icon: ShieldCheck,
      tone: 'text-emerald-600',
    },
    {
      label: sp({ technical: 'Denied', finance: 'No access', ai_coe: 'No access' }),
      value: k ? k.deniedCalls.toLocaleString() : '—',
      sub: sp({ technical: '401: no key or tool not on the product', finance: 'no access key or not allowed', ai_coe: 'team not given this tool' }),
      icon: ShieldX,
      tone: 'text-rose-600',
    },
    {
      label: sp({ technical: 'Rejected', finance: 'Not allowed', ai_coe: 'Blocked actions' }),
      value: k ? k.rejectedCalls.toLocaleString() : '—',
      sub: sp({ technical: '400: method or schema rejected', finance: 'action blocked or invalid', ai_coe: 'action outside the allowed list' }),
      icon: Ban,
      tone: 'text-amber-600',
    },
    {
      label: sp({ technical: 'Avg Latency', finance: 'Avg response time', ai_coe: 'Avg response time' }),
      value: k?.avgLatencyMs == null ? '—' : `${k.avgLatencyMs} ms`,
      sub: sp({ technical: 'proxy + MCP backend', finance: 'per tool use', ai_coe: 'what people wait per tool' }),
      icon: Timer,
      tone: 'text-slate-900',
    },
  ];

  const toolNames = useMemo(() => [...new Set((logs?.byTool || []).map((t) => t.tool))].sort(), [logs]);

  const showLogsFor = (tool: string, server: string) => {
    setToolFilter(tool);
    setServerFilter(server);
    document.getElementById('tool-call-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const unattributedNote =
    logs && effectiveUser !== 'all' && logs.unattributed > 0
      ? sp({
          technical:
            `${logs.unattributed} call${logs.unattributed === 1 ? '' : 's'} in this window have no caller in the log entry, so they are left out of per-user views. ` +
            'Add the developer email / app to the MCP proxies\' message logging to close the gap.',
          finance: `${logs.unattributed} tool use${logs.unattributed === 1 ? '' : 's'} in this period don't record who made them, so they can't be charged back to one user.`,
          ai_coe: `${logs.unattributed} tool use${logs.unattributed === 1 ? '' : 's'} in this period don't record who made them, so they can't be counted towards one person's adoption.`,
        })
      : null;

  return (
    <div className="h-full bg-slate-50 text-slate-900 overflow-y-auto p-4 sm:px-6 sm:py-5">
      <div className="max-w-7xl mx-auto space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={load} className="underline font-semibold cursor-pointer ml-2">{sp({ technical: 'Retry query', finance: 'Try again', ai_coe: 'Try again' })}</button>
          </div>
        )}

        {/* KPI strip */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="border-b-2 border-cyan-500 inline-flex items-center gap-2 pb-1 font-bold text-sm text-slate-900">
              <span>
                {viewMode === 'user'
                  ? sp({ technical: 'Tools Gateway (My Calls)', finance: 'My business tools', ai_coe: 'My tool usage' })
                  : sp({ technical: 'Tools Gateway', finance: 'Business tools used', ai_coe: 'Tool adoption' })}
              </span>
              <span
                title={
                  viewMode === 'user'
                    ? sp({
                        technical: 'My own MCP calls through the Tools Gateway with my key, and the verdict the gateway returned on each.',
                        finance: 'Which business tools I have used, and how often.',
                        ai_coe: 'Which business tools I have used, and whether any of my attempts were blocked.',
                      })
                    : sp({
                        technical:
                          'MCP traffic through the Tools Gateway proxies: calls per MCP server, tool and caller, and the gateway verdict. 401 is an API key or product entitlement failure, 400 a method not on the allow-list or a schema violation, 429 the tool quota, 5xx the MCP backend. The call logs show the JSON-RPC request and which policy faulted.',
                        finance:
                          'Which business tools were used, by whom, and how often. Blocked uses never reach the underlying system, so this also shows how much unapproved use was stopped at the gateway.',
                        ai_coe:
                          'How far tool adoption has spread: which business tools each team uses, how often, and how many attempts were blocked because the team is not allowed that tool or action. High block counts can mean a team needs access, or someone is trying something they should not.',
                      })
                }
              >
                <Info className="w-3.5 h-3.5 text-slate-400 hover:text-cyan-600 cursor-pointer" />
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
              {viewMode === 'admin' ? (
                <div className="flex items-center bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 text-xs shadow-xs">
                  <User className="w-3.5 h-3.5 text-cyan-600 mr-1.5 shrink-0" />
                  <span className="text-slate-500 mr-1 text-[11px] font-semibold">{sp({ technical: 'Caller:', finance: 'User:', ai_coe: 'User:' })}</span>
                  <select
                    value={adminUser}
                    onChange={(e) => changeUser(e.target.value)}
                    className="bg-transparent text-slate-800 text-xs font-mono focus:outline-none cursor-pointer max-w-[220px] truncate"
                    title={sp({
                      technical: 'Scope to one developer or shared agent API key, or all callers',
                      finance: 'Show one user, one shared assistant, or everyone',
                      ai_coe: 'Show one person, one shared assistant, or everyone',
                    })}
                  >
                    <option value="all">{sp({ technical: 'All callers (fleet)', finance: 'All users', ai_coe: 'All users' })}</option>
                    {userOptions.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.label}{u.calls ? ` · ${u.calls}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="font-mono text-[11px]">{currentUserEmail}</span>
              )}
              <span>•</span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full animate-pulse ${env === 'dev' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {env === 'dev'
                  ? sp({ technical: 'Development', business: term(voice, 'devEnv') })
                  : sp({ technical: 'Production', business: term(voice, 'prodEnv') })} • {timeRange.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {kpiCards.map((c) => (
              <div key={c.label} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {c.label}
                  <c.icon className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className={`text-2xl font-bold mt-1 ${c.tone}`}>{c.value}</div>
                {c.sub && <div className="text-[10px] text-slate-500 mt-0.5">{c.sub}</div>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
            {SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* By tool server */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm mb-3">
              <Server className="w-4 h-4 text-cyan-600" /> {sp({ technical: 'Verdicts by MCP Server', finance: 'Use by tool connector', ai_coe: 'Adoption by connector' })}
            </div>
            {data && data.byServer.length === 0 && (
              <p className="text-xs text-slate-500">
                {sp({ technical: 'No MCP traffic in this window.', finance: 'No tools used in this period.', ai_coe: 'No team used a tool in this period.' })}
              </p>
            )}
            <div className="space-y-3">
              {data?.byServer.map((s) => (
                <div key={s.proxy} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      {s.label} <span className="font-mono text-[10px] text-slate-400">/{s.proxy}</span>
                    </span>
                    <span className="font-mono text-slate-600">
                      {s.calls} {usesWord}{s.avgLatencyMs != null ? ` • ${s.avgLatencyMs} ms` : ''}
                    </span>
                  </div>
                  <StackedBar row={s as unknown as Record<string, number>} total={s.calls} speaker={speaker} />
                </div>
              ))}
            </div>
          </div>

          {/* Access by persona */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm mb-3">
              <Users className="w-4 h-4 text-cyan-600" /> {sp({ technical: 'Verdicts by Persona', finance: 'Tool use by persona', ai_coe: 'Tool access by persona' })}
            </div>
            {data && data.byPersona.length === 0 && (
              <p className="text-xs text-slate-500">
                {sp({ technical: 'No MCP traffic in this window.', finance: 'No tools used in this period.', ai_coe: 'No team used a tool in this period.' })}
              </p>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-1.5 font-bold">Persona</th>
                  <th className="py-1.5 font-bold text-right">{sp({ technical: 'Calls', finance: 'Uses', ai_coe: 'Uses' })}</th>
                  <th className="py-1.5 font-bold text-right">Allowed</th>
                  <th className="py-1.5 font-bold text-right">{sp({ technical: 'Blocked (4xx)', finance: 'Blocked', ai_coe: 'Blocked' })}</th>
                  <th className="py-1.5 font-bold pl-3 w-1/3">{sp({ technical: 'Verdict mix', finance: 'Result', ai_coe: 'Result' })}</th>
                </tr>
              </thead>
              <tbody>
                {data?.byPersona.map((p) => (
                  <tr key={p.persona} className="border-b border-slate-50">
                    <td className="py-1.5">
                      <div className="font-semibold text-slate-800">{p.persona}</div>
                      <div className="text-[10px] font-mono text-slate-400">{p.servers.join(', ')}</div>
                    </td>
                    <td className="py-1.5 text-right font-mono">{p.calls}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-600">{p.ok}</td>
                    <td className="py-1.5 text-right font-mono text-rose-600">{p.denied + p.rejected + p.throttled}</td>
                    <td className="py-1.5 pl-3"><StackedBar row={p as unknown as Record<string, number>} total={p.calls} speaker={speaker} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tools used */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 font-bold text-sm">
              <Hammer className="w-4 h-4 text-cyan-600" /> {sp({ technical: 'Tools Called', finance: 'Tools used', ai_coe: 'Tools adopted' })}
              {logs && (
                <span className="text-[11px] font-normal text-slate-500">
                  {sp({
                    technical: `(${logs.byTool.length} tools, from ${logs.scanned.toLocaleString()} logged calls)`,
                    finance: `(${logs.byTool.length} tools, from ${logs.scanned.toLocaleString()} recorded uses)`,
                    ai_coe: `(${logs.byTool.length} tools in use, from ${logs.scanned.toLocaleString()} recorded uses)`,
                  })}
                </span>
              )}
            </div>
          </div>
          {logsLoading && !logs && (
            <p className="text-xs text-slate-500">
              {sp({ technical: 'Scanning Cloud Logging…', finance: 'Loading tool usage…', ai_coe: 'Loading tool adoption…' })}
            </p>
          )}
          {logs && logs.byTool.length === 0 && (
            <p className="text-xs text-slate-500">
              {effectiveUser !== 'all'
                ? sp({
                    technical: 'No tools/call requests from this caller in this window.',
                    finance: 'This user used no tools in this period.',
                    ai_coe: 'This person has not used any tools in this period.',
                  })
                : sp({
                    technical: 'No tools/call requests in this window.',
                    finance: 'No tools were used in this period.',
                    ai_coe: 'No tools were used in this period, so no adoption to show yet.',
                  })}
            </p>
          )}
          {unattributedNote && <p className="text-[11px] text-amber-700 mb-2">{unattributedNote}</p>}
          {logs && logs.byTool.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 font-bold">Tool</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'MCP server', finance: 'Connector', ai_coe: 'Connector' })}</th>
                    <th className="py-1.5 font-bold text-right">{sp({ technical: 'Calls', finance: 'Uses', ai_coe: 'Uses' })}</th>
                    <th className="py-1.5 font-bold text-right">OK</th>
                    <th className="py-1.5 font-bold text-right">Blocked</th>
                    <th className="py-1.5 font-bold text-right">{sp({ technical: 'Errors', finance: 'Failed', ai_coe: 'Failed' })}</th>
                    <th className="py-1.5 font-bold text-right">{sp({ technical: 'Avg backend', finance: 'Avg response', ai_coe: 'Avg response' })}</th>
                    <th className="py-1.5 font-bold text-right">Last used</th>
                    <th className="py-1.5 font-bold text-right">{sp({ technical: 'Logs', finance: 'History', ai_coe: 'History' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.byTool.map((t) => (
                    <tr key={`${t.server}:${t.tool}`} className="border-b border-slate-50">
                      <td className="py-1.5 font-mono font-semibold text-slate-800">{t.tool}</td>
                      <td className="py-1.5 text-slate-600">{t.serverLabel} <span className="font-mono text-[10px] text-slate-400">/{t.server}</span></td>
                      <td className="py-1.5 text-right font-mono">{t.calls}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-600">{t.ok}</td>
                      <td className="py-1.5 text-right font-mono text-rose-600">{t.blocked}</td>
                      <td className="py-1.5 text-right font-mono text-amber-700">{t.failed}</td>
                      <td className="py-1.5 text-right font-mono text-slate-600">{t.avgBackendMs != null ? `${t.avgBackendMs} ms` : '—'}</td>
                      <td className="py-1.5 text-right text-slate-500">{fmtTime(t.lastUsed)}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => showLogsFor(t.tool, t.server)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-cyan-200 text-cyan-700 hover:bg-cyan-50 text-[11px] font-semibold cursor-pointer"
                        >
                          <ScrollText className="w-3 h-3" /> {sp({ technical: 'Logs', finance: 'History', ai_coe: 'History' })}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tool call logs */}
        <div id="tool-call-logs" className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs scroll-mt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 font-bold text-sm">
              <ScrollText className="w-4 h-4 text-cyan-600" /> {sp({ technical: 'MCP Call Logs', finance: 'Tool use history', ai_coe: 'Tool use history' })}
              {logs && (
                <span className="text-[11px] font-normal text-slate-500">
                  ({logs.matched.toLocaleString()} {sp({ technical: 'matching', finance: 'found', ai_coe: 'found' })}
                  {logs.matched > logs.entries.length
                    ? sp({
                        technical: `, newest ${logs.entries.length} shown`,
                        finance: `, latest ${logs.entries.length} shown`,
                        ai_coe: `, latest ${logs.entries.length} shown`,
                      })
                    : ''}
                  )
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs cursor-pointer" aria-label={sp({ technical: 'MCP server', finance: 'Connector', ai_coe: 'Connector' })}>
                <option value="">{sp({ technical: 'All MCP servers', finance: 'All connectors', ai_coe: 'All connectors' })}</option>
                <option value="mcp">{sp({ technical: 'Enterprise APIs /mcp', business: 'Enterprise APIs' })}</option>
                <option value="bigquery-mcp">{sp({ technical: 'BigQuery /bigquery-mcp', business: 'BigQuery' })}</option>
                <option value="servicenow-mcp">{sp({ technical: 'ServiceNow /servicenow-mcp', business: 'ServiceNow' })}</option>
              </select>
              <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono cursor-pointer max-w-[200px]" aria-label="Tool">
                <option value="">All tools</option>
                {toolFilter && !toolNames.includes(toolFilter) && <option value={toolFilter}>{toolFilter}</option>}
                {toolNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label
                className="inline-flex items-center gap-1 text-slate-600 cursor-pointer"
                title={sp({
                  technical: 'Include tools/list, initialize, ping and other MCP protocol calls, not just tool executions',
                  finance: 'Also show background setup and health-check calls; these do no business work',
                  ai_coe: 'Also show background setup and health-check calls made by the assistants',
                })}
              >
                <input type="checkbox" checked={includeProtocol} onChange={(e) => setIncludeProtocol(e.target.checked)} disabled={!!toolFilter} />
                {sp({ technical: 'Protocol calls', finance: 'Background calls', ai_coe: 'Background calls' })}
              </label>
              <button type="button" onClick={loadLogs} disabled={logsLoading}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50" aria-label={sp({ technical: 'Re-run log query', finance: 'Reload history', ai_coe: 'Reload history' })}>
                <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${logsLoading ? 'animate-spin' : ''}`} />
              </button>
              {logs?.consoleUrl && (
                <a href={logs.consoleUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-cyan-700 hover:underline font-semibold">
                  {sp({ technical: 'Cloud Logging', finance: 'Raw logs', ai_coe: 'Raw logs' })} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {logsError && <p className="text-xs text-rose-600 mb-2">{logsError}</p>}
          {logs && logs.entries.length === 0 && !logsLoading && <p className="text-xs text-slate-500">{sp({
            technical: 'No MCP calls match these filters in this window.',
            finance: 'No matching tool uses in this period.',
            ai_coe: 'No matching tool uses in this period.',
          })}</p>}
          {logs && logs.entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 w-5" />
                    <th className="py-1.5 font-bold">Time</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'Caller', finance: 'User', ai_coe: 'User' })}</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'MCP server', finance: 'Connector', ai_coe: 'Connector' })}</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'Tool / method', finance: 'Tool', ai_coe: 'Tool' })}</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'Arguments', finance: 'Inputs', ai_coe: 'Inputs' })}</th>
                    <th className="py-1.5 font-bold">{sp({ technical: 'Verdict', finance: 'Result', ai_coe: 'Result' })}</th>
                    <th className="py-1.5 font-bold text-right">{sp({ technical: 'Backend', finance: 'Time taken', ai_coe: 'Time taken' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.entries.map((e, i) => {
                    const id = e.trackingId || `${e.timestamp}-${i}`;
                    const open = expanded === id;
                    const o = OUTCOME_STYLE[e.outcome] || OUTCOME_STYLE.error;
                    return (
                      <React.Fragment key={id}>
                        <tr
                          className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
                          onClick={() => setExpanded(open ? null : id)}
                        >
                          <td className="py-1.5 text-slate-400">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                          <td className="py-1.5 text-slate-600 whitespace-nowrap">{fmtTime(e.timestamp)}</td>
                          <td className="py-1.5 text-slate-600 max-w-[180px] truncate" title={e.userLabel || sp({
                            technical: 'Caller not written to the log by this MCP proxy',
                            finance: 'User not recorded for this tool, so it cannot be charged back',
                            ai_coe: 'User not recorded for this tool',
                          })}>
                            {e.attributed ? e.userLabel : <span className="text-slate-300">{sp({ technical: 'not logged', finance: 'not recorded', ai_coe: 'not recorded' })}</span>}
                          </td>
                          <td className="py-1.5 text-slate-600 whitespace-nowrap">{e.serverLabel}</td>
                          <td className="py-1.5 font-mono text-slate-800">{e.tool || <span className="text-slate-500">{e.method}</span>}</td>
                          <td className="py-1.5 font-mono text-[10px] text-slate-500 max-w-[240px] truncate" title={e.arguments}>{e.arguments || '—'}</td>
                          <td className="py-1.5 whitespace-nowrap">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold ${o.cls}`}>{o.label}</span>
                            {e.httpStatus && <span className="ml-1 font-mono text-[10px] text-slate-400">{e.httpStatus}</span>}
                          </td>
                          <td className="py-1.5 text-right font-mono text-slate-600">{e.backendMs != null ? `${e.backendMs} ms` : '—'}</td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <td />
                            <td colSpan={7} className="py-2 pr-2">
                              {(e.errorMessage || e.faultName) && (
                                <div className="text-[11px] text-rose-700 mb-2">
                                  {e.faultName && <span className="font-mono mr-2">{e.faultName}</span>}
                                  {e.errorMessage}
                                </div>
                              )}
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{sp({ technical: 'JSON-RPC request', finance: 'Request sent', ai_coe: 'Request sent' })}</div>
                                  <pre className="text-[10px] font-mono bg-white border border-slate-200 rounded-lg p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{prettyJson(e.request) || '—'}</pre>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{sp({ technical: 'JSON-RPC response', finance: 'Reply', ai_coe: 'Reply' })}</div>
                                  <pre className="text-[10px] font-mono bg-white border border-slate-200 rounded-lg p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{prettyJson(e.response) || sp({
                                    technical: '— (no body: a gateway policy rejected the call before the MCP backend)',
                                    finance: '— (none: the gateway blocked this use)',
                                    ai_coe: '— (none: the gateway blocked this use)',
                                  })}</pre>
                                </div>
                              </div>
                              {e.trackingId && <div className="mt-1 text-[10px] font-mono text-slate-400">tracking id {e.trackingId}</div>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {logs?.truncated && (
            <p className="mt-2 text-[11px] text-slate-500">
              {sp({
                technical: 'Only the newest 3,000 log entries in this window were scanned. Narrow the range or query Cloud Logging directly for the rest.',
                finance: 'Only the newest 3,000 tool uses in this period were checked. Pick a shorter range to see everything.',
                ai_coe: 'Only the newest 3,000 tool uses were checked. Pick a shorter range for a complete adoption picture.',
              })}
            </p>
          )}
        </div>

        <p className="text-[11px] text-slate-500">
          {sp({
            technical: `Sources: KPIs, MCP servers and personas from Apigee Analytics for the MCP proxies (${env}); tools called and call logs from the JSON-RPC requests the MCP proxies write to Cloud Logging. Analytics can trail the logs by a few minutes.`,
            finance: `Sources: totals and personas from gateway analytics (${term(voice, env === 'dev' ? 'devEnv' : 'prodEnv')}); tool history from the gateway's request logs. Figures are counts of use, not amounts billed.`,
            ai_coe: `Sources: totals and personas from gateway analytics (${term(voice, env === 'dev' ? 'devEnv' : 'prodEnv')}); tools adopted and history from the gateway's request logs.`,
          })}
        </p>
      </div>
    </div>
  );
};
