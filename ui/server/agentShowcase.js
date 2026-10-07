// Agent Showcase backend (/api/agent-showcase/*), shared by ui/server.js and the Vite dev
// middleware.
//
// The browser never sees a key. For each run this module resolves, server-side:
//   - the caller's identity token (the IAP assertion, or the same minted stand-in /api/me
//     hands out on localhost) -- sent on every gateway hop so calls are attributed to the user;
//   - the persona keys: Support & Sales (governed agent) and the caller's Engineering & IT
//     admin key (baseline agent's MCP calls);
// then calls the private agent-showcase-api Cloud Run service with a Google ID token and
// pipes its Server-Sent Events straight back to the browser.

import { getIdentityToken as defaultGetIdentityToken } from './demoReset.js';
import { mintSyntheticIdentityToken } from './adminAgentCore.js';
import { APIGEE_ORG, SSO_USER_EMAIL, AGENT_SHOWCASE_URL } from './deployConfig.js';

export { AGENT_SHOWCASE_URL };

const ORG = APIGEE_ORG;
const KEY_CACHE_MS = 5 * 60 * 1000;
const MAX_PROMPT = 4000;
const SIDES = ['baseline', 'governed'];

/** Caller email as /api/me resolves it: IAP header first, then the configured default. */
export function callerEmail(req, fallbackEmail) {
  const raw = String(req.headers['x-goog-authenticated-user-email'] || '');
  const clean = raw.replace(/^accounts\.google\.com:/, '').trim();
  return clean || fallbackEmail;
}

/** Validated run body, or throws an Error with `.status = 400`. */
export function parseRunBody(body) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!body || typeof body !== 'object') throw bad('Body must be a JSON object.');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw bad('Enter a prompt.');
  if (prompt.length > MAX_PROMPT) throw bad(`Prompt is longer than ${MAX_PROMPT} characters.`);
  const sides = Array.isArray(body.sides) ? body.sides.filter((s) => SIDES.includes(s)) : SIDES;
  if (!sides.length) throw bad('Choose at least one side.');
  const profileId = typeof body.profileId === 'string' && body.profileId ? body.profileId : 'customer_service';
  // false only for the quota burst: the governed agent then skips the semantic cache.
  const useCache = body.useCache !== false;
  // Baseline agent's model (UI switch). The agent service checks it against its allow-list.
  const baselineModel = typeof body.baselineModel === 'string' && /^gemini[A-Za-z0-9.\-]*$/.test(body.baselineModel) ? body.baselineModel : null;
  // Theme industry: with a pack, both agents use its instruction and MCP server (agent service).
  const industry = typeof body.industry === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(body.industry) ? body.industry : null;
  return { prompt, sides, profileId, useCache, baselineModel, industry };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Body is not valid JSON.'), { status: 400 });
  }
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/**
 * @param {{
 *   getToken: () => Promise<string|null>,                          // GCP access token (Apigee mgmt)
 *   provision: (org: string, token: string, email: string) => Promise<{apiKeys?: Record<string,string>}>,
 *   getIdentityToken?: (audience: string) => Promise<string|null>,  // Cloud Run ID token
 *   fetchImpl?: typeof fetch,
 *   serviceUrl?: string,
 *   defaultEmail?: string,
 *   now?: () => number,
 * }} deps
 */
export function createAgentShowcaseService(deps) {
  const {
    getToken,
    provision,
    getIdentityToken = defaultGetIdentityToken,
    fetchImpl = (...a) => globalThis.fetch(...a),
    serviceUrl = AGENT_SHOWCASE_URL,
    defaultEmail = SSO_USER_EMAIL,
    now = () => Date.now(),
  } = deps;

  const keyCache = new Map(); // email -> { at, keys }

  async function personaKeys(email) {
    const hit = keyCache.get(email);
    if (hit && now() - hit.at < KEY_CACHE_MS) return hit.keys;
    const token = await getToken();
    if (!token) throw Object.assign(new Error('Could not get a GCP access token to look up API keys.'), { status: 502 });
    const result = await provision(ORG, token, email);
    const keys = {
      governed: result?.apiKeys?.sales_agent || '',
      baseline: result?.apiKeys?.admin || '',
    };
    if (!keys.governed || !keys.baseline) {
      throw Object.assign(
        new Error(
          `Missing API key for the ${!keys.governed ? 'Support & Sales (governed)' : 'Engineering & IT (baseline)'} agent. ` +
            'Sign in once on the AI Gateway tab so your developer app is provisioned.'
        ),
        { status: 409 }
      );
    }
    keyCache.set(email, { at: now(), keys });
    return keys;
  }

  async function serviceHeaders() {
    const idToken = await getIdentityToken(serviceUrl);
    if (!idToken) throw Object.assign(new Error('Could not get an ID token for the agent service.'), { status: 502 });
    return { Authorization: `Bearer ${idToken}` };
  }

  async function handleProfiles(res) {
    const r = await fetchImpl(`${serviceUrl}/v1/profiles`, { headers: await serviceHeaders() });
    sendJson(res, r.status, await r.json().catch(() => ({ error: `Agent service HTTP ${r.status}` })));
  }

  async function handleRun(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
    const { prompt, sides, profileId, useCache, baselineModel, industry } = parseRunBody(await readJson(req));
    const email = callerEmail(req, defaultEmail);
    const identityToken = String(req.headers['x-goog-iap-jwt-assertion'] || '') || mintSyntheticIdentityToken(email, email.split('@')[0]);
    const keys = await personaKeys(email);

    const controller = new AbortController();
    // Stop both agents when the presenter navigates away or clears the run.
    res.on('close', () => controller.abort());

    const upstream = await fetchImpl(`${serviceUrl}/v1/showcase/run`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...(await serviceHeaders()),
        'Content-Type': 'application/json',
        'X-Showcase-Identity-Token': identityToken,
        'X-Showcase-User-Email': email,
        'X-Showcase-Governed-Key': keys.governed,
        'X-Showcase-Baseline-Key': keys.baseline,
      },
      body: JSON.stringify({ prompt, sides, profile_id: profileId, use_cache: useCache, ...(baselineModel ? { baseline_model: baselineModel } : {}), ...(industry ? { industry } : {}) }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      let detail = text;
      try {
        detail = JSON.parse(text).detail || text;
      } catch {
        // not JSON
      }
      return sendJson(res, upstream.status || 502, { error: `Agent service: ${detail || `HTTP ${upstream.status}`}` });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    try {
      for await (const chunk of upstream.body) {
        if (res.writableEnded || res.destroyed) break;
        res.write(chunk);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        res.write(`data: ${JSON.stringify({ type: 'stream_error', error: err?.message || String(err) })}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  }

  async function handleRequest(req, res, parsedUrl) {
    const sub = parsedUrl.pathname.replace(/^\/api\/agent-showcase\/?/, '');
    try {
      if (sub === 'run') return await handleRun(req, res);
      if (sub === 'profiles') return await handleProfiles(res);
      if (sub === '' || sub === 'config') return sendJson(res, 200, { serviceUrl, sides: SIDES });
      return sendJson(res, 404, { error: `Unknown agent-showcase route: /${sub}` });
    } catch (err) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      return sendJson(res, err?.status || 500, { error: err?.message || String(err) });
    }
  }

  return { handleRequest, personaKeys };
}
