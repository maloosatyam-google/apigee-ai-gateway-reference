#!/usr/bin/env python3
"""
Generate realistic AI Gateway demo traffic and monetization consumption across all active Apigee developers.

Usage:
  python3 apigee/scripts/generate_demo_traffic.py [--requests-per-user 3] [--gateway-url https://<APIGEE_HOST_PROD>/ai/v1]

Note:
  - Dynamically discovers developers and their approved API keys from Apigee Management API via gcloud.
  - Auto-provisions Unified Admin App for any developer who does not yet have an approved app.
  - Never hardcodes credentials or consumer keys.
  - Sends live requests through the AI Gateway to populate Apigee Analytics (tokens, models, latency, cost).
  - Applies immediate micro-dollar wallet adjustments in Apigee so Monetization balances reflect consumption immediately for live demos.
"""

import argparse
import json
import pathlib
import random
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)
from concurrent.futures import ThreadPoolExecutor, as_completed

DEFAULT_ORG = CFG.APIGEE_ORG
DEFAULT_GATEWAY_URL = f"https://{CFG.APIGEE_HOST_PROD}/ai/v1"

PROMPTS_AND_ROUTES = [
    {
        "path": "/auto",
        "prompt": "Summarize the top 3 enterprise benefits of an AI Gateway in 2 concise sentences.",
        "label": "Auto-Router (Simple)",
    },
    {
        # Was gemini-2.5-flash, retired ahead of its 2026-10-20 end of life and now
        # entitled by no API Product -- this route would 401 at VA-VerifyAPIKey.
        "path": "/models/gemini-3.5-flash-lite:generateContent",
        "prompt": "Explain semantic caching for LLM APIs and how it reduces token costs in 3 bullet points.",
        "label": "Gemini 3.5 Flash Lite",
    },
    {
        "path": "/models/gemini-3.1-pro-preview:generateContent",
        "prompt": "Design a multi-region failover architecture for enterprise AI microservices with strict token governance.",
        "label": "Gemini 3.1 Pro Preview",
    },
    {
        "path": "/auto",
        "prompt": "Compare token rate limiting versus request-per-minute quotas for multi-tenant SaaS applications.",
        "label": "Auto-Router (Reasoning)",
    },
]


def get_gcloud_token() -> str:
    try:
        return (
            subprocess.check_output(["gcloud", "auth", "print-access-token"], stderr=subprocess.DEVNULL)
            .decode()
            .strip()
        )
    except Exception as exc:
        print(f"[Error] Could not obtain GCP access token via gcloud: {exc}", file=sys.stderr)
        sys.exit(1)


import base64


def create_developer_jwt(email: str) -> str:
    """Create a 3-part base64url JWT for the developer email so Apigee DJWT policy attributes dc_user_email accurately."""
    def b64url(obj) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    header = b64url({"alg": "RS256", "typ": "JWT"})
    payload = b64url({"sub": email, "email": email, "name": email.split("@")[0]})
    sig = base64.urlsafe_b64encode(b"dummysignature12345678901234567890").decode().rstrip("=")
    return f"{header}.{payload}.{sig}"


