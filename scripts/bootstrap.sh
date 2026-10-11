#!/usr/bin/env bash
# Stand up the whole demo in YOUR Google Cloud project, on top of an existing Apigee X org.
#
#   cp .env.example .env && $EDITOR .env      # fill in the "Required" block
#   scripts/bootstrap.sh --check              # read-only: what exists, what is missing
#   scripts/bootstrap.sh                      # run every step (idempotent, safe to re-run)
#   scripts/bootstrap.sh proxies products     # run selected steps only
#
# Steps (in order):
#   apis            enable the Google APIs the demo uses
#   iam             service accounts + IAM roles (UI management SA, proxy runtime SA)
#   modelarmor      Model Armor templates used by the AI Gateway (prompt + response)
#   vectorsearch    Vertex AI Vector Search index + public endpoint for the semantic cache
#                   (first run takes ~30-60 min; writes the IDs back into .env)
#   datacollectors  Apigee analytics data collectors (dc_*) used by the proxies
#   backends        Cloud Run backends: customer-service-api, business-insights-api,
#                   industry-apis, servicenow-mcp-server, agent-showcase-api
#   kvms            Apigee KVMs: rate card, business-API config, router credentials
#   proxies         deploy every proxy in apigee/proxies to APIGEE_ENV_DEV and APIGEE_ENV_PROD
#   products        API products, developers, apps and industry packs
#   bucket          GCS bucket for the customer theme library
#   ui              build and deploy the UI to Cloud Run (ui/scripts/deploy_prod.sh)
#   modelwatch      daily pricing & model watch: Cloud Run job + Cloud Scheduler
#                   (services/model-watch/deploy.sh)
#
# Prerequisites: gcloud (logged in as a project Owner or equivalent), Node 20+, Python 3.10+,
# an Apigee X org in the project with two environments attached to environment groups whose
# hostnames you put in APIGEE_HOST_PROD / APIGEE_HOST_DEV. No Apigee yet? See
# docs/phase2_apigee_provisioning.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "${ROOT}/scripts/lib/config.sh"
export APIGEE_ENV_DEV="${APIGEE_ENV_DEV:-dev}"
export APIGEE_ENV_PROD="${APIGEE_ENV_PROD:-prod}"

CHECK=false
STEPS=()
for a in "$@"; do
  case "$a" in
    --check) CHECK=true ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) STEPS+=("$a") ;;
  esac
done
ALL_STEPS=(apis iam modelarmor vectorsearch datacollectors backends kvms proxies products bucket ui modelwatch)
[ "${#STEPS[@]}" -eq 0 ] && STEPS=("${ALL_STEPS[@]}")

require_config GCP_PROJECT_ID GCP_REGION APIGEE_ORG APIGEE_HOST_PROD DEMO_ADMIN_EMAIL
P="$GCP_PROJECT_ID"
R="$GCP_REGION"
gc() { gcloud --project "$P" --quiet "$@"; }
TOKEN="$(gcloud auth print-access-token)"
# Apigee calls: prefer the UI management SA (works where user tokens are restricted by
# context-aware access), then ADC, then the user token.
APIGEE_TOKEN="$(gcloud auth print-access-token --impersonate-service-account="${UI_MGMT_SA}" 2>/dev/null \
  || gcloud auth application-default print-access-token 2>/dev/null || echo "$TOKEN")"
api() {
  local t="$TOKEN"
  case "$*" in *apigee.googleapis.com*) t="$APIGEE_TOKEN" ;; esac
  curl -sS -H "Authorization: Bearer ${t}" -H "x-goog-user-project: ${P}" -H 'Content-Type: application/json' "$@"
}
APIGEE="https://apigee.googleapis.com/v1/organizations/${APIGEE_ORG}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
miss() { printf '  \033[33m•\033[0m %s\n' "$*"; MISSING=$((MISSING + 1)); }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
MISSING=0

# Persist a value into .env (used for IDs that only exist after creation).
set_env() {
  local key="$1" val="$2" f="${ROOT}/.env"
  touch "$f"
  if grep -q "^${key}=" "$f"; then
    python3 - "$f" "$key" "$val" <<'PY'
import sys, re
f, k, v = sys.argv[1:]
s = open(f).read()
s = re.sub(rf'^{k}=.*$', f'{k}="{v}"', s, flags=re.M)
open(f, 'w').write(s)
PY
  else
    echo "${key}=\"${val}\"" >> "$f"
  fi
  export "${key}=${val}"
}

