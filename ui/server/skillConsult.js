/**
 * Ask Apigee -- `consult_skill`: answers from the repo's Gemini skills.
 *
 * Reads server/skillDigest.json (generated from .gemini/skills by
 * generateSkillDigest.js) and returns the few sections that best match a
 * topic, each with a citation the change record keeps. Any guardrail change
 * is refused unless a skill was consulted in the same turn (see
 * adminAgentService.js), so proxy-facing edits stay grounded in the skills.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SKILL_NAMES = ['ai-gateway-policy-manager', 'apigee-proxy-builder', 'tools-gateway-manager'];
export const MAX_SKILL_SECTIONS = 3;
const MAX_RETURN_CHARS = 2200;

let cached = null;
export function loadSkillDigest(file = path.join(here, 'skillDigest.json')) {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cached = { skills: {} };
  }
  return cached;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'how', 'what', 'is', 'do', 'i', 'with', 'it']);
function terms(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9.@_-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Rank a skill's sections against `topic`. Heading hits weigh 3x body hits.
 * Pure: pass the digest in tests.
 */
export function consultSkill(digest, skill, topic, max = MAX_SKILL_SECTIONS) {
  const entry = digest?.skills?.[skill];
  if (!entry) {
    return { skill, found: false, sections: [], available: Object.keys(digest?.skills || {}) };
  }
  const q = terms(topic);
  const scored = entry.sections.map((s, i) => {
    const head = s.heading.toLowerCase();
    const body = s.text.toLowerCase();
    let score = 0;
    for (const t of q) {
      if (head.includes(t)) score += 3;
      const hits = body.split(t).length - 1;
      score += Math.min(hits, 5);
    }
    return { s, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored.filter((x) => x.score > 0).slice(0, max);
  const sections = (picked.length ? picked : scored.slice(0, 1)).map(({ s }) => ({
    citation: `${skill}/${s.file}#${s.heading}`,
    heading: s.heading,
    text: s.text.length > MAX_RETURN_CHARS ? `${s.text.slice(0, MAX_RETURN_CHARS)}…` : s.text,
  }));
  return { skill, found: true, description: entry.description, sections };
}
