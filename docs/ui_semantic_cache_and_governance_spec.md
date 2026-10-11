# Frontend UI Reference: Gateway Governance & Semantic Cache Surfaces

> **Repository path**: `ui/`
> **Status**: Reconciled against source on 2026-09-17. Sections are explicitly labelled
> **Implemented** or **Proposal (not built)**.
> **Associated proxies**: [`apigee/proxies/ai-gateway-v1`](../apigee/proxies/ai-gateway-v1),
> and the `mcp` proxy (`/mcp`) — UI-managed in Apigee by design, so its source is
> intentionally not in this repo

> [!IMPORTANT]
> This document previously specified a `SemanticCacheView.tsx` component and a fifth
> `semantic-cache` studio tab. **Neither was ever implemented.** Semantic cache behaviour
> ships today through the [ChatPlayground](../ui/src/components/ChatPlayground.tsx)
> scenario chips and the Semantic Cache card in
> [GatewayTraceViewer](../ui/src/components/GatewayTraceViewer.tsx#L217-L266).
> The unbuilt design is preserved — clearly marked — in [Section 9](#9-proposal--not-built-semanticcacheviewtsx).

---

## 1. What ships today

| Capability | Where it actually lives | Built? |
| --- | --- | --- |
| Semantic cache demo (seed → hit) | Two-step chip in `ChatPlayground` + `useCache` setting | ✅ |
| Cache outcome display | `GatewayTraceViewer` "Semantic Cache" + "Latency" cards | ✅ |
| Cache on/off toggle | `GatewayTraceViewer` header pill and `ChatPlayground` footer pill | ✅ |
| MCP JSON-RPC tracing | `McpPlayground` + `McpTraceViewer` | ✅ |
| Prepaid wallet balance readout | `GatewayTraceViewer` "Wallet" card (from response headers) | ✅ |
| Wallet top-up | `MonetizationManager` "Top-Up Prepaid Wallet" modal | ✅ |
| Dedicated cache explorer screen | — | ❌ never built |
| Cache KPI dashboard / vector entries table | — | ❌ never built |
| Fifth `semantic-cache` navigation tab | — | ❌ never built |

---

## 2. Component inventory (Implemented)

**Seventeen** components exist under
[`ui/src/components/`](../ui/src/components).

| Component | Purpose | Mounted today? |
| --- | --- | --- |
| [AdminAgentPanel.tsx](../ui/src/components/AdminAgentPanel.tsx) | Ask Apigee chat dock (inspects products/policies; dev-only writes) | Yes — App, beside `MonetizationManager` on the `monetization` tab |
| [AnalyticsDashboard.tsx](../ui/src/components/AnalyticsDashboard.tsx) | Fleet consumption / cost KPIs. Scoped cache hit-rate/savings come from [`utils/cacheKpis.js`](../ui/src/utils/cacheKpis.js) | Yes — `analytics` tab |
| [ApigeeLogo.tsx](../ui/src/components/ApigeeLogo.tsx) | Exports `ApigeeLogo` and `ApigeeColorSymbol` | Yes — Navbar, ChatPlayground |
| [ArchitectureBlueprintModal.tsx](../ui/src/components/ArchitectureBlueprintModal.tsx) | High-level **Solution Overview** (default tab) plus interactive AI Gateway and MCP Tools Gateway pipeline diagrams with clickable XML policy inspector, live trace correlation, and dynamic short-circuit `Tested Request Flow` mode. The AI router stage lists the deployed `AutoRoutingFlow` chain: `KVM-GetRouterCredentials` → `AM-PrepRouterRequest` → `SC-ModelRouter` (TypeSafe AI JEV System One) → `JS-AutoRouting`. The Solution Overview walks the prompt *"Customer says order 1042 is late"* through the agent loop to the MCP Gateway, whose tool servers are **Service MCP** (Customer Service), **Insights MCP** (Business Insights) and Salesforce. The MCP Tools Flow steps are **01 API Key Check → 02 Tools Filter → 03 Rate Limit → 04 MCP Call → 05 JSON-RPC → REST**; step 05 is optional (only REST APIs converted and hosted as MCP by Apigee — third-party MCP such as Salesforce skip it), and a refund over the $50 limit is drawn as an amber business-rule stop after step 05, not as a Tools Filter denial | Yes — App (`Architecture` button in Navbar + inline `Request Flow` button next to Target URL / MCP Operation) |
| [CallLogsModal.tsx](../ui/src/components/CallLogsModal.tsx) | **Full Audit Logs** — per-call Cloud Logging table for one `(user, model)` pair, with window selector, expandable rows and a Cloud Logging deep link | Yes — AnalyticsDashboard (`View logs` link in the consumption ledger) |
| [ChatPlayground.tsx](../ui/src/components/ChatPlayground.tsx) | Chat pane + scenario chips + trace pane | Yes — `ai-gateway` tab |
| [DeveloperOnboardingModal.tsx](../ui/src/components/DeveloperOnboardingModal.tsx) | First-run name-confirmation gate; collects first/last name and `POST`s to `/api/me/onboard` to create the developer, app, prepaid wallet and subscription | Yes — App, conditionally: rendered only when `GET /api/me` returns `needsOnboarding: true` ([App.tsx#L528](../ui/src/App.tsx#L528)) |
| [DonutPieChart.tsx](../ui/src/components/DonutPieChart.tsx) | Chart primitive | Yes — AnalyticsDashboard |
| [GatewaySettingsModal.tsx](../ui/src/components/GatewaySettingsModal.tsx) | Settings modal, heading **"Gateway Configuration"** | Yes — App |
| [GatewayTraceViewer.tsx](../ui/src/components/GatewayTraceViewer.tsx) | AI Gateway telemetry panel | Yes — ChatPlayground |
| [GuardrailsPoliciesView.tsx](../ui/src/components/GuardrailsPoliciesView.tsx) | Read-only guardrail catalog rendered from [`data/guardrailPolicies.ts`](../ui/src/data/guardrailPolicies.ts) (mirrored to `server/guardrailCatalog.json` for Ask Apigee) | Yes — MonetizationManager (Guardrails & Policies sub-tab) |
| [GuidedTour.tsx](../ui/src/components/GuidedTour.tsx) | Interactive guided demo driven by [`services/tourSteps.ts`](../ui/src/services/tourSteps.ts) | Yes — App (`Guide me` button, or `?tour=open`) |
| [McpPlayground.tsx](../ui/src/components/McpPlayground.tsx) | MCP tool catalog + execution | Yes — `mcp-gateway` tab |
| [McpTraceViewer.tsx](../ui/src/components/McpTraceViewer.tsx) | Structured result tables + collapsible JSON-RPC/headers inspector | Yes — McpPlayground |
| [MonetizationManager.tsx](../ui/src/components/MonetizationManager.tsx) | **Admin Console**: AI products, wallets, rate cards, rate plans, guardrails. Sort rules live in [`utils/monetizationSort.js`](../ui/src/utils/monetizationSort.js) | Yes — `monetization` tab (labelled *Admin Console*) |
| [Navbar.tsx](../ui/src/components/Navbar.tsx) | Header, tabs, quick config | Yes — App |
| [ProviderLogos.tsx](../ui/src/components/ProviderLogos.tsx) | `GoogleLogo` / `AnthropicLogo` brand marks | Yes — blueprint, trace viewer, Admin Console |

> [!NOTE]
> The former dead components `ModelRateCardView.tsx` and `ScenarioPresets.tsx` have been
> **removed**. Rate cards are served by the `rate-cards` sub-tab inside `MonetizationManager`,
> and the chat scenario grid is built inline in `ChatPlayground` from the `sampleChips` array,
> which looks up prompts in the `SCENARIO_PRESETS` data (still in `defaultSettings.ts`).

### 2.1 Component graph

```mermaid
flowchart TD
    App["App.tsx"]
    Navbar["Navbar.tsx (logo, 4 tabs, quick config)"]
    Chat["ChatPlayground.tsx (chat + scenario chips)"]
    GTV["GatewayTraceViewer.tsx (AI telemetry)"]
    Mcp["McpPlayground.tsx (tool catalog)"]
    MTV["McpTraceViewer.tsx (Structured Tables + JSON-RPC Inspector)"]
    Analytics["AnalyticsDashboard.tsx"]
    Donut["DonutPieChart.tsx"]
    Money["MonetizationManager.tsx (wallets | rate-cards | rate-plans)"]
    Modal["GatewaySettingsModal.tsx"]
    Blueprint["ArchitectureBlueprintModal.tsx (policy inspector)"]
    Onboard["DeveloperOnboardingModal.tsx (first-run name gate)"]

    App --> Navbar
    App --> Chat
    App --> Mcp
    App --> Analytics
    App --> Money
    App --> Modal
    App --> Blueprint
    App -->|"only when /api/me returns needsOnboarding"| Onboard
    App --> Theme
    Chat --> GTV
    Mcp --> MTV
    Analytics --> Donut
```

---

## 3. Tab routing (Implemented)

### 3.1 `AppTab` type

[`ui/src/types/index.ts#L131`](../ui/src/types/index.ts#L131):

```ts
export type AppTab =
  | 'ai-gateway'
  | 'mcp-gateway'
  | 'kvm-pricing'
  | 'monetization'
  | 'analytics'
  | 'rate-cards';
```

`kvm-pricing` and `rate-cards` are legacy aliases: all three monetization-family values render the
same [MonetizationManager](../ui/src/App.tsx#L350-L351).

The initial tab can be deep-linked with `?tab=`, but
[App.tsx#L169-L177](../ui/src/App.tsx#L169-L177) only accepts
`ai-gateway`, `mcp-gateway`, `monetization`, `kvm-pricing`, `analytics` — `rate-cards` is **not**
accepted from the URL. Anything else falls back to `ai-gateway`.

Non-admin personas are bounced off the monetization family back to a permitted tab
([App.tsx#L294-L298](../ui/src/App.tsx#L294-L298)).

### 3.2 Navbar tabs

[Navbar.tsx#L120-L178](../ui/src/components/Navbar.tsx#L120-L178)
renders the 4-colour logo symbol (no wordmark) followed by these buttons:

| Order | Visible label | Target tab | Icon | Visibility |
| --- | --- | --- | --- | --- |
| 1 | `AI Gateway` | `ai-gateway` | `Sparkles` | Always |
| 2 | `MCP Gateway` | `mcp-gateway` | `Terminal` | Always |
| 3 | `Analytics & Cost` | `analytics` | `BarChart3` | Always |
| 4 | `Monetization` | `monetization` | `Coins` | Admin view only |

Admin view is `analyticsControls?.viewMode === 'admin'` on the analytics tab, otherwise
`settings.activeUser === 'admin'`
([Navbar.tsx#L107-L110](../ui/src/components/Navbar.tsx#L107-L110)).

### Analytics tab defaults

| Control | Default | Override |
| --- | --- | --- |
| View mode | **User** | `Admin` / `User` toggle, or `?view=admin` |
| Time range | **24H** | `24H` / `7D` / `30D` selector |
| User filter | `All Users (Fleet)` — admin view only | `?userFilter=<email>` |

> [!IMPORTANT]
> Because `Monetization` is gated on admin view *while the analytics tab is active*, the default
> User view hides that tab until the toggle is switched to **Admin**. This is expected, not a
> regression — the tab reappears immediately on switching.

The **View logs** modal opens on whichever time range is selected here, so the audit drill-down
always covers the same period as the ledger row behind it.

### Navbar layout and identity chip

| Element | Behaviour |
| --- | --- |
| Tab labels | Collapse to icon-only below **1400px**; the `title` tooltip still names each tab |
| Persona pills (`Admin` / `Sales` / `Loans`) | Rendered on the **MCP Gateway tab only** |
| Active persona elsewhere | Pinned back to `admin` on leaving the MCP tab |
| Controls drawer (`☰`) | Below **1024px**, matching its toggle button |
| SSO chip + popover | Read-only; no identity field, no OIDC token row |

Persona selects an agent's *tool* entitlements, which is an MCP concern. The AI Gateway
tab therefore always runs on the Enterprise (`admin`) key, and model entitlement is
demonstrated by selecting a model no API product grants.

> [!WARNING]
> Two CSS traps caused the SSO popover to render detached off the top-right of the
> viewport. Do not reintroduce either:
> 1. The popover needs an explicit **`top-full`**. With `top: auto` an absolutely
>    positioned child falls back to its static position, which inside an `items-center`
>    flex row is *vertically centred* — placing the panel ~95px above the navbar.
> 2. Every navbar group was `shrink-0`, so the row had a fixed **1487px** intrinsic
>    width and simply overflowed the viewport, carrying the whole SSO block off-screen
>    below that width. Anything added to the navbar must stay within the budget.

> [!CAUTION]
> The word "Apigee" is deliberately absent from all rendered UI text; only the logo symbol remains.
> Quote only the strings above. Code identifiers (`ApigeeLogo`, `sendPromptToApigee`,
> `apigeeClient.ts`) intentionally retain the name and are not user-facing.

---

## 4. Request header contract (Implemented)

### 4.1 AI Gateway — [`apigeeClient.ts`](../ui/src/services/apigeeClient.ts#L149-L167)

```ts
const headersSent: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-apikey': effectiveApiKey,
};
// Identity is the JWT only. The X-User-Email fallback was removed from the proxy.
if (!settings.omitEmailHeader && effectiveIdToken) {
  headersSent['Authorization'] = `Bearer ${effectiveIdToken}`;
}
if (settings.useCache) headersSent['use-cache'] = 'true';
```

| Header | Sent when | Notes |
| --- | --- | --- |
| `Content-Type: application/json` | Always | — |
| `x-apikey` | Always | Resolved from `settings.apiKey`, the active persona, or `/api/me` |
| `Authorization: Bearer <id_token>` | SSO token present **and** `omitEmailHeader` false | The **only** identity the AI Gateway accepts |
| `use-cache: true` | `settings.useCache === true` | Only emitted when true; never sent as `false` |

> [!NOTE]
> The `ai-gateway-v1` proxy also accepts `x-use-cache` as an alias
> ([default.xml#L79-L83](../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml#L79-L83)),
> but the UI never sends it. Do not document `x-use-cache` as a UI behaviour.

The former `exhaustLlmQuota()` helper in `apigeeClient.ts` has been **removed**. It was exported
but never called, and targeted `gemini-3.5-flash-lite`, which does not match
`LLMTokenLimitFlow` (that flow only enforces `LTQ-TokenEnforce` for
`claude-haiku-5-5`).

### 4.2 MCP Gateway — [`mcpClient.ts`](../ui/src/services/mcpClient.ts#L27-L48)

`Content-Type`, `x-apikey`, optional `Authorization: Bearer …`, **and** optional
`X-User-Email`. Both `tools/list` and `tools/call` POST JSON-RPC 2.0 envelopes to the resolved
MCP endpoint.

> [!IMPORTANT]
> **The MCP identity contract deliberately differs from the AI Gateway's, and this is not
> drift.** The MCP demo is built around three personas — Admin, Sales Agent and Loans Agent —
> which exist to show *tool-level* authorization: the same `tools/list` call returns a
> different tool set per persona. Those personas are not real signed-in humans, so there is no
> SSO-derived JWT to carry them; the persona travels in `X-User-Email` and the corresponding
> product entitlement travels in `x-apikey`.
>
> The AI Gateway has the opposite requirement. It demonstrates *per-user* attribution, cost and
> quota against the real signed-in identity, so it takes identity from the JWT only and rejects
> the header. Migrating MCP to JWT-only would mean minting a JWT per synthetic persona, which
> buys symmetry and nothing else.

Consequence to keep in mind: an `X-User-Email` value sent to MCP is caller-asserted and
unverified. It selects which tools are offered, so the real access control there is the API
key and its product, not the header.

---

## 5. Response headers the UI consumes (Implemented)

### 5.0 What the gateway actually sets

[`AM-SetResponseHeaders.xml`](../apigee/proxies/ai-gateway-v1/apiproxy/policies/AM-SetResponseHeaders.xml)
sets **exactly twenty-eight** headers, and no others:

`x-gateway-model`, `x-gateway-provider`, `x-auto-routed`, `x-gateway-category`,
`x-gateway-router-category`, `x-gateway-router-engine`, `x-gateway-router-confidence`,
`x-gateway-cost-tier`, `x-gateway-cost-usd`, `x-gateway-currency`, `x-gateway-cached`,
`x-gateway-cache-status`, `x-gateway-prompt-tokens`, `x-gateway-completion-tokens`,
`x-gateway-total-tokens`, `x-gateway-token-quota-used`, `x-gateway-token-quota-limit`,
`x-gateway-token-quota-used-pct`, `x-gateway-token-quota-threshold-pct`,
`x-gateway-token-quota-status`, `x-gateway-token-quota-warning`, `x-gateway-budget-status`,
`x-gateway-budget-used-usd`, `x-gateway-budget-limit-usd`, `x-gateway-monetization-status`,
`x-gateway-prepaid-balance`, `x-gateway-prepaid-currency`, `x-gateway-balance-remaining`.

(This list previously said fifteen; the router, budget and token-quota headers were added later.)

The policy has `IgnoreUnresolvedVariables=true`, so a header whose source flow variable is unset is
emitted empty rather than omitted.

`apigeeClient` lower-cases and stores **every** response header in `telemetry.headersReceived`, then
reads the following explicitly:

| Header | Read at | Used for |
| --- | --- | --- |
| `x-gateway-cache-status` | [apigeeClient.ts#L212-L222](../ui/src/services/apigeeClient.ts#L212-L222) | `telemetry.cacheStatus` (`HIT` / `MISS` / `DISABLED`) |
| `x-gateway-cached` | [L217](../ui/src/services/apigeeClient.ts#L217) | Fallback when `x-gateway-cache-status` is absent |
| `x-gateway-model` | [L266](../ui/src/services/apigeeClient.ts#L266), [L308](../ui/src/services/apigeeClient.ts#L308) | Resolved model name |
| `x-gateway-provider` | [L260](../ui/src/services/apigeeClient.ts#L260) | Upstream provider |
| `x-auto-routed` | [L265](../ui/src/services/apigeeClient.ts#L265), [L310](../ui/src/services/apigeeClient.ts#L310) | Auto-routing badge |
| `x-gateway-cost-usd` | [L261](../ui/src/services/apigeeClient.ts#L261) | Cost readout (client-side estimate if absent) |
| `x-gateway-cost-tier` | [L262](../ui/src/services/apigeeClient.ts#L262) | Cost tier label |
| `x-gateway-prompt-tokens` | [L257](../ui/src/services/apigeeClient.ts#L257) | Prompt tokens when the body has no usage block |
| `x-gateway-completion-tokens` | [L258](../ui/src/services/apigeeClient.ts#L258) | Completion tokens |
| `x-gateway-total-tokens` | [L259](../ui/src/services/apigeeClient.ts#L259) | Total tokens |
| `x-gateway-prepaid-balance` | [L280](../ui/src/services/apigeeClient.ts#L280), [GatewayTraceViewer.tsx#L340](../ui/src/components/GatewayTraceViewer.tsx#L340) | Session-ledger baseline and the "Start Balance" tile |
| `x-gateway-monetization-status` | [GatewayTraceViewer.tsx#L309](../ui/src/components/GatewayTraceViewer.tsx#L309) | Wallet-depleted (403) styling |
| `x-gateway-balance-remaining` | [GatewayTraceViewer.tsx#L346](../ui/src/components/GatewayTraceViewer.tsx#L346) | "Remaining" tile |
| `x-gateway-token-quota-status`, `-used`, `-limit`, `-used-pct`, `-threshold-pct`, `-warning` | [tokenQuota.js](../ui/src/utils/tokenQuota.js) `parseTokenQuota`, called from [apigeeClient.ts](../ui/src/services/apigeeClient.ts) | `telemetry.tokenQuota` → token-quota banner and message chip (§5.2) |

The proxy also emits `x-gateway-currency` and `x-gateway-prepaid-currency`; the UI does not read
them today, though both appear in the raw headers accordion.

### 5.0.1 Headers the UI reads that the gateway never sets (dead reads)

> [!WARNING]
> Every lookup below resolves to `undefined` on every request. No policy in
> [`ai-gateway-v1`](../apigee/proxies/ai-gateway-v1) sets
> any of them — a repository-wide search of `apigee/` returns zero matches. Do not present these as
> gateway telemetry, and do not "fix" a blank value by looking for a proxy bug: the writer does not
> exist.

| Header | Read at | Actual effect |
| --- | --- | --- |
| `x-gateway-intent` | [apigeeClient.ts#L235](../ui/src/services/apigeeClient.ts#L235) | Always `undefined`. Second term of `effectiveCategory`; the gateway never sets this name. |
| `x-gateway-quota-remaining` | [ArchitectureBlueprintModal.tsx#L84](../ui/src/components/ArchitectureBlueprintModal.tsx#L84) | Always `undefined`; falls through to `x-ratelimit-remaining`, which the gateway does not set either, so `remainingTokens` is permanently empty. |

> [!NOTE]
> `x-gateway-category` **used to** be dead and was previously listed here. The LLM-router
> work added it to `AM-SetResponseHeaders`, and it is now emitted on every routed `/auto` call
> (verified against prod: `x-gateway-category: simple`), alongside
> `x-gateway-router-category`. The classifier is the **TypeSafe AI JEV System One** router
> (`SC-ModelRouter`, request built natively by `AM-PrepRouterRequest`, API key read by
> `KVM-GetRouterCredentials` from the encrypted `ai-gateway-creds` KVM). The chain runs in
> `AutoRoutingFlow`, i.e. **after** `SCL-Semantic-Cache-Lookup`, so a cache hit carries no
> category and no `x-gateway-model` — the trace viewer shows *Served from cache*.

Because `x-gateway-category` is now populated, the `Model Routing` card's intent label comes
solely from the gateway's own classification. The raw header value is a lowercase enum
(`simple` | `general` | `deep_reasoning` | `coding`), so it is passed through
[`formatRouterCategory`](../ui/src/services/apigeeClient.ts#L26-L53)
purely for display: `deep_reasoning` renders as `Deep Reasoning`. An unrecognised category is
title-cased rather than dropped, so a category added server-side still surfaces.

> [!IMPORTANT]
> The client no longer guesses the intent. A previous fallback substring-matched the model
> name to produce `General / Fast` / `Deep Reasoning` / `Coding`, which could not work:
> `gemini-3.5-flash-lite` (`simple`) and `gemini-3.6-flash` (`general`) both contain
> `flash`, and there was no `simple` branch at all, so every simple request was mislabelled
> `General / Fast`. It has been removed — the same reasoning that already applies to cost,
> which is never recomputed client-side. If the header is absent the label stays `undefined`
> and the trace viewer hides the chip, which is honest; a wrong label is not.
>
> `tests/intentlabel.unit.test.mjs` statically guards against the heuristic returning.

When the request was *not* auto-routed, `intent` stays `undefined`.

### 5.1 `GatewayTelemetry` type contract

[`ui/src/types/index.ts#L40-L81`](../ui/src/types/index.ts#L40-L81)
mixes fields that come from the gateway with fields the client computes. The distinction matters
when judging whether a number in the trace pane is authoritative.

| Field | Source | Notes |
| --- | --- | --- |
| `status`, `statusText` | Gateway | HTTP response line |
| `model` | Gateway, with fallback | `x-gateway-model`, else the requested model |
| `provider` | Gateway, with fallback | `x-gateway-provider`, else inferred from the model prefix |
| `autoRouted` | Gateway, with fallback | `x-auto-routed === 'true'`, else the client's `isAuto` flag |
| `costUsd` | **Gateway only** | `x-gateway-cost-usd`, else `undefined` — see the note below |
| `costTier` | **Gateway only** | `x-gateway-cost-tier`, else `undefined` — see the note below |
| `promptTokens`, `candidatesTokens`, `totalTokens` | Body first, then gateway | Response `usageMetadata` / `usage`, falling back to the token headers |
| `cacheStatus` | Gateway | `x-gateway-cache-status`, else derived from `x-gateway-cached` |
| `headersReceived` | Gateway | Every response header, lower-cased — **except** the two wallet keys, which the debit ledger overwrites |
| **`latencyMs`** | **Client** | `Math.round(performance.now() - startTime)` ([apigeeClient.ts#L195](../ui/src/services/apigeeClient.ts#L195)) — full browser round-trip including the local proxy hop |
| **`intent`** | **Client** | Always the heuristic in §5.0.1; the gateway sets no intent header |
| **`guardrailStatus`, `guardrailMessage`** | **Client** | Inferred by string-matching the 400 response body for `model armor` / `sanitize` / `blocked` / `sup-userprompt` ([L199-L204](../ui/src/services/apigeeClient.ts#L199-L204)) |
| `tokenQuota` | **Gateway only** | `parseTokenQuota(headersReceived)` from the `x-gateway-token-quota-*` headers; `undefined` on cache hits, errors, and proxy revisions without `JS-TokenQuotaThreshold` (§5.2) |
| `headersSent`, `rawRequest`, `endpointUrl`, `targetUrl`, `environment`, `user`, `userEmail`, `ssoUser`, `requestedModel` | Client | Request-side context |

> [!IMPORTANT]
> **The client never computes cost.** Both cost fields used to fall back to a client-side
> guess — a flat `$0.20 / 1M` blended rate, and a cost tier inferred by substring-matching the
> model name. The name heuristic was actively wrong: it would label `gemini-3.6-flash` cheap
> although it bills `9.00` per 1M output tokens, more than the newer `gemini-3.8-flash` (`3.75`).
> Both fallbacks are gone. `JS-CalculateCost` in the gateway is the single costing authority and
> now populates the headers on cache hits too, so the fallbacks had no legitimate caller left.
> When a header is genuinely absent the field stays `undefined` and `GatewayTraceViewer` hides
> the chip rather than showing a fabricated number.

The `x-*` keys at the bottom of the interface are **backwards-compatibility aliases**, not headers.
They are assigned from already-resolved values
([apigeeClient.ts#L331-L341](../ui/src/services/apigeeClient.ts#L331-L341)),
so reading `telemetry['x-gateway-cached']` gives the client's `cacheStatus === 'HIT'` verdict, not
the raw header.

> [!CAUTION]
> `x-gateway-latency-ms` is **not** a gateway header. It is `String(durationMs)` from the client
> stopwatch ([apigeeClient.ts#L340](../ui/src/services/apigeeClient.ts#L340)).
> The name is misleading — it measures browser round-trip, not gateway processing time.
>
> `x-pii-redacted` ([types/index.ts#L77](../ui/src/types/index.ts#L77))
> is **fully dead**: no policy sets it, nothing assigns it, and no component reads it. It is the only
> occurrence of the string in the entire repository. Delete it or implement it; do not document it as
> a capability.

> [!WARNING]
> Both balance tiles fall back to the hardcoded literal `109.988` when the headers are missing, so a
> plausible-looking balance can render even with no monetization data. Do not read those tiles as
> authoritative during a demo without confirming the headers are present.

MCP responses are filtered — [`extractResponseHeaders()`](../ui/src/services/mcpClient.ts#L53-L75)
keeps only: `content-type`, `x-request-id`, `x-cloud-trace-context`, `x-b3-traceid`, `x-b3-spanid`,
`date`, `server`, `via`, `x-powered-by`. `x-gateway-*` headers are therefore **not** visible in the
MCP trace even if the gateway sends them.

### 5.2 Token-quota threshold alert (Implemented)

**Gateway.** [JS-TokenQuotaThreshold](../apigee/proxies/ai-gateway-v1/apiproxy/policies/JS-TokenQuotaThreshold.xml)
runs in the `ai-gateway-v1` PostFlow right after `LTQ-TokenCount` (same condition: 200 and not
cached), and before `AM-SetResponseHeaders`. It compares `ratelimit.LTQ-TokenCount.used.count` with
the product limit `verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit` — not
`ratelimit.LTQ-TokenCount.allowed.count`, which is `Long.MAX_VALUE` for a `CountOnly` policy — and
emits:

| `x-gateway-token-quota-status` | Condition | UI |
| :--- | :--- | :--- |
| `ok` | used ≤ 50% (`threshold` property `0.5`) | nothing |
| `near-threshold` | 50% < used < 100% | amber banner *Nearing token quota threshold* |
| `exhausted` | used ≥ 100% | rose banner *Token quota exhausted* |

plus `-used`, `-limit`, `-used-pct`, `-threshold-pct` and a human-readable `-warning`. The policy is
`continueOnError="true"` and never blocks; blocking stays with `LTQ-TokenEnforce` (429). Design
detail: [proxy_architecture_design_plan.md §5.4](proxy_architecture_design_plan.md).

**UI.**

- [tokenQuota.js](../ui/src/utils/tokenQuota.js) (+ `.d.ts`): `parseTokenQuota(headers)`
  returns `{ status, used, limit, usedPct, thresholdPct, warning }`, or `undefined` unless the status
  is one of the three values and used / limit / pct are numeric. `isTokenQuotaAlert(signal)` is true
  for `near-threshold` and `exhausted`.
- `apigeeClient` stores the result as `GatewayTelemetry.tokenQuota`.
- [ChatPlayground.tsx](../ui/src/components/ChatPlayground.tsx) renders a banner at the top of
  the chat (`data-token-quota-banner`) from the **most recent message that carried the signal** —
  e.g. *"236 / 300 tokens (78.7% used, alert above 50%) in the current window"*. Cache hits and
  errors carry no signal, so they neither raise nor clear it; the next metered call does. Each
  alerting message also gets a small inline chip (`data-token-quota-alert`) with the percentage and
  the gateway's warning as its tooltip. The UI computes nothing: the status comes from the gateway.

**Demo.** The **Tokenomics** chip cycles 4 steps
([TOKEN_LIMIT_EXAMPLES](../ui/src/services/defaultSettings.ts)) on
`claude-haiku-5-5` (300 tokens / 1 min in both AI tiers). Each step is sent with
`PromptRequestOptions { stateless: true, maxOutputTokens: TOKEN_DEMO_MAX_OUTPUT_TOKENS (90) }`, so it
carries no chat history and costs ~120 tokens: ~40% → 200 `ok`; ~80% → 200 + amber banner;
over 100% → 200 + rose banner (still admitted — the counter was under the limit when it arrived); then
429. Verified on dev: 117/300, 236/300, 361/300, 429. Run within one minute (rolling window). The
Admin Console quota preset for the model is **300 tpm** (was 50), and the reset modal restores it.

Guarded by [tokenquota.unit.test.mjs](../ui/tests/tokenquota.unit.test.mjs) (gateway
script, wiring, parser, and prompt sync across the UI, `gateway-live.test.mjs` and
`test_token_limit.sh`).

---

## 6. Backend proxy endpoints (Implemented)

Two equivalent implementations exist: Vite dev middleware in
[`ui/vite.config.ts`](../ui/vite.config.ts#L667-L1588)
(the `configureServer` hook) and the production Node server
[`ui/server.js`](../ui/server.js).
Both mint a GCP access token server-side and call the Apigee Management API.

| Route | Methods | Server handler | Client wrapper |
| --- | --- | --- | --- |
| `/env-config.js` | GET | [server.js#L698](../ui/server.js#L698-L710) | `window.__RUNTIME_CONFIG__`, read by `defaultSettings.ts` |
| `/api/me` | GET (`?email=`) | [server.js#L713](../ui/server.js#L713-L772) | inline `fetch` in `apigeeClient` and `App.tsx` |
| `/api/me/onboard` | POST, PUT | [server.js#L775](../ui/server.js#L774-L854) | `DeveloperOnboardingModal` inline `fetch` |
| `/api/me/profile` | POST, PUT | [server.js#L778](../ui/server.js#L774-L854) | same handler as `/api/me/onboard`; used to rename an existing developer |
| `/api/kvm/rates` | GET, PUT, POST | [server.js#L857](../ui/server.js#L857-L958) | `fetchModelRates`, `updateModelRates` |
| `/api/monetization/balance` | GET (`?dev=`) | [server.js#L960](../ui/server.js#L960-L1015) | `fetchDeveloperBalance` |
| `/api/monetization/debit` | POST only | [server.js](../ui/server.js) → [walletLedger.js](../ui/server/walletLedger.js) | inline `fetch` in [apigeeClient.ts](../ui/src/services/apigeeClient.ts) |
| `/api/monetization/credit` | POST | [server.js#L1064](../ui/server.js#L1064-L1127) | `creditDeveloperBalance` |
| `/api/monetization/rateplans` | GET | [server.js#L1129](../ui/server.js#L1129-L1179) | `fetchRatePlans` |
| `/api/monetization/subscriptions` | GET, POST | [server.js#L1181](../ui/server.js#L1181-L1248) | `fetchDeveloperSubscriptions`, `subscribeDeveloper` |
| `/api/monetization/config` | GET, PUT, POST | [server.js#L1250](../ui/server.js#L1250-L1306) | `fetchDeveloperMonetizationConfig`, `updateDeveloperMonetizationConfig` |
| `/api/analytics/fleet-stats` | GET (`?timeRange=&env=`) | [server.js#L1308](../ui/server.js#L1308-L1532) | `fetchFleetAnalytics` |
| `/api/monetization/attributions` | GET | [server.js#L1534](../ui/server.js#L1534-L1680) | `fetchDeveloperAttributions` |

> [!IMPORTANT]
> `/api/monetization/debit` is **not** an Apigee route. It is a session ledger that bridges
> Apigee's ~15-minute prepaid-wallet settlement window. Logic lives in
> [walletLedger.js](../ui/server/walletLedger.js),
> shared by `server.js` and `vite.config.ts`, and is covered by
> [walletLedger.unit.test.mjs](../ui/tests/walletLedger.unit.test.mjs).
>
> - **POST only**: any other method returns `405 Method Not Allowed. Use POST.`
> - It takes `{ developer, amountUsd }`. The **starting balance is read from Apigee**
>   (`GET /v1/organizations/{org}/developers/{dev}/balance`, primary wallet) on every call.
>   It is never supplied by the browser and never defaulted. The old invented `110` USD fallback is gone.
> - Pending debits live in the in-memory `Map` `sessionLedgerByDev` (keyed by lower-cased email,
>   lost on restart/new revision). They are cleared when Apigee reports a new `lastCreditTime`
>   (a credit or settlement), and `/api/monetization/balance` subtracts them from the Apigee balance.
> - Returns `{ status, developer, debitedThisRequestUsd, totalDebitedSessionUsd, balanceSource,
>   startBalanceUsd, remainingBalanceUsd }`. `balanceSource` is `apigee` or `unavailable`; when
>   Apigee cannot be read both balances are `null` (the debit is still recorded).
> - `apigeeClient` calls it after every 2xx gateway response. Only when both balances are numbers does it
>   overwrite `x-gateway-prepaid-balance` / `x-gateway-balance-remaining`, so the Wallet tiles
>   chain across requests from a real Apigee balance. Otherwise the gateway's own headers are left as-is.

Pass-through proxies (prefix match):
`/api/ai-dev`, `/api/ai-prod`, `/api/mcp-dev`, `/api/mcp-prod`. Each prefix is
stripped and the remainder is appended to the environment's upstream base (`/ai/v1` or `/mcp`),
query string preserved. Anything else falls through to static file serving.

> [!WARNING]
> `/api/analytics/fleet-stats` can return **more than one `consumptionRows` entry for the same
> `(userEmail, model)` pair**. One comes from the Analytics-indexed traffic, the other from the
> wallet reconciliation block
> ([server.js#L1418-L1488](../ui/server.js#L1418-L1488)),
> which synthesises `gemini-2.5-flash` / `gemini-3.1-pro-preview` rows for prepaid spend that
> analytics has not indexed yet. `AnalyticsDashboard` therefore **merges duplicate pairs** in
> `allConsumptionRecords` before anything else consumes them. Do not remove that merge: the ledger
> table keys its rows on `` `${userEmail}__${model}` ``, so duplicate pairs produce duplicate React
> keys, and React then fails to unmount rows when the list shrinks — the symptom was the **User**
> filter updating the ledger title, model dropdown and KPI cards while leaving other users' rows
> visibly stranded in the table.

### Request Success Rate — how it is derived per scope

| Scope | Numerator source | Denominator |
| :--- | :--- | :--- |
| Admin · All Users | `kpis.isErrorCount` — `sum(is_error)` on the `apiproxy` dimension | `kpis.totalCalls` (server computes `kpis.slaHealth`) |
| Admin · single user | `errorCount` summed over that user's `consumptionRows` | `totalTraffic` of the same rows |
| User view | same, scoped to the signed-in email | same |

Per-user error data only exists because the proxy's `DefaultFaultRule` runs `DC-FaultAnalytics`,
which emits `dc_user_email` on the fault path. The server selects `sum(is_error)` on the
`dc_user_email,dc_model_name` dimension and returns it as `errorCount` on each row, plus
`kpis.attributedErrorCount` as the total.

**The query must be filtered to `(apiproxy eq 'ai-gateway-v1')`.** `dc_user_email` is an
environment-wide dimension, so an unfiltered query also returns `mcp` and any other proxy's
traffic. Those proxies never set the dimension, so their calls arrive bucketed as `(not set)`
and would be rendered in the AI Gateway ledger as anonymous AI callers. Measured on prod:
unfiltered 126 calls / 45 errors versus filtered 76 / 39, the latter matching the `apiproxy`
dimension exactly. Without the filter `attributedErrorCount` can exceed `isErrorCount`, which
is the symptom to look for if this regresses.

**Placeholder normalisation.** Apigee reports a dimension that was never written as
`(not set)`, but a dimension captured from an *unresolved variable* as the literal string
`null`. The fault path produces the latter whenever a request dies before
`DJWT-ExtractUserIdentity` — a malformed body rejected by `OAS-ValidateRequest`, or a request
with no JWT. The server therefore treats `(not set)`, `null`, `undefined` and empty as
equivalent, mapping the user to `anonymous.caller@external.client` and the model to
`unknown-model`. Matching only `(not set)` would surface a user literally named "null" in the
ledger.

> [!NOTE]
> The **dev environment has no Analytics add-on** — every stats query against it returns
> `400 invalid argument: Analytics add-on is disabled for dev environment`. Dev therefore has
> no real `consumptionRows` at all and falls back entirely to synthetic wallet-derived rows,
> which correctly renders the success-rate card as an em dash. Verify analytics behaviour
> against **prod** only.

> [!WARNING]
> Two failure modes this design exists to prevent:
>
> 1. **Never substitute a flattering default.** `slaHealth` and `faultCount` are `null` when the
>    scope has no error data, and the card renders an em dash with "Not recorded for this window".
>    The panel previously hardcoded `slaHealth: 100, faultCount: 0` for every non-fleet view, so an
>    individual user displayed a perfect 100% while the fleet displayed 54% — and deliberately
>    triggering Model Armor or a token-limit block changed nothing.
> 2. **Report only what was measured.** Where no measurement exists, the API returns `null` and
>    the UI renders an em dash. It does not interpolate, extrapolate or assume.

### No fabricated analytics

Every invented value has been removed. For the record, because each was load-bearing in a
customer-facing screen:

| Value | What it used to be | Now |
| :--- | :--- | :--- |
| `cacheHitRate` (fleet) | hardcoded `29.4` | `HIT / (HIT + MISS)` from `dc_cache_status` |
| `cacheHitRate` (per user) | hardcoded `33` whenever calls > 0 | `null` — the dimension is not broken down per user |
| `cacheCostSavingsUsd` | `totalSpend * 0.35` | priced from measured hits, `null` when none |
| Cache sparkline | literal `[8,11,14…38]`, always rising | removed |
| Routing "savings" badge | `flashPercent * 0.55` | "Saved up to $X": real tokens priced at the most expensive rate-card model minus actual cost (`utils/routingSavings.js`) |
| `flashPercent` with no traffic | `78.5` | `null` |
| Consumption rows | two rows per developer synthesised from wallet drift — call count `spend x 16`, tokens `spend x 48500`, a 65/35 token split and a 60/40 model mix | removed; the ledger shows only recorded traffic |
| Monetization `totalCalls` / `totalTokens` | `Math.max(measured, walletDrift x 16 / x 48500)` | measured only |
| Monetization spend | flat `$0.75` per million tokens | per-model input/output rates from the `ai-model-rates` KVM |

> [!CAUTION]
> Removing the synthetic consumption rows changes what **dev** looks like. Because the dev
> environment has no Analytics add-on, those rows were its *only* source of data — the dashboard
> reported 110 entirely imaginary calls. Dev now correctly shows an empty ledger. Use **prod**
> to demonstrate analytics.

A consequence worth stating plainly: a developer whose prepaid wallet was debited by traffic
Apigee never indexed will now show fewer calls than their wallet spend implies. That gap is
real. The previous code hid it by inventing calls to match the money.

> [!NOTE]
> The **Model Split Across Catalog** card shows every model with `cost > 0` in the Spend ($) view,
> formatting sub-cent values with four decimals. It previously required `cost >= 0.01`, which
> silently dropped cheap models from Spend while they remained visible under Tokens.

### 6.1 Actual payload shapes

`GET /api/monetization/balance` returns the raw Apigee response nested under `data` — **not** a
flattened `balance` number:

```json
{
  "status": "ok",
  "developer": "admin@example.com",
  "org": "your-gcp-project",
  "data": {
    "wallets": [
      { "balance": { "currencyCode": "USD", "units": "109", "nanos": 996920000 } }
    ]
  }
}
```

`POST /api/monetization/credit` takes `{ "units": "50", "developer": "…" }` (units is a **string**;
there is no `amount` or `currency` field) and returns:

```json
{
  "status": "ok",
  "developer": "admin@example.com",
  "credited": "50",
  "transactionId": "topup-1726309876",
  "data": { }
}
```

Currency is hardcoded to `USD` server-side
([server.js#L1099-L1103](../ui/server.js#L1099-L1103)). A
successful top-up also clears that developer's `sessionLedgerByDev` entry
([server.js#L1109](../ui/server.js#L1109)), so the Wallet
tiles restart from the freshly credited balance.

---

## 7. How semantic cache is actually demonstrated (Implemented)

### 7.1 Gateway side

| Policy | Detail |
| --- | --- |
| [`SCL-Semantic-Cache-Lookup`](../apigee/proxies/ai-gateway-v1/apiproxy/policies/SCL-Semantic-Cache-Lookup.xml) | Embeddings via `text-embedding-005`; `findNeighbors` on index endpoint `INDEX_ENDPOINT_ID`; deployed index `semantic_cache`; `Threshold` `0.95` |
| [`SCP-Semantic-Cache-Populate`](../apigee/proxies/ai-gateway-v1/apiproxy/policies/SCP-Semantic-Cache-Populate.xml) | `upsertDatapoints` on index `INDEX_ID`; `TTLInSeconds` `180` |

Both run only when `use-cache` (or `x-use-cache`) is `true`.

### 7.2 UI side — the two-step chip

[ChatPlayground.tsx#L276-L289](../ui/src/components/ChatPlayground.tsx#L276-L289)
renders a single **Semantic Cache** chip whose label flips with `cacheStep`:

| Step | Chip label | Prompt source | Effect |
| --- | --- | --- | --- |
| 0 | `⚡ Semantic Cache: Seed (Miss)` | `CACHE_EXAMPLES[0]` | Zero-trust payments-architecture prompt, executed live on Claude Opus (~14 s, ~$0.08) and seeded |
| 1 | `⚡ Semantic Cache: Instant Hit ($0)` | `CACHE_EXAMPLES[1]` | Semantically equivalent paraphrase, expected to hit (~1 s, $0) |

[`handleCacheStep()`](../ui/src/components/ChatPlayground.tsx#L359-L376)
forces the admin persona, `useCache: true`, `model: CACHE_DEMO_MODEL` (`claude-opus-5-5`),
`omitEmailHeader: false` and a stateless request before executing,
and clicking the chip body auto-advances 0 → 1 → 0. Two sub-buttons labelled `Seed (Miss)` and
`Instant Hit ($0)` let a presenter jump directly to either step. Jumping to `Instant Hit` when this
session has not seeded the cache in the last ~2 minutes (TTL 180 s minus a 60 s margin) runs the
seed first, announced by a grey system note in the chat (`planCacheSteps` in
[scenarioPrereqs.js](../ui/src/utils/scenarioPrereqs.js)). The Tokenomics sub-steps work the same
way via `planTokenSteps`: a later step runs the missing earlier ones inside the same 1-minute
window, or asks the presenter to wait if the window still holds an earlier run
([L641-L666](../ui/src/components/ChatPlayground.tsx#L641-L666)).

A sibling chip labelled `🌐 Direct (No Cache)` runs the same seed prompt with `useCache: false` for
latency contrast (preset `no-cache` in
[defaultSettings.ts#L441-L450](../ui/src/services/defaultSettings.ts#L441-L450)).

The chat footer also carries a persistent toggle rendering `Cache:` + `ENABLED` / `OFF`
([L902-L916](../ui/src/components/ChatPlayground.tsx#L902-L916)).

> [!NOTE]
> The six chips are defined inline as `sampleChips`
> ([ChatPlayground.tsx#L208](../ui/src/components/ChatPlayground.tsx#L208));
> their titles and badges are looked up from
> `SCENARIO_PRESETS` in [defaultSettings.ts#L390-L451](../ui/src/services/defaultSettings.ts#L390-L451).
> The default session starts with `useCache: false`
> ([defaultSettings.ts#L247](../ui/src/services/defaultSettings.ts#L247)).

---

## 8. Trace viewers (Implemented)

### 8.1 `GatewayTraceViewer.tsx`

Empty state reads **"Ready for Gateway Traffic"**. Once telemetry exists, the panel header shows
`Gateway Telemetry` plus an `HTTP <status> <statusText>` pill, followed by six cards:

| # | Card heading | Key behaviour |
| --- | --- | --- |
| 1 | `Model Routing` | Model, provider, cost tier, intent, `Auto-Routed` pill, cost chip |
| 2 | `Token` | Prompt / Output / Total tiles; on 429 swaps to a quota-exceeded banner |
| 3 | `Latency` | Round-trip ms, colour-banded; on a hit shows `Vector Cache (~90% Faster)` |
| 4 | `Semantic Cache` | Toggle pill + outcome line (see below) |
| 5 | `Model Armor` | `Secured` or `Blocked (400)` with the guardrail message |
| 6 | `Wallet` | `Prepaid Active` or `❌ Depleted (403)`; Start Balance / Remaining tiles |

Semantic Cache card states
([L217-L266](../ui/src/components/GatewayTraceViewer.tsx#L217-L266)):

| Condition | Toggle pill | Outcome text |
| --- | --- | --- |
| `useCache` on, `cacheStatus === 'HIT'` | `use-cache: true` | `Vector Cache Hit` + `$0 Token Cost` |
| `useCache` on, not a hit | `use-cache: true` | `Cache Miss (Seeded to Vector DB)` |
| `useCache` off | `use-cache: omitted` | `Bypassed (Direct LLM Inference)` |

The pill is a button wired to `onToggleCache`, so cache can be flipped mid-demo from the trace pane.

A collapsible **"Inspect HTTP Headers & Raw JSON"** accordion
([L353-L435](../ui/src/components/GatewayTraceViewer.tsx#L353-L435))
exposes three blocks:

- **Gateway Response Headers (`x-gateway-*`)** — filtered to keys starting `x-gateway`, `x-auto`,
  `content-type`, `x-accel`.
- **Request Headers Sent** — any key containing `apikey` is masked as `first8…last6`; a `Bearer`
  value renders as `Bearer <12 chars>…<8 chars> (Google SSO Token)`.
- **Raw JSON Response** — with a `Copy` button that copies `telemetry.rawResponse` only.

### 8.2 `McpTraceViewer.tsx`

The MCP Gateway trace inspector mirrors the executive layout of `GatewayTraceViewer.tsx` so that non-technical viewers see structured business data first, while technical architects can expand the wire protocol on demand:

1. **Executive Telemetry Summary Card** (Full-width top card):
   - **MCP Operation Card**: Displays the JSON-RPC method (`tools/list` or `tools/call (<toolName>)`) in full without truncation, a `JSON-RPC 2.0` protocol badge, and round-trip latency (`ms`) on a single line with color-coded thresholds.

2. **Structured Visual Result View** (Primary default view, replacing raw JSON dumps):
   - **Tool Discovery Catalog (`tools/list`)**: Renders a 4-column table (`Tool Name`, `Domain`, `Parameters`, `Description`) and highlights required input fields. The `Domain` column uses business capabilities, grouped and coloured by source API: `Customers`, `Orders`, `Pricing`, `Support`, `Refunds` (Customer Service API, cool colours) and `Finance`, `Customer Analytics` (Business Insights API, warm colours); tools from other MCP servers (BigQuery, ServiceNow) keep their own domains. The array order is also the table's sort order, so each API's tools sit together.
   - **Array Result Table (`tools/call` returning arrays, e.g. `listCustomerOrders`, `searchCustomers`)**: Dynamically constructs columns from returned object keys with formatted currency values and monospace ID chips.
   - **Business Entity Record Table (`tools/call` returning single objects, e.g. `getOrderStatus`, `getCustomer`, `getSupportMetrics`)**: Flattens nested objects into a 2-column property table with section headers and styled status badges (e.g. `Delayed`). Nested arrays of objects inside the record (e.g. a metrics breakdown) are collected with a dotted path label and rendered as their own tables.
   - **Gateway & Service Diagnostic Card (HTTP 429 / 401 / 403 or upstream faults)**: Displays a clear policy enforcement banner alongside a structured table of diagnostic fields (`Diagnostic Message`, `Error Code`). A `REFUND_LIMIT` fault (or any fault with `enforcedBy: "Apigee"`) is a business rule, not an entitlement denial: its plain-language status reads **Needs approval** rather than *Blocked: not allowed*.

3. **Collapsible Technical Accordion (`Inspect JSON-RPC Wire Payload & HTTP Headers`)**:
   - Collapsed by default (`showTechnicalDetails = false`) so raw JSON never intimidates users; automatically opens if deep-linked via `?subtab=response|request|headers`.
   - When expanded, reveals three tabs: **JSON-RPC Response**, **JSON-RPC Request**, and **Headers**, plus a tab-aware **Copy** button.
   - The **Headers** tab displays two theme-aware cards (**"Headers Received from Gateway"** and **"Headers Sent by Client"**) with live header count badges and `x-apikey` masking (`first8...last4`).

---

## 9. Proposal — NOT BUILT: `SemanticCacheView.tsx`

> [!WARNING]
> Everything in this section is an unimplemented design proposal retained for historical context.
> No file, tab, route, or component described here exists in the repository. Do not cite it as
> current behaviour.

The original proposal called for:

1. A fifth studio tab `semantic-cache` in `Navbar.tsx`, labelled `Semantic Cache`, using a
   `Database` or `Zap` icon.
2. A new `ui/src/components/SemanticCacheView.tsx` containing:
   - Four KPI cards: Cache Hit Rate, Latency Reduction, Cumulative Cost Avoidance, Vector Search
     Health.
   - A two-stage interactive simulator (seed request, then a paraphrased near-match query).
   - A table of cached vector entries with per-row "Test Hit" actions.
   - Query history and simulated cache-invalidation controls.
3. A wallet balance chip in the header or trace viewer, plus an in-trace "Add Credits" trigger
   posting to `/api/monetization/credit` with preset amounts.

What was delivered instead:

| Proposed | Delivered |
| --- | --- |
| `semantic-cache` tab | None — cache demo lives in the `ai-gateway` tab |
| KPI cards | Aggregate cache hit-rate / savings surface only in `AnalyticsDashboard` via `/api/analytics/fleet-stats` |
| Two-stage simulator | Two-step chip in `ChatPlayground` (Section 7.2) |
| Cached vector entries table | Not built — no UI enumerates cache datapoints |
| Cache invalidation controls | Not built — the only expiry is the 180 s `TTLInSeconds` in `SCP-Semantic-Cache-Populate` |
| Wallet chip + in-trace top-up | Trace viewer shows read-only balance tiles and the text `Prepaid balance exhausted ($0.00). Top up in Monetization tab.` Top-up lives in the `MonetizationManager` modal **"Top-Up Prepaid Wallet"** with quick amounts `+$10 / +$25 / +$50 / +$100` and a `Confirm Top-Up` button |

The proposed KPI figures (`68.4%` hit rate, `~98.5% Speedup`, `$12.84 Saved`) were illustrative
placeholders and were never backed by data. Any revived design should compute them from
`/api/analytics/fleet-stats`, which already returns `cacheHitRate` and `cacheCostSavingsUsd`
([api.ts#L171-L182](../ui/src/services/api.ts#L171-L182)).

---

## 10. Development & verification checklist

Completed:

- [x] `SemanticCacheView.tsx` decision resolved — not built; documented as a proposal above.
- [x] Tab routing verified: 4 Navbar buttons over a 6-value `AppTab` union.
- [x] Request/response header contracts verified against `apigeeClient.ts` and `mcpClient.ts`.
- [x] Monetization and analytics routes re-verified against `server.js` on 2026-09-17 — the previous
      tick was stale. `/api/monetization/debit`, `/api/me/onboard`, `/api/me/profile`,
      `/env-config.js` were missing, the `/api/kvm/rates` and
      `/api/monetization/config` method lists omitted `POST`, and every line anchor was off by
      +275 to +528. All corrected in Section 6.
- [x] `McpTraceViewer` Headers tab rebuilt: theme-aware cards, header counts, `x-apikey` masking,
      combined JSON export on Copy.
- [x] Brand word removed from rendered UI text; logo symbol retained.

Still to run per change:

- [ ] `npm run build` in `ui/` (`tsc && vite build`) — must pass with no TypeScript errors.
- [ ] `npm run dev` — Vite dev server listens on `http://localhost:3000`
      ([vite.config.ts#L1590-L1591](../ui/vite.config.ts#L1590-L1591)).
- [ ] Exercise tab switching across *AI Gateway*, *MCP Gateway*, *Analytics & Cost* and
      *Admin Console* (admin persona required for the last one).
- [ ] `npm run test:live` — runs
      [`tests/gateway-live.test.mjs`](../ui/tests/gateway-live.test.mjs)
      against **prod only**. Dev is never a live-test target: it is a shared sandbox that users
      (and Ask Apigee) change directly, so a dev run measures whatever was last edited, not
      this repo. The suite refuses any `TEST_ENV` other than `prod`, and refuses to start without
      `TEST_ALLOW_PROD=1` (which `test:live`, `test:live:prod` and `test:all` set). It is not
      read-only — it burns token quota, debits the prepaid budget and seeds the shared semantic
      cache — so run it deliberately. With `node server.js` on `:3000` it goes via the local
      proxy (`/api/ai-prod`); otherwise it calls the prod Apigee host directly and skips the
      local-proxy-only tests. The suite prints a provenance banner naming the target, JWT
      identity and API key sources before the first test.

  > [!IMPORTANT]
  > **`ui/.env` is a hard prerequisite.** The script is
  > `node --env-file=.env --test tests/gateway-live.test.mjs`
  > ([package.json#L14](../ui/package.json#L14)), and Node
  > exits with an error before running a single test if the file is missing. `.env` is gitignored
  > ([ui/.gitignore#L3](../ui/.gitignore#L3)), so a fresh
  > clone will always fail here until you create it. `npm run test:all` has the same requirement;
  > `npm run test:unit` does not.

- [ ] `npm test` (same file list as `npm run test:unit`) — offline unit suites in `ui/tests/*.unit.test.mjs`.
      UI-relevant ones: `intentlabel`, `cachemodelattribution`, `cacheanalytics`,
      `monetizationsorting` and `guardrailpolicies`. The last one also checks that every
      AI-gateway policy shown in the console/blueprint exists in the `ai-gateway-v1` bundle and
      that the router control lists the `AutoRoutingFlow` steps in order. After editing
      `data/guardrailPolicies.ts`, run `npm run gen:guardrail-catalog`.

---

## 11. Known UI inaccuracies worth fixing in code

These are defects in the application, not in this document:

| Location | Issue |
| --- | --- |

Previously listed here and now **resolved** by deletion: the dead `ModelRateCardView.tsx` and
`ScenarioPresets.tsx` components, and the unused `exhaustLlmQuota` export in `apigeeClient.ts`.
