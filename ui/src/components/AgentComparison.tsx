import React from 'react';
import { Bot, Cpu, ShieldCheck, Wrench } from 'lucide-react';
import { NO_MODEL, SHOWCASE_SIDES, alignedKeys, formatTokens, formatUsd, ledgerView, ratio } from '../utils/agentShowcase';
import type { LedgerView, ShowcaseLedger, ShowcaseSideId } from '../utils/agentShowcase';

/*
  Agent comparison: what each agent consumed across this session's runs.
  Input / output tokens, models used and what they cost (priced from the ai-model-rates KVM),
  and which MCP tools each agent called. Built from the steps the agent service records, so
  both agents are measured the same way.
*/

type Rates = Record<string, { input?: number; output?: number }> | null;

const SIDE_META: Record<ShowcaseSideId, { label: string; note: string; icon: React.ReactNode; head: string; accent: string }> = {
  baseline: {
    label: 'Regular Gateway (Without AI governance)',
    note: 'No controls, calls recorded only',
    icon: <Bot className="w-4 h-4 text-slate-500" />,
    head: 'bg-slate-50 border-slate-200',
    accent: 'text-slate-800',
  },
  governed: {
    label: 'With AI & Tools Governance',
    note: 'Controlled: authorized tools only, right-sized models',
    icon: <ShieldCheck className="w-4 h-4 text-blue-600" />,
    head: 'bg-blue-50 border-blue-200',
    accent: 'text-blue-800',
  },
};

const num = (n: number) => n.toLocaleString('en-US');
// Zero or missing counts stay blank: an empty cell reads faster than a column of zeroes.
const blank0 = (n: number | undefined | null) => (n ? num(n) : '');
const rateText = (r: { input: number; output: number } | null) => (r ? `$${r.input} / $${r.output}` : 'No rate');
// One fixed height per body row, so rows line up across the two agent tables.
const ROW = 'h-11 border-b border-slate-50 last:border-0 align-middle';

function Kpi({ label, b, g, fmt, showRatio = true }: { label: string; b: number; g: number; fmt: (n: number) => string; showRatio?: boolean }) {
  const x = showRatio ? ratio(b, g) : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xs tabular-nums text-slate-700">Without: {fmt(b)}</div>
      <div className="text-xs tabular-nums font-semibold text-blue-700">With: {fmt(g)}</div>
      {x !== null && x >= 1.05 && (
        <div className="mt-1 text-[11px] font-semibold text-emerald-700">
          {x.toFixed(x < 10 ? 1 : 0)}× less with governance
        </div>
      )}
    </div>
  );
}

type ModelRow = LedgerView['models'][number];
type ToolRow = LedgerView['tools'][number];

