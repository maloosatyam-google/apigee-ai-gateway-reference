#!/usr/bin/env bash
# ==============================================================================
# Apigee AI & Tools Gateway - Complete Deployment and Provisioning Orchestrator
#
# Usage:
#   bash apigee/scripts/deploy_all.sh [--org <ORG>] [--env <ENV>] [--dev <EMAIL>]
#
# Flags:
#   --org <ORG>          Apigee Organization (default: $APIGEE_ORG from .env)
#   --env <ENV>          Apigee Environment (default: prod)
#   --dev <EMAIL>        Developer Email (default: $DEMO_ADMIN_EMAIL from .env)
#   --proxy <NAME>       Proxy name to deploy (default: ai-gateway-v1)
#   --skip-proxy         Skip proxy deployment (only provision products & apps)
#   --skip-credentials   Skip product/app provisioning (only deploy proxy)
#   --dry-run            Validate files without making mutating API calls
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env and derived defaults (scripts/lib/config.sh)
source "${ROOT_DIR}/scripts/lib/config.sh"

ORG="${APIGEE_ORG:-${ORG:-}}"
ENV="${APIGEE_ENV:-${ENV:-prod}}"
DEV_EMAIL="${DEV_EMAIL:-${APIGEE_DEVELOPER:-${DEMO_ADMIN_EMAIL}}}"
PROXY_NAME="${PROXY_NAME:-ai-gateway-v1}"
SKIP_PROXY=false
SKIP_CREDS=false
DRY_RUN=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --org) ORG="$2"; shift ;;
        --env) ENV="$2"; shift ;;
        --dev) DEV_EMAIL="$2"; shift ;;
        --proxy) PROXY_NAME="$2"; shift ;;
        --skip-proxy) SKIP_PROXY=true ;;
        --skip-credentials) SKIP_CREDS=true ;;
        --dry-run) DRY_RUN=true ;;
        -h|--help)
            echo "Usage: $0 [--org <ORG>] [--env <ENV>] [--dev <EMAIL>] [--proxy <NAME>] [--skip-proxy] [--skip-credentials] [--dry-run]"
            exit 0
            ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
    shift
done

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "\n${BOLD}${BLUE}================================================================${NC}"
echo -e "${BOLD}${BLUE}   Apigee AI & Tools Gateway Deployment Orchestrator           ${NC}"
echo -e "${BOLD}${BLUE}================================================================${NC}"
echo -e "Organization: ${GREEN}${ORG}${NC}"
echo -e "Environment:  ${GREEN}${ENV}${NC}"
echo -e "Developer:    ${GREEN}${DEV_EMAIL}${NC}"
echo -e "Proxy Target: ${GREEN}${PROXY_NAME}${NC}"
echo -e "Dry Run Mode: ${YELLOW}${DRY_RUN}${NC}"
echo -e "${BOLD}${BLUE}----------------------------------------------------------------${NC}\n"

# ------------------------------------------------------------------------------
# 0. Pre-Flight Tooling & Auth Verification
# ------------------------------------------------------------------------------
echo -e "${BOLD}[Step 0/4] Checking prerequisites & credentials...${NC}"
command -v gcloud >/dev/null 2>&1 || { echo -e "${RED}[ERROR] gcloud CLI not found.${NC}"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo -e "${RED}[ERROR] python3 not found.${NC}"; exit 1; }
command -v zip >/dev/null 2>&1 || { echo -e "${RED}[ERROR] zip utility not found.${NC}"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo -e "${RED}[ERROR] curl not found.${NC}"; exit 1; }

if [ "$DRY_RUN" = false ]; then
  TOKEN=$(gcloud auth print-access-token 2>/dev/null) || {
    echo -e "${RED}[ERROR] Failed to obtain gcloud access token. Please run 'gcloud auth login'.${NC}"
    exit 1
  }
  echo -e "  ✓ gcloud authentication verified"
else
  echo -e "  ✓ Prerequisites check passed (dry-run)"
fi

