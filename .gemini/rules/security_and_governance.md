---
trigger: glob
globs: "**/*.xml,**/*.py,**/*.json,**/*.ts,**/*.tsx,**/*.js,**/*.mjs,**/*.sh"
description: "Mandatory security, governance, PII masking, authentication, and secret-handling rules."
---

# Security & API Governance Rules

All Apigee proxies, Python ADK services, and frontend clients must adhere to enterprise security standards:

## 1. Authentication & Authorization
- **Never hardcode secrets or service account keys** into proxy XML, Python code, or React components. Always use environment variables, Secret Manager, or Apigee Key-Value Maps (KVMs).
- **API Key & OAuth Enforcement**: Every external endpoint exposed by Apigee must include either `VAK-VerifyApiKey` or `OA-VerifyAccessToken` in the `PreFlow`.
- **Tool Scoping**: Tool execution via the Tools Gateway must enforce least-privilege scopes (e.g. `tool:order:read` vs `tool:order:write`).
- **Admin Agent is dev-only, enforced server-side**: `ui/server/adminAgentService.js` may write only the `(Dev)` product clones and only with `environments: ["dev"]` (`assertWritableDevProduct`, `assertDevOnlyEnvironments`). No promote-to-prod path; prod products change only via PR. The sandbox/admin consumer keys stay in server memory and every response passes `redactSecrets()`.

## 2. Guardrails & Data Protection
- **Prompt Sanitization**: PII (Personally Identifiable Information) including credit cards, SSNs, and private emails must be redacted or tokenized via `JS-RedactPII` before reaching upstream LLMs.
- **DDoS & Spike Protection**: All proxy endpoints must enforce `SA-SpikeArrest` to prevent traffic surges and LLM denial-of-wallet attacks.
- **Quota & Token Caps**: Apply quota policies based on developer tiers (Free, Standard, Enterprise) with token weighting to cap monthly usage.

## 3. CORS & Response Sanitization
- Never leak internal backend hostnames, stack traces, or upstream Vertex AI project IDs in error responses or HTTP headers.
- Always use standardized Apigee FaultRules to return clean JSON error payloads (`{"error": {"code": "...", "message": "..."}}`).
