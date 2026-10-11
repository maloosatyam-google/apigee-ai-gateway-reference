#!/usr/bin/env python3
"""Scaffold a deployable Apigee X AI Gateway proxy bundle (stdlib only, no repo dependencies).

  python3 scaffold_ai_gateway.py --out ./ai-gateway-v1 --project my-proj [options]

Options:
  --name ai-gateway-v1          proxy name (also API product apiSource)
  --basepath /ai/v1
  --project PROJECT             GCP project hosting Vertex AI / Model Armor
  --model-location global       Vertex location for model calls
  --default-model gemini-3.6-flash
  --armor-region REGION         enable Model Armor (SUP + SMR); needs templates below
  --prompt-template NAME        Model Armor template for prompts   (default apigee-sanitize-user-prompt)
  --response-template NAME      Model Armor template for responses (default apigee-sanitize-model-response)
  --cache-region REGION         enable semantic cache (opt-in header x-use-cache: true)
  --index-endpoint-host HOST    e.g. 123.asia-southeast1-456.vdb.vertexai.goog
  --index-endpoint-id ID  --deployed-index-id ID  --index-id ID
  --token-quota                 add LLMTokenQuota enforce/count pair (limits from API product llmOperationGroup)
  --prompt-token-limit RATE     add PromptTokenLimit, e.g. 5000pm
  --claude                      add an Anthropic-on-Vertex target for /models/claude-*

Generated paths: POST {basepath}/models/{model}:generateContent  (Gemini request shape)
Every response carries x-gateway-model / -provider / -prompt-tokens / -completion-tokens / -total-tokens /
-cached headers. Also writes api_product.json with the matching llmOperationGroup.
"""
import argparse
import json
import os
import textwrap

H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    a.add_argument("--name", default="ai-gateway-v1")
    a.add_argument("--basepath", default="/ai/v1")
    a.add_argument("--project", required=True)
    a.add_argument("--model-location", default="global")
    a.add_argument("--default-model", default="gemini-3.6-flash")
    a.add_argument("--armor-region")
    a.add_argument("--prompt-template", default="apigee-sanitize-user-prompt")
    a.add_argument("--response-template", default="apigee-sanitize-model-response")
    a.add_argument("--cache-region")
    a.add_argument("--index-endpoint-host")
    a.add_argument("--index-endpoint-id")
    a.add_argument("--deployed-index-id", default="semantic_cache")
    a.add_argument("--index-id")
    a.add_argument("--token-quota", action="store_true")
    a.add_argument("--prompt-token-limit")
    a.add_argument("--claude", action="store_true")
    o = a.parse_args()
    if o.cache_region and not (o.index_endpoint_host and o.index_endpoint_id and o.index_id):
        a.error("--cache-region needs --index-endpoint-host, --index-endpoint-id and --index-id")

    P = {}  # policy name -> xml
    pre, flows_extra, post, tgt_pre = [], [], [], []
    NOT_OPT = 'request.verb != "OPTIONS"'
    CACHE_ON = '(request.header.x-use-cache = "true")'

    P["CORS-Headers"] = """<CORS continueOnError="false" enabled="true" name="CORS-Headers">
  <AllowOrigins>{request.header.origin}</AllowOrigins>
  <AllowMethods>GET, POST, OPTIONS</AllowMethods>
  <AllowHeaders>origin, accept, content-type, authorization, x-apikey, x-use-cache</AllowHeaders>
  <ExposeHeaders>*</ExposeHeaders>
  <MaxAge>3628800</MaxAge>
  <GeneratePreflightResponse>true</GeneratePreflightResponse>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</CORS>"""
    P["EV-RequestDetails"] = """<ExtractVariables continueOnError="true" enabled="true" name="EV-RequestDetails">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <URIPath>
    <Pattern ignoreCase="true">/models/{model}:generateContent</Pattern>
  </URIPath>
  <Source clearPayload="false">request</Source>
  <VariablePrefix>flow</VariablePrefix>
</ExtractVariables>"""
    P["JS-ExtractPrompt"] = """<Javascript continueOnError="true" enabled="true" timeLimit="200" name="JS-ExtractPrompt">
  <ResourceURL>jsc://ExtractPrompt.js</ResourceURL>
</Javascript>"""
    P["VA-VerifyAPIKey"] = """<VerifyAPIKey continueOnError="false" enabled="true" name="VA-VerifyAPIKey">
  <APIKey ref="request.header.x-apikey"/>
</VerifyAPIKey>"""
    P["AM-RemoveAuthorization"] = """<AssignMessage continueOnError="false" enabled="true" name="AM-RemoveAuthorization">
  <Remove><Headers><Header name="x-apikey"/><Header name="Authorization"/></Headers></Remove>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <AssignTo createNew="false" transport="http" type="request"/>
</AssignMessage>"""
    P["AM-InitCacheStatus"] = """<AssignMessage continueOnError="false" enabled="true" name="AM-InitCacheStatus">
  <AssignVariable><Name>flow.cached</Name><Value>false</Value></AssignVariable>
  <AssignVariable><Name>flow.cacheStatus</Name><Value>DISABLED</Value></AssignVariable>
  <AssignVariable><Name>flow.target_provider</Name><Value>google</Value></AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
    pre += [("CORS-Headers", NOT_OPT), ("EV-RequestDetails", NOT_OPT), ("JS-ExtractPrompt", NOT_OPT),
            ("VA-VerifyAPIKey", NOT_OPT)]

    if o.armor_region:
        P["SUP-UserPrompt"] = f"""<SanitizeUserPrompt async="false" continueOnError="false" enabled="true" name="SUP-UserPrompt">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <ModelArmor>
    <TemplateName>projects/{o.project}/locations/{o.armor_region}/templates/{o.prompt_template}</TemplateName>
  </ModelArmor>
  <UserPromptSource>{{flow.userPrompt}}</UserPromptSource>
