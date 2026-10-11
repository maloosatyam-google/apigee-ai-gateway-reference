import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeModelWatch, proposeRateCard, tierFor, createModelWatchService, splitRetiringAndReplacements, displayToModelId } from '../server/modelWatch.js';

const CARD = JSON.parse(readFileSync(new URL('../../apigee/config/model_rate_card.json', import.meta.url), 'utf8'));
const NOW = '2026-10-10T06:00:00Z';

// Official prices as the watcher reports them (2026-10-10), plus one deliberate change.
const REPORT = {
  checkedAt: NOW,
  errors: [],
  vertex: {
    'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
    'gemini-3.5-flash': { input: 1.5, output: 9.0 },
    'gemini-3.6-flash': { input: 0.75, output: 3.75, until: '2026-12-31', next: { from: '2027-01-01', input: 1.5, output: 7.5 } },
    'gemini-3.8-flash': { input: 0.75, output: 3.75, until: '2026-12-31', next: { from: '2027-01-01', input: 1.5, output: 7.5 } },
    'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
    'gemini-2.5-pro': { input: 1.25, output: 10.0 },
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
    'claude-opus-4-5': { input: 5.0, output: 22.0 }, // changed
    'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
    'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  },
  gemini: { 'gemini-3-flash-preview': { input: 0.5, output: 3.0 } },
  changelog: [
    { id: 'a1', date: '2026-10-08', kinds: ['deprecation'], models: ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'],
      text: 'Gemini 3.5 Flash deprecation : gemini-3.5-flash is deprecated and has been replaced by gemini-3.6-flash .' },
    { id: 'a2', date: '2026-10-06', kinds: ['deprecation'], models: ['gemini-3.1-flash-image'], text: 'Image model deprecated.' },
    { id: 'a3', date: '2026-09-02', kinds: ['release'], models: ['gemini-3.8-flash'], text: 'Gemini 3.8 Flash GA.' },
    { id: 'a4', date: '2026-01-02', kinds: ['shutdown'], models: ['gemini-2.5-flash'], text: 'Old shutdown, outside the window.' },
  ],
};
const IN_USE = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'claude-haiku-4-5', 'claude-opus-4-5@20251101'];

test('tier bands follow the rate card rule', () => {
  assert.equal(tierFor(0.3), 'low');
  assert.equal(tierFor(3.75), 'medium');
  assert.equal(tierFor(5), 'high');
});

test('drift: only the changed price is reported, with the official tier', () => {
  const a = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  assert.deepEqual(a.drift.map((d) => d.model), ['claude-opus-4-5']);
  assert.equal(a.drift[0].inUse, true, '@version suffix is stripped when matching in-use models');
  assert.deepEqual(a.drift[0].official, { input: 5.0, output: 22.0, tier: 'high', source: 'vertex', until: null });
  assert.equal(a.status, 'action');
});

test('deprecations: only those naming watched models, in-use first; old ones fall out of the window', () => {
  const a = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  assert.deepEqual(a.deprecations.map((d) => d.id), ['a1']);
  assert.equal(a.deprecations[0].inUse, true);
  assert.deepEqual(a.deprecations[0].affected, ['gemini-3.5-flash'], 'the replacement (3.8) is not "affected"');
  assert.deepEqual(a.deprecations[0].replacements, ['gemini-3.6-flash', 'gemini-3.8-flash']);
});

test('retiring vs replacement models are split on the replacement cue', () => {
  const e = { text: 'gemini-3.7-flash is deprecated and has been replaced by gemini-3.8-flash . All requests are routed to gemini-3.8-flash .',
    models: ['gemini-3.7-flash', 'gemini-3.8-flash'] };
  assert.deepEqual(splitRetiringAndReplacements(e), { retiring: ['gemini-3.7-flash'], replacements: ['gemini-3.8-flash'] });
  assert.deepEqual(splitRetiringAndReplacements({ text: 'gemini-2.0-flash is shut down', models: ['gemini-2.0-flash'] }),
    { retiring: ['gemini-2.0-flash'], replacements: [] });
});

