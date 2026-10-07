import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiproxyDir = path.resolve(__dirname, "../../apigee/proxies/ai-gateway-v1/apiproxy");
const jscDir = path.join(apiproxyDir, "resources/jsc");
const policiesDir = path.join(apiproxyDir, "policies");
const autoRoutingCode = fs.readFileSync(path.join(jscDir, "AutoRouting.js"), "utf8");
const amPrepRouterXml = fs.readFileSync(path.join(policiesDir, "AM-PrepRouterRequest.xml"), "utf8");

/**
 * AutoRouting.js with comments removed.
 *
 * The static guards below assert that no model name and no prompt-classification logic
 * survives in the policy. They have to run against executable code only: comments may
 * legitimately name models (e.g. the header names the TypeSafe AI JEV System One
 * classifier), and a guard that trips on its own documentation is a guard someone deletes.
 */
const autoRoutingExecutable = autoRoutingCode
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * The routing model map as actually configured on the three persona API products.
 *
 * These are NOT test fixtures invented here: they mirror the `routing.model.*` custom
 * attributes in apigee/products/<persona>.json (see PRODUCT_FILES). `productAttributes`
 * below asserts that correspondence against the product JSON itself, so a product edit
 * that is not reflected here fails rather than silently drifting.
 */
const PRODUCT_ROUTING = {
  "Engineering and IT": {
    coding: "claude-opus-4-5@20251101",
    deep_reasoning: "gemini-3.1-pro-preview",
    simple: "gemini-3.1-flash-lite",
    general: "gemini-3-flash-preview",
  },
  "Analysts and Knowledge Workers": {
    coding: "gemini-3.1-pro-preview",
    deep_reasoning: "gemini-3.1-pro-preview",
    simple: "gemini-3.1-flash-lite",
    general: "gemini-3-flash-preview",
  },
  "Customer Support and Sales": {
    coding: "claude-haiku-4-5@20251001",
    deep_reasoning: "gemini-3.1-pro-preview",
    simple: "gemini-3.1-flash-lite",
    general: "gemini-3-flash-preview",
  },
};

/**
 * Routing targets a product reaches only through /auto, without a direct operation for the model.
 * Support & Sales keeps fast, low-cost models for direct calls and uses Pro on /auto only for
 * deep-reasoning questions.
 */
const AUTO_ONLY_TARGETS = {
  "Customer Support and Sales": { deep_reasoning: "gemini-3.1-pro-preview" },
};

/** Product JSON file for each persona product. */
const PRODUCT_FILES = {
  "Engineering and IT": "engineering_and_it.json",
  "Analysts and Knowledge Workers": "analysts_and_knowledge_workers.json",
  "Customer Support and Sales": "customer_support_and_sales.json",
};

/** Builds the TypeSafe AI JEV System One envelope SC-ModelRouter writes to `routerResponse`. */
function jevResponse(category, confidence = 1.0, model = "jev-1.13.0") {
  return JSON.stringify({
    model: model,
    answers: {
      category: {
        type: "choice",
        choice: category,
        confidence: confidence,
        probabilities: {
          coding: category === "coding" ? 1.0 : 0.0,
          deep_reasoning: category === "deep_reasoning" ? 1.0 : 0.0,
          simple: category === "simple" ? 1.0 : 0.0,
          general: category === "general" ? 1.0 : 0.0,
        },
      },
    },
    usage: { input_tokens: 350, output_tokens: 48 },
  });
}

/** Builds the legacy Vertex `generateContent` envelope SC-ModelRouter writes to `routerResponse`. */
function routerResponse(categoryText) {
  return JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text: categoryText }] } }],
  });
}

/**
 * Executes AutoRouting.js in an isolated vm sandbox simulating the Apigee JSC context.
 *
 * `product` selects which set of `routing.model.*` attributes VA-VerifyAPIKey resolved.
 * Pass `attributes: {}` to simulate a product that carries none.
 */
