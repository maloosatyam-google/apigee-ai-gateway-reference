/**
 * Ask Apigee backend unit tests.
 *
 * Neither Apigee nor the AI Gateway is reachable from CI, so the service is
 * built with a fake `fetchImpl` backed by an in-memory product store, and the
 * tool loop is driven by a fake model responder. What is covered here is the
 * logic that can actually be wrong: the "(Dev)" write guard, tool-argument
 * whitelisting, diff computation, byte-exact snapshot/revert, the shape of the
 * Gemini function declarations, the iteration/time caps, and the rule that the
 * sandbox consumer key never reaches the client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdminAgentError,
  AGENT_MODEL,
  AGENT_FALLBACK_MODEL,
  ChangeStore,
  DEV_PRODUCTS,
  KNOWN_PRODUCTS,
  RATE_LIMIT_APIGEE_QUOTA,
  RATE_LIMIT_UNKNOWN,
  RATE_LIMIT_UPSTREAM_CAPACITY,
  classifyRateLimit,
  apigeeProductName,
  logicalProductName,
  LIVE_PRODUCTS,
  MAX_TOOL_ITERATIONS,
  MAX_TRACKED_CHANGES,
  TOOL_LOOP_BUDGET_MS,
  TOOL_NAMES,
  allowedTestModels,
  applyChangeSet,
  assertDevOnlyEnvironments,
  assertWritableDevProduct,
  buildDevClone,
  buildFunctionDeclarations,
  describeGatewayFailure,
  devNameFor,
  liveNameFor,
  messagesToContents,
  nativeToolTurn,
  textToolTurn,
  mintSyntheticIdentityToken,
  newChangeId,
  parseChangePath,
  pickGatewayHeaders,
  resolveKnownProduct,
  resolveQuotaResource,
  runToolLoop,
  stripServerFields,
  toTestResult,
  validateChangeList,
  validateToolArgs,
  humanizeChangePath,
  summarizeDiff,
  looksLikeToolNarration,
} from '../server/adminAgentCore.js';
import { createAdminAgentService, redactSecrets } from '../server/adminAgentService.js';
import { GUARDRAIL_CONTROLS, listGuardrails } from '../server/guardrailCatalog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'demo-project';
const SANDBOX_KEY = 'SANDBOXKEY0123456789abcdef';
const ADMIN_KEY = 'ADMINKEY9876543210zyxwvu';

function standardDevProduct() {
  return {
    // Stored under the Apigee resource name; the parenthesised form is the
    // displayName, exactly as provisioning creates it.
    name: 'Customer Support and Sales Dev',
    displayName: 'Customer Support and Sales (Dev)',
    approvalType: 'auto',
    environments: ['dev'],
    // A field the agent knows nothing about. Revert must bring it back
    // untouched -- that is the difference between a snapshot and a reset.
    createdAt: '1700000000000',
    someUnknownField: { keep: 'me' },
    attributes: [
      { name: 'access', value: 'private' },
      { name: 'routing.model.coding', value: 'gemini-3.6-flash' },
    ],
    llmOperationGroup: {
      operationConfigs: [
        {
          apiSource: 'ai-gateway-v1',
          llmOperations: [{ resource: '/auto', methods: ['POST'], model: 'auto' }],
          llmTokenQuota: { limit: '2000', interval: '1', timeUnit: 'minute' },
        },
        {
          apiSource: 'ai-gateway-v1',
          llmOperations: [
            { resource: '/models/gemini-3.6-flash:*', methods: ['POST'], model: 'gemini-3.6-flash' },
          ],
          llmTokenQuota: { limit: '2000', interval: '1', timeUnit: 'minute' },
        },
      ],
    },
  };
}

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      forEach: (cb) => Object.entries(headers).forEach(([k, v]) => cb(v, k)),
    },
  };
}

/**
 * Minimal in-memory stand-in for the Apigee management API plus the gateway.
 * `state.calls` records every request so tests can assert what was written and,
 * crucially, *which product name* it was written to.
 */
function makeHarness({ products = {}, appExists = true, gateway, sleep } = {}) {
  const state = {
    products: JSON.parse(JSON.stringify(products)),
    appExists,
    calls: [],
  };

  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    state.calls.push({ url, method, body, headers: opts.headers || {} });

    if (url.startsWith('https://apigee.googleapis.com/')) {
      const base = `https://apigee.googleapis.com/v1/organizations/${ORG}`;
      const suffix = url.slice(base.length);

      const productMatch = /^\/apiproducts\/(.+)$/.exec(suffix);
      if (productMatch) {
        const name = decodeURIComponent(productMatch[1]);
        if (method === 'GET') {
          return state.products[name]
            ? fakeResponse(200, state.products[name])
            : fakeResponse(404, { error: { message: 'not found' } });
        }
        if (method === 'PUT') {
          state.products[name] = body;
          return fakeResponse(200, body);
        }
      }
      if (suffix === '/apiproducts' && method === 'POST') {
        state.products[body.name] = body;
        return fakeResponse(201, body);
      }
      if (/\/apps\/admin-copilot-dev$/.test(suffix) && method === 'GET') {
        return state.appExists
          ? fakeResponse(200, {
              name: 'admin-copilot-dev',
              credentials: [{ status: 'approved', consumerKey: SANDBOX_KEY }],
            })
          : fakeResponse(404, { error: { message: 'not found' } });
      }
      if (/\/apps$/.test(suffix) && method === 'POST') {
        state.appExists = true;
        return fakeResponse(201, { name: body.name });
      }
      if (/keyvaluemaps\/ai-model-rates\/entries\/rate_card$/.test(suffix)) {
        return fakeResponse(200, {
          name: 'rate_card',
          value: JSON.stringify({ 'gemini-3.6-flash': { input: 0.3, output: 2.5 } }),
        });
      }
      return fakeResponse(404, { error: { message: `unhandled ${method} ${suffix}` } });
    }

    if (gateway) return gateway(url, opts, state);
    return fakeResponse(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }, {
      'x-gateway-model': 'gemini-3.6-flash',
      'x-gateway-cost-usd': '0.000012',
      'x-gateway-cache-status': 'DISABLED',
    });
  };

  const service = createAdminAgentService({
    getToken: async () => 'fake-gcp-token',
    provisionAdmin: async () => ({ apiKeys: { admin: ADMIN_KEY } }),
    defaultProducts: {},
    fetchImpl,
    adminEmail: 'admin@example.com',
    randomHex: () => 'abcd1234',
    logger: { warn() {}, error() {} },
    ...(sleep ? { sleep } : {}),
  });

  return { state, service };
}

/** Collects what a handler wrote, so routes can be tested without a socket. */
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk) {
      this.body = chunk || '';
      this.writableEnded = true;
    },
  };
}

function fakeReq(method, body) {
  const listeners = {};
  const req = {
    method,
    on(event, cb) {
      listeners[event] = cb;
      if (event === 'end') {
        if (body !== undefined && listeners.data) listeners.data(Buffer.from(body));
        cb();
      }
      return req;
    },
    destroy() {},
  };
  return req;
}

// ---------------------------------------------------------------------------
// Product name guards -- requirement #2
// ---------------------------------------------------------------------------

test('assertWritableDevProduct refuses every product that is not a "(Dev)" clone', () => {
  for (const live of LIVE_PRODUCTS) {
    assert.throws(() => assertWritableDevProduct(live), /may only modify dev sandbox products/);
  }
  assert.throws(() => assertWritableDevProduct('Customer Support and Sales(Dev)'), /may only modify/);
  assert.throws(() => assertWritableDevProduct('Customer Support and Sales (dev)'), /may only modify/);
  assert.throws(() => assertWritableDevProduct(''), /may only modify/);
  assert.throws(() => assertWritableDevProduct(null), /may only modify/);
  // Right suffix, unknown base: still refused.
  assert.throws(() => assertWritableDevProduct('Rogue Tier (Dev)'), /not one of the known dev sandbox products/);
  for (const dev of DEV_PRODUCTS) assert.equal(assertWritableDevProduct(dev), dev);
});

