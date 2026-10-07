#!/usr/bin/env bash
# Export the current commit as a fresh, history-free repository for public release.
#
#   scripts/export_public_snapshot.sh <out-dir> [remote-url]
#
# - Uses `git archive HEAD`, so only committed files are exported (no .env, no untracked).
# - Runs scripts/check_public.sh on the export and refuses to continue if it fails.
# - Creates ONE commit with a neutral author, so no private history, commit messages,
#   author emails or past (rotated) secrets are published.
# - Pushes only if a remote URL is given. Nothing is pushed by default.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:?usage: $0 <out-dir> [remote-url]}"
REMOTE="${2:-}"
AUTHOR_NAME="${PUBLIC_AUTHOR_NAME:-Apigee AI Gateway Demo}"
AUTHOR_EMAIL="${PUBLIC_AUTHOR_EMAIL:-noreply@example.com}"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Uncommitted changes: commit first (the snapshot is taken from HEAD)." >&2
  exit 1
fi
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "$OUT exists and is not empty." >&2
  exit 1
fi
mkdir -p "$OUT"
SRC_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
git -C "$ROOT" archive HEAD | tar -x -C "$OUT"

echo "==> Scanning the export"
bash "${ROOT}/scripts/check_public.sh" "$OUT"

cd "$OUT"
git init -q -b main
git add -A
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git commit -q -m "Apigee AI & Tools Gateway demo" -m "Snapshot of the private repository at ${SRC_SHA}."
echo "==> Created $(git rev-parse --short HEAD) in $OUT ($(git ls-files | wc -l | tr -d ' ') files)"

if [ -n "$REMOTE" ]; then
  git remote add origin "$REMOTE"
  git push -u origin main
fi
