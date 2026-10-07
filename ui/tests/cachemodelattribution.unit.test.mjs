import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientPath = path.resolve(__dirname, "../src/services/apigeeClient.ts");
const clientCode = fs.readFileSync(clientPath, "utf8");
const viewerPath = path.resolve(__dirname, "../src/components/GatewayTraceViewer.tsx");
const viewerCode = fs.readFileSync(viewerPath, "utf8");

/**
 * Source with comments stripped.
 *
 * The static guards must run against executable code only. The replacement comments
 * deliberately quote the old `|| targetModel` behaviour to explain why it was removed,
 * and a guard that trips on its own documentation is a guard someone deletes.
 *
 * Line comments go first, then block comments. A prose line comment mentioning a glob
 * that ends in a star contains the characters that open a block comment; stripping
 * blocks first lets that stray opener run forward to the next real close and delete
 * live code, leaving the guards to pass against a hole. That happened for real while
 * this file was being written.
 */
const stripComments = (src) =>
  src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const clientExecutable = stripComments(clientCode);

/**
 * Lift a single `const <name> = ...;` declaration out of the TypeScript module.
 *
 * The attribution rule lives inside a long async function, so it cannot be imported or
 * sliced out wholesale. But the three declarations that implement it are pure
 * expressions over local inputs, so evaluating the REAL source text against injected
 * inputs gives genuine behavioural coverage rather than a second copy of the logic that
 * could drift from the first.
 *
 * Relies on the expressions containing no internal semicolons. If that changes this
 * throws loudly, which is the intended outcome.
 */
function extractDecl(name) {
  const start = clientExecutable.indexOf(`const ${name}`);
  assert.notStrictEqual(
    start, -1,
    `could not find "const ${name}" in apigeeClient.ts -- update this extraction`
  );
  const end = clientExecutable.indexOf(";", start);
  assert.notStrictEqual(end, -1, `unterminated declaration for ${name}`);
  return clientExecutable.slice(start, end + 1).replace(": string | undefined", "");
}

// Dependency order: the flag first, then the two fields that consume it.
const rule = [
  extractDecl("cacheHitUnattributed"),
  extractDecl("effectiveProvider"),
  extractDecl("effectiveModel"),
].join("\n");

/**
 * Evaluate the extracted rule against one set of inputs.
 *
 * `isAuto` mirrors the client: `settings.model === 'auto'`, i.e. the caller hit /auto.
 * It defaults off that same equality so a caller only has to pass it when testing the
 * disagreement between the requested path and what came back.
 */
function resolve({ cacheStatus, headersReceived = {}, targetModel, isAuto = targetModel === "auto" }) {
  const sandbox = { cacheStatus, headersReceived, targetModel, isAuto };
  vm.createContext(sandbox);
  vm.runInContext(
    `${rule}
     this.out = { cacheHitUnattributed, effectiveModel, effectiveProvider };`,
    sandbox
  );
  return sandbox.out;
}

