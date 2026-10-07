/**
 * Ask Apigee (formerly "Admin Agent") -- pure logic.
 *
 * Internal identifiers keep the admin-agent / admin-copilot names on purpose:
 * the /api/admin-agent routes, the sandbox app and the tests all key off them,
 * and renaming provisioned Apigee resources would orphan their credentials.
 *
 * Everything in this module is deliberately free of I/O: no fetch, no fs, no
 * clock beyond an injectable `now`. The Apigee management API and the AI
 * Gateway are reached through small injected functions (see
 * adminAgentService.js), so the interesting parts -- diffing, snapshot/revert,
 * the `(Dev)` write guard, tool-argument validation and the tool loop's
 * iteration/time caps -- can be unit-tested without credentials or egress.
 */

import { validateToolAccessArgs } from './mcpGovernance.js';
import { SKILL_NAMES } from './skillConsult.js';
import { PERSONA_PRODUCTS } from './personas.js';
import {
  CALL_OUTCOMES,
  USAGE_GROUPS,
  normalizeEmail,
  normalizeLimit,
  normalizeModel,
  normalizeRange,
  normalizeTool,
  normalizeTrackingId,
} from './insights.js';
import {
  DEFAULT_ADMIN_ROLE,
  adminRoleById,
  capabilityForChange,
  isAdminRole,
  ownerLabel,
  roleCan,
} from './adminRoles.js';
import { APIGEE_ORG, AI_BASE_PROD, AI_BASE_DEV } from './deployConfig.js';

export const ORG = APIGEE_ORG;

/**
 * Every agent write lands on a product whose name ends in this suffix.
 *
 * This is the *logical* name: the one the contract, the UI and the model all
 * use. Apigee itself rejects parentheses in an API product `name`
 * ("Invalid API product name", HTTP 400 — verified against a live Apigee X org), so
 * the resource is created as "Engineering and IT Dev" with the parenthesised form
 * as its displayName. apigeeProductName() is the only place the two meet.
 */
export const DEV_SUFFIX = ' (Dev)';
/** The same suffix, spelled the way Apigee will accept in a product name. */
export const APIGEE_DEV_SUFFIX = ' Dev';

/** One live product per persona (see personas.js). Bound to prod only. */
export const LIVE_PRODUCTS = [...PERSONA_PRODUCTS];
export const DEV_PRODUCTS = LIVE_PRODUCTS.map((n) => `${n}${DEV_SUFFIX}`);
/** The only products any tool call is allowed to name (live + dev clones). */
export const KNOWN_PRODUCTS = [...LIVE_PRODUCTS, ...DEV_PRODUCTS];

/**
 * Resource name of the sandbox developer app in Apigee.
 *
 * This deliberately still reads "copilot" after the Admin Copilot -> Admin Agent
 * rename: the app is already provisioned in the org and holds the sandbox
 * consumer key. Renaming it would orphan that key and force a re-provision, and
 * an Apigee app name cannot be edited in place. The user-facing DisplayName
 * attribute says "Admin Agent Dev Sandbox"; only the resource id is frozen.
 */
export const SANDBOX_APP_NAME = 'admin-copilot-dev';

/**
 * The agent runs on the same gateway it administers, so its own usage is
 * metered and shows up in the demo's analytics. Claude cannot be substituted:
 * the proxy's Gemini->Claude bridge drops `tools` and discards `tool_use`.
 *
 * Model chosen by benchmark, not by reputation. All four Gemini candidates were
 * driven through the real gateway with this file's own SYSTEM_INSTRUCTION and
 * tool declarations, 3 trials each:
 *
 *   model                   plain     tool turn   tools  thinking  cost/call
 *   gemini-3.1-flash-lite   2334ms    2212ms      3/3    0         $0.000101
 *   gemini-3-flash-preview  3747ms    2690ms      3/3    55        $0.000235
 *   gemini-3.7-flash        3648ms    3249ms      3/3    48        $0.002414
 *   gemini-3.8-flash        504 Gateway Timeout
 *
 * gemini-3.8-flash -- the previous choice -- now times out at the gateway under
 * a tool-bearing request. flash-lite answers a tool turn in ~2.2s, calls tools
 * just as reliably, emits no thinking tokens, and costs ~24x less than 3.7 and
 * ~240x less than 3.8 did per turn. It is also entitled on BOTH tiers, so the
 * fallback below is now genuinely a last resort rather than a routine path.
 */
export const AGENT_MODEL = 'gemini-3.1-flash-lite';
/** Used only if the primary model turns out not to be entitled (403/404). */
export const AGENT_FALLBACK_MODEL = 'gemini-3-flash-preview';
export { AI_BASE_PROD };
export { AI_BASE_DEV };

/**
 * Insight questions typically need two or three reads (usage, then logs, then
 * an explanation), so the cap is 8 rather than the original 6.
 */
export const MAX_TOOL_ITERATIONS = 8;
/**
 * Wall-clock ceiling for one chat turn.
 *
 * At ~2.5s per hop on gemini-3.1-flash-lite, the worst case (6 hops) is ~15s.
 * 45s leaves roughly 3x headroom for a slow upstream without making a wedged
 * turn feel hung. This was 90s when the agent ran on gemini-3.8-flash at ~13s
 * per hop; leaving it there would just mean waiting longer to find out a turn
 * had failed.
 */
export const TOOL_LOOP_BUDGET_MS = 45_000;
/** Newest N changes keep their pre-write snapshot, so revert stays byte-exact. */
export const MAX_TRACKED_CHANGES = 50;

