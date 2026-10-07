// MCP tool argument helpers for the MCP playground form (McpPlayground.tsx). Plain JS so
// the unit tests can import them directly (see tests/mcpplayground.unit.test.mjs).

/** Default value for a JSON-schema property: example, then default, then a type-based blank. */
export function buildDefaultPropValue(prop) {
  if (!prop || typeof prop !== 'object') return '';
  if (prop.example !== undefined) return prop.example;
  if (prop.default !== undefined) return prop.default;
  if (prop.type === 'object' && prop.properties) {
    const nested = {};
    Object.entries(prop.properties).forEach(([k, sub]) => {
      nested[k] = buildDefaultPropValue(sub);
    });
    return nested;
  }
  if (prop.type === 'number' || prop.type === 'integer') return prop.minimum ?? 0;
  if (prop.type === 'boolean') return false;
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum[0];
  return '';
}

/** Initial arguments for a tool, one entry per top-level input property. */
export function initialToolArgs(inputSchema) {
  const out = {};
  Object.entries(inputSchema?.properties || {}).forEach(([k, prop]) => {
    out[k] = buildDefaultPropValue(prop);
  });
  return out;
}

/** Form text to the property's type: numbers stay numbers, 'true'/'false' become booleans. */
export function coerceArgValue(rawVal, prop) {
  if (prop?.type === 'number' || prop?.type === 'integer') {
    if (rawVal === '') return '';
    const n = Number(rawVal);
    return Number.isNaN(n) ? rawVal : n;
  }
  if (prop?.type === 'boolean') return rawVal === 'true';
  return rawVal;
}

/**
 * Drops blank optional fields (recursively), so an empty string does not fail the proxy's
 * OpenAPI pattern / enum validation. Required fields are kept even when blank.
 */
export function pruneBlank(args, schema) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const out = {};
  Object.entries(args || {}).forEach(([k, v]) => {
    const sub = schema?.properties?.[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = pruneBlank(v, sub);
    } else if (v === '' && !required.includes(k)) {
      // skip
    } else {
      out[k] = v;
    }
  });
  return out;
}

/** A best-effort schema from preset arguments, for tools not in the loaded catalog. */
export function inferPropertiesFromArgs(args) {
  const props = {};
  Object.entries(args || {}).forEach(([k, v]) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      props[k] = { type: 'object', properties: inferPropertiesFromArgs(v) };
    } else {
      props[k] = { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string' };
    }
  });
  return props;
}
