#!/usr/bin/env bash
# End-to-End Verification Test Script for Apigee MCP Servers:
# 1. BigQuery MCP Server (bigquery-mcp)
# 2. ServiceNow Incident Management MCP Server (servicenow-mcp)
#
# Requires API_KEY (a developer app key entitled to the BigQuery Tools MCP and
# ServiceNow Tools MCP products), exported or set in the repo-root .env.
# Credentials are never defaulted in source.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env and derived defaults (scripts/lib/config.sh)
source "${ROOT_DIR}/scripts/lib/config.sh"

GATEWAY_HOST="${GATEWAY_HOST:-${APIGEE_HOST_PROD}}"
PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT_ID}}"
if [ -z "${API_KEY:-}" ]; then
  echo "ERROR: API_KEY is not set. Export it or add it to ${ROOT_DIR}/.env" >&2
  exit 2
fi

echo "=========================================================="
echo "    Apigee MCP Servers End-to-End Verification Suite      "
echo "=========================================================="
echo "Gateway Host: https://${GATEWAY_HOST}"
echo "Project ID:   ${PROJECT_ID}"
echo "API Key:      ${API_KEY:0:6}...${API_KEY: -4}"
echo "Timestamp:    $(date -u)"
echo ""

PASSED=0
FAILED=0

assert_success() {
  local test_name="$1"
  local condition="$2"
  if [ "$condition" -eq 0 ]; then
    echo "  [PASS] $test_name"
    PASSED=$((PASSED + 1))
  else
    echo "  [FAIL] $test_name"
    FAILED=$((FAILED + 1))
  fi
}

echo "=== 1. Testing BigQuery MCP Server (bigquery-mcp) ==="

