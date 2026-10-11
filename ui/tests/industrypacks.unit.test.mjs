import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { INDUSTRY_PACKS } from '../src/data/industryPacks.js';
import { industryPackFor, industryPackIds, industryMcpEndpoint, packPresets, packTools, personaKeyForUser, toolNamesForPersona, packAreas, toolArea, simulateGateway, showcaseScenariosFor } from '../src/utils/industryPacks.js';
import { SHOWCASE_SCENARIOS } from '../src/utils/agentShowcase.js';
import { orderPresetsForPersona, MCP_PERSONA_FLOWS } from '../src/utils/mcpFlows.js';
import { industryMcpUpstream } from '../server/industryMcp.js';

const banking = industryPackFor('banking');

describe('industry packs in the UI', () => {
  it('the generated module matches industries/*.json', () => {
    const src = JSON.parse(readFileSync(new URL('../../industries/banking.json', import.meta.url), 'utf8'));
    assert.deepEqual(banking, src);
    assert.ok(industryPackIds().includes('banking'));
  });

  it('industries without a pack keep the generic tools', () => {
    assert.equal(industryPackFor('generic'), null);
    assert.equal(industryPackFor('mining'), null);
    assert.equal(industryPackFor(undefined), null);
  });

  it('routes each pack through its own Apigee proxy, or a local industry-apis in dev', () => {
    assert.deepEqual(industryMcpEndpoint(banking, 'prod'), {
      requestUrl: '/api/industry-mcp-prod/banking',
      displayEndpoint: 'https://api.example.com/banking/mcp',
      local: false,
    });
    assert.equal(industryMcpEndpoint(banking, 'dev').displayEndpoint, 'https://dev.api.example.com/banking/mcp');
    const local = industryMcpEndpoint(banking, 'prod', 'http://localhost:8091/');
    assert.equal(local.displayEndpoint, 'http://localhost:8091/banking/mcp');
    assert.equal(local.local, true);
  });

  it('the UI server maps /api/industry-mcp-<env>/<id> to the proxy (and nothing else)', () => {
    assert.equal(industryMcpUpstream('/api/industry-mcp-prod/banking'), 'https://api.example.com/banking/mcp');
    assert.equal(industryMcpUpstream('/api/industry-mcp-dev/banking/'), 'https://dev.api.example.com/banking/mcp');
    assert.equal(industryMcpUpstream('/api/industry-mcp-prod/banking', 'http://localhost:8091'), 'http://localhost:8091/banking/mcp');
    for (const bad of ['/api/industry-mcp-prod/', '/api/industry-mcp-qa/banking', '/api/industry-mcp-prod/../x', '/api/mcp-prod', '/api/industry-mcp-prod/banking/extra']) {
      assert.equal(industryMcpUpstream(bad), null, bad);
    }
  });

  it('presets and tools come from the pack; every preset calls a pack tool', () => {
    const presets = packPresets(banking);
    const tools = packTools(banking).map((t) => t.name);
    assert.equal(presets.length, banking.mcpPresets.length);
    for (const p of presets) {
      assert.ok(tools.includes(p.toolName), p.id);
      assert.ok(p.lines.title.support && p.lines.title.analysts && p.lines.title.technical);
    }
  });

  it('each persona flow puts its 4 steps first, with the gateway outcome', () => {
    const presets = packPresets(banking);
    const support = orderPresetsForPersona(presets, 'support', banking.mcpPersonaFlows);
    assert.deepEqual(support.slice(0, 4).map((x) => [x.preset.id, x.outcome]), [
      ['bk-account-summary', 'works'], ['bk-fee-small', 'works'], ['bk-fee-large', 'blocked'], ['bk-profitability', 'blocked'],
    ]);
    assert.equal(support.length, presets.length);
    const analysts = orderPresetsForPersona(presets, 'analysts', banking.mcpPersonaFlows);
    assert.deepEqual(analysts.slice(0, 4).map((x) => x.outcome), ['works', 'works', 'blocked', 'limit']);
    // Default flows are unchanged for the generic tools.
    assert.equal(orderPresetsForPersona([{ id: 'cs-order-status' }], 'support')[0].step, 1);
    assert.ok(MCP_PERSONA_FLOWS.support.length === 4);
  });

  it('flows match the pack rules: blocked steps are the limit or another persona\'s tool', () => {
    for (const pack of INDUSTRY_PACKS) {
      const byId = Object.fromEntries(pack.mcpPresets.map((p) => [p.id, p]));
      const tool = (id) => pack.tools.find((t) => t.name === byId[id].toolName);
      for (const [speaker, persona] of [['support', 'ops'], ['analysts', 'insights']]) {
        for (const f of pack.mcpPersonaFlows[speaker]) {
          const t = tool(f.id);
          const overLimit = t.name === pack.limit.tool && byId[f.id].arguments[pack.limit.argument] > pack.limit.max;
          if (f.outcome === 'works') assert.ok(t.persona === persona && !overLimit, `${pack.id} ${speaker} ${f.id} should work`);
          if (f.outcome === 'blocked') assert.ok(t.persona !== persona || overLimit, `${pack.id} ${speaker} ${f.id} should be blocked`);
          if (f.outcome === 'limit') assert.equal(t.slot, 'forecast');
        }
      }
    }
  });

  it('personas see different tools: Support & Sales = ops, Analysts = insights, admin = all', () => {
    assert.equal(personaKeyForUser('sales_agent'), 'ops');
    assert.equal(personaKeyForUser('loans_agent'), 'insights');
    assert.equal(personaKeyForUser('admin'), 'admin');
    const ops = toolNamesForPersona(banking, 'ops');
    const ins = toolNamesForPersona(banking, 'insights');
    assert.ok(ops.includes('reverseFee') && !ops.includes('getSegmentProfitability'));
    assert.ok(ins.includes('runCreditLossForecast') && !ins.includes('searchCustomers'));
    assert.equal(ops.filter((n) => ins.includes(n)).length, 0, 'no overlap');
    assert.equal(toolNamesForPersona(banking, 'admin').length, banking.tools.length);
  });

  it('groups tools into business areas (several per persona)', () => {
    const opsAreas = packAreas(banking, toolNamesForPersona(banking, 'ops')).map((a) => a.area);
    const insAreas = packAreas(banking, toolNamesForPersona(banking, 'insights')).map((a) => a.area);
    for (const a of ['Customers', 'Accounts', 'Cards', 'Payments', 'Loans', 'Fraud', 'Fees']) assert.ok(opsAreas.includes(a), a);
    for (const a of ['Risk', 'Deposits', 'Loans', 'Channels', 'Fraud', 'Profitability']) assert.ok(insAreas.includes(a), a);
    assert.deepEqual(toolArea('getLoanPayoffQuote'), { area: 'Loans', persona: 'ops', industry: 'banking' });
    assert.equal(toolArea('getOrderStatus'), null);
  });

  it('local preview simulates the proxy: 401 off-product, 403 over the limit (ops only), 429 over quota', () => {
    assert.equal(simulateGateway(banking, 'ops', 'getSegmentProfitability', {}).status, 401);
    assert.equal(simulateGateway(banking, 'insights', 'searchCustomers', { query: 'jane' }).status, 401);
    assert.equal(simulateGateway(banking, 'ops', 'reverseFee', { feeId: 'FEE-7001', amount: 30 }), null);
    const stop = simulateGateway(banking, 'ops', 'reverseFee', { feeId: 'FEE-7002', amount: 120 });
    assert.equal(stop.status, 403);
    assert.equal(stop.limitCode, 'FEE_REVERSAL_LIMIT');
    assert.equal(JSON.parse(stop.body.result.content[0].text).requested, 120);
    assert.equal(simulateGateway(banking, 'admin', 'reverseFee', { feeId: 'FEE-7002', amount: 120 }), null, 'admin has no limit');
    const now = 1_000_000;
    assert.equal(simulateGateway(banking, 'insights', 'runCreditLossForecast', {}, [now - 5000], now), null);
    assert.equal(simulateGateway(banking, 'insights', 'runCreditLossForecast', {}, [now - 5000, now - 1000], now).status, 429);
    assert.equal(simulateGateway(banking, 'insights', 'runCreditLossForecast', {}, [now - 70_000, now - 65_000], now), null, 'window is one minute');
    assert.equal(simulateGateway(banking, 'admin', 'runCreditLossForecast', {}, [now - 5000, now - 1000], now).status, 429, 'forecast quota applies to admin too');
  });
});

