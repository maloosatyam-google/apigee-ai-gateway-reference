import type { LucideIcon } from 'lucide-react';
import {
  Key,
  ShieldCheck,
  Database,
  Split,
  Gauge,
  Receipt,
  Plug,
  Workflow,
} from 'lucide-react';

export type GuardrailGateway = 'ai' | 'mcp';

export type GuardrailCategory =
  | 'Security'
  | 'Safety'
  | 'Cost Control'
  | 'Traffic Shaping'
  | 'Observability';

export interface GuardrailPolicyRef {
  /** Policy name as it appears in the proxy bundle. */
  name: string;
  /** Apigee policy type. */
  type: string;
  purpose: string;
}

export interface GuardrailControl {
  id: string;
  gateway: GuardrailGateway;
  proxy: string;
  title: string;
  category: GuardrailCategory;
  summary: string;
  /** Where in the proxy the control runs. */
  attachPoint: string;
  /** What the caller sees when the control trips. */
  onViolation: string;
  /** Where the tunable values come from (product attrs, KVM, template...). */
  configSource: string;
  icon: LucideIcon;
  policies: GuardrailPolicyRef[];
}

export const CATEGORY_STYLES: Record<GuardrailCategory, string> = {
  Security: 'bg-blue-50 text-blue-700 border-blue-200',
  Safety: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Cost Control': 'bg-amber-50 text-amber-800 border-amber-200',
  'Traffic Shaping': 'bg-purple-50 text-purple-700 border-purple-200',
  Observability: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const AI_PROXY = 'ai-gateway-v1';
// Deployed bundle name (apigee/dist/mcp.zip declares <APIProxy name="mcp">), served at /mcp.
export const MCP_PROXY = 'mcp';

/**
 * Read-only catalog of the guardrails currently enforced by the two gateway
 * proxies. Policy names/types mirror the deployed proxy bundles so the
 * Architecture blueprint and this console never drift apart.
 */
export const GUARDRAIL_CONTROLS: GuardrailControl[] = [
  {
    id: 'ai-auth',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Identity & Model Entitlement',
    category: 'Security',
    summary:
      'Resolves the calling user, verifies the API key, and rejects any model that is not explicitly named on the caller’s API Product.',
    attachPoint: 'Proxy PreFlow',
    onViolation: 'HTTP 401 / 403 — request never reaches a model',
    configSource: 'API Product model entitlements',
    icon: Key,
    policies: [
      {
        name: 'DJWT-ExtractUserIdentity',
        type: 'DecodeJWT',
        purpose: 'Extracts the end-user identity from the Cloud IAP / Bearer token for per-user attribution.',
      },
      {
        name: 'VA-VerifyAPIKey',
        type: 'VerifyAPIKey',
        purpose: 'Validates the consumer key and loads the persona API Product (Engineering & IT, Analysts, Customer Support & Sales).',
      },
      {
        name: 'OAS-ValidateRequest',
        type: 'OASValidation',
        purpose: 'Validates the OpenAPI 3.0 request structure and enforces named model entitlements (no wildcards).',
      },
    ],
  },
  {
    id: 'ai-armor',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Prompt & Response Safety',
    category: 'Safety',
    summary:
      'Screens every prompt before a token is spent and inspects every completion on the way out, using one enterprise Model Armor template across all providers.',
    attachPoint: 'Request PreFlow + Response Flow',
    onViolation: 'HTTP 400 — blocked at the perimeter with a safety reason',
    configSource: 'Google Cloud Model Armor template',
    icon: ShieldCheck,
    policies: [
      {
        name: 'SUP-UserPrompt',
        type: 'SanitizeUserPrompt',
        purpose: 'Scans the incoming prompt for injection, jailbreak, and PII before any LLM invocation.',
      },
      {
        name: 'SMR-SanitizeModelResponse',
        type: 'SanitizeModelResponse',
        purpose: 'Inspects the model output to redact sensitive PII or unsafe completions.',
      },
    ],
  },
  {
    id: 'ai-cache',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Semantic Cache',
    category: 'Cost Control',
    summary:
      'Matches semantically equivalent prompts against a vector cache and serves them without an upstream call — zero model cost, zero token quota.',
    attachPoint: 'Request PreFlow + Response Flow',
    onViolation: 'No rejection — a hit short-circuits the upstream call',
    configSource: 'Similarity threshold & TTL on the cache policy',
    icon: Database,
    policies: [
      {
        name: 'SCL-Semantic-Cache-Lookup',
        type: 'SemanticCacheLookup',
        purpose: 'Embeds the incoming prompt and queries the vector store for a high-similarity match.',
      },
      {
        name: 'SCP-Semantic-Cache-Populate',
        type: 'SemanticCachePopulate',
        purpose: 'Stores the LLM response on a cache miss so later similar prompts are served locally.',
      },
    ],
  },
  {
    id: 'ai-router',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Smart Routing Model Mapping',
    category: 'Traffic Shaping',
    summary:
      'Classifies each prompt with the TypeSafe AI JEV System One router model and maps the result to a concrete model the caller is entitled to — no model names hardcoded in the proxy.',
    attachPoint: 'AutoRoutingFlow (/auto route, after the semantic cache lookup — cache misses only)',
    onViolation: 'Fails open — falls back to the product default model',
    configSource: 'API Product routing.model.* custom attributes + encrypted ai-gateway-creds KVM (router API key)',
    icon: Split,
    policies: [
      {
        name: 'KVM-GetRouterCredentials',
        type: 'KeyValueMapOperations',
        purpose: 'Reads the router API key from the encrypted ai-gateway-creds KVM into a private.* variable.',
      },
      {
        name: 'AM-PrepRouterRequest',
        type: 'AssignMessage',
        purpose: 'Builds the classifier request natively and constrains the answer to coding | deep_reasoning | simple | general.',
      },
      {
        name: 'SC-ModelRouter',
        type: 'ServiceCallout',
        purpose: 'Calls the JEV System One router with a 2.5s timeout and continue-on-error so a blip degrades rather than fails.',
      },
      {
        name: 'JS-AutoRouting',
        type: 'JavaScript',
        purpose: 'Maps the returned category to a model using the API Product attributes. Holds no model names of its own.',
      },
      {
        name: 'AM-RouteGeminiTarget',
        type: 'AssignMessage',
        purpose: 'Routes the request to the selected Vertex AI Gemini endpoint.',
      },
      {
        name: 'AM-RouteClaudeTarget',
        type: 'AssignMessage',
        purpose: 'Routes coding prompts to Anthropic Claude on Vertex when the persona product maps coding to Claude.',
      },
    ],
  },
  {
    id: 'ai-quota',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Token Quotas & Spend Limits',
    category: 'Cost Control',
    summary:
      'Budgets by tokens and dollars rather than requests, and checks the prepaid wallet plus active rate plan before the call is allowed through.',
    attachPoint: 'PreFlow + LLMTokenLimitFlow & AutoRoutingFlow (enforce) + PostFlow (count)',
    onViolation: 'HTTP 429 token quota or $ budget exceeded / HTTP 403 wallet exhausted',
    configSource: 'API Product token quota + developer.budget.* attributes + wallet balance & rate plan',
    icon: Gauge,
    policies: [
      {
        name: 'LTQ-TokenEnforce',
        type: 'LLMTokenQuota (LLMTokenLimitFlow, AutoRoutingFlow)',
        purpose: 'Checks accumulated token consumption against the limit resolved from the API Product (token-quota demo model route, and /auto before the router runs).',
      },
      {
        name: 'LTQ-TokenCount',
        type: 'LLMTokenQuota (PostFlow)',
        purpose: 'Reads the exact token count from the model response and increments the distributed counter.',
      },
      {
        name: 'QC-EnforceBudgetLimit',
        type: 'Quota (PreFlow, EnforceOnly)',
        purpose: 'Checks the per-developer USD budget counter; RF-BudgetExceeded raises the client-facing 429.',
      },
      {
        name: 'QC-DeductBudget',
        type: 'Quota (PostFlow)',
        purpose: 'Spends the real request cost (micro-dollars) against the budget counter; skipped on cache hits.',
      },
      {
        name: 'MLC-EnforceMonetizationLimits',
        type: 'MonetizationLimitsCheck',
        purpose: 'Verifies the prepaid wallet balance and an active rate plan subscription.',
      },
    ],
  },
  {
    id: 'ai-upstream',
    gateway: 'ai',
    proxy: AI_PROXY,
    title: 'Cost Attribution & Telemetry',
    category: 'Observability',
    summary:
      'Prices every request from the live rate card and emits the analytics dimensions and x-gateway-* trace headers the dashboards run on.',
    attachPoint: 'Target & Response Flow',
    onViolation: 'Non-blocking — records cost and telemetry',
    configSource: 'ai-model-rates KVM',
    icon: Receipt,
    policies: [
      {
        name: 'KVM-GetModelRates',
        type: 'KeyValueMapOperations',
        purpose: 'Reads the live input/output per-1k token rates from the ai-model-rates KVM.',
      },
      {
        name: 'JS-CalculateCost',
        type: 'JavaScript',
        purpose: 'Computes the exact USD cost for the request (zeroed on a cache hit) that QC-DeductBudget then spends.',
      },
      {
        name: 'DC-ModelAnalytics',
        type: 'DataCapture',
        purpose: 'Streams model, token counts, latency, and cost into custom analytics dimensions.',
      },
      {
        name: 'AM-SetResponseHeaders',
        type: 'AssignMessage',
        purpose: 'Injects the x-gateway-* trace headers used by the trace viewer.',
      },
    ],
  },
  {
    id: 'mcp-auth',
    gateway: 'mcp',
    proxy: MCP_PROXY,
    title: 'Agent API Key Check',
    category: 'Security',
    summary:
      'Parses the JSON-RPC 2.0 envelope, rejects non-MCP methods, and verifies the agent’s API key on tools/list and tools/call before anything else runs.',
    attachPoint: 'Proxy PreFlow',
    onViolation: 'HTTP 401 unauthorized (bad key) / HTTP 400 (method not allowed)',
    configSource: 'Developer App credentials',
    icon: Key,
    policies: [
      {
        name: 'CORS-Allow',
        type: 'CORS',
        purpose: 'Enables cross-origin browser and web-agent inspection.',
      },
      {
        name: 'PP-MCP',
        type: 'MCP Protocol Policy',
        purpose: 'Parses the incoming JSON-RPC 2.0 envelope (jsonrpc, id, method, params).',
      },
      {
        name: 'RF-MethodNotAllowed',
        type: 'RaiseFault',
        purpose: 'Rejects JSON-RPC methods outside the MCP allowlist with HTTP 400 / -32601.',
      },
      {
        name: 'VA-VerifyAPIKey',
        type: 'VerifyAPIKey',
        purpose: 'Verifies the agent consumer key on tools/list and tools/call.',
      },
    ],
  },
  {
    id: 'mcp-tools',
    gateway: 'mcp',
    proxy: MCP_PROXY,
    title: 'Persona Tools Filter',
    category: 'Security',
    summary:
      'Only tools listed as tools/call/<tool> operations on the persona’s API product are returned by tools/list or callable, so a Support agent never discovers — let alone calls — a confidential insights tool.',
    attachPoint: 'Proxy PreFlow (VerifyAPIKey operation match)',
    onViolation: 'HTTP 401 InvalidApiKeyForGivenResource — tool hidden from tools/list, tools/call rejected',
    configSource: 'API Product MCP operations (tools/call/<tool>)',
    icon: ShieldCheck,
    policies: [
      {
        name: 'VA-VerifyAPIKey',
        type: 'VerifyAPIKey',
        purpose: 'Matches the MCP operation against the key’s API product; tools not on the product are filtered or rejected.',
      },
    ],
  },
  {
    id: 'mcp-rate',
    gateway: 'mcp',
    proxy: MCP_PROXY,
    title: 'Tool Call Rate Limits',
    category: 'Traffic Shaping',
    summary:
      'Caps tool-call rates per app and per tool, from the quota on the API product, so a runaway agent loop cannot overwhelm core customer or order systems.',
    attachPoint: 'Proxy PreFlow',
    onViolation: 'HTTP 429 rate limited',
    configSource: 'API Product quota (per tool operation)',
    icon: Gauge,
    policies: [
      {
        name: 'Q-Limit',
        type: 'Quota',
        purpose: 'Enforces the product quota (per app and per tool) protecting downstream systems of record.',
      },
    ],
  },
  {
    id: 'mcp-call',
    gateway: 'mcp',
    proxy: MCP_PROXY,
    title: 'MCP Server Call & Audit Log',
    category: 'Observability',
    summary:
      'Strips client credentials, forwards the call to the MCP server (Apigee-hosted Customer Service, Business Insights and industry packs, Google’s BigQuery, or third-party such as ServiceNow), and streams an audit record of every tool invocation to Cloud Logging.',
    attachPoint: 'Proxy PreFlow → Target → PostClientFlow',
    onViolation: 'Non-blocking — always logs',
    configSource: 'Target endpoint + Cloud Logging sink',
    icon: Plug,
    policies: [
      {
        name: 'AM-RemoveAuthorization',
        type: 'AssignMessage',
        purpose: 'Strips client auth headers before forwarding to the MCP server.',
      },
      {
        name: 'ML-CloudLogging',
        type: 'MessageLogging',
        purpose: 'Streams structured MCP tool execution audit logs to Google Cloud Logging.',
      },
    ],
  },
  {
    id: 'mcp-bridge',
    gateway: 'mcp',
    proxy: MCP_PROXY,
    title: 'JSON-RPC → REST Bridge (Optional)',
    category: 'Traffic Shaping',
    summary:
      'Only for REST APIs converted to MCP and hosted by Apigee: maps the tool call to the REST endpoint and validates arguments against the tool schema. Third-party MCP servers skip it.',
    attachPoint: 'Apigee-hosted MCP server',
    onViolation: 'JSON-RPC -32602 invalid tool arguments',
    configSource: 'Tool-to-endpoint mapping (OpenAPI spec)',
    icon: Workflow,
    policies: [
      {
        name: 'PP-MCP',
        type: 'Protocol Bridge',
        purpose: 'Maps the MCP tool name and JSON arguments to the target URL, HTTP verb, and parameters.',
      },
      {
        name: 'RF-RefundLimit',
        type: 'RaiseFault',
        purpose: 'Business rule on the REST proxy: issueRefund over $50 returns HTTP 403 REFUND_LIMIT for every persona.',
      },
    ],
  },
];

/**
 * Business-voice wording for each control (Finance, AI CoE and the business
 * consumer personas). Kept outside GUARDRAIL_CONTROLS on purpose: the server
 * mirror (server/guardrailCatalog.json) is generated from that array, and the
 * technical fields above are what Ask Apigee and the tests rely on.
 */
export interface GuardrailBusinessCopy {
  title: string;
  summary: string;
  /** What the user experiences when the control steps in. */
  outcome: string;
}

export const GUARDRAIL_BUSINESS_COPY: Record<string, GuardrailBusinessCopy> = {
  'ai-auth': {
    title: 'Who can use which AI models',
    summary:
      'Checks who is asking and only lets each persona use the AI models it has been given. Anything else is turned away before it costs money.',
    outcome: 'Request refused, nothing is charged',
  },
  'ai-armor': {
    title: 'Safe prompts and answers',
    summary:
      'Screens every question for attacks and personal data before it reaches a model, and checks every answer on the way back. Same rules for every AI provider.',
    outcome: 'Blocked with a clear safety reason',
  },
  'ai-cache': {
    title: 'Answer reuse',
    summary:
      'When someone asks a question that has already been answered, the saved answer comes back instantly. No model cost and no usage limit used.',
    outcome: 'Never blocks, repeat questions are free',
  },
  'ai-router': {
    title: 'Automatic model choice',
    summary:
      'Reads each question and sends it to the most suitable model the persona is allowed to use, so simple questions go to cheaper models.',
    outcome: 'If unsure, uses the persona’s default model',
  },
  'ai-quota': {
    title: 'Usage limits and budgets',
    summary:
      'Caps how much each persona can use, in tokens and in dollars, and checks prepaid credit and the billing plan before any AI call runs.',
    outcome: 'Paused when a limit, budget or credit runs out',
  },
  'ai-upstream': {
    title: 'Cost tracking',
    summary:
      'Prices every request from the current model price list and records who used what, so spend can be reported by team and model.',
    outcome: 'Never blocks, always records cost',
  },
  'mcp-auth': {
    title: 'Assistant access keys',
    summary:
      'Checks each AI assistant’s access key before it can list or use any business tool, and turns away requests that are not standard tool requests.',
    outcome: 'Request refused, no tool is called',
  },
  'mcp-tools': {
    title: 'Tools each persona can see',
    summary:
      'Each persona only sees and uses the business tools meant for it. A support assistant never even discovers a confidential insights tool.',
    outcome: 'Tool hidden and the call refused',
  },
  'mcp-rate': {
    title: 'Tool usage pace limits',
    summary:
      'Limits how fast each assistant can call each tool, so a runaway assistant cannot overload customer or order systems.',
    outcome: 'Slowed down until the limit resets',
  },
  'mcp-call': {
    title: 'Tool calls and audit trail',
    summary:
      'Passes approved requests to the tool, in-house, BigQuery or partner (such as ServiceNow), and records every use: which persona, which tool, how long it took and whether it worked.',
    outcome: 'Never blocks, always recorded',
  },
  'mcp-bridge': {
    title: 'Existing systems as AI tools (optional)',
    summary:
      'Makes in-house business systems available to AI assistants as tools, and checks the inputs first. Partner tools that already speak MCP skip this.',
    outcome: 'Invalid input returned to the assistant',
  },
};

/** Business-voice names for the control categories. */
export const CATEGORY_BUSINESS_LABEL: Record<GuardrailCategory, string> = {
  Security: 'Access',
  Safety: 'Safety',
  'Cost Control': 'Cost',
  'Traffic Shaping': 'Routing & limits',
  Observability: 'Reporting',
};

/**
 * Per-speaker notes shown under each control, on top of the technical fields
 * (Platform Admin) or GUARDRAIL_BUSINESS_COPY (AI CoE). Finance uses the
 * business copy as-is. Like the business copy this sits outside
 * GUARDRAIL_CONTROLS, so the server mirror and the tests are unaffected.
 * Keep these keyed records free of 4-space `id: '…',` lines and bare `  {`
 * lines: the catalog tests scan everything after GUARDRAIL_CONTROLS for both.
 */
export interface GuardrailSpeakerNotes {
  /** Platform Admin: how it is enforced in practice, blast radius, where to tune or debug it. */
  platform: string;
  /** AI CoE: why the control matters for responsible, wide adoption. */
  ai_coe: string;
}

export const GUARDRAIL_SPEAKER_NOTES: Record<string, GuardrailSpeakerNotes> = {
  'ai-auth': {
    platform:
      'Runs first, so a bad key or an unlisted model fails fast with no upstream cost. Grant a model by adding it to the product entitlements; no proxy redeploy.',
    ai_coe:
      'This is how your model decisions take effect: a team can only call the models you approved for it, so experiments stay inside the agreed list.',
  },
  'ai-armor': {
    platform:
      'One Model Armor template covers every provider, so there is no per-model safety config to drift. Tune filters in the template, not the proxy.',
    ai_coe:
      'Every team gets the same screening on questions and answers whichever model they use, so a new model can be approved without a fresh safety setup.',
  },
  'ai-cache': {
    platform:
      'A hit skips the target call, the token counter and the budget deduction, and sets x-gateway-cached. Adjust threshold and TTL if hits look stale or rare.',
    ai_coe:
      'Common questions get the same vetted answer instantly, which keeps answers consistent within a team and leaves usage limits for new work.',
  },
  'ai-router': {
    platform:
      'Fails open to the product default on router timeout (2.5s) or error, so a router issue affects cost, not availability. Mappings live in routing.model.* attributes.',
    ai_coe:
      'Your routing policy in action: simple questions go to lighter models and hard ones to stronger models, always within the models each team is approved for.',
  },
  'ai-quota': {
    platform:
      'Checked before the call and counted after it from real token usage, so limits are exact. Callers get a 429 for quota or budget and a 403 when the wallet is empty.',
    ai_coe:
      'Fair-use limits stop one team or a runaway agent from using up shared capacity, so every team can rely on predictable access.',
  },
  'ai-upstream': {
    platform:
      'Non-blocking. Feeds the Analytics dimensions and the x-gateway-* trace headers; if a cost looks wrong, check the ai-model-rates KVM first.',
    ai_coe:
      'Shows which teams use which models and how often, so you can track adoption, spot unused approvals and back model decisions with data.',
  },
  'mcp-auth': {
    platform:
      'Runs first: non-MCP methods get 400, a missing or bad key gets 401, and nothing downstream runs. The MCP handshake (initialize, ping) stays keyless.',
    ai_coe:
      'Every assistant is identified before it touches business tools, a baseline to have in place before agents work with real data.',
  },
  'mcp-tools': {
    platform:
      'Same VerifyAPIKey, matched against the product’s tools/call/<tool> operations: tools/list is filtered and a hard-coded tool name still gets 401. No proxy change to grant a tool.',
    ai_coe:
      'Each team’s assistants only see the tools that fit their job, which keeps agent use within policy by design rather than by training.',
  },
  'mcp-rate': {
    platform:
      'Q-Limit reads the per-tool quota from the product VerifyAPIKey matched, so each persona and tool can have its own rate. Over the limit: 429.',
    ai_coe:
      'Each assistant is paced, so a misbehaving agent is contained without slowing other teams down.',
  },
  'mcp-call': {
    platform:
      'Client auth headers are stripped before the MCP server call. Non-blocking MessageLogging records persona, tool, latency and status, the first place to look when debugging.',
    ai_coe:
      'In-house and partner tools are governed the same way, with a complete record of what each assistant did, the evidence a responsible AI review asks for.',
  },
  'mcp-bridge': {
    platform:
      'Only for APIs Apigee hosts as MCP (Customer Service, Business Insights, industry packs). Arguments are schema-checked before the REST call; BigQuery, ServiceNow and other native MCP servers skip it.',
    ai_coe:
      'Existing systems can sit behind assistants quickly, with input checks built in, so new agent use cases do not wait on backend projects.',
  },
};
