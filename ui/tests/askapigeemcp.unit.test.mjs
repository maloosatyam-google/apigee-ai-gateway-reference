/**
 * Ask Apigee MCP tool governance.
 *
 * Offline checks against an in-memory Apigee fake:
 *  - only "… Dev" clones bound to dev are ever written (never a live MCP product),
 *  - grants are limited to tools the MCP server actually exposes,
 *  - a change is refused until consult_skill (tools-gateway-manager) ran this turn,
 *  - revert restores the clone exactly, and AI CoE owns it (Finance cannot),
 *  - the entitlement classifier reads Apigee's per-tool refusal correctly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMcpDevClone,
  assertWritableMcpDev,
  applyToolAccessChanges,
  validateToolAccessArgs,
  toolsOf,
  toolUniverse,
  mcpBasePathFor,
  mcpTestAppName,
  classifyToolCall,
} from '../server/mcpGovernance.js';
import { buildFunctionDeclarations } from '../server/adminAgentCore.js';
import { createAdminAgentService } from '../server/adminAgentService.js';

const op = (tool, limit = '100') => ({ apiSource: 'banking-mcp', operations: [{ operation: `tools/call/${tool}` }], quota: { limit, interval: '1', timeUnit: 'minute' } });
const LIST = { apiSource: 'banking-mcp', operations: [{ operation: 'tools/list' }], quota: { limit: '30', interval: '1', timeUnit: 'minute' } };
const ANALYSTS = {
  name: 'Banking Tools MCP - Analysts',
  displayName: 'Banking Tools MCP - Analysts',
  environments: ['dev', 'prod'],
  approvalType: 'auto',
  attributes: [{ name: 'industry', value: 'banking' }, { name: 'persona', value: 'insights' }],
  payloadOperationGroup: { operationConfigs: [LIST, op('getAccount'), op('listTransactions', '50')] },
};
const ADMIN = {
  name: 'Banking Tools MCP Admin',
  environments: ['dev', 'prod'],
  payloadOperationGroup: { operationConfigs: [LIST, op('getAccount'), op('listTransactions'), op('issueRefund')] },
};

test('dev clone is dev-only, auto-approved and named "… Dev"', () => {
  const c = buildMcpDevClone(ANALYSTS);
  assert.equal(c.name, 'Banking Tools MCP - Analysts Dev');
  assert.deepEqual(c.environments, ['dev']);
  assert.equal(c.approvalType, 'auto');
  assert.deepEqual(toolsOf(c).map((t) => t.tool), ['getAccount', 'listTransactions']);
  assert.throws(() => assertWritableMcpDev(ANALYSTS), /only edits/);
  assert.throws(() => assertWritableMcpDev({ ...c, environments: ['dev', 'prod'] }), /dev/);
});

test('grant, revoke and quota changes; grants limited to the server\'s tools', () => {
  const clone = buildMcpDevClone(ANALYSTS);
  const universe = toolUniverse([ANALYSTS, ADMIN], ['banking-mcp']);
  assert.deepEqual(universe, ['getAccount', 'issueRefund', 'listTransactions']);
  const { next, diff } = applyToolAccessChanges(clone, { add: ['issueRefund'], remove: ['getAccount'], quotas: { listTransactions: '20' } }, universe);
  assert.deepEqual(toolsOf(next).map((t) => t.tool).sort(), ['issueRefund', 'listTransactions']);
  assert.equal(toolsOf(next).find((t) => t.tool === 'listTransactions').quota.limit, '20');
  assert.equal(diff.length, 3);
  assert.ok(next.payloadOperationGroup.operationConfigs.some((c) => c.operations[0].operation === 'tools/list'), 'tools/list kept');
  assert.throws(() => applyToolAccessChanges(clone, { add: ['dropDatabase'] }, universe), /not a tool/);
  assert.throws(() => applyToolAccessChanges(clone, { remove: ['issueRefund'] }, universe), /not granted/);
});

test('argument validation', () => {
  assert.deepEqual(validateToolAccessArgs({ product: 'P', add: 'a, b', quotas: { a: '1,000' } }), { product: 'P', add: ['a', 'b'], remove: [], quotas: { a: '1000' } });
  assert.throws(() => validateToolAccessArgs({ product: 'P' }), /Nothing to change/);
  assert.throws(() => validateToolAccessArgs({ product: 'P', add: ['a'], remove: ['a'] }));
  assert.throws(() => validateToolAccessArgs({ product: 'P', add: ['../x'] }));
  assert.throws(() => validateToolAccessArgs({ product: 'P', quotas: { a: 0 } }));
});

test('helpers: base path, test app name, entitlement classifier', () => {
  assert.equal(mcpBasePathFor('banking-mcp'), '/banking/mcp');
  assert.equal(mcpBasePathFor('customer-service-v1'), null);
  assert.equal(mcpTestAppName('Banking Tools MCP - Analysts Dev'), 'ask-apigee-mcp-test-banking-tools-mcp-analysts');
  assert.equal(classifyToolCall(401, { fault: { detail: { errorcode: 'oauth.v2.InvalidApiKeyForGivenResource' } } }, ''), 'denied');
  assert.equal(classifyToolCall(401, { fault: { detail: { errorcode: 'oauth.v2.InvalidApiKey' } } }, ''), 'key_not_ready');
  assert.equal(classifyToolCall(200, null, 'event: message\ndata: {"result":{}}'), 'allowed');
  assert.equal(classifyToolCall(403, null, '{"result":{"isError":true}}'), 'allowed');
  assert.equal(classifyToolCall(0, null, ''), 'unreachable');
});

test('MCP tools are admin-only', () => {
  const admin = buildFunctionDeclarations('admin').map((d) => d.name);
  for (const n of ['list_mcp_tools', 'update_dev_tool_access', 'run_dev_tool_test']) assert.ok(admin.includes(n));
  assert.ok(!buildFunctionDeclarations('user').some((d) => d.name === 'update_dev_tool_access'));
});

function fakeApigee() {
  const store = new Map([[ANALYSTS.name, ANALYSTS], [ADMIN.name, ADMIN]]);
  const calls = [];
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: new Map() });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method });
    const u = new URL(url);
    if (u.pathname.endsWith('/apiproducts') && method === 'GET') return json(200, { apiProduct: [...store.values()] });
    if (u.pathname.endsWith('/apiproducts') && method === 'POST') {
      const p = JSON.parse(init.body);
      store.set(p.name, p);
      return json(201, p);
    }
    const m = /\/apiproducts\/(.+)$/.exec(u.pathname);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (method === 'GET') return store.has(name) ? json(200, store.get(name)) : json(404, {});
      if (method === 'PUT') {
        store.set(name, JSON.parse(init.body));
        return json(200, store.get(name));
      }
    }
    return json(404, {});
  };
  return { fetchImpl, calls, store };
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

test('update_dev_tool_access: consult first, writes only the dev clone, reverts exactly', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const call = { name: 'update_dev_tool_access', args: { product: 'banking tools mcp - analysts', remove: ['getAccount'] } };
  const turn = { scope: 'admin', consulted: [] };

  const refused = await svc._internals.executeTool(call, [], 'platform', turn);
  assert.match(refused.error, /consult_skill/);
  assert.ok(!fake.calls.some((c) => c.method !== 'GET'));

  await svc._internals.executeTool({ name: 'consult_skill', args: { skill: 'tools-gateway-manager', topic: 'per-tool authorization' } }, [], 'platform', turn);
  const events = [];
  const out = await svc._internals.executeTool(call, events, 'platform', turn);
  assert.equal(out.applied, true);
  assert.equal(out.createdDevCopy, true);

  const writes = fake.calls.filter((c) => c.method !== 'GET');
  assert.ok(writes.every((c) => decodeURIComponent(c.url).includes('Analysts Dev') || c.url.endsWith('/apiproducts')), JSON.stringify(writes));
  assert.deepEqual(toolsOf(fake.store.get(ANALYSTS.name)).map((t) => t.tool), ['getAccount', 'listTransactions'], 'live untouched');
  const dev = fake.store.get('Banking Tools MCP - Analysts Dev');
  assert.deepEqual(toolsOf(dev).map((t) => t.tool), ['listTransactions']);

  const change = events.find((e) => e.type === 'change').change;
  assert.equal(change.kind, 'mcp_product');
  assert.ok(change.skillCitations.every((c) => c.startsWith('tools-gateway-manager/')));

  await assert.rejects(svc._internals.revertChange(change.changeId, 'finance'), /cannot change/);
  await svc._internals.revertChange(change.changeId, 'ai_coe');
  assert.deepEqual(toolsOf(fake.store.get('Banking Tools MCP - Analysts Dev')).map((t) => t.tool), ['getAccount', 'listTransactions']);
});

test('a guardrail-skill consult does not unlock tool changes', async () => {
  const fake = fakeApigee();
  const svc = service(fake);
  const turn = { scope: 'admin', consulted: ['ai-gateway-policy-manager/SKILL.md#4. Semantic cache'] };
  const out = await svc._internals.executeTool({ name: 'update_dev_tool_access', args: { product: ANALYSTS.name, remove: ['getAccount'] } }, [], 'platform', turn);
  assert.match(out.error, /tools-gateway-manager/);
});