function runAutoRouting({
  routerContent = undefined,
  product = "Engineering and IT",
  attributes = undefined,
  productName = undefined,
} = {}) {
  const resolvedName = productName !== undefined ? productName : product;
  const routingMap = attributes !== undefined ? attributes : PRODUCT_ROUTING[product] || {};

  const variables = {
    "verifyapikey.VA-VerifyAPIKey.apiproduct.name": resolvedName,
  };
  for (const [category, model] of Object.entries(routingMap)) {
    variables[`verifyapikey.VA-VerifyAPIKey.apiproduct.routing.model.${category}`] = model;
  }
  if (routerContent !== undefined) {
    variables["routerResponse.content"] = routerContent;
  }

  const context = {
    getVariable: (name) => (variables[name] !== undefined ? variables[name] : null),
    setVariable: (name, val) => {
      variables[name] = val;
    },
  };

  const sandbox = { context, console };
  vm.createContext(sandbox);
  vm.runInContext(autoRoutingCode, sandbox);

  return {
    targetModel: variables["flow.target_model"],
    model: variables["flow.model"],
    targetProvider: variables["flow.target_provider"],
    autoRouted: variables["flow.autoRouted"],
    routerCategory: variables["flow.routerCategory"],
    routerEngine: variables["flow.routerEngine"],
    routerConfidence: variables["flow.routerConfidence"],
    routingTier: variables["flow.routingTier"],
    costTier: variables["flow.costTier"],
    allVars: variables,
  };
}

/** Evaluates AM-PrepRouterRequest.xml template substitution. */
function runPrepRouter(userPrompt) {
  const payloadMatch = amPrepRouterXml.match(/<Payload contentType="application\/json">([\s\S]*?)<\/Payload>/);
  assert.ok(payloadMatch, "AM-PrepRouterRequest.xml must contain a JSON <Payload>");
  const template = payloadMatch[1].trim();

  const isSkip = !userPrompt || userPrompt.trim() === "";
  const escaped = userPrompt ? JSON.stringify(userPrompt).slice(1, -1) : "";
  const jsonStr = template.replace("{escapeJSON(flow.userPrompt)}", escaped);

  return {
    skip: isSkip ? "true" : "false",
    payload: jsonStr,
    parsed: JSON.parse(jsonStr),
    xml: amPrepRouterXml,
  };
}