test('devNameFor / liveNameFor round-trip and reject unknown products', () => {
  assert.equal(devNameFor('Customer Support and Sales'), 'Customer Support and Sales (Dev)');
  assert.equal(devNameFor('Customer Support and Sales (Dev)'), 'Customer Support and Sales (Dev)');
  assert.equal(liveNameFor('Engineering and IT (Dev)'), 'Engineering and IT');
  assert.equal(resolveKnownProduct('  engineering and it  '), 'Engineering and IT');
  assert.throws(() => devNameFor('Enterprise Tools MCP'), /Unknown product/);
  assert.throws(() => resolveKnownProduct('../../apiproducts/Customer Support and Sales'), /Unknown product/);
});

test('logical "(Dev)" names map to Apigee-legal resource names and back', () => {
  // Apigee answers HTTP 400 "Invalid API product name" for a name containing
  // parentheses, so the resource cannot literally be "Customer Support and Sales (Dev)".
  assert.equal(apigeeProductName('Customer Support and Sales (Dev)'), 'Customer Support and Sales Dev');
  assert.equal(apigeeProductName('Engineering and IT (Dev)'), 'Engineering and IT Dev');
  assert.equal(apigeeProductName('Customer Support and Sales'), 'Customer Support and Sales');
  assert.doesNotMatch(apigeeProductName('Customer Support and Sales (Dev)'), /[()]/);

  assert.equal(logicalProductName('Customer Support and Sales Dev'), 'Customer Support and Sales (Dev)');
  assert.equal(logicalProductName('Customer Support and Sales'), 'Customer Support and Sales');
  // Not one of ours: left alone rather than guessed at.
  assert.equal(logicalProductName('Partner Tier Dev'), 'Partner Tier Dev');

  for (const dev of DEV_PRODUCTS) {
    assert.equal(logicalProductName(apigeeProductName(dev)), dev, 'the mapping must round-trip');
  }
});

// ---------------------------------------------------------------------------
// Tool argument validation -- requirement #5
// ---------------------------------------------------------------------------

test('validateToolArgs whitelists every tool argument', () => {
  assert.deepEqual(validateToolArgs('list_products', { junk: 1 }), {});
  assert.deepEqual(validateToolArgs('get_product', { name: 'Customer Support and Sales' }), {
    name: 'Customer Support and Sales',
  });
  assert.throws(() => validateToolArgs('get_product', { name: 'Payments API' }), /Unknown product/);

  assert.deepEqual(validateToolArgs('list_guardrails', { gateway: 'AI' }), { gateway: 'ai' });
  assert.throws(() => validateToolArgs('list_guardrails', { gateway: 'kafka' }), /Unknown gateway/);

  assert.deepEqual(validateToolArgs('get_rate_card', {}), { env: 'prod' });
  assert.throws(() => validateToolArgs('get_rate_card', { env: 'staging' }), /Unknown environment/);

  assert.deepEqual(validateToolArgs('run_dev_test', { prompt: ' hi ' }), { prompt: 'hi', model: 'auto' });
  assert.throws(() => validateToolArgs('run_dev_test', { prompt: '   ' }), /non-empty "prompt"/);
  assert.throws(() => validateToolArgs('run_dev_test', { prompt: 'x'.repeat(4001) }), /too long/);
  assert.throws(() => validateToolArgs('run_dev_test', { prompt: 'hi', model: 'a/../b' }), /not a valid model id/);

  assert.deepEqual(validateToolArgs('revert_change', { changeId: 'chg_0011aabb' }), {
    changeId: 'chg_0011aabb',
  });
  assert.throws(() => validateToolArgs('revert_change', { changeId: 'chg_zz' }), /not a valid change id/);

  assert.throws(() => validateToolArgs('drop_everything', {}), /Unknown tool/);
});

test('update_dev_product args always resolve to a live source tier and validated changes', () => {
  const args = validateToolArgs('update_dev_product', {
    sourceProduct: 'Customer Support and Sales (Dev)',
    changes: [{ path: 'attributes.routing.model.coding', value: 'gemini-3.1-pro-preview' }],
  });
  assert.equal(args.sourceProduct, 'Customer Support and Sales');
  assert.equal(args.changes.length, 1);
  assert.equal(args.changes[0].kind, 'attribute');
});

test('parseChangePath accepts only the three documented path families', () => {
  assert.equal(parseChangePath('environments').kind, 'environments');
  assert.equal(parseChangePath('attributes.access').kind, 'attribute');
  assert.equal(parseChangePath('llmTokenQuota./auto.limit').kind, 'quota');
  assert.throws(() => parseChangePath('name'), /Unsupported change path/);
  assert.throws(() => parseChangePath('approvalType'), /Unsupported change path/);
  assert.throws(() => parseChangePath('attributes.secret'), /not writable/);
  assert.throws(() => parseChangePath(''), /needs a "path"/);
});

test('change values are bounds-checked before they can reach Apigee', () => {
  assert.throws(() => validateChangeList([]), /non-empty array/);
  assert.throws(
    () => validateChangeList(Array.from({ length: 21 }, () => ({ path: 'attributes.access', value: 'x' }))),
    /At most 20 changes/
  );
  assert.throws(
    () => validateChangeList([{ path: 'llmTokenQuota./auto.limit', value: '0' }]),
    /whole number between 1 and 10000000/
  );
  assert.throws(
    () => validateChangeList([{ path: 'llmTokenQuota./auto.limit', value: '99999999' }]),
    /whole number between 1 and 10000000/
  );
  assert.throws(
    () => validateChangeList([{ path: 'environments', value: '["prod","qa"]' }]),
    /Unknown environment "qa"/
  );
  assert.throws(
    () => validateChangeList([{ path: 'attributes.routing.model.coding', value: 'gemini; rm -rf /' }]),
    /not a valid model id/
  );
  assert.throws(
    () => validateChangeList([{ path: 'attributes.developer.budget.limit', value: 'lots' }]),
    /positive whole number/
  );

  // Accepted shapes.
  assert.deepEqual(validateChangeList([{ path: 'llmTokenQuota./auto.limit', value: '4,000' }])[0].value, '4000');
  assert.deepEqual(validateChangeList([{ path: 'environments', value: ['dev', 'dev'] }])[0].value, ['dev']);
  // A dev clone attached to prod would make the sandbox key a prod credential.
  assert.throws(
    () => validateChangeList([{ path: 'environments', value: 'dev, prod' }]),
    (err) => err instanceof AdminAgentError && err.code === 'forbidden_target' && /only deploy sandbox products to "dev"/.test(err.message)
  );
  assert.throws(() => validateChangeList([{ path: 'environments', value: '["prod"]' }]), /only deploy sandbox products/);
});

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

test('applyChangeSet produces a contract-shaped diff and never mutates its input', () => {
  const product = standardDevProduct();
  const frozen = JSON.stringify(product);
  const changes = validateChangeList([
    { path: 'llmTokenQuota.gemini-3.6-flash.limit', value: '4000' },
    { path: 'attributes.routing.model.simple', value: 'gemini-3.5-flash-lite' },
    { path: 'environments', value: '["dev"]' },
  ]);
  const { next, diff } = applyChangeSet(product, changes);

  assert.equal(JSON.stringify(product), frozen, 'the pre-change snapshot must stay untouched');
  // environments was already ["dev"], so it is a no-op and must not appear.
  assert.deepEqual(
    diff.map((d) => d.path),
    ['llmTokenQuota./models/gemini-3.6-flash:*.limit', 'attributes.routing.model.simple']
  );
  assert.deepEqual(diff[0], {
    path: 'llmTokenQuota./models/gemini-3.6-flash:*.limit',
    // The card shows `label`; `path` is retained for anyone who asks where the
    // value actually lives.
    label: 'Token limit \u00b7 gemini-3.6-flash',
    before: '2000',
    after: '4000',
  });
  assert.deepEqual(diff[1], {
    path: 'attributes.routing.model.simple',
    label: 'Auto-routing \u00b7 simple lookups',
    before: null,
    after: 'gemini-3.5-flash-lite',
  });
  assert.equal(next.llmOperationGroup.operationConfigs[1].llmTokenQuota.limit, '4000');
  assert.equal(next.llmOperationGroup.operationConfigs[0].llmTokenQuota.limit, '2000', 'other ops untouched');
});

