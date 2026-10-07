/**
 * Admin personas (Platform Admin / Finance / AI CoE) and the client mirrors.
 *
 * The server cannot import from src/, so personas.js and adminRoles.js each
 * have a client copy. Those copies drifting apart would make the console grey
 * out one set of controls while Ask Apigee enforces another, so equality
 * is asserted here rather than trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as serverRoles from '../server/adminRoles.js';
import * as clientRoles from '../src/utils/adminRoles.js';
import * as serverPersonas from '../server/personas.js';
import * as clientPersonas from '../src/utils/personas.js';
import {
  assertRoleAllows,
  capabilitiesForChanges,
  normalizeAdminRole,
  roleInstruction,
  validateChangeList,
} from '../server/adminAgentCore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

test('client adminRoles.js mirrors the server copy (only the header comment differs)', () => {
  const strip = (s) => s.replace(/^ \* (Client copy of|Client mirror:).*$/m, '');
  assert.equal(strip(read('src/utils/adminRoles.js')), strip(read('server/adminRoles.js')));
  assert.deepEqual(clientRoles.ADMIN_ROLES, serverRoles.ADMIN_ROLES);
});

test('client personas mirror the server personas on every shared field', () => {
  const shared = ({ id, label, product, mcpProduct }) => ({ id, label, product, mcpProduct });
  assert.deepEqual(clientPersonas.PERSONAS.map(shared), serverPersonas.PERSONAS.map(shared));
});

test('role matrix: Finance owns cost, AI CoE owns models/routing/quota/guardrails, Platform owns all', () => {
  const { roleCan, CAPABILITIES } = serverRoles;
  for (const c of CAPABILITIES) assert.ok(roleCan('platform', c), `platform should own ${c}`);

  for (const c of ['budget', 'wallet', 'pricing', 'rate_plans']) {
    assert.ok(roleCan('finance', c), `finance should own ${c}`);
    assert.ok(!roleCan('ai_coe', c), `ai_coe should not own ${c}`);
  }
  for (const c of ['models', 'quota', 'routing', 'guardrails']) {
    assert.ok(roleCan('ai_coe', c), `ai_coe should own ${c}`);
    assert.ok(!roleCan('finance', c), `finance should not own ${c}`);
  }
  // Blast-radius actions stay with Platform Admin.
  for (const c of ['custom', 'reset']) {
    assert.ok(!roleCan('finance', c) && !roleCan('ai_coe', c), `${c} is Platform Admin only`);
  }
  // Every capability has an owner.
  for (const c of CAPABILITIES) {
    assert.ok(serverRoles.ADMIN_ROLES.some((r) => r.capabilities.includes(c)), `${c} has no owner`);
  }
});

test('unknown roles fall back to Platform Admin (the pre-persona behaviour)', () => {
  assert.equal(normalizeAdminRole(undefined), 'platform');
  assert.equal(normalizeAdminRole('root'), 'platform');
  assert.equal(normalizeAdminRole('finance'), 'finance');
  assert.equal(serverRoles.adminRoleById('nope').id, 'platform');
});

test('agent change paths map to the owning capability', () => {
  const caps = (paths) =>
    capabilitiesForChanges(validateChangeList(paths.map(([p, v]) => ({ path: p, value: v }))));
  assert.deepEqual(caps([['attributes.developer.budget.limit', '15000000']]), ['budget']);
  assert.deepEqual(caps([['attributes.routing.model.simple', 'gemini-3-flash-preview']]), ['routing']);
  assert.deepEqual(caps([['llmTokenQuota.auto.limit', '4000']]), ['quota']);
  assert.deepEqual(caps([['attributes.access', 'private']]), ['models']);
  assert.deepEqual(
    caps([
      ['attributes.developer.budget.limit', '1'],
      ['attributes.routing.model.coding', 'gemini-3-flash-preview'],
    ]).sort(),
    ['budget', 'routing']
  );
});

test('assertRoleAllows refuses out-of-role changes and names the owner', () => {
  assert.doesNotThrow(() => assertRoleAllows('finance', ['budget']));
  assert.doesNotThrow(() => assertRoleAllows('ai_coe', ['routing', 'quota']));
  assert.doesNotThrow(() => assertRoleAllows('platform', ['budget', 'routing', 'custom']));
  assert.throws(() => assertRoleAllows('finance', ['routing']), (err) => {
    assert.equal(err.code, 'forbidden_role');
    assert.match(err.message, /Finance cannot change routing.*AI CoE/);
    return true;
  });
  assert.throws(() => assertRoleAllows('ai_coe', ['budget']), /owned by Finance/);
});

test('roleInstruction scopes the agent prompt per persona', () => {
  assert.match(roleInstruction('platform'), /Platform Admin/);
  assert.match(roleInstruction('finance'), /ONLY change budgets/);
  assert.match(roleInstruction('ai_coe'), /routing\.model/);
  assert.match(roleInstruction('ai_coe'), /Do NOT change budgets/);
  assert.match(roleInstruction('bogus'), /Platform Admin/);
});

test('each admin persona only sees the Admin Console tabs and sections it owns', () => {
  const { roleCanSeeTab: tab, roleCanSeeSection: sec } = clientRoles;
  const tabs = ['products', 'wallets', 'rate-cards', 'rate-plans', 'policies'];
  const sections = ['models', 'routing', 'budget', 'custom'];
  const visible = (role) => ({
    tabs: tabs.filter((t) => tab(role, t)),
    sections: sections.filter((c) => sec(role, c)),
  });
  assert.deepEqual(visible('platform'), { tabs, sections });
  assert.deepEqual(visible('finance'), {
    tabs: ['products', 'wallets', 'rate-cards', 'rate-plans'],
    sections: ['budget'],
  });
  assert.deepEqual(visible('ai_coe'), {
    tabs: ['products', 'policies'],
    sections: ['models', 'routing'],
  });
  assert.equal(tab('finance', 'nope'), false);
  assert.deepEqual(clientRoles.TAB_CAPABILITIES, serverRoles.TAB_CAPABILITIES);
});

test('MonetizationManager hides tabs, sections and reset by admin persona', () => {
  const src = read('src/components/MonetizationManager.tsx');
  for (const t of ['products', 'wallets', 'rate-cards', 'rate-plans', 'policies']) {
    assert.ok(src.includes(`roleCanSeeTab(adminRole, '${t}') && (`), t);
  }
  for (const c of ['models', 'routing', 'budget', 'custom']) {
    assert.ok(src.includes(`roleCanSeeSection(adminRole, '${c}') && (`), c);
  }
  assert.ok(src.includes("roleCan(adminRole, 'reset') && ("));
});
