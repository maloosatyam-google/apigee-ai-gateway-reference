import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronUp, Clipboard, ExternalLink, Loader2, RefreshCw, Sparkles, X,
} from 'lucide-react';

/**
 * Admin Console alert for the daily pricing & model watch (/api/model-watch).
 * Shows rate-card drift against the official Vertex AI / Gemini API prices, changelog
 * deprecations that hit models the persona products use, upcoming price changes and new
 * models. The fix path is a pull request against apigee/config/model_rate_card.json:
 * "Copy & open PR" copies the corrected JSON and opens GitHub's editor for that file.
 */

interface Price { input: number; output: number; tier?: string }
interface Drift { model: string; inUse: boolean; card: Price; official: Price & { source: string; until: string | null } }
interface Deprecation { id: string; date: string; text: string; kinds: string[]; models: string[]; retiring: string[]; replacements: string[]; affected: string[]; inUse: boolean }
interface Upcoming { model: string; inUse: boolean; from: string; inDays: number; now: Price; next: Price }
interface NewModel { model: string; date: string; text: string; price: Price | null }
interface WatchItem { name: string; replaces: string; note: string; url?: string; status: 'waiting' | 'available'; seenOn: string | null; price: Price | null }
interface PageChange {
  id: string; detectedAt: string; change: 'added' | 'removed' | 'changed'; section: string; model: string; item: string;
  column: string; before: string | null; after: string | null; inUse: boolean; inCard: boolean;
}
interface Analysis {
  status: 'ok' | 'info' | 'action' | 'error';
  signature: string;
  counts: Record<string, number>;
  drift: Drift[];
  deprecations: Deprecation[];
  upcoming: Upcoming[];
  newModels: NewModel[];
  pageChanges: PageChange[];
  watchlist: WatchItem[];
  proposedRateCard: Record<string, unknown> | null;
}
interface WatchResponse {
  configured: boolean;
  message?: string;
  checkedAt?: string;
  errors?: { source: string; error: string }[];
  sources?: Record<string, { url: string; ok: boolean; prices?: number; models?: number }>;
  analysis?: Analysis;
  github?: { repo: string; branch: string; path: string; editUrl: string } | null;
}

const DISMISS_KEY = 'modelWatch.dismissedSignature';
// $0.075 keeps three decimals; everything else shows cents ($0.30, $7.50).
const usd = (n: number) => `$${n.toFixed(Number((n * 100).toFixed(6)) % 1 ? 3 : 2)}`;
const pair = (p: Price) => `${usd(p.input)} / ${usd(p.output)}`;

