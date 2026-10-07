/**
 * Prerequisite planning for the stateful demo scenarios.
 *
 * Tokenomics (steps 1-4) and Semantic Cache (Seed → Hit) only show the advertised
 * result when the calls before them have already happened: "Blocked (429)" is only a
 * 429 once the 1-minute token window has been filled by steps 1-3, and "Instant Hit"
 * is only a hit once the seed prompt is in the cache. Clicking a later step directly
 * therefore runs the missing earlier steps first.
 *
 * Pure functions (no React, no I/O) so the rules are unit-tested.
 */

/** LLMTokenQuota rolling window used by the token demo (300 tokens / 1 minute). */
export const TOKEN_WINDOW_MS = 60_000;
/** Rough upper bound for one capped Haiku call, used to check a run fits in the window. */
export const TOKEN_CALL_BUDGET_MS = 5_000;
/** Extra slack so a call that is just ageing out doesn't count as "still in window". */
const WINDOW_SLACK_MS = 3_000;

/** Semantic cache TTL (Apigee SemanticCacheLookup/Populate, 180 s). */
export const CACHE_TTL_MS = 180_000;
/** Re-seed a bit before expiry rather than risk a MISS on the "Hit" step. */
const CACHE_MARGIN_MS = 60_000;

const range = (from, to) => {
  const out = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
};

/**
 * @param {object} p
 * @param {number} p.target      step the user clicked (0-3)
 * @param {number} p.lastStep    last token step completed in the current window (-1 = none)
 * @param {number|null} p.seqStartAt  when step 0 of the current run was sent (ms)
 * @param {number|null} p.lastCallAt  when the most recent token-demo call was sent (ms)
 * @param {number} p.now
 * @returns {{action:'run', steps:number[], fresh:boolean} | {action:'wait', waitMs:number}}
 */
export function planTokenSteps({ target, lastStep, seqStartAt, lastCallAt, now }) {
  const windowClear =
    lastStep < 0 || lastCallAt == null || now - lastCallAt >= TOKEN_WINDOW_MS + WINDOW_SLACK_MS;
  if (windowClear) {
    return { action: 'run', steps: range(0, target), fresh: true };
  }

  const elapsed = seqStartAt == null ? Infinity : now - seqStartAt;
  // Repeating the final 429 step while the window is still full is fine: it is still a 429.
  const steps = lastStep === 3 && target === 3 ? [3] : lastStep < target ? range(lastStep + 1, target) : null;
  if (steps) {
    const fits = elapsed + steps.length * TOKEN_CALL_BUDGET_MS < TOKEN_WINDOW_MS - WINDOW_SLACK_MS;
    if (fits) return { action: 'run', steps, fresh: false };
  }

  // The window still holds calls from an earlier run, so neither continuing nor
  // restarting would land the advertised result. Wait until it drains.
  return {
    action: 'wait',
    waitMs: Math.max(1_000, TOKEN_WINDOW_MS + WINDOW_SLACK_MS - (now - lastCallAt)),
  };
}

/**
 * @param {object} p
 * @param {number} p.target        0 = Seed, 1 = Hit
 * @param {number|null} p.seededAt when the seed prompt was last sent successfully (ms)
 * @param {number} p.now
 * @returns {number[]} steps to run, in order
 */
export function planCacheSteps({ target, seededAt, now }) {
  if (target === 0) return [0];
  const seeded = seededAt != null && now - seededAt < CACHE_TTL_MS - CACHE_MARGIN_MS;
  return seeded ? [1] : [0, 1];
}
