#!/usr/bin/env python3
"""Generates the REST proxy bundles that front the Cloud Run demo services.

  customer-service-v1   /customer-service/v1   -> Cloud Run customer-service-api
  business-insights-v1  /business-insights/v1  -> Cloud Run business-insights-api

Only the documented operations are routed (one conditional flow per MCP tool, so analytics
show the tool name); anything else gets 404, and /admin/* is never exposed.
customer-service-v1 also enforces the refund limit: POST /orders/{id}/refunds with an amount
above refund.maxAmount (KVM `customer-tools-config`, default 50) is refused with 403 before the
backend is called, but only for caller keys holding a product in refund.limitedProducts
(default "Customer Service Tools MCP"; the MCP server forwards the caller's x-apikey).

Private by design: both proxies only accept calls that egress from this Apigee org (the NAT
IPs in KVM `customer-tools-config` key internal.allowedIps), i.e. from the /mcp proxy's MCP
server. Anyone else gets 403 NOT_INTERNAL. Set internal.enforce=false in the KVM to test with
curl. Cloud Run itself only accepts the Apigee service account (Google ID token).

Usage: python3 apigee/scripts/gen_business_proxies.py <customer-service-url> <business-insights-url>
"""
import pathlib
import sys
from textwrap import dedent

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'proxies'
SPECS = pathlib.Path(__file__).resolve().parents[1] / 'specs'
# Hosts per environment group. The bundle spec lists dev first while the proxies only run in
# dev; pass --prod-first when promoting so API hub / MCP pick the prod host.
# Placeholders, rendered from .env at package time (apigee/scripts/render_tokens.py).
HOSTS = ['https://__APIGEE_HOST_DEV__', 'https://__APIGEE_HOST_PROD__']
HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

PROXIES = {
    'customer-service-v1': {
        'basepath': '/customer-service/v1',
        'spec': 'customer-service.yaml',
        'description': 'Customer Service API (customers, orders, pricing, cases, refunds) on Cloud Run. Refunds over the configured limit are refused at the gateway.',
        'flows': [
            ('searchCustomers', 'GET', '/customers'),
            ('listCustomerOrders', 'GET', '/customers/*/orders'),
            ('getCustomer', 'GET', '/customers/*'),
            ('getOrderStatus', 'GET', '/orders/*'),
            ('getProductPrice', 'GET', '/products/*/price'),
            ('createSupportCase', 'POST', '/cases'),
            ('issueRefund', 'POST', '/orders/*/refunds'),
        ],
    },
    'business-insights-v1': {
        'basepath': '/business-insights/v1',
        'spec': 'business-insights.yaml',
        'description': 'Business Insights API (aggregated revenue, support metrics, churn cohorts, margins, forecasts) on Cloud Run. No individual customer data.',
        'flows': [
            ('getRevenueTrends', 'GET', '/insights/revenue'),
            ('getSupportMetrics', 'GET', '/insights/support'),
            ('getChurnRisk', 'GET', '/insights/churn'),
            ('getProductMargins', 'GET', '/insights/products/*/margin'),
            ('runForecast', 'POST', '/insights/forecast'),
        ],
    },
}

