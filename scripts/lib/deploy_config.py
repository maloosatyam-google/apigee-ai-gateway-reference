"""Deployment configuration for the Python scripts (mirror of scripts/lib/config.sh).

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts" / "lib"))
    from deploy_config import CFG

Reads the repo-root .env (see .env.example) without overriding variables that are
already exported, then derives defaults. No environment-specific value is hardcoded
in any script.
"""
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _load_dotenv(path):
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.replace("export ", "", 1).strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
            val = val[1:-1]
        os.environ.setdefault(key, val)


_load_dotenv(ROOT / ".env")


def _env(key, default=""):
    v = os.environ.get(key, "")
    return v if v else default


class _Config:
    def __init__(self):
        self.GCP_PROJECT_ID = _env("GCP_PROJECT_ID", _env("GCP_PROJECT", _env("APIGEE_ORG")))
        self.GCP_PROJECT_NUMBER = _env("GCP_PROJECT_NUMBER")
        self.GCP_REGION = _env("GCP_REGION", "asia-southeast1")
        self.APIGEE_ORG = _env("APIGEE_ORG", self.GCP_PROJECT_ID)
        self.APIGEE_HOST_PROD = _env("APIGEE_HOST_PROD").replace("https://", "").rstrip("/")
        self.APIGEE_HOST_DEV = (_env("APIGEE_HOST_DEV") or self.APIGEE_HOST_PROD).replace("https://", "").rstrip("/")
        self.DEMO_ADMIN_EMAIL = _env("DEMO_ADMIN_EMAIL", _env("SSO_USER_EMAIL"))
        self.PERSONA_APP_DEVELOPER = _env("PERSONA_APP_DEVELOPER", self.DEMO_ADMIN_EMAIL)
        self.UI_MGMT_SA = _env("UI_MGMT_SA", f"apigee-ui-mgmt-sa@{self.GCP_PROJECT_ID}.iam.gserviceaccount.com")
        self.PROXY_SA = _env("PROXY_SA", f"ai-client@{self.GCP_PROJECT_ID}.iam.gserviceaccount.com")
        run = (lambda s: f"https://{s}-{self.GCP_PROJECT_NUMBER}.{self.GCP_REGION}.run.app") if self.GCP_PROJECT_NUMBER else (lambda s: "")
        self.INDUSTRY_APIS_URL = _env("INDUSTRY_APIS_URL", run("industry-apis"))

    @property
    def persona_app_developers(self):
        return [d for i, d in enumerate([self.PERSONA_APP_DEVELOPER, self.DEMO_ADMIN_EMAIL]) if d and d not in [self.PERSONA_APP_DEVELOPER, self.DEMO_ADMIN_EMAIL][:i]]

    def require(self, *names):
        missing = [n for n in names if not getattr(self, n, "")]
        if missing:
            sys.exit(f"Missing configuration: {', '.join(missing)}. Set them in {ROOT / '.env'} (copy .env.example).")
        return self


CFG = _Config()
