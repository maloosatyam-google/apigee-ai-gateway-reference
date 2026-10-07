// Validates an industry pack (industries/<id>.json).
//
// The pack is the single source of truth for an industry's MCP tools: the industry-apis
// service, the Apigee proxy/product generator, the agent service and the UI all read it.
// Every pack must fill the same outcome slots so the demo story works in every industry.
//
// Plain CommonJS with no dependencies, so it can be copied next to each consumer
// (see industries/sync.js) and required from Node scripts and tests.

'use strict';

/** Outcome slots every pack must fill (see docs: Industry demo packs). */
const REQUIRED_SLOTS = ['pii', 'lookup', 'write', 'money', 'metrics', 'confidential', 'forecast'];
/** Which persona each slot belongs to. */
const SLOT_PERSONA = {
  pii: 'ops', lookup: 'ops', write: 'ops', money: 'ops',
  metrics: 'insights', confidential: 'insights', forecast: 'insights',
};
const PERSONA_KEYS = ['ops', 'insights', 'admin'];
const PERSONA_ROLES = { ops: 'sales_agent', insights: 'loans_agent', admin: 'admin' };
/** Agent Showcase scenario slots a pack re-words (ids match SHOWCASE_SCENARIOS in the UI). */
const SHOWCASE_SLOTS = ['lookup', 'multi-step', 'refund', 'over-reach', 'injection', 'burst'];
/** Slots whose expected outcome text names industry tools, so the pack must supply it. */
const SHOWCASE_EXPECT_SLOTS = ['multi-step', 'refund', 'over-reach'];

