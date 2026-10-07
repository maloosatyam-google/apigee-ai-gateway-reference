#!/usr/bin/env bash
# Enable the repository's git hooks (.githooks/pre-commit and pre-push) for this clone.
# Safe to re-run. Undo with: git config --unset core.hooksPath
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "✔ git hooks enabled (core.hooksPath=.githooks)"
command -v gitleaks >/dev/null 2>&1 || echo "  Tip: install gitleaks (brew install gitleaks) for deeper secret scanning."
command -v shellcheck >/dev/null 2>&1 || echo "  Tip: install shellcheck (brew install shellcheck) to lint shell scripts."
if [ ! -f .public-denylist ]; then
  echo "  Tip: list your own project id / domain / emails in .public-denylist (gitignored), one per line,"
  echo "       so the hooks block them from being committed."
fi
