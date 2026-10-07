#!/usr/bin/env python3
"""Creates / updates the MCP tool products for the Customer Service and Business Insights APIs,
adds their tools to Enterprise Tools MCP (Engineering & IT), and attaches them to the persona apps.

Follows the existing MCP product convention: one product per tool set, environments dev + prod,
one payloadOperationGroup operation per tool with its own quota.

  python3 apigee/scripts/provision_business_products.py [--dry-run]
"""
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

ORG = CFG.require('APIGEE_ORG').APIGEE_ORG
API = f'https://apigee.googleapis.com/v1/organizations/{ORG}'
ROOT = pathlib.Path(__file__).resolve().parents[1]
DRY = '--dry-run' in sys.argv

# (tool, limit, interval, timeUnit)
CUSTOMER_TOOLS = [
    ('tools/list', 10, 1, 'minute'),
    ('tools/call/searchCustomers', 20, 1, 'minute'),
    ('tools/call/getCustomer', 20, 1, 'minute'),
    ('tools/call/listCustomerOrders', 20, 1, 'minute'),
    ('tools/call/getOrderStatus', 20, 1, 'minute'),
    ('tools/call/getProductPrice', 20, 1, 'minute'),
    ('tools/call/createSupportCase', 10, 1, 'minute'),
    ('tools/call/issueRefund', 5, 1, 'minute'),
]
INSIGHTS_TOOLS = [
    ('tools/list', 10, 1, 'minute'),
    ('tools/call/getRevenueTrends', 20, 1, 'minute'),
    ('tools/call/getSupportMetrics', 20, 1, 'minute'),
    ('tools/call/getChurnRisk', 20, 1, 'minute'),
    ('tools/call/getProductMargins', 20, 1, 'minute'),
    # Compute-heavy: deliberately tight so the per-tool 429 is easy to show.
    ('tools/call/runForecast', 2, 1, 'minute'),
]
PRODUCTS = {
    'Customer Service Tools MCP': (
        'customer_service_tools_mcp.json', CUSTOMER_TOOLS,
        'Customer Support & Sales: look up customers, orders and prices, log cases, refunds (gateway limit $50). No cost or margin data.'),
    'Business Insights Tools MCP': (
        'business_insights_tools_mcp.json', INSIGHTS_TOOLS,
        'Analysts & Knowledge Workers: aggregated revenue, support metrics, churn cohorts, margins and forecasts. No individual customer records.'),
}
APPS = [
    (CFG.PERSONA_APP_DEVELOPER, 'Unified Sales App', 'Customer Service Tools MCP'),
    (CFG.PERSONA_APP_DEVELOPER, 'Unified Loans App', 'Business Insights Tools MCP'),
]


def token():
    return subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token'], text=True).strip()


TOKEN = token()


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def op_config(op, limit, interval, unit):
    return {'apiSource': 'mcp', 'operations': [{'operation': op}],
            'quota': {'limit': str(limit), 'interval': str(interval), 'timeUnit': unit}}


def product_body(name, tools, description):
    return {
        'name': name, 'displayName': name, 'description': description, 'approvalType': 'auto',
        'attributes': [{'name': 'access', 'value': 'private'}], 'environments': ['dev', 'prod'],
        'payloadOperationGroup': {'operationConfigs': [op_config(*t) for t in tools]},
    }


def upsert_product(body):
    q = urllib.parse.quote(body['name'])
    status, _ = call('GET', f'/apiproducts/{q}')
    if DRY:
        print('  [dry-run]', 'update' if status == 200 else 'create', body['name'])
        return
    status, resp = call('PUT', f'/apiproducts/{q}', body) if status == 200 else call('POST', '/apiproducts', body)
    print('  product', body['name'], status if status >= 300 else 'ok')
    if status >= 300:
        sys.exit(resp)


def main():
    for name, (fname, tools, desc) in PRODUCTS.items():
        body = product_body(name, tools, desc)
        (ROOT / 'products' / fname).write_text(json.dumps(body, indent=2) + '\n')
        upsert_product(body)

    # Engineering & IT: add the new tools to Enterprise Tools MCP (keep everything it already has).
    status, ent = call('GET', '/apiproducts/' + urllib.parse.quote('Enterprise Tools MCP'))
    assert status == 200, ent
    existing = {c['operations'][0]['operation'] for c in ent['payloadOperationGroup']['operationConfigs']}
    added = [op_config(*t) for t in CUSTOMER_TOOLS + INSIGHTS_TOOLS if t[0] not in existing]
    if added:
        ent['payloadOperationGroup']['operationConfigs'] += added
        for k in ('createdAt', 'lastModifiedAt'):
            ent.pop(k, None)
        if DRY:
            print(f'  [dry-run] Enterprise Tools MCP += {len(added)} tools')
        else:
            status, resp = call('PUT', '/apiproducts/' + urllib.parse.quote('Enterprise Tools MCP'), ent)
            print('  Enterprise Tools MCP +', len(added), 'tools', status if status >= 300 else 'ok')
            if status >= 300:
                sys.exit(resp)
    (ROOT / 'products' / 'enterprise_tools_mcp.json').write_text(json.dumps(ent, indent=2) + '\n')

    # Persona apps: add the product to every credential that does not have it yet.
    for dev, app, product in APPS:
        status, a = call('GET', f'/developers/{dev}/apps/{urllib.parse.quote(app)}')
        assert status == 200, a
        for cred in a.get('credentials', []):
            have = [p['apiproduct'] for p in cred.get('apiProducts', [])]
            if product in have:
                print('  app', app, 'already has', product)
                continue
            if DRY:
                print('  [dry-run] app', app, '+', product)
                continue
            status, resp = call('POST', f"/developers/{dev}/apps/{urllib.parse.quote(app)}/keys/{cred['consumerKey']}",
                                {'apiProducts': [product]})
            print('  app', app, '+', product, status if status >= 300 else 'ok')


if __name__ == '__main__':
    main()
