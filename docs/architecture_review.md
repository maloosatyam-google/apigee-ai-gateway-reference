# Architecture review: AI Gateway and MCP Gateway

Generated from `ui/src/components/ArchitectureBlueprintModal.tsx` (the **Architecture** button).
Edit anything in place, or write under **Feedback**. Ideas for new steps or policies go in
the "Add / remove" line of each gateway. I will apply the changes back to the view.

---

## AI Gateway (`ai-gateway-v1`)

| Step | Stage | Badge | Policies |
|---|---|---|---|
| 01 | Access Control | Security & RBAC | `DJWT-ExtractUserIdentity`, `VA-VerifyAPIKey`, `OAS-ValidateRequest` |
| 02 | Prompt Sanitization | Safety Perimeter | `SUP-UserPrompt`, `SMR-SanitizeModelResponse` |
| 03 | Semantic Cache | Latency & Cost Saver | `SCL-Semantic-Cache-Lookup`, `SCP-Semantic-Cache-Populate` |
| 04 | Smart Routing | Intelligent Routing | `KVM-GetRouterCredentials`, `AM-PrepRouterRequest`, `SC-ModelRouter`, `JS-AutoRouting`, `AM-RouteGeminiTarget`, `AM-RouteClaudeTarget` |
| 05 | Tokenomics | FinOps Governance | `LTQ-TokenEnforce`, `LTQ-TokenCount`, `QC-EnforceBudgetLimit`, `QC-DeductBudget`, `MLC-EnforceMonetizationLimits` |
| 06 | Multi-Model Upstream & Cost Attribution | Multi-Cloud AI | `KVM-GetModelRates`, `JS-CalculateCost`, `DC-ModelAnalytics`, `AM-SetResponseHeaders` |

**Add / remove steps for this gateway:** 

### 01 · Access Control

- **Subtitle:** Model & Tool Access by User / Agent Permission
- **Badge:** Security & RBAC

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `DJWT-ExtractUserIdentity` | DecodeJWT | Extracts user email identity from Cloud IAP / Bearer token for per-user attribution. |  |
| 2 | `VA-VerifyAPIKey` | VerifyAPIKey | Validates consumer key & loads the persona API Product (Engineering & IT, Analysts, Customer Support & Sales). |  |
| 3 | `OAS-ValidateRequest` | OASValidation | Validates incoming OpenAPI 3.0 request structure and enforces named model entitlements. |  |

**Talking points shown:**

- Every request resolves user identity first from the JWT, failing closed with HTTP 401 if missing.
- Model entitlements are strictly named in the API Product (no wildcard *), preventing unauthorized use of costly models.
- Extracts developer & user email identity for downstream cost attribution and prepaid wallet debiting.

**Feedback:** 

### 02 · Prompt Sanitization

- **Subtitle:** Prompt Injection, Jailbreak & PII Defense
- **Badge:** Safety Perimeter

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `SUP-UserPrompt` | SanitizeUserPrompt | Scans incoming prompt against Google Cloud Model Armor template before any LLM invocation. |  |
| 2 | `SMR-SanitizeModelResponse` | SanitizeModelResponse | Inspects LLM output in the response flow to redact sensitive PII or unsafe completions. |  |

**Talking points shown:**

- Inspects prompts at the API edge before spending a single LLM token.
- Detects prompt injection, jailbreak attempts, and sensitive PII leakage uniformly across Gemini & Claude.
- Eliminates model-specific safety gaps by enforcing a single enterprise Model Armor template.

**Feedback:** 

### 03 · Semantic Cache

- **Subtitle:** Semantic Vector Similarity Matching (<100ms)
- **Badge:** Latency & Cost Saver

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `SCL-Semantic-Cache-Lookup` | SemanticCacheLookup | Computes embeddings for incoming prompt and queries vector cache store for high-similarity matches. |  |
| 2 | `SCP-Semantic-Cache-Populate` | SemanticCachePopulate | Stores downstream LLM responses in cache on cache miss for subsequent similar queries. |  |

**Talking points shown:**

- Unlike exact-match HTTP caching, Semantic Caching matches intent using vector similarity.
- On a Cache HIT, the gateway returns the response in ~60-90ms with $0.00 upstream model cost and 0 token quota consumption.
- Ideal for repetitive FAQ, customer support, and agentic reasoning loops.

**Feedback:** 

### 04 · Smart Routing

