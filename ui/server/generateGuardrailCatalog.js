/**
 * Derives the server-side guardrail catalog from the single source of truth,
 * ui/src/data/guardrailPolicies.ts, so the agent's `list_guardrails` tool can
 * never drift from what the Admin Console and the Architecture blueprint show.
 *
 * The TS module cannot be imported by the plain-Node server (it is TypeScript,
 * and it imports lucide-react icons), so the array literal is parsed out and
 * re-emitted as JSON. Run:
 *
 *   node server/generateGuardrailCatalog.js
 *
 * tests/guardrailpolicies.unit.test.mjs re-runs this parse and fails if the
 * committed JSON no longer matches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_TS_PATH = path.join(here, '../src/data/guardrailPolicies.ts');
export const CATALOG_JSON_PATH = path.join(here, 'guardrailCatalog.json');

/**
 * Parse `GUARDRAIL_CONTROLS` out of the TypeScript source.
 *
 * The literal is plain data apart from two things: the `icon` entries, which
 * are React components with no server-side meaning, and the AI_PROXY/MCP_PROXY
 * identifiers, which are resolved from their own declarations rather than
 * hardcoded here.
 */
export function parseGuardrailCatalogTs(src) {
  const aiProxy = /export const AI_PROXY = '([^']+)'/.exec(src)?.[1];
  const mcpProxy = /export const MCP_PROXY = '([^']+)'/.exec(src)?.[1];
  if (!aiProxy || !mcpProxy) {
    throw new Error('guardrailPolicies.ts: could not find AI_PROXY / MCP_PROXY declarations');
  }

  const declIdx = src.indexOf('export const GUARDRAIL_CONTROLS');
  if (declIdx === -1) throw new Error('guardrailPolicies.ts: GUARDRAIL_CONTROLS not found');
  const arrStart = src.indexOf('[', declIdx);
  const arrEnd = src.indexOf('\n];', arrStart);
  if (arrStart === -1 || arrEnd === -1) {
    throw new Error('guardrailPolicies.ts: could not delimit the GUARDRAIL_CONTROLS array');
  }

  const literal = src
    .slice(arrStart, arrEnd + 2)
    .replace(/^\s*icon: [A-Za-z0-9_$]+,\s*$/gm, '')
    .replace(/\bAI_PROXY\b/g, JSON.stringify(aiProxy))
    .replace(/\bMCP_PROXY\b/g, JSON.stringify(mcpProxy));

  // The literal is plain JS data (strings, arrays, objects) at this point.
  // eslint-disable-next-line no-new-func
  const controls = new Function(`return (${literal});`)();
  if (!Array.isArray(controls) || controls.length === 0) {
    throw new Error('guardrailPolicies.ts: parsed catalog is empty');
  }
  return controls;
}

export function generateCatalogJson(tsPath = CATALOG_TS_PATH) {
  const controls = parseGuardrailCatalogTs(fs.readFileSync(tsPath, 'utf8'));
  return `${JSON.stringify(controls, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = generateCatalogJson();
  fs.writeFileSync(CATALOG_JSON_PATH, json);
  console.log(`[guardrails] wrote ${CATALOG_JSON_PATH} (${JSON.parse(json).length} controls)`);
}
