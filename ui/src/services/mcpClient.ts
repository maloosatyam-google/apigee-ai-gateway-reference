import { GatewaySettings, McpTool, McpRpcRequest, McpRpcResponse, McpTelemetry } from '../types';
import { getEnvironment, getUserInfo, DEFAULT_SSO_USER } from './defaultSettings';
import { industryMcpEndpoint, personaKeyForUser, simulateGateway, toolNamesForPersona, type IndustryPack } from '../utils/industryPacks';
import { APIGEE_BASE_PROD, APIGEE_BASE_DEV } from '../config/deployment.js';

/**
 * Dev only: when set (e.g. http://localhost:8091), industry pack calls go to a local
 * industry-apis instead of Apigee, so there are no gateway checks (no limit, persona filter
 * or quota). The MCP tab says so. Unset in production builds.
 */
export const INDUSTRY_APIS_LOCAL: string = (import.meta as any).env?.VITE_INDUSTRY_APIS_LOCAL || '';

/** Local preview: tools/call timestamps per persona + tool, for the simulated quota. */
const localCallLog = new Map<string, number[]>();
const localPreview = (pack?: IndustryPack | null): pack is IndustryPack => Boolean(pack && INDUSTRY_APIS_LOCAL);

const BIGQUERY_MCP_TOOLS = new Set([
  'list_dataset_ids',
  'get_dataset_info',
  'list_table_ids',
  'get_table_info',
  'execute_sql_readonly',
  'execute_sql',
  'get_query_results',
  'cancel_job',
]);

const SERVICENOW_MCP_TOOLS = new Set([
  'listIncidents',
  'getIncident',
  'createIncident',
  'updateIncident',
]);

/**
 * Resolves the target MCP endpoint for the current environment and optional tool name.
 */
export function resolveMcpEndpoint(
  settings: GatewaySettings,
  toolName?: string,
  industryPack?: IndustryPack | null
): {
  requestUrl: string;
  displayEndpoint: string;
} {
  // The active theme's industry has a pack: its own MCP proxy (/<id>/mcp) serves every tool.
  if (industryPack && settings.environment !== 'custom') {
    const { requestUrl, displayEndpoint } = industryMcpEndpoint(
      industryPack, getEnvironment(settings.environment).id, INDUSTRY_APIS_LOCAL);
    return { requestUrl, displayEndpoint };
  }

  if (settings.environment === 'custom' && settings.customBaseUrl) {
    const clean = settings.customBaseUrl.replace(/\/+$/, '');
    const url = clean.endsWith('/mcp') ? clean : `${clean}/mcp`;
    return { requestUrl: url, displayEndpoint: url };
  }

  const envInfo = getEnvironment(settings.environment);
  const isDev = envInfo.id === 'dev';
  const host = isDev
    ? APIGEE_BASE_DEV
    : APIGEE_BASE_PROD;

  if (toolName && BIGQUERY_MCP_TOOLS.has(toolName)) {
    return {
      requestUrl: isDev ? '/api/bigquery-mcp-dev' : '/api/bigquery-mcp-prod',
      displayEndpoint: `${host}/bigquery/mcp`,
    };
  }

  if (toolName && SERVICENOW_MCP_TOOLS.has(toolName)) {
    return {
      requestUrl: isDev ? '/api/servicenow-mcp-dev' : '/api/servicenow-mcp-prod',
      displayEndpoint: `${host}/servicenow/mcp`,
    };
  }

  return {
    requestUrl: envInfo.mcpProxyPath,
    displayEndpoint: envInfo.mcpUpstreamUrl,
  };
}

/**
 * Builds standard headers sent to the Apigee MCP Gateway.
 */
function buildMcpHeaders(settings: GatewaySettings): Record<string, string> {
  const userInfo = getUserInfo(settings.activeUser);
  const effectiveApiKey = settings.apiKey || userInfo.apiKey;
  const effectiveEmail = settings.ssoUser?.email || settings.userEmail || DEFAULT_SSO_USER.email;
  const effectiveIdToken = settings.ssoUser?.idToken || settings.idToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-apikey': effectiveApiKey,
  };

  if (!settings.omitEmailHeader) {
    if (effectiveIdToken) {
      headers['Authorization'] = `Bearer ${effectiveIdToken}`;
    }
    if (effectiveEmail) {
      headers['X-User-Email'] = effectiveEmail;
    }
  }

  return headers;
}

