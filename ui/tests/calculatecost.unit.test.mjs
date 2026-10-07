import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../..");
const calculateCostPath = path.resolve(
  repoRoot,
  "apigee/proxies/ai-gateway-v1/apiproxy/resources/jsc/CalculateCost.js"
);
const rateCardPath = path.resolve(repoRoot, "apigee/config/model_rate_card.json");

const calculateCostCode = fs.readFileSync(calculateCostPath, "utf8");
const rateCard = JSON.parse(fs.readFileSync(rateCardPath, "utf8"));

// The KVM holds the card verbatim; the "_comment" array is documentation only.
const kvmRateCardJson = JSON.stringify(rateCard);

/**
 * Executes CalculateCost.js in an isolated Node vm sandbox simulating the Apigee
 * JSC context, seeded with the REAL rate card that sync_rate_card.sh pushes to the
 * ai-model-rates KVM. This is the single costing authority in the proxy: routing
 * no longer contributes a cost tier and AM-SetCacheHitExpected no longer
 * contributes a cost.
 */
function runCalculateCost({
  model = "gemini-3-flash-preview",
  promptTokens = 100,
  candidatesTokens = 50,
  thoughtsTokens = 0,
  totalTokens = null,
  cached = false,
  rateCardJson = kvmRateCardJson,
  extraVars = {},
} = {}) {
  const variables = {
    "flow.target_model": model,
    "flow.promptTokenCount": String(promptTokens),
    "flow.candidatesTokenCount": String(candidatesTokens),
    "flow.thoughtsTokenCount": String(thoughtsTokens),
    "flow.model_rates_json": rateCardJson,
    ...extraVars,
  };
  if (totalTokens !== null) variables["flow.totalTokenCount"] = String(totalTokens);
  if (cached) variables["flow.cached"] = "true";

  const context = {
    getVariable: (name) => (variables[name] !== undefined ? variables[name] : null),
    setVariable: (name, val) => {
      variables[name] = val;
    },
  };

  const sandbox = { context, console };
  vm.createContext(sandbox);
  vm.runInContext(calculateCostCode, sandbox);

  return {
    costTier: variables["flow.costTier"],
    costUsd: variables["flow.tx_cost_usd"],
    costMicros: variables["flow.tx_cost_micros"],
    promptTokens: variables["flow.promptTokenCount"],
    candidatesTokens: variables["flow.candidatesTokenCount"],
    totalTokens: variables["flow.totalTokenCount"],
    multiplier: variables["perUnitPriceMultiplier"],
    allVars: variables,
  };
}

/** The banding rule documented in model_rate_card.json: low <= 0.30, high >= 5.00. */
function expectedTierForOutputRate(outputRate) {
  if (outputRate >= 5.0) return "high";
  if (outputRate <= 0.3) return "low";
  return "medium";
}

const modelEntries = Object.entries(rateCard).filter(
  ([key, val]) => key !== "_comment" && key !== "default" && val && val.input !== undefined
);

