# 🚀 Apigee AI Gateway Template

A declarative, configurable template for generating the **Apigee Enterprise AI Gateway** using [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen).

---

## 📁 Directory Structure

```text
apigee/templates/ai-gateway/
├── apiproxy.yaml                  # Root template (APIProxy, ProxyEndpoints, TargetEndpoints, Resources)
├── values.yaml                    # Declarative configuration & models catalog (full reference config)
├── values.quickstart.yaml         # Minimal starter config — smallest viable render
├── _helpers.tmpl                  # Go template helper macros (Dynamic PropertySets & URL builders)
├── policies.yaml                  # Aggregated policy definitions template
├── policies/                      # 42 decomposed YAML policy definitions
│   ├── VA-ApiKey.yaml
│   ├── MLC-EnforceMonetizationLimits.yaml
│   ├── SC-LLMJudge.yaml
│   ├── SUP-SanitizeUserPrompt.yaml
│   ├── SMR-SanitizeModelResponse.yaml
│   ├── LTQ-EnforceOnly.yaml
│   ├── LTQ-CountOnly.yaml
│   └── ...
└── resources/
    ├── jsc/                       # 16 JavaScript callouts (Smart Router, Converters, Rating)
    ├── oas/                       # 3 OpenAPI schema definitions (claude, gemini, openai)
    └── properties/                # EMPTY placeholder — propertysets are generated at render time
```

> [!NOTE]
> `resources/properties/` ships empty. Because Git does not track empty directories it may be
> absent on a fresh clone; `apigee-go-gen` writes the rendered propertysets into it. Create it if
> your render fails on a missing path.

> [!IMPORTANT]
> These policy filenames follow the template set's own convention, **not** the hand-maintained
> `ai-gateway-v1` XML bundle's. The `SC-` prefix exists only here, and suffixes are lowercase and
> hyphenated (`AM-model.yaml`, `JS-extract-prompt.yaml`). Do not normalise one set to the other.

---

## 🛠 Usage & Generation

All commands below are written to run from the **repository root**.

### 1. Install `apigee-go-gen`

