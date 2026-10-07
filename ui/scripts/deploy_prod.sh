#!/usr/bin/env bash
# Deploys the UI to prod (Cloud Run) with a traceable, git-SHA-tagged image.
#
#   ui/scripts/deploy_prod.sh <change-name>        e.g. ui/scripts/deploy_prod.sh demo-reset
#
# Steps:
#   1. Refuses to run with uncommitted changes (the image tag must match a commit).
#      Set ALLOW_DIRTY=1 to override; the tag then gets a "-dirty" suffix.
#   2. Tags what prod runs now as prod-YYYY-MM-DD-pre-<change-name> (rollback point). The
#      commit comes from the running service's git-sha label (override with LIVE_SHA=<commit>).
#   3. npm run build + npm test.
#   4. Cloud Build image :<sha>, then adds :latest to the same image.
#   5. Deploys :<sha> with the full security flag set and a git-sha label.
#   6. Pushes the git tag, resets demo data, and runs the live tests (SKIP_LIVE=1 to skip).
#
# Roll back: gcloud run deploy "$UI_SERVICE" --image "$IMAGE_REPO:<old-sha>" (same flags),
# or `gcloud run services update-traffic apigee-ai-gateway-ui --to-revisions=<rev>=100`.
set -euo pipefail

CHANGE="${1:-}"
if [[ -z "$CHANGE" ]]; then
  echo "usage: $0 <change-name>" >&2
  exit 1
fi

# Project, region, service account and every runtime value come from the repo-root
# .env (see .env.example) via scripts/lib/config.sh.
# shellcheck source=../../scripts/lib/config.sh
source "$(cd "$(dirname "$0")/../.." && pwd)/scripts/lib/config.sh"
require_config GCP_PROJECT_ID GCP_REGION APIGEE_HOST_PROD DEMO_ADMIN_EMAIL
PROJECT="$GCP_PROJECT_ID"
REGION="$GCP_REGION"
SERVICE="$UI_SERVICE"
SA="$UI_MGMT_SA"
IMAGE_REPO="${ARTIFACT_REPO}/${UI_SERVICE}"

# Runtime configuration for the container (read by ui/server/deployConfig.js). Uses
# '|' as the list delimiter because values contain commas, '@' and spaces.
RUNTIME_ENV_KEYS=(GCP_PROJECT_ID GCP_PROJECT_NUMBER GCP_REGION APIGEE_ORG APIGEE_HOST_PROD APIGEE_HOST_DEV
  SSO_USER_EMAIL DEMO_ADMIN_EMAIL PERSONA_APP_DEVELOPER UI_MGMT_SA INDUSTRY_APIS_URL
  CUSTOMER_SERVICE_API_URL AGENT_SHOWCASE_URL THEME_BUCKET
  ADMIN_USER_EMAIL SALES_AGENT_EMAIL LOANS_AGENT_EMAIL DEFAULT_ENV)
RUNTIME_ENV=""
for k in "${RUNTIME_ENV_KEYS[@]}"; do
  [[ -n "${!k:-}" ]] && RUNTIME_ENV+="${RUNTIME_ENV:+|}${k}=${!k}"
done

UI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$UI_DIR"

# 1. Commit identity
SHA="$(git rev-parse --short=7 HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "${ALLOW_DIRTY:-}" != "1" ]]; then
    echo "Uncommitted changes. Commit first, or set ALLOW_DIRTY=1." >&2
    exit 1
  fi
  SHA="${SHA}-dirty"
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Deploying $SERVICE at $SHA (branch $BRANCH)"

# 2. Rollback tag for what is live now
LIVE_SHA="${LIVE_SHA:-$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(spec.template.metadata.labels.git-sha)' 2>/dev/null || true)}"
LIVE_REV="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"
PRE_TAG="prod-$(date +%Y-%m-%d)-pre-${CHANGE}"
if [[ -n "$LIVE_SHA" && "$LIVE_SHA" != *-dirty ]] && git cat-file -e "${LIVE_SHA}^{commit}" 2>/dev/null; then
  git tag -f -a "$PRE_TAG" "$LIVE_SHA" -m "Prod before ${CHANGE}: revision ${LIVE_REV}, commit ${LIVE_SHA}"
  echo "==> Tagged live commit $LIVE_SHA ($LIVE_REV) as $PRE_TAG"
else
  echo "!!  Live revision $LIVE_REV has no usable git-sha label; tag the rollback commit by hand if needed:"
  echo "    git tag -a $PRE_TAG <commit> -m 'Prod before ${CHANGE}: revision ${LIVE_REV}'"
fi

# 3. Build and unit test
npm run build
npm test

# 4. Image: <sha>, plus latest on the same digest. Polls instead of streaming logs (streaming
#    needs Viewer on the Cloud Build logs bucket).
BUILD_ID="$(gcloud builds submit --async --format='value(id)' --tag "$IMAGE_REPO:$SHA" --project "$PROJECT" .)"
echo "==> Cloud Build $BUILD_ID"
while :; do
  STATUS="$(gcloud builds describe "$BUILD_ID" --project "$PROJECT" --format='value(status)')"
  case "$STATUS" in
    SUCCESS) break ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED) echo "Build $BUILD_ID: $STATUS" >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done
gcloud artifacts docker tags add "$IMAGE_REPO:$SHA" "$IMAGE_REPO:latest" --quiet

# 5. Deploy the SHA-tagged image (always the full flag set)
gcloud run deploy "$SERVICE" \
  --image="$IMAGE_REPO:$SHA" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --ingress=internal-and-cloud-load-balancing \
  --service-account="$SA" \
  --update-labels="git-sha=$SHA" \
  --update-env-vars="^|^${RUNTIME_ENV}" \
  --project="$PROJECT"

# 6. Push the rollback tag, reset demo data, live tests
if git rev-parse -q --verify "refs/tags/$PRE_TAG" >/dev/null; then
  git push -f origin "refs/tags/$PRE_TAG" || echo "!!  Could not push $PRE_TAG"
fi

echo "==> Resetting demo data"
node -e "import('./server/demoReset.js').then(m => m.resetDemoData()).then(r => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); })" \
  || echo "!!  Demo data reset failed; the guided demo resets it again when it starts."

if [[ "${SKIP_LIVE:-}" != "1" ]]; then
  echo "==> Live tests"
  npm run test:live
  # The live tests change demo data too; start the next demo clean.
  node -e "import('./server/demoReset.js').then(m => m.resetDemoData()).then(r => console.log(JSON.stringify(r)))" || true
fi

echo "==> Done: $SERVICE runs $IMAGE_REPO:$SHA"