test('a narrated tool call is never surfaced as the reply', () => {
  // Regression: the model learned the shape of our own synthetic tool turn and
  // started emitting it as a final answer, so the admin saw
  // `Calling get_product({"name":"Customer Support and Sales (Dev)"})` in the panel.
  assert.ok(looksLikeToolNarration('Calling get_product({"name":"Customer Support and Sales"})'));
  assert.ok(looksLikeToolNarration('<<TOOL_CALL_ISSUED get_product({})>>'));
  assert.ok(looksLikeToolNarration('  calling list_products({})  '));
  assert.ok(looksLikeToolNarration('TOOL RESULTS (system-generated, not typed by the user):'));

  // Real answers that merely mention a tool name must still pass through.
  assert.ok(!looksLikeToolNarration('The Standard tier allows 2,000 tokens a minute.'));
  assert.ok(!looksLikeToolNarration('I checked the product and nothing has changed.'));
  assert.ok(!looksLikeToolNarration(''));
});

test('the synthetic tool turn is a machine marker, not imitable prose', () => {
  const [modelTurn] = textToolTurn({
    results: [{ call: { name: 'get_product', args: { name: 'X' } }, response: { ok: true } }],
  });
  const text = modelTurn.parts[0].text;
  assert.ok(text.startsWith('<<TOOL_CALL_ISSUED'), text);
  // If this ever reads like a sentence again, the model will copy it.
  assert.ok(!/^Calling /.test(text), text);
});

test('config paths are humanized for the change card, unknown shapes pass through', () => {
  assert.equal(
    humanizeChangePath('llmTokenQuota./models/claude-haiku-5-5:*.limit'),
    'Token limit \u00b7 claude-haiku-5-5'
  );
  assert.equal(humanizeChangePath('llmTokenQuota./auto.limit'), 'Token limit \u00b7 auto-routed calls');
  assert.equal(humanizeChangePath('attributes.developer.budget.limit'), 'Monthly spending cap');
  assert.equal(humanizeChangePath('environments'), 'Environments');
  // Anything unrecognised must fall back to the raw path rather than inventing
  // a confident-sounding wrong label.
  assert.equal(humanizeChangePath('some.future.path'), 'some.future.path');
});

test('summarizeDiff groups a bulk quota change into one readable line', () => {
  const diff = [
    { path: 'llmTokenQuota./auto.limit', before: '2000', after: '4000' },
    { path: 'llmTokenQuota./models/gemini-3.5-flash-lite:*.limit', before: '2000', after: '4000' },
    { path: 'llmTokenQuota./models/claude-haiku-5-5:*.limit', before: '50', after: '100' },
  ];
  const summary = summarizeDiff('Customer Support and Sales (Dev)', diff);
  assert.equal(summary, 'Raised 3 per-minute token limits on Customer Support and Sales');
  // No config paths may leak into the card summary.
  assert.ok(!/llmTokenQuota|operationConfigs|\{"/.test(summary), summary);
});

test('summarizeDiff falls back to labelled detail for a mixed change', () => {
  const diff = [
    { path: 'attributes.developer.budget.limit', before: '5000000', after: '9000000' },
  ];
  const summary = summarizeDiff('Customer Support and Sales (Dev)', diff);
  assert.equal(summary, 'Customer Support and Sales: Monthly spending cap: 5000000 \u2192 9000000');
});

test('quota resources resolve from a bare model id, and unknown ones are rejected', () => {
  const product = standardDevProduct();
  assert.equal(resolveQuotaResource(product, 'gemini-3.6-flash'), '/models/gemini-3.6-flash:*');
  assert.equal(resolveQuotaResource(product, '/models/gemini-3.6-flash:*'), '/models/gemini-3.6-flash:*');
  assert.equal(resolveQuotaResource(product, 'auto'), '/auto');
  assert.throws(() => resolveQuotaResource(product, 'claude-opus-5-5'), /is not an operation on/);
});

test('buildDevClone pins the clone to dev with auto approval', () => {
  const clone = buildDevClone({
    name: 'Engineering and IT',
    environments: ['dev', 'prod'],
    approvalType: 'manual',
    attributes: [{ name: 'access', value: 'private' }],
    llmOperationGroup: { operationConfigs: [] },
    createdAt: '1',
    lastModifiedAt: '2',
  });
  assert.equal(clone.name, 'Engineering and IT Dev', 'Apigee rejects parentheses in a product name');
  assert.equal(clone.displayName, 'Engineering and IT (Dev)');
  assert.deepEqual(clone.environments, ['dev']);
  assert.equal(clone.approvalType, 'auto');
  assert.equal(clone.createdAt, undefined);
  assert.equal(clone.lastModifiedAt, undefined);
});

test('stripServerFields removes only Apigee-owned metadata', () => {
  const stripped = stripServerFields({ name: 'x', createdAt: '1', lastModifiedBy: 'a', keep: 1 });
  assert.deepEqual(stripped, { name: 'x', keep: 1 });
});

// ---------------------------------------------------------------------------
// Snapshot / revert -- requirement #3
// ---------------------------------------------------------------------------

test('ChangeStore keeps at most the newest 50 changes, newest first', () => {
  const store = new ChangeStore();
  for (let i = 0; i < MAX_TRACKED_CHANGES + 5; i += 1) {
    store.record({ changeId: `chg_${String(i).padStart(8, '0')}`, status: 'applied' }, '{}');
  }
  assert.equal(store.size, MAX_TRACKED_CHANGES);
  assert.equal(store.get('chg_00000000'), null, 'oldest change evicted');
  assert.equal(store.list()[0].changeId, 'chg_00000054');
  assert.equal(store.list().length, MAX_TRACKED_CHANGES);
});

test('revert restores the exact pre-change bytes, not the demo defaults', async () => {
  const before = standardDevProduct();
  const { state, service } = makeHarness({ products: { 'Customer Support and Sales Dev': before } });

  const change = await service._internals.applyDevChange(
    validateToolArgs('update_dev_product', {
      sourceProduct: 'Customer Support and Sales',
      changes: [{ path: 'llmTokenQuota.gemini-3.6-flash.limit', value: '9000' }],
    })
  );
  assert.equal(change.productName, 'Customer Support and Sales (Dev)');
  assert.equal(change.env, 'dev');
  assert.equal(change.status, 'applied');
  assert.match(change.changeId, /^chg_[0-9a-f]{8}$/);
  assert.equal(state.products['Customer Support and Sales Dev'].llmOperationGroup.operationConfigs[1].llmTokenQuota.limit, '9000');

  await service._internals.revertChange(change.changeId);

  assert.equal(
    JSON.stringify(state.products['Customer Support and Sales Dev']),
    JSON.stringify(stripServerFields(before)),
    'revert must replay the snapshot byte for byte'
  );
  assert.deepEqual(
    state.products['Customer Support and Sales Dev'].someUnknownField,
    { keep: 'me' },
    'fields the agent never knew about survive a revert'
  );
  assert.equal(service._internals.changes.get(change.changeId).change.status, 'reverted');
});

test('every write from update_dev_product targets the "(Dev)" product only', async () => {
  const { state, service } = makeHarness({
    products: { 'Customer Support and Sales Dev': standardDevProduct() },
  });
  await service._internals.applyDevChange(
    validateToolArgs('update_dev_product', {
      sourceProduct: 'Customer Support and Sales',
      changes: [{ path: 'attributes.access', value: 'public' }],
    })
  );
  const writes = state.calls.filter((c) => c.method === 'PUT' || c.method === 'POST');
  assert.ok(writes.length > 0);
  for (const write of writes) {
    // The logical name is "Customer Support and Sales (Dev)"; the resource it maps to is
    // the paren-free one. Neither may ever be the live tier.
    assert.equal(decodeURIComponent(write.url).endsWith('/apiproducts/Customer Support and Sales Dev'), true);
    assert.doesNotMatch(decodeURIComponent(write.url), /apiproducts\/Customer Support and Sales$/);
    assert.equal(write.body.name, 'Customer Support and Sales Dev');
  }
});

test('a no-op change is refused rather than recorded as an empty diff', async () => {
  const { service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  await assert.rejects(
    () =>
      service._internals.applyDevChange(
        validateToolArgs('update_dev_product', {
          sourceProduct: 'Customer Support and Sales',
          changes: [{ path: 'attributes.access', value: 'private' }],
        })
      ),
    /already in place/
  );
});

test('a no-op is reported as a normal outcome, not as an error event', async () => {
  // Regression: asking for a change that is already in place produced an
  // `error` event, which the panel renders as a red failure banner directly
  // underneath an otherwise correct reply ("that is already set to X").
  const { service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const events = [];
  const result = await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: { sourceProduct: 'Customer Support and Sales', changes: [{ path: 'attributes.access', value: 'private' }] },
    },
    events
  );

  assert.match(result.error, /already in place/);
  assert.equal(
    events.filter((e) => e.type === 'error').length,
    0,
    'a no-op must not surface as an error to the admin'
  );
  // The model still has to see what happened, or it cannot explain itself.
  const toolEvent = events.find((e) => e.type === 'tool_call');
  assert.match(toolEvent.summary, /already in place/);
  assert.equal(toolEvent.ok, true);
});

test('a genuine tool failure still surfaces as an error event', async () => {
  const { service } = makeHarness({ products: {} });
  const events = [];
  await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: { sourceProduct: 'Customer Support and Sales', changes: [{ path: 'attributes.access', value: 'public' }] },
    },
    events
  );
  assert.ok(
    events.some((e) => e.type === 'error'),
    'the no-op carve-out must not swallow real failures'
  );
});

