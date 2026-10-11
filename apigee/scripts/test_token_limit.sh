#!/bin/bash
# ==============================================================================
# Apigee AI Gateway - LLM Token Limit (300 tokens/min) Integration Tests
# Validates the 4-step demo: pass -> near-threshold alert -> exhausted alert -> HTTP 429
# ==============================================================================

SET_X=false
if [ "$1" == "-v" ]; then
  SET_X=true
  set -x
fi

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/config.sh"
BASE_URL="${BASE_URL:-https://${APIGEE_HOST_PROD}/ai/v1}"
# A fresh identity per run: LTQ is keyed on the JWT email, so this starts from an empty window
# regardless of other traffic. Override USER_EMAIL to test a specific user.
USER_EMAIL="${USER_EMAIL:-quota-script-$(date +%s)@example.com}"
# The proxy resolves identity from a JWT email claim only; the X-User-Email
# fallback was removed. DecodeJWT never verifies the signature, but it does
# reject `alg: none` with an empty signature -- so use RS256 with a placeholder,
# matching apigee/scripts/generate_demo_traffic.py.
b64url() { printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '=\n'; }
USER_JWT="$(b64url '{"alg":"RS256","typ":"JWT"}').$(b64url "{\"email\":\"${USER_EMAIL}\",\"sub\":\"${USER_EMAIL}\"}").$(b64url 'dummysignature12345678901234567890')"

# Never hardcode a consumer key here - this file is version controlled.
# Export one before running, e.g.
#   export API_KEY=$(gcloud ... apps/<app> | jq -r '.credentials[0].consumerKey')
API_KEY="${API_KEY:-}"
if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY is not set." >&2
  echo "       export API_KEY=<consumer key> before running this script." >&2
  exit 1
fi

echo "=============================================================================="
echo "⚡ AI GATEWAY: LLM TOKEN RATE LIMIT TEST SUITE (claude-haiku-5-5, 300 tokens/min)"
echo "Target Endpoint: ${BASE_URL}"
echo "User Email: ${USER_EMAIL}"
echo "=============================================================================="

# Mirrors TOKEN_LIMIT_EXAMPLES in ui/src/services/defaultSettings.ts. Each call is stateless
# with a 90-token output cap (~120 tokens), so against a 300-token window:
#   1: ~40%  -> 200, x-gateway-token-quota-status: ok
#   2: ~80%  -> 200, near-threshold (alert above 50%)
#   3: >100% -> 200, exhausted (admitted: the counter was still under the limit)
#   4:       -> 429 from LTQ-TokenEnforce
PROMPTS=(
  "Explain how an API gateway enforces LLM token quotas per user, in detail."
  "Describe how rolling-window token counters differ from request-per-minute rate limits, in detail."
  "Explain why LLM token quotas should be keyed on the signed-in user rather than the API key, in detail."
  "Summarize API gateway token bucket algorithms and rate limiting principles, in detail."
)
EXPECT_HTTP=(200 200 200 429)
EXPECT_QUOTA=(ok near-threshold exhausted "")
FAILED=0

hdr() { echo "$1" | tr -d '\r' | awk -v IGNORECASE=1 -v h="$2:" 'tolower($1)==tolower(h) {sub(/^[^:]*: */,""); print; exit}'; }

for i in 0 1 2 3; do
  echo ""
  echo "------------------------------------------------------------------------------"
  echo "STEP $((i + 1))/4: expect HTTP ${EXPECT_HTTP[$i]}${EXPECT_QUOTA[$i]:+, quota status ${EXPECT_QUOTA[$i]}}"
  echo "------------------------------------------------------------------------------"
  RESPONSE=$(curl -s -i -X POST "${BASE_URL}/models/claude-haiku-5-5:generateContent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${USER_JWT}" \
    -H "x-apikey: ${API_KEY}" \
    -d "{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"${PROMPTS[$i]}\"}]}],\"generationConfig\":{\"maxOutputTokens\":90}}")

  # Assert on the status line, never on body text: these prompts are ABOUT rate limiting.
  STATUS=$(echo "$RESPONSE" | head -n 1 | awk '{print $2}')
  QUOTA=$(hdr "$RESPONSE" x-gateway-token-quota-status)
  echo "HTTP ${STATUS} | tokens=$(hdr "$RESPONSE" x-gateway-total-tokens) used=$(hdr "$RESPONSE" x-gateway-token-quota-used)/$(hdr "$RESPONSE" x-gateway-token-quota-limit) ($(hdr "$RESPONSE" x-gateway-token-quota-used-pct)%) status=${QUOTA:-n/a}"
  WARN=$(hdr "$RESPONSE" x-gateway-token-quota-warning)
  [ -n "$WARN" ] && echo "Warning header: ${WARN}"

  if [ "$STATUS" == "${EXPECT_HTTP[$i]}" ] && [ "$QUOTA" == "${EXPECT_QUOTA[$i]}" ]; then
    echo "✅ STEP $((i + 1)) PASSED"
  else
    echo "❌ STEP $((i + 1)) FAILED: expected HTTP ${EXPECT_HTTP[$i]} / status '${EXPECT_QUOTA[$i]}', got HTTP ${STATUS} / '${QUOTA}'"
    echo "$RESPONSE" | head -n 25
    FAILED=1
  fi
done

echo ""
echo "=============================================================================="
echo "🎯 LLM TOKEN RATE LIMIT TEST SUITE COMPLETED"
echo "=============================================================================="
exit $FAILED