- **Subtitle:** Dynamic Routing Across Providers & Private Models (/auto)
- **Badge:** Intelligent Routing

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `KVM-GetRouterCredentials` | KeyValueMapOperations | Reads the router API key from the encrypted ai-gateway-creds KVM into a private.* variable, so the secret never appears in the bundle, trace, or logs. |  |
| 2 | `AM-PrepRouterRequest` | AssignMessage | Builds the classifier request natively (no JavaScript): the user prompt plus a choice question constraining the answer to coding \| deep_reasoning \| simple \| general. |  |
| 3 | `SC-ModelRouter` | ServiceCallout | Calls the TypeSafe AI JEV System One router model to classify the prompt. Runs only on a cache miss (AutoRoutingFlow, after the semantic cache lookup); 2.5s timeout and continue-on-error, so a router blip degrades to the product default instead of failing the request. |  |
| 4 | `JS-AutoRouting` | JavaScript | Maps the returned category to a concrete model using the API Product’s routing.model.* custom attributes. Holds no model names of its own. |  |
| 5 | `AM-RouteGeminiTarget` | AssignMessage | Routes request to Vertex AI Gemini endpoint. |  |
| 6 | `AM-RouteClaudeTarget` | AssignMessage | Routes coding prompts to Anthropic Claude on Vertex when the persona product maps coding to Claude. |  |

**Talking points shown:**

- Developers call a single logical endpoint (/ai/v1/auto) without hardcoding model versions.
- Persona-aware routing: each persona product maps the router category to its own model, e.g. coding goes to Claude Opus (Engineering & IT), Gemini Pro (Analysts) or Claude Haiku (Customer Support & Sales).
- The TypeSafe AI JEV System One router classifies each prompt on intent (only on a cache miss), so coding work lands on Claude Opus 5.5 and trivial lookups on low-cost Flash-Lite.
- The category-to-model map lives on the API Product, so entitlements and model choices change without redeploying the proxy.

**Feedback:** 

### 05 · Tokenomics

- **Subtitle:** Product-Driven Token Limits & Per-Minute Budgets
- **Badge:** FinOps Governance

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `LTQ-TokenEnforce` | LLMTokenQuota (LLMTokenLimitFlow, AutoRoutingFlow) | Checks accumulated token consumption against verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit. |  |
| 2 | `LTQ-TokenCount` | LLMTokenQuota (PostFlow) | Extracts exact totalTokenCount from LLM response and increments the distributed token counter. |  |
| 3 | `QC-EnforceBudgetLimit` | Quota (PreFlow, EnforceOnly) | Checks the per-developer USD budget counter (developer.budget.* product attributes); RF-BudgetExceeded raises the 429. |  |
| 4 | `QC-DeductBudget` | Quota (PostFlow) | Spends the real request cost in micro-dollars against the budget counter; skipped on semantic-cache hits. |  |
| 5 | `MLC-EnforceMonetizationLimits` | MonetizationLimitsCheck | Verifies prepaid wallet balance and active rate plan subscription. |  |

**Talking points shown:**

- Traditional API gateways rate-limit by HTTP requests/min, which fails when 1 prompt can consume 50 tokens or 50,000 tokens.
- Token limits are read dynamically from the API Product configuration — never hardcoded in policy XML.
- When a persona exceeds its token budget, the gateway returns HTTP 429 with exact reset telemetry.

**Feedback:** 

### 06 · Multi-Model Upstream & Cost Attribution

- **Subtitle:** Vertex AI Gemini & Anthropic Claude + KVM Rate Card
- **Badge:** Multi-Cloud AI

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `KVM-GetModelRates` | KeyValueMapOperations | Reads live input/output per-1k token rates from the ai-model-rates KVM. |  |
| 2 | `JS-CalculateCost` | JavaScript | Computes exact USD cost for the request (zeroed on a cache hit); QC-DeductBudget then spends it against the developer budget. |  |
| 3 | `DC-ModelAnalytics` | DataCapture | Streams model name, token counts, latency, and cost into custom Analytics dimensions. |  |
| 4 | `AM-SetResponseHeaders` | AssignMessage | Injects x-gateway-* trace headers (model, provider, cost-usd, total-tokens, cached) for UI inspection. |  |

**Talking points shown:**

- Abstracts credential management: the gateway authenticates to Vertex AI / Model Garden via Google Cloud Workload Identity.
- Calculates real-time per-request USD cost using live KVM rate cards and injects x-gateway-* telemetry headers.
- Feeds the Analytics & Cost dashboard with custom analytics dimensions (dc_model_name, dc_user_email, dc_total_tokens) to track consumption across tools and models.

**Feedback:** 

---