/**
 * Extracts relevant response headers for telemetry and audit tracing.
 */
function extractResponseHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  const trackKeys = [
    'content-type',
    'x-request-id',
    'x-gateway-limit',
    'x-cloud-trace-context',
    'x-b3-traceid',
    'x-b3-spanid',
    'date',
    'server',
    'via',
    'x-powered-by',
  ];

  trackKeys.forEach((key) => {
    const val = res.headers.get(key);
    if (val) {
      headers[key] = val;
    }
  });

  return headers;
}

/**
 * Discovers available tools from Apigee native MCP proxy via JSON-RPC tools/list.
 */
export async function listMcpTools(settings: GatewaySettings, industryPack?: IndustryPack | null): Promise<{
  tools: McpTool[];
  telemetry: McpTelemetry;
}> {
  const { requestUrl, displayEndpoint } = resolveMcpEndpoint(settings, undefined, industryPack);
  const headersSent = buildMcpHeaders(settings);

  const rpcRequest: McpRpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: Date.now(),
    params: {},
  };

  const startTime = performance.now();
  let status = 0;
  let statusText = '';
  let headersReceived: Record<string, string> = {};
  let rawResponse: any = null;

  try {
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: headersSent,
      body: JSON.stringify(rpcRequest),
    });

    const latencyMs = Math.round(performance.now() - startTime);
    status = res.status;
    statusText = res.statusText;
    headersReceived = extractResponseHeaders(res);

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      rawResponse = (await res.json()) as McpRpcResponse;
    } else {
      const text = await res.text();
      rawResponse = { text };
    }

    let tools: McpTool[] = rawResponse?.result?.tools || [];
    if (localPreview(industryPack) && rawResponse?.result?.tools) {
      // No Apigee locally: apply the persona's product filter the proxy would apply.
      const allowed = toolNamesForPersona(industryPack, personaKeyForUser(settings.activeUser));
      tools = tools.filter((t) => allowed.includes(t.name));
      rawResponse = { ...rawResponse, result: { ...rawResponse.result, tools } };
      headersReceived['x-local-preview'] = 'persona filter simulated (Apigee applies it after deploy)';
    }

    const telemetry: McpTelemetry = {
      status,
      statusText: statusText || (status === 200 ? 'OK' : 'Error'),
      endpointUrl: displayEndpoint,
      method: 'tools/list',
      latencyMs,
      headersSent,
      headersReceived,
      rawRequest: rpcRequest,
      rawResponse,
      policyTrace: {
        ppMcp: status !== 400,
        vaVerifyApiKey: status !== 401 || Boolean(rawResponse?.result),
        qLimit: status !== 429,
        mlCloudLogging: true,
      },
      userEmail: headersSent['X-User-Email'],
      ssoUser: settings.ssoUser,
      keyTier: settings.keyTier,
      activeUser: settings.activeUser,
    };

    return { tools, telemetry };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorResponse = {
      jsonrpc: '2.0' as const,
      id: rpcRequest.id,
      error: {
        code: -32603,
        message: err.message || 'Network or Gateway Connection Error',
      },
    };

    const telemetry: McpTelemetry = {
      status: 500,
      statusText: 'Gateway Unreachable',
      endpointUrl: displayEndpoint,
      method: 'tools/list',
      latencyMs,
      headersSent,
      headersReceived: {},
      rawRequest: rpcRequest,
      rawResponse: errorResponse,
      policyTrace: {
        ppMcp: false,
        vaVerifyApiKey: false,
        qLimit: false,
        mlCloudLogging: false,
      },
      userEmail: headersSent['X-User-Email'],
      ssoUser: settings.ssoUser,
      keyTier: settings.keyTier,
      activeUser: settings.activeUser,
    };

    return { tools: [], telemetry };
  }
}

