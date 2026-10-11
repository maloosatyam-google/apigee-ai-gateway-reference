import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseTokenQuota, isTokenQuotaAlert } from '../src/utils/tokenQuota.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiproxy = path.join(here, '../../apigee/proxies/ai-gateway-v1/apiproxy');
const code = fs.readFileSync(path.join(apiproxy, 'resources/jsc/TokenQuotaThreshold.js'), 'utf8');

function run(vars, properties = { threshold: '0.5' }) {
  const variables = { ...vars };
  const context = {
    getVariable: (n) => (variables[n] !== undefined ? variables[n] : null),
    setVariable: (n, v) => { variables[n] = v; },
  };
  vm.runInNewContext(code, { context, properties, Math, String, parseFloat, isFinite });
  return variables;
}
const counters = (used, allowed) => ({
  'ratelimit.LTQ-TokenCount.used.count': String(used),
  'verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit': String(allowed),
  // What the CountOnly policy really reports on the runtime (verified on dev): must be ignored.
  'ratelimit.LTQ-TokenCount.allowed.count': '9223372036854775807',
});

describe('TokenQuotaThreshold.js (gateway)', () => {
  it('is ok at or below 50% of the allocation', () => {
    const v = run(counters(25, 50));
    assert.equal(v['flow.token_quota_status'], 'ok');
    assert.equal(v['flow.token_quota_used_pct'], '50');
    assert.equal(v['flow.token_quota_warning'], undefined);
  });

  it('flags near-threshold above 50% with a warning message', () => {
    const v = run(counters(26, 50));
    assert.equal(v['flow.token_quota_status'], 'near-threshold');
    assert.equal(v['flow.token_quota_used_pct'], '52');
    assert.equal(v['flow.token_quota_limit'], '50');
    assert.equal(v['flow.token_quota_threshold_pct'], '50');
    assert.match(v['flow.token_quota_warning'], /Nearing token quota threshold: 52% of 50 tokens/);
  });

  it('reports exhausted at or above 100%', () => {
    const v = run(counters(73, 50));
    assert.equal(v['flow.token_quota_status'], 'exhausted');
    assert.match(v['flow.token_quota_warning'], /exhausted/);
  });

  it('sets nothing when the counters are absent (cache hit / LTQ-TokenCount skipped)', () => {
    const v = run({});
    assert.equal(v['flow.token_quota_status'], undefined);
    assert.equal(run(counters(10, 0))['flow.token_quota_status'], undefined);
  });

  it('never uses the CountOnly Long.MAX allowed.count as the limit', () => {
    const v = run({
      'ratelimit.LTQ-TokenCount.used.count': '107',
      'ratelimit.LTQ-TokenCount.allowed.count': '9223372036854775807',
    });
    assert.equal(v['flow.token_quota_status'], undefined);
  });

  it('honours the threshold property and falls back to 0.5 when invalid', () => {
    assert.equal(run(counters(30, 100), { threshold: '0.25' })['flow.token_quota_status'], 'near-threshold');
    assert.equal(run(counters(30, 100), { threshold: 'bogus' })['flow.token_quota_status'], 'ok');
  });
});

