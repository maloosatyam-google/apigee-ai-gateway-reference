import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  LineChart,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Square,
  Trash2,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';
import { AgentComparison } from './AgentComparison';
import { AgentBurst } from './AgentBurst';
import { AgentAnalytics } from './AgentAnalytics';
import { fetchModelRates } from '../services/api';
import { resetDemoData } from '../services/demoData';
import { useCustomerTheme } from './CustomerThemeProvider';
import { industryPackFor, showcaseScenariosFor } from '../utils/industryPacks';
import {
  BASELINE_MODELS,
  DEFAULT_BASELINE_MODEL,
  GOVERNANCE_LABELS,
  SHOWCASE_SCENARIOS,
  SHOWCASE_SIDES,
  addToLedger,
  addToScoreboard,
  emptyLedger,
  emptyRun,
  emptyScoreboard,
  formatMs,
  formatUsd,
  isRefusedHop,
  parseSseChunk,
  ratio,
  reduceShowcaseEvent,
  sideSummary,
  visibleItems,
} from '../utils/agentShowcase';
import type {
  ShowcaseItem,
  ShowcaseLedger,
  ShowcaseRunState,
  ShowcaseScoreboard,
  ShowcaseSideId,
  ShowcaseSideState,
  ShowcaseSummary,
} from '../utils/agentShowcase';

/*
  Agent Showcase: one prompt, two ADK agents at once (agents/ -> agent-showcase-api).
  Left  = "Regular Gateway (Without AI governance)": Gemini Pro through the bare llm-passthrough-v1 proxy
          (recorded in Apigee analytics and logs, nothing enforced), every tool the org has.
  Right = "With AI & Tools Governance": the /ai/v1/auto gateway, only the Customer Service tools.
  Both sides are priced from the same ai-model-rates KVM so only the agent design differs.
*/

type Rates = Record<string, { input?: number; output?: number }> | null;

// Kept at module level so switching tabs and back keeps the last run and the scoreboard.
let lastRun: ShowcaseRunState = emptyRun();
let lastPrompt = '';
let lastScenarioId: string | null = null;
const SCOREBOARD_KEY = 'agentShowcase.scoreboard';
const LEDGER_KEY = 'agentShowcase.ledger';
let lastView: 'live' | 'compare' = 'live';
// Which page of the tab is open: the live showcase or the agents' history (Agent Analytics).
let lastPage: 'showcase' | 'analytics' = 'showcase';
// Scenario 7 quota burst: several governed-only runs at once, shown instead of the two columns.
let lastBurst: ShowcaseRunState[] | null = null;
let lastMode: 'pair' | 'burst' = 'pair';
let lastBaselineModel = DEFAULT_BASELINE_MODEL;

/** POST one run and feed its streamed events to `onEvents` until the stream ends. */
async function streamRun(body: object, signal: AbortSignal, onEvents: (events: any[]) => void): Promise<void> {
  const res = await fetch('/api/agent-showcase/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    if (events.length) onEvents(events);
  }
}

function loadScoreboard(): ShowcaseScoreboard {
  try {
    const raw = sessionStorage.getItem(SCOREBOARD_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore unreadable storage
  }
  return emptyScoreboard();
}

function loadLedger(): ShowcaseLedger {
  try {
    const raw = sessionStorage.getItem(LEDGER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore unreadable storage
  }
  return emptyLedger();
}

const SIDE_STYLE: Record<ShowcaseSideId, { accent: string; chip: string; border: string; icon: React.ReactNode; blurb: string }> = {
  baseline: {
    accent: 'text-slate-700',
    chip: 'bg-slate-100 text-slate-700 border-slate-200',
    border: 'border-slate-300',
    icon: <Bot className="w-4 h-4 text-slate-500" />,
    blurb: 'No controls: one fixed model for every step, access to every tool in the organization, and no limits or safety checks. Its calls are still recorded.',
  },
  governed: {
    accent: 'text-blue-700',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    border: 'border-blue-300',
    icon: <ShieldCheck className="w-4 h-4 text-blue-600" />,
    blurb: 'Governed: only the tools it is authorized for, usage and business limits, safety checks, and a right-sized model for each step.',
  },
};

const GOOD_GOVERNANCE = new Set(['routed', 'cache_hit']);

function StatusBadge({ side }: { side: ShowcaseSideState }) {
  if (side.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Loader2 className="w-3 h-3 animate-spin" /> Working…
      </span>
    );
  }
  if (side.status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" /> Finished in {formatMs(side.finishedMs)}
      </span>
    );
  }
  if (side.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-3 h-3" /> Stopped after {formatMs(side.finishedMs)}
      </span>
    );
  }
  return null;
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="mt-1 p-2 rounded-md bg-slate-50 border border-slate-200 text-[10.5px] leading-relaxed font-mono text-slate-700 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
      {text}
    </pre>
  );
}

