/**
 * Ask Apigee route wiring.
 *
 * The unit tests drive the handler directly; this one proves the routes are
 * actually mounted in ui/server.js, on a real socket, ahead of the SPA
 * fallback. Without it a typo in the `pathname.startsWith` guard would send
 * /api/admin-agent/* to index.html and every test above would still pass.
 *
 * Each request is shaped so validation rejects it *before* any Apigee or
 * gateway call, so the test needs no credentials, no egress and has no side
 * effects on the demo org. What is asserted is the contract of the edge: a
 * structured JSON body with a `status`, never a 404 HTML page and never a
 * dropped connection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '../server.js');
// 5400-5499 is reserved for this suite so parallel agents cannot collide.
const PORT = 5473;
const BASE = `http://127.0.0.1:${PORT}`;

let child;

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/admin-agent/definitely-not-a-route`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

test.before(async () => {
  child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  const up = await waitForServer();
  assert.ok(up, `server did not come up on ${PORT}`);
});

test.after(() => {
  if (child && !child.killed) child.kill('SIGKILL');
});

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, contentType: res.headers.get('content-type') || '', text, json };
}

test('every /api/admin-agent/* route answers with JSON, not the SPA fallback', async () => {
  // Deliberately invalid payloads: each is rejected by validation before any
  // outbound call, so this stays hermetic.
  const cases = [
    { path: '/api/admin-agent/sandbox', method: 'DELETE', expect: 405 },
    { path: '/api/admin-agent/sandbox/provision', method: 'POST', body: 'definitely not json', expect: 400 },
    { path: '/api/admin-agent/chat', method: 'POST', body: '{"messages":[]}', expect: 400 },
    { path: '/api/admin-agent/chat', method: 'GET', expect: 405 },
    { path: '/api/admin-agent/revert', method: 'POST', body: '{"changeId":"chg_00000000"}', expect: 404 },
    // Disabled on purpose: production goes through a git PR, so this is a
    // deliberate 403 with an explanation rather than a missing route.
    { path: '/api/admin-agent/promote', method: 'POST', body: '{"changeId":"chg_00000000"}', expect: 403 },
    { path: '/api/admin-agent/test', method: 'POST', body: '{"prompt":""}', expect: 400 },
    { path: '/api/admin-agent/unknown-subpath', method: 'GET', expect: 404 },
  ];

  for (const c of cases) {
    const res = await call(c.path, { method: c.method, body: c.body });
    const label = `${c.method} ${c.path}`;
    assert.match(res.contentType, /application\/json/, `${label} did not return JSON: ${res.text.slice(0, 120)}`);
    assert.ok(res.json, `${label} returned an unparseable body`);
    assert.equal(res.json.status, 'error', label);
    assert.ok(res.json.error, `${label} must explain the failure`);
    assert.equal(res.status, c.expect, `${label} -> ${res.text.slice(0, 200)}`);
    assert.doesNotMatch(res.text, /<!DOCTYPE html>/i, `${label} fell through to the SPA`);
  }
});

test('GET /api/admin-agent/changes is routed and starts empty', async () => {
  const res = await call('/api/admin-agent/changes');
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'ok');
  assert.ok(Array.isArray(res.json.changes));
});

test('GET /api/admin-agent/sandbox answers a structured body with or without credentials', async () => {
  // This one does reach out (read-only) when ADC happens to be available; both
  // outcomes are contract-shaped, and neither may leak a consumer key.
  const res = await call('/api/admin-agent/sandbox');
  assert.match(res.contentType, /application\/json/);
  assert.ok(res.json, `unparseable body: ${res.text.slice(0, 200)}`);
  assert.ok(['ok', 'error'].includes(res.json.status));
  if (res.json.status === 'ok') {
    assert.equal(typeof res.json.provisioned, 'boolean');
    assert.equal(typeof res.json.keyPresent, 'boolean');
    assert.equal(res.json.products.length, 3);
    for (const product of res.json.products) {
      assert.match(product.name, / \(Dev\)$/);
      assert.equal(typeof product.exists, 'boolean');
    }
    assert.equal(res.json.app.name, 'admin-copilot-dev');
    assert.equal(res.json.consumerKey, undefined, 'the sandbox key must never be serialized');
    assert.doesNotMatch(res.text, /consumerKey/i);
  }
});

test('the server survives a malformed admin-agent request and keeps serving', async () => {
  await call('/api/admin-agent/chat', { method: 'POST', body: '{"messages":"nope"}' });
  await call('/api/admin-agent/revert', { method: 'POST', body: '[]' });
  const after = await call('/api/admin-agent/changes');
  assert.equal(after.status, 200, 'the process must still be up after bad input');
});

// ---------------------------------------------------------------------------
// Dev (vite.config.ts) / production (server.js) parity
// ---------------------------------------------------------------------------

test('vite dev middleware mounts the same Ask Apigee service as server.js', () => {
  const vite = readFileSync(join(here, '../vite.config.ts'), 'utf8');
  assert.match(vite, /import \{ createAdminAgentService \} from '\.\/server\/adminAgentService\.js'/);
  assert.match(vite, /server\.middlewares\.use\('\/api\/admin-agent'/);
});

test('server.js and vite.config.ts share one DEFAULT_PRODUCTS (server/defaultProducts.js)', () => {
  // "Reset to Demo Defaults" falls back to these, so a drift would mean
  // `npm run dev` and Cloud Run reset the org to different states. Both now
  // import the single module instead of each carrying a copy.
  for (const file of ['../server.js', '../vite.config.ts']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.match(src, /import \{ DEFAULT_PRODUCTS \} from '\.\/server\/defaultProducts\.js'/, file);
    assert.doesNotMatch(src, /^const DEFAULT_PRODUCTS/m, `${file} must not define its own copy`);
  }
});