test('there is no promote path: the live tier is never written', async () => {
  // Promotion to prod was removed on purpose. Production is changed only by a
  // pull request against the product definitions in git, so the agent must have
  // no code path -- and no API surface -- that writes a live product.
  const live = {
    name: 'Customer Support and Sales',
    environments: ['dev', 'prod'],
    attributes: [{ name: 'access', value: 'private' }],
    llmOperationGroup: standardDevProduct().llmOperationGroup,
  };
  const { state, service } = makeHarness({
    products: { 'Customer Support and Sales Dev': standardDevProduct(), 'Customer Support and Sales': live },
  });

  assert.equal(
    service._internals.promoteChange,
    undefined,
    'promoteChange must not exist on the service'
  );

  const change = await service._internals.applyDevChange(
    validateToolArgs('update_dev_product', {
      sourceProduct: 'Customer Support and Sales',
      changes: [{ path: 'llmTokenQuota.gemini-3.6-flash.limit', value: '7777' }],
    })
  );
  assert.equal(change.status, 'applied');

  // The dev clone moved...
  assert.equal(
    state.products['Customer Support and Sales Dev'].llmOperationGroup.operationConfigs[1].llmTokenQuota.limit,
    '7777'
  );
  // ...and the live tier did not.
  assert.equal(
    state.products['Customer Support and Sales'].llmOperationGroup.operationConfigs[1].llmTokenQuota.limit,
    '2000'
  );

  // No write of any kind may have been addressed to the live product.
  const liveWrites = state.calls.filter(
    (c) => (c.method === 'PUT' || c.method === 'POST') && /apiproducts\/Customer Support and Sales$/.test(decodeURIComponent(c.url))
  );
  assert.equal(liveWrites.length, 0, 'the agent must never PUT a live tier');

  // Revert only unwinds the dev clone.
  await service._internals.revertChange(change.changeId);
  assert.equal(
    state.products['Customer Support and Sales Dev'].llmOperationGroup.operationConfigs[1].llmTokenQuota.limit,
    '2000'
  );
});

test('the /promote endpoint explains the git flow instead of 404ing', async () => {
  // A browser tab opened before promotion was removed will still POST here.
  const { service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const res = fakeRes();
  await service.handleRequest(
    fakeReq('POST', JSON.stringify({ changeId: 'chg_00000000' })),
    res,
    new URL('http://x/api/admin-agent/promote')
  );
  assert.equal(res.statusCode, 403);
  const parsed = JSON.parse(res.body);
  assert.match(parsed.error, /pull request/i);
  assert.doesNotMatch(parsed.error, /unknown admin-agent route/i);
});

test('revert of an unknown change id fails cleanly', async () => {
  const { service } = makeHarness();
  await assert.rejects(() => service._internals.revertChange('chg_00000000'), /No snapshot for change/);
});

test('assertDevOnlyEnvironments allows only ["dev"]', () => {
  assert.deepEqual(assertDevOnlyEnvironments(['dev']), ['dev']);
  // An empty list means "all environments" to Apigee, so it is refused too.
  for (const bad of [[], undefined, ['prod'], ['dev', 'prod'], ['qa']]) {
    assert.throws(
      () => assertDevOnlyEnvironments(bad),
      (err) => err instanceof AdminAgentError && err.code === 'forbidden_target',
      JSON.stringify(bad)
    );
  }
});

test('the agent cannot attach a dev clone to prod (no promote by the back door)', async () => {
  const { state, service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const events = [];
  const result = await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: { sourceProduct: 'Customer Support and Sales', changes: [{ path: 'environments', value: '["dev","prod"]' }] },
    },
    events
  );
  assert.match(result.error, /only deploy sandbox products to "dev"/);
  assert.equal(state.calls.filter((c) => c.method === 'PUT' || c.method === 'POST').length, 0, 'nothing written');
  assert.deepEqual(state.products['Customer Support and Sales Dev'].environments, ['dev']);
});