COMMON_POLICIES = {
    'KVM-GetConfig': dedent('''\
        <KeyValueMapOperations continueOnError="false" enabled="true" name="KVM-GetConfig" mapIdentifier="customer-tools-config">
          <Scope>environment</Scope>
          <ExpiryTimeInSecs>60</ExpiryTimeInSecs>
          <Get assignTo="private.internal.allowedIps">
            <Key>
              <Parameter>internal.allowedIps</Parameter>
            </Key>
          </Get>
          <Get assignTo="private.internal.enforce">
            <Key>
              <Parameter>internal.enforce</Parameter>
            </Key>
          </Get>
        </KeyValueMapOperations>
        '''),
    'JS-CheckCaller': dedent('''\
        <Javascript continueOnError="false" enabled="true" timeLimit="200" name="JS-CheckCaller">
          <ResourceURL>jsc://check-caller.js</ResourceURL>
        </Javascript>
        '''),
    'RF-NotInternal': dedent('''\
        <RaiseFault continueOnError="false" enabled="true" name="RF-NotInternal">
          <FaultResponse>
            <Set>
              <StatusCode>403</StatusCode>
              <ReasonPhrase>Forbidden</ReasonPhrase>
              <Payload contentType="application/json" variablePrefix="@" variableSuffix="#">{"error":"NOT_INTERNAL","message":"This API is private. Call it through the MCP gateway (/mcp)."}</Payload>
            </Set>
          </FaultResponse>
          <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
        </RaiseFault>
        '''),
    'CORS-Allow': dedent('''\
        <CORS continueOnError="false" enabled="true" name="CORS-Allow">
          <AllowOrigins>{request.header.origin}</AllowOrigins>
          <AllowMethods>GET, POST, OPTIONS</AllowMethods>
          <AllowHeaders>*</AllowHeaders>
          <ExposeHeaders>*</ExposeHeaders>
          <MaxAge>3628800</MaxAge>
          <AllowCredentials>false</AllowCredentials>
          <GeneratePreflightResponse>true</GeneratePreflightResponse>
          <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
        </CORS>
        '''),
    'SA-Protect': dedent('''\
        <SpikeArrest continueOnError="false" enabled="true" name="SA-Protect">
          <Rate>30ps</Rate>
          <UseEffectiveCount>true</UseEffectiveCount>
        </SpikeArrest>
        '''),
    'RF-NotFound': dedent('''\
        <RaiseFault continueOnError="false" enabled="true" name="RF-NotFound">
          <FaultResponse>
            <Set>
              <StatusCode>404</StatusCode>
              <ReasonPhrase>Not Found</ReasonPhrase>
              <Payload contentType="application/json" variablePrefix="@" variableSuffix="#">{"error":"NOT_FOUND","message":"No such operation on @apiproxy.name#"}</Payload>
            </Set>
          </FaultResponse>
          <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
        </RaiseFault>
        '''),
    'AM-RemoveClientAuth': dedent('''\
        <AssignMessage continueOnError="false" enabled="true" name="AM-RemoveClientAuth">
          <Remove>
            <Headers>
              <Header name="Authorization"/>
              <Header name="X-Serverless-Authorization"/>
              <Header name="X-Goog-IAP-JWT-Assertion"/>
              <Header name="x-api-key"/>
              <Header name="x-apikey"/>
            </Headers>
          </Remove>
          <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
          <AssignTo createNew="false" transport="http" type="request"/>
        </AssignMessage>
        '''),
    'ML-CloudLogging': dedent('''\
        <MessageLogging continueOnError="true" enabled="true" name="ML-CloudLogging">
          <CloudLogging>
            <LogName>projects/{organization.name}/logs/apigee</LogName>
            <Message contentType="application/json">{"apiProxyName":"{apiproxy.name}","environmentName":"{environment.name}","operation":"{current.flow.name}","requestVerb":"{request.verb}","proxyPathSuffix":"{proxy.pathsuffix}","responseStatusCode":"{response.status.code}","faultName":"{fault.name}","callerIp":"{caller.ip}","callerInternal":"{caller.internal}","xff":"{request.header.X-Forwarded-For.values.string}","trackingId":"{messageid}"}</Message>
            <ResourceType>api</ResourceType>
          </CloudLogging>
        </MessageLogging>
        '''),
}

