import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, GatewaySettings, GatewayTelemetry, ScenarioPreset, PromptTransactionRecord, KeyTier, UserPersona } from '../types';
import { sendPromptToApigee, getGatewayTargetUrl, PromptRequestOptions } from '../services/apigeeClient';
import { TourActionId } from '../services/tourSteps';
import { GatewayTraceViewer } from './GatewayTraceViewer';
import { SCENARIO_PRESETS, USERS, getUserInfo, DEFAULT_SSO_USER, AUTO_ROUTING_EXAMPLES, CACHE_EXAMPLES, CACHE_DEMO_MODEL, TOKEN_LIMIT_EXAMPLES, TOKEN_DEMO_MAX_OUTPUT_TOKENS, UNAUTHORIZED_401_EXAMPLES, MODEL_ARMOR_EXAMPLES } from '../services/defaultSettings';
import type { BusinessCopy } from '../services/defaultSettings';
import { Send, Bot, User, ShieldAlert, Activity, Sparkles, Shield, Database, Globe, RotateCcw, Zap, Workflow, AlertTriangle, Info, ChevronDown } from 'lucide-react';
import { ApigeeColorSymbol } from './ApigeeLogo';
import { isTokenQuotaAlert } from '../utils/tokenQuota';
import { planTokenSteps, planCacheSteps } from '../utils/scenarioPrereqs';
import { stepMenuPosition, nextStepIndex, STEP_MENU_HOVER_DELAY_MS, STEP_MENU_CLOSE_DELAY_MS } from '../utils/scenarioStepMenu';
import { personaById, personaForModel } from '../utils/personas';
import { usePersonaVoice } from '../utils/voice';
import type { Lines } from '../utils/voice';
import { MarkdownMessage } from './MarkdownMessage';
import { useCustomerTheme } from './CustomerThemeProvider';
import { personaDisplay, themedPrompt } from '../utils/customerTheme';

/**
 * Scenario presets whose prompt is the first step of an example list, so the
 * customer theme's industry prompt (keyed by example id) applies to them too.
 */
const PRESET_EXAMPLE_ID: Record<string, string> = {
  'unauthorized-toggle': 'auth-missing',
  'auto-routing': 'auto-general',
  'model-armor-toggle': 'armor-destructive',
  'token-limit-toggle': 'token-pass',
  'cache-toggle': 'cache-seed',
  'no-cache': 'cache-seed',
};

const KEY_TIER_FOR_PERSONA: Record<UserPersona, KeyTier> = { admin: 'admin', sales_agent: 'sales', loans_agent: 'loans' };

interface ChatPlaygroundProps {
  settings: GatewaySettings;
  setSettings: React.Dispatch<React.SetStateAction<GatewaySettings>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeTelemetry: GatewayTelemetry | null;
  setActiveTelemetry: React.Dispatch<React.SetStateAction<GatewayTelemetry | null>>;
  onTransactionRecorded?: (tx: PromptTransactionRecord) => void;
  onResetChat?: () => void;
  onOpenRequestFlow?: (telemetry: GatewayTelemetry) => void;
  /**
   * A scenario the guided tour wants run. The tour narrates live responses rather than
   * screenshots, so it reuses the exact handlers behind the demo chips - there is no
   * second, tour-only code path that could drift from what the chips actually do.
   */
  tourAction?: TourActionId | null;
  onTourActionHandled?: () => void;
}

