export type ShowcaseSideId = 'baseline' | 'governed';

export interface ShowcaseScenario {
  id: string;
  step: number;
  title: string;
  prompt: string;
  expect: string;
  /** Fire this many governed-only runs at once, cache off (quota demo). */
  burst?: number;
  /** Switch the ungoverned agent to this model when the scenario is picked. */
  baselineModel?: string;
  /** false: skip answer reuse (semantic cache) for this scenario. */
  useCache?: boolean;
}

export interface ShowcaseTokens {
  prompt: number;
  output: number;
  thoughts: number;
  total: number;
}

export interface ShowcaseLlmItem {
  kind: 'llm';
  side: ShowcaseSideId;
  step: number;
  via: 'apigee' | 'apigee_passthrough' | 'vertex_direct';
  endpoint: string;
  requested_model: string;
  model: string | null;
  status: number;
  latency_ms: number;
  tokens: ShowcaseTokens;
  billable: boolean;
  cache: string | null;
  cache_requested: boolean;
  auto_routed: boolean;
  route_category: string | null;
  function_calls?: string[];
  error?: string;
  t_ms: number;
}

export interface ShowcaseHopItem {
  kind: 'hop';
  method: string;
  server: string;
  endpoint: string;
  status: number;
  latency_ms: number;
  tools?: number;
  t_ms: number;
}

export interface ShowcaseToolCall {
  rpc_id?: number | string;
  name: string;
  args: Record<string, unknown>;
  server?: string;
  t_ms?: number;
}

export interface ShowcaseToolResult {
  rpc_id?: number | string;
  name: string;
  is_error: boolean;
  http_status: number;
  latency_ms: number;
  result: unknown;
  server?: string;
  request_id?: string | null;
  t_ms: number;
}

export interface ShowcaseToolItem {
  kind: 'tool';
  call: ShowcaseToolCall;
  result: ShowcaseToolResult | null;
}

export interface ShowcaseGovernanceItem {
  kind: 'governance';
  govKind: string;
  side: ShowcaseSideId;
  detail: string;
  where?: 'llm' | 'tool';
  tool?: string;
  status?: number;
  t_ms: number;
}

export type ShowcaseItem = ShowcaseLlmItem | ShowcaseHopItem | ShowcaseToolItem | ShowcaseGovernanceItem;

export interface ShowcaseGovernanceEvent {
  kind: string;
  detail: string;
  where?: 'llm' | 'tool';
  tool?: string;
  status?: number;
  t_ms: number;
}

export interface ShowcaseMetrics {
  e2e_ms: number;
  llm_steps: number;
  tool_calls: number;
  tokens: ShowcaseTokens;
  by_model: Record<string, { prompt: number; output: number; steps: number }>;
  tools_offered: string[];
  tools_offered_count: number;
  tools_called: string[];
  cache_hits: number;
  governance_events: number;
  gateway_cost_usd: number;
}

export interface ShowcaseSideState {
  side: ShowcaseSideId;
  status: 'idle' | 'running' | 'done' | 'error';
  label: string;
  llm: string;
  mcpServers: string[];
  toolsOffered: string[];
  items: ShowcaseItem[];
  governance: ShowcaseGovernanceEvent[];
  answer: string;
  error: string | null;
  metrics: ShowcaseMetrics | null;
  finishedMs: number | null;
}

export interface ShowcaseRunState {
  runId: string | null;
  prompt: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  sides: Record<ShowcaseSideId, ShowcaseSideState>;
}

export interface ShowcaseSummary {
  costUsd: number;
  unpriced: string[];
  e2eMs: number | null;
  promptTokens: number;
  outputTokens: number;
  llmSteps: number;
  toolsOffered: number;
  toolsCalled: string[];
  toolErrors: number;
  models: string[];
  cacheHits: number;
  governance: string[];
}

export interface ShowcaseScoreboardSide {
  runs: number;
  costUsd: number;
  e2eMs: number;
  promptTokens: number;
  outputTokens: number;
  toolCalls: number;
  governance: number;
  cacheHits: number;
}

