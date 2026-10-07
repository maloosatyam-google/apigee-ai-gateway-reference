// Checks every industry pack end to end against its handlers (no network), so a new pack
// only needs industries/<id>.json + services/packs/<id>.js to be covered:
//   - every pack has a backend, every tool a handler, and every tool answers without a 500
//   - every MCP preset works at the backend (the gateway, not the backend, blocks the demo's
//     "blocked" cases), on fresh seed data
//   - the story: the hero customer exists, the small amount and the over-limit amount are
//     both accepted by the backend (only Apigee enforces the limit)
//   - showcase prompts mention the story's ids so the agents can find the records
//   - reset restores the seed data

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadIndustries, runTool } = require('../industry-apis');
const { checkPack } = require('../packs/check');

const industries = loadIndustries();
const packIds = fs.readdirSync(path.join(__dirname, '..', 'industries')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

const fresh = (ind) => ({ ...ind, db: ind.mod.build() });

test('every pack has a backend', () => {
  for (const id of packIds) assert.ok(industries.has(id), `services/packs/${id}.js is missing`);
});

for (const [id, ind] of industries) {
  const { pack } = ind;

  test(`${id}: services/packs/check.js passes (unique tool names, limit code, story, showcase)`, () => {
    const others = [...industries.values()].filter((o) => o.pack.id !== id).map((o) => o.pack);
    assert.deepEqual(checkPack(pack, ind.mod, others), []);
  });

  test(`${id}: every preset works at the backend on fresh data`, () => {
    for (const p of pack.mcpPresets) {
      const r = runTool(fresh(ind), p.toolName, p.arguments);
      assert.equal(r.status, 200, `${p.id} (${p.toolName}): ${JSON.stringify(r.body)}`);
    }
  });

  test(`${id}: every tool answers without an internal error (empty and example args)`, () => {
    for (const t of pack.tools) {
      const empty = runTool(fresh(ind), t.name, {});
      assert.notEqual(empty.status, 500, `${t.name} with {} crashed`);
      if ((t.inputSchema.required || []).length) assert.equal(empty.status, 400, `${t.name} must reject missing required args`);
    }
  });

  test(`${id}: story records exist and both amounts pass the backend`, () => {
    const { story, limit } = pack;
    const pii = pack.tools.find((t) => t.slot === 'pii');
    const q = story.customerName.split(' ')[0].toLowerCase();
    const found = runTool(fresh(ind), pii.name, { [Object.keys(pii.inputSchema.properties)[0]]: q });
    assert.equal(found.status, 200);
    assert.ok(JSON.stringify(found.body).includes(story.customerId), `${pii.name}("${q}") should find ${story.customerId}`);

    const moneyTool = pack.tools.find((t) => t.name === limit.tool);
    const idArg = (moneyTool.inputSchema.required || []).find((k) => k !== limit.argument);
    if (story.smallFeeId && story.largeFeeId && idArg) {
      const db = fresh(ind);
      const small = runTool(db, limit.tool, { [idArg]: story.smallFeeId, [limit.argument]: story.smallFeeAmount });
      assert.equal(small.status, 200, `small: ${JSON.stringify(small.body)}`);
      const large = runTool(db, limit.tool, { [idArg]: story.largeFeeId, [limit.argument]: story.largeFeeAmount });
      assert.equal(large.status, 200, `large (ungoverned side goes through): ${JSON.stringify(large.body)}`);
    }
  });

  test(`${id}: showcase prompts point at the story`, () => {
    const s = pack.showcase.scenarios;
    for (const slot of ['multi-step', 'refund', 'burst']) {
      assert.ok(s[slot].prompt.includes(pack.story.customerId), `${slot} prompt should name ${pack.story.customerId}`);
    }
    if (pack.story.largeFeeId) assert.ok(s.refund.prompt.includes(pack.story.largeFeeId), 'refund prompt should name the over-limit record');
  });

  test(`${id}: build() gives independent seed data`, () => {
    const a = ind.mod.build();
    const b = ind.mod.build();
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
  });
}

test('industries/MAPPING.md is in sync with the packs, the theme industries and the theme snapshot', () => {
  const { execFileSync } = require('node:child_process');
  const repo = path.join(__dirname, '..', '..');
  if (!fs.existsSync(path.join(repo, 'industries', 'mapping.mjs'))) return; // not in the Docker build context
  execFileSync(process.execPath, [path.join(repo, 'industries', 'mapping.mjs'), '--check'], { stdio: 'pipe' });
});
