---
trigger: glob
globs: "agents/**/*.py,agents/**/*.txt,agents/Dockerfile"
description: "Rules for developing Google ADK (Agent Development Kit) agents, tools, and FastAPI wrappers."
---

# Google ADK Python Development Standards

When developing Python ADK agents and backend services, follow these standards:

## 1. Architecture
1. **Consuming Apigee**:
   - Route model calls through Apigee: the governed agent uses the AI Gateway `/ai/v1/auto`, the
     baseline agent uses the `llm-passthrough-v1` proxy. Calling Vertex AI directly is allowed only
     as an explicit, opt-in profile mode (`llm="vertex"`).
   - Reach tools only through the Apigee MCP gateway with ADK `McpToolset`; never call backend
     databases or APIs directly.
   - Keep no Apigee keys in the service: use the identity token and persona keys the UI server
     forwards on each request.
2. **Exposed to the UI**:
   - The service is a stateless FastAPI app on private Cloud Run that streams run events over SSE.
   - Only the UI's service account (and the deployer) may invoke it.

## 2. Code Structure
```text
agents/
├── app/
│   ├── main.py            # FastAPI: /health, /v1/profiles, POST /v1/showcase/run (SSE)
│   ├── agent.py           # run_side(): one ADK LlmAgent per side
│   ├── profiles.py        # Agent profiles and their sides (model mode, key role, MCP servers)
│   ├── gateway_llm.py     # ADK BaseLlm adapter for Apigee /auto, pass-through, or Vertex
│   ├── mcp_transport.py   # Recording httpx client for McpToolset
│   ├── recorder.py        # Per-side event stream and totals
│   └── config.py          # Settings from environment variables
├── tests/                 # pytest (run via cloudbuild.test.yaml)
├── scripts/smoke_live.py  # Live smoke test
├── requirements.txt       # Pinned Python dependencies
└── Dockerfile             # Production container for Cloud Run
```

## 3. Error Handling & Observability
- Propagate gateway correlation headers (`x-request-id`, `x-session-id`, `x-agent-id`) on all outgoing HTTP requests to Apigee.
- Log tool execution inputs, outputs, and latencies.
- Ensure graceful fallbacks if a tool call or model call exceeds latency budgets or returns rate-limit (429) errors.
