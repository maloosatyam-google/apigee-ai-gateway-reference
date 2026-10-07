import { APIGEE_BASE_PROD, APIGEE_BASE_DEV } from './deployConfig.js';
// UI-server route for industry pack MCP proxies, shared by server.js and the Vite dev server.
//
//   /api/industry-mcp-<dev|prod>/<id>  ->  <Apigee host>/<id>/mcp   (proxy <id>-mcp)
//
// Dev only: INDUSTRY_APIS_LOCAL (or VITE_INDUSTRY_APIS_LOCAL), e.g. http://localhost:8091,
// sends the calls to a local industry-apis instead, with no gateway in between.

export const APIGEE_HOSTS = {
  dev: APIGEE_BASE_DEV,
  prod: APIGEE_BASE_PROD,
};

/** Upstream URL for a UI-server path, or null if the path is not an industry MCP route. */
export function industryMcpUpstream(pathname, localUrl = '') {
  const m = /^\/api\/industry-mcp-(dev|prod)\/([a-z][a-z0-9-]*)\/?$/.exec(pathname || '');
  if (!m) return null;
  const [, env, id] = m;
  return localUrl ? `${localUrl.replace(/\/+$/, '')}/${id}/mcp` : `${APIGEE_HOSTS[env]}/${id}/mcp`;
}
