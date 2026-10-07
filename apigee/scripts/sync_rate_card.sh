#!/usr/bin/env bash
#
# Sync apigee/config/model_rate_card.json into the 'ai-model-rates' KVM ('rate_card' key).
#
# The KVM used to be hand-edited, and drifted badly: it carried three Claude IDs that do not
# exist in this project, and was MISSING claude-haiku-4-5 and gemini-2.5-flash, both of which
# are entitled. Missing models fall through to the 'default' rate, so they were silently
# under-billed. This script makes the repo the source of truth so that cannot recur.
#
# Usage:
#   apigee/scripts/sync_rate_card.sh --org <your-org> --env prod [--dry-run]

set -euo pipefail

ORG=""
ENVIRONMENT=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    --env) ENVIRONMENT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ORG" || -z "$ENVIRONMENT" ]]; then
  echo "Usage: $0 --org <org> --env <env> [--dry-run]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARD="$SCRIPT_DIR/../config/model_rate_card.json"

if [[ ! -f "$CARD" ]]; then
  echo "Rate card not found: $CARD" >&2
  exit 1
fi

# Strip the _comment block and minify. The KVM value is a JSON *string*, so keeping the
# documentation in it would waste the value size limit and confuse every consumer.
PAYLOAD="$(python3 - "$CARD" <<'PY'
import json, sys
card = json.load(open(sys.argv[1]))
card.pop("_comment", None)

# Fail loudly rather than pushing a card that would silently mis-bill.
for name, entry in card.items():
    for field in ("input", "output", "provider", "tier"):
        if field not in entry:
            raise SystemExit("ERROR: '%s' is missing required field '%s'" % (name, field))
    if entry["tier"] not in ("low", "medium", "high"):
        raise SystemExit("ERROR: '%s' has invalid tier '%s'" % (name, entry["tier"]))
if "default" not in card:
    raise SystemExit("ERROR: rate card has no 'default' entry")

print(json.dumps(card, separators=(",", ":")))
PY
)"

echo "Rate card: $(python3 -c "import json,sys;print(len(json.loads(sys.argv[1])))" "$PAYLOAD") entries"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "$PAYLOAD"
  echo "(dry run — nothing written)"
  exit 0
fi

TOKEN="$(gcloud auth print-access-token)"
BASE="https://apigee.googleapis.com/v1/organizations/$ORG/environments/$ENVIRONMENT/keyvaluemaps/ai-model-rates/entries"

BODY="$(python3 -c 'import json,sys;print(json.dumps({"name":"rate_card","value":sys.argv[1]}))' "$PAYLOAD")"

# Entries are created with POST and replaced with PUT; try the update path first.
CODE="$(curl -s -o /tmp/rate_card_resp.json -w '%{http_code}' -X PUT \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "$BASE/rate_card")"

if [[ "$CODE" == "404" ]]; then
  echo "Entry absent, creating it."
  CODE="$(curl -s -o /tmp/rate_card_resp.json -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$BODY" "$BASE")"
fi

if [[ "$CODE" != "200" && "$CODE" != "201" ]]; then
  echo "FAILED (HTTP $CODE):" >&2
  cat /tmp/rate_card_resp.json >&2
  exit 1
fi

echo "Rate card synced to $ORG/$ENVIRONMENT (HTTP $CODE)."