describe("CalculateCost.js - the single costing authority", () => {
  describe("1. Cost tier is derived from the KVM rate, for every model on the card", () => {
    for (const [model, entry] of modelEntries) {
      it(`derives "${entry.tier}" for ${model} (output ${entry.output})`, () => {
        const res = runCalculateCost({ model });
        assert.strictEqual(res.costTier, entry.tier);
        // Guards the card against itself: a hand-edited tier that contradicts the
        // banding rule would make the KVM disagree with the header the proxy emits.
        assert.strictEqual(
          entry.tier,
          expectedTierForOutputRate(entry.output),
          `${model}: declared tier "${entry.tier}" contradicts its output rate ${entry.output}`
        );
      });
    }
  });

  describe("2. Tier is never inferred from the model name", () => {
    it('prices the "flash" models above the Pro model', () => {
      // gemini-3.7/3.8-flash bill at 7.50, above gemini-3.1-pro-preview's 5.00.
      // A substring match on "flash" would label them cheap.
      assert.strictEqual(runCalculateCost({ model: "gemini-3.7-flash" }).costTier, "high");
      assert.strictEqual(runCalculateCost({ model: "gemini-3.8-flash" }).costTier, "high");
      assert.strictEqual(runCalculateCost({ model: "gemini-3.1-flash-lite" }).costTier, "low");
    });

    it("resolves a versioned Anthropic id by stripping the @version suffix", () => {
      const res = runCalculateCost({ model: "claude-opus-4-5@20251101" });
      assert.strictEqual(res.costTier, "high");
      assert.ok(parseFloat(res.costUsd) > 0);
    });
  });

  describe("3. Every /auto target resolves on the card", () => {
    // These are the only four models AutoRouting.js can select. A target missing
    // from the card silently falls through to the "default" rate and under-bills.
    const autoTargets = [
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "claude-opus-4-5@20251101",
    ];

    for (const model of autoTargets) {
      it(`${model} has an explicit rate-card entry`, () => {
        const base = model.split("@")[0];
        assert.ok(rateCard[base], `${base} is missing from model_rate_card.json`);
        const res = runCalculateCost({ model });
        assert.strictEqual(res.costTier, rateCard[base].tier);
      });
    }
  });

  describe("4. Thinking tokens are billed at the output rate", () => {
    it("folds thoughtsTokenCount into the completion count", () => {
      // Measured shape of a reasoning call: 7 prompt / 1 candidate / 84 thoughts.
      const res = runCalculateCost({
        model: "gemini-3.7-flash",
        promptTokens: 7,
        candidatesTokens: 1,
        thoughtsTokens: 84,
      });
      assert.strictEqual(res.candidatesTokens, "85");
      const expected = (7 / 1e6) * 1.5 + (85 / 1e6) * 7.5;
      assert.strictEqual(res.costUsd, expected.toFixed(6));
    });

    it("never lets the provider total shrink the figure below our own sum", () => {
      const res = runCalculateCost({
        promptTokens: 100,
        candidatesTokens: 50,
        thoughtsTokens: 0,
        totalTokens: 10,
      });
      assert.strictEqual(res.totalTokens, "150");
    });
  });

  describe("5. Semantic-cache hits", () => {
    it("still carry a cost tier", () => {
      // Regression guard. Costing used to be skipped entirely on a hit, so
      // x-gateway-cost-tier came back empty while every other response had one.
      const res = runCalculateCost({ model: "gemini-3.1-flash-lite", cached: true });
      assert.strictEqual(res.costTier, "low");
    });

    it("cost exactly zero, with no micro-dollar floor", () => {
      const res = runCalculateCost({ model: "claude-opus-4-5@20251101", cached: true });
      assert.strictEqual(res.costUsd, "0.000000");
      // Real calls floor at 1 micro-dollar via Math.max(1, ...); a hit must not.
      assert.strictEqual(res.costMicros, "0");
    });

    it("tell Monetization there is nothing to charge", () => {
      // Leaving these unset let DC-ModelAnalytics' defaults (multiplier 1.0,
      // transactionSuccess true) bill every hit one $0.001 unit to the prepaid wallet.
      const res = runCalculateCost({ cached: true });
      assert.strictEqual(res.multiplier, "0");
      assert.strictEqual(res.allVars["transactionSuccess"], "false");
      assert.strictEqual(res.allVars["currency"], "USD");
    });

    it("leave the token counts as the response flow found them", () => {
      // DC-ModelAnalytics runs on hits too; rewriting these would change what a
      // hit reports today.
      const res = runCalculateCost({ promptTokens: 100, candidatesTokens: 50, cached: true });
      assert.strictEqual(res.promptTokens, "100");
      assert.strictEqual(res.candidatesTokens, "50");
    });
  });

  describe("6. Non-cached calls are unchanged", () => {
    it("emits cost, micro-dollars and the monetization multiplier", () => {
      const res = runCalculateCost({
        model: "gemini-3-flash-preview",
        promptTokens: 1000,
        candidatesTokens: 1000,
      });
      const expected = (1000 / 1e6) * 0.15 + (1000 / 1e6) * 0.6;
      assert.strictEqual(res.costUsd, expected.toFixed(6));
      assert.strictEqual(res.costMicros, String(Math.round(expected * 1e6)));
      // Base fee is $0.001, so the multiplier must be USD * 1000.
      assert.strictEqual(res.multiplier, (expected * 1000).toFixed(6));
      assert.strictEqual(res.allVars["currency"], "USD");
    });

    it("floors a near-zero cost at one micro-dollar", () => {
      const res = runCalculateCost({
        model: "gemini-3.1-flash-lite",
        promptTokens: 1,
        candidatesTokens: 0,
      });
      assert.strictEqual(res.costMicros, "1");
    });

    it("deducts the cost from the prepaid wallet estimate", () => {
      const res = runCalculateCost({
        model: "gemini-3-flash-preview",
        promptTokens: 1000,
        candidatesTokens: 1000,
        extraVars: { "mint.limitscheck.prepaid_developer_balance": "20.0" },
      });
      const expected = (1000 / 1e6) * 0.15 + (1000 / 1e6) * 0.6;
      assert.strictEqual(res.allVars["flow.prepaid_balance_remaining"], (20.0 - expected).toFixed(6));
    });
  });

  describe("7. Rate resolution: the KVM is the only source", () => {
    it("falls back to the KVM default for an unknown model", () => {
      const res = runCalculateCost({ model: "some-model-that-does-not-exist" });
      assert.strictEqual(res.costTier, rateCard["default"].tier);
      assert.strictEqual(res.allVars["flow.cost_source"], "kvm");
    });

    it("prices from the KVM and says so", () => {
      const res = runCalculateCost({ model: "gemini-3.1-pro-preview", promptTokens: 1_000_000, candidatesTokens: 0 });
      assert.strictEqual(parseFloat(res.costUsd), rateCard["gemini-3.1-pro-preview"].input);
      assert.strictEqual(res.allVars["flow.cost_source"], "kvm");
    });

    for (const [label, json] of [["malformed", "{not json"], ["missing", null]]) {
      it(`reports a ${label} rate card instead of guessing a price`, () => {
        const res = runCalculateCost({ rateCardJson: json });
        assert.strictEqual(res.costTier, "unknown");
        assert.strictEqual(res.costUsd, undefined);
        assert.strictEqual(res.costMicros, undefined, "no cost means QC-DeductBudget is skipped");
        assert.match(res.allVars["flow.cost_source"], /^unavailable: /);
        assert.strictEqual(res.allVars["transactionSuccess"], "false", "monetization must not bill a flat default");
        assert.strictEqual(res.multiplier, undefined);
      });
    }

    it("has no second rate source in the bundle", () => {
      assert.ok(!calculateCostCode.includes("propertyset"), "CalculateCost.js must not read a property set");
      const bundle = path.join(repoRoot, "apigee/proxies/ai-gateway-v1/apiproxy");
      assert.ok(!fs.existsSync(path.join(bundle, "resources/properties/model_rates.properties")));
      const kvm = fs.readFileSync(path.join(bundle, "policies/KVM-GetModelRates.xml"), "utf8");
      // <Parameter value="..."/> is not KVM syntax: the key resolved empty and the
      // Get silently returned nothing, so the property set priced every call.
      assert.match(kvm, /<Parameter>rate_card<\/Parameter>/);
    });
  });
});