REFUND_POLICIES = {
    'KVM-GetRefundLimit': dedent('''\
        <KeyValueMapOperations continueOnError="false" enabled="true" name="KVM-GetRefundLimit" mapIdentifier="customer-tools-config">
          <Scope>environment</Scope>
          <ExpiryTimeInSecs>60</ExpiryTimeInSecs>
          <Get assignTo="private.refund.maxAmount">
            <Key>
              <Parameter>refund.maxAmount</Parameter>
            </Key>
          </Get>
          <Get assignTo="private.refund.limitedProducts">
            <Key>
              <Parameter>refund.limitedProducts</Parameter>
            </Key>
          </Get>
        </KeyValueMapOperations>
        '''),
    'AE-CallerKey': dedent('''\
        <AccessEntity continueOnError="true" enabled="true" name="AE-CallerKey">
          <!-- The caller's app, looked up by the key the Apigee MCP server forwards; the API products on
               that key decide
               whether the refund limit applies (see check-refund-limit.js). -->
          <EntityType value="app"/>
          <EntityIdentifier ref="request.header.x-apikey" type="consumerkey"/>
        </AccessEntity>
        '''),
    'JS-CheckRefundLimit': dedent('''\
        <Javascript continueOnError="false" enabled="true" timeLimit="200" name="JS-CheckRefundLimit">
          <ResourceURL>jsc://check-refund-limit.js</ResourceURL>
        </Javascript>
        '''),
    'RF-RefundLimit': dedent('''\
        <RaiseFault continueOnError="false" enabled="true" name="RF-RefundLimit">
          <FaultResponse>
            <Set>
              <StatusCode>403</StatusCode>
              <ReasonPhrase>Forbidden</ReasonPhrase>
              <Payload contentType="application/json" variablePrefix="@" variableSuffix="#">{"error":"REFUND_LIMIT","message":"Refunds over $@refund.maxAmount# need supervisor approval. Requested $@refund.amount#.","limit":@refund.maxAmount#,"requested":@refund.amount#,"enforcedBy":"Apigee"}</Payload>
            </Set>
          </FaultResponse>
          <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
        </RaiseFault>
        '''),
}

CALLER_JS = dedent('''\
    // Private API: only the Apigee MCP server (or anything egressing from this org's NAT IPs)
    // may call it. Everything after the last public IP in X-Forwarded-For was appended by Google
    // infrastructure, so the client cannot forge it (spoofed entries land before its own IP).
    //   direct call : "<client>, <lb>, 10.148.x.x"                               -> 1 internal hop
    //   via /mcp    : "<client>, <lb>, 10.148.x.x, 10.0.32.3, 10.0.0.2, 7.0.4.3"   -> 4 internal hops
    // The MCP server calls the REST proxy over Apigee's internal network, so it is recognised by
    // having 2+ trailing internal hops. 7.0.0.0/8 is the Apigee runtime's internal hop range.
    function isInternalHop(ip) {
      var o = ip.split('.').map(Number);
      if (o.length !== 4) { return false; }
      return o[0] === 10 || o[0] === 7 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
        (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127);
    }
    var xff = String(context.getVariable('request.header.X-Forwarded-For.values.string') || context.getVariable('request.header.X-Forwarded-For') || '');
    var parts = xff.split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
    var hops = 0;
    while (hops < parts.length && isInternalHop(parts[parts.length - 1 - hops])) { hops++; }
    var lastPublic = hops < parts.length ? parts.length - 1 - hops : -1;
    // With the LB at lastPublic, the IP that reached the LB (the real caller) sits just before it.
    var callerIp = lastPublic >= 1 ? parts[lastPublic - 1] : (parts[0] || String(context.getVariable('client.ip') || ''));
    var allowed = String(context.getVariable('private.internal.allowedIps') || '34.124.136.14').split(',').map(function (p) { return p.trim(); });
    var enforce = String(context.getVariable('private.internal.enforce') || 'true') !== 'false';
    var viaMcp = hops >= 2;
    var internal = viaMcp || allowed.indexOf(callerIp) >= 0;
    context.setVariable('caller.ip', callerIp);
    context.setVariable('caller.internalHops', String(hops));
    context.setVariable('caller.internal', String(internal));
    context.setVariable('caller.blocked', String(enforce && !internal));
    ''')

