# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately via
GitHub's **Report a vulnerability** (Security tab) on this repository.

## Secrets in this repository

There are none, by design:

- All environment-specific values live in a gitignored `.env` (template: `.env.example`).
- Third-party credentials (e.g. `TYPESAFE_API_KEY`) are written to the **encrypted** Apigee
  KVM `ai-gateway-creds` by `scripts/bootstrap.sh kvms` and read at runtime by
  `KVM-GetRouterCredentials` into a `private.*` variable. They never appear in proxy bundles.
- Apigee consumer keys are never committed. The UI resolves them at runtime from the
  Management API with the `apigee-ui-mgmt-sa` service account.
- No service-account key files are used. Local tools impersonate service accounts with
  `gcloud auth print-access-token --impersonate-service-account=...`.

Before publishing, `scripts/check_public.sh` scans for secret patterns and for the
identifiers listed in your private, gitignored `.public-denylist`. The same rules run on
every commit and push through the git hooks in `.githooks/` (enable with
`scripts/install_hooks.sh`), and in CI together with gitleaks.
