# Apigee AI & Tools Gateway with Google ADK

This repository is an enterprise demonstration and development platform for:
1. **Apigee API Management**: API governance, security, rate-limiting, and developer enablement.
2. **Apigee AI Gateway**: Intelligent auto-routing across Gemini and Anthropic Claude models, product-driven LLM token quotas, Model Armor prompt guardrails, response sanitization, semantic caching, and per-request cost attribution.
3. **Apigee Tools Gateway**: Centralized tool/function execution governance, agent authentication, and native MCP (Model Context Protocol) serving.
4. **Google ADK (Agent Development Kit)**: Dual-pattern Python agents that consume Apigee gateways for models and tools, and are hosted as managed backend microservices fronted by Apigee.
5. **Interactive Demo UI**: React + Vite + Tailwind playground with real-time gateway trace inspection, token/latency/cost metrics, and live policy toggles.

> [!WARNING]
> **`gemini-2.5-flash` is RETIRED.** Ahead of its 2026-10-20 end of life it was removed from both API Products and from the UI dropdown, and is now entitled by nothing — calling it returns 401 at `VA-VerifyAPIKey`. Its **rate-card entry, `model_rates.properties` rate, `CalculateCost.js` prefix entry and analytics colour mapping are deliberately retained**, because `server.js` recomputes historical analytics cost by looking the model up in the rate card; deleting them would silently re-cost past traffic at the `default` rate. Do not "clean up" those.
>
> The **token-quota demo runs on `claude-haiku-4-5@20251001` at 50 tok/min** on both AI tiers, enforced by `LLMTokenLimitFlow`. Claude hosts it correctly because `JS-FormatClaudeResponse` synthesises `usageMetadata.totalTokenCount` in the *target* response flow, before `LTQ-TokenCount` reads it in PostFlow.
>
> **Verified callable targets** (probed against the live publisher catalog 2026-09-19; a fabricated ID and both `gemini-3.{7,8}-flash-lite` returned 404 on the same endpoint, so the probe discriminates): `gemini-3.1-flash-lite` (both tiers), `gemini-3.7-flash` and `gemini-3.8-flash` (Enterprise only — priced, in `AVAILABLE_MODELS`, and **proven with a real `generateContent` call through prod**).
>
> **`gemini-3.5-flash` was removed** from the `ai-gateway-v1` bundle, the rate card and the property set. It is GA in the catalog but was in no API product, so it was unreachable and its price key could never resolve. It **remains a live default in the separate `apigee-go-gen` template set** (`_helpers.tmpl` medium tier and `simple_chat` task, plus several `resources/jsc/` fallbacks) — that set is self-consistent and was deliberately left untouched. Do not "clean up" those references without substituting a model the template catalog actually lists.

> [!CAUTION]
> **A "flash" name does not imply a cheap model.** `gemini-3.7-flash` and `gemini-3.8-flash` list at **$1.50 / $7.50** per 1M tokens — *more* than `gemini-3.1-pro-preview` at $1.25 / $5.00. Never classify cost tier by substring-matching a model name; read `tier` from the rate card ([model_rate_card.json](apigee/config/model_rate_card.json)), which is the version-controlled source of truth for the `ai-model-rates` KVM and is published with [sync_rate_card.sh](apigee/scripts/sync_rate_card.sh). A model entitled in a product but absent from the card is silently billed at the `default` rate.
>
> These are also **thinking models**: `usageMetadata.thoughtsTokenCount` is billed at the output rate but is *not* part of `candidatesTokenCount`. Billable completion is `candidates + thoughts`.

---

## Repository Structure Overview
- [`.gemini/rules/`](.gemini/rules/): Specialized rules for Apigee XML, Python ADK, and React/Tailwind.
- [`.gemini/skills/`](.gemini/skills/): On-demand procedural playbooks for proxy generation, policy tuning, and agent scaffolding.
- [`.gemini/agents/`](.gemini/agents/): Subagent personas (Apigee Architect, ADK Engineer, Gateway Tester).
- [`apigee/`](apigee/): Apigee X proxy bundles (`proxies/`), API products (`products/`), developer apps (`apps/`), templates, and deployment scripts (`scripts/`).
- [`agents/`](agents/): Python ADK agent microservice (FastAPI + Cloud Run ready) using the Dual-Pattern.
- [`ui/`](ui/): React + Vite + Tailwind demo testing playground with live gateway telemetry, served in production by [`server.js`](ui/server.js) on Node.
- [`docs/`](docs/): Architecture specs, policy guides, and step-by-step customer demo walkthrough scripts.

### Proxy bundles
| Bundle | Status | Purpose |
| --- | --- | --- |
| `ai-gateway-v1` | **Primary / active** | The AI Gateway. All new work lands here. |
| `mcp` | **Active** | Native MCP Tools Gateway. |
| `bigquery-mcp` | **Active** | Dedicated BigQuery MCP Tools Gateway. |
| `servicenow-mcp` | **Active** | Dedicated ServiceNow Incident Management MCP Gateway. |

---

## Core Guidelines for Agentic Development