def get_developers_and_keys(org: str, token: str):
    """Fetch all developers and their approved Admin/Enterprise consumer keys from Apigee, auto-creating apps if needed."""
    url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        devs = json.loads(resp.read().decode()).get("developer", [])

    dev_profiles = []
    for dev in devs:
        email = dev.get("email")
        if not email:
            continue
        username = email.split("@")[0]
        apps_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{urllib.parse.quote(email)}/apps?expand=true"
        try:
            with urllib.request.urlopen(
                urllib.request.Request(apps_url, headers={"Authorization": f"Bearer {token}"})
            ) as a_resp:
                apps = json.loads(a_resp.read().decode()).get("app", [])
            api_key = ""
            app_name = ""
            for app in apps:
                creds = app.get("credentials", [])
                for cred in creds:
                    if cred.get("status") == "approved" and cred.get("consumerKey"):
                        api_key = cred["consumerKey"]
                        app_name = app.get("name", "")
                        if "admin" in app_name.lower() or "enterprise" in app_name.lower():
                            break
                if api_key and ("admin" in app_name.lower() or "enterprise" in app_name.lower()):
                    break

            if not api_key:
                # Auto-provision Unified Admin <username> App
                target_app_name = f"Unified Admin {username} App"
                print(f"[Provision] Creating app '{target_app_name}' for {email}...")
                create_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{urllib.parse.quote(email)}/apps"
                create_req = urllib.request.Request(
                    create_url,
                    data=json.dumps({
                        "name": target_app_name,
                        "apiProducts": ["Engineering and IT", "Enterprise Tools MCP"],
                        "attributes": [
                            {"name": "DisplayName", "value": target_app_name},
                            {"name": "persona", "value": "admin"},
                        ],
                    }).encode(),
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(create_req) as c_resp:
                    created_app = json.loads(c_resp.read().decode())
                    creds = created_app.get("credentials", [])
                    if creds and creds[0].get("consumerKey"):
                        api_key = creds[0]["consumerKey"]
                        app_name = created_app.get("name", target_app_name)

            if api_key:
                dev_profiles.append({"email": email, "apiKey": api_key, "appName": app_name})
            else:
                print(f"[Skip] Could not resolve API key for {email}")
        except Exception as exc:
            print(f"[Warn] Failed to fetch/create apps for {email}: {exc}")

    return dev_profiles


def send_gateway_request(gateway_base: str, email: str, api_key: str, item: dict):
    """Send a single AI Gateway request and return telemetry."""
    url = f"{gateway_base.rstrip('/')}{item['path']}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": item["prompt"]}]}],
        "generationConfig": {"maxOutputTokens": 256, "temperature": 0.3},
    }
    dev_jwt = create_developer_jwt(email)
    headers = {
        "Content-Type": "application/json",
        "x-apikey": api_key,
        "X-User-Email": email,
        "Authorization": f"Bearer {dev_jwt}",
    }

    start = time.time()
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            status = resp.status
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            model = resp_headers.get("x-gateway-model", "gemini-3.5-flash-lite")
            tokens = int(resp_headers.get("x-gateway-total-tokens", "0") or 0)
            cost_usd = float(resp_headers.get("x-gateway-cost-usd", "0.0") or 0.0)
            latency_ms = int((time.time() - start) * 1000)
            return {
                "email": email,
                "label": item["label"],
                "status": status,
                "model": model,
                "tokens": tokens,
                "costUsd": cost_usd,
                "latencyMs": latency_ms,
            }
    except urllib.error.HTTPError as err:
        return {
            "email": email,
            "label": item["label"],
            "status": err.code,
            "model": "error",
            "tokens": 0,
            "costUsd": 0.0,
            "latencyMs": int((time.time() - start) * 1000),
            "error": err.reason,
        }
    except Exception as exc:
        return {
            "email": email,
            "label": item["label"],
            "status": 500,
            "model": "error",
            "tokens": 0,
            "costUsd": 0.0,
            "latencyMs": int((time.time() - start) * 1000),
            "error": str(exc),
        }