/**
 * Executes a tool on Apigee native MCP proxy via JSON-RPC tools/call.
 */
export async function callMcpTool(
  settings: GatewaySettings,
  toolName: string,
  args: Record<string, any>,
  industryPack?: IndustryPack | null
): Promise<{
  result: any;
  telemetry: McpTelemetry;
}> {
  const { requestUrl, displayEndpoint } = resolveMcpEndpoint(settings, toolName, industryPack);
  const headersSent = buildMcpHeaders(settings);

  const rpcRequest: McpRpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    id: Date.now(),
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const startTime = performance.now();
  let status = 0;
  let statusText = '';
  let headersReceived: Record<string, string> = {};
  let rawResponse: any = null;

  try {
    // Local preview: decide what the pack's Apigee proxy would do before calling the backend.
    const simulated = localPreview(industryPack)
      ? (() => {
          const persona = personaKeyForUser(settings.activeUser);
          const key = `${persona}:${toolName}`;
          const recent = localCallLog.get(key) || [];
          const fault = simulateGateway(industryPack, persona, toolName, args, recent);
          if (!fault) localCallLog.set(key, [...recent.filter((t) => Date.now() - t < 60_000), Date.now()]);
          return fault;
        })()
      : null;
    const res = simulated
      ? new Response(JSON.stringify(simulated.status === 403 ? { ...simulated.body, id: rpcRequest.id } : simulated.body), {
          status: simulated.status,
          statusText: { 401: 'Unauthorized', 403: 'Forbidden', 429: 'Too Many Requests' }[simulated.status],
          headers: {
            'content-type': 'application/json',
            ...(simulated.limitCode ? { 'x-gateway-limit': simulated.limitCode } : {}),
          },
        })
      : await fetch(requestUrl, {
          method: 'POST',
          headers: headersSent,
          body: JSON.stringify(rpcRequest),
        });

    const latencyMs = Math.round(performance.now() - startTime);
    status = res.status;
    statusText = res.statusText;
    headersReceived = extractResponseHeaders(res);
    if (simulated) headersReceived['x-local-preview'] = 'gateway decision simulated (Apigee enforces it after deploy)';

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      rawResponse = (await res.json()) as McpRpcResponse;
    } else {
      const text = await res.text();
      rawResponse = { text };
    }

    const telemetry: McpTelemetry = {
      status,
      statusText: statusText || (status === 200 ? 'OK' : status === 429 ? 'Quota Exceeded' : 'Error'),
      endpointUrl: displayEndpoint,
      method: `tools/call (${toolName})`,
      latencyMs,
      headersSent,
      headersReceived,
      rawRequest: rpcRequest,
      rawResponse,
      policyTrace: {
        ppMcp: status !== 400,
        vaVerifyApiKey: status !== 401 || Boolean(rawResponse?.result),
        qLimit: status !== 429,
        mlCloudLogging: true,
      },
      userEmail: headersSent['X-User-Email'],
      ssoUser: settings.ssoUser,
      keyTier: settings.keyTier,
      activeUser: settings.activeUser,
    };

    return {
      result: rawResponse?.result || rawResponse?.error || rawResponse,
      telemetry,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorResponse = {
      jsonrpc: '2.0' as const,
      id: rpcRequest.id,
      error: {
        code: -32603,
        message: err.message || 'Execution Failed: Gateway Unreachable',
      },
    };

    const telemetry: McpTelemetry = {
      status: 500,
      statusText: 'Gateway Unreachable',
      endpointUrl: displayEndpoint,
      method: `tools/call (${toolName})`,
      latencyMs,
      headersSent,
      headersReceived: {},
      rawRequest: rpcRequest,
      rawResponse: errorResponse,
      policyTrace: {
        ppMcp: false,
        vaVerifyApiKey: false,
        qLimit: false,
        mlCloudLogging: false,
      },
      userEmail: headersSent['X-User-Email'],
      ssoUser: settings.ssoUser,
      keyTier: settings.keyTier,
      activeUser: settings.activeUser,
    };

    return {
      result: errorResponse,
      telemetry,
    };
  }
}
