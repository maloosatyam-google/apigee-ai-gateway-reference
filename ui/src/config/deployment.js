// Deployment values for the browser bundle (plain JS so Node unit tests can import it).
//
// Nothing environment-specific is compiled into the build. The server publishes the
// values in /env-config.js (window.__RUNTIME_CONFIG__, see ui/server/deployConfig.js),
// which index.html loads before the app. Under Node (unit tests) it falls back to
// process.env and then to neutral example values.
function source() {
  const g = globalThis;
  return { ...((g.process && g.process.env) || {}), ...(g.__RUNTIME_CONFIG__ || {}) };
}

const read = (key, fallback) => {
  const v = source()[key];
  return v !== undefined && v !== '' ? v : fallback;
};
const stripScheme = (h) => String(h).replace(/^https?:\/\//, '').replace(/\/+$/, '');

export const GCP_PROJECT_ID = read('GCP_PROJECT_ID', read('APIGEE_ORG', 'your-gcp-project'));
export const APIGEE_ORG = read('APIGEE_ORG', GCP_PROJECT_ID);
export const APIGEE_HOST_PROD = stripScheme(read('APIGEE_HOST_PROD', 'api.example.com'));
export const APIGEE_HOST_DEV = stripScheme(read('APIGEE_HOST_DEV', APIGEE_HOST_PROD));
export const APIGEE_BASE_PROD = `https://${APIGEE_HOST_PROD}`;
export const APIGEE_BASE_DEV = `https://${APIGEE_HOST_DEV}`;
export const AI_BASE_PROD = `${APIGEE_BASE_PROD}/ai/v1`;
export const AI_BASE_DEV = `${APIGEE_BASE_DEV}/ai/v1`;
export const MCP_BASE_PROD = `${APIGEE_BASE_PROD}/mcp`;
export const MCP_BASE_DEV = `${APIGEE_BASE_DEV}/mcp`;
export const apigeeBase = (env) => (env === 'dev' ? APIGEE_BASE_DEV : APIGEE_BASE_PROD);
