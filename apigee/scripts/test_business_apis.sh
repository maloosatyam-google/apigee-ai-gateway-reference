#!/usr/bin/env bash
# End-to-end REST checks for customer-service-v1 and business-insights-v1 through Apigee.
# Needs internal.enforce=false in the env's KVM (the APIs are otherwise private to the MCP proxy).
# Usage: bash apigee/scripts/test_business_apis.sh [host]
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/config.sh"
H="${1:-https://${APIGEE_HOST_DEV}}"
PASS=0; FAIL=0
check() { # name expected_status method path [body] [jq-ish grep]
  local name="$1" want="$2" method="$3" path="$4" body="${5:-}" expect="${6:-}"
  local out code
  if [ -n "$body" ]; then
    out=$(curl -s -X "$method" -H 'content-type: application/json' --data "$body" -w '\n%{http_code}' "$H$path")
  else
    out=$(curl -s -X "$method" -w '\n%{http_code}' "$H$path")
  fi
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [ "$code" = "$want" ] && { [ -z "$expect" ] || grep -q -- "$expect" <<<"$out"; }; then
    PASS=$((PASS+1)); printf '  ok   %-44s %s\n' "$name" "$code"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %-44s got %s want %s %s\n       %s\n' "$name" "$code" "$want" "${expect:+(expect $expect)}" "${out:0:240}"
  fi
}
CS=/customer-service/v1; BI=/business-insights/v1
echo "Customer Service API ($H$CS)"
check 'searchCustomers q=jane'              200 GET  "$CS/customers?q=jane" '' '"CUST-1001"'
check 'searchCustomers masks email'         200 GET  "$CS/customers?q=jane" '' 'j\*\*\*@example.com'
check 'searchCustomers q too short (OAS)'   400 GET  "$CS/customers?q=j"
check 'getCustomer CUST-1001'               200 GET  "$CS/customers/CUST-1001" '' '"allowedDiscountPct":10'
check 'getCustomer bad id (OAS pattern)'    400 GET  "$CS/customers/1001"
check 'getCustomer unknown'                 404 GET  "$CS/customers/CUST-9999"
check 'listCustomerOrders CUST-1001'        200 GET  "$CS/customers/CUST-1001/orders" '' '"ORD-1042"'
check 'getOrderStatus ORD-1042 (late)'      200 GET  "$CS/orders/ORD-1042" '' '"status":"Delayed"'
check 'getProductPrice DEV-HUB Gold'        200 GET  "$CS/products/DEV-HUB/price?tier=Gold" '' '"lowestPrice":116.1'
check 'getProductPrice no cost field'       200 GET  "$CS/products/DEV-HUB/price?tier=Gold" '' '"maxDiscountPct"'
check 'getProductPrice bad tier (OAS)'      400 GET  "$CS/products/DEV-HUB/price?tier=Diamond"
check 'getProductPrice unknown sku (OAS)'   400 GET  "$CS/products/NOPE/price"
check 'createSupportCase'                   201 POST "$CS/cases" '{"customerId":"CUST-1001","orderId":"ORD-1042","subject":"Late delivery","priority":"High"}' '"status":"Open"'
check 'createSupportCase missing subject'   400 POST "$CS/cases" '{"customerId":"CUST-1001"}'
check 'issueRefund $20 (under limit)'       201 POST "$CS/orders/ORD-1042/refunds" '{"amount":20,"reason":"Late delivery goodwill"}' '"status":"Approved"'
check 'issueRefund $50 (at limit)'          201 POST "$CS/orders/ORD-1042/refunds" '{"amount":50,"reason":"Late delivery goodwill"}' '"status":"Approved"'
check 'issueRefund $120 (over limit)'       403 POST "$CS/orders/ORD-1042/refunds" '{"amount":120,"reason":"Late delivery"}' 'REFUND_LIMIT'
check 'issueRefund no reason (OAS)'         400 POST "$CS/orders/ORD-1042/refunds" '{"amount":10}'
check 'unknown operation'                   404 GET  "$CS/admin/reset"
echo "Business Insights API ($H$BI)"
check 'getRevenueTrends 90d APAC'           200 GET  "$BI/insights/revenue?period=last_90d&region=APAC" '' '"totalRevenue"'
check 'getRevenueTrends bad period (OAS)'   400 GET  "$BI/insights/revenue?period=last_7d"
check 'getSupportMetrics 30d'               200 GET  "$BI/insights/support?period=last_30d" '' '"Late delivery"'
check 'getChurnRisk'                        200 GET  "$BI/insights/churn" '' '"revenueAtRisk"'
check 'getChurnRisk has no emails'          200 GET  "$BI/insights/churn" '' '"cohorts"'
check 'getProductMargins DEV-HUB'           200 GET  "$BI/insights/products/DEV-HUB/margin" '' '"unitCost":71'
check 'runForecast revenue 4w'              200 POST "$BI/insights/forecast" '{"metric":"revenue","horizonWeeks":4}' '"forecast"'
check 'runForecast horizon 40 (OAS)'        400 POST "$BI/insights/forecast" '{"metric":"revenue","horizonWeeks":40}'
check 'runForecast bad metric (OAS)'        400 POST "$BI/insights/forecast" '{"metric":"profit"}'
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
