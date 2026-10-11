import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAdminAgentService } from './server/adminAgentService.js';
import { createAgentShowcaseService } from './server/agentShowcase.js';
import { createThemeLibraryService, THEME_BUCKET } from './server/themeLibrary.js';
import { createModelWatchService } from './server/modelWatch.js';
import { handleReloadHint } from './server/reloadHint.js';
import { mintSyntheticIdentityToken } from './server/adminAgentCore.js';
import { applyLedgerToBalance, fetchApigeeWallet, recordDebit } from './server/walletLedger.js';
import { buildToolsAnalytics, toolsStatsUrl } from './server/toolsAnalytics.js';
import { handleToolLogs } from './server/toolLogs.js';
import { handleAgentAnalytics } from './server/agentAnalytics.js';
import { handleDemoReset } from './server/demoReset.js';
import { industryMcpUpstream } from './server/industryMcp.js';
import { DEFAULT_PRODUCTS } from './server/defaultProducts.js';
import { PERSONA_PRODUCTS, personaTierForApps } from './server/personas.js';
import { ADMIN_APP_PRODUCTS, requiredSubscriptionsFor, syncAdminAppProducts } from './server/personaProvisioning.js';
import { handleConsoleProducts, handleConsoleProductsReset, normalizeConsoleEnv, consoleWriteGuard } from './server/consoleEnv.js';
import { GCP_PROJECT_ID, APIGEE_ORG, APIGEE_BASE_PROD, APIGEE_BASE_DEV, SSO_USER_EMAIL, DEMO_ADMIN_EMAIL, PERSONA_APP_DEVELOPERS, UI_MGMT_SA, publicRuntimeConfig } from './server/deployConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');

// Load environment variables from .env if present.
//
// This file is also read by `node --env-file=.env` (see the test:live and
// test:all scripts in package.json), so this parser MUST agree with Node's
// own. Node treats a matching pair of surrounding quotes as delimiters and
// strips them; without the same handling here, SSO_USER_EMAIL="a@b.com" was
// read literally as `"a@b.com"` quotes and all. That propagated into the JWT
// and the Apigee developer lookup, which 404'd and pushed an already
// provisioned developer into the first-time onboarding modal.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();
      const quote = val[0];
      if (
        val.length >= 2 &&
        (quote === '"' || quote === "'" || quote === '`') &&
        val[val.length - 1] === quote
      ) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const PORT = process.env.PORT || 8080;

// Demo constant: every new developer is provisioned a prepaid wallet with this starting
// balance (see /api/me/onboard). It is NOT the gateway's budget cap - that is enforced by
// QC-EnforceBudgetLimit / RF-BudgetExceeded with the per-product developer.budget.limit
// attribute ($20 / $10 / $5 a month for Engineering & IT / Analysts / Support & Sales). The
// two are unrelated on purpose: this one is the wallet Apigee Monetization debits, the other
// is the quota counter. apigee/scripts/provision_unified_credentials.py credits the same $20.
const PREPAID_STARTING_BALANCE_USD = 20;
// Tolerance for "the wallet has not been spent from yet". Monetization reports the balance
// with sub-cent precision, so an untouched wallet can read fractionally above the credited
// amount; comparing for exact equality would misclassify it as partially spent.
const PREPAID_BALANCE_EPSILON_USD = 0.05;

/**
 * The denominator behind the "spent X of Y" reading in the Monetization tab.
 *
 * An untouched wallet still shows the starting balance. Once spending begins, the original
 * allocation is reconstructed as balance + consumed, because Monetization exposes the
 * remaining balance rather than the credited total. With no wallet at all there is nothing
 * to reconstruct from, so the default allocation is reported.
 */
function allocatedBudgetFor(hasWallet, balanceUsd, consumedUsd) {
  if (hasWallet && balanceUsd <= PREPAID_STARTING_BALANCE_USD + PREPAID_BALANCE_EPSILON_USD) {
    return PREPAID_STARTING_BALANCE_USD;
  }
  if (balanceUsd > 0) {
    return Number((balanceUsd + consumedUsd).toFixed(2));
  }
  return PREPAID_STARTING_BALANCE_USD;
}

// Canonical persona product definitions live in server/defaultProducts.js (mirrors apigee/products).

// In-memory token cache for Apigee Management API
let cachedToken = '';
let tokenExpiry = 0;

// Real-time session debit ledger per developer email to bridge Apigee's 15-min Analytics settlement window
// Map<emailLowerCase, { debitedUsd: number, lastCreditTimeSeen: string }>
const sessionLedgerByDev = new Map();

async function getGcpAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  // 1. Optional explicit GOOGLE_APPLICATION_CREDENTIALS (never use repo-local key files)
  const keyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean);

  for (const keyPath of keyPaths) {
    if (fs.existsSync(keyPath)) {
      try {
        const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        if (keyData.client_email && keyData.private_key) {
          const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
          const nowSec = Math.floor(Date.now() / 1000);
          const payload = Buffer.from(
            JSON.stringify({
              iss: keyData.client_email,
              scope: 'https://www.googleapis.com/auth/cloud-platform',
              aud: 'https://oauth2.googleapis.com/token',
              exp: nowSec + 3600,
              iat: nowSec,
            })
          ).toString('base64url');

          const signer = crypto.createSign('RSA-SHA256');
          signer.update(`${header}.${payload}`);
          const signature = signer.sign(keyData.private_key, 'base64url');
          const jwt = `${header}.${payload}.${signature}`;

          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion: jwt,
            }),
          });

          if (tokenRes.ok) {
            const data = await tokenRes.json();
            if (data.access_token) {
              cachedToken = data.access_token;
              tokenExpiry = now + 50 * 60 * 1000;
              return cachedToken;
            }
          }
        }
      } catch (err) {
        console.warn(`[Server] SA key auth error at ${keyPath}:`, err.message);
      }
    }
  }

  // 2. Query Cloud Run / Compute Metadata Server
  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      if (metaData.access_token) {
        cachedToken = metaData.access_token;
        const expiresInSec = metaData.expires_in || 3600;
        tokenExpiry = now + Math.max(300, expiresInSec - 300) * 1000;
        return cachedToken;
      }
    }
  } catch {
    // Not running on Cloud Run / GCE
  }

  // 3. Fallback to gcloud
  try {
    try {
      cachedToken = execSync(
        `gcloud auth print-access-token --impersonate-service-account=${UI_MGMT_SA} 2>/dev/null`
      )
        .toString()
        .trim();
    } catch {
      cachedToken = execSync('gcloud auth print-access-token').toString().trim();
    }
    tokenExpiry = now + 4 * 60 * 1000;
    return cachedToken;
  } catch (err) {
    console.error('[Server] Failed to get gcloud auth token:', err.message);
    return '';
  }
}

