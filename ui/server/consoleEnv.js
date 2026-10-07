/**
 * Admin Console environment rules, shared by server.js and vite.config.ts.
 *
 * The console shows two views of the AI products:
 *   - Prod: the live persona products ("Engineering and IT", ...). READ-ONLY.
 *   - Dev:  the sandbox clones Ask Apigee edits ("Engineering and IT Dev", ...).
 *
 * Prod is read-only for every console write (products, product reset, rate card).
 * Changes reach prod through Git: make them in Dev, commit them to the repo, raise
 * a pull request, and prod is updated after the PR is reviewed and merged. The UI
 * shows the same message, but this module is the enforcement point: a request
 * with no or an unknown env is treated as prod and refused.
 */
import { buildDevClone, APIGEE_DEV_SUFFIX } from './adminAgentCore.js';
import { PERSONA_PRODUCTS } from './personas.js';
import { APIGEE_ORG } from './deployConfig.js';

export const ORG = APIGEE_ORG;

export const PROD_READ_ONLY_MESSAGE =
  'Production is read-only. Changes reach prod through Git: make them in Dev, commit them to the ' +
  'repo, and raise a pull request. Prod is updated after the PR is reviewed and merged.';

/** Console tiers (one per persona), in logical (live) names. */
export const CONSOLE_TIERS = [...PERSONA_PRODUCTS];

/**
 * 'dev' | 'prod'. Anything missing or unrecognised falls back to `fallback`, which
 * defaults to 'prod' so an under-specified write lands on the read-only side.
 */
export function normalizeConsoleEnv(value, fallback = 'prod') {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'dev' || v === 'bap') return 'dev';
  if (v === 'prod') return 'prod';
  return fallback;
}

/** Apigee resource name for a console tier in an environment view. */
export function apigeeNameForTier(tier, env) {
  if (!CONSOLE_TIERS.includes(tier)) throw new Error(`Unknown tier "${tier}"`);
  return env === 'dev' ? `${tier}${APIGEE_DEV_SUFFIX}` : tier;
}

/** null if the write may proceed, otherwise the HTTP error to return. */
export function consoleWriteGuard(env) {
  if (env === 'prod') {
    return { status: 403, body: { error: PROD_READ_ONLY_MESSAGE, code: 'prod_read_only' } };
  }
  return null;
}

/**
 * Present an Apigee product to the console under its logical tier name, so the
 * UI keys Dev and Prod the same way. `apigeeName` keeps the real resource id.
 */
export function toConsoleProduct(apigeeProduct, tier, env) {
  return { ...apigeeProduct, name: tier, apigeeName: apigeeProduct?.name || apigeeNameForTier(tier, env), env };
}

/** Inverse of toConsoleProduct for a write: real resource name, no console-only fields. */
export function toApigeeProduct(consoleProduct, tier, env) {
  const out = { ...(consoleProduct || {}) };
  delete out.createdAt;
  delete out.lastModifiedAt;
  delete out.apigeeName;
  delete out.env;
  out.name = apigeeNameForTier(tier, env);
  if (env === 'dev') {
    // A dev clone must never be attached to prod, whatever the client sent.
    out.environments = ['dev'];
  }
  return out;
}

