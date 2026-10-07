import React from 'react';
import { CheckCircle2, Clock, Gauge, Loader2, ShieldAlert, XCircle, Zap } from 'lucide-react';

import { burstTotals, formatMs, formatTokens, formatUsd } from '../utils/agentShowcase';
import type { BurstOutcome, ShowcaseRunState } from '../utils/agentShowcase';

/*
  Quota burst (scenario 7): the governed agent alone, several runs back to back with the
  semantic cache off. They share one Customer Service key, so they draw on the same per-user
  token quota on /auto; once it is spent, the gateway answers the next model call with a 429.
*/

type Rates = Record<string, { input?: number; output?: number }> | null;

const OUTCOME: Record<BurstOutcome, { label: string; className: string; icon: React.ReactNode }> = {
  queued: { label: 'Waiting', className: 'bg-slate-50 text-slate-500 border-slate-200', icon: <Clock className="w-3 h-3" /> },
  running: { label: 'Working...', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  done: { label: 'Answered', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="w-3 h-3" /> },
  quota: { label: 'Stopped: usage limit', className: 'bg-rose-50 text-rose-700 border-rose-200', icon: <ShieldAlert className="w-3 h-3" /> },
  error: { label: 'Error', className: 'bg-slate-100 text-slate-700 border-slate-300', icon: <XCircle className="w-3 h-3" /> },
};

export function AgentBurst({ runs, rates, prompt }: { runs: ShowcaseRunState[]; rates: Rates; prompt: string }) {
  const t = burstTotals(runs, rates);
  const done = t.running === 0 && t.queued === 0;
  return (
    <section className="rounded-2xl border border-blue-200 bg-white shadow-xs">
      <div className="px-4 py-3 border-b border-slate-100 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Zap className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-bold text-blue-800">Usage limit: {runs.length} runs back to back, With AI & Tools Governance only</h2>
          {prompt && <span className="text-[11px] text-slate-500 break-words">“{prompt}”</span>}
        </div>
        <p className="text-xs text-slate-600">
          Answers are not reused, so every run spends real tokens against the same per-user usage limit.
        </p>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold">{t.finished} answered</span>
        <span className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 font-semibold">{t.stopped} stopped by the usage limit</span>
        {t.errors > 0 && <span className="px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 font-semibold">{t.errors} errors</span>}
        {t.running + t.queued > 0 && <span className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 font-semibold">{t.running + t.queued} to go</span>}
        <span className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 tabular-nums">{formatTokens(t.tokens)} tokens</span>
        <span className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 tabular-nums">{formatUsd(t.costUsd)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50">
              <th className="px-4 py-2 font-semibold">Run</th>
              <th className="px-2 py-2 font-semibold">Result</th>
              <th className="px-2 py-2 font-semibold text-right">Model steps</th>
              <th className="px-2 py-2 font-semibold text-right">Tool calls</th>
              <th className="px-2 py-2 font-semibold text-right">Tokens</th>
              <th className="px-2 py-2 font-semibold text-right">Limit used</th>
              <th className="px-2 py-2 font-semibold">Model</th>
              <th className="px-2 py-2 font-semibold text-right">Time</th>
              <th className="px-4 py-2 font-semibold text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => {
              const o = OUTCOME[r.outcome];
              return (
                <React.Fragment key={i}>
                  <tr className="border-b border-slate-50">
                    <td className="px-4 py-2 font-semibold text-slate-700">#{i + 1}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${o.className}`}>
                        {o.icon}
                        {o.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.steps}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.toolCalls}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.tokens.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">
                      {r.quotaUsedPct === null ? '—' : (
                        <span className="inline-flex items-center gap-1">
                          <Gauge className="w-3 h-3 text-slate-400" />
                          {Math.round(r.quotaUsedPct)}%
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-700 break-all">{r.models.join(', ') || '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{formatMs(r.e2eMs ?? NaN)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatUsd(r.costUsd)}</td>
                  </tr>
                  {(r.quotaDetail || r.error) && (
                    <tr className="border-b border-slate-50">
                      <td />
                      <td colSpan={8} className={`px-2 pb-2 text-[11px] break-words ${r.quotaDetail ? 'text-rose-700' : 'text-slate-600'}`}>
                        {r.quotaDetail || r.error}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {done && (
        <p className="px-4 py-3 text-xs text-slate-600 border-t border-slate-100">
          {t.stopped > 0
            ? 'Once the per-user usage limit was spent, the next model calls were stopped before any model ran. The ungoverned agent has no such limit: every run would go through at full Pro cost.'
            : 'All runs fit inside the per-user usage limit this time. The limit is a rolling 2 minutes: run the burst again right away to go over it.'}
        </p>
      )}
    </section>
  );
}

export default AgentBurst;
