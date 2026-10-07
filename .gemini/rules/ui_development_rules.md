---
trigger: glob
globs: "ui/**/*.ts,ui/**/*.tsx,ui/**/*.js,ui/**/*.mjs,ui/**/*.css,ui/**/*.html"
description: "Rules for developing the React + Vite + Tailwind testing UI and playground."
---

# UI Development Standards (React + Vite + Tailwind)

When building or updating the custom testing UI:

## 1. Component Architecture
- Place shared UI widgets in `ui/src/components/`.
- Maintain strict TypeScript types for all gateway payloads, messages, tool definitions, and trace metadata in `ui/src/types/index.ts`.
- Separate API client logic in `ui/src/services/api.ts` (Admin Agent client: `ui/src/services/adminAgent.ts`).
- **Every `/api/*` route exists twice**: `ui/server.js` (production, Cloud Run) and the `configureServer` middleware in `ui/vite.config.ts` (`npm run dev`). Add/change both, or put the logic in a `ui/server/*.js` module that both import (as `/api/admin-agent/*` does). `adminagentroutes.unit.test.mjs` checks this for the Admin Agent and `DEFAULT_PRODUCTS`.
- `ui/Dockerfile` copies `server/` and `package.json` (for `"type": "module"`); anything the server reads at runtime must live there.

## 2. Key Demo Features Required
- **Chat Playground**: Real-time message streaming, tool call execution badges, and token/latency display.
- **Gateway Trace Viewer**: Display exact HTTP headers returned by Apigee (`x-gateway-model`, `x-prompt-tokens`, `x-candidate-tokens`, `x-gateway-cached`, `x-policy-latency-ms`).
- **Policy Sandbox**: Controls to simulate:
  - Model routing (Flash vs. Pro vs. Auto-failover)
  - Rate limiting (simulate 429 quota exhaustion)
  - PII masking (redacting credit cards / email / SSN in prompt before sending to LLM)
  - Tool execution authorization toggles.
- **Tool Registry**: Interactive list of available tools with schema preview and direct execution tester.

## 3. Styling & Polish
- Use modern Tailwind CSS with clean dark/light mode accents, badge tags for policy statuses, and collapsible JSON payloads.