# ------------------------------------------------------------------------------------------
do_apis() {
  step "APIs"
  local apis=(apigee.googleapis.com aiplatform.googleapis.com modelarmor.googleapis.com run.googleapis.com
    cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
    logging.googleapis.com storage.googleapis.com bigquery.googleapis.com apihub.googleapis.com
    cloudresourcemanager.googleapis.com)
  local enabled; enabled="$(gc services list --enabled --format='value(config.name)')"
  local todo=()
  for a in "${apis[@]}"; do
    if grep -qx "$a" <<<"$enabled"; then ok "$a"; else miss "$a"; todo+=("$a"); fi
  done
  if ! $CHECK && [ "${#todo[@]}" -gt 0 ]; then gc services enable "${todo[@]}"; ok "enabled ${#todo[@]} APIs"; fi
}

ensure_sa() { # name display
  local email="$1@${P}.iam.gserviceaccount.com"
  if gc iam service-accounts describe "$email" >/dev/null 2>&1; then ok "SA $email"
  else miss "SA $email"; $CHECK || gc iam service-accounts create "$1" --display-name "$2" >/dev/null; fi
}
grant() { # member role
  if $CHECK; then return; fi
  gc projects add-iam-policy-binding "$P" --member "$1" --role "$2" --condition=None >/dev/null && ok "$2 -> ${1#*:}"
}

do_iam() {
  step "Service accounts and IAM"
  ensure_sa "${UI_MGMT_SA%%@*}" "Apigee demo UI (management API)"
  ensure_sa "${PROXY_SA%%@*}" "Apigee proxy runtime"
  for r in roles/apigee.admin roles/apigee.monetizationAdmin roles/logging.viewer roles/aiplatform.user; do
    grant "serviceAccount:${UI_MGMT_SA}" "$r"
  done
  for r in roles/aiplatform.user roles/modelarmor.user roles/logging.logWriter roles/bigquery.dataViewer \
           roles/bigquery.jobUser roles/iam.serviceAccountTokenCreator; do
    grant "serviceAccount:${PROXY_SA}" "$r"
  done
  # Local development impersonates the UI SA (ui/server/deployConfig.js -> UI_MGMT_SA).
  $CHECK || gc iam service-accounts add-iam-policy-binding "$UI_MGMT_SA" \
    --member "user:${DEMO_ADMIN_EMAIL}" --role roles/iam.serviceAccountTokenCreator >/dev/null \
    && ok "user:${DEMO_ADMIN_EMAIL} may impersonate ${UI_MGMT_SA}"
  # Apigee deploys proxies "as" the runtime SA.
  local agent="service-${GCP_PROJECT_NUMBER}@gcp-sa-apigee.iam.gserviceaccount.com"
  $CHECK || gc iam service-accounts add-iam-policy-binding "$PROXY_SA" \
    --member "serviceAccount:${agent}" --role roles/iam.serviceAccountTokenCreator >/dev/null \
    && ok "Apigee service agent may act as ${PROXY_SA}"
}

do_modelarmor() {
  step "Model Armor templates (${R})"
  local base="https://modelarmor.${R}.rep.googleapis.com/v1/projects/${P}/locations/${R}/templates"
  local rai='{"raiFilters":[{"filterType":"HATE_SPEECH","confidenceLevel":"HIGH"},{"filterType":"DANGEROUS","confidenceLevel":"HIGH"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"HIGH"},{"filterType":"HARASSMENT","confidenceLevel":"HIGH"}]}'
  local prompt_cfg="{\"filterConfig\":{\"raiSettings\":${rai},\"piAndJailbreakFilterSettings\":{\"filterEnforcement\":\"ENABLED\",\"confidenceLevel\":\"HIGH\"},\"maliciousUriFilterSettings\":{\"filterEnforcement\":\"ENABLED\"}}}"
  local resp_cfg="{\"filterConfig\":{\"raiSettings\":${rai},\"sdpSettings\":{\"basicConfig\":{\"filterEnforcement\":\"ENABLED\"}}}}"
  for t in apigee-sanitize-user-prompt apigee-sanitize-model-response; do
    if api "${base}/${t}" | grep -q '"name"'; then ok "$t"
    else
      miss "$t"
      if ! $CHECK; then
        local body="$prompt_cfg"; [ "$t" = apigee-sanitize-model-response ] && body="$resp_cfg"
        api -X POST "${base}?templateId=${t}" -d "$body" | grep -q '"name"' && ok "created $t"
      fi
    fi
  done
}

