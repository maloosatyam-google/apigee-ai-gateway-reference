#!/usr/bin/env bash
# Standalone: package and (optionally) deploy an Apigee X proxy bundle with the Apigee API.
# Requires: zip, curl, gcloud (authenticated). No repo dependencies.
#
#   deploy_bundle.sh <proxy-dir> [--org ORG] [--env ENV] [--sa SERVICE_ACCOUNT_EMAIL] [--package-only]
#
# <proxy-dir> contains apiproxy/. The proxy name is the root manifest's name attribute.
# --sa is required when targets use GoogleAccessToken / GoogleIDToken authentication.
set -euo pipefail

DIR="${1:?usage: $0 <proxy-dir> [--org ORG] [--env ENV] [--sa SA] [--package-only]}"; shift
ORG="${APIGEE_ORG:-}"; ENV="${APIGEE_ENV:-}"; SA="${APIGEE_DEPLOY_SA:-}"; PACKAGE_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift ;;
    --env) ENV="$2"; shift ;;
    --sa) SA="$2"; shift ;;
    --package-only) PACKAGE_ONLY=true ;;
    *) echo "unknown arg $1"; exit 1 ;;
  esac; shift
done

[[ -d "$DIR/apiproxy" ]] || { echo "no apiproxy/ under $DIR"; exit 1; }
MANIFEST=$(ls "$DIR"/apiproxy/*.xml | head -1)
NAME=$(sed -n 's/.*<APIProxy[^>]*name="\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)
[[ -n "$NAME" ]] || NAME=$(basename "$MANIFEST" .xml)

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SKILL_DIR/validate_bundle.py" "$DIR"

ZIP="$(mktemp -d)/${NAME}.zip"
(cd "$DIR" && zip -qr "$ZIP" apiproxy -x "*.DS_Store*")
echo "Packaged $ZIP"
$PACKAGE_ONLY && exit 0

[[ -n "$ORG" && -n "$ENV" ]] || { echo "--org and --env (or APIGEE_ORG/APIGEE_ENV) required"; exit 1; }
TOKEN=$(gcloud auth print-access-token)
API="https://apigee.googleapis.com/v1/organizations/${ORG}"

REV=$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" -F "file=@${ZIP}" \
  "${API}/apis?name=${NAME}&action=import" | python3 -c 'import sys,json;print(json.load(sys.stdin)["revision"])')
echo "Imported ${NAME} revision ${REV}"

Q="override=true"; [[ -n "$SA" ]] && Q="${Q}&serviceAccount=${SA}"
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  "${API}/environments/${ENV}/apis/${NAME}/revisions/${REV}/deployments?${Q}" >/dev/null
echo "Deploying revision ${REV} to ${ENV}..."

for i in $(seq 1 60); do
  STATE=$(curl -sf -H "Authorization: Bearer $TOKEN" \
    "${API}/environments/${ENV}/apis/${NAME}/revisions/${REV}/deployments" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("state",""))')
  [[ "$STATE" == "READY" ]] && { echo "READY: ${NAME} r${REV} in ${ENV}"; exit 0; }
  [[ "$STATE" == "ERROR" ]] && { echo "Deployment ERROR (check the Apigee UI for details)"; exit 1; }
  sleep 5
done
echo "Timed out waiting for READY (last state: ${STATE})"; exit 1
