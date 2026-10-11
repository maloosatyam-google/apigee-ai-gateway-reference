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
> `apigee-go-gen` writes the rendered propertysets into `resources/properties/`. The directory
> may be missing on a fresh clone; create it if your render fails on a missing path.

Policy filenames in this template differ from the XML bundle in `apigee/proxies/ai-gateway-v1/`:
the `SC-` prefix is used only here, and suffixes are lowercase and hyphenated
(`AM-model.yaml`, `JS-extract-prompt.yaml`).

---

## 🛠 Usage & Generation

All commands below are written to run from the **repository root**.

### 1. Install `apigee-go-gen`

`apigee-go-gen` is not included in this repository. Get it from
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
> `values.yaml` sets `gateway.name: ai-gateway-v1`, the name of the live proxy serving
> `https://api.example.com/ai/v1`. Deploying the rendered bundle under that
> name with `--ovr` replaces the deployed `ai-gateway-v1` proxy. The rendered bundle does not
> match the XML bundle in `apigee/proxies/ai-gateway-v1/`, which is what production runs.

**Recommended: deploy side by side** under a different name. Set the name at render time so the
bundle's internal name matches:

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

**To replace production** (creates a new revision of the live proxy):

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
served from the `/v1/models` endpoint, so clients see every entry. List only models that
resolve in your project, and match the prices to the rate card in
[`apigee/config/model_rate_card.json`](../../config/model_rate_card.json).

Rates are USD per 1M tokens.

| Model | Publisher | Region | Input | Output |
| :--- | :--- | :--- | ---: | ---: |
| `gemini-3.5-flash-lite` | google | global | 0.300 | 2.500 |
| `gemini-3.6-flash` | google | global | 0.750 | 3.750 |
| `gemini-2.5-flash` | google | global | 0.300 | 2.500 |
| `gemini-3.8-flash` | google | global | 0.750 | 3.750 |
| `gemini-3.1-pro-preview` | google | global | 2.000 | 12.000 |
| `gemini-2.5-pro` | google | global | 1.250 | 10.000 |
| `claude-haiku-5-5` | anthropic | us-east5 | 0.100 | 0.500 |
| `claude-opus-5-5` | anthropic | us-east5 | 4.000 | 20.000 |

> [!WARNING]
> Do not add `gemini-3-flash`, `claude-3-5-sonnet`, `claude-3-5-haiku` or `claude-3-7-sonnet`
> to the catalog. They return **HTTP 404** from Vertex in this project, which publishes no
> `claude-3-x` models. Check any new model ID against the `your-gcp-project` publisher catalog
> before you add it.

The `routing.aliases` block maps older and generic model names onto models that resolve, so
clients that request them get a response instead of a 404:

| Alias | Resolves to |
| :--- | :--- |
| `claude-3-5-sonnet`, `claude-3-7-sonnet`, `claude-sonnet` | `claude-opus-5-5` |
| `claude-3-5-haiku`, `claude-haiku` | `claude-haiku-5-5` |
| `gemini-flash` / `gemini-flash-lite` / `gemini-pro` | the corresponding Gemini 3.x model |
| `gpt-4o` / `gpt-4o-mini` | `gemini-3.1-pro-preview` / `gemini-3.5-flash-lite` |
| `auto`, `gateway/auto` | `gemini-3.6-flash` |

The catalog does not show which models API products entitle. For example, `gemini-2.5-flash`
is in the template catalog, but no API product on the deployed `ai-gateway-v1` proxy entitles
it (end of life 2026-10-20). The token-quota demo model is `claude-haiku-5-5`, at 300 tokens/min.

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

Turn features on or off in `values.yaml`. The defaults are below; `monetization` and
`llm_judge` are off:

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
    classifier_model: "gemini-3.5-flash-lite"
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