</SanitizeUserPrompt>"""
        pre.append(("SUP-UserPrompt", f'{NOT_OPT} and flow.userPrompt != null and flow.userPrompt != ""'))
    if o.prompt_token_limit:
        P["PTL-PromptTokenLimit"] = f"""<PromptTokenLimit continueOnError="false" enabled="true" name="PTL-PromptTokenLimit">
  <Properties/>
  <UserPromptSource>{{flow.userPrompt}}</UserPromptSource>
  <Identifier ref="verifyapikey.VA-VerifyAPIKey.client_id"/>
  <Rate>{o.prompt_token_limit}</Rate>
  <UseEffectiveCount>true</UseEffectiveCount>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</PromptTokenLimit>"""
        pre.append(("PTL-PromptTokenLimit", f'{NOT_OPT} and flow.userPrompt != null and flow.userPrompt != ""'))
    pre += [("AM-RemoveAuthorization", NOT_OPT), ("AM-InitCacheStatus", NOT_OPT)]

    if o.claude:
        P["AM-PrepClaude"] = """<AssignMessage continueOnError="false" enabled="true" name="AM-PrepClaude">
  <AssignVariable><Name>flow.target_provider</Name><Value>anthropic</Value></AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
        pre.append(("AM-PrepClaude", f'{NOT_OPT} and proxy.pathsuffix JavaRegex "^/models/claude.*"'))

    if o.cache_region:
        P["AM-SetCacheHitExpected"] = """<AssignMessage continueOnError="false" enabled="true" name="AM-SetCacheHitExpected">
  <AssignVariable><Name>flow.cached</Name><Value>true</Value></AssignVariable>
  <AssignVariable><Name>flow.cacheStatus</Name><Value>HIT</Value></AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
        P["AM-SetCacheMiss"] = """<AssignMessage continueOnError="false" enabled="true" name="AM-SetCacheMiss">
  <!-- Runs in the TargetEndpoint PreFlow, which a semantic-cache hit never reaches -->
  <AssignVariable><Name>flow.cached</Name><Value>false</Value></AssignVariable>
  <AssignVariable><Name>flow.cacheStatus</Name><Value>MISS</Value></AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
        r = o.cache_region
        P["SCL-Semantic-Cache-Lookup"] = f"""<SemanticCacheLookup async="false" continueOnError="true" enabled="true" name="SCL-Semantic-Cache-Lookup">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <UserPromptSource>{{flow.userPrompt}}</UserPromptSource>
  <Embeddings>
    <VertexAI>
      <URL>https://{r}-aiplatform.googleapis.com/v1/projects/{o.project}/locations/{r}/publishers/google/models/text-embedding-005:predict</URL>
    </VertexAI>
  </Embeddings>
  <SimilaritySearch>
    <VertexAI>
      <URL>https://{o.index_endpoint_host}/v1/projects/{o.project}/locations/{r}/indexEndpoints/{o.index_endpoint_id}:findNeighbors</URL>
      <DeployedIndexID>{o.deployed_index_id}</DeployedIndexID>
      <Threshold>0.95</Threshold>
    </VertexAI>
  </SimilaritySearch>
</SemanticCacheLookup>"""
        P["SCP-Semantic-Cache-Populate"] = f"""<SemanticCachePopulate async="false" continueOnError="true" enabled="true" name="SCP-Semantic-Cache-Populate">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <SimilaritySearch>
    <VertexAI>
      <URL>https://{r}-aiplatform.googleapis.com/v1/projects/{o.project}/locations/{r}/indexes/{o.index_id}:upsertDatapoints</URL>
    </VertexAI>
  </SimilaritySearch>
  <TTLInSeconds>180</TTLInSeconds>
</SemanticCachePopulate>"""
        pre += [("AM-SetCacheHitExpected", f"{NOT_OPT} and {CACHE_ON}"),
                ("SCL-Semantic-Cache-Lookup", f"{NOT_OPT} and {CACHE_ON}")]
        tgt_pre.append(("AM-SetCacheMiss", CACHE_ON))

    if o.token_quota:
        common = """  <Allow count="1000" countRef="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit"/>
  <Interval ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.interval">1</Interval>
  <TimeUnit ref="verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.timeunit">minute</TimeUnit>
  <Distributed>true</Distributed>
  <Synchronous>true</Synchronous>
  <!-- Identifier, LLMModelSource and SharedName MUST be identical in both LTQ policies -->
  <Identifier ref="verifyapikey.VA-VerifyAPIKey.client_id"/>"""
        P["LTQ-TokenEnforce"] = f"""<LLMTokenQuota continueOnError="false" enabled="true" name="LTQ-TokenEnforce" type="rollingwindow">
{common}
  <LLMModelSource>{{flow.quota_model}}</LLMModelSource>
  <EnforceOnly>true</EnforceOnly>
  <SharedName>common-counter</SharedName>
</LLMTokenQuota>"""
        P["LTQ-TokenCount"] = f"""<LLMTokenQuota continueOnError="true" enabled="true" name="LTQ-TokenCount" type="rollingwindow">
{common}
  <LLMTokenUsageSource>{{jsonPath('$.usageMetadata.totalTokenCount',response.content,true)}}</LLMTokenUsageSource>
  <LLMModelSource>{{flow.quota_model}}</LLMModelSource>
  <CountOnly>true</CountOnly>
  <SharedName>common-counter</SharedName>
</LLMTokenQuota>"""
        # in a conditional flow -> runs only on cache miss (lookup hit short-circuits after PreFlow)
        flows_extra.append(("LLMTokenQuotaFlow", "LTQ-TokenEnforce",
                            f'{NOT_OPT} and proxy.pathsuffix JavaRegex "^/models/.*"'))

    P["EV-ModelResponse"] = """<ExtractVariables continueOnError="true" enabled="true" name="EV-ModelResponse">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <JSONPayload>
    <!-- never name a variable "model" here: it would overwrite flow.model mid-flow -->
    <Variable name="responseModelVersion"><JSONPath>$.modelVersion</JSONPath></Variable>
    <Variable name="promptTokenCount"><JSONPath>$.usageMetadata.promptTokenCount</JSONPath></Variable>
    <Variable name="candidatesTokenCount"><JSONPath>$.usageMetadata.candidatesTokenCount</JSONPath></Variable>
    <Variable name="totalTokenCount"><JSONPath>$.usageMetadata.totalTokenCount</JSONPath></Variable>
  </JSONPayload>
  <Source clearPayload="false">response</Source>
  <VariablePrefix>flow</VariablePrefix>
</ExtractVariables>"""
    post.append(("EV-ModelResponse", None))
    if o.token_quota:
        post.append(("LTQ-TokenCount", 'response.status.code = 200 and flow.cached != "true"'))
    if o.cache_region:
        post.append(("SCP-Semantic-Cache-Populate", f'response.status.code = 200 and {CACHE_ON} and flow.cached != "true"'))
    if o.armor_region:
        P["SMR-SanitizeModelResponse"] = f"""<SanitizeModelResponse async="false" continueOnError="true" enabled="true" name="SMR-SanitizeModelResponse">
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <ModelArmor>
    <TemplateName>projects/{o.project}/locations/{o.armor_region}/templates/{o.response_template}</TemplateName>
  </ModelArmor>
  <LLMResponseSource>{{jsonPath('$.candidates[-1].content.parts',response.content,true)}}</LLMResponseSource>
</SanitizeModelResponse>"""
        post.append(("SMR-SanitizeModelResponse", 'response.status.code = 200 and flow.target_provider = "google"'))
    P["AM-SetResponseHeaders"] = """<AssignMessage continueOnError="true" enabled="true" name="AM-SetResponseHeaders">
  <Set>
    <Headers>
      <Header name="x-gateway-model">{flow.model}</Header>
      <Header name="x-gateway-provider">{flow.target_provider}</Header>
      <Header name="x-gateway-cached">{flow.cached}</Header>
      <Header name="x-gateway-cache-status">{flow.cacheStatus}</Header>
      <Header name="x-gateway-prompt-tokens">{flow.promptTokenCount}</Header>
      <Header name="x-gateway-completion-tokens">{flow.candidatesTokenCount}</Header>
      <Header name="x-gateway-total-tokens">{flow.totalTokenCount}</Header>
    </Headers>
  </Set>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
  <AssignTo createNew="false" transport="http" type="response"/>
</AssignMessage>"""
    post.append(("AM-SetResponseHeaders", None))
    P["ML-CloudLogging"] = """<MessageLogging continueOnError="true" enabled="true" name="ML-CloudLogging">
  <CloudLogging>
    <LogName>projects/{organization.name}/logs/apigee</LogName>
    <Message contentType="application/json">{"proxy":"{apiproxy.name}","model":"{flow.model}","provider":"{flow.target_provider}","app":"{developer.app.name}","cached":"{flow.cached}","promptTokens":"{flow.promptTokenCount}","completionTokens":"{flow.candidatesTokenCount}","totalTokens":"{flow.totalTokenCount}","status":"{response.status.code}","fault":"{fault.name}","messageId":"{messageid}"}</Message>
    <ResourceType>api</ResourceType>
  </CloudLogging>
</MessageLogging>"""

    # Targets
    targets = {}
    P["AM-RouteGeminiTarget"] = f"""<AssignMessage continueOnError="false" enabled="true" name="AM-RouteGeminiTarget">
  <AssignVariable><Name>target.copy.pathsuffix</Name><Value>false</Value></AssignVariable>
  <AssignVariable>
    <Name>target.url</Name>
    <Template>https://aiplatform.googleapis.com/v1/projects/{o.project}/locations/{o.model_location}/publishers/google/models/{{flow.model}}:generateContent</Template>
  </AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
    targets["gemini-vertex-target"] = tgt_pre + [("AM-RouteGeminiTarget", None)]
    if o.claude:
        P["AM-RouteClaudeTarget"] = f"""<AssignMessage continueOnError="false" enabled="true" name="AM-RouteClaudeTarget">
  <!-- Anthropic on Vertex: body must be Anthropic Messages shape with "anthropic_version": "vertex-2023-10-16" -->
  <AssignVariable><Name>target.copy.pathsuffix</Name><Value>false</Value></AssignVariable>
  <AssignVariable>
    <Name>target.url</Name>
    <Template>https://aiplatform.googleapis.com/v1/projects/{o.project}/locations/global/publishers/anthropic/models/{{flow.model}}:rawPredict</Template>
  </AssignVariable>
  <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>"""
        targets["claude-vertex-target"] = tgt_pre + [("AM-RouteClaudeTarget", None)]

    # ---- write files
    root = os.path.join(o.out, "apiproxy")
    for d in ("policies", "proxies", "targets", "resources/jsc"):
        os.makedirs(os.path.join(root, d), exist_ok=True)
    for n, x in P.items():
        open(os.path.join(root, "policies", n + ".xml"), "w").write(H + x + "\n")
    open(os.path.join(root, "resources/jsc/ExtractPrompt.js"), "w").write(JS)

    def steps(lst, ind="      "):
        out = []
        for n, c in lst:
            out.append(f"{ind}<Step>\n{ind}  <Name>{n}</Name>")
            if c:
                out.append(f"{ind}  <Condition>{c.replace('>', '&gt;')}</Condition>")
            out.append(f"{ind}</Step>")
        return "\n".join(out)

    flows = [f"""    <Flow name="OptionsPreFlight">
      <Request>
{steps([("CORS-Headers", None)], "        ")}
      </Request>
      <Response/>
      <Condition>request.verb == "OPTIONS" AND request.header.origin != null</Condition>
    </Flow>"""]
    for fname, pol, cond in flows_extra:
        flows.append(f"""    <Flow name="{fname}">
      <Request>
{steps([(pol, None)], "        ")}
      </Request>
      <Response/>
      <Condition>{cond}</Condition>
    </Flow>""")
    route_rules = ""
    if o.claude:
        route_rules += """  <RouteRule name="claude-target">
    <Condition>flow.target_provider == "anthropic"</Condition>
    <TargetEndpoint>claude-vertex-target</TargetEndpoint>
  </RouteRule>
