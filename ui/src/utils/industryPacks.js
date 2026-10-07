// Industry packs in the UI: which pack (if any) drives the MCP tab for the active theme's
// industry, and the pack's endpoint, presets and persona flows.
//
// Packs come from industries/<id>.json via the generated ../data/industryPacks.js
// (`node industries/sync.js`). Industries without a pack keep the generic tools.
// Plain JS so the unit tests can import it (see tests/industrypacks.unit.test.mjs).

import { INDUSTRY_PACKS } from '../data/industryPacks.js';
import { APIGEE_BASE_PROD, APIGEE_BASE_DEV } from '../config/deployment.js';

const APIGEE_HOSTS = {
  dev: APIGEE_BASE_DEV,
  prod: APIGEE_BASE_PROD,
};

/** The pack for an industry id, or null (generic tools). */
export function industryPackFor(industryId, packs = INDUSTRY_PACKS) {
  return packs.find((p) => p.id === industryId) || null;
}

/** Ids of the industries that have a pack. */
export function industryPackIds(packs = INDUSTRY_PACKS) {
  return packs.map((p) => p.id);
}

/**
 * Where the MCP tab sends a pack's JSON-RPC calls.
 * requestUrl goes through the UI server (/api/industry-mcp-<env>/<id>), which forwards to
 * Apigee (<host>/<id>/mcp), or to a local industry-apis when `localUrl` is set (dev only).
 */
export function industryMcpEndpoint(pack, envId, localUrl = '') {
  const env = envId === 'dev' ? 'dev' : 'prod';
  const requestUrl = `/api/industry-mcp-${env}/${pack.id}`;
  if (localUrl) {
    return { requestUrl, displayEndpoint: `${localUrl.replace(/\/+$/, '')}/${pack.id}/mcp`, local: true };
  }
  return { requestUrl, displayEndpoint: `${APIGEE_HOSTS[env]}${pack.basePath}`, local: false };
}

/**
 * The pack's presets in the MCP tab's preset shape (McpPresetScenario + per-speaker lines).
 */
export function packPresets(pack) {
  return pack.mcpPresets.map((p) => {
    const tool = pack.tools.find((t) => t.name === p.toolName);
    return {
      id: p.id,
      title: p.title.technical,
      businessTitle: p.title.support,
      lines: { title: p.title },
      toolName: p.toolName,
      category: tool?.slot || 'Tools',
      description: p.description,
      businessDescription: p.description,
      arguments: p.arguments,
      badgeText: p.badgeText,
      businessBadgeText: p.badgeText,
      badgeColor: p.badgeColor,
    };
  });
}

/** The pack's tools in MCP tools/list shape (used before the live list loads). */
export function packTools(pack) {
  return pack.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Pack persona for the UI's active user: Support & Sales = ops, Analysts = insights, else admin. */
export function personaKeyForUser(activeUser) {
  if (activeUser === 'sales_agent') return 'ops';
  if (activeUser === 'loans_agent') return 'insights';
  return 'admin';
}

/** Tool names the persona's product entitles (admin: every tool). */
export function toolNamesForPersona(pack, personaKey) {
  return pack.tools.filter((t) => personaKey === 'admin' || t.persona === personaKey).map((t) => t.name);
}

/** Business areas in pack order, each with its tools (optionally only the given tool names). */
export function packAreas(pack, onlyNames) {
  const areas = [];
  for (const t of pack.tools) {
    if (onlyNames && !onlyNames.includes(t.name)) continue;
    let a = areas.find((x) => x.area === t.area);
    if (!a) areas.push((a = { area: t.area, persona: t.persona, tools: [] }));
    a.tools.push(t.name);
  }
  return areas;
}

/** Business area of a pack tool, or null. */
export function toolArea(toolName, packs = INDUSTRY_PACKS) {
  for (const p of packs) {
    const t = p.tools.find((x) => x.name === toolName);
    if (t) return { area: t.area, persona: t.persona, industry: p.id };
  }
  return null;
}

/**
 * Local preview only (no Apigee in front of industry-apis): what the pack's proxy would do
 * with this tools/call, so personas still differ. Mirrors the generated proxy and products:
 *   - tool not on the persona's product -> 401 InvalidApiKeyForGivenResource (VerifyAPIKey)
 *   - quota: more than quotaPerMin calls in the last minute -> 429 (Q-Limit)
 *   - the pack limit, ops product only -> 403 with a JSON-RPC tool error (RF-Limit*)
 * `recent` is the caller's timestamps (ms) for this persona + tool; returns null if it passes.
 */
export function simulateGateway(pack, personaKey, toolName, args = {}, recent = [], now = Date.now()) {
  const tool = pack.tools.find((t) => t.name === toolName);
  if (tool && !toolNamesForPersona(pack, personaKey).includes(toolName)) {
    return {
      status: 401,
      body: { fault: { faultstring: 'Invalid ApiKey for given resource', detail: { errorcode: 'oauth.v2.InvalidApiKeyForGivenResource' } } },
    };
  }
  if (tool) {
    const quota = personaKey === 'admin' && tool.slot !== 'forecast' ? 100 : tool.quotaPerMin;
    if (recent.filter((t) => now - t < 60_000).length >= quota) {
      return {
        status: 429,
        body: { fault: { faultstring: `Rate limit quota violation. Quota limit exceeded. Identifier : ${toolName}`, detail: { errorcode: 'policies.ratelimit.QuotaViolation' } } },
      };
    }
  }
  const { limit } = pack;
  const amount = Number(args?.[limit.argument]);
  if (toolName === limit.tool && personaKey === limit.persona && amount > limit.max) {
    const err = { status: 403, error: limit.code, message: `${limit.message} Requested $${amount}.`, limit: limit.max, requested: amount, enforcedBy: 'Apigee' };
    return { status: 403, limitCode: limit.code, body: { jsonrpc: '2.0', id: null, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] } } };
  }
  return null;
}

/**
 * Agent Showcase scenarios for the active industry.
 *
 * With a pack, each slot the pack re-words (lookup, multi-step, refund, over-reach,
 * injection, burst) takes the pack's title, prompt and, if given, expected outcome. "Ask
 * again (cache)" repeats the lookup prompt, and industry-neutral slots (cheaper-model) stay
 * as they are. Placeholders in `expect`: {label}, {opsCount}, {adminCount}, {limitMax}.
 * Without a pack the generic scenarios are returned unchanged.
 */
export function showcaseScenariosFor(scenarios, pack) {
  const slots = pack?.showcase?.scenarios;
  if (!slots) return scenarios;
  const vars = {
    label: pack.label,
    opsCount: String(toolNamesForPersona(pack, 'ops').length),
    adminCount: String(pack.tools.length),
    limitMax: String(pack.limit?.max ?? ''),
  };
  const fill = (text) => text.replace(/\{(label|opsCount|adminCount|limitMax)\}/g, (_, k) => vars[k]);
  return scenarios.map((s) => {
    const own = slots[s.id];
    if (own) return { ...s, title: own.title, prompt: own.prompt, ...(own.expect ? { expect: fill(own.expect) } : {}) };
    if (s.id === 'cache' && slots.lookup) return { ...s, prompt: slots.lookup.prompt };
    return s;
  });
}
