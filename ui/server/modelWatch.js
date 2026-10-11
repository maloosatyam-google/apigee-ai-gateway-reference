/**
 * Model & pricing watch for the Admin Console (/api/model-watch).
 *
 * The daily `model-watch` Cloud Run job (services/model-watch/watch.py) writes
 * gs://<bucket>/model-watch/latest.json with the official prices (Vertex AI + Gemini API)
 * and the Gemini API changelog. This module compares that report with what the gateway
 * actually bills (the live `ai-model-rates` KVM) and with the models the persona products
 * entitle, and tells the admin what needs attention:
 *
 *   - rate-card drift   a card price differs from the official list price
 *   - deprecations      a changelog deprecation/shutdown names a model a product uses
 *   - price schedule    an official price change is coming (e.g. 2027-01-01)
 *   - new models        recent releases that are not in the rate card yet
 *   - page price changes ANY price on the Vertex AI pricing page that changed in the last
 *                       30 days (all models and modes), flagged when it is a model in use
 *   - watcher health    a page failed to fetch or its layout changed
 *
 *   GET  /api/model-watch       report + analysis (+ proposed rate card)
 *   POST /api/model-watch/run   run the job now (Cloud Run Jobs API)
 */

export const RATE_BANDS = Object.freeze({ lowMaxOutput: 0.3, highMinOutput: 5.0 });
const TEXT_MODEL_RE = /^(gemini-[0-9][0-9.]*-(flash|pro)(-lite)?(-preview)?|claude-(opus|sonnet|haiku)-[0-9]+(-[0-9]+)?)$/;

/** Models the gateway uses outside the API products (the semantic cache embeds every prompt). */
export const DEFAULT_EXTRA_IN_USE = (process.env.MODEL_WATCH_EXTRA_IN_USE || 'text-embedding-005')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Announced models to watch for. When one shows up on the pricing page or in the changelog,
 * the admin is told it is available and which current model it is meant to replace.
 */
export const DEFAULT_WATCHLIST = [
  {
    name: 'Gemini 4 Argon',
    pattern: 'gemini[- ]?4[- ]?argon',
    replaces: 'gemini-3.1-pro-preview',
    note: 'Announced 2026-09-30 at $2 / $10 per 1M tokens (introductory); limited rollout first.',
    url: 'https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/',
  },
];
const RECENT_DAYS = { deprecation: 120, release: 45 };

/** Tier bands by OUTPUT rate, same rule as model_rate_card.json and JS-CalculateCost. */
export function tierFor(output) {
  if (output <= RATE_BANDS.lowMaxOutput) return 'low';
  if (output >= RATE_BANDS.highMinOutput) return 'high';
  return 'medium';
}

const baseModel = (m) => String(m || '').split('@')[0];

/** Page display name -> model id: 'Gemini 3.8 Flash*through Dec 31, 2026' -> gemini-3.8-flash. */
export function displayToModelId(display, section = '') {
  let d = String(display || '').replace(/\*.*$/, '').replace(/(through|starting)\b.*$/i, '').trim();
  if (/claude/i.test(section) && /^(opus|sonnet|haiku)\b/i.test(d)) d = `Claude ${d}`;
  if (!/^(gemini|claude)\b/i.test(d)) return null;
  const slug = d.toLowerCase().replace(/\s+/g, '-');
  return slug.startsWith('claude') ? slug.replace(/\./g, '-') : slug;
}
const daysBetween = (aIso, bIso) => (Date.parse(bIso) - Date.parse(aIso)) / 86_400_000;

function officialPrice(report, model) {
  const v = report?.vertex?.[model];
  if (v && Number.isFinite(v.input) && Number.isFinite(v.output)) return { ...v, source: 'vertex' };
  const g = report?.gemini?.[model];
  if (g && Number.isFinite(g.input) && Number.isFinite(g.output)) return { ...g, source: 'gemini' };
  return null;
}

const REPLACEMENT_CUE = /\b(replaced by|migrate (your requests )?to|use\s+\S+\s+instead|update your model string to|successor|routed to)\b/i;

/**
 * A notice names both the model being retired and its replacement
 * ("gemini-3.5-flash is deprecated and has been replaced by gemini-3.6-flash").
 * Models before the first replacement cue are retiring; models only after it are replacements.
 */
