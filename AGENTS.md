# Agent Architecture & Customization Registry

This file registers all specialized subagents, procedural skills, and operational rules for this repository.

## 1. Available Subagents (`.gemini/agents/`)
- [`apigee-architect.md`](.gemini/agents/apigee-architect.md): Apigee X bundle architect, XML policy designer, and security auditor.
- [`adk-engineer.md`](.gemini/agents/adk-engineer.md): Python Google ADK agent engineer, tool integration specialist, and FastAPI developer.
- [`gateway-tester.md`](.gemini/agents/gateway-tester.md): E2E integration tester, load/latency simulator, and verification specialist.

## 2. Available Skills (`.gemini/skills/`)
- [`apigee-proxy-builder`](.gemini/skills/apigee-proxy-builder/SKILL.md): Scaffold, validate, package, and deploy Apigee X proxy bundles.
- [`ai-gateway-policy-manager`](.gemini/skills/ai-gateway-policy-manager/SKILL.md): Manage model routing and auto-routing, LLM token quotas, prompt guardrails, PII redaction, and semantic caching.
- [`tools-gateway-manager`](.gemini/skills/tools-gateway-manager/SKILL.md): Tool execution governance, schema validation, authorization, and MCP/REST bridging.
- [`adk-agent-developer`](.gemini/skills/adk-agent-developer/SKILL.md): Python ADK agent implementation using the Dual-Pattern.

## 3. Active Workspace Rules (`.gemini/rules/`)
- [`apigee_proxy_standards.md`](.gemini/rules/apigee_proxy_standards.md)
- [`adk_python_standards.md`](.gemini/rules/adk_python_standards.md)
- [`ui_development_rules.md`](.gemini/rules/ui_development_rules.md)
- [`security_and_governance.md`](.gemini/rules/security_and_governance.md)
- [`git_and_ci_cd_workflow.md`](.gemini/rules/git_and_ci_cd_workflow.md)

## 4. Key Implementation Specifications (`docs/`)
- [`proxy_architecture_design_plan.md`](docs/proxy_architecture_design_plan.md): End-to-end AI Gateway proxy architecture — PreFlow and response-flow ordering, the policy catalog, OpenAPI 3.0 request validation, Model Armor perimeter defense, and auto-routing rules.
- [`unified_credentials_and_products_reference.md`](docs/unified_credentials_and_products_reference.md): Canonical reference for API Products (Standard & Enterprise AI, MCP Tools), unified developer keys, Apigee Monetization prepaid rate plans & wallets, per-operation LLM token quotas, and customer walkthrough scripts.
- [`apigee_ai_gateway_demo_design.md`](docs/apigee_ai_gateway_demo_design.md): Broad platform design doc spanning proxies, products, and UI, plus the end-to-end demo narrative. It has **no ADK section** and never references `agents/`.
- [`ui_semantic_cache_and_governance_spec.md`](docs/ui_semantic_cache_and_governance_spec.md): Frontend UI specification — trace inspector telemetry and API data contracts, plus the proposed Semantic Cache Explorer screen.
- [`cloud_run_iap_deployment_guide.md`](docs/cloud_run_iap_deployment_guide.md): Deploying the demo UI to Cloud Run behind IAP — build, deploy, service account, ingress, and troubleshooting.
- [`best_practices_guide.md`](docs/best_practices_guide.md): Agentic development conventions — rule scoping, progressive disclosure in skills, subagent specialization, and verification before declaration.

## 5. Working Scratchpads (repo root)
- [`scenario_presets_review.md`](scenario_presets_review.md): Editable copy deck for the UI playground scenario preset cards — titles, badges, descriptions, sub-button labels and prompts.

> [!NOTE]
> `scenario_presets_review.md` is now **generated** from
> [`defaultSettings.ts`](ui/src/services/defaultSettings.ts)
> by [`generate_scenario_presets_doc.mjs`](ui/scripts/generate_scenario_presets_doc.mjs)
> (`npm run docs:presets` in `ui/`, or `-- --check` to fail when stale). Do not hand-edit it — edit
> the code and regenerate. It now carries the `settingsOverride` blocks and `category` /
> `badgeColor` fields it previously omitted.
>
> It was formerly a hand-maintained scratchpad that described itself as text to apply **verbatim**
> into the code, and it drifted in the dangerous direction: it still claimed the titles
> `Unauthorized`, `Auto Routing`, `Token Limits` and `Semantic Cache` long after the code had moved
> to `Access Control`, `Model Routing`, `Tokenomics` and `Cache`, so applying it verbatim would have
> regressed shipped demo copy.

> [!IMPORTANT]
> `SemanticCacheView.tsx` does not exist in [`ui/src/components/`](ui/src/components/). Semantic cache behaviour is surfaced today through `ChatPlayground` scenario presets and `GatewayTraceViewer`. Treat the Semantic Cache Explorer as a proposal, not shipped code.
