#!/usr/bin/env python3
"""Live smoke test for the deployed Agent Showcase service.

    python3 agents/scripts/smoke_live.py "Where is order ORD-1042?"

Resolves the persona keys from Apigee (Support & Sales -> governed, the
caller's Unified Admin app -> baseline), mints the demo identity token the UI
server uses, calls the private service with the caller's ID token, and prints
each streamed event on one line. Standard library only (runs on system Python).
"""

import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts" / "lib"))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

ORG = CFG.APIGEE_ORG
REGION = CFG.GCP_REGION
SERVICE = "agent-showcase-api"
UI_DIR = __file__.rsplit("/agents/", 1)[0] + "/ui"


def sh(*cmd: str) -> str:
  return subprocess.check_output(cmd, text=True).strip()


def apigee(path: str, token: str) -> dict:
  req = urllib.request.Request(f"https://apigee.googleapis.com/v1/organizations/{ORG}/{path}", headers={"Authorization": f"Bearer {token}"})
  with urllib.request.urlopen(req) as res:
    return json.load(res)


def app_key(dev: str, app: str, token: str) -> str:
  try:
    data = apigee(f"developers/{dev}/apps/{urllib.parse.quote(app)}", token)
  except Exception:  # pylint: disable=broad-except
    return ""
  creds = [c for c in data.get("credentials", []) if c.get("status") == "approved"] or data.get("credentials", [])
  return creds[0]["consumerKey"] if creds else ""


def main() -> None:
  prompt = sys.argv[1] if len(sys.argv) > 1 else "Where is order ORD-1042?"
  sides = sys.argv[2].split(",") if len(sys.argv) > 2 else ["baseline", "governed"]
  email = sh("gcloud", "config", "get-value", "account")
  adc = sh("gcloud", "auth", "application-default", "print-access-token")
  governed = next((k for k in (app_key(d, "Unified Sales App", adc) for d in CFG.persona_app_developers) if k), "")
  apps = [a if isinstance(a, str) else (a.get("name") or a.get("appId", "")) for a in apigee(f"developers/{email}/apps", adc).get("app", [])]
  admin_app = next((a for a in apps if a.startswith("Unified Admin")), "")
  baseline = app_key(email, admin_app, adc)
  jwt = sh("node", "-e", f"import('{UI_DIR}/server/adminAgentCore.js').then(m=>console.log(m.mintSyntheticIdentityToken('{email}','Showcase Smoke')))")
  url = sh("gcloud", "run", "services", "describe", SERVICE, "--region", REGION, "--format", "value(status.url)")
  id_token = sh("gcloud", "auth", "print-identity-token")

  req = urllib.request.Request(
      f"{url}/v1/showcase/run",
      data=json.dumps({"prompt": prompt, "sides": sides}).encode(),
      headers={
          "Content-Type": "application/json",
          "Authorization": f"Bearer {id_token}",
          "X-Showcase-Identity-Token": jwt,
          "X-Showcase-User-Email": email,
          "X-Showcase-Governed-Key": governed,
          "X-Showcase-Baseline-Key": baseline,
      },
  )
  print(f"keys: governed={bool(governed)} baseline={bool(baseline)} ({admin_app or 'no admin app'}) as {email}", flush=True)
  try:
    res = urllib.request.urlopen(req, timeout=300)
  except urllib.error.HTTPError as err:
    sys.exit(f"HTTP {err.code}: {err.read().decode()}")
  with res:
    for raw in res:
      line = raw.decode().rstrip("\n")
      if not line.startswith("data: "):
        continue
      e = json.loads(line[6:])
      side = e.get("side", "-")[:8].ljust(8)
      t = str(e.get("t_ms", "")).rjust(6)
      kind = e["type"]
      if kind == "llm_step":
        detail = f"#{e['step']} {e.get('model')} {e['status']} {e['latency_ms']}ms tok={e['tokens']} cache={e.get('cache')} route={e.get('route_category')} calls={e.get('function_calls')} {e.get('error') or ''}"
      elif kind == "tool_call":
        detail = f"{e['name']}({json.dumps(e['args'])}) @ {e['server']}"
      elif kind == "tool_result":
        detail = f"{e['name']} http={e['http_status']} err={e['is_error']} {e['latency_ms']}ms {json.dumps(e['result'])[:160]}"
      elif kind == "gateway_hop":
        detail = f"{e['method']} {e['server']} {e['status']} {e['latency_ms']}ms tools={e.get('tools', '')}"
      elif kind == "tools_offered":
        detail = f"{e['count']} tools"
      elif kind == "governance_event":
        detail = f"{e['kind']}: {e['detail']}"
      elif kind == "final":
        detail = f"error={e.get('error')}\n{e.get('text')}"
      elif kind == "metrics":
        detail = json.dumps({k: e[k] for k in ("e2e_ms", "llm_steps", "tool_calls", "tokens", "by_model", "tools_offered_count", "tools_called", "cache_hits", "governance_events")})
      else:
        detail = json.dumps({k: v for k, v in e.items() if k not in ("type", "side", "seq", "t_ms")})
      print(f"{side} {t} {kind:16} {detail}", flush=True)


if __name__ == "__main__":
  main()