1. **Apigee Standards**: Keep proxy bundles compliant with Apigee X directory structures (`apiproxy/{proxies,targets,policies,resources}`). Name policies with the type prefix already established in the bundle — `AM-`, `CORS-`, `DC-`, `DJWT-`, `EV-`, `JS-`, `KVM-`, `LTQ-`, `ML-`, `MLC-`, `OAS-`, `QC-`, `RF-`, `SCL-`, `SCP-`, `SMR-`, `SUP-`, `VA-` in `ai-gateway-v1`, plus `PP-` and `Q-` in `mcp`. **This list scopes only the two hand-maintained XML bundles.** [`apigee/templates/ai-gateway/policies/`](apigee/templates/ai-gateway/policies/) is a separate `apigee-go-gen` YAML policy set with its own conventions — it adds an `SC-` prefix (`SC-LLMJudge.yaml`) that appears in neither XML bundle, and uses lowercase, hyphenated suffixes (`AM-model.yaml`, `JS-extract-prompt.yaml`) instead of PascalCase. Match whichever set you are editing; do not normalise one to the other.

2. **Quotas come from the API Product, never hardcoded**: LLM token limits are defined in `llmOperationGroup.operationConfigs[].llmTokenQuota` in [`apigee/products/`](apigee/products/). The `LTQ-TokenEnforce` and `LTQ-TokenCount` policies read them dynamically via `countRef="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit"` and matching interval/timeunit refs. Literal values in the policy XML are fallback defaults only — do not treat them as the effective limit, and do not introduce per-limit policy variants.

3. **ADK Dual-Pattern**: Ensure agents route model calls through the AI Gateway and tool calls through the Tools Gateway. Avoid hardcoding direct Vertex AI or backend URLs in the agent core.

4. **Traceability**: Gateway responses carry `x-gateway-*` trace metadata set by [`AM-SetResponseHeaders`](apigee/proxies/ai-gateway-v1/apiproxy/policies/AM-SetResponseHeaders.xml) — including `x-gateway-model`, `x-gateway-provider`, `x-auto-routed`, `x-gateway-cached`, `x-gateway-total-tokens`, and `x-gateway-cost-usd`. Preserve these; the UI trace inspector depends on them.

5. **UI branding constraint**: The word "Apigee" has been deliberately removed from all **user-facing UI text**; the 4-colour logo symbol is retained. Do not reintroduce it into rendered strings. This applies only to visible UI copy — code identifiers (`ApigeeLogo`, `apigeeClient.ts`, `sendPromptToApigee`) and technical prose about the Apigee platform intentionally keep the name.

6. **UI theming hazard**: [`ui/src/index.css`](ui/src/index.css) carries aggressive light-theme `!important` overrides (e.g. `html[data-theme="light"] .text-slate-200`). Never pair an inline dark `backgroundColor` with Tailwind slate text classes — it renders invisible text in light mode. Use `bg-white dark:bg-slate-900` class pairs instead.

7. **Validation**: Test proxy bundles and Python ADK endpoints before proposing cloud deployment. Run `npm test` and `npm run build` in [`ui/`](ui/) before shipping UI changes. `npm run test:live` targets **prod only** (it sets `TEST_ALLOW_PROD=1`; there is no `TEST_ENV`) and spends prod quota/budget — run it after deploying, not as a pre-merge check. Never use `dev` for automated verification: it is a shared sandbox people edit directly.

8. **Documentation is part of the change — always update the docs.** Any change to proxy policies, API products, the model catalog, rate cards, or UI behaviour MUST update the affected files in [`docs/`](docs/) and [`README.md`](README.md) in the *same* change. Do not defer this or offer it as a follow-up.

9. **Never commit credentials.** No consumer key, token, or secret may appear as a literal in a version-controlled file — not even as a convenience fallback such as `${API_KEY:-<literal>}`. Scripts and tests must read from the environment or `/api/me` and fail loudly when unset. Note that removing a committed secret does **not** purge it from git history; it must also be revoked in Apigee.

10. **Entitlements are named models only.** API products must never grant `model="*"` or use a `**` resource glob. Each model is granted explicitly by name.

11. **Apigee resource glob trap**: `*` matches within a single path segment and requires **at least one** trailing character — so `/auto*` does **not** match a bare `/auto`. A trailing `*` placed directly after a model name also leaks siblings (`/models/gemini-2.5-flash*` grants `gemini-2.5-flash-lite`). Use the `:*` form, which absorbs only the `:generateContent` suffix, and grant suffix-less paths such as `/auto` as exact resources.

12. **Verify model IDs against the live publisher catalog before referencing them.** Four IDs (`gemini-3-flash`, `claude-3-5-haiku`, `claude-3-5-sonnet`, `claude-3-7-sonnet`) were referenced throughout the proxy, products, UI and docs but do not exist in `your-gcp-project` and returned 404. There is no `claude-3-x` generation in this project at all.

