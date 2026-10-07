/**
 * Ask Apigee -- MCP tool governance (pure logic).
 *
 * Follows .gemini/skills/tools-gateway-manager: an MCP product's
 * payloadOperationGroup lists `tools/call/<tool>` operations, each with its own
 * quota, and VerifyAPIKey refuses any tool that is not in the caller's product
 * (persona = product = tool set).
 *
 * Ask Apigee never edits a live MCP product. It edits a "<name> Dev" clone that
 * is bound to the dev environment only, then proves the result with a test app
 * that holds only that clone. Going live is a pull request against
 * apigee/products/*.json, exactly as for the LLM persona products.
 */
import { AdminAgentError } from './adminAgentCore.js';

export const MCP_DEV_SUFFIX = ' Dev';
export const MCP_DEV_DISPLAY_SUFFIX = ' (Dev)';
export const MAX_TOOL_QUOTA = 100_000;
export const DEFAULT_TOOL_QUOTA = { limit: '60', interval: '1', timeUnit: 'minute' };
const TOOL_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const SERVER_FIELDS = ['createdAt', 'lastModifiedAt'];

export function isMcpProduct(p) {
  return Array.isArray(p?.payloadOperationGroup?.operationConfigs);
}

export function isMcpDevName(name) {
  return typeof name === 'string' && name.endsWith(MCP_DEV_SUFFIX);
}

export function mcpDevNameFor(liveName) {
  const n = String(liveName || '').trim();
  return isMcpDevName(n) ? n : `${n}${MCP_DEV_SUFFIX}`;
}

export function mcpLiveNameFor(name) {
  const n = String(name || '').trim();
  return isMcpDevName(n) ? n.slice(0, -MCP_DEV_SUFFIX.length) : n;
}

const attr = (p, name) => (p?.attributes || []).find((a) => a.name === name)?.value || '';

/** `tools/call/<tool>` operations with their quota, in product order. */
export function toolsOf(product) {
  const out = [];
  for (const cfg of product?.payloadOperationGroup?.operationConfigs || []) {
    for (const op of cfg.operations || []) {
      const m = /^tools\/call\/(.+)$/.exec(op.operation || '');
      if (m) out.push({ tool: m[1], apiSource: cfg.apiSource, quota: cfg.quota || null });
    }
  }
  return out;
}

export function apiSourcesOf(product) {
  return [...new Set((product?.payloadOperationGroup?.operationConfigs || []).map((c) => c.apiSource).filter(Boolean))];
}

/** Every tool any product grants on the same MCP server(s): what may be added. */
export function toolUniverse(products, apiSources) {
  const set = new Set();
  for (const p of products || []) {
    for (const t of toolsOf(p)) if (apiSources.includes(t.apiSource)) set.add(t.tool);
  }
  return [...set].sort();
}

/** Short summary for list views. */
export function summarizeMcpProduct(p) {
  return {
    name: p.name,
    displayName: p.displayName || p.name,
    industry: attr(p, 'industry'),
    persona: attr(p, 'persona'),
    environments: p.environments || [],
    mcpServers: apiSourcesOf(p),
    toolCount: toolsOf(p).length,
  };
}

/**
 * Dev clone of a live MCP product: same tools and quotas, dev environment only,
 * auto-approved so the per-product test app can use it immediately.
 */
export function buildMcpDevClone(live) {
  const clone = JSON.parse(JSON.stringify(live || {}));
  for (const f of SERVER_FIELDS) delete clone[f];
  clone.name = mcpDevNameFor(live.name);
  clone.displayName = `${live.displayName || live.name}${MCP_DEV_DISPLAY_SUFFIX}`;
  clone.description = `Ask Apigee dev sandbox clone of "${live.name}". Bound to dev only; prod changes go through a PR.`;
  clone.environments = ['dev'];
  clone.approvalType = 'auto';
  return clone;
}

/** Refuse anything that is not a dev clone bound to dev only. */
export function assertWritableMcpDev(product) {
  if (!isMcpDevName(product?.name)) {
    throw new AdminAgentError(`Refusing to write "${product?.name}": Ask Apigee only edits "… Dev" MCP clones.`, 'forbidden_target');
  }
  const envs = product.environments || [];
  if (envs.length !== 1 || envs[0] !== 'dev') {
    throw new AdminAgentError(`Refusing to write "${product.name}": a dev clone must be bound to "dev" only.`, 'forbidden_target');
  }
  return product;
}

function toolList(raw, label) {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const cleaned = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  for (const t of cleaned) {
    if (!TOOL_RE.test(t)) throw new AdminAgentError(`"${t}" in ${label} is not a valid tool name.`);
  }
  return cleaned;
}