REFUND_JS = dedent('''\
    // Refund limit, enforced at the gateway, for governed callers only.
    //
    // The Apigee MCP server forwards the caller's x-apikey to this proxy, so AE-CallerKey can
    // look up which API products that key holds. The limit applies when the key holds any
    // product listed in KVM refund.limitedProducts (comma-separated; default
    // "Customer Service Tools MCP"). Keys on other products (e.g. Enterprise Tools MCP, the
    // ungoverned all-tools product) are not limited. If the key cannot be resolved the limit
    // applies: fail closed.
    //
    // The amount limit comes from KVM refund.maxAmount (default 50 USD).
    var limit = parseFloat(context.getVariable('private.refund.maxAmount'));
    if (isNaN(limit) || limit <= 0) { limit = 50; }
    var limitedProducts = String(context.getVariable('private.refund.limitedProducts') || 'Customer Service Tools MCP')
      .split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
    // AE-CallerKey returns the caller's whole app; only the <Credential> holding this key counts,
    // so another key on the same app cannot widen or narrow the rule.
    var appXml = String(context.getVariable('AccessEntity.AE-CallerKey') || '');
    var key = String(context.getVariable('request.header.x-apikey') || '');
    var entity = '';
    var creds = appXml.split('<Credential>');
    for (var c = 1; c < creds.length && key; c++) {
      var block = creds[c].split('</Credential>')[0];
      if (block.indexOf('<ConsumerKey>' + key + '</ConsumerKey>') !== -1) { entity = block; }
    }
    var matched = '';
    for (var i = 0; i < limitedProducts.length && !matched; i++) {
      if (entity.indexOf(limitedProducts[i]) !== -1) { matched = limitedProducts[i]; }
    }
    var applies = !entity || !!matched;
    var amount = NaN;
    try { amount = parseFloat(JSON.parse(context.getVariable('request.content') || '{}').amount); } catch (e) { amount = NaN; }
    context.setVariable('refund.maxAmount', String(limit));
    context.setVariable('refund.amount', isNaN(amount) ? '0' : String(amount));
    context.setVariable('refund.limitApplies', String(applies));
    context.setVariable('refund.limitReason', !entity ? 'caller key not resolved (fail closed)' : (matched ? 'product ' + matched : 'no limited product on the key'));
    context.setVariable('refund.overLimit', String(applies && !isNaN(amount) && amount > limit));
    ''')


def target_xml(url):
    return HDR + dedent(f'''\
        <TargetEndpoint name="default">
          <PreFlow name="PreFlow">
            <Request>
              <Step>
                <Name>AM-RemoveClientAuth</Name>
              </Step>
            </Request>
            <Response/>
          </PreFlow>
          <HTTPTargetConnection>
            <Authentication>
              <GoogleIDToken>
                <Audience>{url}</Audience>
              </GoogleIDToken>
            </Authentication>
            <URL>{url}</URL>
          </HTTPTargetConnection>
        </TargetEndpoint>
        ''')


