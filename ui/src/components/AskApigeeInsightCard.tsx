import React from 'react';
import { BarChart3, Wrench, ScrollText, Stethoscope, UserRound } from 'lucide-react';
import type { InsightEvent } from '../services/adminAgent';

/**
 * Compact, read-only cards for the Ask Apigee's analytics answers.
 *
 * The model writes the prose; these cards show the numbers it used, so the
 * reader can check the answer at a glance without opening the Analytics tab.
 * Every field is optional because the payload comes straight from the server's
 * insight tools and older servers may omit some of it.
 */

const usd = (n: unknown, digits = 4) => `$${(Number(n) || 0).toFixed(digits)}`;
const int = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
const pct = (n: unknown) => (n === null || n === undefined ? '—' : `${n}%`);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const Kpi: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-slate-900' }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 min-w-0">
    <div className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold truncate">{label}</div>
    <div className={`text-[12px] font-bold tabular-nums truncate ${tone}`}>{value}</div>
  </div>
);

const Shell: React.FC<{ icon: React.ReactNode; title: string; meta?: string; children: React.ReactNode }> = ({ icon, title, meta, children }) => (
  <div data-agent-insight className="rounded-xl border border-slate-200 bg-slate-50/70 shadow-2xs overflow-hidden">
    <div className="px-2.5 py-1.5 border-b border-slate-200 bg-white flex items-center gap-1.5">
      {icon}
      <span className="text-[11px] font-bold text-slate-900">{title}</span>
      {meta && <span className="ml-auto text-[10px] text-slate-500 truncate">{meta}</span>}
    </div>
    <div className="px-2.5 py-2 space-y-2">{children}</div>
  </div>
);

