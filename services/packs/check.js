#!/usr/bin/env node
// Checks one industry pack end to end against its backend, without writing any files:
//
//   node services/packs/check.js <id>
//
// Reads industries/<id>.json (the source, not the synced copy) and services/packs/<id>.js,
// then runs the pack validator plus the backend checks the demo relies on. The same checks
// run for every pack in tests/packs-generic.test.js. Exit code 1 lists every problem.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ToolError, checkArgs } = require('./common');

const REPO = path.join(__dirname, '..', '..');

function run(pack, mod, db, name, args) {
  const tool = pack.tools.find((t) => t.name === name);
  if (!tool) return { status: 404, body: { error: 'UNKNOWN_TOOL' } };
  try {
    return { status: 200, body: mod.handlers[name](db, checkArgs(tool.inputSchema, args)) };
  } catch (e) {
    if (e instanceof ToolError) return { status: e.status, body: { error: e.code, message: e.message } };
    return { status: 500, body: { error: 'INTERNAL', message: String(e && e.stack || e) } };
  }
}

/** Problems with a pack and its backend module; [] when all good. */
function checkPack(pack, mod, otherPacks = []) {
  const errors = [];
  const fail = (m) => errors.push(m);
  const fresh = () => mod.build();

  for (const t of pack.tools) if (typeof mod.handlers?.[t.name] !== 'function') fail(`no handler for ${t.name}`);
  if (errors.length) return errors;

  // Tool names are unique across packs (traces label a tool's area by its name).
  for (const other of otherPacks) {
    for (const t of pack.tools) if (other.tools.some((o) => o.name === t.name)) fail(`tool ${t.name} is also in the ${other.id} pack; rename it`);
    if (other.mcpPresets.some((p) => pack.mcpPresets.some((q) => q.id === p.id))) fail(`preset ids collide with the ${other.id} pack; use a different prefix`);
  }

  // Business limit codes end in _LIMIT (the agent service reports them as business limits).
  if (!/_LIMIT$/.test(pack.limit.code)) fail(`limit.code ${pack.limit.code} must end in _LIMIT`);

  for (const p of pack.mcpPresets) {
    const r = run(pack, mod, fresh(), p.toolName, p.arguments);
    if (r.status !== 200) fail(`preset ${p.id} (${p.toolName}) -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const t of pack.tools) {
    const r = run(pack, mod, fresh(), t.name, {});
    if (r.status === 500) fail(`${t.name}({}) crashed: ${r.body.message}`);
    else if ((t.inputSchema.required || []).length && r.status !== 400) fail(`${t.name}({}) must return 400 for missing required args, got ${r.status}`);
  }

  const { story, limit } = pack;
  const pii = pack.tools.find((t) => t.slot === 'pii');
  const firstProp = Object.keys(pii.inputSchema.properties || {})[0];
  const q = String(story.customerName || '').split(' ')[0].toLowerCase();
  const found = run(pack, mod, fresh(), pii.name, { [firstProp]: q });
  if (found.status !== 200 || !JSON.stringify(found.body).includes(story.customerId)) fail(`${pii.name}({${firstProp}: "${q}"}) must find ${story.customerId}`);

  const moneyTool = pack.tools.find((t) => t.name === limit.tool);
  const idArg = (moneyTool.inputSchema.required || []).find((k) => k !== limit.argument);
  if (!idArg) fail(`${limit.tool} needs a required record-id argument besides ${limit.argument}`);
  if (!story.smallFeeId || !story.largeFeeId) fail('story.smallFeeId and story.largeFeeId (record ids for the limit tool) are required');
  if (idArg && story.smallFeeId && story.largeFeeId) {
    const db = fresh();
    const small = run(pack, mod, db, limit.tool, { [idArg]: story.smallFeeId, [limit.argument]: story.smallFeeAmount });
    if (small.status !== 200) fail(`${limit.tool} small (${story.smallFeeId}, ${story.smallFeeAmount}) -> ${small.status} ${JSON.stringify(small.body)}`);
    const large = run(pack, mod, db, limit.tool, { [idArg]: story.largeFeeId, [limit.argument]: story.largeFeeAmount });
    if (large.status !== 200) fail(`${limit.tool} large (${story.largeFeeId}, ${story.largeFeeAmount}) must pass the backend (Apigee enforces the limit) -> ${large.status}`);
    const again = run(pack, mod, db, limit.tool, { [idArg]: story.largeFeeId, [limit.argument]: story.largeFeeAmount });
    if (again.status === 200 || !/^EXCEEDS_/.test(again.body.error || '')) fail(`repeating the large ${limit.tool} must fail with an EXCEEDS_* error code, got ${again.status} ${again.body.error}`);
  }

  const lookup = pack.mcpPresets.find((p) => p.id === pack.mcpPersonaFlows?.support?.[0]?.id);
  if (!lookup) fail('mcpPersonaFlows.support[0] must be a preset');
  else {
    const r = run(pack, mod, fresh(), lookup.toolName, lookup.arguments);
    if (!JSON.stringify(r.body).includes(story.customerName)) fail(`first Support flow step (${lookup.id}) must return the story customer's name "${story.customerName}"`);
  }

  const s = pack.showcase?.scenarios || {};
  for (const slot of ['multi-step', 'refund', 'burst']) if (!String(s[slot]?.prompt || '').includes(story.customerId)) fail(`showcase ${slot} prompt must name ${story.customerId}`);
  if (!String(s.refund?.prompt || '').includes(story.largeFeeId)) fail(`showcase refund prompt must name ${story.largeFeeId}`);
  if (!/Never say an action happened/.test(pack.showcase?.instruction || '')) fail('showcase.instruction must include the "Never say an action happened unless a tool confirmed it" rule');

  const a = fresh(); const b = fresh();
  if (JSON.stringify(a) !== JSON.stringify(b) || a === b) fail('build() must return fresh, identical seed data each call');
  return errors;
}

module.exports = { checkPack };

if (require.main === module) {
  const id = process.argv[2];
  if (!id) { console.error('usage: node services/packs/check.js <id>'); process.exit(2); }
  const { validatePack } = require(path.join(REPO, 'industries', 'validate.js'));
  const src = (f) => path.join(REPO, 'industries', f);
  const pack = JSON.parse(fs.readFileSync(src(`${id}.json`), 'utf8'));
  const others = fs.readdirSync(path.join(REPO, 'industries')).filter((f) => f.endsWith('.json') && f !== `${id}.json`)
    .map((f) => { try { return JSON.parse(fs.readFileSync(src(f), 'utf8')); } catch { return null; } })
    .filter((p) => p && Array.isArray(p.tools) && Array.isArray(p.mcpPresets));
  const errors = validatePack(pack);
  if (!errors.length) errors.push(...checkPack(pack, require(path.join(__dirname, `${id}.js`)), others));
  if (errors.length) {
    console.error(`${id}: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`${id}: OK (${pack.tools.length} tools, ${pack.mcpPresets.length} presets)`);
}
