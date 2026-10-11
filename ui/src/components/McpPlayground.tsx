import React, { useState, useEffect } from 'react';
import {
  GatewaySettings,
  McpTool,
  McpTelemetry,
  McpPresetScenario,
} from '../types';
import { listMcpTools, callMcpTool, INDUSTRY_APIS_LOCAL } from '../services/mcpClient';
import { useCustomerTheme } from './CustomerThemeProvider';
import { industryPackFor, packAreas, packPresets, packTools, personaKeyForUser, toolArea, toolNamesForPersona } from '../utils/industryPacks';
import { resetDemoData } from '../services/demoData';
import { MCP_PRESET_SCENARIOS, getUserInfo } from '../services/defaultSettings';
import { orderPresetsForPersona, type McpFlowOutcome } from '../utils/mcpFlows';
import { initialToolArgs, coerceArgValue, pruneBlank, inferPropertiesFromArgs } from '../utils/mcpArgs';
import type { BusinessCopy } from '../services/defaultSettings';
import { McpTraceViewer } from './McpTraceViewer';
import { usePersonaVoice } from '../utils/voice';
import {
  Wrench,
  Play,
  RefreshCw,
  RotateCcw,
  Layers,
  Code2,
  Terminal,
  Activity,
  AlertCircle,
  HelpCircle,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { MCP_BASE_PROD } from '../config/deployment.js';
import ScrollHintRow from './ScrollHintRow';

interface McpPlaygroundProps {
  settings: GatewaySettings;
  onTelemetryChange?: (telemetry: McpTelemetry | null) => void;
  onOpenRequestFlow?: (telemetry: McpTelemetry) => void;
}

const DEFAULT_MCP_TOOLS: McpTool[] = [
  {
    name: 'getOrderStatus',
    description: 'Get order status and delivery estimate',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'Order ID, e.g. ORD-1042',
          example: 'ORD-1042',
        },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'searchCustomers',
    description: 'Search customers',
    inputSchema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Name, customer ID (e.g. CUST-1001) or the start of an email address',
          example: 'jane',
        },
      },
      required: ['q'],
    },
  },
];

const createInitialMcpTelemetry = (settings: GatewaySettings): McpTelemetry => ({
  status: 200,
  statusText: 'OK',
  endpointUrl: MCP_BASE_PROD,
  method: 'tools/list',
  latencyMs: 182,
  headersSent: {
    'Content-Type': 'application/json',
    'x-apikey': '••••••••••••••••',
    'X-User-Email': settings.userEmail || 'user@example.com',
  },
  headersReceived: {
    'content-type': 'application/json',
    'x-request-id': 'c21b1190-8f58-4363-881c-03090d5ac18d',
    'via': '1.1 google',
  },
  rawRequest: {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/list',
    params: {},
  },
  rawResponse: {
    id: Date.now(),
    jsonrpc: '2.0',
    result: {
      tools: DEFAULT_MCP_TOOLS,
    },
  },
  policyTrace: {
    ppMcp: true,
    vaVerifyApiKey: true,
    qLimit: true,
    mlCloudLogging: true,
  },
  userEmail: settings.userEmail || 'user@example.com',
  activeUser: settings.activeUser || 'sales_agent',
});

