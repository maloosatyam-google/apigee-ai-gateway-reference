#!/usr/bin/env python3
"""Migrate the org from the two generic AI tiers to the three persona products.

Retires  : "Enterprise AI Tier", "Standard AI Tier" (+ their "... Dev" clones)
Introduces: "Engineering and IT", "Analysts and Knowledge Workers",
            "Customer Support and Sales" (prod-only) + "<name> Dev" clones (dev-only)

Run in two phases around the UI deploy (see docs/unified_credentials_and_products_reference.md):

  create  Safe while the old UI is live. Upserts the persona products and their Dev
          clones, publishes a PayAsYouGo rate plan on each prod persona product, and
          subscribes developers so MLC-EnforceMonetizationLimits keeps passing once keys
          move. Nothing that the old UI depends on is touched.

  swap    Run after the new UI is deployed. For every app credential that holds a
          legacy product: attach the mapped persona product(s) first, then detach the
          legacy product, so a key is never left without an AI product. Optionally
          rotates one leaked key (--rotate-key-prefix). Legacy products are left in
          place (detached) for rollback; delete them by hand once signed off.

Idempotent: re-running either phase only does what is still missing.
Keys are never printed in full.

Usage:
  python3 apigee/scripts/migrate_persona_products.py --phase create [--dry-run]
  python3 apigee/scripts/migrate_persona_products.py --phase swap   [--dry-run] \
      [--rotate-key-prefix GR4Vw5 --rotate-developer <admin email>]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import quote
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRODUCTS_DIR = ROOT / "apigee" / "products"
API = "https://apigee.googleapis.com/v1/organizations"

ENG = "Engineering and IT"
ANA = "Analysts and Knowledge Workers"
SUP = "Customer Support and Sales"
PERSONA_FILES = {
    ENG: "engineering_and_it.json",
    ANA: "analysts_and_knowledge_workers.json",
    SUP: "customer_support_and_sales.json",
}
PERSONA_PRODUCTS = list(PERSONA_FILES)
DEV_SUFFIX = " Dev"

LEGACY_ENT = "Enterprise AI Tier"
LEGACY_STD = "Standard AI Tier"
LEGACY_PROD = [LEGACY_ENT, LEGACY_STD]
LEGACY_DEV = [p + DEV_SUFFIX for p in LEGACY_PROD]

# Developers who own the shared persona apps and must be subscribed to every product.
OWNERS = set(CFG.persona_app_developers)

DRY = False
ORG = ""
TOKEN = ""


# --------------------------------------------------------------------------- http
def token() -> str:
    for cmd in (["gcloud", "auth", "application-default", "print-access-token"],
                ["gcloud", "auth", "print-access-token"]):
        try:
            t = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode().strip()
            if t:
                return t
        except Exception:
            pass
    sys.exit("could not obtain a gcloud access token")


def call(method: str, path: str, body=None, ok404=False):
    """Management API call. Mutations are skipped (and logged) under --dry-run."""
    if DRY and method != "GET":
        return {"_dry_run": True}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}/{ORG}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    # GETs are retried on timeouts / 5xx. Mutations are not: a retried POST could
    # duplicate a subscription, and the whole script is safe to rerun instead.
    attempts = 4 if method == "GET" else 1
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if ok404 and e.code == 404:
                return None
            if e.code >= 500 and i < attempts - 1:
                time.sleep(2 ** i)
                continue
            msg = e.read().decode()[:400]
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {msg}") from None
        except (TimeoutError, OSError) as e:
            if i < attempts - 1:
                time.sleep(2 ** i)
                continue
            raise RuntimeError(f"{method} {path} -> {e}") from None


def q(s: str) -> str:
    return quote(s, safe="")


def mask(key: str) -> str:
    return (key or "")[:6] + "…"


def act(msg: str):
    print(("  [DRY-RUN] " if DRY else "  ") + msg)


# ----------------------------------------------------------------------- products
def load_product(name: str) -> dict:
    return json.loads((PRODUCTS_DIR / PERSONA_FILES[name]).read_text(encoding="utf-8"))


def dev_clone(prod: dict) -> dict:
    """Mirror of buildDevClone in ui/server/adminAgentCore.js."""
    c = json.loads(json.dumps(prod))
    c["name"] = prod["name"] + DEV_SUFFIX
    if prod.get("displayName"):
        c["displayName"] = prod["displayName"] + " (Dev)"
    c["environments"] = ["dev"]
    c["description"] = f"Admin Agent dev sandbox clone of {prod['name']}. Bound to dev only."
    for k in ("createdAt", "lastModifiedAt"):
        c.pop(k, None)
    return c


def upsert_product(body: dict, overwrite: bool):
    name = body["name"]
    existing = call("GET", f"/apiproducts/{q(name)}", ok404=True)
    if existing is None:
        call("POST", "/apiproducts", body)
        act(f"[CREATED] product {name}")
    elif overwrite:
        call("PUT", f"/apiproducts/{q(name)}", body)
        act(f"[UPDATED] product {name}")
    else:
        print(f"  [EXISTS] product {name} (left as is: Dev edits are preserved)")


def ensure_rate_plan(name: str):
    rp_path = f"/apiproducts/{q(name)}/rateplans"
    listing = call("GET", rp_path, ok404=True) or {}
    # The listing returns ids only; the state is on the plan itself.
    for p in listing.get("ratePlans", []):
        detail = call("GET", f"{rp_path}/{p['name']}", ok404=True) or {}
        if detail.get("state") == "PUBLISHED":
            print(f"  [EXISTS] published rate plan on {name}: {p['name']}")
            return
    plan = {
        "apiproduct": name,
        "displayName": f"{name} PayAsYouGo",
        "billingPeriod": "MONTHLY",
        "currencyCode": "USD",
        "consumptionPricingType": "FIXED_PER_UNIT",
        "consumptionPricingRates": [{"fee": {"currencyCode": "USD", "units": "0", "nanos": 1000000}}],
        "state": "DRAFT",
    }
    created = call("POST", rp_path, plan)
    plan_id = created.get("name", "<new>")
    plan.update(state="PUBLISHED", startTime=str(int(time.time() * 1000)))
    call("PUT", f"{rp_path}/{plan_id}", plan)
    act(f"[PUBLISHED] rate plan on {name}: {plan_id}")


# -------------------------------------------------------------------- developers
def developers() -> list[dict]:
    out, start = [], None
    while True:
        path = "/developers?expand=true&count=1000" + (f"&startKey={q(start)}" if start else "")
        page = (call("GET", path) or {}).get("developer", [])
        if start:
            page = [d for d in page if d.get("email") != start]
        if not page:
            break
        out.extend(page)
        if len(page) < 999:
            break
        start = page[-1]["email"]
    return out


def active_subs(email: str) -> set[str]:
    data = call("GET", f"/developers/{q(email)}/subscriptions", ok404=True) or {}
    now = int(time.time() * 1000)
    active = set()
    for s in data.get("developerSubscriptions", []):
        end = s.get("endTime")
        if s.get("apiproduct") and (not end or int(end) > now):
            active.add(s["apiproduct"])
    return active


def phase_create():
    print("1. Persona products (prod)")
    prods = {n: load_product(n) for n in PERSONA_PRODUCTS}
    for n, body in prods.items():
        upsert_product(body, overwrite=True)

    print("2. Dev clones (dev)")
    for body in prods.values():
        upsert_product(dev_clone(body), overwrite=False)

    print("3. Rate plans")
    for n in PERSONA_PRODUCTS:
        ensure_rate_plan(n)

    print("4. Subscriptions")
    start = str(int(time.time() * 1000))
    added = 0
    for d in developers():
        email = d["email"]
        have = active_subs(email)
        want = set(PERSONA_PRODUCTS) if email.lower() in OWNERS else (
            {ENG} if (LEGACY_ENT in have or LEGACY_STD in have) else set())
        for p in sorted(want - have):
            call("POST", f"/developers/{q(email)}/subscriptions", {"apiproduct": p, "startTime": start})
            act(f"[SUBSCRIBED] {email} -> {p}")
            added += 1
    print(f"  {added} subscription(s) added")


# ------------------------------------------------------------------------- swap
def mapping_for(app_name: str, products: set[str]) -> tuple[list[str], list[str]]:
    """(add, remove) for one credential."""
    add, remove = [], []
    if LEGACY_ENT in products:
        add.append(ENG)
        remove.append(LEGACY_ENT)
    if LEGACY_STD in products:
        lname = app_name.lower()
        add.append(ANA if "loans" in lname else SUP)
        remove.append(LEGACY_STD)
    legacy_dev = [p for p in LEGACY_DEV if p in products]
    if legacy_dev:
        add.extend(p + DEV_SUFFIX for p in PERSONA_PRODUCTS)
        remove.extend(legacy_dev)
    add = [p for p in dict.fromkeys(add) if p not in products]
    return add, remove


def phase_swap(rotate_prefix: str | None, rotate_dev: str | None):
    print("1. Move credentials off the legacy tiers")
    moved = 0
    for d in developers():
        email = d["email"]
        apps = (call("GET", f"/developers/{q(email)}/apps?expand=true", ok404=True) or {}).get("app", [])
        for app in apps:
            for cred in app.get("credentials", []):
                have = {p["apiproduct"] for p in cred.get("apiProducts", [])}
                add, remove = mapping_for(app["name"], have)
                if not add and not remove:
                    continue
                key_path = f"/developers/{q(email)}/apps/{q(app['name'])}/keys/{q(cred['consumerKey'])}"
                if add:
                    call("POST", key_path, {"apiProducts": add})
                for p in remove:
                    call("DELETE", f"{key_path}/apiproducts/{q(p)}")
                act(f"[SWAPPED] {email} / {app['name']} key {mask(cred['consumerKey'])}: "
                    f"+{add} -{remove}")
                moved += 1
    print(f"  {moved} credential(s) updated")

    if rotate_prefix:
        print(f"2. Rotate key {rotate_prefix}… on {rotate_dev}")
        rotate_key(rotate_dev, rotate_prefix)


def rotate_key(email: str, prefix: str):
    apps = (call("GET", f"/developers/{q(email)}/apps?expand=true", ok404=True) or {}).get("app", [])
    hits = [(a, c) for a in apps for c in a.get("credentials", []) if c["consumerKey"].startswith(prefix)]
    if not hits:
        print(f"  [SKIP] no key starting {prefix} on {email} (already rotated?)")
        return
    if len(hits) > 1:
        sys.exit(f"  prefix {prefix} matches {len(hits)} keys; refusing to rotate")
    app, old = hits[0]
    products = [p["apiproduct"] for p in old.get("apiProducts", [])]
    body = {
        "name": app["name"],
        "attributes": app.get("attributes", []),
        "callbackUrl": app.get("callbackUrl", ""),
        "apiProducts": products,
    }
    before = {c["consumerKey"] for c in app.get("credentials", [])}
    call("POST", f"/developers/{q(email)}/apps/{q(app['name'])}", body)
    if not DRY:
        after = call("GET", f"/developers/{q(email)}/apps/{q(app['name'])}")
        new = [c for c in after.get("credentials", []) if c["consumerKey"] not in before]
        if not new:
            sys.exit("  new key was not created; old key left in place")
        act(f"[NEW KEY] {app['name']}: {mask(new[0]['consumerKey'])} products={products}")
    call("DELETE", f"/developers/{q(email)}/apps/{q(app['name'])}/keys/{q(old['consumerKey'])}")
    act(f"[REVOKED] {app['name']}: old key {mask(old['consumerKey'])}")


def main():
    global DRY, ORG, TOKEN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phase", choices=["create", "swap"], required=True)
    ap.add_argument("--org", default=CFG.APIGEE_ORG)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--rotate-key-prefix")
    ap.add_argument("--rotate-developer", default=CFG.DEMO_ADMIN_EMAIL)
    a = ap.parse_args()
    DRY, ORG, TOKEN = a.dry_run, a.org, token()
    print(f"org={ORG} phase={a.phase}{' (dry run)' if DRY else ''}")
    if a.phase == "create":
        phase_create()
    else:
        phase_swap(a.rotate_key_prefix, a.rotate_developer)


if __name__ == "__main__":
    main()
