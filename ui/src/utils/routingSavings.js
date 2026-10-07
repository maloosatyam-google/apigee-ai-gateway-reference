// Potential savings from smart routing, measured against a "no routing" baseline in
// which every call is sent to the most expensive model on the rate card.
//
// savings(row) = tokens priced at the benchmark model's rates - the row's actual cost
//
// Rates are USD per 1M tokens, the same unit JS-CalculateCost and the fleet-stats
// endpoint use, so the result lines up with the ledger's costUsd. Rows priced at or
// above the benchmark contribute 0 (never negative), and rows without tokens (blocked
// calls, unknown-model) contribute nothing.

/**
 * Pick the most expensive model on the rate card: highest output rate, then highest
 * input rate. The 'default' fallback entry is not a real model and is ignored.
 * @param {Record<string, {input?: number, output?: number}> | null | undefined} rates
 * @returns {{ model: string, input: number, output: number } | null}
 */
export function findBenchmarkModel(rates) {
  if (!rates || typeof rates !== 'object') return null;
  let best = null;
  for (const [model, r] of Object.entries(rates)) {
    if (model === 'default' || !r) continue;
    const input = Number(r.input);
    const output = Number(r.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    if (!best || output > best.output || (output === best.output && input > best.input)) {
      best = { model, input, output };
    }
  }
  return best;
}

/**
 * @param {Array<{model: string, inputTokens: number, outputTokens: number, costUsd: number}>} rows
 * @param {Record<string, {input?: number, output?: number}> | null | undefined} rates
 * @returns {{ savingsUsd: number, baselineUsd: number, actualUsd: number, benchmarkModel: string } | null}
 *   null when there is no usable rate card or no token-bearing traffic.
 */
export function computeRoutingSavings(rows, rates) {
  const bench = findBenchmarkModel(rates);
  if (!bench || !Array.isArray(rows)) return null;
  let savingsUsd = 0;
  let baselineUsd = 0;
  let actualUsd = 0;
  let counted = 0;
  for (const r of rows) {
    const pt = Number(r?.inputTokens) || 0;
    const ct = Number(r?.outputTokens) || 0;
    if (pt <= 0 && ct <= 0) continue;
    const actual = Number(r?.costUsd) || 0;
    const baseline = (pt / 1_000_000) * bench.input + (ct / 1_000_000) * bench.output;
    baselineUsd += baseline;
    actualUsd += actual;
    savingsUsd += Math.max(0, baseline - actual);
    counted += 1;
  }
  if (counted === 0) return null;
  return { savingsUsd, baselineUsd, actualUsd, benchmarkModel: bench.model };
}