export interface ShowcaseScoreboard {
  runs: number;
  sides: Record<ShowcaseSideId, ShowcaseScoreboardSide>;
}

type Rates = Record<string, { input?: number; output?: number }> | null | undefined;

export const SHOWCASE_SIDES: ShowcaseSideId[];
export const BASELINE_MODELS: { id: string; label: string }[];
export const DEFAULT_BASELINE_MODEL: string;
export const SHOWCASE_SCENARIOS: ShowcaseScenario[];
export const GOVERNANCE_LABELS: Record<string, string>;

export function parseSseChunk(buffer: string): { events: any[]; rest: string };
export function isRefusedHop(item: ShowcaseItem | null | undefined): boolean;
export function visibleItems(items: ShowcaseItem[], showHops: boolean): ShowcaseItem[];
export function emptySide(side: ShowcaseSideId): ShowcaseSideState;
export function emptyRun(): ShowcaseRunState;
export function reduceShowcaseEvent(run: ShowcaseRunState, event: any): ShowcaseRunState;
export function rateFor(model: string | null | undefined, rates: Rates): { input: number; output: number } | null;
export function priceSteps(items: ShowcaseItem[], rates: Rates): { usd: number; unpriced: string[] };
export function sideSummary(side: ShowcaseSideState, rates: Rates): ShowcaseSummary;
export function emptyScoreboard(): ShowcaseScoreboard;
export function addToScoreboard(board: ShowcaseScoreboard, summaries: Partial<Record<ShowcaseSideId, ShowcaseSummary>>): ShowcaseScoreboard;
export function ratio(baseline: number, governed: number): number | null;
export function formatUsd(usd: number): string;
export function formatMs(ms: number | null | undefined): string;

export interface LedgerModel { calls: number; cached: number; failed: number; input: number; output: number }
export interface LedgerTool { server: string; calls: number; ok: number; blocked: number; error: number }
export interface LedgerSide { runs: number; toolsOffered: number; models: Record<string, LedgerModel>; tools: Record<string, LedgerTool> }
export interface ShowcaseLedger { runs: number; sides: Record<ShowcaseSideId, LedgerSide> }
export interface LedgerModelRow extends LedgerModel { model: string; noModel: boolean; rate: { input: number; output: number } | null; costUsd: number | null }
export interface LedgerToolRow extends LedgerTool { name: string }
export interface LedgerView {
  runs: number;
  toolsOffered: number;
  models: LedgerModelRow[];
  tools: LedgerToolRow[];
  modelsUsed: number;
  unpriced: string[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    llmCalls: number;
    cachedCalls: number;
    toolCalls: number;
    toolsUsed: number;
    toolsBlocked: number;
  };
}

export function emptyLedger(): ShowcaseLedger;
export function toolOutcome(item: ShowcaseToolItem): 'ok' | 'blocked' | 'error';
export const NO_MODEL: string;
export function sideLedgerEntry(side: ShowcaseSideState): { models: Record<string, LedgerModel>; tools: Record<string, LedgerTool>; toolsOffered: number };
export function addToLedger(ledger: ShowcaseLedger, run: ShowcaseRunState): ShowcaseLedger;
export function ledgerView(sideLedger: LedgerSide | undefined, rates: Rates): LedgerView;
export function alignedKeys<T extends Record<string, any>>(aRows: T[], bRows: T[], key: keyof T & string): string[];
export function formatTokens(n: number): string;

export type BurstOutcome = 'queued' | 'running' | 'done' | 'quota' | 'error';
export interface BurstRunSummary {
  outcome: BurstOutcome;
  steps: number;
  tokens: number;
  quotaUsedPct: number | null;
  quotaDetail: string | null;
  models: string[];
  toolCalls: number;
  costUsd: number;
  e2eMs: number | null;
  error: string | null;
}
export function burstRunSummary(run: ShowcaseRunState, rates: Rates): BurstRunSummary;
export function burstTotals(runs: ShowcaseRunState[], rates: Rates): {
  rows: BurstRunSummary[];
  finished: number;
  stopped: number;
  errors: number;
  running: number;
  queued: number;
  tokens: number;
  costUsd: number;
};
