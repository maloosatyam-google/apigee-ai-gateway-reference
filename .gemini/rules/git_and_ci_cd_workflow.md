---
trigger: always
description: "Git conventions, CI/CD pipeline standards, and validation workflows. Applies to ALL work in this repository, not just scripts."
---

# Git & CI/CD Workflow Standards

## 1. Directory Structure Rules
- Apigee proxies must always be kept under `apigee/proxies/<proxy-name>/apiproxy/`.
- Shared flows must be placed under `apigee/sharedflows/<flow-name>/sharedflowbundle/`.
- Python agent code resides under `agents/app/`.

## 2. Automated Quality Gates
Before packaging or deploying:
1. **Proxy Bundle Linting**: Validate XML well-formedness and policy references using `python apigee/scripts/validate_bundle.py <proxy-name>`.
2. **Python Linting & Tests**: Ensure all ADK endpoints pass unit tests (`pytest agents/tests`).
3. **Frontend Type Checking**: Ensure TypeScript compiles cleanly (`cd ui && npm run build`).

## 3. Branching & Isolation Strategy
- **Dedicated Branches**: Always branch off `main` for changes (`git checkout -b <branch-name>`). Never commit or push unverified changes directly to `main`. This applies to **every** change — UI, docs, proxies, scripts — not only to the asset types this file's examples happen to mention.
- **Merging is user-gated**: Do not merge or push to `main` until the user has explicitly reviewed the work and given the go-ahead. "The tests pass" is not approval. Ask, then merge.
- **Deploying from a branch is expected**: Cloud Run and Apigee `dev` may be deployed from a feature branch so the user can review the running result before approving the merge. Deployment is not approval either.
- **Prod deploys by the coding agent are allowed**: the coding agent may deploy proxies, API products and the Cloud Run UI to `prod` and run the live suite there when the user asks to deploy/test on prod. The **only** actor blocked from changing prod is the **Admin Agent inside the UI** (enforced server-side by `assertDevOnlyEnvironments` in `ui/server/adminAgentCore.js`). Merging to `main` stays user-gated regardless.
- **Live Demo Protection**: `prod` (both Apigee `prod` environment and live Cloud Run UI) is actively used for customer demos and must remain unbroken.

## 4. Staged Deployment Flow
1. **Develop on Branch**: Implement feature or fix on a feature branch.
2. **Local Validation**: Run linting, unit tests, and bundle validation (`cd ui && npm test && npm run build`, `validate_bundle.py`).
3. **Deploy to Dev (`dev`)**: Package and deploy proxy changes to Apigee `dev` environment first (`bash apigee/scripts/deploy_proxy.sh --env dev`).
4. **No automated testing on dev**: `dev` is a shared sandbox people edit directly, so live-test results there are meaningless and there is no `TEST_ENV` switch. A manual look at the dev UI is optional.
5. **PR & Approval**: Submit PR for review before merging to `main`. Deploying to `prod` for testing may happen before the merge when the user asks for it (see Section 3).
6. **Post-deploy live check**: After a prod deploy, run `cd ui && npm run test:live` (prod only; sets `TEST_ALLOW_PROD=1`, spends prod quota/budget).

