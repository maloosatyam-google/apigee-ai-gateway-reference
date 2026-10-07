/**
 * Ask Apigee -- Apigee / AI Gateway I/O and the /api/admin-agent/* routes.
 *
 * All the pure logic lives in adminAgentCore.js. This module is the thin, but
 * carefully defensive, shell around it:
 *
 *  - every outbound call goes through one of two injectable functions
 *    (`apigeeFetch`, `gatewayFetch`) so tests can run without credentials;
 *  - no handler is allowed to throw: the HTTP layer always answers with a
 *    structured JSON body, never a stack trace and never a dead socket;
 *  - the dev sandbox consumer key is held in process memory only and is
 *    scrubbed out of every response body on the way to the browser.
 */
import {
  isMcpProduct,
  isMcpDevName,
  mcpDevNameFor,
  mcpLiveNameFor,
  toolsOf,
  apiSourcesOf,
  toolUniverse,
  summarizeMcpProduct,
  buildMcpDevClone,
  assertWritableMcpDev,
  applyToolAccessChanges,
  mcpBasePathFor,
  mcpTestAppName,
  classifyToolCall,
} from './mcpGovernance.js';
import { consultSkill, loadSkillDigest } from './skillConsult.js';
import {
  productTestAppName,
  compareGuardrails,
  isGuardrailAttribute,
  AI_BASE_DEV,
  AI_BASE_PROD,
  AdminAgentError,
  AGENT_MODEL,
  AGENT_FALLBACK_MODEL,
  RATE_LIMIT_UPSTREAM_CAPACITY,
  ChangeStore,
  DEV_PRODUCTS,
  INSIGHT_TOOL_NAMES,
  LIVE_PRODUCTS,
  KNOWN_PRODUCTS,
  MAX_TOOL_ITERATIONS,
  ORG,
  SANDBOX_APP_NAME,
  SYSTEM_INSTRUCTION,
  TOOL_LOOP_BUDGET_MS,
  allowedTestModels,
  applyChangeSet,
  assertDevOnlyEnvironments,
  assertRoleAllows,
  capabilitiesForChanges,
  normalizeAdminRole,
  normalizeScope,
  roleInstruction,
  userSystemInstruction,
  assertWritableDevProduct,
  buildDevClone,
  buildFunctionDeclarations,
  classifyRateLimit,
  apigeeProductName,
  devNameFor,
  isDevProductName,
  liveNameFor,
  logicalProductName,
  messagesToContents,
  mintSyntheticIdentityToken,
  newChangeId,
  runToolLoop,
  stripServerFields,
  summarizeDiff,
  toTestResult,
  validateToolArgs,
} from './adminAgentCore.js';
import { listGuardrails } from './guardrailCatalog.js';
import { createInsights } from './insights.js';
import { SSO_USER_EMAIL } from './deployConfig.js';

/** Caller email as /api/me resolves it: IAP header first, then the configured default. */
export function callerEmailFrom(req, fallbackEmail) {
  const raw = String(req?.headers?.['x-goog-authenticated-user-email'] || '');
  const clean = raw.replace(/^accounts\.google\.com:/, '').trim().toLowerCase();
  return clean || String(fallbackEmail || '').toLowerCase();
}

const APIGEE_BASE = 'https://apigee.googleapis.com/v1/organizations';
const RATE_KVM = 'ai-model-rates';
const RATE_KVM_ENTRY = 'rate_card';
const AGENT_TIMEOUT_MS = 25_000;
const DEV_TEST_TIMEOUT_MS = 20_000;
/** Backoff before the single retry of a transient Vertex capacity 429. */
const UPSTREAM_RETRY_DELAY_MS = 1_500;
const MAX_BODY_BYTES = 256 * 1024;