describe("apigeeClient.ts - model attribution on a semantic cache hit", () => {
  describe("1. A cache hit the gateway did not attribute names no model", () => {
    it("does not fall back to the literal \"auto\" on an /auto cache hit", () => {
      // The regression this file exists for. SCL-Semantic-Cache-Lookup keys on the
      // prompt ALONE and the router chain sits in AutoRoutingFlow, so it is skipped
      // entirely on a hit and no x-gateway-model comes back. Falling back to
      // targetModel would print the literal string "auto" to a customer.
      const out = resolve({ cacheStatus: "HIT", targetModel: "auto" });
      assert.strictEqual(out.cacheHitUnattributed, true);
      assert.strictEqual(out.effectiveModel, undefined);
      assert.notStrictEqual(out.effectiveModel, "auto");
    });

    it("does not attribute a direct /models/* cache hit to the requested model", () => {
      // The cache key excludes the model, so a hit on /models/gemini-... can be served
      // bytes that some other model produced. Naming the requested model would be an
      // assertion the gateway cannot back.
      const out = resolve({ cacheStatus: "HIT", targetModel: "gemini-3.1-flash-lite" });
      assert.strictEqual(out.effectiveModel, undefined);
    });

    it("reports no provider either, rather than guessing from the model name", () => {
      const out = resolve({ cacheStatus: "HIT", targetModel: "claude-opus-4-5@20251101" });
      assert.strictEqual(out.effectiveProvider, undefined);
    });
  });

  describe("1b. An /auto call that never reached the router names no model either", () => {
    it("does not report \"auto\" as the model when the call was rejected", () => {
      // A 401 from the identity check comes back with no x-gateway-* headers at all.
      // The old fallback turned that into a confident claim that the router picked a
      // model called "auto" - the URL path segment, printed as a model name.
      const out = resolve({ cacheStatus: "DISABLED", targetModel: "auto" });
      assert.strictEqual(out.cacheHitUnattributed, false);
      assert.strictEqual(out.effectiveModel, undefined);
    });

    it("reports the routed model as soon as the gateway names one", () => {
      const out = resolve({
        cacheStatus: "DISABLED",
        headersReceived: { "x-gateway-model": "claude-opus-4-5@20251101" },
        targetModel: "auto",
      });
      assert.strictEqual(out.effectiveModel, "claude-opus-4-5@20251101");
    });
  });

  describe("2. Attribution still works everywhere it is sound", () => {
    it("honours x-gateway-model on a hit if the gateway ever starts sending it", () => {
      // Forward-compatible: if the cache is later taught to record the originating
      // model, the UI picks it up with no further change.
      const out = resolve({
        cacheStatus: "HIT",
        headersReceived: { "x-gateway-model": "gemini-3.1-pro-preview" },
        targetModel: "auto",
      });
      assert.strictEqual(out.cacheHitUnattributed, false);
      assert.strictEqual(out.effectiveModel, "gemini-3.1-pro-preview");
    });

    it("uses the gateway header on a miss", () => {
      const out = resolve({
        cacheStatus: "MISS",
        headersReceived: { "x-gateway-model": "claude-opus-4-5@20251101" },
        targetModel: "auto",
      });
      assert.strictEqual(out.effectiveModel, "claude-opus-4-5@20251101");
    });

    it("keeps the targetModel fallback when caching is not involved", () => {
      // Only the cache-hit case loses attribution. A direct uncached call still knows
      // exactly which model it invoked.
      const out = resolve({ cacheStatus: "DISABLED", targetModel: "gemini-3.1-flash-lite" });
      assert.strictEqual(out.effectiveModel, "gemini-3.1-flash-lite");
      assert.strictEqual(out.effectiveProvider, "google");
    });

    it("still derives the anthropic provider for an uncached claude call", () => {
      const out = resolve({ cacheStatus: "DISABLED", targetModel: "claude-opus-4-5@20251101" });
      assert.strictEqual(out.effectiveProvider, "anthropic");
    });
  });

  describe("3. The targetModel fallback must not come back", () => {
    it("no longer assigns the model field straight from the header-or-target expression", () => {
      assert.ok(
        !clientExecutable.includes("model: headersReceived['x-gateway-model'] || targetModel"),
        "apigeeClient.ts must not reintroduce the unconditional targetModel fallback"
      );
    });

    it("assigns the telemetry model from the guarded expression", () => {
      assert.ok(
        clientExecutable.includes("model: effectiveModel"),
        "telemetry.model must come from effectiveModel, which honours cacheHitUnattributed"
      );
    });

    it("does not claim Auto-Routed when the router never ran", () => {
      assert.ok(
        clientExecutable.includes("autoRouted: cacheHitUnattributed"),
        "autoRouted must be false on an unattributed cache hit -- isAuto only means the client called /auto"
      );
    });
  });

  describe("4. The trace viewer renders the absence honestly", () => {
    it("labels an unattributed cache hit \"Served from cache\" rather than rendering an empty model", () => {
      assert.ok(
        viewerCode.includes("telemetry.model || (isCacheHit ? 'Served from cache'"),
        "GatewayTraceViewer must label an unattributed cache hit 'Served from cache'"
      );
    });

    it("does not credit the cache for a call that was never cached", () => {
      // A 401 also arrives with no model. Reusing the cache wording there would invent
      // a mechanism that never ran, which is the same class of lie as inventing a model.
      assert.ok(
        viewerCode.includes("'No model reported'"),
        "a missing model on a non-cached call must not be reported as a cache hit"
      );
    });

    it("does not guess a provider when there is no model", () => {
      // The provider line is only reachable inside the `telemetry.model ?` branch, so a
      // missing model cannot fall through to the claude/Google substring guess.
      assert.ok(
        viewerCode.includes("{telemetry.model ? ("),
        "the provider guess must be gated behind the presence of a model"
      );
    });
  });
});
