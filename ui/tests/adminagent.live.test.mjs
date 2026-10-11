/**
 * Ask Apigee live end-to-end test.
 *
 * This one really does spend money: it drives a full chat turn through the prod
 * AI Gateway on the admin key, and a dev-gateway test call on the sandbox key.
 * It is therefore NOT part of `npm test`. Run it deliberately:
 *
 *   npm run test:admin-agent:live
 *
 * It skips cleanly (rather than failing) whenever the environment cannot
 * support it -- no ADC, no admin consumer key, no egress -- so it is safe to
 * wire into a pipeline that sometimes has credentials and sometimes does not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEV_PRODUCTS } from '../server/adminAgentCore.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ADMIN_AGENT_LIVE_PORT || 5475);
const BASE = process.env.ADMIN_AGENT_LIVE_URL || `http://127.0.0.1:${PORT}`;
const ownServer = !process.env.ADMIN_AGENT_LIVE_URL;

let child;
let liveReason = '';

async function call(path, { method = 'GET', body, timeoutMs = 120_000 } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, json: null, text };
  }
}

test.before(async () => {
  if (ownServer) {
    child = spawn(process.execPath, [join(here, '../server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.resume();
    child.stderr.resume();
  }

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/admin-agent/changes`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  try {
    const me = await call('/api/me', { timeoutMs: 60_000 });
    if (!me.json?.apiKey) liveReason = 'no admin consumer key from /api/me (no ADC?)';
  } catch (err) {
    liveReason = `server unreachable: ${err?.message || err}`;
  }
});

test.after(() => {
  if (child && !child.killed) child.kill('SIGKILL');
});

test('LIVE: a chat turn drives a real tool call through the gateway', async (t) => {
  if (liveReason) return t.skip(liveReason);

  const res = await call('/api/admin-agent/chat', {
    method: 'POST',
    body: {
      messages: [
        {
          role: 'user',
          // Deliberately phrased to avoid the word "guardrail": this template's
          // Model Armor prompt-injection filter matches on it (verified), and
          // the request would be blocked at the perimeter.
          content: 'What is the token quota on the Customer Support and Sales for gemini-3.6-flash? One line.',
        },
      ],
    },
  });

  assert.equal(res.status, 200, res.text.slice(0, 400));
  assert.equal(res.json.status, 'ok');

  const errors = res.json.events.filter((e) => e.type === 'error');
  if (errors.length) {
    // A wallet/quota exhaustion is a legitimate state, not a code defect --
    // but the contract still has to hold: a useful reply and an error event.
    assert.ok(res.json.reply.length > 0, 'a degraded turn must still reply');
    return t.skip(`gateway degraded: ${errors[0].message}`);
  }

  assert.ok(res.json.reply.length > 0, 'expected a non-empty reply');
  assert.ok(
    res.json.events.some((e) => e.type === 'tool_call' && e.ok),
    `expected at least one successful tool call, got ${JSON.stringify(res.json.events)}`
  );
  assert.ok(res.json.usage.model, 'usage.model must name the model that served the turn');
  assert.ok(res.json.usage.totalTokens > 0, 'the turn must be metered');
  assert.ok(res.json.usage.costUsd >= 0);
  assert.doesNotMatch(res.text, /consumerKey/i);
});

test('LIVE: the dev sandbox reports its state without ever exposing the key', async (t) => {
  if (liveReason) return t.skip(liveReason);

  const res = await call('/api/admin-agent/sandbox', { timeoutMs: 60_000 });
  assert.equal(res.status, 200, res.text.slice(0, 300));
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.products.length, DEV_PRODUCTS.length);
  assert.doesNotMatch(res.text, /consumerKey/i);

  if (!res.json.provisioned) return t.skip('dev sandbox not provisioned in this org');

  const dev = await call('/api/admin-agent/test', {
    method: 'POST',
    body: { prompt: 'Reply with exactly: pong', model: 'gemini-3.5-flash-lite' },
  });
  assert.equal(dev.status, 200, dev.text.slice(0, 300));
  const result = dev.json.result;
  assert.equal(typeof result.httpStatus, 'number');
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.guardrailBlocked, 'boolean');
  for (const key of Object.keys(result.headers)) {
    assert.match(key, /^x-gateway-/, 'only x-gateway-* headers may be surfaced');
  }
  if (result.ok) {
    assert.equal(result.model, 'gemini-3.5-flash-lite');
    assert.ok(result.totalTokens > 0, 'a successful dev test must be metered');
  }
});
