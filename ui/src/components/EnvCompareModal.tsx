import React, { useEffect, useState } from 'react';
import { X, GitCompare, RefreshCw, AlertCircle, CheckCircle2, GitPullRequest } from 'lucide-react';
import { fetchAiProducts, fetchModelRates } from '../services/api';
import { diffProducts, diffRateCards, DiffRow } from '../utils/configDiff';
import { ApiProduct, RateCardDictionary } from '../types';
import { PERSONAS } from '../utils/personas';
import { displayPersona } from '../utils/customerTheme';
import { usePersonaVoice } from '../utils/voice';

/**
 * Admin Console "Compare Dev ↔ Prod" view.
 *
 * Loads both environments fresh (so it reflects Ask Apigee changes made since
 * the console was opened) and lists what the Dev sandbox would change in Prod,
 * i.e. what a pull request would need to carry.
 */

const TIERS = PERSONAS.map((p) => p.product);

interface Loaded {
  devProducts: ApiProduct[];
  prodProducts: ApiProduct[];
  devRates: RateCardDictionary;
  prodRates: RateCardDictionary;
}

const KIND_STYLE: Record<DiffRow['kind'], { label: string; cls: string }> = {
  added: { label: 'Only in Dev', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  removed: { label: 'Only in Prod', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  changed: { label: 'Changed', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

/** Finance and AI CoE call the environments Sandbox and Live. */
const KIND_LABEL: Record<DiffRow['kind'], { technical: string; finance: string; ai_coe: string }> = {
  added: { technical: 'Only in Dev', finance: 'Only in Sandbox', ai_coe: 'Only in Sandbox' },
  removed: { technical: 'Only in Prod', finance: 'Only in Live', ai_coe: 'Only in Live' },
  changed: { technical: 'Changed', finance: 'Changed', ai_coe: 'Changed' },
};

function DiffTable({ rows }: { rows: DiffRow[] }) {
  const { sp } = usePersonaVoice('admin');
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 px-3 py-2">
        <CheckCircle2 className="w-3.5 h-3.5" />{' '}
        {sp({
          technical: 'No drift: Dev and Prod are identical.',
          finance: 'Sandbox and Live match, so no cost change.',
          ai_coe: 'Sandbox and Live match, so teams see no change.',
        })}
      </div>
    );
  }
  let lastSection = '';
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-slate-400 uppercase tracking-wider text-[10px]">
          <th className="px-3 py-1.5 font-semibold w-[30%]">{sp({ technical: 'Attribute', finance: 'Setting', ai_coe: 'Setting' })}</th>
          <th className="px-3 py-1.5 font-semibold">{sp({ technical: 'Prod (current)', finance: 'Live (current)', ai_coe: 'Live (current)' })}</th>
          <th className="px-3 py-1.5 font-semibold">{sp({ technical: 'Dev (proposed)', finance: 'Sandbox (proposed)', ai_coe: 'Sandbox (proposed)' })}</th>
          <th className="px-3 py-1.5 font-semibold w-24" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const header = r.section !== lastSection;
          lastSection = r.section;
          const k = KIND_STYLE[r.kind];
          return (
            <React.Fragment key={`${r.section}:${r.key}`}>
              {header && (
                <tr>
                  <td colSpan={4} className="px-3 pt-2.5 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {r.section}
                  </td>
                </tr>
              )}
              <tr className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 font-mono text-slate-800 break-all">{r.key}</td>
                <td className={`px-3 py-1.5 font-mono ${r.prod === null ? 'text-slate-300' : 'text-slate-600'} ${r.kind !== 'added' ? 'line-through decoration-rose-300' : ''}`}>
                  {r.prod ?? '—'}
                </td>
                <td className={`px-3 py-1.5 font-mono ${r.dev === null ? 'text-slate-300' : 'text-slate-900 font-semibold'}`}>
                  {r.dev ?? '—'}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${k.cls}`}>{sp(KIND_LABEL[r.kind])}</span>
                </td>
              </tr>
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function EnvCompareModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { sp } = usePersonaVoice('admin');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dp, pp, dr, pr] = await Promise.all([
        fetchAiProducts('dev'),
        fetchAiProducts('prod'),
        fetchModelRates('dev'),
        fetchModelRates('prod'),
      ]);
      setData({
        devProducts: dp.products || [],
        prodProducts: pp.products || [],
        devRates: dr.rates || {},
        prodRates: pr.rates || {},
      });
    } catch (e: any) {
      setError(
        e?.message ||
          sp({
            technical: 'Failed to load Dev and Prod configuration',
            finance: 'Could not load Sandbox and Live settings',
            ai_coe: 'Could not load Sandbox and Live settings',
          })
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections = data
    ? [
        ...TIERS.map((tier) => {
          const dev = data.devProducts.find((p) => p.name === tier);
          const prod = data.prodProducts.find((p) => p.name === tier);
          return {
            title: (() => { const p = PERSONAS.find((x) => x.product === tier); return p ? displayPersona(p).label : tier; })(),
            subtitle: sp({
              technical: `${dev?.apigeeName || `${tier} Dev`} → ${prod?.apigeeName || tier}`,
              finance: 'Sandbox → Live',
              ai_coe: 'Sandbox → Live',
            }),
            note: dev?.missing
              ? sp({
                  technical: 'No (Dev) product clone exists yet, so this compares Prod with itself. Provision the sandbox first.',
                  finance: 'This persona has no Sandbox copy yet, so there is no budget or price change to review.',
                  ai_coe: 'This team has no Sandbox copy yet, so there is no model or limit change to review.',
                })
              : undefined,
            rows: diffProducts(dev, prod),
          };
        }),
        {
          title: sp({ technical: 'Model rate card', finance: 'Model price list', ai_coe: 'Model prices' }),
          subtitle: sp({
            technical: 'KVM ai-model-rates / rate_card, dev → prod',
            finance: 'Sandbox → Live',
            ai_coe: 'Sandbox → Live',
          }),
          note: undefined,
          rows: diffRateCards(data.devRates, data.prodRates),
        },
      ]
    : [];
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-label={sp({ technical: 'Compare Dev and Prod', finance: 'Compare Sandbox and Live', ai_coe: 'Compare Sandbox and Live' })}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{sp({ technical: 'Compare Dev ↔ Prod', finance: 'Compare Sandbox ↔ Live', ai_coe: 'Compare Sandbox ↔ Live' })}</h3>
              <p className="text-xs text-slate-500">
                {sp({
                  technical: 'Config drift between the Dev sandbox (incl. Ask Apigee writes) and Prod: what the PR must carry.',
                  finance: 'Budget, price and billing changes that would go Live, including ones made by Ask Apigee.',
                  ai_coe: 'Model, routing and limit changes your teams would get, including ones made by Ask Apigee.',
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={load} disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer disabled:opacity-50" aria-label={sp({ technical: 'Reload both environments', finance: 'Reload', ai_coe: 'Reload' })}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {loading && !data && <div className="text-xs text-slate-500">{sp({ technical: 'Reading Dev and Prod products and KVM…', finance: 'Loading Sandbox and Live settings…', ai_coe: 'Loading Sandbox and Live settings…' })}</div>}
          {data && (
            <div className="text-xs text-slate-600">
              {total === 0
                ? sp({
                    technical: 'No differences: Dev matches Prod, nothing to promote.',
                    finance: 'No differences: going Live would not change any budget or price.',
                    ai_coe: 'No differences: going Live would not change what any team can use.',
                  })
                : sp({
                    technical: `${total} difference${total === 1 ? '' : 's'} across ${sections.filter((s) => s.rows.length).length} area(s) to carry in the PR.`,
                    finance: `${total} change${total === 1 ? '' : 's'} across ${sections.filter((s) => s.rows.length).length} area(s) to review before going Live.`,
                    ai_coe: `${total} change${total === 1 ? '' : 's'} across ${sections.filter((s) => s.rows.length).length} area(s) your teams would get.`,
                  })}
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                <div className="text-xs font-bold text-slate-900">{s.title}</div>
                <div className="text-[10px] font-mono text-slate-400 truncate">{s.subtitle}</div>
              </div>
              {s.note && <div className="px-3 pt-2 text-[11px] text-amber-700">{s.note}</div>}
              <DiffTable rows={s.rows} />
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 rounded-b-2xl flex items-start gap-2 text-[11px] text-slate-600">
          <GitPullRequest className="w-4 h-4 text-slate-500 shrink-0 mt-px" />
          <span>
            {sp({
              technical:
                'To promote, commit these changes to the product definitions in the repo and raise a pull request. CI deploys to Prod after review and merge, so a bad change can be rolled back by reverting the PR.',
              finance:
                'To go Live, these changes are submitted for review. Real budgets, credit and prices only change once the review is approved, so there are no surprise costs.',
              ai_coe:
                'To go Live, these changes are submitted for review. Teams get the new models, routing and limits only once the review is approved.',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