/** Returns a list of problems; an empty list means the pack is valid. */
function validatePack(pack) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!pack || typeof pack !== 'object') return ['pack must be an object'];

  const { id } = pack;
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(id || ''))) fail('id must be a lowercase slug');
  if (!pack.label) fail('label is required');
  if (pack.proxy !== `${id}-mcp`) fail(`proxy must be "${id}-mcp"`);
  if (pack.basePath !== `/${id}/mcp`) fail(`basePath must be "/${id}/mcp"`);
  if (pack.currency !== 'USD') fail('currency must be USD (market-neutral demo data)');

  const personas = pack.personas || {};
  const productNames = new Set();
  for (const key of PERSONA_KEYS) {
    const p = personas[key];
    if (!p) { fail(`personas.${key} is missing`); continue; }
    if (p.role !== PERSONA_ROLES[key]) fail(`personas.${key}.role must be ${PERSONA_ROLES[key]}`);
    for (const f of ['label', 'product', 'productDisplayName', 'description']) {
      if (!p[f]) fail(`personas.${key}.${f} is required`);
    }
    if (key !== 'admin' && !p.app) fail(`personas.${key}.app is required`);
    if (p.product && !/^[A-Za-z0-9 ._-]+$/.test(p.product)) fail(`personas.${key}.product has characters Apigee product names do not allow`);
    if (p.product && !p.product.startsWith(pack.label)) fail(`personas.${key}.product must start with the industry label`);
    if (productNames.has(p.product)) fail(`personas.${key}.product is not unique`);
    productNames.add(p.product);
  }

  const tools = Array.isArray(pack.tools) ? pack.tools : [];
  if (!tools.length) fail('tools must be a non-empty array');
  const names = new Set();
  for (const t of tools) {
    const where = `tool ${t?.name || '?'}`;
    if (!/^[a-z][A-Za-z0-9]{2,40}$/.test(String(t?.name || ''))) fail(`${where}: name must be camelCase`);
    if (names.has(t.name)) fail(`${where}: duplicate name`);
    names.add(t.name);
    if (!REQUIRED_SLOTS.includes(t.slot)) fail(`${where}: unknown slot ${t.slot}`);
    else if (SLOT_PERSONA[t.slot] !== t.persona) fail(`${where}: slot ${t.slot} belongs to persona ${SLOT_PERSONA[t.slot]}`);
    if (!Number.isInteger(t.quotaPerMin) || t.quotaPerMin < 1) fail(`${where}: quotaPerMin must be a positive integer`);
    if (!t.description) fail(`${where}: description is required`);
    if (!t.area || typeof t.area !== 'string') fail(`${where}: area is required (business area, e.g. Cards, Loans)`);
    const s = t.inputSchema;
    if (!s || s.type !== 'object' || typeof (s.properties || {}) !== 'object') fail(`${where}: inputSchema must be an object schema`);
    else for (const r of s.required || []) if (!(r in (s.properties || {}))) fail(`${where}: required "${r}" is not a property`);
  }
  for (const slot of REQUIRED_SLOTS) {
    if (!tools.some((t) => t.slot === slot)) fail(`slot ${slot} has no tool`);
  }
  // Enough breadth for a believable demo: several business areas per persona.
  for (const persona of ['ops', 'insights']) {
    const areas = new Set(tools.filter((t) => t.persona === persona).map((t) => t.area));
    if (areas.size < 3) fail(`persona ${persona} needs tools in at least 3 areas (has ${areas.size})`);
  }
  const forecast = tools.filter((t) => t.slot === 'forecast');
  if (forecast.some((t) => t.quotaPerMin > 3)) fail('forecast tools must have a tight quota (<= 3/min) so the 429 is easy to show');

  const limit = pack.limit || {};
  const money = tools.find((t) => t.slot === 'money');
  if (!money || limit.tool !== money.name) fail('limit.tool must be the money-slot tool');
  else {
    const prop = money.inputSchema?.properties?.[limit.argument];
    if (!prop || prop.type !== 'number') fail('limit.argument must be a number property of the limit tool');
    if (!(money.inputSchema.required || []).includes(limit.argument)) fail('limit.argument must be required');
  }
  if (!(Number.isFinite(limit.max) && limit.max > 0)) fail('limit.max must be a positive number');
  if (limit.persona !== 'ops') fail('limit.persona must be ops (the governed, customer-facing persona)');
  if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(String(limit.code || ''))) fail('limit.code must be UPPER_SNAKE');
  if (!limit.message) fail('limit.message is required');

  const story = pack.story || {};
  for (const f of ['customerId', 'customerName', 'summary']) if (!story[f]) fail(`story.${f} is required`);
  if (Number.isFinite(story.smallFeeAmount) && story.smallFeeAmount > limit.max) fail('story small amount must be within the limit');
  if (Number.isFinite(story.largeFeeAmount) && story.largeFeeAmount <= limit.max) fail('story large amount must be over the limit');

  // MCP tab: presets (one-click tool calls) and the numbered "Try a task" flow per persona.
  const presets = Array.isArray(pack.mcpPresets) ? pack.mcpPresets : [];
  if (!presets.length) fail('mcpPresets must be a non-empty array');
  const presetIds = new Set();
  for (const p of presets) {
    if (!p?.id || presetIds.has(p.id)) fail(`preset ${p?.id || '?'}: id must be unique`);
    presetIds.add(p?.id);
    if (!names.has(p?.toolName)) fail(`preset ${p?.id}: unknown tool ${p?.toolName}`);
    for (const v of ['technical', 'analysts', 'support']) if (!p?.title?.[v]) fail(`preset ${p?.id}: title.${v} is required`);
    if (!p?.arguments || typeof p.arguments !== 'object') fail(`preset ${p?.id}: arguments must be an object`);
  }
  const flows = pack.mcpPersonaFlows || {};
  for (const speaker of ['support', 'analysts', 'eng']) {
    const flow = flows[speaker];
    if (!Array.isArray(flow) || !flow.length) { fail(`mcpPersonaFlows.${speaker} is required`); continue; }
    for (const f of flow) {
      if (!presetIds.has(f.id)) fail(`mcpPersonaFlows.${speaker}: unknown preset ${f.id}`);
      if (!['works', 'blocked', 'limit'].includes(f.outcome)) fail(`mcpPersonaFlows.${speaker}: bad outcome ${f.outcome}`);
    }
  }

  // Agent Showcase: the agent instruction (same for both sides) and the industry prompt for
  // each industry-specific scenario slot. Slots not listed here (cache, cheaper-model) reuse
  // the lookup prompt or stay industry neutral.
  const showcase = pack.showcase || {};
  if (typeof showcase.instruction !== 'string' || showcase.instruction.length < 40) fail('showcase.instruction is required');
  const scenarios = showcase.scenarios || {};
  for (const slot of SHOWCASE_SLOTS) {
    const s = scenarios[slot];
    if (!s?.title || !s?.prompt) { fail(`showcase.scenarios.${slot} needs title and prompt`); continue; }
    if (s.prompt.length > 4000) fail(`showcase.scenarios.${slot}.prompt is too long`);
    if (SHOWCASE_EXPECT_SLOTS.includes(slot) && !s.expect) fail(`showcase.scenarios.${slot}.expect is required (the outcome is industry specific)`);
  }
  for (const slot of Object.keys(scenarios)) if (!SHOWCASE_SLOTS.includes(slot)) fail(`showcase.scenarios.${slot} is not a showcase slot`);
  if (scenarios.refund?.prompt && Number.isFinite(story.largeFeeAmount) && !scenarios.refund.prompt.includes(`$${story.largeFeeAmount}`)) {
    fail('showcase.scenarios.refund.prompt must ask for the over-limit amount from the story');
  }

  return errors;
}

/** Tools for a persona key; admin gets every tool. */
function toolsFor(pack, personaKey) {
  return personaKey === 'admin' ? pack.tools.slice() : pack.tools.filter((t) => t.persona === personaKey);
}

module.exports = { REQUIRED_SLOTS, SLOT_PERSONA, PERSONA_KEYS, SHOWCASE_SLOTS, validatePack, toolsFor };