13. **API products carry only the attributes listed here.** Those are `access: private`, which Apigee itself interprets, and — on the two AI tier products only — the three budget attributes `developer.budget.limit` / `.interval` / `.timeunit` read by `QC-EnforceBudgetLimit` and `QC-DeductBudget` (Enterprise `20000000` micros = $20/month, Standard `5000000` = $5/month; see rule 2, quotas come from the product), plus the four **routing attributes** `routing.model.coding` / `.deep_reasoning` / `.simple` / `.general` read by [`AutoRouting.js`](apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/AutoRouting.js) on the `/auto` path. Do **not** reintroduce `tier`, `description`, `domain` or other *descriptive* attributes — those were removed because nothing read them. The distinction that matters is **read vs. decorative**: an attribute earns its place only when a policy resolves it at runtime.

    **The routing attributes are the model map.** One attribute per category the router model can emit, valued with a model the *same product also entitles* (`ui/tests/autorouting.unit.test.mjs` asserts both halves of that). `AutoRouting.js` indexes them directly — `...apiproduct.routing.model.<category>` — and carries **no model literal and no prompt heuristics of its own**; a category the product does not map falls back to `routing.model.general`, and a product that declares none resolves no model at all rather than silently handing out one it may not entitle. This is what makes a tier cap real: `coding` resolves to `claude-opus-4-5@20251101` on Enterprise and to `gemini-3-flash-preview` on Standard from the *same* classification. `flow.routingTier` is still derived from the product **name** for tracing only — it no longer selects a model.

    > [!WARNING]
    > This rule previously asserted that `verifyapikey.VA-VerifyAPIKey.apiproduct.<custom>` **"will not resolve"**. That is **false** and was disproven by direct experiment on 2026-09-20: a custom attribute named `developer.budget.limit` resolves at exactly that dotted path, moving the reported cap from the literal fallback `100.000000` to `200.000000`, and `.interval` / `.timeunit` resolve too (switching `month`→`hour` lands on a fresh quota counter bucket). Avoiding descriptive attributes is a deliberate design preference, **not** a platform limitation — do not use the old rationale to argue that an attribute-driven design is impossible.
    >
    > **Propagation is ~10s and not uniform across message processors.** During that window concurrent requests can observe the old and the new value. An earlier probe that slept a fixed 6s read a stale processor and produced a false "does not resolve" result. Always **poll until the change is observed** rather than sleeping.

    Related Apigee constraint: an `operationConfig` must contain **exactly one** `llmOperation` — zero is rejected with `400 Operations must contain exactly one entity but found 0 entities`, so when removing an operation delete its wrapper too.

14. **One AI ingress surface — do not re-add native passthrough.** `ai-gateway-v1` exposes exactly two paths: `POST /ai/v1/auto` and `POST /ai/v1/models/{model}:generateContent` (plus `:streamGenerateContent`, which is declared in the OpenAPI spec purely so `OAS-ValidateRequest` gives a clean error, and is then refused with **501 `UNIMPLEMENTED`** by `RF-StreamingNotSupported` — it previously fell through and answered a streaming request with a non-streaming 200). The native `/v1/projects/**` and `/v1/messages` shapes and the unroutable `/models/auto` grant were deliberately removed from the proxy flows, the OpenAPI spec and every API product. **Claude uses the same path and the same Gemini `contents` body as Gemini** — the gateway converts the request and `SMR-SanitizeModelResponse` normalises the reply, so an Anthropic-shaped `messages` body is now correctly rejected with 400 by `OAS-ValidateRequest`. Note `/v1/projects/...` and `:rawPredict` legitimately remain in the **upstream target templates** (`AM-RouteGeminiTarget` / `AM-RouteClaudeTarget`); those are outbound URLs, not ingress paths, and must not be touched.

15. **Branching, Dev Isolation, and Staging Review**:
    - **Always work on a dedicated branch**: Never commit directly to `main`. Create a new branch for every feature, bugfix, or experiment (`git checkout -b <branch-name>`).
    - **Never deploy directly to production (`prod`)**: Production (`prod` environment / live UI) is used by field teams for live customer demos and must remain unbroken and stable.
    - **Deploy to `dev` only when there is a code change to test**: Do not deploy to the `dev` environment unless there are new code or configuration changes on the branch requiring integration testing.
    - **No automated verification on `dev`**: `dev` is a shared sandbox people change directly, so test results there are meaningless. Validate with unit tests + `npm run build`, deploy, then run `npm run test:live` against prod. A manual look at a dev UI instance is optional and never a substitute for those checks.

16. **Ask Apigee is dev-only — keep it that way.** The Admin Console's Ask Apigee assistant (formerly "Admin Agent" / "Admin Copilot"; never call it "Copilot"; runs on `gemini-3.1-flash-lite`, fallback `gemini-3-flash-preview`) is served by [`ui/server/adminAgentService.js`](ui/server/adminAgentService.js) from both `server.js` and `vite.config.ts`. It may write only the `(Dev)` product clones, only on the `dev` environment (`assertWritableDevProduct` + `assertDevOnlyEnvironments`, enforced server-side at the Apigee write). There is no promote-to-prod path; `/api/admin-agent/promote` returns 403. Production product changes go through a PR against `apigee/products/`. Do not add a write path that bypasses these guards.

