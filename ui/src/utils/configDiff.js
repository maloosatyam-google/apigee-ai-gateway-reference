/**
 * Dev ↔ Prod configuration diff for the Admin Console "Compare with Prod" view.
 *
 * Pure: takes the product / rate-card objects the console already loaded and
 * returns rows describing what differs. Identity fields that are expected to
 * differ between a dev clone and the live tier (name, displayName, description,
 * environments, approvalType, timestamps) are ignored.
 */

/**
 * Shown when someone tries to save in the Prod view. Must match
 * PROD_READ_ONLY_MESSAGE in server/consoleEnv.js (the server enforces it; the
 * Cloud Run image doesn't ship src/, so each side keeps a copy and a unit test
 * keeps them identical).
 */
export const PROD_READ_ONLY_MESSAGE =
  'Production is read-only. Changes reach prod through Git: make them in Dev, commit them to the ' +
  'repo, and raise a pull request. Prod is updated after the PR is reviewed and merged.';

/** @typedef {'added'|'removed'|'changed'} ChangeKind */
/** @typedef {{ section: string, key: string, dev: string|null, prod: string|null, kind: ChangeKind }} DiffRow */

const IGNORED_ATTRIBUTES = new Set(['access']);

function quotaText(q) {
  if (!q || !q.limit) return 'no token quota';
  return `${q.limit} tokens / ${q.interval || '1'} ${q.timeUnit || 'minute'}`;
}

/** model -> token-quota text, from llmOperationGroup.operationConfigs. */
export function modelQuotaMap(product) {
  const out = new Map();
  for (const cfg of product?.llmOperationGroup?.operationConfigs || []) {
    for (const op of cfg.llmOperations || []) {
      if (op?.model && !out.has(op.model)) out.set(op.model, quotaText(cfg.llmTokenQuota));
    }
  }
  return out;
}

function attributeMap(product) {
  const out = new Map();
  for (const a of product?.attributes || []) {
    if (a?.name && !IGNORED_ATTRIBUTES.has(a.name)) out.set(a.name, String(a.value ?? ''));
  }
  return out;
}

function productQuota(product) {
  if (!product?.quota) return null;
  return `${product.quota} requests / ${product.quotaInterval || '1'} ${product.quotaTimeUnit || 'minute'}`;
}

function diffMaps(section, devMap, prodMap, rows) {
  const keys = new Set([...devMap.keys(), ...prodMap.keys()]);
  for (const key of [...keys].sort()) {
    const dev = devMap.has(key) ? devMap.get(key) : null;
    const prod = prodMap.has(key) ? prodMap.get(key) : null;
    if (dev === prod) continue;
    rows.push({
      section,
      key,
      dev,
      prod,
      kind: prod === null ? 'added' : dev === null ? 'removed' : 'changed',
    });
  }
}

/**
 * @param {object|undefined} devProduct
 * @param {object|undefined} prodProduct
 * @returns {DiffRow[]}  'added' = only in Dev, 'removed' = only in Prod
 */
export function diffProducts(devProduct, prodProduct) {
  const rows = [];
  diffMaps('Models & token quotas', modelQuotaMap(devProduct), modelQuotaMap(prodProduct), rows);
  diffMaps('Routing & attributes', attributeMap(devProduct), attributeMap(prodProduct), rows);
  const dq = productQuota(devProduct);
  const pq = productQuota(prodProduct);
  if (dq !== pq) {
    rows.push({
      section: 'Request quota',
      key: 'quota',
      dev: dq,
      prod: pq,
      kind: pq === null ? 'added' : dq === null ? 'removed' : 'changed',
    });
  }
  return rows;
}

function rateText(r) {
  if (!r) return null;
  const tier = r.tier ? `, ${r.tier}` : '';
  return `$${Number(r.input ?? 0)} in / $${Number(r.output ?? 0)} out per 1M${tier}`;
}

/**
 * @param {Record<string, {input?:number, output?:number, tier?:string}>} devRates
 * @param {Record<string, {input?:number, output?:number, tier?:string}>} prodRates
 * @returns {DiffRow[]}
 */
export function diffRateCards(devRates, prodRates) {
  const rows = [];
  const toMap = (rates) => new Map(Object.entries(rates || {}).map(([k, v]) => [k, rateText(v)]));
  diffMaps('Model rate card', toMap(devRates), toMap(prodRates), rows);
  return rows;
}
