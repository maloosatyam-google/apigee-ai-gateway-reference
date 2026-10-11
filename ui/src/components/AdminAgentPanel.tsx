import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  PanelRight,
  Wrench,
  Undo2,
  GitPullRequest,
  FlaskConical,
  Send,
  Loader2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,

  GripVertical,
  Check,
  X,
  History,
  ArrowRight,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';
import { AskApigeeInsightCard } from './AskApigeeInsightCard';
import {
  AGENT_MODEL,
  fetchChanges,
  fetchSandbox,
  provisionSandbox,
  revertChange,
  sendChat,
  type AdminAgentEvent,
  type Change,
  type ChatTurn,
  type ChatUsage,
  type AssistantScope,
  type InsightEvent,
  type SandboxState,
  type TestResult,
  type ToolTestResult,
} from '../services/adminAgent';
import { adminRoleById } from '../utils/adminRoles';
import type { AdminRole } from '../utils/adminRoles';
import { usePersonaVoice } from '../utils/voice';
import { rewordPersonaNames, canonicalPersonaNames } from '../utils/customerTheme';
import { useCustomerTheme } from './CustomerThemeProvider';

/**
 * A single row in the transcript. The agent's writes are auto-applied by the
 * backend, so a `change` entry is a *notification with an undo*, never an
 * approval prompt - the card says so in as many words.
 */
type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; usage?: ChatUsage; next?: string[] }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean }
  | { kind: 'change'; id: string; change: Change }
  | { kind: 'test'; id: string; result: TestResult }
  | { kind: 'tool_test'; id: string; result: ToolTestResult }
  | { kind: 'insight'; id: string; event: InsightEvent }
  /*
    `blocked` is a governed refusal from Model Armor, not a broken request, and is
    styled amber rather than rose to say so.
  */
  | { kind: 'error'; id: string; text: string; tone: 'failed' | 'blocked'; retry?: string };

const MIN_WIDTH = 340;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 400;

/*
  Avoid the literal tokens "guardrail", "jailbreak" and "bypass": Model Armor
  matches them as prompt injection at the perimeter and rejects the turn with a
  400 every single time, so a chip using those words would fail on first click.
  "Security controls ... on the AI proxy" asks the same question and is verified
  to return the full control list, so Platform and AI CoE share that exact chip.
*/
const SUGGESTIONS: Record<AdminRole, string[]> = {
  platform: [
    'Which security controls are enforced on the AI proxy?',
    'Double the Customer Support & Sales token quota',
    'Why are calls failing today?',
    'Who spent the most this week?',
  ],
  finance: [
    'Raise the Analysts & Knowledge Workers budget to $15 a month',
    'What does Claude Opus cost per 1M tokens?',
    'Top 5 users by spend this week',
    'Which models cost us the most this month?',
  ],
  ai_coe: [
    'Change the model for general questions from Gemini 3.6 Flash to Gemini 3.8 Flash for Analysts & Knowledge Workers',
    'Double the Customer Support & Sales usage limit',
    'Who hit their token quota this week?',
    'Which MCP tools were denied this week?',
  ],
};

/** The user-view assistant: read-only questions about the caller's own traffic. */
const USER_SUGGESTIONS = [
  'How much have I spent this week?',
  'Why did my last call fail?',
  'Which models did I use today?',
  'Which MCP tools did I call this week?',
];
const USER_INTRO = {
  heading: 'Ask about your own AI usage.',
  body:
    'I can tell you how many calls and tokens you have used, what they cost, which models and MCP tools you called, and why a call was blocked or failed, straight from the gateway\'s analytics and audit log. I only see your own traffic and I cannot change anything.',
};
const USER_PLACEHOLDER = 'Ask about your usage, costs or a failed call…';

/** What each admin persona owns, in its own words (composer caption). */
const ROLE_SCOPE: Record<AdminRole, string> = {
  platform: 'products, quotas, security controls and rate card · dev only',
  finance: 'budgets, prepaid credit, model prices and billing plans only',
  ai_coe: 'models per team, automatic model choice, usage limits and safety only',
};

/** Composer placeholder, per admin persona. */
const PLACEHOLDER: Record<AdminRole, string> = {
  platform: 'Inspect or change a product, quota or policy on dev…',
  finance: 'Ask about budgets, model prices or prepaid credit…',
  ai_coe: 'Ask which team gets which model, routing or limits…',
};