/** A tool/validation failure that is safe to show the model and the user. */
export class AdminAgentError extends Error {
  constructor(message, code = 'invalid_argument') {
    super(message);
    this.name = 'AdminAgentError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Mint the stand-in identity token the gateway needs when there is no IAP
 * assertion (localhost). Shared with /api/me so the two can never drift.
 *
 * It must say RS256 and carry a non-empty signature segment: Apigee's
 * DecodeJWT rejects the `alg: none` / empty-signature form outright (401),
 * even though it never verifies the signature.
 */
export function mintSyntheticIdentityToken(email, name, nowMs = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sig = Buffer.from('dummysignature12345678901234567890').toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    email,
    sub: email,
    name,
    iss: 'local-dev',
    iat: Math.floor(nowMs / 1000),
  })}.${sig}`;
}

// ---------------------------------------------------------------------------
// Product name guards
// ---------------------------------------------------------------------------

export function isDevProductName(name) {
  return typeof name === 'string' && name.endsWith(DEV_SUFFIX);
}

/** Resolve any accepted spelling to one of the known product names. */
export function resolveKnownProduct(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const match = KNOWN_PRODUCTS.find((p) => p.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    throw new AdminAgentError(
      `Unknown product "${trimmed}". Known products: ${KNOWN_PRODUCTS.join(', ')}.`
    );
  }
  return match;
}

/** Map a source tier (live or dev spelling) onto its dev sandbox clone. */
export function devNameFor(sourceProduct) {
  const known = resolveKnownProduct(sourceProduct);
  return isDevProductName(known) ? known : `${known}${DEV_SUFFIX}`;
}

/**
 * Per-product test app for run_dev_test. The shared sandbox key is bound to
 * every dev product, and Apigee resolves the first product that matches the
 * call, so it cannot prove a per-product setting. One app per dev product can.
 */
export function productTestAppName(sourceProduct) {
  const live = liveNameFor(sourceProduct);
  return `ask-apigee-test-${live.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Compare the switches a dev product asks for with what the dev gateway
 * reported applying (x-gateway-guardrails). `matches` is null when the gateway
 * sent no header (older proxy revision) so nothing can be claimed either way.
 */
export function compareGuardrails(product, applied) {
  const attrs = Object.fromEntries((product?.attributes || []).map((a) => [a.name, String(a.value || '').toLowerCase()]));
  const expected = {
    'armor-prompt': attrs['guardrail.modelArmor.prompt'] === 'off' ? 'off' : 'on',
    'armor-response': attrs['guardrail.modelArmor.response'] === 'off' ? 'off' : 'on',
    'semantic-cache': attrs['guardrail.semanticCache'] === 'off' ? 'off' : 'on',
  };
  if (!applied) return { expected, applied: null, matches: null, mismatched: [] };
  const mismatched = Object.keys(expected).filter((k) => (applied[k] || 'on') !== expected[k]);
  return { expected, applied, matches: mismatched.length === 0, mismatched };
}

/** Map a dev clone back to the live tier it was cloned from. */
export function liveNameFor(devProduct) {
  const known = resolveKnownProduct(devProduct);
  return isDevProductName(known) ? known.slice(0, -DEV_SUFFIX.length) : known;
}

/**
 * The name to use in an Apigee management API path or `name` field.
 *
 * Apigee will not accept "Engineering and IT (Dev)" -- parentheses are outside
 * the permitted character set for an API product name -- so the dev clones live
 * under "Engineering and IT Dev" and carry the parenthesised form as their
 * displayName. Everything above this function speaks in logical names only.
 */
export function apigeeProductName(logicalName) {
  const known = resolveKnownProduct(logicalName);
  return isDevProductName(known)
    ? `${known.slice(0, -DEV_SUFFIX.length)}${APIGEE_DEV_SUFFIX}`
    : known;
}

/** Inverse of apigeeProductName, for names read back from Apigee. */
export function logicalProductName(apigeeName) {
  const trimmed = typeof apigeeName === 'string' ? apigeeName.trim() : '';
  if (trimmed.endsWith(APIGEE_DEV_SUFFIX)) {
    const base = trimmed.slice(0, -APIGEE_DEV_SUFFIX.length);
    if (LIVE_PRODUCTS.includes(base)) return `${base}${DEV_SUFFIX}`;
  }
  return trimmed;
}

/**
 * The hard stop behind requirement #2: update_dev_product must refuse to write
 * anything that is not a `(Dev)` clone, whatever the model asked for.
 */
export function assertWritableDevProduct(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!isDevProductName(trimmed)) {
    throw new AdminAgentError(
      `Refusing to write "${trimmed}": the agent may only modify dev sandbox products ` +
        `(names ending in "${DEV_SUFFIX}").`,
      'forbidden_target'
    );
  }
  if (!DEV_PRODUCTS.includes(trimmed)) {
    throw new AdminAgentError(
      `Refusing to write "${trimmed}": not one of the known dev sandbox products ` +
        `(${DEV_PRODUCTS.join(', ')}).`,
      'forbidden_target'
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Change paths
// ---------------------------------------------------------------------------

const ROUTING_CATEGORIES = ['coding', 'deep_reasoning', 'simple', 'general'];

/**
 * Per-product guardrail switches read by ai-gateway-v1 (AM-ResolveGuardrailToggles).
 * Missing means "on", so only an explicit "off" changes behaviour, and only on
 * the (Dev) products this agent can write.
 */
export const GUARDRAIL_ATTRIBUTES = {
  'guardrail.modelArmor.prompt': 'Prompt screening (Model Armor on the request)',
  'guardrail.modelArmor.response': 'Response screening (Model Armor on the answer)',
  'guardrail.semanticCache': 'Semantic cache (reuse answers to similar prompts)',
};
export const GUARDRAIL_VALUES = ['on', 'off'];

export function isGuardrailAttribute(attr) {
  return Object.prototype.hasOwnProperty.call(GUARDRAIL_ATTRIBUTES, String(attr || ''));
}

/** Only these attributes are writable; anything else is rejected up front. */
export const ALLOWED_ATTRIBUTE_NAMES = new Set([
  'access',
  'developer.budget.limit',
  'developer.budget.interval',
  'developer.budget.timeunit',
  ...ROUTING_CATEGORIES.map((c) => `routing.model.${c}`),
  ...Object.keys(GUARDRAIL_ATTRIBUTES),
]);

export const ALLOWED_ENVIRONMENTS = ['dev', 'prod'];
/** The only environment a `(Dev)` clone may ever be attached to. */
export const DEV_SANDBOX_ENVIRONMENTS = ['dev'];

/**
 * The environment half of the dev-only guarantee. assertWritableDevProduct
 * stops a write to a live tier by *name*; this stops a dev clone being
 * attached to prod, which would turn the sandbox key into a prod credential.
 */
export function assertDevOnlyEnvironments(environments) {
  const list = Array.isArray(environments) ? environments : [];
  const offending = list.filter((e) => !DEV_SANDBOX_ENVIRONMENTS.includes(String(e).trim()));
  if (list.length === 0 || offending.length > 0) {
    throw new AdminAgentError(
      `Refusing to attach a dev sandbox product to ${
        offending.length ? offending.map((e) => `"${e}"`).join(', ') : 'no environment'
      }: the agent may only deploy sandbox products to "dev". Production changes go ` +
        'through a pull request against the product definitions in git.',
      'forbidden_target'
    );
  }
  return list;
}

const MAX_QUOTA_LIMIT = 10_000_000;

/**
 * Classify and validate a change path *before* it reaches the Apigee
 * management API. Returns a descriptor; throws AdminAgentError otherwise.
 */
export function parseChangePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new AdminAgentError('Each change needs a "path".');
  }
  const p = path.trim();

  if (p === 'environments') return { kind: 'environments', path: p };

  if (p.startsWith('attributes.')) {
    const attr = p.slice('attributes.'.length);
    if (!ALLOWED_ATTRIBUTE_NAMES.has(attr)) {
      throw new AdminAgentError(
        `Attribute "${attr}" is not writable. Allowed: ${[...ALLOWED_ATTRIBUTE_NAMES].join(', ')}.`
      );
    }
    return { kind: 'attribute', path: p, attribute: attr };
  }

  const quota = /^llmTokenQuota\.(.+)\.limit$/.exec(p);
  if (quota) {
    const resource = quota[1].trim();
    if (!resource || resource.length > 120 || /[\s"'<>]/.test(resource)) {
      throw new AdminAgentError(`Invalid token quota resource "${resource}".`);
    }
    return { kind: 'quota', path: p, resource };
  }

  throw new AdminAgentError(
    `Unsupported change path "${p}". Supported: attributes.<name>, ` +
      'llmTokenQuota.<resource>.limit, environments.'
  );
}

/** Coerce and bounds-check a change value for the given path kind. */
export function normalizeChangeValue(descriptor, rawValue) {
  if (descriptor.kind === 'environments') {
    let list = rawValue;
    if (typeof list === 'string') {
      const text = list.trim();
      try {
        list = text.startsWith('[') ? JSON.parse(text) : text.split(',').map((s) => s.trim());
      } catch {
        throw new AdminAgentError(`environments must be a JSON array, got ${text}`);
      }
    }
    if (!Array.isArray(list) || list.length === 0) {
      throw new AdminAgentError('environments must be a non-empty array.');
    }
    const cleaned = [...new Set(list.map((e) => String(e).trim()))];
    for (const env of cleaned) {
      if (!ALLOWED_ENVIRONMENTS.includes(env)) {
        throw new AdminAgentError(
          `Unknown environment "${env}". Allowed: ${ALLOWED_ENVIRONMENTS.join(', ')}.`
        );
      }
    }
    // Every write lands on a (Dev) clone, and attaching one to prod would make
    // the sandbox key a prod credential -- a promote-to-prod by the back door.
    assertDevOnlyEnvironments(cleaned);
    return cleaned;
  }

  if (descriptor.kind === 'quota') {
    const n = Number(String(rawValue).replace(/[_,\s]/g, ''));
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_QUOTA_LIMIT) {
      throw new AdminAgentError(
        `Token quota limit must be a whole number between 1 and ${MAX_QUOTA_LIMIT}, got "${rawValue}".`
      );
    }
    return String(n);
  }

  // attribute
  if (rawValue === null || rawValue === undefined) {
    throw new AdminAgentError(`Attribute "${descriptor.attribute}" needs a value.`);
  }
  const value = String(rawValue).trim();
  if (!value || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new AdminAgentError(`Invalid value for "${descriptor.path}".`);
  }
  if (descriptor.attribute.startsWith('routing.model.') && !/^[A-Za-z0-9._@-]+$/.test(value)) {
    throw new AdminAgentError(`"${value}" is not a valid model id for ${descriptor.path}.`);
  }
  if (isGuardrailAttribute(descriptor.attribute)) {
    const v = value.toLowerCase();
    if (!GUARDRAIL_VALUES.includes(v)) {
      throw new AdminAgentError(`${descriptor.path} must be "on" or "off", got "${value}".`);
    }
    return v;
  }
  if (descriptor.attribute === 'developer.budget.limit' && !/^\d{1,12}$/.test(value)) {
    throw new AdminAgentError('developer.budget.limit must be a positive whole number.');
  }
  return value;
}

/** Validate the whole `changes` array from a tool call. */
export function validateChangeList(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new AdminAgentError('"changes" must be a non-empty array of {path, value}.');
  }
  if (changes.length > 20) {
    throw new AdminAgentError('At most 20 changes may be applied in one call.');
  }
  return changes.map((c) => {
    if (!c || typeof c !== 'object') throw new AdminAgentError('Each change must be an object.');
    const descriptor = parseChangePath(c.path);
    return { ...descriptor, value: normalizeChangeValue(descriptor, c.value) };
  });
}

// ---------------------------------------------------------------------------
// Admin persona scoping
// ---------------------------------------------------------------------------

/** Unknown or missing roles act as Platform Admin, the pre-persona behaviour. */
export function normalizeAdminRole(role) {
  return isAdminRole(role) ? role : DEFAULT_ADMIN_ROLE;
}

/** Capabilities a validated change list touches, e.g. ['budget']. */
export function capabilitiesForChanges(validated) {
  return [...new Set((validated || []).map(capabilityForChange))];
}

/**
 * Throw unless the acting admin persona owns every capability in `capabilities`.
 * The console greys the same areas out; this is the agent's equivalent, so a
 * Finance user cannot talk the agent into changing a routing model.
 */
export function assertRoleAllows(role, capabilities) {
  const r = adminRoleById(normalizeAdminRole(role));
  const denied = (capabilities || []).filter((c) => !roleCan(r.id, c));
  if (denied.length) {
    const owners = [...new Set(denied.map(ownerLabel))].join(' / ');
    throw new AdminAgentError(
      `${r.label} cannot change ${denied.join(', ')}: that is owned by ${owners}. ` +
        `Switch the admin persona to ${owners} or Platform Admin.`,
      'forbidden_role'
    );
  }
}

