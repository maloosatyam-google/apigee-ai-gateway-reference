// Deployment configuration for the UI server (server.js, vite.config.ts, server/*).
//
// Every environment-specific value -- GCP project, Apigee org and hostnames, service
// accounts, demo identities, backend URLs -- is read from the environment here and
// nowhere else. Locally the values come from the repo-root .env (see .env.example);
// on Cloud Run they are set as service env vars by ui/scripts/deploy_prod.sh.
//
// The browser gets the public subset through /env-config.js (publicRuntimeConfig()).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Load the repo-root .env (and ui/.env) without overriding variables that are
// already set, so `FOO=x node server.js` and Cloud Run env vars always win.
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawVal.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.DEPLOY_CONFIG_NO_DOTENV) {
  loadDotEnv(path.resolve(HERE, '..', '.env'));
  loadDotEnv(path.resolve(HERE, '..', '..', '.env'));
}

const env = (key, fallback = '') => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
};
const stripScheme = (h) => String(h || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** GCP project that hosts Apigee, Vertex AI, Model Armor and the Cloud Run services. */
export const GCP_PROJECT_ID = env('GCP_PROJECT_ID', env('GCP_PROJECT', env('APIGEE_ORG', 'your-gcp-project')));
export const GCP_PROJECT_NUMBER = env('GCP_PROJECT_NUMBER', '');
export const GCP_REGION = env('GCP_REGION', 'asia-southeast1');
/** Apigee organization (normally the same as the project ID). */
export const APIGEE_ORG = env('APIGEE_ORG', GCP_PROJECT_ID);

/** Hostname of the prod environment group, e.g. api.example.com. */
export const APIGEE_HOST_PROD = stripScheme(env('APIGEE_HOST_PROD', 'api.example.com'));
/** Hostname of the dev environment group, e.g. dev.api.example.com. */
export const APIGEE_HOST_DEV = stripScheme(env('APIGEE_HOST_DEV', APIGEE_HOST_PROD));
export const APIGEE_BASE_PROD = `https://${APIGEE_HOST_PROD}`;
export const APIGEE_BASE_DEV = `https://${APIGEE_HOST_DEV}`;
export const AI_BASE_PROD = `${APIGEE_BASE_PROD}/ai/v1`;
export const AI_BASE_DEV = `${APIGEE_BASE_DEV}/ai/v1`;
export const apigeeBase = (environment) => (environment === 'dev' ? APIGEE_BASE_DEV : APIGEE_BASE_PROD);

/** Default signed-in user when no IAP header is present (local dev). */
export const SSO_USER_EMAIL = env('SSO_USER_EMAIL', env('VITE_SSO_USER_EMAIL', env('DEMO_ADMIN_EMAIL', 'admin@example.com')));
/** The demo owner: Apigee developer of the admin app, platform-admin in the UI. */
export const DEMO_ADMIN_EMAIL = env('DEMO_ADMIN_EMAIL', SSO_USER_EMAIL);
/** Apigee developer that owns the shared persona apps (Unified Sales / Loans App). */
export const PERSONA_APP_DEVELOPER = env('PERSONA_APP_DEVELOPER', DEMO_ADMIN_EMAIL);
/** Developers searched (in order) for the shared persona apps. */
export const PERSONA_APP_DEVELOPERS = [...new Set([PERSONA_APP_DEVELOPER, DEMO_ADMIN_EMAIL].filter(Boolean))];

/** Service account the UI impersonates for Apigee management calls. */
export const UI_MGMT_SA = env('UI_MGMT_SA', `apigee-ui-mgmt-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com`);

const runUrl = (service) =>
  GCP_PROJECT_NUMBER ? `https://${service}-${GCP_PROJECT_NUMBER}.${GCP_REGION}.run.app` : '';
export const INDUSTRY_APIS_URL = env('INDUSTRY_APIS_URL', runUrl('industry-apis'));
export const CUSTOMER_SERVICE_API_URL = env('CUSTOMER_SERVICE_API_URL', runUrl('customer-service-api'));
export const AGENT_SHOWCASE_URL = env('AGENT_SHOWCASE_URL', runUrl('agent-showcase-api'));
export const THEME_BUCKET = env('THEME_BUCKET', `${GCP_PROJECT_ID}-customer-themes`);

/** Values the browser needs. Served as window.__RUNTIME_CONFIG__ by /env-config.js. */
export function publicRuntimeConfig(overrides = {}) {
  return {
    ADMIN_USER_EMAIL: env('ADMIN_USER_EMAIL', 'admin.user@example.com'),
    SALES_AGENT_EMAIL: env('SALES_AGENT_EMAIL', 'sales.agent@example.com'),
    LOANS_AGENT_EMAIL: env('LOANS_AGENT_EMAIL', 'loans.agent@example.com'),
    SSO_USER_EMAIL,
    DEFAULT_ENV: env('DEFAULT_ENV', 'prod'),
    GCP_PROJECT_ID,
    APIGEE_ORG,
    APIGEE_HOST_PROD,
    APIGEE_HOST_DEV,
    ...overrides,
  };
}