async function fetchAppConsumerKey(org, token, devEmail, appName) {
  try {
    const res = await fetch(
      `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(devEmail)}/apps/${encodeURIComponent(appName)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const cred = data.credentials?.find((c) => c.status === 'approved') || data.credentials?.[0];
      return cred?.consumerKey || '';
    }
  } catch (err) {
    console.warn(`[Server] Failed to fetch key for ${appName}:`, err.message);
  }
  return '';
}

/** Key of a shared persona app, looked up under each configured owner in turn. */
async function fetchPersonaAppKey(org, token, appName) {
  for (const dev of PERSONA_APP_DEVELOPERS) {
    const key = await fetchAppConsumerKey(org, token, dev, appName);
    if (key) return key;
  }
  return '';
}

const geminiNameCache = new Map();

async function parseEmailHandleWithGemini(email, token) {
  if (!email || !token) return null;
  const cacheKey = email.toLowerCase();
  if (geminiNameCache.has(cacheKey)) return geminiNameCache.get(cacheKey);

  try {
    // Direct Vertex call, deliberately NOT through the AI Gateway: this is incidental UI
    // plumbing, and routing it through the proxy would pollute demo analytics and burn
    // token quota on name parsing. Because it bypasses the gateway, retiring a model from
    // the API Products does not stop it -- it would just have started 404ing on
    // gemini-2.5-flash's 2026-10-20 end of life, silently degrading sign-in names.
    const url =
      `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent`;
    const prompt = `Extract the likely human First Name and Last Name from this corporate email address: "${email}".
Rules:
1. Strip prefixes like "the", "mr", "ms", "iam", "official" if they precede a clear given name (e.g., "thejohnsmith" -> First: "John", Last: "Smith").
2. If the username is last-name-first (like "smithjohn"), order as Given Name first, Surname second (First: "John", Last: "Smith").
3. If one part is a single initial (e.g., "jsmith", "johns"), capitalize the initial and the surname (e.g., First: "J", Last: "Smith" or First: "John", Last: "S").
4. NEVER return "Google" or the domain name as the last name. If only one name exists with no surname, set lastName to "".
Return ONLY valid JSON: {"firstName": "...", "lastName": "..."}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, responseMimeType: 'application/json' },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(text);
      if (parsed.firstName) {
        const cleanLast =
          parsed.lastName && parsed.lastName.toLowerCase() !== 'google' && parsed.lastName.toLowerCase() !== 'user'
            ? parsed.lastName.trim()
            : '';
        const result = {
          firstName: parsed.firstName.trim(),
          lastName: cleanLast,
          fullName: [parsed.firstName.trim(), cleanLast].filter(Boolean).join(' '),
        };
        geminiNameCache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Fallback if Gemini call fails
  }
  return null;
}

function extractNameFromJwt(jwtString) {
  if (!jwtString) return null;
  try {
    const cleanJwt = String(jwtString).replace(/^Bearer\s+/i, '').trim();
    const parts = cleanJwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const given =
      payload.given_name ||
      payload.gcip?.given_name ||
      payload.gcip?.firebase?.sign_in_attributes?.given_name ||
      '';
    const family =
      payload.family_name ||
      payload.gcip?.family_name ||
      payload.gcip?.firebase?.sign_in_attributes?.family_name ||
      '';
    if (given && family) {
      return { firstName: given, lastName: family, fullName: `${given} ${family}` };
    }
    const rawName =
      payload.name ||
      payload.gcip?.name ||
      payload.gcip?.firebase?.sign_in_attributes?.name ||
      payload.google?.name ||
      payload.user_info?.name ||
      '';
    if (rawName && rawName.trim()) {
      const split = rawName.trim().split(/\s+/);
      return {
        firstName: split[0],
        lastName: split.slice(1).join(' ') || split[0],
        fullName: rawName.trim(),
      };
    }
  } catch {
    // Ignore JWT parse errors
  }
  return null;
}

async function resolveUserFullName(email, iapJwtHeader, fallbackName, authHeader = '', token = '') {
  const username = (email || '').split('@')[0].toLowerCase() || 'admin';
  // 1. Check x-goog-iap-jwt-assertion or Authorization Bearer JWT for name claims
  const fromIapJwt = extractNameFromJwt(iapJwtHeader);
  if (fromIapJwt) return fromIapJwt;
  const fromAuthJwt = extractNameFromJwt(authHeader);
  if (fromAuthJwt) return fromAuthJwt;

  // 2. If Authorization Bearer is an OAuth2 access token (e.g. ya29.*), query Google OAuth2 userinfo
  if (authHeader && /^Bearer\s+ya29\./i.test(authHeader)) {
    try {
      const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: authHeader },
      });
      if (uRes.ok) {
        const uData = await uRes.json();
        if (uData.given_name && uData.family_name) {
          return {
            firstName: uData.given_name,
            lastName: uData.family_name,
            fullName: `${uData.given_name} ${uData.family_name}`,
          };
        }
        if (uData.name) {
          const split = uData.name.trim().split(/\s+/);
          return {
            firstName: split[0],
            lastName: split.slice(1).join(' ') || split[0],
            fullName: uData.name.trim(),
          };
        }
      }
    } catch {
      // Ignore userinfo errors
    }
  }

  // 3. Parse dot/underscore separated usernames (e.g. john.doe -> John Doe)
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  if (username.includes('.') || username.includes('_')) {
    const parts = username.split(/[._]/).filter(Boolean).map(cap);
    const firstName = parts[0] || cap(username);
    const lastName = parts.slice(1).join(' ') || '';
    return { firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(' ') };
  }
  // 4. Fallback if fallbackName has spaces and doesn't end with 'User' or 'Google'
  if (
    fallbackName &&
    fallbackName.includes(' ') &&
    !fallbackName.endsWith(' User') &&
    !fallbackName.endsWith(' Google')
  ) {
    const split = fallbackName.trim().split(/\s+/);
    return { firstName: split[0], lastName: split.slice(1).join(' '), fullName: fallbackName.trim() };
  }
  // 5. Use Vertex AI Gemini to split compound corporate email handles (e.g. "thejohnsmith@example.com" -> "John Smith")
  if (token) {
    const geminiParsed = await parseEmailHandleWithGemini(email, token);
    if (geminiParsed) return geminiParsed;
  }
  // 6. Single word fallback: capitalize handle, NEVER append 'Google' as lastName
  const firstName = cap(username.replace(/^the/i, ''));
  return { firstName, lastName: '', fullName: firstName };
}

