#!/usr/bin/env bash
# Deploy the daily pricing & model watch:
#   - service account  model-watch-sa        (writes reports to the bucket, nothing else)
#   - Cloud Run job    model-watch           (services/model-watch/watch.py)
#   - Cloud Scheduler  model-watch-daily     (runs the job every day)
#   - IAM: the UI service account may read the reports and start the job ("Check now")
#
# Usage: services/model-watch/deploy.sh            (idempotent; re-run to update)
# Env overrides: GCP_PROJECT_ID, GCP_REGION, MODEL_WATCH_BUCKET, MODEL_WATCH_SCHEDULE,
#                MODEL_WATCH_TZ, UI_RUNTIME_SA
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# Loads the repo-root .env and derived defaults (see .env.example).
# shellcheck source=../../scripts/lib/config.sh
. ../../scripts/lib/config.sh
require_config GCP_PROJECT_ID

PROJECT="$GCP_PROJECT_ID"
REGION="$GCP_REGION"
BUCKET="${MODEL_WATCH_BUCKET:-${THEME_BUCKET:-${PROJECT}-customer-themes}}"
SCHEDULE="${MODEL_WATCH_SCHEDULE:-0 7 * * *}"
TZ_NAME="${MODEL_WATCH_TZ:-Asia/Singapore}"
JOB=model-watch
SA_NAME=model-watch-sa
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
# Identity of the UI Cloud Run service (reads the report, starts the job on "Check now").
UI_SA="${UI_RUNTIME_SA:-$(gcloud run services describe apigee-ai-gateway-ui --region "$REGION" --project "$PROJECT" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)}"
if [ -z "$UI_SA" ]; then
  NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  UI_SA="${NUM}-compute@developer.gserviceaccount.com"
fi

echo "==> Project $PROJECT, region $REGION, bucket gs://$BUCKET, schedule '$SCHEDULE' ($TZ_NAME)"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --project "$PROJECT" --quiet

echo "==> Service account $SA"
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "Model & pricing watch"
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" \
  --role roles/storage.objectUser --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$UI_SA" \
  --role roles/storage.objectViewer --quiet >/dev/null

echo "==> Cloud Run job $JOB"
gcloud run jobs deploy "$JOB" --source . --region "$REGION" --project "$PROJECT" \
  --service-account "$SA" --set-env-vars "MODEL_WATCH_BUCKET=$BUCKET" \
  --task-timeout 300 --max-retries 1 --memory 512Mi --quiet

echo "==> IAM on the job (scheduler + UI 'Check now')"
for member in "serviceAccount:$SA" "serviceAccount:$UI_SA"; do
  gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --project "$PROJECT" \
    --member "$member" --role roles/run.invoker --quiet >/dev/null
done

echo "==> Scheduler model-watch-daily"
URI="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run"
if gcloud scheduler jobs describe model-watch-daily --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  verb=update
else
  verb=create
fi
gcloud scheduler jobs "$verb" http model-watch-daily --location "$REGION" --project "$PROJECT" \
  --schedule "$SCHEDULE" --time-zone "$TZ_NAME" --uri "$URI" --http-method POST \
  --oauth-service-account-email "$SA" --quiet >/dev/null

echo "==> First run"
gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT" --wait --quiet
gcloud storage cat "gs://$BUCKET/model-watch/latest.json" | python3 -c \
  'import json,sys;r=json.load(sys.stdin);print("checked",r["checkedAt"],"| sources",{k:v["ok"] for k,v in r["sources"].items()},"| errors",r["errors"])'
echo "Done. The Admin Console shows the result under 'Pricing & model watch'."