test('a dev clone already attached to prod is never written by the agent', async () => {
  // Hand-edited in the console: the write choke point must still refuse it,
  // rather than carrying `prod` forward into the agent's PUT.
  const tainted = { ...standardDevProduct(), environments: ['dev', 'prod'] };
  const { state, service } = makeHarness({ products: { 'Customer Support and Sales Dev': tainted } });
  await assert.rejects(
    () =>
      service._internals.applyDevChange(
        validateToolArgs('update_dev_product', {
          sourceProduct: 'Customer Support and Sales',
          changes: [{ path: 'attributes.access', value: 'public' }],
        })
      ),
    (err) => err instanceof AdminAgentError && err.code === 'forbidden_target'
  );
  assert.equal(state.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('provisioning heals a dev clone that was attached to prod back to dev-only', async () => {
  const tainted = { ...standardDevProduct(), environments: ['dev', 'prod'] };
  const enterpriseDev = { ...standardDevProduct(), name: 'Engineering and IT Dev', displayName: 'Engineering and IT (Dev)' };
  const { state, service } = makeHarness({
    products: { 'Customer Support and Sales Dev': tainted, 'Engineering and IT Dev': enterpriseDev },
  });
  const result = await service._internals.provisionSandbox();
  assert.deepEqual(state.products['Customer Support and Sales Dev'].environments, ['dev']);
  assert.ok(result.notes.some((n) => /Repaired Customer Support and Sales \(Dev\)/.test(n)), result.notes.join('; '));
});

// ---------------------------------------------------------------------------
// Function declarations
// ---------------------------------------------------------------------------

test('the Gemini functionDeclarations JSON is well formed', () => {
  const decls = buildFunctionDeclarations();
  assert.deepEqual(decls.map((d) => d.name), TOOL_NAMES);
  // Must survive the wire unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(decls)), decls);

  for (const decl of decls) {
    assert.match(decl.name, /^[a-z][a-z0-9_]{0,62}$/, `${decl.name} is not a legal function name`);
    assert.ok(decl.description && decl.description.length > 20, `${decl.name} needs a description`);
    assert.equal(decl.parameters.type, 'object');
    assert.equal(typeof decl.parameters.properties, 'object');
    for (const [prop, schema] of Object.entries(decl.parameters.properties)) {
      assert.ok(schema.type, `${decl.name}.${prop} has no type`);
      assert.ok(schema.description, `${decl.name}.${prop} has no description`);
      if (schema.enum) assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0);
      if (schema.type === 'array') assert.equal(schema.items.type, 'object');
    }
    for (const req of decl.parameters.required || []) {
      assert.ok(decl.parameters.properties[req], `${decl.name} requires undeclared property ${req}`);
    }
  }

  const getProduct = decls.find((d) => d.name === 'get_product');
  assert.deepEqual(getProduct.parameters.properties.name.enum, KNOWN_PRODUCTS);
  const update = decls.find((d) => d.name === 'update_dev_product');
  assert.deepEqual(update.parameters.properties.sourceProduct.enum, LIVE_PRODUCTS);
});

// ---------------------------------------------------------------------------
// Tool loop -- requirement #4
// ---------------------------------------------------------------------------

function modelTurn(parts, headers = {}) {
  return {
    ok: true,
    status: 200,
    json: { candidates: [{ content: { parts } }], usageMetadata: { totalTokenCount: 10 } },
    headers: { 'x-gateway-cost-usd': '0.000010', ...headers },
  };
}

test('the tool loop stops at the 6-iteration cap when the model never stops calling tools', async () => {
  let modelCalls = 0;
  const executed = [];
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'go' }] }],
    tools: [],
    callModel: async () => {
      modelCalls += 1;
      return modelTurn([{ functionCall: { name: 'list_products', args: {}, id: `call_${modelCalls}` } }]);
    },
    executeTool: async (call, events) => {
      executed.push(call.id);
      events.push({ type: 'tool_call', name: call.name, summary: 'listed products', ok: true });
      return { products: [] };
    },
  });

  assert.equal(modelCalls, MAX_TOOL_ITERATIONS);
  assert.equal(result.iterations, MAX_TOOL_ITERATIONS);
  assert.equal(result.stopReason, 'iteration_cap');
  assert.equal(executed.length, MAX_TOOL_ITERATIONS);
  assert.ok(result.reply.length > 0, 'a capped turn must still answer something useful');
  assert.equal(result.events.filter((e) => e.type === 'error').length, 1);
  assert.match(result.events.at(-1).message, /tool-call limit/);
  assert.equal(result.usage.totalTokens, 10 * MAX_TOOL_ITERATIONS);
});

test('the tool loop returns the model text and stops as soon as there are no tool calls', async () => {
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => modelTurn([{ text: 'Standard is capped at 2000 tokens/min.' }], {
      'x-gateway-model': 'gemini-3.6-flash',
    }),
    executeTool: async () => ({}),
  });
  assert.equal(result.stopReason, 'complete');
  assert.equal(result.iterations, 1);
  assert.equal(result.reply, 'Standard is capped at 2000 tokens/min.');
  assert.equal(result.usage.model, 'gemini-3.6-flash');
  assert.equal(result.usage.costUsd, 0.00001);
});

test('an empty text part on a pure tool-call turn is not treated as an answer', async () => {
  let call = 0;
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => {
      call += 1;
      return call === 1
        ? modelTurn([{ text: '' }, { functionCall: { name: 'get_rate_card', args: {}, id: 'c1' } }])
        : modelTurn([{ text: 'Flash costs $0.30/1M in.' }]);
    },
    executeTool: async () => ({ rates: {} }),
  });
  assert.equal(result.iterations, 2);
  assert.equal(result.reply, 'Flash costs $0.30/1M in.');
});

test('nativeToolTurn echoes the call id so multi-tool turns correlate', async () => {
  let seen = null;
  let call = 0;
  await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    encodeToolTurn: nativeToolTurn,
    callModel: async ({ contents }) => {
      call += 1;
      if (call === 1) {
        return modelTurn([
          { functionCall: { name: 'get_product', args: { name: 'Customer Support and Sales' }, id: 'call_1' } },
          { functionCall: { name: 'get_rate_card', args: {}, id: 'call_2' } },
        ]);
      }
      seen = contents.at(-1).parts;
      return modelTurn([{ text: 'done' }]);
    },
    executeTool: async () => ({ ok: true }),
  });
  assert.deepEqual(seen.map((p) => p.functionResponse.id), ['call_1', 'call_2']);
  assert.deepEqual(seen.map((p) => p.functionResponse.name), ['get_product', 'get_rate_card']);
});

test('the default transcript encoding is text-only, because the gateway rejects tool parts', async () => {
  // OAS-ValidateRequest on the AI proxy validates `contents[].parts[]` against
  // a text-only schema; sending functionCall/functionResponse back returns 400.
  let sent = null;
  let call = 0;
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'what is the standard quota?' }] }],
    tools: [],
    callModel: async ({ contents }) => {
      call += 1;
      if (call === 1) {
        return modelTurn([
          { functionCall: { name: 'get_product', args: { name: 'Customer Support and Sales' }, id: 'call_1' } },
        ]);
      }
      sent = contents;
      return modelTurn([{ text: '2000 tokens/min.' }]);
    },
    executeTool: async () => ({ product: { name: 'Customer Support and Sales', limit: '2000' } }),
  });

  assert.equal(result.reply, '2000 tokens/min.');
  const serialized = JSON.stringify(sent);
  assert.doesNotMatch(serialized, /functionCall/, 'no functionCall may be sent back through the gateway');
  assert.doesNotMatch(serialized, /functionResponse/, 'no functionResponse may be sent back either');
  assert.doesNotMatch(serialized, /thoughtSignature/);
  // Every part must be a plain text part...
  for (const content of sent) {
    for (const part of content.parts) assert.deepEqual(Object.keys(part), ['text']);
  }
  // ...and roles must still alternate, which is why a text stand-in replaces
  // the model's own tool-call turn.
  assert.deepEqual(sent.map((c) => c.role), ['user', 'model', 'user']);
  // The stand-in is deliberately NOT natural prose: the model used to copy a
  // "Calling get_product(...)" line out of its own transcript and emit it as a
  // final answer, so the marker is now something it will never imitate.
  assert.match(sent[1].parts[0].text, /^<<TOOL_CALL_ISSUED get_product\(/);
  assert.match(sent[2].parts[0].text, /TOOL RESULTS \(system-generated/);
  assert.match(sent[2].parts[0].text, /"limit":"2000"/);
  assert.match(sent[2].parts[0].text, /\[call_1\]/, 'the call id is preserved for correlation');
});

test('textToolTurn labels results so they are not mistaken for user input', () => {
  const [modelTurnContent, userTurnContent] = textToolTurn({
    results: [{ call: { name: 'list_products', args: {}, id: 'c1' }, response: { products: [] } }],
  });
  assert.equal(modelTurnContent.role, 'model');
  assert.equal(userTurnContent.role, 'user');
  assert.match(userTurnContent.parts[0].text, /not typed by the user/);
});

