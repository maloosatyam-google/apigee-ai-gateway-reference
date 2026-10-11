import { parseTokenQuota } from '../utils/tokenQuota';
import { GatewaySettings, GatewayTelemetry, ChatMessage } from '../types';
import { getEnvironment, getUserInfo, USERS, DEFAULT_SSO_USER } from './defaultSettings';
import { AI_BASE_PROD } from '../config/deployment.js';

export interface GenerateContentResult {
  success: boolean;
  text: string;
  telemetry: GatewayTelemetry;
  error?: string;
}

// The gateway exposes a single surface for every model and provider:
//   /ai/v1/auto                              -> intelligent auto-routing
//   /ai/v1/models/{model}:generateContent    -> direct model execution
// Anthropic models are reached through the same path; the gateway translates
// the request and the response, so callers never speak the Anthropic wire format.
export function getGatewayTargetUrl(settings: GatewaySettings, modelOverride?: string): string {
  const envInfo = getEnvironment(settings.environment);
  const targetModel = modelOverride || settings.model || 'auto';
  const base = envInfo.upstreamUrl || AI_BASE_PROD;
  if (targetModel === 'auto') {
    return `${base}/auto`;
  }
  return `${base}/models/${targetModel}:generateContent`;
}

/**
 * Per-call knobs that must NOT leak into sticky GatewaySettings.
 *
 * The token-quota demo needs each call to consume a predictable number of tokens, which
 * the normal chat path cannot give: it replays the whole conversation, so every call is
 * larger than the last, and an uncapped answer varies in length.
 */
export interface PromptRequestOptions {
  /** Send only the current message, not the chat history. */
  stateless?: boolean;
  /** generationConfig.maxOutputTokens (mapped to Anthropic max_tokens by ClaudeRequestPrep). */
  maxOutputTokens?: number;
}

// `x-gateway-category` carries the router's raw verdict, which is a lowercase
// enum (`simple` | `general` | `deep_reasoning` | `coding`). Render it as-is and
// the trace viewer shows "deep_reasoning" to a customer, so map it to a label.
//
// This is presentation only. It never decides a category, it only renames one
// the gateway already decided.
const ROUTER_CATEGORY_LABELS: Record<string, string> = {
  simple: 'Simple',
  general: 'General',
  deep_reasoning: 'Deep Reasoning',
  coding: 'Coding',
};

