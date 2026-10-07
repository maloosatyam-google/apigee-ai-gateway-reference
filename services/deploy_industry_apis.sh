#!/usr/bin/env bash
# Builds the services image and deploys the private Cloud Run service `industry-apis`
# (mock APIs + MCP servers for the industry demo packs).
#
#   bash services/deploy_industry_apis.sh
#
# - Syncs industries/*.json into services/industries first (the build context is services/).
# - Same image as customer-service / business-insights, selected with SERVICE=industry-apis.
#   Tagged by git sha and `industry-apis-latest`; the shared `:latest` tag is left alone.
# - Private: only the Apigee proxy service account (ai-client) and the UI service account
#   (demo reset) may invoke it.
# Rollback: gcloud run services update-traffic industry-apis --to-revisions=<rev>=100 --region <region>
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/config.sh"
require_config GCP_PROJECT_ID
PROJECT="${PROJECT:-${GCP_PROJECT_ID}}"
REGION="${REGION:-${GCP_REGION}}"
SERVICE_NAME="industry-apis"
REPO_IMG="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/demo-business-services"
INVOKERS=("ai-client@${PROJECT}.iam.gserviceaccount.com" "apigee-ui-mgmt-sa@${PROJECT}.iam.gserviceaccount.com")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${HERE}")"
SHA="$(git -C "${ROOT}" rev-parse --short HEAD)"

node "${ROOT}/industries/sync.js"
(cd "${HERE}" && npm test)

echo "Building ${REPO_IMG}:${SHA} ..."
BUILD_ID=$(gcloud builds submit "${HERE}" --async --format='value(id)' --tag "${REPO_IMG}:${SHA}" \
  --project "${PROJECT}" --region "${REGION}")
# Poll instead of streaming logs (streaming needs Viewer on the logs bucket).
while :; do
  STATUS=$(gcloud builds describe "${BUILD_ID}" --project "${PROJECT}" --region "${REGION}" --format='value(status)')
  case "${STATUS}" in
    SUCCESS) break ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED) echo "Build ${BUILD_ID}: ${STATUS}"; exit 1 ;;
    *) sleep 10 ;;
  esac
done
gcloud artifacts docker tags add "${REPO_IMG}:${SHA}" "${REPO_IMG}:industry-apis-latest" --quiet

gcloud run deploy "${SERVICE_NAME}" \
  --image "${REPO_IMG}:${SHA}" \
  --set-env-vars SERVICE=industry-apis \
  --region "${REGION}" --project "${PROJECT}" --platform managed \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 5 --memory 512Mi \
  --update-labels "git-sha=${SHA}"

for SA in "${INVOKERS[@]}"; do
  gcloud run services add-iam-policy-binding "${SERVICE_NAME}" --region "${REGION}" --project "${PROJECT}" \
    --member "serviceAccount:${SA}" --role roles/run.invoker --quiet >/dev/null
  echo "  run.invoker: ${SA}"
done

URL=$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --project "${PROJECT}" --format='value(status.url)')
echo "Deployed ${SERVICE_NAME} (${SHA}): ${URL}"
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${URL}/healthz" && echo
