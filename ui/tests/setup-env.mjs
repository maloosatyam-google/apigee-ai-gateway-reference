// Loaded with `node --import ./tests/setup-env.mjs --test ...` by the unit-test scripts.
// Unit tests never read a developer's .env: they run against these fixed example
// values, so the suite gives the same result in every clone.
const FIXTURE = {
  DEPLOY_CONFIG_NO_DOTENV: '1',
  GCP_PROJECT_ID: 'demo-project',
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_REGION: 'asia-southeast1',
  APIGEE_ORG: 'demo-project',
  APIGEE_HOST_PROD: 'api.example.com',
  APIGEE_HOST_DEV: 'dev.api.example.com',
  SSO_USER_EMAIL: 'admin@example.com',
  DEMO_ADMIN_EMAIL: 'admin@example.com',
  PERSONA_APP_DEVELOPER: 'persona.owner@example.com',
  CUSTOMER_SERVICE_API_URL: 'https://customer-service-api-123456789012.asia-southeast1.run.app',
  INDUSTRY_APIS_URL: 'https://industry-apis-123456789012.asia-southeast1.run.app',
  AGENT_SHOWCASE_URL: 'https://agent-showcase-api-123456789012.asia-southeast1.run.app',
};
for (const [k, v] of Object.entries(FIXTURE)) process.env[k] = v;
for (const k of ['VITE_SSO_USER_EMAIL', 'THEME_BUCKET', 'VITE_INDUSTRY_APIS_LOCAL', 'INDUSTRY_APIS_LOCAL']) delete process.env[k];