## MCP Gateway (MCP proxies)

| Step | Stage | Badge | Policies |
|---|---|---|---|
| 01 | API Key Check | Missing / Bad Key: 401 | `VA-VerifyAPIKey` |
| 02 | Tools Filter | Not on Product: 401 | `PP-MCP` |
| 03 | Rate Limit | Over Limit: 429 | `Q-Limit` |
| 04 | MCP Call | MCP Server |  |
| 05 | JSON-RPC → REST (Optional) | Optional | `RF-RefundLimit` |

**Add / remove steps for this gateway:** 

### 01 · API Key Check

- **Subtitle:** Agent Key Verification (x-api-key)
- **Badge:** Missing / Bad Key: 401

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `VA-VerifyAPIKey` | VerifyAPIKey | Verifies the agent consumer key (x-api-key) on tools/list and tools/call. Missing, invalid or revoked key: HTTP 401. |  |

**Talking points shown:**

- Agents send standard MCP JSON-RPC 2.0 messages over HTTP POST to one path, /mcp.
- The MCP handshake (initialize, ping) stays keyless; tools/list and tools/call need a valid key, or HTTP 401 and nothing else runs.
- The same API key used on the AI Gateway identifies the agent and its persona through its Developer App.

**Feedback:** 

### 02 · Tools Filter

- **Subtitle:** Per-Tool Entitlements from the API Product (tools/call/<tool>)
- **Badge:** Not on Product: 401

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `PP-MCP` | MCP Protocol Policy | Parses the JSON-RPC 2.0 envelope and exposes the MCP method and tool name, which are matched against the tools/call/<tool> operations on the key’s API product. tools/list is filtered to entitled tools; a tools/call for any other tool gets HTTP 401 InvalidApiKeyForGivenResource. |  |

**Talking points shown:**

- Entitlement is per tool, not per API: each persona product lists the exact tools/call/<tool> operations it may use.
- Customer Support & Sales: Customer Service Tools MCP (7 tools, e.g. getCustomer, getOrderStatus, issueRefund). Analysts & Knowledge Workers: Business Insights Tools MCP (5 tools, e.g. getRevenueTrends, runForecast). Engineering & IT: every tool.
- A tool that is not on the product is hidden from tools/list and a direct tools/call returns HTTP 401 (e.g. an Analyst key calling getCustomer). The MCP server is never called.

**Feedback:** 

### 03 · Rate Limit

- **Subtitle:** Per-App & Per-Tool Quota from the API Product
- **Badge:** Over Limit: 429

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `Q-Limit` | Quota | Enforces the quota configured on the API product (per app, and per tool via the tools/call/<tool> operation config) to protect downstream systems of record. |  |

**Talking points shown:**

- Prevents runaway agent loops from overwhelming enterprise systems of record.
- Limits are set on the API product, per tool (e.g. runForecast 2/min, issueRefund 5/min), so each persona can get a different pace without a proxy change.

**Feedback:** 

### 04 · MCP Call

- **Subtitle:** Forward to MCP Server: Apigee-Hosted, BigQuery or ServiceNow
- **Badge:** MCP Server

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|

**Talking points shown:**

- The gateway forwards the governed JSON-RPC call to the MCP server: Customer Service, Business Insights and the industry packs (hosted by Apigee), Google’s managed BigQuery MCP server, or a third-party server such as ServiceNow.
- The same controls apply to every MCP server, whoever runs it.
- Every tool invocation is logged centrally with persona, tool, latency and status.

**Feedback:** 

### 05 · JSON-RPC → REST (Optional)

- **Subtitle:** Only for APIs Converted to MCP and Hosted by Apigee
- **Badge:** Optional

| # | Policy | Type | What it does (as shown) | Feedback |
|---|---|---|---|---|
| 1 | `RF-RefundLimit` | RaiseFault | Business rule on the REST proxy, before the backend: an issueRefund over $50 returns HTTP 403 REFUND_LIMIT for every persona. Industry packs raise their own limit the same way (e.g. FOLIO_CREDIT_LIMIT). |  |

**Talking points shown:**

- Optional: only for REST APIs converted to MCP tools and hosted by Apigee (Customer Service, Business Insights, industry packs). Native MCP servers such as BigQuery and ServiceNow are called as-is at step 04.
- Existing REST services become MCP tools without rewriting backend code; arguments (order and customer IDs) are checked against the tool schema.
- Business rules run at the REST proxy before the backend: refunds over $50 get 403 REFUND_LIMIT for every persona.

**Feedback:** 