function ModelsTable({ view, keys }: { view: LedgerView; keys: string[] }) {
  if (!keys.length) return <p className="px-4 py-3 text-xs text-slate-500">No model calls yet.</p>;
  const byKey = new Map<string, ModelRow>(view.models.map((m) => [m.model, m]));
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
          <th className="px-4 py-2 font-semibold">Model used</th>
          <th className="px-2 py-2 font-semibold text-right">Calls</th>
          <th className="px-2 py-2 font-semibold text-right">Input tokens</th>
          <th className="px-2 py-2 font-semibold text-right">Output tokens</th>
          <th className="px-2 py-2 font-semibold text-right">Rate per 1M (in / out)</th>
          <th className="px-4 py-2 font-semibold text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const m = byKey.get(k);
          const noModel = m ? m.noModel : k === NO_MODEL;
          return (
            <tr key={k} className={ROW}>
              <td className={`px-4 py-1 break-all ${m ? (noModel ? 'text-slate-600' : 'font-mono text-slate-800') : noModel ? 'text-slate-400' : 'font-mono text-slate-400'}`}>{k}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-700">
                {m && blank0(m.calls)}
                {m && m.cached > 0 && <span className="block text-[10px] text-emerald-700">{m.cached} from cache</span>}
                {m && m.failed > 0 && <span className="block text-[10px] text-rose-700">{m.failed} {noModel ? 'blocked' : 'failed'}</span>}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-700">{m && blank0(m.input)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-700">{m && blank0(m.output)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-500">{m && !noModel ? rateText(m.rate) : ''}</td>
              <td className="px-4 py-1 text-right tabular-nums font-semibold text-slate-900">
                {!m || noModel || !m.costUsd ? (m && m.costUsd === null ? '—' : '') : formatUsd(m.costUsd)}
              </td>
            </tr>
          );
        })}
        <tr className="h-9 bg-slate-50">
          <td className="px-4 py-1.5 font-semibold text-slate-700">Total</td>
          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{blank0(view.totals.llmCalls)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{blank0(view.totals.inputTokens)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-700">{blank0(view.totals.outputTokens)}</td>
          <td />
          <td className="px-4 py-1.5 text-right tabular-nums font-bold text-slate-900">{view.totals.costUsd ? formatUsd(view.totals.costUsd) : ''}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ToolsTable({ view, keys }: { view: LedgerView; keys: string[] }) {
  const byKey = new Map<string, ToolRow>(view.tools.map((t) => [t.name, t]));
  return (
    <>
      <p className="px-4 pt-2 text-[11px] text-slate-500">
        {view.toolsOffered > 0 ? `${view.toolsOffered} tools available to this agent. ` : ''}
        {view.totals.toolsUsed} used, {num(view.totals.toolCalls)} calls.
      </p>
      {keys.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">No MCP tools called yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2 font-semibold">MCP tool</th>
              <th className="px-2 py-2 font-semibold">Server</th>
              <th className="px-2 py-2 font-semibold text-right">Calls</th>
              <th className="px-2 py-2 font-semibold text-right">OK</th>
              <th className="px-2 py-2 font-semibold text-right">Blocked</th>
              <th className="px-4 py-2 font-semibold text-right">Errors</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const t = byKey.get(k);
              return (
                <tr key={k} className={ROW}>
                  <td className={`px-4 py-1 font-mono break-all ${t ? 'text-slate-800' : 'text-slate-400'}`}>{k}</td>
                  <td className="px-2 py-1 text-slate-600 break-words">{t ? t.server || '—' : ''}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-700">{t && blank0(t.calls)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{t && blank0(t.ok)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-amber-700">{t && blank0(t.blocked)}</td>
                  <td className="px-4 py-1 text-right tabular-nums text-rose-700">{t && blank0(t.error)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export const AgentComparison: React.FC<{ ledger: ShowcaseLedger; rates: Rates; ratesError: string | null }> = ({ ledger, rates, ratesError }) => {
  const views = Object.fromEntries(SHOWCASE_SIDES.map((s) => [s, ledgerView(ledger.sides[s], rates)])) as Record<ShowcaseSideId, LedgerView>;
  const b = views.baseline.totals;
  const g = views.governed.totals;
  const unpriced = [...new Set(SHOWCASE_SIDES.flatMap((s) => views[s].unpriced))];
  // Same model and tool rows on both sides, so each line compares like with like.
  const modelKeys = alignedKeys(views.baseline.models, views.governed.models, 'model');
  const toolKeys = alignedKeys(views.baseline.tools, views.governed.tools, 'name');

  if (ledger.runs === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-6 text-sm text-slate-600">
        Run a scenario on the <span className="font-semibold">Live run</span> tab. Each finished run adds both agents&apos; tokens, models, costs and MCP tool calls here.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800">Agent comparison</h2>
          <span className="text-xs text-slate-500">
            {ledger.runs} run{ledger.runs === 1 ? '' : 's'} this session. Both agents priced from the same price list.
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Kpi label="Input tokens" b={b.inputTokens} g={g.inputTokens} fmt={formatTokens} />
          <Kpi label="Output tokens" b={b.outputTokens} g={g.outputTokens} fmt={formatTokens} />
          <Kpi label="Model cost" b={b.costUsd} g={g.costUsd} fmt={formatUsd} />
          <Kpi label="Models used" b={views.baseline.modelsUsed} g={views.governed.modelsUsed} fmt={(n) => String(n)} showRatio={false} />
          <Kpi label="MCP tools available" b={views.baseline.toolsOffered} g={views.governed.toolsOffered} fmt={(n) => String(n)} />
        </div>
        {(unpriced.length > 0 || ratesError) && (
          <p className="text-[11px] text-amber-700 break-words">
            {ratesError ? `Rate card unavailable (${ratesError}); costs cannot be shown.` : `No rate in the ai-model-rates card for: ${unpriced.join(', ')}. Those calls are not priced.`}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {SHOWCASE_SIDES.map((s) => {
          const meta = SIDE_META[s];
          const view = views[s];
          return (
            <section key={s} className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <header className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b ${meta.head}`}>
                {meta.icon}
                <h3 className={`text-sm font-bold ${meta.accent}`}>{meta.label}</h3>
                <span className="text-[11px] text-slate-500">{meta.note}</span>
                <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{view.runs} run{view.runs === 1 ? '' : 's'}</span>
              </header>
              <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-slate-700">
                <Cpu className="w-3.5 h-3.5 text-slate-500" /> Models and cost
              </div>
              <ModelsTable view={view} keys={modelKeys} />
              <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-slate-700 border-t border-slate-100">
                <Wrench className="w-3.5 h-3.5 text-slate-500" /> MCP tools accessed
              </div>
              <div className="pb-2">
                <ToolsTable view={view} keys={toolKeys} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default AgentComparison;