"""
    route_rules += """  <RouteRule name="gemini-target">
    <TargetEndpoint>gemini-vertex-target</TargetEndpoint>
  </RouteRule>"""
    proxy = f"""{H}<ProxyEndpoint name="default">
  <PreFlow name="PreFlow">
    <Request>
{steps(pre)}
    </Request>
    <Response/>
  </PreFlow>
  <Flows>
{chr(10).join(flows)}
  </Flows>
  <PostFlow name="PostFlow">
    <Request/>
    <Response>
{steps(post)}
    </Response>
  </PostFlow>
  <PostClientFlow>
    <Response>
{steps([("ML-CloudLogging", None)])}
    </Response>
  </PostClientFlow>
  <HTTPProxyConnection>
    <BasePath>{o.basepath}</BasePath>
  </HTTPProxyConnection>
{route_rules}
</ProxyEndpoint>
"""
    open(os.path.join(root, "proxies/default.xml"), "w").write(proxy)
    for tname, tsteps in targets.items():
        open(os.path.join(root, "targets", tname + ".xml"), "w").write(f"""{H}<TargetEndpoint name="{tname}">
  <PreFlow name="PreFlow">
    <Request>
{steps(tsteps)}
    </Request>
    <Response/>
  </PreFlow>
  <HTTPTargetConnection>
    <URL>https://aiplatform.googleapis.com</URL>
    <Authentication>
      <GoogleAccessToken>
        <Scopes><Scope>https://www.googleapis.com/auth/cloud-platform</Scope></Scopes>
      </GoogleAccessToken>
    </Authentication>
  </HTTPTargetConnection>