export const ChatPlayground: React.FC<ChatPlaygroundProps> = ({
  settings,
  setSettings,
  messages,
  setMessages,
  activeTelemetry,
  setActiveTelemetry,
  onTransactionRecorded,
  onResetChat,
  onOpenRequestFlow,
  tourAction,
  onTourActionHandled,
}) => {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'trace'>('chat');
  const [hasUnreadTrace, setHasUnreadTrace] = useState(false);
  const [cacheStep, setCacheStep] = useState<0 | 1>(0);
  const [autoStep, setAutoStep] = useState<0 | 1 | 2>(0);
  const [tokenStep, setTokenStep] = useState<0 | 1 | 2 | 3>(0);
  const [authStep, setAuthStep] = useState<0 | 1>(0);
  const [armorStep, setArmorStep] = useState<0 | 1 | 2>(0);
  const [activeSendingUrl, setActiveSendingUrl] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Copy follows the consumer persona picked top-right, one voice each:
  //   technical (eng)  Engineering & IT: builder integrating with the gateway
  //   analysts         Analysts & Knowledge Workers: research and analysis
  //   support          Customer Support & Sales: customer replies
  const { sp } = usePersonaVoice('persona');
  // Customer theme: the industry prompt for each predefined scenario (see INDUSTRIES).
  const { theme: customerTheme } = useCustomerTheme();
  const industryPrompt = (exampleId: string, fallback: string) =>
    themedPrompt(exampleId, customerTheme.industry, fallback);
  const personaLabel = (id: UserPersona) => personaDisplay(personaById(id), customerTheme.industry).label;
  /** Per-speaker preset copy, falling back to the older two-voice fields. */
  const presetLine = (
    preset: ScenarioPreset & BusinessCopy,
    field: 'title' | 'description' | 'badge',
  ): string => {
    const own = preset.lines?.[field];
    if (own) return sp(own);
    const fallback: Lines<string> =
      field === 'title'
        ? { technical: preset.title, business: preset.businessTitle }
        : field === 'description'
        ? { technical: preset.description, business: preset.businessDescription }
        : { technical: preset.badgeText, business: preset.businessBadgeText };
    return sp(fallback);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleReset = () => {
    setInputText('');
    if (onResetChat) {
      onResetChat();
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleExecute = async (textToSubmit: string, overrideSettings?: GatewaySettings, requestOptions?: PromptRequestOptions) => {
    if (!textToSubmit.trim() || loading) return null;

    const userText = textToSubmit.trim();
    setInputText('');

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    const settingsToUse = overrideSettings || settings;
    const targetUrl = getGatewayTargetUrl(settingsToUse, settingsToUse.model);
    setActiveSendingUrl(targetUrl);

    try {
      const response = await sendPromptToApigee(
        userText,
        settingsToUse,
        messages,
        requestOptions
      );

      /*
        One object, two references - deliberately.

        The inspector works out which call it is showing by comparing `activeTelemetry`
        against each message's `telemetry` by identity, because two calls in a demo
        routinely have byte-identical field values (replaying a prompt to show a cache
        hit is exactly that). Cloning this into two equal-but-separate objects silently
        breaks that: the inspector can never match a message, so the comparison band and
        the historical-call banner never appear.
      */
      const callTelemetry: GatewayTelemetry = {
        ...response.telemetry,
        userEmail: settingsToUse.userEmail || DEFAULT_SSO_USER.email,
      };

      const agentMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'agent',
        text: response.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: response.telemetry.model,
        isError: !response.success,
        targetUrl: response.telemetry.targetUrl || targetUrl,
        telemetry: callTelemetry,
      };

      setMessages((prev) => [...prev, agentMessage]);
      setActiveTelemetry(callTelemetry);

      if (onTransactionRecorded) {
        onTransactionRecorded({
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          userEmail: settingsToUse.userEmail || DEFAULT_SSO_USER.email,
          // PromptTransactionRecord requires strings. An unattributed cache hit
          // gets its own bucket rather than being credited to a model that may
          // not have produced the cached bytes.
          model: response.telemetry.model || 'served-from-cache',
          provider: response.telemetry.provider
            || (response.telemetry.model
              ? (response.telemetry.model.startsWith('claude') ? 'anthropic' : 'google')
              : 'cache'),
          promptTokens: response.telemetry.promptTokens || 0,
          candidatesTokens: response.telemetry.candidatesTokens || 0,
          totalTokens: response.telemetry.totalTokens || 0,
          costUsd: parseFloat(response.telemetry.costUsd || '0'),
          latencyMs: response.telemetry.latencyMs,
          cacheStatus: response.telemetry.cacheStatus,
          status: response.telemetry.status,
          autoRouted: response.telemetry.autoRouted,
        });
      }

      if (mobileTab === 'chat') {
        setHasUnreadTrace(true);
      }
      return response;
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'agent',
        text: sp({
          technical: `Gateway request failed before any response came back: ${err.message}. Check the base URL and network, then retry.`,
          analysts: `Could not reach the AI service, so no analysis was run: ${err.message}`,
          support: `Could not reach the AI service, so no reply was drafted: ${err.message}`,
        }),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
        targetUrl,
      };
      setMessages((prev) => [...prev, errorMessage]);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /*
    Stateful scenarios (Tokenomics 1-4, Semantic Cache Seed → Hit) only show the
    advertised result when the earlier calls have already happened. These refs remember
    what this session has sent so a later step clicked directly first runs the missing
    earlier steps (see utils/scenarioPrereqs.js for the rules).
  */
  const tokenRunRef = useRef<{ lastStep: number; seqStartAt: number | null; lastCallAt: number | null }>({
    lastStep: -1,
    seqStartAt: null,
    lastCallAt: null,
  });
  const cacheSeededAtRef = useRef<number | null>(null);
  // `loading` flips back to false between the calls of a sequence; this guards the whole run.
  const sequenceBusyRef = useRef(false);

  const pushSystemNote = (text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-note-${Math.random().toString(36).slice(2, 7)}`,
        sender: 'system',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  /**
   * Settings patch that switches to a persona entitled to `model`, or null when
   * the selected persona already is. Posts a visible note when it switches, so
   * the audience knows why the persona changed.
   */
  const personaSwitchFor = (model: string, scenario: string): Partial<GatewaySettings> | null => {
    const target = personaForModel(settings.activeUser, model);
    if (target === settings.activeUser) return null;
    const from = personaLabel(settings.activeUser);
    const to = personaLabel(target);
    pushSystemNote(
      sp({
        technical: `${scenario} targets ${model}, which the ${from} key is not entitled to, so this call is sent with the ${to} key.`,
        analysts: `${scenario} needs ${model}, which ${from} cannot use, so this demo runs as ${to}. Your own access is unchanged.`,
        support: `${scenario} runs on ${model}, which is not on the ${from} list, so this demo switches to ${to}. Your own access is unchanged.`,
      }),
    );
    return { activeUser: target, keyTier: KEY_TIER_FOR_PERSONA[target], apiKey: USERS[target]?.apiKey || '' };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    // Runs as the persona picked top-right, whatever the model: a persona whose
    // product does not entitle the chosen model is meant to be refused (401).
    const settingsToUse = { ...settings, omitEmailHeader: false };
    if (settings.omitEmailHeader) {
      setSettings((prev) => ({ ...prev, omitEmailHeader: false }));
    }
    handleExecute(inputText, settingsToUse);
  };

  const handleSelectSample = (preset: ScenarioPreset & BusinessCopy) => {
    const isIdentityTest =
      preset.id === 'zero-trust-identity' || Boolean(preset.settingsOverride?.omitEmailHeader);

    let effectiveSettings: GatewaySettings = {
      ...settings,
      ...preset.settingsOverride,
      omitEmailHeader: isIdentityTest,
    };

    if (preset.settingsOverride?.activeUser) {
      const u = USERS[preset.settingsOverride.activeUser];
      if (u) {
        effectiveSettings.apiKey = u.apiKey;
      }
    } else if (preset.settingsOverride?.model) {
      // Keep the selected persona when its product entitles the scenario's model;
      // otherwise switch visibly rather than silently.
      const persona = personaSwitchFor(preset.settingsOverride.model, presetLine(preset, 'title'));
      if (persona) {
        effectiveSettings = { ...effectiveSettings, ...persona };
        setSettings((prev) => ({ ...prev, ...persona }));
      }
    }

    if (preset.settingsOverride) {
      const persistentOverrides = { ...preset.settingsOverride };
      delete persistentOverrides.omitEmailHeader;

      if (Object.keys(persistentOverrides).length > 0) {
        setSettings((prev) => ({
          ...prev,
          ...persistentOverrides,
          ...(preset.settingsOverride?.activeUser
            ? {
                // Must not fall back to prev.apiKey: that is the previously
                // active persona's key (admin at session start), which would
                // silently escalate this scenario's privileges. Empty is
                // correct here; apigeeClient re-resolves from /api/me.
                apiKey: USERS[preset.settingsOverride.activeUser]?.apiKey || '',
              }
            : {}),
          omitEmailHeader: false,
        }));
      } else {
        setSettings((prev) => ({ ...prev, omitEmailHeader: false }));
      }
    } else {
      setSettings((prev) => ({ ...prev, omitEmailHeader: false }));
    }

    const exampleId = PRESET_EXAMPLE_ID[preset.id];
    handleExecute(exampleId ? industryPrompt(exampleId, preset.prompt) : preset.prompt, effectiveSettings);
  };

  // 6 preset scenarios in strictly requested sequence:
  // 1. Identity check, 2. Unauthorized model, 3. Model Armor, 4. Auto, 5. Semantic cache, 6. No cache
  const sampleChips = [
    {
      label:
        authStep === 0
          ? sp({ technical: '🚫 Auth: No Identity → 401 (1/2)', analysts: '🚫 Access: not signed in (1/2)', support: '🚫 Agents only: not signed in (1/2)' })
          : sp({ technical: '🚫 Auth: Unentitled Model → 401 (2/2)', analysts: '🚫 Access: model not approved (2/2)', support: '🚫 Agents only: model not allowed (2/2)' }),
      promptId: 'unauthorized-toggle',
      title:
        authStep === 0
          ? sp({
              technical: 'Step 1: Caller identity omitted from the request. Expect a 401 from the gateway: no upstream call, no charge.',
              analysts: 'Step 1: A research request from someone who is not signed in is refused, so confidential work stays protected.',
              support: 'Step 1: A request from someone who is not signed in is refused, so customer details stay with your team.',
            })
          : sp({
              technical: "Step 2: A valid Engineering & IT key asks for gemini-2.5-pro, which its API product does not include. Expect a 401 at key verification.",
              analysts: 'Step 2: Even the most senior team is refused a model that no team has been approved to use.',
              support: 'Step 2: Even Engineering & IT is refused a model that nobody is approved to use.',
            }),
      color: 'hover:border-rose-500 hover:text-rose-500',
      icon: ShieldAlert,
      iconColor: 'text-rose-500',
    },
    {
      label:
        armorStep === 0
          ? sp({ technical: '🛡️ Screening: Destructive → 400 (1/3)', analysts: '🛡️ Data guard: harmful ask (1/3)', support: '🛡️ Safe to send: harmful ask (1/3)' })
          : armorStep === 1
          ? sp({ technical: '🛡️ Screening: Jailbreak → 400 (2/3)', analysts: '🛡️ Data guard: rule bypass (2/3)', support: '🛡️ Safe to send: rule bypass (2/3)' })
          : sp({ technical: '🛡️ Screening: PII Request → 400 (3/3)', analysts: '🛡️ Data guard: data leak (3/3)', support: '🛡️ Safe to send: data leak (3/3)' }),
      promptId: 'model-armor-toggle',
      title:
        armorStep === 0
          ? sp({
              technical: 'Step 1: Destructive script request. Rejected with 400 before routing: show the user a safe error, do not retry.',
              analysts: 'Step 1: A request to secretly delete files is stopped before the AI sees it.',
              support: 'Step 1: A harmful request is stopped, so no unsafe reply can be drafted.',
            })
          : armorStep === 1
          ? sp({
              technical: 'Step 2: DAN-style prompt injection. Rejected with 400 before any model sees it.',
              analysts: "Step 2: An attempt to make the AI ignore its rules is stopped before it can touch your data.",
              support: 'Step 2: An attempt to make the AI ignore its rules is stopped before it can say anything off-brand.',
            })
          : sp({
              technical: 'Step 3: Request for SSNs, card numbers and password hashes. Rejected with 400; nothing reaches the model.',
              analysts: 'Step 3: A request for customer SSNs and card numbers is stopped, so confidential data stays protected.',
              support: 'Step 3: A request for customer SSNs and card numbers is stopped, so no customer data leaks into a reply.',
            }),
      color: 'hover:border-red-500 hover:text-red-500',
      icon: Shield,
      iconColor: 'text-red-500',
    },
    {
      label:
        autoStep === 0
          ? sp({ technical: '🧠 model=auto: Simple (1/3)', analysts: '🧠 Model choice: quick fact (1/3)', support: '🧠 Model choice: quick answer (1/3)' })
          : autoStep === 1
          ? sp({ technical: '🧠 model=auto: Deep Reasoning (2/3)', analysts: '🧠 Model choice: deep analysis (2/3)', support: '🧠 Model choice: complex ask (2/3)' })
          : sp({ technical: '🧠 model=auto: Coding (3/3)', analysts: '🧠 Model choice: coding (3/3)', support: '🧠 Model choice: coding (3/3)' }),
      promptId: 'auto-routing',
      title:
        autoStep === 0
          ? sp({
              technical: 'Example 1/3: Trivial lookup. The router classifies it as simple and calls Flash Lite; the chosen model comes back in x-gateway-model.',
              analysts: 'Example 1/3: A quick factual question goes to a fast, low-cost model.',
              support: 'Example 1/3: A quick factual question goes to a fast, low-cost model, so the reply is quick and cheap.',
            })
          : autoStep === 1
          ? sp({
              technical: 'Example 2/3: Trade-off analysis. Classified as deep reasoning and sent to Gemini Pro on your key: budget ~15 s of latency.',
              analysts: 'Example 2/3: An in-depth analysis goes to Gemini Pro, the strongest model your team can use.',
              support: 'Example 2/3: A complex question goes to Gemini Flash, which keeps replies quick and cheap.',
            })
          : sp({
              technical: 'Example 3/3: Implementation request. Classified as coding and sent to Claude Opus on the Engineering & IT key.',
              analysts: "Example 3/3: A coding request goes to Gemini Pro, your team's coding model.",
              support: "Example 3/3: A coding request goes to Claude Haiku, your team's low-cost option.",
            }),
      color: 'hover:border-purple-500 hover:text-purple-500',
      icon: Sparkles,
      iconColor: 'text-purple-500',
    },
    {
      label: sp({
        technical: [
          '⚡ Token Quota: 200 OK (1/4)',
          '⚠️ Token Quota: Near Threshold (2/4)',
          '⚠️ Token Quota: Used Up (3/4)',
          '🛑 Token Quota: 429 (4/4)',
        ],
        analysts: [
          '⚡ Fair use: within limit (1/4)',
          '⚠️ Fair use: warning (2/4)',
          '⚠️ Fair use: used up (3/4)',
          '🛑 Fair use: refused (4/4)',
        ],
        support: [
          '⚡ Allowance: within limit (1/4)',
          '⚠️ Allowance: warning (2/4)',
          '⚠️ Allowance: used up (3/4)',
          '🛑 Allowance: refused (4/4)',
        ],
      })[tokenStep],
      promptId: 'token-limit-toggle',
      title: sp(TOKEN_LIMIT_EXAMPLES[tokenStep].lines.title) + ' - ' + sp(TOKEN_LIMIT_EXAMPLES[tokenStep].lines.description),
      color:
        tokenStep === 0
          ? 'hover:border-emerald-500 hover:text-emerald-500'
          : tokenStep === 3
          ? 'hover:border-rose-500 hover:text-rose-500'
          : 'hover:border-amber-500 hover:text-amber-500',
      icon: tokenStep === 0 ? Zap : tokenStep === 3 ? ShieldAlert : AlertTriangle,
      iconColor: tokenStep === 0 ? 'text-emerald-500' : tokenStep === 3 ? 'text-rose-500' : 'text-amber-500',
    },
    {
      label:
        cacheStep === 0
          ? sp({ technical: '⚡ Semantic Cache: Miss (Seed)', analysts: '⚡ Reuse analysis: first ask', support: '⚡ Reuse replies: first ask' })
          : sp({ technical: '⚡ Semantic Cache: Hit ($0)', analysts: '⚡ Reuse analysis: reused ($0)', support: '⚡ Reuse replies: reused ($0)' }),
      promptId: 'cache-toggle',
      title:
        cacheStep === 0
          ? sp({
              technical: 'Step 1: Opus call with use-cache: true. Cache miss (~14 s, ~$0.08); the response is stored for reuse.',
              analysts: 'Step 1: A detailed question is answered live (~14 s) and saved for reuse.',
              support: 'Step 1: A detailed customer question is answered live and saved for reuse.',
            })
          : sp({
              technical: 'Step 2: Paraphrased prompt above the 0.95 similarity threshold. Served from cache in ~1 s at $0, with no model call.',
              analysts: 'Step 2: The same question, reworded, reuses the saved analysis in about a second at no model cost.',
              support: 'Step 2: A customer asks the same thing in other words. The saved reply comes back instantly at no model cost.',
            }),
      color: 'hover:border-emerald-500 hover:text-emerald-500',
      icon: Database,
      iconColor: 'text-emerald-500',
    },
    {
      label: sp({ technical: '🌐 Direct Call (no use-cache)', analysts: '🌐 Fresh analysis (no reuse)', support: '🌐 Fresh reply (no reuse)' }),
      promptId: 'no-cache',
      title: sp({
        technical: 'Same Opus prompt without the use-cache header: live inference, so you can compare latency and cost with the cache hit.',
        analysts: 'Asks without reusing earlier answers, to compare time and cost per analysis.',
        support: 'Asks without reusing earlier replies, to compare speed and cost per reply.',
      }),
      color: 'hover:border-cyan-500 hover:text-cyan-500',
      icon: Globe,
      iconColor: 'text-cyan-500',
    },
  ];

  const handleAuthStep = (step: 0 | 1, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAuthStep(step);
    const example = UNAUTHORIZED_401_EXAMPLES[step];
    const overrides = (example.settingsOverride || {}) as Partial<GatewaySettings>;
    const effectiveSettings: GatewaySettings = {
      ...settings,
      ...overrides,
    };
    setSettings((prev) => ({
      ...prev,
      ...overrides,
    }));
    handleExecute(industryPrompt(example.id, example.prompt), effectiveSettings);
  };

  const handleArmorStep = (step: 0 | 1 | 2, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setArmorStep(step);
    const example = MODEL_ARMOR_EXAMPLES[step];
    // Model Armor runs on the request PreFlow, before any routing decision, so
    // the block is identical on every model. Pinning /auto demonstrates it on
    // the endpoint real traffic actually uses, and keeps the scenario from
    // inheriting whatever model the previous demo step happened to leave
    // selected (a rate-limited Claude, say, which would muddy the 400 with a 429).
    const effectiveSettings: GatewaySettings = {
      ...settings,
      model: 'auto',
      useCache: false,
      omitEmailHeader: false,
    };
    setSettings((prev) => ({
      ...prev,
      model: 'auto',
      useCache: false,
      omitEmailHeader: false,
    }));
    handleExecute(industryPrompt(example.id, example.prompt), effectiveSettings);
  };

  const handleAutoRoutingStep = (step: 0 | 1 | 2, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAutoStep(step);
    const example = AUTO_ROUTING_EXAMPLES[step];
    // Runs as the selected persona: each persona's product maps the router's
    // category to a different model (e.g. coding -> Opus / Pro / Haiku).
    const effectiveSettings: GatewaySettings = {
      ...settings,
      model: 'auto',
      useCache: false,
      omitEmailHeader: false,
    };
    setSettings((prev) => ({
      ...prev,
      model: 'auto',
      useCache: false,
      omitEmailHeader: false,
    }));
    handleExecute(industryPrompt(example.id, example.prompt), effectiveSettings);
  };

  const handleCacheStep = async (step: 0 | 1, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (loading || sequenceBusyRef.current) return;
    // Opus is Engineering & IT only: other personas are switched, with a note.
    const cacheOverrides = {
      ...(personaSwitchFor(CACHE_DEMO_MODEL, sp({ technical: 'Semantic cache', analysts: 'Reuse past analysis', support: 'Reuse common replies' })) || {}),
      useCache: true,
      model: CACHE_DEMO_MODEL,
      omitEmailHeader: false,
    };
    const effectiveSettings: GatewaySettings = { ...settings, ...cacheOverrides };
    setSettings((prev) => ({ ...prev, ...cacheOverrides }));

    const steps = planCacheSteps({ target: step, seededAt: cacheSeededAtRef.current, now: Date.now() });
    if (steps.length > 1) {
      pushSystemNote(
        sp({
          technical: 'Sending the seed call first (step 1), so the paraphrased prompt in step 2 has a cache entry to hit.',
          analysts: 'Asking the original question first (step 1), so the reworded one in step 2 can reuse its analysis.',
          support: 'Asking the original question first (step 1), so the reworded one in step 2 can reuse its reply.',
        }),
      );
    }
    sequenceBusyRef.current = true;
    try {
      for (const s of steps) {
        setCacheStep(s as 0 | 1);
        // Stateless: prior chat turns would add Opus input cost to the seed call.
        const res = await handleExecute(industryPrompt(CACHE_EXAMPLES[s].id, CACHE_EXAMPLES[s].prompt), effectiveSettings, { stateless: true });
        if (s === 0) {
          if (res?.success) cacheSeededAtRef.current = Date.now();
          else break; // no seed, so the hit step would just be another miss
        }
      }
    } finally {
      sequenceBusyRef.current = false;
    }
    // Highlight the step that comes next.
    setCacheStep(step === 0 ? 1 : 0);
  };

  const handleTokenStep = async (step: 0 | 1 | 2 | 3, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (loading || sequenceBusyRef.current) return;
    // Haiku is on Engineering & IT and Customer Support & Sales; Analysts switch, with a note.
    const tokenOverrides = {
      ...(personaSwitchFor('claude-haiku-4-5@20251001', sp({ technical: 'The token quota demo', analysts: 'Fair-use limits', support: 'Reply allowance' })) || {}),
      useCache: false,
      model: 'claude-haiku-4-5@20251001',
      omitEmailHeader: false,
    };
    const effectiveSettings: GatewaySettings = { ...settings, ...tokenOverrides };
    setSettings((prev) => ({ ...prev, ...tokenOverrides }));

    const run = tokenRunRef.current;
    const plan = planTokenSteps({ target: step, ...run, now: Date.now() });
    if (plan.action === 'wait') {
      const secs = Math.ceil(plan.waitMs / 1000);
      pushSystemNote(
        sp({
          technical: `The rolling 1-minute token window still holds the previous run, so step ${step + 1} would not return its expected status yet. Retry in about ${secs}s.`,
          analysts: `This minute's allowance still counts the previous run, so step ${step + 1} would not show the right result yet. Try again in about ${secs}s.`,
          support: `This minute's allowance still counts earlier requests, so step ${step + 1} would not show the right result yet. Try again in about ${secs}s.`,
        }),
      );
      return;
    }
    if (plan.steps.length > 1) {
      const first = plan.steps[0] + 1;
      const range = `${first}${plan.steps.length > 2 ? `-${step}` : ''}`;
      const plural = plan.steps.length > 2 ? 's' : '';
      pushSystemNote(
        sp({
          technical: `Running step${plural} ${range} first: step ${step + 1} only returns its intended status once those calls have filled the same 1-minute token window.`,
          analysts: `Running step${plural} ${range} first: step ${step + 1} only shows its result once earlier questions have used part of this minute's allowance.`,
          support: `Running step${plural} ${range} first: step ${step + 1} only shows its result once earlier requests have used part of this minute's allowance.`,
        }),
      );
    }

    sequenceBusyRef.current = true;
    try {
      for (const s of plan.steps) {
        setTokenStep(s as 0 | 1 | 2 | 3);
        const sentAt = Date.now();
        if (s === 0) run.seqStartAt = sentAt;
        // Stateless + capped output so each step costs a predictable ~120 tokens and the
        // alert / 429 land on the documented steps (see TOKEN_LIMIT_EXAMPLES).
        const res = await handleExecute(industryPrompt(TOKEN_LIMIT_EXAMPLES[s].id, TOKEN_LIMIT_EXAMPLES[s].prompt), effectiveSettings, {
          stateless: true,
          maxOutputTokens: TOKEN_DEMO_MAX_OUTPUT_TOKENS,
        });
        run.lastStep = s;
        run.lastCallAt = sentAt;
        const status = res?.telemetry?.status;
        if (s < step && status !== 200) {
          // A prerequisite didn't behave as expected (e.g. an early 429 because the window
          // already held other traffic). Stop rather than show a misleading final step.
          pushSystemNote(
            sp({
              technical: `Step ${s + 1} returned ${status ?? 'an error'} instead of 200, so the sequence stopped. Other traffic may be in the window: wait a minute, then retry.`,
              analysts: `Step ${s + 1} did not return an answer, so the demo stopped. Wait a minute for the allowance to reset and try again.`,
              support: `Step ${s + 1} did not return a reply, so the demo stopped. Wait a minute for the allowance to reset and try again.`,
            }),
          );
          break;
        }
      }
    } finally {
      sequenceBusyRef.current = false;
    }
    // Highlight the step that comes next.
    setTokenStep(((step + 1) % 4) as 0 | 1 | 2 | 3);
  };

  const handleChipClick = async (chip: (typeof sampleChips)[0]) => {
    if (chip.promptId === 'model-armor-toggle') {
      const nextStep = armorStep;
      handleArmorStep(nextStep);
      setArmorStep(((nextStep + 1) % 3) as 0 | 1 | 2);
      return;
    }
    if (chip.promptId === 'unauthorized-toggle') {
      const nextStep = authStep;
      handleAuthStep(nextStep);
      setAuthStep(nextStep === 0 ? 1 : 0);
      return;
    }
    if (chip.promptId === 'token-limit-toggle') {
      // handleTokenStep runs any missing earlier steps and advances tokenStep itself.
      handleTokenStep(tokenStep);
      return;
    }

    if (chip.promptId === 'cache-toggle') {
      handleCacheStep(cacheStep);
      return;
    }

    if (chip.promptId === 'auto-routing') {
      const nextStep = autoStep;
      handleAutoRoutingStep(nextStep);
      setAutoStep(((nextStep + 1) % 3) as 0 | 1 | 2);
      return;
    }

    const preset = SCENARIO_PRESETS.find((p) => p.id === chip.promptId);
    if (preset) {
      handleSelectSample(preset);
    }
  };

  /**
   * Steps of a multi-step scenario chip, for the picker that opens on hover (after a short
   * delay) or from the chevron. Clicking the chip itself still runs the next step.
   */
  const chipSteps = (promptId: string): { label: string; next: boolean; run: (e: React.MouseEvent) => void }[] => {
    switch (promptId) {
      case 'unauthorized-toggle':
        return ([0, 1] as const).map((i) => ({
          label: [
            sp({ technical: 'No identity → 401', business: 'Not signed in' }),
            sp({ technical: 'Unentitled model → 401', analysts: 'Model not approved', support: 'Model not allowed' }),
          ][i],
          next: authStep === i,
          run: (e: React.MouseEvent) => { handleAuthStep(i, e); setAuthStep(nextStepIndex(i, 2) as 0 | 1); },
        }));
      case 'model-armor-toggle':
        return ([0, 1, 2] as const).map((i) => ({
          label: [
            sp({ technical: 'Destructive → 400', business: 'Harmful ask' }),
            sp({ technical: 'Jailbreak → 400', business: 'Rule bypass' }),
            sp({ technical: 'PII request → 400', business: 'Data leak' }),
          ][i],
          next: armorStep === i,
          run: (e: React.MouseEvent) => { handleArmorStep(i, e); setArmorStep(nextStepIndex(i, 3) as 0 | 1 | 2); },
        }));
      case 'auto-routing':
        return ([0, 1, 2] as const).map((i) => ({
          label: [
            sp({ technical: 'Simple', analysts: 'Quick fact', support: 'Quick answer' }),
            sp({ technical: 'Deep reasoning', analysts: 'Deep analysis', support: 'Complex ask' }),
            sp({ technical: 'Coding', business: 'Coding' }),
          ][i],
          next: autoStep === i,
          run: (e: React.MouseEvent) => { handleAutoRoutingStep(i, e); setAutoStep(nextStepIndex(i, 3) as 0 | 1 | 2); },
        }));
      case 'token-limit-toggle':
        return TOKEN_LIMIT_EXAMPLES.map((ex, i) => ({
          label: sp(ex.lines.tag),
          next: tokenStep === i,
          run: (e: React.MouseEvent) => handleTokenStep(i as 0 | 1 | 2 | 3, e),
        }));
      case 'cache-toggle':
        return [
          { label: sp({ technical: 'Miss (seed)', business: 'First ask' }), next: cacheStep === 0, run: (e) => handleCacheStep(0, e) },
          { label: sp({ technical: 'Hit ($0)', business: 'Reused ($0)' }), next: cacheStep === 1, run: (e) => handleCacheStep(1, e) },
        ];
      default:
        return [];
    }
  };

  // Step picker for the scenario bar. Rendered position: fixed because the bar scrolls
  // horizontally, which would clip an absolutely positioned popover.
  const [stepMenu, setStepMenu] = useState<{ id: string; left: number; bottom: number } | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const clearMenuTimers = () => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = closeTimerRef.current = null;
  };
  const openStepMenu = (id: string, el: HTMLElement) => {
    clearMenuTimers();
    const pos = stepMenuPosition(el.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    setStepMenu({ id, ...pos });
  };
  const scheduleOpenStepMenu = (id: string, el: HTMLElement) => {
    clearMenuTimers();
    openTimerRef.current = window.setTimeout(() => openStepMenu(id, el), STEP_MENU_HOVER_DELAY_MS);
  };
  const scheduleCloseStepMenu = () => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = window.setTimeout(() => setStepMenu(null), STEP_MENU_CLOSE_DELAY_MS);
  };
  useEffect(() => {
    if (!stepMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setStepMenu(null);
    const onScroll = () => setStepMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [stepMenu]);

  /*
    Run whatever scenario the tour asked for, then immediately tell the parent it has
    been consumed so the same request cannot re-fire on the next render.

    Deliberately keyed on `tourAction` alone. The handlers it calls are redefined on
    every render, so depending on them would re-run this effect - and therefore re-send
    a real, billable gateway call - on every keystroke in the prompt box.
  */
  useEffect(() => {
    if (!tourAction) return;
    switch (tourAction) {
      case 'auto-simple':
        handleAutoRoutingStep(0);
        break;
      case 'auto-coding':
        handleAutoRoutingStep(2);
        break;
      case 'cache-seed':
        handleCacheStep(0);
        break;
      case 'cache-hit':
        handleCacheStep(1);
        break;
    }
    onTourActionHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourAction]);

  const activeUser = getUserInfo(settings.activeUser);
  const ssoUser = settings.ssoUser || DEFAULT_SSO_USER;
  const effectiveEmail = ssoUser.email || settings.userEmail || DEFAULT_SSO_USER.email;


  /** The id of the message whose telemetry the inspector is currently showing. */
  const selectedMessageId = useMemo(() => {
    if (!activeTelemetry) return undefined;
    // Compared by identity: telemetry objects are stored per message and never cloned,
    // so this stays correct even when two calls have identical field values (which is
    // exactly what happens when you replay the same prompt to demonstrate a cache hit).
    return messages.find((m) => m.telemetry === activeTelemetry)?.id;
  }, [messages, activeTelemetry]);

  const latestTelemetryMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.sender === 'agent' && m.telemetry) return m.id;
    }
    return undefined;
  }, [messages]);

  // Token-quota state of the MOST RECENT call that carried the signal. Cache hits and
  // errors carry none, so they neither raise nor clear the banner; the next metered call
  // does. The gateway computes the status (JS-TokenQuotaThreshold); nothing is guessed here.
  const latestTokenQuota = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const q = messages[i].telemetry?.tokenQuota;
      if (messages[i].sender === 'agent' && q) return q;
    }
    return undefined;
  }, [messages]);

  const isViewingHistoricalCall =
    !!selectedMessageId && !!latestTelemetryMessageId && selectedMessageId !== latestTelemetryMessageId;



  return (
    <div className="h-[calc(100vh-3.25rem)] flex flex-col md:flex-row overflow-hidden bg-slate-950">
      {/* Mobile Tab Switcher (< md) */}
      <div className="flex md:hidden items-center border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer min-h-[36px] ${
            mobileTab === 'chat'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>{sp({ technical: 'Chat Playground', business: 'Chat' })}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileTab('trace');
            setHasUnreadTrace(false);
          }}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer min-h-[36px] relative ${
            mobileTab === 'trace'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          <span>{sp({ technical: 'Gateway Trace', business: 'What happened' })}</span>
          {hasUnreadTrace && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse" />
          )}
        </button>
      </div>

      {/* Left Column: Chat Area */}
      <div
        className={`flex-1 flex flex-col surface-flow border-r border-slate-200 h-full overflow-hidden ${
          mobileTab === 'chat' ? 'flex' : 'hidden md:flex'
        }`}
      >
        {/* Token-quota threshold banner (gateway header x-gateway-token-quota-status) */}
        {isTokenQuotaAlert(latestTokenQuota) && latestTokenQuota && (
          <div
            role="status"
            data-token-quota-banner={latestTokenQuota.status}
            className={`shrink-0 flex items-center gap-2 px-4 py-2 border-b text-xs font-semibold ${
              latestTokenQuota.status === 'exhausted'
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {latestTokenQuota.status === 'exhausted'
                ? sp({ technical: 'Token quota exhausted: next call gets 429', analysts: "This minute's allowance is used up", support: "Reply allowance used up this minute" })
                : sp({ technical: 'Token quota status: near-threshold', analysts: "Nearing this minute's allowance", support: "Nearing this minute's reply allowance" })}
            </span>
            <span className="font-normal opacity-80">
              {sp({
                technical: `${latestTokenQuota.used.toLocaleString()} / ${latestTokenQuota.limit.toLocaleString()} tokens (${latestTokenQuota.usedPct}% used, alert above ${latestTokenQuota.thresholdPct}%) in the rolling 1-minute window`,
                analysts: `${latestTokenQuota.usedPct}% of your team's allowance used this minute. Long analyses may be refused until it resets.`,
                support: `${latestTokenQuota.usedPct}% of your team's allowance used this minute. Keep replies short or wait for the reset.`,
              })}
            </span>
          </div>
        )}

        {/* Messages Feed */}
        {/* No visible scrollbar (it looked out of place when presenting); the area still scrolls with the wheel / trackpad. */}
        <div data-tour-id="chat-messages" className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 no-scrollbar">
          {messages.length === 0 && (
            <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6 select-none max-w-5xl mx-auto my-auto">
              <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-center mb-2.5">
                <ApigeeColorSymbol className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                {sp({ technical: 'AI Gateway: one endpoint, your key', analysts: 'AI for research and analysis', support: 'AI for customer replies' })}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-5 text-center">
                {sp({
                  technical: 'Run a scenario to see the status codes, headers, latency and cost your code gets back, or send your own prompt:',
                  analysts: 'Try a scenario to see how your analysis stays accurate, confidential and within budget, or ask your own research question:',
                  support: 'Try a scenario to see how replies stay fast, safe to send and cheap, or ask for a customer reply:',
                })}
              </p>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4 w-full">
                {sampleChips.map((chip) => {
                  const preset = SCENARIO_PRESETS.find(
                    (p) =>
                      p.id ===
                      (chip.promptId === 'cache-toggle'
                        ? 'cache-toggle'
                        : chip.promptId)
                  );
                  const Icon = chip.icon || Sparkles;
                  const presetTitle = preset ? presetLine(preset, 'title') : '';
                  const presetBadge = preset ? presetLine(preset, 'badge') : '';
                  const presetDescription = preset ? presetLine(preset, 'description') : '';
                  return (
                    // A div with button semantics, not a <button>: some chips hold their own step buttons,
                    // and a <button> inside a <button> is invalid HTML.
                    <div
                      key={chip.promptId}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleChipClick(chip)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleChipClick(chip);
                        }
                      }}
                      className="p-4 bg-white hover:bg-slate-50 border border-slate-200 hover:border-blue-400 rounded-xl text-left transition group cursor-pointer flex flex-col justify-between gap-2 shadow-xs hover:shadow-sm"
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Icon className={`w-5 h-5 shrink-0 ${chip.iconColor || 'text-blue-500'}`} />
                            <span className="text-base font-semibold text-slate-900 group-hover:text-blue-600 transition leading-snug">
                              {presetTitle || chip.label}
                            </span>
                          </div>
                          {presetBadge && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 shrink-0 font-medium whitespace-nowrap">
                              {presetBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {presetDescription || chip.title}
                        </p>
                      </div>

                      {chip.promptId === 'unauthorized-toggle' && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 w-full">
                          <button
                            type="button"
                            onClick={(e) => handleAuthStep(0, e)}
                            className={`w-full text-center text-[11px] px-1 py-0.5 rounded font-mono transition cursor-pointer whitespace-nowrap ${
                              authStep === 0
                                ? 'bg-rose-500/20 text-rose-600 font-bold border border-rose-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'No Identity', business: 'Not signed in' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleAuthStep(1, e)}
                            className={`w-full text-center text-[11px] px-1 py-0.5 rounded font-mono transition cursor-pointer whitespace-nowrap ${
                              authStep === 1
                                ? 'bg-rose-500/20 text-rose-600 font-bold border border-rose-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Unentitled Model', analysts: 'Not approved', support: 'Not allowed' })}
                          </button>
                        </div>
                      )}

                      {chip.promptId === 'model-armor-toggle' && (
                        <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-slate-100 w-full">
                          <button
                            type="button"
                            onClick={(e) => handleArmorStep(0, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              armorStep === 0
                                ? 'bg-red-500/20 text-red-600 font-bold border border-red-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Destructive', business: 'Harmful' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleArmorStep(1, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              armorStep === 1
                                ? 'bg-red-500/20 text-red-600 font-bold border border-red-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Injection', business: 'Rule bypass' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleArmorStep(2, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              armorStep === 2
                                ? 'bg-red-500/20 text-red-600 font-bold border border-red-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'PII Request', business: 'Data leak' })}
                          </button>
                        </div>
                      )}

                      {chip.promptId === 'auto-routing' && (
                        <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-slate-100 w-full">
                          <button
                            type="button"
                            onClick={(e) => handleAutoRoutingStep(0, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              autoStep === 0
                                ? 'bg-purple-500/20 text-purple-600 font-bold border border-purple-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Simple', analysts: 'Quick fact', support: 'Quick' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleAutoRoutingStep(1, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              autoStep === 1
                                ? 'bg-purple-500/20 text-purple-600 font-bold border border-purple-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Reasoning', analysts: 'Deep dive', support: 'Complex' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleAutoRoutingStep(2, e)}
                            className={`w-full text-center text-[10.5px] px-0.5 py-0.5 rounded font-mono tracking-tight transition cursor-pointer whitespace-nowrap ${
                              autoStep === 2
                                ? 'bg-purple-500/20 text-purple-600 font-bold border border-purple-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Coding', business: 'Coding' })}
                          </button>
                        </div>
                      )}

                      {chip.promptId === 'cache-toggle' && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 w-full">
                          <button
                            type="button"
                            onClick={(e) => handleCacheStep(0, e)}
                            className={`w-full text-center text-[11px] px-1 py-0.5 rounded font-mono transition cursor-pointer whitespace-nowrap ${
                              cacheStep === 0
                                ? 'bg-emerald-500/20 text-emerald-600 font-bold border border-emerald-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Miss (Seed)', business: 'First ask' })}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleCacheStep(1, e)}
                            className={`w-full text-center text-[11px] px-1 py-0.5 rounded font-mono transition cursor-pointer whitespace-nowrap ${
                              cacheStep === 1
                                ? 'bg-emerald-500/20 text-emerald-600 font-bold border border-emerald-500/30'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            }`}
                          >
                            {sp({ technical: 'Hit ($0)', business: 'Reused ($0)' })}
                          </button>
                        </div>
                      )}

                      {chip.promptId === 'token-limit-toggle' && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 w-full">
                          {TOKEN_LIMIT_EXAMPLES.map((ex, i) => {
                            const active = tokenStep === i;
                            const tone =
                              i === 0
                                ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30'
                                : i === 3
                                ? 'bg-rose-500/20 text-rose-600 border-rose-500/30'
                                : 'bg-amber-500/20 text-amber-700 border-amber-500/30';
                            return (
                              <button
                                key={ex.id}
                                type="button"
                                title={sp(ex.lines.description)}
                                onClick={(e) => handleTokenStep(i as 0 | 1 | 2 | 3, e)}
                                className={`w-full text-center text-[11px] px-1 py-0.5 rounded font-mono transition cursor-pointer whitespace-nowrap ${
                                  active
                                    ? `${tone} font-bold border`
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                                }`}
                              >
                                {i + 1}. {sp(ex.lines.tag)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((msg) => msg.sender === 'system' ? (
            <div key={msg.id} role="note" className="flex justify-center">
              <div className="max-w-xl flex items-start gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px] text-slate-600 leading-snug">
                <Info className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
                <span>{msg.text}</span>
              </div>
            </div>
          ) : (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'agent' && (
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.isError
                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                      : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}
                >
                  {msg.isError ? <ShieldAlert className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
              )}

              {/*
                Agent responses that carry telemetry are selectable: clicking one loads that
                call into the inspector on the right. This is how you look back at an earlier
                call without re-running it, and it is what makes the "what changed" hints
                below reachable for every call rather than only the most recent one.

                The bubble stays a div, not a button, even though it is clickable: it
                already contains a real button ("Request Flow"), and nesting interactive
                content inside a button is invalid HTML and breaks it for assistive tech.
                Keyboard and screen-reader users get the explicit "Telemetry" button in the
                footer row instead, which does exactly the same thing.
              */}
              {(() => {
                const selectable = msg.sender === 'agent' && !!msg.telemetry;
                const isSelected = selectable && msg.id === selectedMessageId;
                const bubbleClass = `max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed shadow-xs transition text-left ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : msg.isError
                    ? 'bg-rose-50/70 text-slate-900 border border-rose-200 rounded-bl-none'
                    : 'bg-white text-slate-900 border border-slate-200 rounded-bl-none'
                } ${
                  selectable ? 'cursor-pointer hover:border-blue-300 hover:shadow-sm' : ''
                } ${
                  isSelected ? 'ring-2 ring-blue-500/70 border-blue-300' : ''
                }`;

                const body = (
                  <>
                    {msg.sender === 'agent' && !msg.isError ? (
                      <MarkdownMessage text={msg.text} />
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    )}


                {/* Inline Telemetry & Target URL Badge on Agent Messages */}
                <div className="mt-2 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-500 font-mono">
                  {msg.targetUrl && (
                    <div className="flex items-center justify-between gap-2 overflow-hidden">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 font-bold text-[9px] shrink-0">
                          POST
                        </span>
                        <span className="text-slate-500 font-semibold shrink-0">{sp({ technical: 'Endpoint:', business: 'Sent to:' })}</span>
                        <span className="truncate text-blue-700 select-all font-medium">{msg.targetUrl}</span>
                      </div>
                      {msg.telemetry && (
                        <div className="flex items-center gap-1 shrink-0">
                          {/*
                            The keyboard path to what clicking the bubble does. Hidden from
                            the accessibility tree would be wrong here - this is the only
                            way to reach an earlier call's telemetry without a mouse.
                          */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTelemetry(msg.telemetry!);
                            }}
                            aria-pressed={msg.id === selectedMessageId}
                            /*
                              Do NOT reach for bg-slate-800 + text-white here. The light
                              theme in index.css repaints bg-slate-800 to #f1f5f9 with
                              !important, so the selected pill came out white-on-white.
                              bg-slate-200 / text-slate-900 are outside that override layer.
                            */
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-sans font-semibold text-[10px] transition cursor-pointer shadow-2xs border ${
                              msg.id === selectedMessageId
                                ? 'bg-slate-200 text-slate-900 border-slate-400 font-bold'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                            }`}

                            title={sp({
                              technical: "Load this call's status, headers and token counts into the inspector",
                              analysts: 'Show how this analysis was handled: model, cost and data checks',
                              support: 'Show how this reply was handled: speed, cost and safety checks',
                            })}
                          >
                            <Activity className="w-3 h-3" />
                            <span>{sp({ technical: 'Telemetry', business: 'Details' })}</span>
                          </button>
                          {onOpenRequestFlow && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenRequestFlow(msg.telemetry!);
                              }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-sans font-semibold text-[10px] transition cursor-pointer shadow-2xs"
                              title={sp({
                                technical: 'See every gateway policy this request passed through, in order',
                                analysts: 'See each check your question went through',
                                support: 'See each check this reply went through',
                              })}
                            >
                              <Workflow className="w-3 h-3 text-blue-600" />
                              <span>{sp({ technical: 'Request Flow', business: 'See the steps' })}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.telemetry && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-semibold ${
                          msg.telemetry.guardrailStatus === 'BLOCKED'
                            ? 'text-rose-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {msg.telemetry.guardrailStatus === 'BLOCKED'
                          ? sp({ technical: '🛡️ 400: Prompt Sanitization', analysts: '🛡️ Blocked to protect data', support: '🛡️ Blocked: not safe to send' })
                          : sp({ technical: '🛡️ Screened', analysts: '🛡️ Data protected', support: '🛡️ Safety checked' })}
                      </span>
                      <span>•</span>
                      <span>{msg.telemetry.latencyMs}ms</span>
                      {msg.telemetry.totalTokens && (
                        <>
                          <span>•</span>
                          <span>{msg.telemetry.totalTokens} tokens</span>
                        </>
                      )}
                      {msg.telemetry.cacheStatus === 'HIT' && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-600 font-bold">{sp({ technical: 'Cache Hit ($0)', analysts: 'Reused analysis ($0)', support: 'Reused reply ($0)' })}</span>
                        </>
                      )}
                      <span className="ml-auto opacity-60 text-[9px]">{msg.timestamp}</span>
                    </div>
                  )}

                  {isTokenQuotaAlert(msg.telemetry?.tokenQuota) && msg.telemetry?.tokenQuota && (
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      <span
                        data-token-quota-alert={msg.telemetry.tokenQuota.status}
                        title={msg.telemetry.tokenQuota.warning}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border font-sans font-semibold text-[9px] ${
                          msg.telemetry.tokenQuota.status === 'exhausted'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                      >
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>
                          {msg.telemetry.tokenQuota.status === 'exhausted'
                            ? sp({ technical: 'Quota exhausted: next call 429', business: 'Allowance used up' })
                            : sp({ technical: 'Quota near-threshold', business: 'Nearing allowance' })}
                          {' '}· {msg.telemetry.tokenQuota.usedPct}% used
                        </span>
                      </span>
                    </div>
                  )}

                  {/*
                    Which model the router picked.

                    Shown only for /auto, because that is the only case where the target
                    URL above does not already answer the question: a direct
                    /models/<name> call names its model in the path, so repeating it here
                    would be noise. `autoRouted` is false for those, and also false on an
                    unattributed cache hit, where no model ran at all - the Semantic Cache
                    card owns that story instead.
                  */}
                  {msg.telemetry?.autoRouted && msg.telemetry.model && (
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      <span
                        data-routed-model={msg.telemetry.model}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-purple-200 bg-purple-50 text-purple-700 font-sans font-semibold text-[9px]"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        <span className="uppercase tracking-wide opacity-70">{sp({ technical: 'Routed to', analysts: 'Analysed by', support: 'Answered by' })}</span>
                        <span className="font-mono">{msg.telemetry.model}</span>
                      </span>
                    </div>
                  )}
                </div>
                  </>
                );

                if (!selectable) {
                  return <div className={bubbleClass}>{body}</div>;
                }
                return (
                  <div
                    onClick={() => setActiveTelemetry(msg.telemetry!)}
                    className={bubbleClass}
                  >
                    {body}
                  </div>
                );
              })()}

              {msg.sender === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5 text-slate-700">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}

          {/* Prominent Loading / Sending Indicator with Target URL */}
          {loading && (
            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs space-y-2 animate-pulse shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-blue-700 font-semibold">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
                  <span>
                    {sp({
                      technical: `POST to AI Gateway (${settings.environment.toUpperCase()}), waiting for the response...`,
                      analysts: 'Working on your analysis...',
                      support: 'Drafting your reply...',
                    })}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 uppercase font-bold">
                  POST
                </span>
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-blue-200/80 font-mono text-[11px] text-slate-800 break-all select-all">
                <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-blue-700 font-semibold shrink-0">{sp({ technical: 'Endpoint:', business: 'Sent to:' })}</span>
                <span className="truncate text-slate-900 font-medium">
                  {activeSendingUrl || getGatewayTargetUrl(settings, settings.model)}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input & Quick Chips */}
        <div className="p-3 sm:p-3.5 bg-white/90 border-t border-slate-200 shrink-0 backdrop-blur">
          {/*
            All 6 Scenario Chips in Exact Required Order.
            The guided tour points here rather than at the empty-state card grid above,
            because that grid unmounts as soon as the first message lands - and by the
            time the tour is talking about scenarios, it usually has.
          */}
          <div
            data-tour-id="scenario-presets"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-2.5 no-scrollbar w-full"
          >
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider shrink-0 mr-1">{sp({ technical: 'Scenarios:', business: 'Try:' })}</span>
            {sampleChips.map((chip) => {
              const steps = chipSteps(chip.promptId);
              if (steps.length === 0) {
                return (
                  <button
                    key={chip.promptId}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-700 whitespace-nowrap transition cursor-pointer min-h-[32px] hover:bg-slate-200/70 shrink-0 ${chip.color}`}
                    title={chip.title}
                  >
                    {chip.label}
                  </button>
                );
              }
              const open = stepMenu?.id === chip.promptId;
              return (
                <div
                  key={chip.promptId}
                  onMouseEnter={(e) => scheduleOpenStepMenu(chip.promptId, e.currentTarget)}
                  onMouseLeave={scheduleCloseStepMenu}
                  className={`flex items-stretch rounded-full text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-700 whitespace-nowrap transition min-h-[32px] shrink-0 hover:bg-slate-200/70 ${chip.color} ${open ? 'ring-2 ring-blue-500/30' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setStepMenu(null);
                      clearMenuTimers();
                      handleChipClick(chip);
                    }}
                    className="pl-3 pr-1.5 py-1.5 cursor-pointer"
                    title={chip.title}
                  >
                    {chip.label}
                  </button>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label={sp({ technical: 'Pick a step to run', business: 'Choose which one to run' })}
                    onClick={(e) => {
                      const wrap = e.currentTarget.parentElement as HTMLElement;
                      if (open) setStepMenu(null);
                      else openStepMenu(chip.promptId, wrap);
                    }}
                    className="pr-2 pl-1 border-l border-slate-300/70 cursor-pointer flex items-center"
                  >
                    <ChevronDown className={`w-3 h-3 transition ${open ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              );
            })}
          </div>

          {stepMenu && (() => {
            const chip = sampleChips.find((c) => c.promptId === stepMenu.id);
            const steps = chipSteps(stepMenu.id);
            if (!chip || steps.length === 0) return null;
            return (
              <div
                role="menu"
                onMouseEnter={clearMenuTimers}
                onMouseLeave={scheduleCloseStepMenu}
                style={{ position: 'fixed', left: stepMenu.left, bottom: stepMenu.bottom }}
                className="z-50 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-1.5"
              >
                <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {sp({ technical: 'Run a step', business: 'Choose one to run' })}
                </div>
                {steps.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    disabled={loading}
                    onClick={(e) => {
                      setStepMenu(null);
                      s.run(e);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[11px] text-slate-800 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className="w-4 h-4 shrink-0 rounded-full bg-slate-100 border border-slate-200 text-[9px] font-bold flex items-center justify-center text-slate-600">
                      {i + 1}
                    </span>
                    <span className="flex-1">{s.label}</span>
                    {s.next && (
                      <span className="text-[9px] font-semibold px-1.5 py-px rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {sp({ technical: 'next', business: 'next' })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Prompt Input Form */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            {/* Prompt Text Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={sp({
                technical: 'Send a prompt through the gateway, or run a scenario chip above...',
                analysts: 'Ask a research or analysis question, or pick a scenario above...',
                support: 'Ask for a customer reply or a quick answer, or pick a scenario above...',
              })}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[44px]"
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={loading || !inputText.trim()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-medium shadow-xs transition flex items-center justify-center gap-1.5 text-xs sm:text-sm shrink-0 min-h-[44px] cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>

            {/* Reset Button next to Send */}
            <button
              type="button"
              onClick={handleReset}
              className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 hover:text-slate-900 rounded-xl font-medium shadow-xs transition flex items-center justify-center gap-1.5 text-xs sm:text-sm shrink-0 min-h-[44px] cursor-pointer"
              title={sp({
                technical: 'Clear the chat history, so the next call is sent without earlier turns',
                analysts: 'Clear this conversation and start a new analysis',
                support: 'Clear this conversation and start a new reply',
              })}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </form>

          {/* Active Status Footer */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-2 text-[10px] text-slate-500 font-mono">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span>
                {sp({ technical: 'Gateway', business: 'Environment' })}:{' '}
                <strong className="text-blue-600 uppercase font-semibold">
                  {sp({
                    technical: settings.environment,
                    business: settings.environment === 'dev' ? 'Sandbox' : settings.environment === 'prod' ? 'Live' : settings.environment,
                  })}
                </strong>
              </span>
              <span>•</span>
              <span>{sp({ technical: 'SSO', business: 'Signed in' })}: <strong className="text-slate-700 font-semibold">{ssoUser.name}</strong> <span className="text-slate-400">({effectiveEmail})</span></span>
              <span>•</span>
              <span>Persona: <strong className="text-slate-700 font-semibold">{customerTheme.industry !== 'generic' ? personaLabel(settings.activeUser) : activeUser.name}</strong></span>
              <span>•</span>
              <span>Model: <strong className="text-purple-600 font-semibold">{settings.model === 'auto' ? sp({ technical: 'auto (router picks)', business: 'Automatic' }) : settings.model}</strong></span>
              {settings.omitEmailHeader && (
                <>
                  <span>•</span>
                  <span className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200 flex items-center gap-1 font-medium">
                    <span>{sp({ technical: '⚠️ No identity header', business: '⚠️ Sign-in removed' })}</span>
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, omitEmailHeader: false }))}
                      className="underline text-rose-700 ml-0.5 hover:text-rose-900 cursor-pointer font-bold"
                    >
                      {sp({ technical: 'Restore Auth', business: 'Restore sign-in' })}
                    </button>
                  </span>
                </>
              )}
            </div>

            {/* Interactive Cache Toggle in Footer */}
            <button
              type="button"
              onClick={() => setSettings((prev) => ({ ...prev, useCache: !prev.useCache }))}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-semibold text-[10px] transition cursor-pointer border ${
                settings.useCache
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
              title={sp({
                technical: `use-cache header is ${settings.useCache ? 'sent (true): similar prompts can come back from cache at $0' : 'omitted: every call goes to the model'}. Click to toggle.`,
                analysts: `Reusing earlier answers is ${settings.useCache ? 'on: a similar question reuses an earlier analysis' : 'off: every question gets a fresh analysis'}. Click to change.`,
                support: `Reply reuse is ${settings.useCache ? 'on: similar questions reuse an earlier reply' : 'off: every question gets a fresh reply'}. Click to change.`,
              })}
            >
              <Zap className={`w-3 h-3 ${settings.useCache ? 'text-emerald-600 fill-emerald-500/30' : 'text-slate-400'}`} />
              <span>{sp({ technical: 'use-cache:', analysts: 'Answer reuse:', support: 'Reply reuse:' })}</span>
              <strong className={settings.useCache ? 'text-emerald-700 font-bold' : 'text-slate-500 font-normal'}>
                {settings.useCache ? sp({ technical: 'ON', business: 'On' }) : sp({ technical: 'OFF', business: 'Off' })}
              </strong>
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Clean Telemetry Inspector */}
      <div
        className={`w-full md:w-80 lg:w-96 surface-telemetry border-l border-slate-200 h-full overflow-hidden flex-col shrink-0 ${
          mobileTab === 'trace' ? 'flex flex-1' : 'hidden md:flex'
        }`}
      >
        <GatewayTraceViewer
          telemetry={activeTelemetry}
          settings={settings}
          isHistorical={isViewingHistoricalCall}
          onReturnToLatest={() => {
            const latest = messages.find((m) => m.id === latestTelemetryMessageId);
            if (latest?.telemetry) setActiveTelemetry(latest.telemetry);
          }}
          onToggleCache={() =>
            setSettings((prev) => ({ ...prev, useCache: !prev.useCache }))
          }
        />
      </div>
    </div>
  );
};