describe("AutoRouting.js - LLM Router Model Unit Test Suite", () => {
  describe("1. Router category -> product attribute resolution (Engineering and IT)", () => {
    const cases = [
      ["coding", "claude-opus-4-5@20251101", "anthropic"],
      ["deep_reasoning", "gemini-3.1-pro-preview", "google"],
      ["simple", "gemini-3.1-flash-lite", "google"],
      ["general", "gemini-3-flash-preview", "google"],
    ];

    for (const [category, expectedModel, expectedProvider] of cases) {
      it(`routes JEV category "${category}" to ${expectedModel}`, () => {
        const res = runAutoRouting({
          routerContent: jevResponse(category, 0.98, "jev-1.13.0"),
          product: "Engineering and IT",
        });
        assert.strictEqual(res.routerCategory, category);
        assert.strictEqual(res.targetModel, expectedModel);
        assert.strictEqual(res.model, expectedModel);
        assert.strictEqual(res.targetProvider, expectedProvider);
        assert.strictEqual(res.autoRouted, "true");
        assert.strictEqual(res.routerEngine, "jev-1.13.0");
        assert.strictEqual(res.routerConfidence, "0.98");
      });

      it(`routes legacy Gemini category "${category}" to ${expectedModel}`, () => {
        const res = runAutoRouting({
          routerContent: routerResponse(JSON.stringify({ category })),
          product: "Engineering and IT",
        });
        assert.strictEqual(res.routerCategory, category);
        assert.strictEqual(res.targetModel, expectedModel);
        assert.strictEqual(res.model, expectedModel);
        assert.strictEqual(res.targetProvider, expectedProvider);
        assert.strictEqual(res.autoRouted, "true");
      });
    }
  });

  describe("2. The SAME category resolves differently per product (attribute-driven)", () => {
    // This is the whole point of moving the model map onto the API product: the routing
    // decision is one classification, and entitlement is applied by the product. If these
    // two ever return the same model for `coding`, the tier cap has stopped working.
    it("routes coding to Opus / Pro / Haiku depending on the persona product", () => {
      const run = (product) =>
        runAutoRouting({ routerContent: routerResponse('{"category": "coding"}'), product });
      const eng = run("Engineering and IT");
      const analysts = run("Analysts and Knowledge Workers");
      const support = run("Customer Support and Sales");

      assert.strictEqual(eng.targetModel, "claude-opus-4-5@20251101");
      assert.strictEqual(eng.targetProvider, "anthropic");
      assert.strictEqual(analysts.targetModel, "gemini-3.1-pro-preview");
      assert.strictEqual(analysts.targetProvider, "google");
      assert.strictEqual(support.targetModel, "claude-haiku-4-5@20251001");
      assert.strictEqual(support.targetProvider, "anthropic");
    });

    it("never routes Customer Support & Sales to Opus, and to Pro only for deep reasoning; never Analysts to Claude", () => {
      for (const category of ["coding", "deep_reasoning", "simple", "general"]) {
        const support = runAutoRouting({
          routerContent: routerResponse(JSON.stringify({ category })),
          product: "Customer Support and Sales",
        });
        assert.notStrictEqual(support.targetModel, "claude-opus-4-5@20251101");
        // Pro only where the question needs it (Agent Showcase scenario 8); fast models otherwise.
        if (category !== "deep_reasoning") assert.notStrictEqual(support.targetModel, "gemini-3.1-pro-preview");

        const analysts = runAutoRouting({
          routerContent: routerResponse(JSON.stringify({ category })),
          product: "Analysts and Knowledge Workers",
        });
        assert.strictEqual(analysts.targetProvider, "google");
      }
    });
  });

  describe("3. Router response parsing robustness", () => {
    it("parses a pretty-printed JSON body", () => {
      const res = runAutoRouting({
        routerContent: routerResponse('{\n  "category": "deep_reasoning"\n}'),
      });
      assert.strictEqual(res.routerCategory, "deep_reasoning");
      assert.strictEqual(res.targetModel, "gemini-3.1-pro-preview");
    });

    it("strips ```json fences before parsing", () => {
      const res = runAutoRouting({
        routerContent: routerResponse('```json\n{"category": "coding"}\n```'),
      });
      assert.strictEqual(res.routerCategory, "coding");
      assert.strictEqual(res.targetModel, "claude-opus-4-5@20251101");
    });

    it("recovers the category by regex when the body is not valid JSON", () => {
      // Guards the `catch` arm of extractCategory: a truncated body still carries a
      // usable decision, and discarding it would silently demote the request to general.
      const res = runAutoRouting({
        routerContent: routerResponse('{"category": "simple", "confidence":'),
      });
      assert.strictEqual(res.routerCategory, "simple");
      assert.strictEqual(res.targetModel, "gemini-3.1-flash-lite");
    });

    it("normalises case and surrounding whitespace in the category", () => {
      const res = runAutoRouting({
        routerContent: routerResponse('{"category": "  CODING  "}'),
      });
      assert.strictEqual(res.routerCategory, "coding");
      assert.strictEqual(res.targetModel, "claude-opus-4-5@20251101");
    });
  });

  describe("4. Router unavailable -> general attribute, never a hardcoded model", () => {
    // The regex heuristics and the hardcoded per-tier model map were both deleted. The
    // ONLY remaining source of a model name is the API product, so every degraded path
    // has to land on `routing.model.general` rather than on a literal in the policy.
    const degraded = [
      ["callout never ran (empty prompt / skipped)", undefined],
      ["callout timed out and left no body", ""],
      ["callout returned an error envelope", '{"error":{"code":429,"message":"quota"}}'],
      ["callout returned no candidates", '{"candidates":[]}'],
      ["callout returned unparseable content", "not-json-at-all"],
      ["candidate carried no recognisable category", routerResponse('{"label":"coding"}')],
    ];

    for (const [label, content] of degraded) {
      it(`falls back to routing.model.general when the ${label}`, () => {
        const res = runAutoRouting({ routerContent: content, product: "Engineering and IT" });
        assert.strictEqual(res.routerCategory, null, "category must stay unresolved");
        assert.strictEqual(res.targetModel, "gemini-3-flash-preview");
        assert.strictEqual(res.targetProvider, "google");
        assert.strictEqual(res.autoRouted, "true");
      });
    }

    it("falls back to general when the router invents a category the product does not map", () => {
      // The responseSchema enum makes this unlikely, not impossible. An unmapped category
      // must degrade to the product's general model, not to null.
      const res = runAutoRouting({
        routerContent: routerResponse('{"category": "translation"}'),
        product: "Engineering and IT",
      });
      assert.strictEqual(res.routerCategory, "translation");
      assert.strictEqual(res.targetModel, "gemini-3-flash-preview");
    });
  });

  describe("5. No hardcoded model map survives in the policy", () => {
    it("resolves nothing when the product carries no routing attributes", () => {
      // Deliberate. A product that grants /auto without declaring routing.model.* is a
      // misconfiguration, and the policy must surface it rather than quietly hand out a
      // model the product may not even entitle. This test is what fails if someone
      // reintroduces the old per-tier literals as a "safety net".
      for (const category of ["coding", "deep_reasoning", "simple", "general"]) {
        const res = runAutoRouting({
          routerContent: routerResponse(JSON.stringify({ category })),
          attributes: {},
          productName: "Engineering and IT",
        });
        assert.strictEqual(
          res.targetModel,
          null,
          `a product with no attributes must not yield a model (category: ${category})`
        );
      }
    });

    it("contains no model literal in the executable source", () => {
      // Static guard on the file itself. The runtime tests above can be satisfied by a
      // literal that happens to agree with the product; this cannot.
      //
      // Comments are stripped first, deliberately. Comments may name models for
      // context (the header names the JEV classifier) -- a guard that fires on its
      // own documentation just gets disabled.
      for (const literal of [
        "claude-opus-4-5@20251101",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
      ]) {
        assert.ok(
          !autoRoutingExecutable.includes(literal),
          `AutoRouting.js must not hardcode the model name ${literal}`
        );
      }
    });

    it("contains no prompt-classification logic in the executable source", () => {
      // The classification now belongs to the router model. A regex creeping back in
      // would mean two disagreeing classifiers and a decision that depends on timing.
      // flow.userPrompt is included: AutoRouting.js must no longer read the prompt at all.
      for (const marker of ["isCoding", "isDeepReasoning", "isSimple", "flow.userPrompt"]) {
        assert.ok(
          !autoRoutingExecutable.includes(marker),
          `AutoRouting.js must not classify prompts itself (found ${marker})`
        );
      }
    });
  });

  describe("6. Tier tracing and provider selection", () => {
    it("reports the persona product that supplied the routing map", () => {
      const res = runAutoRouting({
        routerContent: routerResponse('{"category":"simple"}'),
        product: "Customer Support and Sales",
      });
      assert.strictEqual(res.routingTier, "Customer Support and Sales");
    });

    it("reports unknown when the product name is blank", () => {
      const res = runAutoRouting({
        routerContent: routerResponse('{"category":"simple"}'),
        product: "Customer Support and Sales",
        productName: "",
      });
      assert.strictEqual(res.routingTier, "unknown");
    });

    it("selects the anthropic provider from the resolved model name alone", () => {
      // Provider is derived, not configured. A product could map any category to a Claude
      // model and the Claude RouteRule still has to fire.
      const res = runAutoRouting({
        routerContent: routerResponse('{"category":"simple"}'),
        attributes: { simple: "claude-haiku-4-5@20251001" },
      });
      assert.strictEqual(res.targetModel, "claude-haiku-4-5@20251001");
      assert.strictEqual(res.targetProvider, "anthropic");
    });

    it("defaults the provider to google when no model resolves", () => {
      // Regression guard: reading .indexOf on a null model threw and took the whole
      // policy down, which turns a misconfigured product into a 500 for the caller.
      const res = runAutoRouting({ attributes: {} });
      assert.strictEqual(res.targetModel, null);
      assert.strictEqual(res.targetProvider, "google");
    });
  });

  describe("7. Separation of concerns", () => {
    it("sets NO costing variables - routing selects a model, nothing else", () => {
      // Routing used to hardcode a costTier literal beside each decision, which then beat
      // the KVM-resolved rate in CalculateCost.js on the /auto path. Costing lives in
      // exactly one place.
      for (const category of ["coding", "deep_reasoning", "simple", "general"]) {
        for (const product of ["Customer Support and Sales", "Engineering and IT"]) {
          const res = runAutoRouting({
            routerContent: routerResponse(JSON.stringify({ category })),
            product,
          });
          assert.strictEqual(res.costTier, undefined);
          assert.strictEqual(res.allVars["flow.tx_cost_usd"], undefined);
          assert.strictEqual(res.allVars["flow.tx_cost_micros"], undefined);
        }
      }
    });

    it("populates every variable the downstream flow reads", () => {
      const res = runAutoRouting({ routerContent: routerResponse('{"category":"coding"}') });
      assert.ok(res.allVars["flow.target_model"]);
      assert.ok(res.allVars["flow.model"]);
      assert.ok(res.allVars["flow.target_provider"]);
      assert.ok(res.allVars["flow.routerCategory"]);
      assert.ok(res.allVars["flow.routingTier"]);
      assert.strictEqual(res.allVars["flow.autoRouted"], "true");
    });
  });
});