async function provisionUserDeveloperAndApp(
  org,
  token,
  email,
  name,
  iapJwtHeader = '',
  authHeader = '',
  options = { allowCreate: false, explicitFirstName: '', explicitLastName: '' }
) {
  const resolved = await resolveUserFullName(email, iapJwtHeader, name, authHeader, token);
  if (!email || !token) {
    return { apiKey: '', apiKeys: {}, username: '', fullName: resolved.fullName };
  }

  const username = email.split('@')[0] || 'admin';
  let firstName = options.explicitFirstName ? options.explicitFirstName.trim() : resolved.firstName;
  let lastName = options.explicitLastName ? options.explicitLastName.trim() : resolved.lastName;
  let fullName = firstName === lastName || !lastName ? firstName : `${firstName} ${lastName}`.trim();
  const apiKeys = { admin: '', sales_agent: '', loans_agent: '' };

  try {
    // 1. Check/Create Developer
    const devUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}`;
    const devRes = await fetch(devUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (devRes.status === 404) {
      if (!options.allowCreate) {
        console.log(`[Server] Developer ${email} not found (404). Returning needsOnboarding=true with suggested name: ${firstName} ${lastName}`);
        return {
          needsOnboarding: true,
          suggestedFirstName: firstName,
          suggestedLastName: lastName,
          fullName,
          apiKey: '',
          apiKeys: {},
          username,
        };
      }
      console.log(`[Server] Creating developer ${email} with validated name ${firstName} ${lastName}...`);
      await fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          firstName,
          lastName: lastName || firstName,
          userName: username,
        }),
      });
    } else if (devRes.ok) {
      const devData = await devRes.json();
      const existingFirst = devData.firstName || '';
      const existingLast = devData.lastName || '';
      if (options.allowCreate && options.explicitFirstName) {
        console.log(`[Server] Updating existing developer name for ${email}: ${existingFirst} ${existingLast} -> ${firstName} ${lastName}`);
        devData.firstName = firstName;
        devData.lastName = lastName || firstName;
        await fetch(devUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(devData),
        });
      } else if (existingFirst) {
        // The Apigee developer record is the source of truth for the display name.
        // Users change it via the profile form (explicitFirstName path above).
        firstName = existingFirst;
        lastName = existingLast;
        fullName = existingFirst === existingLast || !existingLast ? existingFirst : `${existingFirst} ${existingLast}`;
      }
    }

    // 2. Check/Create Admin App
    const targetAppName = `Unified Admin ${username} App`;
    const appsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/apps?expand=true`;
    const appsRes = await fetch(appsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const appsList = appsRes.ok ? (await appsRes.json()).app || [] : [];

    let matchedApp = appsList.find(
      (a) =>
        a.name === targetAppName ||
        a.name.startsWith(targetAppName)
    );

    if (!matchedApp) {
      console.log(`[Server] Creating app ${targetAppName} for ${email}...`);
      const createAppRes = await fetch(
        `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/apps`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: targetAppName,
            apiProducts: [...ADMIN_APP_PRODUCTS],
            attributes: [
              { name: 'DisplayName', value: targetAppName },
              { name: 'persona', value: 'admin' },
            ],
          }),
        }
      );
      if (createAppRes.ok) {
        matchedApp = await createAppRes.json();
      }
    } else {
      // Ensure products are attached and displayName is set
      const existingProducts = new Set();
      if (matchedApp.credentials) {
        for (const cred of matchedApp.credentials) {
          if (cred.apiProducts) {
            for (const p of cred.apiProducts) {
              existingProducts.add(p.apiproduct);
            }
          }
        }
      }
      const requiredProducts = [...ADMIN_APP_PRODUCTS];
      const missingProducts = requiredProducts.filter((p) => !existingProducts.has(p));
      const hasDisplayNameAttr = matchedApp.attributes?.some(
        (a) => (a.name === 'DisplayName' || a.name === 'displayName') && a.value
      );

      if (missingProducts.length > 0 || !hasDisplayNameAttr) {
        console.log(`[Server] Ensuring app ${matchedApp.name} has required products and displayName...`);
        const updatedProducts = Array.from(new Set([...existingProducts, ...requiredProducts]));
        const existingAttrs = matchedApp.attributes || [];
        const mergedAttrs = existingAttrs.filter((a) => a.name !== 'DisplayName' && a.name !== 'displayName');
        mergedAttrs.unshift({ name: 'DisplayName', value: matchedApp.name });

        await fetch(
          `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/apps/${encodeURIComponent(matchedApp.name)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: matchedApp.name,
              apiProducts: updatedProducts,
              attributes: mergedAttrs,
            }),
          }
        );
      }
    }

    // Persona products: attach Engineering & IT, detach the retired generic tiers.
    if (matchedApp) {
      await syncAdminAppProducts({ org, token, email, app: matchedApp });
    }

    if (matchedApp && matchedApp.credentials) {
      const approvedCred = matchedApp.credentials.find((c) => c.status === 'approved') || matchedApp.credentials[0];
      if (approvedCred && approvedCred.consumerKey) {
        apiKeys.admin = approvedCred.consumerKey;
      }
    }

    // 3. Fetch global keys for Sales and Loans (owned by PERSONA_APP_DEVELOPER, falling back to DEMO_ADMIN_EMAIL)
    apiKeys.sales_agent =
      await fetchPersonaAppKey(org, token, 'Unified Sales App');
    apiKeys.loans_agent =
      await fetchPersonaAppKey(org, token, 'Unified Loans App');

    // 4. Monetization PREPAID + Balance Top-up
    const cfgUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/monetizationConfig`;
    const cfgRes = await fetch(cfgUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (cfgRes.ok) {
      const cfgData = await cfgRes.json();
      if (cfgData.billingType !== 'PREPAID') {
        await fetch(cfgUrl, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ billingType: 'PREPAID' }),
        });
      }
    } else if (cfgRes.status === 404) {
      await fetch(cfgUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingType: 'PREPAID' }),
      });
    }

    const balUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/balance`;
    const balRes = await fetch(balUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let needsInitialTopup = true;
    if (balRes.ok) {
      const balData = await balRes.json();
      const wallets = balData.wallets || [];
      if (wallets.length > 0 && wallets[0].balance) {
        const units = parseInt(wallets[0].balance.units || '0', 10);
        if (units > 0 || wallets[0].lastCreditTime) {
          needsInitialTopup = false;
        }
      }
    }

    if (needsInitialTopup) {
      console.log(`[Server] Adding $${PREPAID_STARTING_BALANCE_USD} starting balance for developer ${email}...`);
      const creditUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/balance:credit`;
      await fetch(creditUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionAmount: { currencyCode: 'USD', units: String(PREPAID_STARTING_BALANCE_USD), nanos: 0 },
          transactionId: `init-topup-${PREPAID_STARTING_BALANCE_USD}-${Date.now()}`,
        }),
      });
    }

    // 5. Ensure Developer Rate Plan Subscriptions for AI Products
    const subsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/subscriptions`;
    const subsRes = await fetch(subsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const existingProducts = new Set();
    if (subsRes.ok) {
      const subsData = await subsRes.json();
      for (const s of subsData.developerSubscriptions || []) {
        if (s.apiproduct && !s.endTime) existingProducts.add(s.apiproduct);
      }
    }
    const requiredProducts = requiredSubscriptionsFor(email);
    for (const product of requiredProducts) {
      if (!existingProducts.has(product)) {
        console.log(`[Server] Auto-subscribing developer ${email} to ${product}...`);
        await fetch(subsUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiproduct: product }),
        });
      }
    }

    return { apiKey: apiKeys.admin || '', apiKeys, username, fullName };
  } catch (err) {
    console.error('[Server] Error provisioning user developer and apps:', err.message);
    return { apiKey: '', apiKeys: {}, username, fullName };
  }
}

function getApigeeTimeRange(rangeParam) {
  const now = new Date();
  let days = 7;
  if (rangeParam === '24h') days = 1;
  else if (rangeParam === '30d') days = 30;

  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');

  const fmt = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${fmt(start)}~${fmt(now)}`;
}

// Ask Apigee backend (/api/admin-agent/*).
//
// The service is constructed with this file's own Apigee helpers injected
// rather than importing them, which keeps all the credential handling in one
// place and lets the unit tests drive the same code with fakes.
const adminAgentService = createAdminAgentService({
  getToken: getGcpAccessToken,
  provisionAdmin: (org, token, email) =>
    provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
  defaultProducts: DEFAULT_PRODUCTS,
});

// Agent Showcase backend (/api/agent-showcase/*): resolves the caller's identity and
// persona keys here, then streams the private ADK service's run (see server/agentShowcase.js).
const agentShowcaseService = createAgentShowcaseService({
  getToken: getGcpAccessToken,
  provision: (org, token, email) =>
    provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
});

// Customer theme library (/api/themes/*): themes and logos live in a private GCS
// bucket so customers can be added without a redeploy (see server/themeLibrary.js).
const themeLibraryService = createThemeLibraryService({
  getToken: getGcpAccessToken,
  provision: (org, token, email) =>
    provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
  identityToken: (email) => mintSyntheticIdentityToken(email, email.split('@')[0]),
  defaultEmail: SSO_USER_EMAIL,
});

// Daily pricing/model watch (/api/model-watch): report written by the model-watch Cloud Run
// job, compared here with the live rate card and product entitlements (server/modelWatch.js).
const modelWatchService = createModelWatchService({
  getToken: getGcpAccessToken,
  org: APIGEE_ORG,
  project: GCP_PROJECT_ID,
  bucket: process.env.MODEL_WATCH_BUCKET || THEME_BUCKET,
  personaProducts: PERSONA_PRODUCTS,
});

