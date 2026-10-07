// Opening "Try a task" flow per persona on the MCP tab, and the preset ordering built from
// it. Plain JS so the unit tests can import it (see tests/mcpplayground.unit.test.mjs).
//
// Keyed by the persona's speaker ('eng' | 'analysts' | 'support', see utils/voice.ts), i.e.
// by the key that persona holds:
//  - Support & Sales (Customer Service tools): order status, $30 refund, $120 refund (403
//    REFUND_LIMIT), then support trends, which is not on their product (401).
//  - Analysts (Business Insights tools): CSAT, product margin, then a customer profile,
//    which is not on their product (401), then the 2/min forecast limit (429).
//  - Engineering & IT (all tools): order status, $30 refund, the forecast limit (429), then the
//    $120 refund, which succeeds: the refund limit applies only to keys on the Customer Service
//    Tools product (KVM refund.limitedProducts), not to the all-tools Enterprise product.

export const MCP_PERSONA_FLOWS = {
  support: [
    { id: 'cs-order-status', outcome: 'works' },
    { id: 'cs-refund-approved', outcome: 'works' },
    { id: 'cs-refund-denied', outcome: 'blocked' },
    { id: 'bi-support-metrics', outcome: 'blocked' },
  ],
  analysts: [
    { id: 'bi-support-metrics', outcome: 'works' },
    { id: 'bi-product-margins', outcome: 'works' },
    { id: 'cs-customer-profile', outcome: 'blocked' },
    { id: 'quota-breach-test', outcome: 'limit' },
  ],
  eng: [
    { id: 'cs-order-status', outcome: 'works' },
    { id: 'cs-refund-approved', outcome: 'works' },
    { id: 'quota-breach-test', outcome: 'limit' },
    { id: 'cs-refund-denied', outcome: 'works' },
  ],
};

/**
 * The persona's flow first (numbered, with its expected outcome), then every other preset in
 * catalog order. Unknown speakers get the Engineering & IT flow; unknown ids are skipped.
 * `flows` defaults to the generic tools' flows; an industry pack passes its mcpPersonaFlows.
 */
export function orderPresetsForPersona(presets, speaker, flows = MCP_PERSONA_FLOWS) {
  const flow = flows[speaker] ?? flows.eng ?? [];
  const flowIds = new Set(flow.map((f) => f.id));
  const head = flow
    .map((f) => ({ preset: presets.find((p) => p.id === f.id), outcome: f.outcome }))
    .filter((x) => x.preset)
    .map((x, i) => ({ ...x, step: i + 1 }));
  const tail = presets.filter((p) => !flowIds.has(p.id)).map((preset) => ({ preset }));
  return [...head, ...tail];
}
