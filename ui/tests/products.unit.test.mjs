import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Test suite for Admin Console AI Products & Entitlements configuration logic

// The three persona products, read from the real definitions (no fixtures).
const productsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../apigee/products');
const loadProduct = (file) => JSON.parse(readFileSync(join(productsRoot, file), 'utf8'));
const ENGINEERING = loadProduct('engineering_and_it.json');
const ANALYSTS = loadProduct('analysts_and_knowledge_workers.json');
const SUPPORT = loadProduct('customer_support_and_sales.json');

const modelsOf = (p) => p.llmOperationGroup.operationConfigs.flatMap((c) => c.llmOperations.map((o) => o.model));
const attr = (p, name) => p.attributes.find((a) => a.name === name)?.value;

test('Customer Support & Sales keeps the 300-token Haiku quota for the token demo', () => {
  const haikuConfig = SUPPORT.llmOperationGroup.operationConfigs.find((c) =>
    c.llmOperations?.some((op) => op.model === 'claude-haiku-5-5')
  );
  assert.ok(haikuConfig, 'Claude Haiku must be present in Customer Support & Sales');
  assert.equal(haikuConfig.llmTokenQuota.limit, '300');
  assert.equal(haikuConfig.llmTokenQuota.interval, '1');
  assert.equal(haikuConfig.llmTokenQuota.timeUnit, 'minute');
});

test('persona entitlements: Engineering has everything, Analysts no Claude, Support only fast models', () => {
  const eng = modelsOf(ENGINEERING);
  for (const m of ['gemini-3.1-pro-preview', 'claude-opus-5-5', 'claude-haiku-5-5', 'gemini-3.8-flash']) {
    assert.ok(eng.includes(m), `Engineering & IT must include ${m}`);
  }
  const analysts = modelsOf(ANALYSTS);
  assert.ok(analysts.includes('gemini-3.1-pro-preview'));
  assert.ok(!analysts.some((m) => m.startsWith('claude')), 'Analysts must not include Claude');
  assert.deepEqual(
    modelsOf(SUPPORT).filter((m) => m !== 'auto').sort(),
    ['claude-haiku-5-5', 'gemini-3.5-flash-lite', 'gemini-3.6-flash']
  );
});

test('Budget limit conversions between micro-dollars and USD', () => {
  assert.equal(Number(attr(ENGINEERING, 'developer.budget.limit')) / 1e6, 20.0);
  assert.equal(Number(attr(ANALYSTS, 'developer.budget.limit')) / 1e6, 10.0);
  assert.equal(Number(attr(SUPPORT, 'developer.budget.limit')) / 1e6, 5.0);
  assert.equal(String(Math.round(12.5 * 1e6)), '12500000');
});

test('Router target model attribute mappings exist for all 4 intents on every persona', () => {
  for (const p of [ENGINEERING, ANALYSTS, SUPPORT]) {
    for (const k of ['coding', 'deep_reasoning', 'simple', 'general']) {
      assert.ok(attr(p, `routing.model.${k}`), `${p.name}: routing.model.${k}`);
    }
  }
  assert.equal(attr(ENGINEERING, 'routing.model.coding'), 'claude-opus-5-5');
  assert.equal(attr(ANALYSTS, 'routing.model.coding'), 'gemini-3.1-pro-preview');
  assert.equal(attr(SUPPORT, 'routing.model.coding'), 'claude-haiku-5-5');
});

test('Simulated product modifications: add model, update quota, remove model', () => {
  const clone = JSON.parse(JSON.stringify(SUPPORT));
  const before = clone.llmOperationGroup.operationConfigs.length;

  clone.llmOperationGroup.operationConfigs.push({
    apiSource: 'ai-gateway-v1',
    llmOperations: [{ resource: '/models/gemini-3.1-pro-preview:*', methods: ['POST'], model: 'gemini-3.1-pro-preview' }],
    llmTokenQuota: { limit: '5000', interval: '1', timeUnit: 'minute' },
  });
  assert.equal(clone.llmOperationGroup.operationConfigs.length, before + 1);

  const haiku = clone.llmOperationGroup.operationConfigs.find((c) =>
    c.llmOperations.some((op) => op.model === 'claude-haiku-5-5')
  );
  haiku.llmTokenQuota.limit = '5000';
  assert.equal(haiku.llmTokenQuota.limit, '5000');

  clone.llmOperationGroup.operationConfigs = clone.llmOperationGroup.operationConfigs.filter(
    (c) => !c.llmOperations.some((op) => op.model === 'gemini-3.5-flash-lite')
  );
  assert.equal(modelsOf(clone).includes('gemini-3.5-flash-lite'), false);
});

