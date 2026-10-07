// Unit tests for the MCP playground, chat scenario bar, chat Markdown rendering and the demo
// data reset. They guard behaviour the demo relies on so later changes cannot silently break it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import {
  buildDefaultPropValue,
  initialToolArgs,
  coerceArgValue,
  pruneBlank,
  inferPropertiesFromArgs,
} from '../src/utils/mcpArgs.js';
import { MCP_PERSONA_FLOWS, orderPresetsForPersona } from '../src/utils/mcpFlows.js';
import {
  stepMenuPosition,
  nextStepIndex,
  STEP_MENU_WIDTH,
  STEP_MENU_HOVER_DELAY_MS,
  STEP_MENU_CLOSE_DELAY_MS,
} from '../src/utils/scenarioStepMenu.js';
import { MARKDOWN_REMARK_PLUGINS, MARKDOWN_REHYPE_PLUGINS, textOf, codeLanguage } from '../src/utils/markdownConfig.js';
import { resetDemoData, handleDemoReset, getIdentityToken, DEMO_RESET_TARGETS } from '../server/demoReset.js';

// defaultSettings.ts cannot be imported by node (extensionless TS imports), so read the preset
// ids from its source text.
const settingsSrc = readFileSync(new URL('../src/services/defaultSettings.ts', import.meta.url), 'utf8');
const presetsBlock = settingsSrc.slice(settingsSrc.indexOf('MCP_PRESET_SCENARIOS'));
const PRESET_IDS = [...presetsBlock.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);

// Shape of the Customer Service issueRefund tool (nested request body).
const ISSUE_REFUND_SCHEMA = {
  type: 'object',
  required: ['orderId', 'issueRefundBody'],
  properties: {
    orderId: { type: 'string', example: 'ORD-1042' },
    issueRefundBody: {
      type: 'object',
      properties: {
        amount: { type: 'number', example: 25 },
        reason: { type: 'string', example: 'Late delivery goodwill credit' },
      },
    },
  },
};

describe('mcpArgs: default form values', () => {
  test('nested object gets an object, not "[object Object]"', () => {
    const args = initialToolArgs(ISSUE_REFUND_SCHEMA);
    assert.deepEqual(args, {
      orderId: 'ORD-1042',
      issueRefundBody: { amount: 25, reason: 'Late delivery goodwill credit' },
    });
  });

  test('example beats default; default beats type blank', () => {
    assert.equal(buildDefaultPropValue({ type: 'string', example: 'a', default: 'b' }), 'a');
    assert.equal(buildDefaultPropValue({ type: 'string', default: 'b' }), 'b');
  });

  test('enum uses its first value', () => {
    assert.equal(buildDefaultPropValue({ type: 'string', enum: ['open', 'closed'] }), 'open');
  });

  test('type-based blanks', () => {
    assert.equal(buildDefaultPropValue({ type: 'number' }), 0);
    assert.equal(buildDefaultPropValue({ type: 'integer', minimum: 1 }), 1);
    assert.equal(buildDefaultPropValue({ type: 'boolean' }), false);
    assert.equal(buildDefaultPropValue({ type: 'string' }), '');
    assert.equal(buildDefaultPropValue(undefined), '');
  });

  test('missing schema gives no args', () => {
    assert.deepEqual(initialToolArgs(undefined), {});
    assert.deepEqual(initialToolArgs({}), {});
  });
});

describe('mcpArgs: coerceArgValue', () => {
  test('numbers', () => {
    assert.equal(coerceArgValue('30', { type: 'number' }), 30);
    assert.equal(coerceArgValue('7', { type: 'integer' }), 7);
    assert.equal(coerceArgValue('', { type: 'number' }), '');
    assert.equal(coerceArgValue('abc', { type: 'number' }), 'abc');
  });
  test('booleans', () => {
    assert.equal(coerceArgValue('true', { type: 'boolean' }), true);
    assert.equal(coerceArgValue('false', { type: 'boolean' }), false);
  });
  test('strings and unknown schema pass through', () => {
    assert.equal(coerceArgValue('x', { type: 'string' }), 'x');
    assert.equal(coerceArgValue('x', undefined), 'x');
  });
});

