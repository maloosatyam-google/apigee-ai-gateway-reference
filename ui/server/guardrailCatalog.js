/**
 * Server-side view of the guardrail catalog.
 *
 * The data is NOT maintained here. guardrailCatalog.json is generated from
 * ui/src/data/guardrailPolicies.ts by generateGuardrailCatalog.js, and
 * tests/guardrailpolicies.unit.test.mjs fails if the two ever diverge.
 */
import fs from 'node:fs';

export const GUARDRAIL_CONTROLS = JSON.parse(
  fs.readFileSync(new URL('./guardrailCatalog.json', import.meta.url), 'utf8')
);

/** Compact projection for the model: enough to answer, small enough to be cheap. */
export function listGuardrails(gateway) {
  const filtered = gateway
    ? GUARDRAIL_CONTROLS.filter((c) => c.gateway === gateway)
    : GUARDRAIL_CONTROLS;
  return filtered.map((c) => ({
    id: c.id,
    gateway: c.gateway,
    proxy: c.proxy,
    title: c.title,
    category: c.category,
    summary: c.summary,
    attachPoint: c.attachPoint,
    onViolation: c.onViolation,
    configSource: c.configSource,
    policies: c.policies.map((p) => `${p.name} (${p.type})`),
  }));
}
