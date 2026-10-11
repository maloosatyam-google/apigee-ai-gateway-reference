# Apigee AI & Tools Gateway with Google ADK

[![Apigee X](https://img.shields.io/badge/Apigee-X-blue.svg)](https://cloud.google.com/apigee)
[![Google ADK](https://img.shields.io/badge/Google-ADK-4285F4.svg)](https://google.github.io/adk/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org/)
[![Node 20](https://img.shields.io/badge/Node-20-339933.svg)](https://nodejs.org/)
[![Cloud Run](https://img.shields.io/badge/Google_Cloud-Cloud_Run-4285F4.svg)](https://cloud.google.com/run)

An enterprise-grade demonstration and development platform showcasing **Apigee API Management**,
the **Apigee AI Gateway**, the **Apigee MCP Tools Gateway**, and **Google ADK (Agent Development Kit)**
microservices — with live policy trace telemetry, identity-driven entitlement governance,
product-driven LLM token quotas, and Apigee native monetization.

---

## 🚀 Live Demo Studio

| Surface | URL | Source of truth |
| :--- | :--- | :--- |
| Interactive UI Playground | `https://ai-ui.alexdemo.demo.example.com/` | IAP-fronted Cloud Run service |
| AI Gateway | `https://api.example.com/ai/v1` | `<BasePath>/ai/v1</BasePath>` in [default.xml](apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L184) |
| MCP Tools Gateway | `https://api.example.com/mcp` | UI-managed `mcp` proxy — defined in the Apigee UI, intentionally not in this repo (see section 7) |
| MCP OAuth Protected Resource Metadata | `https://api.example.com/.well-known/oauth-protected-resource/mcp` | UI-managed `mcp` proxy (Apigee UI) |

---

## ✨ Core Features & Architectural Capabilities

### 1. 🧠 Model Routing (`/ai/v1/auto`)

Routing is a **two-stage decision**: the TypeSafe AI JEV System One router classifies the
prompt, and the caller's API product decides which model that classification is allowed to reach.

**Stage 1 — classify.** `KVM-GetRouterCredentials` reads the router key from the **encrypted**
`ai-gateway-creds` KVM (no secret in the bundle), the native `AM-PrepRouterRequest` AssignMessage
builds the request (no JavaScript), and `SC-ModelRouter` calls **TypeSafe AI JEV System One**
(`jev-latest`) with a `choice` question pinning the answer to one of four categories — `coding`,
`deep_reasoning`, `simple`, `general`. The chain runs in `AutoRoutingFlow`, after the semantic-cache
lookup, so cache hits never call the router.

**Stage 2 — entitle.** [AutoRouting.js](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/AutoRouting.js)
reads the category and resolves the model from a **custom attribute on the caller's API product**:

```
verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.<category>
```

The policy contains **no model names and no prompt heuristics**. The model map lives entirely on
the product, so the same classification yields a different model per persona product:

| Router category | Engineering & IT | Analysts & Knowledge Workers | Customer Support & Sales |
| :--- | :--- | :--- | :--- |
| `coding` | `claude-opus-5-5` *(anthropic)* | `gemini-3.1-pro-preview` | `claude-haiku-5-5` *(anthropic)* |
| `deep_reasoning` | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` |
| `simple` | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` |
| `general` | `gemini-3.6-flash` | `gemini-3.6-flash` | `gemini-3.6-flash` |

Only **Engineering & IT** can reach `claude-opus-5-5`. **Analysts & Knowledge Workers**
tops out at `gemini-3.1-pro-preview`. **Customer Support & Sales** calls only
`gemini-3.5-flash-lite` / `gemini-3.6-flash` / `claude-haiku-5-5` directly, and on
`/auto` uses `gemini-3.1-pro-preview` only for questions the router classifies `deep_reasoning`
(Agent Showcase scenario 8). The key check on `/auto` runs against the `/auto` operation, so this
needs no direct Pro operation on the product; it can never reach `claude-opus-5-5`. Changing the routing map is a **product edit, not a code change**; re-run
`apigee/scripts/provision_unified_credentials.py` and the new mapping takes effect in ~10s with no
proxy redeploy.

**Degradation is explicit.** `SC-ModelRouter` is `continueOnError="true"` with a 2.5s timeout, and
an empty prompt skips the callout entirely. If the classifier times out, errors, or returns
something unparseable, the category stays unresolved and the request falls back to the product's
`routing.model.general`. There is no hidden second classifier: a product that declares no routing
attributes resolves **no model at all** rather than quietly serving one it may not entitle.

`flow.target_provider` is derived from the resolved model name (`claude…` → `anthropic`) and is what
selects the Claude Vertex target at route time. The policy writes `flow.target_model`, `flow.model`,
`flow.target_provider`, `flow.autoRouted`, `flow.routerCategory` and `flow.routingTier`; the chosen
category is echoed to the caller as `x-gateway-category`. `flow.routingTier` is **tracing only** —
it no longer selects a model.

**Routing selects a model; it does not do costing.** `flow.costTier` is set in exactly one place,
[CalculateCost.js](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/CalculateCost.js),
which derives it from the rate resolved out of the `ai-model-rates` KVM — on cache hits too. The
router used to carry a hardcoded `costTier` literal beside each decision that beat the KVM on the
`/auto` path; that, and the hardcoded zero cost in `AM-SetCacheHitExpected`, have been removed.

### 2. 🛡️ Access Control & Model Armor

- **Prompt sanitization** — [SUP-UserPrompt.xml](apigee/proxies/ai-gateway-v1/apiproxy/policies/SUP-UserPrompt.xml)
  is a `SanitizeUserPrompt` policy bound to Model Armor template
  `projects/your-gcp-project/locations/asia-southeast1/templates/apigee-sanitize-user-prompt`.
- **Response sanitization** — `SMR-SanitizeModelResponse` runs on successful non-passthrough responses.
- **Identity first** — the request PreFlow resolves identity from a Bearer JWT
  (`DJWT-ExtractUserIdentity` → `AM-SetUserIdentity`) and raises `RF-MissingUserEmail` →
  **HTTP 401** if no `email` claim resolves. The JWT is the **only** accepted source: there is no
  `X-User-Email` header fallback, and a request bearing only that header is rejected.
- **API key verification** — `VA-VerifyAPIKey` runs *after* identity resolution and *before* Model Armor.
- **Blocked calls stay attributable** — the proxy's `DefaultFaultRule` runs `DC-FaultAnalytics`,
  re-emitting `dc_user_email` and `dc_model_name` on the fault path. Without it, faults skip the
  response flow and a blocked request would be counted fleet-wide but belong to no caller.

Anything calling the AI Gateway must send **both** an `x-apikey` *and* an identity JWT. The key
authorises (product, models, quota); the JWT identifies (`email` claim). The
[`agents/`](agents/) ADK service forwards the end
user's own token from the inbound `/chat` request so ledger, wallet and token-quota spend are
attributed to the real person, and falls back to `APIGEE_IDENTITY_TOKEN` for headless runs.

> [!IMPORTANT]
> API key verification executes **before** Model Armor in the PreFlow. A request that fails key
> validation — including one naming a model its API Product does not entitle — is rejected with
> **HTTP 401** before any prompt is sent for safety evaluation, so an unauthenticated caller
> cannot drive a billable Model Armor call.

### 3. 🎟️ Tokenomics — Product-Driven LLM Token Quotas

Token limits are **not hardcoded in the proxy**. Both
[LTQ-TokenEnforce.xml](apigee/proxies/ai-gateway-v1/apiproxy/policies/LTQ-TokenEnforce.xml)
and `LTQ-TokenCount.xml` are `LLMTokenQuota` policies that read `limit` / `interval` / `timeUnit`
dynamically from the API Product attached to the verified key:

```xml
<LLMTokenQuota continueOnError="false" enabled="true" name="LTQ-TokenEnforce" type="rollingwindow">
  <Allow count="1000" countRef="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit"/>
  <Interval ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.interval">1</Interval>
  <TimeUnit ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.timeunit">minute</TimeUnit>
  <Distributed>true</Distributed>
  <Synchronous>true</Synchronous>
  <Identifier ref="flow.emailId"/>
  <LLMModelSource>{flow.model}</LLMModelSource>
  <EnforceOnly>true</EnforceOnly>
  <SharedName>common-counter</SharedName>
</LLMTokenQuota>
```

The inline `count="1000"` / `1` / `minute` values are fallback defaults only — the `*Ref` attributes win.
`LTQ-TokenEnforce` enforces, `LTQ-TokenCount` counts, and both share the `common-counter` shared name.

> [!NOTE]
> **Token-quota demo model: `claude-haiku-5-5`, 300 tokens/min on every persona product that grants it** (Engineering & IT and Customer Support & Sales;
> Analysts & Knowledge Workers has no Haiku)
> (raised from 50 so the demo can show a pass, two threshold alerts and then a 429).
> It moved off `gemini-2.5-flash` ahead of that model's 2026-10-20 retirement. Claude hosts the
> demo correctly because `JS-FormatClaudeResponse` synthesises `usageMetadata.totalTokenCount`
> in the *target* response flow, before `LTQ-TokenCount` reads it in PostFlow — so the demo now
> also proves token governance works across providers, not just on Google's response shape.
>
> `gemini-2.5-flash` has since been **retired outright**: its `operationConfig` was removed from
> the (now-legacy) AI tiers and is absent from every persona product, so it is entitled by no
> product and now returns **401** at `VA-VerifyAPIKey`.
> Its rate-card entry, `CalculateCost.js` prefix entry and
> analytics colour are deliberately kept, because `server.js` re-costs historical analytics from
> the rate card and deleting them would silently re-price past traffic at the `default` rate.
>
> **2026-10 model refresh:** retired `gemini-3.7-flash` and `gemini-3.5-flash` (deprecated 2026-10-08),
> `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `claude-haiku-4-5` and `claude-opus-4-5`. Current models:
> `gemini-3.5-flash-lite` (simple), `gemini-3.6-flash` (general), `gemini-3.8-flash`, `gemini-3.1-pro-preview`
> (deep reasoning; Gemini 4 Argon is its planned successor), `claude-haiku-5-5` and `claude-opus-5-5` (global
> endpoint). As with `gemini-2.5-flash`, the retired IDs keep pricing-only rate-card, `CalculateCost.js` and
> analytics-colour entries so historical traffic is not re-priced at the `default` rate.

**`claude-haiku-5-5` is the deliberate token-limit demo model at 300 tokens / 1 minute.**
`/auto` is 20000 tokens / 2 minutes (rolling) and every other operation in
[customer_support_and_sales.json](apigee/products/customer_support_and_sales.json) is 2000 tokens / 1 minute. `/auto` has a higher cap because one agent turn chains several model calls and thinking tokens count. The 2-minute rolling window is for the Agent Showcase quota burst (scenario 7): spent tokens stay counted long enough to show the 429, and a second burst right after is stopped at once. The product declares **5 `operationConfigs` across 4 models** (`auto`
has two — `/auto` and `/auto:*`), exactly one `llmOperation` per config (the Management API
rejects more with `Operations must contain exactly one entity`, and rejects an empty config with
`Operations must contain exactly one entity but found 0 entities` — which is why retiring a model
means deleting its whole wrapper, not just its operation):

| Resource | Model | Token quota |
| :--- | :--- | :--- |
| `/auto` | `auto` | 20000 / 2 min |
| `/auto:*` | `auto` | 20000 / 2 min (must equal `/auto`) |
| `/models/gemini-3.5-flash-lite:*` | `gemini-3.5-flash-lite` | 2000 / 1 min |
| `/models/gemini-3.6-flash:*` | `gemini-3.6-flash` | 2000 / 1 min |
| **`/models/claude-haiku-5-5:*`** | `claude-haiku-5-5` | **300 / 1 min** |

> [!NOTE]
> **Auto-routing is two resources that must carry one number.** All three persona products declare `/auto`
> *and* `/auto:*` as separate `operationConfigs`, each with its own quota — the Management API
> forbids two operations in one config, so they cannot share a single quota block. That once let
> them drift apart: a single quota change left one route at 3000 and the other at 2000, giving the
> confusing state "3,000 tokens a minute (2,000 at base route)".
>
> History: `/auto:*` was removed in `02e21bf` because of that drift (the UI only calls bare
> `/ai/v1/auto`). It has since been **restored** so Gemini-SDK-style clients can call
> `/ai/v1/auto:generateContent`, this time with a guard:
> [products.unit.test.mjs](ui/tests/products.unit.test.mjs) fails unless `/auto` and `/auto:*`
> have **equal** `llmTokenQuota` in every persona product JSON and in `DEFAULT_PRODUCTS`, and the Admin
> Console (`MonetizationManager`) edits quotas by model, so both configs move together.
>
> Caveat: they are still two counters, so a caller can spend the limit on `/auto` **and** again on
> `/auto:*` in the same window — accepted for the demo. `/auto:streamGenerateContent` is **not**
> supported (refused by `RF-StreamingNotSupported`); streaming for `/auto` is on the roadmap.

Enforcement is wired through the dedicated `LLMTokenLimitFlow` conditional flow, which fires on
`/models/claude-haiku-5-5:generateContent`, on
`flow.model == "claude-haiku-5-5"`, or on the regex `^/models/claude-haiku-4-5.*` — the
last clause deliberately omits the `@date` suffix so a future revision of the same model still
matches. Breaching the limit returns **HTTP 429**.

**Threshold alert before the 429.**
[JS-TokenQuotaThreshold.xml](apigee/proxies/ai-gateway-v1/apiproxy/policies/JS-TokenQuotaThreshold.xml)
([TokenQuotaThreshold.js](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/TokenQuotaThreshold.js))
runs in PostFlow right after `LTQ-TokenCount`, under the same condition (200 and not cached). It
divides `ratelimit.LTQ-TokenCount.used.count` by the product limit
`verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit` and sets
`x-gateway-token-quota-status` to `ok` (≤ 50%), `near-threshold` (> 50% and < 100%) or `exhausted`
(≥ 100%), alongside used / limit / percentage / warning headers (see section 6). The threshold is
the policy's `threshold` property (`0.5`). The policy is `continueOnError="true"` and
observability-only: it never blocks a call. The Chat Playground turns the signal into an amber
*Nearing token quota threshold* banner (rose *Token quota exhausted*) at the top of the chat, driven
by the most recent call that carried it, plus a small chip on the message itself — parsed by
[tokenQuota.js](ui/src/utils/tokenQuota.js). Cache hits and errors carry no signal.

> [!NOTE]
> The limit comes from the API product, not `ratelimit.LTQ-TokenCount.allowed.count`: for a
> `CountOnly` policy the runtime reports `Long.MAX_VALUE` (`9223372036854775807`) there, which made
> every call read as 0% (verified on dev).

The **Token Limits** demo is 4 stateless calls (no chat history, `maxOutputTokens: 90`, ~120 tokens
each), run within one minute because the window is rolling. Clicking a later sub-step directly
(e.g. **4. Blocked (429)**) first runs the earlier steps it depends on; the Semantic Cache
**Instant Hit** sub-step likewise seeds first if needed
([scenarioPrereqs.js](ui/src/utils/scenarioPrereqs.js)). In the scenario bar under the prompt
box, clicking a chip runs its next step; hovering for ~0.6 s or clicking its ▾ opens a picker to
run any step directly:

| Step | Window after the call | Result |
| :--- | :--- | :--- |
| 1 | ~40% | 200, `ok` |
| 2 | ~80% | 200 + `near-threshold` alert |
| 3 | > 100% | 200 + `exhausted` alert — still admitted, because `LTQ-TokenEnforce` is `EnforceOnly` and the counter was under the limit when the request arrived |
| 4 | — | **429** from `LTQ-TokenEnforce` |

Verified on dev: 117/300 (39%) `ok`, 236/300 (78.7%) `near-threshold`, 361/300 (120.3%)
`exhausted`, then 429. The plan holds for any per-call size of 100–149 tokens.

> [!IMPORTANT]
> The counter is keyed on `flow.emailId`, the SSO-derived caller identity — **not** on the consumer
> key. Every demo user shares the same `Unified Admin … App` credential, so a key-keyed window
> meant two people demoing at once shared one token budget and the second got a 429 they did
> not cause. `LTQ-TokenEnforce` and `LTQ-TokenCount` must declare an **identical** `<Identifier>`:
> they share `common-counter`, and if they diverge the enforcer reads a counter nobody writes to
> and the quota silently stops working.

### 4. 💳 Apigee Native Monetization & Prepaid Wallets

- **Cost calculation** — `KVM-GetModelRates` loads the `ai-model-rates` KVM (`rate_card` entry),
  then [CalculateCost.js](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/CalculateCost.js)
  computes `flow.tx_cost_micros`.
- **Wallet deduction** — `QC-DeductBudget` debits the developer wallet, and
  `JS-AuditBudgetAccounting` records the outcome in `flow.budget_status`.
  `MLC-EnforceMonetizationLimits` gates the request on the way in with a 403.

- **Budget enforcement** — `QC-EnforceBudgetLimit` checks the counter on the way in and
  `RF-BudgetExceeded` returns **HTTP 429 `RESOURCE_EXHAUSTED`** when it is exhausted.

  > [!IMPORTANT]
  > The quota policy is `continueOnError="true"` on purpose, so its raw
  > `policies.ratelimit.QuotaViolation` never reaches the client; `RF-BudgetExceeded` raises the
  > 429 instead, in the same envelope as every other guardrail. **Deleting that step silently
  > disables budget enforcement entirely** — which is exactly the state this proxy was in until
  > it was added. There is no `ratelimit.<policy>.exceeded` variable; the working signal is
  > `ratelimit.<policy>.failed = true and ratelimit.<policy>.exceed.count > 0`.
- **Prepaid provisioning** — [server.js](ui/server.js#L531-L569)
  sets `billingType: PREPAID` and credits a **$20 USD** starting balance. This now runs from the
  explicit `/api/me/onboard` step rather than silently on sign-in — see
  [First-run developer onboarding](#first-run-developer-onboarding).
- **Rate plans & attribution** — surfaced through the `/api/monetization/*` endpoints
  (rate plans, subscriptions, attributions, credit, config).

### 5. ⚡ Cache (Vertex AI Vector Search)

[SCL-Semantic-Cache-Lookup.xml](apigee/proxies/ai-gateway-v1/apiproxy/policies/SCL-Semantic-Cache-Lookup.xml)
embeds the prompt with Vertex AI `text-embedding-005` and queries a Vertex AI Vector Search index
endpoint (`DeployedIndexID: semantic_cache`) with a similarity **threshold of 0.95**.
`SCP-Semantic-Cache-Populate` writes successful responses back.

Caching is **opt-in per request** — the lookup only runs when the `use-cache` or `x-use-cache`
header is `true`. On a hit, `flow.cached` is `"true"`, which skips `QC-DeductBudget` and
`LTQ-TokenCount` — so a cache hit costs no tokens and no wallet balance.

`KVM-GetModelRates` and `JS-CalculateCost` **do** still run on a hit; they are gated on
`response.status.code = 200` alone. That is what populates `x-gateway-cost-tier` on a cached
response, which was previously empty. `CalculateCost.js` zeroes the cost itself on a hit rather
than being skipped. A hit reports `x-gateway-budget-status: skipped_cached`.

### 6. 📡 `x-gateway-*` Trace Telemetry Contract

Every gateway response carries a block of trace headers set by a single policy,
[AM-SetResponseHeaders.xml](apigee/proxies/ai-gateway-v1/apiproxy/policies/AM-SetResponseHeaders.xml).
This is a **contract, not a debugging aid** — the UI trace inspector, the analytics dashboard and
the live test suite all read it, so headers must not be renamed or dropped.

| Header | Source variable | Meaning |
| :--- | :--- | :--- |
| `x-gateway-model` | `flow.target_model` | Model actually invoked upstream |
| `x-gateway-provider` | `flow.target_provider` | `google` or `anthropic` — also selects the Vertex target |
| `x-auto-routed` | `flow.autoRouted` | Whether `AutoRouting.js` chose the model |
| `x-gateway-category` | `flow.routerCategory` | Category the router model returned: `coding` / `deep_reasoning` / `simple` / `general`. Empty when the classifier was skipped or failed |
| `x-gateway-router-category` | `flow.routerCategory` | Alias of the above, kept so the UI trace inspector and the analytics dashboard can read either name |
| `x-gateway-cost-tier` | `flow.costTier` | `low` / `medium` / `high` routing classification |
| `x-gateway-cost-usd` | `flow.tx_cost_usd` | Computed request cost |
| `x-gateway-currency` | *(literal `USD`)* | Currency for the cost fields |
| `x-gateway-cached` | `flow.cached` | `"true"` on a semantic cache hit |
| `x-gateway-cache-status` | `flow.cacheStatus` | Cache lookup outcome detail |
| `x-gateway-prompt-tokens` | `flow.promptTokenCount` | Input tokens |
| `x-gateway-completion-tokens` | `flow.candidatesTokenCount` | Output tokens |
| `x-gateway-total-tokens` | `flow.totalTokenCount` | Total tokens, and the quota-counted figure |
| `x-gateway-token-quota-used` | `flow.token_quota_used` | Tokens counted in the current LLM-quota window, this response included |
| `x-gateway-token-quota-limit` | `flow.token_quota_limit` | The product's `llmTokenQuota` limit for the operation |
| `x-gateway-token-quota-used-pct` | `flow.token_quota_used_pct` | Used / limit as a percentage, one decimal place |
| `x-gateway-token-quota-threshold-pct` | `flow.token_quota_threshold_pct` | Alert threshold (`50`) |
| `x-gateway-token-quota-status` | `flow.token_quota_status` | `ok` / `near-threshold` / `exhausted` — set by `JS-TokenQuotaThreshold` |
| `x-gateway-token-quota-warning` | `flow.token_quota_warning` | Human-readable warning; empty when `ok` |
| `x-gateway-budget-status` | `flow.budget_status` | Budget accounting outcome — see below |
| `x-gateway-budget-used-usd` | `flow.budget_used_usd` | Developer spend recorded this interval |
| `x-gateway-budget-limit-usd` | `flow.budget_limit_usd` | Budget cap the counter is measured against |
| `x-gateway-monetization-status` | `mint.limitscheck.status_message` | Monetization limit-check verdict |
| `x-gateway-prepaid-balance` | `mint.limitscheck.prepaid_developer_balance` | Wallet balance at check time |
| `x-gateway-prepaid-currency` | `mint.limitscheck.prepaid_developer_currency` | Wallet currency |
| `x-gateway-balance-remaining` | `flow.prepaid_balance_remaining` | Balance after this request's deduction |

`x-gateway-budget-status` exists because budget accounting is fail-open by design and every way
it can break is otherwise silent — `QC-DeductBudget` swallows its own faults, and a
`JS-CalculateCost` failure skips the step with no fault raised at all.
[AuditBudgetAccounting.js](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/AuditBudgetAccounting.js)
runs unconditionally after the deduction and names the outcome:

| Value | Meaning |
| :--- | :--- |
| `ok` | Cost computed, counter incremented |
| `skipped_cached` | Semantic cache hit — deliberately not charged |
| `skipped_no_cost` | **Silent failure** — costing produced no weight |
| `skipped_not_run` | Step condition matched nothing, or policy disabled |
| `violation` | Quota raised, but the spend *was* recorded — cap now crossed |
| `error` | **Silent failure** — quota faulted before counting; spend lost |

The same values are logged to Cloud Logging as `budgetStatus`, which is the surface to alert on.

The policy runs with `continueOnError="true"` and `<IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>`,
so an unset variable yields an absent or empty header rather than a fault — clients must treat every
header as optional. On a cache hit the cost and token variables are never populated, which is why
`x-gateway-cached` is the field to branch on.

### 7. 🛠️ Native MCP Server & Tools Governance

The `mcp` proxy (`/mcp`, Customer Service / Business Insights / Enterprise tools) governs JSON-RPC 2.0 `tools/list` and
`tools/call` traffic. It is **UI-managed by design**: it is created, edited and deployed in the
Apigee UI, and its source is intentionally not in this repo, because pushing a repo bundle over it
once broke the UI-managed configuration.
[deploy_proxy.sh](apigee/scripts/deploy_proxy.sh) refuses `--proxy mcp`, and
[proxybundle.unit.test.mjs](ui/tests/proxybundle.unit.test.mjs) asserts `apigee/proxies/mcp` does
not exist.

The repo-managed [bigquery-mcp](apigee/proxies/bigquery-mcp) and
[servicenow-mcp](apigee/proxies/servicenow-mcp) gateways each carry seven policies (`CORS-Allow`,
`PP-MCP`, `RF-MethodNotAllowed`, `VA-VerifyAPIKey`, `Q-Limit`, `AM-RemoveAuthorization`,
`ML-CloudLogging`) and enforce a JSON-RPC **method allowlist**:

| Method | Key required | Outcome |
| :--- | :--- | :--- |
| `tools/list`, `tools/call` | **Yes** (`VA-VerifyAPIKey` + `Q-Limit`) | Forwarded |
| `initialize`, `ping`, `notifications/*` | No — the MCP products define only `tools/list` / `tools/call/<tool>` operations, so VerifyAPIKey would fail the handshake | Forwarded |
| anything else (`resources/*`, `prompts/*`, …) | — | `RF-MethodNotAllowed` → **400** `{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not allowed by gateway"}}` |

`OPTIONS` (CORS preflight) bypasses the allowlist.

Authorization is expressed as **per-operation entries in the API product**, so a persona can only
invoke the tools its product enumerates:

| Product | Operations | Quotas |
| :--- | :--- | :--- |
| [Customer Service Tools MCP](apigee/products/customer_service_tools_mcp.json) | `tools/list`, `tools/call/searchCustomers`, `getCustomer`, `listCustomerOrders`, `getOrderStatus`, `getProductPrice`, `createSupportCase`, `issueRefund` | `tools/list` 10/min · lookups 20/min each · `createSupportCase` 10/min · `issueRefund` 5/min |
| [Business Insights Tools MCP](apigee/products/business_insights_tools_mcp.json) | `tools/list`, `tools/call/getRevenueTrends`, `getSupportMetrics`, `getChurnRisk`, `getProductMargins`, `runForecast` | `tools/list` 10/min · insights 20/min each · `runForecast` **2/min** |
| [Enterprise Tools MCP](apigee/products/enterprise_tools_mcp.json) | all 12 tools above (same quotas) plus every BigQuery MCP and ServiceNow MCP tool | per-operation |
| [ServiceNow Tools MCP - Create Incident](apigee/products/servicenow_tools_mcp_create_incident.json) | `tools/list`, `tools/call/createIncident` on `servicenow-mcp` (Unified Sales App: approval requests) | `tools/list` 10/min · `createIncident` 5/min |

The products are created by
[provision_business_products.py](apigee/scripts/provision_business_products.py) and synced by
`provision_unified_credentials.py`. **Customer Service Tools MCP** is attached to the Unified Sales
App (Customer Support & Sales, 7 tools); **Business Insights Tools MCP** to the Unified Loans App
(Analysts & Knowledge Workers, 5 tools); the Engineering & IT key sees all 12 tools
others. A call without a key fails with **401** `FailedToResolveAPIKey`; a tool outside the
caller's product (a Support & Sales key calling `getProductMargins`, an Analyst key calling
`getCustomer`) fails with **401** `InvalidApiKeyForGivenResource`. A third `runForecast` in a
minute returns **429**.

The MCP tools are REST APIs converted to MCP by Apigee: they were added in the Apigee UI
(**Add tool**) to the prod `mcp` proxy from the OpenAPI specs that API hub syncs from the REST
proxies below. The dev `mcp-dev` proxy carries no governance policies, so all MCP testing happens
in prod. POST tools take their JSON body under an argument named `<operationId>Body`
(`issueRefundBody`, `createSupportCaseBody`, `runForecastBody`); flat arguments return JSON-RPC
**-32602**.

#### Customer Service & Business Insights backends

The demo scenario is generic — *your customers*. Two private REST services run on Cloud Run
(project `your-gcp-project`, region `asia-southeast1`, `--no-allow-unauthenticated`; only the Apigee
service account `ai-client@your-gcp-project.iam.gserviceaccount.com` can invoke them). Both are built
from one image in [services/](services), selected by the `SERVICE` env var, over deterministic seed
data ([seed.js](services/shared/seed.js): 150 customers, 1500 orders, 12 products, 500 cases;
demo "today" is 2026-09-25).

| Cloud Run service | Apigee REST proxy | Base path | Spec |
| :--- | :--- | :--- | :--- |
| `customer-service-api` | [customer-service-v1](apigee/proxies/customer-service-v1) | `/customer-service/v1` | [customer-service.yaml](apigee/specs/customer-service.yaml) |
| `business-insights-api` | [business-insights-v1](apigee/proxies/business-insights-v1) | `/business-insights/v1` | [business-insights.yaml](apigee/specs/business-insights.yaml) — aggregated data only, no individual customer data |

Each proxy runs PreFlow `CORS` → `KVM-GetConfig` → `JS-CheckCaller` → `RF-NotInternal` →
`SA-Protect` (spike arrest), then one conditional flow per tool starting with
`OAS-ValidateRequest` (the spec is bundled as `resources/oas/*.yaml`, and API hub syncs it from the
proxy); unknown paths return **404**. The target PreFlow runs `AM-RemoveClientAuth` (stripping
`Authorization`, `X-Serverless-Authorization`, `X-Goog-IAP-JWT-Assertion`, `x-api-key`, `x-apikey`
so upstream IAP/Serverless-NEG tokens cannot shadow Apigee's token) and authenticates to Cloud Run
with `GoogleIDToken`, and `ML-CloudLogging` writes to Cloud Logging.

- **Private-API check** — `RF-NotInternal` returns **403** `NOT_INTERNAL` unless the call comes
  from the Apigee MCP server, recognised by the internal hops Google infrastructure appends to
  `X-Forwarded-For` after the external load balancer, or from the Apigee NAT IP `34.124.136.14`
  (`nat-1`, the instance's only ACTIVE NAT address).
- **Refund business rule** — `issueRefund` over **$50** is refused at the REST proxy with **403**
  `REFUND_LIMIT` ("Refunds over $50 need supervisor approval") before the backend, for caller
  keys on the **Customer Service Tools MCP** product (KVM `refund.limitedProducts`; the MCP server
  forwards the caller's `x-apikey`, which `AE-CallerKey` resolves). The all-tools Enterprise Tools
  MCP product is not limited, which is what the Agent Showcase's ungoverned agent uses. $50 or
  less is approved. Via MCP it arrives as HTTP 403 with JSON-RPC
  `result.isError=true`. **Approvals via ServiceNow**: when a refund, credit or waiver is refused
  for approval, every showcase agent (generic and all industry packs) says plainly it was not
  applied and raises a ServiceNow incident with `createIncident` (category "Approval Request",
  priority "3 - Moderate"), then gives the customer the incident number. The Support & Sales key
  gets this one tool through the **ServiceNow Tools MCP - Create Incident** product
  (`tools/list` 10/min, `createIncident` 5/min); every other ServiceNow tool still returns 401.
- **Config** — encrypted per-env KVM `customer-tools-config`: `refund.maxAmount=50`,
  `refund.limitedProducts=Customer Service Tools MCP`,
  `internal.allowedIps` (NAT IPs), `internal.enforce=true`.

| Script | Purpose |
| :--- | :--- |
| [gen_business_proxies.py](apigee/scripts/gen_business_proxies.py) `<cs-url> <bi-url> [--prod-first]` | Generates both REST proxy bundles |
| [deploy_business_proxies.sh](apigee/scripts/deploy_business_proxies.sh) `<env> [enforce]` | Deploys them to an environment |
| [test_business_apis.sh](apigee/scripts/test_business_apis.sh) | Tests the REST proxies |
| [provision_business_products.py](apigee/scripts/provision_business_products.py) | Creates the two MCP tool products |

**Demo story.** Customer Jane Doe (`CUST-1001`, Gold) says order `ORD-1042` is late ($144,
Delayed). The support agent checks the order, logs a case and offers a $30 goodwill refund
(approved); a $120 refund is blocked by the $50 rule. The analyst sees last-30-day CSAT 3.2 vs 4.1
before, with "Late delivery" the top issue, checks churn risk, and finds margins confidential
(Support can't see them) and forecasts rate limited.

**In the UI.** The MCP Gateway tab's Tools presets walk this story: *Check Order ORD-1042*,
*Customer Profile CUST-1001*, *Log Support Case*, *Refund $30* (approved), *Refund $120*
(403 `REFUND_LIMIT`), *Support Metrics 30 days*, *Churn Risk by Cohort*, *Product Margin
(confidential)* and *Forecast Burst (Quota 429)*, alongside the ServiceNow and BigQuery presets.

*Try a task* opens with a numbered flow for the selected persona: two tasks that work, one the
gateway stops, then one more. Each chip carries its expected outcome (Works / Blocked / Limit;
200 / Denied / 429 for Engineering & IT). The rest of the presets follow in catalog order
(`MCP_PERSONA_FLOWS` in [mcpFlows.js](ui/src/utils/mcpFlows.js), re-exported by
[defaultSettings.ts](ui/src/services/defaultSettings.ts)):

| # | Customer Support & Sales | Analysts & Knowledge Workers | Engineering & IT |
| :--- | :--- | :--- | :--- |
| 1 | Where is order 1042? (200) | Why is CSAT dropping? (200) | Order status (200) |
| 2 | $30 goodwill refund (200) | Smart Hub margin (200) | Refund $30 (200) |
| 3 | $120 refund (403 `REFUND_LIMIT`) | Look up a customer (401, not on their product) | Forecast burst (429) |
| 4 | Support trends this month (401, analyst-only) | Revenue forecast (429 on the 3rd call in a minute) | Refund $120 (200, no limit on the all-tools product) |

Object arguments (`issueRefundBody`, `createSupportCaseBody`, `runForecastBody`) are shown as
sub-fields, enums as dropdowns, and blank optional fields are left out of the call so they don't
fail the proxy's OpenAPI validation.

**Demo data reset.** The Customer Service API keeps its seed data in memory, and the flows change
it (the $30 refund lowers ORD-1042's refundable balance; *Log Support Case* adds a case). The UI
restores the seed data through `POST /api/demo/reset`
([demoReset.js](ui/server/demoReset.js)) when the guided demo (**Guide me**) starts, and from the
**Reset Demo Data** button (*Start fresh* in business voices) next to *Refresh Tools* on the MCP
tab. The server calls the backend's
`/admin/reset` directly (it is not exposed through Apigee) with a Google ID token: the Cloud Run
metadata server's token for `apigee-ui-mgmt-sa` in prod (it holds `roles/run.invoker` on
`customer-service-api`), or `gcloud auth print-identity-token` locally.

Each call is traced through **01 API Key Check → 02 Tools Filter → 03 Rate Limit → 04 MCP Call →
05 JSON-RPC → REST** (step 05 applies only to REST APIs converted and hosted as MCP by Apigee;
third-party MCP servers such as Salesforce skip it). The refund limit shows as an amber
business-rule stop after step 05, not as a Tools Filter denial.

#### Industry packs — the MCP tab and Agent Showcase follow the industry

When the customer theme's industry has a pack, the demo switches to that industry's tools, story
and agent prompts. 15 packs ship: Aviation, Banking, Education, Energy, Healthcare, Insurance,
IT Services, Manufacturing, Media, Oil & Gas, Public Sector, Real Estate, Retail, Telecom and Travel (hotels). Each is one
JSON file, `industries/<id>.json` ([industries/](industries)), with 21 tools (13 for Support & Sales, 8 for
Analysts) grouped into business areas, a hero customer, a $30 refund within policy and a $120 one
over the $50 limit, MCP presets and persona flows, and the Agent Showcase instruction and scenarios.
[industries/README.md](industries/README.md) lists every pack; [MAPPING.md](industries/MAPPING.md)
maps each industry to its prompts, personas, MCP server, tools, showcase and themes.

| Layer | Per pack |
| :--- | :--- |
| Backend | One private Cloud Run service `industry-apis` hosts every pack's mock API and MCP server (`/<id>/mcp`, handlers in [services/packs/](services/packs)) |
| Apigee | Repo-managed MCP proxy `<id>-mcp` at `/<id>/mcp` (key check, persona tool filter, quotas, `ExtractVariables` + `RaiseFault` for the $50 limit on the ops product only) and 3 products: `<Label> Tools MCP Admin` and one per persona. The persona products are attached to the Unified Sales / Loans apps, the Admin product to the Unified Admin apps |
| MCP tab | Tools, business-area filter, presets and *Try a task* flows from the pack; the persona decides which tools list |
| Agent Showcase | Both agents get the pack's instruction and MCP server in place of `/mcp` (BigQuery and ServiceNow stay); the governed Support & Sales key sees 13 tools and hits the limit at $120, the ungoverned admin key sees all tools and refunds |

Industries without a pack (including ones the theme agent adds) keep the generic `/mcp` story
above. The UI-managed `/mcp` proxy is untouched. Build and release steps:
[industries/README.md](industries/README.md#add-or-change-a-pack).

### Entitlement tiers — what the products actually grant

Every grant is enumerated per model. There are **no `model="*"` entitlements and no `**` resource
globs** — both were removed. Each model gets a single gateway-shaped resource:

```
/models/<model>:*
```

| Product | Models | Resources | Token quota |
| :--- | :--- | :--- | :--- |
| **[Engineering & IT](apigee/products/engineering_and_it.json)** | `auto`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `claude-haiku-5-5`, `claude-opus-5-5`, `gemini-3.7-flash`, `gemini-3.8-flash` — **8** | 9 `operationConfigs` (`auto` has two) | 10000 / min · `auto` → 50000 / min · `claude-haiku-5-5` → **300 / min** |
| **[Analysts & Knowledge Workers](apigee/products/analysts_and_knowledge_workers.json)** | `auto`, `gemini-3.1-pro-preview`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` — **6** (no Opus, no Haiku) | 7 `operationConfigs` (`auto` has two) | 5000 / min · `auto` → 30000 / min |
| **[Customer Support & Sales](apigee/products/customer_support_and_sales.json)** | `auto`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `claude-haiku-5-5` — **4** | 5 `operationConfigs` (`auto` has two) | 2000 / min · `auto` → 20000 / 2 min · `claude-haiku-5-5` → **300 / min** |

`auto` is granted as **an exact resource plus a verb-suffix resource** in all three persona products, as two
separate `operationConfigs` with equal quotas:

```
/auto
/auto:*
```

Apigee's `*` matches within a single path segment and requires **at least one character**, so
`/auto*` does **not** match a bare `/auto` — hence `/auto` must be granted as its own exact
resource. The tightened `:*` suffix form used for models is deliberate too: a trailing `*` placed
directly after a model name leaks siblings (`/models/gemini-2.5-flash*` also granted
`gemini-2.5-flash-lite`), whereas `:*` only absorbs the `:generateContent` /
`:streamGenerateContent` suffix.

The companion `/auto:*` resource was removed in `02e21bf` because, as a second `operationConfig`,
it gave auto-routing two independently editable quotas that had silently disagreed. It has been
**restored** with an equal-quota guard in `ui/tests/products.unit.test.mjs` (see the note in
section 3), so `/auto:generateContent` is entitled and works. `/auto:streamGenerateContent` is
**not** supported and is refused; streaming for `/auto` is on the roadmap.

`AutoRoutingFlow` matches `proxy.pathsuffix MatchesPath "/auto*"` or the regex `^/auto.*`, so it
serves both bare `/auto` (what the UI calls) and `/auto:generateContent`.
`/models/auto` is no longer entitled by any product and is rejected with **400** at
`OAS-ValidateRequest`, because the path is absent from the OpenAPI spec.

> [!NOTE]
> Customer Support & Sales **does** include `claude-haiku-5-5`. It does **not** enumerate
> `gemini-3.1-pro-preview` or `claude-opus-5-5`, so calls to those models with a Customer
> Support & Sales key are rejected by `VA-VerifyAPIKey`. Analysts & Knowledge Workers grants
> `gemini-3.1-pro-preview` but neither Claude model; only Engineering & IT grants Opus. All three products use
> `llmOperationGroup.operationConfigs[].llmTokenQuota` with exactly one `llmOperation` per config;
> neither uses the classic product `quota` field. The 300 tokens/min `claude-haiku-5-5` demo cap
> applies in **every** product that grants Haiku (Engineering & IT, Customer Support & Sales).

`gemini-2.5-pro` is deliberately **unentitled in every product**: a real, older-generation model the
organisation has not approved for use. It powers the "Restricted Model" demo scenario: even an Engineering & IT key is rejected at `VA-VerifyAPIKey` with **HTTP 401** before any
upstream call is made.

---

### 8. 📜 Full Audit Logs

Every governed call is written to Cloud Logging by
[`ML-CloudLogging`](apigee/proxies/ai-gateway-v1/apiproxy/policies/ML-CloudLogging.xml)
at `projects/your-gcp-project/logs/apigee`. The policy sits in **`PostClientFlow`**, which runs after
the response is flushed **and still fires on faults** — so successful, blocked and failed calls are
all captured.

Each record carries the identity (`userEmail`), the resolved `model` and path-derived
`requestedModel`, `targetProvider`, `autoRouted`, `cached`, `costUsd`, token counts, the full
`prompt` and `response`, plus `faultName` / `errorMessage`.

In the UI, the **Model Consumption Ledger** (Analytics & Cost) has a **View logs** link on every
`(user, model)` row. It opens a per-call table — timestamp, status, request, response, tokens, cost
and auto-routed / cached flags — with an **Open in Cloud Logging** deep link. Rows expand to reveal
the untruncated request and response.

The window selector offers `1h / 24h / 7d / 30d` and **opens on whichever range is selected on the
Analytics & Cost tab** (`24h` by default), so the drill-down always covers the same period as the
ledger row that spawned it. Narrowing it inside the modal does not change the dashboard.

| Piece | Location |
| :--- | :--- |
| Log policy | [`ML-CloudLogging.xml`](apigee/proxies/ai-gateway-v1/apiproxy/policies/ML-CloudLogging.xml) |
| Response-text extraction | [`EV-ModelResponse.xml`](apigee/proxies/ai-gateway-v1/apiproxy/policies/EV-ModelResponse.xml) |
| Read API | `GET /api/logs/calls` in [`server.js`](ui/server.js) |
| UI | [`CallLogsModal.tsx`](ui/src/components/CallLogsModal.tsx) |

> [!IMPORTANT]
> The server identity (`apigee-ui-mgmt-sa@your-gcp-project.iam.gserviceaccount.com`) needs
> `roles/logging.viewer`. The same service account backs both local development and Cloud Run, so a
> single grant covers both.

> [!CAUTION]
> `prompt` and `response` persist **full, untruncated** user content to Cloud Logging. This is a
> deliberate demo-fidelity choice. Redact or drop those two fields before handling real user data.

Model Armor blocks at `SUP-UserPrompt` in PreFlow, *before* the target model is resolved — such a
record has an empty `model`, which is why `requestedModel` is logged and why the read API matches
**either** field.

---

### 9. 🤖 Ask Apigee — conversational governance

A chat panel docked to the right of the **Admin Console** that reads and changes gateway
configuration in plain English. It is itself a customer of the gateway it administers: every turn
goes out through `/ai/v1`, is metered, and shows up in the demo's own analytics alongside user
traffic.

**It can only ever change dev.** `update_dev_product` writes a `(Dev)` clone of a tier, never the
live product — the guard is
[`assertWritableDevProduct`](ui/server/adminAgentCore.js),
and a unit test asserts no `PUT` is ever addressed to a live tier. There is deliberately **no
promote-to-prod path**: production is changed by raising a pull request against
[`apigee/products/`](apigee/products). `POST
/api/admin-agent/promote` is still routed, but only to return a `403` that explains this — deleting
it would give a stale browser tab an opaque `404`.

| Concern | How it is handled |
| :--- | :--- |
| Blast radius | Writes land on `… (Dev)` clones pinned to `environments: ['dev']`; `assertDevOnlyEnvironments` refuses any write or `environments` change that would attach a clone to `prod` (or to "all environments") |
| Undo | Byte-exact pre-write snapshot per change; `POST /revert` restores it |
| Going live | Pull request against the product JSON — not available to the agent |
| Secrets | The sandbox consumer key never leaves the server; responses pass through `redactSecrets()` |
| Runaway loops | 8 tool rounds and a 45s wall-clock ceiling per turn, and the loop never throws |

**Tools:** `list_products`, `get_product`, `list_guardrails`, `get_rate_card`,
`update_dev_product`, `run_dev_test`, `revert_change`; insights (`query_usage`,
`query_tool_usage`, `search_call_logs`, `explain_failure`); finance (`get_wallet`,
`list_rate_plans`, `topup_wallet`, `update_dev_rate_card`); MCP tool access (`list_mcp_tools`,
`update_dev_tool_access`, `run_dev_tool_test`); and `consult_skill`.

**User view.** Every non-console tab has an **Ask Apigee** button. That drawer gets only the
insight tools, pinned server-side to the caller's IAP identity, so a user can ask about their own
usage, costs and failed calls and nobody else's.

**Screening and cache switches.** `ai-gateway-v1` reads three optional API product attributes in
[`AM-ResolveGuardrailToggles`](apigee/proxies/ai-gateway-v1/apiproxy/policies/AM-ResolveGuardrailToggles.xml):
`guardrail.modelArmor.prompt`, `guardrail.modelArmor.response` and `guardrail.semanticCache` (`on`|`off`;
missing = `on`, so live products are unchanged). It reports the result in the `x-gateway-guardrails`
response header. Ask Apigee may flip them on `(Dev)` products only (AI CoE / Platform), and:

- **Skills first.** The server refuses a `guardrail.*` change unless `consult_skill` ran in the same
  turn. The cited skill sections are stored on the change record and shown on its card.
  `consult_skill` serves [`ui/server/skillDigest.json`](ui/server/skillDigest.json), a sectioned
  copy of `.gemini/skills` (the Cloud Run image only contains `ui/`). Regenerate it with
  `npm run gen:skill-digest`; a unit test fails if it is stale.
- **Prove it.** `run_dev_test` with `sourceProduct` uses a per-product test app
  (`ask-apigee-test-<tier>`, bound to that dev product only). The shared sandbox key spans every dev
  product, so Apigee would resolve an arbitrary one. The result's `guardrailsCheck` compares what the
  product asks for with what the gateway applied, and the agent may only call it proven when they match.

**MCP tool access.** Each MCP API product is a persona's tool set: `payloadOperationGroup` lists
`tools/call/<tool>` operations, each with its own per-minute quota. Ask Apigee can allow or remove
tools, or change a tool's quota, following
[`tools-gateway-manager`](.gemini/skills/tools-gateway-manager/SKILL.md)
([`mcpGovernance.js`](ui/server/mcpGovernance.js)):

- Writes go only to a `<product> Dev` clone. It is created from the live product on first use, is
  bound to `dev` only, and is auto-approved. `assertWritableMcpDev` refuses anything else. You can
  only add tools that some product already grants on the same MCP server.
- `consult_skill` (`tools-gateway-manager`) must run in the same turn. A guardrail-skill consult does
  not count. Citations are stored on the change, and revert restores the clone exactly.
- `run_dev_tool_test` calls the tool on the dev gateway with a test app (`ask-apigee-mcp-test-<product>`)
  that holds only the clone. Apigee's `InvalidApiKeyForGivenResource` means **denied**; any backend
  answer means **allowed**. The result reports `matches` against the clone's tool list.

`run_dev_test` fires a real metered prompt at the dev gateway with the sandbox key, which is why the
test card is the one place the panel still shows tokens, cost and latency — there, the telemetry
*is* the answer. Ordinary chat turns show none.

#### Model selection

Chosen by benchmark against the live gateway, using the agent's own system instruction and tool
declarations, 3 trials each:

| Model | Plain answer | Tool turn | Tool calls | Thinking tokens | Cost / call |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`gemini-3.1-flash-lite`** ✅ | 2334 ms | **2212 ms** | 3/3 | 0 | **$0.000101** |
| `gemini-3-flash-preview` | 3747 ms | 2690 ms | 3/3 | 55 | $0.000235 |
| `gemini-3.7-flash` | 3648 ms | 3249 ms | 3/3 | 48 | $0.002414 |
| `gemini-3.8-flash` | **504 Gateway Timeout** | — | — | — | — |

Measured 2026-09 on models since retired; in 2026-10 the agent moved to their successors,
`gemini-3.5-flash-lite` (primary) and `gemini-3.6-flash` (fallback).
`gemini-3.8-flash` was the original choice and timed out at the gateway under a tool-bearing
request. `gemini-3.5-flash-lite` is entitled on **both** tiers, so
[`AGENT_FALLBACK_MODEL`](ui/server/adminAgentCore.js)
(`gemini-3.6-flash`, used on a 403/404 entitlement failure) is now a genuine last resort.

> [!NOTE]
> A smaller model needs firmer instructions. flash-lite initially guessed a model id
> (`claude-3-haiku`) instead of reading the product, then *asked permission* to retry with the
> correct name the error had just handed it. Two system-instruction rules fixed it: never guess a
> model id, and self-correct immediately when an error lists the valid values.

#### Endpoints

All under `/api/admin-agent/*`, served by
[`adminAgentService.js`](ui/server/adminAgentService.js):
`GET /sandbox`, `POST /sandbox/provision`, `POST /chat`, `GET /changes`, `POST /revert`,
`POST /test`, and the deliberately-disabled `POST /promote`.

> [!IMPORTANT]
> The sandbox app's Apigee resource name is `admin-copilot-dev`, from before the feature was renamed
> from Admin Copilot. An Apigee app name cannot be edited in place, so renaming it would orphan the
> provisioned consumer key. Only the resource id is frozen — its DisplayName reads
> *Admin Agent Dev Sandbox*.

### 10. 🆚 Agent Showcase — the same agent with and without AI governance

The **Agent Showcase** tab sends one customer question to two ADK agents at once and streams both
side by side ([AgentShowcase.tsx](ui/src/components/AgentShowcase.tsx), service in
[`agents/`](agents)). Both agents have the same name, instructions, loop, MCP servers and request headers
(including `use-cache`, which the pass-through ignores). Only two things differ: the model URL and the API key.

With an industry pack selected, both agents take the pack's instruction and its `<id>-mcp` server in
place of `/mcp`, and the scenario chips use the pack's story (a **Tools: &lt;industry&gt;** badge shows
which); see [Industry packs](#industry-packs--the-mcp-tab-and-agent-showcase-follow-the-industry).
The tables below describe the generic story.

| | Regular Gateway (Without AI governance) | With AI & Tools Governance |
| :--- | :--- | :--- |
| Model | One model for every step via [`llm-passthrough-v1`](apigee/proxies/llm-passthrough-v1) (key check, analytics and logs only): Gemini 3.8 Flash by default, switchable in the column to Gemini 3.6 Flash or 3.5 Flash-Lite (`BASELINE_MODELS` on the agent service) | `/ai/v1/auto`: routing, semantic cache, Model Armor, token quota |
| Tools | Connects to `/mcp`, `/bigquery/mcp`, `/servicenow/mcp` with the caller's Unified Admin key: 24 tools | Connects to the same three with the Support and Sales key: Apigee lists 7 tools on `/mcp`, only `createIncident` on ServiceNow (for approval requests) and refuses BigQuery (401 `InvalidApiKeyForGivenResource`); ADK carries on without it |
| Cost | Tokens × the `ai-model-rates` KVM | Same KVM, same way |

The refusals are visible: the governed timeline shows a red **Refused: not authorized for this
agent** line per refused server (once per server; every repeat with *Show tool-server protocol
calls*), and **Agent Analytics** counts them as the governed agent's Blocked MCP calls on the
BigQuery and ServiceNow rows. Apigee rejects the key before it resolves an app, so Analytics
records no app for them; agent-traffic 401s with no app on those two servers are attributed to the
governed agent, whose key is the only one refused there
([`isRefusedByKey`](ui/server/agentAnalytics.js)).

Eight preset scenarios, measured on prod (27–28 Sep 2026):

| # | Scenario | Regular Gateway (Without AI governance) | With AI & Tools Governance |
| :--- | :--- | :--- | :--- |
| 1 | Simple lookup | Pro, 265k input tokens, $0.33 | Flash-lite / Flash, 2.6k tokens, $0.0002 |
| 2 | Ask again (cache) | Full Pro call again | First step from the semantic cache |
| 3 | Upset customer | Chooses from 24 tools | Chooses from 7, same case opened |
| 4 | $120 refund | Refund issued | 403 `REFUND_LIMIT` at $50; the agent opens a case |
| 5 | Confidential data | Hands over the product margin | Margin tool not on the support key |
| 6 | Prompt injection | Reaches Pro ($0.17) | Model Armor blocks it before any model runs |
| 7 | Burst (usage limit) | — | 5 governed runs back to back, cache off: 3 answered, then 429 `LLMTokenQuotaViolation` (20000 tokens / 2 min) |
| 8 | Cheaper model? | Switched to Flash-Lite for this question: wrong box plan ($36–$38) or gives up, in every run so far | Routed `deep_reasoning` to Gemini 3.1 Pro: $32, one box of each size, each exactly full, in one step (answer reuse off for this scenario) |

Scenario 8 answers "why not just use a cheaper model?": picking it switches the ungoverned agent's
model picker to Gemini 3.5 Flash-Lite, and picking another scenario puts the previous model back.
The Customer Support & Sales product routes `deep_reasoning` to `gemini-3.1-pro-preview` on `/auto`
only, so the governed agent pays for Pro just on the question that needs it; easy steps still go to
Flash-Lite or Flash.

Scenario 7 runs back to back rather than in parallel: the token quota is checked when a model call
starts and counted when it ends, so parallel runs all pass the check before any of their tokens
count. The window is a rolling 2 minutes, so S1–S6 run just before also count, and a second burst
within 2 minutes is stopped at once. The **Agent comparison** sub-tab totals every run of the session per agent: input and
output tokens, cost per model, models used, and each MCP tool with its server and outcome (OK,
blocked, error). Scenario 4 changes demo data; use **Reset demo data** afterwards.

**Agent Analytics**, the second page in the Agent Showcase pane (switch in its title row), shows the same two agents over time
(24 hours, 7 or 30 days; Prod or Dev) from what Apigee recorded, not from the browser session:
model cost, input and output tokens, model calls and average call time per agent, a per-hour or
per-day chart, models and cost, what happened to each model call (answered, semantic cache, token
quota 429, policy block, provider 429, timeout), MCP calls by server, and the MCP tools each agent
used. It reads `/api/analytics/agent-stats` ([agentAnalytics.js](ui/server/agentAnalytics.js)):
- Apigee Analytics with the standard `useragent` dimension. The agent service is the only Python
  client of the gateway (`python-httpx/*` for model calls, `google-adk/*` for MCP), so no proxy
  change was needed and the history goes back to the first agent run. Model calls are split by
  proxy (`llm-passthrough-v1` = without governance, `ai-gateway-v1` = with governance), MCP calls by
  the key (Unified Admin app = without, Support & Sales app = with). MCP `initialize` handshakes
  pass before the key check, so they are counted separately.
- Cost from the `ai-model-rates` KVM for both agents; cache hits are not billed.
- Tool names from the MCP proxies' Cloud Logging entries: `tools/call` requests whose params carry
  `_meta`, which ADK's MCP client adds and the UI's MCP playground does not.

On screen the wording describes what the controls do (authorized tools, usage and business limits,
safety checks, right-sized models), not how the gateway implements them. Both agents get the same
rows in the same order, and every row is colour coded:

| Colour | Regular Gateway, without AI governance (risks) | With AI & Tools Governance (controls) |
| :--- | :--- | :--- |
| Green | Tool or model call allowed | Allowed; answers reused from the cache ("Paid once, reused"); unsafe requests stopped before a model (shield) |
| Amber | **Premium model** for every step, **No refund limit** on `issueRefund`, **No answer reuse**, provider 429 / timeouts | **Refunds over $50 blocked** on `issueRefund` (the tool itself stays green) |
| Red | **Unauthorized access**: tools and servers the governed agent is not authorized for (`getProductMargins`, BigQuery, ServiceNow); **No safety checks** / **No prompt-attack checks** | **Blocked: not authorized for this agent** |

The KPI cards show the "Without" value in red wherever governance does better, and the chart shows
the ungoverned agent in red and the governed agent in blue.

---

## 📁 Repository Structure

```
.
├── AGENTS.md                              # Subagent persona registry & playbooks
├── GEMINI.md                              # Repository-level agent instructions
├── README.md
├── scenario_presets_review.md
├── agents/                                # Agent Showcase service: Python Google ADK + FastAPI (private Cloud Run)
│   ├── Dockerfile
│   ├── deploy.sh                          # Build + deploy agent-showcase-api (asia-southeast1)
│   ├── cloudbuild.test.yaml               # pytest in Cloud Build (Python 3.12)
│   ├── requirements.txt
│   ├── .env.example
│   ├── scripts/smoke_live.py              # Live run against the deployed service
│   ├── tests/
│   └── app/
│       ├── main.py                        # /health, /v1/profiles, POST /v1/showcase/run (SSE)
│       ├── agent.py                       # run_side(): one ADK LlmAgent per side, same prompt
│       ├── profiles.py                    # Sides: pass-through + 3 MCP servers vs /auto + curated MCP
│       ├── gateway_llm.py                 # ADK model adapter: Apigee /auto, llm-passthrough-v1, or Vertex
│       ├── mcp_transport.py               # Records every MCP hop and tool call
│       ├── recorder.py                    # Per-side event stream + totals
│       └── config.py
├── apigee/
│   ├── apps/                              # Developer apps (2)
│   │   ├── unified_sales_app.json
│   │   └── unified_loans_app.json
│   ├── products/                          # API products (8)
│   │   ├── engineering_and_it.json
│   │   ├── analysts_and_knowledge_workers.json
│   │   ├── customer_support_and_sales.json
│   │   ├── enterprise_tools_mcp.json
│   │   ├── customer_service_tools_mcp.json
│   │   ├── business_insights_tools_mcp.json
│   │   ├── bigquery_tools_mcp.json
│   │   └── servicenow_tools_mcp.json
│   ├── proxies/
│   │   ├── ai-gateway-v1/                 # PRIMARY AI Gateway — 43 policies
│   │   ├── bigquery-mcp/                  # Standalone BigQuery MCP Gateway — 7 policies
│   │   ├── servicenow-mcp/                # Standalone ServiceNow MCP Gateway — 7 policies
│   │   ├── customer-service-v1/           # Private REST proxy → customer-service-api (generated)
│   │   └── business-insights-v1/          # Private REST proxy → business-insights-api (generated)
│   │   #   (no mcp/ — the native MCP Tools Gateway is UI-managed in Apigee, by design)
│   ├── specs/                             # Canonical OpenAPI specs for the REST proxies
│   │   ├── customer-service.yaml
│   │   └── business-insights.yaml
│   ├── scripts/
│   │   ├── deploy_all.sh                  deploy_proxy.sh      package_bundle.sh
│   │   ├── provision_unified_credentials.py / .sh
│   │   ├── provision_business_products.py # Customer Service / Business Insights Tools MCP products
│   │   ├── gen_business_proxies.py        deploy_business_proxies.sh  test_business_apis.sh
│   │   ├── generate_demo_traffic.py       # Synthetic analytics/monetization traffic generator
│   │   ├── test_autorouting.sh            test_token_limit.sh
│   │   └── validate_bundle.py
│   ├── templates/ai-gateway/              # Helm-style policy templates (YAML)
│   └── dist/ai-gateway-v1.zip             # Packaged bundle output
├── docs/
│   ├── apigee_ai_gateway_demo_design.md
│   ├── best_practices_guide.md
│   ├── cloud_run_iap_deployment_guide.md
│   ├── demo_script.md                     # Presenter talk track for the live demo
│   ├── industry_scenario_prompts.md       # Generated: AI-tab prompts per customer-theme industry
│   ├── proxy_architecture_design_plan.md
│   ├── ui_semantic_cache_and_governance_spec.md
│   └── unified_credentials_and_products_reference.md
├── industries/                            # Industry packs: one <id>.json per industry (source of truth)
│   ├── README.md                          # Pack list, slots, add/release steps
│   ├── MAPPING.md                         # Generated: industry → prompts, personas, MCP server, showcase, themes
│   ├── validate.js  sync.js  mapping.mjs  # Rules; copy to services/agents/UI; regenerate MAPPING.md
│   └── mapping/themes.json                # Theme snapshot used by MAPPING.md
├── services/                              # Cloud Run REST backends (one image, SERVICE env var)
│   ├── Dockerfile
│   ├── customer-service.js                # customer-service-api
│   ├── business-insights.js               # business-insights-api (aggregates only)
│   ├── industry-apis.js                   # industry-apis: every pack's mock API + MCP server (/<id>/mcp)
│   ├── packs/                             # <id>.js seed data + handlers; check.js per-pack checker
│   ├── deploy_industry_apis.sh            # Build + deploy industry-apis
│   ├── shared/seed.js                     # Deterministic seed data
│   └── tests/services.test.js
└── ui/                                    # React 18 + Vite 5 + Tailwind demo studio
    ├── Dockerfile                         # node:20-alpine, serves dist/ via server.js
    ├── server.js                          # Production Node server: static + /api/* + reverse proxy
    ├── server/                             # Server-side modules (MUST be COPYed by the Dockerfile)
    │   ├── adminAgentCore.js              # Ask Apigee pure logic: guards, diffs, tool loop
    │   ├── adminAgentService.js           # Ask Apigee Apigee/gateway I/O + /api/admin-agent/*
    │   ├── guardrailCatalog.js            # Guardrail control catalogue loader
    │   ├── themeLibrary.js                # Customer theme library (GCS) + theme agent: /api/themes/*
    │   ├── industryGenerator.js           # Industries the theme agent adds (slots into fixed prompt templates)
    │   ├── reloadHint.js                  # /reload-hint.js: flags a hard refresh (Cmd/Ctrl+Shift+R)
    │   ├── guardrailCatalog.json          # Generated catalogue (read from disk at runtime)
    │   └── generateGuardrailCatalog.js    # Regenerates the JSON from guardrailPolicies.ts
    ├── vite.config.ts                     # Dev server (port 3000) + dev-only /api/* middleware
    ├── index.html                         # <title>AI &amp; Tools Gateway - Live Playground</title>
    ├── package.json
    ├── public/{apigee-color.svg, env-config.js}
    ├── tests/
    │   ├── *.unit.test.mjs                # Offline unit suites (npm test)
    │   ├── gateway-live.test.mjs          # Live integration suite (prod only)
    │   └── adminagent.live.test.mjs       # Live Ask Apigee turn (spends money)
    └── src/
        ├── App.tsx                        # Root app, tab routing, SSO bootstrap
        ├── main.tsx  index.css  vite-env.d.ts
        ├── types/index.ts
        ├── components/                    # 17 components
        │   ├── AdminAgentPanel.tsx        AnalyticsDashboard.tsx ApigeeLogo.tsx
        │   ├── ArchitectureBlueprintModal.tsx  CallLogsModal.tsx  ChatPlayground.tsx
        │   ├── DeveloperOnboardingModal.tsx    DonutPieChart.tsx  GatewaySettingsModal.tsx
        │   ├── GatewayTraceViewer.tsx     GuardrailsPoliciesView.tsx  GuidedTour.tsx
        │   ├── McpPlayground.tsx          McpTraceViewer.tsx    MonetizationManager.tsx
        │   └── Navbar.tsx  ProviderLogos.tsx
        └── services/
            ├── api.ts                     # Management/identity client (/api/me, /api/monetization/*)
            ├── apigeeClient.ts            # AI Gateway REST client
            ├── defaultSettings.ts
            └── mcpClient.ts               # JSON-RPC 2.0 tool protocol client
```

> [!NOTE]
> `ui/nginx.conf.template` and `ui/generate-env.sh` still exist in the tree but are **not referenced
> by [ui/Dockerfile](ui/Dockerfile)** or by any build
> script. They are leftovers from an earlier NGINX-based container and are dead files today.

### UI navigation

[Navbar.tsx](ui/src/components/Navbar.tsx) renders five
primary tabs: **AI Gateway**, **MCP Gateway**, **Analytics & Cost**, **Admin Console** and
**Agent Showcase** (Admin Console is admin-view only, and hosts Developer Wallets, Token Pricing, Rate Plans,
**Guardrails & Policies**, and the docked **Ask Apigee** panel; a **Dev / Prod** toggle shows
the Dev sandbox products (`Engineering and IT Dev`, `Analysts and Knowledge Workers Dev`,
`Customer Support and Sales Dev`) and dev rate card, which
are editable, or the live Prod config, which is **read-only**: saving there explains that prod
changes go through a pull request, and the server refuses prod writes with 403 `prod_read_only`
([consoleEnv.js](ui/server/consoleEnv.js)). **Compare Dev ↔ Prod** ([EnvCompareModal.tsx](ui/src/components/EnvCompareModal.tsx))
lists model, quota, attribute and rate-card differences so Ask Apigee changes can be reviewed before a PR), plus an interactive **Architecture** button that opens
[ArchitectureBlueprintModal.tsx](ui/src/components/ArchitectureBlueprintModal.tsx) — an interactive reference diagram opening on **Solution Overview** — an animated walkthrough ([AgentFlowDiagram.tsx](ui/src/components/AgentFlowDiagram.tsx)) of one agent loop: User → Agent → AI Gateway (policy chips light up) → Vertex AI returns a tool call → Agent → MCP Gateway → REST API (the optional Apigee-hosted MCP → REST step is the MCP Gateway's last step, highlighted in amber, so only the REST API sits outside; Self-hosted MCP and 3rd-party MCP drawn alongside with BigQuery, Salesforce, SAP and Jira logos; Other models shown as Anthropic, Amazon Bedrock, OpenAI, DeepSeek and self-hosted logos next to Gemini; logos are Simple Icons paths in brandLogos.ts) → tool result back through the AI Gateway → final answer to the user, with play/pause/step/speed controls, reduced-motion support, and AI Gateway / MCP Gateway boxes that drill down, alongside **AI Gateway Flow** and **MCP Tools Flow** with clickable policy XML inspection and live trace status correlation. Additionally, every tested request in `ChatPlayground` (`Target URL:`) and `McpTraceViewer` (`JSON-RPC 2.0`) includes a **`Request Flow`** button that opens the modal in **`⚡ Tested Request Flow`** mode, dynamically short-circuiting the pipeline diagram at the exact stopping policy (e.g., red perimeter block at Prompt Sanitization or green short-circuit at Semantic Cache HIT; the "why it stopped" explanation renders as a white callout next to the stopped step, not as another step) and omitting bypassed downstream stages. The underlying `AppTab` union in
[types/index.ts](ui/src/types/index.ts#L131) also carries
`kvm-pricing` and `rate-cards`, which render inside the Admin Console surface.

**Analytics & Cost** has a **Prod / Dev** environment toggle (dev analytics is enabled) next to
the 24H/7D/30D range, and two sections:

- **AI Gateway**: model traffic from [AnalyticsDashboard.tsx](ui/src/components/AnalyticsDashboard.tsx).
  The Smart Routing audit badge reads **"Saved up to $X"**: real prompt/completion tokens priced at
  the most expensive model on the env's rate card, minus actual cost
  ([routingSavings.js](ui/src/utils/routingSavings.js)).
- **Tools Gateway**: MCP traffic from [ToolsAnalytics.tsx](ui/src/components/ToolsAnalytics.tsx) via
  `/api/analytics/tools-stats` ([toolsAnalytics.js](ui/server/toolsAnalytics.js)): tool calls, allowed /
  denied (401/403) / rejected (400) / throttled (429), latency, per tool server
  (`mcp`, `bigquery-mcp`, `servicenow-mcp`) and per caller. Admins get the same **user filter** as
  AI Gateway (real users via `developer_email`; Sales/Loans shown as personas); the choice is shared
  between both sections. **Tools Used** and **Tool Call Logs** come from `/api/logs/tools`
  ([toolLogs.js](ui/server/toolLogs.js)), which reads the MCP proxies' ML-CloudLogging entries in
  Cloud Logging and parses the JSON-RPC bodies into per-tool counts, errors, latency and an expandable
  request/response log. Those log entries carry no caller today, so with a user filter selected they
  are shown as "unattributed" until the proxies log `developer.app.name` / `developer.email`.

### Customer themes

The palette button (bottom right) opens **Customer theme**
([ThemeStudioModal.tsx](ui/src/components/ThemeStudioModal.tsx)). A theme re-skins the app for the
audience in the room: the customer logo replaces the top-left logo (the Apigee logo stays above the
AI Gateway), brand colours drive the blue/indigo/purple and cyan/teal Tailwind families through CSS
variables (status emerald/amber/rose stay fixed), the font is loaded from Google Fonts, and the
**industry** renames the personas and swaps the AI-tab scenario prompts
([industry_scenario_prompts.md](docs/industry_scenario_prompts.md)). Access, models and quotas are
unchanged; scenarios never name the customer. Logic lives in
[customerTheme.js](ui/src/utils/customerTheme.js) and
[themePalette.js](ui/src/utils/themePalette.js). `?customer=<id>` applies a theme,
`?customize=open` opens the panel.

- **Apigee (default)**: only its industry can be changed. The choice is kept in the browser across
  reloads and resets to Generic on a hard refresh (Cmd/Ctrl+Shift+R, detected by
  [reloadHint.js](ui/server/reloadHint.js)).
- **Brand header**: a theme can also carry a **full logo** with the company name (`wordmarkUrl`,
  shown top-left at 1280 px and wider, the square logo below that and as the favicon) and a
  **header bar colour** (`headerBg`, e.g. ICICI orange, Axis maroon; empty = white), with the
  full logo optionally **shown in white** on a dark bar (`wordmarkWhite`). With either one set, a
  3 px **brand stripe** in one colour (primary, or accent if the primary blends into the bar) runs along the bottom of the header, like the blue band
  under HPCL's site header. The menu buttons keep their light fill so they read on any bar;
  on a coloured bar the square logo sits on a small white plate. See `brandHeader()` in
  [customerTheme.js](ui/src/utils/customerTheme.js).
- **Customer library**: shared themes in the private bucket `gs://your-gcp-project-customer-themes`
  (`themes/<id>.json`, `logos/<id>`, `wordmarks/<id>`, `industries/<id>.json`), served by
  [themeLibrary.js](ui/server/themeLibrary.js): `GET /api/themes` (themes and added industries),
  `POST /api/themes/requests`, `PUT /api/themes/<id>`, `GET /api/themes/logo/<id>`,
  `GET /api/themes/wordmark/<id>`.
  Presenters can add and edit, not remove. Requesting an existing customer returns 409 `exists`;
  an edit must send the `updatedAt` it started from (`baseUpdatedAt`), else 409 `stale`.
- **Request a theme** (name and website required; logo and industry optional) runs the theme agent:
  1. **Reads the customer's homepage** (and up to 3 same-site stylesheets; public hosts only, 6 s
     and size caps): `meta theme-color`, the most used non-grey colours, the fonts it loads, its
     icon links (including inline `data:image/svg+xml` favicons), its header `<img>` logos, and the
     **header bar background** from CSS rules for `header` / `nav` / `.header…` / `.navbar…`
     (`var(--x)` resolved, Tailwind `--tw-*` from the rule's fallback, gradients read at their
     midpoint; overlay / backdrop / drawer / menu / button rules skipped).
  2. **Asks Gemini through the prod AI Gateway** with the caller's admin key (so the call shows in
     Analytics), Google Search grounded first, with the site evidence in the prompt. Colours the
     site does not use are replaced by the site's own; a site font on the font list wins.
  3. **Industry**: the presenter's pick, else the agent's pick from the built-in and added
     industries. If none fits, the agent **adds the industry** to the library
     (`industries/<id>.json`, reused by later customers in the same industry): the model fills
     short slots (a portfolio, a platform, two security controls, ...) that go into fixed templates
     in [industryGenerator.js](ui/server/industryGenerator.js), so every scenario prompt keeps the
     shape its outcome depends on (router category, cache similarity, token size, Model Armor
     block). Added industries show as "(added by agent)" in the pickers; at most 60 are added.
  4. **Full logo**: the first header logo that is at least 2:1 wide and sharp (SVG, or 32 px+
     tall). If there is none (the site blocks bots, e.g. BookMyShow), or it is a white logo with
     no dark header bar on the site (ICICI Lombard), the agent uses the **official logo from
     Wikipedia** (the company article's infobox `logo`) or else the best-named `<name> logo` file
     on **Wikimedia Commons** (`fetchReferenceLogo`, descriptive User-Agent per Wikimedia policy).
     **Header bar**: the site's header colour when it is not white; when the CSS shows no
     header at all (JS-rendered sites such as Axis and Ayala Land), Gemini's grounded
     `headerBackground` if it is a dark bar (on a site the agent could not read at all, only when
     there is no dark full logo, so BookMyShow stays white); a white full logo with no such colour
     gets the primary behind it. A dark full logo on a dark bar is **shown in white**
     (`wordmarkWhite`), as the customer's own site does (`chooseHeaderBg`, `wantsWhiteWordmark`,
     using the logo's pixel/fill lightness).
  5. **Logo** (square, also the favicon): uploaded file, else the page's icon links (Apple touch
     icon, SVG, large PNG; wide or near-white images only as a last resort), else
     `/apple-touch-icon.png`, else Google's favicon service; a square Wikipedia/Commons logo beats
     a last-resort image.
  6. Saves to the bucket only if the id is new.

### First-run developer onboarding

The UI **no longer auto-creates** Apigee developers on sign-in. `provisionUserDeveloperAndApp` is
called from `/api/me` with [`allowCreate: false`](ui/server.js#L743),
so when the Management API returns 404 for the signed-in email the server responds with
[`needsOnboarding: true`](ui/server.js#L355-L360) plus a
suggested first/last name derived from the identity token, and creates nothing.

`App.tsx` reacts to that flag by rendering
[DeveloperOnboardingModal.tsx](ui/src/components/DeveloperOnboardingModal.tsx),
which pre-fills the suggested names, requires a non-empty first name, trims both fields, and falls
back to `lastName = firstName` when only one name is given. Submitting `POST`s to
[`/api/me/onboard`](ui/server.js#L774-L853), which
re-runs the same provisioning routine with `allowCreate: true` and the user-validated names. That
single call provisions:

| Step | Result |
| :--- | :--- |
| Developer | Created in org `your-gcp-project` with the confirmed first/last name |
| Developer app | `Unified Admin <username> App`, with its consumer key returned to the client |
| Monetization config | `billingType: PREPAID` (set or corrected) |
| Wallet | **$20.00 USD** starting balance, credited once (skipped if a balance or prior credit exists) |
| Subscriptions | `Engineering and IT PayAsYouGo` rate plan (the primary admin account, `admin@example.com`, is subscribed to all three persona products) |

The response echoes `needsOnboarding: false` along with the new keys, so the UI can dismiss the
modal and continue without a reload.

### Balance display precision

Wallet and consumption figures render to **2 decimal places** with the exact **6-decimal** value in
a hover tooltip — see the `Exact balance: $…` / `Exact consumed: $…` `title` attributes in
[MonetizationManager.tsx](ui/src/components/MonetizationManager.tsx#L788-L809).
This matters because a single gateway call is priced in micro-dollars: a 2dp display alone would
show `$0.00` for real traffic, while 6dp everywhere is unreadable in summary tiles.

---

## 🛠️ Local Development & Setup

### Prerequisites

- **Node.js** v20+ and **npm**
- **Python** 3.10+ (only for the `agents/` ADK service)
- **gcloud CLI** authenticated against GCP project `your-gcp-project` — the dev server shells out to
  `gcloud auth print-access-token` and `gcloud auth print-identity-token` for Management API and
  SSO simulation

### npm scripts

All scripts live in [ui/package.json](ui/package.json#L6-L15):

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `vite` | Dev server with live `/api/*` middleware |
| `npm run build` | `tsc && vite build` | Type-check then emit `dist/` |
| `npm run preview` | `vite preview` | Preview the built bundle |
| `npm test` | `node --test` over the offline `tests/*.unit.test.mjs` suites | Full offline unit set (incl. guardrail catalog + Ask Apigee) |
| `npm run test:unit` | same file list as `npm test` | Alias of `npm test` |
| `npm run test:autorouting` / `test:cost` / `test:products` / `test:monetization` / `test:bundle` | single suite | Run one offline suite |
| `npm run test:admin-agent` | `adminagent` + `adminagentroutes` unit suites | Ask Apigee only, offline |
| `npm run test:admin-agent:live` | `node --test tests/adminagent.live.test.mjs` | Real metered Ask Apigee turn (spends money) |
| `npm run test:live` | `TEST_ALLOW_PROD=1 node --env-file=.env --test tests/gateway-live.test.mjs` | Live gateway suite — **prod only** |
| `npm run test:live:prod` | identical to `test:live` | Alias |
| `npm run test:all` | unit set `&&` `test:live` | Everything |
| `npm run gen:guardrail-catalog` | `node server/generateGuardrailCatalog.js` | Regenerate `server/guardrailCatalog.json` |
| `npm run docs:presets` | `node scripts/generate_scenario_presets_doc.mjs` | Regenerate the scenario presets doc |

### Running the UI playground locally

```bash
cd ui
npm install
npm run dev
```

The Vite dev server listens on **`http://localhost:3000`** — the port is pinned in
[vite.config.ts](ui/vite.config.ts#L1590-L1591).

[vite.config.ts](ui/vite.config.ts) registers dev-only
middleware that mirrors the production endpoints (`/api/me`, `/api/kvm/rates`,
`/api/monetization/{balance,credit,rateplans,subscriptions,config,attributions}`,
`/api/analytics/fleet-stats`, `/api/products`, `/api/products/reset`, `/api/demo/reset`, and `/api/admin-agent/*` —
the last mounts the same `server/adminAgentService.js` as `server.js`) plus HTTP proxies for
`/api/ai-dev`, `/api/ai-prod`, `/api/mcp-dev`, and `/api/mcp-prod`. `/api/logs/calls` is currently
served by `server.js` only.

Build the production bundle (required before a container build — the Dockerfile copies `dist/`,
it does not build it):

```bash
npm run build
```

### Environment configuration

Copy [ui/.env.example](ui/.env.example) to `ui/.env`:

```bash
cp .env.example .env
```

Recognised keys: `VITE_DEFAULT_ENV`, `VITE_ADMIN_API_KEY`, `VITE_ADMIN_USER_EMAIL`,
`VITE_SALES_API_KEY`, `VITE_SALES_AGENT_EMAIL`, `VITE_LOANS_API_KEY`, `VITE_LOANS_AGENT_EMAIL`,
`VITE_SSO_USER_EMAIL` (also the developer whose admin key Ask Apigee uses). A `.env` file is
**mandatory** for `npm run test:live`, which is invoked with `node --env-file=.env`.

> [!IMPORTANT]
> `npm run test:live` targets **prod only** (the script sets `TEST_ALLOW_PROD=1`); there is no
> `TEST_ENV` switch. `dev` is a shared sandbox people edit directly, so it is never used for
> automated verification. Validate with `npm test` + `npm run build`, deploy, then run
> `npm run test:live` against prod. It burns prod quota and budget and seeds the prod semantic cache.

---

## 🧪 Test Suites

Suites live in [ui/tests/](ui/tests). `npm test`
(= `npm run test:unit`) runs every offline unit suite listed in `package.json` — auto-routing, cost,
intent labels, cache analytics/attribution, products, monetization sorting, guardrail catalog,
Apigee proxy-bundle integrity, the token-quota threshold signal (`tokenquota`), and
Ask Apigee (`adminagent` + `adminagentroutes`, which spawns `server.js` on port 5473 and
checks `vite.config.ts` parity), and the MCP tab / chat UI (`mcpplayground`: tool-form defaults,
coercion and blank pruning, per-persona *Try a task* flows vs the preset catalog, the scenario
bar step picker, Markdown + code highlighting and raw-HTML escaping, and the demo data reset).
No credentials needed. `npm run test:mcp` runs the last one alone.

UI logic the tests cover lives in plain `.js` modules with `.d.ts` types
([ui/src/utils/](ui/src/utils): `mcpArgs`, `mcpFlows`, `scenarioStepMenu`, `markdownConfig`),
because `node --test` cannot import the app's `.ts` files. Put new testable logic there and add
new suite files to the `test` / `test:unit` scripts in `package.json` (they list files explicitly).

| Suite | File | Command | Network |
| :--- | :--- | :--- | :--- |
| Offline unit set | `tests/*.unit.test.mjs` | `npm test` | Offline |
| Live gateway integration | [gateway-live.test.mjs](ui/tests/gateway-live.test.mjs) | `npm run test:live` | Live Apigee (prod) |
| Ask Apigee live | `adminagent.live.test.mjs` | `npm run test:admin-agent:live` | Live: agent turn on the prod gateway, `run_dev_test` on the dev gateway |

The live suite is organised into four describe blocks:

1. Local Auth & Identity Endpoint (`/api/me`)
2. Apigee AI Gateway — Live Vertex AI (Gemini)
3. Apigee Tools Gateway — Live MCP Backend (`tools/list` with the Customer Service / Business
   Insights tools, per-persona filtering, `getOrderStatus` `ORD-1042`, `getSupportMetrics`, 401 on
   a tool outside the product, 403 `REFUND_LIMIT`)
4. Apigee AI Gateway — Intelligent Auto-Routing (`/auto`)

It first probes `http://localhost:3000/api/me`; if the dev server is up it routes through the local
proxy and harvests API keys from the `/api/me` response, otherwise it falls back to calling
`https://api.example.com` directly. It also retries HTTP 429 responses with
backoff, since the `claude-haiku-5-5` quota demo is deliberately tight.

**The result depends on which target it picked**, so the suite prints a provenance banner naming the
target, the JWT identity, and the source of each API key before any test runs:

| Target | Result |
| :--- | :--- |
| Local proxy (`node server.js` on `:3000`) | **24 pass, 0 fail, 0 skipped** |
| Direct Apigee (no local server) | **20 pass, 0 fail, 4 skipped** |

The 4 skips are the tests that can only run against the local proxy — the two `/api/me` checks, the
proxy route check, and the SSO-token test, which cannot obtain a token without `/api/me`. They are
not upstream or provisioning failures.

When keys are not supplied via `.env` or `/api/me` the suite discovers them from Apigee with
`gcloud`. Two separate developers are involved, and they are selected independently:

| Variable | Default | Selects |
| :--- | :--- | :--- |
| `APIGEE_ORG` | `your-gcp-project` | Org queried for apps and keys |
| `APIGEE_DEVELOPER` | `VITE_SSO_USER_EMAIL` | Developer owning the **admin** app → `ADMIN_KEY` |
| `APIGEE_PERSONA_DEVELOPER` | `persona.owner@example.com` | Developer owning the **sales/loans** apps (MCP personas only) |

> [!IMPORTANT]
> The admin key must belong to the same developer as the JWT identity. The AI Gateway attributes LLM
> token quota to the JWT email (`flow.emailId`) but developer budget to the key's developer
> (`verifyapikey.VA-VerifyAPIKey.developer.id`). If they diverge, the suite still passes while
> measuring two different subjects. A duplicate admin app exists under `persona.owner@example.com`, so
> the banner prints a `!!` warning whenever the discovered admin key's developer is not the JWT
> identity. The sales/loans divergence is expected — those personas exist only for the MCP Gateway
> demo and are deliberately owned by a different developer.

```bash
cd ui
npm run test:unit    # offline, no credentials needed (same as npm test)
npm run test:live    # PROD only; requires ui/.env and gcloud auth — run after a deploy
npm run test:all
```

---

## ☁️ Deployment

### Deployed Cloud Run configuration

| Setting | Value |
| :--- | :--- |
| Service | `apigee-ai-gateway-ui` |
| Region / platform | `asia-southeast1` / managed |
| Project | `your-gcp-project` (number `PROJECT_NUMBER`) |
| Image | `asia-southeast1-docker.pkg.dev/your-gcp-project/cloud-run-source-deploy/apigee-ai-gateway-ui:<git-sha>` (the same image is also tagged `:latest`) |
| Container port | `8080` |
| Base image | `node:20-alpine`, `CMD ["node", "server.js"]` |
| Service account | `apigee-ui-mgmt-sa@your-gcp-project.iam.gserviceaccount.com` (also `roles/run.invoker` on `customer-service-api` for the demo data reset) |
| Ingress | `internal-and-cloud-load-balancing` |
| Auth | `--no-allow-unauthenticated` (IAP-fronted) |
| Resources | 1000m CPU, 512Mi memory, concurrency 80, max scale 100, min scale 0 |
| Labels | `git-sha=<short sha>`: the commit the live revision was built from |

### Build and deploy

Use [deploy_prod.sh](ui/scripts/deploy_prod.sh) from a clean, committed tree (normally `main`):

```bash
ui/scripts/deploy_prod.sh <change-name>     # e.g. ui/scripts/deploy_prod.sh demo-reset
```

It:

1. Refuses to run with uncommitted changes, so the image tag always matches a commit
   (`ALLOW_DIRTY=1` overrides and tags `<sha>-dirty`).
2. Tags the commit prod runs now as `prod-YYYY-MM-DD-pre-<change-name>` (the rollback point, read
   from the live revision's `git-sha` label; pass `LIVE_SHA=<commit>` for revisions deployed
   before the label existed) and pushes the tag.
3. Runs `npm run build` and `npm test`.
4. Builds `apigee-ai-gateway-ui:<sha>` with Cloud Build and adds `:latest` to the same image.
5. Deploys `:<sha>` with the full security flag set and the `git-sha` label.
6. Resets the demo data, runs `npm run test:live` (`SKIP_LIVE=1` skips it), then resets again.

Find what is live, and roll back:

```bash
gcloud run services describe apigee-ai-gateway-ui --region asia-southeast1 --project your-gcp-project \
  --format='value(status.latestReadyRevisionName,spec.template.metadata.labels.git-sha)'
# Roll back to an earlier revision (instant, no rebuild)
gcloud run services update-traffic apigee-ai-gateway-ui --to-revisions=<revision>=100 \
  --region asia-southeast1 --project your-gcp-project
```

The manual equivalent of steps 3–5:

```bash
cd ui && npm run build && npm test          # the Dockerfile copies dist/, it does not build it
SHA=$(git rev-parse --short=7 HEAD)
IMG=asia-southeast1-docker.pkg.dev/your-gcp-project/cloud-run-source-deploy/apigee-ai-gateway-ui
gcloud builds submit --tag $IMG:$SHA --project=your-gcp-project .
gcloud artifacts docker tags add $IMG:$SHA $IMG:latest
gcloud run deploy apigee-ai-gateway-ui \
  --image=$IMG:$SHA \
  --region=asia-southeast1 \
  --platform=managed \
  --no-allow-unauthenticated \
  --ingress=internal-and-cloud-load-balancing \
  --service-account=apigee-ui-mgmt-sa@your-gcp-project.iam.gserviceaccount.com \
  --update-labels=git-sha=$SHA \
  --project=your-gcp-project
```

Full load balancer, IAP, DNS and troubleshooting detail lives in
[cloud_run_iap_deployment_guide.md](docs/cloud_run_iap_deployment_guide.md).

### Daily pricing & model watch

[services/model-watch](services/model-watch) is a Cloud Run job that Cloud Scheduler runs every day
at 07:00 (Asia/Singapore). It reads the
[Vertex AI pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing) page
(authoritative, since the gateway calls Vertex), the
[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) page (cross-check) and the
[Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog), and writes
`gs://<bucket>/model-watch/latest.json`.

The Admin Console shows a **Pricing & model watch** alert built from that report and the live
`ai-model-rates` card ([server/modelWatch.js](ui/server/modelWatch.js)):

| Finding | Example |
| :--- | :--- |
| Rate-card drift | Card says `gemini-3.1-pro-preview` 1.25 / 5.00; Vertex lists 2.00 / 12.00 |
| Deprecation of a model in use, with its replacement | `gemini-3.5-flash` deprecated → `gemini-3.6-flash` |
| Scheduled price change | `gemini-3.8-flash` 0.75 / 3.75 → 1.50 / 7.50 from 2027-01-01 |
| New model not in the card | `gemini-3.6-flash` |
| Any price change on the Vertex AI page, all models (last 30 days) | Grok, Llama, Mistral, DeepSeek, Imagen, Veo, embeddings, tuning, caching, Priority/Flex tiers: ~1,700 prices across ~170 models |
| Watcher health | A page failed to load or its layout changed (never reported as "no change") |

Fixes go through a pull request: **Copy & open PR** copies the corrected rate card and opens the
GitHub editor for `apigee/config/model_rate_card.json` (set `MODEL_WATCH_GITHUB_REPO=owner/repo`).
After merging, publish with `apigee/scripts/sync_rate_card.sh`. **Check now** runs the job on demand.

```bash
services/model-watch/deploy.sh                 # SA, job, scheduler, IAM, first run (idempotent)
python3 services/model-watch/watch.py --dry-run   # local check, writes nothing
python3 -m unittest discover -s services/model-watch
```

### Deploying the Apigee proxies

Bundle packaging, validation and deployment are scripted in
[apigee/scripts/](apigee/scripts):
`package_bundle.sh`, `validate_bundle.py`, `deploy_proxy.sh`, `deploy_all.sh`, plus
`provision_unified_credentials.{sh,py}` for developer/app/product provisioning,
`generate_demo_traffic.py` for seeding demo analytics, and
`test_autorouting.sh` / `test_token_limit.sh` for shell-based smoke tests.
`deploy_proxy.sh --proxy mcp` is refused (exit 1): the `mcp` proxy is managed in the Apigee UI.

[apihub_catalog.py](apigee/scripts/apihub_catalog.py) curates the
**API hub** catalog (`your-gcp-project`, `asia-southeast1`). It creates the Business Unit and Team
values under **Settings → Attributes**, then fills in each synced proxy's BU, team, owner
(mocked as `<team>@example.com`), style (REST / MCP / WebSocket / GraphQL), service type
(**Model** for the LLM proxies, **Code** otherwise), maturity, target users, description and
version lifecycle. It never overwrites a description, owner or lifecycle that is already set. It
can be re-run safely. Every `industries/*.json` pack is included automatically, and
`provision_industry_pack.py` runs it for a new pack's `<id>-mcp`. A new proxy only appears in
API hub after the Apigee plugin's 6-hourly sync, so re-run it after the next sync if the first run
reports the proxy as not synced yet. See
[industries/README.md](industries/README.md#api-hub) for the optional `apihub` block. To add a
non-industry proxy, add it to `CATALOG` in the script.

```bash
python3 apigee/scripts/apihub_catalog.py --dry-run                    # preview the whole catalog
python3 apigee/scripts/apihub_catalog.py                              # apply to every API
python3 apigee/scripts/apihub_catalog.py --only banking-mcp          # one API (exit 1 + next sync time if not synced yet)
```

[generate_demo_traffic.py](apigee/scripts/generate_demo_traffic.py)
populates Apigee Analytics and Monetization with realistic traffic ahead of a demo. It discovers
every active developer and their approved keys through the Management API via `gcloud`
(auto-provisioning a `Unified Admin <username> App` for any developer without one), fans live
requests across `/auto`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview` and the other catalog models,
then applies immediate micro-dollar wallet adjustments so prepaid balances reflect the consumption
straight away. No consumer key is ever hardcoded.

```bash
python3 apigee/scripts/generate_demo_traffic.py --requests-per-user 3
```

[test_autorouting.sh](apigee/scripts/test_autorouting.sh)
runs the offline unit suite and, when `ui/.env` exists, the live suite.

[test_token_limit.sh](apigee/scripts/test_token_limit.sh)
exercises the 300 tokens/min demo cap against `/models/claude-haiku-5-5:generateContent` with
the same 4 steps as the UI demo (stateless, `maxOutputTokens: 90`), under a fresh per-run email so
it starts from an empty window. It asserts each status and the `x-gateway-token-quota-status`
header: 200 `ok` → 200 `near-threshold` → 200 `exhausted` → **HTTP 429**. No consumer key is
committed to the repo, so `API_KEY` is a **required** environment variable: the script prints
`ERROR: API_KEY is not set.` and exits `1` if it is missing. `BASE_URL` and `USER_EMAIL` are
optional overrides, and `-v` enables `set -x` tracing.

```bash
export API_KEY=<consumer key>
./apigee/scripts/test_token_limit.sh
```

---

## 📄 License

This repository is licensed under the Apache 2.0 License.