</TargetEndpoint>
""")
    pol_list = "\n".join(f"    <Policy>{n}</Policy>" for n in sorted(P))
    tgt_list = "\n".join(f"    <TargetEndpoint>{t}</TargetEndpoint>" for t in targets)
    open(os.path.join(root, f"{o.name}.xml"), "w").write(f"""{H}<APIProxy revision="1" name="{o.name}">
  <DisplayName>{o.name}</DisplayName>
  <Description>AI Gateway scaffolded by the ai-gateway-policy-manager skill</Description>
  <BasePaths>{o.basepath}</BasePaths>
  <Policies>
{pol_list}
  </Policies>
  <Resources>
    <Resource>jsc://ExtractPrompt.js</Resource>
  </Resources>
  <ProxyEndpoints>
    <ProxyEndpoint>default</ProxyEndpoint>
  </ProxyEndpoints>
  <TargetEndpoints>
{tgt_list}
  </TargetEndpoints>
</APIProxy>
""")

    models = [o.default_model] + (["claude-haiku-5-5"] if o.claude else [])
    product = {
        "name": f"{o.name} - Standard",
        "displayName": f"{o.name} - Standard",
        "approvalType": "auto",
        "attributes": [{"name": "access", "value": "private"}],
        "environments": ["<ENV>"],
        "llmOperationGroup": {"operationConfigs": [
            {"apiSource": o.name,
             "llmOperations": [{"resource": f"/models/{m}:*", "methods": ["POST"], "model": m}],
             "llmTokenQuota": {"limit": "10000", "interval": "1", "timeUnit": "minute"}} for m in models]},
    }
    open(os.path.join(o.out, "api_product.json"), "w").write(json.dumps(product, indent=2) + "\n")
    print(f"Scaffolded {o.out} ({len(P)} policies, targets: {', '.join(targets)})")
    print("Next: validate_bundle.py, then deploy_bundle.sh --sa <runtime SA with aiplatform.user"
          + (", modelarmor.user" if o.armor_region else "") + ">, then create the API product + app.")


JS = textwrap.dedent("""\
    // Extract the user prompt (Gemini / Anthropic / OpenAI / flat) into flow.userPrompt so that
    // SanitizeUserPrompt, PromptTokenLimit and SemanticCacheLookup share one provider-agnostic source.
    // flow.quota_model is the model id LLMTokenQuota keys on; it must never change mid-flow.
    var model = context.getVariable("flow.model");
    if (model) { context.setVariable("flow.quota_model", model); }
    var body = context.getVariable("request.content") || "";
    try {
      var p = JSON.parse(body), text = "";
      if (p.contents && p.contents.length) {
        var parts = p.contents[p.contents.length - 1].parts || [];
        text = parts.filter(function (x) { return x && x.text; }).map(function (x) { return x.text; }).join(" ");
      } else if (p.messages && p.messages.length) {
        var c = p.messages[p.messages.length - 1].content;
        text = typeof c === "string" ? c : (c || []).filter(function (x) { return x && x.text; }).map(function (x) { return x.text; }).join(" ");
      } else if (p.prompt) {
        text = typeof p.prompt === "string" ? p.prompt : JSON.stringify(p.prompt);
      }
      if (text) { context.setVariable("flow.userPrompt", text); }
    } catch (e) { /* non-JSON body: leave unset */ }
    """)

if __name__ == "__main__":
    main()
