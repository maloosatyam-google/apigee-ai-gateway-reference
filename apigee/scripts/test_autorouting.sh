#!/usr/bin/env bash
# Test Runner for Apigee Intelligent Auto-Routing Policy
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

MODE="${1:---unit}"

echo "========================================================="
echo "   Apigee AI Gateway - Auto-Routing Test Suite"
echo "========================================================="

# 1. Fast Offline Unit Tests
echo -e "\n[*] Running Offline Unit Tests (Node.js test runner)..."
node --test "${ROOT_DIR}/ui/tests/autorouting.unit.test.mjs"
echo -e "✅ Offline Unit Tests Passed!\n"

# 2. Optional Live Gateway Tests - PROD ONLY, explicit opt-in.
#    Dev is a shared sandbox users modify directly, so it is never a live-test target.
#    The live suite consumes prod token quota/budget and seeds the prod semantic cache,
#    which is why it no longer runs by default.
if [ "$MODE" == "--live" ] || [ "$MODE" == "--all" ]; then
  if [ -f "${ROOT_DIR}/ui/.env" ]; then
    echo -e "[*] Running Live Gateway Integration Tests against Apigee PROD..."
    (cd "${ROOT_DIR}/ui" && npm run --silent test:live)
    echo -e "✅ Live Gateway Integration Tests Passed!\n"
  else
    echo -e "[!] ui/.env not found - cannot run live tests." >&2
    exit 1
  fi
fi

echo "========================================================="
echo "   All Auto-Routing Tests Successfully Completed!"
echo "========================================================="