function ago(iso?: string) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function ModelWatchAlert() {
  const [data, setData] = useState<WatchResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [busy, setBusy] = useState<'run' | 'copy' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/model-watch');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setBusy('run');
    setNote(null);
    try {
      const res = await fetch('/api/model-watch/run', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNote('Check started. Results appear here in about a minute.');
      setTimeout(load, 60_000);
    } catch (e) {
      setNote(`Could not start the check: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const copyAndOpen = async (openEditor: boolean) => {
    const card = data?.analysis?.proposedRateCard;
    if (!card) return;
    setBusy('copy');
    try {
      await navigator.clipboard.writeText(`${JSON.stringify(card, null, 2)}\n`);
      setNote(openEditor
        ? 'Corrected rate card copied. In the GitHub editor: select all, paste, then "Commit changes" → "Create a new branch and start a pull request".'
        : 'Corrected rate card copied. Paste it into apigee/config/model_rate_card.json and open a pull request.');
      if (openEditor && data?.github?.editUrl) window.open(data.github.editUrl, '_blank', 'noopener');
    } catch {
      setNote('Clipboard access was blocked by the browser.');
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
        Pricing &amp; model watch unavailable: {loadError}
      </div>
    );
  }
  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2"><BellRing className="w-4 h-4 text-slate-400" />Pricing &amp; model watch: {data.message}</span>
        <button type="button" onClick={runNow} disabled={busy === 'run'} className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:bg-slate-50 font-semibold cursor-pointer disabled:opacity-50">
          {busy === 'run' ? 'Starting…' : 'Check now'}
        </button>
      </div>
    );
  }

  const a = data.analysis!;
  if ((a.status === 'ok' || a.signature === dismissed) && !open) {
    return (
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Pricing &amp; model watch: {a.status === 'ok' ? 'rate card matches official prices' : 'no new changes since you dismissed it'} · checked {ago(data.checkedAt)}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="hover:text-slate-800 cursor-pointer underline-offset-2 hover:underline">Details</button>
      </div>
    );
  }

  const tone = a.status === 'action'
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : a.status === 'error' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-sky-50 border-sky-200 text-sky-900';
  const parts = [
    a.counts.drift && `${a.counts.drift} rate-card price${a.counts.drift > 1 ? 's' : ''} differ from official`,
    a.counts.deprecationsInUse && `${a.counts.deprecationsInUse} deprecation${a.counts.deprecationsInUse > 1 ? 's affect' : ' affects'} models in use`,
    a.counts.upcoming && `${a.counts.upcoming} upcoming price change${a.counts.upcoming > 1 ? 's' : ''}`,
    a.counts.watchlistAvailable && `${a.watchlist.filter((w) => w.status === 'available').map((w) => w.name).join(', ')} now available`,
    a.counts.newModels && `${a.counts.newModels} new model${a.counts.newModels > 1 ? 's' : ''}`,
    a.counts.pageChanges && `${a.counts.pageChanges} Vertex price change${a.counts.pageChanges > 1 ? 's' : ''}${a.counts.pageChangesInUse ? ` (${a.counts.pageChangesInUse} in use)` : ''}`,
    a.counts.errors && `${a.counts.errors} source${a.counts.errors > 1 ? 's' : ''} could not be checked`,
  ].filter(Boolean);

  return (
    <div className={`rounded-xl border ${tone} text-xs`}>
      <div className="flex items-center justify-between gap-2 p-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 text-left cursor-pointer min-w-0">
          <BellRing className="w-4 h-4 shrink-0" />
          <span className="font-semibold shrink-0">Pricing &amp; model watch</span>
          <span className="truncate">{parts.join(' · ') || 'Up to date'}</span>
          <span className="opacity-60 shrink-0">· checked {ago(data.checkedAt)}</span>
          {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={runNow} disabled={busy === 'run'} title="Run the check now"
            className="p-1.5 rounded-md hover:bg-white/70 cursor-pointer disabled:opacity-50">
            {busy === 'run' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <button type="button" title="Dismiss until something new changes"
            onClick={() => { try { localStorage.setItem(DISMISS_KEY, a.signature); } catch { /* ignore */ } setDismissed(a.signature); setOpen(false); }}
            className="p-1.5 rounded-md hover:bg-white/70 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {open && (
        <div className="border-t border-current/10 bg-white/70 rounded-b-xl p-3 space-y-3 text-slate-800">
          {note && <div className="p-2 rounded-md bg-slate-100 border border-slate-200">{note}</div>}

          {(data.errors || []).length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Watcher problems</h4>
              <ul className="list-disc pl-5 space-y-0.5">
                {data.errors!.map((e) => <li key={e.source}><b>{e.source}</b>: {e.error}</li>)}
              </ul>
            </section>
          )}

          {a.drift.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Rate card vs official price (USD per 1M tokens, input / output)</h4>
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="py-1">Model</th><th>Rate card</th><th>Official</th><th>Tier</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {a.drift.map((d) => (
                    <tr key={d.model} className="border-t border-slate-200/70">
                      <td className="py-1 font-mono">{d.model}{d.inUse && <span className="ml-1.5 px-1 rounded bg-amber-100 text-amber-800 font-sans text-[10px]">in use</span>}</td>
                      <td className="line-through text-slate-500">{pair(d.card)}</td>
                      <td className="font-semibold">{pair(d.official)}{d.official.until && <span className="font-normal text-slate-500"> until {d.official.until}</span>}</td>
                      <td>{d.card.tier === d.official.tier ? d.official.tier : <span>{d.card.tier} → <b>{d.official.tier}</b></span>}</td>
                      <td className="text-slate-500">{d.official.source === 'vertex' ? 'Vertex AI' : 'Gemini API'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {data.github && (
                  <button type="button" onClick={() => copyAndOpen(true)} disabled={busy === 'copy'}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 text-white font-semibold hover:bg-slate-700 cursor-pointer disabled:opacity-50">
                    <ExternalLink className="w-3.5 h-3.5" />Copy &amp; open PR
                  </button>
                )}
                <button type="button" onClick={() => copyAndOpen(false)} disabled={busy === 'copy'}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-300 font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50">
                  <Clipboard className="w-3.5 h-3.5" />Copy corrected rate card
                </button>
                <span className="text-slate-500">After the PR merges, publish it with <code>apigee/scripts/sync_rate_card.sh</code>.</span>
              </div>
            </section>
          )}

          {a.deprecations.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Deprecations and shutdowns (Gemini API changelog)</h4>
              <ul className="space-y-1">
                {a.deprecations.map((d) => (
                  <li key={d.id} className="flex gap-2">
                    <span className="text-slate-500 shrink-0 w-20">{d.date}</span>
                    <span>
                      {d.inUse && <span className="mr-1.5 px-1 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">in use: {d.affected.join(', ')}</span>}
                      {d.replacements.length > 0 && (
                        <span className="mr-1.5 px-1 rounded bg-emerald-50 text-emerald-800 text-[10px] font-semibold">replacement: {d.replacements.join(', ')}</span>
                      )}
                      {d.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {a.upcoming.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Upcoming official price changes</h4>
              <ul className="space-y-0.5">
                {a.upcoming.map((u) => (
                  <li key={u.model}><span className="font-mono">{u.model}</span>: {pair(u.now)} → <b>{pair(u.next)}</b> ({u.next.tier} tier) from {u.from} · in {u.inDays} days{u.inUse ? ' · in use' : ''}</li>
                ))}
              </ul>
            </section>
          )}

          {a.newModels.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-600" />New models not in the rate card</h4>
              <ul className="space-y-0.5">
                {a.newModels.map((n) => (
                  <li key={n.model}><span className="font-mono">{n.model}</span>{n.price ? ` · ${pair(n.price)} (${n.price.tier})` : ''} <span className="text-slate-500">· {n.date}</span></li>
                ))}
              </ul>
            </section>
          )}

          {a.watchlist.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Watching for</h4>
              <ul className="space-y-0.5">
                {a.watchlist.map((w) => (
                  <li key={w.name}>
                    <span className={`mr-1.5 px-1 rounded text-[10px] font-semibold ${w.status === 'available' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {w.status === 'available' ? `available · ${w.seenOn}` : 'not released yet'}
                    </span>
                    {w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{w.name}</a> : <b>{w.name}</b>}
                    {' '}to replace <span className="font-mono">{w.replaces}</span>
                    {w.price ? ` · ${pair(w.price)} (${w.price.tier})` : ''}
                    <span className="text-slate-500"> · {w.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {a.pageChanges.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">Price changes on the Vertex AI pricing page (all models, last 30 days)</h4>
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="py-1">Detected</th><th>Model</th><th>Item</th><th>Before</th><th>After</th></tr>
                </thead>
                <tbody>
                  {(showAllChanges ? a.pageChanges : a.pageChanges.slice(0, 15)).map((c) => (
                    <tr key={c.id} className="border-t border-slate-200/70 align-top">
                      <td className="py-1 text-slate-500 whitespace-nowrap pr-2">{c.detectedAt.slice(0, 10)}</td>
                      <td className="pr-2">
                        <span className="text-slate-500">{c.section} · </span>{c.model}
                        {c.inUse && <span className="ml-1.5 px-1 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">in use</span>}
                        {!c.inUse && c.inCard && <span className="ml-1.5 px-1 rounded bg-slate-100 text-slate-600 text-[10px]">in rate card</span>}
                      </td>
                      <td className="pr-2 text-slate-600">{c.item}{c.column ? <span className="text-slate-400"> · {c.column}</span> : null}</td>
                      <td className="text-slate-500 line-through whitespace-nowrap pr-2">{c.before ?? '—'}</td>
                      <td className="font-semibold whitespace-nowrap">{c.after ?? <span className="text-rose-600">removed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.pageChanges.length > 15 && (
                <button type="button" onClick={() => setShowAllChanges(!showAllChanges)} className="mt-1 text-slate-600 underline cursor-pointer">
                  {showAllChanges ? 'Show fewer' : `Show all ${a.pageChanges.length}`}
                </button>
              )}
            </section>
          )}

          <p className="text-[10px] text-slate-500">
            {data.sources?.vertex?.prices ? `Tracking ${data.sources.vertex.prices.toLocaleString()} prices for ${data.sources.vertex.models} models. ` : ''}
            Checked daily against{' '}
            {Object.entries(data.sources || {}).map(([k, s], i) => (
              <span key={k}>{i ? ', ' : ''}<a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">{k === 'vertex' ? 'Vertex AI pricing' : k === 'gemini' ? 'Gemini API pricing' : 'Gemini API changelog'}</a>{s.ok ? '' : ' (failed)'}</span>
            ))}.
          </p>
        </div>
      )}
    </div>
  );
}
