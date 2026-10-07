// Demo data reset, shared by ui/server.js and the Vite dev middleware.
//
// The Customer Service API (Cloud Run, private) keeps its demo data in memory, and MCP
// calls change it: a $30 goodwill refund lowers the refundable balance on ORD-1042 and a
// support case adds a row. POST /api/demo/reset restores the seed data so each demo starts
// from the same state. The UI calls it when the guided demo starts and from the MCP tab.
//
// The backend's /admin/reset is not exposed through Apigee; it is called directly with a
// Google ID token for the backend's URL (Cloud Run IAM: the UI's service account needs
// roles/run.invoker on customer-service-api).

import { execSync } from 'node:child_process';
import { INDUSTRY_APIS_URL as CLOUD_RUN_INDUSTRY_APIS_URL, CUSTOMER_SERVICE_API_URL } from './deployConfig.js';

// industry-apis (industry packs): a local instance in dev (VITE_INDUSTRY_APIS_LOCAL), else the
// Cloud Run service (apigee-ui-mgmt-sa holds roles/run.invoker on it).
const INDUSTRY_APIS_URL = process.env.VITE_INDUSTRY_APIS_LOCAL || CLOUD_RUN_INDUSTRY_APIS_URL;

export const DEMO_RESET_TARGETS = [
  {
    name: 'customer-service-api',
    url: CUSTOMER_SERVICE_API_URL,
  },
  ...(INDUSTRY_APIS_URL ? [{ name: 'industry-apis', url: INDUSTRY_APIS_URL.replace(/\/+$/, '') }] : []),
];

/**
 * Google ID token for a Cloud Run audience. On Cloud Run the metadata server mints it for
 * the service account; locally it falls back to the gcloud user's identity token.
 */
export async function getIdentityToken(audience, { fetchImpl = fetch, execImpl = execSync } = {}) {
  try {
    const r = await fetchImpl(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (r.ok) {
      const t = (await r.text()).trim();
      if (t) return t;
    }
  } catch {
    // Not on Cloud Run / GCE.
  }
  try {
    const t = String(execImpl('gcloud auth print-identity-token 2>/dev/null')).trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Resets every target; resolves to { ok, results: [{ name, ok, status, error? }] }. */
export async function resetDemoData({ targets = DEMO_RESET_TARGETS, getToken = getIdentityToken, fetchImpl = fetch } = {}) {
  const results = await Promise.all(
    targets.map(async ({ name, url }) => {
      const token = await getToken(url, { fetchImpl });
      if (!token) return { name, ok: false, status: 0, error: 'No identity token' };
      try {
        const r = await fetchImpl(`${url}/admin/reset`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        return r.ok ? { name, ok: true, status: r.status } : { name, ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
      } catch (e) {
        return { name, ok: false, status: 0, error: e.message };
      }
    }),
  );
  return { ok: results.every((r) => r.ok), results };
}

/** HTTP handler for POST /api/demo/reset. */
export async function handleDemoReset(req, res, deps = {}) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  const out = await resetDemoData(deps);
  res.statusCode = out.ok ? 200 : 502;
  res.end(JSON.stringify(out));
}