do_vectorsearch() {
  step "Vector Search (semantic cache)"
  if [ -n "${VECTOR_SEARCH_INDEX_ID}" ] && [ -n "${VECTOR_SEARCH_INDEX_ENDPOINT_ID}" ] && [ -n "${VECTOR_SEARCH_ENDPOINT_HOST}" ]; then
    ok "configured in .env (index ${VECTOR_SEARCH_INDEX_ID}, endpoint ${VECTOR_SEARCH_INDEX_ENDPOINT_ID})"; return
  fi
  miss "VECTOR_SEARCH_* not set"
  $CHECK && return
  local idx ep
  idx="$(gc ai indexes list --region "$R" --filter='displayName=semantic-cache-index' --format='value(name.basename())' 2>/dev/null | head -1)"
  if [ -z "$idx" ]; then
    local meta; meta="$(mktemp)"
    cat > "$meta" <<'JSON'
{"config": {"dimensions": 768, "approximateNeighborsCount": 150, "distanceMeasureType": "DOT_PRODUCT_DISTANCE",
  "featureNormType": "NONE", "shardSize": "SHARD_SIZE_SMALL",
  "algorithmConfig": {"treeAhConfig": {"leafNodeEmbeddingCount": "10000", "fractionLeafNodesToSearch": 0.05}}}}
JSON
    echo "  creating index (several minutes)..."
    gc ai indexes create --region "$R" --display-name semantic-cache-index --metadata-file "$meta" \
      --index-update-method stream-update >/dev/null
    idx="$(gc ai indexes list --region "$R" --filter='displayName=semantic-cache-index' --format='value(name.basename())' | head -1)"
  fi
  ok "index $idx"
  ep="$(gc ai index-endpoints list --region "$R" --filter='displayName=semantic-cache-endpoint' --format='value(name.basename())' 2>/dev/null | head -1)"
  if [ -z "$ep" ]; then
    gc ai index-endpoints create --region "$R" --display-name semantic-cache-endpoint --public-endpoint-enabled >/dev/null
    ep="$(gc ai index-endpoints list --region "$R" --filter='displayName=semantic-cache-endpoint' --format='value(name.basename())' | head -1)"
  fi
  ok "endpoint $ep"
  if ! gc ai index-endpoints describe "$ep" --region "$R" --format='value(deployedIndexes.id)' | grep -q semantic_cache; then
    echo "  deploying index to endpoint (can take 30-60 min)..."
    gc ai index-endpoints deploy-index "$ep" --region "$R" --index "$idx" --deployed-index-id semantic_cache \
      --display-name semantic-cache --machine-type e2-standard-2 --min-replica-count 1 --max-replica-count 1 >/dev/null
  fi
  local host; host="$(gc ai index-endpoints describe "$ep" --region "$R" --format='value(publicEndpointDomainName)')"
  set_env VECTOR_SEARCH_INDEX_ID "$idx"
  set_env VECTOR_SEARCH_INDEX_ENDPOINT_ID "$ep"
  set_env VECTOR_SEARCH_ENDPOINT_HOST "$host"
  ok "wrote VECTOR_SEARCH_* to .env"
}

