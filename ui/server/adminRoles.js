/**
 * Admin personas: who *governs* the gateway in the Admin Console.
 *
 * The consumer personas (personas.js) decide which API key signs a call. These
 * decide which Admin Console controls a user may change. It is a demo role
 * switcher, not authorization: the console hides tabs and sections a role does
 * not own, and Ask Apigee refuses changes outside the role. Prod stays
 * read-only for every role (consoleEnv.js).
 *
 * Client mirror: ui/src/utils/adminRoles.js (the server cannot import from src/).
 * tests/adminroles.unit.test.mjs keeps the two equal.
 */

/**
 * Capabilities, i.e. the things a role can change.
 *   models      which models each persona product entitles
 *   quota       token quotas per model (capacity and fair use)
 *   routing     the auto-routing model per category
 *   guardrails  Model Armor / guardrail policies
 *   budget      the monthly budget on each persona product
 *   wallet      developer prepaid wallets (top-ups, billing config)
 *   pricing     the model rate card
 *   rate_plans  rate plans and subscriptions
 *   custom      free-form product attributes
 *   reset       re-cloning Prod into the Dev sandbox
 */
export const CAPABILITIES = [
  'models', 'quota', 'routing', 'guardrails',
  'budget', 'wallet', 'pricing', 'rate_plans',
  'custom', 'reset',
];

export const ADMIN_ROLES = [
  {
    id: 'platform',
    label: 'Platform Admin',
    short: 'Platform',
    summary: 'Full access: cost, models, routing and guardrails',
    capabilities: [...CAPABILITIES],
  },
  {
    id: 'finance',
    label: 'Finance',
    short: 'Finance',
    summary: 'Budgets, wallets, model pricing and rate plans',
    capabilities: ['budget', 'wallet', 'pricing', 'rate_plans'],
  },
  {
    id: 'ai_coe',
    label: 'AI CoE',
    short: 'AI CoE',
    summary: 'Which teams get which models, auto-routing, quotas and guardrails',
    capabilities: ['models', 'quota', 'routing', 'guardrails'],
  },
];

export const DEFAULT_ADMIN_ROLE = 'platform';

export function adminRoleById(id) {
  return ADMIN_ROLES.find((r) => r.id === id) || ADMIN_ROLES[0];
}

export function isAdminRole(id) {
  return ADMIN_ROLES.some((r) => r.id === id);
}

export function roleCan(roleId, capability) {
  return adminRoleById(roleId).capabilities.includes(capability);
}

/**
 * Admin Console sub-tabs and product config sections, and the capabilities that
 * make each one visible. A role sees a tab only if it owns at least one of its
 * capabilities; everything else is hidden (Platform Admin sees all).
 */
export const TAB_CAPABILITIES = {
  products: ['models', 'quota', 'routing', 'budget', 'custom'],
  wallets: ['wallet'],
  'rate-cards': ['pricing'],
  'rate-plans': ['rate_plans'],
  policies: ['guardrails'],
};

export const SECTION_CAPABILITIES = {
  models: ['models', 'quota'],
  routing: ['routing'],
  budget: ['budget'],
  custom: ['custom'],
};

export function roleCanSeeTab(roleId, tab) {
  return (TAB_CAPABILITIES[tab] || []).some((c) => roleCan(roleId, c));
}

export function roleCanSeeSection(roleId, section) {
  return (SECTION_CAPABILITIES[section] || []).some((c) => roleCan(roleId, c));
}

/** Label of the narrowest non-platform role that owns a capability, e.g. "Finance". */
export function ownerLabel(capability) {
  const owner = ADMIN_ROLES.find((r) => r.id !== 'platform' && r.capabilities.includes(capability));
  return owner ? owner.label : ADMIN_ROLES[0].label;
}

/**
 * Capability needed for one Ask Apigee change descriptor (see parseChangePath
 * in adminAgentCore.js): budget attributes are Finance's, routing attributes and
 * token quotas are the AI CoE's. `access` and `environments` change who can use
 * a product, so they count as model entitlement.
 */
export function capabilityForChange(descriptor) {
  if (descriptor?.kind === 'quota') return 'quota';
  if (descriptor?.kind === 'attribute') {
    const a = String(descriptor.attribute || '');
    if (a.startsWith('developer.budget.')) return 'budget';
    if (a.startsWith('routing.model.')) return 'routing';
    if (a.startsWith('guardrail.')) return 'guardrails';
    return 'models';
  }
  return 'models';
}
