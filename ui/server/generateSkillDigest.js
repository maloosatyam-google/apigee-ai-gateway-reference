#!/usr/bin/env node
/**
 * Snapshot the repo's Gemini skills (.gemini/skills) into server/skillDigest.json
 * for Ask Apigee's `consult_skill` tool.
 *
 * The Cloud Run image is built from ui/ only, so it cannot read ../.gemini at
 * runtime. Same pattern as generateGuardrailCatalog.js: regenerate and commit
 * whenever a skill changes (`npm run gen:skill-digest`). The skill files stay
 * the single source of truth; this is a sectioned, read-only copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(here, '..', '..', '.gemini', 'skills');
const OUT = path.join(here, 'skillDigest.json');

/** Skill -> extra reference files (relative to the skill dir) worth serving. */
export const SKILL_SOURCES = {
  'ai-gateway-policy-manager': ['SKILL.md', 'references/model_routing_playbook.md'],
  'apigee-proxy-builder': ['SKILL.md', 'references/policies_ai_gateway.md', 'references/policies_mcp_tools.md'],
  'tools-gateway-manager': ['SKILL.md'],
};

const MAX_SECTION_CHARS = 4000;

/** Split markdown into {heading, text} sections on ## / ### headings. */
export function splitSections(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const sections = [];
  let current = { heading: 'Overview', lines: [] };
  for (const line of body.split('\n')) {
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { heading: m[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections.map((s) => ({
    heading: s.heading,
    text: s.lines.join('\n').trim().slice(0, MAX_SECTION_CHARS),
  }));
}

function frontmatterDescription(markdown) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!fm) return '';
  const m = /description:\s*>?-?\s*\n?([\s\S]*?)(?:\n\w+:|$)/.exec(fm[1]);
  return (m ? m[1] : '').replace(/\s+/g, ' ').trim();
}

export function buildDigest(skillsDir = SKILLS_DIR) {
  const skills = {};
  for (const [skill, files] of Object.entries(SKILL_SOURCES)) {
    const entries = [];
    let description = '';
    for (const rel of files) {
      const full = path.join(skillsDir, skill, rel);
      if (!fs.existsSync(full)) continue;
      const md = fs.readFileSync(full, 'utf8');
      if (rel === 'SKILL.md') description = frontmatterDescription(md);
      for (const s of splitSections(md)) entries.push({ file: rel, ...s });
    }
    if (entries.length) skills[skill] = { description, sections: entries };
  }
  return { generatedFrom: '.gemini/skills', skills };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const digest = buildDigest();
  fs.writeFileSync(OUT, JSON.stringify(digest, null, 1) + '\n');
  const n = Object.values(digest.skills).reduce((a, s) => a + s.sections.length, 0);
  console.log(`[skillDigest] wrote ${Object.keys(digest.skills).length} skills, ${n} sections -> ${path.relative(process.cwd(), OUT)}`);
}