do_datacollectors() {
  step "Apigee data collectors"
  local have; have="$(api "${APIGEE}/datacollectors" | python3 -c 'import json,sys;print("\n".join(d["name"] for d in json.load(sys.stdin).get("dataCollectors",[])))')"
  local dc
  for dc in dc_model_name:STRING dc_user_email:STRING dc_cache_status:STRING dc_prompt_token_count:INTEGER \
            dc_candidates_token_count:INTEGER dc_total_token_count:INTEGER dc_llm_input_token:INTEGER \
            dc_llm_output_token:INTEGER; do
    local n="${dc%%:*}" t="${dc##*:}"
    if grep -qx "$n" <<<"$have"; then ok "$n"
    else miss "$n"; $CHECK || { api -X POST "${APIGEE}/datacollectors" -d "{\"name\":\"$n\",\"type\":\"$t\"}" >/dev/null && ok "created $n"; }; fi
  done
}

deploy_source_service() { # name source-dir extra-env invoker...
  local name="$1" src="$2" envs="$3"; shift 3
  if gc run services describe "$name" --region "$R" >/dev/null 2>&1; then ok "Cloud Run $name"; $CHECK && return
  else miss "Cloud Run $name"; $CHECK && return; fi
  gc run deploy "$name" --source "$src" --region "$R" --no-allow-unauthenticated \
    ${envs:+--set-env-vars "$envs"} --min-instances 0 --max-instances 5 --memory 512Mi >/dev/null
  for inv in "$@"; do
    gc run services add-iam-policy-binding "$name" --region "$R" --member "serviceAccount:${inv}" \
      --role roles/run.invoker >/dev/null
  done
  ok "deployed $name: $(gc run services describe "$name" --region "$R" --format='value(status.url)')"
}

do_backends() {
  step "Cloud Run backends"
  node "${ROOT}/industries/sync.js" >/dev/null 2>&1 || true
  deploy_source_service customer-service-api "${ROOT}/services" "SERVICE=customer-service" "$PROXY_SA" "$UI_MGMT_SA"
  deploy_source_service business-insights-api "${ROOT}/services" "SERVICE=business-insights" "$PROXY_SA" "$UI_MGMT_SA"
  deploy_source_service industry-apis "${ROOT}/services" "SERVICE=industry-apis" "$PROXY_SA" "$UI_MGMT_SA"
  deploy_source_service servicenow-mcp-server "${ROOT}/mcp-servers/servicenow" "APIGEE_HOST_PROD=${APIGEE_HOST_PROD}" "$PROXY_SA"
  if gc run services describe agent-showcase-api --region "$R" >/dev/null 2>&1; then ok "Cloud Run agent-showcase-api"
  else miss "Cloud Run agent-showcase-api"; $CHECK || bash "${ROOT}/agents/deploy.sh"; fi
}

do_kvms() {
  step "Apigee KVMs"
  local env
  for env in "$APIGEE_ENV_DEV" "$APIGEE_ENV_PROD"; do
    local have; have="$(api "${APIGEE}/environments/${env}/keyvaluemaps" | tr -d '[]" \n')"
    for kvm in ai-model-rates customer-tools-config ai-gateway-creds; do
      if tr ',' '\n' <<<"$have" | grep -qx "$kvm"; then ok "$env/$kvm"; else miss "$env/$kvm"; fi
    done
    $CHECK && continue
    bash "${ROOT}/apigee/scripts/sync_rate_card.sh" --org "$APIGEE_ORG" --env "$env"
    # Router credentials: optional third-party key (TypeSafe JEV router). Never stored in git.
    api -X POST "${APIGEE}/environments/${env}/keyvaluemaps" -d '{"name":"ai-gateway-creds","encrypted":true}' >/dev/null || true
    if [ -n "${TYPESAFE_API_KEY:-}" ]; then
      api -X POST "${APIGEE}/environments/${env}/keyvaluemaps/ai-gateway-creds/entries" \
        -d "{\"name\":\"typesafe_api_key\",\"value\":\"${TYPESAFE_API_KEY}\"}" >/dev/null || \
      api -X PUT "${APIGEE}/environments/${env}/keyvaluemaps/ai-gateway-creds/entries/typesafe_api_key" \
        -d "{\"name\":\"typesafe_api_key\",\"value\":\"${TYPESAFE_API_KEY}\"}" >/dev/null
      ok "$env/ai-gateway-creds typesafe_api_key set"
    else
      echo "  (TYPESAFE_API_KEY not set: /auto falls back to the built-in classifier routing)"
    fi
  done
}