const Table: React.FC<{ head: string[]; rows: (string | React.ReactNode)[][]; align?: ('l' | 'r')[] }> = ({ head, rows, align = [] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-slate-500">
          {head.map((h, i) => (
            <th key={h} className={`font-semibold pb-1 pr-2 ${align[i] === 'r' ? 'text-right' : 'text-left'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-slate-200/70">
            {r.map((c, ci) => (
              <td key={ci} className={`py-1 pr-2 ${align[ci] === 'r' ? 'text-right tabular-nums' : 'text-slate-800'} ${ci === 0 ? 'font-semibold max-w-[160px] truncate' : ''}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const metaFor = (d: any) => [d?.range, d?.env, d?.user].filter(Boolean).join(' · ');

const UsageCard: React.FC<{ d: any }> = ({ d }) => {
  const t = d?.totals || {};
  const rows: any[] = d?.rows || [];
  const byModel = d?.groupBy === 'model';
  return (
    <Shell icon={<BarChart3 className="w-3.5 h-3.5 text-purple-600" />} title="AI Gateway usage" meta={metaFor(d)}>
      <div className="grid grid-cols-4 gap-1.5">
        <Kpi label="Calls" value={int(t.calls)} />
        <Kpi label="Tokens" value={int(t.totalTokens)} />
        <Kpi label="Spend" value={usd(t.costUsd, 2)} />
        <Kpi label="Cache hits" value={pct(t.cacheHitRate)} />
      </div>
      {rows.length > 0 && (
        <Table
          head={[byModel ? 'Model' : d?.groupBy === 'user_model' ? 'User · model' : 'User', 'Calls', 'Tokens', 'Spend']}
          align={['l', 'r', 'r', 'r']}
          rows={rows.slice(0, 6).map((r) => [r.key, int(r.calls), int(r.totalTokens), usd(r.costUsd)])}
        />
      )}
      {d?.moreRows > 0 && <div className="text-[10px] text-slate-500">+{d.moreRows} more</div>}
    </Shell>
  );
};

const ToolsCard: React.FC<{ d: any }> = ({ d }) => {
  const k = d?.kpis || {};
  const tools: any[] = d?.byTool || [];
  return (
    <Shell icon={<Wrench className="w-3.5 h-3.5 text-cyan-600" />} title="MCP tool usage" meta={metaFor(d)}>
      <div className="grid grid-cols-4 gap-1.5">
        <Kpi label="Calls" value={int(k.totalCalls)} />
        <Kpi label="Success" value={pct(k.successRate)} />
        <Kpi label="Denied" value={int(k.deniedCalls)} tone={k.deniedCalls ? 'text-amber-700' : undefined} />
        <Kpi label="Errors" value={int(k.errorCalls)} tone={k.errorCalls ? 'text-rose-700' : undefined} />
      </div>
      {tools.length > 0 && (
        <Table
          head={['Tool', 'Calls', 'OK', 'Blocked', 'Failed']}
          align={['l', 'r', 'r', 'r', 'r']}
          rows={tools.slice(0, 6).map((t) => [t.tool, int(t.calls), int(t.ok), int(t.blocked), int(t.failed)])}
        />
      )}
    </Shell>
  );
};

const OUTCOME_TONE: Record<string, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  blocked: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

const LogsCard: React.FC<{ d: any }> = ({ d }) => {
  const c = d?.counts || {};
  const reasons: any[] = d?.failureReasons || [];
  const entries: any[] = d?.entries || [];
  return (
    <Shell icon={<ScrollText className="w-3.5 h-3.5 text-slate-600" />} title="Call log" meta={metaFor(d)}>
      <div className="grid grid-cols-4 gap-1.5">
        <Kpi label="Scanned" value={int(c.total)} />
        <Kpi label="OK" value={int(c.ok)} tone="text-emerald-700" />
        <Kpi label="Blocked" value={int(c.blocked)} tone={c.blocked ? 'text-amber-700' : undefined} />
        <Kpi label="Failed" value={int(c.error)} tone={c.error ? 'text-rose-700' : undefined} />
      </div>
      {reasons.length > 0 && (
        <Table
          head={['Why it failed', 'Count', 'Owner']}
          align={['l', 'r', 'l']}
          rows={reasons.slice(0, 5).map((r) => [r.title, int(r.count), r.owner || '—'])}
        />
      )}
      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.slice(0, 5).map((e, i) => (
            <li key={e.trackingId || i} className="flex items-center gap-1.5 text-[10px] text-slate-600 min-w-0">
              <span className={`px-1 rounded border font-semibold ${OUTCOME_TONE[e.outcome] || OUTCOME_TONE.error}`}>{e.status || '—'}</span>
              <span className="text-slate-400 shrink-0">{when(e.timestamp)}</span>
              <span className="font-mono truncate">{e.model || e.requestedModel || '—'}</span>
              {e.user && <span className="truncate text-slate-500">{e.user}</span>}
              <span className="ml-auto shrink-0 truncate max-w-[45%]">{e.reason || (e.costUsd ? usd(e.costUsd) : '')}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
};

const FailureCard: React.FC<{ d: any }> = ({ d }) => {
  if (!d?.found) {
    return (
      <Shell icon={<Stethoscope className="w-3.5 h-3.5 text-emerald-600" />} title="Failure check">
        <p className="text-[11px] text-slate-700">{d?.message || 'No failed calls found.'}</p>
      </Shell>
    );
  }
  const reasons: any[] = d?.reasons || [];
  return (
    <Shell
      icon={<Stethoscope className="w-3.5 h-3.5 text-amber-600" />}
      title="Why calls failed"
      meta={`${int(d.failedCalls)} of ${int(d.callsChecked)} calls`}
    >
      {reasons.slice(0, 4).map((r) => (
        <div key={r.category} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-900">{r.title}</span>
            <span className="text-[10px] text-slate-500">×{int(r.count)}</span>
            {r.owner && (
              <span className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                <UserRound className="w-2.5 h-2.5" />
                {r.owner}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-600 leading-snug mt-0.5">{r.explanation}</p>
          {r.fix && <p className="text-[10px] text-slate-800 leading-snug mt-0.5"><b>Fix:</b> {r.fix}</p>}
        </div>
      ))}
    </Shell>
  );
};

export const AskApigeeInsightCard: React.FC<{ event: InsightEvent }> = ({ event }) => {
  switch (event.kind) {
    case 'usage':
      return <UsageCard d={event.data} />;
    case 'tools':
      return <ToolsCard d={event.data} />;
    case 'logs':
      return <LogsCard d={event.data} />;
    case 'failure':
      return <FailureCard d={event.data} />;
    default:
      return null;
  }
};