describe("AM-PrepRouterRequest.xml - Router Callout Payload & Auth", () => {
  it("skips the callout on an empty prompt via flow condition", () => {
    for (const prompt of ["", "   ", "\n\t "]) {
      const res = runPrepRouter(prompt);
      assert.strictEqual(res.skip, "true", `expected skip for ${JSON.stringify(prompt)}`);
    }
  });

  it("builds a callout payload for a real prompt", () => {
    const res = runPrepRouter("def fib(n): pass");
    assert.strictEqual(res.skip, "false");
    assert.ok(res.parsed.state.includes("def fib(n): pass"));
    assert.strictEqual(res.parsed.model, "jev-latest");
  });

  it("authenticates via private.typesafe_api_key loaded from encrypted KVM", () => {
    assert.ok(
      amPrepRouterXml.includes('<Header name="Authorization">Bearer {private.typesafe_api_key}</Header>'),
      "AM-PrepRouterRequest must reference private.typesafe_api_key from KVM"
    );
    assert.ok(
      !amPrepRouterXml.includes("apikey_"),
      "AM-PrepRouterRequest must never contain plain-text API keys"
    );
  });

  it("pins the question to the four-category criteria schema", () => {
    const { parsed } = runPrepRouter("hello");
    const q = parsed.questions.category;
    assert.strictEqual(q.type, "choice");
    assert.deepStrictEqual(Object.keys(q.criteria).sort(), [
      "coding",
      "deep_reasoning",
      "general",
      "simple",
    ]);
  });

  it("emits a payload that is valid JSON using escapeJSON", () => {
    const { payload } = runPrepRouter('He said "hi"\nthen {left};');
    assert.doesNotThrow(() => JSON.parse(payload));
  });
});

