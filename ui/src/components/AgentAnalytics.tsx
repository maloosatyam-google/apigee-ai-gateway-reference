import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Cpu, Loader2, RefreshCw, ShieldCheck, ShieldX, Wrench, Server, AlertTriangle, ExternalLink, DollarSign, Download, Upload, Clock } from 'lucide-react';
import { formatMs, formatTokens, formatUsd, ratio } from '../utils/agentShowcase';

/*
  Agent Analytics: the history of the two Agent Showcase agents, read back from what Apigee
  recorded - not from this browser session. Model calls, tokens, cost (ai-model-rates KVM), the
  gateway's outcomes, MCP calls per server and the tools each agent used, over 24 hours, 7 or
  30 days. Built by /api/analytics/agent-stats (ui/server/agentAnalytics.js).
*/

type SideId = 'baseline' | 'governed';
const SIDES: SideId[] = ['baseline', 'governed'];
type Range = '24h' | '7d' | '30d';
type Env = 'prod' | 'dev';

interface ModelRow { model: string; noModel: boolean; calls: number; cached: number; failed: number; input: number; output: number; rate: { input: number; output: number } | null; costUsd: number | null }
interface ServerRow { proxy: string; label: string; calls: number; ok: number; denied: number; limited: number; rejected: number; error: number; avgLatencyMs: number | null; available: boolean }
interface ToolRow { tool: string; server: string; serverLabel: string; calls: number; ok: number; blocked: number; failed: number; avgBackendMs: number | null; lastUsed: string | null; available: boolean }
interface SideData {
  llm: { calls: number; ok: number; cached: number; blocked: number; limited: number; error: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number | null; models: ModelRow[]; statuses: { status: string; calls: number; label: string }[] };
  mcp: { calls: number; ok: number; denied: number; limited: number; rejected: number; error: number; avgLatencyMs: number | null; servers: ServerRow[] };
  tools: ToolRow[];
}
interface Bucket { llmCalls: number; mcpCalls: number; tokens: number; costUsd: number }
interface AgentStats {
  env: Env; timeRange: Range; timeUnit: 'hour' | 'day'; since: string; until: string;
  ratesError: string | null; toolsError: string | null; toolsTruncated: boolean; toolsConsoleUrl: string;
  sides: Record<SideId, SideData>; handshakes: number; unpriced: string[];
  series: ({ ts: number } & Record<SideId, Bucket>)[];
}

const SIDE_META: Record<SideId, { label: string; note: string; icon: React.ReactNode; head: string; accent: string; bar: string }> = {
  baseline: {
    label: 'Regular Gateway (Without AI governance)',
    note: 'No controls: one fixed model, every tool in the organization, no limits or safety checks',
    icon: <Bot className="w-4 h-4 text-slate-500" />,
    head: 'bg-slate-50 border-slate-200',
    accent: 'text-slate-800',
    bar: 'bg-rose-400',
  },
  governed: {
    label: 'With AI & Tools Governance',
    note: 'Controlled: only the tools it is authorized for, usage and business limits, safety checks, right-sized models',
    icon: <ShieldCheck className="w-4 h-4 text-blue-600" />,
    head: 'bg-blue-50 border-blue-200',
    accent: 'text-blue-800',
    bar: 'bg-blue-500',
  },
};

const METRICS: { id: keyof Bucket; label: string; fmt: (n: number) => string }[] = [
  { id: 'costUsd', label: 'Model cost', fmt: formatUsd },
  { id: 'tokens', label: 'Tokens', fmt: formatTokens },
  { id: 'llmCalls', label: 'Model calls', fmt: (n) => n.toLocaleString('en-US') },
  { id: 'mcpCalls', label: 'MCP calls', fmt: (n) => n.toLocaleString('en-US') },
];

const num = (n: number) => n.toLocaleString('en-US');
const rateText = (r: { input: number; output: number } | null) => (r ? `$${r.input} / $${r.output}` : 'No rate');

// Session-level cache so switching tabs does not refetch.
let lastStats: AgentStats | null = null;
let lastQuery: { env: Env; range: Range } = { env: 'prod', range: '7d' };