export const McpPlayground: React.FC<McpPlaygroundProps> = ({
  settings,
  onTelemetryChange,
  onOpenRequestFlow,
}) => {
  const [tools, setTools] = useState<McpTool[]>(DEFAULT_MCP_TOOLS);
  const [loadingTools, setLoadingTools] = useState<boolean>(false);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(DEFAULT_MCP_TOOLS[0]);
  const [toolArgs, setToolArgs] = useState<Record<string, any>>({});
  const [rawJsonMode, setRawJsonMode] = useState<boolean>(false);
  const [rawJsonText, setRawJsonText] = useState<string>('{}');
  const [executing, setExecuting] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<McpTelemetry | null>(() => createInitialMcpTelemetry(settings));
  const [mobileTab, setMobileTab] = useState<'console' | 'trace'>('console');
  const [hasNewTrace, setHasNewTrace] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  // Copy follows the consumer persona, one voice each:
  // technical = Engineering & IT (builder), analysts, support.
  const { sp, speaker } = usePersonaVoice('persona');
  // The active theme's industry picks the tools: an industry pack has its own MCP proxy,
  // presets and flows; other industries keep the generic Customer Service / Insights tools.
  const { theme } = useCustomerTheme();
  const pack = industryPackFor(theme.industry);
  const localPack = Boolean(pack && INDUSTRY_APIS_LOCAL);
  const mcpPath = pack ? pack.basePath : '/mcp';
  // Business-area filter for the tools grid (industry packs only).
  const [areaFilter, setAreaFilter] = useState<string>('all');
  /** Per-speaker preset title, falling back to the older two-voice fields. */
  const presetTitle = (preset: McpPresetScenario & BusinessCopy): string =>
    sp(preset.lines?.title ?? { technical: preset.title, business: preset.businessTitle });
  // Persona flow first (two that work, one the gateway stops, ...), then the other presets.
  const orderedPresets = pack
    ? orderPresetsForPersona(packPresets(pack), speaker, pack.mcpPersonaFlows)
    : orderPresetsForPersona(MCP_PRESET_SCENARIOS, speaker);
  const OUTCOME_LABEL: Record<McpFlowOutcome, string> = {
    works: sp({ technical: '200', business: 'Works' }),
    blocked: sp({ technical: 'Denied', business: 'Blocked' }),
    limit: sp({ technical: '429', business: 'Limit' }),
  };
  const [resettingData, setResettingData] = useState(false);
  const handleResetDemoData = async () => {
    setResettingData(true);
    try {
      const { ok } = await resetDemoData();
      setStatusNotification(
        ok
          ? sp({ technical: pack ? `Demo data reset: Customer Service and ${pack.label} APIs are back to their seed data.` : 'Demo data reset: Customer Service API is back to its seed data.', business: 'Demo data reset. Everything is back to the start.' })
          : sp({ technical: 'Demo data reset failed; see the server log for /api/demo/reset.', business: 'Could not reset the demo data. Try again in a moment.' }),
      );
    } catch {
      setStatusNotification(sp({ technical: 'Demo data reset failed (network error).', business: 'Could not reset the demo data. Try again in a moment.' }));
    } finally {
      setResettingData(false);
    }
  };

  useEffect(() => {
    onTelemetryChange?.(telemetry);
  }, [telemetry, onTelemetryChange]);

  // Load available MCP tools on mount and when environment, active persona or industry pack changes
  useEffect(() => {
    const persona = personaKeyForUser(settings.activeUser);
    const fallback = pack
      ? packTools(pack).filter((t) => toolNamesForPersona(pack, persona).includes(t.name))
      : DEFAULT_MCP_TOOLS;
    setAreaFilter('all');
    setTools(fallback);
    setSelectedTool(fallback[0]);
    initToolArgs(fallback[0]);
    const effectiveKey = settings.apiKey || getUserInfo(settings.activeUser).apiKey;
    if (!effectiveKey && !localPack) return;
    fetchTools();
  }, [settings.environment, settings.activeUser, settings.apiKey, pack?.id]);

  const fetchTools = async () => {
    setLoadingTools(true);
    setStatusNotification(null);
    try {
      const { tools: loadedTools, telemetry: listTelem } = await listMcpTools(settings, pack);
      if (loadedTools && loadedTools.length > 0) {
        setTools(loadedTools);
        setTelemetry(listTelem);
        const defaultTool = loadedTools[0];
        setSelectedTool(defaultTool);
        initToolArgs(defaultTool);
      } else if (listTelem && listTelem.status === 200) {
        setTelemetry(listTelem);
      }
    } catch (err: any) {
      console.error('Failed to discover MCP tools', err);
    } finally {
      setLoadingTools(false);
    }
  };

  const initToolArgs = (tool: McpTool) => {
    const initial = initialToolArgs(tool.inputSchema);
    setToolArgs(initial);
    setRawJsonText(JSON.stringify(initial, null, 2));
  };

  const handleSelectTool = (tool: McpTool) => {
    setSelectedTool(tool);
    initToolArgs(tool);
    setStatusNotification(null);
  };

  const handleArgChange = (field: string, value: any, prop?: any) => {
    const updated = { ...toolArgs, [field]: coerceArgValue(String(value), prop) };
    setToolArgs(updated);
    setRawJsonText(JSON.stringify(updated, null, 2));
  };

  const handleNestedArgChange = (parentField: string, childField: string, value: any, childProp?: any) => {
    const currentParent =
      toolArgs[parentField] && typeof toolArgs[parentField] === 'object' ? toolArgs[parentField] : {};
    const updatedParent = {
      ...currentParent,
      [childField]: coerceArgValue(String(value), childProp),
    };
    const updated = { ...toolArgs, [parentField]: updatedParent };
    setToolArgs(updated);
    setRawJsonText(JSON.stringify(updated, null, 2));
  };

  const handleRawJsonChange = (text: string) => {
    setRawJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setToolArgs(parsed);
    } catch {
      // Allow user to continue typing invalid JSON
    }
  };

  const handleSelectPreset = (preset: McpPresetScenario & BusinessCopy) => {
    const matchingTool = tools.find((t) => t.name === preset.toolName);
    if (matchingTool) {
      setSelectedTool(matchingTool);
      setToolArgs(preset.arguments);
      setRawJsonText(JSON.stringify(preset.arguments, null, 2));
    } else {
      // Create lightweight fallback tool entry if catalog hasn't loaded yet or tool belongs to another MCP server
      setSelectedTool({
        name: preset.toolName,
        description: preset.description,
        inputSchema: {
          type: 'object',
          properties: inferPropertiesFromArgs(preset.arguments),
          required: Object.keys(preset.arguments || {}),
        },
      });
      setToolArgs(preset.arguments);
      setRawJsonText(JSON.stringify(preset.arguments, null, 2));
    }
    setStatusNotification(
      sp({
        technical: `Preset loaded: ${presetTitle(preset)}. Check the arguments, then send tools/call.`,
        analysts: `Ready to run: ${presetTitle(preset)}. Check the inputs, then click Run tool.`,
        support: `Ready to run: ${presetTitle(preset)}. Click Run tool to get the answer for your customer.`,
      }),
    );
  };

  const handleExecute = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    setStatusNotification(null);

    // Drop blank optional fields (form mode) so empty strings don't trip OAS pattern/enum checks.
    let finalArgs = pruneBlank(toolArgs, selectedTool.inputSchema);
    if (rawJsonMode) {
      try {
        finalArgs = JSON.parse(rawJsonText);
      } catch (e: any) {
        setStatusNotification(
          sp({
            technical: `Invalid JSON arguments, nothing sent: ${e.message}`,
            analysts: `The inputs are not valid JSON, so nothing was run: ${e.message}`,
            support: `The inputs are not valid JSON, so nothing was run: ${e.message}`,
          }),
        );
        setExecuting(false);
        return;
      }
    }

    try {
      const { telemetry: callTelem } = await callMcpTool(
        settings,
        selectedTool.name,
        finalArgs,
        pack
      );
      setTelemetry(callTelem);
      setHasNewTrace(true);
    } catch (err: any) {
      console.error('Tool execution error', err);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-100/50 text-slate-850 overflow-hidden">
      {/* Mobile Sub-Navigation Switcher (< md) */}
      <div className="md:hidden flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs w-full">
          <button
            type="button"
            onClick={() => setMobileTab('console')}
            className={`flex-1 py-1.5 px-3 rounded-lg font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              mobileTab === 'console'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>{sp({ technical: 'Tools & Run', business: 'Tools' })}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileTab('trace');
              setHasNewTrace(false);
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 relative ${
              mobileTab === 'trace'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{sp({ technical: 'Protocol Trace', business: 'What happened' })}</span>
            {hasNewTrace && mobileTab !== 'trace' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Main Dual-Pane Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Tool Explorer & Execution Console */}
        <section
          className={`flex-1 flex flex-col min-w-0 border-r border-slate-200 surface-flow overflow-y-auto ${
            mobileTab === 'console' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <div className="max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
            {/* Header / Subtitle */}
            <div data-tour-id="mcp-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-start sm:items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-sm shadow-cyan-500/20 shrink-0">
                    <Terminal className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        {sp({ technical: 'MCP Tools via the Gateway', analysts: 'Data tools for your analysis', support: 'Tools for customer answers' })}
                      </h2>
                      <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-800 border border-cyan-300 shrink-0">
                        {sp({ technical: 'JSON-RPC 2.0', business: 'Governed' })}
                      </span>
                      <span
                        className="inline-flex items-center text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white text-slate-700 border border-slate-300 shrink-0"
                        title={pack
                          ? `${pack.label} industry pack: proxy ${pack.proxy} at ${pack.basePath}`
                          : 'No industry pack for this theme: generic Customer Service and Business Insights tools'}
                      >
                        Tools: {pack ? pack.label : 'Generic'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {speaker === 'eng' ? (
                        <>
                          Call <code className="text-cyan-700 bg-cyan-100/70 px-1.5 py-0.5 rounded font-mono font-semibold border border-cyan-200/60">tools/list</code> then <code className="text-cyan-700 bg-cyan-100/70 px-1.5 py-0.5 rounded font-mono font-semibold border border-cyan-200/60">tools/call</code> on {mcpPath} with your key. Tools outside your product return 401/403; bursts return 429.
                        </>
                      ) : (
                        pack
                          ? sp({
                              technical: `Call tools/list then tools/call on ${mcpPath} with your key.`,
                              analysts: `${pack.label} metrics and forecasts for your analysis. Every call is checked, so confidential data stays protected.`,
                              support: `${pack.label} tools for customer answers. Every call is checked before it runs.`,
                            })
                          : sp({
                              technical: 'Call tools/list then tools/call on /mcp with your key.',
                              analysts: 'Pull support, revenue and churn trends for your analysis. Every call is checked, so confidential data stays protected.',
                              support: 'Look up customers, orders and prices, log cases and issue refunds. Every call is checked before it runs.',
                            })
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="self-start sm:self-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDemoData}
                disabled={resettingData}
                className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 transition cursor-pointer shadow-2xs"
                title={sp({
                  technical: 'POST /api/demo/reset: restore the Customer Service API seed data (undo refunds and cases)',
                  business: 'Undo refunds and cases from earlier runs so the demo starts fresh',
                })}
              >
                <RotateCcw className={`w-3.5 h-3.5 ${resettingData ? 'animate-spin text-cyan-600' : ''}`} />
                <span>{sp({ technical: 'Reset Demo Data', business: 'Start fresh' })}</span>
              </button>
              <button
                type="button"
                onClick={fetchTools}
                disabled={loadingTools}
                className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 transition cursor-pointer shadow-2xs"
                title={sp({ technical: 'Re-run tools/list with your current key', analysts: 'Reload the tools your team can use for analysis', support: 'Reload the tools you can use for customer answers' })}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTools ? 'animate-spin text-cyan-600' : ''}`} />
                <span>{sp({ technical: 'Refresh Tools', business: 'Refresh list' })}</span>
              </button>
              </div>
            </div>

            {localPack && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-px" />
                <span>
                  <strong>Local preview:</strong> {pack!.label} calls go to industry-apis at{' '}
                  <code className="font-mono">{INDUSTRY_APIS_LOCAL}</code>, not through Apigee. The UI simulates what the{' '}
                  {pack!.proxy} proxy will do (persona tools, 401, the fee limit 403 and 429), so switch persona to compare.
                  After deploy, Apigee makes these decisions.
                </span>
              </div>
            )}

            {/* Quick Demo Presets */}
            <div data-tour-id="mcp-presets" className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
                <span>{sp({ technical: 'Preset Calls', business: 'Try a task' })}</span>
              </div>
              <ScrollHintRow className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {orderedPresets.map(({ preset, step, outcome }) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-cyan-500 hover:bg-cyan-50/40 text-slate-800 text-xs transition cursor-pointer group shadow-2xs text-left"
                  >
                    {step ? (
                      <span
                        className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          outcome === 'works' ? 'bg-emerald-500' : outcome === 'limit' ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                      >
                        {step}
                      </span>
                    ) : (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          preset.badgeColor === 'emerald' || preset.badgeColor === 'green'
                            ? 'bg-emerald-500'
                            : preset.badgeColor === 'red'
                            ? 'bg-rose-500'
                            : preset.badgeColor === 'blue'
                            ? 'bg-blue-500'
                            : preset.badgeColor === 'purple'
                            ? 'bg-purple-500'
                            : 'bg-amber-500'
                        }`}
                      />
                    )}
                    <div>
                      <div className="font-semibold text-slate-900 group-hover:text-cyan-700 transition">
                        {presetTitle(preset)}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5">
                        <span>{preset.toolName}()</span>
                        {outcome && (
                          <span
                            className={`px-1.5 py-px rounded font-sans font-semibold border ${
                              outcome === 'works'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : outcome === 'limit'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {OUTCOME_LABEL[outcome]}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </ScrollHintRow>
            </div>

            {/* Registered Tools List */}

            <div data-tour-id="mcp-tools" className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-600" />
                  <span>{sp({ technical: `Tools on your key (${tools.length})`, analysts: `Tools for your analysis (${tools.length})`, support: `Tools for your replies (${tools.length})` })}</span>
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  {sp({ technical: `POST ${mcpPath}`, business: '' })}
                </span>
              </div>

              {tools.length === 0 ? (
                <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center space-y-2 shadow-xs">
                  <AlertCircle className="w-6 h-6 text-amber-500 mx-auto" />
                  <div className="text-xs font-semibold text-slate-800">
                    {sp({ technical: 'tools/list returned nothing yet', business: 'No tools loaded yet' })}
                  </div>
                  <p className="text-[11px] text-slate-600 max-w-sm mx-auto">
                    Click{' '}
                    <span className="text-cyan-600 font-semibold">{sp({ technical: 'Refresh Tools', business: 'Refresh list' })}</span>
                    {sp({
                      technical: ` to call tools/list on ${mcpPath} with your key and load the tools it is entitled to.`,
                      analysts: ' to load the tools your team can use for analysis.',
                      support: ' to load the tools you can use to answer customers.',
                    })}
                  </p>
                </div>
              ) : (
                <>
                {pack && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tools by business area">
                    {[{ area: 'all', tools: tools.map((t) => t.name) }, ...packAreas(pack, tools.map((t) => t.name))].map((a) => {
                      const active = areaFilter === a.area;
                      return (
                        <button
                          key={a.area}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAreaFilter(a.area)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                            active
                              ? 'bg-cyan-600 text-white border-cyan-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-500'
                          }`}
                        >
                          {a.area === 'all' ? 'All areas' : a.area} <span className={active ? 'text-cyan-100' : 'text-slate-400'}>{a.tools.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {tools.filter((t) => areaFilter === 'all' || toolArea(t.name)?.area === areaFilter).map((t) => {
                    const isSelected = selectedTool?.name === t.name;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => handleSelectTool(t)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-cyan-50/90 border-2 border-cyan-600 text-slate-900 shadow-xs ring-1 ring-cyan-500/20'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs'
                        }`}
                      >
                        <div>
                          <div className={`font-semibold text-xs font-mono truncate ${isSelected ? 'text-cyan-800 font-bold' : 'text-slate-900'}`}>
                            {t.name}
                          </div>
                          <p className="text-[11px] text-slate-600 line-clamp-2 mt-1 leading-snug">
                            {t.description}
                          </p>
                        </div>
                        <div className="mt-2.5 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                          <span>
                            {Object.keys(t.inputSchema?.properties || {}).length} {sp({ technical: 'arg(s)', business: 'input(s)' })}
                            {pack && toolArea(t.name) && (
                              <span className="ml-1.5 font-sans font-semibold text-slate-600">· {toolArea(t.name)!.area}</span>
                            )}
                          </span>
                          <ChevronRight
                            className={`w-3.5 h-3.5 ${isSelected ? 'text-cyan-600' : 'text-slate-400'}`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
                </>
              )}
            </div>

            {/* Tool Arguments Form */}
            {selectedTool && (
              <div className="space-y-3.5 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-cyan-600" />
                    <span className="font-bold text-xs text-slate-900">
                      {sp({ technical: 'Arguments for', business: 'Inputs for' })} <code className="font-mono text-cyan-700">{selectedTool.name}</code>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRawJsonMode(!rawJsonMode)}
                    className="text-[11px] text-cyan-600 hover:text-cyan-700 transition cursor-pointer font-semibold"
                  >
                    {rawJsonMode ? sp({ technical: 'Switch to Form', business: 'Use the form' }) : sp({ technical: 'Edit Raw JSON', business: 'Edit as JSON' })}
                  </button>
                </div>

                {rawJsonMode ? (
                  <div>
                    <textarea
                      value={rawJsonText}
                      onChange={(e) => handleRawJsonChange(e.target.value)}
                      rows={5}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 focus:bg-white"
                      placeholder="{}"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedTool.inputSchema?.properties &&
                    Object.keys(selectedTool.inputSchema.properties).length > 0 ? (
                      Object.entries(selectedTool.inputSchema.properties).map(([field, prop]) => {
                        const isRequired = selectedTool.inputSchema?.required?.includes(field);
                        if (prop.type === 'object' && prop.properties && Object.keys(prop.properties).length > 0) {
                          const parentVal =
                            toolArgs[field] && typeof toolArgs[field] === 'object' ? toolArgs[field] : {};
                          const nestedRequired: string[] = Array.isArray(prop.required) ? prop.required : [];
                          return (
                            <div key={field} className="space-y-2.5 p-3 rounded-xl bg-slate-50/80 border border-slate-200">
                              <div className="flex items-center justify-between text-xs pb-1.5 border-b border-slate-200/80">
                                <label className="font-mono font-semibold text-slate-800 flex items-center gap-1">
                                  {field}
                                  {isRequired && <span className="text-red-500 font-bold">*</span>}
                                </label>
                                <span className="text-[10px] text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                  object
                                </span>
                              </div>
                              {Object.entries(prop.properties).map(([subField, subProp]: [string, any]) => {
                                const isSubReq = nestedRequired.includes(subField);
                                return (
                                  <div key={subField} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <label className="font-mono font-semibold text-slate-700 flex items-center gap-1">
                                        {subField}
                                        {isSubReq && <span className="text-red-500 font-bold">*</span>}
                                      </label>
                                      <span className="text-[10px] text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                        {subProp.type}
                                      </span>
                                    </div>
                                    {subProp.description && (
                                      <p className="text-[11px] text-slate-600 leading-snug">
                                        {subProp.description}
                                      </p>
                                    )}
                                    {Array.isArray(subProp.enum) && subProp.enum.length > 0 ? (
                                      <select
                                        value={parentVal[subField] ?? ''}
                                        onChange={(e) => handleNestedArgChange(field, subField, e.target.value, subProp)}
                                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                      >
                                        {!isSubReq && <option value="">(none)</option>}
                                        {subProp.enum.map((opt: any) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type={subProp.type === 'number' || subProp.type === 'integer' ? 'number' : 'text'}
                                        value={parentVal[subField] ?? ''}
                                        onChange={(e) => handleNestedArgChange(field, subField, e.target.value, subProp)}
                                        placeholder={subProp.example !== undefined ? `e.g. ${subProp.example}` : `Enter ${subField}`}
                                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return (
                          <div key={field} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <label className="font-mono font-semibold text-slate-800 flex items-center gap-1">
                                {field}
                                {isRequired && <span className="text-red-500 font-bold">*</span>}
                              </label>
                              <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {prop.type}
                              </span>
                            </div>
                            {prop.description && (
                              <p className="text-[11px] text-slate-600 leading-snug">
                                {prop.description}
                              </p>
                            )}
                            {Array.isArray(prop.enum) && prop.enum.length > 0 ? (
                              <select
                                value={toolArgs[field] ?? ''}
                                onChange={(e) => handleArgChange(field, e.target.value, prop)}
                                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 focus:bg-white"
                              >
                                {!isRequired && <option value="">(none)</option>}
                                {prop.enum.map((opt: any) => (
                                  <option key={String(opt)} value={String(opt)}>
                                    {String(opt)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={prop.type === 'number' || prop.type === 'integer' ? 'number' : 'text'}
                                value={
                                  toolArgs[field] !== null && typeof toolArgs[field] === 'object'
                                    ? JSON.stringify(toolArgs[field])
                                    : (toolArgs[field] ?? '')
                                }
                                onChange={(e) => handleArgChange(field, e.target.value, prop)}
                                placeholder={prop.example ? `e.g. ${prop.example}` : `Enter ${field}`}
                                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 focus:bg-white"
                              />
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-2 text-xs text-slate-500 italic">
                        {sp({ technical: 'No input parameters: arguments are sent as {}.', analysts: 'This tool needs no inputs.', support: 'This tool needs no inputs.' })}
                      </div>
                    )}
                  </div>
                )}

                {statusNotification && (
                  <div className="p-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-xs text-cyan-800 flex items-center gap-2 font-medium">
                    <HelpCircle className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                    <span>{statusNotification}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleExecute}
                    disabled={executing}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                  >
                    <Play className={`w-3.5 h-3.5 fill-current ${executing ? 'animate-pulse' : ''}`} />
                    <span>{executing ? sp({ technical: 'Calling...', business: 'Running...' }) : sp({ technical: 'Send tools/call', business: 'Run tool' })}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Pane: Protocol & Telemetry Trace Inspector */}
        <aside
          data-tour-id="mcp-trace"
          className={`w-full md:w-[480px] lg:w-[540px] xl:w-[600px] border-l border-slate-200 surface-telemetry p-4 sm:p-5 shrink-0 overflow-hidden flex flex-col ${
            mobileTab === 'trace' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <McpTraceViewer telemetry={telemetry} loading={executing} onOpenRequestFlow={onOpenRequestFlow} />
        </aside>
      </div>
    </div>
  );
};