function projectProduct(product, exists, logicalName) {
  const name = logicalName || logicalProductName(product?.name);
  if (!exists || !product) return { name, exists: false };
  return {
    name,
    exists: true,
    displayName: product.displayName || name,
    environments: product.environments || [],
    approvalType: product.approvalType || '',
    attributes: (product.attributes || []).map((a) => ({ name: a.name, value: String(a.value ?? '') })),
    tokenQuotas: (product.llmOperationGroup?.operationConfigs || []).flatMap((cfg) =>
      (cfg.llmOperations || []).map((op) => ({
        resource: op.resource,
        model: op.model,
        limit: cfg.llmTokenQuota?.limit ?? null,
        interval: cfg.llmTokenQuota?.interval ?? null,
        timeUnit: cfg.llmTokenQuota?.timeUnit ?? null,
      }))
    ),
  };
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AdminAgentError('Request body too large.', 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

/**
 * Requirement #1: the sandbox consumer key must never reach the browser.
 * Rather than trusting every response shape, the secrets we hold are scrubbed
 * out of the serialized body as a last line of defence.
 */
export function redactSecrets(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function createAdminAgentService({
  getToken,
  provisionAdmin,
  defaultProducts = {},
  fetchImpl = (...args) => globalThis.fetch(...args),
  org = ORG,
  adminEmail = SSO_USER_EMAIL,
  aiBaseProd = AI_BASE_PROD,
  aiBaseDev = AI_BASE_DEV,
  agentModel = AGENT_MODEL,
  fallbackModel = AGENT_FALLBACK_MODEL,
  now = () => Date.now(),
  randomHex,
  // Injectable so the retry path is unit-testable without a real 1.5s wait.
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  // Read-only analytics / audit queries. Injectable so tests need no egress.
  insights = null,
} = {}) {
  const changes = new ChangeStore();
  const insightsApi = insights || createInsights({ getToken, fetchImpl, org, now });
  /** Consumer keys. Process memory only; never serialized to a client. */
  const secrets = { adminKey: '', sandboxKey: '', productKeys: {} };
  const toolsByScope = {
    admin: [{ functionDeclarations: buildFunctionDeclarations('admin') }],
    user: [{ functionDeclarations: buildFunctionDeclarations('user') }],
  };
  /** The model currently serving turns; only ever downgraded, never upgraded. */
  let activeModel = agentModel;

  // -------------------------------------------------------------------------
  // Apigee management API
  // -------------------------------------------------------------------------

  async function apigee(pathSuffix, { method = 'GET', body } = {}) {
    const token = await getToken();
    if (!token) {
      return { ok: false, status: 503, json: null, text: 'no_gcp_token', error: 'Could not obtain a GCP access token.' };
    }
    try {
      const res = await fetchImpl(`${APIGEE_BASE}/${org}${pathSuffix}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { ok: res.ok, status: res.status, json, text };
    } catch (err) {
      return { ok: false, status: 0, json: null, text: '', error: err?.message || String(err) };
    }
  }

  // The one place a logical name ("Engineering and IT (Dev)") becomes an Apigee
  // resource name ("Engineering and IT Dev"). Everything else speaks logically.
  const productPath = (logicalName) =>
    `/apiproducts/${encodeURIComponent(apigeeProductName(logicalName))}`;

  async function readProduct(logicalName) {
    const res = await apigee(productPath(logicalName));
    if (res.ok && res.json) return { exists: true, product: res.json, raw: res.text };
    if (res.status === 404) return { exists: false, product: null, raw: '' };
    return { exists: false, product: null, raw: '', error: res.error || `HTTP ${res.status}` };
  }

  /** Live tier read with the canonical demo defaults as a fallback, as /api/products does. */
  async function readLiveOrDefault(name) {
    const res = await readProduct(name);
    if (res.exists) return res.product;
    const fallback = defaultProducts[name];
    return fallback ? JSON.parse(JSON.stringify(fallback)) : null;
  }

  async function writeProduct(logicalName, product) {
    // Last line of defence, whatever built `product` (a tool change, a revert
    // snapshot, a sandbox repair): only a known (Dev) clone, only on dev.
    assertWritableDevProduct(logicalName);
    const body = stripServerFields(product);
    assertDevOnlyEnvironments(body.environments);
    // Never let a logical name leak into the resource itself: Apigee would
    // reject the parentheses, and a mismatched `name` renames the product.
    body.name = apigeeProductName(logicalName);
    const res = await apigee(productPath(logicalName), { method: 'PUT', body });
    if (!res.ok) {
      throw new AdminAgentError(
        `Apigee refused the write to "${logicalName}" (HTTP ${res.status})${
          res.json?.error?.message ? `: ${res.json.error.message}` : ''
        }`,
        'apigee_error'
      );
    }
    return res.json;
  }

  async function createProduct(product) {
    assertWritableDevProduct(logicalProductName(product?.name));
    assertDevOnlyEnvironments(product?.environments);
    const res = await apigee('/apiproducts', { method: 'POST', body: product });
    if (!res.ok) {
      throw new AdminAgentError(
        `Could not create "${product.name}" (HTTP ${res.status})${
          res.json?.error?.message ? `: ${res.json.error.message}` : ''
        }`,
        'apigee_error'
      );
    }
    return res.json;
  }

  // -------------------------------------------------------------------------
  // Credentials (server-side only)
  // -------------------------------------------------------------------------

  async function adminConsumerKey() {
    if (secrets.adminKey) return secrets.adminKey;
    const token = await getToken();
    if (!token || typeof provisionAdmin !== 'function') return '';
    try {
      const result = await provisionAdmin(org, token, adminEmail);
      secrets.adminKey = result?.apiKeys?.admin || result?.apiKey || '';
    } catch (err) {
      logger.warn?.('[AdminAgent] Could not resolve the admin consumer key:', err?.message || err);
    }
    return secrets.adminKey;
  }

  const appPath = () =>
    `/developers/${encodeURIComponent(adminEmail)}/apps/${encodeURIComponent(SANDBOX_APP_NAME)}`;

  async function readSandboxApp() {
    const res = await apigee(appPath());
    if (!res.ok) return { exists: false, app: null };
    const cred =
      res.json?.credentials?.find((c) => c.status === 'approved') || res.json?.credentials?.[0];
    if (cred?.consumerKey) secrets.sandboxKey = cred.consumerKey;
    return { exists: true, app: res.json };
  }

  function identityToken() {
    return mintSyntheticIdentityToken(adminEmail, adminEmail.split('@')[0], now());
  }

  // -------------------------------------------------------------------------
  // Sandbox
  // -------------------------------------------------------------------------

  async function sandboxStatus() {
    const products = await Promise.all(
      DEV_PRODUCTS.map(async (name) => {
        const res = await readProduct(name);
        return { name, exists: res.exists, environments: res.product?.environments || [] };
      })
    );
    const app = await readSandboxApp();
    const provisioned = products.every((p) => p.exists) && app.exists && !!secrets.sandboxKey;
    return {
      provisioned,
      products,
      app: { name: SANDBOX_APP_NAME, exists: app.exists },
      // The key itself stays here. Only its presence is reported.
      keyPresent: !!secrets.sandboxKey,
    };
  }

  /**
   * Create the two `(Dev)` clones and the sandbox app.
   *
   * Existing clones are healed (environments/approvalType) rather than
   * overwritten, so re-provisioning does not silently discard changes the
   * agent already applied to the sandbox.
   */
  async function provisionSandbox() {
    const notes = [];
    for (const liveName of LIVE_PRODUCTS) {
      const devName = devNameFor(liveName);
      const existing = await readProduct(devName);
      if (!existing.exists) {
        const live = await readLiveOrDefault(liveName);
        if (!live) {
          notes.push(`Could not read "${liveName}"; skipped its dev clone.`);
          continue;
        }
        await createProduct(buildDevClone(live, devName));
        notes.push(`Created ${devName}.`);
      } else {
        const product = existing.product;
        const needsEnv =
          !Array.isArray(product.environments) ||
          product.environments.length !== 1 ||
          product.environments[0] !== 'dev';
        const needsApproval = product.approvalType !== 'auto';
        if (needsEnv || needsApproval) {
          await writeProduct(devName, { ...product, environments: ['dev'], approvalType: 'auto' });
          notes.push(`Repaired ${devName} (dev-only, auto approval).`);
        }
      }
    }

    const app = await readSandboxApp();
    if (!app.exists) {
      const created = await apigee(`/developers/${encodeURIComponent(adminEmail)}/apps`, {
        method: 'POST',
        body: {
          name: SANDBOX_APP_NAME,
          // Apps reference the Apigee resource names, not the logical ones.
          apiProducts: DEV_PRODUCTS.map(apigeeProductName),
          attributes: [
            { name: 'DisplayName', value: 'Admin Agent Dev Sandbox' },
            { name: 'persona', value: 'admin-agent' },
          ],
        },
      });
      if (!created.ok) {
        throw new AdminAgentError(
          `Could not create the sandbox app (HTTP ${created.status})${
            created.json?.error?.message ? `: ${created.json.error.message}` : ''
          }`,
          'apigee_error'
        );
      }
      notes.push(`Created app ${SANDBOX_APP_NAME}.`);
    }
    await readSandboxApp();

    const status = await sandboxStatus();
    return { ...status, notes };
  }

  // -------------------------------------------------------------------------
  // Gateway calls
  // -------------------------------------------------------------------------

  async function gatewayCall({ url, apiKey, body, timeoutMs, headers: extraHeaders = {} }) {
    const startedAt = now();
    if (!apiKey) {
      return {
        ok: false,
        status: 0,
        json: null,
        text: '',
        headers: {},
        latencyMs: 0,
        error: 'no API key available for the gateway call',
      };
    }
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-apikey': apiKey,
          Authorization: `Bearer ${identityToken()}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const headers = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return { ok: res.ok, status: res.status, json, text, headers, latencyMs: now() - startedAt };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        json: null,
        text: '',
        headers: {},
        latencyMs: now() - startedAt,
        error: err?.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err?.message || String(err),
      };
    }
  }

  /**
   * The agent's own model call -- metered like any other gateway consumer.
   *
   * AGENT_MODEL (gemini-3.1-flash-lite) is entitled on both tiers, so this
   * should always hold, but an entitlement failure must
   * degrade to a model that is known to support tools rather than kill the
   * turn. The model that actually served is reported back so `usage.model`
   * (and the UI chip) never claims something untrue.
   */
  async function callAgentModel({ contents, systemInstruction, tools: toolDefs }) {
    const apiKey = await adminConsumerKey();
    const body = {
      // No `role` here: the gateway's OAS-ValidateRequest policy rejects
      // systemInstruction.role with HTTP 400 ("properties which are not
      // allowed by the schema"), even though Vertex itself accepts it.
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: toolDefs,
    };
    const attemptOnce = (model) =>
      gatewayCall({
        url: `${aiBaseProd}/models/${model}:generateContent`,
        apiKey,
        timeoutMs: AGENT_TIMEOUT_MS,
        body,
      });

    /**
     * Vertex RESOURCE_EXHAUSTED is upstream capacity, not our governance, and
     * it is transient -- so it gets exactly one retry. An Apigee quota/budget
     * 429 deliberately gets none: that one IS the governance story, and hiding
     * it behind a retry would both delay the answer and misrepresent it.
     */
    const attempt = async (model) => {
      const first = await attemptOnce(model);
      if (first.ok || first.status !== 429) return first;
      if (classifyRateLimit(first) !== RATE_LIMIT_UPSTREAM_CAPACITY) return first;

      logger.warn?.(
        `[AdminAgent] Vertex RESOURCE_EXHAUSTED on ${model}; retrying once in ${UPSTREAM_RETRY_DELAY_MS}ms.`
      );
      await sleep(UPSTREAM_RETRY_DELAY_MS);
      const second = await attemptOnce(model);
      // Flagged so the error message can say it already retried.
      return { ...(second.status ? second : first), retriedUpstream: true };
    };

    let res = await attempt(activeModel);
    const notEntitled = !res.ok && (res.status === 403 || res.status === 404);
    if (notEntitled && activeModel !== fallbackModel) {
      logger.warn?.(
        `[AdminAgent] ${activeModel} returned HTTP ${res.status}; retrying on ${fallbackModel}.`
      );
      const retry = await attempt(fallbackModel);
      if (retry.ok) {
        // Only make the downgrade stick when it actually worked; a 403 from an
        // exhausted wallet must not silently pin the agent to a lesser model.
        activeModel = fallbackModel;
        return { ...retry, model: fallbackModel };
      }
      res = retry.status ? retry : res;
    }
    return { ...res, model: activeModel };
  }

  /**
   * Key for a test app bound to exactly one dev product (created on first use,
   * dev product only, so it can never reach prod). Returns {key, created}.
   */
  async function ensureProductTestKey(sourceProduct) {
    const devName = assertWritableDevProduct(devNameFor(sourceProduct));
    if (secrets.productKeys[devName]) return { key: secrets.productKeys[devName], created: false, devName };
    const appName = productTestAppName(sourceProduct);
    const path = `/developers/${encodeURIComponent(adminEmail)}/apps/${encodeURIComponent(appName)}`;
    let res = await apigee(path);
    let created = false;
    if (!res.ok) {
      res = await apigee(`/developers/${encodeURIComponent(adminEmail)}/apps`, {
        method: 'POST',
        body: {
          name: appName,
          apiProducts: [apigeeProductName(devName)],
          attributes: [
            { name: 'DisplayName', value: `Ask Apigee test key: ${devName}` },
            { name: 'persona', value: 'admin-agent' },
          ],
        },
      });
      if (!res.ok) {
        throw new AdminAgentError(
          `Could not create the test app for ${devName} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
          'apigee_error'
        );
      }
      created = true;
    }
    const cred = res.json?.credentials?.find((c) => c.status === 'approved') || res.json?.credentials?.[0];
    if (!cred?.consumerKey) throw new AdminAgentError(`The test app for ${devName} has no key.`, 'apigee_error');
    secrets.productKeys[devName] = cred.consumerKey;
    return { key: cred.consumerKey, created, devName };
  }

  async function runDevTest({ prompt, model, sourceProduct }) {
    if (sourceProduct) {
      const { key, created, devName } = await ensureProductTestKey(sourceProduct);
      const current = await readProduct(devName);
      if (!current.exists) throw new AdminAgentError(`${devName} does not exist yet. Provision the dev sandbox first.`, 'not_provisioned');
      const allowedHere = allowedTestModels([current.product]);
      if (!allowedHere.includes(model)) {
        throw new AdminAgentError(`Model "${model}" is not entitled on ${devName}. Available: ${allowedHere.join(', ')}.`);
      }
      const url = model === 'auto' ? `${aiBaseDev}/auto` : `${aiBaseDev}/models/${model}:generateContent`;
      const call = () =>
        gatewayCall({ url, apiKey: key, timeoutMs: DEV_TEST_TIMEOUT_MS, body: { contents: [{ role: 'user', parts: [{ text: prompt }] }] } });
      let res = await call();
      // A brand-new key takes a few seconds to reach the runtime.
      if (created && res.status === 401) {
        await new Promise((r) => setTimeout(r, 5000));
        res = await call();
      }
      const result = toTestResult({ ...res, requestedModel: model });
      return { ...result, product: devName, guardrailsCheck: compareGuardrails(current.product, result.guardrails) };
    }
    if (!secrets.sandboxKey) await readSandboxApp();
    if (!secrets.sandboxKey) {
      throw new AdminAgentError(
        'The dev sandbox is not provisioned yet, so there is no key to test with. Provision it first.',
        'not_provisioned'
      );
    }

    const devProducts = (
      await Promise.all(DEV_PRODUCTS.map((n) => readProduct(n)))
    )
      .filter((r) => r.exists)
      .map((r) => r.product);
    const allowed = allowedTestModels(
      devProducts.length ? devProducts : Object.values(defaultProducts)
    );
    if (!allowed.includes(model)) {
      throw new AdminAgentError(
        `Model "${model}" is not entitled on the dev sandbox. Available: ${allowed.join(', ')}.`
      );
    }

    const url = model === 'auto' ? `${aiBaseDev}/auto` : `${aiBaseDev}/models/${model}:generateContent`;
    const res = await gatewayCall({
      url,
      apiKey: secrets.sandboxKey,
      timeoutMs: DEV_TEST_TIMEOUT_MS,
      body: { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
    });
    return toTestResult({ ...res, requestedModel: model });
  }

  // -------------------------------------------------------------------------
  // MCP tool governance (dev clones of MCP products only)
  // -------------------------------------------------------------------------

  const mcpProductPath = (name) => `/apiproducts/${encodeURIComponent(name)}`;
  let mcpCache = { at: 0, products: null };

  async function listMcpProducts({ fresh = false } = {}) {
    if (!fresh && mcpCache.products && now() - mcpCache.at < 60_000) return mcpCache.products;
    const res = await apigee('/apiproducts?expand=true');
    if (!res.ok) throw new AdminAgentError(`Could not list API products (HTTP ${res.status}).`, 'apigee_error');
    const products = (res.json?.apiProduct || []).filter(isMcpProduct);
    mcpCache = { at: now(), products };
    return products;
  }

  async function readMcpProduct(name) {
    const res = await apigee(mcpProductPath(name));
    if (res.status === 404) return { exists: false };
    if (!res.ok) throw new AdminAgentError(`Could not read ${name} (HTTP ${res.status}).`, 'apigee_error');
    return { exists: true, product: res.json, raw: res.text };
  }

  /** Resolve a requested name to a live (non-clone) MCP product, case-insensitively. */
  async function resolveLiveMcp(requested) {
    const products = await listMcpProducts();
    const want = mcpLiveNameFor(requested).toLowerCase();
    const live = products.find((p) => !isMcpDevName(p.name) && p.name.toLowerCase() === want);
    if (!live) {
      const close = products
        .filter((p) => !isMcpDevName(p.name) && p.name.toLowerCase().includes(want.split(' ')[0] || ''))
        .slice(0, 8)
        .map((p) => p.name);
      throw new AdminAgentError(
        `No MCP product named "${requested}".${close.length ? ` Did you mean: ${close.join('; ')}?` : ' Call list_mcp_tools to see them.'}`
      );
    }
    return { live, products };
  }

  async function listMcpTools({ product, industry }) {
    if (!product) {
      const products = (await listMcpProducts()).filter((p) => !isMcpDevName(p.name));
      const filtered = industry
        ? products.filter((p) => summarizeMcpProduct(p).industry === industry || p.name.toLowerCase().includes(industry))
        : products;
      return { count: filtered.length, products: filtered.map(summarizeMcpProduct) };
    }
    const { live, products } = await resolveLiveMcp(product);
    const sources = apiSourcesOf(live);
    const granted = toolsOf(live);
    const universe = toolUniverse(products, sources);
    const dev = await readMcpProduct(mcpDevNameFor(live.name));
    const out = {
      product: live.name,
      ...summarizeMcpProduct(live),
      allowedTools: granted.map((t) => ({ tool: t.tool, perMinute: t.quota?.limit ?? null })),
      notAllowed: universe.filter((t) => !granted.some((g) => g.tool === t)),
      devCopy: null,
    };
    if (dev.exists) {
      const devTools = toolsOf(dev.product);
      out.devCopy = {
        name: dev.product.name,
        added: devTools.filter((d) => !granted.some((g) => g.tool === d.tool)).map((d) => d.tool),
        removed: granted.filter((g) => !devTools.some((d) => d.tool === g.tool)).map((g) => g.tool),
        quotaChanges: devTools
          .map((d) => ({ tool: d.tool, dev: d.quota?.limit, live: granted.find((g) => g.tool === d.tool)?.quota?.limit }))
          .filter((x) => x.live !== undefined && String(x.dev) !== String(x.live)),
      };
    }
    return out;
  }

  /** Ensure the "<name> Dev" clone exists (dev only). Returns {product, raw, created}. */
  async function ensureMcpDevClone(live) {
    const devName = mcpDevNameFor(live.name);
    const existing = await readMcpProduct(devName);
    if (existing.exists) return { product: assertWritableMcpDev(existing.product), raw: existing.raw, created: false };
    const clone = assertWritableMcpDev(buildMcpDevClone(live));
    const res = await apigee('/apiproducts', { method: 'POST', body: clone });
    if (!res.ok) {
      throw new AdminAgentError(
        `Could not create ${devName} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
        'apigee_error'
      );
    }
    mcpCache.at = 0;
    return { product: res.json || clone, raw: res.text || JSON.stringify(clone), created: true };
  }

  async function writeMcpDevProduct(product) {
    assertWritableMcpDev(product);
    const res = await apigee(mcpProductPath(product.name), { method: 'PUT', body: product });
    if (!res.ok) {
      throw new AdminAgentError(
        `Could not update ${product.name} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
        'apigee_error'
      );
    }
    mcpCache.at = 0;
  }

  async function updateDevToolAccess(args, { skillCitations = [] } = {}) {
    const { live, products } = await resolveLiveMcp(args.product);
    const universe = toolUniverse(products, apiSourcesOf(live));
    const { product: current, raw, created } = await ensureMcpDevClone(live);
    const { next, diff } = applyToolAccessChanges(current, args, universe);
    if (diff.length === 0) {
      throw new AdminAgentError(`Nothing to change on ${current.name}: those settings are already in place.`, 'no_op');
    }
    await writeMcpDevProduct(next);
    const change = {
      changeId: newChangeId(randomHex),
      kind: 'mcp_product',
      productName: current.name,
      sourceProduct: live.name,
      env: 'dev',
      summary: `${current.name}: ${diff.map((d) => `${d.label.replace('Tool access · ', '')} ${d.before ?? '—'} → ${d.after}`).join('; ')}`,
      diff,
      capabilities: ['guardrails'],
      appliedAt: new Date(now()).toISOString(),
      status: 'applied',
      ...(created ? { createdClone: true } : {}),
      ...(skillCitations.length ? { skillCitations } : {}),
    };
    // Snapshot = the dev clone as it was just before this write (a fresh clone
    // equals the live product), so revert restores it exactly.
    changes.record(change, raw);
    return change;
  }

  async function ensureMcpTestKey(devProduct) {
    const devName = devProduct.name;
    if (secrets.productKeys[devName]) return { key: secrets.productKeys[devName], created: false };
    const appName = mcpTestAppName(devName);
    const path = `/developers/${encodeURIComponent(adminEmail)}/apps/${encodeURIComponent(appName)}`;
    let res = await apigee(path);
    let created = false;
    if (!res.ok) {
      res = await apigee(`/developers/${encodeURIComponent(adminEmail)}/apps`, {
        method: 'POST',
        body: {
          name: appName,
          apiProducts: [devName],
          attributes: [
            { name: 'DisplayName', value: `Ask Apigee MCP test key: ${devName}` },
            { name: 'persona', value: 'admin-agent' },
          ],
        },
      });
      if (!res.ok) {
        throw new AdminAgentError(
          `Could not create the MCP test app for ${devName} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
          'apigee_error'
        );
      }
      created = true;
    }
    const cred = res.json?.credentials?.find((c) => c.status === 'approved') || res.json?.credentials?.[0];
    if (!cred?.consumerKey) throw new AdminAgentError(`The MCP test app for ${devName} has no key.`, 'apigee_error');
    secrets.productKeys[devName] = cred.consumerKey;
    return { key: cred.consumerKey, created };
  }

  async function runDevToolTest({ product, tool, arguments: toolArgs }) {
    const { live } = await resolveLiveMcp(product);
    const dev = await readMcpProduct(mcpDevNameFor(live.name));
    if (!dev.exists) {
      throw new AdminAgentError(
        `${mcpDevNameFor(live.name)} does not exist yet: make a change with update_dev_tool_access first (that creates the dev copy).`,
        'not_provisioned'
      );
    }
    const devProduct = assertWritableMcpDev(dev.product);
    const basePath = mcpBasePathFor(apiSourcesOf(devProduct)[0]);
    if (!basePath) throw new AdminAgentError(`${devProduct.name} has no MCP base path the dev test can reach.`);
    const { key, created } = await ensureMcpTestKey(devProduct);
    const url = `${aiBaseDev.replace(/\/ai\/v1$/, '')}${basePath}`;
    const call = () =>
      gatewayCall({
        url,
        apiKey: key,
        timeoutMs: DEV_TEST_TIMEOUT_MS,
        headers: { Accept: 'application/json, text/event-stream' },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: toolArgs || {} } },
      });
    let res = await call();
    let outcome = classifyToolCall(res.status, res.json, res.text);
    // A brand-new key takes a few seconds to reach the runtime.
    for (let i = 0; i < 3 && outcome === 'key_not_ready'; i++) {
      await new Promise((r) => setTimeout(r, created ? 5000 : 2000));
      res = await call();
      outcome = classifyToolCall(res.status, res.json, res.text);
    }
    const expected = toolsOf(devProduct).some((t) => t.tool === tool) ? 'allowed' : 'denied';
    const matches = outcome === 'allowed' || outcome === 'denied' ? outcome === expected : null;
    return {
      product: devProduct.name,
      tool,
      httpStatus: res.status,
      outcome,
      expected,
      matches,
      latencyMs: res.latencyMs,
      detail: String(res.json?.fault?.faultstring || res.json?.error?.message || res.text || res.error || '').slice(0, 400),
    };
  }

  // -------------------------------------------------------------------------
  // Finance: wallets, rate plans, dev rate card
  // -------------------------------------------------------------------------

  const devPath = (email) => `/developers/${encodeURIComponent(email)}`;
  const moneyToUsd = (m) => Number(m?.units || 0) + Number(m?.nanos || 0) / 1e9;
  const usdToMoney = (usd) => {
    const sign = usd < 0 ? -1 : 1;
    const abs = Math.abs(usd);
    const units = Math.floor(abs);
    const nanos = Math.round((abs - units) * 1e9);
    return { currencyCode: 'USD', units: String(sign * units), nanos: sign * nanos };
  };

  async function readWallet(email) {
    const [bal, cfg] = await Promise.all([apigee(`${devPath(email)}/balance`), apigee(`${devPath(email)}/monetizationConfig`)]);
    if (bal.status === 404) {
      throw new AdminAgentError(`No developer "${email}" in the org.`, 'not_found');
    }
    if (!bal.ok) throw new AdminAgentError(`Could not read the wallet for ${email} (HTTP ${bal.status}).`, 'apigee_error');
    const wallets = (bal.json?.wallets || []).map((w) => ({
      currency: w.balance?.currencyCode || 'USD',
      balanceUsd: Number(moneyToUsd(w.balance).toFixed(6)),
      lastCreditAt: w.lastCreditTime ? new Date(Number(w.lastCreditTime)).toISOString() : null,
    }));
    return {
      developer: email,
      billingType: cfg.ok ? cfg.json?.billingType || 'UNSPECIFIED' : wallets.length ? 'PREPAID' : 'POSTPAID',
      balanceUsd: wallets[0]?.balanceUsd ?? 0,
      wallets,
    };
  }

  async function listRatePlans(product) {
    const products = product ? [product] : LIVE_PRODUCTS;
    const out = [];
    for (const p of products) {
      const list = await apigee(`/apiproducts/${encodeURIComponent(apigeeProductName(p))}/rateplans`);
      if (!list.ok) continue;
      // The list call returns stubs; each plan's detail carries the fees.
      const details = await Promise.all(
        (list.json?.ratePlans || []).map(async (item) => {
          if (item.billingPeriod || item.consumptionPricingRates) return item;
          const d = await apigee(`/apiproducts/${encodeURIComponent(apigeeProductName(p))}/rateplans/${encodeURIComponent(item.name)}`);
          return d.ok ? d.json : item;
        })
      );
      for (const plan of details) {
        out.push({
          product: p,
          name: plan.displayName || plan.name,
          state: plan.state,
          currency: plan.currencyCode,
          billingPeriod: plan.billingPeriod,
          paymentFundingModel: plan.paymentFundingModel,
          setupFee: plan.setupFee ? moneyToUsd(plan.setupFee) : 0,
          fixedRecurringFee: plan.fixedRecurringFee ? moneyToUsd(plan.fixedRecurringFee) : 0,
          consumptionPricingType: plan.consumptionPricingType,
          consumptionRates: (plan.consumptionPricingRates || []).map((r) => ({
            start: r.start ?? 0,
            end: r.end ?? null,
            feeUsd: r.fee ? moneyToUsd(r.fee) : 0,
          })),
          startTime: plan.startTime ? new Date(Number(plan.startTime)).toISOString() : null,
        });
      }
    }
    return out;
  }

  async function topupWallet({ developer, amountUsd }) {
    const before = await readWallet(developer);
    const transactionId = `ask-apigee-topup-${now()}`;
    const res = await apigee(`${devPath(developer)}/balance:credit`, {
      method: 'POST',
      body: { transactionAmount: usdToMoney(amountUsd), transactionId },
    });
    if (!res.ok) {
      throw new AdminAgentError(
        `Apigee refused the top-up for ${developer} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
        'apigee_error'
      );
    }
    const afterUsd = res.json?.wallets?.[0]?.balance ? moneyToUsd(res.json.wallets[0].balance) : before.balanceUsd + amountUsd;
    const diff = [
      {
        path: 'wallet.balance',
        label: 'Prepaid balance',
        before: `$${before.balanceUsd.toFixed(2)}`,
        after: `$${afterUsd.toFixed(2)}`,
      },
    ];
    const change = {
      changeId: newChangeId(randomHex),
      kind: 'wallet',
      productName: `Wallet · ${developer}`,
      sourceProduct: '',
      env: 'org',
      summary: `Topped up ${developer}'s prepaid wallet by $${amountUsd.toFixed(2)}`,
      diff,
      capabilities: ['wallet'],
      appliedAt: new Date(now()).toISOString(),
      status: 'applied',
      developer,
      amountUsd,
      transactionId,
    };
    changes.record(change, JSON.stringify({ developer, amountUsd, transactionId }));
    return change;
  }

  async function revertTopup(entry) {
    const { developer, amountUsd } = JSON.parse(entry.snapshotRaw);
    // Apigee's sign convention: a POSITIVE adjustment DECREASES the balance
    // (it corrects an under-charge), so undoing a credit of $X adjusts by +$X.
    const res = await apigee(`${devPath(developer)}/balance:adjust`, {
      method: 'POST',
      body: { adjustment: usdToMoney(amountUsd) },
    });
    if (!res.ok) {
      throw new AdminAgentError(
        `Could not debit the top-up back from ${developer} (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
        'apigee_error'
      );
    }
  }

  const RATE_ENTRY_PATH = `/environments/dev/keyvaluemaps/${RATE_KVM}/entries/${RATE_KVM_ENTRY}`;

  async function readDevRateCard() {
    const res = await apigee(RATE_ENTRY_PATH);
    if (!res.ok) throw new AdminAgentError(`Could not read the dev rate card (HTTP ${res.status}).`, 'apigee_error');
    const raw = typeof res.json?.value === 'string' ? res.json.value : JSON.stringify(res.json?.value || {});
    let rates;
    try {
      rates = JSON.parse(raw);
    } catch {
      throw new AdminAgentError('The dev rate card is not valid JSON.', 'apigee_error');
    }
    return { raw, rates };
  }

  async function writeDevRateCard(value) {
    // Hard-wired to the dev environment: there is no parameter that could aim this at prod.
    const res = await apigee(RATE_ENTRY_PATH, { method: 'PUT', body: { name: RATE_KVM_ENTRY, value } });
    if (!res.ok) {
      throw new AdminAgentError(
        `Apigee refused the dev rate-card write (HTTP ${res.status})${res.json?.error?.message ? `: ${res.json.error.message}` : ''}`,
        'apigee_error'
      );
    }
  }

  async function updateDevRateCard({ model, input, output }) {
    const { raw, rates } = await readDevRateCard();
    if (!Object.prototype.hasOwnProperty.call(rates, model)) {
      const keys = Object.keys(rates).filter((k) => k !== 'default');
      throw new AdminAgentError(`"${model}" is not on the dev rate card. Keys: ${keys.join(', ')}.`);
    }
    const current = rates[model] || {};
    const next = { ...current, ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) };
    const diff = [];
    for (const f of ['input', 'output']) {
      if (next[f] !== current[f]) {
        diff.push({
          path: `rates.${model}.${f}`,
          label: `${model} · ${f} price per 1M tokens`,
          before: current[f] === undefined ? null : `$${Number(current[f]).toFixed(2)}`,
          after: `$${Number(next[f]).toFixed(2)}`,
        });
      }
    }
    if (diff.length === 0) {
      throw new AdminAgentError(`Nothing to change: ${model} already costs that on the dev rate card.`, 'no_op');
    }
    await writeDevRateCard(JSON.stringify({ ...rates, [model]: next }));
    const change = {
      changeId: newChangeId(randomHex),
      kind: 'rate_card',
      productName: 'Rate card (Dev)',
      sourceProduct: '',
      env: 'dev',
      summary: `Dev rate card: ${diff.map((d) => `${d.label.replace(' per 1M tokens', '')} ${d.before ?? '—'} → ${d.after}`).join('; ')}`,
      diff,
      capabilities: ['pricing'],
      appliedAt: new Date(now()).toISOString(),
      status: 'applied',
    };
    changes.record(change, raw);
    return change;
  }

  // -------------------------------------------------------------------------
  // Changes
  // -------------------------------------------------------------------------

  async function applyDevChange({ sourceProduct, changes: validated }, { skillCitations = [] } = {}) {
    const devName = assertWritableDevProduct(devNameFor(sourceProduct));
    const current = await readProduct(devName);
    if (!current.exists) {
      throw new AdminAgentError(
        `${devName} does not exist yet. Provision the dev sandbox first.`,
        'not_provisioned'
      );
    }

    const { next, diff } = applyChangeSet(current.product, validated);
    if (diff.length === 0) {
      throw new AdminAgentError(
        `Nothing to change on ${devName}: the requested values are already in place.`,
        'no_op'
      );
    }

    await writeProduct(devName, next);

    const change = {
      changeId: newChangeId(randomHex),
      productName: devName,
      sourceProduct: isDevProductName(sourceProduct) ? liveNameFor(sourceProduct) : sourceProduct,
      env: 'dev',
      summary: summarizeDiff(devName, diff),
      diff,
      capabilities: capabilitiesForChanges(validated),
      appliedAt: new Date(now()).toISOString(),
      status: 'applied',
      ...(skillCitations.length ? { skillCitations } : {}),
    };
    // The snapshot is the exact product as it was read a moment ago, so revert
    // restores that state byte for byte rather than "resetting to defaults".
    changes.record(change, current.raw || JSON.stringify(current.product));
    return change;
  }

  async function revertChange(changeId, role = 'platform') {
    const entry = changes.get(changeId);
    if (!entry) {
      throw new AdminAgentError(`No snapshot for change "${changeId}" (only the last 50 are kept).`, 'not_found');
    }
    if (entry.change.status === 'reverted') return entry.change;
    // Undoing a change is making it: the persona must own what it touched.
    assertRoleAllows(role, entry.change.capabilities || []);

    const kind = entry.change.kind || 'product';
    if (kind === 'wallet') {
      await revertTopup(entry);
      return changes.setStatus(changeId, 'reverted');
    }
    if (kind === 'mcp_product') {
      const snapshot = JSON.parse(entry.snapshotRaw);
      for (const f of ['createdAt', 'lastModifiedAt']) delete snapshot[f];
      await writeMcpDevProduct({ ...snapshot, name: entry.change.productName });
      return changes.setStatus(changeId, 'reverted');
    }
    if (kind === 'rate_card') {
      // Byte-exact: the whole dev rate card as it was read before the write.
      await writeDevRateCard(entry.snapshotRaw);
      return changes.setStatus(changeId, 'reverted');
    }
    // Only ever a dev product: the agent has no write path to a live tier, so
    // there is no second snapshot to unwind.
    const snapshot = JSON.parse(entry.snapshotRaw);
    await writeProduct(assertWritableDevProduct(entry.change.productName), snapshot);
    return changes.setStatus(changeId, 'reverted');
  }

  // -------------------------------------------------------------------------
  // Tool execution
  // -------------------------------------------------------------------------

  async function executeTool(call, events, role = 'platform', ctx = {}) {
    const name = call?.name || '(unnamed)';
    const scope = normalizeScope(ctx.scope);
    // The user view is offered insight tools only, but the model's output is
    // untrusted: refuse anything else here too.
    if (scope === 'user' && !INSIGHT_TOOL_NAMES.includes(name)) {
      events.push({ type: 'tool_call', name, summary: `${name} is not available in the user view`, ok: false });
      return { error: `"${name}" is only available to admins in the Admin Console.` };
    }
    let args;
    try {
      args = validateToolArgs(name, call?.args);
    } catch (err) {
      events.push({ type: 'tool_call', name, summary: `${name} rejected: ${err.message}`, ok: false });
      return { error: err.message };
    }
    // User view: every insight query is pinned to the caller, whatever was asked.
    const scopeEmail = scope === 'user' ? ctx.email || '' : '';
    if (scope === 'user' && !scopeEmail) {
      events.push({ type: 'tool_call', name, summary: 'No signed-in identity', ok: false });
      return { error: 'Could not determine who is signed in, so there is no usage to show.' };
    }

    try {
      switch (name) {
        case 'list_products': {
          const results = await Promise.all(
            KNOWN_PRODUCTS.map(async (n) => {
              const r = await readProduct(n);
              return projectProduct(r.product, r.exists, n);
            })
          );
          events.push({
            type: 'tool_call',
            name,
            summary: `Listed ${results.filter((p) => p.exists).length} of ${KNOWN_PRODUCTS.length} products`,
            ok: true,
          });
          return { products: results };
        }
        case 'get_product': {
          const r = await readProduct(args.name);
          if (!r.exists) {
            events.push({ type: 'tool_call', name, summary: `${args.name} not found`, ok: false });
            return { error: `Product "${args.name}" does not exist.` };
          }
          events.push({ type: 'tool_call', name, summary: `Read ${args.name}`, ok: true });
          return { product: projectProduct(r.product, true, args.name) };
        }
        case 'list_guardrails': {
          const controls = listGuardrails(args.gateway);
          events.push({
            type: 'tool_call',
            name,
            summary: `Listed ${controls.length} guardrail controls${args.gateway ? ` (${args.gateway})` : ''}`,
            ok: true,
          });
          return { controls };
        }
        case 'get_rate_card': {
          const res = await apigee(
            `/environments/${args.env}/keyvaluemaps/${RATE_KVM}/entries/${RATE_KVM_ENTRY}`
          );
          if (!res.ok) {
            events.push({ type: 'tool_call', name, summary: `Rate card read failed (HTTP ${res.status})`, ok: false });
            return { error: `Could not read the rate card (HTTP ${res.status}).` };
          }
          let rates = {};
          try {
            rates = typeof res.json?.value === 'string' ? JSON.parse(res.json.value) : res.json?.value || {};
          } catch {
            rates = {};
          }
          events.push({ type: 'tool_call', name, summary: `Read the ${args.env} rate card`, ok: true });
          return { env: args.env, rates };
        }
        case 'update_dev_product': {
          assertRoleAllows(role, capabilitiesForChanges(args.changes));
          // Screening / cache switches change how the gateway treats traffic, so
          // they must be grounded in the repo skills: consult_skill first, this turn.
          const touchesGuardrails = args.changes.some((c) => c.kind === 'attribute' && isGuardrailAttribute(c.attribute));
          const consulted = Array.isArray(ctx.consulted) ? ctx.consulted : [];
          if (touchesGuardrails && consulted.length === 0) {
            events.push({ type: 'tool_call', name, summary: 'Refused: consult_skill must come first', ok: false });
            return {
              error:
                'Guardrail switches need the playbook first: call consult_skill (skill "ai-gateway-policy-manager") ' +
                'in this turn, then retry the same change.',
            };
          }
          const change = await applyDevChange(args, {
            skillCitations: touchesGuardrails ? [...new Set(consulted)].slice(0, 6) : [],
          });
          events.push({ type: 'tool_call', name, summary: change.summary, ok: true });
          events.push({ type: 'change', change });
          return { applied: true, changeId: change.changeId, productName: change.productName, diff: change.diff };
        }
        case 'run_dev_test': {
          const result = await runDevTest(args);
          events.push({
            type: 'tool_call',
            name,
            summary: `Dev test → HTTP ${result.httpStatus}${result.model ? ` on ${result.model}` : ''}`,
            ok: result.ok,
          });
          events.push({ type: 'test', result });
          return {
            httpStatus: result.httpStatus,
            ok: result.ok,
            model: result.model,
            totalTokens: result.totalTokens,
            costUsd: result.costUsd,
            cacheStatus: result.cacheStatus,
            latencyMs: result.latencyMs,
            guardrailBlocked: result.guardrailBlocked,
            guardrails: result.guardrails,
            ...(result.guardrailsCheck ? { product: result.product, guardrailsCheck: result.guardrailsCheck } : {}),
            text: result.text.slice(0, 1500),
          };
        }
        case 'list_mcp_tools': {
          const out = await listMcpTools(args);
          events.push({
            type: 'tool_call',
            name,
            summary: out.products ? `Listed ${out.count} MCP products` : `Read ${out.product}: ${out.allowedTools.length} tools allowed`,
            ok: true,
          });
          return out;
        }
        case 'update_dev_tool_access': {
          assertRoleAllows(role, ['guardrails']);
          const consulted = Array.isArray(ctx.consulted) ? ctx.consulted : [];
          const toolSkill = consulted.filter((c) => c.startsWith('tools-gateway-manager/') || c.startsWith('apigee-proxy-builder/'));
          if (toolSkill.length === 0) {
            events.push({ type: 'tool_call', name, summary: 'Refused: consult_skill must come first', ok: false });
            return {
              error:
                'Tool access changes need the playbook first: call consult_skill (skill "tools-gateway-manager") in this ' +
                'turn, then retry the same change.',
            };
          }
          const change = await updateDevToolAccess(args, { skillCitations: [...new Set(toolSkill)].slice(0, 6) });
          events.push({ type: 'tool_call', name, summary: change.summary, ok: true });
          events.push({ type: 'change', change });
          return { applied: true, changeId: change.changeId, productName: change.productName, diff: change.diff, createdDevCopy: !!change.createdClone };
        }
        case 'run_dev_tool_test': {
          const out = await runDevToolTest(args);
          events.push({
            type: 'tool_call',
            name,
            summary: `Dev tool test → ${out.tool} ${out.outcome} (HTTP ${out.httpStatus})${out.matches === true ? ' ✓ as configured' : out.matches === false ? ' ✗ not yet as configured' : ''}`,
            ok: out.matches !== false,
          });
          events.push({ type: 'tool_test', result: out });
          return out;
        }
        case 'consult_skill': {
          const out = consultSkill(loadSkillDigest(), args.skill, args.topic);
          if (Array.isArray(ctx.consulted)) ctx.consulted.push(...out.sections.map((x) => x.citation));
          events.push({
            type: 'tool_call',
            name,
            summary: out.found
              ? `Consulted ${args.skill}: ${out.sections.map((x) => x.heading).join(' · ')}`
              : `Skill ${args.skill} not found`,
            ok: out.found,
          });
          return out;
        }
        case 'revert_change': {
          const change = await revertChange(args.changeId, role);
          events.push({ type: 'tool_call', name, summary: `Reverted ${args.changeId}`, ok: true });
          events.push({ type: 'change', change });
          return { reverted: true, changeId: change.changeId };
        }
        case 'get_wallet': {
          const wallet = await readWallet(args.developer || adminEmail.toLowerCase());
          events.push({
            type: 'tool_call',
            name,
            summary: `${wallet.developer}: $${wallet.balanceUsd.toFixed(2)} (${wallet.billingType})`,
            ok: true,
          });
          return wallet;
        }
        case 'list_rate_plans': {
          const plans = await listRatePlans(args.product);
          events.push({ type: 'tool_call', name, summary: `Listed ${plans.length} rate plan(s)`, ok: true });
          return { ratePlans: plans };
        }
        case 'topup_wallet': {
          assertRoleAllows(role, ['wallet']);
          const change = await topupWallet(args);
          events.push({ type: 'tool_call', name, summary: change.summary, ok: true });
          events.push({ type: 'change', change });
          return { applied: true, changeId: change.changeId, diff: change.diff };
        }
        case 'update_dev_rate_card': {
          assertRoleAllows(role, ['pricing']);
          const change = await updateDevRateCard(args);
          events.push({ type: 'tool_call', name, summary: change.summary, ok: true });
          events.push({ type: 'change', change });
          return { applied: true, changeId: change.changeId, diff: change.diff };
        }
        case 'query_usage': {
          const out = await insightsApi.queryUsage({ ...args, scopeEmail });
          const t = out.totals || {};
          events.push({
            type: 'tool_call',
            name,
            summary: `Usage (${out.range}, ${out.env}${out.user ? `, ${out.user}` : ''}): ${t.calls ?? 0} calls · ${(t.totalTokens ?? 0).toLocaleString('en-US')} tokens · $${Number(t.costUsd ?? 0).toFixed(4)}`,
            ok: true,
          });
          events.push({ type: 'insight', kind: 'usage', data: out });
          return out;
        }
        case 'query_tool_usage': {
          const out = await insightsApi.queryToolUsage({ ...args, scopeEmail });
          events.push({
            type: 'tool_call',
            name,
            summary: `MCP tool usage (${out.range}, ${out.env}${out.user ? `, ${out.user}` : ''}): ${out.kpis?.totalCalls ?? 0} calls`,
            ok: true,
          });
          events.push({ type: 'insight', kind: 'tools', data: out });
          return out;
        }
        case 'search_call_logs': {
          const out = await insightsApi.searchCallLogs({ ...args, scopeEmail });
          events.push({
            type: 'tool_call',
            name,
            summary: `Call logs (${out.range}${out.user ? `, ${out.user}` : ''}): ${out.counts?.total ?? 0} calls, ${(out.counts?.blocked ?? 0) + (out.counts?.error ?? 0)} failed`,
            ok: true,
          });
          events.push({ type: 'insight', kind: 'logs', data: out });
          return out;
        }
        case 'explain_failure': {
          const out = await insightsApi.explainFailure({ ...args, scopeEmail });
          events.push({
            type: 'tool_call',
            name,
            summary: out.found
              ? `Explained ${out.failedCalls ?? 1} failed call(s): ${(out.reasons || []).map((r) => r.title).slice(0, 3).join(', ')}`
              : out.message || 'No failures found',
            ok: true,
          });
          events.push({ type: 'insight', kind: 'failure', data: out });
          return out;
        }
        default:
          events.push({ type: 'tool_call', name, summary: `Unknown tool ${name}`, ok: false });
          return { error: `Unknown tool "${name}".` };
      }
    } catch (err) {
      const message = err instanceof AdminAgentError ? err.message : `Tool ${name} failed: ${err?.message || err}`;
      // "Nothing to change -- the requested values are already in place" is a
      // correct answer, not a failure. Emitting an `error` event for it painted a
      // red banner underneath an otherwise perfect reply, so it stays a plain
      // tool_call: the model still sees it and can say so in its own words.
      const benign = err instanceof AdminAgentError && err.code === 'no_op';
      events.push({ type: 'tool_call', name, summary: message, ok: benign });
      if (!benign) events.push({ type: 'error', message });
      return { error: message };
    }
  }

  async function chat(messages, adminRole, { scope: rawScope = 'admin', email = '' } = {}) {
    const role = normalizeAdminRole(adminRole);
    const scope = normalizeScope(rawScope);
    const contents = messagesToContents(messages);
    const turn = { scope, email, consulted: [] };
    const result = await runToolLoop({
      contents,
      systemInstruction:
        scope === 'user' ? userSystemInstruction(email) : SYSTEM_INSTRUCTION + roleInstruction(role),
      tools: toolsByScope[scope],
      callModel: callAgentModel,
      // One context per turn, so consult_skill can unlock a later guardrail change.
      executeTool: (call, events) => executeTool(call, events, role, turn),
      maxIterations: MAX_TOOL_ITERATIONS,
      budgetMs: TOOL_LOOP_BUDGET_MS,
      now,
    });
    return { reply: result.reply, events: result.events, usage: result.usage };
  }

  // -------------------------------------------------------------------------
  // HTTP layer
  // -------------------------------------------------------------------------

  function send(res, statusCode, payload) {
    if (res.writableEnded) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      body = JSON.stringify({ status: 'error', error: 'Response could not be serialized.' });
    }
    res.end(redactSecrets(body, [secrets.adminKey, secrets.sandboxKey, ...Object.values(secrets.productKeys)]));
  }

  function statusFor(err) {
    if (!(err instanceof AdminAgentError)) return 500;
    switch (err.code) {
      case 'invalid_argument':
      case 'unknown_tool':
        return 400;
      case 'method_not_allowed':
        return 405;
      case 'forbidden_target':
      case 'forbidden_role':
        return 403;
      case 'not_found':
        return 404;
      case 'conflict':
      case 'no_op':
        return 409;
      case 'too_large':
        return 413;
      case 'not_provisioned':
        return 409;
      case 'apigee_error':
        return 502;
      default:
        return 500;
    }
  }

  function fail(res, err) {
    const code = err instanceof AdminAgentError ? err.code : 'internal_error';
    const message = err instanceof AdminAgentError ? err.message : err?.message || String(err);
    if (!(err instanceof AdminAgentError)) {
      logger.error?.('[AdminAgent] Unhandled error:', err);
    }
    send(res, statusFor(err), { status: 'error', code, error: message });
  }

  async function jsonBody(req) {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AdminAgentError('Request body must be a JSON object.');
      }
      return parsed;
    } catch (err) {
      if (err instanceof AdminAgentError) throw err;
      throw new AdminAgentError('Request body is not valid JSON.');
    }
  }

  function requireMethod(req, method) {
    if (req.method !== method) {
      throw new AdminAgentError(`Method ${req.method} not allowed; use ${method}.`, 'method_not_allowed');
    }
  }

  async function handleRequest(req, res, parsedUrl) {
    const route = parsedUrl.pathname.replace(/^\/api\/admin-agent/, '').replace(/\/$/, '') || '/';
    try {
      switch (route) {
        case '/sandbox': {
          requireMethod(req, 'GET');
          const status = await sandboxStatus();
          return send(res, 200, { status: 'ok', ...status });
        }
        case '/sandbox/provision': {
          requireMethod(req, 'POST');
          await jsonBody(req);
          const result = await provisionSandbox();
          return send(res, 200, { status: 'ok', ...result });
        }
        case '/chat': {
          requireMethod(req, 'POST');
          const body = await jsonBody(req);
          const scope = normalizeScope(body.scope);
          // The identity comes from the request (IAP header), never from the body.
          const email = scope === 'user' ? callerEmailFrom(req, adminEmail) : '';
          const result = await chat(body.messages, body.adminRole, { scope, email });
          return send(res, 200, { status: 'ok', scope, ...result });
        }
        case '/changes': {
          requireMethod(req, 'GET');
          return send(res, 200, { status: 'ok', changes: changes.list() });
        }
        case '/revert': {
          requireMethod(req, 'POST');
          const body = await jsonBody(req);
          const change = await revertChange(String(body.changeId || '').trim(), normalizeAdminRole(body.adminRole));
          return send(res, 200, { status: 'ok', change });
        }
        case '/promote': {
          // Deliberately still routed rather than deleted. A browser tab left
          // open from before this change would otherwise get an opaque 404;
          // this tells whoever hit it where production changes actually go.
          throw new AdminAgentError(
            'Promoting to production from Ask Apigee is disabled. The agent only ' +
              'changes the dev sandbox. Production changes go through a pull request ' +
              'against the product definitions in git.',
            'forbidden_target'
          );
        }
        case '/test': {
          requireMethod(req, 'POST');
          const body = await jsonBody(req);
          const args = validateToolArgs('run_dev_test', { prompt: body.prompt, model: body.model });
          const result = await runDevTest(args);
          return send(res, 200, { status: 'ok', result });
        }
        default:
          return send(res, 404, {
            status: 'error',
            code: 'unknown_route',
            error: `Unknown admin-agent route "${parsedUrl.pathname}".`,
          });
      }
    } catch (err) {
      // Nothing below this point may reject: an unhandled rejection here would
      // take the whole demo server down.
      try {
        return fail(res, err);
      } catch (sendErr) {
        logger.error?.('[AdminAgent] Failed to send error response:', sendErr);
        if (!res.writableEnded) res.end();
      }
    }
  }

  return {
    handleRequest,
    // Exposed for tests and for the live end-to-end check.
    _internals: {
      changes,
      secrets,
      tools: toolsByScope.admin,
      toolsByScope,
      insights: insightsApi,
      applyDevChange,
      revertChange,
      topupWallet,
      updateDevRateCard,
      readWallet,
      runDevTest,
      executeTool,
      chat,
      sandboxStatus,
      provisionSandbox,
      callAgentModel,
      readProduct,
      identityToken,
    },
  };
}