// MIME Types helper
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function proxyRequest(req, res, targetUrl) {
  try {
    const headers = {};
    for (const [key, val] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'host' &&
        lowerKey !== 'content-length' &&
        lowerKey !== 'connection' &&
        lowerKey !== 'accept-encoding' &&
        lowerKey !== 'x-serverless-authorization' &&
        lowerKey !== 'x-goog-iap-jwt-assertion' &&
        lowerKey !== 'x-goog-authenticated-user-email' &&
        lowerKey !== 'x-goog-authenticated-user-id' &&
        lowerKey !== 'cookie'
      ) {
        headers[key] = val;
      }
    }

    let bodyBuffer = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      bodyBuffer = Buffer.concat(chunks);
    }

    const proxyRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyBuffer,
    });

    res.statusCode = proxyRes.status;
    proxyRes.headers.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'content-encoding' &&
        lowerKey !== 'content-length' &&
        lowerKey !== 'transfer-encoding' &&
        lowerKey !== 'connection'
      ) {
        res.setHeader(key, val);
      }
    });

    const responseBody = await proxyRes.arrayBuffer();
    const buffer = Buffer.from(responseBody);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  } catch (err) {
    console.error(`[Server] Proxy error to ${targetUrl}:`, err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = req.url || '/';
  const parsedUrl = new URL(reqUrl, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Serve /env-config.js dynamically for SPA
  if (pathname === '/env-config.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Cache-Control', 'no-store');
    const runtimeConfig = publicRuntimeConfig();
    res.end(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`);
    return;
  }

  // 1b. Hard-refresh hint for the SPA (see server/reloadHint.js)
  if (pathname === '/reload-hint.js') {
    handleReloadHint(req, res);
    return;
  }

  // 2. /api/me endpoint
  if (pathname === '/api/me' || pathname === '/api/me/') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const queryEmail = parsedUrl.searchParams.get('email') || '';
    const incomingHeader = req.headers['x-goog-authenticated-user-email'] || '';
    const iapJwtHeader = req.headers['x-goog-iap-jwt-assertion'] || '';
    const authHeader = req.headers['authorization'] || '';
    const cleanHeader = String(incomingHeader).replace(/^accounts\.google\.com:/, '').trim();
    const email = (queryEmail || cleanHeader || SSO_USER_EMAIL).trim();
    const resolvedName = await resolveUserFullName(email, iapJwtHeader, '', authHeader);
    let name = resolvedName.fullName || email.split('@')[0] || 'SSO User';

    const saToken = await getGcpAccessToken();
    let apiKey = '';
    let apiKeys = {};
    let username = email.split('@')[0] || 'admin';
    let needsOnboarding = false;
    let suggestedFirstName = resolvedName.firstName || '';
    let suggestedLastName = resolvedName.lastName || '';

    if (saToken && email) {
      const org = APIGEE_ORG;
      const provResult = await provisionUserDeveloperAndApp(
        org,
        saToken,
        email,
        name,
        iapJwtHeader,
        authHeader,
        { allowCreate: false }
      );
      if (provResult.needsOnboarding) {
        needsOnboarding = true;
        suggestedFirstName = provResult.suggestedFirstName || suggestedFirstName;
        suggestedLastName = provResult.suggestedLastName || suggestedLastName;
      }
      if (provResult.apiKey) apiKey = provResult.apiKey;
      if (provResult.apiKeys) apiKeys = provResult.apiKeys;
      if (provResult.username) username = provResult.username;
      if (provResult.fullName) name = provResult.fullName;
    }

    // The proxy resolves caller identity from the JWT `email` claim only, so a
    // token must always be present or every call 401s. Behind IAP that is the
    // real assertion. On localhost there is none, so mint a stand-in.
    //
    // It must say RS256 and carry a non-empty signature segment: Apigee's
    // DecodeJWT rejects the `alg: none` / empty-signature form outright (401),
    // even though it never verifies the signature. Same shape as
    // apigee/scripts/generate_demo_traffic.py. Development affordance only --
    // see the VerifyJWT note in docs/apigee_ai_gateway_demo_design.md.
    //
    // The construction lives in server/adminAgentCore.js because the Admin
    // Agent mints the same token server-side; one definition, no drift.
    let identityToken = iapJwtHeader;
    if (!identityToken) {
      identityToken = mintSyntheticIdentityToken(email, name);
    }

    res.end(
      JSON.stringify({
        email,
        // Hand the IAP assertion to the client so it can authenticate to the
        // gateway with a token instead of a self-asserted email header. The
        // proxy's DJWT-ExtractUserIdentity/AM-SetUserIdentity pair already
        // prefers this; it simply never received one before.
        token: identityToken,
        name,
        username,
        apiKey,
        apiKeys,
        needsOnboarding,
        suggestedFirstName,
        suggestedLastName,
        provider: cleanHeader ? 'Google Cloud Identity SSO (IAP)' : 'Local Default SSO',
        raw: incomingHeader,
      })
    );
    return;
  }

  // 2b. /api/me/onboard & /api/me/profile endpoints (create or update developer with user-validated firstName & lastName)
  if (
    pathname === '/api/me/onboard' ||
    pathname === '/api/me/onboard/' ||
    pathname === '/api/me/profile' ||
    pathname === '/api/me/profile/'
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST' && req.method !== 'PUT') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST or PUT.' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const email = (payload.email || '').trim();
        let firstName = (payload.firstName || '').trim();
        let lastName = (payload.lastName || '').trim();
        const rawFullName = (payload.fullName || '').trim();

        if (!firstName && rawFullName) {
          const parts = rawFullName.split(/\s+/).filter(Boolean);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ');
        }

        if (!email || !firstName) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Both email and firstName are required' }));
          return;
        }

        const fullName = lastName && lastName !== firstName ? `${firstName} ${lastName}`.trim() : firstName;

        const saToken = await getGcpAccessToken();
        if (!saToken) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
          return;
        }

        const org = APIGEE_ORG;
        const provResult = await provisionUserDeveloperAndApp(
          org,
          saToken,
          email,
          fullName,
          '',
          '',
          {
            allowCreate: true,
            explicitFirstName: firstName,
            explicitLastName: lastName || firstName,
          }
        );

        res.end(JSON.stringify({
          status: 'ok',
          email,
          firstName,
          lastName: lastName || firstName,
          fullName,
          name: fullName,
          username: provResult.username || email.split('@')[0],
          apiKey: provResult.apiKey || '',
          apiKeys: provResult.apiKeys || {},
          needsOnboarding: false,
        }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 3. /api/kvm/rates
  if (pathname === '/api/kvm/rates') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const envParam = parsedUrl.searchParams.get('env') || 'prod';
    const apigeeEnv = envParam === 'dev' || envParam === 'bap' ? 'dev' : 'prod';
    const org = APIGEE_ORG;
    const kvmName = 'ai-model-rates';
    const entryKey = 'rate_card';

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const apigeeBase = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/keyvaluemaps/${kvmName}/entries`;

    if (req.method === 'GET') {
      try {
        const apiRes = await fetch(`${apigeeBase}/${entryKey}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!apiRes.ok) {
          const errText = await apiRes.text();
          res.statusCode = apiRes.status;
          res.end(JSON.stringify({ error: `KVM error (${apiRes.status}): ${errText}` }));
          return;
        }
        const data = await apiRes.json();
        let rates = {};
        try {
          rates = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        } catch {
          rates = {};
        }
        res.end(JSON.stringify({
          status: 'ok',
          env: apigeeEnv,
          org,
          map: kvmName,
          rates,
          updatedAt: new Date().toISOString(),
        }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          // Unknown / missing env is treated as prod, which the console may not write.
          const targetEnv = normalizeConsoleEnv(payload.env ?? parsedUrl.searchParams.get('env'));
          const guard = consoleWriteGuard(targetEnv);
          if (guard) {
            res.statusCode = guard.status;
            res.end(JSON.stringify(guard.body));
            return;
          }
          const newRates = payload.rates;
          if (!newRates || typeof newRates !== 'object') {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing or invalid "rates" object in request body' }));
            return;
          }

          const targetUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${targetEnv}/keyvaluemaps/${kvmName}/entries/${entryKey}`;
          const updateRes = await fetch(targetUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: entryKey,
              value: JSON.stringify(newRates),
            }),
          });

          if (!updateRes.ok) {
            const errText = await updateRes.text();
            res.statusCode = updateRes.status;
            res.end(JSON.stringify({ error: `Failed to update KVM (${updateRes.status}): ${errText}` }));
            return;
          }

          res.end(JSON.stringify({
            status: 'ok',
            env: targetEnv,
            message: `Successfully updated ${entryKey} in ${targetEnv} KVM`,
            rates: newRates,
            updatedAt: new Date().toISOString(),
          }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }
    return;
  }

  // 4. /api/monetization/balance
  if (pathname === '/api/monetization/balance') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const dev = parsedUrl.searchParams.get('dev') || DEMO_ADMIN_EMAIL;
    const org = APIGEE_ORG;
    try {
      const apiRes = await fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await apiRes.json();

      // Subtract pending session debits (bridges Apigee's ~15-min settlement window)
      applyLedgerToBalance(sessionLedgerByDev, dev, data);

      res.statusCode = apiRes.status;
      res.end(JSON.stringify({
        status: apiRes.ok ? 'ok' : 'error',
        developer: dev,
        org,
        data,
      }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 4b. /api/monetization/debit (Real-time session wallet deduction)
  if (pathname === '/api/monetization/debit') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const dev = (payload.developer || DEMO_ADMIN_EMAIL).toLowerCase();
        // Starting balance is read from Apigee here, never taken from the client.
        const token = await getGcpAccessToken();
        const wallet = await fetchApigeeWallet({ org: APIGEE_ORG, dev, token });
        const result = recordDebit(sessionLedgerByDev, dev, payload.amountUsd, wallet);
        res.end(JSON.stringify({ status: 'ok', ...result }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5. /api/monetization/credit
  if (pathname === '/api/monetization/credit') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
      return;
    }

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const dev = payload.developer || DEMO_ADMIN_EMAIL;
        const units = String(payload.units || '50');
        const org = APIGEE_ORG;
        const txId = `topup-${Date.now()}`;

        const creditUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/balance:credit`;
        const creditRes = await fetch(creditUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transactionAmount: {
              currencyCode: 'USD',
              units,
              nanos: 0,
            },
            transactionId: txId,
          }),
        });

        // Clear session debit ledger on top-up so balance reflects the fresh credit
        sessionLedgerByDev.delete(dev.toLowerCase());

        const data = await creditRes.json();
        res.statusCode = creditRes.status;
        res.end(JSON.stringify({
          status: creditRes.ok ? 'ok' : 'error',
          developer: dev,
          credited: units,
          transactionId: txId,
          data,
        }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 6. /api/monetization/rateplans
  if (pathname === '/api/monetization/rateplans') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const org = APIGEE_ORG;
    const products = [...PERSONA_PRODUCTS];

    try {
      const allPlans = [];
      const prodPromises = products.map(async (prod) => {
        const rpListRes = await fetch(
          `https://apigee.googleapis.com/v1/organizations/${org}/apiproducts/${encodeURIComponent(prod)}/rateplans`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (rpListRes.ok) {
          const rpListData = await rpListRes.json();
          const planItems = rpListData.ratePlans || [];
          const planPromises = planItems.map(async (item) => {
            try {
              const planRes = await fetch(
                `https://apigee.googleapis.com/v1/organizations/${org}/apiproducts/${encodeURIComponent(prod)}/rateplans/${item.name}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (planRes.ok) {
                return await planRes.json();
              }
            } catch { }
            return null;
          });
          const loadedPlans = await Promise.all(planPromises);
          return loadedPlans.filter(Boolean);
        }
        return [];
      });
      const results = await Promise.all(prodPromises);
      results.forEach((plans) => allPlans.push(...plans));
      res.end(JSON.stringify({ status: 'ok', ratePlans: allPlans }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7. /api/monetization/subscriptions
  if (pathname === '/api/monetization/subscriptions') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const dev = parsedUrl.searchParams.get('dev') || DEMO_ADMIN_EMAIL;
    const org = APIGEE_ORG;

    if (req.method === 'GET') {
      try {
        const subRes = await fetch(
          `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/subscriptions`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await subRes.json();
        res.statusCode = subRes.status;
        res.end(JSON.stringify({
          status: subRes.ok ? 'ok' : 'error',
          developer: dev,
          subscriptions: data.developerSubscriptions || (Array.isArray(data) ? data : []),
        }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const targetDev = payload.developer || dev;
          const apiproduct = payload.apiproduct;
          const subRes = await fetch(
            `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(targetDev)}/subscriptions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                apiproduct,
                startTime: String(Date.now()),
              }),
            }
          );
          const data = await subRes.json();
          res.statusCode = subRes.status;
          res.end(JSON.stringify({ status: subRes.ok ? 'ok' : 'error', data }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }
    return;
  }

  // 8. /api/monetization/config
  if (pathname === '/api/monetization/config') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const dev = parsedUrl.searchParams.get('dev') || DEMO_ADMIN_EMAIL;
    const org = APIGEE_ORG;
    const cfgUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/monetizationConfig`;

    if (req.method === 'GET') {
      try {
        const apiRes = await fetch(cfgUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await apiRes.json();
        res.statusCode = apiRes.status;
        res.end(JSON.stringify({ status: apiRes.ok ? 'ok' : 'error', developer: dev, config: data }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const billingType = payload.billingType || 'PREPAID';
          const apiRes = await fetch(cfgUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ billingType }),
          });
          const data = await apiRes.json();
          res.statusCode = apiRes.status;
          res.end(JSON.stringify({ status: apiRes.ok ? 'ok' : 'error', developer: dev, config: data }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }
    return;
  }

  // 9b. /api/analytics/tools-stats — MCP (tools) traffic from standard Apigee dimensions.
  if (pathname === '/api/analytics/tools-stats') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }
    const env = parsedUrl.searchParams.get('env') === 'dev' ? 'dev' : 'prod';
    const handle = parsedUrl.searchParams.get('handle') || undefined;
    const user = parsedUrl.searchParams.get('user') || undefined;
    const apigeeTimeRange = getApigeeTimeRange(parsedUrl.searchParams.get('timeRange') || '24h');
    try {
      const r = await fetch(toolsStatsUrl({ org: APIGEE_ORG, env, apigeeTimeRange }), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `Apigee stats returned ${r.status}` }));
        return;
      }
      res.end(JSON.stringify({ env, ...buildToolsAnalytics(await r.json(), { handle, user }) }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 9c. /api/logs/tools — per-call MCP logs (method, tool, outcome) from Cloud Logging.
  if (pathname === '/api/logs/tools') {
    await handleToolLogs(req, res, { parsedUrl, getToken: getGcpAccessToken });
    return;
  }

  // 9e. /api/analytics/agent-stats — the Agent Showcase agents' history (Apigee stats + logs).
  if (pathname === '/api/analytics/agent-stats') {
    await handleAgentAnalytics(req, res, { parsedUrl, getToken: getGcpAccessToken });
    return;
  }

  // 9d. /api/demo/reset — restore the Customer Service API's seed data (demo start).
  if (pathname === '/api/demo/reset') {
    await handleDemoReset(req, res);
    return;
  }

  // 9. /api/analytics/fleet-stats
  if (pathname === '/api/analytics/fleet-stats') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const rangeParam = parsedUrl.searchParams.get('timeRange') || '24h';
    const envParam = parsedUrl.searchParams.get('env') || 'prod';
    const org = APIGEE_ORG;
    const apigeeEnv = envParam === 'dev' || envParam === 'bap' ? 'dev' : 'prod';
    const apigeeTimeRange = getApigeeTimeRange(rangeParam);

    try {
      // sum(is_error) is selected per user/model too, not just fleet-wide: faults now emit
      // dc_user_email via the proxy's DefaultFaultRule, so blocked calls can be attributed.
      //
      // The apiproxy filter is load-bearing. The dc_user_email dimension is environment-wide,
      // so without it this query also returns `mcp` and other proxies' traffic. Those proxies
      // never set dc_user_email, so every one of their calls landed in the `(not set)` bucket
      // and was rendered in the AI Gateway ledger as an anonymous AI caller. Measured on prod:
      // unfiltered 126 calls / 45 errors, filtered 76 / 39 — the latter matching the apiproxy
      // dimension exactly. Without the filter, attributedErrorCount can exceed isErrorCount.
      const proxyFilter = encodeURIComponent(`(apiproxy eq 'ai-gateway-v1')`);
      const statsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/dc_user_email,dc_model_name?select=sum(message_count),sum(is_error),sum(dc_prompt_token_count),sum(dc_candidates_token_count),sum(dc_total_token_count)&timeRange=${encodeURIComponent(apigeeTimeRange)}&filter=${proxyFilter}`;
      const proxyStatsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/apiproxy?select=sum(message_count),sum(is_error),avg(total_response_time)&timeRange=${encodeURIComponent(apigeeTimeRange)}`;
      const kvmUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/keyvaluemaps/ai-model-rates/entries/rate_card`;
      // Real semantic-cache signal. dc_cache_status is HIT / MISS / DISABLED, captured by
      // DC-ModelAnalytics alongside dc_user_email. Querying both dimensions allows calculating
      // both fleet totals and per-user cache hit rates. Traffic served before that collector
      // shipped reports "(not set)" and is excluded from the denominator.
      const cacheStatsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/dc_user_email,dc_cache_status?select=sum(message_count)&timeRange=${encodeURIComponent(apigeeTimeRange)}&filter=${proxyFilter}`;

      const [statsRes, proxyRes, kvmRes, cacheRes] = await Promise.all([
        fetch(statsUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(proxyStatsUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(kvmUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        fetch(cacheStatsUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
      ]);

      let rates = {};
      if (kvmRes && kvmRes.ok) {
        try {
          const kvmData = await kvmRes.json();
          rates = typeof kvmData.value === 'string' ? JSON.parse(kvmData.value) : kvmData.value || {};
        } catch { }
      }

      let totalProxyCalls = 0;
      let totalProxyErrors = 0;
      let avgLatencyMs = 380;
      if (proxyRes.ok) {
        const pData = await proxyRes.json();
        const dims = pData.environments?.[0]?.dimensions || [];
        const aiGatewayDim = dims.find((d) => d.name === 'ai-gateway-v1');
        if (aiGatewayDim) {
          const mc = aiGatewayDim.metrics?.find((m) => m.name === 'sum(message_count)');
          const ec = aiGatewayDim.metrics?.find((m) => m.name === 'sum(is_error)');
          const lat = aiGatewayDim.metrics?.find((m) => m.name === 'avg(total_response_time)');
          totalProxyCalls = Number(mc?.values?.[0] || 0);
          totalProxyErrors = Number(ec?.values?.[0] || 0);
          avgLatencyMs = Math.round(Number(lat?.values?.[0] || 380));
        }
      }

      const statsData = statsRes.ok ? await statsRes.json() : null;
      const rawDimensions = statsData?.environments?.[0]?.dimensions || [];

      let totalTraffic = 0;
      let totalPromptTokens = 0;
      let totalCandidateTokens = 0;
      let totalCostUsd = 0;
      let flashCalls = 0;
      let proCalls = 0;

      const consumptionRows = [];
      let totalAttributedErrors = 0;

      for (const dim of rawDimensions) {
        const rawUser = dim.individualNames?.[0] || dim.name?.split(',')[0] || '(not set)';
        const rawModel = dim.individualNames?.[1] || dim.name?.split(',')[1] || '(not set)';

        const mc = Number(dim.metrics?.find((m) => m.name === 'sum(message_count)')?.values?.[0] || 0);
        const ec = Number(dim.metrics?.find((m) => m.name === 'sum(is_error)')?.values?.[0] || 0);
        const pt = Number(dim.metrics?.find((m) => m.name === 'sum(dc_prompt_token_count)')?.values?.[0] || 0);
        const ct = Number(dim.metrics?.find((m) => m.name === 'sum(dc_candidates_token_count)')?.values?.[0] || 0);

        if (mc <= 0) continue;

        // Apigee reports a missing dimension as the string '(not set)', but a dimension that was
        // captured while its source variable was unresolved comes back as the literal string
        // 'null'. Both mean "no identity". The fault path produces the latter for requests that
        // die before PreFlow step 5 (DJWT-ExtractUserIdentity) — a malformed body rejected by
        // OAS-ValidateRequest at step 2, or a request with no JWT at all. Treating only
        // '(not set)' as absent would render those in the ledger as a user literally named 'null'.
        const isAbsent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';

        // A blocked call legitimately has no model and no tokens. Only drop the row when it also
        // has no errors, otherwise this guard would silently discard the very data we just added.
        if (isAbsent(rawModel) && pt === 0 && ct === 0 && ec === 0) continue;

        const isUnauthenticated = isAbsent(rawUser);
        const userEmail = isUnauthenticated ? 'anonymous.caller@external.client' : rawUser;
        const model = isAbsent(rawModel) ? 'unknown-model' : rawModel;

        // Resolve the rate card entry first — it is the source of truth for BOTH price and
        // cost tier. Longest key wins so 'claude-opus-5-5' beats a shorter prefix.
        const rateKey = Object.keys(rates)
          .filter((k) => k !== 'default' && (model === k || model.startsWith(k)))
          .sort((a, b) => b.length - a.length)[0];
        const matchedRate = (rateKey ? rates[rateKey] : null) || rates[model] || rates['default'] || {};

        // Tier comes from the rate card, NOT from the model name. Name-matching on
        // 'pro'/'opus'/'flash-lite' silently mis-tiers models whose price does not match their
        // name: gemini-3.5-flash (1.50/9.00) costs more than the newer gemini-3.8-flash
        // (0.75/3.75), yet a name heuristic would call both 'medium' and
        // counted them as low-cost routing wins. Fall back to the band only for an unpriced model.
        const tierFromRate = (out) => (out >= 5.0 ? 'high' : out <= 0.3 ? 'low' : 'medium');
        const tier = isAbsent(rawModel)
          ? 'N/A'
          : matchedRate.tier || (matchedRate.output !== undefined ? tierFromRate(Number(matchedRate.output)) : 'medium');
        const provider = isAbsent(rawModel)
          ? 'System / Pre-Model'
          : matchedRate.provider
            ? (matchedRate.provider === 'anthropic' ? 'Anthropic' : 'Google')
            : (model.includes('claude') ? 'Anthropic' : 'Google');

        const inRate = matchedRate.input ?? 0.15;
        const outRate = matchedRate.output ?? 0.60;
        const cost = isAbsent(rawModel) ? 0 : (pt / 1_000_000) * inRate + (ct / 1_000_000) * outRate;

        totalTraffic += mc;
        totalPromptTokens += pt;
        totalCandidateTokens += ct;
        totalCostUsd += cost;
        totalAttributedErrors += ec;

        // Routing split counts only calls that actually reached a model. A blocked call has
        // no model, and 'unknown-model' would otherwise fall through the tier ladder into the
        // non-high bucket and be presented as a cheap-model routing win. '{flow.model}' is
        // residue from the pre-rev-13 DataCapture literal-default bug and is equally not a model.
        const modelResolved = model !== 'unknown-model' && model !== '{flow.model}';
        if (modelResolved) {
          if (tier === 'high') proCalls += mc;
          else flashCalls += mc;
        }

        consumptionRows.push({
          userEmail,
          model,
          provider,
          tier,
          totalTraffic: mc,
          errorCount: ec,
          inputTokens: pt,
          outputTokens: ct,
          costUsd: Number(cost.toFixed(4)),
          isUnauthenticated,
        });
      }

      // NOTE: there was previously a "wallet reconciliation" block here that invented
      // consumption rows for any developer whose prepaid balance had dropped below its
      // starting value. It fabricated a call count (spend x 16), a token count
      // (spend x 48500), a 65/35 prompt-to-candidate split and a two-model breakdown
      // (60% gemini-2.5-flash, 40% gemini-3.1-pro-preview) — none of which was measured.
      // On dev, where the Analytics add-on is disabled, it was the *only* source of rows,
      // so the dashboard showed 110 entirely imaginary calls. Removed: the ledger now
      // contains only what Apigee actually recorded.

      consumptionRows.sort((a, b) => b.costUsd - a.costUsd || b.totalTraffic - a.totalTraffic);

      // Real cache hit rate from the dc_cache_status dimension.
      //
      // Only HIT and MISS count toward the rate. DISABLED means the caller turned caching
      // off for that request, and "(not set)" is traffic served before the collector
      // existed — neither is a cache miss, so counting them would understate the rate.
      // When nothing measurable is present the KPI is null and the UI renders an em dash,
      // rather than the 29.4 constant that used to sit here.
      let cacheHits = 0;
      let cacheMisses = 0;
      const userCacheStats = {};

      if (cacheRes && cacheRes.ok) {
        try {
          const cacheJson = await cacheRes.json();
          for (const dim of cacheJson?.environments?.[0]?.dimensions || []) {
            const rawUser = dim.individualNames?.[0] || dim.name?.split(',')[0] || '(not set)';
            const rawStatus = dim.individualNames?.[1] || dim.name?.split(',')[1] || '(not set)';

            const isAbsent = (v) => !v || v === '(not set)' || v === 'null' || v === 'undefined';
            const userEmail = isAbsent(rawUser) ? 'anonymous.caller@external.client' : rawUser;
            const status = String(rawStatus || '').toUpperCase();

            const n = Number(dim.metrics?.find((m) => m.name === 'sum(message_count)')?.values?.[0] || 0);
            if (n <= 0) continue;

            const emailKey = userEmail.toLowerCase();
            if (!userCacheStats[emailKey]) {
              userCacheStats[emailKey] = { hits: 0, misses: 0, disabled: 0, notSet: 0 };
            }

            if (status === 'HIT') {
              cacheHits += n;
              userCacheStats[emailKey].hits += n;
            } else if (status === 'MISS') {
              cacheMisses += n;
              userCacheStats[emailKey].misses += n;
            } else if (status === 'DISABLED') {
              userCacheStats[emailKey].disabled += n;
            } else {
              userCacheStats[emailKey].notSet += n;
            }
          }
        } catch { }
      }
      const cacheMeasured = cacheHits + cacheMisses;
      const cacheHitRate = cacheMeasured > 0 ? Number(((cacheHits / cacheMeasured) * 100).toFixed(1)) : null;

      const totalCalls = totalTraffic;
      // null, not 99: a "99% success rate" over zero traffic is a fabrication. The UI renders an em dash.
      const slaHealth = totalProxyCalls > 0 ? Math.round((1 - totalProxyErrors / totalProxyCalls) * 100) : null;
      // null, not 78.5: with no traffic there is no routing split to report.
      const flashRatio = (flashCalls + proCalls) > 0 ? Number(((flashCalls / (flashCalls + proCalls)) * 100).toFixed(1)) : null;

      res.end(JSON.stringify({
        status: 'ok',
        source: 'Apigee Analytics Management API',
        org,
        env: apigeeEnv,
        timeRange: rangeParam,
        apigeeTimeRange,
        metaData: {
          notices: statsData?.metaData?.notices || ['Source:ApigeeAnalytics'],
        },
        kpis: {
          totalCalls,
          totalTokens: totalPromptTokens + totalCandidateTokens,
          inputTokens: totalPromptTokens,
          outputTokens: totalCandidateTokens,
          totalSpendUsd: Number(totalCostUsd.toFixed(2)),
          // Savings are only claimed for calls actually served from cache. The old figure
          // was 35% of total spend regardless of whether anything was cached at all.
          //
          // The denominator is the number of calls that actually reached a model
          // (everything except the cache hits, which cost nothing), so the quotient is a
          // real average price per model call. Dividing by cacheMisses alone would treat
          // the whole window's spend as the cost of the handful of measured misses.
          cacheCostSavingsUsd:
            cacheHitRate === null || cacheHits === 0
              ? null
              : Number(((totalCostUsd / Math.max(1, totalCalls - cacheHits)) * cacheHits).toFixed(2)),
          cacheHitRate,
          cacheHitCount: cacheMeasured > 0 ? cacheHits : null,
          cacheMeasuredCalls: cacheMeasured > 0 ? cacheMeasured : null,
          slaHealth,
          avgLatencyMs,
          isErrorCount: totalProxyErrors,
          // Errors that carry a dc_user_email and can therefore be shown per user. Windows that
          // predate the DefaultFaultRule will report 0 here while isErrorCount is non-zero.
          attributedErrorCount: totalAttributedErrors,
        },
        routing: {
          flashCalls,
          flashPercent: flashRatio,
          proOpusCalls: proCalls,
          proOpusPercent: flashRatio === null ? null : Number((100 - flashRatio).toFixed(1)),
        },
        consumptionRows,
        userCacheStats,
      }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 10. /api/monetization/attributions
  if (pathname === '/api/monetization/attributions') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const org = APIGEE_ORG;
    try {
      const devListRes = await fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const devData = await devListRes.json();
      const developers = devData.developer || [];

      // Per-developer usage, priced from the live KVM rate card.
      //
      // This previously selected only total tokens and multiplied by a flat $0.75/M, a rate
      // that appears nowhere in the rate card and matches no actual model. Breaking the query
      // down by model lets each model be charged at its real input/output prices, the same way
      // /api/analytics/fleet-stats does.
      //
      // The apiproxy filter matters here for the same reason it does there: dc_user_email is
      // environment-wide, so without it `mcp` traffic is attributed to AI Gateway spend.
      let statsByUser = {};
      try {
        const dynamicRange = getApigeeTimeRange('30d');
        const monFilter = encodeURIComponent(`(apiproxy eq 'ai-gateway-v1')`);
        const sUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/prod/stats/dc_user_email,dc_model_name?select=sum(message_count),sum(dc_total_token_count),sum(dc_prompt_token_count),sum(dc_candidates_token_count)&timeRange=${encodeURIComponent(dynamicRange)}&filter=${monFilter}`;
        const rcUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/prod/keyvaluemaps/ai-model-rates/entries/rate_card`;
        const [sRes, rcRes] = await Promise.all([
          fetch(sUrl, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(rcUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        ]);

        let monRates = {};
        if (rcRes && rcRes.ok) {
          try {
            const rcJson = await rcRes.json();
            monRates = typeof rcJson.value === 'string' ? JSON.parse(rcJson.value) : rcJson.value || {};
          } catch { }
        }

        if (sRes.ok) {
          const sData = await sRes.json();
          const dims = sData.environments?.[0]?.dimensions || [];
          for (const d of dims) {
            const names = d.individualNames || String(d.name || '').split(',');
            const email = names[0];
            const model = names[1] || '';
            if (!email || email === '(not set)' || email === 'null') continue;

            const calls = Number(d.metrics?.find((m) => m.name === 'sum(message_count)')?.values?.[0] || 0);
            const tokens = Number(d.metrics?.find((m) => m.name === 'sum(dc_total_token_count)')?.values?.[0] || 0);
            const pt = Number(d.metrics?.find((m) => m.name === 'sum(dc_prompt_token_count)')?.values?.[0] || 0);
            const ct = Number(d.metrics?.find((m) => m.name === 'sum(dc_candidates_token_count)')?.values?.[0] || 0);

            // Longest matching key wins, and the fallback is the card's own 'default' rather
            // than a guess keyed off the model name — 'flash' does not imply cheap here.
            const rateKey = Object.keys(monRates)
              .filter((k) => k !== 'default' && (model === k || model.startsWith(k)))
              .sort((a, b) => b.length - a.length)[0];
            const matched = (rateKey ? monRates[rateKey] : null) || monRates[model] || monRates['default'] || {};
            const inRate = matched.input ?? 0.15;
            const outRate = matched.output ?? 0.60;
            const cost = (pt / 1_000_000) * inRate + (ct / 1_000_000) * outRate;

            const acc = statsByUser[email] || { calls: 0, tokens: 0, costUsd: 0 };
            acc.calls += calls;
            acc.tokens += tokens;
            acc.costUsd += cost;
            statsByUser[email] = acc;
          }
        }
      } catch { }

      const attributions = await Promise.all(
        developers.map(async (d) => {
          const email = d.email;
          let balanceUsd = 0;
          let hasWallet = false;
          let resolvedBillingType = 'PREPAID';
          let apps = [];
          let firstName = '';
          let lastName = '';

          try {
            const [balRes, detRes, cfgRes] = await Promise.all([
              fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/balance`, {
                headers: { Authorization: `Bearer ${token}` },
              }),
              fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}`, {
                headers: { Authorization: `Bearer ${token}` },
              }),
              fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/monetizationConfig`, {
                headers: { Authorization: `Bearer ${token}` },
              }),
            ]);

            if (balRes.ok) {
              const bJson = await balRes.json();
              const primaryWallet = bJson.wallets?.[0];
              if (primaryWallet?.balance) {
                hasWallet = true;
                const units = Number(primaryWallet.balance.units || 0);
                const nanos = Number(primaryWallet.balance.nanos || 0);
                const rawTotal = units + nanos / 1e9;
                const sessionDebit = sessionLedgerByDev.get(email.toLowerCase())?.debitedUsd || 0;
                balanceUsd = Number(Math.max(0, rawTotal - sessionDebit).toFixed(6));
              }
            }

            if (cfgRes.ok) {
              const cJson = await cfgRes.json();
              if (cJson.billingType) {
                resolvedBillingType = cJson.billingType;
              }
            } else {
              resolvedBillingType = hasWallet ? 'PREPAID' : 'POSTPAID';
            }

            if (detRes.ok) {
              const dJson = await detRes.json();
              apps = dJson.apps || [];
              firstName = dJson.firstName || '';
              lastName = dJson.lastName || '';
              const unameLower = email.split('@')[0].toLowerCase();
              const isBadName =
                lastName === 'Google' ||
                lastName === 'User' ||
                firstName.toLowerCase() === unameLower;
              if (isBadName) {
                const healed = await resolveUserFullName(email, '', '', '', token);
                if (healed?.firstName) {
                  firstName = healed.firstName;
                  lastName = healed.lastName || '';
                  dJson.firstName = firstName;
                  dJson.lastName = lastName || firstName;
                  fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(dJson),
                  }).catch(() => {});
                }
              }
            }
          } catch { }

          const cleanLast = lastName === 'Google' || lastName === 'User' ? '' : lastName;
          const fullName =
            firstName && cleanLast && firstName !== cleanLast
              ? `${firstName} ${cleanLast}`
              : firstName || email.split('@')[0];
          const personaTier = personaTierForApps(apps);
          const userStats = statsByUser[email] || { calls: 0, tokens: 0, costUsd: 0 };
          const sessionDebit = sessionLedgerByDev.get(email.toLowerCase())?.debitedUsd || 0;

          // Measured usage only.
          //
          // These two lines used to be Math.max(measured, walletConsumedUsd * 16) and
          // Math.max(measured, walletConsumedUsd * 48500) — synthetic floors that invented a
          // call and token count for any developer whose prepaid balance had moved. A
          // developer with an untracked wallet debit now simply shows the traffic Apigee
          // actually recorded, which may be less than their wallet spend implies. That gap is
          // real and worth seeing; papering over it was the bug.
          const totalCalls = userStats.calls;
          const totalTokens = userStats.tokens;

          // Spend priced from the KVM rate card per model, plus this session's live debits.
          const consumedUsd = Number((userStats.costUsd + sessionDebit).toFixed(6));

          return {
            userEmail: email,
            name: fullName,
            tier: personaTier,
            badge: resolvedBillingType === 'PREPAID' ? 'Prepaid Wallet' : 'Postpaid Plan',
            billingType: resolvedBillingType,
            totalConsumedUsd: consumedUsd,
            totalCalls,
            totalTokens,
            currentBalanceUsd: balanceUsd,
            allocatedBudgetUsd: allocatedBudgetFor(hasWallet, balanceUsd, consumedUsd),
            lastActive: hasWallet ? 'Active Wallet' : 'Registered',
          };
        })
      );

      attributions.sort((a, b) => {
        const nameA = (a.name || a.userEmail).toLowerCase();
        const nameB = (b.name || b.userEmail).toLowerCase();
        const cmp = nameA.localeCompare(nameB);
        return cmp !== 0 ? cmp : a.userEmail.localeCompare(b.userEmail);
      });

      res.end(JSON.stringify({ status: 'ok', attributions }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Per-call audit log view: Cloud Logging entries for one user + model pair.
  // Backs the "View Logs" link in the Model Consumption Ledger.
  if (pathname === '/api/logs/calls') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const userEmail = (parsedUrl.searchParams.get('user') || '').trim();
    const model = (parsedUrl.searchParams.get('model') || '').trim();
    const windowParam = (parsedUrl.searchParams.get('window') || '24h').trim();

    // These values are interpolated into a Cloud Logging filter expression.
    // Validate against strict allowlists instead of escaping: a double quote
    // or a boolean operator in either field would otherwise let a caller
    // rewrite the filter and read log entries belonging to other users.
    const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const MODEL_RE = /^[A-Za-z0-9._@-]{1,100}$/;
    const WINDOWS = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };

    if (userEmail && !EMAIL_RE.test(userEmail)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid user parameter' }));
      return;
    }
    if (model && !MODEL_RE.test(model)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid model parameter' }));
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(WINDOWS, windowParam)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid window parameter' }));
      return;
    }

    const token = await getGcpAccessToken();
    if (!token) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Could not obtain GCP access token' }));
      return;
    }

    const project = GCP_PROJECT_ID;
    const sinceIso = new Date(Date.now() - WINDOWS[windowParam] * 3600 * 1000).toISOString();

    const filterParts = [
      `logName="projects/${project}/logs/apigee"`,
      `timestamp>="${sinceIso}"`,
    ];
    if (userEmail) filterParts.push(`jsonPayload.userEmail="${userEmail}"`);
    // Model Armor (SUP-UserPrompt) faults in PreFlow *before* the target model
    // is resolved, so a blocked call carries only the path-derived
    // `requestedModel`. Match either field or blocked calls would silently
    // vanish from this view.
    if (model) {
      filterParts.push(
        `(jsonPayload.model="${model}" OR jsonPayload.requestedModel="${model}")`
      );
    }
    const filter = filterParts.join(' AND ');

    try {
      const logRes = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceNames: [`projects/${project}`],
          filter,
          orderBy: 'timestamp desc',
          pageSize: 100,
        }),
      });

      if (!logRes.ok) {
        const detail = await logRes.text();
        res.statusCode = logRes.status;
        res.end(JSON.stringify({ error: 'Cloud Logging query failed', detail: detail.slice(0, 500) }));
        return;
      }

      const data = await logRes.json();
      const entries = (data.entries || []).map((e) => {
        const p = e.jsonPayload || {};
        const num = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };
        // Latency: prefer the client round trip, fall back to the target leg.
        const start = num(p.clientReceivedStartTimeEpoch);
        const end = num(p.clientReceivedEndTimeEpoch);
        const latencyMs = start > 0 && end >= start ? end - start : null;

        return {
          timestamp: e.timestamp || null,
          trackingId: p.trackingId || '',
          userEmail: p.userEmail || '',
          model: p.model || '',
          provider: p.targetProvider || '',
          // The proxy logs the Gemini-shaped field first and the Anthropic
          // shape as a fallback; exactly one of them resolves per call.
          prompt: p.prompt || '',
          response: p.response || p.responseClaude || '',
          // On a fault the response status variable never resolves; the real
          // HTTP code lands in error.status.code instead.
          status: num(p.responseStatusCode) || num(p.errorStatusCode),
          costUsd: num(p.costUsd),
          promptTokens: num(p.promptTokens),
          candidatesTokens: num(p.candidatesTokens),
          totalTokens: num(p.totalTokens),
          autoRouted: String(p.autoRouted || '') === 'true',
          cached: String(p.cached || '') === 'true',
          latencyMs,
          faultName: p.faultName || '',
          errorMessage: p.errorMessage || '',
          pathSuffix: p.proxyPathSuffix || '',
          environment: p.environmentName || '',
        };
      });

      // Deep link into the Cloud Logging console for anything not shown here.
      const consoleUrl =
        `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(filter)}` +
        `?project=${project}`;

      res.end(JSON.stringify({ status: 'ok', count: entries.length, window: windowParam, entries, consoleUrl }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 12. /api/products and 13. /api/products/reset -- Dev/Prod console rules
  // (prod read-only, dev = "(Dev)" sandbox products) live in server/consoleEnv.js,
  // shared with vite.config.ts.
  if (pathname === '/api/products') {
    await handleConsoleProducts(req, res, { parsedUrl, getToken: getGcpAccessToken, defaultProducts: DEFAULT_PRODUCTS });
    return;
  }
  if (pathname === '/api/products/reset') {
    await handleConsoleProductsReset(req, res, { parsedUrl, getToken: getGcpAccessToken, defaultProducts: DEFAULT_PRODUCTS });
    return;
  }

  // 14. /api/admin-agent/* -- Ask Apigee (see server/adminAgentService.js).
  // Mounted ahead of the reverse proxies and the SPA fallback so an unknown
  // sub-path answers with a structured JSON error instead of index.html.
  if (pathname === '/api/admin-agent' || pathname.startsWith('/api/admin-agent/')) {
    await adminAgentService.handleRequest(req, res, parsedUrl);
    return;
  }

  // 15. /api/agent-showcase/* -- baseline vs governed agents, streamed (server/agentShowcase.js).
  if (pathname === '/api/agent-showcase' || pathname.startsWith('/api/agent-showcase/')) {
    await agentShowcaseService.handleRequest(req, res, parsedUrl);
    return;
  }

  // 17. /api/model-watch[/run] -- daily pricing & model changes (server/modelWatch.js).
  if (pathname === '/api/model-watch' || pathname.startsWith('/api/model-watch/')) {
    await modelWatchService.handleRequest(req, res, parsedUrl);
    return;
  }

  // 16. /api/themes/* -- customer theme library in GCS (server/themeLibrary.js).
  if (pathname === '/api/themes' || pathname.startsWith('/api/themes/')) {
    await themeLibraryService.handleRequest(req, res, parsedUrl);
    return;
  }

  // Reverse proxy routes for Apigee Gateway
  if (pathname.startsWith('/api/ai-dev')) {
    const targetPath = pathname.replace(/^\/api\/ai-dev/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_DEV}/ai/v1${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/ai-prod')) {
    const targetPath = pathname.replace(/^\/api\/ai-prod/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_PROD}/ai/v1${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/mcp-dev')) {
    const targetPath = pathname.replace(/^\/api\/mcp-dev/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_DEV}/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/mcp-prod')) {
    const targetPath = pathname.replace(/^\/api\/mcp-prod/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_PROD}/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/bigquery-mcp-dev')) {
    const targetPath = pathname.replace(/^\/api\/bigquery-mcp-dev/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_DEV}/bigquery/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/bigquery-mcp-prod')) {
    const targetPath = pathname.replace(/^\/api\/bigquery-mcp-prod/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_PROD}/bigquery/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/servicenow-mcp-dev')) {
    const targetPath = pathname.replace(/^\/api\/servicenow-mcp-dev/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_DEV}/servicenow/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  if (pathname.startsWith('/api/servicenow-mcp-prod')) {
    const targetPath = pathname.replace(/^\/api\/servicenow-mcp-prod/, '');
    await proxyRequest(req, res, `${APIGEE_BASE_PROD}/servicenow/mcp${targetPath}${parsedUrl.search}`);
    return;
  }

  // Industry pack MCP proxies (<id>-mcp at /<id>/mcp), one per industry pack.
  const industryUpstream = industryMcpUpstream(pathname);
  if (industryUpstream) {
    await proxyRequest(req, res, `${industryUpstream}${parsedUrl.search}`);
    return;
  }

  // Serve static SPA files from dist/
  let filePath = path.join(DIST_DIR, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.setHeader('Content-Type', contentType);
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (pathname.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.end(content);
  } catch (err) {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Production Node server listening on port ${PORT}`);
});