/** Appended to the system instruction so the model knows which changes it may make. */
export function roleInstruction(role) {
  const r = adminRoleById(normalizeAdminRole(role));
  if (r.id === 'platform') {
    return '\n\nACTING ADMIN PERSONA: Platform Admin (may change anything the tools allow).';
  }
  const scope = {
    finance:
      'You may ONLY change budgets (attributes.developer.budget.limit / .interval / .timeunit), ' +
      `top up prepaid wallets (topup_wallet, max $${MAX_TOPUP_USD}) and model prices on the dev rate card ` +
      '(update_dev_rate_card). You may read products, wallets, rate plans, the rate card and usage ' +
      'to answer cost questions. Do NOT change routing models, token quotas, access or environments; ' +
      'if asked, say the AI CoE owns that and suggest switching the admin persona.',
    ai_coe:
      'You may ONLY change which model auto-routing uses (attributes.routing.model.<category>), ' +
      'token quotas (llmTokenQuota.<resource>.limit), access and environments. You may read ' +
      'security controls, usage and logs, and run dev tests. Do NOT change budgets, wallets or ' +
      'prices; if asked, say Finance owns them and suggest switching the admin persona.',
  }[r.id];
  return `\n\nACTING ADMIN PERSONA: ${r.label}. ${scope}`;
}

// ---------------------------------------------------------------------------
// Reading / writing product fields
// ---------------------------------------------------------------------------

function operationConfigs(product) {
  return product?.llmOperationGroup?.operationConfigs || [];
}

/**
 * Accept either the literal operation resource (`/models/x:*`), a bare model id
 * (`gemini-3-flash-preview`) or `auto`, and return the canonical resource
 * string used by the product. Throws if the product has no such operation --
 * inventing one would silently create an unquota'd path.
 */
export function resolveQuotaResource(product, requested) {
  const want = String(requested).trim();
  const configs = operationConfigs(product);
  const resources = configs.flatMap((cfg) => (cfg.llmOperations || []).map((op) => op.resource));

  if (resources.includes(want)) return want;

  const candidates = [`/models/${want}:*`, `/${want}`, `/${want}:*`];
  for (const candidate of candidates) {
    if (resources.includes(candidate)) return candidate;
  }

  for (const cfg of configs) {
    for (const op of cfg.llmOperations || []) {
      if (op.model && op.model === want) return op.resource;
    }
  }

  throw new AdminAgentError(
    `"${want}" is not an operation on ${product?.name || 'this product'}. ` +
      `Available: ${resources.join(', ') || '(none)'}.`
  );
}

/** Current value at a change path, as a string (or null when unset). */
export function readChangePath(product, descriptor) {
  if (descriptor.kind === 'environments') {
    return JSON.stringify(product.environments || []);
  }
  if (descriptor.kind === 'attribute') {
    const found = (product.attributes || []).find((a) => a.name === descriptor.attribute);
    return found ? String(found.value ?? '') : null;
  }
  const resource = descriptor.resolvedResource || descriptor.resource;
  for (const cfg of operationConfigs(product)) {
    if ((cfg.llmOperations || []).some((op) => op.resource === resource)) {
      const limit = cfg.llmTokenQuota?.limit;
      return limit === undefined || limit === null ? null : String(limit);
    }
  }
  return null;
}

function writeChangePath(product, descriptor, value) {
  if (descriptor.kind === 'environments') {
    product.environments = value;
    return;
  }
  if (descriptor.kind === 'attribute') {
    product.attributes = product.attributes || [];
    const existing = product.attributes.find((a) => a.name === descriptor.attribute);
    if (existing) existing.value = value;
    else product.attributes.push({ name: descriptor.attribute, value });
    return;
  }
  const resource = descriptor.resolvedResource || descriptor.resource;
  let touched = false;
  for (const cfg of operationConfigs(product)) {
    if ((cfg.llmOperations || []).some((op) => op.resource === resource)) {
      cfg.llmTokenQuota = { interval: '1', timeUnit: 'minute', ...(cfg.llmTokenQuota || {}), limit: value };
      touched = true;
    }
  }
  if (!touched) {
    throw new AdminAgentError(`No token quota operation found for "${resource}".`);
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Apigee rejects these on write; they are server-owned metadata. */
export function stripServerFields(product) {
  const copy = clone(product);
  delete copy.createdAt;
  delete copy.lastModifiedAt;
  delete copy.createdBy;
  delete copy.lastModifiedBy;
  return copy;
}

/**
 * Apply a validated change list to a product, returning the new product and a
 * contract-shaped diff. The input product is never mutated, so the caller can
 * keep it as the pre-change snapshot.
 */
export function applyChangeSet(product, validatedChanges) {
  const next = clone(product);
  const diff = [];
  for (const change of validatedChanges) {
    const descriptor =
      change.kind === 'quota'
        ? { ...change, resolvedResource: resolveQuotaResource(next, change.resource) }
        : change;
    const canonicalPath =
      descriptor.kind === 'quota'
        ? `llmTokenQuota.${descriptor.resolvedResource}.limit`
        : descriptor.path;
    const before = readChangePath(next, descriptor);
    writeChangePath(next, descriptor, descriptor.value);
    const after = readChangePath(next, descriptor);
    if (before !== after) {
      diff.push({
        path: canonicalPath,
        // A readable label for the card. `path` stays on the object so the
        // exact config location is still available when someone asks for it.
        label: humanizeChangePath(canonicalPath),
        before,
        after,
      });
    }
  }
  return { next, diff };
}

/**
 * Turns an internal config path into something a platform owner can read at a
 * glance. The admin reading the change card wants "Token limit · Claude Haiku",
 * not "llmTokenQuota./models/claude-haiku-4-5@20251001:*.limit".
 *
 * Unknown shapes fall through to the raw path rather than being mangled into a
 * confident-sounding wrong label.
 */
export function humanizeChangePath(path) {
  const quota = /^llmTokenQuota\.(.+)\.limit$/.exec(path);
  if (quota) {
    const resource = quota[1];
    if (resource === '/auto' || resource === '/auto:*') return 'Token limit · auto-routed calls';
    const model = /^\/models\/(.+?):?\*?$/.exec(resource);
    if (model) return `Token limit · ${model[1].replace(/@\d+$/, '')}`;
    return `Token limit · ${resource}`;
  }

  const attr = /^attributes\.(.+)$/.exec(path);
  if (attr) {
    const known = {
      'developer.budget.limit': 'Monthly spending cap',
      'developer.budget.interval': 'Spending cap interval',
      'developer.budget.timeunit': 'Spending cap period',
      'routing.model.coding': 'Auto-routing · coding prompts',
      'routing.model.deep_reasoning': 'Auto-routing · deep reasoning',
      'routing.model.simple': 'Auto-routing · simple lookups',
      'routing.model.general': 'Auto-routing · general prompts',
      access: 'Product visibility',
      ...GUARDRAIL_ATTRIBUTES,
    };
    return known[attr[1]] || `Attribute · ${attr[1]}`;
  }

  if (path === 'environments') return 'Environments';
  return path;
}

/**
 * One line of plain English for the change card and the model's own recap.
 * Groups the common case — several token limits moved at once — instead of
 * listing four near-identical config paths.
 */
export function summarizeDiff(productName, diff) {
  if (diff.length === 0) return `No effective change on ${productName} — values already match.`;

  const tier = productName.replace(/\s*\(Dev\)\s*$/, '');
  const quotas = diff.filter((d) => /^llmTokenQuota\./.test(d.path));

  // All token limits, all moving the same way: say it once.
  if (quotas.length === diff.length && quotas.length > 1) {
    const raised = quotas.every((d) => Number(d.after) > Number(d.before));
    const lowered = quotas.every((d) => Number(d.after) < Number(d.before));
    const verb = raised ? 'Raised' : lowered ? 'Lowered' : 'Changed';
    return `${verb} ${quotas.length} per-minute token limits on ${tier}`;
  }

  const describe = (d) =>
    `${d.label || humanizeChangePath(d.path)}: ${d.before ?? '—'} → ${d.after}`;
  const parts = diff.slice(0, 2).map(describe);
  const more = diff.length > 2 ? ` (+${diff.length - 2} more)` : '';
  return `${tier}: ${parts.join('; ')}${more}`;
}

export function newChangeId(randomHex = () => Math.random().toString(16).slice(2, 10)) {
  return `chg_${String(randomHex()).replace(/[^0-9a-f]/gi, '').slice(0, 8).padEnd(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Change store (snapshots for byte-exact revert)
// ---------------------------------------------------------------------------

/**
 * Keeps the last N changes together with the exact bytes of the product as it
 * was read immediately before the write. Revert replays those bytes; it does
 * not "reset to defaults", so a change applied on top of hand-edited state
 * restores that state rather than the canonical demo one.
 */
export class ChangeStore {
  constructor(max = MAX_TRACKED_CHANGES) {
    this.max = max;
    this.entries = new Map();
  }

  record(change, snapshotRaw) {
    this.entries.set(change.changeId, { change, snapshotRaw });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    return change;
  }

  get(changeId) {
    return this.entries.get(changeId) || null;
  }

  /** Newest first. Snapshots are never included -- they are server-only state. */
  list() {
    return [...this.entries.values()].map((e) => e.change).reverse();
  }

  setStatus(changeId, status) {
    const entry = this.entries.get(changeId);
    if (!entry) return null;
    entry.change.status = status;
    return entry.change;
  }

  get size() {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// Dev sandbox clone
// ---------------------------------------------------------------------------

/**
 * Build the dev clone of a live tier: same attributes and llmOperationGroup,
 * but pinned to the dev environment with auto approval. API Products are
 * org-scoped, which is exactly why the agent never writes the live tiers.
 */
export function buildDevClone(liveProduct, devName = devNameFor(liveProduct?.name)) {
  const source = stripServerFields(liveProduct || {});
  return {
    // `name` is the Apigee resource id and may not contain parentheses;
    // `displayName` is what the console and the agent show.
    name: apigeeProductName(devName),
    // Keep the live product's friendly label ("Engineering & IT") on the clone.
    displayName: liveProduct?.displayName ? `${liveProduct.displayName}${DEV_SUFFIX}` : devName,
    description:
      `Admin Agent dev sandbox clone of "${liveProduct?.name || ''}". ` +
      'Safe to modify: not attached to prod.',
    approvalType: 'auto',
    environments: ['dev'],
    attributes: clone(source.attributes || []),
    ...(source.llmOperationGroup ? { llmOperationGroup: clone(source.llmOperationGroup) } : {}),
    ...(source.operationGroup ? { operationGroup: clone(source.operationGroup) } : {}),
    ...(source.quota ? { quota: source.quota, quotaInterval: source.quotaInterval, quotaTimeUnit: source.quotaTimeUnit } : {}),
  };
}

/** Models a dev test may name: whatever the dev products actually entitle. */
export function allowedTestModels(devProducts = []) {
  const models = new Set(['auto']);
  for (const product of devProducts) {
    for (const cfg of operationConfigs(product)) {
      for (const op of cfg.llmOperations || []) {
        if (op.model && op.model !== 'auto') models.add(op.model);
      }
    }
  }
  return [...models];
}

// ---------------------------------------------------------------------------
// Tool declarations
// ---------------------------------------------------------------------------

/** Read-only analytics / audit tools. The only tools offered in the user view. */
export const INSIGHT_TOOL_NAMES = ['query_usage', 'query_tool_usage', 'search_call_logs', 'explain_failure'];

/** Finance tools: prepaid wallets, rate plans and model prices. */
export const FINANCE_TOOL_NAMES = ['get_wallet', 'list_rate_plans', 'topup_wallet', 'update_dev_rate_card'];

/** Largest single wallet top-up Ask Apigee may make. Wallets are org-level, so keep it small. */
export const MAX_TOPUP_USD = 100;
/** Sanity ceiling for a per-1M-token price on the dev rate card. */
export const MAX_RATE_USD = 1000;

/** MCP tool governance (admin view only; dev clones only). */
export const MCP_TOOL_NAMES = ['list_mcp_tools', 'update_dev_tool_access', 'run_dev_tool_test'];

export function buildMcpDeclarations() {
  return [
    {
      name: 'list_mcp_tools',
      description:
        'MCP tool access. Without "product": list the MCP API products (persona tool sets per industry). With "product": ' +
        'the tools that product allows with their per-minute quotas, the tools its MCP server offers but it does not allow, ' +
        'and its dev copy (if any) with the differences.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', description: 'Exact MCP product name, e.g. "Banking Tools MCP - Analysts".' },
          industry: { type: 'string', description: 'Optional filter for the list, e.g. "banking".' },
        },
      },
    },
    {
      name: 'update_dev_tool_access',
      description:
        'Allow or remove MCP tools, or change a tool\'s calls-per-minute quota, on the DEV copy of an MCP product ' +
        '(created from the live product on first use, dev only). Requires consult_skill (tools-gateway-manager) first.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', description: 'Live MCP product name (from list_mcp_tools).' },
          add: { type: 'string', description: 'Comma-separated tool names to allow, e.g. "getAccount, listTransactions".' },
          remove: { type: 'string', description: 'Comma-separated tool names to remove, e.g. "getAccount, listTransactions".' },
          quotas: {
            type: 'object',
            description: 'Map of tool name -> calls per minute, e.g. {"getAccount": 30}.',
          },
        },
        required: ['product'],
      },
    },
    {
      name: 'run_dev_tool_test',
      description:
        'Prove tool access on the dev gateway: call one tool as the dev copy of an MCP product (a test key that holds only ' +
        'that copy) and report whether Apigee allowed or denied it, versus what the dev copy says.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', description: 'Live MCP product name; its dev copy is used.' },
          tool: { type: 'string', description: 'Tool to call.' },
          arguments: { type: 'object', description: 'Optional tool arguments. Defaults to {} (enough to prove access).' },
        },
        required: ['product', 'tool'],
      },
    },
  ];
}

export const TOOL_NAMES = [
  'list_products',
  'get_product',
  'list_guardrails',
  'get_rate_card',
  'update_dev_product',
  'run_dev_test',
  'revert_change',
  ...INSIGHT_TOOL_NAMES,
  ...FINANCE_TOOL_NAMES,
  'consult_skill',
  ...MCP_TOOL_NAMES,
];

/** Finance tool declarations (admin view only). */
export function buildFinanceDeclarations() {
  return [
    {
      name: 'get_wallet',
      description:
        'Read a developer\'s prepaid wallet: current balance, currency and billing type (PREPAID / POSTPAID). Defaults to the signed-in admin.',
      parameters: {
        type: 'object',
        properties: { developer: { type: 'string', description: 'Developer email. Optional.' } },
      },
    },
    {
      name: 'list_rate_plans',
      description:
        'List the Apigee monetization rate plans on the persona products: state, billing period, fixed fees and per-call consumption pricing.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', description: 'Optional: one persona product.', enum: LIVE_PRODUCTS },
        },
      },
    },
    {
      name: 'topup_wallet',
      description:
        `Credit a developer's prepaid wallet with a US dollar amount (max $${MAX_TOPUP_USD} per top-up). Prepaid wallets are org-level in Apigee, so this is real credit; it is recorded as a change and can be reverted, which debits the same amount back.`,
      parameters: {
        type: 'object',
        properties: {
          developer: { type: 'string', description: 'Developer email to credit.' },
          amountUsd: { type: 'number', description: `Dollars to add, 1 to ${MAX_TOPUP_USD}.` },
        },
        required: ['developer', 'amountUsd'],
      },
    },
    {
      name: 'update_dev_rate_card',
      description:
        'Change what one model costs on the DEV rate card (the ai-model-rates KVM in the dev environment): input and/or output price in US dollars per 1M tokens. Prod prices are never written. Returns a revertible diff.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Exact rate-card key, e.g. gemini-3-flash-preview or claude-opus-4-5. Read get_rate_card first.' },
          input: { type: 'number', description: 'New input price, USD per 1M tokens.' },
          output: { type: 'number', description: 'New output price, USD per 1M tokens.' },
        },
        required: ['model'],
      },
    },
  ];
}