do_proxies() {
  step "Apigee proxies -> ${APIGEE_ENV_DEV}, ${APIGEE_ENV_PROD}"
  local p
  for d in "${ROOT}"/apigee/proxies/*/; do
    p="$(basename "$d")"
    if $CHECK; then
      if api "${APIGEE}/environments/${APIGEE_ENV_PROD}/apis/${p}/deployments" | grep -q '"revision"'; then ok "$p"; else miss "$p"; fi
      continue
    fi
    case "$p" in
      customer-service-v1|business-insights-v1) continue ;;   # deployed with their KVM below
    esac
    for env in "$APIGEE_ENV_DEV" "$APIGEE_ENV_PROD"; do
      bash "${ROOT}/apigee/scripts/deploy_proxy.sh" --env "$env" --proxy "$p" --no-wait
    done
  done
  if ! $CHECK; then
    for env in "$APIGEE_ENV_DEV" "$APIGEE_ENV_PROD"; do
      bash "${ROOT}/apigee/scripts/deploy_business_proxies.sh" "$env"
    done
  fi
  echo "  NOTE: the /mcp tools-gateway proxy is created in the Apigee UI (MCP proxy), not from this repo."
  echo "        See README > Replicate in your environment > MCP gateway."
}

do_products() {
  step "API products, developers and apps"
  if $CHECK; then
    local n; n="$(api "${APIGEE}/apiproducts" | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("apiProduct",[])))')"
    if [ "$n" -gt 0 ]; then ok "$n API products"; else miss "API products"; fi
    return
  fi
  python3 "${ROOT}/apigee/scripts/provision_unified_credentials.py" --org "$APIGEE_ORG" --dev "$DEMO_ADMIN_EMAIL"
  python3 "${ROOT}/apigee/scripts/provision_business_products.py"
  for pack in "${ROOT}"/industries/*.json; do
    python3 "${ROOT}/apigee/scripts/provision_industry_pack.py" "$(basename "$pack" .json)" || true
  done
}

do_bucket() {
  step "Theme library bucket"
  if gcloud storage buckets describe "gs://${THEME_BUCKET}" --project "$P" >/dev/null 2>&1; then ok "gs://${THEME_BUCKET}"
  else
    miss "gs://${THEME_BUCKET}"
    $CHECK || { gcloud storage buckets create "gs://${THEME_BUCKET}" --project "$P" --location "$R" --uniform-bucket-level-access >/dev/null; ok "created"; }
  fi
  $CHECK || gcloud storage buckets add-iam-policy-binding "gs://${THEME_BUCKET}" \
    --member "serviceAccount:${UI_MGMT_SA}" --role roles/storage.objectAdmin >/dev/null
}

do_ui() {
  step "UI (Cloud Run)"
  if gc run services describe "$UI_SERVICE" --region "$R" >/dev/null 2>&1; then ok "Cloud Run $UI_SERVICE"; else miss "Cloud Run $UI_SERVICE"; fi
  $CHECK && return
  (cd "${ROOT}/ui" && npm install --no-audit --no-fund)
  SKIP_LIVE="${SKIP_LIVE:-1}" bash "${ROOT}/ui/scripts/deploy_prod.sh" bootstrap
  echo "  Put the service behind IAP + an HTTPS load balancer: docs/cloud_run_iap_deployment_guide.md"
}

do_modelwatch() {
  step "Daily pricing & model watch"
  if gc run jobs describe model-watch --region "$R" >/dev/null 2>&1; then ok "Cloud Run job model-watch"
  else miss "Cloud Run job model-watch"; fi
  $CHECK && return
  bash "${ROOT}/services/model-watch/deploy.sh"
}

for s in "${STEPS[@]}"; do
  case "$s" in
    apis|iam|modelarmor|vectorsearch|datacollectors|backends|kvms|proxies|products|bucket|ui|modelwatch) "do_$s" ;;
    *) echo "Unknown step: $s (valid: ${ALL_STEPS[*]})" >&2; exit 2 ;;
  esac
done

if $CHECK; then
  echo
  if [ "$MISSING" -eq 0 ]; then echo "Everything is in place."; else echo "${MISSING} item(s) missing. Run scripts/bootstrap.sh to create them."; fi
fi
