import React, { useState } from 'react';
import { toolArea } from '../utils/industryPacks';
import { McpTelemetry, McpTool } from '../types';
import {
  Activity,
  Clock,
  Code2,
  Copy,
  Check,
  FileJson,
  Send,
  ChevronDown,
  ChevronUp,
  Table,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Database,
  Workflow,
} from 'lucide-react';
import { usePersonaVoice } from '../utils/voice';

interface McpTraceViewerProps {
  telemetry: McpTelemetry | null;
  loading?: boolean;
  onOpenRequestFlow?: (telemetry: McpTelemetry) => void;
}

/**
 * Theme-aware JSON syntax highlighter for both Light and Dark modes
 */
const highlightJson = (json: any): string => {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  if (!json) return '';

  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match: string) => {
      let cls = 'text-amber-700 font-medium'; // number
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'text-cyan-700 font-semibold'; // JSON key
        } else {
          cls = 'text-emerald-700'; // string value
        }
      } else if (/true|false/.test(match)) {
        cls = 'text-purple-700 font-bold'; // boolean
      } else if (/null/.test(match)) {
        cls = 'text-rose-600 italic'; // null
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
};

/**
 * Formats snake_case or camelCase property names into clean human labels
 */
const formatLabel = (key: string): string => {
  const specialMap: Record<string, string> = {
    sku: 'SKU',
    csat: 'CSAT',
    customerId: 'Customer ID',
    orderId: 'Order ID',
    caseId: 'Case ID',
    refundId: 'Refund ID',
    grossMarginPct: 'Gross Margin',
    maxDiscountPct: 'Max Discount',
    averageDiscountPct: 'Avg Discount',
    weekStarting: 'Week Of',
    applicationId: 'Application ID',
    applicantName: 'Applicant Name',
    firstName: 'First Name',
    lastName: 'Last Name',
    dateOfBirth: 'Date of Birth',
    ssnLast4: 'SSN (Last 4)',
    zipCode: 'ZIP Code',
    creditScore: 'Credit Score',
    applicantSegment: 'Customer Segment',
    phoneNumber: 'Phone Number',
    faultstring: 'Diagnostic Message',
    errorcode: 'Error Code',
  };
  if (specialMap[key]) return specialMap[key];

  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 *Categorizes MCP tools into business service domains
 */
// Business capability per tool. Colours are grouped by source API: cool tones for the
// Customer Service API, warm tones for the Business Insights API. Array order is also the
// sort order of the tools/list table, so each API's tools sit together.
const TOOL_DOMAINS: { label: string; badgeClass: string; tools: string[] }[] = [
  // Customer Service API (customer-service-v1)
  { label: 'Customers', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200', tools: ['searchcustomers', 'getcustomer'] },
  { label: 'Orders', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200', tools: ['listcustomerorders', 'getorderstatus'] },
  { label: 'Pricing', badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200', tools: ['getproductprice'] },
  { label: 'Support', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200', tools: ['createsupportcase'] },
  { label: 'Refunds', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200', tools: ['issuerefund'] },
  // Business Insights API (business-insights-v1), aggregated data only
  { label: 'Finance', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', tools: ['getrevenuetrends', 'getproductmargins', 'runforecast'] },
  { label: 'Customer Analytics', badgeClass: 'bg-orange-50 text-orange-700 border-orange-200', tools: ['getsupportmetrics', 'getchurnrisk'] },
  // Other MCP servers
  {
    label: 'Data & Analytics',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
    tools: ['list_dataset_ids', 'get_dataset_info', 'list_table_ids', 'get_table_info', 'execute_sql_readonly', 'execute_sql', 'get_query_results', 'cancel_job'],
  },
  {
    label: 'IT Service Mgmt',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    tools: ['listincidents', 'getincident', 'createincident', 'updateincident'],
  },
];

/** Sort key for the tools/list table: domain order, then the order within the domain. */
const toolSortKey = (toolName: string): number => {
  const lower = toolName.toLowerCase();
  const d = TOOL_DOMAINS.findIndex((x) => x.tools.includes(lower));
  return d < 0 ? 10_000 : d * 100 + TOOL_DOMAINS[d].tools.indexOf(lower);
};

const getToolDomain = (toolName: string): { label: string; badgeClass: string } => {
  const lower = toolName.toLowerCase();
  const match = TOOL_DOMAINS.find((d) => d.tools.includes(lower));
  if (match) return { label: match.label, badgeClass: match.badgeClass };
  // Industry pack tools: the pack's business area. Cool tones for customer-facing tools,
  // warm tones for analyst tools, like the generic APIs above.
  const packTool = toolArea(toolName);
  if (packTool) {
    return {
      label: packTool.area,
      badgeClass: packTool.persona === 'ops' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  if (lower.includes('loan')) {
    return {
      label: 'Loans & Banking',
      badgeClass:
        'bg-blue-50 text-blue-700 border-blue-200',
    };
  }
  if (lower.includes('price') || lower.includes('sku')) {
    return {
      label: 'Pricing',
      badgeClass:
        'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  return {
    label: 'Core Enterprise',
    badgeClass:
      'bg-purple-50 text-purple-700 border-purple-200',
  };
};

/**
 * Renders an individual table cell or record value with rich formatting
 */
const renderFormattedValue = (key: string, val: any): React.ReactNode => {
  if (val === null || val === undefined) {
    return <span className="text-slate-400 italic">—</span>;
  }

  const lowerKey = key.toLowerCase();

  // Price / Currency formatting
  if (
    typeof val === 'number' &&
    /price|amount|income|revenue|total|value|profit|cost|refundable|limit|requested/.test(lowerKey) &&
    !/orders|cases|customers|units/.test(lowerKey)
  ) {
    return (
      <span className="font-mono font-bold text-emerald-600">
        ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }

  // Percentages (e.g. grossMarginPct, maxDiscountPct)
  if (typeof val === 'number' && lowerKey.endsWith('pct')) {
    return <span className="font-mono font-semibold text-slate-800">{val}%</span>;
  }

  // Arrays of plain values
  if (Array.isArray(val) && val.every((v) => v === null || typeof v !== 'object')) {
    return <span className="text-slate-800 font-medium">{val.join(', ')}</span>;
  }

  // Status badges
  if (lowerKey === 'status' && typeof val === 'string') {
    const upper = val.toUpperCase();
    const isApproved = upper.includes('APPROV') || upper === 'OK' || upper === 'ACTIVE' || upper === 'DELIVERED' || upper === 'RESOLVED';
    const isRejected = upper.includes('REJECT') || upper.includes('DENI') || upper.includes('FAIL') || upper === 'DELAYED' || upper === 'CANCELLED';
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
          isApproved
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : isRejected
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}
      >
        {val}
      </span>
    );
  }

  // SKU / ID / Code badges
  if (
    typeof val === 'string' &&
    (lowerKey.includes('sku') ||
      lowerKey.includes('id') ||
      lowerKey === 'errorcode' ||
      /^[A-Z0-9_-]{5,}$/.test(val))
  ) {
    return (
      <span className="font-mono font-semibold text-cyan-700 bg-cyan-50/80 px-2 py-0.5 rounded border border-cyan-200/60 text-[11px]">
        {val}
      </span>
    );
  }

  if (typeof val === 'boolean') {
    return (
      <span
        className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
          val
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-600'
        }`}
      >
        {String(val)}
      </span>
    );
  }

  if (typeof val === 'object') {
    return (
      <span className="font-mono text-[11px] text-slate-700">
        {JSON.stringify(val)}
      </span>
    );
  }

  return <span className="text-slate-800 font-medium">{String(val)}</span>;
};

/** True for a non-empty array of plain objects (orders, customers, monthly trends...). */
const isRowArray = (v: any): v is Array<Record<string, any>> =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r));

/** Collects nested arrays of objects (with a dotted path label) so they render as tables. */
const collectRowArrays = (
  obj: Record<string, any>,
  prefix = ''
): Array<{ key: string; label: string; rows: Array<Record<string, any>> }> => {
  const out: Array<{ key: string; label: string; rows: Array<Record<string, any>> }> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isRowArray(v)) out.push({ key: `${prefix}${k}`, label: formatLabel(k), rows: v });
    else if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...collectRowArrays(v, `${prefix}${k}.`));
  }
  return out;
};

/**
 * Flattens nested object properties for clean 2-column business record tables
 * (arrays of objects are skipped here and rendered as tables, see collectRowArrays).
 */
const flattenObjectEntries = (
  obj: Record<string, any>,
  prefix = ''
): Array<{ section?: string; key: string; label: string; value: any }> => {
  const rows: Array<{ section?: string; key: string; label: string; value: any }> = [];

  for (const [k, v] of Object.entries(obj)) {
    if (isRowArray(v)) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sectionTitle = formatLabel(k);
      const nested = flattenObjectEntries(v, `${prefix}${k}.`);
      if (nested.length > 0) {
        nested[0].section = sectionTitle;
        rows.push(...nested);
      }
    } else {
      rows.push({
        key: `${prefix}${k}`,
        label: formatLabel(k),
        value: v,
      });
    }
  }
  return rows;
};

type ParsedMcpView =
  | { kind: 'catalog'; tools: McpTool[] }
  | { kind: 'array'; rows: Array<Record<string, any>>; toolName: string }
  | { kind: 'record'; record: Record<string, any>; toolName: string }
  | { kind: 'fault'; fault: Record<string, any>; status: number; toolName: string }
  | { kind: 'text'; text: string; toolName: string };

const parseMcpPayload = (telemetry: McpTelemetry): ParsedMcpView => {
  const raw = telemetry.rawResponse;
  const toolMatch = telemetry.method.match(/tools\/call\s*\(([^)]+)\)/);
  const toolName = toolMatch ? toolMatch[1] : telemetry.method;

  // 1. Check for tools/list catalog
  if (telemetry.method === 'tools/list' || Array.isArray(raw?.result?.tools)) {
    return {
      kind: 'catalog',
      tools: raw?.result?.tools || [],
    };
  }

  // 2. Extract inner text content from MCP tools/call response if present
  let innerData: any = raw?.result;
  if (raw?.result?.content && Array.isArray(raw.result.content) && raw.result.content[0]?.text) {
    const rawText = raw.result.content[0].text;
    try {
      innerData = JSON.parse(rawText);
    } catch {
      innerData = rawText;
    }
  } else if (raw?.error) {
    innerData = raw.error;
  } else if (!innerData && raw) {
    innerData = raw;
  }

  // 3. Check if response is an error / policy block / upstream fault
  const isErrorStatus = telemetry.status >= 400 || raw?.result?.isError === true || Boolean(raw?.error);
  const hasFaultObject =
    innerData && typeof innerData === 'object' && (innerData.fault || innerData.error || innerData.errorcode);

  if (isErrorStatus || hasFaultObject) {
    // Apigee policy faults nest under `fault`; REST proxy business-rule faults are flat
    // ({"error":"REFUND_LIMIT","message":...}), so keep the whole object when `error` is a string.
    const faultObj =
      innerData?.fault ||
      (innerData?.error && typeof innerData.error === 'object' ? innerData.error : null) ||
      innerData ||
      { message: telemetry.statusText };
    return {
      kind: 'fault',
      fault: typeof faultObj === 'object' ? faultObj : { message: String(faultObj) },
      status: telemetry.status,
      toolName,
    };
  }

  // 4. Array of records
  if (Array.isArray(innerData)) {
    return {
      kind: 'array',
      rows: innerData,
      toolName,
    };
  }

  // 5. Single structured object record (e.g. getOrderStatus, getSupportMetrics)
  if (innerData && typeof innerData === 'object') {
    return {
      kind: 'record',
      record: innerData,
      toolName,
    };
  }

  // 6. Plain text fallback
  return {
    kind: 'text',
    text: typeof innerData === 'string' ? innerData : JSON.stringify(innerData, null, 2),
    toolName,
  };
};

export const McpTraceViewer: React.FC<McpTraceViewerProps> = ({ telemetry, loading, onOpenRequestFlow }) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const sub = new URLSearchParams(window.location.search).get('subtab');
      if (sub === 'headers' || sub === 'request' || sub === 'response') return true;
    }
    return false;
  });

  const [activeTab, setActiveTab] = useState<'response' | 'request' | 'headers'>(() => {
    if (typeof window !== 'undefined') {
      const sub = new URLSearchParams(window.location.search).get('subtab');
      if (sub === 'headers' || sub === 'request' || sub === 'response') return sub;
    }
    return 'response';
  });

  const [copied, setCopied] = useState(false);
  // Rendered inside the Tools Gateway playground, so the consumer persona sets the voice:
  // technical = Engineering & IT (builder), analysts, support.
  const { sp } = usePersonaVoice('persona');

  const getLatencyColor = (ms: number) => {
    if (ms < 250) return 'text-emerald-600';
    if (ms < 1000) return 'text-blue-600';
    if (ms < 2500) return 'text-amber-600';
    return 'text-rose-600';
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-white border border-slate-200 rounded-2xl shadow-xs">
        <div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-600 rounded-full animate-spin mb-4" />
        <h4 className="text-sm font-semibold text-slate-900">{sp({ technical: 'Calling tools/call', business: 'Running the tool' })}</h4>
        <p className="text-xs text-slate-600 mt-1 max-w-xs">
          {sp({
            technical: 'Verifying your key and quota, then forwarding the JSON-RPC call to the MCP server...',
            analysts: "Checking your team's access, then fetching the records...",
            support: 'Checking your access, then fetching the answer...',
          })}
        </p>
      </div>
    );
  }

  if (!telemetry) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-white border border-slate-200 rounded-2xl shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600 mb-4">
          <Activity className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-slate-900">{sp({ technical: 'Tool call results appear here', analysts: 'Records appear here', support: 'Answers appear here' })}</h4>
        <p className="text-xs text-slate-600 mt-1 max-w-sm leading-relaxed">
          Pick a tool and click{' '}
          <span className="text-cyan-600 font-medium">{sp({ technical: 'Send tools/call', business: 'Run tool' })}</span>
          {sp({
            technical: ', or load a preset, to see the JSON-RPC result, status code and latency your client gets back.',
            analysts: ', or try a task, to see the records and what the gateway checked.',
            support: ', or try a task, to see the answer for your customer and what the gateway checked.',
          })}
        </p>
      </div>
    );
  }

  const parsedView = parseMcpPayload(telemetry);
  const isSuccess = telemetry.status >= 200 && telemetry.status < 300 && parsedView.kind !== 'fault';
  const isRateLimited = telemetry.status === 429;
  // Business rules enforced by the REST proxy behind an Apigee-hosted tool (e.g. REFUND_LIMIT):
  // the key and tool were allowed, so this is not an entitlement denial.
  const isBusinessRule =
    parsedView.kind === 'fault' &&
    typeof parsedView.fault.error === 'string' &&
    (parsedView.fault.enforcedBy === 'Apigee' || parsedView.fault.error === 'REFUND_LIMIT');
  const isKeyBlock =
    (telemetry.status === 401 || telemetry.status === 403) &&
    !isBusinessRule &&
    !telemetry.rawResponse?.result;
  // Plain outcome and operation name for Analysts and Support & Sales; the HTTP code
  // and JSON-RPC method stay for Engineering & IT.
  const businessStatus = isSuccess
    ? 'Done'
    : isRateLimited
    ? 'Limit reached'
    : isBusinessRule
    ? 'Needs approval'
    : isKeyBlock
    ? 'Blocked: not allowed'
    : 'Not completed';
  const calledTool = telemetry.method.match(/tools\/call\s*\(([^)]+)\)/)?.[1];
  const businessOperation =
    telemetry.method === 'tools/list' ? 'List available tools' : calledTool ? `Run ${calledTool}` : telemetry.method;
  const statusLabel = sp({ technical: `HTTP ${telemetry.status} ${telemetry.statusText}`, business: businessStatus });
  const operationLabel = sp({ technical: telemetry.method, business: businessOperation });

  const handleCopy = (content: any) => {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col surface-telemetry font-sans text-xs overflow-y-auto rounded-2xl border border-slate-200 shadow-xs">
      {/* Top Header Bar */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isSuccess ? 'bg-emerald-500 animate-pulse' : isRateLimited ? 'bg-amber-500' : 'bg-rose-500'
            }`}
          />
          <h2 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
            {sp({ technical: 'MCP Response Trace', business: 'What happened' })}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              isSuccess
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : isRateLimited
                ? 'bg-amber-50 text-amber-800 border-amber-300 text-amber-300'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Scrollable Main Content Body */}
      <div className="p-3.5 space-y-3 flex-1 overflow-y-auto">
        {/* Executive Telemetry Summary Card (Full Width) */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-600" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {sp({ technical: 'JSON-RPC Method', business: 'Tool request' })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onOpenRequestFlow && (
                <button
                  type="button"
                  onClick={() => onOpenRequestFlow(telemetry)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 font-sans font-semibold text-[10px] transition cursor-pointer shadow-2xs"
                  title={sp({ technical: 'See every gateway policy this tools/call passed through, in order', analysts: 'See each check your request went through', support: 'See each check this lookup went through' })}
                >
                  <Workflow className="w-3 h-3 text-cyan-600" />
                  <span>{sp({ technical: 'Request Flow', business: 'See the steps' })}</span>
                </button>
              )}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold">
                {sp({ technical: 'JSON-RPC 2.0', business: 'Governed' })}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-0.5">
            <div className="font-mono font-bold text-slate-900 text-xs sm:text-sm truncate">
              {operationLabel}
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-bold whitespace-nowrap shrink-0">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className={getLatencyColor(telemetry.latencyMs)}>{telemetry.latencyMs} ms</span>
            </div>
          </div>
        </div>

        {/* Structured Result View Section (Replaces Raw JSON Dump) */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
          {/* Section Header */}
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-cyan-600" />
              <span className="font-bold text-slate-900 text-xs">
                {parsedView.kind === 'catalog'
                  ? sp({ technical: 'tools/list result', analysts: 'Tools for your analysis', support: 'Tools for your replies' })
                  : parsedView.kind === 'array'
                  ? sp({ technical: `Result rows — ${parsedView.toolName}`, analysts: `Records — ${parsedView.toolName}`, support: `Result — ${parsedView.toolName}` })
                  : parsedView.kind === 'record'
                  ? sp({ technical: `Result object — ${parsedView.toolName}`, analysts: `Record — ${parsedView.toolName}`, support: `Details — ${parsedView.toolName}` })
                  : parsedView.kind === 'fault'
                  ? sp({ technical: `Error response — ${parsedView.toolName}`, business: `Could not complete — ${parsedView.toolName}` })
                  : sp({ technical: 'Text content', business: 'Result' })}
              </span>
            </div>

            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-200/70 text-slate-700">
              {parsedView.kind === 'catalog'
                ? sp({ technical: `${parsedView.tools.length} tools`, business: `${parsedView.tools.length} tools` })
                : parsedView.kind === 'array'
                ? sp({ technical: `${parsedView.rows.length} rows`, business: `${parsedView.rows.length} records` })
                : parsedView.kind === 'record'
                ? sp({ technical: 'Single object', business: 'One record' })
                : parsedView.kind === 'fault'
                ? sp({ technical: `HTTP ${parsedView.status}`, business: 'Notice' })
                : sp({ technical: 'text', business: 'Text' })}
            </span>
          </div>

          {/* CASE 1: Tool Discovery Catalog Table (tools/list) */}
          {parsedView.kind === 'catalog' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2 px-3.5">{sp({ technical: 'Tool & Summary', business: 'Tool' })}</th>
                    <th className="py-2 px-3">{sp({ technical: 'Domain', business: 'Area' })}</th>
                    <th className="py-2 px-3.5">{sp({ technical: 'Parameters', business: 'Inputs' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-xs">
                  {[...parsedView.tools].sort((x, y) => toolSortKey(x.name) - toolSortKey(y.name)).map((tool) => {
                    const domain = getToolDomain(tool.name);
                    const props = tool.inputSchema?.properties || {};
                    const requiredList = tool.inputSchema?.required || [];
                    const paramKeys = Object.keys(props);
                    const cleanDesc = (tool.description || '').split('\n')[0].trim();

                    return (
                      <tr
                        key={tool.name}
                        className="hover:bg-slate-50/80 transition"
                      >
                        <td className="py-2 px-3.5">
                          <div className="font-mono font-bold text-cyan-700">
                            {tool.name}
                          </div>
                          {cleanDesc && (
                            <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                              {cleanDesc}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${domain.badgeClass}`}
                          >
                            {domain.label}
                          </span>
                        </td>
                        <td className="py-2 px-3.5">
                          {paramKeys.length === 0 ? (
                            <span className="text-[11px] text-slate-400 italic">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {paramKeys.map((pKey) => {
                                const isReq = requiredList.includes(pKey);
                                return (
                                  <span
                                    key={pKey}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-700 border border-slate-200"
                                  >
                                    <span>{pKey}</span>
                                    {isReq && <span className="text-rose-500 font-bold">*</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* CASE 2: Array of Records Table */}
          {parsedView.kind === 'array' && (
            <div className="overflow-x-auto">
              {parsedView.rows.length === 0 ? (
                <div className="p-6 text-center text-slate-500 italic">{sp({ technical: 'Empty array returned.', analysts: 'No matching records found.', support: 'Nothing found for this customer.' })}</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-2.5 px-3.5 w-10 text-center">#</th>
                      {Object.keys(parsedView.rows[0]).map((colKey) => (
                        <th key={colKey} className="py-2.5 px-3.5">
                          {formatLabel(colKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 text-xs">
                    {parsedView.rows.map((row, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-slate-50/80 transition"
                      >
                        <td className="py-2.5 px-3.5 text-center font-mono text-[11px] text-slate-400">
                          {idx + 1}
                        </td>
                        {Object.entries(row).map(([colKey, val]) => (
                          <td key={colKey} className="py-2.5 px-3.5">
                            {renderFormattedValue(colKey, val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* CASE 3: Single Business Entity Record Table (e.g. getOrderStatus), nested lists as tables */}
          {parsedView.kind === 'record' && (
            <div className="divide-y divide-slate-200/70">
              {flattenObjectEntries(parsedView.record).map((item) => (
                <React.Fragment key={item.key}>
                  {item.section && (
                    <div className="px-4 py-1.5 bg-slate-100/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Database className="w-3 h-3 text-cyan-600" />
                      <span>{item.section}</span>
                    </div>
                  )}
                  <div className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-slate-50/60 transition">
                    <span className="text-slate-600 font-medium text-xs">
                      {item.label}
                    </span>
                    <div className="text-right">{renderFormattedValue(item.key, item.value)}</div>
                  </div>
                </React.Fragment>
              ))}
              {collectRowArrays(parsedView.record).map((tbl) => (
                <div key={tbl.key}>
                  <div className="px-4 py-1.5 bg-slate-100/80 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Database className="w-3 h-3 text-cyan-600" />
                    <span>{tbl.label} ({tbl.rows.length})</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {Object.keys(tbl.rows[0]).map((colKey) => (
                            <th key={colKey} className="py-2 px-3 whitespace-nowrap">{formatLabel(colKey)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70 text-xs">
                        {tbl.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 transition">
                            {Object.keys(tbl.rows[0]).map((colKey) => (
                              <td key={colKey} className="py-2 px-3 whitespace-nowrap">{renderFormattedValue(colKey, row[colKey])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CASE 4: Policy / Governance Block or Upstream Service Fault */}
          {parsedView.kind === 'fault' && (
            <div className="p-4 space-y-3">
              <div
                className={`p-3 rounded-xl border flex items-start gap-3 ${
                  telemetry.status === 429 || isBusinessRule
                    ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                    : 'bg-rose-50/80 border-rose-200 text-rose-900'
                }`}
              >
                <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold">
                    {isBusinessRule
                      ? sp({ technical: `${telemetry.status}: business rule (${String(parsedView.fault.error)})`, analysts: 'Stopped by a business rule', support: 'Needs supervisor approval' })
                      : telemetry.status === 429
                      ? sp({ technical: '429: burst rate limit hit (Q-Limit)', analysts: 'Usage limit reached: too many requests in a short time', support: 'Too many lookups: wait a few seconds' })
                      : isKeyBlock
                      ? sp({ technical: `${telemetry.status}: key not entitled to this tool`, analysts: 'Blocked: your team is not allowed to use this tool', support: "Blocked: this tool is not on your team's list" })
                      : sp({ technical: 'Upstream service returned an error', analysts: 'The business system returned an error', support: 'The business system returned an error' })}
                  </div>
                  <p className="text-[11px] opacity-90 leading-relaxed">
                    {isBusinessRule
                      ? sp({
                          technical: `Key and tool were allowed; the REST proxy behind the tool enforced a business rule before calling the backend. ${String(parsedView.fault.message || '')}`,
                          analysts: `The gateway applied a company rule before the business system was changed. ${String(parsedView.fault.message || '')}`,
                          support: `${String(parsedView.fault.message || 'This request needs a supervisor.')} Offer a smaller goodwill credit, or ask a supervisor.`,
                        })
                      : telemetry.status === 429
                      ? sp({
                          technical: 'The Q-Limit policy rejected this tools/call because your key exceeded its allowed burst rate. Back off before retrying; the fault body is below.',
                          analysts: "Requests came in faster than your team's limit allows, so this lookup was refused. Wait a few seconds and try again.",
                          support: "Requests came in faster than your team's limit allows. Wait a few seconds before looking this up again for the customer.",
                        })
                      : isKeyBlock
                      ? sp({
                          technical: "The gateway rejected the call at key verification: this key's API product does not include the tool, so the MCP server was never called. Fault body below.",
                          analysts: "The gateway checked your team's access and stopped the call before it reached the business system, so no confidential data was exposed.",
                          support: "The gateway checked your team's access and stopped the call before it reached the business system.",
                        })
                      : sp({
                          technical: 'The gateway accepted the JSON-RPC envelope and forwarded it; the target service returned the error below. This is not a gateway policy denial.',
                          analysts: 'The request was allowed, but the business system could not complete it. Details below.',
                          support: 'The request was allowed, but the business system could not complete it. Details below.',
                        })}
                  </p>
                </div>
              </div>

              {/* Structured Fault Details Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-200/70">
                {flattenObjectEntries(parsedView.fault).map((item) => (
                  <div
                    key={item.key}
                    className="px-3.5 py-2 flex items-start justify-between gap-4 bg-slate-50/40"
                  >
                    <span className="text-slate-500 font-medium text-[11px] shrink-0">
                      {item.label}
                    </span>
                    <div className="text-right break-all">{renderFormattedValue(item.key, item.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CASE 5: Plain Text Output */}
          {parsedView.kind === 'text' && (
            <div className="p-4 font-mono text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
              {parsedView.text}
            </div>
          )}
        </div>

        {/* Collapsible Accordion: Inspect JSON-RPC Wire Payload & HTTP Headers */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-white hover:bg-slate-100/80 border border-slate-200 text-slate-700 hover:text-slate-900 transition text-xs shadow-2xs cursor-pointer"
          >
            <div className="flex items-center gap-2 font-semibold">
              <Code2 className="w-4 h-4 text-cyan-600" />
              <span>{sp({ technical: 'JSON-RPC Payload & HTTP Headers', business: 'Technical details (for IT)' })}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
              <span>{showTechnicalDetails ? 'Hide' : 'Show'}</span>
              {showTechnicalDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          </button>

          {showTechnicalDetails && (
            <div className="mt-2.5 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-in fade-in duration-150">
              {/* Tab Switcher for Wire Details */}
              <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('response')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'response'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                    }`}
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    JSON-RPC Response
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('request')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'request'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    JSON-RPC Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('headers')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'headers'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                    }`}
                  >
                    Headers
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const content =
                      activeTab === 'response'
                        ? telemetry.rawResponse
                        : activeTab === 'request'
                        ? telemetry.rawRequest
                        : {
                            headersReceived: telemetry.headersReceived,
                            headersSent: telemetry.headersSent,
                          };
                    handleCopy(content);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-medium transition cursor-pointer shadow-2xs"
                  title="Copy payload"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Tab Content Display */}
              <div className="p-3.5 font-mono text-xs leading-relaxed">
                {activeTab === 'response' && (
                  <pre
                    className="p-3.5 rounded-xl bg-slate-50 text-slate-800 border border-slate-200 overflow-x-auto text-xs leading-relaxed selection:bg-cyan-100 shadow-2xs max-h-80"
                    dangerouslySetInnerHTML={{
                      __html: highlightJson(telemetry.rawResponse),
                    }}
                  />
                )}

                {activeTab === 'request' && (
                  <div className="space-y-2">
                    <div className="text-[11px] text-slate-600 font-sans">
                      Payload posted to{' '}
                      <code className="font-mono text-cyan-600 font-semibold">
                        {telemetry.endpointUrl}
                      </code>
                      :
                    </div>
                    <pre
                      className="p-3.5 rounded-xl bg-slate-50 text-slate-800 border border-slate-200 overflow-x-auto text-xs leading-relaxed selection:bg-cyan-100 shadow-2xs max-h-80"
                      dangerouslySetInnerHTML={{
                        __html: highlightJson(telemetry.rawRequest),
                      }}
                    />
                  </div>
                )}

                {activeTab === 'headers' && (
                  <div className="space-y-3">
                    {/* Headers Received from Gateway */}
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 shadow-2xs">
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200">
                        <div className="text-[11px] font-bold text-slate-800 font-sans uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                          <span>Headers Received from Gateway</span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200 font-medium">
                          {Object.keys(telemetry.headersReceived).length} headers
                        </span>
                      </div>
                      <div className="divide-y divide-slate-200/80 font-mono text-[11px] max-h-48 overflow-y-auto">
                        {Object.entries(telemetry.headersReceived).map(([k, v]) => (
                          <div key={k} className="py-1.5 px-1 flex items-start justify-between gap-3">
                            <span className="text-cyan-700 font-semibold select-all shrink-0">
                              {k}:
                            </span>
                            <span className="text-slate-900 text-right break-all select-all font-medium">
                              {v}
                            </span>
                          </div>
                        ))}
                        {Object.keys(telemetry.headersReceived).length === 0 && (
                          <div className="py-3 text-center text-slate-500 text-xs italic font-sans">
                            No headers received in response
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Headers Sent by Client */}
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 shadow-2xs">
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200">
                        <div className="text-[11px] font-bold text-slate-800 font-sans uppercase tracking-wider flex items-center gap-1.5">
                          <Send className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>Headers Sent by Client</span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200 font-medium">
                          {Object.keys(telemetry.headersSent).length} headers
                        </span>
                      </div>
                      <div className="divide-y divide-slate-200/80 font-mono text-[11px]">
                        {Object.entries(telemetry.headersSent).map(([k, v]) => (
                          <div key={k} className="py-1.5 px-1 flex items-start justify-between gap-3">
                            <span className="text-slate-700 font-semibold select-all shrink-0">
                              {k}:
                            </span>
                            <span className="text-slate-900 text-right break-all select-all font-medium">
                              {k.toLowerCase() === 'x-apikey' && v && v.length > 12
                                ? `${v.slice(0, 8)}...${v.slice(-4)}`
                                : v}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


