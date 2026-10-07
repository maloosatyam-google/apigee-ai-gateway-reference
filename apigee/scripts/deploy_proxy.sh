#!/usr/bin/env bash
# Script to deploy Apigee proxy bundle to Apigee X using gcloud / apigeecli
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env and derived defaults (scripts/lib/config.sh)
source "${ROOT_DIR}/scripts/lib/config.sh"

# Default variables (can be set via .env, exported env vars, or CLI flags)
ORG="${APIGEE_ORG:-${ORG:-}}"
ENV="${APIGEE_ENV:-${ENV:-prod}}"
PROXY_NAME="${PROXY_NAME:-ai-gateway-v1}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-${PROXY_SA}}"
# By default the script blocks until the new revision is actually serving. Set --no-wait
# to return as soon as the deploy is submitted.
NO_WAIT="false"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --org) ORG="$2"; shift ;;
        --env) ENV="$2"; shift ;;
        --proxy) PROXY_NAME="$2"; shift ;;
        --service-account) SERVICE_ACCOUNT="$2"; shift ;;
        --no-wait) NO_WAIT="true" ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$ORG" ] || [ -z "$PROXY_NAME" ]; then
    echo "Usage: $0 [--org <APIGEE_ORG>] [--env <APIGEE_ENV>] [--proxy <PROXY_NAME>] [--service-account <SA_EMAIL>] [--no-wait]"
    exit 1
fi

# Proxies created and maintained in the Apigee UI. Deploying a repo bundle over
# them overwrites the UI-managed configuration, so refuse outright.
UI_MANAGED_PROXIES="mcp"
for p in $UI_MANAGED_PROXIES; do
  if [ "$PROXY_NAME" = "$p" ]; then
    echo "Refusing to deploy '$PROXY_NAME': it is managed in the Apigee UI, not from this repo."
    exit 1
  fi
done

echo "=== Packaging Proxy: $PROXY_NAME ==="
bash "${SCRIPT_DIR}/package_bundle.sh" "$PROXY_NAME"

BUNDLE_ZIP="${ROOT_DIR}/apigee/dist/${PROXY_NAME}.zip"

echo "=== Deploying $PROXY_NAME to Org: $ORG, Env: $ENV ==="
TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token --impersonate-service-account="${UI_MGMT_SA}" 2>/dev/null || gcloud auth print-access-token)

# 1. Import proxy revision
echo "Importing proxy revision..."
IMPORT_RES=$(curl -s -X POST "https://apigee.googleapis.com/v1/organizations/${ORG}/apis?name=${PROXY_NAME}&action=import" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"${BUNDLE_ZIP}")

REVISION=$(echo "$IMPORT_RES" | grep -o '"revision": "[0-9]*"' | head -1 | cut -d'"' -f4)

if [ -z "$REVISION" ]; then
  echo "Import failed or returned unexpected response:"
  echo "$IMPORT_RES"
  exit 1
fi

echo "Imported Revision: $REVISION"

# 2. Deploy revision to environment
echo "Deploying Revision $REVISION to environment $ENV with Service Account $SERVICE_ACCOUNT..."
DEPLOY_URL="https://apigee.googleapis.com/v1/organizations/${ORG}/environments/${ENV}/apis/${PROXY_NAME}/revisions/${REVISION}/deployments?override=true"
if [ -n "$SERVICE_ACCOUNT" ]; then
  DEPLOY_URL="${DEPLOY_URL}&serviceAccount=${SERVICE_ACCOUNT}"
fi

DEPLOY_RES=$(curl -s -X POST "${DEPLOY_URL}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$DEPLOY_RES"

# 3. Wait for the revision to actually serve traffic.
#
# Apigee returns from the deploy call long before the new revision is live on the
# message processors. A smoke test run immediately afterwards silently exercises the
# PREVIOUS revision and looks exactly like a failed fix -- this has cost multiple
# debugging cycles. Poll until the deployment reports READY, then hold a short
# safety margin, because READY still slightly precedes full propagation.
#
# Skip with --no-wait when chaining several deploys and verifying only at the end.
if [ "${NO_WAIT:-false}" = "true" ]; then
  echo "=== Deployment submitted (propagation wait skipped via --no-wait) ==="
  echo "    Allow ~60s before testing, or results will reflect the previous revision."
  exit 0
fi

STATUS_URL="https://apigee.googleapis.com/v1/organizations/${ORG}/environments/${ENV}/apis/${PROXY_NAME}/revisions/${REVISION}/deployments"
echo -n "Waiting for revision ${REVISION} to serve traffic"
DEADLINE=$(( $(date +%s) + 180 ))
READY=false
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 10
  STATE=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${STATUS_URL}" \
    | tr -d '\n' | grep -o '"state": *"[A-Z]*"' | head -1 | cut -d'"' -f4)
  if [ "$STATE" = "READY" ]; then
    READY=true
    break
  fi
  echo -n "."
done
echo ""

if [ "$READY" = "true" ]; then
  # READY is necessary but not sufficient; hold a margin before returning.
  echo "Revision ${REVISION} reports READY. Holding 20s for full propagation..."
  sleep 20
  echo "=== Deployment Completed and Propagated (rev ${REVISION} on ${ENV}) ==="
else
  echo "!! Revision ${REVISION} did not report READY within 180s." >&2
  echo "   It may still be rolling out. Re-check before trusting any test result:" >&2
  echo "   curl -H \"Authorization: Bearer \\\$(gcloud auth print-access-token)\" ${STATUS_URL}" >&2
  exit 1
fi
