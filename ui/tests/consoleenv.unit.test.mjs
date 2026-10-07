import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffProducts, diffRateCards, PROD_READ_ONLY_MESSAGE as CLIENT_MESSAGE } from '../src/utils/configDiff.js';
import {
  normalizeConsoleEnv,
  apigeeNameForTier,
  consoleWriteGuard,
  toConsoleProduct,
  toApigeeProduct,
  PROD_READ_ONLY_MESSAGE,
} from '../server/consoleEnv.js';

const cfg = (model, limit) => ({
  llmOperations: [{ resource: '/**', model }],
  llmTokenQuota: { limit: String(limit), interval: '1', timeUnit: 'minute' },
});
const product = (name, configs, attrs = [], extra = {}) => ({
  name,
  displayName: name,
  environments: ['prod'],
  attributes: attrs,
  llmOperationGroup: { operationConfigs: configs },
  ...extra,
});

// ---- configDiff ------------------------------------------------------------

test('identical products produce no rows, even with different identity fields', () => {
  const prod = product('Engineering and IT', [cfg('gemini-3-flash-preview', 2000)], [{ name: 'routing.model.simple', value: 'x' }]);
  const dev = { ...prod, name: 'Engineering and IT Dev', displayName: 'Engineering and IT (Dev)', environments: ['dev'], description: 'clone' };
  assert.deepEqual(diffProducts(dev, prod), []);
});

test('model added in dev, removed in dev, and quota changed', () => {
  const prod = product('P', [cfg('a', 1000), cfg('b', 2000)]);
  const dev = product('D', [cfg('a', 5000), cfg('c', 300)]);
  assert.deepEqual(diffProducts(dev, prod), [
    { section: 'Models & token quotas', key: 'a', dev: '5000 tokens / 1 minute', prod: '1000 tokens / 1 minute', kind: 'changed' },
    { section: 'Models & token quotas', key: 'b', dev: null, prod: '2000 tokens / 1 minute', kind: 'removed' },
    { section: 'Models & token quotas', key: 'c', dev: '300 tokens / 1 minute', prod: null, kind: 'added' },
  ]);
});

test('attribute changes are reported; the access attribute is ignored', () => {
  const prod = product('P', [], [{ name: 'routing.model.coding', value: 'opus' }, { name: 'access', value: 'public' }]);
  const dev = product('D', [], [{ name: 'routing.model.coding', value: 'pro' }, { name: 'access', value: 'private' }]);
  assert.deepEqual(diffProducts(dev, prod), [
    { section: 'Routing & attributes', key: 'routing.model.coding', dev: 'pro', prod: 'opus', kind: 'changed' },
  ]);
});

test('request quota difference', () => {
  const prod = product('P', [], [], { quota: '100', quotaInterval: '1', quotaTimeUnit: 'minute' });
  const dev = product('D', []);
  assert.equal(diffProducts(dev, prod)[0].kind, 'removed');
});

test('missing products are handled', () => {
  assert.deepEqual(diffProducts(undefined, undefined), []);
  assert.equal(diffProducts(product('D', [cfg('a', 1)]), undefined)[0].kind, 'added');
});

test('rate card diff', () => {
  const rows = diffRateCards(
    { a: { input: 1, output: 2, tier: 'low' }, c: { input: 1, output: 1 } },
    { a: { input: 1, output: 3, tier: 'low' }, b: { input: 5, output: 5 } },
  );
  assert.deepEqual(rows.map((r) => [r.key, r.kind]), [['a', 'changed'], ['b', 'removed'], ['c', 'added']]);
  assert.deepEqual(diffRateCards({ a: { input: 1, output: 2 } }, { a: { input: 1, output: 2 } }), []);
});

// ---- consoleEnv (server) ---------------------------------------------------

test('env normalisation defaults to prod (the read-only side)', () => {
  assert.equal(normalizeConsoleEnv('dev'), 'dev');
  assert.equal(normalizeConsoleEnv('bap'), 'dev');
  assert.equal(normalizeConsoleEnv('PROD'), 'prod');
  assert.equal(normalizeConsoleEnv(undefined), 'prod');
  assert.equal(normalizeConsoleEnv('staging'), 'prod');
});

test('prod writes are refused with the pull-request message; dev writes pass', () => {
  const g = consoleWriteGuard('prod');
  assert.equal(g.status, 403);
  assert.equal(g.body.code, 'prod_read_only');
  assert.equal(g.body.error, PROD_READ_ONLY_MESSAGE);
  assert.match(PROD_READ_ONLY_MESSAGE, /pull request/);
  assert.equal(consoleWriteGuard('dev'), null);
});

test('tier names map to the dev sandbox products', () => {
  assert.equal(apigeeNameForTier('Engineering and IT', 'prod'), 'Engineering and IT');
  assert.equal(apigeeNameForTier('Engineering and IT', 'dev'), 'Engineering and IT Dev');
  assert.throws(() => apigeeNameForTier('Other', 'dev'));
});

test('console <-> apigee product mapping keeps the resource name and pins dev to dev', () => {
  const apigee = { name: 'Customer Support and Sales Dev', displayName: 'Customer Support and Sales (Dev)', environments: ['dev'], createdAt: '1' };
  const c = toConsoleProduct(apigee, 'Customer Support and Sales', 'dev');
  assert.equal(c.name, 'Customer Support and Sales');
  assert.equal(c.apigeeName, 'Customer Support and Sales Dev');
  const back = toApigeeProduct({ ...c, environments: ['dev', 'prod'] }, 'Customer Support and Sales', 'dev');
  assert.equal(back.name, 'Customer Support and Sales Dev');
  assert.deepEqual(back.environments, ['dev']);
  assert.equal(back.apigeeName, undefined);
  assert.equal(back.env, undefined);
  assert.equal(back.createdAt, undefined);
  assert.equal(back.displayName, 'Customer Support and Sales (Dev)');
});

test('client and server read-only messages are identical', () => {
  assert.equal(CLIENT_MESSAGE, PROD_READ_ONLY_MESSAGE);
});