describe('mcpArgs: pruneBlank', () => {
  test('drops blank optional fields and keeps required ones', () => {
    const schema = { required: ['orderId'], properties: { orderId: {}, status: {} } };
    assert.deepEqual(pruneBlank({ orderId: '', status: '' }, schema), { orderId: '' });
  });
  test('keeps non-blank values, zero and false', () => {
    assert.deepEqual(pruneBlank({ a: 0, b: false, c: 'x' }, {}), { a: 0, b: false, c: 'x' });
  });
  test('recurses into nested objects using the nested schema', () => {
    const schema = {
      properties: { body: { required: ['amount'], properties: { amount: {}, note: {} } } },
    };
    assert.deepEqual(pruneBlank({ body: { amount: '', note: '' } }, schema), { body: { amount: '' } });
  });
  test('arrays are kept as-is', () => {
    assert.deepEqual(pruneBlank({ tags: ['a'] }, {}), { tags: ['a'] });
  });
});

describe('mcpArgs: inferPropertiesFromArgs', () => {
  test('infers types including nested objects', () => {
    assert.deepEqual(inferPropertiesFromArgs({ orderId: 'ORD-1', issueRefundBody: { amount: 30, ok: true } }), {
      orderId: { type: 'string' },
      issueRefundBody: { type: 'object', properties: { amount: { type: 'number' }, ok: { type: 'boolean' } } },
    });
  });
  test('nullish args give no properties', () => {
    assert.deepEqual(inferPropertiesFromArgs(undefined), {});
  });
});

describe('mcpFlows: per-persona "Try a task" flows', () => {
  test('preset ids were parsed from defaultSettings.ts', () => {
    assert.ok(PRESET_IDS.includes('cs-order-status'), 'expected cs-order-status among presets');
    assert.ok(PRESET_IDS.length >= 8);
  });

  for (const [speaker, flow] of Object.entries(MCP_PERSONA_FLOWS)) {
    test(`${speaker}: every flow id is a real preset`, () => {
      for (const { id } of flow) assert.ok(PRESET_IDS.includes(id), `${id} missing from MCP_PRESET_SCENARIOS`);
    });
    test(`${speaker}: starts with 2 working tasks then a failure`, () => {
      assert.equal(flow[0].outcome, 'works');
      assert.equal(flow[1].outcome, 'works');
      assert.notEqual(flow[2].outcome, 'works');
    });
  }

  test('all three personas have a flow', () => {
    assert.deepEqual(Object.keys(MCP_PERSONA_FLOWS).sort(), ['analysts', 'eng', 'support']);
  });

  const presets = PRESET_IDS.map((id) => ({ id }));

  test('flow first with steps 1..n, rest in catalog order, no duplicates', () => {
    const ordered = orderPresetsForPersona(presets, 'support');
    const flow = MCP_PERSONA_FLOWS.support;
    flow.forEach((f, i) => {
      assert.equal(ordered[i].preset.id, f.id);
      assert.equal(ordered[i].step, i + 1);
      assert.equal(ordered[i].outcome, f.outcome);
    });
    const rest = ordered.slice(flow.length);
    assert.ok(rest.every((x) => x.step === undefined));
    const flowIds = new Set(flow.map((f) => f.id));
    assert.deepEqual(
      rest.map((x) => x.preset.id),
      PRESET_IDS.filter((id) => !flowIds.has(id)),
    );
    assert.equal(new Set(ordered.map((x) => x.preset.id)).size, ordered.length);
    assert.equal(ordered.length, new Set(PRESET_IDS).size);
  });

  test('unknown speaker falls back to Engineering & IT', () => {
    const ordered = orderPresetsForPersona(presets, 'nobody');
    assert.deepEqual(
      ordered.slice(0, MCP_PERSONA_FLOWS.eng.length).map((x) => x.preset.id),
      MCP_PERSONA_FLOWS.eng.map((f) => f.id),
    );
  });

  test('ids missing from the catalog are skipped and steps stay contiguous', () => {
    const ordered = orderPresetsForPersona([{ id: 'cs-refund-denied' }, { id: 'other' }], 'support');
    assert.deepEqual(
      ordered.map((x) => [x.preset.id, x.step]),
      [
        ['cs-refund-denied', 1],
        ['other', undefined],
      ],
    );
  });
});