/** The two audiences Ask Apigee serves. */
export const ASSISTANT_SCOPES = ['admin', 'user'];

export function normalizeScope(scope) {
  return scope === 'user' ? 'user' : 'admin';
}

/**
 * Insight tool declarations. In the user view the `user` filter is not even
 * offered: the server pins every query to the caller (see insights.js).
 */
export function buildInsightDeclarations(scope = 'admin') {
  const isAdmin = normalizeScope(scope) === 'admin';
  const range = {
    type: 'string',
    description: 'Time window: 1h, 24h, 7d or 30d. Defaults to 24h.',
    enum: ['1h', '24h', '7d', '30d'],
  };
  const env = { type: 'string', description: 'Apigee environment. Defaults to prod.', enum: ['prod', 'dev'] };
  const userProp = isAdmin
    ? { user: { type: 'string', description: 'Optional: restrict to one caller, by email.' } }
    : {};
  const model = { type: 'string', description: 'Optional exact model id, e.g. gemini-3-flash-preview.' };
  const limit = { type: 'integer', description: 'Max rows to return (1-25). Defaults to 10.' };
  return [
    {
      name: 'query_usage',
      description: isAdmin
        ? 'AI Gateway usage from Apigee Analytics: calls, errors, input/output tokens, spend (priced at the live rate card) and cache hit rate, ranked by spend. Group by user, model or user_model. Use for "who spent the most", "top models by tokens", "how much did X use".'
        : 'Your own AI Gateway usage from Apigee Analytics: calls, errors, tokens, spend and cache hit rate, broken down by model.',
      parameters: {
        type: 'object',
        properties: {
          range,
          env,
          ...userProp,
          model,
          ...(isAdmin ? { groupBy: { type: 'string', description: 'user (default), model or user_model.', enum: USAGE_GROUPS } } : {}),
          limit,
        },
      },
    },
    {
      name: 'query_tool_usage',
      description: isAdmin
        ? 'MCP tool traffic: calls by MCP server, persona and HTTP status (ok / denied / throttled / rejected / error), plus most-called tools and recent tool calls from the audit log.'
        : 'Your own MCP tool calls: which tools you called, how many succeeded or were blocked, and recent calls.',
      parameters: {
        type: 'object',
        properties: {
          range,
          env,
          ...userProp,
          tool: { type: 'string', description: 'Optional exact tool name, e.g. issueRefund.' },
          limit,
        },
      },
    },
    {
      name: 'search_call_logs',
      description: isAdmin
        ? 'Recent AI Gateway calls from the Cloud Logging audit log (newest first), with status, model, tokens, cost, latency and a breakdown of failure reasons. Filter by user, model and outcome.'
        : 'Your recent AI Gateway calls from the audit log (newest first), with status, model, tokens, cost and why any failed.',
      parameters: {
        type: 'object',
        properties: {
          range,
          env,
          ...userProp,
          model,
          outcome: { type: 'string', description: 'all (default), errors, blocked (stopped by governance) or ok.', enum: CALL_OUTCOMES },
          limit,
        },
      },
    },
    {
      name: 'explain_failure',
      description:
        'Explain why calls failed (e.g. a 429 or 403): classifies each failure (token quota, spending cap, prepaid wallet, Model Armor, model not allowed, bad key, upstream capacity) and says who can fix it and how. Pass a trackingId for one call, or filter by ' +
        (isAdmin ? 'user and model' : 'model') +
        ' for the latest failures.',
      parameters: {
        type: 'object',
        properties: {
          range,
          env,
          ...userProp,
          model,
          trackingId: { type: 'string', description: 'Optional tracking id of one call (from the trace viewer or call logs).' },
        },
      },
    },
  ];
}

