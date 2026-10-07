import React, { useState } from 'react';
import { GatewayTelemetry, GatewaySettings } from '../types';
import { GoogleLogo, AnthropicLogo } from './ProviderLogos';
import { usePersonaVoice } from '../utils/voice';
import {
  Activity,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Database,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Code2,
  Send,
  Coins,
  Zap,
  History,
} from 'lucide-react';

interface GatewayTraceViewerProps {
  telemetry?: GatewayTelemetry | null;
  settings: GatewaySettings;
  onToggleCache: () => void;
  /** True when the inspector is showing an earlier call rather than the most recent one. */
  isHistorical?: boolean;
  onReturnToLatest?: () => void;
}

export const GatewayTraceViewer: React.FC<GatewayTraceViewerProps> = ({
  telemetry,
  settings,
  onToggleCache,
  isHistorical = false,
  onReturnToLatest,
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  // Rendered inside the AI Gateway playground, so the consumer persona sets the voice:
  // technical = Engineering & IT (builder), analysts, support.
  const { sp } = usePersonaVoice('persona');
  const [copied, setCopied] = useState(false);

  const handleCopyJson = () => {
    if (!telemetry) return;
    navigator.clipboard.writeText(JSON.stringify(telemetry.rawResponse, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 200) return 'text-emerald-600';
    if (ms < 1000) return 'text-blue-600';
    if (ms < 2500) return 'text-amber-600';
    return 'text-rose-600';
  };

  if (!telemetry) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500">
        <Activity className="w-10 h-10 mb-3 text-slate-700 animate-pulse" />
        <p className="font-semibold text-slate-400 text-sm">
          {sp({ technical: 'Waiting for your first call', analysts: 'Analysis details appear here', support: 'Reply details appear here' })}
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
          {sp({
            technical: 'Send a prompt or run a scenario to see the status code, x-gateway-* headers, tokens, latency and cost of each call.',
            analysts: 'Ask a question to see which model analysed it, what it cost and how confidential data was protected.',
            support: 'Ask for a reply to see how fast it came back, what it cost and whether it passed the safety checks.',
          })}
        </p>
      </div>
    );
  }

  const isBlocked = telemetry.guardrailStatus === 'BLOCKED';
  const isCacheHit = telemetry.cacheStatus === 'HIT';
  const isOk = telemetry.status >= 200 && telemetry.status < 300;
  // Plain outcome for Analysts and Support & Sales; the HTTP code stays for Engineering & IT.
  const statusLabel = sp({
    technical: `HTTP ${telemetry.status} ${telemetry.statusText}`,
    analysts: isOk
      ? 'Answered'
      : telemetry.status === 429
      ? 'Limit reached'
      : telemetry.status === 400
      ? 'Blocked: data safety'
      : telemetry.status === 401 || telemetry.status === 403
      ? 'Blocked: not allowed'
      : 'Not answered',
    support: isOk
      ? 'Reply ready'
      : telemetry.status === 429
      ? 'Limit reached'
      : telemetry.status === 400
      ? 'Blocked: unsafe'
      : telemetry.status === 401 || telemetry.status === 403
      ? 'Blocked: not allowed'
      : 'No reply',
  });

  return (
    <div className="h-full flex flex-col surface-telemetry font-sans text-xs overflow-y-auto">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
            {sp({ technical: 'Response Telemetry', analysts: 'Analysis details', support: 'Reply details' })}
          </h2>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
            telemetry.status >= 200 && telemetry.status < 300
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {/*
        Viewing an earlier call. Without this the inspector silently stops tracking new
        responses after you click an old one, which reads as a bug rather than a mode.
      */}
      {isHistorical && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800">
            <History className="w-3 h-3" />
            {sp({ technical: 'Inspecting an earlier call', analysts: 'Showing an earlier analysis', support: 'Showing an earlier reply' })}
          </span>
          {onReturnToLatest && (
            <button
              type="button"
              onClick={onReturnToLatest}
              className="px-2 py-0.5 rounded-md bg-white hover:bg-amber-100 text-amber-800 border border-amber-300 font-semibold text-[10px] transition cursor-pointer"
            >
              {sp({ technical: 'Back to latest', business: 'Back to latest' })}
            </button>
          )}
        </div>
      )}

      {/* Focused Telemetry Cards Container */}
      <div className="p-3 space-y-2">
        {/*
          1. Smart Routing

          Highlighted only when the router actually picked the model, i.e. a /auto call
          that reached a model. On a direct /models/<name> call there is no routing
          decision to celebrate, and on an unattributed cache hit no model ran at all -
          `autoRouted` is already false for both, so the card stays quiet.
        */}
        <div
          data-tour-id="telemetry-model-routing"
          className={`p-2.5 border rounded-xl space-y-1 shadow-2xs transition ${
            telemetry.autoRouted
              ? 'bg-purple-50/70 border-purple-300 ring-1 ring-purple-200'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Routed Model', business: 'Model used' })}
              </span>
            </div>
            {telemetry.autoRouted && (
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                {sp({ technical: 'model=auto', business: 'Chosen automatically' })}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 font-mono truncate">
                {telemetry.model || (isCacheHit ? 'Served from cache' : sp({ technical: 'No model reported', business: 'No AI model used' }))}
              </div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                {telemetry.model ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    {telemetry.model.startsWith('claude') ? (
                      <AnthropicLogo className="w-3 h-3" />
                    ) : (
                      <GoogleLogo className="w-3 h-3" />
                    )}
                    <span>{telemetry.provider || (telemetry.model.startsWith('claude') ? 'Anthropic' : 'Google')}</span>
                  </span>
                ) : isCacheHit ? (
                  // The cache keys on the prompt alone and the router is skipped on a
                  // hit, so the gateway names no model and neither do we.
                  <span>
                    {sp({
                      technical: 'No model call · served from semantic cache',
                      analysts: 'No AI model needed: an earlier analysis was reused',
                      support: 'No AI model needed: an earlier reply was reused',
                    })}
                  </span>
                ) : (
                  // Not a cache hit and still no model: the request did not get far
                  // enough to be routed - a rejected identity, a blocked prompt. Saying
                  // "served from cache" here would invent a mechanism that never ran.
                  <span>
                    {sp({
                      technical: 'Rejected before routing: no model call',
                      analysts: 'Stopped before it reached the AI',
                      support: 'Stopped before it reached the AI',
                    })}
                  </span>
                )}
                {telemetry.costTier && (
                  <>
                    <span>•</span>
                    <span className="uppercase font-medium">{telemetry.costTier} Cost</span>
                  </>
                )}
                {telemetry.intent && (
                  <>
                    <span>•</span>
                    <span className="text-purple-600 font-semibold">{telemetry.intent}</span>
                  </>
                )}
              </div>
            </div>

            {telemetry.costUsd && (
              <div className="text-right shrink-0 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                <div className="text-[9px] text-slate-400 uppercase font-medium">{sp({ technical: 'Cost (USD)', analysts: 'Cost of this analysis', support: 'Cost of this reply' })}</div>
                <div className="text-xs font-mono font-bold text-emerald-600">
                  ${telemetry.costUsd}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 2. Token (renamed from Token Quotas & Accounting) */}
        <div className={`p-2.5 bg-white border rounded-xl shadow-2xs ${
          telemetry.status === 429
            ? 'border-amber-300 bg-amber-50/70'
            : 'border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className={`w-3.5 h-3.5 ${telemetry.status === 429 ? 'text-amber-500' : 'text-blue-500'}`} />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Tokens', business: 'Usage' })}
              </span>
            </div>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-medium ${
              telemetry.status === 429
                ? 'text-amber-700 bg-amber-50 border-amber-200 font-bold'
                : 'text-slate-600 bg-slate-50 border-slate-200'
            }`}>
              {telemetry.status === 429
                ? sp({ technical: '⚠️ 429 Quota', business: '⚠️ Limit reached' })
                : sp({ technical: 'Per-user quota', business: 'Limit applies' })}
            </span>
          </div>

          {telemetry.status === 429 ? (
            <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-900 font-medium">
              {sp({
                technical: 'Rejected with 429 by LTQ-TokenEnforce: the per-minute token quota your API product sets for this model is used up. Back off and retry once the window rolls.',
                analysts: "This minute's allowance is used up, so the analysis was refused and nothing was charged. Try again in a minute.",
                support: "This minute's allowance is used up, so no reply was drafted and nothing was charged. Try again in a minute.",
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[11px]">
              <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                <div className="text-slate-400 text-[9px] font-sans">{sp({ technical: 'Prompt', business: 'Question' })}</div>
                <div className="font-bold text-slate-800">
                  {telemetry.promptTokens ?? (telemetry.status === 200 ? '—' : 0)}
                </div>
              </div>
              <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                <div className="text-slate-400 text-[9px] font-sans">{sp({ technical: 'Output', analysts: 'Answer', support: 'Reply' })}</div>
                <div className="font-bold text-slate-800">
                  {telemetry.candidatesTokens ?? (telemetry.status === 200 ? '—' : 0)}
                </div>
              </div>
              <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                <div className="text-slate-400 text-[9px] font-sans">Total</div>
                <div className="font-bold text-emerald-600">
                  {telemetry.totalTokens ?? (telemetry.status === 200 ? '—' : 0)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. Latency (renamed from Response Latency) */}
        <div
          data-tour-id="telemetry-latency"
          className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Latency', business: 'Response time' })}
              </span>
            </div>
            <span className="text-[9px] font-mono text-slate-400">{sp({ technical: 'Client round trip', business: 'End to end' })}</span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className={`text-xl font-bold font-mono ${getLatencyColor(telemetry.latencyMs)}`}>
              {telemetry.latencyMs}{' '}
              <span className="text-xs font-sans text-slate-500 font-normal">ms</span>
            </div>

            {isCacheHit ? (
              <span className="text-[9px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                <Zap className="w-3 h-3 fill-emerald-500" />
                {sp({ technical: 'Cache Hit (~90% faster)', analysts: 'Reused analysis (~90% faster)', support: 'Reused reply (~90% faster)' })}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-slate-500">
                {sp({ technical: 'Live model call', analysts: 'Fresh analysis from the AI', support: 'Fresh reply from the AI' })}
              </span>
            )}
          </div>
        </div>

        {/*
          4. Semantic Cache

          Highlighted when the cache actually served the answer. This is one of the two
          cards that carry a demo, so it gets a tinted surface and a ring rather than a
          numeric delta - the point a presenter makes is "this came from the cache", not
          "this was 62% faster than last time".
        */}
        <div
          data-tour-id="telemetry-semantic-cache"
          className={`p-2.5 border rounded-xl shadow-2xs transition ${
            isCacheHit
              ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Semantic Cache', business: 'Answer reuse' })}
              </span>
            </div>

            <button
              onClick={onToggleCache}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border transition cursor-pointer ${
                settings.useCache
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title={sp({ technical: 'Toggle the use-cache request header', analysts: 'Turn reuse of earlier analyses on or off', support: 'Turn reuse of earlier replies on or off' })}
            >
              {settings.useCache ? sp({ technical: 'use-cache: true', business: 'On' }) : sp({ technical: 'use-cache: omitted', business: 'Off' })}
            </button>
          </div>

          {/*
            The verdict describes THIS call, so it reads cacheStatus, not the live
            `settings.useCache` toggle above it. Those two disagree the moment you flip
            the toggle - or look back at an earlier call - and the toggle used to win,
            which meant a genuine cache hit could be labelled "Bypassed".
          */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">
              {isCacheHit ? (
                <span className="text-emerald-600 flex items-center gap-1 font-bold">
                  <Zap className="w-3.5 h-3.5 fill-emerald-500" />
                  {sp({ technical: 'Cache Hit: no model call', analysts: 'Analysis reused (no model cost)', support: 'Reply reused (no model cost)' })}
                </span>
              ) : telemetry.cacheStatus === 'MISS' ? (
                <span className="text-slate-700">
                  {sp({ technical: 'Cache Miss: response stored', analysts: 'New analysis, saved for reuse', support: 'New reply, saved for reuse' })}
                </span>
              ) : (
                <span className="text-slate-500">
                  {sp({ technical: 'Bypassed (no use-cache header)', analysts: 'Not used (fresh analysis)', support: 'Not used (fresh reply)' })}
                </span>
              )}
            </div>

            {isCacheHit && (
              <span className="text-[9px] font-mono font-bold text-emerald-600">
                {sp({ technical: '$0 token cost', business: '$0 model cost' })}
              </span>
            )}
          </div>
        </div>

        {/* 5. Model Armor */}
        <div className={`p-2.5 rounded-xl border transition shadow-2xs ${
          isBlocked
            ? 'bg-rose-50 border-rose-200'
            : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              {isBlocked ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Prompt Sanitization', analysts: 'Data protection', support: 'Safety checks' })}
              </span>
            </div>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-medium ${
              isBlocked
                ? 'text-rose-700 bg-rose-50 border-rose-200 font-bold'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200'
            }`}>
              {isBlocked ? sp({ technical: 'Blocked (400)', business: 'Blocked' }) : sp({ technical: 'Passed', analysts: 'Protected', support: 'Safe' })}
            </span>
          </div>

          <div className="text-xs font-semibold">
            {isBlocked ? (
              <span className="text-rose-600">
                {sp({
                  technical: telemetry.guardrailMessage || 'Rejected with 400 by Model Armor before routing. Treat it as non-retryable and show the user a safe message.',
                  analysts: 'Blocked to protect confidential data. The request never reached the AI.',
                  support: 'Blocked because it was not safe. No reply was drafted, so nothing reached a customer.',
                })}
              </span>
            ) : (
              <span className="text-emerald-600 flex items-center gap-1">
                {sp({ technical: 'Passed Model Armor: no findings', analysts: 'No confidential data or safety issues found', support: 'Safe to send: no issues found' })}
              </span>
            )}
          </div>
        </div>

        {/* 6. Wallet (renamed from Monetization & Wallet) */}
        <div className={`p-2.5 bg-white border rounded-xl shadow-2xs ${
          telemetry.status === 403 && (telemetry.headersReceived['x-gateway-monetization-status'] || JSON.stringify(telemetry.rawResponse || {}).includes('Monetization') || JSON.stringify(telemetry.rawResponse || {}).includes('prepaid'))
            ? 'border-rose-300 bg-rose-50/70'
            : 'border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'Prepaid Wallet', business: 'Prepaid credit' })}
              </span>
            </div>
            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-medium ${
              telemetry.status === 403 && (telemetry.headersReceived['x-gateway-monetization-status'] || JSON.stringify(telemetry.rawResponse || {}).includes('Monetization') || JSON.stringify(telemetry.rawResponse || {}).includes('prepaid'))
                ? 'text-rose-700 bg-rose-50 border-rose-200 font-bold'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200'
            }`}>
              {telemetry.status === 403 && (telemetry.headersReceived['x-gateway-monetization-status'] || JSON.stringify(telemetry.rawResponse || {}).includes('Monetization') || JSON.stringify(telemetry.rawResponse || {}).includes('prepaid'))
                ? sp({ technical: '❌ 403 Depleted', business: '❌ Out of credit' })
                : sp({ technical: 'Balance OK', business: 'Credit available' })}
            </span>
          </div>

          {telemetry.status === 403 && (telemetry.headersReceived['x-gateway-monetization-status'] || JSON.stringify(telemetry.rawResponse || {}).includes('Monetization') || JSON.stringify(telemetry.rawResponse || {}).includes('prepaid')) ? (
            <div className="p-1.5 bg-rose-50 border border-rose-200 rounded-lg text-[10px] text-rose-900 font-medium">
              {sp({
                technical: 'Rejected with 403: the prepaid balance behind this key is $0.00. Every call fails the same way until an admin tops it up in the Admin Console.',
                analysts: "Your team's prepaid credit has run out, so analyses are paused until an admin tops it up in the Admin Console.",
                support: "Your team's prepaid credit has run out, so replies are paused until an admin tops it up in the Admin Console.",
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                <div className="text-slate-400 text-[9px] font-sans">{sp({ technical: 'Before call', business: 'Balance before' })}</div>
                <div className="font-bold text-slate-800 truncate">
                  {telemetry.headersReceived['x-gateway-prepaid-balance'] ? `$${telemetry.headersReceived['x-gateway-prepaid-balance']}` : '—'}
                </div>
              </div>
              <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                <div className="text-slate-400 text-[9px] font-sans">{sp({ technical: 'After call', business: 'Balance after' })}</div>
                <div className="font-bold text-emerald-600 truncate">
                  {telemetry.headersReceived['x-gateway-balance-remaining'] ? `$${telemetry.headersReceived['x-gateway-balance-remaining']}` : '—'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Accordion: Deep Technical Details (HTTP Headers & Raw JSON) */}
        <div className="pt-2">
          <button
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-slate-900 transition text-xs shadow-2xs cursor-pointer"
          >
            <div className="flex items-center gap-2 font-medium">
              <Code2 className="w-3.5 h-3.5 text-blue-500" />
              <span>{sp({ technical: 'HTTP Headers & Raw JSON', business: 'Technical details (for IT)' })}</span>
            </div>
            {showTechnicalDetails ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {showTechnicalDetails && (
            <div className="mt-3 space-y-3 font-mono text-[11px] animate-in fade-in duration-150">
              {/* Response Headers Received */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-emerald-500" />
                  Gateway Response Headers (<span className="text-emerald-600">x-gateway-*</span>):
                </div>
                <div className="space-y-1 divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                  {Object.entries(telemetry.headersReceived)
                    .filter(([k]) => k.startsWith('x-gateway') || k.startsWith('x-auto') || k.startsWith('content-type') || k.startsWith('x-accel'))
                    .map(([k, v]) => (
                      <div key={k} className="pt-1 flex items-start justify-between gap-2">
                        <span className="text-emerald-700 font-semibold">{k}:</span>
                        <span className="text-slate-800 text-right break-all font-mono">{v}</span>
                      </div>
                    ))}
                  {Object.keys(telemetry.headersReceived).filter((k) => k.startsWith('x-gateway')).length === 0 && (
                    <div className="text-slate-500 italic text-[10px] py-1">
                      No custom x-gateway headers in direct response (Standard HTTP headers received)
                    </div>
                  )}
                </div>
              </div>

              {/* Request Headers */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                  <Send className="w-3 h-3 text-blue-500" />
                  Request Headers Sent:
                </div>
                <div className="space-y-1 divide-y divide-slate-100">
                  {Object.entries(telemetry.headersSent).map(([k, v]) => (
                    <div key={k} className="pt-1 flex items-start justify-between gap-2">
                      <span className="text-slate-500">{k}:</span>
                      <span className="text-slate-800 text-right break-all">
                        {k.toLowerCase().includes('apikey')
                          ? `${v.slice(0, 8)}...${v.slice(-6)}`
                          : k.toLowerCase() === 'authorization' && v.startsWith('Bearer ')
                          ? `Bearer ${v.slice(7, 19)}...${v.slice(-8)} (Google SSO Token)`
                          : v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw JSON */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800">Raw JSON Response:</span>
                  <button
                    onClick={handleCopyJson}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] cursor-pointer"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 overflow-x-auto text-[10px] text-slate-800 leading-relaxed max-h-60">
                  {JSON.stringify(telemetry.rawResponse, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