// ---------------------------------------------------------------------------
// /auto vs /auto:* quota parity — reads the REAL sources, not fixtures.
// Apigee won't hold two resources in one operationConfig, so /auto and
// /auto:* (e.g. /auto:generateContent) are separate configs with separate
// quotas. They were once dropped because they drifted; this pins them equal.
// ---------------------------------------------------------------------------

const __here = dirname(fileURLToPath(import.meta.url));

function autoQuotas(product) {
  const byResource = {};
  for (const cfg of product.llmOperationGroup.operationConfigs) {
    for (const op of cfg.llmOperations) byResource[op.resource] = { quota: cfg.llmTokenQuota, op };
  }
  return byResource;
}

function assertAutoParity(product, label) {
  const q = autoQuotas(product);
  assert.ok(q['/auto'], `${label}: missing /auto operationConfig`);
  assert.ok(q['/auto:*'], `${label}: missing /auto:* operationConfig`);
  assert.deepEqual(q['/auto:*'].quota, q['/auto'].quota, `${label}: /auto:* quota drifted from /auto`);
  assert.equal(q['/auto:*'].op.model, 'auto');
  assert.deepEqual(q['/auto:*'].op.methods, ['POST']);
}

const PERSONA_PRODUCT_FILES = ['engineering_and_it.json', 'analysts_and_knowledge_workers.json', 'customer_support_and_sales.json'];

for (const file of PERSONA_PRODUCT_FILES) {
  test(`${file}: /auto and /auto:* share the same llmTokenQuota`, () => {
    const product = JSON.parse(readFileSync(join(__here, '../../apigee/products', file), 'utf8'));
    assertAutoParity(product, file);
  });
}

test('server/defaultProducts.js mirrors apigee/products and keeps /auto parity', async () => {
  const { DEFAULT_PRODUCTS } = await import('../server/defaultProducts.js');
  const fromFiles = Object.fromEntries(
    PERSONA_PRODUCT_FILES.map((f) => {
      const p = JSON.parse(readFileSync(join(__here, '../../apigee/products', f), 'utf8'));
      return [p.name, p];
    })
  );
  assert.deepEqual(DEFAULT_PRODUCTS, fromFiles);
  for (const [name, product] of Object.entries(DEFAULT_PRODUCTS)) assertAutoParity(product, name);
});

test('persona products are prod-only (their dev clones are the sandbox)', () => {
  for (const f of PERSONA_PRODUCT_FILES) {
    const p = JSON.parse(readFileSync(join(__here, '../../apigee/products', f), 'utf8'));
    assert.deepEqual(p.environments, ['prod'], f);
    assert.doesNotMatch(p.name, /[&()]/, `${f}: Apigee rejects & and () in a product name`);
  }
});

test('Restricted Model scenario: its model is in the dropdown and entitled by no product', () => {
  const settings = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/services/defaultSettings.ts'), 'utf8');
  const restricted = settings.match(/\{ id: '([^']+)',[^}]*tag: 'Restricted \(Not Entitled\)' \}/)?.[1];
  assert.equal(restricted, 'gemini-2.5-pro');
  // The Restricted Model preset must aim at that same model.
  const preset = settings.slice(settings.indexOf("tag: 'Restricted Model'"));
  assert.match(preset.slice(0, 1500), new RegExp(`model: '${restricted.replace(/\./g, '\\.')}'`));
  // No product file may grant it, or the 401 turns into an upstream call.
  for (const file of ['engineering_and_it.json', 'analysts_and_knowledge_workers.json', 'customer_support_and_sales.json']) {
    assert.ok(!modelsOf(loadProduct(file)).includes(restricted), `${file} must not entitle ${restricted}`);
    assert.ok(!readFileSync(join(productsRoot, file), 'utf8').includes(restricted), `${file} must not mention ${restricted}`);
  }
});
