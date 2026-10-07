/**
 * Token-quota threshold signal from the AI Gateway's response headers.
 *
 * JS-TokenQuotaThreshold (ai-gateway-v1 PostFlow) compares LTQ-TokenCount's used/allowed
 * counters and emits x-gateway-token-quota-*. The gateway is the single authority for the
 * status; this only parses it. Nothing is computed from client-side token counts, because
 * the counter is per SSO user across every tab and device, which the browser cannot see.
 *
 * Returns undefined when the gateway sent no usable signal (cache hit, error, older proxy
 * revision) so the UI shows nothing rather than a guessed percentage.
 *
 * Plain JS (typed by the sibling .d.ts) so tests import the code the UI actually runs.
 */
const STATUSES = new Set(['ok', 'near-threshold', 'exhausted']);

export function parseTokenQuota(headers) {
  if (!headers) return undefined;
  const get = (name) => {
    const raw = headers[name];
    return raw === undefined || raw === null || String(raw).trim() === '' ? undefined : String(raw).trim();
  };
  const num = (name) => {
    const raw = get(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const status = get('x-gateway-token-quota-status');
  const used = num('x-gateway-token-quota-used');
  const limit = num('x-gateway-token-quota-limit');
  const usedPct = num('x-gateway-token-quota-used-pct');
  if (!status || !STATUSES.has(status) || used === undefined || limit === undefined || usedPct === undefined) {
    return undefined;
  }
  return {
    status,
    used,
    limit,
    usedPct,
    thresholdPct: num('x-gateway-token-quota-threshold-pct') ?? 50,
    warning: get('x-gateway-token-quota-warning'),
  };
}

/** True when the UI should show the nearing-threshold / exhausted alert. */
export function isTokenQuotaAlert(signal) {
  return !!signal && (signal.status === 'near-threshold' || signal.status === 'exhausted');
}
