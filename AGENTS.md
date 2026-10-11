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
- [`unified_credentials_and_products_reference.md`](docs/unified_credentials_and_products_reference.md): Reference for the API Products (persona AI products, MCP Tools), unified developer keys, Apigee Monetization prepaid rate plans & wallets, per-operation LLM token quotas, and customer walkthrough scripts.
- [`cloud_run_iap_deployment_guide.md`](docs/cloud_run_iap_deployment_guide.md): Deploying the demo UI to Cloud Run behind IAP — build, deploy, service account, ingress, and troubleshooting.
- [`best_practices_guide.md`](docs/best_practices_guide.md): Agentic development conventions — rule scoping, progressive disclosure in skills, subagent specialization, and verification before declaration.