echo "Test 1.1: tools/list discovery"
BQ_LIST_RES=$(curl -s -X POST "https://${GATEWAY_HOST}/bigquery/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1, "params": {}}')

BQ_TOOL_COUNT=$(echo "$BQ_LIST_RES" | jq '.result.tools | length // 0')
BQ_HAS_DATASETS=$(echo "$BQ_LIST_RES" | grep -c "list_dataset_ids" || true)
BQ_HAS_SQL=$(echo "$BQ_LIST_RES" | grep -c "execute_sql_readonly" || true)

if [ "$BQ_TOOL_COUNT" -ge 8 ] && [ "$BQ_HAS_DATASETS" -ge 1 ] && [ "$BQ_HAS_SQL" -ge 1 ]; then
  assert_success "BigQuery MCP tools/list returns all 8 tools" 0
else
  echo "Response: $BQ_LIST_RES"
  assert_success "BigQuery MCP tools/list returns all 8 tools" 1
fi

echo "Test 1.2: tools/call list_dataset_ids"
BQ_CALL_RES=$(curl -s -X POST "https://${GATEWAY_HOST}/bigquery/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 2, "params": {"name": "list_dataset_ids", "arguments": {"projectId": "'"${PROJECT_ID}"'"}}}')

BQ_HAS_ADANI=$(echo "$BQ_CALL_RES" | grep -c "adani_ic" || true)
if [ "$BQ_HAS_ADANI" -ge 1 ]; then
  assert_success "BigQuery tools/call list_dataset_ids returned real datasets" 0
else
  echo "Response: $BQ_CALL_RES"
  assert_success "BigQuery tools/call list_dataset_ids returned real datasets" 1
fi

echo "Test 1.3: tools/call execute_sql_readonly"
BQ_SQL_RES=$(curl -s -X POST "https://${GATEWAY_HOST}/bigquery/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 3, "params": {"name": "execute_sql_readonly", "arguments": {"projectId": "'"${PROJECT_ID}"'", "query": "SELECT 1 as test_val, '\''Apigee MCP Verified'\'' as message"}}}')

BQ_SQL_SUCCESS=$(echo "$BQ_SQL_RES" | grep -c "Apigee MCP Verified" || true)
if [ "$BQ_SQL_SUCCESS" -ge 1 ]; then
  assert_success "BigQuery execute_sql_readonly successfully executed query" 0
else
  echo "Response: $BQ_SQL_RES"
  assert_success "BigQuery execute_sql_readonly successfully executed query" 1
fi

echo "Test 1.4: Security governance - Missing API Key rejection"
BQ_UNAUTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://${GATEWAY_HOST}/bigquery/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 4, "params": {}}')

if [ "$BQ_UNAUTH_HTTP" -eq 401 ]; then
  assert_success "BigQuery MCP blocks missing API Key with HTTP 401" 0
else
  assert_success "BigQuery MCP blocks missing API Key with HTTP 401 (got ${BQ_UNAUTH_HTTP})" 1
fi

echo "Test 1.5: OAuth Protected Resource Metadata endpoint"
BQ_PRM_RES=$(curl -s "https://${GATEWAY_HOST}/.well-known/oauth-protected-resource/bigquery/mcp")
BQ_PRM_HAS_AUTH=$(echo "$BQ_PRM_RES" | grep -c "https://accounts.google.com/" || true)
if [ "$BQ_PRM_HAS_AUTH" -ge 1 ]; then
  assert_success "BigQuery OAuth PRM returns valid authorization metadata" 0
else
  assert_success "BigQuery OAuth PRM returns valid authorization metadata" 1
fi

echo ""
echo "=== 2. Testing ServiceNow Incident Management MCP Server (servicenow-mcp) ==="

echo "Test 2.1: tools/list discovery for ServiceNow tools"
NOW_LIST_RES=$(curl -s -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 5, "params": {}}')

NOW_HAS_INCIDENTS=$(echo "$NOW_LIST_RES" | grep -c "listIncidents" || true)
NOW_HAS_CREATE=$(echo "$NOW_LIST_RES" | grep -c "createIncident" || true)
NOW_HAS_GET=$(echo "$NOW_LIST_RES" | grep -c "getIncident" || true)
NOW_HAS_UPDATE=$(echo "$NOW_LIST_RES" | grep -c "updateIncident" || true)

if [ "$NOW_HAS_INCIDENTS" -ge 1 ] && [ "$NOW_HAS_CREATE" -ge 1 ] && [ "$NOW_HAS_GET" -ge 1 ] && [ "$NOW_HAS_UPDATE" -ge 1 ]; then
  assert_success "ServiceNow MCP tools/list includes all incident tools" 0
else
  echo "Response: $NOW_LIST_RES"
  assert_success "ServiceNow MCP tools/list includes all incident tools" 1
fi

echo "Test 2.2: tools/call listIncidents"
NOW_LIST_CALL=$(curl -s -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 6, "params": {"name": "listIncidents", "arguments": {}}}')

NOW_LIST_OK=$(echo "$NOW_LIST_CALL" | jq '.result.isError == false')
if [ "$NOW_LIST_OK" == "true" ]; then
  assert_success "ServiceNow tools/call listIncidents succeeded" 0
else
  echo "Response: $NOW_LIST_CALL"
  assert_success "ServiceNow tools/call listIncidents succeeded" 1
fi

echo "Test 2.3: tools/call getIncident (INC0010001)"
NOW_GET_CALL=$(curl -s -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 7, "params": {"name": "getIncident", "arguments": {"incidentId": "INC0010001"}}}')

NOW_GET_OK=$(echo "$NOW_GET_CALL" | jq '.result.isError == false')
if [ "$NOW_GET_OK" == "true" ]; then
  assert_success "ServiceNow tools/call getIncident returned incident details" 0
else
  echo "Response: $NOW_GET_CALL"
  assert_success "ServiceNow tools/call getIncident returned incident details" 1
fi

echo "Test 2.4: tools/call createIncident"
NOW_CREATE_CALL=$(curl -s -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 8, "params": {"name": "createIncident", "arguments": {"caller_id": "it.admin@example.com", "category": "Cloud Infrastructure", "short_description": "Network latency spike", "priority": "1 - Critical"}}}')

NOW_CREATE_OK=$(echo "$NOW_CREATE_CALL" | jq '.result.isError == false')
if [ "$NOW_CREATE_OK" == "true" ]; then
  assert_success "ServiceNow tools/call createIncident created ticket successfully" 0
else
  echo "Response: $NOW_CREATE_CALL"
  assert_success "ServiceNow tools/call createIncident created ticket successfully" 1
fi

echo "Test 2.5: tools/call updateIncident"
NOW_UPDATE_CALL=$(curl -s -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -H "x-apikey: ${API_KEY}" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "id": 9, "params": {"name": "updateIncident", "arguments": {"incidentId": "INC0010001", "state": "Resolved", "close_notes": "Read replica pool expanded."}}}')

NOW_UPDATE_OK=$(echo "$NOW_UPDATE_CALL" | jq '.result.isError == false')
if [ "$NOW_UPDATE_OK" == "true" ]; then
  assert_success "ServiceNow tools/call updateIncident resolved ticket successfully" 0
else
  echo "Response: $NOW_UPDATE_CALL"
  assert_success "ServiceNow tools/call updateIncident resolved ticket successfully" 1
fi

echo "Test 2.6: Security governance - Missing API Key rejection"
NOW_UNAUTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://${GATEWAY_HOST}/servicenow/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 10, "params": {}}')

if [ "$NOW_UNAUTH_HTTP" -eq 401 ]; then
  assert_success "ServiceNow MCP blocks missing API Key with HTTP 401" 0
else
  assert_success "ServiceNow MCP blocks missing API Key with HTTP 401 (got ${NOW_UNAUTH_HTTP})" 1
fi

echo "Test 2.7: OAuth Protected Resource Metadata endpoint"
NOW_PRM_RES=$(curl -s "https://${GATEWAY_HOST}/.well-known/oauth-protected-resource/servicenow/mcp")
NOW_PRM_HAS_AUTH=$(echo "$NOW_PRM_RES" | grep -c "https://accounts.google.com/" || true)
if [ "$NOW_PRM_HAS_AUTH" -ge 1 ]; then
  assert_success "ServiceNow OAuth PRM returns valid authorization metadata" 0
else
  assert_success "ServiceNow OAuth PRM returns valid authorization metadata" 1
fi

echo ""
echo "=========================================================="
echo "Suite Summary: Passed: ${PASSED} | Failed: ${FAILED}"
echo "=========================================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
