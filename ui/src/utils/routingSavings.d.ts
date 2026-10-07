export interface BenchmarkModel {
  model: string;
  input: number;
  output: number;
}

export interface RoutingSavings {
  savingsUsd: number;
  baselineUsd: number;
  actualUsd: number;
  benchmarkModel: string;
}

type Rates = Record<string, { input?: number; output?: number }> | null | undefined;

export function findBenchmarkModel(rates: Rates): BenchmarkModel | null;

export function computeRoutingSavings(
  rows: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number }>,
  rates: Rates,
): RoutingSavings | null;
