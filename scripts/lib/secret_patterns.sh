#!/usr/bin/env bash
# Shared secret-detection rules, sourced by scripts/check_public.sh and .githooks/*.
# Keep this file free of real secrets: the patterns below only describe their shape.

# Regexes (grep -E) for credentials that must never be committed.
SECRET_PATTERNS=(
  'AIza[0-9A-Za-z_-]{35}'                              # Google API key
  'GOCSPX-[0-9A-Za-z_-]{20,}'                          # Google OAuth client secret
  'ya29\.[0-9A-Za-z_-]{20,}'                           # Google OAuth access token
  '1//0[0-9A-Za-z_-]{30,}'                             # Google OAuth refresh token
  '"type": *"service_account"'                         # Service-account key JSON
  '"private_key_id": *"[0-9a-f]{20,}"'                 # Service-account key JSON
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                 # PEM / OpenSSH private key
  'AKIA[0-9A-Z]{16}'                                   # AWS access key id
  'ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}'  # GitHub token
  'sk-ant-[0-9A-Za-z_-]{30,}'                          # Anthropic key
  'sk-(proj-)?[A-Za-z0-9]{30,}'                        # OpenAI-style key
  'sk_live_[0-9A-Za-z]{20,}'                           # Stripe live key
  'xox[baprs]-[0-9A-Za-z-]{10,}'                       # Slack token
  'npm_[0-9A-Za-z]{36}'                                # npm token
  'apikey_[0-9a-f]{20,}'                               # TypeSafe-style key
)

# Paths whose content is not scanned (lockfiles hold integrity hashes; this file and
# check_public.sh hold the patterns themselves).
SCAN_EXCLUDE='(^|/)(package-lock\.json|\.public-denylist|secret_patterns\.sh|check_public\.sh)$'

# is_forbidden_path <path>: true if the path must never be committed.
is_forbidden_path() {
  local p="$1"
  case "$p" in *.env.example|.env.example) return 1 ;; esac
  printf '%s\n' "$p" | grep -qE '(^|/)\.env(\..*)?$|(^|/)\.public-denylist$|\.(pem|key|p12|pfx|jks|keystore|tfstate)$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|(service[-_]?account|sa[-_]key|credentials?)[^/]*\.json$'
}

# load_denylist <repo-root>: fills DENYLIST with the literals in the gitignored
# .public-denylist (your project id, domains, emails), one per line, # comments allowed.
load_denylist() {
  DENYLIST=()
  local f="$1/.public-denylist" l
  [ -f "$f" ] || return 0
  while IFS= read -r l || [ -n "$l" ]; do
    [ -n "$l" ] && [ "${l:0:1}" != "#" ] && DENYLIST+=("$l")
  done < "$f"
}

# lockfile_private_registry <file>: prints the first "resolved" URL that is not on the public
# npm registry (internal mirrors leak hostnames and break `npm ci` for everyone else).
# Fix with: npm install --package-lock-only --registry=https://registry.npmjs.org
lockfile_private_registry() {
  grep -oE '"resolved": *"[^"]+"' "$1" 2>/dev/null | grep -vE '"https://registry\.npmjs\.org/' | head -1
}