/**
 * Gemini function declarations. Kept JSON-serialisable and schema-minimal.
 * The user view gets the insight tools only; nothing that reads config or writes.
 */
export function buildFunctionDeclarations(scope = 'admin') {
  if (normalizeScope(scope) === 'user') return buildInsightDeclarations('user');
  return [
    {
      name: 'list_products',
      description:
        `List the live persona API Products (${PERSONA_PRODUCTS.join(', ')}) and their dev sandbox clones, with environments, approval type, token quotas and routing attributes.`,
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_product',
      description:
        'Read one API Product in full: attributes, environments and per-model token quotas.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `Exact product name. One of: ${KNOWN_PRODUCTS.join(', ')}.`,
            enum: KNOWN_PRODUCTS,
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_guardrails',
      description:
        'List the guardrail controls enforced by the AI and MCP gateway proxies, including the Apigee policies behind each one.',
      parameters: {
        type: 'object',
        properties: {
          gateway: {
            type: 'string',
            description: 'Optional filter: "ai" or "mcp". Omit for both.',
            enum: ['ai', 'mcp'],
          },
        },
      },
    },
    {
      name: 'get_rate_card',
      description:
        'Read the live per-model input/output token rates from the ai-model-rates KVM that the gateway prices requests with.',
      parameters: {
        type: 'object',
        properties: {
          env: { type: 'string', description: 'Apigee environment, dev or prod. Defaults to prod.', enum: ['dev', 'prod'] },
        },
      },
    },
    {
      name: 'update_dev_product',
      description:
        'Apply configuration changes to the DEV SANDBOX clone of a tier. The live tier is never written. Returns the applied diff, which the user can revert.',
      parameters: {
        type: 'object',
        properties: {
          sourceProduct: {
            type: 'string',
            description: 'The tier to change. The dev clone is written, not this product.',
            enum: LIVE_PRODUCTS,
          },
          changes: {
            type: 'array',
            description: 'The edits to apply.',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description:
                    'One of: attributes.<name> (access, developer.budget.limit, developer.budget.interval, developer.budget.timeunit, routing.model.coding|deep_reasoning|simple|general), llmTokenQuota.<resource>.limit (resource may be a model id such as gemini-3-flash-preview), or environments.',
                },
                value: {
                  type: 'string',
                  description:
                    'The new value. For environments pass a JSON array string such as ["dev"]; dev is the only environment a sandbox copy may be attached to.',
                },
              },
              required: ['path', 'value'],
            },
          },
        },
        required: ['sourceProduct', 'changes'],
      },
    },
    {
      name: 'run_dev_test',
      description:
        'Send a real prompt through the dev AI Gateway using the sandbox app key, and report status, model, tokens, cost, cache status and latency.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt to send.' },
          model: {
            type: 'string',
            description: 'Optional model id, or "auto" to exercise the router. Defaults to auto.',
          },
          sourceProduct: {
            type: 'string',
            description:
              'Optional persona product to test as (its dev copy). Required to prove a per-product change such as a ' +
              'screening or cache switch; the result then carries guardrailsCheck.',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'revert_change',
      description: 'Restore the exact pre-change snapshot for a change id returned by update_dev_product.',
      parameters: {
        type: 'object',
        properties: { changeId: { type: 'string', description: 'A chg_xxxxxxxx id.' } },
        required: ['changeId'],
      },
    },
    ...buildInsightDeclarations('admin'),
    ...buildFinanceDeclarations(),
    {
      name: 'consult_skill',
      description:
        'Look up the platform\'s own engineering playbook (the repo skills) before changing how the gateway screens, caches or ' +
        'governs traffic. Returns the most relevant sections with citations. Required before any guardrail.* change.',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            enum: SKILL_NAMES,
            description:
              'ai-gateway-policy-manager: LLM gateway screening, quotas, cache, cost. apigee-proxy-builder: policy and flow ' +
              'details. tools-gateway-manager: MCP tool governance.',
          },
          topic: { type: 'string', description: 'What you need, e.g. "prompt screening placement" or "semantic cache".' },
        },
        required: ['skill', 'topic'],
      },
    },
    ...buildMcpDeclarations(),
  ];
}

/**
 * Whitelist every tool argument before it can reach the management API.
 * Returns normalized args; throws AdminAgentError on anything unexpected.
 */
export function validateToolArgs(name, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  switch (name) {
    case 'list_products':
      return {};
    case 'get_product':
      return { name: resolveKnownProduct(args.name) };
    case 'list_guardrails': {
      const gateway = args.gateway ? String(args.gateway).trim().toLowerCase() : '';
      if (gateway && gateway !== 'ai' && gateway !== 'mcp') {
        throw new AdminAgentError(`Unknown gateway "${gateway}". Use "ai" or "mcp".`);
      }
      return gateway ? { gateway } : {};
    }
    case 'get_rate_card': {
      const env = args.env ? String(args.env).trim().toLowerCase() : 'prod';
      if (env !== 'dev' && env !== 'prod') {
        throw new AdminAgentError(`Unknown environment "${env}". Use "dev" or "prod".`);
      }
      return { env };
    }
    case 'update_dev_product': {
      const source = resolveKnownProduct(args.sourceProduct || args.product || args.name);
      return {
        sourceProduct: isDevProductName(source) ? liveNameFor(source) : source,
        changes: validateChangeList(args.changes),
      };
    }
    case 'run_dev_test': {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!prompt) throw new AdminAgentError('run_dev_test needs a non-empty "prompt".');
      if (prompt.length > 4000) throw new AdminAgentError('Prompt is too long (max 4000 chars).');
      const model = args.model ? String(args.model).trim() : 'auto';
      if (!/^[A-Za-z0-9._@:-]{1,80}$/.test(model)) {
        throw new AdminAgentError(`"${model}" is not a valid model id.`);
      }
      if (args.sourceProduct) return { prompt, model, sourceProduct: resolveKnownProduct(args.sourceProduct) };
      return { prompt, model };
    }
    case 'revert_change': {
      const changeId = typeof args.changeId === 'string' ? args.changeId.trim() : '';
      if (!/^chg_[0-9a-f]{8}$/.test(changeId)) {
        throw new AdminAgentError(`"${changeId}" is not a valid change id.`);
      }
      return { changeId };
    }
    case 'query_usage':
    case 'query_tool_usage':
    case 'search_call_logs':
    case 'explain_failure':
      return validateInsightArgs(name, args);
    case 'get_wallet':
    case 'list_rate_plans':
    case 'topup_wallet':
    case 'update_dev_rate_card':
      return validateFinanceArgs(name, args);
    case 'list_mcp_tools': {
      const product = args.product ? String(args.product).trim().slice(0, 120) : '';
      const industry = args.industry ? String(args.industry).trim().toLowerCase().slice(0, 40) : '';
      return { product, industry };
    }
    case 'update_dev_tool_access':
      return validateToolAccessArgs(args);
    case 'run_dev_tool_test': {
      const product = String(args.product || '').trim().slice(0, 120);
      const tool = String(args.tool || '').trim();
      if (!product) throw new AdminAgentError('run_dev_tool_test needs the MCP "product".');
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(tool)) throw new AdminAgentError(`"${tool}" is not a valid tool name.`);
      const toolArgs = args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments : {};
      if (JSON.stringify(toolArgs).length > 2000) throw new AdminAgentError('Tool arguments are too large (max 2000 chars).');
      return { product, tool, arguments: toolArgs };
    }
    case 'consult_skill': {
      const skill = String(args.skill || '').trim();
      if (!SKILL_NAMES.includes(skill)) {
        throw new AdminAgentError(`Unknown skill "${skill}". Available: ${SKILL_NAMES.join(', ')}.`);
      }
      const topic = String(args.topic || '').trim().slice(0, 200);
      if (!topic) throw new AdminAgentError('consult_skill needs a "topic".');
      return { skill, topic };
    }
    default:
      throw new AdminAgentError(`Unknown tool "${name}".`, 'unknown_tool');
  }
}

const DEV_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const RATE_KEY_RE = /^[A-Za-z0-9._@-]{1,100}$/;

/** Dollars with at most cent precision, inside [min, max]. */
function money(value, { min, max, label }) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value);
  if (!Number.isFinite(n)) throw new AdminAgentError(`${label} must be a number.`);
  if (n < min || n > max) throw new AdminAgentError(`${label} must be between ${min} and ${max}.`);
  return Math.round(n * 100) / 100;
}

