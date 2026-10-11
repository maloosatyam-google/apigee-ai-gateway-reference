#!/usr/bin/env bash
# Deploy the Agent Showcase ADK service to Cloud Run (private).
#
#   agents/deploy.sh            # build (runs unit tests), deploy, print URL
#
# - Own service account with Vertex AI User only: the baseline agent calls
#   Vertex directly with it. It holds no Apigee keys.
# - --no-allow-unauthenticated: only the UI's service account (and the deployer,
#   for smoke tests) may invoke it, with a Google ID token.
# - Image is SHA-tagged; roll back with
#   gcloud run deploy agent-showcase-api --image "$IMAGE_REPO:<old-sha>" (same flags).
set -euo pipefail

source "$(cd "$(dirname "$0")/.." && pwd)/scripts/lib/config.sh"
require_config GCP_PROJECT_ID APIGEE_HOST_PROD
PROJECT="$GCP_PROJECT_ID"
REGION="$GCP_REGION"
SERVICE=agent-showcase-api
SA_NAME=agent-showcase-sa
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
UI_SA="apigee-ui-mgmt-sa@$PROJECT.iam.gserviceaccount.com"
IMAGE_REPO="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE"

cd "$(dirname "$0")"
SHA="$(git rev-parse --short HEAD)$(git diff --quiet -- . || echo -dirty)"

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name "Agent Showcase (ADK) runtime"
fi
for attempt in 1 2 3 4 5 6; do  # a new service account takes a moment to propagate
  if gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
    --role roles/aiplatform.user --condition=None --quiet >/dev/null; then
    break
  fi
  [ "$attempt" = 6 ] && exit 1
  sleep 10
done

# The Docker build runs the unit tests (test stage); a failure stops here.
gcloud builds submit --tag "$IMAGE_REPO:$SHA" --project "$PROJECT" --region "$REGION" .

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE_REPO:$SHA" \
  --service-account "$SA" \
  --no-allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 20 --timeout 300 \
  --min-instances 1 --max-instances 3 \
  --set-env-vars "ENVIRONMENT=production,GCP_PROJECT=$PROJECT,GATEWAY_HOST=https://${APIGEE_HOST_PROD},VERTEX_LOCATION=global,BASELINE_MODEL=gemini-3.8-flash" \
  --labels "app=agent-showcase,sha=${SHA//[^a-z0-9-]/-}"

for MEMBER in "serviceAccount:$UI_SA" "user:$(gcloud config get-value account 2>/dev/null)"; do
  gcloud run services add-iam-policy-binding "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --member "$MEMBER" --role roles/run.invoker --quiet >/dev/null
done

gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)'
