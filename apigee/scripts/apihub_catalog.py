#!/usr/bin/env python3
"""Curates the Apigee API hub catalog: business units, teams and per-API metadata.

The Apigee X/Hybrid plugin syncs proxies into API hub with only a name (and sometimes an API
style). This script fills in the rest so the hub can be filtered by BU, team, style
(REST / MCP), service type (Model / Code / Agent) and maturity:

  1. Adds the business units and teams below as allowed values of the system attributes
     `system-business-unit` and `system-team` (each team description names its BU).
  2. For every API in CATALOG, sets businessUnit, team, owner, apiStyle, serviceType,
     maturityLevel, targetUser and description.
  3. Sets the lifecycle on each version that has none (level-3 -> prod, level-2 -> preview,
     level-1 -> develop).
  4. Removes the example Business Unit / Team values that ship with API hub, unless an API
     still uses them. Owners are mocked as <team-id>@example.com.

Fields that already hold curated data are left alone: descriptions, owners and lifecycles are
only written when empty, and the Cymbal Auto sample APIs (Claims, Members, Rewards, Roadside)
only get a new BU and team. Re-running is safe; --dry-run prints the planned patches.

Industry packs are picked up automatically: every industries/<id>.json adds its <id>-mcp proxy
to the catalog (description built from the pack). Its BU and team come from, in order:
  - the pack's optional "apihub" block: {"businessUnit": "<bu id>", "team": "<team id>",
    "teamName": "<display name, only needed for a new team>"}
  - INDUSTRY_TEAMS below (the original 15 packs)
  - otherwise a new team "<id>" named after the pack label, in DEFAULT_INDUSTRY_BU (warned).
provision_industry_pack.py runs this script with --only <id>-mcp as its last step.

A new proxy only appears in API hub after the Apigee X/Hybrid plugin's scheduled sync-metadata
run (every 6 hours; the system plugin rejects manual runs). If the API is not there yet,
--only exits 1 and prints the next sync time; re-run then, or pass --wait to poll.

Usage: python3 apigee/scripts/apihub_catalog.py [--only <api name> ...] [--wait SECONDS] [--dry-run]
                                                [--project <project>] [--location <region>]
  --only   restrict the API updates to these API display names (attributes are still ensured)
  --wait   with --only, poll up to SECONDS for the APIs to be synced into the hub
Auth: Application Default Credentials (gcloud auth application-default login).
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'lib'))
from deploy_config import CFG  # noqa: E402  (repo-root .env, see .env.example)

REPO = pathlib.Path(__file__).resolve().parents[2]
OWNER_DOMAIN = 'example.com'
# The system plugin instance that syncs Apigee proxies into API hub.
APIGEE_PLUGIN, APIGEE_PLUGIN_INSTANCE = 'system-apigee-x-and-hybrid', 'system-default-instance'

BUSINESS_UNITS = {
    'ai-platform': ('AI Platform', 'AI Gateway, model proxies, agent runtimes and the MCP tools gateway.'),
    'financial-services': ('Financial Services', 'Banking, lending, insurance and loyalty.'),
    'health-public-services': ('Health & Public Services', 'Healthcare, education and public sector.'),
    'energy-industrial': ('Energy & Industrial', 'Energy, oil and gas, manufacturing, supply chain and agriculture.'),
    'consumer-digital': ('Consumer & Digital', 'Retail, travel, aviation, media, telecom, real estate and customer experience.'),
    'enterprise-technology': ('Enterprise Technology', 'IT service management, data and analytics, workforce systems.'),
    'platform-engineering': ('Platform Engineering', 'API platform samples, test proxies, identity and security.'),
}

# team id -> (display name, business unit id)
TEAMS = {
    'ai-gateway': ('AI Gateway', 'ai-platform'),
    'agent-engineering': ('Agent Engineering', 'ai-platform'),
    'tools-gateway': ('MCP Tools Gateway', 'ai-platform'),
    'banking-lending': ('Banking & Lending', 'financial-services'),
    'insurance-claims': ('Insurance & Claims', 'financial-services'),
    'loyalty-rewards': ('Loyalty & Rewards', 'financial-services'),
    'healthcare': ('Healthcare Services', 'health-public-services'),
    'education': ('Education Services', 'health-public-services'),
    'citizen-services': ('Citizen Services', 'health-public-services'),
    'energy-utilities': ('Energy & Utilities', 'energy-industrial'),
    'manufacturing-supply-chain': ('Manufacturing & Supply Chain', 'energy-industrial'),
    'agritech': ('AgriTech', 'energy-industrial'),
    'retail-commerce': ('Retail & Commerce', 'consumer-digital'),
    'travel-hospitality': ('Travel & Hospitality', 'consumer-digital'),
    'media-telecom': ('Media & Telecom', 'consumer-digital'),
    'real-estate': ('Real Estate & Property', 'consumer-digital'),
    'customer-experience': ('Customer Experience', 'consumer-digital'),
    'it-service-management': ('IT Service Management', 'enterprise-technology'),
    'data-analytics': ('Data & Analytics', 'enterprise-technology'),
    'workforce-systems': ('Workforce Systems', 'enterprise-technology'),
    'api-platform': ('API Platform & Samples', 'platform-engineering'),
    'identity-security': ('Identity & Security', 'platform-engineering'),
}

# Team for the original industry packs (proxy <id>-mcp). New packs should set "apihub" in their
# JSON instead (see the module docstring); this map is only the fallback.
INDUSTRY_TEAMS = {
    'aviation': 'travel-hospitality', 'banking': 'banking-lending', 'education': 'education',
    'energy': 'energy-utilities', 'healthcare': 'healthcare', 'insurance': 'insurance-claims',
    'it': 'it-service-management', 'manufacturing': 'manufacturing-supply-chain',
    'media': 'media-telecom', 'oil-gas': 'energy-utilities', 'public-sector': 'citizen-services',
    'real-estate': 'real-estate', 'retail': 'retail-commerce', 'telecom': 'media-telecom',
    'travel': 'travel-hospitality',
}
DEFAULT_INDUSTRY_BU = 'consumer-digital'

LEGACY = 'Legacy sample/test proxy synced from Apigee org sg-demo25.'

# API display name -> metadata. style: rest|mcp-api|websocket|graphql,
# service: code|model|agent, level: 1-3, users: subset of team|internal|partner|public.
CATALOG = {
    # --- Model proxies (AI Gateway) ---
    'ai-gateway-v1': dict(team='ai-gateway', style='rest', service='model', level=3, users=['internal', 'partner'],
                          desc='Model-agnostic AI Gateway: multi-provider auto-routing, Model Armor, token identity, cost controls, semantic cache and LLM token quotas. Base path /ai/v1.'),
    'llm-passthrough-v1': dict(team='ai-gateway', style='rest', service='model', level=3, users=['internal'],
                               desc='Minimal pass-through to Vertex AI Gemini (API key check and analytics only). Ungoverned baseline for the Agent Showcase. Base path /passthrough/v1.'),
    'llm-developer-routing-v1': dict(team='ai-gateway', style='rest', service='model', level=2, users=['internal'],
                                     desc='Routes LLM requests to Vertex AI models based on developer custom attributes. Base path /llm-developer-routing/v1.'),
    'vertex-ai-v1': dict(team='ai-gateway', style='rest', service='model', level=2, users=['internal'],
                         desc='Model proxy for Vertex AI generative models. Base path /vertexai/v1.'),
    'anthropic-llm': dict(team='ai-gateway', style='rest', service='model', level=2, users=['internal'],
                          desc='Model proxy for Anthropic Claude models. Base path /anthropic/llm.'),
    'gemini-live': dict(team='ai-gateway', style='websocket', service='model', level=2, users=['internal'],
                        desc='Model proxy for the Gemini Live bidirectional streaming (WebSocket) API. Base path /gemini-live.'),
    'apigee-claude-cli': dict(team='ai-gateway', style='rest', service='model', level=2, users=['internal'],
                              desc='Model proxy that lets Claude Code / CLI clients reach Claude models through Apigee. Base path /apigee-claude-cli.'),
    'adk-vertex-ai-v1': dict(team='agent-engineering', style='rest', service='model', level=2, users=['internal'],
                             desc='Vertex AI model proxy used by ADK agents (v1). Base path /adk/vertexai/v1.'),
    'adk-vertex-ai-v2': dict(team='agent-engineering', style='rest', service='model', level=2, users=['internal'],
                             desc='Vertex AI model proxy used by ADK agents (v2). Base path /adk/vertexai/v2.'),
    # --- MCP servers ---
    'mcp': dict(team='tools-gateway', style='mcp-api', service='code', level=3, users=['internal', 'partner'],
                desc='Apigee native MCP server exposing enterprise APIs (customer service, business insights) as governed tools. Base path /mcp.'),
    'mcp-dev': dict(team='tools-gateway', style='mcp-api', service='code', level=1, users=['team'],
                    desc='Development copy of the Apigee native MCP server. Base path /mcp.'),
    'bigquery-mcp': dict(team='data-analytics', style='mcp-api', service='code', level=3, users=['internal'],
                         desc='Apigee MCP gateway for the Google Cloud BigQuery MCP server. Base path /bigquery/mcp.'),
    'servicenow-mcp': dict(team='it-service-management', style='mcp-api', service='code', level=3, users=['internal'],
                           desc='Apigee native MCP server for the ServiceNow Incident Management API. Base path /servicenow/mcp.'),
    # --- REST business APIs ---
    'customer-service-v1': dict(team='customer-experience', style='rest', service='code', level=3, users=['internal'],
                                desc='Customer Service API (customers, orders, pricing, cases, refunds) on Cloud Run. Refunds over the configured limit are refused at the gateway. Base path /customer-service/v1.'),
    'business-insights-v1': dict(team='data-analytics', style='rest', service='code', level=3, users=['internal'],
                                 desc='Business Insights API (aggregated revenue, support metrics, churn cohorts, margins, forecasts) on Cloud Run. Base path /business-insights/v1.'),
    'customers-v1': dict(team='customer-experience', style='rest', service='code', level=2, users=['internal'],
                         desc='API for managing and accessing customer transcripts. Base path /customers/v1.'),
    'employees-v1': dict(team='workforce-systems', style='rest', service='code', level=2, users=['internal'],
                         desc='API for managing employee data. Base path /employeeservice/v1.'),
    'loans-application-v1': dict(team='banking-lending', style='rest', service='code', level=2, users=['internal', 'partner'],
                                 desc='API for submitting new loan applications. Base path /loans-application/v1.'),
    'shipments-v1': dict(team='manufacturing-supply-chain', style='rest', service='code', level=2, users=['internal', 'partner'],
                         desc='Shipments API for tracking supply-chain shipments. Base path /shipments/v1.'),
    'Discounted-Price-Lookup-API-v1': dict(team='manufacturing-supply-chain', style='rest', service='code', level=2, users=['partner'],
                                           desc='API for looking up discounted prices for parts based on SKU. Base path /v1/discounted-price-lookup-api.'),
    'smart-irrigation-v1': dict(team='agritech', style='rest', service='code', level=2, users=['partner'],
                                desc='Cropin APIs for Smart Irrigation. Base path /smartirrigation/v1.'),
    'yield-forecast-v1': dict(team='agritech', style='rest', service='code', level=2, users=['partner'],
                              desc='Cropin APIs for Yield Forecast. Base path /yieldforecast/v1.'),
    'adk-auto-insurance-v1': dict(team='insurance-claims', style='rest', service='code', level=2, users=['internal'],
                                  desc='Cymbal Auto insurance APIs (claims, members, rewards, roadside assistance) used as tools by ADK agents. Base path /v1/samples/adk-cymbal-auto.'),
    # Curated Cymbal Auto samples: only BU and team are replaced (they held the example values).
    'Claims API': dict(team='insurance-claims', only_org=True),
    'Roadside Assistance API': dict(team='insurance-claims', only_org=True),
    'Members API': dict(team='loyalty-rewards', only_org=True),
    'Rewards API': dict(team='loyalty-rewards', only_org=True),
    # --- Platform engineering: samples, tests, identity ---
    'oauth-v1': dict(team='identity-security', style='rest', service='code', level=2, users=['internal', 'partner'],
                     desc='OAuth 2.0 token endpoints for API clients. Base path /oauth/v1.'),
    'oauth': dict(team='identity-security', style='rest', service='code', level=1, users=['team'], desc='OAuth sample proxy. ' + LEGACY),
    'websocket-v1': dict(team='api-platform', style='websocket', service='code', level=1, users=['team'],
                         desc='WebSocket pass-through sample proxy. Base path /websocket/v1.'),
    'middleware': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Middleware sample proxy. Base path /middleware.'),
    'success': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Health-check sample proxy that always succeeds. Base path /success.'),
    'default': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Default catch-all proxy on base path /.'),
    'graphQLTest': dict(team='api-platform', style='graphql', service='code', level=1, users=['team'], desc='GraphQL test proxy. ' + LEGACY),
    'getstarted': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Getting-started sample proxy. ' + LEGACY),
    'helloworld': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Hello World sample proxy. ' + LEGACY),
    'no-target': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='No-target sample proxy. ' + LEGACY),
    'target-server': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='Target server sample proxy. ' + LEGACY),
    'testproxywithssloff': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='TLS-disabled test proxy. ' + LEGACY),
    'utf-test': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='UTF-8 encoding test proxy. ' + LEGACY),
    'utf8': dict(team='api-platform', style='rest', service='code', level=1, users=['team'], desc='UTF-8 encoding test proxy. ' + LEGACY),
    'RTRAppPhase3Prod_rev9_2021_01_19': dict(team='api-platform', style='rest', service='code', level=1, users=['team'],
                                             desc='Archived 2021 RTR app proxy revision. ' + LEGACY),
}


def industry_team(pack):
    """Resolves (and if needed registers in TEAMS) the team id for an industry pack."""
    ind, hub = pack['id'], pack.get('apihub') or {}
    team = hub.get('team') or INDUSTRY_TEAMS.get(ind) or ind
    if team not in TEAMS:
        bu = hub.get('businessUnit') or DEFAULT_INDUSTRY_BU
        if bu not in BUSINESS_UNITS:
            sys.exit(f'industries/{ind}.json: apihub.businessUnit "{bu}" is not one of {sorted(BUSINESS_UNITS)}')
        if not hub.get('businessUnit'):
            print(f'WARNING: industries/{ind}.json has no apihub.businessUnit; '
                  f'new team "{team}" goes in {BUSINESS_UNITS[bu][0]}')
        TEAMS[team] = (hub.get('teamName') or pack['label'], bu)
    return team


def industry_entries():
    """One CATALOG entry per industry pack (industries/*.json), keyed by its <id>-mcp proxy."""
    out = {}
    for path in sorted((REPO / 'industries').glob('*.json')):
        pack = json.loads(path.read_text())
        if not pack.get('proxy'):
            continue
        p = pack.get('personas', {})
        ops, ins = p.get('ops', {}).get('label', 'Ops'), p.get('insights', {}).get('label', 'Analysts')
        n = len(pack.get('tools', []))
        out[pack['proxy']] = dict(
            team=industry_team(pack), style='mcp-api', service='code', level=3, users=['internal', 'partner'],
            desc=(f"{pack['label']} MCP server (industry pack): {n} governed tools for the {ops} and {ins} "
                  f"personas, with per-tool quotas and business-rule limits enforced by Apigee. "
                  f"Base path {pack['basePath']}; backend Cloud Run industry-apis."))
    return out


STYLE_NAMES = {'rest': 'REST', 'mcp-api': 'MCP', 'websocket': 'WebSocket', 'graphql': 'GraphQL'}
USER_NAMES = {'team': 'Team', 'internal': 'Internal', 'partner': 'Partner', 'public': 'Public'}
LIFECYCLE = {3: ('prod', 'Production'), 2: ('preview', 'Preview'), 1: ('develop', 'Develop')}


class Hub:
    def __init__(self, project, location, dry_run):
        self.project, self.dry = project, dry_run
        self.base = f'https://apihub.googleapis.com/v1/projects/{project}/locations/{location}'
        self.token = subprocess.check_output(
            ['gcloud', 'auth', 'application-default', 'print-access-token'], text=True).strip()

    def attr(self, aid):
        return f'{self.base.split("v1/", 1)[1]}/attributes/{aid}'

    def call(self, method, path, body=None):
        url = path if path.startswith('http') else f'{self.base}/{path}'
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self.token}', 'x-goog-user-project': self.project,
            'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'{method} {url}: {e.code} {e.read().decode()[:500]}') from None

    def patch(self, name, body, mask):
        if self.dry:
            print(f'  [dry-run] PATCH {name.rsplit("/", 2)[-1]} {",".join(mask)}')
            return
        self.call('PATCH', f'https://apihub.googleapis.com/v1/{name}?updateMask={",".join(mask)}', body)

    def list_all(self, path, key):
        items, token = [], ''
        while True:
            sep = '&' if '?' in path else '?'
            d = self.call('GET', f'{path}{sep}pageSize=100' + (f'&pageToken={token}' if token else ''))
            items += d.get(key, [])
            token = d.get('nextPageToken')
            if not token:
                return items


def enum_value(hub, attr_id, vid, name, desc=None):
    v = {'id': vid, 'displayName': name}
    if desc:
        v['description'] = desc
    return {'attribute': hub.attr(attr_id), 'enumValues': {'values': [v]}}


def ensure_allowed_values(hub, attr_id, wanted):
    """Adds missing allowed values (id -> (name, description)); existing ones are kept."""
    a = hub.call('GET', f'attributes/{attr_id}')
    have = {v['id'] for v in a.get('allowedValues', [])}
    new = [{'id': i, 'displayName': n, 'description': d} for i, (n, d) in wanted.items() if i not in have]
    print(f'{attr_id}: {len(have)} existing, adding {len(new)}')
    if new:
        hub.patch(a['name'], {'allowedValues': a.get('allowedValues', []) + new}, ['allowedValues'])


def remove_allowed_values(hub, attr_id, field, ids):
    """Drops allowed values `ids` from an attribute, keeping any still used by an API's `field`."""
    used = {v['id'] for api in hub.list_all('apis', 'apis')
            for v in (api.get(field) or {}).get('enumValues', {}).get('values', [])}
    a = hub.call('GET', f'attributes/{attr_id}')
    values = a.get('allowedValues', [])
    drop = {v['id'] for v in values if v['id'] in ids and v['id'] not in used}
    kept = sorted(set(ids) & used)
    print(f'{attr_id}: removing {sorted(drop) or "nothing"}' + (f' (still in use, kept: {kept})' if kept else ''))
    if drop:
        hub.patch(a['name'], {'allowedValues': [v for v in values if v['id'] not in drop]}, ['allowedValues'])


def next_plugin_sync(hub):
    """Next run of the Apigee plugin's sync-metadata action (it cannot be triggered manually)."""
    inst = hub.call('GET', f'plugins/{APIGEE_PLUGIN}/instances/{APIGEE_PLUGIN_INSTANCE}')
    act = next((a for a in inst.get('actions', []) if a.get('actionId') == 'sync-metadata'), {})
    cron = act.get('scheduleCronExpression', '')  # e.g. "10 14,20,2,8 * * *" (UTC)
    try:
        minute, hours = int(cron.split()[0]), sorted(int(h) for h in cron.split()[1].split(','))
    except (IndexError, ValueError):
        return f'unknown schedule "{cron}"'
    now = time.gmtime()
    for day in (0, 1):
        for h in hours:
            if day or (h, minute) > (now.tm_hour, now.tm_min):
                return f'{h:02d}:{minute:02d} UTC{" tomorrow" if day else ""} (schedule "{cron}" {act.get("scheduleTimeZone", "UTC")})'


def wait_for(hub, wanted, timeout):
    """Polls until every `wanted` API display name is in the hub, or `timeout` seconds pass."""
    deadline = time.time() + timeout
    while True:
        missing = sorted(set(wanted) - {a['displayName'] for a in hub.list_all('apis', 'apis')})
        if not missing or time.time() > deadline:
            return missing
        print(f'  waiting for API hub to sync: {", ".join(missing)}')
        time.sleep(60)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--project', default=CFG.GCP_PROJECT_ID)
    ap.add_argument('--location', default=CFG.GCP_REGION)
    ap.add_argument('--only', nargs='+', metavar='API', help='API display names to update (default: all)')
    ap.add_argument('--wait', type=int, default=0, metavar='SECONDS',
                    help='with --only, poll this long for the APIs to be synced from Apigee')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    hub = Hub(args.project, args.location, args.dry_run)
    catalog = {**CATALOG, **industry_entries()}
    for name in args.only or []:
        if name not in catalog:
            sys.exit(f'{name} is not in CATALOG or industries/*.json')

    if args.only and args.wait:
        wait_for(hub, args.only, args.wait)

    ensure_allowed_values(hub, 'system-business-unit', BUSINESS_UNITS)
    ensure_allowed_values(hub, 'system-team', {
        t: (n, f'{n} team, {BUSINESS_UNITS[bu][0]} business unit.') for t, (n, bu) in TEAMS.items()})

    apis = hub.list_all('apis', 'apis')
    if args.only:
        missing = sorted(set(args.only) - {a['displayName'] for a in apis})
        apis = [a for a in apis if a['displayName'] in args.only]
    unmapped = sorted(a['displayName'] for a in apis if a['displayName'] not in catalog)
    for api in sorted(apis, key=lambda a: a['displayName'].lower()):
        meta = catalog.get(api['displayName'])
        if not meta:
            continue
        tname, bu = TEAMS[meta['team']]
        body = {
            'businessUnit': enum_value(hub, 'system-business-unit', bu, BUSINESS_UNITS[bu][0], BUSINESS_UNITS[bu][1]),
            'team': enum_value(hub, 'system-team', meta['team'], tname),
        }
        if not meta.get('only_org'):
            lvl = meta['level']
            body['maturityLevel'] = enum_value(hub, 'system-maturity-level', f'level-{lvl}', f'Level {lvl}')
            body['apiStyle'] = enum_value(hub, 'system-api-style', meta['style'], STYLE_NAMES[meta['style']])
            body['targetUser'] = {'attribute': hub.attr('system-target-user'), 'enumValues': {'values': [
                {'id': u, 'displayName': USER_NAMES[u]} for u in meta['users']]}}
            body['serviceType'] = enum_value(hub, 'system-service-type', meta['service'], meta['service'].title())
            if not api.get('description'):
                body['description'] = meta['desc']
            if not api.get('owner', {}).get('email'):
                body['owner'] = {'displayName': f'{tname} Team', 'email': f'{meta["team"]}@{OWNER_DOMAIN}'}
        print(f'{api["displayName"]}: {BUSINESS_UNITS[bu][0]} / {tname}')
        hub.patch(api['name'], body, list(body))

        if meta.get('only_org'):
            continue
        lid, lname = LIFECYCLE[meta['level']]
        for vname in api.get('versions', []):
            v = hub.call('GET', f'https://apihub.googleapis.com/v1/{vname}')
            if not v.get('lifecycle'):
                hub.patch(vname, {'lifecycle': enum_value(hub, 'system-lifecycle', lid, lname)}, ['lifecycle'])

    if args.only:
        if missing:
            print(f'\nNot in API hub yet: {", ".join(missing)}. API hub pulls new Apigee proxies on a schedule '
                  f'(next sync: {next_plugin_sync(hub)}); re-run this command after that.')
            return 1
        return 0

    # The out-of-the-box sample values; no API should reference them once the catalog is applied.
    remove_allowed_values(hub, 'system-business-unit', 'businessUnit', ['example-business-unit'])
    remove_allowed_values(hub, 'system-team', 'team', ['example-team'])

    if unmapped:
        print(f'\nNot in CATALOG (left unchanged): {", ".join(unmapped)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