test('a gateway 429 degrades into an error event plus a useful reply', async () => {
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => ({
      ok: false,
      status: 429,
      json: { fault: { faultstring: 'Token quota exceeded' } },
      headers: {},
    }),
    executeTool: async () => ({}),
  });
  assert.equal(result.stopReason, 'model_error');
  assert.equal(result.events.filter((e) => e.type === 'error').length, 1);
  // This fixture is an Apigee quota fault, so it must be attributed to *our*
  // governance -- not to upstream Vertex capacity.
  assert.match(result.events[0].message, /gateway's own governance stopped this call/);
  assert.match(result.events[0].message, /token quota or prepaid wallet budget is exhausted/);
  assert.ok(result.reply.includes("I couldn't complete that turn."));
});

test('a throwing callModel or executeTool never escapes the loop', async () => {
  const thrown = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => {
      throw new Error('socket hang up');
    },
    executeTool: async () => ({}),
  });
  assert.equal(thrown.stopReason, 'model_error');
  assert.match(thrown.events[0].message, /socket hang up/);

  let call = 0;
  const toolThrew = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => {
      call += 1;
      return call === 1
        ? modelTurn([{ functionCall: { name: 'boom', args: {}, id: 'c1' } }])
        : modelTurn([{ text: 'recovered' }]);
    },
    executeTool: async () => {
      throw new Error('apigee exploded');
    },
  });
  assert.equal(toolThrew.reply, 'recovered');
  assert.ok(toolThrew.events.some((e) => e.type === 'error' && /apigee exploded/.test(e.message)));
});

test('the tool loop abandons the turn once the wall-clock budget is spent', async () => {
  let clock = 0;
  const result = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    // Explicit, so raising TOOL_LOOP_BUDGET_MS in production never silently
    // turns this into an iteration-cap test instead of a budget test.
    budgetMs: 30_000,
    now: () => clock,
    callModel: async () => {
      clock += 11_000; // three round-trips exhaust the budget
      return modelTurn([{ functionCall: { name: 'list_products', args: {}, id: 'c' } }]);
    },
    executeTool: async () => ({}),
  });
  assert.equal(result.stopReason, 'time_budget');
  assert.equal(result.iterations, 3);
  // The admin-facing text must stay plain English -- no budget constants leaked.
  assert.match(result.events.at(-1).message, /took longer than expected/);
  assert.doesNotMatch(result.events.at(-1).message, /budget|30s/);
  assert.ok(result.reply.includes('ran out of time'));
});

test('the production turn budget leaves room for a read-read-write-summarise turn', () => {
  // Benchmarked: ~2.5s per hop on gemini-3.5-flash-lite. A change request costs
  // 4 hops, so the floor is ~10s; the ceiling keeps a wedged turn from feeling
  // hung. Both bounds are asserted so a future model swap has to revisit this.
  assert.ok(
    TOOL_LOOP_BUDGET_MS >= 4 * 2_500 * 3,
    `TOOL_LOOP_BUDGET_MS (${TOOL_LOOP_BUDGET_MS}ms) is too tight for a 4-hop change turn`
  );
  assert.ok(
    TOOL_LOOP_BUDGET_MS <= 60_000,
    `TOOL_LOOP_BUDGET_MS (${TOOL_LOOP_BUDGET_MS}ms) makes a failed turn feel hung`
  );
});