function Kpi({ label, b, g, fmt, lowerIsBetter = true, icon, accent }: { label: string; b: number; g: number; fmt: (n: number) => string; lowerIsBetter?: boolean; icon: React.ReactNode; accent: string }) {
  const x = lowerIsBetter ? ratio(b, g) : null;
  return (
    <div className={`rounded-xl border border-slate-200 border-t-4 ${accent} bg-white p-3`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{icon} {label}</div>
      <div className={`mt-1 text-xs tabular-nums ${x !== null && x >= 1.05 ? 'font-semibold text-rose-700' : 'text-slate-700'}`}>Without: {fmt(b)}</div>
      <div className="text-xs tabular-nums font-semibold text-blue-700">With: {fmt(g)}</div>
      {x !== null && x >= 1.05 && (
        <div className="mt-1 text-[11px] font-semibold text-emerald-700">{x.toFixed(x < 10 ? 1 : 0)}× less with governance</div>
      )}
    </div>
  );
}

function bucketLabel(ts: number, unit: 'hour' | 'day') {
  const d = new Date(ts);
  return unit === 'hour'
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Trend({ stats }: { stats: AgentStats }) {
  const [metric, setMetric] = useState<keyof Bucket>('costUsd');
  const m = METRICS.find((x) => x.id === metric)!;
  const max = Math.max(0, ...stats.series.flatMap((b) => SIDES.map((s) => b[s][metric])));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-800">Over time</h3>
        <span className="text-xs text-slate-500">per {stats.timeUnit}, UTC buckets shown in your local time</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {METRICS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setMetric(x.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border ${metric === x.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {stats.series.length === 0 || max === 0 ? (
        <p className="text-xs text-slate-500">No agent traffic in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex items-end gap-3 min-w-full" style={{ height: 180 }}>
            {stats.series.map((b) => (
              <div key={b.ts} className="flex flex-col items-center gap-1 min-w-[56px] flex-1 h-full justify-end">
                <div className="flex items-end gap-1 h-full w-full justify-center">
                  {SIDES.map((s) => {
                    const v = b[s][metric];
                    const h = max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * 150) : 0;
                    return (
                      <div key={s} className="flex flex-col items-center justify-end h-full">
                        <span className="text-[10px] tabular-nums text-slate-600 whitespace-nowrap">{v > 0 ? m.fmt(v) : ''}</span>
                        <div className={`w-4 rounded-t ${SIDE_META[s].bar}`} style={{ height: h }} title={`${SIDE_META[s].label}: ${m.fmt(v)}`} />
                      </div>
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">{bucketLabel(b.ts, stats.timeUnit)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-600">
        {SIDES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm ${SIDE_META[s].bar}`} /> {SIDE_META[s].label}
          </span>
        ))}
      </div>
    </section>
  );
}

/*
  The two agent columns line up section by section and row by row: the server gives both agents
  the same models, outcomes, servers and tools in the same order (alignSides), every row is one
  line high, and each section is a row of a shared grid (CSS subgrid), so a heading or a tool sits
  at the same height on both sides.
*/
const TH = 'px-2 py-2 font-semibold text-right whitespace-nowrap';
const TD = 'px-2 h-8 text-right tabular-nums whitespace-nowrap';
// Zero or not-applicable cells stay blank: an empty cell reads faster than a column of 0s and dashes.
const dash = null;
const count = (n: number, cls: string) => (n > 0 ? <span className={cls}>{num(n)}</span> : null);
const tok = (n: number) => (n ? num(n) : null);

// Colour code for every call row: green = allowed, amber = warning (some calls stopped by a limit
// or failed), red = restricted (blocked / not authorized), grey = not used in this period.
// On the governed side a block is a control doing its job, so it is shown as green "protected"
// (shield); red and amber are kept for the ungoverned agent's risks and for real faults.
type Tone = 'ok' | 'guard' | 'warn' | 'bad' | 'idle';
const TONE: Record<Tone, { dot: string; row: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', row: '', label: 'Allowed' },
  guard: { dot: '', row: 'bg-emerald-50/70', label: 'Protected: stopped by a control' },
  warn: { dot: 'bg-amber-500', row: 'bg-amber-50/70', label: 'Warning: some calls stopped or failed' },
  bad: { dot: 'bg-rose-500', row: 'bg-rose-50/70', label: 'Restricted: blocked' },
  idle: { dot: 'bg-slate-300', row: '', label: 'Not used' },
};
const Dot = ({ tone }: { tone: Tone }) =>
  tone === 'guard'
    ? <span title={TONE.guard.label} className="shrink-0 inline-flex"><ShieldCheck className="w-3 h-3 text-emerald-600" /></span>
    : <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${TONE[tone].dot}`} title={TONE[tone].label} />;
const Legend = ({ side }: { side: SideId }) => (
  <span className="ml-auto flex items-center gap-2.5 text-[10px] font-medium text-slate-500">
    <span className="flex items-center gap-1"><Dot tone="ok" /> Allowed</span>
    <span className="flex items-center gap-1"><Dot tone="warn" /> {side === 'governed' ? 'Limit' : 'Warning'}</span>
    <span className="flex items-center gap-1"><Dot tone="bad" /> {side === 'governed' ? 'Not authorized' : 'Risk'}</span>
  </span>
);
// A short note on the row itself saying what the control did / what risk the ungoverned agent took.
const PILL: Record<'warn' | 'bad' | 'guard', string> = {
  bad: 'bg-rose-100 border-rose-200 text-rose-700',
  warn: 'bg-amber-100 border-amber-200 text-amber-800',
  guard: 'bg-emerald-100 border-emerald-200 text-emerald-800',
};
const Pill = ({ tone, children }: { tone: 'warn' | 'bad' | 'guard'; children: React.ReactNode }) => (
  <span className={`shrink-0 inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold whitespace-nowrap ${PILL[tone]}`}>
    {tone === 'guard' && <ShieldCheck className="w-2.5 h-2.5" />}{children}
  </span>
);
// Model family colour, so the fixed expensive model and the right-sized ones stand apart.
const modelColor = (m: string) =>
  /claude|opus|sonnet/i.test(m) ? 'bg-orange-500' : /pro/i.test(m) ? 'bg-violet-500' : /lite/i.test(m) ? 'bg-teal-500' : /flash/i.test(m) ? 'bg-sky-500' : 'bg-slate-300';

function ModelsTable({ d, side }: { d: SideData; side: SideId }) {
  if (!d.llm.models.length) return <p className="px-4 py-3 text-xs text-slate-500">No model calls in this period.</p>;
  // Without governance every step goes to the most expensive model it is configured with.
  const topRate = Math.max(0, ...d.llm.models.map((m) => (m.calls && m.rate ? m.rate.input : 0)));
  // Rows that are a control on the governed side; on the ungoverned side an empty row is a missing control.
  const missing = (m: ModelRow): { tone: 'warn' | 'bad'; text: string; title: string } | null =>
    side !== 'baseline' || !m.noModel || m.calls > 0 ? null
      : m.model.startsWith('Reused') ? { tone: 'warn', text: 'No answer reuse', title: 'Every call goes to the model and is paid for, even a repeat question' }
      : { tone: 'bad', text: 'No safety checks', title: 'Nothing is blocked before it reaches the model: prompt attacks and unsafe requests go through' };
  const premium = (m: ModelRow) => side === 'baseline' && !m.noModel && m.calls > 0 && !!m.rate && m.rate.input === topRate && topRate > 0;
  return (
    <table className="w-full text-xs table-fixed">
      <colgroup>
        <col />
        <col className="w-[52px]" />
        <col className="w-[56px]" />
        <col className="w-[84px]" />
        <col className="w-[76px]" />
        <col className="w-[104px]" />
        <col className="w-[84px]" />
      </colgroup>
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th className="px-4 py-2 font-semibold">Model</th>
          <th className={TH}>Calls</th>
          <th className={TH}>Failed</th>
          <th className={TH}>Input tok.</th>
          <th className={TH}>Output tok.</th>
          <th className={TH}>Rate / 1M</th>
          <th className="px-4 py-2 font-semibold text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {d.llm.models.map((m) => (
          <tr key={m.model} className={`border-b border-slate-50 ${m.calls === 0 ? 'text-slate-400' : ''} ${side === 'governed' && m.noModel && m.calls > 0 ? TONE.guard.row : ''} ${premium(m) ? TONE.warn.row : ''} ${missing(m) ? TONE[missing(m)!.tone].row : ''}`}>
            <td className={`px-4 h-8 ${m.noModel ? '' : 'font-mono'} ${m.calls === 0 ? '' : m.noModel ? 'text-slate-600' : 'text-slate-800'}`} title={m.model}>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${missing(m) ? TONE[missing(m)!.tone].dot : m.calls === 0 ? 'bg-slate-200' : m.noModel ? (m.cached > 0 || side === 'governed' ? 'bg-emerald-500' : 'bg-rose-500') : modelColor(m.model)}`} />
                <span className={`min-w-0 break-words ${missing(m) ? 'text-slate-700' : ''}`}>{m.model}</span>
                {missing(m) && <span title={missing(m)!.title}><Pill tone={missing(m)!.tone}>{missing(m)!.text}</Pill></span>}
                {side === 'governed' && m.noModel && m.calls > 0 && !m.cached && <span title="Prompt attacks and unsafe requests were stopped before reaching a model"><Pill tone="guard">Unsafe stopped</Pill></span>}
                {side === 'governed' && m.noModel && m.cached > 0 && <Pill tone="guard">Paid once, reused</Pill>}
                {premium(m) && <span title="Every step uses the most expensive model, whatever the task"><Pill tone="warn">Premium model</Pill></span>}
              </span>
            </td>
            <td className={TD}>{count(m.calls, 'text-slate-700')}</td>
            <td className={TD}>{m.failed > 0 ? <span className={side === 'governed' && m.noModel ? 'text-emerald-700 font-semibold' : 'text-rose-700'}>{num(m.failed)}</span> : dash}</td>
            <td className={TD}>{m.calls ? tok(m.input) : dash}</td>
            <td className={TD}>{m.calls ? tok(m.output) : dash}</td>
            <td className={`${TD} text-slate-500`}>{m.noModel ? dash : rateText(m.rate)}</td>
            <td className={`px-4 h-8 text-right tabular-nums font-semibold whitespace-nowrap ${premium(m) ? 'text-rose-700' : 'text-slate-900'}`}>
              {m.calls === 0 ? dash : m.cached > 0 && m.noModel ? 'Not billed' : m.costUsd === null ? dash : formatUsd(m.costUsd)}
            </td>
          </tr>
        ))}
        <tr className="bg-slate-50">
          <td className="px-4 h-8 font-semibold text-slate-700">Total</td>
          <td className={`${TD} font-semibold text-slate-700`}>{tok(d.llm.calls)}</td>
          <td className={`${TD} font-semibold ${side === 'governed' && !d.llm.error ? 'text-emerald-700' : 'text-rose-700'}`}>{d.llm.limited + d.llm.blocked + d.llm.error || ''}</td>
          <td className={`${TD} font-semibold text-slate-700`}>{tok(d.llm.inputTokens)}</td>
          <td className={`${TD} font-semibold text-slate-700`}>{tok(d.llm.outputTokens)}</td>
          <td />
          <td className={`px-4 h-8 text-right tabular-nums font-bold ${side === 'governed' ? 'text-emerald-700' : 'text-rose-700'}`}>{d.llm.costUsd ? formatUsd(d.llm.costUsd) : null}</td>
        </tr>
      </tbody>
    </table>
  );
}

// 400/401/403 = the request was refused (restricted); 429/5xx = stopped by a limit or failed (warning).
// With governance, 400/401/403/429 are controls that stopped the call (protected); only timeouts and
// server errors are warnings.
const statusTone = (status: string, side: SideId): Tone =>
  side === 'governed' ? (/^4(00|01|03|29)$/.test(status) ? 'guard' : 'warn') : /^4(00|01|03)$/.test(status) ? 'bad' : 'warn';
const TONE_TEXT: Record<Tone, string> = { ok: 'text-emerald-700', guard: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700', idle: 'text-slate-400' };
const TONE_BAR: Record<Tone, string> = { ok: 'bg-emerald-500', guard: 'bg-emerald-700', warn: 'bg-amber-400', bad: 'bg-rose-500', idle: 'bg-slate-200' };

// Outcomes that come from a control on the governed side. When the ungoverned agent has none of
// them, that is a missing control, not a clean record.
const MISSING_OUTCOME: Record<string, { tone: 'warn' | 'bad'; text: string; title: string }> = {
  cached: { tone: 'warn', text: 'No answer reuse', title: 'Every call goes to the model and is paid for, even a repeat question' },
  '400': { tone: 'bad', text: 'No prompt-attack checks', title: 'Prompt attacks and unsafe requests are not checked; only the model provider can refuse them' },
};

function Outcomes({ d, side }: { d: SideData; side: SideId }) {
  const items: { key: string; label: string; n: number; tone: Tone }[] = [
    { key: 'ok', label: 'Answered by a model', n: d.llm.ok, tone: 'ok' },
    { key: 'cached', label: 'Reused a recent answer (no model cost)', n: d.llm.cached, tone: 'ok' },
    ...d.llm.statuses.map((st) => ({ key: st.status, label: `${st.label} (${st.status})`, n: st.calls, tone: statusTone(st.status, side) })),
  ];
  const missingFor = (key: string, n: number) => (side === 'baseline' && n === 0 ? MISSING_OUTCOME[key] : undefined);
  const total = items.reduce((a, x) => a + x.n, 0);
  return (
    <ul className="px-4 py-1 text-xs">
      <li className="flex h-2 my-2 rounded-full overflow-hidden bg-slate-100" title="Share of model calls by outcome">
        {total > 0 && items.filter((x) => x.n > 0).map((x) => (
          <span key={x.key} className={`${TONE_BAR[x.tone]} ${x.key === 'cached' ? 'opacity-60' : ''}`} style={{ width: `${(x.n / total) * 100}%` }} title={`${x.label}: ${x.n}`} />
        ))}
      </li>
      {items.map((x) => (
        (() => {
          const miss = missingFor(x.key, x.n);
          return (
            <li key={x.key} className={`flex items-center gap-2 h-6 -mx-4 px-4 ${miss ? TONE[miss.tone].row : x.tone === 'guard' && x.n ? TONE.guard.row : ''}`}>
              <Dot tone={miss ? miss.tone : x.n ? x.tone : 'idle'} />
              <span className={`min-w-0 break-words ${x.n || miss ? 'text-slate-700' : 'text-slate-400'}`} title={x.label}>{x.label}</span>
              {miss && <span title={miss.title}><Pill tone={miss.tone}>{miss.text}</Pill></span>}
              <span className="flex-1" />
              {count(x.n, `font-semibold ${TONE_TEXT[x.tone]}`)}
            </li>
          );
        })()
      ))}
      <li className="flex items-center gap-2 h-6 text-slate-500">
        <span className="flex-1">Average model call time</span>
        <span className="tabular-nums">{formatMs(d.llm.avgLatencyMs ?? NaN)}</span>
      </li>
    </ul>
  );
}

// The governed agent is not authorized for this server/tool: every attempt is blocked, so it is
// highlighted as a prevented access rather than an empty row.
const notOnKey = (cols: number, text = 'Blocked: not authorized for this agent') => (
  <td colSpan={cols} className="px-4 h-8 text-right whitespace-nowrap" title="Unauthorized access prevented: this agent is not authorized for it, so it cannot see or call it">
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
      <ShieldX className="w-3 h-3" /> {text}
    </span>
  </td>
);

function ServersTable({ d, other }: { d: SideData; other?: SideData }) {
  if (!d.mcp.servers.length) return <p className="px-4 py-3 text-xs text-slate-500">No MCP calls in this period.</p>;
  return (
    <table className="w-full text-xs table-fixed">
      <colgroup>
        <col />
        <col className="w-[56px]" />
        <col className="w-[48px]" />
        <col className="w-[68px]" />
        <col className="w-[56px]" />
        <col className="w-[92px]" />
      </colgroup>
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th className="px-4 py-2 font-semibold">MCP server</th>
          <th className={TH}>Calls</th>
          <th className={TH}>OK</th>
          <th className={TH}>Blocked</th>
          <th className={TH}>Errors</th>
          <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Avg time</th>
        </tr>
      </thead>
      <tbody>
        {d.mcp.servers.map((sv) => {
          const unauthorizedUse = !!other && sv.calls > 0 && other.mcp.servers.some((o) => o.proxy === sv.proxy && !o.available);
          const stopped = sv.denied + sv.limited + sv.rejected;
          const tone: Tone = !sv.available || unauthorizedUse ? 'bad' : !sv.calls ? 'idle' : sv.error > 0 ? 'warn' : stopped > 0 && other ? 'warn' : 'ok';
          return (
          <tr key={sv.proxy} className={`border-b border-slate-50 last:border-0 ${TONE[tone].row}`}>
            <td className="px-4 h-8 text-slate-800" title={`${sv.label} (${sv.proxy}) - ${TONE[tone].label}`}>
              <span className="flex items-center gap-1.5 min-w-0">
                <Dot tone={tone} />
                <span className="min-w-0 break-words">{sv.label} <span className="font-mono text-[10px] text-slate-400">{sv.proxy}</span></span>
                {unauthorizedUse && <Pill tone="bad">Unauthorized access</Pill>}
              </span>
            </td>
            {sv.available ? (
              <>
                <td className={TD}>{count(sv.calls, 'text-slate-700')}</td>
                <td className={TD}>{count(sv.ok, 'text-emerald-700')}</td>
                <td className={TD}>{count(stopped, 'text-amber-700')}</td>
                <td className={TD}>{count(sv.error, 'text-rose-700')}</td>
                <td className="px-4 h-8 text-right tabular-nums text-slate-500 whitespace-nowrap">{sv.calls ? formatMs(sv.avgLatencyMs ?? NaN) : dash}</td>
              </>
            ) : notOnKey(5, sv.calls > 0 ? `Blocked: not authorized · ${sv.calls} refused` : undefined)}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Business limits the governed agent's controls apply to a tool it IS authorized for. Shown on the
// governed side only, next to the tool, so the Blocked count there reads as "over the limit", not
// "tool refused". (Tools it is not authorized for show "Not authorized for this agent" instead.)
const TOOL_LIMITS: Record<string, string> = { issueRefund: 'Refunds over $50 blocked' };

// What the ungoverned agent did with a tool that has a business limit under governance.
const NO_LIMIT_RISK: Record<string, string> = { issueRefund: 'No refund limit' };

function ToolsTable({ d, error, governed, other }: { d: SideData; error: string | null; governed: boolean; other?: SideData }) {
  if (error) return <p className="px-4 py-3 text-xs text-amber-700 break-words">Tool names unavailable: {error}. Refresh in a minute.</p>;
  if (!d.tools.length) return <p className="px-4 py-3 text-xs text-slate-500">No tool calls in this period.</p>;
  return (
    <table className="w-full text-xs table-fixed">
      <colgroup>
        <col />
        <col className="w-[112px]" />
        <col className="w-[56px]" />
        <col className="w-[48px]" />
        <col className="w-[68px]" />
        <col className="w-[80px]" />
      </colgroup>
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th className="px-4 py-2 font-semibold">MCP tool</th>
          <th className="px-2 py-2 font-semibold">Server</th>
          <th className={TH}>Calls</th>
          <th className={TH}>OK</th>
          <th className={TH}>Blocked</th>
          <th className="px-4 py-2 font-semibold text-right">Errors</th>
        </tr>
      </thead>
      <tbody>
        {d.tools.map((t) => {
          const o = other?.tools.find((x) => x.server === t.server && x.tool === t.tool);
          // Ungoverned side: used a tool the governed agent is not authorized for, or used a limited tool with no limit.
          const unauthorizedUse = !governed && t.calls > 0 && !!o && !o.available;
          const noLimit = !governed && t.ok > 0 && !!o && o.available ? NO_LIMIT_RISK[t.tool] : undefined;
          const tone: Tone = !t.available || unauthorizedUse ? 'bad' : !t.calls ? 'idle' : t.failed > 0 || noLimit ? 'warn' : t.blocked > 0 && !governed ? 'warn' : 'ok';
          return (
          <tr key={`${t.server}:${t.tool}`} className={`border-b border-slate-50 last:border-0 ${TONE[tone].row}`}>
            <td className="px-4 h-8" title={`${t.tool} - ${TONE[tone].label}`}>
              {(() => {
                const flag = governed && t.available ? TOOL_LIMITS[t.tool] : undefined;
                return (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Dot tone={tone} />
                    <span className={`font-mono min-w-0 break-all ${!t.available || t.calls ? 'text-slate-800' : 'text-slate-400'}`}>{t.tool}</span>
                    {flag && <Pill tone="warn">{flag}</Pill>}
                    {unauthorizedUse && <Pill tone="bad">Unauthorized access</Pill>}
                    {noLimit && <Pill tone="warn">{noLimit}</Pill>}
                  </span>
                );
              })()}
            </td>
            <td className="px-2 h-8 font-mono text-[11px] text-slate-500 break-all" title={t.serverLabel}>{t.server}</td>
            {t.available ? (
              <>
                <td className={TD}>{count(t.calls, 'text-slate-700')}</td>
                <td className={TD}>{count(t.ok, 'text-emerald-700')}</td>
                <td className={TD}>{count(t.blocked, 'text-amber-700')}</td>
                <td className="px-4 h-8 text-right tabular-nums whitespace-nowrap">{count(t.failed, 'text-rose-700')}</td>
              </>
            ) : notOnKey(4, 'Blocked: not authorized')}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const SectionTitle = ({ icon, children, border = true }: { icon: React.ReactNode; children: React.ReactNode; border?: boolean }) => (
  <div className={`flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-slate-700 ${border ? 'border-t border-slate-100' : ''}`}>
    {icon} {children}
  </div>
);

export const AgentAnalytics: React.FC<{ header?: React.ReactNode }> = ({ header }) => {
  const [env, setEnv] = useState<Env>(lastQuery.env);
  const [range, setRange] = useState<Range>(lastQuery.range);
  const [stats, setStats] = useState<AgentStats | null>(lastStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (e: Env, r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/agent-stats?env=${e}&timeRange=${r}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      lastStats = data as AgentStats;
      lastQuery = { env: e, range: r };
      setStats(lastStats);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!lastStats || lastQuery.env !== env || lastQuery.range !== range) load(env, range);
  }, [env, range, load]);

  const b = stats?.sides.baseline;
  const g = stats?.sides.governed;

  return (
    <>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {header ?? <h2 className="text-base font-bold text-slate-800">Agent Analytics</h2>}
            <span className="text-xs text-slate-500">
              Every run of the two agents, as Apigee recorded it: model calls, tokens, cost and MCP calls.
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                {(['prod', 'dev'] as Env[]).map((x) => (
                  <button key={x} type="button" onClick={() => setEnv(x)} disabled={loading}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${env === x ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}>
                    {x === 'prod' ? 'Prod' : 'Dev'}
                  </button>
                ))}
              </div>
              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                {(['24h', '7d', '30d'] as Range[]).map((x) => (
                  <button key={x} type="button" onClick={() => setRange(x)} disabled={loading}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${range === x ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}>
                    {x === '24h' ? '24 hours' : x === '7d' ? '7 days' : '30 days'}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => load(env, range)} disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-60">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-rose-700 break-words">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Could not load agent analytics: {error}
            </p>
          )}

          {b && g && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                <Kpi label="Model cost" b={b.llm.costUsd} g={g.llm.costUsd} fmt={formatUsd} accent="border-t-emerald-500" icon={<DollarSign className="w-3.5 h-3.5 text-emerald-600" />} />
                <Kpi label="Input tokens" b={b.llm.inputTokens} g={g.llm.inputTokens} fmt={formatTokens} accent="border-t-violet-500" icon={<Download className="w-3.5 h-3.5 text-violet-600" />} />
                <Kpi label="Output tokens" b={b.llm.outputTokens} g={g.llm.outputTokens} fmt={formatTokens} accent="border-t-fuchsia-500" icon={<Upload className="w-3.5 h-3.5 text-fuchsia-600" />} />
                <Kpi label="Model calls" b={b.llm.calls} g={g.llm.calls} fmt={num} lowerIsBetter={false} accent="border-t-sky-500" icon={<Cpu className="w-3.5 h-3.5 text-sky-600" />} />
                <Kpi label="Avg model call time" b={b.llm.avgLatencyMs ?? NaN} g={g.llm.avgLatencyMs ?? NaN} fmt={formatMs} accent="border-t-amber-500" icon={<Clock className="w-3.5 h-3.5 text-amber-600" />} />
                <Kpi label="MCP calls" b={b.mcp.calls} g={g.mcp.calls} fmt={num} lowerIsBetter={false} accent="border-t-teal-500" icon={<Wrench className="w-3.5 h-3.5 text-teal-600" />} />
              </div>
              {(stats!.unpriced.length > 0 || stats!.ratesError) && (
                <p className="text-[11px] text-amber-700 break-words">
                  {stats!.ratesError
                    ? `Rate card unavailable (${stats!.ratesError}); costs show as $0.`
                    : `No rate in the ai-model-rates card for: ${stats!.unpriced.join(', ')}. Those calls are not priced.`}
                </p>
              )}
            </>
          )}
          {!stats && loading && <p className="text-xs text-slate-500">Loading Apigee analytics…</p>}
        </section>

        {stats && b && g && (
          <>
            <Trend stats={stats} />

            {/* Five shared rows (header, models, outcomes, servers, tools); each card spans them with subgrid. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-4 xl:gap-y-0">
              {SIDES.map((s) => {
                const meta = SIDE_META[s];
                const d = stats.sides[s];
                return (
                  <section key={s} className="[grid-row:span_5] grid [grid-template-rows:subgrid] rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                    <header className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b ${meta.head}`}>
                      {meta.icon}
                      <h3 className={`text-sm font-bold ${meta.accent}`}>{meta.label}</h3>
                      <span className="text-[11px] text-slate-500">{meta.note}</span>
                    </header>
                    <div>
                      <SectionTitle icon={<Cpu className="w-3.5 h-3.5 text-violet-600" />} border={false}>Models and cost</SectionTitle>
                      <ModelsTable d={d} side={s} />
                    </div>
                    <div>
                      <SectionTitle icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}>What happened to each model call</SectionTitle>
                      <Outcomes d={d} side={s} />
                    </div>
                    <div>
                      <SectionTitle icon={<Server className="w-3.5 h-3.5 text-sky-600" />}>MCP calls by server <Legend side={s} /></SectionTitle>
                      <ServersTable d={d} other={s === 'baseline' ? stats.sides.governed : undefined} />
                    </div>
                    <div className="pb-2">
                      <SectionTitle icon={<Wrench className="w-3.5 h-3.5 text-teal-600" />}>MCP tools used <Legend side={s} /></SectionTitle>
                      <ToolsTable d={d} error={stats.toolsError} governed={s === 'governed'} other={s === 'baseline' ? stats.sides.governed : undefined} />
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 text-[11px] text-slate-600 space-y-1.5">
              <p>
                <span className="font-semibold text-slate-700">Where this comes from.</span> Apigee records every model and tool call
                both agents make, including the ungoverned one, so the history is complete even for calls that were blocked. Both agents
                are priced from the same price list; reused answers are not billed.
              </p>
              <p>
                Tool names come from the tool-call logs
                {stats.toolsTruncated ? ', limited to the latest 3,000 calls' : ''}.{' '}
                <a href={stats.toolsConsoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-700 hover:underline">
                  Open in Logs Explorer <ExternalLink className="w-3 h-3" />
                </a>
              </p>
              {stats.handshakes > 0 && (
                <p>{num(stats.handshakes)} tool-server connection set-ups are not counted above: they happen before the agent identifies itself, so they belong to neither agent.</p>
              )}
              <p className="text-slate-500">
                {new Date(stats.since).toLocaleString()} to {new Date(stats.until).toLocaleString()} · {stats.env === 'prod' ? 'Prod' : 'Dev'} environment. Apigee Analytics can lag a few minutes behind a run.
              </p>
            </section>
          </>
        )}
    </>
  );
};

export default AgentAnalytics;