# ------------------------------------------------------------------------------
# 1. Validate Proxy Bundle Structure
# ------------------------------------------------------------------------------
if [ "$SKIP_PROXY" = false ]; then
  echo -e "\n${BOLD}[Step 1/4] Validating Proxy Bundle '${PROXY_NAME}'...${NC}"
  python3 "${SCRIPT_DIR}/validate_bundle.py" "${PROXY_NAME}" || {
    echo -e "${RED}[ERROR] Proxy bundle validation failed.${NC}"
    exit 1
  }

  # ----------------------------------------------------------------------------
  # 2. Package & Deploy Proxy Bundle
  # ----------------------------------------------------------------------------
  echo -e "\n${BOLD}[Step 2/4] Packaging & Deploying '${PROXY_NAME}'...${NC}"
  bash "${SCRIPT_DIR}/package_bundle.sh" "${PROXY_NAME}"

  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}  [DRY-RUN] Would deploy apigee/dist/${PROXY_NAME}.zip to Org: ${ORG}, Env: ${ENV}${NC}"
  else
    bash "${SCRIPT_DIR}/deploy_proxy.sh" --org "${ORG}" --env "${ENV}" --proxy "${PROXY_NAME}"
  fi
else
  echo -e "\n${YELLOW}[Step 1-2/4] Skipping proxy bundle deployment (--skip-proxy).${NC}"
fi

# ------------------------------------------------------------------------------
# 3. Synchronize Products, Apps & Unified Credentials
# ------------------------------------------------------------------------------
if [ "$SKIP_CREDS" = false ]; then
  echo -e "\n${BOLD}[Step 3/4] Synchronizing API Products & Developer Apps...${NC}"
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}  [DRY-RUN] Would sync products from apigee/products/ and apps from apigee/apps/${NC}"
    ls -1 "${ROOT_DIR}/apigee/products" | sed 's/^/    - Product: /'
    ls -1 "${ROOT_DIR}/apigee/apps" | sed 's/^/    - App: /'
  else
    python3 "${SCRIPT_DIR}/provision_unified_credentials.py" --org "${ORG}" --dev "${DEV_EMAIL}"
  fi
else
  echo -e "\n${YELLOW}[Step 3/4] Skipping credential provisioning (--skip-credentials).${NC}"
fi

# ------------------------------------------------------------------------------
# 4. Summary & Verification Instructions
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}   Deployment & Provisioning Finished Successfully!             ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "\n${BOLD}Active Environment:${NC} ${ENV} (https://${APIGEE_HOST_PROD})"
echo -e "${BOLD}AI Gateway:${NC}         https://${APIGEE_HOST_PROD}/ai/v1"
echo -e "${BOLD}MCP Tools Gateway:${NC}  https://${APIGEE_HOST_PROD}/mcp"
echo -e "\n${BOLD}Unified Personas & Access Control:${NC}"
echo -e "  1. ${BOLD}Engineering & IT${NC} (Engineering and IT + Enterprise Tools MCP)"
echo -e "     - Models: auto, gemini-3.5-flash-lite, gemini-3.6-flash,"
echo -e "               gemini-3.1-pro-preview, gemini-3.8-flash,"
echo -e "               claude-haiku-5-5, claude-opus-5-5"
echo -e "     - Tools:  All tools (Customer Service, Business Insights, BigQuery, ServiceNow)"
echo -e "  2. ${BOLD}Customer Support & Sales${NC} (Customer Support and Sales + Customer Service Tools MCP)"
echo -e "     - Models: auto, gemini-3.5-flash-lite, gemini-3.6-flash,"
echo -e "               claude-haiku-5-5 (no Pro, no Opus)"
echo -e "     - Tools:  searchCustomers, getCustomer, listCustomerOrders, getOrderStatus, getProductPrice,"
echo -e "               createSupportCase, issueRefund ONLY (refunds over \$50 get 403 REFUND_LIMIT)"
echo -e "  3. ${BOLD}Analysts & Knowledge Workers${NC} (Analysts and Knowledge Workers + Business Insights Tools MCP)"
echo -e "     - Models: auto, gemini-3.1-pro-preview, gemini-3.5-flash-lite, gemini-3.6-flash,"
echo -e "               gemini-3.8-flash (no Claude)"
echo -e "     - Tools:  getRevenueTrends, getSupportMetrics, getChurnRisk, getProductMargins,"
echo -e "               runForecast (2/min) ONLY (no customer-level tools)"

echo -e "\n${BOLD}To test or run demo UI:${NC}"
echo -e "  cd ui && npm run dev"
echo -e "  URL: http://localhost:3000\n"