export function splitRetiringAndReplacements(entry) {
  const models = entry?.models || [];
  const text = String(entry?.text || '');
  const cut = text.search(REPLACEMENT_CUE);
  if (cut < 0) return { retiring: models, replacements: [] };
  const head = text.slice(0, cut);
  const retiring = models.filter((m) => new RegExp(`\\b${m.replace(/[.]/g, '\\.')}\\b`).test(head));
  return { retiring, replacements: models.filter((m) => !retiring.includes(m)) };
}

/**
 * Pure comparison of a watcher report with the live rate card.
 * @param {object} report       latest.json from the watcher
 * @param {object} rateCard     parsed `ai-model-rates` rate_card (may include _comment)
 * @param {object} [opts]
 * @param {string[]} [opts.inUseModels]  models entitled by the persona products
 * @param {string}   [opts.now]          ISO time (tests)
 */
export function analyzeModelWatch(report, rateCard, {
  inUseModels = [], extraInUse = DEFAULT_EXTRA_IN_USE, watchlist = DEFAULT_WATCHLIST, now = new Date().toISOString(),
} = {}) {
  const card = Object.fromEntries(Object.entries(rateCard || {}).filter(([k]) => k !== '_comment' && k !== 'default'));
  const inUse = new Set([...inUseModels, ...extraInUse].map(baseModel));

  const drift = [];
  const unverified = [];
  const upcoming = [];
  for (const [model, entry] of Object.entries(card)) {
    const off = officialPrice(report, model);
    if (!off) {
      unverified.push({ model, inUse: inUse.has(model) });
      continue;
    }
    const officialTier = tierFor(off.output);
    if (entry.input !== off.input || entry.output !== off.output || entry.tier !== officialTier) {
      drift.push({
        model,
        inUse: inUse.has(model),
        card: { input: entry.input, output: entry.output, tier: entry.tier },
        official: { input: off.input, output: off.output, tier: officialTier, source: off.source, until: off.until || null },
      });
    }
    if (off.next && Number.isFinite(off.next.output) && off.next.from) {
      const inDays = Math.ceil(daysBetween(now, `${off.next.from}T00:00:00Z`));
      if (inDays >= 0 && inDays <= 120) {
        upcoming.push({
          model, inUse: inUse.has(model), from: off.next.from, inDays,
          now: { input: off.input, output: off.output }, next: { input: off.next.input, output: off.next.output, tier: tierFor(off.next.output) },
        });
      }
    }
  }

  const changelog = Array.isArray(report?.changelog) ? report.changelog : [];
  const watched = new Set([...Object.keys(card), ...inUse]);
  const deprecations = changelog
    .filter((e) => (e.kinds || []).some((k) => k === 'deprecation' || k === 'shutdown'))
    .filter((e) => daysBetween(e.date, now) <= RECENT_DAYS.deprecation)
    .map((e) => {
      const { retiring, replacements } = splitRetiringAndReplacements(e);
      const affected = retiring.filter((m) => watched.has(m));
      return {
        id: e.id, date: e.date, text: e.text, kinds: e.kinds, models: e.models || [],
        retiring, replacements, affected, inUse: affected.some((m) => inUse.has(m)),
      };
    })
    .filter((e) => e.affected.length > 0)
    .sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.date.localeCompare(a.date));

  const newModels = [];
  const seenNew = new Set();
  for (const e of changelog) {
    if (!(e.kinds || []).includes('release') || daysBetween(e.date, now) > RECENT_DAYS.release) continue;
    for (const m of e.models || []) {
      if (!TEXT_MODEL_RE.test(m) || card[m] || seenNew.has(m)) continue;
      seenNew.add(m);
      const off = officialPrice(report, m);
      newModels.push({ model: m, date: e.date, text: e.text, price: off ? { input: off.input, output: off.output, tier: tierFor(off.output) } : null });
    }
  }
  // Text models priced on the official pages but missing from the card (e.g. a GA successor).
  for (const m of Object.keys({ ...(report?.vertex || {}), ...(report?.gemini || {}) })) {
    if (seenNew.has(m) || card[m] || !TEXT_MODEL_RE.test(m)) continue;
    const replaces = deprecations.find((d) => d.replacements.includes(m) && d.affected.length);
    if (!replaces) continue;
    seenNew.add(m);
    const off = officialPrice(report, m);
    newModels.push({ model: m, date: replaces.date, text: `Named as a replacement in: ${replaces.text.slice(0, 160)}`, price: off ? { input: off.input, output: off.output, tier: tierFor(off.output) } : null });
  }

  // Every price change on the Vertex AI page in the last 30 days (all models, all modes).
  const pageChanges = (Array.isArray(report?.recentPriceChanges) ? report.recentPriceChanges : []).map((c) => {
    const id = displayToModelId(c.model, c.section);
    return { ...c, modelId: id, inUse: !!id && inUse.has(id), inCard: !!id && !!card[id] };
  }).sort((a, b) => Number(b.inUse) - Number(a.inUse) || Number(b.inCard) - Number(a.inCard) || String(b.detectedAt).localeCompare(String(a.detectedAt)));

  // Announced models we are waiting for (e.g. Gemini 4 Argon to replace gemini-3.1-pro-preview).
  const pageModels = [...new Set(Object.values(report?.allPrices || {}).map((v) => v.model))];
  const watched2 = watchlist.map((w) => {
    const rx = new RegExp(w.pattern, 'i');
    const onPage = pageModels.find((m) => rx.test(m)) || Object.keys({ ...(report?.vertex || {}), ...(report?.gemini || {}) }).find((m) => rx.test(m));
    const inChangelog = changelog.find((e) => rx.test(e.text) || (e.models || []).some((m) => rx.test(m)));
    const price = onPage ? officialPrice(report, displayToModelId(onPage) || onPage) : null;
    return {
      name: w.name, replaces: w.replaces, note: w.note, url: w.url,
      status: onPage || inChangelog ? 'available' : 'waiting',
      seenOn: onPage ? 'Vertex AI pricing' : inChangelog ? `Gemini API changelog (${inChangelog.date})` : null,
      price: price ? { input: price.input, output: price.output, tier: tierFor(price.output) } : null,
    };
  });

  const proposed = proposeRateCard(rateCard, drift);
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const needsAction = drift.length > 0 || deprecations.some((d) => d.inUse) || pageChanges.some((c) => c.inUse)
    || watched2.some((w) => w.status === 'available');
  const status = errors.length ? 'error' : needsAction ? 'action'
    : (deprecations.length || upcoming.length || newModels.length || pageChanges.length) ? 'info' : 'ok';
  const signature = hash(JSON.stringify({
    d: drift.map((x) => [x.model, x.official.input, x.official.output]),
    p: deprecations.map((x) => x.id),
    n: newModels.map((x) => x.model),
    u: upcoming.map((x) => [x.model, x.from]),
    e: errors.map((x) => x.source),
    c: pageChanges.map((x) => x.id),
    w: watched2.map((x) => [x.name, x.status]),
  }));

  return {
    status,
    signature,
    counts: {
      drift: drift.length, deprecationsInUse: deprecations.filter((d) => d.inUse).length, deprecations: deprecations.length,
      upcoming: upcoming.length, newModels: newModels.length, errors: errors.length,
      pageChanges: pageChanges.length, pageChangesInUse: pageChanges.filter((c) => c.inUse).length,
      watchlistAvailable: watched2.filter((w) => w.status === 'available').length,
    },
    drift,
    deprecations,
    upcoming,
    newModels,
    pageChanges,
    watchlist: watched2,
    inUseModels: [...inUse],
    unverified,
    proposedRateCard: drift.length ? proposed : null,
  };
}

