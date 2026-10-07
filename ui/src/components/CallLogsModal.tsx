import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  ScrollText,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Shuffle,
  Database,
} from 'lucide-react';
import { CallLogEntry, CallLogWindow, fetchCallLogs } from '../services/api';
import { Term, usePersonaVoice } from '../utils/voice';

interface CallLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The ledger row this modal was opened from. */
  userEmail: string;
  model: string;
  /**
   * Window to open on, inherited from the range selected on the Analytics tab
   * so the drill-down covers the same period as the ledger row that spawned it.
   * The parent remounts this modal (via `key`) whenever it changes, so this is
   * read once per open and the in-modal selector stays free to narrow further.
   */
  initialWindow?: CallLogWindow;
}

const WINDOW_OPTIONS: { value: CallLogWindow; label: string }[] = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/** Local time, seconds precision -- these rows are read at demo pace. */
const formatTimestamp = (iso: string | null): string => {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

/**
 * Per-call costs routinely land below a cent, so the shared two-decimal
 * formatter would render most rows as "$0.00". Keep six decimals here.
 */
const formatCallCost = (usd: number): string => {
  if (!usd || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

interface StatusPillCopy {
  /** Pill text when the call faulted but no HTTP status was resolved. */
  blocked: string;
  /** Hover hints per outcome class; the fault name is appended when present. */
  okHint: string;
  blockedHint: string;
  failedHint: string;
}

const StatusPill: React.FC<{ status: number; faultName: string; copy: StatusPillCopy }> = ({ status, faultName, copy }) => {
  const ok = status >= 200 && status < 300;
  // A policy fault is a deliberate block, not a server failure -- colour it
  // amber even when the status code could not be resolved from the log entry.
  const clientBlocked = (status >= 400 && status < 500) || (!ok && !!faultName);
  const cls = ok
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : clientBlocked
    ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-rose-100 text-rose-700 border-rose-200';
  return (
    <span
      className={`inline-block text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${cls}`}
      title={[ok ? copy.okHint : clientBlocked ? copy.blockedHint : copy.failedHint, faultName].filter(Boolean).join(': ')}
    >
      {status || (faultName ? copy.blocked : '--')}
    </span>
  );
};

export const CallLogsModal: React.FC<CallLogsModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  model,
  initialWindow = '24h',
}) => {
  // Opened from Analytics, so the admin persona picked top-right decides the voice:
  // platform = per-call audit (status, faulting policy), finance = cost per request,
  // ai_coe = what people asked and what the safety controls stopped.
  const { voice, sp } = usePersonaVoice('admin');
  const pillCopy: StatusPillCopy = {
    blocked: sp({ technical: 'FAULT', finance: 'BLOCKED', ai_coe: 'BLOCKED' }),
    okHint: sp({ technical: '2xx: served by the model', finance: 'Answered and charged', ai_coe: 'Answered' }),
    blockedHint: sp({
      technical: '4xx: rejected by a gateway policy (key, entitlement, Model Armor or quota)',
      finance: 'Blocked by the gateway, no model cost',
      ai_coe: 'Blocked by a safety control or usage limit',
    }),
    failedHint: sp({
      technical: '5xx: model backend or proxy fault',
      finance: 'Failed at the AI provider',
      ai_coe: 'Failed at the AI provider',
    }),
  };
  const notCaptured = sp({ technical: 'not logged', finance: 'not recorded', ai_coe: 'not recorded' });
  const [logWindow, setLogWindow] = useState<CallLogWindow>(initialWindow);
  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [consoleUrl, setConsoleUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userEmail || !model) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchCallLogs(userEmail, model, logWindow);
      setEntries(data.entries || []);
      setConsoleUrl(data.consoleUrl || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userEmail, model, logWindow]);

  useEffect(() => {
    if (isOpen) {
      setExpanded(null);
      load();
    }
  }, [isOpen, load]);

  // Escape-to-close, matching the other modals in the app.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-7xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-start gap-2.5">
            <ScrollText className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {sp({ technical: 'Per-Call Audit Log', finance: 'Cost per request', ai_coe: 'Request history' })}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {sp({
                  technical: 'Every request through the AI proxy from',
                  finance: 'What each request cost for',
                  ai_coe: 'Every prompt sent by',
                })}{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {userEmail}
                </span>{' '}
                {sp({ technical: 'on', finance: 'on', ai_coe: 'to' })}{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {model}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={sp({ technical: 'Close audit log', finance: 'Close cost view', ai_coe: 'Close request history' })}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs shadow-xs">
              <span className="text-slate-500 mr-1.5 text-[11px]">{sp({ technical: 'Window:', finance: 'Period:', ai_coe: 'Period:' })}</span>
              <select
                value={logWindow}
                onChange={(e) => setLogWindow(e.target.value as CallLogWindow)}
                className="bg-transparent text-slate-800 text-xs font-mono focus:outline-none cursor-pointer"
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {sp({ technical: 'Re-query', finance: 'Refresh', ai_coe: 'Refresh' })}
            </button>
            {!loading && !error && (
              <span className="text-xs text-slate-500">
                {entries.length} {sp({ technical: 'call', finance: 'request', ai_coe: 'request' })}{entries.length === 1 ? '' : 's'}
                {entries.length === 100
                  ? sp({ technical: ' (capped at newest 100)', finance: ' (latest 100)', ai_coe: ' (latest 100)' })
                  : ''}
              </span>
            )}
          </div>

          {consoleUrl && (
            <a
              href={consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
            >
              {sp({ technical: 'Open in Cloud Logging', finance: 'Open raw logs', ai_coe: 'Open raw logs' })}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Body */}
        <div className="overflow-auto grow">
          {error ? (
            <div className="m-6 flex items-start gap-2.5 p-4 rounded-xl border border-rose-200 bg-rose-50">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-rose-700">
                  {sp({ technical: 'Cloud Logging query failed', finance: 'Could not load request costs', ai_coe: 'Could not load request history' })}
                </p>
                <p className="text-xs text-rose-600 mt-1 font-mono">{error}</p>
              </div>
            </div>
          ) : loading ? (
            <p className="py-16 text-center text-sm text-slate-500">
              {sp({ technical: 'Querying Cloud Logging...', finance: 'Loading costs...', ai_coe: 'Loading requests...' })}
            </p>
          ) : entries.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">
              {sp({
                technical:
                  'No log entries for this developer and model in this window. Logging can trail Analytics by a minute or two; widen the window or re-query.',
                finance: 'No requests, and so no cost, from this user on this model in this period.',
                ai_coe: 'This user sent no requests to this model in this period.',
              })}
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-2.5 pl-6 pr-2 w-8" />
                  <th className="py-2.5 pr-3 whitespace-nowrap">{sp({ technical: 'Timestamp', finance: 'Time', ai_coe: 'Time' })}</th>
                  <th className="py-2.5 pr-3">{sp({ technical: 'HTTP status', finance: 'Result', ai_coe: 'Result' })}</th>
                  <th className="py-2.5 pr-3">{sp({ technical: 'Prompt', finance: 'Question', ai_coe: 'Prompt' })}</th>
                  <th className="py-2.5 pr-3">{sp({ technical: 'Completion / fault', finance: 'Answer', ai_coe: 'Answer' })}</th>
                  <th className="py-2.5 pr-3 text-right whitespace-nowrap">Tokens (in/out)</th>
                  <th className="py-2.5 pr-3 text-right">Cost</th>
                  <th className="py-2.5 pr-6 text-center whitespace-nowrap">{sp({ technical: 'Flags', finance: 'Savings', ai_coe: 'Notes' })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry, idx) => {
                  const rowKey = entry.trackingId || `${entry.timestamp}__${idx}`;
                  const isExpanded = expanded === rowKey;
                  const blocked = entry.status >= 400 || !!entry.faultName;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        onClick={() => setExpanded(isExpanded ? null : rowKey)}
                        className="hover:bg-slate-50 transition cursor-pointer"
                      >
                        <td className="py-2.5 pl-6 pr-2 align-top text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </td>
                        <td className="py-2.5 pr-3 align-top font-mono text-slate-600 whitespace-nowrap">
                          {formatTimestamp(entry.timestamp)}
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <StatusPill status={entry.status} faultName={entry.faultName} copy={pillCopy} />
                        </td>
                        <td className="py-2.5 pr-3 align-top text-slate-700 max-w-xs">
                          {entry.prompt ? (
                            truncate(entry.prompt, 70)
                          ) : (
                            <span className="text-slate-400 italic">
                              {notCaptured}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 align-top text-slate-700 max-w-xs">
                          {entry.response ? (
                            truncate(entry.response, 70)
                          ) : blocked ? (
                            <span className="text-amber-600 text-[11px]">
                              {truncate(entry.errorMessage || entry.faultName || sp({ technical: 'Policy fault', finance: 'Blocked', ai_coe: 'Blocked' }), 70)}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">
                              {notCaptured}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 align-top text-right font-mono text-slate-600 whitespace-nowrap">
                          {entry.promptTokens.toLocaleString()} /{' '}
                          {entry.candidatesTokens.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 align-top text-right font-mono font-semibold text-emerald-600 whitespace-nowrap">
                          {formatCallCost(entry.costUsd)}
                        </td>
                        <td className="py-2.5 pr-6 align-top">
                          <div className="flex items-center justify-center gap-1">
                            {entry.autoRouted && (
                              <span
                                title={sp({
                                  technical: 'Auto-routed: the complexity classifier picked this target instead of the requested model',
                                  finance: 'Model picked automatically, usually a cheaper one for simple requests',
                                  ai_coe: 'Model chosen by automatic model choice, not by the user',
                                })}
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200"
                              >
                                <Shuffle className="w-2.5 h-2.5" />
                                {sp({ technical: 'Routed', finance: 'Auto', ai_coe: 'Auto' })}
                              </span>
                            )}
                            {entry.cached && (
                              <span
                                title={sp({
                                  technical: 'Semantic cache HIT: answered without calling the model backend',
                                  finance: 'A saved answer was reused, at no model cost',
                                  ai_coe: 'A saved answer to a similar question was reused',
                                })}
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-100 text-blue-700 border-blue-200"
                              >
                                <Database className="w-2.5 h-2.5" />
                                {sp({ technical: 'Cached', finance: 'Reused', ai_coe: 'Reused' })}
                              </span>
                            )}
                            {!entry.autoRouted && !entry.cached && (
                              <span className="text-slate-300">--</span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                                  {sp({ technical: 'Full prompt', finance: 'Full question', ai_coe: 'Full prompt' })}
                                </p>
                                <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded-lg p-3 max-h-48 overflow-auto">
                                  {entry.prompt || `(${notCaptured})`}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                                  {sp({ technical: 'Full completion or fault message', finance: 'Full answer', ai_coe: 'Full answer' })}
                                </p>
                                <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded-lg p-3 max-h-48 overflow-auto">
                                  {entry.response || entry.errorMessage || `(${notCaptured})`}
                                </pre>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-[11px] text-slate-500 font-mono">
                              <span>
                                Tracking ID:{' '}
                                <span className="text-slate-700">
                                  {entry.trackingId || '--'}
                                </span>
                              </span>
                              <span>
                                Provider:{' '}
                                <span className="text-slate-700">
                                  {entry.provider || '--'}
                                </span>
                              </span>
                              <span>
                                Path:{' '}
                                <span className="text-slate-700">
                                  {entry.pathSuffix || '--'}
                                </span>
                              </span>
                              <span>
                                {Term(voice, 'latency')}:{' '}
                                <span className="text-slate-700">
                                  {entry.latencyMs === null ? '--' : `${entry.latencyMs} ms`}
                                </span>
                              </span>
                              <span>
                                Total tokens:{' '}
                                <span className="text-slate-700">
                                  {entry.totalTokens.toLocaleString()}
                                </span>
                              </span>
                              <span>
                                Environment:{' '}
                                <span className="text-slate-700">
                                  {entry.environment || '--'}
                                </span>
                              </span>
                              {entry.faultName && (
                                <span>
                                  {sp({ technical: 'Faulting policy:', finance: 'Blocked by:', ai_coe: 'Blocked by:' })}{' '}
                                  <span className="text-amber-600">
                                    {entry.faultName}
                                  </span>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <p className="text-[11px] text-slate-500">
            {sp({
              technical:
                'Source: the AI proxy\'s Cloud Logging entries, written after the response is sent and on fault rules too, so 4xx policy blocks and 5xx faults appear alongside 2xx calls. Up to the newest 100. Click a row for the full prompt, completion and faulting policy.',
              finance:
                'From the gateway request logs. Each row shows what that request cost; reused answers and blocked requests show no model cost. Click a row for the full question and answer.',
              ai_coe:
                'From the gateway request logs. Blocked requests are recorded alongside answered ones, so you can see what the safety controls stopped and why. Click a row for the full prompt and answer.',
            })}
          </p>
        </div>
      </div>
    </div>
  );
};