describe('scenarioStepMenu', () => {
  test('menu sits above the chip, left-aligned', () => {
    const pos = stepMenuPosition({ left: 100, top: 700 }, 1400, 900);
    assert.deepEqual(pos, { left: 100, bottom: 900 - 700 + 6 });
  });
  test('clamps to the right edge of the viewport', () => {
    const pos = stepMenuPosition({ left: 1350, top: 700 }, 1400, 900);
    assert.equal(pos.left, 1400 - STEP_MENU_WIDTH - 8);
  });
  test('clamps to the left edge of the viewport', () => {
    assert.equal(stepMenuPosition({ left: -40, top: 10 }, 1400, 900).left, 8);
  });
  test('nextStepIndex advances and wraps', () => {
    assert.equal(nextStepIndex(0, 3), 1);
    assert.equal(nextStepIndex(2, 3), 0);
    assert.equal(nextStepIndex(0, 1), 0);
  });
  test('hover opens slower than it closes', () => {
    assert.ok(STEP_MENU_HOVER_DELAY_MS > STEP_MENU_CLOSE_DELAY_MS);
  });
});

describe('markdownConfig: chat Markdown rendering', () => {
  const render = (md) =>
    renderToStaticMarkup(
      React.createElement(
        ReactMarkdown,
        { remarkPlugins: MARKDOWN_REMARK_PLUGINS, rehypePlugins: MARKDOWN_REHYPE_PLUGINS },
        md,
      ),
    );

  test('GFM tables render as <table>', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    assert.match(html, /<table>/);
    assert.match(html, /<td>1<\/td>/);
  });

  test('fenced code is syntax highlighted', () => {
    const html = render('```python\ndef f():\n    return 1\n```');
    assert.match(html, /class="hljs language-python"/);
    assert.match(html, /hljs-keyword/);
  });

  test('inline code, headings, lists and bold', () => {
    const html = render('# Title\n\n- **one** `x`\n- two');
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>one<\/strong>/);
    assert.match(html, /<code>x<\/code>/);
    assert.match(html, /<li>two<\/li>/);
  });

  test('raw HTML is escaped, not rendered', () => {
    const html = render('hello <script>alert(1)</script>');
    assert.doesNotMatch(html, /<script>/);
  });

  test('textOf flattens React children', () => {
    const el = React.createElement('span', null, 'a', React.createElement('b', null, 'b', 1), null, false, ['c']);
    assert.equal(textOf(el), 'ab1c');
    assert.equal(textOf(undefined), '');
  });

  test('codeLanguage reads the language class', () => {
    assert.equal(codeLanguage('hljs language-python'), 'python');
    assert.equal(codeLanguage('language-c++'), 'c++');
    assert.equal(codeLanguage('hljs'), undefined);
    assert.equal(codeLanguage(undefined), undefined);
  });
});