/** Whitelist update_dev_tool_access arguments. */
export function validateToolAccessArgs(args = {}) {
  const product = String(args.product || '').trim();
  if (!product || product.length > 120) throw new AdminAgentError('update_dev_tool_access needs the MCP "product" name.');
  const add = toolList(args.add, 'add');
  const remove = toolList(args.remove, 'remove');
  const quotas = {};
  const rawQuotas = args.quotas && typeof args.quotas === 'object' ? args.quotas : {};
  for (const [tool, value] of Object.entries(rawQuotas)) {
    toolList([tool], 'quotas');
    const n = Number(String(value).replace(/[_,\s]/g, ''));
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOOL_QUOTA) {
      throw new AdminAgentError(`Quota for ${tool} must be a whole number of calls per minute between 1 and ${MAX_TOOL_QUOTA}.`);
    }
    quotas[tool] = String(n);
  }
  const overlap = add.filter((t) => remove.includes(t));
  if (overlap.length) throw new AdminAgentError(`Cannot add and remove the same tool: ${overlap.join(', ')}.`);
  if (add.length + remove.length + Object.keys(quotas).length === 0) {
    throw new AdminAgentError('Nothing to change: give tools to add, remove, or quotas to set.');
  }
  if (add.length + remove.length + Object.keys(quotas).length > 20) {
    throw new AdminAgentError('At most 20 tool changes in one call.');
  }
  return { product, add, remove, quotas };
}

/**
 * Apply tool grants/revocations/quotas to an MCP product. Pure.
 * `universe` = tools the product's MCP server(s) actually expose.
 */
export function applyToolAccessChanges(product, { add = [], remove = [], quotas = {} }, universe = []) {
  const next = JSON.parse(JSON.stringify(product));
  for (const f of SERVER_FIELDS) delete next[f];
  const configs = next.payloadOperationGroup.operationConfigs;
  const has = (tool) => toolsOf(next).some((t) => t.tool === tool);
  const diff = [];
  const sources = apiSourcesOf(product);

  for (const tool of add) {
    if (!universe.includes(tool)) {
      throw new AdminAgentError(
        `"${tool}" is not a tool on ${sources.join(', ')}. Available: ${universe.join(', ')}.`
      );
    }
    if (has(tool)) continue;
    const template = configs.find((c) => (c.operations || []).some((o) => /^tools\/call\//.test(o.operation)));
    const quota = { ...(template?.quota || DEFAULT_TOOL_QUOTA) };
    if (quotas[tool]) quota.limit = quotas[tool];
    configs.push({ apiSource: sources[0], operations: [{ operation: `tools/call/${tool}` }], quota });
    diff.push({ path: `tools.${tool}`, label: `Tool access · ${tool}`, before: 'not allowed', after: `allowed (${quota.limit}/${quota.timeUnit || 'minute'})` });
  }

  for (const tool of remove) {
    if (!has(tool)) throw new AdminAgentError(`"${tool}" is not granted on ${product.name}, so it cannot be removed.`);
    for (const cfg of configs) cfg.operations = (cfg.operations || []).filter((o) => o.operation !== `tools/call/${tool}`);
    diff.push({ path: `tools.${tool}`, label: `Tool access · ${tool}`, before: 'allowed', after: 'not allowed' });
  }
  next.payloadOperationGroup.operationConfigs = configs.filter((c) => (c.operations || []).length > 0);

  for (const [tool, limit] of Object.entries(quotas)) {
    if (add.includes(tool)) continue;
    const cfg = next.payloadOperationGroup.operationConfigs.find((c) => (c.operations || []).some((o) => o.operation === `tools/call/${tool}`));
    if (!cfg) throw new AdminAgentError(`"${tool}" is not granted on ${product.name}; add it first to set a quota.`);
    const before = cfg.quota?.limit ?? null;
    if (String(before) === limit) continue;
    if ((cfg.operations || []).length > 1) {
      // Split it out so the quota change touches only this tool.
      cfg.operations = cfg.operations.filter((o) => o.operation !== `tools/call/${tool}`);
      next.payloadOperationGroup.operationConfigs.push({
        apiSource: cfg.apiSource,
        operations: [{ operation: `tools/call/${tool}` }],
        quota: { ...(cfg.quota || DEFAULT_TOOL_QUOTA), limit },
      });
    } else {
      cfg.quota = { ...(cfg.quota || DEFAULT_TOOL_QUOTA), limit };
    }
    diff.push({ path: `quota.${tool}`, label: `Calls per ${cfg.quota?.timeUnit || 'minute'} · ${tool}`, before, after: limit });
  }
  return { next, diff };
}

/** `aviation-mcp` -> `/aviation/mcp`; null when the base path is not derivable. */
export function mcpBasePathFor(apiSource) {
  const m = /^([a-z0-9-]+)-mcp$/.exec(String(apiSource || ''));
  return m ? `/${m[1]}/mcp` : null;
}

/** Per-product MCP test app, bound to exactly one dev clone. */
export function mcpTestAppName(devName) {
  return `ask-apigee-mcp-test-${mcpLiveNameFor(devName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 90);
}

/**
 * Was the tool call let through by Apigee's per-tool authorization?
 * Apigee refuses an ungranted tool with 401 InvalidApiKeyForGivenResource
 * before the backend; anything the backend answers means it was allowed.
 */
export function classifyToolCall(status, json, text) {
  const body = typeof text === 'string' ? text : '';
  const code = json?.fault?.detail?.errorcode || '';
  if (/InvalidApiKeyForGivenResource/i.test(code) || /InvalidApiKeyForGivenResource/i.test(body)) return 'denied';
  if (/InvalidApiKey\b|oauth\.v2\.InvalidApiKey$/i.test(code) || /"oauth\.v2\.InvalidApiKey"/.test(body)) return 'key_not_ready';
  if (status === 429 || /QuotaViolation/i.test(code + body)) return 'rate_limited';
  if (status === 401 || status === 403) return /isError/.test(body) ? 'allowed' : 'denied';
  if (status > 0) return 'allowed';
  return 'unreachable';
}