function TimelineItem({ item }: { item: ShowcaseItem }) {
  if (item.kind === 'llm') {
    const failed = item.status !== 200;
    const modelLabel = item.model || item.requested_model;
    return (
      <li className={`rounded-lg border px-3 py-2 ${failed ? 'border-rose-200 bg-rose-50/50' : 'border-violet-200 bg-violet-50/40'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Cpu className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          <span className="font-semibold text-slate-800">Model step {item.step}</span>
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-violet-200 text-violet-700">{modelLabel}</span>
          {item.auto_routed && item.requested_model !== item.model && (
            <span className="text-[11px] text-slate-500">right-sized for this step</span>
          )}
          {item.route_category && <span className="text-[11px] text-slate-500">· {item.route_category}</span>}
          {item.via === 'apigee_passthrough' && <span className="text-[11px] text-slate-500">· recorded, no controls</span>}
          {item.cache === 'HIT' && (
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Cache hit · not billed</span>
          )}
          <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{formatMs(item.latency_ms)}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-600 tabular-nums">
          {item.tokens.prompt.toLocaleString()} tokens in · {item.tokens.output.toLocaleString()} out
          {item.tokens.thoughts > 0 && ` (incl. ${item.tokens.thoughts.toLocaleString()} thinking)`}
          {item.function_calls && item.function_calls.length > 0 && <> · decided to call {item.function_calls.join(', ')}</>}
        </div>
        {failed && item.error && <div className="mt-1 text-[11px] text-rose-700 break-words">HTTP {item.status}: {item.error}</div>}
      </li>
    );
  }
  if (item.kind === 'tool') {
    const r = item.result;
    const failed = !!r?.is_error;
    return (
      <li className={`rounded-lg border px-3 py-2 ${failed ? 'border-rose-200 bg-rose-50/50' : 'border-cyan-200 bg-cyan-50/40'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Wrench className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
          <span className="font-semibold text-slate-800">Tool</span>
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-cyan-200 text-cyan-800">{item.call.name}</span>
          {(r?.server || item.call.server) && <span className="text-[11px] text-slate-500">on {r?.server || item.call.server}</span>}
          {!r && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
          {r && (
            <span className={`text-[11px] font-semibold ${failed ? 'text-rose-700' : 'text-emerald-700'}`}>
              {failed ? `Refused (HTTP ${r.http_status})` : `OK (HTTP ${r.http_status})`}
            </span>
          )}
          {r && <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{formatMs(r.latency_ms)}</span>}
        </div>
        <details className="mt-1 text-[11px] text-slate-600">
          <summary className="cursor-pointer select-none hover:text-slate-900">Arguments{r ? ' and result' : ''}</summary>
          <JsonBlock value={item.call.args} />
          {r && <JsonBlock value={r.result} />}
        </details>
      </li>
    );
  }
  if (item.kind === 'governance') {
    const good = GOOD_GOVERNANCE.has(item.govKind);
    return (
      <li className={`rounded-lg border px-3 py-2 ${good ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-300 bg-amber-50'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {good ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
          <span className={`font-semibold ${good ? 'text-emerald-800' : 'text-amber-800'}`}>{GOVERNANCE_LABELS[item.govKind] || item.govKind}</span>
          {item.tool && <span className="font-mono text-[11px] text-slate-600">{item.tool}</span>}
          {item.status ? <span className="text-[11px] text-slate-500">HTTP {item.status}</span> : null}
        </div>
        {item.detail && <div className="mt-1 text-[11px] text-slate-700 break-words">{item.detail}</div>}
      </li>
    );
  }
  // Tool server refused for this agent's key: it never sees that server's tools.
  if (isRefusedHop(item)) {
    return (
      <li className="px-3 py-1.5 text-[11px] bg-rose-50 border-l-2 border-rose-400 flex flex-wrap items-center gap-x-2" title="The gateway refused to list this server's tools for this agent's key">
        <ShieldX className="w-3.5 h-3.5 text-rose-600 shrink-0" />
        <span className="font-semibold text-rose-800">Refused: not authorized for this agent</span>
        <span className="text-rose-700">{item.server}</span>
        <span className="text-slate-500">tools/list · HTTP {item.status}</span>
        <span className="ml-auto tabular-nums text-slate-500">{formatMs(item.latency_ms)}</span>
      </li>
    );
  }
  // Protocol hop (initialize, tools/list, …)
  return (
    <li className="px-3 py-1 text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
      <span className="font-mono">{item.method}</span>
      <span>→ {item.server}</span>
      <span>HTTP {item.status}</span>
      {typeof item.tools === 'number' && <span>· {item.tools} tools listed</span>}
      <span className="ml-auto tabular-nums">{formatMs(item.latency_ms)}</span>
    </li>
  );
}

/** Model switch for the "Regular Gateway (Without AI governance)" agent, with each model's KVM rate. */
function BaselineModelPicker({ value, onChange, disabled, rates }: { value: string; onChange: (m: string) => void; disabled: boolean; rates: Rates }) {
  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
      <span className="font-semibold text-slate-700">Model</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
      >
        {BASELINE_MODELS.map((m) => {
          const r = rates?.[m.id];
          const price = r && Number.isFinite(Number(r.input)) ? ` · $${Number(r.input)} / $${Number(r.output)} per 1M tokens` : '';
          return (
            <option key={m.id} value={m.id}>
              {m.label}{price}
            </option>
          );
        })}
      </select>
      <span className="text-slate-400">used for every step of this agent</span>
    </label>
  );
}

function SideColumn({ side, showHops, picker }: { side: ShowcaseSideState; showHops: boolean; picker?: React.ReactNode }) {
  const style = SIDE_STYLE[side.side];
  const items = visibleItems(side.items, showHops);
  return (
    <section className={`flex flex-col min-w-0 rounded-2xl border-2 ${style.border} bg-white shadow-xs`}>
      <header className="px-4 py-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          {style.icon}
          <h2 className={`text-sm font-bold ${style.accent}`}>{side.label}</h2>
          <StatusBadge side={side} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{style.blurb}</p>
        {picker}
        {(side.llm || side.toolsOffered.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {side.llm && <span className={`px-2 py-0.5 rounded-full border ${style.chip}`}>Model: {side.llm}</span>}
            {side.toolsOffered.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full border ${style.chip}`} title={side.toolsOffered.join(', ')}>
                {side.toolsOffered.length} tools offered
              </span>
            )}
            {side.mcpServers.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full border ${style.chip}`}>
                {side.mcpServers.length} tool server{side.mcpServers.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="px-4 py-3 space-y-3">
        {side.status === 'idle' && items.length === 0 && (
          <p className="text-xs text-slate-400">Pick a scenario or type a prompt, then press Run.</p>
        )}
        {items.length > 0 && (
          <ol className="space-y-1.5">
            {items.map((it, i) => (
              <TimelineItem key={i} item={it} />
            ))}
          </ol>
        )}
        {(side.answer || side.error) && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Agent answer</div>
            {side.answer && (
              <div className="text-sm text-slate-800">
                <MarkdownMessage text={side.answer} compact />
              </div>
            )}
            {side.error && <p className="text-xs text-rose-700 break-words">{side.error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// Lower is better for every measured row (cost, time, tokens). null = no clear difference.
const winner = (b: number, g: number): ShowcaseSideId | null => {
  const r = ratio(b, g);
  if (r === null || Math.abs(r - 1) < 0.05) return null;
  return r > 1 ? 'governed' : 'baseline';
};
// Green for the side that did better on a row, red for the other.
const WIN_CELL = 'text-emerald-700 font-semibold';
const LOSE_CELL = 'text-rose-700 font-semibold';

function Ratio({ b, g }: { b: number; g: number }) {
  const w = winner(b, g);
  if (!w) return null;
  const r = ratio(b, g) as number;
  const shown = r >= 1 ? r : 1 / r;
  const less = w === 'governed';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${less ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
      {shown.toFixed(shown >= 10 ? 0 : 1)}× {less ? 'less' : 'more'} with governance
    </span>
  );
}

function ComparisonCard({ run, summaries, ratesError }: { run: ShowcaseRunState; summaries: Record<ShowcaseSideId, ShowcaseSummary>; ratesError: string | null }) {
  const b = summaries.baseline;
  const g = summaries.governed;
  const unpriced = [...new Set([...b.unpriced, ...g.unpriced])];
  const bMs = b.e2eMs ?? 0;
  const gMs = g.e2eMs ?? 0;
  const timed = bMs > 0 && gMs > 0;
  const rows: { label: string; b: React.ReactNode; g: React.ReactNode; cmp?: React.ReactNode; win?: ShowcaseSideId | null }[] = [
    { label: 'Cost (same prices)', b: formatUsd(b.costUsd), g: formatUsd(g.costUsd), cmp: <Ratio b={b.costUsd} g={g.costUsd} />, win: winner(b.costUsd, g.costUsd) },
    { label: 'Time to answer', b: formatMs(b.e2eMs), g: formatMs(g.e2eMs), cmp: timed ? <Ratio b={bMs} g={gMs} /> : null, win: timed ? winner(bMs, gMs) : null },
    {
      label: 'Tokens sent / received',
      b: `${b.promptTokens.toLocaleString()} / ${b.outputTokens.toLocaleString()}`,
      g: `${g.promptTokens.toLocaleString()} / ${g.outputTokens.toLocaleString()}`,
      cmp: <Ratio b={b.promptTokens} g={g.promptTokens} />,
      win: winner(b.promptTokens, g.promptTokens),
    },
    { label: 'Models used', b: b.models.join(', ') || '—', g: g.models.join(', ') || '—' },
    { label: 'Model steps', b: b.llmSteps, g: g.llmSteps },
    { label: 'Tools offered to the agent', b: b.toolsOffered, g: g.toolsOffered },
    {
      label: 'Tools called',
      b: b.toolsCalled.length ? `${b.toolsCalled.join(', ')}${b.toolErrors ? ` (${b.toolErrors} refused)` : ''}` : '—',
      g: g.toolsCalled.length ? `${g.toolsCalled.join(', ')}${g.toolErrors ? ` (${g.toolErrors} refused)` : ''}` : '—',
    },
    { label: 'Cache hits', b: b.cacheHits, g: g.cacheHits },
    {
      label: 'Controls applied',
      b: b.governance.map((k) => GOVERNANCE_LABELS[k] || k).join(', ') || 'None',
      g: g.governance.map((k) => GOVERNANCE_LABELS[k] || k).join(', ') || 'None',
    },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <header className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">This run, side by side</h2>
        {run.prompt && <span className="text-[11px] text-slate-500 break-words">“{run.prompt}”</span>}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-semibold">Measure</th>
              <th className="px-4 py-2 font-semibold">Regular Gateway (Without AI governance)</th>
              <th className="px-4 py-2 font-semibold text-blue-700">With AI & Tools Governance</th>
              <th className="px-4 py-2 font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100 align-top">
                <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">{r.label}</td>
                <td className={`px-4 py-1.5 tabular-nums break-words ${!r.win ? 'text-slate-800' : r.win === 'baseline' ? WIN_CELL : LOSE_CELL}`}>{r.b}</td>
                <td className={`px-4 py-1.5 tabular-nums break-words ${!r.win ? 'text-slate-800' : r.win === 'governed' ? WIN_CELL : LOSE_CELL}`}>{r.g}</td>
                <td className="px-4 py-1.5 text-[11px]">{r.cmp ?? null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(unpriced.length > 0 || ratesError) && (
        <p className="px-4 py-2 border-t border-slate-100 text-[11px] text-amber-700">
          {ratesError ? `Rate card unavailable (${ratesError}); costs show as $0.` : `No rate in the ai-model-rates card for: ${unpriced.join(', ')}. Those steps are not priced.`}
        </p>
      )}
    </section>
  );
}

function Scoreboard({ board }: { board: ShowcaseScoreboard }) {
  if (board.runs === 0) return null;
  const b = board.sides.baseline;
  const g = board.sides.governed;
  const cells: { label: string; b: string; g: string }[] = [
    { label: 'Runs', b: String(b.runs), g: String(g.runs) },
    { label: 'Total cost', b: formatUsd(b.costUsd), g: formatUsd(g.costUsd) },
    { label: 'Average time', b: formatMs(b.runs ? b.e2eMs / b.runs : null), g: formatMs(g.runs ? g.e2eMs / g.runs : null) },
    { label: 'Tokens sent', b: b.promptTokens.toLocaleString(), g: g.promptTokens.toLocaleString() },
    { label: 'Tool calls', b: String(b.toolCalls), g: String(g.toolCalls) },
    { label: 'Cache hits', b: String(b.cacheHits), g: String(g.cacheHits) },
    { label: 'Controls applied', b: String(b.governance), g: String(g.governance) },
  ];
  const saved = b.costUsd - g.costUsd;
  return (
    <section data-tour-id="agent-scoreboard" className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <header className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">Session scoreboard</h2>
        <span className="text-[11px] text-slate-500">{board.runs} run{board.runs === 1 ? '' : 's'} since the last Clear</span>
        {saved > 0 && <span className="ml-auto text-xs font-semibold text-emerald-700">Governance saved {formatUsd(saved)} so far</span>}
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-slate-100">
        {cells.map((c) => (
          <div key={c.label} className="bg-white px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-0.5 text-xs tabular-nums text-slate-700">Without: {c.b}</div>
            <div className="text-xs tabular-nums font-semibold text-blue-700">With: {c.g}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export const AgentShowcase: React.FC = () => {
  const [prompt, setPrompt] = useState(lastPrompt);
  const [run, setRun] = useState<ShowcaseRunState>(lastRun);
  const [board, setBoard] = useState<ShowcaseScoreboard>(loadScoreboard);
  const [ledger, setLedger] = useState<ShowcaseLedger>(loadLedger);
  const [view, setView] = useState<'live' | 'compare'>(lastView);
  const [page, setPage] = useState<'showcase' | 'analytics'>(lastPage);
  const [rates, setRates] = useState<Rates>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [showHops, setShowHops] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [burst, setBurst] = useState<ShowcaseRunState[] | null>(lastBurst);
  const [mode, setMode] = useState<'pair' | 'burst'>(lastMode);
  const [baselineModel, setBaselineModel] = useState(lastBaselineModel);
  const modelBeforeScenarioRef = useRef<string | null>(null);
  const burstAbortRef = useRef<AbortController[]>([]);
  const countedBurstRef = useRef<Set<string>>(new Set((lastBurst || []).filter((r) => r.status !== 'running' && r.runId).map((r) => r.runId as string)));
  const countedRunRef = useRef<string | null>(lastRun.status === 'done' ? lastRun.runId : null);

  const [burstActive, setBurstActive] = useState(false);
  const burstRunning = burstActive || !!burst?.some((r) => r.status === 'running');
  const running = run.status === 'running' || burstRunning;
  const [scenarioId, setScenarioId] = useState<string | null>(lastScenarioId);
  // The theme's industry: with a pack, both agents use its instruction and MCP server
  // (agent service) and the scenarios use its prompts. No pack -> the generic demo.
  const { theme } = useCustomerTheme();
  const pack = industryPackFor(theme.industry);
  const scenarios = useMemo(() => showcaseScenariosFor(SHOWCASE_SCENARIOS, pack), [pack]);
  const industry = useMemo(() => (pack ? { industry: pack.id } : {}), [pack]);
  const scenario = scenarios.find((s) => s.id === scenarioId && s.prompt === prompt.trim()) ?? null;
  useEffect(() => {
    lastScenarioId = scenarioId;
  }, [scenarioId]);

  useEffect(() => {
    lastRun = run;
  }, [run]);
  useEffect(() => {
    lastPrompt = prompt;
  }, [prompt]);
  useEffect(() => {
    lastView = view;
  }, [view]);
  useEffect(() => {
    lastPage = page;
  }, [page]);
  useEffect(() => {
    lastBurst = burst;
  }, [burst]);
  useEffect(() => {
    lastMode = mode;
  }, [mode]);
  useEffect(() => {
    lastBaselineModel = baselineModel;
  }, [baselineModel]);
  useEffect(() => {
    try {
      sessionStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    } catch {
      // storage full or disabled: the comparison still works for this view
    }
  }, [ledger]);
  useEffect(() => {
    try {
      sessionStorage.setItem(SCOREBOARD_KEY, JSON.stringify(board));
    } catch {
      // storage full or disabled: the scoreboard still works for this view
    }
  }, [board]);

  useEffect(() => {
    let cancelled = false;
    fetchModelRates('prod')
      .then((r) => !cancelled && setRates(r.rates as unknown as Rates))
      .catch((e) => !cancelled && setRatesError(e?.message || String(e)));
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      burstAbortRef.current.forEach((c) => c.abort());
    };
  }, []);

  const summaries = useMemo(
    () =>
      Object.fromEntries(SHOWCASE_SIDES.map((s) => [s, sideSummary(run.sides[s], rates)])) as Record<ShowcaseSideId, ShowcaseSummary>,
    [run, rates],
  );

  // Count each finished run once on the scoreboard.
  useEffect(() => {
    if (run.status !== 'done' || !run.runId || countedRunRef.current === run.runId) return;
    countedRunRef.current = run.runId;
    const ran = Object.fromEntries(SHOWCASE_SIDES.filter((s) => run.sides[s].status !== 'idle').map((s) => [s, summaries[s]]));
    setBoard((prev) => addToScoreboard(prev, ran));
    setLedger((prev) => addToLedger(prev, run));
  }, [run, summaries]);

  // Each finished burst run goes into the agent comparison (governed side only), once.
  useEffect(() => {
    const fresh = (burst || []).filter((r) => (r.status === 'done' || r.status === 'error') && r.runId && !countedBurstRef.current.has(r.runId));
    if (!fresh.length) return;
    fresh.forEach((r) => countedBurstRef.current.add(r.runId as string));
    setLedger((prev) => fresh.reduce((l, r) => addToLedger(l, r), prev));
  }, [burst]);

  const start = useCallback(async () => {
    const text = prompt.trim();
    if (!text || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRequestError(null);
    setNotice(null);
    setMode('pair');
    setRun({ ...emptyRun(), prompt: text, status: 'running' });
    try {
      const useCache = scenario?.useCache === false ? { useCache: false } : {};
      await streamRun({ prompt: text, sides: SHOWCASE_SIDES, baselineModel, ...useCache, ...industry }, controller.signal, (events) =>
        setRun((r) => events.reduce(reduceShowcaseEvent, r)),
      );
      // A stream that ends without its `done` event still ends the run.
      setRun((r) => (r.status === 'running' ? { ...r, status: 'done' } : r));
    } catch (e: any) {
      if (controller.signal.aborted) return;
      const msg = e?.message || String(e);
      setRequestError(msg);
      setRun((r) => ({ ...r, status: 'error', error: msg }));
    }
  }, [prompt, running, baselineModel, scenario, industry]);

  // Scenario 7: the governed agent alone, `n` runs back to back, semantic cache off. Not in
  // parallel: the gateway checks the quota when a model call starts and counts tokens when it
  // ends, so parallel runs would all pass the check before any of their tokens counted.
  const startBurst = useCallback(async (n: number) => {
    const text = prompt.trim();
    if (!text || running) return;
    abortRef.current?.abort();
    burstAbortRef.current.forEach((c) => c.abort());
    const controllers = Array.from({ length: n }, () => new AbortController());
    burstAbortRef.current = controllers;
    setRequestError(null);
    setNotice(null);
    setMode('burst');
    setBurstActive(true);
    setBurst(Array.from({ length: n }, () => ({ ...emptyRun(), prompt: text })));
    const update = (i: number, fn: (r: ShowcaseRunState) => ShowcaseRunState) =>
      setBurst((prev) => (prev ? prev.map((r, j) => (j === i ? fn(r) : r)) : prev));
    try {
      for (let i = 0; i < n; i++) {
        const controller = controllers[i];
        if (controller.signal.aborted) break;
        update(i, (r) => ({ ...r, status: 'running' }));
        try {
          await streamRun({ prompt: text, sides: ['governed'], useCache: false, ...industry }, controller.signal, (events) =>
            update(i, (r) => events.reduce(reduceShowcaseEvent, r)),
          );
          update(i, (r) => (r.status === 'running' ? { ...r, status: 'done' } : r));
        } catch (e: any) {
          if (controller.signal.aborted) break;
          const msg = e?.message || String(e);
          update(i, (r) => ({ ...r, status: 'error', error: msg }));
        }
      }
    } finally {
      setBurstActive(false);
    }
  }, [prompt, running, industry]);

  const stop = () => {
    abortRef.current?.abort();
    burstAbortRef.current.forEach((c) => c.abort());
    setBurst((prev) => (prev ? prev.map((r) => (r.status === 'running' || r.status === 'idle' ? { ...r, status: 'error', error: 'Stopped by the presenter.' } : r)) : prev));
    setBurstActive(false);
    setRun((r) => ({
      ...r,
      status: 'idle',
      sides: Object.fromEntries(
        SHOWCASE_SIDES.map((s) => [s, r.sides[s].status === 'running' ? { ...r.sides[s], status: 'error', error: 'Stopped by the presenter.' } : r.sides[s]]),
      ) as ShowcaseRunState['sides'],
    }));
  };

  const clearAll = () => {
    abortRef.current?.abort();
    burstAbortRef.current.forEach((c) => c.abort());
    setRun(emptyRun());
    setBurst(null);
    setMode('pair');
    countedBurstRef.current = new Set();
    setBoard(emptyScoreboard());
    setLedger(emptyLedger());
    countedRunRef.current = null;
    setRequestError(null);
    setNotice(null);
    setPrompt('');
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const { ok } = await resetDemoData();
      setNotice(ok ? (pack ? 'Demo data reset. Everything the agents changed is back to the start.' : 'Demo data reset. Orders, refunds and cases are back to the start.') : 'Could not reset the demo data. Try again in a moment.');
    } catch {
      setNotice('Could not reset the demo data. Try again in a moment.');
    } finally {
      setResetting(false);
    }
  };

  const hasRun = run.status !== 'idle' || SHOWCASE_SIDES.some((s) => run.sides[s].items.length > 0);
  const burstSize = scenario?.burst ?? 0;
  const go = () => (burstSize ? startBurst(burstSize) : start());

  // Page switch in the pane header: the live showcase, or both agents' history from Apigee.
  // The showcase stays mounted while Agent Analytics is open, so a running demo keeps streaming.
  const pageTabs = (
    <div data-tour-id="agent-page-tabs" className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200" role="tablist">
      {([
        ['showcase', 'Agent Showcase', <Bot key="i" className="w-4 h-4" />],
        ['analytics', 'Agent Analytics', <LineChart key="i" className="w-4 h-4" />],
      ] as const).map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={page === id}
          onClick={() => setPage(id)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-bold transition cursor-pointer ${
            page === id ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50 text-slate-900">
      {/* pb-20: the page scrolls past the fixed bottom-right "Guide me" pill instead of hiding data under it. */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-4 pb-20 space-y-4">
        {page === 'analytics' ? (
          <AgentAnalytics header={pageTabs} />
        ) : (
        <>
        {/* Prompt bar */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {pageTabs}
            <span
              className="inline-flex items-center text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white text-slate-700 border border-slate-300 shrink-0"
              title={pack
                ? `Both agents use the ${pack.label} tools (${pack.proxy} at ${pack.basePath}) plus BigQuery and ServiceNow. The key decides what each can use.`
                : 'No industry pack for this theme: generic Customer Service tools'}
            >
              Tools: {pack ? pack.label : 'Generic'}
            </span>
            <span className="text-xs text-slate-500">The same customer question goes to both agents at the same time.</span>
          </div>
          <div data-tour-id="agent-scenarios" className="flex flex-wrap gap-1.5">
            {scenarios.map((s) => {
              const active = scenario?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setPrompt(s.prompt);
                    setScenarioId(s.id);
                    // Scenario 8 switches the ungoverned agent to a cheaper model; picking another
                    // scenario afterwards puts back the model the presenter had.
                    if (s.baselineModel) {
                      if (!modelBeforeScenarioRef.current) modelBeforeScenarioRef.current = baselineModel;
                      setBaselineModel(s.baselineModel);
                    } else if (modelBeforeScenarioRef.current) {
                      setBaselineModel(modelBeforeScenarioRef.current);
                      modelBeforeScenarioRef.current = null;
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-700'
                  }`}
                >
                  {s.step}. {s.title}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  go();
                }
              }}
              rows={2}
              placeholder={`Ask as a customer, e.g. ${scenarios[0].prompt}`}
              className="flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex md:flex-col gap-2 shrink-0">
              {running ? (
                <button type="button" onClick={stop} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 cursor-pointer">
                  <Square className="w-4 h-4" /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={go}
                  disabled={!prompt.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {burstSize ? (
                    <>
                      <Zap className="w-4 h-4" /> Run burst ({burstSize}× With AI & Tools Governance)
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Run both
                    </>
                  )}
                </button>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={clearAll}
                  title="Clear this run, the session scoreboard and the agent comparison"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting || running}
                  title={pack ? `Restore the ${pack.label} and Customer Service demo data` : 'Restore the Customer Service demo data (undo refunds and cases)'}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reset demo data
                </button>
              </div>
            </div>
          </div>
          {scenario && (
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-700">What to look for: </span>
              {scenario.expect}
            </p>
          )}
          {notice && <p className="text-xs text-emerald-700">{notice}</p>}
          {requestError && <p className="text-xs text-rose-700 break-words">Could not run the agents: {requestError}</p>}
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={showHops} onChange={(e) => setShowHops(e.target.checked)} className="accent-blue-600" />
            <Clock className="w-3 h-3" /> Show tool-server protocol calls (connect, list tools)
          </label>
        </section>

        <div data-tour-id="agent-views" role="tablist" aria-label="Agent Showcase views" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs">
          {([
            ['live', 'Live run'],
            ['compare', `Agent comparison${ledger.runs ? ` (${ledger.runs})` : ''}`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                view === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'compare' ? (
          <AgentComparison ledger={ledger} rates={rates} ratesError={ratesError} />
        ) : (
          <>
            {mode === 'burst' && burst ? (
              <AgentBurst runs={burst} rates={rates} prompt={burst[0]?.prompt || ''} />
            ) : (
              <>
                <div data-tour-id="agent-sides" className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  {SHOWCASE_SIDES.map((s) => (
                    <SideColumn
                      key={s}
                      side={run.sides[s]}
                      showHops={showHops}
                      picker={
                        s === 'baseline' ? (
                          <BaselineModelPicker value={baselineModel} onChange={setBaselineModel} disabled={running} rates={rates} />
                        ) : undefined
                      }
                    />
                  ))}
                </div>

                {hasRun && <ComparisonCard run={run} summaries={summaries} ratesError={ratesError} />}
              </>
            )}

            <Scoreboard board={board} />
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
};

export default AgentShowcase;