const productUrl = (name) =>
  `https://apigee.googleapis.com/v1/organizations/${ORG}/apiproducts/${encodeURIComponent(name)}`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function getProduct(token, name) {
  try {
    const r = await fetch(productUrl(name), { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return await r.json();
  } catch { /* fall through */ }
  return null;
}

/** PUT, or create with POST if the product doesn't exist yet (dev clone on first use). */
async function upsertProduct(token, product) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let r = await fetch(productUrl(product.name), { method: 'PUT', headers, body: JSON.stringify(product) });
  if (r.status === 404) {
    r = await fetch(`https://apigee.googleapis.com/v1/organizations/${ORG}/apiproducts`, {
      method: 'POST', headers, body: JSON.stringify(product),
    });
  }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/**
 * GET  /api/products?env=dev|prod   -> both tiers for that view
 * PUT  /api/products?env=dev        -> save one tier (body {name, product[, env]}); prod is refused
 */
export async function handleConsoleProducts(req, res, { parsedUrl, getToken, defaultProducts }) {
  const token = await getToken();
  if (!token) return send(res, 500, { error: 'Could not obtain GCP access token' });

  if (req.method === 'GET') {
    const env = normalizeConsoleEnv(parsedUrl.searchParams.get('env'));
    const products = await Promise.all(
      CONSOLE_TIERS.map(async (tier) => {
        const live = await getProduct(token, apigeeNameForTier(tier, env));
        if (live) return toConsoleProduct(live, tier, env);
        // Missing dev clone: show what it would be (a copy of prod) and say so.
        const base = env === 'dev'
          ? (await getProduct(token, tier)) || defaultProducts[tier]
          : defaultProducts[tier];
        const fallback = env === 'dev' ? buildDevClone({ ...base, name: tier }) : JSON.parse(JSON.stringify(base));
        return { ...toConsoleProduct(fallback, tier, env), missing: true };
      })
    );
    return send(res, 200, { status: 'ok', env, products, defaults: defaultProducts });
  }

  if (req.method === 'PUT') {
    let payload;
    try { payload = await readJson(req); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
    const env = normalizeConsoleEnv(parsedUrl.searchParams.get('env') ?? payload.env);
    const guard = consoleWriteGuard(env);
    if (guard) return send(res, guard.status, guard.body);
    const tier = payload.name;
    if (!CONSOLE_TIERS.includes(tier)) {
      return send(res, 400, { error: `Only ${CONSOLE_TIERS.join(' and ')} can be modified` });
    }
    const result = await upsertProduct(token, toApigeeProduct(payload.product, tier, env));
    return send(res, result.status, {
      status: result.ok ? 'ok' : 'error',
      product: result.ok ? toConsoleProduct(result.data, tier, env) : result.data,
      ...(result.ok ? {} : { error: result.data?.error?.message || `Apigee returned ${result.status}` }),
    });
  }

  return send(res, 405, { error: 'Method Not Allowed' });
}

/**
 * POST /api/products/reset?env=dev  body {name: tier|'all'}
 * Dev reset = re-clone the current prod tier into the dev sandbox ("match prod").
 * Prod is refused (prod follows git, not a console button).
 */
export async function handleConsoleProductsReset(req, res, { parsedUrl, getToken, defaultProducts }) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });
  let payload;
  try { payload = await readJson(req); } catch { return send(res, 400, { error: 'Invalid JSON body' }); }
  const env = normalizeConsoleEnv(parsedUrl.searchParams.get('env') ?? payload.env);
  const guard = consoleWriteGuard(env);
  if (guard) return send(res, guard.status, guard.body);

  const tiers = payload.name === 'all' ? CONSOLE_TIERS : CONSOLE_TIERS.filter((t) => t === payload.name);
  if (tiers.length === 0) return send(res, 400, { error: 'Invalid product name to reset' });

  const token = await getToken();
  if (!token) return send(res, 500, { error: 'Could not obtain GCP access token' });

  const results = await Promise.all(
    tiers.map(async (tier) => {
      const live = (await getProduct(token, tier)) || defaultProducts[tier];
      const clone = buildDevClone({ ...live, name: tier });
      const r = await upsertProduct(token, clone);
      return { name: tier, ok: r.ok, data: r.data };
    })
  );
  const allOk = results.every((r) => r.ok);
  return send(res, allOk ? 200 : 500, {
    status: allOk ? 'ok' : 'error',
    message: allOk ? 'Dev products now match prod' : 'Failed to reset one or more dev products',
    results,
    defaults: defaultProducts,
  });
}
