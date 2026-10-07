---
name: adk-agent-developer
description: >-
  Develop, test, and deploy the Python Google ADK (Agent Development Kit) Agent Showcase service
  in agents/. Use when changing agent logic, the model adapter, MCP toolsets, run events, or
  when testing the service against the Apigee AI Gateway and MCP gateway.
---

# ADK Agent Developer Skill

`agents/` is the Agent Showcase service (`agent-showcase-api`, private Cloud Run, asia-southeast1).
It runs the same customer question through two ADK agents at once and streams every step to the
UI's Agent Showcase tab over SSE.

## 1. Layout
- `app/main.py`: FastAPI. `GET /health`, `GET /v1/profiles`, `POST /v1/showcase/run` (SSE).
  Both sides run as asyncio tasks writing to one queue; keep-alive comments every `HEARTBEAT_S`.
- `app/agent.py`: `run_side()` builds one `LlmAgent` per side. Same name and instruction on both
  sides, so the prompts are byte-identical and only the gateway differs.
- `app/profiles.py`: the sides.
  - `baseline` ("Regular Gateway (Without AI governance)"): `llm="passthrough"` (Gemini Pro via `llm-passthrough-v1`),
    caller's Unified Admin key, three MCP servers (`/mcp`, `/bigquery/mcp`, `/servicenow/mcp`).
  - `governed` ("With AI & Tools Governance"): `llm="apigee"` (`/ai/v1/auto`), Customer Support and
    Sales key, the same three MCP servers. Apigee lists 7 tools on `/mcp` and refuses BigQuery and
    ServiceNow for this key (401); ADK logs the failed toolsets and runs without them.
  - Both sides send the same headers (`use-cache` too; `llm-passthrough-v1` ignores it), so the
    requests differ only in URL and key.
- `app/gateway_llm.py`: `GatewayLlm`, an ADK `BaseLlm` adapter. Modes `apigee`, `passthrough`,
  `vertex` (direct, ADC). Reads gateway telemetry headers (model, route, cache, cost, quota).
  Retries Vertex capacity 429s with backoff and a timed-out call once; failures become a failed
  `llm_step` plus a `governance_event`, never a silent end of the run.
- `app/mcp_transport.py`: httpx client factory for `McpToolset` that records MCP hops,
  tool calls and results.
- `app/recorder.py`: `RunRecorder`, per-side events (`run_started`, `tools_offered`, `llm_step`,
  `gateway_hop`, `tool_call`, `tool_result`, `governance_event`, `final`, `metrics`, `run_finished`).

No Apigee keys live in the service: the UI server (`ui/server/agentShowcase.js`) forwards the
user's identity token and both persona keys as `X-Showcase-*` headers on every run.

## 2. Rules
- Model calls go through Apigee (`/ai/v1/auto` or `/passthrough/v1/models/...`). Direct Vertex is
  an opt-in profile mode only.
- Tools are reached only through the Apigee MCP gateway with ADK `McpToolset`
  (`StreamableHTTPConnectionParams`), never by calling backends directly.
- Send `x-apikey`, `Authorization: Bearer <identity token>`, `x-session-id` (run id) and
  `x-agent-id` (`<profile>-<side>`) on every model and MCP request.
- Cost is not computed here. The UI prices both sides from the `ai-model-rates` KVM.

## 3. Test
Local Python may be older than the service needs, so run pytest in Cloud Build:
```bash
cd agents
gcloud builds submit --config cloudbuild.test.yaml --project your-gcp-project --region asia-southeast1 .
```

## 4. Deploy and smoke test
```bash
cd agents && bash deploy.sh      # builds the image, deploys, grants the UI service account invoker
python3 agents/scripts/smoke_live.py "Where is my order ORD-1042?" baseline,governed
```
Refund prompts mutate demo data: reset afterwards with the UI's "Reset demo data" button or
`ui/server/demoReset.js`.
