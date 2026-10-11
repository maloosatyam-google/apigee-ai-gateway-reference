/**
 * Client copy of ui/server/personas.js (the server cannot import from src/).
 * tests/adminroles.unit.test.mjs keeps the two equal.
 *
 * `models` lists what each persona's API product entitles, so the UI can
 * explain why a scenario switches persona (e.g. Claude Opus is Engineering & IT
 * only) instead of silently changing it.
 */
export const PERSONAS = [
  {
    id: 'admin',
    label: 'Engineering & IT',
    short: 'Eng & IT',
    product: 'Engineering and IT',
    mcpProduct: 'Enterprise Tools MCP',
    summary: 'Every model, incl. Claude Opus & Gemini Pro',
    models: [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.1-pro-preview',
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'gemini-3.8-flash',
    ],
  },
  {
    id: 'loans_agent',
    label: 'Analysts & Knowledge Workers',
    short: 'Analysts',
    product: 'Analysts and Knowledge Workers',
    mcpProduct: 'Business Insights Tools MCP',
    summary: 'Gemini Pro & Flash family, no Claude',
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ],
  },
  {
    id: 'sales_agent',
    label: 'Customer Support & Sales',
    short: 'Support & Sales',
    product: 'Customer Support and Sales',
    mcpProduct: 'Customer Service Tools MCP',
    summary: 'Fast, low-cost models; Pro only for hard questions',
    models: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'claude-haiku-5-5'],
  },
];

export function personaById(id) {
  return PERSONAS.find((p) => p.id === id) || PERSONAS[0];
}

/** True when the persona's product entitles `model` ('auto' is on every product). */
export function personaAllowsModel(id, model) {
  return model === 'auto' || personaById(id).models.includes(model);
}

/**
 * Persona to run a model-specific scenario as: the current one if it entitles
 * the model, otherwise the first persona that does (always Engineering & IT for
 * the demo models).
 */
export function personaForModel(currentId, model) {
  if (personaAllowsModel(currentId, model)) return personaById(currentId).id;
  const hit = PERSONAS.find((p) => p.models.includes(model));
  return hit ? hit.id : PERSONAS[0].id;
}