def proxy_endpoint_xml(cfg, refund):
    flows = []
    for name, verb, path in cfg['flows']:
        steps = '''        <Step>
          <Name>OAS-ValidateRequest</Name>
        </Step>
'''
        if refund and name == 'issueRefund':
            steps += dedent('''\
                      <Step>
                        <Name>KVM-GetRefundLimit</Name>
                      </Step>
                      <Step>
                        <Name>AE-CallerKey</Name>
                      </Step>
                      <Step>
                        <Name>JS-CheckRefundLimit</Name>
                      </Step>
                      <Step>
                        <Name>RF-RefundLimit</Name>
                        <Condition>refund.overLimit = "true"</Condition>
                      </Step>
                ''')
        flows.append(
            f'''    <Flow name="{name}">
      <Request>
{steps}      </Request>
      <Response/>
      <Condition>(proxy.pathsuffix MatchesPath "{path}") and (request.verb = "{verb}")</Condition>
    </Flow>
'''
        )
    flows.append('''    <Flow name="NotFound">
      <Request>
        <Step>
          <Name>RF-NotFound</Name>
        </Step>
      </Request>
      <Response/>
    </Flow>
''')
    return HDR + f'''<ProxyEndpoint name="default">
  <HTTPProxyConnection>
    <BasePath>{cfg['basepath']}</BasePath>
  </HTTPProxyConnection>
  <PreFlow name="PreFlow">
    <Request>
      <Step>
        <Name>CORS-Allow</Name>
      </Step>
      <Step>
        <Name>KVM-GetConfig</Name>
        <Condition>request.verb != "OPTIONS"</Condition>
      </Step>
      <Step>
        <Name>JS-CheckCaller</Name>
        <Condition>request.verb != "OPTIONS"</Condition>
      </Step>
      <Step>
        <Name>RF-NotInternal</Name>
        <Condition>caller.blocked = "true"</Condition>
      </Step>
      <Step>
        <Name>SA-Protect</Name>
        <Condition>request.verb != "OPTIONS"</Condition>
      </Step>
    </Request>
    <Response/>
  </PreFlow>
  <Flows>
{''.join(flows)}  </Flows>
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


def main(cs_url, bi_url):
    urls = {'customer-service-v1': cs_url.rstrip('/'), 'business-insights-v1': bi_url.rstrip('/')}
    for name, cfg in PROXIES.items():
        refund = name == 'customer-service-v1'
        base = ROOT / name / 'apiproxy'
        for sub in ('policies', 'proxies', 'targets', 'resources/jsc'):
            (base / sub).mkdir(parents=True, exist_ok=True)
        policies = dict(COMMON_POLICIES, **(REFUND_POLICIES if refund else {}))
        # The OpenAPI spec ships inside the bundle: API hub syncs it from here (needed for the
        # REST -> MCP conversion), and OAS-ValidateRequest enforces it on every call.
        spec_src = (SPECS / cfg['spec']).read_text()
        hosts = HOSTS[::-1] if '--prod-first' in sys.argv else HOSTS
        prod_url = 'https://__APIGEE_HOST_PROD__' + cfg['basepath']
        servers = ''.join(f'  - url: {h}{cfg["basepath"]}\n' for h in hosts)
        assert f'  - url: {prod_url}\n' in spec_src, 'spec servers must list the prod URL'
        (base / 'resources/oas').mkdir(parents=True, exist_ok=True)
        (base / 'resources/oas' / cfg['spec']).write_text(spec_src.replace(f'  - url: {prod_url}\n', servers))
        policies['OAS-ValidateRequest'] = dedent(f'''\
            <OASValidation continueOnError="false" enabled="true" name="OAS-ValidateRequest">
              <Source>request</Source>
              <OASResource>oas://{cfg['spec']}</OASResource>
              <Options>
                <ValidateMessageBody>true</ValidateMessageBody>
                <AllowUnspecifiedParameters>
                  <Header>true</Header>
                  <Query>false</Query>
                  <Cookie>true</Cookie>
                </AllowUnspecifiedParameters>
              </Options>
            </OASValidation>
            ''')
        for pname, xml in policies.items():
            (base / 'policies' / f'{pname}.xml').write_text(HDR + xml)
        (base / 'resources/jsc/check-caller.js').write_text(CALLER_JS)
        if refund:
            (base / 'resources/jsc/check-refund-limit.js').write_text(REFUND_JS)
        (base / 'proxies/default.xml').write_text(proxy_endpoint_xml(cfg, refund))
        (base / 'targets/default.xml').write_text(target_xml(urls[name]))
        pol = ''.join(f'    <Policy>{p}</Policy>\n' for p in policies)
        res = f'    <Resource>oas://{cfg["spec"]}</Resource>\n' + '    <Resource>jsc://check-caller.js</Resource>\n' + ('    <Resource>jsc://check-refund-limit.js</Resource>\n' if refund else '')
        (base / f'{name}.xml').write_text(HDR + f'''<APIProxy revision="1" name="{name}">
  <DisplayName>{name}</DisplayName>
  <Description>{cfg['description']}</Description>
  <BasePaths>{cfg['basepath']}</BasePaths>
  <Policies>
{pol}  </Policies>
  <ProxyEndpoints>
    <ProxyEndpoint>default</ProxyEndpoint>
  </ProxyEndpoints>
  <Resources>
{res}  </Resources>
  <TargetEndpoints>
    <TargetEndpoint>default</TargetEndpoint>
  </TargetEndpoints>
</APIProxy>
''')
        print('wrote', base)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--prod-first']
    if len(args) != 2:
        sys.exit(__doc__)
    main(args[0], args[1])