test('describeGatewayFailure explains the failures an admin can act on', () => {
  assert.match(describeGatewayFailure({ status: 401 }), /rejected the agent's credentials/);
  assert.match(describeGatewayFailure({ status: 503 }), /failing upstream/);
  assert.match(describeGatewayFailure({ status: 0, error: 'ETIMEDOUT' }), /Could not reach the AI Gateway/);
  assert.match(describeGatewayFailure(null), /no response/);
});

test('messagesToContents maps the contract shape and rejects malformed turns', () => {
  assert.deepEqual(
    messagesToContents([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]),
    [
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
      { role: 'user', parts: [{ text: 'c' }] },
    ]
  );
  assert.throws(() => messagesToContents([]), /non-empty array/);
  assert.throws(() => messagesToContents('hi'), /non-empty array/);
  assert.throws(() => messagesToContents([{ role: 'assistant', content: 'b' }]), /last message must come from the user/);
  assert.throws(() => messagesToContents([{ role: 'user', content: '   ' }]), /No message content/);
});

// ---------------------------------------------------------------------------
// TestResult mapping
// ---------------------------------------------------------------------------

test('toTestResult maps the real x-gateway-* headers', () => {
  const result = toTestResult({
    status: 200,
    latencyMs: 2365,
    requestedModel: 'auto',
    json: {
      candidates: [{ content: { parts: [{ text: 'hello' }] } }],
      usageMetadata: { promptTokenCount: 56, candidatesTokenCount: 18, totalTokenCount: 106 },
    },
    headers: {
      'x-gateway-model': 'gemini-3.6-flash',
      'x-gateway-cost-usd': '0.000038',
      'x-gateway-cache-status': 'DISABLED',
      'content-type': 'application/json',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.model, 'gemini-3.6-flash');
  assert.equal(result.totalTokens, 106);
  assert.equal(result.costUsd, 0.000038);
  assert.equal(result.cacheStatus, 'DISABLED');
  assert.equal(result.text, 'hello');
  assert.equal(result.guardrailBlocked, false);
  assert.deepEqual(Object.keys(result.headers).sort(), [
    'x-gateway-cache-status',
    'x-gateway-cost-usd',
    'x-gateway-model',
  ]);
});

test('toTestResult reports a Model Armor block and never invents a model', () => {
  const blocked = toTestResult({
    status: 400,
    latencyMs: 120,
    requestedModel: 'auto',
    json: { fault: { faultstring: 'Blocked by Model Armor: prompt injection' } },
    headers: {},
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.guardrailBlocked, true);
  assert.equal(blocked.model, '', 'an /auto request that never reached a model must not claim one');
  assert.match(blocked.text, /Model Armor/);
});

test('pickGatewayHeaders keeps x-gateway-* only', () => {
  assert.deepEqual(
    pickGatewayHeaders({ 'X-Gateway-Model': 'm', 'set-cookie': 'nope', authorization: 'secret' }),
    { 'x-gateway-model': 'm' }
  );
});

// ---------------------------------------------------------------------------
// Secrets -- requirement #1
// ---------------------------------------------------------------------------

test('redactSecrets scrubs known keys out of a serialized body', () => {
  assert.equal(redactSecrets(`{"k":"${SANDBOX_KEY}"}`, [SANDBOX_KEY]), '{"k":"[redacted]"}');
  assert.equal(redactSecrets('{"k":"x"}', ['', null, 'short']), '{"k":"x"}');
});

test('no endpoint response ever contains the sandbox or admin consumer key', async () => {
  const { service } = makeHarness({
    products: Object.fromEntries(
      DEV_PRODUCTS.map((n) => [apigeeProductName(n), { ...standardDevProduct(), name: apigeeProductName(n) }])
    ),
  });

  // Warm both keys into process memory.
  await service._internals.sandboxStatus();
  assert.equal(service._internals.secrets.sandboxKey, SANDBOX_KEY, 'the key is held server-side');

  for (const [path, method, body] of [
    ['/api/admin-agent/sandbox', 'GET', undefined],
    ['/api/admin-agent/sandbox/provision', 'POST', '{}'],
    ['/api/admin-agent/changes', 'GET', undefined],
  ]) {
    const res = fakeRes();
    await service.handleRequest(fakeReq(method, body), res, new URL(`http://x${path}`));
    assert.equal(res.headers['Content-Type'], 'application/json');
    assert.doesNotMatch(res.body, new RegExp(SANDBOX_KEY), `${path} leaked the sandbox key`);
    assert.doesNotMatch(res.body, new RegExp(ADMIN_KEY), `${path} leaked the admin key`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.status, 'ok');
  }

  const res = fakeRes();
  await service.handleRequest(fakeReq('GET', undefined), res, new URL('http://x/api/admin-agent/sandbox'));
  const sandbox = JSON.parse(res.body);
  assert.equal(sandbox.keyPresent, true);
  assert.equal(sandbox.consumerKey, undefined);
  assert.equal(sandbox.key, undefined);
});

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

test('handlers answer with structured JSON errors, never a throw', async () => {
  const { service } = makeHarness();

  const cases = [
    { path: '/api/admin-agent/sandbox', method: 'POST', body: '{}', status: 405 },
    { path: '/api/admin-agent/chat', method: 'POST', body: 'not json', status: 400 },
    { path: '/api/admin-agent/chat', method: 'POST', body: '{"messages":[]}', status: 400 },
    { path: '/api/admin-agent/revert', method: 'POST', body: '{"changeId":"chg_11111111"}', status: 404 },
    // Promotion is disabled, not missing: 403 with an explanation, not a 404.
    { path: '/api/admin-agent/promote', method: 'POST', body: '{}', status: 403 },
    { path: '/api/admin-agent/test', method: 'POST', body: '{}', status: 400 },
    { path: '/api/admin-agent/nope', method: 'GET', body: undefined, status: 404 },
  ];

  for (const c of cases) {
    const res = fakeRes();
    await service.handleRequest(fakeReq(c.method, c.body), res, new URL(`http://x${c.path}`));
    assert.equal(res.statusCode, c.status, `${c.method} ${c.path}`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.status, 'error');
    assert.ok(parsed.error && parsed.code, `${c.path} must name the failure`);
  }
});

test('an unprovisioned sandbox refuses a dev test instead of hanging', async () => {
  const { service } = makeHarness({ appExists: false });
  const res = fakeRes();
  await service.handleRequest(
    fakeReq('POST', '{"prompt":"hello"}'),
    res,
    new URL('http://x/api/admin-agent/test')
  );
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /not provisioned/);
});

test('provision creates every dev clone and the sandbox app', async () => {
  const { state, service } = makeHarness({
    products: {
      'Customer Support and Sales': { name: 'Customer Support and Sales', environments: ['dev', 'prod'], attributes: [] },
      'Engineering and IT': { name: 'Engineering and IT', environments: ['dev', 'prod'], attributes: [] },
      'Analysts and Knowledge Workers': { name: 'Analysts and Knowledge Workers', environments: ['dev', 'prod'], attributes: [] },
    },
    appExists: false,
  });
  const res = fakeRes();
  await service.handleRequest(fakeReq('POST', '{}'), res, new URL('http://x/api/admin-agent/sandbox/provision'));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.provisioned, true);
  assert.equal(body.keyPresent, true);
  for (const dev of DEV_PRODUCTS) {
    assert.deepEqual(state.products[apigeeProductName(dev)].environments, ['dev']);
    assert.equal(state.products[apigeeProductName(dev)].approvalType, 'auto');
    assert.equal(state.products[apigeeProductName(dev)].displayName, dev);
  }
  // The live tiers must be untouched by provisioning.
  assert.deepEqual(state.products['Customer Support and Sales'].environments, ['dev', 'prod']);
});

test('executeTool surfaces failures as tool_call events instead of throwing', async () => {
  const { service } = makeHarness();
  const events = [];
  const out = await service._internals.executeTool(
    { name: 'get_product', args: { name: 'Nonexistent Tier' }, id: 'c1' },
    events
  );
  assert.ok(out.error);
  assert.equal(events[0].ok, false);
  assert.equal(events[0].type, 'tool_call');

  const events2 = [];
  const missing = await service._internals.executeTool(
    { name: 'get_product', args: { name: 'Customer Support and Sales' }, id: 'c2' },
    events2
  );
  assert.match(missing.error, /does not exist/);
});

test('list_guardrails answers from the server-side mirror', async () => {
  const { service } = makeHarness();
  const events = [];
  const out = await service._internals.executeTool({ name: 'list_guardrails', args: { gateway: 'ai' } }, events);
  assert.equal(out.controls.length, GUARDRAIL_CONTROLS.filter((c) => c.gateway === 'ai').length);
  assert.ok(out.controls.every((c) => c.gateway === 'ai'));
  assert.ok(out.controls[0].policies.every((p) => typeof p === 'string'));
  assert.equal(listGuardrails().length, GUARDRAIL_CONTROLS.length);
});

test('allowedTestModels only offers what the dev products entitle', () => {
  const models = allowedTestModels([standardDevProduct()]);
  assert.deepEqual(models.sort(), ['auto', 'gemini-3.6-flash']);
  assert.ok(!models.includes('claude-opus-5-5'));
});

test('the synthetic identity token is an RS256 JWT with a non-empty signature', () => {
  const token = mintSyntheticIdentityToken('a@b.com', 'A B', 1_700_000_000_000);
  const [h, p, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).email, 'a@b.com');
  assert.ok(s.length > 0, 'Apigee DecodeJWT rejects an empty signature segment');
});

test('newChangeId always produces the contract id shape', () => {
  assert.match(newChangeId(() => 'ff00ff00'), /^chg_ff00ff00$/);
  assert.match(newChangeId(() => 'zz'), /^chg_[0-9a-f]{8}$/);
  assert.match(newChangeId(), /^chg_[0-9a-f]{8}$/);
});

// ---------------------------------------------------------------------------
// Agent model selection
// ---------------------------------------------------------------------------

test('the agent runs on gemini-3.5-flash-lite and downgrades only on an entitlement failure', async () => {
  // Chosen by benchmark: ~2.2s tool turns, 3/3 tool calls, no thinking tokens.
  // The previous pick (gemini-3.8-flash) started returning 504s at the gateway.
  assert.equal(AGENT_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(AGENT_FALLBACK_MODEL, 'gemini-3.6-flash');

  const seen = [];
  const { service } = makeHarness({
    gateway: (url) => {
      seen.push(url);
      if (url.includes(AGENT_MODEL)) {
        return fakeResponse(403, { fault: { faultstring: 'model not entitled' } });
      }
      return fakeResponse(200, { candidates: [{ content: { parts: [{ text: 'hi' }] } }] }, {
        'x-gateway-cost-usd': '0.00004',
      });
    },
  });

  const first = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(first.ok, true);
  assert.equal(first.model, AGENT_FALLBACK_MODEL, 'usage.model must name the model that served');
  assert.equal(seen.length, 2);

  // The downgrade sticks, so the dead model is not retried on every turn.
  const second = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(second.model, AGENT_FALLBACK_MODEL);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((u, i) => (i === 0 ? true : u.includes(AGENT_FALLBACK_MODEL))));
});

test('a 429 on the primary model is not mistaken for an entitlement failure', async () => {
  const seen = [];
  const { service } = makeHarness({
    gateway: (url) => {
      seen.push(url);
      return fakeResponse(429, { fault: { faultstring: 'Token quota exceeded' } });
    },
  });
  const res = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(res.status, 429);
  assert.equal(res.model, AGENT_MODEL, 'a wallet/quota 429 must not silently downgrade the model');
  assert.equal(seen.length, 1, 'no pointless retry on a quota failure');
});

// ---------------------------------------------------------------------------
// HTTP 429: our governance vs upstream capacity
// ---------------------------------------------------------------------------

// The exact body Vertex returns through the gateway when it is out of capacity.
const VERTEX_EXHAUSTED = {
  error: {
    code: 429,
    message:
      'Resource exhausted. Please try again later. Please refer to ' +
      'https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429 for more details.',
    status: 'RESOURCE_EXHAUSTED',
  },
};

test('classifyRateLimit tells upstream capacity apart from our own quota', () => {
  assert.equal(
    classifyRateLimit({ status: 429, json: VERTEX_EXHAUSTED }),
    RATE_LIMIT_UPSTREAM_CAPACITY
  );
  assert.equal(
    classifyRateLimit({ status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED' } } }),
    RATE_LIMIT_UPSTREAM_CAPACITY
  );

  // Apigee's own LLMTokenQuota / Quota policy fault.
  assert.equal(
    classifyRateLimit({
      status: 429,
      json: {
        fault: {
          faultstring: 'Rate limit quota violation. Quota limit exceeded. Identifier : _default',
          detail: { errorcode: 'policies.ratelimit.QuotaViolation' },
        },
      },
    }),
    RATE_LIMIT_APIGEE_QUOTA
  );
  assert.equal(
    classifyRateLimit({ status: 429, json: { fault: { faultstring: 'Token quota exceeded' } } }),
    RATE_LIMIT_APIGEE_QUOTA
  );
  // A gateway header is enough on its own.
  assert.equal(
    classifyRateLimit({ status: 429, json: {}, headers: { 'x-gateway-budget-status': 'exceeded' } }),
    RATE_LIMIT_APIGEE_QUOTA
  );
  // ...but a healthy budget header must not be read as exhaustion.
  assert.equal(
    classifyRateLimit({ status: 429, json: {}, headers: { 'x-gateway-budget-status': 'ok' } }),
    RATE_LIMIT_UNKNOWN
  );
  // No evidence either way: say so rather than guess.
  assert.equal(classifyRateLimit({ status: 429, json: {} }), RATE_LIMIT_UNKNOWN);
  assert.equal(classifyRateLimit({ status: 429, text: 'too many requests' }), RATE_LIMIT_UNKNOWN);
});

test('each kind of 429 is described honestly', () => {
  const upstream = describeGatewayFailure({ status: 429, json: VERTEX_EXHAUSTED });
  assert.match(upstream, /Vertex AI is out of model capacity/);
  assert.match(upstream, /unrelated to your token quota or wallet/);
  assert.doesNotMatch(upstream, /exhausted\.\s*Raise the quota/);

  const ours = describeGatewayFailure({
    status: 429,
    json: { fault: { faultstring: 'Token quota exceeded', detail: { errorcode: 'policies.ratelimit.QuotaViolation' } } },
  });
  assert.match(ours, /governance stopped this call/);
  assert.match(ours, /Raise the quota on the API Product or top up the developer wallet/);
  assert.doesNotMatch(ours, /Vertex AI is out of model capacity/);

  const ambiguous = describeGatewayFailure({ status: 429, json: {} });
  assert.match(ambiguous, /does not say whether that is our/);

  const retried = describeGatewayFailure({ status: 429, json: VERTEX_EXHAUSTED, retriedUpstream: true });
  assert.match(retried, /already retried once/);
});

test('a Vertex capacity 429 is retried exactly once, with backoff', async () => {
  const seen = [];
  const slept = [];
  let call = 0;
  const { service } = makeHarness({
    gateway: (url) => {
      seen.push(url);
      call += 1;
      return call === 1
        ? fakeResponse(429, VERTEX_EXHAUSTED)
        : fakeResponse(200, { candidates: [{ content: { parts: [{ text: 'recovered' }] } }] });
    },
    sleep: async (ms) => slept.push(ms),
  });

  const res = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(res.ok, true, 'the retry should have succeeded');
  assert.equal(seen.length, 2, 'exactly one retry');
  assert.deepEqual(slept, [1500], 'backoff before the retry');
  assert.equal(res.model, AGENT_MODEL, 'a transient upstream 429 must not downgrade the model');
});

test('a persistent Vertex capacity 429 gives up after one retry and says so', async () => {
  const seen = [];
  const slept = [];
  const { service } = makeHarness({
    gateway: (url) => {
      seen.push(url);
      return fakeResponse(429, VERTEX_EXHAUSTED);
    },
    sleep: async (ms) => slept.push(ms),
  });

  const res = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(res.status, 429);
  assert.equal(seen.length, 2, 'one retry, not a retry storm');
  assert.equal(res.retriedUpstream, true);
  assert.match(describeGatewayFailure(res), /already retried once/);
});

test('an Apigee quota 429 is never retried — that failure is the governance story', async () => {
  const seen = [];
  const slept = [];
  const { service } = makeHarness({
    gateway: (url) => {
      seen.push(url);
      return fakeResponse(429, {
        fault: {
          faultstring: 'Rate limit quota violation. Quota limit exceeded.',
          detail: { errorcode: 'policies.ratelimit.QuotaViolation' },
        },
      });
    },
    sleep: async (ms) => slept.push(ms),
  });

  const res = await service._internals.callAgentModel({ contents: [], systemInstruction: 's', tools: [] });
  assert.equal(res.status, 429);
  assert.equal(seen.length, 1, 'fail fast: no retry, no delay');
  assert.deepEqual(slept, []);
  assert.equal(res.retriedUpstream, undefined);
  assert.match(describeGatewayFailure(res), /governance stopped this call/);
});

test('the two 429 paths diverge end-to-end through the tool loop', async () => {
  const upstream = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => ({ ok: false, status: 429, json: VERTEX_EXHAUSTED, headers: {}, retriedUpstream: true }),
    executeTool: async () => ({}),
  });
  assert.equal(upstream.stopReason, 'model_error');
  assert.match(upstream.events[0].message, /Vertex AI is out of model capacity/);
  assert.doesNotMatch(upstream.events[0].message, /wallet budget is exhausted/);

  const ours = await runToolLoop({
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    tools: [],
    callModel: async () => ({
      ok: false,
      status: 429,
      json: { fault: { faultstring: 'Token quota exceeded' } },
      headers: {},
    }),
    executeTool: async () => ({}),
  });
  assert.match(ours.events[0].message, /governance stopped this call/);
});


// ---------------------------------------------------------------------------
// Admin personas: the agent only changes what the acting persona owns
// ---------------------------------------------------------------------------

test('Finance cannot make the agent change a routing model; the product is untouched', async () => {
  const { state, service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const before = JSON.stringify(state.products['Customer Support and Sales Dev']);
  const events = [];
  const result = await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: {
        sourceProduct: 'Customer Support and Sales',
        changes: [{ path: 'attributes.routing.model.coding', value: 'gemini-3.1-pro-preview' }],
      },
    },
    events,
    'finance'
  );
  assert.match(result.error, /Finance cannot change routing/);
  assert.equal(JSON.stringify(state.products['Customer Support and Sales Dev']), before);
});

test('Finance can change a budget; AI CoE cannot revert it', async () => {
  const { service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const events = [];
  const result = await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: {
        sourceProduct: 'Customer Support and Sales',
        changes: [{ path: 'attributes.developer.budget.limit', value: '7000000' }],
      },
    },
    events,
    'finance'
  );
  assert.equal(result.applied, true);
  const change = events.find((e) => e.type === 'change').change;
  assert.deepEqual(change.capabilities, ['budget']);

  await assert.rejects(() => service._internals.revertChange(change.changeId, 'ai_coe'), /owned by Finance/);
  const reverted = await service._internals.revertChange(change.changeId, 'finance');
  assert.equal(reverted.status, 'reverted');
});

test('executeTool without a role behaves as Platform Admin (existing callers unchanged)', async () => {
  const { service } = makeHarness({ products: { 'Customer Support and Sales Dev': standardDevProduct() } });
  const result = await service._internals.executeTool(
    {
      name: 'update_dev_product',
      args: {
        sourceProduct: 'Customer Support and Sales',
        changes: [{ path: 'attributes.routing.model.coding', value: 'gemini-3.1-pro-preview' }],
      },
    },
    []
  );
  assert.equal(result.applied, true);
});
