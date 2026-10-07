import { GCP_PROJECT_ID, APIGEE_ORG, APIGEE_BASE_PROD, APIGEE_BASE_DEV, AI_BASE_PROD, AI_BASE_DEV, SSO_USER_EMAIL, DEMO_ADMIN_EMAIL, PERSONA_APP_DEVELOPERS, UI_MGMT_SA, publicRuntimeConfig } from './server/deployConfig.js';
import { defineConfig, loadEnv } from 'vite'
import { APIGEE_HOSTS } from './server/industryMcp.js'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
// @ts-ignore -- plain-JS ESM module shared with server.js (no .d.ts).
import { createAdminAgentService } from './server/adminAgentService.js'
import { createAgentShowcaseService } from './server/agentShowcase.js'
import { createThemeLibraryService } from './server/themeLibrary.js'
import { handleReloadHint } from './server/reloadHint.js'
import { mintSyntheticIdentityToken } from './server/adminAgentCore.js'
import { applyLedgerToBalance, fetchApigeeWallet, recordDebit } from './server/walletLedger.js'
import { buildToolsAnalytics, toolsStatsUrl } from './server/toolsAnalytics.js'
import { handleToolLogs } from './server/toolLogs.js'
import { handleAgentAnalytics } from './server/agentAnalytics.js'
import { handleDemoReset } from './server/demoReset.js'
import { DEFAULT_PRODUCTS } from './server/defaultProducts.js'
import { PERSONA_PRODUCTS, personaTierForApps } from './server/personas.js'
import { ADMIN_APP_PRODUCTS, requiredSubscriptionsFor, syncAdminAppProducts } from './server/personaProvisioning.js'
import { handleConsoleProducts, handleConsoleProductsReset, normalizeConsoleEnv, consoleWriteGuard } from './server/consoleEnv.js'

// In-memory token cache for Apigee Management API
let cachedToken = ''
let tokenExpiry = 0

// Real-time session debit ledger per developer email to bridge Apigee's 15-min Analytics settlement window
const sessionLedgerByDev = new Map<string, { debitedUsd: number; lastCreditTimeSeen: string }>()

// Mirrors server.js. This dev middleware reimplements the production /api surface, so the
// two must agree; changing one without the other makes `npm run dev` and `node server.js`
// disagree about what the Monetization tab shows.
//
// Demo constant: the prepaid wallet each new developer is credited on onboarding. It is NOT
// the gateway budget cap, which is enforced by QC-EnforceBudgetLimit / RF-BudgetExceeded from
// the per-product developer.budget.limit attribute. provision_unified_credentials.py credits
// the same $20.
const PREPAID_STARTING_BALANCE_USD = 20
// Untouched wallets can report fractionally above the credited amount, so exact equality
// would misclassify them as partially spent.
const PREPAID_BALANCE_EPSILON_USD = 0.05

/** The denominator behind the "spent X of Y" reading in the Monetization tab. */
function allocatedBudgetFor(hasWallet: boolean, balanceUsd: number, consumedUsd: number): number {
  if (hasWallet && balanceUsd <= PREPAID_STARTING_BALANCE_USD + PREPAID_BALANCE_EPSILON_USD) {
    return PREPAID_STARTING_BALANCE_USD
  }
  if (balanceUsd > 0) {
    return Number((balanceUsd + consumedUsd).toFixed(2))
  }
  return PREPAID_STARTING_BALANCE_USD
}

// Canonical persona product definitions live in server/defaultProducts.js (mirrors apigee/products).