describe("AutoRouting.js - JEV response edge cases", () => {
  it("accepts a top-level { category } body and records the router engine", () => {
    const res = runAutoRouting({
      routerContent: JSON.stringify({ category: "Coding", model: "jev-x" }),
      product: "Engineering and IT",
    });
    assert.strictEqual(res.routerCategory, "coding");
    assert.strictEqual(res.targetModel, "claude-opus-4-5@20251101");
    assert.strictEqual(res.routerEngine, "jev-x");
  });

  it("keeps a zero confidence rather than dropping it as falsy", () => {
    const res = runAutoRouting({ routerContent: jevResponse("simple", 0) });
    assert.strictEqual(res.routerConfidence, "0");
    assert.strictEqual(res.targetModel, "gemini-3.1-flash-lite");
  });

  it("falls back to routing.model.general when the JEV answer carries no choice", () => {
    const res = runAutoRouting({
      routerContent: JSON.stringify({ model: "jev-1.13.0", answers: { category: { type: "choice" } } }),
    });
    assert.strictEqual(res.routerCategory, null);
    assert.strictEqual(res.targetModel, "gemini-3-flash-preview");
    assert.strictEqual(res.autoRouted, "true");
  });

  it("falls back to routing.model.general on a JEV 401 error body (bad/missing KVM key)", () => {
    const res = runAutoRouting({ routerContent: '{"error":"unauthorized"}' });
    assert.strictEqual(res.routerCategory, null);
    assert.strictEqual(res.targetModel, "gemini-3-flash-preview");
  });
});

