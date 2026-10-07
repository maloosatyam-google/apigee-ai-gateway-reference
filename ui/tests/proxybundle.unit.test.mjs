/**
 * Static integrity checks for the Apigee proxy bundles, API products and MCP
 * backend, plus behavioural tests for the Gemini <-> Claude translation JS.
 *
 * Everything here runs offline against files in the repo; nothing talks to Apigee.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const proxiesRoot = path.join(repoRoot, "apigee/proxies");
const productsDir = path.join(repoRoot, "apigee/products");

const readText = (p) => fs.readFileSync(p, "utf8");
const listXml = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".xml")) : []);
const stripComments = (xml) => xml.replace(/<!--[\s\S]*?-->/g, "");
// Industry packs (industries/<id>.json) generate an <id>-mcp bundle and 3 product files.
const INDUSTRY_IDS = fs.readdirSync(path.join(repoRoot, "industries")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const INDUSTRY_PRODUCT_FILES = INDUSTRY_IDS.flatMap((id) => ["admin", "ops", "insights"].map((k) => `${id}_tools_mcp_${k}.json`));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const bundles = fs
  .readdirSync(proxiesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(proxiesRoot, d.name, "apiproxy")))
  .map((d) => d.name);

describe("Proxy bundle manifests are internally consistent", () => {
  it("finds the expected bundles", () => {
    for (const name of ["ai-gateway-v1", "bigquery-mcp", "servicenow-mcp"]) {
      assert.ok(bundles.includes(name), `expected apigee/proxies/${name}`);
    }
  });

  for (const bundle of bundles) {
    const apiproxy = path.join(proxiesRoot, bundle, "apiproxy");
    const manifest = stripComments(readText(path.join(apiproxy, `${bundle}.xml`)));
    const policyFiles = listXml(path.join(apiproxy, "policies")).map((f) => f.replace(/\.xml$/, ""));
    const endpointXml = [
      ...listXml(path.join(apiproxy, "proxies")).map((f) => path.join(apiproxy, "proxies", f)),
      ...listXml(path.join(apiproxy, "targets")).map((f) => path.join(apiproxy, "targets", f)),
    ]
      .map((p) => stripComments(readText(p)))
      .join("\n");
    const stepNames = new Set([...endpointXml.matchAll(/<Step>\s*<Name>([^<]+)<\/Name>/g)].map((m) => m[1].trim()));
    const manifestPolicies = [...manifest.matchAll(/<Policy>([^<]+)<\/Policy>/g)].map((m) => m[1].trim());

    describe(bundle, () => {
      it("lists every policy file in the manifest, and nothing else", () => {
        assert.deepStrictEqual([...manifestPolicies].sort(), [...policyFiles].sort());
        assert.strictEqual(new Set(manifestPolicies).size, manifestPolicies.length, "duplicate <Policy> entry");
      });

      it("attaches every policy to at least one flow step (no orphans)", () => {
        for (const p of policyFiles) assert.ok(stepNames.has(p), `${bundle}: policy ${p} is never attached`);
      });

      it("has a policy file for every step it references (no dangling steps)", () => {
        for (const s of stepNames) assert.ok(policyFiles.includes(s), `${bundle}: step ${s} has no policy file`);
      });

      it("names each policy the same as its file", () => {
        for (const p of policyFiles) {
          const xml = readText(path.join(apiproxy, "policies", `${p}.xml`));
          const name = xml.match(/<[A-Za-z]+\b[^>]*\bname="([^"]+)"/);
          assert.ok(name && name[1] === p, `${bundle}: ${p}.xml declares name="${name && name[1]}"`);
        }
      });

      it("declares exactly the proxy and target endpoints that exist", () => {
        const decl = (tag) => [...manifest.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, "g"))].map((m) => m[1].trim()).sort();
        const files = (dir) => listXml(path.join(apiproxy, dir)).map((f) => f.replace(/\.xml$/, "")).sort();
        assert.deepStrictEqual(decl("ProxyEndpoint"), files("proxies"));
        assert.deepStrictEqual(decl("TargetEndpoint"), files("targets"));
      });

      it("routes only to target endpoints that exist", () => {
        const targets = listXml(path.join(apiproxy, "targets")).map((f) => f.replace(/\.xml$/, ""));
        for (const m of endpointXml.matchAll(/<RouteRule[\s\S]*?<TargetEndpoint>([^<]+)<\/TargetEndpoint>/g)) {
          assert.ok(targets.includes(m[1].trim()), `${bundle}: RouteRule targets missing endpoint ${m[1]}`);
        }
      });

      it("ships every JS resource a policy references, lists it, and has no unused JS", () => {
        const jscDir = path.join(apiproxy, "resources/jsc");
        const jsFiles = fs.existsSync(jscDir) ? fs.readdirSync(jscDir).filter((f) => f.endsWith(".js")) : [];
        const referenced = new Set();
        for (const p of policyFiles) {
          const m = readText(path.join(apiproxy, "policies", `${p}.xml`)).match(/<ResourceURL>jsc:\/\/([^<]+)<\/ResourceURL>/);
          if (m) referenced.add(m[1].trim());
        }
        for (const r of referenced) {
          assert.ok(jsFiles.includes(r), `${bundle}: referenced jsc://${r} does not exist`);
          if (/<Resources>/.test(manifest)) {
            assert.ok(manifest.includes(`<Resource>jsc://${r}</Resource>`), `${bundle}: manifest omits jsc://${r}`);
          }
        }
        for (const f of jsFiles) assert.ok(referenced.has(f), `${bundle}: resources/jsc/${f} is not used by any policy`);
      });
    });
  }
});

describe("No credentials in source (proxies, scripts, MCP servers)", () => {
  const roots = ["apigee/proxies", "apigee/scripts", "apigee/products", "mcp-servers"].map((r) => path.join(repoRoot, r));
  const files = roots.filter(fs.existsSync).flatMap((r) => walk(r)).filter((f) => /\.(xml|js|mjs|json|sh|py|yaml|yml|properties)$/.test(f));

  const patterns = [
    [/apikey_[0-9a-f]{16,}/i, "TypeSafe-style apikey_ literal"],
    [/Bearer\s+(?!\{)[A-Za-z0-9._~+/-]{20,}/, "literal bearer token"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
    [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
    // Apigee consumer keys are 48 alphanumerics; 40+ catches them and similar tokens
    // without tripping on 32-char hex sys_ids in the ServiceNow fixtures.
    [/["'=:-]\s*[A-Za-z0-9]{40,}["'\s}]/, "long opaque key-like literal"],
  ];

  it("scans a non-trivial set of files", () => {
    assert.ok(files.length > 50, `only ${files.length} files scanned`);
  });

  for (const [re, label] of patterns) {
    it(`contains no ${label}`, () => {
      const hits = files.filter((f) => re.test(readText(f))).map((f) => path.relative(repoRoot, f));
      assert.deepStrictEqual(hits, [], `${label} found in: ${hits.join(", ")}`);
    });
  }

  it("never seeds KVM entries from a bundle", () => {
    for (const f of files.filter((p) => p.includes(`${path.sep}policies${path.sep}`) && p.endsWith(".xml"))) {
      const xml = readText(f);
      if (xml.includes("<KeyValueMapOperations")) {
        assert.ok(!/<InitialEntries/.test(xml), `${path.relative(repoRoot, f)} seeds KVM entries in XML`);
      }
    }
  });
});

describe("API products reference real proxies and are all provisioned", () => {
  const productFiles = fs.readdirSync(productsDir).filter((f) => f.endsWith(".json"));
  const products = productFiles.map((f) => [f, JSON.parse(readText(path.join(productsDir, f)))]);
  const sources = (p) =>
    ["llmOperationGroup", "payloadOperationGroup", "operationGroup"]
      .flatMap((g) => (p[g] && p[g].operationConfigs) || [])
      .map((oc) => oc.apiSource);

  it("points every operation at a proxy bundle in the repo", () => {
    // `mcp` (the Apigee-native MCP proxy behind the Customer Service/Business Insights/Enterprise tools products) is
    // intentionally NOT in the repo: it is created, edited and deployed via the Apigee UI, and
    // pushing a repo bundle over it previously broke the UI-managed configuration.
    const UI_MANAGED_PROXIES = ["mcp"];
    const known = new Set([...bundles, ...UI_MANAGED_PROXIES]);
    for (const [file, p] of products) {
      for (const s of sources(p)) assert.ok(known.has(s), `${file}: apiSource "${s}" has no proxy bundle`);
    }
  });

  it("the UI-managed `mcp` proxy has no bundle in the repo (deploy_proxy.sh must never overwrite it)", () => {
    assert.ok(!bundles.includes("mcp"), "apigee/proxies/mcp must not exist: the `mcp` proxy is managed in the Apigee UI");
  });

  it("provision_unified_credentials.py syncs every product file", () => {
    const py = readText(path.join(repoRoot, "apigee/scripts/provision_unified_credentials.py"));
    // Industry pack products are generated and synced by provision_industry_pack.py.
    for (const f of productFiles.filter((x) => !INDUSTRY_PRODUCT_FILES.includes(x))) {
      assert.ok(py.includes(`"${f}"`), `provision script does not sync ${f}`);
    }
  });

  it("every industry pack has its generated proxy bundle and 3 products", () => {
    for (const id of INDUSTRY_IDS) {
      assert.ok(bundles.includes(`${id}-mcp`), `apigee/proxies/${id}-mcp is missing: run gen_industry_mcp.py ${id}`);
      for (const k of ["admin", "ops", "insights"]) {
        assert.ok(productFiles.includes(`${id}_tools_mcp_${k}.json`), `${id}_tools_mcp_${k}.json is missing`);
      }
    }
  });

  it("the MCP tools products entitle every ServiceNow tool the server exposes", () => {
    const server = readText(path.join(repoRoot, "mcp-servers/servicenow/server.js"));
    const toolNames = [...server.matchAll(/^\s{4}name: "([A-Za-z]+)",$/gm)].map((m) => m[1]);
    assert.ok(toolNames.length >= 4, "could not read tool names from server.js");
    const snow = JSON.parse(readText(path.join(productsDir, "servicenow_tools_mcp.json")));
    const ops = snow.payloadOperationGroup.operationConfigs.flatMap((oc) => oc.operations.map((o) => o.operation));
    for (const t of toolNames) {
      if (t === "listChangeRequests") continue; // intentionally not granted
      assert.ok(ops.includes(`tools/call/${t}`), `servicenow_tools_mcp.json does not grant ${t}`);
    }
  });
});

describe("Industry pack MCP proxies enforce the pack's business rule without JavaScript", () => {
  for (const id of INDUSTRY_IDS) {
    const pack = JSON.parse(readText(path.join(repoRoot, "industries", `${id}.json`)));
    const apiproxy = path.join(proxiesRoot, `${id}-mcp`, "apiproxy");
    const flow = stripComments(readText(path.join(apiproxy, "proxies/default.xml")));
    it(`${id}-mcp: limit check (EV + RaiseFault) runs after quota, only for the ops product, with the pack threshold`, () => {
      const iQ = flow.indexOf("<Name>Q-Limit</Name>");
      const iEV = flow.indexOf("<Name>EV-ToolCall</Name>");
      const iRF = flow.indexOf("<Name>RF-LimitNumericId</Name>");
      const iAM = flow.indexOf("<Name>AM-RemoveAuthorization</Name>");
      assert.ok(iQ >= 0 && iEV > iQ && iRF > iEV && iAM > iRF, "expected Q-Limit -> EV-ToolCall -> RF-Limit* -> AM-RemoveAuthorization");
      assert.ok(flow.includes(`mcp.amount GreaterThan ${pack.limit.max}`), "threshold comes from the pack");
      assert.ok(flow.includes(`mcp.tool = "${pack.limit.tool}"`));
      assert.ok(flow.includes(`"${pack.personas.ops.product}"`), "limit applies to the ops product");
      assert.ok(!flow.includes(`"${pack.personas.admin.product}"`), "admin product is not limited");
      assert.ok(!/Javascript/i.test(fs.readdirSync(path.join(apiproxy, "policies")).join(" ")), "no JavaScript policies");
      const rf = readText(path.join(apiproxy, "policies/RF-LimitNumericId.xml"));
      assert.match(rf, /<StatusCode>403<\/StatusCode>/);
      assert.ok(rf.includes(pack.limit.code));
      const ev = readText(path.join(apiproxy, "policies/EV-ToolCall.xml"));
      assert.ok(ev.includes(`$.params.arguments.${pack.limit.argument}`));
    });
    it(`${id}-mcp: target is the industry-apis path for the pack, with a Google ID token`, () => {
      const t = readText(path.join(apiproxy, "targets/default.xml"));
      assert.match(t, new RegExp(`/${id}/mcp</URL>`));
      assert.match(t, /<GoogleIDToken>/);
    });
    it(`${id}: products split tools by persona; admin has all`, () => {
      const read = (k) => JSON.parse(readText(path.join(repoRoot, "apigee/products", `${id}_tools_mcp_${k}.json`)));
      const ops = (p) => p.payloadOperationGroup.operationConfigs.map((c) => c.operations[0].operation).filter((o) => o !== "tools/list");
      const tools = (persona) => pack.tools.filter((t) => !persona || t.persona === persona).map((t) => `tools/call/${t.name}`);
      assert.deepEqual(ops(read("ops")).sort(), tools("ops").sort());
      assert.deepEqual(ops(read("insights")).sort(), tools("insights").sort());
      assert.deepEqual(ops(read("admin")).sort(), tools().sort());
      for (const k of ["admin", "ops", "insights"]) {
        assert.ok(read(k).payloadOperationGroup.operationConfigs.every((c) => c.apiSource === `${id}-mcp`));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Gemini <-> Claude translation (JS-ClaudeRequestPrep / JS-FormatClaudeResponse)
// ---------------------------------------------------------------------------
describe("MCP bundles block non-allowlisted JSON-RPC methods before the keyless path", () => {
  // The MCP products only define operations for tools/list and tools/call/<tool>, so VerifyAPIKey
  // cannot run on initialize/ping/notifications/* without breaking clients. Everything else must be
  // refused by the gateway rather than forwarded unauthenticated to the backend.
  for (const bundle of ["bigquery-mcp", "servicenow-mcp", ...INDUSTRY_IDS.map((id) => `${id}-mcp`)]) {
    const apiproxy = path.join(proxiesRoot, bundle, "apiproxy");
    it(`${bundle}: RF-MethodNotAllowed exists, is in the manifest and returns JSON-RPC -32601`, () => {
      const rf = readText(path.join(apiproxy, "policies/RF-MethodNotAllowed.xml"));
      assert.match(rf, /<RaiseFault[^>]*name="RF-MethodNotAllowed"/);
      assert.match(rf, /<StatusCode>400<\/StatusCode>/);
      assert.match(rf, /-32601/);
      assert.match(stripComments(readText(path.join(apiproxy, `${bundle}.xml`))), /<Policy>RF-MethodNotAllowed<\/Policy>/);
    });
    it(`${bundle}: RF-MethodNotAllowed runs after PP-MCP and before VA-VerifyAPIKey with the allowlist condition`, () => {
      const flow = stripComments(readText(path.join(apiproxy, "proxies/default.xml")));
      const iPP = flow.indexOf("<Name>PP-MCP</Name>");
      const iRF = flow.indexOf("<Name>RF-MethodNotAllowed</Name>");
      const iVA = flow.indexOf("<Name>VA-VerifyAPIKey</Name>");
      assert.ok(iPP >= 0 && iRF > iPP && iVA > iRF, "expected order PP-MCP -> RF-MethodNotAllowed -> VA-VerifyAPIKey");
      const step = flow.slice(flow.lastIndexOf("<Step>", iRF), flow.indexOf("</Step>", iRF));
      const cond = (/<Condition>([\s\S]*?)<\/Condition>/.exec(step) || [])[1] || "";
      for (const allowed of ['"tools/list"', '"tools/call"', '"initialize"', '"ping"', '"notifications/"']) {
        assert.ok(cond.includes(allowed), `${bundle}: allowlist condition is missing ${allowed}`);
      }
      assert.match(cond, /OPTIONS/, "CORS preflight must bypass the allowlist");
      assert.match(cond, /parsepayload\.PP-MCP\.json-rpc\.request\.method/);
    });
  }

  for (const [bundle, policy] of [
    ["bigquery-mcp", "AM-RemoveAuthorization.xml"],
    ["servicenow-mcp", "AM-RemoveAuthorization.xml"],
    ...INDUSTRY_IDS.map((id) => [`${id}-mcp`, "AM-RemoveAuthorization.xml"]),
    ["customer-service-v1", "AM-RemoveClientAuth.xml"],
    ["business-insights-v1", "AM-RemoveClientAuth.xml"],
  ]) {
    it(`${bundle}: ${policy} strips X-Serverless-Authorization so Cloud Run targets do not 401 on IAP/NEG hop headers`, () => {
      const xml = readText(path.join(proxiesRoot, bundle, "apiproxy/policies", policy));
      assert.match(xml, /<Header name="X-Serverless-Authorization"\/>/);
      assert.match(xml, /<Header name="Authorization"\/>/);
    });
  }
});

const jscDir = path.join(proxiesRoot, "ai-gateway-v1/apiproxy/resources/jsc");
const claudePrepCode = readText(path.join(jscDir, "ClaudeRequestPrep.js"));
const formatClaudeCode = readText(path.join(jscDir, "FormatClaudeResponse.js"));

function runJs(code, vars) {
  const variables = { ...vars };
  const context = {
    getVariable: (n) => (variables[n] !== undefined ? variables[n] : null),
    setVariable: (n, v) => {
      variables[n] = v;
    },
  };
  const request = { content: variables["request.content"] };
  vm.runInNewContext(code, { context, request, JSON, Object, String });
  return variables;
}

const prep = (body, model = "claude-haiku-4-5@20251001") =>
  runJs(claudePrepCode, { "request.content": JSON.stringify(body), "flow.target_model": model });

describe("ClaudeRequestPrep.js - Gemini request -> Anthropic Messages", () => {
  it("translates text turns and carries systemInstruction and generationConfig", () => {
    const vars = prep({
      systemInstruction: { role: "system", parts: [{ text: "Be terse." }, { text: "Use SI units." }] },
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 300, topP: 0.9, stopSequences: ["END"] },
    });
    const out = JSON.parse(vars["request.content"]);
    assert.strictEqual(out.anthropic_version, "vertex-2023-10-16");
    assert.strictEqual(out.system, "Be terse.\nUse SI units.");
    assert.deepStrictEqual(out.messages, [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    assert.strictEqual(out.temperature, 0.2);
    assert.strictEqual(out.max_tokens, 300);
    assert.strictEqual(out.top_p, 0.9);
    assert.deepStrictEqual(out.stop_sequences, ["END"]);
    assert.strictEqual(vars["flow.convert_claude_to_gemini_resp"], "true");
  });

  it("maps functionDeclarations to tools with lower-cased JSON Schema types", () => {
    const out = JSON.parse(
      prep({
        contents: [{ role: "user", parts: [{ text: "weather?" }] }],
        tools: [
          {
            functionDeclarations: [
              { name: "getWeather", description: "d", parameters: { type: "OBJECT", properties: { city: { type: "STRING" } } } },
              { name: "noArgs" },
            ],
          },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
      })["request.content"]
    );
    assert.deepStrictEqual(out.tools[0], {
      name: "getWeather",
      description: "d",
      input_schema: { type: "object", properties: { city: { type: "string" } } },
    });
    assert.deepStrictEqual(out.tools[1].input_schema, { type: "object", properties: {} });
    assert.deepStrictEqual(out.tool_choice, { type: "any" });
    assert.ok(out.max_tokens >= 2048, "tool turns need headroom for tool_use + answer");
  });

  it("drops tools when functionCallingConfig.mode is NONE", () => {
    const out = JSON.parse(
      prep({
        contents: [{ role: "user", parts: [{ text: "x" }] }],
        tools: [{ functionDeclarations: [{ name: "f" }] }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
      })["request.content"]
    );
    assert.strictEqual(out.tools, undefined);
  });

  it("pairs functionCall/functionResponse as tool_use/tool_result and keeps roles alternating", () => {
    const out = JSON.parse(
      prep({
        contents: [
          { role: "user", parts: [{ text: "weather in Paris?" }] },
          { role: "model", parts: [{ functionCall: { name: "getWeather", args: { city: "Paris" } } }] },
          { role: "user", parts: [{ functionResponse: { name: "getWeather", response: { tempC: 18 } } }] },
          { role: "user", parts: [{ text: "and tomorrow?" }] },
        ],
      })["request.content"]
    );
    assert.deepStrictEqual(
      out.messages.map((m) => m.role),
      ["user", "assistant", "user"],
      "consecutive user turns must be merged"
    );
    const toolUse = out.messages[1].content[0];
    assert.strictEqual(toolUse.type, "tool_use");
    assert.deepStrictEqual(toolUse.input, { city: "Paris" });
    const [result, text] = out.messages[2].content;
    assert.strictEqual(result.type, "tool_result");
    assert.strictEqual(result.tool_use_id, toolUse.id, "tool_result must reference the tool_use id");
    assert.strictEqual(result.content, JSON.stringify({ tempC: 18 }));
    assert.deepStrictEqual(text, { type: "text", text: "and tomorrow?" });
  });

  it("passes an Anthropic-native body through, stripping model and defaulting fields", () => {
    const out = JSON.parse(prep({ model: "x", messages: [{ role: "user", content: "hi" }] })["request.content"]);
    assert.strictEqual(out.model, undefined);
    assert.strictEqual(out.anthropic_version, "vertex-2023-10-16");
    assert.strictEqual(out.max_tokens, 1024);
  });
});

describe("FormatClaudeResponse.js - Anthropic response -> Gemini candidates", () => {
  const format = (claude) =>
    JSON.parse(
      runJs(formatClaudeCode, {
        "flow.convert_claude_to_gemini_resp": "true",
        "response.content": JSON.stringify(claude),
        "flow.target_model": "claude-haiku-4-5@20251001",
      })["response.content"]
    );

  it("maps text and tool_use blocks to ordered text/functionCall parts", () => {
    const out = format({
      model: "claude-haiku-4-5",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me " },
        { type: "text", text: "check." },
        { type: "tool_use", id: "toolu_1", name: "getWeather", input: { city: "Paris" } },
        { type: "thinking", thinking: "hidden" },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const cand = out.candidates[0];
    assert.deepStrictEqual(cand.content.parts, [
      { text: "Let me check." },
      { functionCall: { id: "toolu_1", name: "getWeather", args: { city: "Paris" } } },
    ]);
    assert.strictEqual(cand.finishReason, "STOP");
    assert.deepStrictEqual(
      [out.usageMetadata.promptTokenCount, out.usageMetadata.candidatesTokenCount, out.usageMetadata.totalTokenCount],
      [10, 5, 15]
    );
  });

  it("maps max_tokens and refusal stop reasons", () => {
    assert.strictEqual(format({ stop_reason: "max_tokens", content: [{ type: "text", text: "a" }] }).candidates[0].finishReason, "MAX_TOKENS");
    assert.strictEqual(format({ stop_reason: "refusal", content: [] }).candidates[0].finishReason, "SAFETY");
  });

  it("always returns at least one part", () => {
    assert.deepStrictEqual(format({ content: [] }).candidates[0].content.parts, [{ text: "" }]);
  });
});
