// Shared helpers for industry pack handlers (services/packs/<id>.js).

'use strict';

/** A tool failure with an HTTP-style status and a stable error code. */
class ToolError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const money = (n) => Math.round(n * 100) / 100;
const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * Checks tool arguments against the pack's inputSchema (required, type, enum, min/max)
 * and applies nothing else. Returns the arguments or throws a 400 ToolError, so a model
 * gets a clear message it can correct.
 */
function checkArgs(schema, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const props = schema.properties || {};
  for (const r of schema.required || []) {
    if (a[r] === undefined || a[r] === null || a[r] === '') throw new ToolError(400, 'INVALID_ARGUMENT', `${r} is required`);
  }
  for (const [k, v] of Object.entries(a)) {
    const p = props[k];
    if (!p) continue; // extra arguments are ignored
    if (p.type === 'string' && typeof v !== 'string') throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be a string`);
    if (p.type === 'number' && !Number.isFinite(v)) throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be a number`);
    if (p.type === 'integer' && !Number.isInteger(v)) throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be an integer`);
    if (p.enum && !p.enum.includes(v)) throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be one of: ${p.enum.join(', ')}`);
    if (p.minimum !== undefined && v < p.minimum) throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be at least ${p.minimum}`);
    if (p.maximum !== undefined && v > p.maximum) throw new ToolError(400, 'INVALID_ARGUMENT', `${k} must be at most ${p.maximum}`);
  }
  return a;
}

module.exports = { ToolError, money, maskEmail, checkArgs };
