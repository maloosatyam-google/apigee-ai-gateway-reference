---
name: ai-gateway-policy-manager
description: >-
  Design, scaffold and operate an Apigee X AI Gateway in front of Vertex AI (Gemini and Anthropic Claude).
  Use for model routing (direct and /auto classifier routing driven by API product attributes),
  Model Armor guardrails (SanitizeUserPrompt / SanitizeModelResponse), LLM token quotas
  (LLMTokenQuota enforce/count pair, PromptTokenLimit), semantic caching (SemanticCacheLookup/Populate),
  cost and budget governance (KVM rate card, Quota micro-dollar budgets, MonetizationLimitsCheck + DataCapture),
  per-user attribution, and gateway telemetry headers. Standalone: includes a scaffold script that
  generates a deployable bundle and API product.
---

# AI Gateway Policy Manager

Build a **model-agnostic AI Gateway** on Apigee X. Clients call one endpoint with one API key.
The gateway authenticates, screens, rate-limits, caches, routes, prices and logs every LLM call.
This skill is self-contained. It pairs with `apigee-proxy-builder` (general proxy authoring and
the `validate_bundle.py` / `deploy_bundle.sh` scripts), but does not require it.

## When to use
- "Put Apigee in front of Gemini / Claude", "add Model Armor", "token quota per user/app/model"
- "semantic cache", "auto-route prompts to the cheapest suitable model", "budget / chargeback / prepaid wallet"
- Reviewing or debugging an LLM proxy (quota never trips, cache never hits, cost is wrong, 404 with an empty model)

## Quick start (demo in about 10 minutes)

```bash
SK=<path-to>/.gemini/skills
# 1. Generate a governed bundle + matching API product
python3 $SK/ai-gateway-policy-manager/scripts/scaffold_ai_gateway.py --out ./ai-gateway-v1 \
  --project $PROJECT --token-quota --prompt-token-limit 5000pm \
  --armor-region $REGION                       # optional: Model Armor (create templates first)
  # --cache-region $REGION --index-endpoint-host H --index-endpoint-id E --index-id I   # optional semantic cache
  # --claude                                   # optional Anthropic-on-Vertex target

# 2. Validate + deploy (runtime SA needs roles/aiplatform.user [+ roles/modelarmor.user])
python3 $SK/apigee-proxy-builder/scripts/validate_bundle.py ./ai-gateway-v1
bash    $SK/apigee-proxy-builder/scripts/deploy_bundle.sh ./ai-gateway-v1 --org $ORG --env $ENV --sa $RUNTIME_SA

# 3. Product + app, then call it
TOKEN=$(gcloud auth print-access-token); API=https://apigee.googleapis.com/v1/organizations/$ORG
sed "s/<ENV>/$ENV/" ./ai-gateway-v1/api_product.json | curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d @- $API/apiproducts
# create a developer + app with that product (UI or apigeecli), then:
curl -si https://$HOST/ai/v1/models/gemini-3-flash-preview:generateContent -H "x-apikey: $KEY" \
  -H 'Content-Type: application/json' -d '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}' | grep -i x-gateway
```

Demo script ideas: jailbreak prompt → 403 from Model Armor. Loop calls → 429 from
`LLMTokenQuota`. Send the same question twice with `x-use-cache: true` → `x-gateway-cache-status: HIT`
(this skips the model, so no tokens are charged).

## Architecture (request lifecycle)

```text
Client ── x-apikey (+ optional user JWT) ──▶ ProxyEndpoint /ai/v1
 PreFlow   identity (EV bearer → DecodeJWT → flow.emailId) → JS extract prompt/model → VerifyAPIKey
           → cheap refusals (unsupported path / streaming) → SanitizeUserPrompt → PromptTokenLimit
           → MonetizationLimitsCheck → budget Quota (EnforceOnly) + RaiseFault → strip auth
           → [opt-in] SemanticCacheLookup ─── HIT ──▶ response (skips target + conditional flows)
 Flows     (miss only) LLMTokenQuota EnforceOnly; /auto: KVM creds → ServiceCallout classifier → JS route
 Target    AM sets target.url (Gemini :generateContent | Claude :rawPredict), target.copy.pathsuffix=false,
           GoogleAccessToken auth; Claude path converts request/response shapes
 PostFlow  EV usage → KVM rate card → JS cost → budget Quota (Weight) → LLMTokenQuota CountOnly
           → DataCapture (analytics + monetization) → SemanticCachePopulate → SanitizeModelResponse
           → x-gateway-* headers
 PostClientFlow MessageLogging · DefaultFaultRule(AlwaysEnforce) DataCapture for blocked calls
```

Full policy XML is in [`../apigee-proxy-builder/references/policies_ai_gateway.md`](../apigee-proxy-builder/references/policies_ai_gateway.md)
(if that skill is absent, the scaffold output is a complete working example).

## 1. Model routing
- **Direct:** `POST /models/{model}:generateContent`. `EV-RequestDetails` sets `flow.model` from the path,
  and AM in the TargetEndpoint builds
  `https://aiplatform.googleapis.com/v1/projects/{p}/locations/global/publishers/google/models/{flow.model}:generateContent`.
- **Claude on Vertex:** `.../publishers/anthropic/models/{model}:rawPredict`. The body must use the Anthropic Messages
  shape with `"anthropic_version": "vertex-2023-10-16"`. Select it with a RouteRule on `flow.target_provider == "anthropic"`.
