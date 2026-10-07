export type TokenQuotaStatus = 'ok' | 'near-threshold' | 'exhausted';

export interface TokenQuotaSignal {
  status: TokenQuotaStatus;
  /** Tokens consumed in the current LLM token-quota window (this response included). */
  used: number;
  /** The API product's llmTokenQuota limit for the matched operation. */
  limit: number;
  usedPct: number;
  thresholdPct: number;
  warning?: string;
}

export function parseTokenQuota(headers: Record<string, string> | undefined | null): TokenQuotaSignal | undefined;
export function isTokenQuotaAlert(signal: TokenQuotaSignal | undefined | null): boolean;