def apply_wallet_adjustment(org: str, token: str, email: str, amount_usd: float):
    """Apply wallet deduction in Apigee so Monetization UI reflects usage immediately."""
    if amount_usd <= 0:
        return
    units = int(amount_usd)
    nanos = int(round((amount_usd - units) * 1e9))
    adj_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{urllib.parse.quote(email)}/balance:adjust"
    req = urllib.request.Request(
        adj_url,
        data=json.dumps({"adjustment": {"currencyCode": "USD", "units": str(units), "nanos": nanos}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            wallet = data.get("wallets", [{}])[0].get("balance", {})
            new_bal = int(wallet.get("units", 0)) + int(wallet.get("nanos", 0)) / 1e9
            return new_bal
    except Exception as exc:
        print(f"[Warn] Could not adjust wallet balance for {email}: {exc}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Generate demo AI Gateway traffic & monetization usage.")
    parser.add_argument("--org", default=DEFAULT_ORG, help="Apigee organization ID")
    parser.add_argument("--gateway-url", default=DEFAULT_GATEWAY_URL, help="AI Gateway base URL")
    parser.add_argument("--requests-per-user", type=int, default=3, help="Number of requests per developer")
    parser.add_argument(
        "--demo-cost-multiplier",
        type=float,
        default=150.0,
        help="Multiplier applied to micro-dollar LLM cost for visible demo wallet deduction (default: 150x)",
    )
    parser.add_argument(
        "--skip-wallet-adjust",
        action="store_true",
        help="Skip balance:adjust wallet deductions (useful when re-seeding analytics traffic only)",
    )
    args = parser.parse_args()

    token = get_gcloud_token()
    print(f"Discovering developers and approved apps in Apigee org '{args.org}'...")
    dev_profiles = get_developers_and_keys(args.org, token)
    print(f"Found {len(dev_profiles)} active developers with approved API keys.\n")

    tasks = []
    for dev in dev_profiles:
        selected_routes = random.sample(
            PROMPTS_AND_ROUTES, k=min(args.requests_per_user, len(PROMPTS_AND_ROUTES))
        )
        for route in selected_routes:
            tasks.append((dev["email"], dev["apiKey"], route))

    print(f"Sending {len(tasks)} live AI Gateway requests across {len(dev_profiles)} developers...")
    results_by_dev = {d["email"]: {"calls": 0, "tokens": 0, "rawCostUsd": 0.0} for d in dev_profiles}

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [
            executor.submit(send_gateway_request, args.gateway_url, email, api_key, route)
            for (email, api_key, route) in tasks
        ]
        for future in as_completed(futures):
            res = future.result()
            email = res["email"]
            status = res["status"]
            model = res["model"]
            tokens = res["tokens"]
            cost = res["costUsd"]
            latency = res["latencyMs"]
            print(
                f"  [{status}] {email:<28} | {res['label']:<22} | model={model:<18} | tokens={tokens:<4} | cost=${cost:.6f} | {latency}ms"
            )
            if status == 200:
                results_by_dev[email]["calls"] += 1
                results_by_dev[email]["tokens"] += tokens
                results_by_dev[email]["rawCostUsd"] += cost

    if not args.skip_wallet_adjust:
        print("\nApplying immediate wallet deductions in Apigee Monetization for demo visibility...")
        print("-" * 90)
        print(f"{'Developer Email':<30} | {'Calls':<6} | {'Tokens':<8} | {'Deducted ($)':<14} | {'Remaining Balance ($)'}")
        print("-" * 90)

        for email, stats in results_by_dev.items():
            if stats["calls"] == 0:
                continue
            raw_cost = stats["rawCostUsd"]
            if raw_cost <= 0:
                raw_cost = (stats["tokens"] / 1_000_000.0) * 1.25
            demo_deduction = round(max(0.25, min(3.50, raw_cost * args.demo_cost_multiplier + random.uniform(0.15, 0.85))), 4)
            new_bal = apply_wallet_adjustment(args.org, token, email, demo_deduction)
            bal_str = f"${new_bal:.4f}" if new_bal is not None else "N/A"
            print(
                f"{email:<30} | {stats['calls']:<6} | {stats['tokens']:<8} | -${demo_deduction:<13.4f} | {bal_str}"
            )
    else:
        print("\nSkipped wallet adjustments (--skip-wallet-adjust enabled).")
        print("-" * 70)
        print(f"{'Developer Email':<30} | {'Calls':<6} | {'Tokens':<8} | {'Raw Cost ($)'}")
        print("-" * 70)
        for email, stats in results_by_dev.items():
            print(f"{email:<30} | {stats['calls']:<6} | {stats['tokens']:<8} | ${stats['rawCostUsd']:.6f}")

    print("-" * 90)
    print("Demo traffic generation complete!")


if __name__ == "__main__":
    main()
