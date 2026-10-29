# Unified Credentials, API Products, Monetization & Demo Walkthrough

> **Apigee org**: `your-gcp-project` · **Environment**: `prod`
> **Default developer**: `admin@example.com` — used by the provisioning scripts, the
> prepaid wallet and every `?dev=` parameter. The `Unified Sales App` / `Unified Loans App`
> keys are looked up under `persona.owner@example.com` first (see [§4](#4-developer-apps)).

Base paths come from each proxy's `HTTPProxyConnection`:

| Gateway | Bundle | `BasePath` | Public URL |
| --- | --- | --- | --- |
| AI Gateway | `ai-gateway-v1` | `/ai/v1` | `https://api.example.com/ai/v1` |
| LLM Passthrough *(Agent Showcase baseline: key check, analytics and logs only; no governance)* | `llm-passthrough-v1` | `/passthrough/v1` | `https://api.example.com/passthrough/v1/models/gemini-*:generateContent` |
| Tools Gateway (MCP) | `mcp` *(UI-managed; source not in this repo)* | `/mcp` | `https://api.example.com/mcp` |
| OAuth PRM (MCP) | `mcp` *(UI-managed)* | `/.well-known/oauth-protected-resource/mcp` | same host |
| BigQuery MCP | `bigquery-mcp` | `/bigquery/mcp` | `https://api.example.com/bigquery/mcp` |
| ServiceNow MCP | `servicenow-mcp` | `/servicenow/mcp` | `https://api.example.com/servicenow/mcp` |
| Customer Service REST *(private — MCP server only)* | `customer-service-v1` | `/customer-service/v1` | same host; **403** `NOT_INTERNAL` for direct calls |
| Business Insights REST *(private — MCP server only)* | `business-insights-v1` | `/business-insights/v1` | same host; **403** `NOT_INTERNAL` for direct calls |

Source: [default.xml#L272-L275](../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L272-L275),
[bigquery-mcp/default.xml](../apigee/proxies/bigquery-mcp/apiproxy/proxies/default.xml#L4),
[servicenow-mcp/default.xml](../apigee/proxies/servicenow-mcp/apiproxy/proxies/default.xml#L4).

The `mcp` proxy used by the Customer Service / Business Insights / Enterprise Tools products
is created, edited and deployed in the Apigee UI; its source is not in this repo. Deploying a
repo bundle over it overwrites the UI configuration, so
[deploy_proxy.sh](../apigee/scripts/deploy_proxy.sh)
refuses `--proxy mcp`.

---

## 1. Architecture Overview

Two governed capabilities share a single credential per persona:

1. **AI Gateway** (`ai-gateway-v1` at `/ai/v1`) — model-agnostic routing
   (`/models/{model}:generateContent` and `/auto`),
   identity attribution, Model Armor, semantic caching, LLM token quotas,
   prepaid-wallet monetization.
2. **Tools Gateways** (MCP JSON-RPC 2.0 with tool-level RBAC and per-operation
   quotas): `mcp` at `/mcp` (Customer Service / Business Insights tools; managed in the Apigee UI),
   `bigquery-mcp` at `/bigquery/mcp` and `servicenow-mcp` at `/servicenow/mcp` (repo-managed;
   both enforce a JSON-RPC method allowlist via `RF-MethodNotAllowed` — see [§2.7](#27-mcp-products--per-operation-call-quotas)).

### The unified single-key pattern

A persona holds **one** API key, sent as the `x-apikey` request header
([VA-VerifyAPIKey.xml](../apigee/proxies/ai-gateway-v1/apiproxy/policies/VA-VerifyAPIKey.xml)).
The developer app behind that key is bound to both an AI product and an MCP tools
product, so the same key is authorised differently depending on which gateway it hits.

```mermaid
flowchart TD
    subgraph Personas ["Personas (UI persona dropdown)"]
        Admin["Engineering & IT — dynamic per-SSO-user app"]
        Sales["Customer Support & Sales — Unified Sales App"]
        Loans["Analysts & Knowledge Workers — Unified Loans App"]
    end

    subgraph Products ["API Products (apigee/products/)"]
        EngTier["Engineering and IT (llmOperationGroup)"]
        AnaTier["Analysts and Knowledge Workers (llmOperationGroup)"]
        SupTier["Customer Support and Sales (llmOperationGroup)"]
        CsMCP["Customer Service Tools MCP (payloadOperationGroup)"]
        BiMCP["Business Insights Tools MCP (payloadOperationGroup)"]
        EntMCP["Enterprise Tools MCP (payloadOperationGroup)"]
    end

    subgraph Gateways ["Apigee Gateways"]
        AIGateway["ai-gateway-v1 (/ai/v1)"]
        MCPGateway["mcp (/mcp, UI-managed)"]
        BQGateway["bigquery-mcp (/bigquery/mcp)"]
        SNGateway["servicenow-mcp (/servicenow/mcp)"]
    end

    subgraph Rest ["Private REST APIs (Cloud Run)"]
        CSProxy["customer-service-v1 (/customer-service/v1)"]
        BIProxy["business-insights-v1 (/business-insights/v1)"]
    end

    Admin --> EngTier & EntMCP
    Sales --> SupTier & CsMCP
    Loans --> AnaTier & BiMCP

    EngTier & AnaTier & SupTier --> AIGateway
    EntMCP & CsMCP & BiMCP --> MCPGateway
    EntMCP --> BQGateway & SNGateway
    MCPGateway -- "JSON-RPC to REST" --> CSProxy & BIProxy
```

---

## 2. API Products Catalog

Product definitions live in
[apigee/products/](../apigee/products).

> [!IMPORTANT]
> **No product uses the classic top-level `quota` field.** The three persona AI products use
> `llmOperationGroup.operationConfigs[].llmTokenQuota` (token-based, per model).
> The five MCP products use `payloadOperationGroup.operationConfigs[].quota`
> (call-count based, per JSON-RPC operation).

| File | `name` | Group type | `apiSource` | Attributes |
| --- | --- | --- | --- | --- |
| [engineering_and_it.json](../apigee/products/engineering_and_it.json) | Engineering and IT | `llmOperationGroup` | `ai-gateway-v1` | `access=private`, `persona=Engineering & IT`, `developer.budget.limit=20000000` ($20/mo), `.interval=1`, `.timeunit=month`, `routing.model.coding=claude-opus-5-5`, `routing.model.deep_reasoning=gemini-3.1-pro-preview`, `routing.model.simple=gemini-3.5-flash-lite`, `routing.model.general=gemini-3.6-flash` |
| [analysts_and_knowledge_workers.json](../apigee/products/analysts_and_knowledge_workers.json) | Analysts and Knowledge Workers | `llmOperationGroup` | `ai-gateway-v1` | `access=private`, `persona=Analysts & Knowledge Workers`, `developer.budget.limit=10000000` ($10/mo), `.interval=1`, `.timeunit=month`, `routing.model.{coding,deep_reasoning}=gemini-3.1-pro-preview`, `routing.model.simple=gemini-3.5-flash-lite`, `routing.model.general=gemini-3.6-flash` |
| [customer_support_and_sales.json](../apigee/products/customer_support_and_sales.json) | Customer Support and Sales | `llmOperationGroup` | `ai-gateway-v1` | `access=private`, `persona=Customer Support & Sales`, `developer.budget.limit=5000000` ($5/mo), `.interval=1`, `.timeunit=month`, `routing.model.coding=claude-haiku-5-5`, `routing.model.deep_reasoning=gemini-3.1-pro-preview`, `routing.model.general=gemini-3.6-flash`, `routing.model.simple=gemini-3.5-flash-lite` |
| [customer_service_tools_mcp.json](../apigee/products/customer_service_tools_mcp.json) | Customer Service Tools MCP | `payloadOperationGroup` | `mcp` | `access=private` |
| [business_insights_tools_mcp.json](../apigee/products/business_insights_tools_mcp.json) | Business Insights Tools MCP | `payloadOperationGroup` | `mcp` | `access=private` |
| [enterprise_tools_mcp.json](../apigee/products/enterprise_tools_mcp.json) | Enterprise Tools MCP | `payloadOperationGroup` | `mcp`, `bigquery-mcp`, `servicenow-mcp` | `access=private` |
| [bigquery_tools_mcp.json](../apigee/products/bigquery_tools_mcp.json) | BigQuery Tools MCP | `payloadOperationGroup` | `bigquery-mcp` | `access=private` |
| [servicenow_tools_mcp.json](../apigee/products/servicenow_tools_mcp.json) | ServiceNow Tools MCP | `payloadOperationGroup` | `servicenow-mcp` | `access=private` |
| [llm_passthrough.json](../apigee/products/llm_passthrough.json) | LLM Passthrough | `operationGroup` (`POST /models/**`) | `llm-passthrough-v1` | `access=private`; on every Unified Admin app (`ADMIN_APP_PRODUCTS`); no quota, budget or rate plan |

Products carry no `tier` or `domain` attributes. Auto-routing reads the `routing.model.*`
attributes ([§5](#auto-routing-decisions)); MCP tool access comes from the credential's
product grants.

All products declare `approvalType: auto`. The five MCP products are bound to
`environments: ["dev", "prod"]`. The three persona AI products are bound to
**`["prod"]` only**. Ask Apigee edits a separate Dev clone of each
(`<name> Dev`, displayName `<displayName> (Dev)`, bound to `["dev"]`); changes there do not
affect what a prod key is entitled to.

> [!NOTE]
> Apigee product **names** cannot contain `&` or parentheses (`Invalid API product name`,
> HTTP 400), so the names spell out "and". The UI shows the `displayName` / `persona`
> attribute ("Engineering & IT").

### 2.1 Engineering & IT — per-model token quotas

**8 `operationConfigs` covering 7 distinct models** (`auto` has two: the exact `/auto`
and `/auto:*` for `/auto:generateContent`; see [§2.4](#24-resource-patterns-and-glob-semantics)). Every `operationConfig` carries exactly **one** `llmOperation` and its own
`llmTokenQuota`; the Management API rejects more with
`Operations must contain exactly one entity`, and rejects a config with none at all with
`Operations must contain exactly one entity but found 0 entities`. Every operation is
`apiSource: ai-gateway-v1`, method `POST`.

| # | Resource | `model` | Token limit | Interval |
| --- | --- | --- | --- | --- |
| 1 | `/auto` | `auto` | 100000 | 1 minute |
| 2 | `/auto:*` | `auto` | 100000 | 1 minute |
| 3 | `/models/gemini-3.5-flash-lite:*` | `gemini-3.5-flash-lite` | 10000 | 1 minute |
| 4 | `/models/gemini-3.6-flash:*` | `gemini-3.6-flash` | 10000 | 1 minute |
| 5 | `/models/gemini-3.1-pro-preview:*` | `gemini-3.1-pro-preview` | 10000 | 1 minute |
| 6 | **`/models/claude-haiku-5-5:*`** | `claude-haiku-5-5` | **300** | 1 minute |
| 7 | `/models/claude-opus-5-5:*` | `claude-opus-5-5` | 10000 | 1 minute |
| 8 | `/models/gemini-3.8-flash:*` | `gemini-3.8-flash` | 10000 | 1 minute |

Source: [engineering_and_it.json](../apigee/products/engineering_and_it.json).
Engineering & IT is entitled to **every** model and is the only persona with Opus. It is the
AI product on every per-SSO-user `Unified Admin <handle> App`.

### 2.2 Analysts & Knowledge Workers — per-model token quotas

**6 `operationConfigs` covering 5 distinct models**. Same shape: one `llmOperation` per
`operationConfig`, `apiSource: ai-gateway-v1`, method `POST`.

| # | Resource | `model` | Token limit | Interval |
| --- | --- | --- | --- | --- |
| 1 | `/auto` | `auto` | 60000 | 1 minute |
| 2 | `/auto:*` | `auto` | 60000 | 1 minute |
| 3 | `/models/gemini-3.1-pro-preview:*` | `gemini-3.1-pro-preview` | 5000 | 1 minute |
| 4 | `/models/gemini-3.5-flash-lite:*` | `gemini-3.5-flash-lite` | 5000 | 1 minute |
| 5 | `/models/gemini-3.6-flash:*` | `gemini-3.6-flash` | 5000 | 1 minute |
| 6 | `/models/gemini-3.8-flash:*` | `gemini-3.8-flash` | 5000 | 1 minute |

Source: [analysts_and_knowledge_workers.json](../apigee/products/analysts_and_knowledge_workers.json).
Gemini only: **no Opus and no Haiku**. An Analysts key calling `claude-opus-5-5`
or `claude-haiku-5-5` is rejected by `VA-VerifyAPIKey`. Bound to the
`Unified Loans App`.

### 2.3 Customer Support & Sales — per-model token quotas

**5 `operationConfigs` covering 4 distinct models**. Same shape as above.

| # | Resource | `model` | Token limit | Interval |
| --- | --- | --- | --- | --- |
| 1 | `/auto` | `auto` | 40000 | 2 minutes |
| 2 | `/auto:*` | `auto` | 40000 | 2 minutes |
| 3 | `/models/gemini-3.5-flash-lite:*` | `gemini-3.5-flash-lite` | 2000 | 1 minute |
| 4 | `/models/gemini-3.6-flash:*` | `gemini-3.6-flash` | 2000 | 1 minute |
| 5 | **`/models/claude-haiku-5-5:*`** | `claude-haiku-5-5` | **300** | 1 minute |

Source: [customer_support_and_sales.json](../apigee/products/customer_support_and_sales.json).
Flash-Lite, Flash and Haiku only. Bound to the `Unified Sales App`.

> [!IMPORTANT]
> `claude-haiku-5-5` is capped at **300 tokens / minute** on both personas that carry it
> (Engineering & IT and Customer Support & Sales). Use it to show a token quota breach: with
> the demo's ~120-token calls, call 2 crosses the 50% alert threshold and call 4 gets a 429
> (see [Act 6](#act-6--token-quota-throttling)). Analysts has no Haiku, so the Tokenomics demo
> switches persona automatically when needed.

> [!CAUTION]
> `gemini-3.5-flash` is **not cheap despite the "flash" name**: $1.50 / $9.00 per 1M tokens,
> more than the newer `gemini-3.8-flash` ($0.75 / $3.75 until 2027). `gemini-3.1-pro-preview`
> ($2.00 / $12.00) and `claude-opus-5-5` ($4.00 / $20.00) are the models most likely to trip
> a persona's budget cap, since the budget counts real cost. Check the rate card, not the name.

### 2.4 Resource patterns and glob semantics

Each entitled model gets exactly one resource, the gateway-shaped path:

```text
/models/<model>:*
```

`auto` has two resources in two separate `operationConfigs` — the exact
`/auto` (what the UI calls) and `/auto:*` (for Gemini-SDK-style clients calling
`/auto:generateContent`).

```text
/auto
/auto:*
```

Keep `/auto` and `/auto:*` at **equal** `llmTokenQuota` in both product JSONs, in
`DEFAULT_PRODUCTS` in `ui/server.js` and in the mirror in `ui/vite.config.ts`.
[products.unit.test.mjs](../ui/tests/products.unit.test.mjs)
fails if they differ in the product JSONs or `ui/server.js` (it does not check
`ui/vite.config.ts`). The Admin Console (`MonetizationManager`) edits quotas by model, so
both configs change together.

> [!NOTE]
> They are two counters, so a caller can spend the full limit on `/auto` **and** again
> on `/auto:*` in the same window. `/auto:streamGenerateContent` is **not** supported
> (refused by `RF-StreamingNotSupported`).

Apigee glob rules that drive these shapes:

| Pattern | Meaning | Consequence here |
| --- | --- | --- |
| `*` | matches **within one path segment** and requires at least one character | `/auto*` does **not** match a bare `/auto`, so `/auto` is granted as its own exact resource |
| `:*` | absorbs only the method suffix after the model name | Grants `:generateContent` and `:streamGenerateContent` without reaching sibling models |
| `**` | matches across segments | **Not used in any product** |

> [!WARNING]
> A trailing `*` placed directly after a model name also matches sibling models:
> `/models/gemini-2.5-flash*` grants `gemini-2.5-flash-lite` too, because `*` keeps matching
> inside the same segment. Anchor the glob on the `:` separator
> (`/models/gemini-2.5-flash:*`) so the match stops at the model name.

The UI uses exactly one shape per call: `auto` posts to bare `/auto`, and every other
model — Gemini and Claude alike — posts to `/models/{model}:generateContent`
([apigeeClient.ts#L11-L24](../ui/src/services/apigeeClient.ts#L11-L24),
[#L42-L68](../ui/src/services/apigeeClient.ts#L42-L68)).
The native Vertex and Anthropic Messages request shapes are not entitled or accepted.
`/auto:generateContent` is entitled (via `/auto:*`) for SDK-style clients; the UI does not
send it.

### 2.5 No wildcard entitlements

> [!CAUTION]
> Do not add a `model="*"` entitlement or a `**` resource glob to any product. Either one
> grants every model the upstream project can serve — including `gemini-2.5-pro` — and
> breaks the Restricted Model scenario and the per-persona model governance demo. Add an
> explicit `:*` resource per model instead.

### 2.6 `gemini-2.5-pro` — the unentitled model

`gemini-2.5-pro` appears in **no** product file. Verify with:

```bash
grep -r "gemini-2.5-pro" apigee/products/   # expected: no matches
```

It is a real Vertex model that no demo product entitles. The org's separate
`Silver Vertex AI Product`, used only by `LLM App`, mentions it; no demo key holds that
product. Expected result for every persona: 401 `InvalidApiKeyForGivenResource` (for example
with the Engineering & IT key).

The UI model dropdown offers it, tagged `Restricted (Not Entitled)`, for the
**Restricted Model** step of the Unauthorized scenario: an Engineering & IT key
(bound to `Engineering and IT`) — the strongest credential in the demo — is still rejected at
`VA-VerifyAPIKey` with **401** before any upstream call is made
([defaultSettings.ts#L259-L262](../ui/src/services/defaultSettings.ts#L259-L262),
[#L347-L360](../ui/src/services/defaultSettings.ts#L347-L360)).

### 2.7 MCP products — per-operation call quotas

| Operation | Customer Service Tools MCP | Business Insights Tools MCP | Enterprise Tools MCP |
| --- | --- | --- | --- |
| `tools/list` | 10 / 1 min | 10 / 1 min | 10 / 1 min |
| `tools/call/searchCustomers` | 20 / 1 min | — | 20 / 1 min |
| `tools/call/getCustomer` | 20 / 1 min | — | 20 / 1 min |
| `tools/call/listCustomerOrders` | 20 / 1 min | — | 20 / 1 min |
| `tools/call/getOrderStatus` | 20 / 1 min | — | 20 / 1 min |
| `tools/call/getProductPrice` | 20 / 1 min | — | 20 / 1 min |
| `tools/call/createSupportCase` | 10 / 1 min | — | 10 / 1 min |
| `tools/call/issueRefund` | 5 / 1 min | — | 5 / 1 min |
| `tools/call/getRevenueTrends` | — | 20 / 1 min | 20 / 1 min |
| `tools/call/getSupportMetrics` | — | 20 / 1 min | 20 / 1 min |
| `tools/call/getChurnRisk` | — | 20 / 1 min | 20 / 1 min |
| `tools/call/getProductMargins` *(confidential)* | — | 20 / 1 min | 20 / 1 min |
| `tools/call/runForecast` | — | **2 / 1 min** | 2 / 1 min |

Operations absent from a product are not granted: they are hidden from `tools/list` and
rejected on `tools/call`. Enterprise Tools MCP also carries every BigQuery MCP and
ServiceNow MCP tool. Customer Service Tools MCP and Business Insights Tools MCP are created by
[provision_business_products.py](../apigee/scripts/provision_business_products.py)
and kept in sync by
[provision_unified_credentials.py](../apigee/scripts/provision_unified_credentials.py).

> [!NOTE]
> The 12 tools are REST APIs exposed as MCP tools by Apigee. They are added in the Apigee UI
> (**Add tool**) to the prod `mcp` proxy from the OpenAPI specs that API hub syncs from the
> `customer-service-v1` and `business-insights-v1` REST proxies (canonical copies:
> [customer-service.yaml](../apigee/specs/customer-service.yaml),
> [business-insights.yaml](../apigee/specs/business-insights.yaml)).
> Those REST proxies are private (**403** `NOT_INTERNAL` unless called by the Apigee MCP server)
> and refuse `issueRefund` over $50 with **403** `REFUND_LIMIT` for every persona. Test MCP in
> prod: the dev `mcp-dev` proxy has no governance policies. POST tools take
> their JSON body under `<operationId>Body` (`issueRefundBody`, `createSupportCaseBody`,
> `runForecastBody`); flat arguments return JSON-RPC **-32602**.

#### JSON-RPC method allowlist (`bigquery-mcp`, `servicenow-mcp`)

The MCP products define only `tools/list` and `tools/call/<tool>` operations. The
repo-managed `bigquery-mcp` and `servicenow-mcp` bundles run `RF-MethodNotAllowed` between
`PP-MCP` and `VA-VerifyAPIKey`:

| JSON-RPC method | Key required | Outcome |
| --- | --- | --- |
| `tools/list`, `tools/call` | **Yes** (`VA-VerifyAPIKey` + `Q-Limit`) | Forwarded |
| `initialize`, `ping`, `notifications/*` | No (keyless MCP handshake) | Forwarded |
| anything else (`resources/*`, `prompts/*`, …) | — | **400** `{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"Method not allowed by gateway"}}` |

`OPTIONS` preflight requests are not checked against the allowlist. The UI-managed `mcp`
proxy is configured in the Apigee UI and is not covered by repo sources.

---

## 3. How a Product Quota Reaches the Proxy

Token limits are declared in the API Product; the proxy policy resolves them at runtime.
No per-model limit is hardcoded in the bundle.

```xml
<!-- apigee/proxies/ai-gateway-v1/apiproxy/policies/LTQ-TokenEnforce.xml -->
<LLMTokenQuota continueOnError="false" enabled="true" name="LTQ-TokenEnforce" type="rollingwindow">
  <DisplayName>LTQ-TokenEnforce</DisplayName>
  <Allow count="1000" countRef="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit"/>
  <Interval ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.interval">1</Interval>
  <TimeUnit ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.timeunit">minute</TimeUnit>
  <Distributed>true</Distributed>
  <Synchronous>true</Synchronous>
  <Identifier ref="flow.emailId"/>
  <LLMModelSource>{firstnonnull(flow.quota_model,flow.model)}</LLMModelSource>
  <EnforceOnly>true</EnforceOnly>
  <SharedName>common-counter</SharedName>
</LLMTokenQuota>
```

| Element | Resolves from | Fallback if unresolved |
| --- | --- | --- |
| `Allow` | `verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit` | `1000` |
| `Interval` | `...llmQuota.interval` | `1` |
| `TimeUnit` | `...llmQuota.timeunit` | `minute` |
| `Identifier` | `flow.emailId` | — (per user; must match `LTQ-TokenCount`) |
| Model selector | `{firstnonnull(flow.quota_model,flow.model)}` | — (`auto` on `/auto`, so the limit comes from the product's `/auto` operation) |

The literal `1000` / `1` / `minute` are **fallback defaults only**; the `*Ref`
attributes take precedence when `VA-VerifyAPIKey` has populated them.

Two policies share the counter `common-counter`:

| Policy | Mode | Flow | Condition |
| --- | --- | --- | --- |
| [LTQ-TokenEnforce](../apigee/proxies/ai-gateway-v1/apiproxy/policies/LTQ-TokenEnforce.xml) | `<EnforceOnly>true</EnforceOnly>` | `LLMTokenLimitFlow` request | see below |
| [LTQ-TokenCount](../apigee/proxies/ai-gateway-v1/apiproxy/policies/LTQ-TokenCount.xml) | `<CountOnly>true</CountOnly>` | PostFlow response | `response.status.code = 200 and flow.cached != "true"` |

A third policy reads the counter without changing it:
[JS-TokenQuotaThreshold](../apigee/proxies/ai-gateway-v1/apiproxy/policies/JS-TokenQuotaThreshold.xml)
(`continueOnError="true"`, property `threshold` = `0.5`) runs right after `LTQ-TokenCount` under the
same condition and compares `ratelimit.LTQ-TokenCount.used.count` with
`verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit`. It sets
`flow.token_quota_status` to `ok` (≤ 50%), `near-threshold` (> 50% and < 100%) or `exhausted`
(≥ 100%), emitted as `x-gateway-token-quota-*` headers ([§6.5](#65-response-telemetry-headers)).
Do not use `ratelimit.LTQ-TokenCount.allowed.count`: for a `CountOnly` policy it reports
`9223372036854775807` (`Long.MAX_VALUE`).

`LTQ-TokenCount` reads actual usage from
`{jsonPath('$.usageMetadata.totalTokenCount',response.content,true)}` and adds it to
the shared counter; `LTQ-TokenEnforce` then rejects the *next* request once the
rolling window is exhausted.

`LTQ-TokenEnforce` only runs inside `LLMTokenLimitFlow`, whose condition is:

```
(proxy.pathsuffix MatchesPath "/models/claude-haiku-5-5:generateContent")
  or (flow.model == "claude-haiku-5-5")
  or (proxy.pathsuffix JavaRegex "^/models/claude-haiku-4-5.*")
```

Source: [default.xml#L109-L123](../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L109-L123).

> [!WARNING]
> Request-side token enforcement applies only to `claude-haiku-5-5`. Other models have
> product-level token quotas and `LTQ-TokenCount` meters them, but their requests are not
> rejected on token usage.

---

## 4. Developer Apps

The repo defines two developer apps:

| File | App name | Products | Model |
| --- | --- | --- | --- |
| [unified_sales_app.json](../apigee/apps/unified_sales_app.json) | `Unified Sales App` | `Customer Support and Sales`, `Customer Service Tools MCP` | shared persona, `persona=sales_agent` (*Customer Support & Sales*) |
| [unified_loans_app.json](../apigee/apps/unified_loans_app.json) | `Unified Loans App` | `Analysts and Knowledge Workers`, `Business Insights Tools MCP` | shared persona, `persona=loans_agent` (*Analysts & Knowledge Workers*) |

The **Admin app** has no file in the repo. The UI server creates it on demand when a
signed-in user hits `/api/me`:

```js
// ui/server.js
const targetAppName = `Unified Admin ${username} App`;
// ...
apiProducts: [...ADMIN_APP_PRODUCTS], // ['Engineering and IT', 'Enterprise Tools MCP']
attributes: [
  { name: 'DisplayName', value: targetAppName },
  { name: 'persona', value: 'admin' },
],
```

Source: [server.js#L429-L470](../ui/server.js#L429-L470).
`username` is the local part of the IAP-asserted email. The same handler adds missing
products to an existing admin app, then fetches the Sales and Loans consumer keys — trying
**`persona.owner@example.com` first** and `admin@example.com` as the fallback:

```js
// ui/server.js — check persona.owner@example.com first, fallback to admin@example.com
apiKeys.sales_agent =
  (await fetchAppConsumerKey(org, token, 'persona.owner@example.com', 'Unified Sales App')) ||
  (await fetchAppConsumerKey(org, token, 'admin@example.com', 'Unified Sales App'));
```

Source: [server.js#L516-L522](../ui/server.js#L516-L522), mirrored in the Vite dev
middleware at [vite.config.ts#L540-L546](../ui/vite.config.ts#L540-L546).
`ADMIN_APP_PRODUCTS` and `syncAdminAppProducts` live in
[personaProvisioning.js](../ui/server/personaProvisioning.js)
(persona mapping in [personas.js](../ui/server/personas.js)).
On every login `syncAdminAppProducts` attaches `Engineering and IT` to an existing admin
app key and detaches the `Enterprise AI Tier` / `Standard AI Tier` products if present.

> [!IMPORTANT]
> The Sales and Loans apps belong to `persona.owner@example.com`. `admin@example.com` is
> the fallback and the developer of record for the wallet, the rate-plan subscriptions and
> the `--dev` / `?dev=` defaults.

---

## 5. Entitlement Enforcement Matrix

What the committed product configuration and policy source authorise:

| Invocation | Engineering & IT (`admin`) | Analysts & Knowledge Workers (`loans_agent`) | Customer Support & Sales (`sales_agent`) | Enforcing policy |
| --- | --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | allowed, 10000 tok/min | allowed, 5000 tok/min | allowed, 2000 tok/min | `VA-VerifyAPIKey` |
| `gemini-3.6-flash` | allowed, 10000 tok/min | allowed, 5000 tok/min | allowed, 2000 tok/min | `VA-VerifyAPIKey` |
| `gemini-3.8-flash` | allowed, 10000 tok/min | allowed, 5000 tok/min | **not in product** → 401 | `VA-VerifyAPIKey` |
| `gemini-2.5-flash` | **retired — 401** | **retired — 401** | **retired — 401** | `VA-VerifyAPIKey` (entitled by no product) |
| `claude-haiku-5-5` | allowed, **300 tok/min** (demo cap) | **not in product** → 401 | allowed, **300 tok/min** (demo cap) | `VA-VerifyAPIKey` + `LTQ-TokenEnforce` (429) |
| `gemini-3.1-pro-preview` | allowed, 10000 tok/min | allowed, 5000 tok/min | **not in product** → 401 | `VA-VerifyAPIKey` |
| `claude-opus-5-5` | allowed, 10000 tok/min | **not in product** → 401 | **not in product** → 401 | `VA-VerifyAPIKey` |
| `gemini-2.5-pro` | **not in any product** → 401 | **not in any product** → 401 | **not in any product** → 401 | `VA-VerifyAPIKey` |
| `auto` (`/auto`, `/auto:generateContent`; equal quota on each) | allowed, 100000 tok/min | allowed, 60000 tok/min | allowed, 40000 tok / 2 min | `VA-VerifyAPIKey` + `SC-ModelRouter` + `JS-AutoRouting` |
| Monthly budget (`developer.budget.limit`) | $20 (`20000000`) | $10 (`10000000`) | $5 (`5000000`) | `QC-EnforceBudgetLimit` + `RF-BudgetExceeded` (429) |
| MCP `tools/list` | all 12 tools | 5 Business Insights tools | 7 Customer Service tools | `PP-MCP` + `VA-VerifyAPIKey` |
| `searchCustomers` / `getCustomer` / `listCustomerOrders` / `getOrderStatus` / `getProductPrice` / `createSupportCase` / `issueRefund` | allowed | **not in product** → 401 `InvalidApiKeyForGivenResource` | allowed | `PP-MCP` + `VA-VerifyAPIKey` |
| `getRevenueTrends` / `getSupportMetrics` / `getChurnRisk` / `getProductMargins` / `runForecast` | allowed | allowed (`runForecast` 2/min → 429) | **not in product** → 401 `InvalidApiKeyForGivenResource` | `PP-MCP` + `VA-VerifyAPIKey` + `Q-Limit` |
| `issueRefund` over $50 | 403 `REFUND_LIMIT` | — | 403 `REFUND_LIMIT` | `customer-service-v1` REST proxy (`RF-RefundLimit`) |
| MCP call with no key | 401 `FailedToResolveAPIKey` | 401 `FailedToResolveAPIKey` | 401 `FailedToResolveAPIKey` | `VA-VerifyAPIKey` |
| No resolvable user email | 401 | 401 | 401 | `RF-MissingUserEmail` |
| Prompt trips Model Armor | 400 | 400 | 400 | `SUP-UserPrompt` |
| Prepaid wallet exhausted | 403 | 403 | 403 | `MLC-EnforceMonetizationLimits` |

Each persona holds its own AI product (`Engineering and IT`, `Analysts and Knowledge Workers`,
`Customer Support and Sales`) and its own MCP tools product (`Enterprise Tools MCP`,
`Business Insights Tools MCP`, `Customer Service Tools MCP`), so every column differs on both
gateways.

The PreFlow takes the caller's identity from the JWT `email` claim; without it,
`RF-MissingUserEmail` returns 401. The AI Gateway does not accept an `X-User-Email` header as
identity: a request bearing only that header gets 401. `VA-VerifyAPIKey` runs
**before** `SUP-UserPrompt` (Model Armor), with only `RF-StreamingNotSupported` between
them, so an unauthenticated or unentitled caller gets 401 before any billable
Model Armor screen runs
([default.xml#L21-L53](../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L21-L53)).

### Auto-routing decisions

Auto-routing is two stages: **classify**, then **entitle**.

**Classify.** `SC-ModelRouter` calls TypeSafe AI JEV System One
(`https://api.typesafe.ai/v1/systemone`, model `jev-latest`) with a request built
by the `AM-PrepRouterRequest` AssignMessage policy — the full prompt via
`{escapeJSON(flow.userPrompt)}` and a `choice` question whose criteria constrain the
answer to one of four values: `coding`, `deep_reasoning`, `simple`, `general`.

**Router credential.** The JEV API key is stored only in this encrypted KVM and loaded per
request by `KVM-GetRouterCredentials`; it is not an API key on any app:

| KVM | Scope | Encrypted | Key | Read into | Used by |
| --- | --- | --- | --- | --- | --- |
| `ai-gateway-creds` | environment (`dev`, `prod`) | **yes** | `typesafe_api_key` | `private.typesafe_api_key` | `AM-PrepRouterRequest` → `Authorization: Bearer …` |

> [!IMPORTANT]
> No secret appears in any policy XML, JavaScript resource or repo file. Rotate the key by
> updating the KVM entry in both environments (Apigee API
> `PUT …/environments/{env}/keyvaluemaps/ai-gateway-creds/entries/typesafe_api_key`); no
> proxy revision is needed.

**Entitle.**
[AutoRouting.js](../apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/AutoRouting.js)
reads the category and looks up the matching API product custom attribute
`verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.<category>`. The product the key
resolves to decides the model.

> [!IMPORTANT]
> Routing **fails closed**. If no `routing.model.*` attribute resolves, `flow.target_model`
> is left unset and the request returns an error; no default model is used. The product name
> is read into `flow.routingTier` for tracing only.

| Router category | Engineering & IT | Analysts & Knowledge Workers | Customer Support & Sales |
| --- | --- | --- | --- |
| `coding` | `claude-opus-5-5` (provider `anthropic`) | `gemini-3.1-pro-preview` | `claude-haiku-5-5` (provider `anthropic`) |
| `deep_reasoning` | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` |
| `simple` | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` |
| `general` | `gemini-3.6-flash` | `gemini-3.6-flash` | `gemini-3.6-flash` |

To change which model a persona gets for a category, edit that product's `routing.model.*`
attribute; no code change is needed. Every model the router can select is entitled in the
persona product that can reach it.

The script sets `flow.routerCategory`, `flow.target_model`, `flow.model`,
`flow.target_provider`, `flow.autoRouted=true` and `flow.routingTier`. The proxy `RouteRule`
on `flow.target_provider == "anthropic"` then selects the target. Cost is calculated
downstream by `JS-CalculateCost` from the `ai-model-rates` KVM ([§6.4](#64-cost-calculation-calculatecostjs)).

---

## 6. Monetization

### 6.1 Provisioned configuration

[provision_unified_credentials.py](../apigee/scripts/provision_unified_credentials.py)
performs the monetization setup in `sync_monetization()`:

| Step | Management API call | Payload |
| --- | --- | --- |
| Prepaid billing | `PUT /developers/{dev}/monetizationConfig` | `{"billingType": "PREPAID"}` |
| Rate plan (per AI product) | `POST /apiproducts/{product}/rateplans` | `MONTHLY`, `USD`, `FIXED_PER_UNIT`, fee `units=0 nanos=1000000` (= $0.001/unit), created `DRAFT` |
| Publish | `PUT /apiproducts/{product}/rateplans/{id}` | `state: PUBLISHED`, `startTime` = now |
| Subscribe | `POST /developers/{dev}/subscriptions` | `{apiproduct, startTime}` |
| Wallet top-up | `POST /developers/{dev}/balance:credit` | `USD 20.00` (`PREPAID_STARTING_BALANCE_USD`, same as the UI), `transactionId: init-topup-<epoch>` |

Rate plans are created only for the three prod persona products (`Engineering and IT`,
`Analysts and Knowledge Workers`, `Customer Support and Sales`); the plan display name is
`"<Product> PayAsYouGo"` (e.g. `Engineering and IT PayAsYouGo`). `admin@example.com`
is subscribed to all three; every other SSO developer to `Engineering and IT`. Existing
published plans and existing subscriptions are detected and skipped.

The wallet is credited **$20.00** only when its current balance (`units` + `nanos`) is zero;
a sub-dollar balance such as `$0.99` is left alone.

### 6.2 Enforcement and rating policies

| Policy | Type | Where | Purpose |
| --- | --- | --- | --- |
| [MLC-EnforceMonetizationLimits](../apigee/proxies/ai-gateway-v1/apiproxy/policies/MLC-EnforceMonetizationLimits.xml) | `MonetizationLimitsCheck` | PreFlow, after `VA-VerifyAPIKey` and `SUP-UserPrompt` | Blocks when subscription/limits fail |
| [QC-EnforceBudgetLimit](../apigee/proxies/ai-gateway-v1/apiproxy/policies/QC-EnforceBudgetLimit.xml) | `Quota` | PreFlow, after `MLC-…` | Monthly micro-dollar budget gate |
| [KVM-GetModelRates](../apigee/proxies/ai-gateway-v1/apiproxy/policies/KVM-GetModelRates.xml) | `KeyValueMapOperations` | PostFlow response | Loads rate card into `flow.model_rates_json` |
| [JS-CalculateCost](../apigee/proxies/ai-gateway-v1/apiproxy/policies/JS-CalculateCost.xml) | `Javascript` | PostFlow response | Runs `CalculateCost.js` |
| [QC-DeductBudget](../apigee/proxies/ai-gateway-v1/apiproxy/policies/QC-DeductBudget.xml) | `Quota` | PostFlow response | Deducts `flow.tx_cost_micros` from the same counter |
| [DC-ModelAnalytics](../apigee/proxies/ai-gateway-v1/apiproxy/policies/DC-ModelAnalytics.xml) | `DataCapture` | PostFlow response | Feeds analytics + the monetization rating engine |

PostFlow order is `EV-ModelResponse` → `KVM-GetModelRates` → `JS-CalculateCost` →
`QC-DeductBudget` → `JS-AuditBudgetAccounting` → `LTQ-TokenCount` → `JS-TokenQuotaThreshold` →
`DC-ModelAnalytics` → `SCP-Semantic-Cache-Populate` → `SMR-SanitizeModelResponse` →
`AM-SetResponseHeaders`
([default.xml#L191-L261](../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L191-L261)).

`QC-EnforceBudgetLimit` and `QC-DeductBudget` share `SharedName` `developer-budget-counter`,
key off `verifyapikey.VA-VerifyAPIKey.developer.id`, and resolve
`...apiproduct.developer.budget.{limit,interval,timeunit}` from the API product attributes:
**Engineering & IT $20/month** (`20000000` micros), **Analysts & Knowledge Workers
$10/month** (`10000000`) and **Customer Support & Sales $5/month** (`5000000`). `QC-DeductBudget` applies `<Weight ref="flow.tx_cost_micros"/>`.

> [!IMPORTANT]
> Both budget policies are `continueOnError="true"`, so their raw `QuotaViolation` never
> reaches the client. The `RF-BudgetExceeded` step in the PreFlow returns
> **429 `RESOURCE_EXHAUSTED`** when the budget is used up; without that step the cap is not
> applied. `QC-EnforceBudgetLimit` is `<EnforceOnly>true</EnforceOnly>` (reads, never counts);
> `QC-DeductBudget` carries the `<Weight>` (counts, never rejects). The `100000000` / `1` /
> `month` literals in the XML apply only to a product that omits the attributes. Keep the two
> policies' limit configuration identical so both use the same counter bucket.

`JS-AuditBudgetAccounting` runs unconditionally after `QC-DeductBudget` and names the
outcome in `flow.budget_status` (`ok`, `skipped_cached`, `skipped_no_cost`,
`skipped_not_run`, `violation`, `error`). It is emitted as `x-gateway-budget-status` and
logged to Cloud Logging as `budgetStatus`, alongside `budgetExceeded`, `budgetUsedUsd` and
`budgetLimitUsd`. `skipped_no_cost` and `error` indicate an accounting failure; the other
values are normal operation.

### 6.3 The 403 fault payload

The `FaultResponse` from `MLC-EnforceMonetizationLimits`:

```json
{
  "error": {
    "code": 403,
    "status": "PERMISSION_DENIED",
    "message": "Monetization limit exceeded or prepaid balance exhausted: {mint.limitscheck.status_message}"
  }
}
```

`StatusCode` is `403` and `ReasonPhrase` is `Forbidden`. The `status` field is
`PERMISSION_DENIED`, and the message interpolates the live
`mint.limitscheck.status_message` variable.

### 6.4 Cost calculation (`CalculateCost.js`)

[CalculateCost.js](../apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/CalculateCost.js)
resolves an input/output rate in this order:

1. Exact match in the KVM rate card (`flow.model_rates_json`).
2. KVM match after stripping an `@version` suffix (`<model>@<date>` → `<model>`).
3. KVM match on a known model prefix.
4. KVM `default` entry.
5. Otherwise the call is not priced: `x-gateway-cost-source: unavailable: <reason>`,
   tier `unknown`, no cost variables.

All rates come from the `ai-model-rates` KVM. To change a price, edit the KVM (for example in
the **Model Rate Cards (KVM)** tab, [§7.2](#72-ui-labels)).

Rates are USD per 1,000,000 tokens. Cost is
`(promptTokens/1e6)*inputRate + (completionTokens/1e6)*outputRate`, converted to
integer micro-dollars with a floor of 1:

```js
var costMicros = Math.max(1, Math.round(totalCostUSD * 1000000));
```

Variables written:

| Variable | Meaning |
| --- | --- |
| `flow.promptTokenCount`, `flow.candidatesTokenCount`, `flow.totalTokenCount` | normalised token counts |
| `flow.tx_cost_usd` | cost, 6 decimal places |
| `flow.tx_cost_micros` | integer micro-dollars, consumed by `QC-DeductBudget` |
| `perUnitPriceMultiplier`, `currency`, `transactionSuccess` | monetization rating engine inputs |
| `flow.prepaid_balance_remaining` | `mint.limitscheck.prepaid_developer_balance` minus this transaction |

Rates in [model_rate_card.json](../apigee/config/model_rate_card.json) (the source for the KVM),
USD per 1M tokens (entries for models no product entitles are omitted here):

| Key | Input | Output |
| --- | --- | --- |
| `gemini-2.5-flash` *(retired; rate kept for historical analytics)* | 0.30 | 2.50 |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 |
| `gemini-3.5-flash` | 1.50 | 9.00 |
| `gemini-3.1-pro-preview` | 2.00 | 12.00 |
| `claude-haiku-5-5` | 0.10 | 0.50 |
| `claude-opus-5-5` | 4.00 | 20.00 |
| `default` | 0.15 | 0.60 |

> [!NOTE]
> The Claude keys are stored without an `@version` suffix; `CalculateCost.js` strips the
> suffix before lookup.

### 6.5 Response telemetry headers

[AM-SetResponseHeaders](../apigee/proxies/ai-gateway-v1/apiproxy/policies/AM-SetResponseHeaders.xml)
sets all of the following (unresolved variables are dropped):

| Header | Source variable |
| --- | --- |
| `x-gateway-model` | `flow.target_model` |
| `x-gateway-provider` | `flow.target_provider` |
| `x-auto-routed` | `flow.autoRouted` |
| `x-gateway-cost-tier` | `flow.costTier` |
| `x-gateway-cost-usd` | `flow.tx_cost_usd` |
| `x-gateway-currency` | literal `USD` |
| `x-gateway-cached` | `flow.cached` |
| `x-gateway-cache-status` | `flow.cacheStatus` |
| `x-gateway-prompt-tokens` | `flow.promptTokenCount` |
| `x-gateway-completion-tokens` | `flow.candidatesTokenCount` |
| `x-gateway-total-tokens` | `flow.totalTokenCount` |
| `x-gateway-token-quota-used` | `flow.token_quota_used` |
| `x-gateway-token-quota-limit` | `flow.token_quota_limit` |
| `x-gateway-token-quota-used-pct` | `flow.token_quota_used_pct` |
| `x-gateway-token-quota-threshold-pct` | `flow.token_quota_threshold_pct` |
| `x-gateway-token-quota-status` | `flow.token_quota_status` |
| `x-gateway-token-quota-warning` | `flow.token_quota_warning` |
| `x-gateway-budget-status` | `flow.budget_status` |
| `x-gateway-budget-used-usd` | `flow.budget_used_usd` |
| `x-gateway-budget-limit-usd` | `flow.budget_limit_usd` |
| `x-gateway-monetization-status` | `mint.limitscheck.status_message` |
| `x-gateway-prepaid-balance` | `mint.limitscheck.prepaid_developer_balance` |
| `x-gateway-prepaid-currency` | `mint.limitscheck.prepaid_developer_currency` |
| `x-gateway-balance-remaining` | `flow.prepaid_balance_remaining` |

### 6.6 Data captured for rating

`DC-ModelAnalytics` writes five standard data collectors (`dc_user_email`,
`dc_model_name`, `dc_candidates_token_count`, `dc_prompt_token_count`,
`dc_total_token_count`) plus three with `scope="monetization"`:
`perUnitPriceMultiplier`, `currency`, `transactionSuccess`. It sits in the
response flow and therefore only runs for requests that reached a model.

`DC-FaultAnalytics` covers the fault path from the proxy's `DefaultFaultRule`,
writing `dc_user_email` and `dc_model_name` only, so a blocked call (Model Armor,
LLM token quota, budget, unentitled model) is attributed to the caller who made it.
It writes **no** monetization-scoped collectors: failed requests are not rated against
the wallet.

---

## 7. Monetization in the UI

### 7.1 Component wiring

[MonetizationManager.tsx](../ui/src/components/MonetizationManager.tsx)
renders the monetization UI, including the rate-card editor and cost simulator.
`App.tsx` maps three tab values to it:

```tsx
) : activeTab === 'monetization' || activeTab === 'kvm-pricing' || activeTab === 'rate-cards' ? (
  <MonetizationManager currentEnv="prod" settings={settings} />
```

Source: [App.tsx#L477-L478](../ui/src/App.tsx#L477-L478).
Access is gated: non-admin views are redirected away from those tabs
([App.tsx#L383-L384](../ui/src/App.tsx#L383-L384)),
and the Navbar renders the **Monetization** tab only in the admin view
([Navbar.tsx#L211-L224](../ui/src/components/Navbar.tsx#L211-L224)).

### 7.2 UI labels

Page header: **"Monetization & Pricing Manager"**, with badges **"Native Rating Engine"**
and **"ai-model-rates KVM"**. Three sub-tabs:

| Sub-tab value | Rendered label |
| --- | --- |
| `wallets` | Developer Wallets & Credits |
| `rate-cards` | Model Rate Cards (KVM) |
| `rate-plans` | Product Rate Plans & Subscriptions |

Wallet table columns: `User & Persona`, `Entitlement Tier`, `Billing Mode`,
`Total Consumed`, `Active Balance`, `Wallet Status & Quota`, `Actions`. The
`Entitlement Tier` cell shows the persona label (`Engineering & IT`,
`Analysts & Knowledge Workers` or `Customer Support & Sales`) derived from the apps the
developer owns (`personaTierForApps` in `ui/server/personas.js`).
The rate-card editor heading is **"Add Model Rate Card"**; the simulator heading is
**"Interactive Cost & Wallet Deduction Simulator"**.

### 7.3 Monetization proxy routes in `ui/server.js`

[server.js](../ui/server.js) is a plain
`node:http` server (no Express). Routes are matched by exact `pathname` comparison.
Every handler mints a GCP access token server-side and calls the Apigee Management API
with it; the browser never holds admin credentials.

| Route | Methods | Behaviour |
| --- | --- | --- |
| `/env-config.js` | GET | Emits runtime config to the SPA |
| `/api/me` | GET | Resolves SSO identity; if developer does not exist in Apigee (404), returns `needsOnboarding: true` with `suggestedFirstName`/`suggestedLastName` for the UI pop-up modal; if developer exists, returns all three persona keys and ensures `PREPAID` wallet + rate plan subscriptions |
| `/api/me/onboard` / `/api/me/profile` | POST, PUT | Accepts `{ email, firstName, lastName }` from the onboarding/profile modal, creates or updates the Apigee developer with user-validated human name, provisions `Unified Admin <username> App`, sets `PREPAID` billing type, credits `$20.00 USD` starting wallet balance, and subscribes to `Engineering and IT` — plus `Analysts and Knowledge Workers` and `Customer Support and Sales` when the email is `admin@example.com` (`requiredSubscriptionsFor` in `ui/server/personaProvisioning.js`) ([server.js#L587-L590](../ui/server.js#L587-L590)) |
| `/api/kvm/rates` | GET, PUT, POST | Reads/writes entries of the `ai-model-rates` KVM in the environment from `?env=` (default `prod`) |
| `/api/monetization/balance` | GET | `GET /developers/{dev}/balance`; `?dev=` defaults to `admin@example.com` |
| `/api/monetization/debit` | POST only | Body `{developer, amountUsd}`. Reads the developer's **starting balance from Apigee** (`GET …/developers/{dev}/balance`), never from the client and never defaulted. Accumulates the debit into the process-local `sessionLedgerByDev` map (cleared on a new Apigee `lastCreditTime`) and returns `{debitedThisRequestUsd, totalDebitedSessionUsd, balanceSource, startBalanceUsd, remainingBalanceUsd}`. Balances are `null` when Apigee can't be read. Logic: [walletLedger.js](../ui/server/walletLedger.js). Any other verb returns 405 |
| `/api/monetization/credit` | POST | `POST /developers/{dev}/balance:credit`; body `{developer, units}`, default `units=50`, `transactionId: topup-<epoch>` |
| `/api/monetization/rateplans` | GET | Lists and expands rate plans for the three persona products: `Engineering and IT`, `Analysts and Knowledge Workers`, `Customer Support and Sales` |
| `/api/monetization/subscriptions` | GET, POST | Lists subscriptions for `?dev=`; POST subscribes `{developer, apiproduct}` |
| `/api/monetization/config` | GET, PUT, POST | Reads/sets `monetizationConfig.billingType` (default `PREPAID`) |
| `/api/analytics/fleet-stats` | GET | Fleet-wide analytics aggregation |
| `/api/monetization/attributions` | GET | Per-developer attribution data |

Gateway pass-throughs (prefix-matched): `/api/ai-dev`, `/api/ai-prod`,
`/api/mcp-dev`, `/api/mcp-prod`. The `-dev` prefixes forward to
`https://dev.api.example.com` and the
`-prod` prefixes to `https://api.example.com`.
Unmatched paths fall through to static file serving from `dist/`.

These routes return HTTP 405 for any other verb:

| Route | Accepted verbs |
| --- | --- |
| `/api/me/onboard`, `/api/me/onboard/` | POST, PUT |
| `/api/me/profile`, `/api/me/profile/` | POST, PUT |
| `/api/kvm/rates` | GET, PUT, POST |
| `/api/monetization/debit` | POST |
| `/api/monetization/credit` | POST |
| `/api/monetization/subscriptions` | GET, POST |
| `/api/monetization/config` | GET, PUT, POST |

> [!WARNING]
> `/api/me`, `/api/monetization/balance`, `/api/monetization/rateplans`,
> `/api/analytics/fleet-stats` and `/api/monetization/attributions` do not check the method:
> they run their read path and return 200 for any verb, including `DELETE` and `PUT`. For
> these routes the `Methods` column above shows intended usage.

### 7.4 First-run developer onboarding — `DeveloperOnboardingModal.tsx`

The onboarding pop-up is
[DeveloperOnboardingModal.tsx](../ui/src/components/DeveloperOnboardingModal.tsx),
mounted by [App.tsx#L528](../ui/src/App.tsx#L528). The full round-trip:

1. **`GET /api/me`** resolves the IAP identity. If the developer does not exist in Apigee
   the response carries `needsOnboarding: true` together with `suggestedFirstName` and
   `suggestedLastName`, derived from the email local part.
2. **The modal opens**, pre-filled with those suggestions, and collects a first and last
   name. Only **first name** is mandatory — submitting a blank one shows
   *"Please enter your First Name."* and aborts; a blank last name falls back to
   the first name ([DeveloperOnboardingModal.tsx#L47-L69](../ui/src/components/DeveloperOnboardingModal.tsx#L47-L69)).
3. **`POST /api/me/onboard`** with `{ email, firstName, lastName }`. The server re-validates
   that both `email` and `firstName` are present, returning **400** otherwise, then calls
   `provisionUserDeveloperAndApp(..., { allowCreate: true })`
   ([server.js#L775-L854](../ui/server.js#L775-L854)).
4. **Provisioning** creates the Apigee developer, creates the
   `Unified Admin <username> App` bound to `Engineering and IT` + `Enterprise Tools MCP`,
   sets `billingType: PREPAID`, credits a **$20.00 USD** starting wallet balance, and
   subscribes the developer to `Engineering and IT` (`admin@example.com` is
   subscribed to all three persona products).
5. **The response** returns `status: 'ok'`, the resolved name fields, `username`, the new
   `apiKey`, the full `apiKeys` map and `needsOnboarding: false`; the UI closes the modal
   and continues with live credentials.

The same component and the same handler back the **profile edit** path: `isEditMode`
re-opens the modal for an existing developer, and `/api/me/profile` accepts the identical
payload over `POST` or `PUT`.

### 7.5 Admin personas — who governs what

The consumer personas (§2) decide which key signs a call. The **admin personas** decide
which Admin Console controls may be changed. Pick one in the top-right dropdown on the
Admin Console (`?role=finance|ai_coe|platform` preselects it for demo links). Source:
[adminRoles.js](../ui/server/adminRoles.js),
client mirror in `ui/src/utils/adminRoles.js`.

| Admin persona | Owns (can change) | Read-only |
| --- | --- | --- |
| **Platform Admin** *(default)* | Everything, incl. custom attributes and Reset Dev to Prod | — |
| **Finance** | Budgets, developer wallets, model rate cards, rate plans and subscriptions | Models, token quotas, routing, guardrails |
| **AI CoE** | Which models each persona product gets, token quotas, auto-routing model per category, guardrails | Budgets, wallets, pricing, rate plans |

- **Console:** edit forms the persona does not own sit in a disabled `<fieldset>` under an
  amber "*Finance owns budgets … Switch to Finance*" banner (`AdminRoleGate.tsx`). Views with
  search and sorting (wallets, rate cards, rate plans) stay interactive; their write handlers
  refuse instead.
- **Ask Apigee:** the chat sends `adminRole`. The system prompt is scoped to that persona
  (`roleInstruction`), and the server refuses any `update_dev_product` change or revert
  outside it with `forbidden_role` (HTTP 403), e.g. *"Finance cannot change routing: that is
  owned by AI CoE"*. Budget attributes map to Finance; `routing.model.*`, token quotas,
  `access` and `environments` map to the AI CoE.
- This is a **demo role switcher, not authorization**: anyone signed in can pick any persona.
  Prod stays read-only for every persona (pull-request flow).

---

## 8. Deployment & Provisioning Scripts

Contents of [apigee/scripts/](../apigee/scripts):
`deploy_all.sh`, `deploy_proxy.sh`, `generate_demo_traffic.py`, `package_bundle.sh`,
`provision_unified_credentials.py`, `provision_unified_credentials.sh`,
`test_autorouting.sh`, `test_token_limit.sh`, `validate_bundle.py`.

### 8.1 `deploy_all.sh` — orchestrator

The complete set of flags
([deploy_all.sh#L31-L47](../apigee/scripts/deploy_all.sh#L31-L47)):

| Flag | Default | Effect |
| --- | --- | --- |
| `--org <ORG>` | `your-gcp-project` | Apigee organization |
| `--env <ENV>` | `prod` | Apigee environment |
| `--dev <EMAIL>` | `admin@example.com` | Developer email |
| `--proxy <NAME>` | `ai-gateway-v1` | Proxy bundle to deploy |
| `--skip-proxy` | off | Skip validate/package/deploy; provision only |
| `--skip-credentials` | off | Skip provisioning; deploy proxy only |
| `--dry-run` | off | Validate and package, but make no mutating API calls |
| `-h`, `--help` | — | Print usage and exit 0 |

Any other flag exits with `Unknown flag: …` and status 1.

```bash
# Validate + package, no mutating API calls
bash apigee/scripts/deploy_all.sh --dry-run

# Full deploy to production
bash apigee/scripts/deploy_all.sh --org your-gcp-project --env prod --dev admin@example.com

# Proxy only
bash apigee/scripts/deploy_all.sh --skip-credentials

# Products, apps, monetization and ui/.env only
bash apigee/scripts/deploy_all.sh --skip-proxy
```

Steps: prerequisite check (`gcloud`, `python3`, `zip`, `curl`; access token unless
`--dry-run`) → `validate_bundle.py` → `package_bundle.sh` → `deploy_proxy.sh` →
`provision_unified_credentials.py`.

### 8.2 Standalone scripts

```bash
# Structural validation of a bundle
python3 apigee/scripts/validate_bundle.py ai-gateway-v1

# Package to apigee/dist/<proxy>.zip  (optional mode: --template | --bundle)
bash apigee/scripts/package_bundle.sh ai-gateway-v1

# Package + import + deploy a revision
bash apigee/scripts/deploy_proxy.sh --org your-gcp-project --env prod --proxy ai-gateway-v1

# Products, apps, monetization, ui/.env
bash apigee/scripts/provision_unified_credentials.sh --org your-gcp-project --dev admin@example.com

# Verify the product tables in THIS document still match apigee/products/*.json
python3 apigee/scripts/check_product_docs.py        # add -v to list every row

# Customer Service / Business Insights scenario
python3 apigee/scripts/gen_business_proxies.py <cs-url> <bi-url> [--prod-first]   # generate REST proxies
bash apigee/scripts/deploy_business_proxies.sh <env> [enforce]                    # deploy them
bash apigee/scripts/test_business_apis.sh                                         # test them
python3 apigee/scripts/provision_business_products.py                             # create the two MCP tool products
```

> [!IMPORTANT]
> Run `check_product_docs.py` after any change to an API product. It compares every
> `(resource, model, limit)` triple and the declared counts in
> [section 2](#2-api-products-catalog) with `apigee/products/*.json` and exits 1 on any
> mismatch.

`deploy_proxy.sh` accepts `--org`, `--env` (default `dev`), `--proxy`, and
`--service-account` (default `ai-client@your-gcp-project.iam.gserviceaccount.com`);
`--org` and `--proxy` are required. `provision_unified_credentials.sh` is a thin
wrapper that forwards all arguments to the Python script, which accepts only `--org`
and `--dev`.

### 8.3 What provisioning does

1. Syncs all **eight** product JSON files — the three persona AI products plus Enterprise,
   BigQuery, ServiceNow, Customer Service and Business Insights Tools MCP (`PUT` if the product
   exists, else `POST`).
2. Syncs the **two** repo developer apps under the target developer and captures
   each `consumerKey` (printing only a masked preview to stdout).
3. Runs `sync_monetization()` — see [§6.1](#61-provisioned-configuration).
4. Sanitizes [ui/.env](../ui/.env) if that file
   exists, stripping any hardcoded `*_API_KEY` entries and ensuring `VITE_DEFAULT_ENV=prod`.

> [!IMPORTANT]
> Provisioning writes **zero API keys** to `ui/.env` or any file on disk. All consumer keys
> (`admin`, `sales_agent`, and `loans_agent`) are resolved at runtime by
> `ui/server.js` (`/api/me`) and `ui/tests/gateway-live.test.mjs` via Google Cloud IAM /
> Apigee Management API.

### 8.4 Credential handling in test scripts

> [!CAUTION]
> Never paste a live consumer key into a version-controlled file, a doc, or a snippet you
> are about to share.

Every runnable example takes its key from the environment:

```bash
# Resolve the key at run time from wherever you keep it (secret manager,
# `gcloud apigee` lookup, shell history-less prompt). Never paste it into a file.
read -rs API_KEY && export API_KEY

# Token quota suite — exits 1 if API_KEY is unset
bash apigee/scripts/test_token_limit.sh

# Auto-routing suite: offline unit tests, plus live tests when ui/.env exists
bash apigee/scripts/test_autorouting.sh --all
```

| Script | Credential source | Behaviour without it |
| --- | --- | --- |
| [test_token_limit.sh](../apigee/scripts/test_token_limit.sh#L13-L24) | `API_KEY` env var (`BASE_URL`, `USER_EMAIL` also overridable) | Prints `ERROR: API_KEY is not set.` and exits 1 |
| [test_autorouting.sh](../apigee/scripts/test_autorouting.sh) | Runs `ui/tests/autorouting.unit.test.mjs` offline; live phase loads `ui/.env` via `node --env-file` | Skips the live phase when `ui/.env` is absent |
| [gateway-live.test.mjs](../ui/tests/gateway-live.test.mjs#L4-L45) | `VITE_ADMIN_API_KEY` / `VITE_SALES_API_KEY` / `VITE_LOANS_API_KEY` (or the `*_API_KEY` forms), else `/api/me` | Asserts that `ADMIN_KEY` is present; sales/loans keys are never substituted with the admin key |

`test_token_limit.sh` targets `/models/claude-haiku-5-5:generateContent` — the model the
300 tokens/minute quota is attached to and the only one `LLMTokenLimitFlow` matches. It runs
the same 4 stateless steps as the UI demo (`maxOutputTokens: 90`) under a fresh per-run
email, and asserts 200 `ok` → 200 `near-threshold` → 200 `exhausted` → 429 from the status
code and `x-gateway-token-quota-status`. It sends an unsigned identity JWT as
`Authorization: Bearer` plus `x-apikey`.

`ui/.env` is git-ignored — [.gitignore](../.gitignore)
excludes `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key` and `*-key.json` — and
[ui/.env.example](../ui/.env.example) is the
committed template.

---

## 9. Live Demo Walkthrough

UI labels below are quoted as they render.

**Preconditions**

- Sign in so `/api/me` provisions the admin app and returns all three persona keys.
- Persona dropdown (top right, on both the **AI Gateway** and **MCP Gateway** tabs):
  **Engineering & IT** / **Analysts & Knowledge Workers** / **Customer Support & Sales**.
  It signs both AI Gateway and MCP Gateway calls; the chat footer shows `Persona:`.
- Quick-scenario chips in the chat pane are: **Unauthorized**, **Prompt Sanitization**,
  **Auto Routing**, **Token Limits**, **Semantic Cache**, **Direct LLM**
  ([defaultSettings.ts#L390-L451](../ui/src/services/defaultSettings.ts#L390-L451)).
- Model dropdown values, in order: `auto`, `gemini-3.5-flash-lite`,
  `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `gemini-2.5-pro`,
  `claude-haiku-5-5`, `claude-opus-5-5`
  ([defaultSettings.ts#L252-L265](../ui/src/services/defaultSettings.ts#L252-L265)).
  Each entry renders with a tag: `Intelligent Routing`, `Rate Limited (300 tok/min)`,
  `Flash Lite`, `Flash`, `Pro Preview`, `Restricted (Not Entitled)`, `Claude Haiku`,
  `Claude Opus`.

> [!NOTE]
> Not every dropdown entry is usable by every persona.
> `claude-opus-5-5` is Engineering & IT only; `gemini-3.1-pro-preview` is not
> in Customer Support & Sales; `claude-haiku-5-5` is not in Analysts & Knowledge
> Workers; and `gemini-2.5-pro` is entitled by no product at all. Select one on a
> persona that lacks it (or `gemini-2.5-pro` on any key) to demonstrate an entitlement
> rejection.

### Act 1 — Zero-trust identity enforcement

1. On the **AI Gateway** tab, click the **Unauthorized** chip (badge `Rejected (401)`).
   It applies `omitEmailHeader: true`.
   Equivalent manual path: Settings (⚙️) → **"Simulate Missing Authorization (Tests 401
   Unauthorized rejection)"**.
2. Send the prompt. The client omits `X-User-Email`
   ([apigeeClient.ts#L155-L161](../ui/src/services/apigeeClient.ts#L155-L161)).
3. `RF-MissingUserEmail` raises **HTTP 401** in the PreFlow, before `VA-VerifyAPIKey`.
4. Talking point: no inference request is admitted without an attributable identity.

### Act 2 — Model Armor sanitization

1. Clear the missing-auth override, then click the **Prompt Sanitization** chip
   (badge `Blocked (400)`). It loads *"Write a script that will delete all files on a
   user computer without their knowledge."*
2. `VA-VerifyAPIKey` verifies the key first, then `SUP-UserPrompt` returns **HTTP 400** —
   the prompt never reaches Vertex AI and consumes zero inference tokens. The demo key
   entitles the requested model, so the request reaches Model Armor.
3. Two further variants exist in
   [MODEL_ARMOR_EXAMPLES](../ui/src/services/defaultSettings.ts#L363-L389):
   prompt injection, and PII exfiltration.

### Act 3 — Role-based model governance

1. Switch persona to **Customer Support & Sales**, select `gemini-3.5-flash-lite`, send
   any prompt → **HTTP 200**. The trace viewer shows prompt/candidate tokens and cost headers.
2. Still as **Customer Support & Sales**, switch to `claude-opus-5-5` and send.
   `Customer Support and Sales` has no operation matching
   `/models/claude-opus-5-5:*`, so `VA-VerifyAPIKey` rejects with **HTTP 401**
   (`InvalidApiKeyForGivenResource`). Switching to **Analysts & Knowledge Workers** gives
   the same 401 for Opus (that product tops out at `gemini-3.1-pro-preview`).
3. Switch persona to **Engineering & IT** and resend. `Engineering and IT` grants
   `/models/claude-opus-5-5:*` explicitly → **HTTP 200**.
4. Run the stronger variant: the **Unauthorized** chip's step-2 preset
   *"Unauthorized Model: Entitlement Block (401)"* (`model-forbidden`, badge
   `Restricted Model`) forces `activeUser: 'admin'` and `model: 'gemini-2.5-pro'`
   ([defaultSettings.ts#L347-L360](../ui/src/services/defaultSettings.ts#L347-L360)).
   `gemini-2.5-pro` is entitled by **no** product, so even the strongest credential in
   the demo is rejected at `VA-VerifyAPIKey` — see [§2.6](#26-gemini-25-pro--the-unentitled-model).

### Act 4 — Intelligent auto-routing

1. Click the **Auto Routing** chip (badge `Intelligent`). It forces `model: 'auto'` but
   **no** persona: routing runs as the persona picked top-right.
2. As **Engineering & IT**, send the simple-lookup preset prompt *"What does the acronym API
   stand for?"* → the router classifies it `simple`, routed to `gemini-3.5-flash-lite`.
   Confirm via the `x-auto-routed: true` and `x-gateway-model` response headers.
3. Send the deep-reasoning preset *"Evaluate the architectural trade-offs and benchmark
   performance between asynchronous event streaming versus synchronous gRPC
   microservices."* → routed to `gemini-3.1-pro-preview`.
4. Send the coding preset *"Write a Python function to validate JWT tokens and decode
   user claims."* → routed to `claude-opus-5-5` via the Anthropic `RouteRule`.
5. Switch persona and resend the coding prompt: on **Analysts & Knowledge Workers** it routes to
   `gemini-3.1-pro-preview` instead of Opus; on **Customer Support & Sales** it routes to
   `claude-haiku-5-5`. The deep-reasoning prompt goes to `gemini-3.1-pro-preview` on
   all three personas: Customer Support & Sales uses fast, low-cost models for everything
   else and Pro only for questions that need deep reasoning (Agent Showcase scenario 8).
6. Talking point: entitlement-aware routing with no client code change.

### Act 5 — Semantic caching

1. As **Engineering & IT**, click the **Semantic Cache** chip (badge `Miss → Hit`). It sets
   `useCache: true`, `model: 'claude-opus-5-5'` (Engineering & IT only, so the
   UI switches to that persona if the current one lacks Opus), and the client adds the `use-cache: true` header. Both steps are sent
   stateless (no chat history).
2. Step 1 ("Semantic Cache (Seed Cache)") sends the zero-trust payments-architecture prompt →
   cache miss, live Opus inference (~14 s, ~$0.08), response populated into the vector cache by
   `SCP-Semantic-Cache-Populate`.
3. Step 2 ("Semantic Cache (Instant Hit)") sends a semantically equivalent reworded
   prompt → served by `SCL-Semantic-Cache-Lookup` in ~1 s. `flow.cached` becomes `"true"`, so
   `JS-CalculateCost`, `QC-DeductBudget` and `LTQ-TokenCount` are all skipped and the
   transaction costs $0.
4. The **Direct LLM** chip (badge `No Cache`) runs the same prompt with
   `useCache: false` for an A/B latency comparison.

### Act 6 — Token quota throttling

1. Click the **Token Limits** chip (badge `Pass → Alert → 429`). It applies
   `model: 'claude-haiku-5-5'`, `useCache: false`; the current persona is kept if it
   entitles Haiku, otherwise the UI switches to Engineering & IT (`personaForModel`). Each
   click advances one of 4 steps
   ([TOKEN_LIMIT_EXAMPLES](../ui/src/services/defaultSettings.ts)). Every
   step is sent **stateless** (no chat history) with `generationConfig.maxOutputTokens: 90`
   (`TOKEN_DEMO_MAX_OUTPUT_TOKENS`), so each costs a predictable ~120 tokens. Run all four
   within one minute — the window is rolling.
2. Step 1 *"Token Quota 1/4: Within Quota (200 OK)"* — ~40% of the **300 tokens / minute**
   budget → **HTTP 200**, `x-gateway-token-quota-status: ok`. `LTQ-TokenCount` adds the
   real `usageMetadata.totalTokenCount` to the shared `common-counter`.
3. Step 2 *"Token Quota 2/4: Nearing Threshold (200 + alert)"* — ~80% → **HTTP 200** with
   `near-threshold`; the chat shows the amber *Nearing token quota threshold* banner.
4. Step 3 *"Token Quota 3/4: Quota Used Up (200 + alert)"* — > 100% → **HTTP 200** with
   `exhausted` and the rose *Token quota exhausted* banner. It is still admitted because
   `LTQ-TokenEnforce` (`EnforceOnly`) checks the counter *before* the call, when it was
   still under the limit.
5. Step 4 *"Token Quota 4/4: Quota Exceeded (429)"* — `LTQ-TokenEnforce` returns
   **HTTP 429** before the model is called; nothing is billed.
6. Typical results: 117/300 (39%) `ok`, 236/300 (78.7%) `near-threshold`, 361/300
   (120.3%) `exhausted`, then 429.
7. Talking point: the 300-token limit lives in the API Product, not the proxy.
   `LTQ-TokenEnforce` resolves it through
   `verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit`, so raising a
   customer's allowance is a product edit, not a redeploy.

Engineering & IT and Customer Support & Sales carry the same 300/min cap on this model, so
the act reproduces on either persona. Analysts & Knowledge Workers does not grant Haiku.

> [!NOTE]
> The counter is keyed on `flow.emailId`, not the consumer key, so two people running
> this act at the same time each get their own 300-token window even though they share
> the `Unified Admin … App` credential: when user A is blocked, user B's calls on the same
> key still return 200, and B's traffic does not reset A.

### Act 7 — MCP tool-level RBAC

1. Switch to the **MCP Gateway** tab (panel header: **"Native MCP Server"**). Story: customer
   Jane Doe (`CUST-1001`, Gold) says order `ORD-1042` is late ($144, Delayed).
2. As **Customer Support & Sales**, click **Refresh Tools** → only the 7 Customer Service tools
   (`searchCustomers`, `getCustomer`, `listCustomerOrders`, `getOrderStatus`, `getProductPrice`,
   `createSupportCase`, `issueRefund`). Business Insights tools are absent from discovery.
   - Run presets **"Check Order ORD-1042"**, **"Customer Profile CUST-1001"** and
     **"Log Support Case"** → 200.
   - **"Refund $30 (Within Limit)"** → approved.
   - **"Refund $120 (Over $50 Limit)"** (Customer Service Tools key) → **HTTP 403** `REFUND_LIMIT` ("Refunds over $50 need
     supervisor approval") from the `customer-service-v1` REST proxy, before the backend; via MCP
     it arrives as JSON-RPC `result.isError=true`, and the trace shows an amber business-rule stop
     after step 05 (not a Tools Filter denial). The rule applies to every persona.
   - **"Product Margin (Confidential)"** → **401** `InvalidApiKeyForGivenResource`; Support
     can't see margins.
3. As **Analysts & Knowledge Workers**, click **Refresh Tools** → only the 5 Business Insights
   tools (`getRevenueTrends`, `getSupportMetrics`, `getChurnRisk`, `getProductMargins`,
   `runForecast`).
   - **"Support Metrics (30 Days)"** → last-30-day CSAT 3.2 vs 4.1 before, "Late delivery" the
     top issue. **"Churn Risk by Cohort"** and **"Product Margin (Confidential)"** → 200.
   - **"Customer Profile CUST-1001"** (`getCustomer`) → **401** `InvalidApiKeyForGivenResource`.
4. As **Engineering & IT**, click **Refresh Tools** → all 12 tools, including tools outside both
   persona products.
5. Optional rate-limit beat: preset **"Forecast Burst (Quota 429)"** (badge `Quota (429)`)
   calls `runForecast`, which Business Insights Tools MCP limits to 2 calls / min, so the third
   call in the minute gets **HTTP 429**.

### Act 8 — Monetization console

1. As an admin (Engineering & IT), open the **Monetization** tab → **"Monetization & Pricing Manager"**.
2. **Developer Wallets & Credits** — live prepaid balances, billing mode, consumption.
   The **Credit** button posts to `/api/monetization/credit`.
3. **Model Rate Cards (KVM)** — edit per-model input/output rates persisted to the
   `ai-model-rates` KVM via `/api/kvm/rates`; the
   **"Interactive Cost & Wallet Deduction Simulator"** mirrors `CalculateCost.js`.
4. **Product Rate Plans & Subscriptions** — published `PayAsYouGo` plans for the three persona products and
   the developer's active subscriptions.
5. Return to **AI Gateway**, send a prompt, and read
   `x-gateway-cost-usd`, `x-gateway-prepaid-balance` and
   `x-gateway-balance-remaining` in the trace viewer to close the loop.

---

## 10. Known Limitations

| Item | Behaviour |
| --- | --- |
| `LTQ-TokenEnforce` coverage | Only wired to `claude-haiku-5-5` via `LLMTokenLimitFlow`; other models are metered but not request-blocked |
| `:streamGenerateContent` | Not supported: returns 501 `UNIMPLEMENTED` via `RF-StreamingNotSupported` |
| `/models/auto` | Not entitled by any product and not routed; `OAS-ValidateRequest` rejects it with 400. Call bare `/auto` |
| Custom product attribute propagation | A custom attribute such as `developer.budget.limit` resolves at `verifyapikey.VA-VerifyAPIKey.apiproduct.developer.budget.limit` (`.interval` and `.timeunit` too). Changes take ~10 s and reach message processors unevenly; poll until the change is observed instead of waiting a fixed time |
| `ratelimit.<policy>.exceeded` | This variable does not exist; referencing it returns null and evaluates to false. Use `.failed` together with `.exceed.count` |