/** Whitelist finance-tool arguments. */
export function validateFinanceArgs(name, args) {
  const email = (v, required) => {
    const e = String(v || '').trim().toLowerCase();
    if (!e) {
      if (required) throw new AdminAgentError(`${name} needs a developer email.`);
      return '';
    }
    if (!DEV_EMAIL_RE.test(e)) throw new AdminAgentError(`"${v}" is not a developer email.`);
    return e;
  };
  switch (name) {
    case 'get_wallet':
      return { developer: email(args.developer || args.user || args.email, false) };
    case 'list_rate_plans':
      return args.product ? { product: resolveKnownProduct(args.product) } : {};
    case 'topup_wallet':
      return {
        developer: email(args.developer || args.user || args.email, true),
        amountUsd: money(args.amountUsd ?? args.amount, { min: 1, max: MAX_TOPUP_USD, label: 'amountUsd' }),
      };
    case 'update_dev_rate_card': {
      const model = String(args.model || '').trim();
      if (!RATE_KEY_RE.test(model)) throw new AdminAgentError(`"${args.model}" is not a valid rate-card key.`);
      const out = { model };
      if (args.input !== undefined && args.input !== null && args.input !== '') {
        out.input = money(args.input, { min: 0, max: MAX_RATE_USD, label: 'input' });
      }
      if (args.output !== undefined && args.output !== null && args.output !== '') {
        out.output = money(args.output, { min: 0, max: MAX_RATE_USD, label: 'output' });
      }
      if (out.input === undefined && out.output === undefined) {
        throw new AdminAgentError('update_dev_rate_card needs an input and/or output price.');
      }
      return out;
    }
    default:
      throw new AdminAgentError(`Unknown tool "${name}".`, 'unknown_tool');
  }
}

/** Whitelist insight-tool arguments; every value ends up in an API filter. */
export function validateInsightArgs(name, args) {
  const wrap = (fn) => {
    try {
      return fn();
    } catch (err) {
      throw new AdminAgentError(err.message);
    }
  };
  const env = String(args.env || 'prod').trim().toLowerCase();
  if (env !== 'prod' && env !== 'dev') throw new AdminAgentError(`Unknown environment "${args.env}". Use "prod" or "dev".`);
  const out = { env, range: wrap(() => normalizeRange(args.range || args.timeRange || args.window)) };
  if (args.user !== undefined) out.user = wrap(() => normalizeEmail(args.user));
  if (name !== 'query_tool_usage' && args.model !== undefined) out.model = wrap(() => normalizeModel(args.model));
  if (name === 'query_usage') {
    const groupBy = String(args.groupBy || 'user').trim().toLowerCase();
    if (!USAGE_GROUPS.includes(groupBy)) throw new AdminAgentError(`groupBy must be one of ${USAGE_GROUPS.join(', ')}.`);
    out.groupBy = groupBy;
  }
  if (name === 'query_tool_usage' && args.tool !== undefined) out.tool = wrap(() => normalizeTool(args.tool));
  if (name === 'search_call_logs') {
    const outcome = String(args.outcome || 'all').trim().toLowerCase();
    if (!CALL_OUTCOMES.includes(outcome)) throw new AdminAgentError(`outcome must be one of ${CALL_OUTCOMES.join(', ')}.`);
    out.outcome = outcome;
  }
  if (name === 'explain_failure' && args.trackingId !== undefined) out.trackingId = wrap(() => normalizeTrackingId(args.trackingId));
  if (name !== 'explain_failure') out.limit = normalizeLimit(args.limit);
  return out;
}

export const ASSISTANT_NAME = 'Ask Apigee';

/** Shared guidance for the read-only analytics tools, used by both scopes. */
const INSIGHTS_GUIDANCE = `
ANSWERING USAGE, COST AND LOG QUESTIONS
- query_usage for calls, tokens, spend and cache hits; query_tool_usage for MCP
  tools; search_call_logs for individual recent calls; explain_failure for "why
  did this fail / why am I getting 429 / 403".
- Default to the last 24 hours on prod unless the question says otherwise
  ("this week" = 7d, "this month" = 30d, "today" = 24h).
- Lead with the number that answers the question, then at most 3-5 supporting
  rows. For "who / which is the most" questions, name the top one and show the
  top 3-5 as a short table so the ranking is visible.
- Explain failures using the reason / explanation fields the tools return.
  Never decode raw filter strings yourself ("PI" means prompt injection, not PII). Money as dollars with 2-4 decimals ("$0.0123"), tokens with commas.
- A short markdown table is fine when comparing 3 or more rows.
- When explaining a failure, say what happened, who owns the fix (the owner
  field: Finance, AI CoE or Platform) and what to do, in 2-3 sentences.
- If a query returns nothing, say so plainly and suggest a wider time range.`;

export const SYSTEM_INSTRUCTION = `You are ${ASSISTANT_NAME}, the assistant built into an Apigee AI Gateway console (org ${ORG}).

You help a platform administrator understand and change AI Gateway configuration,
and answer questions about usage, spend and failures, by talking to them, not by
showing them the machinery.

HOW TO WRITE
- Plain business English. Write the way you would explain it to a colleague who
  owns the platform but does not know Apigee's internals.
- Lead with the answer in one sentence. Add detail only if it genuinely helps.
- Short paragraphs or a few bullets. No headings for a two-line answer.
- Spell out numbers the way a person would: "2,000 tokens a minute", not
  "llmTokenQuota.limit=2000".
- Use everyday words for the concepts: "prompt screening" rather than
  "SUP-UserPrompt", "the spending cap" rather than "developer.budget.limit",
  "which models this tier may call" rather than "llmOperationGroup".

WHAT NOT TO SHOW UNLESS ASKED
- Never volunteer code, JSON, XML, policy filenames, attribute paths, resource
  paths or internal identifiers. They are noise to the person reading this panel.
- No fenced code blocks unless the admin explicitly asks to see the
  configuration, the policy, the XML, the JSON, or "the actual name of...".
- When they do ask, give it to them fully and precisely. The information is not
  secret, it is just not the default way to answer.
- Do not report your own token usage, cost or latency. The console shows that.

WHAT TO DO
- Never write out a tool call as your answer. Do not reply with text like
  "Calling get_product(...)" or "I will now call the tool". Either issue the
  tool call, or answer the question. Narration is never an acceptable reply.
- Use tools for every fact. Never invent a quota, model name, price or policy.
- Prefer one tool call per turn and stop as soon as you can answer. You have at
  most ${MAX_TOOL_ITERATIONS} tool rounds.
- There is one API Product per persona: ${PERSONA_PRODUCTS.join(', ')}.
  Each live product serves prod only and you never touch it.
  update_dev_product always writes the "${DEV_SUFFIX.trim()}" sandbox copy. Say that in
  plain words: "I've made that change on the dev copy."
- You cannot change production, and you must never offer to. Production is
  changed only by raising a pull request against the product definitions in
  git. If the admin asks you to promote, publish, or apply something to prod,
  tell them plainly that the change is ready on dev and that going live needs a
  pull request. Do not treat this as a failure -- it is how the platform works.
- Never guess a model id. Model names carry versions and suffixes that you will
  get wrong from memory. Read the product first and use the exact id it returns.
- If a tool fails and the error message lists the valid values, immediately
  retry once with the correct value. Do not ask the admin for permission to use
  a name the system just handed you -- they cannot be expected to know it, and
  asking wastes their turn. Only come back to them if the retry also fails.
- Write numbers as digits: "50 tokens a minute", never "fifty tokens a minute".
- After a change, say what is different now in one sentence, in business terms
  ("Customer Support & Sales can now use twice as many tokens a minute: 4,000
  instead of 2,000"). Mention that it can be undone from the card below. Do not repeat the
  diff; the card already shows it.
- If something fails for a reason you cannot correct, say what happened and what
  they can do about it, in one or two sentences. Never retry the same failing
  call with the same arguments.

MONEY
- Wallet top-ups (topup_wallet) are real prepaid credit: Apigee wallets are
  org-level, not per environment. Only top up when the admin clearly asked for
  an amount and a developer; never round up or choose an amount yourself.
- Model price changes (update_dev_rate_card) land on the dev rate card only.
  Read get_rate_card (env dev) first and use the exact key it returns.
- After either, say what changed in one sentence and that it can be undone from
  the card.

SCREENING AND CACHE SWITCHES (dev copies only)
- Each dev product has three switches: prompt screening, response screening and
  the semantic cache (attributes ${Object.keys(GUARDRAIL_ATTRIBUTES).join(', ')},
  values "on" or "off"; missing means on). Change them with update_dev_product.
- ALWAYS call consult_skill first (skill ai-gateway-policy-manager) and follow what
  it says; the change is refused without it. Mention the playbook advice in one line.
- Then prove it: call run_dev_test with sourceProduct set to that product. Its
  guardrailsCheck compares what the product asks for with what the dev gateway
  applied. Say it is proven ONLY if guardrailsCheck.matches is true. If it is
  false, say plainly that the gateway has not picked it up yet (Apigee caches
  product settings for a few minutes) and offer to re-test shortly. Never claim
  a test confirmed something it did not.
- Turning screening off is for experiments on dev only. Say so, and suggest
  turning it back on when they are done.

MCP TOOL ACCESS (dev copies only)
- Agents reach business tools through MCP products: one product per persona and
  industry, listing exactly which tools it may call and how often.
- Read list_mcp_tools first and use the exact product and tool names it returns.
- ALWAYS call consult_skill (skill tools-gateway-manager) before
  update_dev_tool_access; the change is refused without it.
- update_dev_tool_access edits the dev copy only (made from the live product on
  first use). Then prove it with run_dev_tool_test on a tool you changed, and say
  it is proven ONLY if the result's matches is true. A removed tool should come
  back "denied", an added one "allowed". If it does not match yet, say Apigee may
  take a minute to pick up the change and offer to re-test.
${INSIGHTS_GUIDANCE}`;

/**
 * The user-view assistant: read-only, and only ever about the caller's own
 * traffic. The tools cannot reach anyone else's data; this text just keeps the
 * model from promising things it cannot do.
 */