`apigee-go-gen` is an **external, upstream tool** — it is not vendored in this repository and there
is no `apigeegg/` directory here. Get it from
[github.com/apigee/apigee-go-gen](https://github.com/apigee/apigee-go-gen) (see the
[releases page](https://github.com/apigee/apigee-go-gen/releases) for prebuilt binaries):

```bash
# Option A — install the released binary directly
go install github.com/apigee/apigee-go-gen/cmd/apigee-go-gen@latest

# Option B — clone and build from source, anywhere outside this repo
git clone https://github.com/apigee/apigee-go-gen.git
cd apigee-go-gen && go build -o ./bin/apigee-go-gen ./cmd/apigee-go-gen
```

### 2. Render Proxy Bundle
Generate a deployable Apigee API proxy bundle (`.zip` or directory):

```bash
apigee-go-gen render apiproxy \
    --template ./apigee/templates/ai-gateway/apiproxy.yaml \
    --values ./apigee/templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip
```

Swap in `values.quickstart.yaml` for a minimal render.

### 3. Deploy to Apigee

> [!CAUTION]
> `values.yaml` sets `gateway.name: ai-gateway-v1`, which is the **live, primary proxy** serving
> `https://api.example.com/ai/v1`. Deploying this rendered bundle under that
> name with `--ovr` **overwrites the hand-maintained `ai-gateway-v1` bundle**. The XML bundle in
> `apigee/proxies/ai-gateway-v1/` is the source of truth for production; this template set is a
> parallel, experimental generator and the two are not kept in sync.

**Recommended — side-by-side experimental deploy** under a distinct name, leaving production alone.
Override the name at render time so the bundle's internal name matches:

```bash
apigee-go-gen render apiproxy \
    --template ./apigee/templates/ai-gateway/apiproxy.yaml \
    --values ./apigee/templates/ai-gateway/values.yaml \
    --set gateway.name=ai-gateway-gen \
    --output ./out/ai-gateway-gen.zip

apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway-gen.zip \
    --name ai-gateway-gen \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --wait \
    --default-token
```

**Only if you intend to replace production** — this is destructive and creates a new revision of
the live proxy:

```bash
apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway-v1 \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --ovr \
    --wait \
    --default-token
```

---

## 📚 Model Catalog

The `models:` block in `values.yaml` is rendered into `models.catalog` by `_helpers.tmpl` and
served from the `/v1/models` endpoint, so **every entry is advertised to clients**. Only list
models that actually resolve in this project, and keep pricing in sync with the authoritative rate
card at
[`apigee/proxies/ai-gateway-v1/apiproxy/resources/properties/model_rates.properties`](../../proxies/ai-gateway-v1/apiproxy/resources/properties/model_rates.properties).

Rates are USD per 1M tokens.

| Model | Publisher | Region | Input | Output |
| :--- | :--- | :--- | ---: | ---: |
| `gemini-3.1-flash-lite` | google | global | 0.075 | 0.300 |
| `gemini-3-flash-preview` | google | global | 0.150 | 0.600 |
| `gemini-3.5-flash` | google | global | 0.150 | 0.600 |
| `gemini-2.5-flash` | google | global | 0.300 | 2.500 |
| `gemini-3.7-flash` | google | global | **1.500** | **7.500** |
| `gemini-3.8-flash` | google | global | **1.500** | **7.500** |
| `gemini-3.1-pro-preview` | google | global | 1.250 | 5.000 |
| `gemini-2.5-pro` | google | global | 1.250 | 5.000 |
| `claude-haiku-4-5` | anthropic | us-east5 | 1.000 | 5.000 |
| `claude-opus-4-5` | anthropic | us-east5 | 15.000 | 75.000 |

> [!WARNING]
> **Deliberately absent**: `gemini-3-flash`, `claude-3-5-sonnet`, `claude-3-5-haiku` and
> `claude-3-7-sonnet`. These return **HTTP 404** from Vertex in this project — there is no
> `claude-3-x` generation published here at all. Verify any new model ID against the live
> `your-gcp-project` publisher catalog before adding it.

The legacy names are still handled: the `routing.aliases` block **forward-maps** them onto models
that do resolve, so an old client gets a working response instead of a 404. These aliases are
intentional and must not be removed alongside the catalog entries.

| Alias | Resolves to |
| :--- | :--- |
| `claude-3-5-sonnet`, `claude-3-7-sonnet`, `claude-sonnet` | `claude-opus-4-5@20251101` |
| `claude-3-5-haiku`, `claude-haiku` | `claude-haiku-4-5@20251001` |
| `gemini-flash` / `gemini-flash-lite` / `gemini-pro` | the corresponding Gemini 3.x model |
| `gpt-4o` / `gpt-4o-mini` | `gemini-3.1-pro-preview` / `gemini-3.1-flash-lite` |
| `auto`, `gateway/auto` | `gemini-3-flash-preview` |

`gemini-2.5-flash` is listed here because this template catalog is self-contained and its rate
table must stay internally consistent. It is **no longer the token-quota demo model** — that
moved to `claude-haiku-4-5@20251001`, now at 300 tokens/min (originally 50) — and in the hand-maintained
`ai-gateway-v1` bundle it has been **retired outright** ahead of its 2026-10-20 end of life,
entitled by no API product. Do not infer the live entitlement set from this table.

---

## ⚙️ Custom URLs & API Formats per Model

To add self-hosted LLMs (e.g., vLLM, Ollama) or regional endpoints, specify `custom_url`, `format`, and optional `auth` settings directly in `values.yaml`:

```yaml
models:
  # Self-hosted OpenAI-compatible LLM (vLLM / Ollama)
  - name: "custom-llama-3"
    displayName: "Llama 3 70B (vLLM)"
    publisher: "custom"
    target: "gemini-openai-compat"
    format: "openai"                            # openai | anthropic | gemini | passthrough
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"                            # bearer | header | none
      token_ref: "propertyset.config.vllm_api_key"
    pricing:
      input_rate: 0.050
      output_rate: 0.150

  # Regional Vertex AI Model
  - name: "gemini-2.5-pro-eu"
    displayName: "Gemini 2.5 Pro (Europe)"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "europe-west1"                      # Automatically routes to europe-west1-aiplatform.googleapis.com
    pricing:
      input_rate: 1.250
      output_rate: 5.000
```

---

## 🎛 Feature Toggles

You can toggle features on or off in `values.yaml`. These are the **actual shipped defaults** —
note that `monetization` and `llm_judge` default to `false`:

```yaml
features:
  monetization:
    enabled: false
    default_currency: "USD"
    default_markup: 1.0
  model_armor:
    enabled: true
    location: "global"
    template: "ai-gateway-filter"
  llm_judge:
    enabled: false
    classifier_model: "gemini-3.1-flash-lite"
  quotas:
    enabled: true
  cors:
    enabled: true
  auth:
    enabled: true
    type: "apikey"   # apikey | none
  identity_check:
    enabled: true
  semantic_cache:
    enabled: true
```
