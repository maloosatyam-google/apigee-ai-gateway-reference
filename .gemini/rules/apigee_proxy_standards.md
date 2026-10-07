---
trigger: glob
globs: "apigee/**/*.xml,apigee/**/*.sh,apigee/**/*.json"
description: "Rules and best practices for creating and modifying Apigee X proxy bundles and shared flows."
---

# Apigee X Proxy Development Standards

When generating or modifying Apigee X proxy bundles, strictly adhere to the following conventions:

## 1. Directory Structure
All proxy bundles must follow the standard Apigee X hierarchy:
```text
apiproxy/
├── <proxy-name>.xml              # Root proxy definition
├── proxies/
│   └── default.xml               # ProxyEndpoint definition (PreFlow, Flows, PostFlow, HTTPProxyConnection)
├── targets/
│   └── default.xml               # TargetEndpoint definition (HTTPTargetConnection, PreFlow, PostFlow)
├── policies/                     # XML Policy files (one per policy instance)
│   ├── VAK-VerifyApiKey.xml
│   ├── SA-SpikeArrest.xml
│   ├── Q-QuotaTier.xml
│   └── JS-TokenAccounting.xml
└── resources/
    └── jsc/                      # JavaScript callout scripts
        └── token_accounting.js
```

## 2. Policy Naming Conventions
Always prefix policy file names and `name` attributes with standard Apigee abbreviations
(match the prefixes already used in `apigee/proxies/**`):
- `VA-`: Verify API Key (`VerifyAPIKey`)
- `OA-`: OAuth v2 (`OAuthV2`)
- `SA-`: Spike Arrest (`SpikeArrest`)
- `Q-` / `QC-`: Quota (`Quota`)
- `LTQ-`: LLM Token Quota (`LLMTokenQuota`)
- `AM-`: Assign Message (`AssignMessage`)
- `EV-`: Extract Variables (`ExtractVariables`)
- `JS-`: JavaScript (`Javascript`)
- `KVM-`: Key Value Map Operations (`KeyValueMapOperations`)
- `SC-`: Service Callout (`ServiceCallout`)
- `PY-`: Python Script (`PythonScript`)
- `RC-`: Response Cache (`ResponseCache`)
- `FC-`: Flow Callout (`FlowCallout`)
- `ML-`: Message Logging (`MessageLogging`)
- `RF-`: Raise Fault (`RaiseFault`)
- `PTL-`: Prompt Token Limit (`PromptTokenLimit`)
- `SUP-` / `SMR-`: Model Armor (`SanitizeUserPrompt` / `SanitizeModelResponse`)
- `SCL-` / `SCP-`: Semantic cache (`SemanticCacheLookup` / `SemanticCachePopulate`)
- `MLC-`: Monetization limits (`MonetizationLimitsCheck`)
- `PP-`: Parse Payload, MCP / JSON-RPC (`ParsePayload`)
- `DC-`: Data Capture (`DataCapture`) · `DJWT-`: Decode JWT · `AE-`: Access Entity · `OAS-`: OAS Validation · `TC-`: Trace Capture

Every file in `policies/` must be listed in the root manifest's `<Policies>` and attached
by at least one `<Step>`; every `jsc://` resource a policy references must exist and be
listed in `<Resources>`. `ui/tests/proxybundle.unit.test.mjs` enforces this.

## 3. Secrets
- Never put a credential (API key, bearer token, password, private key) in policy XML,
  JavaScript, scripts, product JSON or any repo file — not even as a default/fallback value.
- Gateway-owned secrets live in an **encrypted** environment KVM (e.g. `ai-gateway-creds`),
  read by a `KVM-*` policy into a `private.*` variable, and referenced from there.
- Do not seed KVMs from the bundle (`<InitialEntries>` / `<Put>` with literal values).
- Scripts must read keys from the environment / `.env` and fail if they are missing.

## 4. AI Gateway Specific Conventions
- **Model Routing**: Use conditional RouteRules or AssignMessage dynamically setting `target.url` to the appropriate Vertex AI model endpoint; model names for `/auto` come from API Product `routing.model.*` attributes, never from literals in the proxy.
- **Token Quotas**: Use `LLMTokenQuota` as an EnforceOnly (request) / CountOnly (response) pair with identical `Identifier`, `LLMModelSource` and `SharedName`, and limits from the API product `llmOperationGroup`. Use `PromptTokenLimit` for surge protection. Do not hand-roll token counting with `Quota` + `Weight`.
- **Guardrails / cache**: Model Armor via `SanitizeUserPrompt` / `SanitizeModelResponse`. Use `SemanticCacheLookup` / `SemanticCachePopulate` for caching, not `ResponseCache`. Full reference: `.gemini/skills/apigee-proxy-builder/references/policies_ai_gateway.md`.
- **Trace Headers**: Inject telemetry headers in `PostFlow` response via `AM-SetResponseHeaders`
  (e.g. `x-gateway-model`, `x-gateway-provider`, `x-gateway-prompt-tokens`,
  `x-gateway-completion-tokens`, `x-gateway-cached`, `x-gateway-router-*`).

## 5. Tools Gateway Conventions
- MCP proxies: `ParsePayload` first, a method allowlist, and VerifyAPIKey + Quota (`UseQuotaConfigInAPIProduct`) on `tools/*` only.
  Per-tool entitlement comes from API product `payloadOperationGroup` operations `tools/call/<tool>`.
- Business limits on tool arguments return JSON-RPC `result.isError=true` (403) with the request id echoed in its original type.
  Full reference: `.gemini/skills/apigee-proxy-builder/references/policies_mcp_tools.md`.
