import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GUARDRAIL_CONTROLS } from '../server/guardrailCatalog.js';
import {
  generateCatalogJson,
  parseGuardrailCatalogTs,
} from '../server/generateGuardrailCatalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalogSrc = readFileSync(join(here, '../src/data/guardrailPolicies.ts'), 'utf8');
const archSrc = readFileSync(
  join(here, '../src/components/ArchitectureBlueprintModal.tsx'),
  'utf8'
);

/** Pulls `id: 'x'` values out of the GUARDRAIL_CONTROLS array. */
function controlIds(src) {
  const body = src.slice(src.indexOf('GUARDRAIL_CONTROLS'));
  return [...body.matchAll(/^\s{4}id: '([^']+)',$/gm)].map((m) => m[1]);
}

/** Pulls `name: 'X'` values (policy names) out of the catalog. */
function policyNames(src) {
  return [...src.matchAll(/name: '([^']+)',\s*type: '/g)].map((m) => m[1]);
}

test('Guardrail catalog has unique control ids', () => {
  const ids = controlIds(catalogSrc);
  assert.ok(ids.length >= 10, `Expected the full catalog, got ${ids.length} controls`);
  assert.equal(new Set(ids).size, ids.length, `Duplicate control ids: ${ids.join(', ')}`);
});

test('Every guardrail control maps to an Architecture blueprint stage', () => {
  const archStageIds = new Set(
    [...archSrc.matchAll(/^\s{6}id: '([^']+)',$/gm)].map((m) => m[1])
  );
  for (const id of controlIds(catalogSrc)) {
    assert.ok(
      archStageIds.has(id),
      `Control "${id}" has no matching stage in ArchitectureBlueprintModal — the Admin Console and the blueprint would drift`
    );
  }
});

test('Catalog policy names are in the blueprint or are real proxy policies', () => {
  // The Architecture view is a simplified presenter view (e.g. the MCP view leaves out
  // CORS-Allow and the audit log); the Admin Console lists what the proxy really runs.
  const archPolicyNames = new Set(policyNames(archSrc));
  const proxiesDir = join(here, '../../apigee/proxies');
  const bundlePolicies = new Set(
    readdirSync(proxiesDir).flatMap((p) => {
      const dir = join(proxiesDir, p, 'apiproxy/policies');
      return existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.xml$/, '')) : [];
    })
  );
  for (const name of policyNames(catalogSrc)) {
    assert.ok(
      archPolicyNames.has(name) || bundlePolicies.has(name),
      `Policy "${name}" is listed in the Admin Console but is neither in the Architecture blueprint nor a proxy policy`
    );
  }
});

test('Every guardrail declares an enforcement point and a violation outcome', () => {
  const blocks = catalogSrc
    .slice(catalogSrc.indexOf('GUARDRAIL_CONTROLS'))
    .split(/^  \{$/m)
    .slice(1);
  assert.ok(blocks.length >= 10, `Expected >=10 control blocks, got ${blocks.length}`);
  for (const block of blocks) {
    const id = /id: '([^']+)'/.exec(block)?.[1] ?? '(unknown)';
    for (const field of ['attachPoint', 'onViolation', 'configSource', 'category', 'proxy']) {
      assert.ok(new RegExp(`${field}:`).test(block), `Control "${id}" is missing ${field}`);
    }
    assert.ok(/policies: \[/.test(block), `Control "${id}" has no policies array`);
  }
});

test('Guardrails are declared against the two deployed proxies only', () => {
  const proxies = [...catalogSrc.matchAll(/proxy: (AI_PROXY|MCP_PROXY),/g)].map((m) => m[1]);
  assert.ok(proxies.includes('AI_PROXY'), 'AI gateway guardrails must be present');
  assert.ok(proxies.includes('MCP_PROXY'), 'MCP gateway guardrails must be present');
  assert.equal(
    proxies.length,
    controlIds(catalogSrc).length,
    'Every control must name the proxy that enforces it'
  );
});

// The Ask Apigee's `list_guardrails` tool answers from a server-side mirror
// (server/guardrailCatalog.json), because server.js is plain Node and cannot
// import this TypeScript module. These two tests are what stop the agent from
// describing a guardrail estate the console no longer shows.

test('The server-side guardrail mirror has the same controls, in the same order', () => {
  const parsed = parseGuardrailCatalogTs(catalogSrc);
  assert.equal(
    GUARDRAIL_CONTROLS.length,
    parsed.length,
    `Mirror has ${GUARDRAIL_CONTROLS.length} controls, catalog has ${parsed.length}. ` +
      'Re-run: node server/generateGuardrailCatalog.js'
  );
  assert.deepEqual(
    GUARDRAIL_CONTROLS.map((c) => c.id),
    parsed.map((c) => c.id),
    'Control ids drifted between guardrailPolicies.ts and server/guardrailCatalog.json. ' +
      'Re-run: node server/generateGuardrailCatalog.js'
  );
  assert.deepEqual(
    GUARDRAIL_CONTROLS.map((c) => c.id),
    controlIds(catalogSrc),
    'The mirror must match the ids declared in the TS source'
  );
});

test('The server-side guardrail mirror is byte-identical to a fresh generation', () => {
  assert.equal(
    readFileSync(join(here, '../server/guardrailCatalog.json'), 'utf8'),
    generateCatalogJson(),
    'server/guardrailCatalog.json is stale. Re-run: node server/generateGuardrailCatalog.js'
  );
});

