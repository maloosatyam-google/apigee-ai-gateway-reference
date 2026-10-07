#!/usr/bin/env bash
# Pre-publish gate: fails if the tree (or a snapshot dir) contains credentials or
# environment-specific values that must never reach the public repo.
#
#   scripts/check_public.sh            # scan the files git tracks (+ untracked, unignored)
#   scripts/check_public.sh <dir>      # scan an exported snapshot directory
#
# Extra literals to block (your own project id, domains, emails) go in the
# gitignored file .public-denylist, one per line, e.g. "my-project-123".
# The secret patterns live in scripts/lib/secret_patterns.sh (shared with .githooks/).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/secret_patterns.sh
source "${ROOT}/scripts/lib/secret_patterns.sh"
TARGET="${1:-}"

if [ -n "$TARGET" ]; then
  FILES="$(cd "$TARGET" && find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's|^\./||')"
  BASE="$TARGET"
else
  FILES="$(cd "$ROOT" && { git ls-files; git ls-files --others --exclude-standard; } | sort -u)"
  BASE="$ROOT"
fi
load_denylist "$ROOT"

fail=0
cd "$BASE" || exit 2
LIST="$(mktemp)"; printf '%s\n' "$FILES" | grep -v -E "$SCAN_EXCLUDE" > "$LIST"
for pat in "${SECRET_PATTERNS[@]}"; do
  hits="$(tr '\n' '\0' < "$LIST" | xargs -0 grep -IEn -- "$pat" 2>/dev/null | head -5)"
  if [ -n "$hits" ]; then echo "✖ secret pattern /$pat/:"; echo "$hits" | cut -c1-160; fail=1; fi
done
for lit in ${DENYLIST[@]+"${DENYLIST[@]}"}; do
  hits="$(tr '\n' '\0' < "$LIST" | xargs -0 grep -IFn -- "$lit" 2>/dev/null | head -5)"
  if [ -n "$hits" ]; then echo "✖ denylisted literal '$lit':"; echo "$hits" | cut -c1-160; fail=1; fi
done
# Files that must never be published, whatever their content (only *.env.example is allowed).
bad=""
while IFS= read -r f; do [ -n "$f" ] && is_forbidden_path "$f" && bad+="$f"$'\n'; done <<< "$FILES"
if [ -n "$bad" ]; then echo "✖ forbidden files would be published:"; printf '%s' "$bad"; fail=1; fi
rm -f "$LIST"

if [ "$fail" -eq 0 ]; then echo "✔ public check passed ($(printf '%s\n' "$FILES" | wc -l | tr -d ' ') files)"; fi
exit "$fail"