/** Empty-state intro card, per admin persona. */
const INTRO: Record<AdminRole, { heading: string; body: string }> = {
  platform: {
    heading: 'Ask for a change and I\'ll apply it to the dev sandbox.',
    body:
      'I can read the API products, security controls and KVM rate card, edit the (Dev) product clones, and run a real metered call against the dev gateway to verify the policy fires. Every write lands immediately and shows up here with a diff and a Revert button. Blast radius is dev only: production changes go through a pull request against the product definitions in git.',
  },
  finance: {
    heading: 'Ask for a budget or pricing change and I\'ll make it in the Sandbox.',
    body:
      'I can look up monthly budgets, prepaid credit, model prices and billing plans, change them on practice copies of each persona, and run a real test call so you see exactly what one request costs. Every change shows up here with a before and after, and an Undo button. No real spend changes until the change is reviewed and goes Live.',
  },
  ai_coe: {
    heading: 'Ask for a model, routing or limit change and I\'ll make it in the Sandbox.',
    body:
      'I can check which teams get which AI models, how questions are routed between them, each team\'s fair-use limits and the safety controls on every request. I change practice copies of each persona and can run a real test question to prove the policy works before anyone relies on it. Every change shows up here with a before and after, and an Undo button. Nothing reaches Live until it is reviewed.',
  },
};

let entrySeq = 0;
const nextId = () => `e${++entrySeq}`;

/**
 * A perimeter refusal reads as a failure unless we say otherwise, so these are
 * pulled out of the rose error styling and shown as a governed block.
 */
const isModelArmorBlock = (message: string) =>
  /model\s*armor|pimatchesfound/i.test(message);

const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(6)}`;

/**
 * Suggested follow-ups for the turn that just finished, derived from what the
 * assistant actually did (a change, a test, an analytics read). Clicking one
 * sends it as the next message. At most three, most specific first.
 */
export function nextActionsFor(events: AdminAgentEvent[] | undefined, scope: AssistantScope): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  for (const e of events || []) {
    if (e.type === 'change' && e.change.status === 'applied') {
      const kind = e.change.kind || 'product';
      if (kind === 'product') add('Run a test prompt on dev to prove it');
      if (kind === 'rate_card') add('What would a typical call cost at the new price?');
      if (kind === 'wallet') add(`Show ${e.change.productName.replace(/^Wallet · /, '')}'s wallet balance`);
      if (kind === 'mcp_product') add('Test that tool on dev to prove it');
    }
    if (e.type === 'test') {
      add(e.result.guardrailBlocked ? 'Why was that test blocked?' : 'Show my failed calls today');
    }
    if (e.type === 'insight') {
      if (e.kind === 'usage') {
        add(scope === 'user' ? 'Show my failed calls this week' : 'Break that down by model');
        if (scope === 'admin') add('Why are calls failing this week?');
      }
      if (e.kind === 'logs' && (e.data?.counts?.blocked || e.data?.counts?.error)) add('Explain why those calls failed and how to fix it');
      if (e.kind === 'failure' && e.data?.found) {
        const owner = e.data?.reasons?.[0]?.owner;
        if (scope === 'admin' && owner === 'AI CoE') add('Which tier and model is hitting the limit?');
        add(scope === 'user' ? 'How much have I spent this week?' : 'Who is affected most?');
      }
      if (e.kind === 'tools') add(scope === 'user' ? 'Did any of my tool calls fail?' : 'Which MCP tools were denied, and for whom?');
    }
  }
  return out.slice(0, 3);
}

/** Footer note on a change card: where the change landed and how it reaches prod. */
const CHANGE_NOTE: Record<string, { technical: string; finance: string; ai_coe: string }> = {
  product: { technical: 'Prod changes go through a PR', finance: 'Real spend changes after review', ai_coe: 'Teams see it after review' },
  rate_card: { technical: 'Dev rate card only · prod via PR', finance: 'Practice prices only, until reviewed', ai_coe: 'Dev prices only' },
  wallet: { technical: 'Real org credit · Revert debits it back', finance: 'Real credit · Undo takes it back', ai_coe: 'Real credit · Undo takes it back' },
  mcp_product: { technical: 'Dev MCP tool set only · prod via PR', finance: 'Practice tool access only', ai_coe: 'Dev tool access · teams see it after review' },
};

