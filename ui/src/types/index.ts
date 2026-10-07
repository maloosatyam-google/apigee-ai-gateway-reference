import type { TokenQuotaSignal } from '../utils/tokenQuota';
import type { AdminRole } from '../utils/adminRoles';
export type { AdminRole } from '../utils/adminRoles';
export type GatewayEnvironment = 'dev' | 'prod' | 'custom';
export type UserPersona = 'admin' | 'sales_agent' | 'loans_agent';
export type KeyTier = 'admin' | 'sales' | 'loans' | 'custom';
// Themes are CSS-only. Each entry here must have a matching
// `html[data-theme="<name>"]` block in src/index.css, and that pairing is the
// whole contract — there is no per-theme TypeScript.
//
// Selected via the `?theme=` query parameter; anything not in this list is
// ignored and falls back to 'light', so a typo during a live demo cannot
// strand the UI on a theme that has no stylesheet.
export const AVAILABLE_THEMES = ['light'] as const;
export type AppTheme = (typeof AVAILABLE_THEMES)[number];

export interface SsoUser {
  name: string;
  email: string;
  organization: string;
  provider: string;
  avatarText: string;
  isAuthenticated: boolean;
  idToken?: string;
}

export interface UserInfo {
  id: UserPersona;
  name: string;
  email: string;
  apiKey: string;
  badge: string;
}

export interface GatewaySettings {
  environment: GatewayEnvironment;
  customBaseUrl: string;
  activeUser: UserPersona;
  /** Admin persona in the Admin Console: which controls may be changed. See utils/adminRoles.js. */
  adminRole?: AdminRole;
  userEmail: string;
  apiKey: string;
  ssoUser?: SsoUser;
  keyTier?: KeyTier;
  idToken?: string;
  projectId: string;
  location: string;
  model: string;
  useCache: boolean;
  omitEmailHeader?: boolean;
}

export interface GatewayTelemetry {
  status: number;
  statusText: string;
  endpointUrl: string;
  // Optional because a semantic-cache hit has no model to attribute. The cache
  // keys on the prompt alone, and the router is skipped on a hit, so the gateway
  // emits no x-gateway-model. The trace viewer renders "Served from cache" when
  // this is absent.
  model?: string;
  requestedModel?: string;
  autoRouted?: boolean;
  environment: GatewayEnvironment;
  user?: string;
  userEmail?: string;
  ssoUser?: SsoUser;
  keyTier?: KeyTier;
  latencyMs: number;
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  cacheStatus: 'HIT' | 'MISS' | 'DISABLED';
  guardrailStatus: 'PASSED' | 'BLOCKED' | 'FLAGGED' | 'NONE';
  guardrailMessage?: string;
  headersSent: Record<string, string>;
  headersReceived: Record<string, string>;
  provider?: string;
  costUsd?: string;
  costTier?: string;
  targetUrl?: string;
  intent?: string;
  // Gateway-reported LLM token-quota consumption (x-gateway-token-quota-*). Absent on
  // cache hits, errors and proxy revisions that predate JS-TokenQuotaThreshold.
  tokenQuota?: TokenQuotaSignal;
  rawRequest: any;
  rawResponse: any;
  // Legacy aliases for backwards compatibility
  'x-gateway-model'?: string;
  'x-gateway-provider'?: string;
  'x-auto-routed'?: string;
  'x-gateway-cost-usd'?: string;
  'x-gateway-cost-tier'?: string;
  'x-prompt-tokens'?: string;
  'x-candidate-tokens'?: string;
  'x-total-tokens'?: string;
  'x-pii-redacted'?: string;
  'x-gateway-cached'?: string;
  'x-gateway-latency-ms'?: string;
  total_e2e_latency_ms?: number;
}

export interface ToolTrace {
  tool: string;
  arguments: Record<string, any>;
  result: Record<string, any>;
  latency_ms: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  model?: string;
  isError?: boolean;
  toolCalls?: ToolTrace[];
  telemetry?: GatewayTelemetry;
  targetUrl?: string;
}

