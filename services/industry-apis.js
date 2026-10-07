// Industry APIs: mock backends and MCP servers for the industry demo packs.
//
// One private Cloud Run service (same image as the generic services, SERVICE=industry-apis)
// hosts every industry that has a pack in ./industries (copied from the repo-root
// industries/ by `node industries/sync.js`) and handlers in ./packs/<id>.js.
//
// Per industry:
//   POST /<id>/mcp                 Stateless streamable-HTTP MCP endpoint (official MCP SDK).
//                                  Reached only through the Apigee proxy <id>-mcp, which
//                                  checks the API key, per-tool quotas and the pack's
//                                  business-rule limit before forwarding.
//   GET  /<id>/tools               Internal REST: tool list.
//   POST /<id>/tools/<tool>        Internal REST: call a tool with a JSON body (same handler
//                                  as MCP). Not exposed through Apigee.
// Shared:
//   POST /admin/reset              Restores every industry's seed data (demo reset).
//   GET  /healthz

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { validatePack } = require('./industries/validate');
const { ToolError, checkArgs } = require('./packs/common');

/** Loads every pack that has handlers; throws if a pack is invalid or a handler is missing. */
function loadIndustries(dir = path.join(__dirname, 'industries')) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const errors = validatePack(pack);
    if (errors.length) throw new Error(`${f}: ${errors.join('; ')}`);
    const modPath = path.join(__dirname, 'packs', `${pack.id}.js`);
    if (!fs.existsSync(modPath)) continue; // pack without a backend yet
    const mod = require(modPath);
    const missing = pack.tools.map((t) => t.name).filter((n) => typeof mod.handlers[n] !== 'function');
    if (missing.length) throw new Error(`${pack.id}: no handler for ${missing.join(', ')}`);
    out.set(pack.id, { pack, mod, db: mod.build() });
  }
  return out;
}

/** Runs one tool: { status, body }. Never throws for tool-level problems. */
function runTool(ind, name, args) {
  const tool = ind.pack.tools.find((t) => t.name === name);
  if (!tool) return { status: 404, body: { error: 'UNKNOWN_TOOL', message: `Unknown tool ${name}` } };
  try {
    const result = ind.mod.handlers[name](ind.db, checkArgs(tool.inputSchema, args));
    return { status: 200, body: result };
  } catch (e) {
    if (e instanceof ToolError) return { status: e.status, body: { error: e.code, message: e.message } };
    console.error(`[${ind.pack.id}] ${name} failed`, e);
    return { status: 500, body: { error: 'INTERNAL', message: 'Tool failed' } };
  }
}

/** A fresh MCP server per request (stateless): tools come straight from the pack. */
function mcpServer(ind) {
  const server = new Server(
    { name: `${ind.pack.id}-tools`, title: `${ind.pack.label} Tools`, version: String(ind.pack.version || 1) },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ind.pack.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { status, body } = runTool(ind, req.params.name, req.params.arguments || {});
    const text = JSON.stringify(status === 200 ? body : { status, ...body });
    return status === 200
      ? { content: [{ type: 'text', text }], structuredContent: body }
      : { isError: true, content: [{ type: 'text', text }] };
  });
  return server;
}

function createApp(industries = loadIndustries()) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true, industries: [...industries.keys()] }));

  app.post('/admin/reset', (_req, res) => {
    for (const ind of industries.values()) ind.db = ind.mod.build();
    res.json({ reset: true, industries: [...industries.keys()] });
  });

  const industryOf = (req, res) => {
    const ind = industries.get(req.params.industry);
    if (!ind) res.status(404).json({ error: 'NOT_FOUND', message: `Unknown industry ${req.params.industry}` });
    return ind;
  };

  app.post('/:industry/mcp', async (req, res) => {
    const ind = industryOf(req, res);
    if (!ind) return;
    // The streamable-HTTP transport insists the client accepts both JSON and SSE. Some
    // simple clients (curl, the UI's JSON-RPC console) send only application/json; replies
    // are JSON either way (enableJsonResponse), so accept them too.
    const accept = String(req.headers.accept || '');
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      req.headers.accept = 'application/json, text/event-stream';
    }
    const server = mcpServer(ind);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error(`[${ind.pack.id}] MCP request failed`, e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  });
  // Stateless server: no SSE stream to resume and no session to delete.
  app.all('/:industry/mcp', (_req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } }));

  app.get('/:industry/tools', (req, res) => {
    const ind = industryOf(req, res);
    if (ind) res.json({ industry: ind.pack.id, tools: ind.pack.tools.map(({ name, slot, persona, description }) => ({ name, slot, persona, description })) });
  });
  app.post('/:industry/tools/:tool', (req, res) => {
    const ind = industryOf(req, res);
    if (!ind) return;
    const { status, body } = runTool(ind, req.params.tool, req.body || {});
    res.status(status).json(body);
  });

  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown resource' }));
  return app;
}

const port = process.env.PORT || 8080;
if (require.main === module) {
  const industries = loadIndustries();
  createApp(industries).listen(port, () => console.log(`industry-apis listening on ${port}: ${[...industries.keys()].join(', ')}`));
}
module.exports = { createApp, loadIndustries, runTool };
