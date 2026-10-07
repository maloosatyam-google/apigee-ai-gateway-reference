# Agentic Development Best Practices Guide

## 1. Rule Organization
- **Hierarchical Scoping**: Place repository-wide rules in [`GEMINI.md`](../GEMINI.md) and [`AGENTS.md`](../AGENTS.md).
- **Contextual Triggers**: Use YAML frontmatter `trigger: glob` to only inject rules when relevant files are being edited (e.g., [apigee_proxy_standards.md](../.gemini/rules/apigee_proxy_standards.md) for XML/Apigee files, [adk_python_standards.md](../.gemini/rules/adk_python_standards.md) for Python code).

## 2. Progressive Disclosure in Skills
- Keep top-level [`SKILL.md`](../.gemini/skills/apigee-proxy-builder/SKILL.md) concise.
- Place extensive checklists, payload samples, and cheat sheets under `references/`.
- Provide automated scripts under `scripts/` (e.g. [validate_bundle.py](../apigee/scripts/validate_bundle.py)) for repeatable verification.

## 3. Subagent Specialization
- Delegate tasks to specialized subagents:
  - **Apigee Architect**: For XML policies, flow logic, and fault rules.
  - **ADK Engineer**: For Python orchestration, tool schema definitions, and FastAPI endpoints.
  - **Gateway Tester**: For executing test suites, load tests, and verifying telemetry.

## 4. Verification Before Declaration
- Always validate proxy bundles using automated bundle validation tools before packaging.
- Run type checks and unit tests before completing features.