export interface ScenarioPreset {
  id: string;
  title: string;
  category:
    | 'Overview'
    | 'Access Control'
    | 'Security'
    | 'Performance'
    | 'Routing'
    | 'Tokenomics'
    | 'Governance'
    | 'Quota';
  prompt: string;
  description: string;
  badgeText: string;
  badgeColor: string;
  settingsOverride?: Partial<GatewaySettings>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface PolicySettings {
  targetModel: string;
  piiRedactionEnabled: boolean;
  cachingEnabled: boolean;
  rateLimitTier: string;
  simulateSpike: boolean;
}

export type AppTab = 'ai-gateway' | 'mcp-gateway' | 'kvm-pricing' | 'monetization' | 'analytics' | 'rate-cards' | 'agent-showcase';

export interface DeveloperWallet {
  currencyCode: string;
  units: string;
  nanos: number;
  lastCreditTime?: string;
  formattedBalance: string;
}

export interface RatePlanInfo {
  name: string;
  apiproduct: string;
  displayName: string;
  billingPeriod: string;
  currencyCode: string;
  consumptionPricingType: string;
  consumptionPricingRates?: Array<{
    fee: {
      currencyCode: string;
      units?: string;
      nanos?: number;
    };
  }>;
  state: 'PUBLISHED' | 'DRAFT' | string;
  startTime?: string;
  createdAt?: string;
  lastModifiedAt?: string;
}

export interface DeveloperSubscription {
  name: string;
  apiproduct: string;
  startTime?: string;
  createdAt?: string;
  lastModifiedAt?: string;
}

export interface DeveloperMonetizationConfig {
  billingType: 'PREPAID' | 'POSTPAID' | string;
}

export interface PromptTransactionRecord {
  id: string;
  timestamp: string;
  userEmail: string;
  model: string;
  provider: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  cacheStatus: 'HIT' | 'MISS' | 'DISABLED';
  status: number;
  autoRouted?: boolean;
}

export interface UserAnalyticsSummary {
  userEmail: string;
  totalCalls: number;
  totalTokens: number;
  totalSpendUsd: number;
  avgLatencyMs: number;
  lastActive: string;
}

export interface UserConsumptionRecord {
  userEmail: string;
  model: string;
  provider: string;
  tier: string;
  totalTraffic: number;
  /**
   * Failed calls attributed to this caller/model pair, from `sum(is_error)`. Absent on rows
   * recorded before the proxy began emitting `dc_user_email` on the fault path — treat `undefined`
   * as "unknown", not as zero.
   */
  errorCount?: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isUnauthenticated?: boolean;
}

export interface UserMonetizationAttribution {
  userEmail: string;
  name: string;
  tier: string;
  badge: string;
  billingType: 'PREPAID' | 'POSTPAID';
  totalConsumedUsd: number;
  totalCalls: number;
  totalTokens: number;
  currentBalanceUsd: number;
  allocatedBudgetUsd: number;
  lastActive: string;
}

export interface ModelRateItem {
  id: string;
  input: number;
  output: number;
  provider: 'google' | 'anthropic' | string;
  tier: 'low' | 'medium' | 'high' | string;
}

export type RateCardDictionary = Record<string, {
  input: number;
  output: number;
  provider?: string;
  tier?: string;
}>;

export interface McpToolInputProperty {
  type: string;
  description?: string;
  example?: string;
  [key: string]: any;
}

export interface McpToolInputSchema {
  type: string;
  properties: Record<string, McpToolInputProperty>;
  required?: string[];
  [key: string]: any;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}

export interface McpRpcRequest {
  jsonrpc: '2.0';
  method: string;
  id: number | string;
  params?: Record<string, any>;
}

export interface McpRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpTelemetry {
  status: number;
  statusText: string;
  endpointUrl: string;
  method: string;
  latencyMs: number;
  headersSent: Record<string, string>;
  headersReceived: Record<string, string>;
  rawRequest: McpRpcRequest;
  rawResponse: McpRpcResponse | any;
  policyTrace: {
    ppMcp: boolean;
    vaVerifyApiKey: boolean;
    qLimit: boolean;
    mlCloudLogging: boolean;
  };
  userEmail?: string;
  ssoUser?: SsoUser;
  keyTier?: KeyTier;
  activeUser?: UserPersona;
}

export interface McpPresetScenario {
  id: string;
  title: string;
  toolName: string;
  category: string;
  description: string;
  arguments: Record<string, any>;
  badgeText: string;
  badgeColor: string;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface LlmOperation {
  resource: string;
  methods: string[];
  model: string;
}

export interface LlmTokenQuota {
  limit: string;
  interval: string;
  timeUnit: string;
}

export interface OperationConfig {
  apiSource: string;
  llmOperations: LlmOperation[];
  llmTokenQuota?: LlmTokenQuota;
}

export interface ApiProduct {
  name: string;
  displayName: string;
  /** Real Apigee resource name (e.g. "Engineering and IT Dev") when `name` is the logical tier. */
  apigeeName?: string;
  /** Which Admin Console view this came from. */
  env?: 'dev' | 'prod';
  /** Dev view only: the sandbox clone doesn't exist yet; this is a preview copied from prod. */
  missing?: boolean;
  approvalType?: string;
  environments?: string[];
  attributes?: ProductAttribute[];
  llmOperationGroup?: {
    operationConfigs?: OperationConfig[];
  };
  proxies?: string[];
  scopes?: string[];
  quota?: string;
  quotaInterval?: string;
  quotaTimeUnit?: string;
  [key: string]: any;
}
