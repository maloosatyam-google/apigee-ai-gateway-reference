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

/**
 * apigeeClient.ts with comments removed.
 *
 * The static guards below assert the model-name intent heuristic is gone. They must run
 * against executable code only: the replacement comment deliberately quotes the old
 * "General / Fast" behaviour to explain why it was removed, and a guard that trips on its
 * own documentation is a guard someone deletes.
 *
 * Line comments are stripped BEFORE block comments, and the order matters. A prose line
 * comment mentioning a glob such as a models path ending in a star contains the
 * characters that open a block comment, and stripping blocks first makes that stray
 * opener match forward to the next real close, deleting live code from this string. The
 * guards would then pass against a hole rather than against the source. Observed for
 * real while adding the cache-attribution guards.
 */
const clientExecutable = clientCode
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * `formatRouterCategory` lifted out of the TypeScript module and made runnable.
 *
 * There is no TS pipeline in this test harness (node --test over .mjs), and the module
 * cannot be imported directly because it uses extensionless relative imports that node's
 * native ESM resolver rejects. The function is pure, so slicing it out and erasing its
 * type annotations gives real behavioural coverage rather than source-shape assertions.
 *
 * If someone refactors the function's signature this extraction fails loudly, which is
 * the intended outcome: better a broken test than a silently unverified label mapping.
 */
const sliceStart = clientCode.indexOf("const ROUTER_CATEGORY_LABELS");
const sliceEnd = clientCode.indexOf("export async function sendPromptToApigee");
assert.ok(
  sliceStart !== -1 && sliceEnd !== -1 && sliceEnd > sliceStart,
  "could not locate formatRouterCategory in apigeeClient.ts -- update this extraction"
);

const runnable = clientCode
  .slice(sliceStart, sliceEnd)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(": Record<string, string>", "")
  .replace("export function formatRouterCategory(raw?: string): string | undefined {",
           "function formatRouterCategory(raw) {");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${runnable}\nthis.formatRouterCategory = formatRouterCategory;`, sandbox);
const { formatRouterCategory } = sandbox;

describe("apigeeClient.ts - router category labelling", () => {
  describe("1. The gateway's category is the only source of the intent label", () => {
    it("maps every router category to a human-readable label", () => {
      // These four are the complete enum that PrepRouterRequest.js constrains the router
      // model to via responseSchema. If the gateway grows a fifth, the fallback branch
      // below covers it until it is named here.
      assert.strictEqual(formatRouterCategory("simple"), "Simple");
      assert.strictEqual(formatRouterCategory("general"), "General");
      assert.strictEqual(formatRouterCategory("deep_reasoning"), "Deep Reasoning");
      assert.strictEqual(formatRouterCategory("coding"), "Coding");
    });

    it("does not leak the raw snake_case enum to the UI", () => {
      // The bug this guards: rendering the header verbatim showed a customer
      // "deep_reasoning" in the trace viewer.
      const label = formatRouterCategory("deep_reasoning");
      assert.ok(!label.includes("_"), `label must not contain an underscore, got ${label}`);
    });

    it("is case and whitespace insensitive", () => {
      assert.strictEqual(formatRouterCategory("SIMPLE"), "Simple");
      assert.strictEqual(formatRouterCategory("  deep_reasoning  "), "Deep Reasoning");
    });

    it("returns undefined when the gateway sent no category", () => {
      // Not a guess, and not a placeholder string. The trace viewer renders the intent
      // chip conditionally, so undefined makes it disappear rather than show a fabricated
      // classification.
      assert.strictEqual(formatRouterCategory(undefined), undefined);
      assert.strictEqual(formatRouterCategory(""), undefined);
      assert.strictEqual(formatRouterCategory("   "), undefined);
    });

    it("title-cases an unknown category instead of dropping it", () => {
      // A category added server-side should still be visible. Showing an unstyled but
      // truthful label beats hiding the fact that routing happened at all.
      assert.strictEqual(formatRouterCategory("image_generation"), "Image Generation");
      assert.strictEqual(formatRouterCategory("multi-modal"), "Multi Modal");
    });
  });

  describe("2. The model-name heuristic must not come back", () => {
    it("contains no model-name-based intent guessing in the executable source", () => {
      // The removed fallback substring-matched the model name. It could not distinguish
      // gemini-3.1-flash-lite (`simple`) from gemini-3-flash-preview (`general`) because
      // both contain "flash", and it had no `simple` branch at all, so every simple
      // request was labelled "General / Fast".
      assert.ok(
        !clientExecutable.includes("'General / Fast'"),
        "apigeeClient.ts must not reintroduce the 'General / Fast' heuristic label"
      );
    });

    it("derives the intent solely from the gateway header", () => {
      assert.ok(
        clientExecutable.includes("formatRouterCategory(effectiveCategory)"),
        "the intent label must be produced by formatRouterCategory over x-gateway-category"
      );
    });
  });
});
