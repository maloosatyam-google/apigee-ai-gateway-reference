#!/usr/bin/env python3
"""
Provision and Synchronize Unified Apigee Products and Apps
Usage: python3 apigee/scripts/provision_unified_credentials.py [--org <ORG>] [--dev <DEVELOPER_EMAIL>]
"""

import os
import pathlib
import sys
import json
import argparse
import subprocess
from urllib.parse import quote
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

# Starting prepaid wallet credit for a new developer. Must match
# PREPAID_STARTING_BALANCE_USD in ui/server.js and ui/vite.config.ts (the UI's onboarding
# path and the "spent X of Y" denominator), or wallets look partly spent on first use.
PREPAID_STARTING_BALANCE_USD = 20

def get_access_token():
    # Try application-default first (avoids CBA mTLS issues on corporate laptops)
    try:
        token = subprocess.check_output(["gcloud", "auth", "application-default", "print-access-token"], stderr=subprocess.DEVNULL).decode().strip()
        if token:
            return token
    except Exception:
        pass
    try:
        token = subprocess.check_output(["gcloud", "auth", "print-access-token", f"--impersonate-service-account={CFG.UI_MGMT_SA}"], stderr=subprocess.DEVNULL).decode().strip()
        if token:
            return token
    except Exception:
        pass
    try:
        return subprocess.check_output(["gcloud", "auth", "print-access-token"], stderr=subprocess.DEVNULL).decode().strip()
    except Exception as e:
        print(f"Error obtaining gcloud token: {e}")
        sys.exit(1)

def run_curl(url, method="GET", data=None, token=None):
    headers = ["-H", f"Authorization: Bearer {token}"]
    if data is not None:
        headers.extend(["-H", "Content-Type: application/json"])
    cmd = ["curl", "-s", "-X", method] + headers + [url]
    if data is not None:
        cmd.extend(["-d", json.dumps(data)])
    res = subprocess.check_output(cmd).decode()
    try:
        return json.loads(res)
    except Exception:
        return res

def sync_product(org, token, filepath):
    with open(filepath) as f:
        prod_data = json.load(f)
    name = prod_data["name"]
    enc_name = quote(name)
    url = f"https://apigee.googleapis.com/v1/organizations/{org}/apiproducts/{enc_name}"
    
    # Check if exists
    chk_cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", f"Authorization: Bearer {token}", url]
    status = subprocess.check_output(chk_cmd).decode().strip()
    
    if status == "200":
        # Remove read-only metadata
        for k in ["createdAt", "lastModifiedAt"]:
            prod_data.pop(k, None)
        put_url = f"https://apigee.googleapis.com/v1/organizations/{org}/apiproducts/{enc_name}"
        res = run_curl(put_url, method="PUT", data=prod_data, token=token)
        print(f"  [UPDATED] API Product: {name}")
    else:
        post_url = f"https://apigee.googleapis.com/v1/organizations/{org}/apiproducts"
        res = run_curl(post_url, method="POST", data=prod_data, token=token)
        print(f"  [CREATED] API Product: {name}")
    return name

def sync_app(org, dev, token, filepath):
    with open(filepath) as f:
        app_data = json.load(f)
    app_name = app_data["name"]
    # Ensure displayName matches name both at top-level and in attributes
    app_data["displayName"] = app_name
    attrs = list(app_data.get("attributes", []))
    if not any(a.get("name") in ("DisplayName", "displayName") for a in attrs):
        attrs.insert(0, {"name": "DisplayName", "value": app_name})
    app_data["attributes"] = attrs

    enc_name = quote(app_name)
    enc_dev = quote(dev)
    
    url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/apps/{enc_name}"
    chk_cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", f"Authorization: Bearer {token}", url]
    status = subprocess.check_output(chk_cmd).decode().strip()
    
    if status != "200":
        post_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/apps"
        res = run_curl(post_url, method="POST", data=app_data, token=token)
        print(f"  [CREATED] Developer App: {app_name} (displayName: {app_name})")
    else:
        # Fetch current app
        res = run_curl(url, method="GET", token=token)
        # Update products and ensure displayName if needed
        curr_attrs = res.get("attributes", []) if isinstance(res, dict) else []
        merged_attrs = [a for a in curr_attrs if a.get("name") not in ("DisplayName", "displayName")]
        merged_attrs.insert(0, {"name": "DisplayName", "value": app_name})
        for a in attrs:
            if not any(ma.get("name") == a.get("name") for ma in merged_attrs):
                merged_attrs.append(a)

        put_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/apps/{enc_name}"
        update_payload = {
            "name": app_name,
            "displayName": app_name,
            "apiProducts": app_data.get("apiProducts", []),
            "attributes": merged_attrs
        }
        res = run_curl(put_url, method="PUT", data=update_payload, token=token)
        print(f"  [UPDATED] Developer App: {app_name} (displayName: {app_name})")
    
    # Extract API key (consumerKey)
    credentials = res.get("credentials", []) if isinstance(res, dict) else []
    if not credentials:
        get_res = run_curl(url, method="GET", token=token)
        credentials = get_res.get("credentials", []) if isinstance(get_res, dict) else []
    if credentials:
        key = credentials[0].get("consumerKey", "")
        return app_name, key
    return app_name, ""