/** Rate card with drifted prices/tiers corrected. Keys, order and _comment are preserved. */
export function proposeRateCard(rateCard, drift) {
  const out = JSON.parse(JSON.stringify(rateCard || {}));
  for (const d of drift) {
    if (!out[d.model]) continue;
    out[d.model] = { ...out[d.model], input: d.official.input, output: d.official.output, tier: d.official.tier };
  }
  return out;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function createModelWatchService({
  getToken,
  org,
  project = org,
  region = process.env.GCP_REGION || 'asia-southeast1',
  bucket,
  prefix = process.env.MODEL_WATCH_PREFIX || 'model-watch',
  jobName = process.env.MODEL_WATCH_JOB || 'model-watch',
  personaProducts = [],
  githubRepo = process.env.MODEL_WATCH_GITHUB_REPO || '',
  githubBranch = process.env.MODEL_WATCH_GITHUB_BRANCH || 'main',
  rateCardPath = 'apigee/config/model_rate_card.json',
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date().toISOString(),
  logger = console,
} = {}) {
  let cache = null; // { at, body }

  async function authHeaders() {
    const token = await getToken();
    if (!token) throw Object.assign(new Error('Could not get a GCP access token.'), { status: 502 });
    return { Authorization: `Bearer ${token}` };
  }

  async function readReport(headers) {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(`${prefix}/latest.json`)}?alt=media`;
    const res = await fetchImpl(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`Reading the watch report failed (HTTP ${res.status}).`), { status: 502 });
    return res.json();
  }

  async function readRateCard(headers) {
    const url = `https://apigee.googleapis.com/v1/organizations/${org}/environments/prod/keyvaluemaps/ai-model-rates/entries/rate_card`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw Object.assign(new Error(`Reading the prod rate card failed (HTTP ${res.status}).`), { status: 502 });
    const entry = await res.json();
    return JSON.parse(entry.value || '{}');
  }

  async function readInUseModels(headers) {
    const models = new Set();
    await Promise.all(personaProducts.map(async (name) => {
      try {
        const res = await fetchImpl(`https://apigee.googleapis.com/v1/organizations/${org}/apiproducts/${encodeURIComponent(name)}`, { headers });
        if (!res.ok) return;
        const p = await res.json();
        for (const c of p?.llmOperationGroup?.operationConfigs || []) {
          for (const o of c.llmOperations || []) if (o.model && o.model !== 'auto') models.add(baseModel(o.model));
        }
        for (const a of p?.attributes || []) if (a.name?.startsWith('routing.model.') && a.value) models.add(baseModel(a.value));
      } catch (err) {
        logger.warn?.(`[model-watch] product ${name}: ${err.message}`);
      }
    }));
    return [...models];
  }

  async function status() {
    if (cache && Date.now() - cache.at < 60_000) return cache.body;
    const headers = await authHeaders();
    const [report, rateCard, inUseModels] = await Promise.all([readReport(headers), readRateCard(headers), readInUseModels(headers)]);
    const github = githubRepo
      ? { repo: githubRepo, branch: githubBranch, path: rateCardPath, editUrl: `https://github.com/${githubRepo}/edit/${githubBranch}/${rateCardPath}` }
      : null;
    const body = report
      ? {
          configured: true,
          checkedAt: report.checkedAt,
          sources: report.sources,
          errors: report.errors || [],
          sourceDisagreements: report.sourceDisagreements || [],
          changesSinceLastRun: report.changesSinceLastRun || { prices: [], changelog: [] },
          inUseModels,
          analysis: analyzeModelWatch(report, rateCard, { inUseModels, now: now() }),
          github,
        }
      : { configured: false, bucket, prefix, github, message: 'No report yet. Deploy services/model-watch and run it once (or press Check now).' };
    cache = { at: Date.now(), body };
    return body;
  }

  async function runNow() {
    const headers = await authHeaders();
    const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${jobName}:run`;
    const res = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Starting ${jobName} failed (HTTP ${res.status}): ${text.slice(0, 200)}`), { status: res.status === 404 ? 404 : 502 });
    cache = null;
    let op = {};
    try { op = JSON.parse(text); } catch { /* not JSON */ }
    return { started: true, operation: op.name || null };
  }

  function send(res, code, body) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }

  async function handleRequest(req, res, parsedUrl) {
    const path = parsedUrl.pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && path === '/api/model-watch') return send(res, 200, await status());
      if (req.method === 'POST' && path === '/api/model-watch/run') return send(res, 202, await runNow());
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      logger.error?.(`[model-watch] ${err.message}`);
      return send(res, err.status || 500, { error: err.message });
    }
  }

  return { handleRequest, status, runNow };
}