export function formatRouterCategory(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  // An unrecognised category means the gateway grew a new one. Title-case it
  // rather than dropping it: showing an unstyled but truthful label beats
  // silently hiding the fact that routing happened.
  return (
    ROUTER_CATEGORY_LABELS[key] ||
    key
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

export async function sendPromptToApigee(
  userMessage: string,
  settings: GatewaySettings,
  history: ChatMessage[] = [],
  requestOptions: PromptRequestOptions = {}
): Promise<GenerateContentResult> {
  const startTime = performance.now();

  // Determine base URL (via Vite proxy or direct custom) with safe fallback
  let baseUrl = '';
  if (settings.environment === 'custom') {
    baseUrl = (settings.customBaseUrl || '').replace(/\/$/, '');
  } else {
    const envInfo = getEnvironment(settings.environment);
    baseUrl = envInfo.proxyPath || '/api/ai-prod';
  }

  // Model selection. Every model resolves to the same two-path surface, so there
  // is no provider-specific endpoint or wire format to special-case here.
  const targetModel = settings.model || 'gemini-3.5-flash-lite';
  const isAuto = settings.model === 'auto';

  const endpointUrl = isAuto
    ? `${baseUrl}/auto`
    : `${baseUrl}/models/${targetModel}:generateContent`;

  // Canonical request body: the Vertex AI generateContent `contents` shape.
  // For Anthropic models the gateway converts this to the Claude messages
  // format on the way out and converts the reply back on the way in.
  const contentsPayload = (requestOptions.stateless ? [] : history)
    .filter((msg) => !msg.isError && (msg.sender === 'user' || msg.sender === 'agent'))
    .map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));

  contentsPayload.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const requestBody: any = {
    contents: contentsPayload,
  };
  if (requestOptions.maxOutputTokens && requestOptions.maxOutputTokens > 0) {
    requestBody.generationConfig = { maxOutputTokens: requestOptions.maxOutputTokens };
  }

  // Resolve active user entitlement and dynamic SSO caller email
  const userInfo = getUserInfo(settings.activeUser);

  // A named persona must resolve to its OWN key and nothing else.
  // settings.apiKey is sticky session state that is pinned to the admin key at
  // load (App.tsx), so preferring it here would make the persona selector
  // cosmetic and silently send Engineering & IT credentials as any persona.
  const isNamedPersona = !!settings.activeUser && settings.activeUser in USERS;
  let effectiveApiKey = isNamedPersona ? userInfo.apiKey : (settings.apiKey || userInfo.apiKey);
  let effectiveIdToken = settings.ssoUser?.idToken || settings.idToken;

  if ((!effectiveApiKey || (!effectiveIdToken && !settings.omitEmailHeader)) && typeof window !== 'undefined') {
    try {
      const meRes = await fetch('/api/me');
      if (meRes.ok) {
        const meData = await meRes.json();
        const apiKeys = meData.apiKeys || {};
        if (apiKeys.admin || meData.apiKey) USERS.admin.apiKey = apiKeys.admin || meData.apiKey;
        if (apiKeys.sales_agent) USERS.sales_agent.apiKey = apiKeys.sales_agent;
        if (apiKeys.loans_agent) USERS.loans_agent.apiKey = apiKeys.loans_agent;
        // Resolve strictly within the active persona. Falling through to
        // meData.apiKey or the admin key here would re-introduce the escalation.
        if (!effectiveApiKey) {
          effectiveApiKey = isNamedPersona
            ? (apiKeys[settings.activeUser] || USERS[settings.activeUser]?.apiKey || '')
            : (apiKeys[settings.activeUser] || meData.apiKey || USERS.admin.apiKey);
        }
        if (!effectiveIdToken && meData.token) {
          effectiveIdToken = meData.token;
          if (settings.ssoUser) {
            settings.ssoUser.idToken = meData.token;
          }
        }
      }
    } catch (e) {
      console.warn('[apigeeClient] Failed to auto-resolve credentials from /api/me', e);
    }
  }
  if (!effectiveApiKey && !isNamedPersona) {
    effectiveApiKey = USERS.admin.apiKey || '';
  }
  if (!effectiveApiKey) {
    // Deliberately send no key rather than borrowing another persona's.
    // The gateway will reject with 401, which is the correct, visible outcome.
    console.warn(
      `[apigeeClient] No API key resolved for persona "${settings.activeUser}". ` +
      'Sending request without x-apikey; expect HTTP 401.'
    );
  }

  const effectiveEmail = settings.ssoUser?.email || settings.userEmail || DEFAULT_SSO_USER.email;

  const headersSent: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-apikey': effectiveApiKey,
  };

  // Attach caller identity unless intentionally omitted for the 401 test scenario.
  //
  // The gateway resolves identity solely from the JWT `email` claim
  // (EV-ExtractBearerToken -> DJWT-ExtractUserIdentity -> AM-SetUserIdentity).
  // The old X-User-Email fallback was removed from the proxy, so the token is
  // now the only identity we send. `/api/me` always supplies one.
  if (!settings.omitEmailHeader && effectiveIdToken) {
    headersSent['Authorization'] = `Bearer ${effectiveIdToken}`;
  }

  if (settings.useCache) {
    headersSent['use-cache'] = 'true';
  }

  let responseStatus = 0;
  let responseStatusText = '';
  const headersReceived: Record<string, string> = {};
  let rawResponseBody: any = null;

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: headersSent,
      body: JSON.stringify(requestBody),
    });

    responseStatus = res.status;
    responseStatusText = res.statusText;

    // Capture response headers
    res.headers.forEach((val, key) => {
      headersReceived[key.toLowerCase()] = val;
    });

    const responseText = await res.text();
    try {
      rawResponseBody = JSON.parse(responseText);
    } catch {
      rawResponseBody = { raw: responseText };
    }

    const durationMs = Math.round(performance.now() - startTime);

    // Analyze Apigee Model Armor / Fault response
    const fault = rawResponseBody?.fault || rawResponseBody?.error;
    const isModelArmorBlock =
      responseStatus === 400 &&
      (JSON.stringify(rawResponseBody).toLowerCase().includes('model armor') ||
        JSON.stringify(rawResponseBody).toLowerCase().includes('sanitize') ||
        JSON.stringify(rawResponseBody).toLowerCase().includes('blocked') ||
        JSON.stringify(rawResponseBody).toLowerCase().includes('sup-userprompt'));

    // Check token counts (Vertex AI, Anthropic Claude, or OpenAI format)
    const usage = rawResponseBody?.usageMetadata || rawResponseBody?.usage || {};
    const promptTokens = usage.promptTokenCount ?? usage.input_tokens ?? usage.prompt_tokens;
    const candidatesTokens = usage.candidatesTokenCount ?? usage.output_tokens ?? usage.completion_tokens;
    const totalTokens = usage.totalTokenCount ?? usage.total_tokens ?? ((promptTokens || 0) + (candidatesTokens || 0));

    // Determine cache status from Apigee response headers
    let cacheStatus: 'HIT' | 'MISS' | 'DISABLED' = 'DISABLED';
    if (headersReceived['x-gateway-cache-status']) {
      cacheStatus = headersReceived['x-gateway-cache-status'] as 'HIT' | 'MISS' | 'DISABLED';
    } else if (settings.useCache) {
      if (headersReceived['x-gateway-cached'] === 'true') {
        cacheStatus = 'HIT';
      } else {
        cacheStatus = 'MISS';
      }
    }

    // A semantic-cache hit that the gateway did not attribute to any model.
    //
    // SCL-Semantic-Cache-Lookup keys on {flow.userPrompt} ALONE - the model is
    // deliberately not part of the key - and since the router chain lives in
    // AutoRoutingFlow it is skipped entirely on a hit, so no x-gateway-model
    // comes back. There is genuinely no model to name here: the cached bytes
    // may have been produced by a different model than the one this request
    // asked for, which is true of a direct model-path hit as much as an /auto one.
    //
    // So we do not fall back to `targetModel`. That would print the literal
    // string "auto" for an /auto request, and would actively assert a false
    // model for a direct one. Same rule the cost and intent fields above
    // already follow: absent beats invented.
    const cacheHitUnattributed = cacheStatus === 'HIT' && !headersReceived['x-gateway-model'];

    // Determine guardrail status
    let guardrailStatus: 'PASSED' | 'BLOCKED' | 'FLAGGED' | 'NONE' = 'NONE';
    let guardrailMessage: string | undefined = undefined;

    if (isModelArmorBlock) {
      guardrailStatus = 'BLOCKED';
      guardrailMessage =
        fault?.faultstring ||
        fault?.message ||
        'Request blocked by prompt sanitization due to a potential safety violation.';
    } else if (responseStatus >= 200 && responseStatus < 300) {
      guardrailStatus = 'PASSED';
    }

    // Extract text from Vertex AI candidates, Claude content, or OpenAI choices
    let assistantText = '';
    const candidates = rawResponseBody?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const parts = candidates[0]?.content?.parts;
      if (Array.isArray(parts)) {
        assistantText = parts.map((p: any) => p.text || '').join('\n');
      }
    } else if (Array.isArray(rawResponseBody?.content)) {
      assistantText = rawResponseBody.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .join('\n');
    } else if (typeof rawResponseBody?.content === 'string') {
      assistantText = rawResponseBody.content;
    } else if (Array.isArray(rawResponseBody?.choices)) {
      assistantText = rawResponseBody.choices.map((c: any) => c.message?.content || '').join('\n');
    }

    const effectivePromptTokens = promptTokens ?? (headersReceived['x-gateway-prompt-tokens'] ? parseInt(headersReceived['x-gateway-prompt-tokens'], 10) : undefined);
    const effectiveCandidatesTokens = candidatesTokens ?? (headersReceived['x-gateway-completion-tokens'] ? parseInt(headersReceived['x-gateway-completion-tokens'], 10) : undefined);
    const effectiveTotalTokens = totalTokens ?? (headersReceived['x-gateway-total-tokens'] ? parseInt(headersReceived['x-gateway-total-tokens'], 10) : undefined);
    const effectiveProvider = cacheHitUnattributed
      ? undefined
      : (headersReceived['x-gateway-provider'] || (targetModel.startsWith('claude') ? 'anthropic' : 'google'));
    // See the cacheHitUnattributed comment above: undefined rather than a fabricated
    // model name.
    //
    // The `isAuto` arm extends the same rule to /auto. There the fallback would be the
    // literal string "auto", which is a URL path segment, not a model - and it is most
    // visible exactly when the call failed. A 401 from the identity check returns no
    // x-gateway-* headers at all, and the panel would confidently report that the router
    // picked a model named "auto". A direct /models/<name> call is different: the client
    // named the model itself, so echoing it back asserts nothing the caller did not
    // already state.
    const effectiveModel: string | undefined = cacheHitUnattributed
      ? undefined
      : (headersReceived['x-gateway-model'] || (isAuto ? undefined : targetModel));
    // Cost is NOT recomputed client-side. JS-CalculateCost in the gateway is the single
    // costing authority and derives both figures from the ai-model-rates KVM, on cache
    // hits too. The previous fallbacks invented a $0.20/1M blended rate and guessed the
    // tier by substring-matching the model name, which mis-tiers gemini-3.6-flash and
    // gemini-3.8-flash: 9.00 vs 3.75 per 1M output, the opposite of what the names suggest. When the
    // header is absent the value stays undefined and the trace viewer hides the chip,
    // which is honest; a wrong number is not.
    const effectiveCostUsd = headersReceived['x-gateway-cost-usd'] || undefined;
    const effectiveCostTier = headersReceived['x-gateway-cost-tier'] || undefined;
    // Intent is NOT guessed client-side. The gateway's router is the single
    // classification authority and reports its verdict in `x-gateway-category`.
    //
    // The previous fallback substring-matched the model name, which cannot work:
    // gemini-3.5-flash-lite (`simple`) and gemini-3.6-flash (`general`)
    // both contain "flash", so every simple request was mislabelled
    // "General / Fast", and there was no `simple` case at all. That is the same
    // mistake the cost fallback above made by guessing the tier from the model
    // name. When the header is absent the value stays undefined and the trace
    // viewer hides the chip, which is honest; a wrong label is not.
    const effectiveCategory = headersReceived['x-gateway-category'] || headersReceived['x-gateway-intent'];
    const effectiveIntent: string | undefined = formatRouterCategory(effectiveCategory);

    // Record real-time session wallet debit so Start Balance -> Remaining chains continuously across requests.
    // The server reads the starting balance from Apigee's developer balance API; the client
    // only reports the amount. If Apigee can't be read the balances come back null and the
    // gateway's own headers (if any) are left untouched — no balance is ever invented.
    if (responseStatus >= 200 && responseStatus < 300) {
      const amountToDebit = cacheStatus === 'HIT' ? 0 : parseFloat(effectiveCostUsd || '0');
      try {
        const debitRes = await fetch('/api/monetization/debit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            developer: effectiveEmail,
            amountUsd: isNaN(amountToDebit) ? 0 : amountToDebit,
          }),
        });
        if (debitRes.ok) {
          const debitData = await debitRes.json();
          if (typeof debitData.startBalanceUsd === 'number' && typeof debitData.remainingBalanceUsd === 'number') {
            headersReceived['x-gateway-prepaid-balance'] = debitData.startBalanceUsd.toFixed(6);
            headersReceived['x-gateway-balance-remaining'] = debitData.remainingBalanceUsd.toFixed(6);
          }
        }
      } catch {
        // Fallback if backend debit ledger unreachable
      }
    }

    const telemetry: GatewayTelemetry = {
      status: responseStatus,
      statusText: responseStatusText || (responseStatus === 200 ? 'OK' : 'Error'),
      endpointUrl,
      targetUrl: getGatewayTargetUrl(settings, targetModel),
      model: effectiveModel,
      requestedModel: settings.model,
      // Not "Auto-Routed" on an unattributed cache hit. isAuto only says the
      // client called /auto; the router never ran, so nothing was routed.
      //
      // The same caveat applies to a call that never reached the router at all - a 401
      // from the identity check, say. `effectiveModel` is the evidence that routing
      // happened: the gateway only names a model once it has picked one.
      autoRouted: cacheHitUnattributed
        ? false
        : (headersReceived['x-auto-routed'] === 'true' || (isAuto && !!effectiveModel)),
      intent: effectiveIntent,
      tokenQuota: parseTokenQuota(headersReceived),
      environment: settings.environment,
      user: userInfo.name,
      userEmail: effectiveEmail,
      ssoUser: settings.ssoUser || DEFAULT_SSO_USER,
      latencyMs: durationMs,
      promptTokens: effectivePromptTokens,
      candidatesTokens: effectiveCandidatesTokens,
      totalTokens: effectiveTotalTokens,
      provider: effectiveProvider,
      costUsd: effectiveCostUsd,
      costTier: effectiveCostTier,
      cacheStatus,
      guardrailStatus,
      guardrailMessage,
      headersSent,
      headersReceived,
      rawRequest: requestBody,
      rawResponse: rawResponseBody,
      // Backwards compatibility aliases
      'x-gateway-model': effectiveModel,
      'x-gateway-provider': effectiveProvider,
      'x-auto-routed': cacheHitUnattributed ? 'false' : (headersReceived['x-auto-routed'] || (isAuto ? 'true' : 'false')),
      'x-gateway-cost-usd': effectiveCostUsd,
      'x-gateway-cost-tier': effectiveCostTier,
      'x-prompt-tokens': effectivePromptTokens ? String(effectivePromptTokens) : undefined,
      'x-candidate-tokens': effectiveCandidatesTokens ? String(effectiveCandidatesTokens) : undefined,
      'x-total-tokens': effectiveTotalTokens ? String(effectiveTotalTokens) : undefined,
      'x-gateway-cached': cacheStatus === 'HIT' ? 'true' : 'false',
      'x-gateway-latency-ms': String(durationMs),
      total_e2e_latency_ms: durationMs,
    };

    if (res.ok && assistantText) {
      return {
        success: true,
        text: assistantText,
        telemetry,
      };
    }

    // Handle fault cases (e.g. RF-MissingUserEmail, Model Armor, Invalid API Key)
    let errorMessage = `Gateway returned HTTP ${responseStatus} (${responseStatusText})`;
    if (fault?.faultstring) {
      errorMessage = `[Gateway Policy Fault]: ${fault.faultstring}`;
    } else if (fault?.message) {
      errorMessage = `[Gateway Error]: ${fault.message}`;
    } else if (rawResponseBody?.message) {
      errorMessage = rawResponseBody.message;
    }

    return {
      success: false,
      text: isModelArmorBlock
        ? `🛡️ **Prompt Sanitization Triggered**:\n${errorMessage}`
        : `⚠️ **Gateway Notification (${responseStatus})**:\n${errorMessage}`,
      telemetry,
      error: errorMessage,
    };
  } catch (networkErr: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMsg = networkErr.message || 'Failed to communicate with the Gateway';

    const telemetry: GatewayTelemetry = {
      status: 0,
      statusText: 'Network / Connection Failure',
      endpointUrl,
      targetUrl: getGatewayTargetUrl(settings, settings.model),
      model: settings.model,
      environment: settings.environment,
      user: userInfo.name,
      userEmail: effectiveEmail,
      ssoUser: settings.ssoUser || DEFAULT_SSO_USER,
      latencyMs: durationMs,
      cacheStatus: settings.useCache ? 'MISS' : 'DISABLED',
      guardrailStatus: 'NONE',
      headersSent,
      headersReceived,
      rawRequest: requestBody,
      rawResponse: { error: errorMsg },
      total_e2e_latency_ms: durationMs,
    };

    return {
      success: false,
      text: `🚫 **Network Error**: Unable to reach the Gateway endpoint. Details: ${errorMsg}.`,
      telemetry,
      error: errorMsg,
    };
  }
}
