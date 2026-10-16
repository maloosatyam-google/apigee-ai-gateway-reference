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

## 3. Branching & Environment Strategy
- **Dedicated Branches**: Work on a feature branch (`git checkout -b <branch-name>`) and run the validation gates before merging to `main`.
- **Dev vs Prod**: `dev` is used for interactive sandbox testing (including Ask Apigee `(Dev)` product clones); `prod` hosts the stable configuration.

## 4. Staged Deployment Flow
1. **Develop on Branch**: Implement the feature or fix on a feature branch.
2. **Local Validation**: Run unit tests, build checks, and bundle validation (`cd ui && npm test && npm run build`, `validate_bundle.py`).
3. **Deploy to Dev (`dev`)**: Package and deploy proxy changes to the Apigee `dev` environment (`bash apigee/scripts/deploy_proxy.sh --env dev`).
4. **Deploy to Prod (`prod`)**: Deploy proxy, product, and UI changes (`bash apigee/scripts/deploy_proxy.sh --env prod`, `ui/scripts/deploy_prod.sh`).
5. **Post-deploy Live Check**: Run `cd ui && npm run test:live` against `prod`.

