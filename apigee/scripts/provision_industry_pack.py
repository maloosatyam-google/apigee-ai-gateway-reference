#!/usr/bin/env python3
"""Deploys an industry pack to Apigee: the <id>-mcp proxy, its 3 products, and app access.

  python3 apigee/scripts/provision_industry_pack.py banking [--envs dev,prod] [--skip-proxy]
                                                            [--skip-apihub] [--dry-run]

Steps:
  1. Regenerates the bundle and product JSON from industries/<id>.json (gen_industry_mcp.py).
  2. Imports the proxy and deploys it to each environment with the ai-client service account
     (its Google ID token reaches the private Cloud Run service industry-apis).
  3. Creates / updates the Admin, Support & Sales and Analysts products.
  4. Adds the persona products to the shared Unified Sales / Loans apps, and the Admin product
     to the owner's "Unified Admin <handle> App" apps (the Agent Showcase baseline key).
     Other admins get it from the UI's admin-app sync on sign-in.
  5. Catalogues <id>-mcp in API hub (apihub_catalog.py --only <id>-mcp): BU, team, owner,
     style MCP, maturity and description; BU and team come from the pack's optional "apihub"
     block. API hub only picks up a new proxy on its 6-hourly Apigee sync, so on a first deploy
     this step usually warns with the next sync time and the command to re-run afterwards.
"""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gen_industry_mcp as gen  # noqa: E402

ORG = CFG.require('APIGEE_ORG').APIGEE_ORG
API = f'https://apigee.googleapis.com/v1/organizations/{ORG}'
PROXY_SA = f'ai-client@{ORG}.iam.gserviceaccount.com'
# Owner of the shared Unified Sales / Loans apps (see provision_business_products.py).
PERSONA_APP_DEV = CFG.PERSONA_APP_DEVELOPER
ADMIN_DEVS = [CFG.DEMO_ADMIN_EMAIL]
ADMIN_APP_RE = re.compile(r'^Unified Admin .+ App$', re.I)


def token():
    return subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token'], text=True).strip()


TOKEN = None


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raw = e.read() or b'{}'
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {'raw': raw.decode(errors='replace')}


def deploy_proxy(pack, envs, dry):
    name = pack['proxy']
    src = gen.PROXIES / name
    with tempfile.TemporaryDirectory() as tmp:
        # Fill the bundle's __PLACEHOLDER__ tokens from .env (same as package_bundle.sh).
        root = pathlib.Path(__file__).resolve().parents[2]
        rendered = pathlib.Path(tmp) / 'src'
        subprocess.run(['bash', '-c', 'source "$0/scripts/lib/config.sh" && python3 "$0/apigee/scripts/render_tokens.py" "$1" "$2"',
                        str(root), str(src), str(rendered)], check=True)
        zip_path = shutil.make_archive(str(pathlib.Path(tmp) / name), 'zip', rendered, 'apiproxy')
        if dry:
            print(f'  [dry-run] import {name} ({pathlib.Path(zip_path).stat().st_size} bytes) and deploy to {envs}')
            return
        out = subprocess.check_output([
            'curl', '-s', '-X', 'POST', '-H', f'Authorization: Bearer {TOKEN}', '-F', f'file=@{zip_path}',
            f'{API}/apis?name={name}&action=import'], text=True)
    rev = json.loads(out).get('revision')
    if not rev:
        sys.exit(f'import failed: {out}')
    print(f'  imported {name} rev {rev}')
    for env in envs:
        status, resp = call('POST', f'/environments/{env}/apis/{name}/revisions/{rev}/deployments'
                                    f'?override=true&serviceAccount={urllib.parse.quote(PROXY_SA)}')
        if status >= 300:
            sys.exit(f'deploy to {env} failed: {resp}')
        print(f'  deploying {name} rev {rev} to {env}')
    for env in envs:
        for _ in range(60):
            status, d = call('GET', f'/environments/{env}/apis/{name}/revisions/{rev}/deployments')
            if d.get('state') == 'READY':
                print(f'  {env}: READY')
                break
            if d.get('state') == 'ERROR':
                sys.exit(f'{env}: deployment error {d.get("errors")}')
            time.sleep(5)
        else:
            sys.exit(f'{env}: deployment did not become READY')


def upsert_product(body, dry):
    q = urllib.parse.quote(body['name'])
    status, _ = call('GET', f'/apiproducts/{q}')
    if dry:
        print('  [dry-run]', 'update' if status == 200 else 'create', body['name'])
        return
    status, resp = call('PUT', f'/apiproducts/{q}', body) if status == 200 else call('POST', '/apiproducts', body)
    if status >= 300:
        sys.exit(f"product {body['name']}: {resp}")
    print('  product', body['name'], 'ok')


def attach(dev, app, product, dry):
    status, a = call('GET', f'/developers/{urllib.parse.quote(dev)}/apps/{urllib.parse.quote(app)}')
    if status != 200:
        print(f'  [WARN] app {app} ({dev}) not found: {status}')
        return
    for cred in a.get('credentials', []):
        if cred.get('status') not in (None, 'approved'):
            continue
        have = [p['apiproduct'] for p in cred.get('apiProducts', [])]
        if product in have:
            print(f'  app {app} already has {product}')
            continue
        if dry:
            print(f'  [dry-run] app {app} + {product}')
            continue
        status, resp = call('POST', f"/developers/{urllib.parse.quote(dev)}/apps/{urllib.parse.quote(app)}/keys/"
                                    f"{urllib.parse.quote(cred['consumerKey'])}", {'apiProducts': [product]})
        print(f'  app {app} + {product}', 'ok' if status < 300 else resp)


def main():
    global TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument('industry')
    ap.add_argument('--envs', default='dev,prod')
    ap.add_argument('--target-url', default=gen.DEFAULT_TARGET)
    ap.add_argument('--skip-proxy', action='store_true')
    ap.add_argument('--skip-apihub', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    TOKEN = token()

    print('1. Generating bundle and products')
    pack = gen.generate(a.industry, a.target_url)
    envs = [e for e in a.envs.split(',') if e]

    if not a.skip_proxy:
        print(f"2. Deploying {pack['proxy']}")
        deploy_proxy(pack, envs, a.dry_run)

    print('3. Products')
    for key in ('admin', 'ops', 'insights'):
        body = json.loads((gen.PRODUCTS / f"{pack['id']}_tools_mcp_{key}.json").read_text())
        upsert_product(body, a.dry_run)

    print('4. App access')
    for key in ('ops', 'insights'):
        p = pack['personas'][key]
        attach(PERSONA_APP_DEV, p['app'], p['product'], a.dry_run)
    for dev in ADMIN_DEVS:
        status, apps = call('GET', f'/developers/{urllib.parse.quote(dev)}/apps?expand=true')
        for app in apps.get('app', []) if status == 200 else []:
            if ADMIN_APP_RE.match(app.get('name', '')):
                attach(dev, app['name'], pack['personas']['admin']['product'], a.dry_run)

    if not a.skip_apihub:
        print('5. API hub catalog')
        cmd = [sys.executable, str(pathlib.Path(__file__).resolve().parent / 'apihub_catalog.py'),
               '--only', pack['proxy']] + (['--dry-run'] if a.dry_run else [])
        if subprocess.run(cmd).returncode:
            print(f"WARNING: {pack['proxy']} is not catalogued in API hub yet (see above); re-run: "
                  f"python3 apigee/scripts/apihub_catalog.py --only {pack['proxy']}")
    print('Done.')


if __name__ == '__main__':
    main()
