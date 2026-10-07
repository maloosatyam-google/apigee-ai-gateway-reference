export const TOKEN_WINDOW_MS: number;
export const TOKEN_CALL_BUDGET_MS: number;
export const CACHE_TTL_MS: number;

export type TokenPlan =
  | { action: 'run'; steps: number[]; fresh: boolean }
  | { action: 'wait'; waitMs: number };

export function planTokenSteps(p: {
  target: number;
  lastStep: number;
  seqStartAt: number | null;
  lastCallAt: number | null;
  now: number;
}): TokenPlan;

export function planCacheSteps(p: { target: number; seededAt: number | null; now: number }): number[];
