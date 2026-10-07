/**
 * Persona API products: the single server-side source of truth.
 *
 * The demo used to have two generic tiers ("Enterprise AI Tier" / "Standard AI
 * Tier"). They were replaced by one product per persona so the AI Gateway can be
 * shown behaving differently for different kinds of users.
 *
 * Apigee rejects "&" and parentheses in an API product `name`, so the resource
 * id spells "and" while `displayName` (what the UI shows) uses "&". Each live
 * product is bound to `prod` only; its Ask Apigee sandbox clone ("<name> Dev")
 * is bound to `dev` only.
 *
 * `id` is the activeUser key the UI and /api/me already use for the three
 * persona credentials, so it is deliberately unchanged.
 *
 * Server code cannot import from src/ (the Docker image ships dist/ and
 * server/ only); the client keeps an equal copy in src/utils/personas.js and a
 * unit test holds the two together.
 */

export const PERSONAS = [
  {
    id: 'admin',
    label: 'Engineering & IT',
    product: 'Engineering and IT',
    mcpProduct: 'Enterprise Tools MCP',
    summary: 'Every model, incl. Claude Opus & Gemini Pro',
  },
  {
    id: 'loans_agent',
    label: 'Analysts & Knowledge Workers',
    product: 'Analysts and Knowledge Workers',
    mcpProduct: 'Business Insights Tools MCP',
    summary: 'Gemini Pro & Flash family, no Claude',
  },
  {
    id: 'sales_agent',
    label: 'Customer Support & Sales',
    product: 'Customer Support and Sales',
    mcpProduct: 'Customer Service Tools MCP',
    summary: 'Fast, low-cost models; Pro only for hard questions',
  },
];

/** Live (prod) persona products, in display order. */
export const PERSONA_PRODUCTS = PERSONAS.map((p) => p.product);

/** The product every signed-in admin's own app is bound to. */
export const ADMIN_PERSONA_PRODUCT = PERSONAS[0].product;

/** Retired generic tiers. Kept only so self-heal code can detach them. */
export const LEGACY_AI_PRODUCTS = ['Enterprise AI Tier', 'Standard AI Tier'];

/** Display label for a product name (live or dev), falling back to the name. */
export function personaLabelForProduct(productName) {
  const name = String(productName || '').replace(/ Dev$/, '').replace(/ \(Dev\)$/, '');
  const hit = PERSONAS.find((p) => p.product === name);
  return hit ? hit.label : String(productName || '');
}

/**
 * Persona label for a developer, from the names of the apps they own. Admin
 * apps win (their owner is an Engineering & IT user even if they also own the
 * shared persona apps); otherwise the Loans app means Analysts, else Sales.
 */
export function personaTierForApps(appNames = []) {
  const names = appNames.map((a) => String(a).toLowerCase());
  if (names.some((a) => a.includes('admin') || a.includes('enterprise'))) return PERSONAS[0].label;
  if (names.some((a) => a.includes('loans'))) return PERSONAS[1].label;
  return PERSONAS[2].label;
}