describe('showcaseScenariosFor', () => {
  const banking = industryPackFor('banking');

  it('returns the generic scenarios when the industry has no pack', () => {
    assert.equal(showcaseScenariosFor(SHOWCASE_SCENARIOS, null), SHOWCASE_SCENARIOS);
    assert.equal(showcaseScenariosFor(SHOWCASE_SCENARIOS, industryPackFor('real-estate-development')), SHOWCASE_SCENARIOS);
  });

  it('keeps every slot, in order, with the pack prompts', () => {
    const out = showcaseScenariosFor(SHOWCASE_SCENARIOS, banking);
    assert.deepEqual(out.map((s) => [s.id, s.step]), SHOWCASE_SCENARIOS.map((s) => [s.id, s.step]));
    const byId = Object.fromEntries(out.map((s) => [s.id, s]));
    for (const [slot, own] of Object.entries(banking.showcase.scenarios)) {
      assert.equal(byId[slot].prompt, own.prompt, slot);
      assert.equal(byId[slot].title, own.title, slot);
    }
    // Ask again repeats the lookup; the neutral reasoning puzzle and burst settings stay.
    assert.equal(byId.cache.prompt, byId.lookup.prompt);
    assert.equal(byId['cheaper-model'].prompt, SHOWCASE_SCENARIOS.find((s) => s.id === 'cheaper-model').prompt);
    assert.equal(byId.burst.burst, 5);
    assert.equal(byId['cheaper-model'].baselineModel, 'gemini-3.5-flash-lite');
    // No generic order or product ids leak into the Banking story.
    for (const s of out.filter((x) => x.id !== 'cheaper-model')) assert.doesNotMatch(s.prompt, /ORD-|DEV-HUB/, s.id);
  });

  it('fills the placeholders in the expected outcome', () => {
    const byId = Object.fromEntries(showcaseScenariosFor(SHOWCASE_SCENARIOS, banking).map((s) => [s.id, s]));
    const ops = toolNamesForPersona(banking, 'ops').length;
    assert.match(byId['multi-step'].expect, new RegExp(`authorized for ${ops} Banking`));
    assert.match(byId['multi-step'].expect, new RegExp(`all ${banking.tools.length} Banking tools`));
    assert.match(byId.refund.expect, new RegExp(`over \\$${banking.limit.max}`));
    for (const s of Object.values(byId)) assert.doesNotMatch(s.expect, /\{\w+\}/, s.id);
  });
});
