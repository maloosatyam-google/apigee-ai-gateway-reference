# shellcheck shell=bash
# Shared deployment configuration for every shell script in this repo.
#
#   source "$(git rev-parse --show-toplevel)/scripts/lib/config.sh"
#
# Loads the repo-root .env (see .env.example), then derives every value that has a
# sensible default from the few you must set yourself. Variables already exported in
# the environment win over .env. Nothing environment-specific is hardcoded in scripts.

_CONFIG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -f "${_CONFIG_ROOT}/.env" ]; then
  # Only fill variables that are not already set, so `FOO=x script.sh` overrides .env.
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in ''|'#'*) continue ;; esac
    _key="${_line%%=*}"
    _key="${_key#export }"
    [[ "$_key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [ -z "${!_key+x}" ]; then
      _val="${_line#*=}"
      _val="${_val%\"}"; _val="${_val#\"}"
      _val="${_val%\'}"; _val="${_val#\'}"
      export "$_key=$_val"
    fi
  done < "${_CONFIG_ROOT}/.env"
  unset _line _key _val
fi

# --- Required: the GCP project that hosts Apigee ---------------------------------
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-${GCP_PROJECT:-${APIGEE_ORG:-}}}"
export GCP_REGION="${GCP_REGION:-asia-southeast1}"
export APIGEE_ORG="${APIGEE_ORG:-${GCP_PROJECT_ID}}"

# --- Apigee hostnames (env group hostnames, no scheme) ----------------------------
export APIGEE_HOST_PROD="${APIGEE_HOST_PROD:-}"
export APIGEE_HOST_DEV="${APIGEE_HOST_DEV:-${APIGEE_HOST_PROD}}"

# --- Identities --------------------------------------------------------------------
export DEMO_ADMIN_EMAIL="${DEMO_ADMIN_EMAIL:-${SSO_USER_EMAIL:-}}"
export PERSONA_APP_DEVELOPER="${PERSONA_APP_DEVELOPER:-${DEMO_ADMIN_EMAIL}}"
export UI_MGMT_SA="${UI_MGMT_SA:-apigee-ui-mgmt-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"
export PROXY_SA="${PROXY_SA:-ai-client@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"

# --- Cloud Run backends --------------------------------------------------------------
# Deterministic Cloud Run URLs need the project NUMBER. Looked up once if not set.
if [ -z "${GCP_PROJECT_NUMBER:-}" ] && [ -n "${GCP_PROJECT_ID}" ] && command -v gcloud >/dev/null 2>&1; then
  GCP_PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || true)"
fi
export GCP_PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-}"
_run_url() { echo "https://$1-${GCP_PROJECT_NUMBER}.${GCP_REGION}.run.app"; }
export INDUSTRY_APIS_URL="${INDUSTRY_APIS_URL:-$(_run_url industry-apis)}"
export SERVICENOW_MCP_URL="${SERVICENOW_MCP_URL:-$(_run_url servicenow-mcp-server)}"
export CUSTOMER_SERVICE_API_URL="${CUSTOMER_SERVICE_API_URL:-$(_run_url customer-service-api)}"
export BUSINESS_INSIGHTS_API_URL="${BUSINESS_INSIGHTS_API_URL:-$(_run_url business-insights-api)}"
export AGENT_SHOWCASE_URL="${AGENT_SHOWCASE_URL:-$(_run_url agent-showcase-api)}"
export UI_SERVICE="${UI_SERVICE:-apigee-ai-gateway-ui}"
export ARTIFACT_REPO="${ARTIFACT_REPO:-${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/cloud-run-source-deploy}"

# --- AI services used by the ai-gateway-v1 proxy -------------------------------------
# Vector Search index for the semantic cache (created by scripts/bootstrap.sh).
export VECTOR_SEARCH_ENDPOINT_HOST="${VECTOR_SEARCH_ENDPOINT_HOST:-}"
export VECTOR_SEARCH_INDEX_ENDPOINT_ID="${VECTOR_SEARCH_INDEX_ENDPOINT_ID:-}"
export VECTOR_SEARCH_INDEX_ID="${VECTOR_SEARCH_INDEX_ID:-}"
export THEME_BUCKET="${THEME_BUCKET:-${GCP_PROJECT_ID}-customer-themes}"

# Fail with a clear message when a script needs a value that is not configured.
#   require_config GCP_PROJECT_ID APIGEE_HOST_PROD
require_config() {
  local missing=()
  for v in "$@"; do [ -n "${!v:-}" ] || missing+=("$v"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing configuration: ${missing[*]}" >&2
    echo "Set them in ${_CONFIG_ROOT}/.env (copy .env.example) or export them." >&2
    return 1
  fi
}