describe("Router chain wiring - KVM credentials, AssignMessage, ServiceCallout, flow", () => {
  const read = (rel) => fs.readFileSync(path.join(apiproxyDir, rel), "utf8");
  const kvmXml = read("policies/KVM-GetRouterCredentials.xml");
  const scXml = read("policies/SC-ModelRouter.xml");
  const proxyXml = read("proxies/default.xml");
  const manifestXml = read("ai-gateway-v1.xml");

  /** Returns [{name, condition}] for the steps inside the named conditional flow. */
  function flowSteps(flowName) {
    const flow = proxyXml.match(new RegExp(`<Flow name="${flowName}">([\\s\\S]*?)</Flow>`));
    assert.ok(flow, `default.xml must define the ${flowName} conditional flow`);
    const request = flow[1].match(/<Request>([\s\S]*?)<\/Request>/);
    assert.ok(request, `${flowName} must have a <Request> block`);
    return [...request[1].matchAll(/<Step>([\s\S]*?)<\/Step>/g)].map((m) => ({
      name: (m[1].match(/<Name>([^<]+)<\/Name>/) || [])[1],
      condition: ((m[1].match(/<Condition>([\s\S]*?)<\/Condition>/) || [])[1] || "").trim(),
    }));
  }

  describe("KVM-GetRouterCredentials", () => {
    it("reads the ai-gateway-creds map at environment scope", () => {
      assert.match(kvmXml, /<KeyValueMapOperations\b[^>]*\bmapIdentifier="ai-gateway-creds"/);
      assert.match(kvmXml, /<Scope>environment<\/Scope>/);
    });

    it("names the key as a <Parameter> text node, not a value= attribute", () => {
      // Regression guard for 7c881ad, which replaced <Parameter value="typesafe_api_key"/>
      // with the text-node form. Without a resolvable key the router call goes out with
      // an empty bearer token and every /auto request degrades to routing.model.general.
      assert.match(kvmXml, /<Key>\s*<Parameter>typesafe_api_key<\/Parameter>\s*<\/Key>/);
      assert.doesNotMatch(kvmXml, /<Parameter\b[^>]*\bvalue=/);
      assert.doesNotMatch(kvmXml, /<Parameter\b[^>]*\bref=/);
    });

    it("assigns into a private. variable so the key is masked in trace and never logged", () => {
      assert.match(kvmXml, /<Get\b[^>]*\bassignTo="private\.typesafe_api_key"/);
    });

    it("never seeds or writes the secret from the bundle", () => {
      // <InitialEntries> or <Put> would put the credential in the proxy XML itself.
      assert.doesNotMatch(kvmXml, /<InitialEntries/);
      assert.doesNotMatch(kvmXml, /<Put\b/);
    });
  });

  describe("AM-PrepRouterRequest", () => {
    it("builds a fresh routerRequest message rather than mutating the client request", () => {
      assert.match(amPrepRouterXml, /<AssignTo\b[^>]*createNew="true"[^>]*>routerRequest<\/AssignTo>/);
      assert.match(amPrepRouterXml, /<Verb>POST<\/Verb>/);
    });

    it("reads the key only from the private. KVM variable", () => {
      const auth = amPrepRouterXml.match(/<Header name="Authorization">([^<]*)<\/Header>/);
      assert.ok(auth, "AM-PrepRouterRequest must set an Authorization header");
      assert.strictEqual(auth[1], "Bearer {private.typesafe_api_key}");
    });
  });

  describe("SC-ModelRouter", () => {
    it("calls the TypeSafe AI JEV System One endpoint", () => {
      const url = scXml.match(/<URL>([^<]+)<\/URL>/);
      assert.ok(url, "SC-ModelRouter must declare an HTTPTargetConnection URL");
      assert.strictEqual(url[1].trim(), "https://api.typesafe.ai/v1/systemone");
    });

    it("sends routerRequest and stores routerResponse (the variable AutoRouting.js reads)", () => {
      assert.match(scXml, /<Request\b[^>]*\bvariable="routerRequest"/);
      assert.match(scXml, /<Response>routerResponse<\/Response>/);
      assert.ok(autoRoutingCode.includes('"routerResponse.content"'));
    });

    it("fails open with a bounded timeout", () => {
      // A router outage must degrade to the product's general model, not fail the call.
      assert.match(scXml, /<ServiceCallout\b[^>]*continueOnError="true"/);
      assert.match(scXml, /<Timeout>\d+<\/Timeout>/);
    });

    it("no longer uses a Gemini/Vertex model as the router", () => {
      assert.doesNotMatch(scXml, /aiplatform\.googleapis\.com|generateContent|GoogleAccessToken/);
      assert.doesNotMatch(amPrepRouterXml, /gemini/i);
    });
  });

  describe("AutoRoutingFlow (proxies/default.xml)", () => {
    it("enforces the token quota, then runs KVM -> AM -> SC -> JS in that order", () => {
      assert.deepStrictEqual(
        flowSteps("AutoRoutingFlow").map((s) => s.name),
        ["LTQ-TokenEnforce", "KVM-GetRouterCredentials", "AM-PrepRouterRequest", "SC-ModelRouter", "JS-AutoRouting"]
      );
    });

    it("skips the KVM read and callout on an empty prompt, but always runs JS-AutoRouting", () => {
      const steps = Object.fromEntries(flowSteps("AutoRoutingFlow").map((s) => [s.name, s.condition]));
      const guard = 'flow.userPrompt != null and flow.userPrompt != ""';
      assert.strictEqual(steps["KVM-GetRouterCredentials"], guard);
      assert.strictEqual(steps["AM-PrepRouterRequest"], guard);
      assert.strictEqual(steps["SC-ModelRouter"], guard);
      assert.strictEqual(steps["JS-AutoRouting"], "", "JS-AutoRouting must be unconditional");
    });

    it("never guards the router chain on flow.cached (it reads \"true\" on a miss too)", () => {
      for (const s of flowSteps("AutoRoutingFlow")) {
        assert.ok(!s.condition.includes("flow.cached"), `${s.name} must not be gated on flow.cached`);
      }
    });

    it("keeps the router chain out of the PreFlow (it belongs after the cache lookup)", () => {
      const preflow = proxyXml.match(/<PreFlow name="PreFlow">([\s\S]*?)<\/PreFlow>/)[1];
      for (const name of ["KVM-GetRouterCredentials", "AM-PrepRouterRequest", "SC-ModelRouter", "JS-AutoRouting"]) {
        assert.ok(!preflow.includes(`<Name>${name}</Name>`), `${name} must not run in the PreFlow`);
      }
    });

    it("is declared after LLMTokenLimitFlow (first matching conditional flow wins)", () => {
      const ltq = proxyXml.indexOf('<Flow name="LLMTokenLimitFlow">');
      const auto = proxyXml.indexOf('<Flow name="AutoRoutingFlow">');
      assert.ok(ltq !== -1 && auto !== -1 && ltq < auto);
    });

    it("matches the /auto path suffix", () => {
      const flow = proxyXml.match(/<Flow name="AutoRoutingFlow">[\s\S]*?(?:<Response\/>|<\/Response>)\s*<Condition>([\s\S]*?)<\/Condition>/);
      assert.ok(flow);
      assert.ok(flow[1].includes('proxy.pathsuffix MatchesPath "/auto*"'));
    });
  });

  describe("No dead references to the removed JS router prep or legacy proxy", () => {
    it("PrepRouterRequest.js and JS-PrepRouterRequest are gone from the bundle", () => {
      assert.ok(!fs.existsSync(path.join(jscDir, "PrepRouterRequest.js")));
      assert.ok(!fs.existsSync(path.join(policiesDir, "JS-PrepRouterRequest.xml")));
      for (const text of [manifestXml, proxyXml]) {
        assert.ok(!text.includes("PrepRouterRequest.js"));
        assert.ok(!text.includes("JS-PrepRouterRequest"));
      }
    });

    it("the vertex-ai-v1 proxy bundle is no longer in the repo", () => {
      assert.ok(!fs.existsSync(path.resolve(apiproxyDir, "../../vertex-ai-v1")));
    });
  });
});

