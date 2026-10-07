#!/usr/bin/env bash
# Deploys the customer-service-v1 and business-insights-v1 REST proxies and their KVM.
# Usage: bash apigee/scripts/deploy_business_proxies.sh <env> [enforce-internal:true|false]
set -euo pipefail
ENV="${1:?env (dev|prod)}"
ENFORCE="${2:-true}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT}/scripts/lib/config.sh"
require_config APIGEE_ORG
ORG="${APIGEE_ORG}"
SA="${PROXY_SA}"
T="$(gcloud auth application-default print-access-token)"
API="https://apigee.googleapis.com/v1/organizations/${ORG}"
H=(-H "Authorization: Bearer ${T}")

# KVM (environment scoped). Create the map if missing, then upsert entries.
curl -s "${H[@]}" -H 'content-type: application/json' -X POST "${API}/environments/${ENV}/keyvaluemaps" \
  -d '{"name":"customer-tools-config","encrypted":true}' >/dev/null || true
upsert() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H 'content-type: application/json' -X PUT \
    "${API}/environments/${ENV}/keyvaluemaps/customer-tools-config/entries/$1" -d "{\"name\":\"$1\",\"value\":\"$2\"}")
  if [ "$code" = "404" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H 'content-type: application/json' -X POST \
      "${API}/environments/${ENV}/keyvaluemaps/customer-tools-config/entries" -d "{\"name\":\"$1\",\"value\":\"$2\"}")
  fi
  echo "  kvm $1=$2 ($code)"
}
NAT_IPS=$(curl -s "${H[@]}" "${API}/instances" | python3 -c "import json,sys;print(','.join(i['name'] for i in json.load(sys.stdin).get('instances',[])))" \
  | tr ',' '\n' | while read -r i; do curl -s "${H[@]}" "${API}/instances/${i}/natAddresses" \
  | python3 -c "import json,sys;print(','.join(a['ipAddress'] for a in json.load(sys.stdin).get('natAddresses',[]) if a.get('state')=='ACTIVE'))"; done | paste -sd, -)
upsert refund.maxAmount 50
# Refund limit applies only to caller keys holding one of these products (comma-separated).
upsert refund.limitedProducts "Customer Service Tools MCP"
upsert internal.allowedIps "${NAT_IPS}"
upsert internal.enforce "${ENFORCE}"

for P in customer-service-v1 business-insights-v1; do
  TMP="$(mktemp -d)"
  (cd "${ROOT}/apigee/proxies/${P}" && zip -qr "${TMP}/${P}.zip" apiproxy)
  REV=$(curl -s "${H[@]}" -X POST -F "file=@${TMP}/${P}.zip" "${API}/apis?name=${P}&action=import" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('revision') or sys.exit(json.dumps(d)))")
  curl -s "${H[@]}" -X POST "${API}/environments/${ENV}/apis/${P}/revisions/${REV}/deployments?override=true&serviceAccount=${SA}" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('  deploy', '${P}', 'rev', '${REV}', d.get('state') or d)"
  rm -rf "${TMP}"
done