describe('demoReset', () => {
  const okResponse = (status = 200, body = 'ok') => ({ ok: status < 400, status, text: async () => body });

  test('targets the Customer Service API by default', () => {
    assert.ok(DEMO_RESET_TARGETS.some((t) => t.name === 'customer-service-api' && /^https:\/\//.test(t.url)));
  });

  test('POSTs /admin/reset with a Bearer ID token for the backend URL', async () => {
    const calls = [];
    const audiences = [];
    const out = await resetDemoData({
      targets: [{ name: 'svc', url: 'https://svc.example' }],
      getToken: async (aud) => (audiences.push(aud), 'tok123'),
      fetchImpl: async (url, init) => (calls.push({ url, init }), okResponse()),
    });
    assert.deepEqual(out, { ok: true, results: [{ name: 'svc', ok: true, status: 200 }] });
    assert.deepEqual(audiences, ['https://svc.example']);
    assert.equal(calls[0].url, 'https://svc.example/admin/reset');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123');
  });

  test('no token: fails without calling the backend', async () => {
    let called = false;
    const out = await resetDemoData({
      targets: [{ name: 'svc', url: 'https://svc.example' }],
      getToken: async () => null,
      fetchImpl: async () => ((called = true), okResponse()),
    });
    assert.equal(out.ok, false);
    assert.equal(out.results[0].error, 'No identity token');
    assert.equal(called, false);
  });

  test('backend error status is reported', async () => {
    const out = await resetDemoData({
      targets: [{ name: 'svc', url: 'https://svc.example' }],
      getToken: async () => 't',
      fetchImpl: async () => okResponse(403, 'Forbidden'),
    });
    assert.deepEqual(out, { ok: false, results: [{ name: 'svc', ok: false, status: 403, error: 'Forbidden' }] });
  });

  test('network error is reported', async () => {
    const out = await resetDemoData({
      targets: [{ name: 'svc', url: 'https://svc.example' }],
      getToken: async () => 't',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.results[0].error, 'ECONNRESET');
  });

  const fakeRes = () => {
    const res = { headers: {}, statusCode: 0, body: '' };
    res.setHeader = (k, v) => (res.headers[k] = v);
    res.end = (b) => (res.body = b);
    return res;
  };

  test('handler rejects non-POST with 405', async () => {
    const res = fakeRes();
    await handleDemoReset({ method: 'GET' }, res);
    assert.equal(res.statusCode, 405);
  });

  test('handler returns 200 on success and 502 on failure', async () => {
    const deps = (ok) => ({
      targets: [{ name: 'svc', url: 'https://svc.example' }],
      getToken: async () => 't',
      fetchImpl: async () => okResponse(ok ? 200 : 500, 'boom'),
    });
    const good = fakeRes();
    await handleDemoReset({ method: 'POST' }, good, deps(true));
    assert.equal(good.statusCode, 200);
    assert.equal(JSON.parse(good.body).ok, true);
    assert.equal(good.headers['Content-Type'], 'application/json');

    const bad = fakeRes();
    await handleDemoReset({ method: 'POST' }, bad, deps(false));
    assert.equal(bad.statusCode, 502);
    assert.equal(JSON.parse(bad.body).ok, false);
  });

  test('getIdentityToken prefers the metadata server', async () => {
    let execCalled = false;
    let seen;
    const t = await getIdentityToken('https://svc.example', {
      fetchImpl: async (url, init) => ((seen = { url, init }), okResponse(200, 'meta-token\n')),
      execImpl: () => ((execCalled = true), 'gcloud-token'),
    });
    assert.equal(t, 'meta-token');
    assert.equal(execCalled, false);
    assert.match(seen.url, /audience=https%3A%2F%2Fsvc\.example$/);
    assert.equal(seen.init.headers['Metadata-Flavor'], 'Google');
  });

  test('getIdentityToken falls back to gcloud, then null', async () => {
    const noMeta = async () => {
      throw new Error('ENOTFOUND');
    };
    assert.equal(await getIdentityToken('a', { fetchImpl: noMeta, execImpl: () => 'gcloud-token\n' }), 'gcloud-token');
    assert.equal(
      await getIdentityToken('a', {
        fetchImpl: noMeta,
        execImpl: () => {
          throw new Error('no gcloud');
        },
      }),
      null,
    );
  });
});