test('a deprecation replacement that is priced but not in the card is offered as a new model', () => {
  const { 'gemini-3.6-flash': _omit, ...cardWithout36 } = CARD;  // as before 3.6 Flash was added
  const a = analyzeModelWatch(REPORT, cardWithout36, { inUseModels: IN_USE, now: NOW });
  const m = a.newModels.find((n) => n.model === 'gemini-3.6-flash');
  assert.ok(m, 'gemini-3.6-flash suggested');
  assert.deepEqual(m.price, { input: 0.75, output: 3.75, tier: 'medium' });
});

test('upcoming scheduled price changes within 120 days', () => {
  const a = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  const u = a.upcoming.find((x) => x.model === 'gemini-3.8-flash');
  assert.equal(u.from, '2027-01-01');
  assert.equal(u.next.tier, 'high');
  assert.equal(u.inDays, 83);
});

test('proposed rate card fixes drift and keeps keys, order and comments', () => {
  const a = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  const p = a.proposedRateCard;
  assert.deepEqual(Object.keys(p), Object.keys(CARD));
  assert.deepEqual(p._comment, CARD._comment);
  assert.equal(p['claude-opus-4-5'].output, 22.0);
  assert.equal(p['claude-opus-4-5'].provider, 'anthropic');
  assert.deepEqual(proposeRateCard(CARD, []), CARD);
});

test('a card that matches the official prices is ok and has no proposal', () => {
  const report = { ...REPORT, vertex: { ...REPORT.vertex, 'claude-opus-4-5': { input: 5, output: 25 } }, changelog: [] };
  const a = analyzeModelWatch(report, CARD, { inUseModels: IN_USE, now: NOW });
  assert.equal(a.drift.length, 0);
  assert.equal(a.proposedRateCard, null);
  assert.equal(a.status, 'info'); // the scheduled 2027 price change is still worth showing
});

test('watcher errors make the status "error"; the signature changes when findings change', () => {
  const ok = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  const err = analyzeModelWatch({ ...REPORT, errors: [{ source: 'vertex', error: 'layout changed' }] }, CARD, { inUseModels: IN_USE, now: NOW });
  assert.equal(err.status, 'error');
  assert.notEqual(ok.signature, err.signature);
});

test('service: GET merges report, live rate card and product models; POST starts the job', async () => {
  const calls = [];
  const product = { llmOperationGroup: { operationConfigs: [{ llmOperations: [{ model: 'gemini-3.5-flash' }, { model: 'auto' }] }] },
    attributes: [{ name: 'routing.model.simple', value: 'gemini-3.5-flash-lite' }] };
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url)]);
    const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (String(url).includes('storage.googleapis.com')) return json(REPORT);
    if (String(url).includes('keyvaluemaps')) return json({ name: 'rate_card', value: JSON.stringify(CARD) });
    if (String(url).includes('/apiproducts/')) return json(product);
    if (String(url).includes('run.googleapis.com')) return json({ name: 'operations/123' });
    return json({}, 404);
  };
  const svc = createModelWatchService({ getToken: async () => 't', org: 'demo-org', bucket: 'b', personaProducts: ['P1'],
    githubRepo: 'acme/gw', fetchImpl, now: () => NOW, logger: { warn() {}, error() {} } });
  const body = await svc.status();
  assert.equal(body.configured, true);
  assert.deepEqual(body.inUseModels.sort(), ['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  assert.equal(body.github.editUrl, 'https://github.com/acme/gw/edit/main/apigee/config/model_rate_card.json');
  assert.equal(body.analysis.deprecations[0].inUse, true);
  const run = await svc.runNow();
  assert.deepEqual(run, { started: true, operation: 'operations/123' });
  assert.ok(calls.some(([m, u]) => m === 'POST' && u.endsWith('/jobs/model-watch:run')));
});

test('page display names map to model ids', () => {
  assert.equal(displayToModelId('Gemini 3.8 Flash*through December 31, 2026'), 'gemini-3.8-flash');
  assert.equal(displayToModelId('Gemini 3.5 Flash-Lite'), 'gemini-3.5-flash-lite');
  assert.equal(displayToModelId('Claude Opus 4.5'), 'claude-opus-4-5');
  assert.equal(displayToModelId('Grok 4.7'), null);
});

