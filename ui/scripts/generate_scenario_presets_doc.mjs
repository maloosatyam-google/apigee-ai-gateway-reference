#!/usr/bin/env node
/**
 * Generates scenario_presets_review.md from the live defaultSettings.ts.
 *
 * Why this exists: the review doc used to be hand-maintained and described itself as text to
 * apply verbatim into defaultSettings.ts. It drifted repeatedly in the dangerous direction -
 * the doc claimed titles like "Unauthorized" and "Auto Routing" long after the code had moved
 * to "Access Control" and "Model Routing", so applying it verbatim would have regressed
 * shipped demo copy. It also omitted the settingsOverride blocks, several of which are the
 * only reason a scenario works at all.
 *
 * The code is the source of truth. This script makes the doc a projection of it.
 *
 *   npm run docs:presets          # rewrite the doc
 *   npm run docs:presets -- --check   # fail if the doc is stale (CI-friendly)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(UI_DIR, '..');
const SOURCE = path.join(UI_DIR, 'src/services/defaultSettings.ts');
const OUT = path.join(REPO_ROOT, 'scenario_presets_review.md');

const checkOnly = process.argv.includes('--check');

// defaultSettings.ts is a Vite module: it reads import.meta.env and imports types from
// ../types. Bundle it to plain ESM so plain node can evaluate it. The env define is only
// needed so the module body does not throw; none of the preset data depends on it.
const work = mkdtempSync(path.join(tmpdir(), 'presets-'));
const bundle = path.join(work, 'defaultSettings.mjs');
let mod;
try {
  execFileSync(
    path.join(UI_DIR, 'node_modules/.bin/esbuild'),
    [SOURCE, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`,
     '--log-level=error', '--define:import.meta.env={}'],
    { cwd: UI_DIR, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  mod = await import(pathToFileURL(bundle).href);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const {
  SCENARIO_PRESETS,
  UNAUTHORIZED_401_EXAMPLES,
  MODEL_ARMOR_EXAMPLES,
  AUTO_ROUTING_EXAMPLES,
  TOKEN_LIMIT_EXAMPLES,
  CACHE_EXAMPLES,
} = mod;

// Which sub-button array belongs to which preset card. Presets that drive a single prompt
// (no sub-buttons) map to null.
const SUB_BUTTONS = {
  'unauthorized-toggle': UNAUTHORIZED_401_EXAMPLES,
  'model-armor-toggle': MODEL_ARMOR_EXAMPLES,
  'auto-routing': AUTO_ROUTING_EXAMPLES,
  'token-limit-toggle': TOKEN_LIMIT_EXAMPLES,
  'cache-toggle': CACHE_EXAMPLES,
  'no-cache': null,
};

const ARRAY_NAME = {
  'unauthorized-toggle': 'UNAUTHORIZED_401_EXAMPLES',
  'model-armor-toggle': 'MODEL_ARMOR_EXAMPLES',
  'auto-routing': 'AUTO_ROUTING_EXAMPLES',
  'token-limit-toggle': 'TOKEN_LIMIT_EXAMPLES',
  'cache-toggle': 'CACHE_EXAMPLES',
  'no-cache': 'CACHE_EXAMPLES',
};

const fmtOverride = (o) =>
  !o || Object.keys(o).length === 0
    ? '_none_'
    : '`{ ' + Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`).join(', ') + ' }`';

const SRC_LINK = '../ui/src/services/defaultSettings.ts';

const out = [];
out.push('# Scenario Presets — Generated Reference');
out.push('');
out.push('> [!IMPORTANT]');
out.push('> **This file is generated. Do not hand-edit it.**');
out.push('>');
out.push('> It is a projection of the `SCENARIO_PRESETS`, `UNAUTHORIZED_401_EXAMPLES`,');
out.push('> `MODEL_ARMOR_EXAMPLES`, `AUTO_ROUTING_EXAMPLES`, `TOKEN_LIMIT_EXAMPLES` and');
out.push(`> \`CACHE_EXAMPLES\` arrays in [defaultSettings.ts](${SRC_LINK}), which is the source of truth.`);
out.push('>');
out.push('> To change demo copy, edit `defaultSettings.ts` and run `npm run docs:presets` in `ui/`.');
out.push('> Run `npm run docs:presets -- --check` to verify this file is current.');
out.push('');
out.push('> [!CAUTION]');
out.push('> `settingsOverride` is **not** cosmetic. Several scenarios do nothing without it —');
out.push('> `omitEmailHeader` is the only reason the 401 fires, `useCache: true` is the only reason');
out.push('> the cache demo is a cache demo, and the Tokenomics cap exists on exactly one model.');
out.push('> Never copy a prompt out of this file without carrying its override.');
out.push('');
out.push(`Generated from ${SCENARIO_PRESETS.length} preset cards.`);
out.push('');
out.push('---');
out.push('');

SCENARIO_PRESETS.forEach((p, i) => {
  out.push(`## ${i + 1}. ${p.title}`);
  out.push('');
  out.push('| Field | Value |');
  out.push('| :--- | :--- |');
  out.push(`| ID | \`${p.id}\` |`);
  out.push(`| Title | ${p.title} |`);
  out.push(`| Category | ${p.category} |`);
  out.push(`| Badge | ${p.badgeText} (\`${p.badgeColor}\`) |`);
  out.push(`| Description | ${p.description} |`);
  out.push(`| Card override | ${fmtOverride(p.settingsOverride)} |`);
  out.push('');

  const subs = SUB_BUTTONS[p.id];
  if (subs && subs.length) {
    out.push(`**Sub-buttons** (from \`${ARRAY_NAME[p.id]}\`):`);
    out.push('');
    subs.forEach((s) => {
      out.push(`${s.step}. **${s.tag}** — ${s.title}`);
      if (s.model) out.push(`   - Model: \`${s.model}\``);
      if (s.expectedModel) out.push(`   - Expected route: \`${s.expectedModel}\``);
      if (s.settingsOverride) out.push(`   - Override: ${fmtOverride(s.settingsOverride)}`);
      out.push(`   - ${s.description}`);
      out.push('   - Prompt:');
      out.push('');
      out.push('     ```text');
      out.push(`     ${s.prompt}`);
      out.push('     ```');
      out.push('');
    });
  } else {
    out.push('**Single prompt** (no sub-buttons):');
    out.push('');
    out.push('```text');
    out.push(p.prompt);
    out.push('```');
    out.push('');
  }
  out.push('---');
  out.push('');
});

const rendered = out.join('\n').replace(/\n+$/, '\n');

if (checkOnly) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /* missing file counts as stale */
  }
  if (current !== rendered) {
    console.error('scenario_presets_review.md is STALE. Run: npm run docs:presets');
    process.exit(1);
  }
  console.log('scenario_presets_review.md is up to date.');
} else {
  writeFileSync(OUT, rendered);
  console.log(`Wrote ${OUT} (${SCENARIO_PRESETS.length} presets).`);
}