def sync_monetization(org, dev, token):
    import time
    print("\n3. Synchronizing Apigee Monetization Configuration...")
    enc_dev = quote(dev)

    # 1. Set Developer to PREPAID
    monetization_cfg_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/monetizationConfig"
    cfg_res = run_curl(monetization_cfg_url, method="PUT", data={"billingType": "PREPAID"}, token=token)
    print(f"  [CONFIGURED] Developer {dev} billingType => PREPAID")

    # 2. Rate Plans and Subscriptions for AI Products
    # One API product per persona (see ui/server/personas.js).
    ai_products = [
        "Engineering and IT",
        "Analysts and Knowledge Workers",
        "Customer Support and Sales",
    ]
    now_ms = str(int(time.time() * 1000))

    # Fetch active subscriptions
    sub_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/subscriptions"
    curr_subs = run_curl(sub_url, method="GET", token=token)
    subscribed_products = set()
    if isinstance(curr_subs, list):
        for s in curr_subs:
            subscribed_products.add(s.get("apiproduct", ""))

    for prod_name in ai_products:
        enc_prod = quote(prod_name)
        rp_url = f"https://apigee.googleapis.com/v1/organizations/{org}/apiproducts/{enc_prod}/rateplans"
        rp_res = run_curl(rp_url, method="GET", token=token)
        
        has_published = False
        rateplan_id = None
        rp_items = rp_res.get("ratePlans", []) if isinstance(rp_res, dict) else []
        for item in rp_items:
            r_id = item.get("name")
            if r_id:
                detail = run_curl(f"{rp_url}/{r_id}", method="GET", token=token)
                if isinstance(detail, dict) and detail.get("state") == "PUBLISHED":
                    has_published = True
                    rateplan_id = r_id
                    break

        if not has_published:
            # Create and publish rate plan
            create_rp_payload = {
                "apiproduct": prod_name,
                "displayName": f"{prod_name} PayAsYouGo",
                "billingPeriod": "MONTHLY",
                "currencyCode": "USD",
                "consumptionPricingType": "FIXED_PER_UNIT",
                "consumptionPricingRates": [{
                    "fee": {
                        "currencyCode": "USD",
                        "units": "0",
                        "nanos": 1000000
                    }
                }],
                "state": "DRAFT"
            }
            create_res = run_curl(rp_url, method="POST", data=create_rp_payload, token=token)
            rateplan_id = create_res.get("name")
            if rateplan_id:
                pub_url = f"{rp_url}/{rateplan_id}"
                pub_payload = dict(create_rp_payload)
                pub_payload["state"] = "PUBLISHED"
                pub_payload["startTime"] = now_ms
                run_curl(pub_url, method="PUT", data=pub_payload, token=token)
                print(f"  [PUBLISHED] Rate Plan for {prod_name}: {rateplan_id}")
        else:
            print(f"  [EXISTS] Published Rate Plan for {prod_name}: {rateplan_id}")

        # Subscribe developer if not yet subscribed
        if prod_name not in subscribed_products:
            sub_payload = {
                "apiproduct": prod_name,
                "startTime": now_ms
            }
            sub_res = run_curl(sub_url, method="POST", data=sub_payload, token=token)
            print(f"  [SUBSCRIBED] Developer {dev} to {prod_name}")
        else:
            print(f"  [EXISTS] Subscription for {prod_name}")

    # 3. Check / Top-Up Developer Wallet
    bal_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/balance"
    bal_res = run_curl(bal_url, method="GET", token=token)
    wallets = bal_res.get("wallets", []) if isinstance(bal_res, dict) else []
    
    needs_credit = True
    if wallets:
        bal = wallets[0].get("balance", {})
        # units AND nanos: a sub-dollar balance ($0.99 = units 0, nanos 990000000) is not
        # empty, and reading units alone re-credited it.
        usd = int(bal.get("units", "0") or 0) + int(bal.get("nanos", 0) or 0) / 1e9
        if usd > 0:
            needs_credit = False
            print(f"  [WALLET] Active Prepaid Wallet Balance: ${usd:.2f} USD")

    if needs_credit:
        credit_url = f"https://apigee.googleapis.com/v1/organizations/{org}/developers/{enc_dev}/balance:credit"
        tx_id = f"init-topup-{int(time.time())}"
        credit_payload = {
            "transactionAmount": {
                "currencyCode": "USD",
                "units": str(PREPAID_STARTING_BALANCE_USD),
                "nanos": 0
            },
            "transactionId": tx_id
        }
        credit_res = run_curl(credit_url, method="POST", data=credit_payload, token=token)
        print(f"  [WALLET] Initialized Prepaid Wallet with ${PREPAID_STARTING_BALANCE_USD:.2f} USD (Tx: {tx_id})")

