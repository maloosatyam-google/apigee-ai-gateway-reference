#!/usr/bin/env python3
"""Generates the Apigee MCP proxy bundle and API products for an industry pack.

Reads industries/<id>.json (the single source of truth) and writes:
  apigee/proxies/<id>-mcp/apiproxy/...       MCP proxy at /<id>/mcp -> Cloud Run industry-apis
  apigee/products/<id>_tools_mcp_admin.json   every tool, generous quotas, no business-rule limit
  apigee/products/<id>_tools_mcp_ops.json     Support & Sales tools (customer-facing persona)
  apigee/products/<id>_tools_mcp_insights.json Analysts tools

The proxy follows the servicenow-mcp / bigquery-mcp pattern (ParsePayload for MCP, method
allowlist, VerifyAPIKey + per-tool product quotas for tools/*, Cloud Logging) and adds the
pack's business rule with ExtractVariables + Condition + RaiseFault (no JavaScript).
Apigee conditions compare a variable with a literal, so the threshold is written into the
condition here; changing a limit means regenerating and redeploying the proxy.

  python3 apigee/scripts/gen_industry_mcp.py banking [--target-url https://...]
  python3 apigee/scripts/gen_industry_mcp.py --all
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
from xml.sax.saxutils import escape

REPO = pathlib.Path(__file__).resolve().parents[2]
PACKS = REPO / 'industries'
PROXIES = REPO / 'apigee' / 'proxies'
PRODUCTS = REPO / 'apigee' / 'products'
# Placeholder for the industry-apis Cloud Run URL, rendered from .env at package time
# (apigee/scripts/render_tokens.py). Pass --target-url to bake in a literal URL instead.
DEFAULT_TARGET = '__INDUSTRY_APIS_URL__'

# Quotas: tools/list is shared by UI discovery and agents; the admin product is the
# ungoverned side of the Agent Showcase, so it gets generous quotas (except the forecast).
LIST_QUOTA = 30
ADMIN_QUOTA = 100

TEMPLATE = PROXIES / 'servicenow-mcp' / 'apiproxy' / 'policies'
TEMPLATE_POLICIES = ('CORS-Allow.xml', 'PP-MCP.xml', 'RF-MethodNotAllowed.xml', 'VA-VerifyAPIKey.xml',
                     'Q-Limit.xml', 'AM-RemoveAuthorization.xml', 'ML-CloudLogging.xml')
XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
MCP_METHODS = ('tools/list', 'tools/call')


def is_tools(var='parsepayload.PP-MCP.json-rpc.request.method'):
    return f'{var} = "tools/list"\n          or {var} = "tools/call"'


def attr(s):
    return escape(str(s), {'"': '&quot;'})


def policies(pack):
    lim = pack['limit']
    ops_product = pack['personas']['ops']['product']
    fault_body = {
        'status': 403, 'error': lim['code'],
        'message': f"{lim['message']} Requested ${{amount}}.",
        'limit': lim['max'], 'requested': '__AMOUNT__', 'enforcedBy': 'Apigee',
    }
    # RaiseFault payload: HTTP 403 with a JSON-RPC result flagged isError, the same shape the
    # existing refund limit (REST proxy -> MCP) returns, so MCP clients (ADK, the UI) hand the
    # message to the model and traces show the stop. The error JSON is a string inside the
    # text content, so its quotes are escaped once more.
    inner = json.dumps(fault_body).replace('"__AMOUNT__"', '@mcp.amountText#').replace('${amount}', '$@mcp.amountText#')
    inner_escaped = inner.replace('\\', '\\\\').replace('"', '\\"')

    def rf_limit(name, id_json):
        payload = ('{"jsonrpc":"2.0","id":' + id_json + ',"result":{"isError":true,"content":[{"type":"text","text":"'
                   + inner_escaped + '"}]}}')
        return XML_HEAD + f'''<!--
  {lim['code']}: {attr(lim['message'])} Generated from industries/{pack['id']}.json by
  apigee/scripts/gen_industry_mcp.py. Returned as HTTP 403 with a JSON-RPC tool error so the
  agent sees the reason; the x-gateway-limit header marks it for traces and tests (Apigee strips
  x-apigee-* response headers).
-->
<RaiseFault async="false" continueOnError="false" enabled="true" name="{name}">
  <DisplayName>{name}</DisplayName>
  <FaultResponse>
    <Set>
      <Headers>
        <Header name="x-gateway-limit">{lim['code']}</Header>
      </Headers>
      <StatusCode>403</StatusCode>
      <ReasonPhrase>Forbidden</ReasonPhrase>
      <Payload contentType="application/json" variablePrefix="@" variableSuffix="#">{escape(payload)}</Payload>
    </Set>
  </FaultResponse>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</RaiseFault>
'''

    # Shared MCP policies are copied from the servicenow-mcp template unchanged, so every
    # repo-managed MCP proxy behaves the same; only the limit policies are generated.
    shared = {f: (TEMPLATE / f).read_text() for f in TEMPLATE_POLICIES}
    return {
        **shared,
        'EV-ToolCall.xml': XML_HEAD + f'''<!-- Reads the tool name, the limit argument and the JSON-RPC id for the business-rule check. -->
<ExtractVariables async="false" continueOnError="false" enabled="true" name="EV-ToolCall">
  <DisplayName>EV-ToolCall</DisplayName>
  <Source clearPayload="false">request</Source>
  <VariablePrefix>mcp</VariablePrefix>
  <JSONPayload>
    <Variable name="tool">
      <JSONPath>$.params.name</JSONPath>
    </Variable>
    <Variable name="amount" type="double">
      <JSONPath>$.params.arguments.{lim['argument']}</JSONPath>
    </Variable>
    <Variable name="amountText">
      <JSONPath>$.params.arguments.{lim['argument']}</JSONPath>
    </Variable>
    <Variable name="rpcId">
      <JSONPath>$.id</JSONPath>
    </Variable>
  </JSONPayload>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</ExtractVariables>
''',
        # The id again, typed: set for a numeric id (and a digits-only string id), unset otherwise.
        # continueOnError because a non-numeric string id cannot be cast.
        'EV-RpcIdNumber.xml': XML_HEAD + '''<!-- The JSON-RPC id as a number, to echo it with its type (see limit_condition). -->
<ExtractVariables async="false" continueOnError="true" enabled="true" name="EV-RpcIdNumber">
  <DisplayName>EV-RpcIdNumber</DisplayName>
  <Source clearPayload="false">request</Source>
  <VariablePrefix>mcpn</VariablePrefix>
  <JSONPayload>
    <Variable name="id" type="long">
      <JSONPath>$.id</JSONPath>
    </Variable>
  </JSONPayload>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</ExtractVariables>
''',
        'RF-LimitNumericId.xml': rf_limit('RF-LimitNumericId', '@mcp.rpcId#'),
        'RF-LimitStringId.xml': rf_limit('RF-LimitStringId', '"@mcp.rpcId#"'),
    }, ops_product


def limit_condition(pack, ops_product, id_regex_ok):
    lim = pack['limit']
    prod = attr(ops_product)
    # Measured on Apigee X: JavaRegex is false for an id extracted from a JSON number (even 902)
    # and true for a JSON string of digits, and mcpn.id is set for both. So a numeric id is
    # "mcpn.id set and the regex false"; everything else is echoed as a string.
    numeric = 'mcpn.id != null and not (mcp.rpcId JavaRegex "^-?[0-9]+$")'
    id_cond = f'({numeric})' if id_regex_ok else f'not ({numeric})'
    return (f'parsepayload.PP-MCP.json-rpc.request.method = "tools/call" and mcp.tool = "{lim["tool"]}"\n'
            f'          and mcp.amount GreaterThan {lim["max"]}\n'
            f'          and (apiproduct.name = "{prod}" or verifyapikey.VA-VerifyAPIKey.apiproduct.name = "{prod}")\n'
            f'          and {id_cond}')


def step(name, cond=None):
    c = f'\n        <Condition>{cond}</Condition>' if cond else ''
    return f'''      <Step>
        <Name>{name}</Name>{c}
      </Step>'''


def proxy_endpoint(pack, ops_product):
    m = 'parsepayload.PP-MCP.json-rpc.request.method'
    allow = (f'request.verb != "OPTIONS" and not ({m} = "tools/list"\n          or {m} = "tools/call"\n'
             f'          or {m} = "initialize"\n          or {m} = "ping"\n          or {m} StartsWith "notifications/")')
    call = f'{m} = "tools/call"'
    steps = [
        step('CORS-Allow'),
        step('PP-MCP', 'request.verb != "OPTIONS"'),
        step('RF-MethodNotAllowed', allow),
        step('VA-VerifyAPIKey', is_tools()),
        step('Q-Limit', is_tools()),
        step('EV-ToolCall', call),
        step('EV-RpcIdNumber', call),
        step('RF-LimitNumericId', limit_condition(pack, ops_product, True)),
        step('RF-LimitStringId', limit_condition(pack, ops_product, False)),
        step('AM-RemoveAuthorization', is_tools()),
    ]
    return XML_HEAD + f'''<!-- Generated from industries/{pack['id']}.json by apigee/scripts/gen_industry_mcp.py. Do not edit by hand. -->
<ProxyEndpoint name="default">
  <HTTPProxyConnection>
    <BasePath>{pack['basePath']}</BasePath>
  </HTTPProxyConnection>
  <PreFlow name="PreFlow">
    <Request>
{chr(10).join(steps)}
    </Request>
    <Response/>
  </PreFlow>
  <PostClientFlow>
    <Response>
      <Step>
        <Name>ML-CloudLogging</Name>
      </Step>
    </Response>
  </PostClientFlow>
  <RouteRule name="default">
    <TargetEndpoint>default</TargetEndpoint>
  </RouteRule>
</ProxyEndpoint>
'''


def target_endpoint(pack, target):
    return XML_HEAD + f'''<TargetEndpoint name="default">
  <HTTPTargetConnection>
    <URL>{target}/{pack['id']}/mcp</URL>
    <Authentication>
      <GoogleIDToken>
        <Audience>{target}</Audience>
      </GoogleIDToken>
    </Authentication>
  </HTTPTargetConnection>
</TargetEndpoint>
'''


def manifest(pack, policy_names):
    pols = '\n'.join(f'    <Policy>{p}</Policy>' for p in policy_names)
    return XML_HEAD + f'''<APIProxy revision="1" name="{pack['proxy']}">
  <DisplayName>{pack['proxy']}</DisplayName>
  <Description>{attr(pack['label'])} demo tools over MCP (industry pack). Backend: Cloud Run industry-apis {pack['basePath']}.</Description>
  <BasePaths>{pack['basePath']}</BasePaths>
  <Policies>
{pols}
  </Policies>
  <ProxyEndpoints>
    <ProxyEndpoint>default</ProxyEndpoint>
  </ProxyEndpoints>
  <TargetEndpoints>
    <TargetEndpoint>default</TargetEndpoint>
  </TargetEndpoints>
</APIProxy>
'''


def op(proxy, operation, limit):
    return {'apiSource': proxy, 'operations': [{'operation': operation}],
            'quota': {'limit': str(limit), 'interval': '1', 'timeUnit': 'minute'}}


def product(pack, key):
    p = pack['personas'][key]
    tools = pack['tools'] if key == 'admin' else [t for t in pack['tools'] if t['persona'] == key]
    ops = [op(pack['proxy'], 'tools/list', LIST_QUOTA)]
    # The forecast keeps its tight quota on every product, so the 429 shows for admins too.
    ops += [op(pack['proxy'], f"tools/call/{t['name']}",
               ADMIN_QUOTA if key == 'admin' and t['slot'] != 'forecast' else t['quotaPerMin']) for t in tools]
    return {
        'name': p['product'], 'displayName': p['productDisplayName'], 'description': p['description'],
        'approvalType': 'auto',
        'attributes': [{'name': 'access', 'value': 'private'}, {'name': 'industry', 'value': pack['id']},
                       {'name': 'persona', 'value': p['role']}],
        'environments': ['dev', 'prod'],
        'payloadOperationGroup': {'operationConfigs': ops},
    }


def generate(pack_id, target=DEFAULT_TARGET):
    pack = json.loads((PACKS / f'{pack_id}.json').read_text())
    check = subprocess.run(
        ['node', '-e', 'const e=require(process.argv[1]).validatePack(require(process.argv[2]));'
                       'if(e.length){console.error(e.join("\\n"));process.exit(1)}',
         str(PACKS / 'validate.js'), str(PACKS / f'{pack_id}.json')],
        capture_output=True, text=True)
    if check.returncode:
        sys.exit(f'{pack_id}: invalid pack:\n{check.stderr}')

    out = PROXIES / pack['proxy'] / 'apiproxy'
    if out.exists():
        shutil.rmtree(out)
    (out / 'policies').mkdir(parents=True)
    (out / 'proxies').mkdir()
    (out / 'targets').mkdir()
    pols, ops_product = policies(pack)
    for name, xml in pols.items():
        (out / 'policies' / name).write_text(xml)
    (out / 'proxies' / 'default.xml').write_text(proxy_endpoint(pack, ops_product))
    (out / 'targets' / 'default.xml').write_text(target_endpoint(pack, target))
    (out / f"{pack['proxy']}.xml").write_text(manifest(pack, [n[:-4] for n in sorted(pols)]))

    written = []
    for key in ('admin', 'ops', 'insights'):
        f = PRODUCTS / f"{pack['id']}_tools_mcp_{key}.json"
        f.write_text(json.dumps(product(pack, key), indent=2) + '\n')
        written.append(f.name)
    print(f"{pack['id']}: apigee/proxies/{pack['proxy']} + {', '.join(written)}")
    return pack


def all_pack_ids():
    return sorted(p.stem for p in PACKS.glob('*.json'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('industry', nargs='?')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--target-url', default=DEFAULT_TARGET)
    a = ap.parse_args()
    ids = all_pack_ids() if a.all else [a.industry]
    if not ids or ids == [None]:
        ap.error('industry or --all is required')
    for i in ids:
        generate(i, a.target_url)


if __name__ == '__main__':
    main()
