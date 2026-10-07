import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The $50 refund limit in customer-service-v1 applies only to governed callers: keys that hold
// a product listed in KVM refund.limitedProducts. The Apigee MCP server forwards the caller's
// x-apikey, and AE-CallerKey resolves that key's products.

const here = path.dirname(fileURLToPath(import.meta.url));
const apiproxy = path.join(here, '../../apigee/proxies/customer-service-v1/apiproxy');
const code = fs.readFileSync(path.join(apiproxy, 'resources/jsc/check-refund-limit.js'), 'utf8');

const KEY = 'caller-key';
const cred = (key, products) =>
  `<Credential><ApiProducts>${products.map((p) => `<ApiProduct><Name>${p}</Name><Status>approved</Status></ApiProduct>`).join('')}</ApiProducts><ConsumerKey>${key}</ConsumerKey></Credential>`;
// AccessEntity app output: every credential on the app, only the caller's one counts.
const keyEntity = (...products) => `<App><Name>app</Name><Credentials>${cred(KEY, products)}</Credentials></App>`;

function run({ amount = 120, entity, limit = '50', limited } = {}) {
  const vars = {
    'private.refund.maxAmount': limit,
    'request.content': JSON.stringify({ amount }),
    'request.header.x-apikey': KEY,
    ...(entity !== undefined ? { 'AccessEntity.AE-CallerKey': entity } : {}),
    ...(limited !== undefined ? { 'private.refund.limitedProducts': limited } : {}),
  };
  const context = { getVariable: (n) => (vars[n] !== undefined ? vars[n] : null), setVariable: (n, v) => { vars[n] = v; } };
  vm.runInNewContext(code, { context, JSON, String, parseFloat, isNaN });
  return vars;
}

describe('check-refund-limit.js: governed callers only', () => {
  it('limits a Customer Service Tools MCP key over $50', () => {
    const v = run({ entity: keyEntity('Customer Support and Sales', 'Customer Service Tools MCP') });
    assert.equal(v['refund.limitApplies'], 'true');
    assert.equal(v['refund.overLimit'], 'true');
  });

  it('approves $50 or less on the governed key', () => {
    assert.equal(run({ amount: 30, entity: keyEntity('Customer Service Tools MCP') })['refund.overLimit'], 'false');
    assert.equal(run({ amount: 50, entity: keyEntity('Customer Service Tools MCP') })['refund.overLimit'], 'false');
  });

  it('does not limit an Enterprise Tools MCP (ungoverned) key', () => {
    const v = run({ entity: keyEntity('LLM Passthrough', 'Engineering and IT', 'Enterprise Tools MCP') });
    assert.equal(v['refund.limitApplies'], 'false');
    assert.equal(v['refund.overLimit'], 'false');
  });

  it('fails closed when the caller key cannot be resolved', () => {
    const v = run({ entity: '' });
    assert.equal(v['refund.limitApplies'], 'true');
    assert.equal(v['refund.overLimit'], 'true');
    assert.match(v['refund.limitReason'], /fail closed/);
  });

  it("ignores another key's products on the same app", () => {
    const app = `<App><Credentials>${cred('other-key', ['Customer Service Tools MCP'])}${cred(KEY, ['Enterprise Tools MCP'])}</Credentials></App>`;
    assert.equal(run({ entity: app })['refund.overLimit'], 'false');
  });

  it('reads the limited product list from the KVM (comma-separated)', () => {
    const v = run({ entity: keyEntity('Enterprise Tools MCP'), limited: 'Customer Service Tools MCP, Enterprise Tools MCP' });
    assert.equal(v['refund.overLimit'], 'true');
  });

  it('wires AE-CallerKey before JS-CheckRefundLimit in the issueRefund flow', () => {
    const xml = fs.readFileSync(path.join(apiproxy, 'proxies/default.xml'), 'utf8');
    const flow = xml.slice(xml.indexOf('<Flow name="issueRefund">'));
    assert.ok(flow.indexOf('AE-CallerKey') > 0 && flow.indexOf('AE-CallerKey') < flow.indexOf('JS-CheckRefundLimit'));
    const ae = fs.readFileSync(path.join(apiproxy, 'policies/AE-CallerKey.xml'), 'utf8');
    assert.match(ae, /ref="request.header.x-apikey"/);
    assert.match(ae, /continueOnError="true"/);
  });

  it('the generator produces the same script (regeneration must not revert it)', () => {
    const gen = fs.readFileSync(path.join(here, '../../apigee/scripts/gen_business_proxies.py'), 'utf8');
    assert.ok(gen.includes("'AE-CallerKey'"));
    assert.ok(gen.includes("private.refund.limitedProducts"));
  });
});