export function userSystemInstruction(email) {
  return `You are ${ASSISTANT_NAME}, the assistant built into an Apigee AI Gateway console (org ${ORG}).

You are talking to a developer${email ? ` signed in as ${email}` : ''} who uses the AI Gateway and MCP
tools. You answer questions about THEIR OWN usage: how many calls and tokens
they used, what it cost, which models and tools they called, and why a call of
theirs failed or was blocked.

RULES
- You can only see this person's own traffic. If they ask about other users,
  the whole fleet, or to change configuration, say that is available to admins
  in the Admin Console, and offer what you can show about their own usage.
- You cannot change anything. Never offer to.
- Use tools for every fact. Never invent a number, model name or reason.
- Plain, friendly English. Lead with the answer in one sentence. No code, JSON,
  policy names or internal identifiers unless they ask for them.
- Never write out a tool call as your answer.
- When a call was blocked by governance (quota, spending cap, Model Armor),
  explain it as the platform working as designed, then say what they can do.
${INSIGHTS_GUIDANCE}`;
}

// ---------------------------------------------------------------------------
// Tool loop
// ---------------------------------------------------------------------------

/**
 * True when a 4xx is Apigee's Model Armor guardrail rather than a client error.
 * Shared by the agent's own error reporting and by TestResult mapping so the
 * two can never disagree about what counts as a guardrail block.
 */
export function isModelArmorBlock(status, json, text) {
  if (status !== 400 && status !== 403) return false;
  const blob = JSON.stringify(json ?? text ?? '').toLowerCase();
  return (
    blob.includes('model armor') ||
    blob.includes('sanitize') ||
    blob.includes('sup-userprompt') ||
    blob.includes('blocked')
  );
}

/**
 * Two completely different failures share HTTP 429, and conflating them is
 * actively harmful in a governance demo:
 *
 *  - APIGEE_QUOTA: our own LLMTokenQuota / budget / wallet policy stopped the
 *    call. That IS the governance story. It is actionable (raise the quota, top
 *    up the wallet) and must fail fast and visibly.
 *  - UPSTREAM_CAPACITY: Vertex answered RESOURCE_EXHAUSTED and the gateway
 *    passed it through. Nothing to do with our configuration, and transient.
 *
 * Telling an admin their wallet is empty when it holds $15.78 of $20 is exactly
 * the sort of thing that derails a demo, so when the evidence is ambiguous this
 * returns UNKNOWN rather than guessing.
 */
export const RATE_LIMIT_APIGEE_QUOTA = 'apigee_quota';
export const RATE_LIMIT_UPSTREAM_CAPACITY = 'upstream_capacity';
export const RATE_LIMIT_UNKNOWN = 'unknown';

export function classifyRateLimit(res) {
  const json = res?.json;
  const blob = JSON.stringify(json ?? res?.text ?? '');
  const lower = blob.toLowerCase();
  const headers = res?.headers || {};

  // Vertex's own resource-exhaustion, forwarded by the gateway. The doc link in
  // the message is the most reliable marker; RESOURCE_EXHAUSTED is the next.
  if (
    lower.includes('error-code-429') ||
    lower.includes('resource exhausted') ||
    json?.error?.status === 'RESOURCE_EXHAUSTED'
  ) {
    return RATE_LIMIT_UPSTREAM_CAPACITY;
  }

  // Apigee-originated: a policy fault, or a gateway header that says so.
  const errorcode = String(json?.fault?.detail?.errorcode || '');
  if (
    /^policies\.(ratelimit|quota)\./i.test(errorcode) ||
    lower.includes('quotaviolation') ||
    lower.includes('ltq-token') ||
    lower.includes('token quota') ||
    lower.includes('budget') ||
    lower.includes('wallet') ||
    lower.includes('monetization')
  ) {
    return RATE_LIMIT_APIGEE_QUOTA;
  }
  const budgetStatus = String(headers['x-gateway-budget-status'] || '').toLowerCase();
  if (budgetStatus && budgetStatus !== 'ok') return RATE_LIMIT_APIGEE_QUOTA;

  return RATE_LIMIT_UNKNOWN;
}

/** Human-readable reason for a non-2xx (or transport-level) gateway result. */
export function describeGatewayFailure(res) {
  if (!res) return 'The AI Gateway returned no response.';
  if (res.error && !res.status) return `Could not reach the AI Gateway: ${res.error}`;
  const status = res.status || 0;
  const detail =
    res.json?.error?.message ||
    res.json?.fault?.faultstring ||
    (typeof res.text === 'string' ? res.text.slice(0, 240) : '') ||
    '';

  if (isModelArmorBlock(status, res.json, res.text)) {
    // The agent is governed by the very guardrail it exists to explain.
    // Observed behaviour: this template's prompt-injection filter can match on
    // benign security vocabulary, and it is not fully deterministic -- the same
    // prompt is sometimes allowed. So suggest a rephrase rather than asserting
    // a rule about which words are banned.
    const injection = /pimatchesfound: true/i.test(JSON.stringify(res.json ?? res.text ?? ''));
    return (
      `Model Armor blocked that prompt at the gateway${
        injection ? ' (prompt-injection filter)' : ''
      }, so it never reached a model. This template can match on security ` +
      'vocabulary; rephrasing usually gets through — e.g. "Which security controls ' +
      'are enforced on the AI proxy?".'
    );
  }
  if (status === 400 && /OASValidation|not allowed by the schema/i.test(detail)) {
    return `The gateway's request schema rejected the agent's payload: ${detail}`;
  }
  if (status === 401 || status === 403) {
    return `The AI Gateway rejected the agent's credentials (HTTP ${status})${detail ? `: ${detail}` : ''}.`;
  }
  if (status === 429) {
    const kind = classifyRateLimit(res);
    const retried = res.retriedUpstream ? ' It was already retried once.' : '';
    if (kind === RATE_LIMIT_UPSTREAM_CAPACITY) {
      return (
        'Vertex AI is out of model capacity right now (HTTP 429 RESOURCE_EXHAUSTED, ' +
        `upstream of the gateway). This is transient and unrelated to your token quota or wallet.${retried} ` +
        `Try again in a moment.${detail ? ` Upstream said: ${detail}` : ''}`
      );
    }
    if (kind === RATE_LIMIT_APIGEE_QUOTA) {
      return (
        "The gateway's own governance stopped this call (HTTP 429): the agent's " +
        `token quota or prepaid wallet budget is exhausted.${detail ? ` ${detail}` : ''} ` +
        'Raise the quota on the API Product or top up the developer wallet.'
      );
    }
    return (
      `The AI Gateway returned HTTP 429, and the response does not say whether that is our ` +
      `token quota or upstream model capacity.${retried}${detail ? ` It said: ${detail}` : ''}`
    );
  }
  if (status >= 500) {
    return `The AI Gateway is failing upstream (HTTP ${status})${detail ? `: ${detail}` : ''}.`;
  }
  return `The AI Gateway returned HTTP ${status}${detail ? `: ${detail}` : ''}.`;
}