- **Auto routing (`/auto`):** a ServiceCallout classifies the prompt (for example coding / deep_reasoning / simple /
  general), and JS reads the target model from the **API product attributes**
  `routing.model.<category>` (`verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.coding`). Each persona
  product therefore gets its own model map without any proxy change. Fall back to `routing.model.general`.
- Details and pitfalls: [references/model_routing_playbook.md](references/model_routing_playbook.md).

## 2. Guardrails (Model Armor)
- Create templates (`gcloud model-armor templates create ...`) for prompt and response. Grant the runtime SA
  `roles/modelarmor.user`.
- `SanitizeUserPrompt` goes **after** VerifyAPIKey, so you do not pay for screening unauthenticated traffic. Use
  `continueOnError="false"` to block.
- `SanitizeModelResponse` goes in the PostFlow on 200. Its default extraction expects the Gemini response shape.
- Feed both from a single provider-agnostic `flow.userPrompt` extracted in JS.
- Use Model Armor instead of hand-written regex redaction. It covers prompt injection, jailbreak, RAI, SDP/PII, malicious URLs and CSAM.

## 3. Token governance
| Need | Policy |
|---|---|
| Stop sudden surges in prompt size | `PromptTokenLimit` (Rate, for example `5000pm`) |
| Per-minute to per-month token allowance per model | `LLMTokenQuota` EnforceOnly (request) + CountOnly (response) |
| Limits per persona / model | API product `llmOperationGroup.operationConfigs[].llmTokenQuota` |
| Warn before 429 | JS: `ratelimit.LTQ-TokenCount.used.count` ÷ `...apiproduct.developer.llmQuota.limit` |

Rules learned the hard way:
1. Both LTQ policies must use **identical** `Identifier`, `LLMModelSource` and `SharedName`.
2. Key the quota per **user** (`flow.emailId`) when many users share one app.
3. `LLMModelSource` must equal an operationConfig `model`, and must **not** be overwritten mid-flow. Keep
   `flow.quota_model` (for example `auto` for `/auto`).
4. Do not count semantic-cache hits.
5. The CountOnly policy reads `usageMetadata.totalTokenCount`. A Claude response must be normalised to that shape
   (or use `$.usage.output_tokens`) or it is never counted.

## 4. Semantic cache
Vector Search index (streaming updates) on a public endpoint, plus `text-embedding-004`. Lookup goes at the end of the PreFlow,
populate in the PostFlow. Make it opt-in (`x-use-cache: true`) and use `continueOnError="true"`. Track HIT/MISS by setting HIT
before the lookup and MISS in the **TargetEndpoint** PreFlow, which only runs on a miss. The cache key is the prompt only,
so do not classify or route before the lookup.

## 5. Cost, budget, monetization
- Keep the rate card in an environment **KVM** as JSON (`{"gemini-3-flash-preview":{"input":0.5,"output":3.0},...}`, USD per 1M tokens).
  `JS-CalculateCost` computes `flow.tx_cost_usd` and `flow.tx_cost_micros`. Count thinking tokens at the output rate.
- **Budget:** a Quota pair on `SharedName developer-budget-counter`, with limits from product attributes `developer.budget.*`.
  The read side is `EnforceOnly` with `continueOnError="true"`, followed by an explicit RaiseFault 429 on `ratelimit.X.failed`.
- **Prepaid wallet:** `MonetizationLimitsCheck` in the request. In the response, `DataCapture` with monetization-scope
  `perUnitPriceMultiplier` (cost × 1000 for a $0.001 base fee), `currency` and `transactionSuccess`.
  Set `transactionSuccess=false` on cache hits and on unpriced calls.

## 6. Identity and telemetry
- Authorization uses the **API key** (product = persona = entitlement). User identity for attribution comes from a JWT via
  `DecodeJWT`. Use `VerifyJWT` if you need to trust the token itself.
- Response headers (`AM-SetResponseHeaders`): `x-gateway-model`, `-provider`, `-prompt-tokens`, `-completion-tokens`,
  `-total-tokens`, `-cached`, `-cache-status`, `-cost-usd`, `-router-category`, `-token-quota-*`, `-budget-*`.
  Avoid `x-apigee-*`, which Apigee strips.
- `MessageLogging` in PostClientFlow. `DataCapture` dimensions `dc_user_email`, `dc_model_name`, `dc_*_token_count`,
  `dc_cache_status`, plus a fault-path twin in `DefaultFaultRule` with `AlwaysEnforce`.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Token quota never trips | LTQ pair mismatch, `flow.model` overwritten, or CountOnly fault swallowed (`continueOnError`). Check `ratelimit.LTQ-TokenCount.failed` in trace |
| `InvalidAPICallAsNoApiProductMatchFound` | Model string not in the product's `llmOperations` (for example `@` and `-` revision separators differ) |
| 404 from Vertex with an empty model in the URL | Routing skipped. Do not guard routing flows on `flow.cached` |
| Budget never enforced | EnforceOnly + continueOnError without a RaiseFault checking `ratelimit.*.failed` |
| Wallet charged on cache hits | DataCapture defaults are used. Set `transactionSuccess=false` and the multiplier to 0 |
| Analytics shows `{flow.model}` | `DataCapture default` is a literal string |
| Body never validated | `OASValidation` needs `<ValidateMessageBody>true</ValidateMessageBody>` |