test('page-wide price changes: all models listed, in-use first, in-use makes it actionable', () => {
  const recentPriceChanges = [
    { id: 'p1', detectedAt: '2026-10-09T07:00:00Z', change: 'changed', section: "xAI's Grok models", model: 'Grok 4.7', item: 'Input', column: 'Price', before: '$2.00', after: '$1.80' },
    { id: 'p2', detectedAt: '2026-10-08T07:00:00Z', change: 'changed', section: 'Gemini 3', model: 'Gemini 3.1 Pro Preview', item: 'Text output · Global', column: 'Price (/1M tokens)<= 200K input tokens with Priority', before: '$21.60', after: '$20.00' },
    { id: 'p3', detectedAt: '2026-10-09T07:00:00Z', change: 'added', section: 'Veo', model: 'Veo 4', item: '4k', column: 'Price (USD)', before: null, after: '$0.70 / 1 count' },
  ];
  const report = { ...REPORT, vertex: { ...REPORT.vertex, 'claude-opus-4-5': { input: 5, output: 25 } }, changelog: [], recentPriceChanges };
  const a = analyzeModelWatch(report, CARD, { inUseModels: IN_USE, now: NOW });
  assert.deepEqual(a.pageChanges.map((c) => c.id), ['p2', 'p1', 'p3']);
  assert.equal(a.pageChanges[0].inUse, true);
  assert.equal(a.counts.pageChanges, 3);
  assert.equal(a.counts.pageChangesInUse, 1);
  assert.equal(a.drift.length, 0, 'a Priority-tier change is not rate-card drift');
  assert.equal(a.status, 'action');
  const onlyOthers = analyzeModelWatch({ ...report, recentPriceChanges: [recentPriceChanges[0]] }, CARD, { inUseModels: IN_USE, now: NOW });
  assert.equal(onlyOthers.status, 'info');
});

test('the semantic-cache embedding model counts as in use (extraInUse)', () => {
  const report = { ...REPORT, changelog: [{ id: 'e1', date: '2026-10-01', kinds: ['shutdown'], models: ['text-embedding-005'], text: 'The text-embedding-005 model will be shut down.' }] };
  const a = analyzeModelWatch(report, CARD, { inUseModels: IN_USE, extraInUse: ['text-embedding-005'], now: NOW });
  assert.equal(a.deprecations[0].inUse, true);
  assert.ok(a.inUseModels.includes('text-embedding-005'));
});

test('watchlist: Gemini 4 Argon waits, then is reported available once it is on the pricing page', () => {
  const waiting = analyzeModelWatch(REPORT, CARD, { inUseModels: IN_USE, now: NOW });
  const argon = waiting.watchlist.find((w) => w.name === 'Gemini 4 Argon');
  assert.equal(argon.status, 'waiting');
  assert.equal(argon.replaces, 'gemini-3.1-pro-preview');
  const released = { ...REPORT, allPrices: { k: { section: 'Gemini 4', model: 'Gemini 4 Argon', item: 'Input', column: 'Price', price: '$2.00' } },
    vertex: { ...REPORT.vertex, 'gemini-4-argon': { input: 2, output: 10 } } };
  const b = analyzeModelWatch(released, CARD, { inUseModels: IN_USE, now: NOW });
  const w = b.watchlist.find((x) => x.name === 'Gemini 4 Argon');
  assert.equal(w.status, 'available');
  assert.equal(w.seenOn, 'Vertex AI pricing');
  assert.deepEqual(w.price, { input: 2, output: 10, tier: 'high' });
  assert.equal(b.status, 'action');
  assert.notEqual(b.signature, waiting.signature);
});

test('Claude rows without the brand prefix map to model ids', () => {
  assert.equal(displayToModelId('Opus 5.5', "Anthropic's Claude models"), 'claude-opus-5-5');
  assert.equal(displayToModelId('Opus 5.5', 'Gemini 3'), null);
});
