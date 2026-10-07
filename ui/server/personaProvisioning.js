/**
 * Keeps a signed-in admin's own "Unified Admin <handle> App" on the right
 * persona product, and detaches the retired generic tiers.
 *
 * Shared by server.js and vite.config.ts. Products on an existing app are
 * changed through its credential (keys API): Apigee ignores `apiProducts` on an
 * app PUT, so that route can neither add nor remove a product.
 */
import { ADMIN_PERSONA_PRODUCT, LEGACY_AI_PRODUCTS, PERSONA_PRODUCTS, PERSONAS } from './personas.js';
import { INDUSTRY_ADMIN_PRODUCTS } from './industryAdminProducts.js';
import { DEMO_ADMIN_EMAIL } from './deployConfig.js';

/** The Agent Showcase baseline agent calls /passthrough/v1 with the admin key. */
export const LLM_PASSTHROUGH_PRODUCT = 'LLM Passthrough';

export const ADMIN_APP_PRODUCTS = [ADMIN_PERSONA_PRODUCT, PERSONAS[0].mcpProduct, LLM_PASSTHROUGH_PRODUCT, ...INDUSTRY_ADMIN_PRODUCTS];

/** Pure: what to add to / remove from a credential that has `existing` products. */
export function planAdminAppProducts(existing = []) {
  const have = new Set(existing);
  return {
    add: ADMIN_APP_PRODUCTS.filter((p) => !have.has(p)),
    remove: LEGACY_AI_PRODUCTS.filter((p) => have.has(p)),
  };
}

/** Pure: persona products a developer must hold a monetization subscription to. */
export function requiredSubscriptionsFor(email) {
  // The demo owner also owns the shared persona apps, so needs every product.
  return String(email || '').toLowerCase() === DEMO_ADMIN_EMAIL.toLowerCase()
    ? [...PERSONA_PRODUCTS]
    : [ADMIN_PERSONA_PRODUCT];
}

/**
 * Apply planAdminAppProducts to the app's approved credential.
 * Adds first, then removes, so the key is never left without an AI product.
 * Best-effort: failures are logged, not thrown, so /api/me still answers.
 */
export async function syncAdminAppProducts({ org, token, email, app, fetchImpl = fetch, log = console }) {
  const cred = (app?.credentials || []).find((c) => c.status === 'approved') || app?.credentials?.[0];
  if (!cred?.consumerKey) return { add: [], remove: [] };
  const plan = planAdminAppProducts((cred.apiProducts || []).map((p) => p.apiproduct));
  if (!plan.add.length && !plan.remove.length) return plan;

  const keyUrl =
    `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}` +
    `/apps/${encodeURIComponent(app.name)}/keys/${encodeURIComponent(cred.consumerKey)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    if (plan.add.length) {
      log.log?.(`[Server] Attaching ${plan.add.join(', ')} to ${app.name}`);
      await fetchImpl(keyUrl, { method: 'POST', headers, body: JSON.stringify({ apiProducts: plan.add }) });
    }
    for (const product of plan.remove) {
      log.log?.(`[Server] Detaching retired ${product} from ${app.name}`);
      await fetchImpl(`${keyUrl}/apiproducts/${encodeURIComponent(product)}`, { method: 'DELETE', headers });
    }
  } catch (err) {
    log.warn?.(`[Server] Could not sync products on ${app.name}: ${err?.message || err}`);
  }
  return plan;
}