describe("API products back the routing attributes the policy reads", () => {
  const productsDir = path.resolve(__dirname, "../../apigee/products");

  for (const [productName, expected] of Object.entries(PRODUCT_ROUTING)) {
    const file = PRODUCT_FILES[productName];

    it(`${file} declares every routing.model.* attribute the router can emit`, () => {
      const data = JSON.parse(fs.readFileSync(path.join(productsDir, file), "utf8"));
      const attrs = Object.fromEntries(data.attributes.map((a) => [a.name, a.value]));

      for (const [category, model] of Object.entries(expected)) {
        assert.strictEqual(
          attrs[`routing.model.${category}`],
          model,
          `${file} must map routing.model.${category} to ${model}`
        );
      }
    });

    it(`${file} only routes to models it actually entitles (or a listed /auto-only target)`, () => {
      // Keep routing targets to models the product grants, so a persona's /auto reach matches
      // its direct reach. The one deliberate exception is AUTO_ONLY_TARGETS: the key check on
      // /auto runs against the /auto operation (verified on prod 28 Sep 2026: Support & Sales
      // deep_reasoning -> gemini-3.1-pro-preview returns 200), so the product can use Pro for
      // hard questions on /auto without granting direct Pro calls.
      const data = JSON.parse(fs.readFileSync(path.join(productsDir, file), "utf8"));
      const granted = new Set(
        data.llmOperationGroup.operationConfigs.flatMap((oc) => oc.llmOperations.map((op) => op.model))
      );
      const autoOnly = AUTO_ONLY_TARGETS[productName] || {};

      for (const [category, model] of Object.entries(expected)) {
        if (autoOnly[category] === model) continue;
        assert.ok(
          granted.has(model),
          `${file} maps ${category} to ${model}, which the product does not entitle`
        );
      }
    });
  }
});
