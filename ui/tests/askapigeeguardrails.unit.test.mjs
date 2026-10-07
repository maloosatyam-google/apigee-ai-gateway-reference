/**
 * Ask Apigee guardrail switches + consult_skill.
 *
 * Checks the properties that matter without credentials:
 *  - guardrail.* attributes accept only on/off and map to the guardrails capability,
 *  - a guardrail change is refused until consult_skill ran in the same turn,
 *  - the change record keeps the skill citations and reverts byte for byte,
 *  - the dev gateway's x-gateway-guardrails header is parsed for "prove it" tests,
 *  - consult_skill ranks real skill sections from the generated digest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_PRODUCTS,
  validateChangeList,
  capabilitiesForChanges,
  validateToolArgs,
  buildFunctionDeclarations,
  parseGuardrailHeader,
  toTestResult,
  apigeeProductName,
  devNameFor,
} from '../server/adminAgentCore.js';
import { consultSkill, loadSkillDigest, SKILL_NAMES } from '../server/skillConsult.js';
import { buildDigest, splitSections } from '../server/generateSkillDigest.js';
import { createAdminAgentService } from '../server/adminAgentService.js';

const LIVE = LIVE_PRODUCTS[0];
const DEV_RESOURCE = apigeeProductName(devNameFor(LIVE));

function fakeApigee() {
  const calls = [];
  let product = {
    name: DEV_RESOURCE,
    displayName: DEV_RESOURCE,
    environments: ['dev'],
    attributes: [{ name: 'access', value: 'public' }],
  };
  const raw0 = JSON.stringify(product);
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: new Map() });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method });
    if (url.includes(`/apiproducts/${encodeURIComponent(DEV_RESOURCE)}`)) {
      if (method === 'GET') return json(200, product);
      product = JSON.parse(init.body);
      return json(200, product);
    }
    return json(404, { error: { message: 'not found' } });
  };
  return { fetchImpl, calls, product: () => product, raw0 };
}

function service(fake) {
  let n = 0;
  return createAdminAgentService({
    getToken: async () => 'tok',
    fetchImpl: fake.fetchImpl,
    randomHex: () => (++n).toString(16).padStart(8, '0'),
    insights: {},
    logger: { warn() {}, error() {} },
  });
}

test('guardrail attributes take on/off only and belong to the guardrails capability', () => {
  const v = validateChangeList([{ path: 'attributes.guardrail.modelArmor.prompt', value: 'OFF' }]);
  assert.equal(v[0].value, 'off');
  assert.deepEqual(capabilitiesForChanges(v), ['guardrails']);
  assert.throws(() => validateChangeList([{ path: 'attributes.guardrail.modelArmor.prompt', value: 'maybe' }]));
  assert.throws(() => validateChangeList([{ path: 'attributes.guardrail.somethingElse', value: 'off' }]));
});

test('consult_skill is an admin tool with a whitelisted skill', () => {
  assert.ok(buildFunctionDeclarations('admin').some((d) => d.name === 'consult_skill'));
  assert.ok(!buildFunctionDeclarations('user').some((d) => d.name === 'consult_skill'));
  assert.deepEqual(validateToolArgs('consult_skill', { skill: 'ai-gateway-policy-manager', topic: ' cache ' }), {
    skill: 'ai-gateway-policy-manager',
    topic: 'cache',
  });
  assert.throws(() => validateToolArgs('consult_skill', { skill: '../../etc', topic: 'x' }));
  assert.throws(() => validateToolArgs('consult_skill', { skill: 'apigee-proxy-builder', topic: '' }));
});

test('a guardrail change is refused until consult_skill ran this turn, then cites it and reverts exactly', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const change = { name: 'update_dev_product', args: { sourceProduct: LIVE, changes: [{ path: 'attributes.guardrail.semanticCache', value: 'off' }] } };

  const turn = { scope: 'admin', consulted: [] };
  const refused = await svc._internals.executeTool(change, [], 'platform', turn);
  assert.match(refused.error, /consult_skill/);
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'), 'nothing written before the consult');

  const events = [];
  const consult = await svc._internals.executeTool(
    { name: 'consult_skill', args: { skill: 'ai-gateway-policy-manager', topic: 'semantic cache' } },
    events,
    'platform',
    turn
  );
  assert.ok(consult.found && consult.sections.length > 0);
  assert.ok(turn.consulted.length > 0);

  const out = await svc._internals.executeTool(change, events, 'platform', turn);
  assert.equal(out.applied, true);
  const attr = fake.product().attributes.find((a) => a.name === 'guardrail.semanticCache');
  assert.equal(attr.value, 'off');
  const recorded = events.find((e) => e.type === 'change').change;
  assert.ok(recorded.skillCitations.every((c) => c.startsWith('ai-gateway-policy-manager/')));
  assert.deepEqual(recorded.capabilities, ['guardrails']);

  await svc._internals.revertChange(recorded.changeId, 'platform');
  assert.equal(JSON.stringify(fake.product()), fake.raw0);
});

test('Finance cannot flip a guardrail switch', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const turn = { scope: 'admin', consulted: ['ai-gateway-policy-manager/SKILL.md#x'] };
  const out = await svc._internals.executeTool(
    { name: 'update_dev_product', args: { sourceProduct: LIVE, changes: [{ path: 'attributes.guardrail.modelArmor.prompt', value: 'off' }] } },
    [],
    'finance',
    turn
  );
  assert.ok(out.error);
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'));
});

test('x-gateway-guardrails header is parsed into the test result', () => {
  assert.equal(parseGuardrailHeader(''), null);
  assert.deepEqual(parseGuardrailHeader('armor-prompt=on;armor-response=off;semantic-cache=on'), {
    'armor-prompt': 'on',
    'armor-response': 'off',
    'semantic-cache': 'on',
  });
  const r = toTestResult({ status: 200, json: {}, headers: { 'x-gateway-guardrails': 'armor-prompt=off;armor-response=on;semantic-cache=off' } });
  assert.equal(r.guardrails['armor-prompt'], 'off');
});

test('skill digest covers the skills and consult_skill ranks real sections', () => {
  const digest = loadSkillDigest();
  for (const s of SKILL_NAMES) assert.ok(digest.skills[s]?.sections.length > 0, `${s} in digest`);
  const out = consultSkill(digest, 'ai-gateway-policy-manager', 'Model Armor guardrails');
  assert.ok(out.sections.some((x) => /Guardrails|Model Armor/i.test(x.heading)), JSON.stringify(out.sections.map((x) => x.heading)));
  assert.equal(consultSkill(digest, 'nope', 'x').found, false);
});

test('committed skill digest is up to date with .gemini/skills', () => {
  assert.deepEqual(loadSkillDigest(), buildDigest(), 'run `npm run gen:skill-digest` and commit server/skillDigest.json');
});

test('splitSections strips frontmatter and splits on ## and ###', () => {
  const s = splitSections('---\nname: x\n---\nintro\n## A\none\n### B\ntwo\n');
  assert.deepEqual(s.map((x) => x.heading), ['Overview', 'A', 'B']);
});

test('per-product test apps and the expected-vs-applied guardrail check', async () => {
  const { productTestAppName, compareGuardrails } = await import('../server/adminAgentCore.js');
  assert.equal(productTestAppName('Engineering and IT (Dev)'), 'ask-apigee-test-engineering-and-it');
  assert.equal(productTestAppName('Customer Support and Sales'), 'ask-apigee-test-customer-support-and-sales');
  const product = { attributes: [{ name: 'guardrail.semanticCache', value: 'off' }] };
  const ok = compareGuardrails(product, { 'armor-prompt': 'on', 'armor-response': 'on', 'semantic-cache': 'off' });
  assert.equal(ok.matches, true);
  const stale = compareGuardrails(product, { 'armor-prompt': 'on', 'armor-response': 'on', 'semantic-cache': 'on' });
  assert.equal(stale.matches, false);
  assert.deepEqual(stale.mismatched, ['semantic-cache']);
  assert.equal(compareGuardrails(product, null).matches, null, 'no header -> no claim either way');
  assert.equal(compareGuardrails({ attributes: [] }, {}).matches, true, 'missing attributes and empty header both mean on');
});