async function getGcpAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < tokenExpiry) {
    return cachedToken
  }

  // 1. Optional explicit GOOGLE_APPLICATION_CREDENTIALS (never use repo-local key files)
  const keyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean) as string[];

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
              tokenExpiry = now + 50 * 60 * 1000; // Cache for 50 minutes
              return cachedToken;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Vite Server] Failed SA key auth at ${keyPath}:`, err.message);
      }
    }
  }

  // 2. Query Cloud Run / Compute Metadata Server (for Cloud Run deployments)
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

  // 3. Fallback to gcloud SA impersonation or print-access-token
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
  } catch (err: any) {
    console.error('[Vite Server] Failed to get gcloud auth token:', err.message);
    return '';
  }
}

// In-memory identity token cache for SSO local testing
let cachedIdToken = ''
let cachedIdEmail = ''
let cachedIdName = ''
let idTokenExpiry = 0

function getGcpIdentityToken(): { token: string; email: string; name: string } {
  const now = Date.now()
  if (cachedIdToken && now < idTokenExpiry) {
    return { token: cachedIdToken, email: cachedIdEmail, name: cachedIdName }
  }
  try {
    const rawToken = execSync('gcloud auth print-identity-token 2>/dev/null').toString().trim()
    if (rawToken) {
      cachedIdToken = rawToken
      idTokenExpiry = now + 4 * 60 * 1000 // Cache for 4 minutes
      try {
        const payload = JSON.parse(Buffer.from(rawToken.split('.')[1], 'base64').toString('utf8'))
        cachedIdEmail = payload.email || ''
        cachedIdName = payload.name || payload.given_name || (payload.email ? payload.email.split('@')[0] : '')
      } catch {
        cachedIdEmail = ''
        cachedIdName = ''
      }
      return { token: cachedIdToken, email: cachedIdEmail, name: cachedIdName }
    }
  } catch (err: any) {
    console.warn('[Vite Server] Note: gcloud identity token not available:', err.message)
  }
  return { token: '', email: '', name: '' }
}

async function fetchAppConsumerKey(org: string, token: string, devEmail: string, appName: string): Promise<string> {
  try {
    const res = await fetch(
      `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(devEmail)}/apps/${encodeURIComponent(appName)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const cred = data.credentials?.find((c: any) => c.status === 'approved') || data.credentials?.[0];
      return cred?.consumerKey || '';
    }
  } catch (err: any) {
    console.warn(`[Vite Server] Failed to fetch key for ${appName}:`, err.message);
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

const geminiNameCache = new Map<string, { firstName: string; lastName: string; fullName: string }>();

async function parseEmailHandleWithGemini(
  email: string,
  token: string
): Promise<{ firstName: string; lastName: string; fullName: string } | null> {
  if (!email || !token) return null;
  const cacheKey = email.toLowerCase();
  if (geminiNameCache.has(cacheKey)) return geminiNameCache.get(cacheKey)!;

  try {
    // Direct Vertex call, deliberately NOT through the AI Gateway: this is incidental UI
    // plumbing, and routing it through the proxy would pollute demo analytics and burn
    // token quota on name parsing. Because it bypasses the gateway, retiring a model from
    // the API Products does not stop it -- it would just have started 404ing on
    // gemini-2.5-flash's 2026-10-20 end of life, silently degrading sign-in names.
    const url =
      `https://aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/global/publishers/google/models/gemini-3.1-flash-lite:generateContent`;
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

function extractNameFromJwt(
  jwtString?: string | string[]
): { firstName: string; lastName: string; fullName: string } | null {
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

async function resolveUserFullName(
  email: string,
  iapJwtHeader: string,
  fallbackName: string,
  authHeader = '',
  token = ''
): Promise<{ firstName: string; lastName: string; fullName: string }> {
  const username = (email || '').split('@')[0].toLowerCase() || 'admin';
  const fromIapJwt = extractNameFromJwt(iapJwtHeader);
  if (fromIapJwt) return fromIapJwt;
  const fromAuthJwt = extractNameFromJwt(authHeader);
  if (fromAuthJwt) return fromAuthJwt;

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

  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  if (username.includes('.') || username.includes('_')) {
    const parts = username.split(/[._]/).filter(Boolean).map(cap);
    const firstName = parts[0] || cap(username);
    const lastName = parts.slice(1).join(' ') || '';
    return { firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(' ') };
  }
  if (
    fallbackName &&
    fallbackName.includes(' ') &&
    !fallbackName.endsWith(' User') &&
    !fallbackName.endsWith(' Google')
  ) {
    const split = fallbackName.trim().split(/\s+/);
    return { firstName: split[0], lastName: split.slice(1).join(' '), fullName: fallbackName.trim() };
  }
  if (token) {
    const geminiParsed = await parseEmailHandleWithGemini(email, token);
    if (geminiParsed) return geminiParsed;
  }
  const firstName = cap(username.replace(/^the/i, ''));
  return { firstName, lastName: '', fullName: firstName };
}

async function provisionUserDeveloperAndApp(
  org: string,
  token: string,
  email: string,
  name: string,
  iapJwtHeader = '',
  authHeader = '',
  options: { allowCreate?: boolean; explicitFirstName?: string; explicitLastName?: string } = {
    allowCreate: false,
    explicitFirstName: '',
    explicitLastName: '',
  }
): Promise<{
  apiKey: string;
  apiKeys: Record<string, string>;
  username: string;
  fullName: string;
  needsOnboarding?: boolean;
  suggestedFirstName?: string;
  suggestedLastName?: string;
}> {
  const resolved = await resolveUserFullName(email, iapJwtHeader, name, authHeader, token);
  if (!email || !token) {
    return { apiKey: '', apiKeys: {}, username: '', fullName: resolved.fullName };
  }

  const username = email.split('@')[0] || 'admin';
  let firstName = options.explicitFirstName ? options.explicitFirstName.trim() : resolved.firstName;
  let lastName = options.explicitLastName ? options.explicitLastName.trim() : resolved.lastName;
  let fullName = firstName === lastName || !lastName ? firstName : `${firstName} ${lastName}`.trim();
  const apiKeys: Record<string, string> = { admin: '', sales_agent: '', loans_agent: '' };

  try {
    // 1. Check if Developer exists; if not create Developer
    const devUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}`;
    const devRes = await fetch(devUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (devRes.status === 404) {
      if (!options.allowCreate) {
        console.log(`[Vite Server] Developer ${email} not found (404). Returning needsOnboarding=true with suggested name: ${firstName} ${lastName}`);
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
      console.log(`[Vite Server] Creating developer ${email} with validated name ${firstName} ${lastName}...`);
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
        console.log(`[Vite Server] Updating existing developer name for ${email}: ${existingFirst} ${existingLast} -> ${firstName} ${lastName}`);
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

    // 2. Provision/fetch user-specific Admin app (Unified Admin <USERNAME> App)
    const targetAppName = `Unified Admin ${username} App`;
    const appsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/apps?expand=true`;
    const appsRes = await fetch(appsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const appsList = appsRes.ok ? (await appsRes.json()).app || [] : [];

    let matchedApp = appsList.find(
      (a: any) =>
        a.name === targetAppName ||
        a.name.startsWith(targetAppName)
    );

    if (!matchedApp) {
      console.log(`[Vite Server] Creating app ${targetAppName} for ${email}...`);
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
            displayName: targetAppName,
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
      const existingProducts = new Set<string>();
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
        (a: any) => (a.name === 'DisplayName' || a.name === 'displayName') && a.value
      );

      if (missingProducts.length > 0 || !hasDisplayNameAttr) {
        console.log(`[Vite Server] Ensuring app ${matchedApp.name} has required products and displayName...`);
        const updatedProducts = Array.from(new Set([...existingProducts, ...requiredProducts]));
        const existingAttrs = matchedApp.attributes || [];
        const mergedAttrs = existingAttrs.filter((a: any) => a.name !== 'DisplayName' && a.name !== 'displayName');
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
              displayName: matchedApp.name,
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
      const approvedCred = matchedApp.credentials.find((c: any) => c.status === 'approved') || matchedApp.credentials[0];
      if (approvedCred && approvedCred.consumerKey) {
        apiKeys.admin = approvedCred.consumerKey;
      }
    }

    // 3. Fetch existing global keys for Sales and Loans apps (owned by PERSONA_APP_DEVELOPER, falling back to DEMO_ADMIN_EMAIL)
    apiKeys.sales_agent =
      await fetchPersonaAppKey(org, token, 'Unified Sales App');
    apiKeys.loans_agent =
      await fetchPersonaAppKey(org, token, 'Unified Loans App');

    // 4. Check if developer is a prepaid user; if not register as prepaid, add $20 starting balance
    const cfgUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/monetizationConfig`;
    const cfgRes = await fetch(cfgUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (cfgRes.ok) {
      const cfgData = await cfgRes.json();
      if (cfgData.billingType !== 'PREPAID') {
        console.log(`[Vite Server] Setting monetizationConfig PREPAID for ${email}...`);
        await fetch(cfgUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ billingType: 'PREPAID' }),
        });
      }
    } else if (cfgRes.status === 404) {
      console.log(`[Vite Server] Initializing monetizationConfig PREPAID for ${email}...`);
      await fetch(cfgUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ billingType: 'PREPAID' }),
      });
    }

    // Check balance
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
      console.log(`[Vite Server] Adding $${PREPAID_STARTING_BALANCE_USD} starting balance for developer ${email}...`);
      const creditUrl = `https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(email)}/balance:credit`;
      await fetch(creditUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
    const existingProducts = new Set<string>();
    if (subsRes.ok) {
      const subsData = await subsRes.json();
      for (const s of subsData.developerSubscriptions || []) {
        if (s.apiproduct && !s.endTime) existingProducts.add(s.apiproduct);
      }
    }
    const requiredProducts = requiredSubscriptionsFor(email);
    for (const product of requiredProducts) {
      if (!existingProducts.has(product)) {
        console.log(`[Vite Server] Auto-subscribing developer ${email} to ${product}...`);
        await fetch(subsUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiproduct: product }),
        });
      }
    }

    return { apiKey: apiKeys.admin || '', apiKeys, username, fullName };
  } catch (err: any) {
    console.error('[Vite Server] Error provisioning user developer and apps:', err.message);
    return { apiKey: '', apiKeys: {}, username, fullName };
  }
}

function getApigeeTimeRange(rangeParam: string): string {
  const now = new Date();
  let days = 7;
  if (rangeParam === '24h') days = 1;
  else if (rangeParam === '30d') days = 30;

  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  const fmt = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${fmt(start)}~${fmt(now)}`;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      {
        name: 'iap-me-endpoint',
        configureServer(server) {
          // Same runtime config as server.js (/env-config.js), built from .env.
          server.middlewares.use('/env-config.js', (_req: any, res: any) => {
            res.setHeader('Content-Type', 'text/javascript');
            res.setHeader('Cache-Control', 'no-store');
            res.end(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(publicRuntimeConfig())};`);
          });
          const handleOnboardOrProfile = async (req: any, res: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            if (req.method !== 'POST' && req.method !== 'PUT') {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST or PUT.' }));
              return;
            }

            let body = '';
            req.on('data', (chunk: any) => { body += chunk; });
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
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          };

          server.middlewares.use('/api/me/onboard', handleOnboardOrProfile);
          server.middlewares.use('/api/me/profile', handleOnboardOrProfile);

          server.middlewares.use('/api/me', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            if (parsedUrl.searchParams.get('refresh') === 'true') {
              idTokenExpiry = 0;
              cachedIdToken = '';
            }

            const queryEmail = parsedUrl.searchParams.get('email') || '';
            const incomingHeader = (req.headers['x-goog-authenticated-user-email'] as string) || '';
            const iapJwtHeader = (req.headers['x-goog-iap-jwt-assertion'] as string) || '';
            const reqAuthHeader = (req.headers['authorization'] as string) || '';
            const cleanHeader = incomingHeader.replace(/^accounts\.google\.com:/, '').trim();

            // Obtain SSO identity token from gcloud for local testing
            const sso = getGcpIdentityToken();
            const saToken = await getGcpAccessToken();

            const email = (queryEmail || cleanHeader || sso.email || SSO_USER_EMAIL).trim();
            // In local dev, if email matches gcloud user, use gcloud access token to resolve OAuth2 userinfo profile name
            const effectiveAuthHeader = reqAuthHeader || (saToken && (!queryEmail || queryEmail === sso.email) ? `Bearer ${saToken}` : '');
            const resolvedName = await resolveUserFullName(email, iapJwtHeader, sso.name || '', effectiveAuthHeader);
            let name = resolvedName.fullName || (email ? email.split('@')[0] : 'SSO User');

            let apiKey = '';
            let apiKeys: Record<string, string> = {};
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
                effectiveAuthHeader,
                { allowCreate: false }
              );
              if (provResult.needsOnboarding) {
                needsOnboarding = true;
                suggestedFirstName = provResult.suggestedFirstName || suggestedFirstName;
                suggestedLastName = provResult.suggestedLastName || suggestedLastName;
              }
              if (provResult.apiKey) {
                apiKey = provResult.apiKey;
              }
              if (provResult.apiKeys) {
                apiKeys = provResult.apiKeys;
              }
              if (provResult.username) {
                username = provResult.username;
              }
              if (provResult.fullName) {
                name = provResult.fullName;
              }
            }

            res.end(JSON.stringify({
              email,
              token: sso.token || '',
              name,
              username,
              apiKey,
              apiKeys,
              needsOnboarding,
              suggestedFirstName,
              suggestedLastName,
              provider: sso.token ? 'Google Cloud Identity SSO (gcloud)' : 'Google Cloud Identity SSO (IAP)',
              raw: incomingHeader,
            }));
          });

          server.middlewares.use('/api/kvm/rates', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const envParam = parsedUrl.searchParams.get('env') || 'prod';
            const apigeeEnv = envParam === 'dev' || envParam === 'bap' ? 'dev' : 'prod';
            const org = APIGEE_ORG;
            const kvmName = 'ai-model-rates';
            const entryKey = 'rate_card';

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
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
                  res.end(JSON.stringify({ error: `Apigee KVM error (${apiRes.status}): ${errText}` }));
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
              } catch (err: any) {
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
                    res.end(JSON.stringify({ error: `Failed to update Apigee KVM (${updateRes.status}): ${errText}` }));
                    return;
                  }

                  res.end(JSON.stringify({
                    status: 'ok',
                    env: targetEnv,
                    message: `Successfully updated ${entryKey} in ${targetEnv} KVM`,
                    rates: newRates,
                    updatedAt: new Date().toISOString(),
                  }));
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
            } else {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            }
          });

          // Apigee Monetization balance inspection
          server.middlewares.use('/api/monetization/balance', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const dev = parsedUrl.searchParams.get('dev') || env.DEV_EMAIL || DEMO_ADMIN_EMAIL;
            const org = APIGEE_ORG;

            try {
              const apiRes = await fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers/${encodeURIComponent(dev)}/balance`, {
                headers: { Authorization: `Bearer ${token}` },
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
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          // Real-time session wallet debit
          server.middlewares.use('/api/monetization/debit', async (req, res) => {
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
                const dev = (payload.developer || env.DEV_EMAIL || DEMO_ADMIN_EMAIL).toLowerCase();
                // Starting balance is read from Apigee here, never taken from the client.
                const token = await getGcpAccessToken();
                const wallet = await fetchApigeeWallet({ org: APIGEE_ORG, dev, token });
                const result = recordDebit(sessionLedgerByDev, dev, payload.amountUsd, wallet);
                res.end(JSON.stringify({ status: 'ok', ...result }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });

          // Apigee Monetization wallet credit / top-up
          server.middlewares.use('/api/monetization/credit', async (req, res) => {
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
                const dev = payload.developer || env.DEV_EMAIL || DEMO_ADMIN_EMAIL;
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
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });

          // Apigee Monetization published rate plans
          server.middlewares.use('/api/monetization/rateplans', async (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const org = APIGEE_ORG;
            const products = [...PERSONA_PRODUCTS];

            try {
              const allPlans: any[] = [];
              const prodPromises = products.map(async (prod) => {
                const rpListRes = await fetch(
                  `https://apigee.googleapis.com/v1/organizations/${org}/apiproducts/${encodeURIComponent(prod)}/rateplans`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (rpListRes.ok) {
                  const rpListData = await rpListRes.json();
                  const planItems = rpListData.ratePlans || [];
                  const planPromises = planItems.map(async (item: any) => {
                    try {
                      const planRes = await fetch(
                        `https://apigee.googleapis.com/v1/organizations/${org}/apiproducts/${encodeURIComponent(prod)}/rateplans/${item.name}`,
                        { headers: { Authorization: `Bearer ${token}` } }
                      );
                      if (planRes.ok) {
                        return await planRes.json();
                      }
                    } catch {}
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
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          // Apigee Monetization developer subscriptions
          server.middlewares.use('/api/monetization/subscriptions', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const dev = parsedUrl.searchParams.get('dev') || env.DEV_EMAIL || DEMO_ADMIN_EMAIL;
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
              } catch (err: any) {
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
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
            } else {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            }
          });

          // Apigee Monetization developer configuration (PREPAID vs POSTPAID)
          server.middlewares.use('/api/monetization/config', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const dev = parsedUrl.searchParams.get('dev') || env.DEV_EMAIL || DEMO_ADMIN_EMAIL;
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
              } catch (err: any) {
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
                } catch (err: any) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
            } else {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            }
          });

          // Tools (MCP) analytics — mirrors /api/analytics/tools-stats in server.js.
          server.middlewares.use('/api/analytics/tools-stats', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }
            const u = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const env = u.searchParams.get('env') === 'dev' ? 'dev' : 'prod';
            const handle = u.searchParams.get('handle') || undefined;
            const user = u.searchParams.get('user') || undefined;
            const apigeeTimeRange = getApigeeTimeRange(u.searchParams.get('timeRange') || '24h');
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
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          // Live Apigee Management API Fleet Analytics Endpoint
          // Per-call MCP logs (method, tool, outcome) from Cloud Logging; same module as server.js.
          server.middlewares.use('/api/logs/tools', async (req, res) => {
            const u = new URL((req as any).originalUrl || req.url || '/', `http://${req.headers.host || 'localhost'}`);
            await handleToolLogs(req, res, { parsedUrl: u, getToken: getGcpAccessToken });
          });

          // The Agent Showcase agents' history (Apigee stats + logs); same module as server.js.
          server.middlewares.use('/api/analytics/agent-stats', async (req, res) => {
            const u = new URL((req as any).originalUrl || req.url || '/', `http://${req.headers.host || 'localhost'}`);
            await handleAgentAnalytics(req, res, { parsedUrl: u, getToken: getGcpAccessToken });
          });

          // Restore the Customer Service API's seed data (demo start); same module as server.js.
          server.middlewares.use('/api/demo/reset', async (req, res) => {
            await handleDemoReset(req, res);
          });

          server.middlewares.use('/api/analytics/fleet-stats', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const rangeParam = parsedUrl.searchParams.get('timeRange') || '7d';
            const envParam = parsedUrl.searchParams.get('env') || 'prod';
            const org = APIGEE_ORG;
            const apigeeEnv = envParam === 'dev' || envParam === 'bap' ? 'dev' : 'prod';
            const apigeeTimeRange = getApigeeTimeRange(rangeParam);

            try {
              // 1. Fetch DataCapture stats (user email & model breakdown).
              // sum(is_error) is selected here as well as fleet-wide: the proxy's DefaultFaultRule
              // emits dc_user_email on faults, so blocked calls can be attributed to a caller.
              //
              // The apiproxy filter is load-bearing - the dc_user_email dimension is
              // environment-wide, so without it `mcp` traffic (which never sets dc_user_email)
              // lands in the `(not set)` bucket and is rendered as anonymous AI Gateway callers.
              const proxyFilter = encodeURIComponent(`(apiproxy eq 'ai-gateway-v1')`);
              const statsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/dc_user_email,dc_model_name?select=sum(message_count),sum(is_error),sum(dc_prompt_token_count),sum(dc_candidates_token_count),sum(dc_total_token_count)&timeRange=${encodeURIComponent(apigeeTimeRange)}&filter=${proxyFilter}`;

              // 2. Fetch Proxy stats (for overall SLA, latency, error count)
              const proxyStatsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/apiproxy?select=sum(message_count),sum(is_error),avg(total_response_time)&timeRange=${encodeURIComponent(apigeeTimeRange)}`;

              // 3. Fetch KVM Rates
              const kvmUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/keyvaluemaps/ai-model-rates/entries/rate_card`;

              // 4. Real semantic-cache signal: HIT / MISS / DISABLED per request broken down by user.
              const cacheStatsUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/${apigeeEnv}/stats/dc_user_email,dc_cache_status?select=sum(message_count)&timeRange=${encodeURIComponent(apigeeTimeRange)}&filter=${proxyFilter}`;

              const [statsRes, proxyRes, kvmRes, cacheRes] = await Promise.all([
                fetch(statsUrl, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(proxyStatsUrl, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(kvmUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
                fetch(cacheStatsUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
              ]);

              // Parse KVM rates
              let rates: Record<string, any> = {};
              if (kvmRes && kvmRes.ok) {
                try {
                  const kvmData = await kvmRes.json();
                  rates = typeof kvmData.value === 'string' ? JSON.parse(kvmData.value) : kvmData.value || {};
                } catch {}
              }

              // Parse Proxy stats for SLA and latency
              let totalProxyCalls = 0;
              let totalProxyErrors = 0;
              let avgLatencyMs = 380;
              if (proxyRes.ok) {
                const pData = await proxyRes.json();
                const dims = pData.environments?.[0]?.dimensions || [];
                const aiGatewayDim = dims.find((d: any) => d.name === 'ai-gateway-v1');
                if (aiGatewayDim) {
                  const mc = aiGatewayDim.metrics?.find((m: any) => m.name === 'sum(message_count)');
                  const ec = aiGatewayDim.metrics?.find((m: any) => m.name === 'sum(is_error)');
                  const lat = aiGatewayDim.metrics?.find((m: any) => m.name === 'avg(total_response_time)');
                  totalProxyCalls = Number(mc?.values?.[0] || 0);
                  totalProxyErrors = Number(ec?.values?.[0] || 0);
                  avgLatencyMs = Math.round(Number(lat?.values?.[0] || 380));
                }
              }

              // Parse DC stats
              const statsData = statsRes.ok ? await statsRes.json() : null;
              const rawDimensions = statsData?.environments?.[0]?.dimensions || [];

              let totalTraffic = 0;
              let totalPromptTokens = 0;
              let totalCandidateTokens = 0;
              let totalCostUsd = 0;
              let flashCalls = 0;
              let proCalls = 0;

              const consumptionRows: any[] = [];
              let totalAttributedErrors = 0;

              for (const dim of rawDimensions) {
                const rawUser = dim.individualNames?.[0] || dim.name?.split(',')[0] || '(not set)';
                const rawModel = dim.individualNames?.[1] || dim.name?.split(',')[1] || '(not set)';

                const mc = Number(dim.metrics?.find((m: any) => m.name === 'sum(message_count)')?.values?.[0] || 0);
                const ec = Number(dim.metrics?.find((m: any) => m.name === 'sum(is_error)')?.values?.[0] || 0);
                const pt = Number(dim.metrics?.find((m: any) => m.name === 'sum(dc_prompt_token_count)')?.values?.[0] || 0);
                const ct = Number(dim.metrics?.find((m: any) => m.name === 'sum(dc_candidates_token_count)')?.values?.[0] || 0);

                if (mc <= 0) continue;

                // Apigee reports a missing dimension as '(not set)', but a dimension captured
                // while its source variable was unresolved comes back as the literal string
                // 'null'. Both mean "no identity" — the fault path produces the latter for
                // requests that die before PreFlow step 5 (DJWT-ExtractUserIdentity).
                const isAbsent = (v?: string) =>
                  !v || v === '(not set)' || v === 'null' || v === 'undefined';

                // Exclude probe/health-check traffic where no model was invoked and no tokens were
                // captured. A blocked call looks the same but has errors, so keep those.
                if (isAbsent(rawModel) && pt === 0 && ct === 0 && ec === 0) {
                  continue;
                }

                const isUnauthenticated = isAbsent(rawUser);
                const userEmail = isUnauthenticated ? 'anonymous.caller@external.client' : rawUser;
                const model = isAbsent(rawModel) ? 'unknown-model' : rawModel;

                // The rate card is the source of truth for BOTH price and cost tier. Longest
                // key wins. Tier must NOT be inferred from the model name: gemini-3.7-flash
                // and gemini-3.8-flash cost 1.50/7.50, above gemini-3.1-pro-preview's 1.25/5.00.
                const rateKey = Object.keys(rates)
                  .filter((k) => k !== 'default' && (model === k || model.startsWith(k)))
                  .sort((a, b) => b.length - a.length)[0];
                const matchedRate = (rateKey ? rates[rateKey] : null) || rates[model] || rates['default'] || {};

                const tierFromRate = (out: number) => (out >= 5.0 ? 'high' : out <= 0.3 ? 'low' : 'medium');
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

                // Only calls that reached a model participate in the routing split; a blocked
                // call has no model and would otherwise be counted as a cheap-model win.
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

              consumptionRows.sort((a, b) => b.costUsd - a.costUsd || b.totalTraffic - a.totalTraffic);

              // Real cache hit rate from the dc_cache_status dimension broken down per user and fleet.
              // Only HIT and MISS count; DISABLED and "(not set)" are not cache misses. Null when nothing
              // measurable exists — the UI renders an em dash instead of a constant.
              let cacheHits = 0;
              let cacheMisses = 0;
              const userCacheStats: Record<string, { hits: number; misses: number; disabled: number; notSet: number }> = {};

              if (cacheRes && cacheRes.ok) {
                try {
                  const cacheJson = await cacheRes.json();
                  for (const dim of cacheJson?.environments?.[0]?.dimensions || []) {
                    const rawUser = dim.individualNames?.[0] || dim.name?.split(',')[0] || '(not set)';
                    const rawStatus = dim.individualNames?.[1] || dim.name?.split(',')[1] || '(not set)';

                    const isAbsent = (v?: string) => !v || v === '(not set)' || v === 'null' || v === 'undefined';
                    const userEmail = isAbsent(rawUser) ? 'anonymous.caller@external.client' : rawUser;
                    const status = String(rawStatus || '').toUpperCase();

                    const n = Number(dim.metrics?.find((m: any) => m.name === 'sum(message_count)')?.values?.[0] || 0);
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
                  // Denominator is the calls that actually reached a model; cache hits cost
                  // nothing. Dividing by cacheMisses alone would charge the whole window's
                  // spend to the handful of measured misses and overstate the saving.
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
                  // Errors carrying a dc_user_email, so they can be shown per user. Windows that
                  // predate the DefaultFaultRule report 0 here while isErrorCount is non-zero.
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
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          // Live Apigee Monetization Developer Attributions Endpoint
          server.middlewares.use('/api/monetization/attributions', async (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');

            const token = await getGcpAccessToken();
            if (!token) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not obtain GCP access token from gcloud' }));
              return;
            }

            const org = APIGEE_ORG;
            try {
              const devListRes = await fetch(`https://apigee.googleapis.com/v1/organizations/${org}/developers`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const devData = await devListRes.json();
              const developers: Array<{ email: string }> = devData.developer || [];

              // 2. Per-developer usage, priced from the live KVM rate card.
              // Previously a flat $0.75/M against total tokens — a rate matching no real model.
              // The apiproxy filter keeps `mcp` traffic out of AI Gateway spend.
              let statsByUser: Record<string, { calls: number; tokens: number; costUsd: number }> = {};
              try {
                const dynamicRange = getApigeeTimeRange('30d');
                const monFilter = encodeURIComponent(`(apiproxy eq 'ai-gateway-v1')`);
                const sUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/prod/stats/dc_user_email,dc_model_name?select=sum(message_count),sum(dc_total_token_count),sum(dc_prompt_token_count),sum(dc_candidates_token_count)&timeRange=${encodeURIComponent(dynamicRange)}&filter=${monFilter}`;
                const rcUrl = `https://apigee.googleapis.com/v1/organizations/${org}/environments/prod/keyvaluemaps/ai-model-rates/entries/rate_card`;
                const [sRes, rcRes] = await Promise.all([
                  fetch(sUrl, { headers: { Authorization: `Bearer ${token}` } }),
                  fetch(rcUrl, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
                ]);

                let monRates: Record<string, any> = {};
                if (rcRes && rcRes.ok) {
                  try {
                    const rcJson = await rcRes.json();
                    monRates = typeof rcJson.value === 'string' ? JSON.parse(rcJson.value) : rcJson.value || {};
                  } catch {}
                }

                if (sRes.ok) {
                  const sData = await sRes.json();
                  const dims = sData.environments?.[0]?.dimensions || [];
                  for (const d of dims) {
                    const names = d.individualNames || String(d.name || '').split(',');
                    const email = names[0];
                    const model = names[1] || '';
                    if (!email || email === '(not set)' || email === 'null') continue;

                    const calls = Number(d.metrics?.find((m: any) => m.name === 'sum(message_count)')?.values?.[0] || 0);
                    const tokens = Number(d.metrics?.find((m: any) => m.name === 'sum(dc_total_token_count)')?.values?.[0] || 0);
                    const pt = Number(d.metrics?.find((m: any) => m.name === 'sum(dc_prompt_token_count)')?.values?.[0] || 0);
                    const ct = Number(d.metrics?.find((m: any) => m.name === 'sum(dc_candidates_token_count)')?.values?.[0] || 0);

                    // Longest matching key wins; fall back to the card's own 'default' rather
                    // than guessing from the model name.
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
              } catch {}

              const attributions = await Promise.all(
                developers.map(async (d) => {
                  const email = d.email;
                  let balanceUsd = 0;
                  let hasWallet = false;
                  let resolvedBillingType = 'PREPAID';
                  let apps: string[] = [];
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
                  } catch {}

                  const cleanLast = lastName === 'Google' || lastName === 'User' ? '' : lastName;
                  const fullName =
                    firstName && cleanLast && firstName !== cleanLast
                      ? `${firstName} ${cleanLast}`
                      : firstName || email.split('@')[0];
                  const personaTier = personaTierForApps(apps);
                  const userStats = statsByUser[email] || { calls: 0, tokens: 0, costUsd: 0 };
                  const sessionDebit = sessionLedgerByDev.get(email.toLowerCase())?.debitedUsd || 0;

                  // Measured usage only — the previous Math.max(...) floors invented a call
                  // and token count from wallet-balance drift for any developer whose prepaid
                  // balance had moved. See server.js for the full rationale.
                  const totalCalls = userStats.calls;
                  const totalTokens = userStats.tokens;

                  // Spend priced from the KVM rate card per model, plus live session debits.
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

              attributions.sort((a: any, b: any) => {
                const nameA = (a.name || a.userEmail).toLowerCase();
                const nameB = (b.name || b.userEmail).toLowerCase();
                const cmp = nameA.localeCompare(nameB);
                return cmp !== 0 ? cmp : a.userEmail.localeCompare(b.userEmail);
              });

              res.end(JSON.stringify({ status: 'ok', attributions }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          // 12. /api/products/reset (registered before /api/products) and 13. /api/products.
          // Same Dev/Prod rules as server.js (server/consoleEnv.js): prod is read-only.
          const consoleUrl = (req: any) =>
            new URL(req.originalUrl || req.url || '/', `http://${req.headers.host || 'localhost'}`);
          server.middlewares.use('/api/products/reset', async (req, res) => {
            await handleConsoleProductsReset(req, res, { parsedUrl: consoleUrl(req), getToken: getGcpAccessToken, defaultProducts: DEFAULT_PRODUCTS });
          });
          server.middlewares.use('/api/products', async (req, res) => {
            await handleConsoleProducts(req, res, { parsedUrl: consoleUrl(req), getToken: getGcpAccessToken, defaultProducts: DEFAULT_PRODUCTS });
          });

          // 14. /api/admin-agent/* -- same service module server.js mounts, so
          // dev and production share one implementation and one set of guards.
          const adminAgentService = createAdminAgentService({
            getToken: getGcpAccessToken,
            provisionAdmin: (org: string, token: string, email: string) =>
              provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
            defaultProducts: DEFAULT_PRODUCTS,
            adminEmail: SSO_USER_EMAIL,
          });
          server.middlewares.use('/api/admin-agent', async (req, res) => {
            // Connect strips the mount prefix from req.url; the service routes on
            // the full /api/admin-agent/... path, exactly as in server.js.
            const fullUrl = (req as any).originalUrl || req.url || '/';
            const parsedUrl = new URL(fullUrl, `http://${req.headers.host || 'localhost'}`);
            await adminAgentService.handleRequest(req, res, parsedUrl);
          });

          // 15. /api/agent-showcase/* -- same module server.js mounts.
          const agentShowcaseService = createAgentShowcaseService({
            getToken: getGcpAccessToken,
            provision: (org: string, token: string, email: string) =>
              provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
            defaultEmail: SSO_USER_EMAIL,
          });
          server.middlewares.use('/api/agent-showcase', async (req, res) => {
            const fullUrl = (req as any).originalUrl || req.url || '/';
            const parsedUrl = new URL(fullUrl, `http://${req.headers.host || 'localhost'}`);
            await agentShowcaseService.handleRequest(req, res, parsedUrl);
          });

          // 16. /api/themes/* -- same module server.js mounts.
          const themeLibraryService = createThemeLibraryService({
            getToken: getGcpAccessToken,
            provision: (org: string, token: string, email: string) =>
              provisionUserDeveloperAndApp(org, token, email, '', '', '', { allowCreate: false }),
            identityToken: (email: string) => mintSyntheticIdentityToken(email, email.split('@')[0]),
            defaultEmail: SSO_USER_EMAIL,
          });
          // Hard-refresh hint for the SPA (see server/reloadHint.js).
          server.middlewares.use('/reload-hint.js', (req, res) => handleReloadHint(req, res));
          server.middlewares.use('/api/themes', async (req, res) => {
            const fullUrl = (req as any).originalUrl || req.url || '/';
            const parsedUrl = new URL(fullUrl, `http://${req.headers.host || 'localhost'}`);
            await themeLibraryService.handleRequest(req, res, parsedUrl);
          });
        },
      },
    ],
    server: {
      port: 3000,
      proxy: {
        '/api/ai-dev': {
          target: AI_BASE_DEV,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ai-dev/, ''),
          secure: false,
        },
        '/api/ai-prod': {
          target: AI_BASE_PROD,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ai-prod/, ''),
          secure: false,
        },
        '/api/mcp-dev': {
          target: `${APIGEE_BASE_DEV}/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mcp-dev/, ''),
          secure: false,
        },
        '/api/mcp-prod': {
          target: `${APIGEE_BASE_PROD}/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mcp-prod/, ''),
          secure: false,
        },
        '/api/bigquery-mcp-dev': {
          target: `${APIGEE_BASE_DEV}/bigquery/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/bigquery-mcp-dev/, ''),
          secure: false,
        },
        '/api/bigquery-mcp-prod': {
          target: `${APIGEE_BASE_PROD}/bigquery/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/bigquery-mcp-prod/, ''),
          secure: false,
        },
        '/api/servicenow-mcp-dev': {
          target: `${APIGEE_BASE_DEV}/servicenow/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/servicenow-mcp-dev/, ''),
          secure: false,
        },
        // Industry pack MCP proxies: /api/industry-mcp-<env>/<id> -> <host>/<id>/mcp.
        // VITE_INDUSTRY_APIS_LOCAL (e.g. http://localhost:8091) targets a local industry-apis
        // with no gateway in between (see server/industryMcp.js).
        ...Object.fromEntries((['dev', 'prod'] as const).map((e) => [`/api/industry-mcp-${e}`, {
          target: env.VITE_INDUSTRY_APIS_LOCAL || APIGEE_HOSTS[e],
          changeOrigin: true,
          secure: false,
          rewrite: (path: string) => path.replace(new RegExp(`^/api/industry-mcp-${e}/([a-z][a-z0-9-]*)/?$`), '/$1/mcp'),
        }])),
        '/api/servicenow-mcp-prod': {
          target: `${APIGEE_BASE_PROD}/servicenow/mcp`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/servicenow-mcp-prod/, ''),
          secure: false,
        },
      },
    },
  };
});