def main():
    parser = argparse.ArgumentParser(description="Provision Apigee Unified Products and Apps")
    parser.add_argument("--org", default=CFG.APIGEE_ORG, help="Apigee Organization name")
    parser.add_argument("--dev", default=CFG.DEMO_ADMIN_EMAIL, help="Developer email")
    args = parser.parse_args()

    print(f"=== Apigee Unified Credential Provisioning ===")
    print(f"Organization: {args.org}")
    print(f"Developer:    {args.dev}\n")

    token = get_access_token()

    target_products = [
        "engineering_and_it.json",
        "analysts_and_knowledge_workers.json",
        "customer_support_and_sales.json",
        "enterprise_tools_mcp.json",
        "bigquery_tools_mcp.json",
        "servicenow_tools_mcp.json",
        "servicenow_tools_mcp_create_incident.json",
        "customer_service_tools_mcp.json",
        "business_insights_tools_mcp.json",
        "llm_passthrough.json"
    ]

    print("1. Synchronizing API Products...")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    prod_dir = os.path.join(base_dir, "products")
    
    for pfile in target_products:
        path = os.path.join(prod_dir, pfile)
        if os.path.exists(path):
            sync_product(args.org, token, path)
        else:
            print(f"  [WARN] File not found: {path}")

    print("\n2. Synchronizing Developer Apps & Keys...")
    app_dir = os.path.join(base_dir, "apps")
    target_apps = [
        ("unified_sales_app.json", "VITE_SALES_API_KEY"),
        ("unified_loans_app.json", "VITE_LOANS_API_KEY")
    ]

    for afile, env_var in target_apps:
        path = os.path.join(app_dir, afile)
        if os.path.exists(path):
            app_name, key = sync_app(args.org, args.dev, token, path)
            masked = f"{key[:4]}...{key[-4:]}" if len(key) >= 8 else "***"
            print(f"     => {app_name} provisioned (key: {masked})")
        else:
            print(f"  [WARN] File not found: {path}")

    # Synchronize Monetization
    sync_monetization(args.org, args.dev, token)

    # Ensure ui/.env does not store API keys on disk (keys are fetched at runtime via /api/me)
    ui_env_path = os.path.join(os.path.dirname(base_dir), "ui", ".env")
    if os.path.exists(ui_env_path):
        with open(ui_env_path) as f:
            lines = f.readlines()

        env_dict = {}
        for line in lines:
            line_str = line.strip()
            if line_str and not line_str.startswith("#") and "=" in line_str:
                k, v = line_str.split("=", 1)
                k_clean = k.strip()
                if "API_KEY" not in k_clean.upper():
                    env_dict[k_clean] = v.strip()

        env_dict["VITE_DEFAULT_ENV"] = "prod"

        with open(ui_env_path, "w") as f:
            f.write("# Local development & production demo configuration\n")
            f.write("# API keys are fetched dynamically at runtime via /api/me and Apigee Management API\n")
            for k, v in sorted(env_dict.items()):
                f.write(f"{k}={v}\n")
        print(f"\n4. Sanitized ui/.env (stripped any hardcoded API keys, set VITE_DEFAULT_ENV=prod)")

    print("\n=== Provisioning Complete ===")

if __name__ == "__main__":
    main()