function partsToText(parts) {
  return (parts || [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Keep a tool result from blowing up the next prompt. */
export function truncateToolResult(value, max = 6000) {
  const text = JSON.stringify(value ?? null);
  if (text.length <= max) return value;
  return { truncated: true, note: `Result truncated to ${max} chars.`, preview: text.slice(0, max) };
}

/**
 * Canonical Gemini encoding: echo the model's functionCall parts back and reply
 * with functionResponse parts, correlated by the `id` the gateway assigns.
 *
 * This is what Vertex expects, but it does NOT survive our gateway: the AI
 * proxy's OAS-ValidateRequest policy validates the request body against
 * oas://openapi.yaml, whose `parts` schema allows text only. Sending it back
 * yields HTTP 400 "Object instance has properties which are not allowed by the
 * schema: [functionCall, thoughtSignature]". Kept, and tested, so that the day
 * the proxy's OpenAPI spec learns about tool parts this is a one-line switch.
 */
export function nativeToolTurn({ modelParts, results }) {
  return [
    { role: 'model', parts: modelParts },
    {
      role: 'user',
      parts: results.map(({ call, response }) => ({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: truncateToolResult(response),
        },
      })),
    },
  ];
}

/**
 * Gateway-compatible encoding: the same information as text parts.
 *
 * Roles stay strictly alternating (model, then user) because the model's own
 * functionCall part cannot be echoed; a one-line stand-in takes its place.
 * The results are labelled as system-generated so the model does not mistake
 * them for something the admin typed.
 *
 * The stand-in is deliberately written as a bracketed machine marker rather
 * than prose. An earlier version read "Calling get_product({...})", which the
 * model learned from its own transcript and started emitting as a FINAL ANSWER
 * instead of actually calling the tool — the admin saw
 * `Calling get_product({"name":"Standard AI Tier (Dev)"})` (a since-retired tier) as the reply. Anything
 * that looks like a sentence here is something the model may imitate.
 */
export function textToolTurn({ results }) {
  const callLine = results
    .map(({ call }) => `${call.name}(${JSON.stringify(call.args ?? {})})`)
    .join(', ');
  const body = results
    .map(({ call, response }) =>
      `### ${call.name}${call.id ? ` [${call.id}]` : ''}\n${JSON.stringify(truncateToolResult(response))}`
    )
    .join('\n\n');
  return [
    { role: 'model', parts: [{ text: `<<TOOL_CALL_ISSUED ${callLine}>>` }] },
    {
      role: 'user',
      parts: [{ text: `TOOL RESULTS (system-generated, not typed by the user):\n\n${body}` }],
    },
  ];
}

/**
 * True when the model has narrated a tool call instead of answering.
 *
 * This is never a valid reply: either the model should have emitted a real
 * functionCall part, or it should have answered the question. Surfacing it
 * verbatim shows the admin our internal plumbing.
 */
export function looksLikeToolNarration(text) {
  if (!text) return false;
  const t = text.trim();
  return (
    /^<<TOOL_CALL_ISSUED/.test(t) ||
    /^calling\s+[a-z_][a-z0-9_]*\s*\(/i.test(t) ||
    /^(i('| a)m going to |i will |let me )?call(ing)?\s+[a-z_][a-z0-9_]*\s*\(\s*\{/i.test(t) ||
    t.startsWith('TOOL RESULTS (system-generated')
  );
}

/**
 * Drive the Gemini function-calling loop.
 *
 * Hard guarantees (requirement #4): at most `maxIterations` model round-trips,
 * at most `budgetMs` wall clock, and it never rejects -- a gateway 4xx/5xx or a
 * throwing tool degrades into an `error` event plus a useful `reply`.
 *
 * @param callModel async ({contents, systemInstruction, tools}) =>
 *        { ok, status, json, headers, text, latencyMs, error }
 * @param executeTool async (functionCall, events) => tool response object
 * @param encodeToolTurn how tool results re-enter the transcript. Defaults to
 *        textToolTurn, because the gateway's request schema rejects the native
 *        functionCall/functionResponse parts -- see those functions.
 */
export async function runToolLoop({
  contents,
  systemInstruction = SYSTEM_INSTRUCTION,
  tools,
  callModel,
  executeTool,
  encodeToolTurn = textToolTurn,
  maxIterations = MAX_TOOL_ITERATIONS,
  budgetMs = TOOL_LOOP_BUDGET_MS,
  now = () => Date.now(),
}) {
  const events = [];
  const startedAt = now();
  let working = [...contents];
  let reply = '';
  // One-shot: we correct a narrated tool call once, then stop trying.
  let nudgedForNarration = false;
  let iterations = 0;
  let stopReason = 'iteration_cap';
  let totalTokens = 0;
  let costUsd = 0;
  let model = AGENT_MODEL;

  for (let i = 0; i < maxIterations; i += 1) {
    if (now() - startedAt >= budgetMs) {
      stopReason = 'time_budget';
      events.push({
        type: 'error',
        // Plain English: the admin does not care about our budget constant.
        message: 'That took longer than expected, so I stopped there. Anything already applied is listed above and can be reverted.',
      });
      break;
    }

    iterations += 1;
    let res;
    try {
      res = await callModel({ contents: working, systemInstruction, tools });
    } catch (err) {
      res = { ok: false, status: 0, error: err?.message || String(err) };
    }

    if (!res || !res.ok) {
      stopReason = 'model_error';
      events.push({ type: 'error', message: describeGatewayFailure(res) });
      break;
    }

    totalTokens += Number(res.json?.usageMetadata?.totalTokenCount) || 0;
    costUsd += Number.parseFloat(res.headers?.['x-gateway-cost-usd'] || '0') || 0;
    if (res.headers?.['x-gateway-model']) model = res.headers['x-gateway-model'];
    else if (res.model) model = res.model;

    const parts = res.json?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p && p.functionCall).map((p) => p.functionCall);
    const text = partsToText(parts);

    // An empty text part is normal on a pure tool-call turn; only a turn with
    // no function calls at all ends the loop.
    if (calls.length === 0) {
      // The model sometimes copies the shape of our synthetic tool-turn
      // stand-in and "answers" with `Calling get_product({...})`. That is
      // plumbing, not an answer. Push back once and let it try again rather
      // than showing it to the admin.
      if (looksLikeToolNarration(text) && !nudgedForNarration && iterations < maxIterations) {
        nudgedForNarration = true;
        working = [
          ...working,
          { role: 'model', parts: [{ text: '<<TOOL_CALL_ISSUED>>' }] },
          {
            role: 'user',
            parts: [{
              text:
                'SYSTEM CORRECTION (not typed by the admin): do not describe or ' +
                'narrate a tool call. Either issue the tool call, or answer the ' +
                "question in plain English using what you already have.",
            }],
          },
        ];
        continue;
      }
      reply = looksLikeToolNarration(text) ? reply : (text || reply);
      stopReason = 'complete';
      break;
    }
    if (text && !looksLikeToolNarration(text)) reply = text;

    const results = [];
    for (const call of calls) {
      let response;
      try {
        response = await executeTool(call, events);
      } catch (err) {
        // executeTool is expected to handle its own failures; this is the net.
        response = { error: err?.message || String(err) };
        events.push({ type: 'error', message: `Tool ${call?.name} failed: ${response.error}` });
      }
      results.push({ call, response });
    }
    working = [...working, ...encodeToolTurn({ modelParts: parts, calls, results })];
  }

  if (stopReason === 'iteration_cap') {
    events.push({
      type: 'error',
      message: `Stopped after the ${maxIterations}-tool-call limit for one turn. Ask a narrower follow-up to continue.`,
    });
  }

  if (!reply) reply = fallbackReply(stopReason, events);

  return {
    reply,
    events,
    iterations,
    stopReason,
    usage: {
      model,
      totalTokens,
      costUsd: Number(costUsd.toFixed(6)),
      latencyMs: now() - startedAt,
    },
  };
}

/** A useful answer even when the model never produced one. */
function fallbackReply(stopReason, events) {
  const toolLines = events
    .filter((e) => e.type === 'tool_call')
    .map((e) => `- ${e.summary}`)
    .join('\n');
  const errors = events.filter((e) => e.type === 'error').map((e) => e.message);
  const head =
    stopReason === 'model_error'
      ? "I couldn't complete that turn."
      : stopReason === 'time_budget'
        ? 'I ran out of time on that turn.'
        : stopReason === 'iteration_cap'
          ? 'I hit the tool-call limit before finishing.'
          : 'No answer was produced.';
  return [
    head,
    toolLines ? `Here is what I did get:\n${toolLines}` : '',
    errors.length ? errors.join(' ') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Map the contract's `messages` onto Gemini `contents`. */
export function messagesToContents(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AdminAgentError('"messages" must be a non-empty array.');
  }
  if (messages.length > 40) {
    throw new AdminAgentError('Conversation too long; start a new one.');
  }
  const contents = [];
  for (const m of messages) {
    const role = m?.role === 'assistant' ? 'model' : 'user';
    const text = typeof m?.content === 'string' ? m.content : '';
    if (!text.trim()) continue;
    contents.push({ role, parts: [{ text: text.slice(0, 8000) }] });
  }
  if (contents.length === 0) throw new AdminAgentError('No message content to send.');
  if (contents[contents.length - 1].role !== 'user') {
    throw new AdminAgentError('The last message must come from the user.');
  }
  return contents;
}

/** x-gateway-* response headers only -- the contract's TestResult.headers. */
export function pickGatewayHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase().startsWith('x-gateway-')) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/**
 * Parse x-gateway-guardrails ("armor-prompt=on;armor-response=off;semantic-cache=on")
 * into an object. null when the header is absent (older proxy revision).
 */
export function parseGuardrailHeader(value) {
  if (!value) return null;
  const out = {};
  for (const pair of String(value).split(';')) {
    const [k, v] = pair.split('=').map((s) => (s || '').trim());
    if (k) out[k] = v || 'on';
  }
  return out;
}

/** Build a contract-shaped TestResult from a raw gateway response. */
export function toTestResult({ status, json, text, headers, latencyMs, requestedModel, error }) {
  const h = pickGatewayHeaders(headers);
  const usage = json?.usageMetadata || json?.usage || {};
  const promptTokens = Number(
    usage.promptTokenCount ?? usage.input_tokens ?? h['x-gateway-prompt-tokens'] ?? 0
  );
  const candidatesTokens = Number(
    usage.candidatesTokenCount ?? usage.output_tokens ?? h['x-gateway-completion-tokens'] ?? 0
  );
  const totalTokens = Number(
    usage.totalTokenCount ?? usage.total_tokens ?? h['x-gateway-total-tokens'] ?? promptTokens + candidatesTokens
  );
  const ok = status >= 200 && status < 300;

  let answer = '';
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) answer = partsToText(parts);
  else if (Array.isArray(json?.content)) {
    answer = json.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
  }
  if (!ok || !answer) {
    answer =
      answer ||
      json?.fault?.faultstring ||
      json?.error?.message ||
      (error ? `Request failed: ${error}` : '') ||
      (typeof text === 'string' ? text.slice(0, 600) : '') ||
      '';
  }

  const guardrailBlocked = isModelArmorBlock(status, json, text);

  return {
    httpStatus: status || 0,
    ok,
    // Never fabricate a model: on a cache hit or a fault the gateway names none,
    // and echoing "auto" back would assert a model that was never chosen.
    model: h['x-gateway-model'] || (requestedModel && requestedModel !== 'auto' ? requestedModel : ''),
    latencyMs: Number(latencyMs) || 0,
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    candidatesTokens: Number.isFinite(candidatesTokens) ? candidatesTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    costUsd: Number.parseFloat(h['x-gateway-cost-usd'] || '0') || 0,
    cacheStatus: h['x-gateway-cache-status'] || (h['x-gateway-cached'] === 'true' ? 'HIT' : 'DISABLED'),
    guardrailBlocked,
    guardrails: parseGuardrailHeader(h['x-gateway-guardrails']),
    text: answer,
    headers: h,
  };
}
