#!/usr/bin/env bash
# Export the current commit as a history-free repository for public release.
#
#   scripts/export_public_snapshot.sh <out-dir> [remote-url]   # first release
#   scripts/export_public_snapshot.sh <public-clone-dir>       # later releases
#
# - Uses `git archive HEAD`, so only committed files are exported (no .env, no untracked).
# - Runs scripts/check_public.sh on the export and refuses to continue if it fails.
# - Commits with a neutral author, so no private history, commit messages, author
#   emails or past (rotated) secrets are published.
# - First release: <out-dir> must be empty; a fresh repo with ONE commit is created and
#   pushed if a remote URL is given.
# - Later releases: if <out-dir> is already a git clone of the public repo, its tree is
#   replaced with HEAD and a new commit is added on top, then pushed (never force-pushed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:?usage: $0 <out-dir> [remote-url]}"
REMOTE="${2:-}"
AUTHOR_NAME="${PUBLIC_AUTHOR_NAME:-Apigee AI Gateway Reference}"
AUTHOR_EMAIL="${PUBLIC_AUTHOR_EMAIL:-noreply@example.com}"
MESSAGE="${PUBLIC_COMMIT_MESSAGE:-}"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Uncommitted changes: commit first (the snapshot is taken from HEAD)." >&2
  exit 1
fi
SRC_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
commit() {
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
    git commit -q -m "$1" -m "Snapshot of the private repository at ${SRC_SHA}."
}

if [ -d "$OUT/.git" ]; then
  # ---- Update an existing public clone --------------------------------------------
  cd "$OUT"
  [ -z "$(git status --porcelain)" ] || { echo "$OUT has uncommitted changes." >&2; exit 1; }
  git pull -q --ff-only 2>/dev/null || true
  git ls-files -z | xargs -0 rm -f
  git -C "$ROOT" archive HEAD | tar -x -C "$OUT"
  echo "==> Scanning the export"
  bash "${ROOT}/scripts/check_public.sh" "$OUT"
  git add -A
  if git diff --cached --quiet; then echo "==> No changes to publish."; exit 0; fi
  git diff --cached --stat | tail -1
  commit "${MESSAGE:-Update from private repository}"
  echo "==> Created $(git rev-parse --short HEAD) in $OUT"
  git push -q origin HEAD
  echo "==> Pushed to $(git remote get-url origin)"
  exit 0
fi

# ---- First release --------------------------------------------------------------------
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "$OUT exists, is not empty and is not a git clone." >&2
  exit 1
fi
mkdir -p "$OUT"
git -C "$ROOT" archive HEAD | tar -x -C "$OUT"

echo "==> Scanning the export"
bash "${ROOT}/scripts/check_public.sh" "$OUT"

cd "$OUT"
git init -q -b main
git add -A
commit "${MESSAGE:-Apigee AI Gateway reference implementation}"
echo "==> Created $(git rev-parse --short HEAD) in $OUT ($(git ls-files | wc -l | tr -d ' ') files)"

if [ -n "$REMOTE" ]; then
  git remote add origin "$REMOTE"
  git push -u origin main
fi