describe('ai-gateway-v1 wiring', () => {
  const flow = fs.readFileSync(path.join(apiproxy, 'proxies/default.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const policy = fs.readFileSync(path.join(apiproxy, 'policies/JS-TokenQuotaThreshold.xml'), 'utf8');
  const headers = fs.readFileSync(path.join(apiproxy, 'policies/AM-SetResponseHeaders.xml'), 'utf8');

  it('runs after LTQ-TokenCount and before AM-SetResponseHeaders, never failing the request', () => {
    const iCount = flow.indexOf('<Name>LTQ-TokenCount</Name>');
    const iJs = flow.indexOf('<Name>JS-TokenQuotaThreshold</Name>');
    const iAm = flow.indexOf('<Name>AM-SetResponseHeaders</Name>');
    assert.ok(iCount >= 0 && iJs > iCount && iAm > iJs);
    assert.match(policy, /continueOnError="true"/);
    assert.match(policy, /<Property name="threshold">0\.5<\/Property>/);
  });

  it('exposes the status and warning as x-gateway-token-quota-* headers', () => {
    for (const h of ['used', 'limit', 'used-pct', 'threshold-pct', 'status', 'warning']) {
      assert.match(headers, new RegExp(`name="x-gateway-token-quota-${h}"`));
    }
  });
});

describe('parseTokenQuota (UI)', () => {
  const h = {
    'x-gateway-token-quota-status': 'near-threshold',
    'x-gateway-token-quota-used': '26',
    'x-gateway-token-quota-limit': '50',
    'x-gateway-token-quota-used-pct': '52',
    'x-gateway-token-quota-threshold-pct': '50',
    'x-gateway-token-quota-warning': 'Nearing token quota threshold: 52% of 50 tokens used in the current window',
  };

  it('parses a near-threshold signal and raises the alert', () => {
    const q = parseTokenQuota(h);
    assert.deepEqual(
      { status: q.status, used: q.used, limit: q.limit, usedPct: q.usedPct, thresholdPct: q.thresholdPct },
      { status: 'near-threshold', used: 26, limit: 50, usedPct: 52, thresholdPct: 50 },
    );
    assert.equal(isTokenQuotaAlert(q), true);
  });

  it('does not alert when ok, and treats the empty warning header as absent', () => {
    const q = parseTokenQuota({ ...h, 'x-gateway-token-quota-status': 'ok', 'x-gateway-token-quota-warning': '' });
    assert.equal(q.warning, undefined);
    assert.equal(isTokenQuotaAlert(q), false);
  });

  it('returns undefined rather than guessing when the gateway sent no usable signal', () => {
    assert.equal(parseTokenQuota({}), undefined);
    assert.equal(parseTokenQuota({ ...h, 'x-gateway-token-quota-status': '' }), undefined);
    assert.equal(parseTokenQuota({ ...h, 'x-gateway-token-quota-used': 'NaN' }), undefined);
    assert.equal(parseTokenQuota({ ...h, 'x-gateway-token-quota-status': 'weird' }), undefined);
    assert.equal(isTokenQuotaAlert(undefined), false);
  });
});

describe('Token-quota demo stays in sync across UI, live test and script', () => {
  const settings = fs.readFileSync(path.join(here, '../src/services/defaultSettings.ts'), 'utf8');
  const block = settings.slice(settings.indexOf('export const TOKEN_LIMIT_EXAMPLES'), settings.indexOf('];', settings.indexOf('export const TOKEN_LIMIT_EXAMPLES')));
  const prompts = [...block.matchAll(/prompt: '([^']+)'/g)].map((m) => m[1]);
  const live = fs.readFileSync(path.join(here, 'gateway-live.test.mjs'), 'utf8');
  const script = fs.readFileSync(path.join(here, '../../apigee/scripts/test_token_limit.sh'), 'utf8');

  it('has four steps with a 90-token output cap', () => {
    assert.equal(prompts.length, 4);
    assert.match(settings, /export const TOKEN_DEMO_MAX_OUTPUT_TOKENS = 90;/);
    assert.match(live, /maxOutputTokens: 90/);
    assert.match(script, /maxOutputTokens\\":90/);
  });

  it('uses identical prompts everywhere', () => {
    for (const p of prompts) {
      assert.ok(live.includes(p), `gateway-live.test.mjs is missing demo prompt: ${p}`);
      assert.ok(script.includes(p), `test_token_limit.sh is missing demo prompt: ${p}`);
    }
  });

  it('Haiku carries the 300-token demo quota on every persona product that entitles it', () => {
    for (const f of ['engineering_and_it.json', 'customer_support_and_sales.json']) {
      const p = JSON.parse(fs.readFileSync(path.join(here, '../../apigee/products', f), 'utf8'));
      const cfg = p.llmOperationGroup.operationConfigs.find((c) => c.llmOperations[0].model === 'claude-haiku-5-5');
      assert.equal(cfg.llmTokenQuota.limit, '300', f);
    }
  });
});

describe('/auto is counted and limited against the product /auto operation', () => {
  const read = (p) => fs.readFileSync(path.join(apiproxy, p), 'utf8');
  const extract = read('resources/jsc/ExtractPromptAndModel.js');
  const runExtract = (pathsuffix) => {
    const vars = { 'proxy.pathsuffix': pathsuffix, 'request.content': '{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}' };
    const context = { getVariable: (n) => (vars[n] !== undefined ? vars[n] : null), setVariable: (n, v) => { vars[n] = v; } };
    vm.runInNewContext(extract, { context, JSON, Array, String });
    return vars;
  };

  it('ExtractPromptAndModel sets flow.quota_model=auto only on /auto', () => {
    assert.equal(runExtract('/auto')['flow.quota_model'], 'auto');
    assert.equal(runExtract('/models/gemini-3.6-flash:generateContent')['flow.quota_model'], undefined);
  });

  it('both LTQ policies read flow.quota_model first (routing rewrites flow.model), identically', () => {
    const want = '<LLMModelSource>{firstnonnull(flow.quota_model,flow.model)}</LLMModelSource>';
    assert.ok(read('policies/LTQ-TokenCount.xml').includes(want));
    assert.ok(read('policies/LTQ-TokenEnforce.xml').includes(want));
  });

  it('AutoRoutingFlow enforces the quota before the router call', () => {
    const xml = read('proxies/default.xml');
    const flow = xml.slice(xml.indexOf('<Flow name="AutoRoutingFlow">'), xml.indexOf('</Flow>', xml.indexOf('<Flow name="AutoRoutingFlow">')));
    assert.ok(flow.includes('<Name>LTQ-TokenEnforce</Name>'));
    assert.ok(flow.indexOf('LTQ-TokenEnforce') < flow.indexOf('SC-ModelRouter'));
  });
});