/** A small bordered chip. The default palette is deliberately quiet. */
const Chip: React.FC<{ label: string; value: string; tone?: string }> = ({
  label,
  value,
  tone = 'border-slate-200 bg-slate-50 text-slate-700',
}) => (
  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${tone}`}>
    <span className="text-slate-500 font-medium">{label}</span> {value}
  </span>
);

const ToolChip: React.FC<{ name: string; summary: string; ok: boolean }> = ({
  name,
  summary,
  ok,
}) => (
  <div
    data-agent-tool
    className="flex items-center gap-1.5 text-[11px] text-slate-600 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50/80"
  >
    <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
    <span className="font-mono font-semibold text-slate-800 shrink-0">{name}</span>
    <span className="truncate">{summary}</span>
    {ok ? (
      <Check className="w-3 h-3 text-emerald-600 shrink-0 ml-auto" />
    ) : (
      <X className="w-3 h-3 text-rose-600 shrink-0 ml-auto" />
    )}
  </div>
);

const STATUS_TONE: Record<Change['status'], string> = {
  applied: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  reverted: 'border-slate-200 bg-slate-100 text-slate-600',
};

/** Change-card status pill, per admin persona. */
const STATUS_LABEL: Record<Change['status'], { technical: string; finance: string; ai_coe: string }> = {
  applied: { technical: 'Applied to dev sandbox', finance: 'Done in Sandbox', ai_coe: 'Trialling in Sandbox' },
  reverted: { technical: 'Reverted', finance: 'Undone', ai_coe: 'Undone' },
};

const ChangeCard: React.FC<{
  change: Change;
  onRevert: (id: string) => Promise<void>;
}> = ({ change, onRevert }) => {
  const [busy, setBusy] = useState<'revert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sp } = usePersonaVoice('admin');

  const run = async (kind: 'revert', fn: (id: string) => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn(change.changeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-agent-change
      className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden"
    >
      <div className="px-2.5 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
              STATUS_TONE[change.status]
            }`}
          >
            {sp(STATUS_LABEL[change.status])}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
            {change.env}
          </span>
          <span className="text-[10px] font-mono text-slate-400 ml-auto">
            {change.changeId}
          </span>
        </div>
        <p className="text-[11px] text-slate-700 leading-snug mt-1.5 font-semibold">
          {change.summary}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          <span className="font-mono text-slate-600">{change.productName}</span>
          {change.sourceProduct ? (
            <> · {sp({ technical: 'clone of', finance: 'copy of', ai_coe: 'copy of' })} <span className="font-mono text-slate-600">{change.sourceProduct}</span></>
          ) : null}
        </p>
      </div>

      {change.diff?.length ? (
        <div className="px-2.5 py-2 bg-slate-50/60 border-b border-slate-100 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="font-semibold pb-1 pr-2">
                  {sp({ technical: 'Setting', finance: 'What changed', ai_coe: 'What changed' })}
                </th>
                <th className="font-semibold pb-1 pr-2">Before</th>
                <th className="font-semibold pb-1">After</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {change.diff.map((row) => (
                <tr key={row.path} className="border-t border-slate-200/70">
                  {/* Plain label by default; the exact config path is still one
                      hover away rather than being dropped on the reader. */}
                  <td
                    className="py-1 pr-2 font-semibold text-slate-800"
                    title={row.path}
                  >
                    {row.label || row.path}
                  </td>
                  <td className="py-1 pr-2 font-mono text-slate-400 line-through">
                    {row.before ?? '—'}
                  </td>
                  <td className="py-1 font-mono font-semibold text-emerald-700">
                    {row.after ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error && (
        <div className="px-2.5 py-1.5 bg-rose-50 border-b border-rose-100 text-[10px] text-rose-700 font-medium">
          {error}
        </div>
      )}

      <div className="px-2.5 py-1.5 flex items-center gap-1.5">
        <button
          type="button"
          data-agent-revert
          disabled={busy !== null || change.status === 'reverted'}
          onClick={() => run('revert', onRevert)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'revert' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Undo2 className="w-3 h-3" />
          )}
          {sp({ technical: 'Revert', finance: 'Undo', ai_coe: 'Undo' })}
        </button>
        {/* No promote control by design: the agent's writes stop at dev, and
            production is changed by raising a PR against the product
            definitions in git. Saying so here is more useful than a button
            that would bypass review. */}
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <GitPullRequest className="w-3 h-3 text-slate-400" />
          {sp(CHANGE_NOTE[change.kind || 'product'] || CHANGE_NOTE.product)}
        </span>
        <span className="ml-auto text-[10px] text-slate-400">
          {change.appliedAt ? new Date(change.appliedAt).toLocaleTimeString() : ''}
        </span>
      </div>
      {change.skillCitations?.length ? (
        <div className="px-2.5 pb-2 text-[10px] text-slate-500" data-change-citations>
          <span className="font-semibold text-slate-600">Guided by the playbook: </span>
          {change.skillCitations.map((c) => c.split('#')[1] || c).join(' · ')}
          <span className="text-slate-400"> ({change.skillCitations[0].split('/')[0]})</span>
        </div>
      ) : null}
    </div>
  );
};

/** MCP tool access proof: what Apigee did vs what the dev tool set says. */
const ToolTestCard: React.FC<{ result: ToolTestResult }> = ({ result }) => {
  const proven = result.matches === true;
  const tone = proven
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : result.matches === false
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <div data-agent-tool-test className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
      <div className="px-2.5 py-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dev tool test</span>
        <Chip label="Tool" value={result.tool} />
        <Chip label="Apigee" value={`${result.outcome} · HTTP ${result.httpStatus}`} tone={tone} />
        <Chip label="Expected" value={result.expected} />
        <span className={`ml-auto text-[10px] font-semibold ${proven ? 'text-emerald-700' : 'text-slate-500'}`}>
          {proven ? 'Proven' : result.matches === false ? 'Not picked up yet' : 'Inconclusive'}
        </span>
      </div>
      <div className="px-2.5 pb-2 text-[10px] text-slate-500 truncate" title={result.product}>
        As {result.product}
      </div>
    </div>
  );
};

const TestCard: React.FC<{ result: TestResult }> = ({ result }) => {
  const { sp } = usePersonaVoice('admin');
  const blocked = result.guardrailBlocked;
  const tone = blocked
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : result.ok
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-rose-200 bg-rose-50 text-rose-700';

  return (
    <div
      data-agent-test
      className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden"
    >
      <div className="px-2.5 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5 mb-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] font-bold text-slate-900">{sp({ technical: 'Dev gateway test', finance: 'Test call and its cost', ai_coe: 'Sandbox test question' })}</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${tone}`}>
            {blocked
              ? sp({ technical: `Blocked by policy (${result.httpStatus})`, finance: 'Blocked, not billed', ai_coe: 'Stopped by safety checks' })
              : sp({
                  technical: `HTTP ${result.httpStatus}`,
                  finance: result.ok ? 'Worked' : `Failed (${result.httpStatus})`,
                  ai_coe: result.ok ? 'Answered' : `Failed (${result.httpStatus})`,
                })}
          </span>
          <Chip label={sp({ technical: 'model', finance: 'model', ai_coe: 'model' })} value={result.model || '—'} />
          <Chip label="tokens" value={String(result.totalTokens ?? 0)} />
          <Chip label={sp({ technical: 'cost', finance: 'this call', ai_coe: 'cost' })} value={money(result.costUsd)} />
          <Chip label={sp({ technical: 'cache', finance: 'reused', ai_coe: 'reused' })} value={result.cacheStatus || '—'} />
          <Chip label={sp({ technical: 'latency', finance: 'time', ai_coe: 'answer time' })} value={`${Math.round(result.latencyMs ?? 0)}ms`} />
        </div>
      </div>
      <p className="px-2.5 py-2 text-[11px] text-slate-700 leading-snug whitespace-pre-wrap">
        {result.text}
      </p>
    </div>
  );
};

interface AdminAgentPanelProps {
  /** Docked beside the Admin Console, or floating as the user-view drawer; the caller owns that decision. */
  className?: string;
  /** Acting admin persona: scopes suggestions and which changes the agent may make. */
  adminRole?: AdminRole;
  /**
   * `admin` (default): the Admin Console assistant, with config tools and
   * fleet-wide analytics. `user`: read-only, the caller's own traffic only.
   */
  scope?: AssistantScope;
  /** When set, the header button closes the panel (drawer) instead of collapsing it. */
  onClose?: () => void;
}

export const ASSISTANT_NAME = 'Ask Apigee';

export const AdminAgentPanel: React.FC<AdminAgentPanelProps> = ({
  className = '',
  adminRole = 'platform',
  scope = 'admin',
  onClose,
}) => {
  const { sp } = usePersonaVoice('admin');
  const isUser = scope === 'user';
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /*
    The model that actually served the last turn. The backend can fall back off
    the configured model if the Engineering & IT entitlement fails, so the header chip
    reports what ran rather than what we asked for.
  */
  const [servedModel, setServedModel] = useState<string | null>(null);

  const [sandbox, setSandbox] = useState<SandboxState | null>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  /*
    Starts busy: the first read is kicked off on mount, and defaulting to idle made
    the first paint claim "not provisioned" for a frame before the request answered.
  */
  const [sandboxBusy, setSandboxBusy] = useState(true);
  const [sandboxChecked, setSandboxChecked] = useState(false);

  // Starter prompts use the active industry's team names ("Credit & Risk Analysts").
  const { theme: customerTheme } = useCustomerTheme();
  const industry = customerTheme.industry;
  /* Change history (server-side ChangeStore, newest first). */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Change[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchChanges();
      setHistory(res.changes || []);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const push = useCallback((...items: Entry[]) => {
    setEntries((prev) => [...prev, ...items]);
  }, []);

  /* ---------------------------------------------------------------- sandbox */

  const loadSandbox = useCallback(async () => {
    setSandboxBusy(true);
    try {
      const state = await fetchSandbox();
      setSandbox(state);
      setSandboxError(null);
    } catch (err) {
      setSandbox(null);
      setSandboxError(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxChecked(true);
      setSandboxBusy(false);
    }

  }, []);

  useEffect(() => {
    // The user-view assistant never writes, so it has no sandbox to check.
    if (isUser) return;
    void loadSandbox();
  }, [loadSandbox, isUser]);

  const handleProvision = async () => {
    setSandboxBusy(true);
    try {
      const state = await provisionSandbox();
      setSandbox(state);
      setSandboxError(null);
      push({
        kind: 'assistant',
        id: nextId(),
        text: sp({
          technical:
            'Dev sandbox ready. Product clones and the agent app are provisioned; every write I make lands on the (Dev) products only, so prod traffic is untouched.',
          finance:
            'Sandbox ready. I have made practice copies of each persona, so you can try budget and price changes without touching real spend until they are reviewed.',
          ai_coe:
            'Sandbox ready. I have made practice copies of each persona, so you can trial model, routing and limit changes before any team is affected.',
        }),
      });
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  /* ------------------------------------------------------------------ chat */

  /** `prompt` is threaded through so a blocked turn can be put back in the composer. */
  const applyEvents = (events: AdminAgentEvent[] | undefined, prompt: string) => {

    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (event.type === 'tool_call') {
        push({
          kind: 'tool',
          id: nextId(),
          name: event.name,
          summary: event.summary,
          ok: event.ok,
        });
      } else if (event.type === 'change') {
        push({ kind: 'change', id: nextId(), change: event.change });
      } else if (event.type === 'test') {
        push({ kind: 'test', id: nextId(), result: event.result });
      } else if (event.type === 'tool_test') {
        push({ kind: 'tool_test', id: nextId(), result: event.result });
      } else if (event.type === 'insight') {
        push({ kind: 'insight', id: nextId(), event });
      } else if (event.type === 'error') {
        push({
          kind: 'error',
          id: nextId(),
          text: event.message,
          tone: isModelArmorBlock(event.message) ? 'blocked' : 'failed',
          retry: prompt,
        });
      }

    }
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;

    // The bubble keeps the industry wording; the agent gets the demo persona
    // names, which are what the API products are actually called.
    const toAgent = (t: string) => canonicalPersonaNames(t, industry);
    const history: ChatTurn[] = entries
      .filter((e): e is Extract<Entry, { kind: 'user' | 'assistant' }> =>
        e.kind === 'user' || e.kind === 'assistant'
      )
      .map((e) => ({ role: e.kind === 'user' ? 'user' : 'assistant', content: e.kind === 'user' ? toAgent(e.text) : e.text }));

    push({ kind: 'user', id: nextId(), text: prompt });
    setInput('');
    setBusy(true);

    try {
      const res = await sendChat([...history, { role: 'user', content: toAgent(prompt) }], adminRole, scope);
      if (res.usage?.model) setServedModel(res.usage.model);
      applyEvents(res.events, prompt);
      if (res.reply) {
        push({ kind: 'assistant', id: nextId(), text: res.reply, usage: res.usage, next: nextActionsFor(res.events, scope) });
      }
      if (!isUser && res.events?.some((e) => e.type === 'change')) void loadHistory();
    } catch (err) {
      // The panel must never go blank on a bad response: the failure becomes a
      // first-class, retryable card in the transcript. A perimeter block can also
      // surface here as a 4xx, so it is classified the same way as an error event.
      const message = err instanceof Error ? err.message : String(err);
      const blocked = isModelArmorBlock(message);
      push({
        kind: 'error',
        id: nextId(),
        text: message,
        tone: blocked ? 'blocked' : 'failed',
        retry: prompt,
      });

    } finally {
      setBusy(false);
    }
  };

  const mutateChange = (updated: Change) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.kind === 'change' && e.change.changeId === updated.changeId
          ? { ...e, change: updated }
          : e
      )
    );
  };

  const handleRevert = async (changeId: string) => {
    const res = await revertChange(changeId, adminRole);
    mutateChange(res.change);
    setHistory((prev) => prev.map((c) => (c.changeId === res.change.changeId ? res.change : c)));
  };


  /* ---------------------------------------------------------------- resize */

  /*
    The listeners are bound synchronously inside the mousedown rather than from an
    effect: an effect only runs after React commits, which is late enough that a
    quick drag loses its first few mousemoves.
  */
  const endDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => endDragRef.current?.(), []);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      const next = startWidth + (startX - ev.clientX);
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.removeProperty('user-select');
      endDragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    endDragRef.current = onUp;
    document.body.style.setProperty('user-select', 'none');
  };

  const nudge = (delta: number) =>
    setWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + delta)));

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, busy]);

  /* ------------------------------------------------------------- collapsed */

  if (collapsed && !onClose) {
    return (
      <aside
        data-agent-panel
        data-agent-collapsed="true"
        className={`h-full w-11 shrink-0 border-l border-slate-200 bg-white flex flex-col items-center py-2.5 gap-2 ${className}`}
      >
        <button
          type="button"
          data-agent-toggle
          onClick={() => setCollapsed(false)}
          title={sp({ technical: `Expand ${ASSISTANT_NAME}`, finance: 'Open the assistant', ai_coe: 'Open the assistant' })}
          className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <div
          className="text-[10px] font-semibold text-slate-500 tracking-wide"
          style={{ writingMode: 'vertical-rl' }}
        >
          {ASSISTANT_NAME}
        </div>
        {entries.length > 0 && (
          <span className="mt-auto text-[10px] font-semibold text-slate-400">
            {entries.length}
          </span>
        )}
      </aside>
    );
  }

  /* -------------------------------------------------------------- expanded */

  /*
    Four states, not two: the slow first read deserves its own, and an unreachable
    endpoint is different from a sandbox that simply has not been created.
  */
  const lastAssistantId = [...entries].reverse().find((e) => e.kind === 'assistant')?.id;

  const sandboxState: 'checking' | 'error' | 'ready' | 'unprovisioned' = !sandboxChecked
    ? 'checking'
    : sandboxError
      ? 'error'
      : sandbox?.provisioned
        ? 'ready'
        : 'unprovisioned';

  return (
    <aside
      data-agent-panel
      data-agent-collapsed="false"
      data-agent-width={width}
      style={{ width }}
      className={`relative h-full shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0 ${className}`}
    >
      {/* Drag handle. Arrow keys work too, so the width is reachable without a mouse. */}
      <div
        data-agent-resize
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') nudge(20);
          if (e.key === 'ArrowRight') nudge(-20);
        }}
        title={sp({ technical: 'Drag or use arrow keys to resize', finance: 'Drag to resize', ai_coe: 'Drag to resize' })}
        className="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize group z-10 flex items-center justify-center hover:bg-blue-100/70 focus:bg-blue-100 focus:outline-none"
      >
        <GripVertical className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition" />
      </div>

      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-xs font-bold text-slate-900" data-agent-title>{ASSISTANT_NAME}</div>
            <div className="text-[10px] text-slate-500">
              {isUser
                ? 'Your usage, costs and failed calls · read-only'
                : sp({
                    technical: 'Writes auto-apply to the dev sandbox',
                    finance: 'Try budget changes safely first',
                    ai_coe: 'Trial model changes safely first',
                  })}
            </div>
          </div>
          {!isUser && (
            <button
              type="button"
              data-agent-history-toggle
              onClick={() => {
                setHistoryOpen((o) => !o);
                void loadHistory();
              }}
              aria-pressed={historyOpen}
              title="Change history: every change Ask Apigee made, with undo"
              className={`ml-auto flex items-center gap-1 px-1.5 py-1 rounded-lg border text-[10px] font-semibold transition cursor-pointer ${
                historyOpen ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              {history.length > 0 && <span className="tabular-nums">{history.length}</span>}
            </button>
          )}
          <button
            type="button"
            data-agent-toggle
            onClick={() => (onClose ? onClose() : setCollapsed(true))}
            title={onClose ? `Close ${ASSISTANT_NAME}` : sp({ technical: `Collapse ${ASSISTANT_NAME}`, finance: 'Hide the assistant', ai_coe: 'Hide the assistant' })}
            aria-label={onClose ? `Close ${ASSISTANT_NAME}` : `Collapse ${ASSISTANT_NAME}`}
            className={`${isUser ? 'ml-auto ' : ''}p-1 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 transition cursor-pointer`}
          >
            {onClose ? <X className="w-3.5 h-3.5" /> : <PanelRight className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span
            data-agent-model
            className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-mono font-semibold text-slate-600"
          >
            {servedModel ?? AGENT_MODEL} · via AI Gateway
          </span>
          {servedModel && servedModel !== AGENT_MODEL && (
            <span
              className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800"
              title={sp({
                technical: `Configured for ${AGENT_MODEL}; the last turn was served by ${servedModel}.`,
                finance: `Answered by ${servedModel} instead of ${AGENT_MODEL}; the cost is still tracked.`,
                ai_coe: `Answered by ${servedModel} because ${AGENT_MODEL} was unavailable.`,
              })}
            >
              fallback
            </span>
          )}
        </div>

        {/*
          Dev sandbox status. The initial read is slow (four Apigee product reads
          plus the app), so "checking" is a real state with its own spinner rather
          than a gap that briefly renders as "not provisioned".
        */}
        {!isUser && (
        <div
          className="mt-2 flex items-center gap-1.5 flex-wrap"
          data-agent-sandbox
          data-agent-sandbox-state={sandboxState}
        >
          {sandboxState === 'checking' ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              {sp({ technical: 'Checking dev sandbox…', finance: 'Checking Sandbox…', ai_coe: 'Checking Sandbox…' })}
            </span>
          ) : sandboxState === 'error' ? (
            <>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700">
                <AlertCircle className="w-3 h-3" />
                {sp({ technical: 'Sandbox read failed', finance: 'Sandbox unavailable', ai_coe: 'Sandbox unavailable' })}
              </span>
              <button
                type="button"
                data-agent-sandbox-retry
                onClick={() => void loadSandbox()}
                disabled={sandboxBusy}
                className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:border-slate-300 transition cursor-pointer disabled:opacity-50"
              >
                Retry
              </button>
              <span className="w-full text-[10px] text-rose-600/90 leading-snug">
                {sandboxError}
              </span>
            </>
          ) : sandboxState === 'ready' ? (
            <>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-700">
                <ShieldCheck className="w-3 h-3" />
                {sp({ technical: 'Dev sandbox ready', finance: 'Sandbox ready', ai_coe: 'Sandbox ready' })}
              </span>
              {sandbox?.products?.length ? (
                <span className="text-[10px] text-slate-500">
                  {sandbox.products.filter((p) => p.exists).length}{' '}
                  {sp({ technical: 'dev product', finance: 'practice persona', ai_coe: 'practice team' })}
                  {sandbox.products.filter((p) => p.exists).length === 1 ? '' : 's'}
                  {sandbox.keyPresent ? sp({ technical: ' · key held server-side', finance: '', ai_coe: '' }) : ''}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800">
                {sp({ technical: 'Dev sandbox not provisioned', finance: 'Sandbox not set up yet', ai_coe: 'Sandbox not set up yet' })}
              </span>
              <button
                type="button"
                data-agent-provision
                onClick={() => void handleProvision()}
                disabled={sandboxBusy}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-600 bg-blue-600 text-[10px] font-semibold text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-50"
              >
                {sandboxBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                {sp({ technical: 'Provision dev sandbox', finance: 'Set up Sandbox', ai_coe: 'Set up Sandbox' })}
              </button>
            </>
          )}
        </div>
        )}

      </div>

      {/* Transcript */}
      <div
        data-agent-messages
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2 bg-slate-50/50"
      >
        {historyOpen && !isUser && (
          <div data-agent-history className="rounded-xl border border-blue-200 bg-white shadow-2xs overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-blue-100 bg-blue-50/60 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[11px] font-bold text-slate-900">Change history</span>
              <span className="text-[10px] text-slate-500">· the input for the future PR</span>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close change history"
                className="ml-auto p-0.5 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {historyError ? (
              <p className="px-2.5 py-2 text-[10px] text-rose-700">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="px-2.5 py-2 text-[10px] text-slate-500">No changes yet. Anything Ask Apigee changes will be listed here with an undo.</p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {history.map((c) => (
                  <li key={c.changeId} className="px-2.5 py-1.5 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1 rounded border text-[9px] font-semibold ${STATUS_TONE[c.status]}`}>{c.status}</span>
                        <span className="px-1 rounded border border-slate-200 bg-slate-50 text-[9px] font-semibold text-slate-600">{c.env}</span>
                        <span className="text-[9px] text-slate-400 ml-auto shrink-0">{c.appliedAt ? new Date(c.appliedAt).toLocaleTimeString() : ''}</span>
                      </div>
                      <p className="text-[10px] text-slate-700 leading-snug mt-0.5">{c.summary}</p>
                    </div>
                    <button
                      type="button"
                      disabled={c.status === 'reverted'}
                      onClick={() => void handleRevert(c.changeId).catch((err) => setHistoryError(err instanceof Error ? err.message : String(err)))}
                      title="Undo this change"
                      className="shrink-0 p-1 rounded border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Undo2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-[11px] text-slate-600 leading-snug">
            <p className="font-semibold text-slate-800 mb-1">{(isUser ? USER_INTRO : INTRO[adminRole] ?? INTRO.platform).heading}</p>
            <p>{(isUser ? USER_INTRO : INTRO[adminRole] ?? INTRO.platform).body}</p>
          </div>
        )}

        {entries.map((entry) => {
          if (entry.kind === 'user') {
            return (
              <div key={entry.id} className="flex justify-end">
                <div className="max-w-[88%] rounded-xl bg-blue-600 text-white px-2.5 py-1.5 text-[11px] leading-snug whitespace-pre-wrap">
                  {entry.text}
                </div>
              </div>
            );
          }
          if (entry.kind === 'assistant') {
            return (
              <div
                key={entry.id}
                className="rounded-xl border border-slate-200 bg-white shadow-2xs px-2.5 py-2"
              >
                {/* Deliberately no per-turn usage chips. This panel showcases how
                    easy a governance change is; the agent's own token/cost
                    telemetry is noise here. It is still metered and visible on
                    the Analytics & Cost tab like any other caller, and the
                    header chip still names the model that served the turn. */}
                <div className="text-[11px] text-slate-700 leading-snug">
                  <MarkdownMessage text={entry.text} compact />
                </div>
                {entry.next && entry.next.length > 0 && entry.id === lastAssistantId && !busy && (
                  <div data-agent-next className="mt-1.5 pt-1.5 border-t border-slate-100 flex flex-wrap gap-1">
                    {entry.next.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => void send(n)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-blue-200 bg-blue-50/60 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                      >
                        <ArrowRight className="w-2.5 h-2.5" />
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (entry.kind === 'tool') {
            return (
              <ToolChip
                key={entry.id}
                name={entry.name}
                summary={entry.summary}
                ok={entry.ok}
              />
            );
          }
          if (entry.kind === 'change') {
            return (
              <ChangeCard
                key={entry.id}
                change={entry.change}
                onRevert={handleRevert}
              />
            );
          }
          if (entry.kind === 'test') {
            return <TestCard key={entry.id} result={entry.result} />;
          }
          if (entry.kind === 'tool_test') {
            return <ToolTestCard key={entry.id} result={entry.result} />;
          }
          if (entry.kind === 'insight') {
            return <AskApigeeInsightCard key={entry.id} event={entry.event} />;
          }
          const isBlock = entry.tone === 'blocked';
          return (
            <div
              key={entry.id}
              data-agent-error
              data-agent-error-tone={entry.tone}
              className={`rounded-xl border px-2.5 py-2 ${
                isBlock ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {isBlock ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                )}
                <span
                  className={`text-[11px] font-bold ${
                    isBlock ? 'text-amber-900' : 'text-rose-800'
                  }`}
                >
                  {isBlock
                    ? sp({
                        technical: 'Blocked by Model Armor (400)',
                        finance: 'Blocked by safety screening',
                        ai_coe: 'Stopped by safety screening',
                      })
                    : sp({
                        technical: 'Agent request failed',
                        finance: 'The assistant could not finish',
                        ai_coe: 'The assistant could not finish',
                      })}
                </span>
                {isBlock && (
                  <span className="px-1.5 py-0.5 rounded border border-amber-300 bg-white text-[10px] font-semibold text-amber-800">
                    {sp({ technical: 'governed', finance: 'not billed', ai_coe: 'working as designed' })}
                  </span>
                )}
              </div>
              {/*
                The backend's message carries a suggested rephrasing, so it is shown
                verbatim - no truncation, no clamping.
              */}
              <p
                className={`text-[10px] leading-snug mt-1 break-words whitespace-pre-wrap ${
                  isBlock ? 'text-amber-900/90' : 'text-rose-700'
                }`}
              >
                {entry.text}
              </p>
              {isBlock ? (
                entry.retry && (
                  <button
                    type="button"
                    data-agent-rephrase
                    onClick={() => {
                      setInput(entry.retry as string);
                      inputRef.current?.focus();
                    }}
                    className="mt-1.5 px-2 py-0.5 rounded border border-amber-300 bg-white text-[10px] font-semibold text-amber-800 hover:border-amber-400 transition cursor-pointer"
                  >
                    {sp({ technical: 'Edit prompt', finance: 'Rephrase', ai_coe: 'Rephrase' })}
                  </button>
                )
              ) : (
                entry.retry && (
                  <button
                    type="button"
                    data-agent-retry
                    disabled={busy}
                    onClick={() => void send(entry.retry as string)}
                    className="mt-1.5 px-2 py-0.5 rounded border border-rose-300 bg-white text-[10px] font-semibold text-rose-700 hover:border-rose-400 transition cursor-pointer disabled:opacity-50"
                  >
                    Retry
                  </button>
                )
              )}
            </div>
          );

        })}

        {busy && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {sp({ technical: 'Calling tools…', finance: 'Working…', ai_coe: 'Working…' })}
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Composer */}
      {/*
        `pb-14` clears the app's fixed bottom-right "Guide me" / settings pill, which
        floats over exactly this corner of the viewport.
      */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-3 pt-2.5 pb-14">
        <div className="text-[10px] text-slate-500 mb-1">
          {isUser ? (
            <>Read-only · <b className="text-slate-700">your own traffic only</b></>
          ) : (
            <>
              {sp({ technical: 'Acting as', finance: 'You are', ai_coe: 'You are' })}{' '}
              <b className="text-slate-700">{adminRoleById(adminRole).label}</b>
              {' · '}
              {ROLE_SCOPE[adminRole] || `${adminRoleById(adminRole).summary.toLowerCase()} only`}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-1.5">
          {(isUser ? USER_SUGGESTIONS : SUGGESTIONS[adminRole]).map((raw) => rewordPersonaNames(raw, industry)).map((s) => (
            <button
              key={s}
              type="button"
              data-agent-suggestion
              onClick={() => {
                setInput(s);
                inputRef.current?.focus();
              }}
              className="px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700 transition cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 focus-within:border-blue-300 transition">
          <textarea
            ref={inputRef}
            data-agent-input
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={isUser ? USER_PLACEHOLDER : PLACEHOLDER[adminRole] ?? PLACEHOLDER.platform}
            className="flex-1 bg-transparent text-[11px] text-slate-800 resize-none focus:outline-none placeholder:text-slate-400 leading-snug"
          />
          <button
            type="button"
            data-agent-send
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title={sp({ technical: 'Send (Enter)', finance: 'Send', ai_coe: 'Send' })}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