test('Every mirrored control keeps the fields the agent answers with', () => {
  for (const control of GUARDRAIL_CONTROLS) {
    for (const field of ['gateway', 'proxy', 'title', 'category', 'summary', 'attachPoint', 'onViolation', 'configSource']) {
      assert.ok(control[field], `Mirrored control "${control.id}" is missing ${field}`);
    }
    assert.ok(Array.isArray(control.policies) && control.policies.length > 0);
    // Icons are React components; they must not survive into the server mirror.
    assert.equal(control.icon, undefined, `Mirrored control "${control.id}" should not carry an icon`);
  }
});


// ---------------------------------------------------------------------------
// Bundle parity: the console and blueprint must describe policies that really
// exist in the ai-gateway-v1 bundle. These caught JS-PrepRouterRequest (removed
// when router prep became the native AM-PrepRouterRequest + KVM-GetRouterCredentials
// pair) still being advertised after it was deleted from the proxy.
// ---------------------------------------------------------------------------

const AI_BUNDLE_POLICIES = join(here, '../../apigee/proxies/ai-gateway-v1/apiproxy/policies');
const AI_PROXY_ENDPOINT = join(here, '../../apigee/proxies/ai-gateway-v1/apiproxy/proxies/default.xml');

function aiPolicyNamesFromMirror() {
  return GUARDRAIL_CONTROLS.filter((c) => c.gateway === 'ai').flatMap((c) =>
    c.policies.map((p) => p.name)
  );
}

test('Every AI-gateway policy in the console exists in the ai-gateway-v1 bundle', () => {
  for (const name of aiPolicyNamesFromMirror()) {
    let xml;
    try {
      xml = readFileSync(join(AI_BUNDLE_POLICIES, `${name}.xml`), 'utf8');
    } catch {
      assert.fail(`Console lists "${name}" but apigee/proxies/ai-gateway-v1/apiproxy/policies/${name}.xml does not exist`);
    }
    assert.match(xml, new RegExp(`name="${name}"`), `${name}.xml does not declare name="${name}"`);
  }
});

test('Removed router artefacts are not advertised by the UI', () => {
  for (const [label, src] of [['guardrailPolicies.ts', catalogSrc], ['ArchitectureBlueprintModal.tsx', archSrc]]) {
    assert.ok(!src.includes('JS-PrepRouterRequest'), `${label} still lists the removed JS-PrepRouterRequest policy`);
    assert.ok(!/router model \(gemini-/i.test(src), `${label} still names a Gemini model as the /auto router`);
  }
});

test('Router control reflects the deployed AutoRoutingFlow chain (JEV router, encrypted KVM creds)', () => {
  const router = GUARDRAIL_CONTROLS.find((c) => c.id === 'ai-router');
  assert.ok(router, 'ai-router control missing');
  const names = router.policies.map((p) => p.name);
  // Same relative order as the steps in AutoRoutingFlow.
  const endpoint = readFileSync(AI_PROXY_ENDPOINT, 'utf8');
  const flow = endpoint.slice(endpoint.indexOf('<Flow name="AutoRoutingFlow">'));
  // LTQ-TokenEnforce also runs here but belongs to the Token Quotas control, not the router.
  const flowSteps = [...flow.slice(0, flow.indexOf('</Flow>')).matchAll(/<Name>([^<]+)<\/Name>/g)]
    .map((m) => m[1])
    .filter((n) => n !== 'LTQ-TokenEnforce');
  assert.deepEqual(
    names.filter((n) => flowSteps.includes(n)),
    flowSteps,
    'Console router policies must list every AutoRoutingFlow step, in flow order'
  );
  assert.match(router.attachPoint, /AutoRoutingFlow/);
  assert.match(router.summary, /JEV System One/);
  assert.match(router.configSource, /ai-gateway-creds/);
  const credsXml = readFileSync(join(AI_BUNDLE_POLICIES, 'KVM-GetRouterCredentials.xml'), 'utf8');
  assert.match(credsXml, /mapIdentifier="ai-gateway-creds"/, 'console names a KVM the policy does not read');
});

test('Model Armor violation status in the console matches the 400 the gateway returns', () => {
  const armor = GUARDRAIL_CONTROLS.find((c) => c.id === 'ai-armor');
  assert.match(armor.onViolation, /^HTTP 400\b/);
});

test('Blueprint policy names are all listed in the Admin Console (reverse direction)', () => {
  const catalogPolicyNames = new Set(policyNames(catalogSrc));
  for (const name of policyNames(archSrc)) {
    assert.ok(
      catalogPolicyNames.has(name),
      `Policy "${name}" is in the Architecture blueprint but not in the Admin Console guardrail catalog`
    );
  }
});

test('MCP blueprint steps follow the proxy order and use the real fault codes', () => {
  const ids = [...archSrc.matchAll(/^\s{6}id: '(mcp-[^']+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['mcp-auth', 'mcp-tools', 'mcp-rate', 'mcp-call', 'mcp-bridge'],
    'MCP steps must be: API Key Check, Tools Filter, Rate Limit, MCP Call, optional JSON-RPC -> REST');
  assert.deepEqual(controlIds(catalogSrc).filter((id) => id.startsWith('mcp-')), ids);
  // A tool that is not on the product is rejected by VerifyAPIKey with 401, not a JSON-RPC -32001.
  for (const [label, src] of [['guardrailPolicies.ts', catalogSrc], ['ArchitectureBlueprintModal.tsx', archSrc]]) {
    assert.ok(!src.includes('-32001'), `${label} still advertises the non-existent -32001 tool denial`);
  }
  assert.match(archSrc, /InvalidApiKeyForGivenResource/);
});
