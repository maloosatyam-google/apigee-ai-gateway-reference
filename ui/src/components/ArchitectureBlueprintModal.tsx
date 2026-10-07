import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Terminal,
  ShieldCheck,
  Database,
  Cpu,
  Coins,
  Key,
  Layers,
  ArrowRight,
  CheckCircle2,
  Zap,
  Server,
  Workflow,
  FileCode2,
  MessageSquare,
  ShieldAlert,
  Ban,
  Eye,
  Network,
  Info,
} from 'lucide-react';
import { GatewayTelemetry, McpTelemetry } from '../types';
import AgentFlowDiagram from './AgentFlowDiagram';
import { say, speak, usePersonaVoice, type Speaker } from '../utils/voice';
import { personaById } from '../utils/personas';
import { displayPersona } from '../utils/customerTheme';

interface ArchitectureBlueprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'ai-gateway' | 'mcp-gateway' | 'overview';
  initialMode?: 'request-flow' | 'full-blueprint';
  aiTelemetry?: GatewayTelemetry | null;
  mcpTelemetry?: McpTelemetry | null;
}

/** Persona display name for a telemetry key tier (the tier id itself is data, not copy). */
const PERSONA_FOR_KEY_TIER: Record<string, string> = { admin: 'admin', sales: 'sales_agent', loans: 'loans_agent' };
function personaLabelForKeyTier(keyTier: string | undefined): string {
  const personaId = PERSONA_FOR_KEY_TIER[keyTier || 'admin'];
  return personaId ? displayPersona(personaById(personaId)).label : 'Custom key';
}

/** One speaker's wording for a stage. */
interface StageCopy {
  title?: string;
  subtitle?: string;
  badge?: string;
  points?: string[];
}

interface ArchStage {
  id: string;
  step: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  icon: React.ReactNode;
  policies: {
    name: string;
    type: string;
    purpose: string;
    businessPurpose?: string;
    /** Per-speaker purpose, picked with speak(); purpose / businessPurpose are the fallback. */
    lines?: Partial<Record<Speaker, string>>;
  }[];
  talkingPoints: string[];
  /** Business-voice copy (Finance, AI CoE, Analysts, Customer Support & Sales). Technical fields above stay the source of truth. */
  businessTitle?: string;
  businessSubtitle?: string;
  businessBadge?: string;
  businessTalkingPoints?: string[];
  /**
   * Per-speaker copy (platform, finance, ai_coe, eng, analysts, support). The modal opens from
   * admin tabs and playground tabs, so every stage carries a line for all six; the technical
   * and business* fields above are the fallback.
   */
  lines?: Partial<Record<Speaker, StageCopy>>;
  liveStatus?: {
    label: string;
    status: 'pass' | 'hit' | 'warn' | 'block' | 'neutral';
    detail?: string;
  };
}

interface TerminationInfo {
  stoppedAtStep: string;
  stoppedAtTitle: string;
  reasonTitle: string;
  reasonDescription: string;
  badgeText: string;
  type: 'blocked-security' | 'blocked-quota' | 'cache-hit' | 'business-rule';
  skippedStages: string[];
}

export const ArchitectureBlueprintModal: React.FC<ArchitectureBlueprintModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'ai-gateway',
  initialMode = 'full-blueprint',
  aiTelemetry,
  mcpTelemetry,
}) => {
  const [activeFlow, setActiveFlow] = useState<'ai-gateway' | 'mcp-gateway' | 'overview'>(initialTab);
  const [viewMode, setViewMode] = useState<'request-flow' | 'full-blueprint'>(initialMode);
  const [selectedStageId, setSelectedStageId] = useState<string>('ai-router');
  const { voice, speaker, sp } = usePersonaVoice('active');

  // Derive live status flags from recent AI Gateway telemetry
  const aiStatus = aiTelemetry?.status || 200;
  const isAiCached = aiTelemetry?.cacheStatus === 'HIT';
  const isAiAutoRouted = aiTelemetry?.autoRouted === true;
  const isAiGuardrailBlocked =
    aiTelemetry?.guardrailStatus === 'BLOCKED' ||
    (aiStatus === 400 && (aiTelemetry?.guardrailMessage || '').length > 0);
  const isAiQuotaBlocked = aiStatus === 429;
  const isAiAuthBlocked = aiStatus === 401 || aiStatus === 403;
  const remainingTokens =
    aiTelemetry?.headersReceived?.['x-gateway-quota-remaining'] ||
    aiTelemetry?.headersReceived?.['x-ratelimit-remaining'];

  // Derive live status flags from recent MCP Gateway telemetry
  const mcpStatus = mcpTelemetry?.status || 200;
  // VerifyAPIKey answers 401 both for a bad key (step 01) and for a tool that is not an
  // operation on the key's product (step 02); the fault errorcode tells them apart.
  const mcpFaultCode = String(mcpTelemetry?.rawResponse?.fault?.detail?.errorcode || '');
  // A business rule in the REST proxy (e.g. refunds over $50) answers 403 with a JSON-RPC tool
  // error (result.isError, JSON in content[0].text) after steps 01-05 all passed. It is not a
  // Tools Filter denial, so parse the tool result defensively to tell the two 403s apart.
  const mcpToolResultBody: Record<string, any> | null = (() => {
    const rr = mcpTelemetry?.rawResponse;
    const text = rr?.result?.content?.[0]?.text;
    if (typeof text === 'string') {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Not JSON: fall through to the raw body.
      }
    }
    return rr && typeof rr === 'object' ? rr : null;
  })();
  const isMcpBusinessRule =
    mcpStatus === 403 &&
    (mcpToolResultBody?.error === 'REFUND_LIMIT' || mcpToolResultBody?.enforcedBy === 'Apigee');
  const mcpRefundRequested =
    typeof mcpToolResultBody?.requested === 'number' ? mcpToolResultBody.requested : undefined;
  const isMcpToolDenied =
    (mcpStatus === 401 && mcpFaultCode.includes('InvalidApiKeyForGivenResource')) ||
    (mcpStatus === 403 && !isMcpBusinessRule);
  const isMcpKeyBlocked = mcpStatus === 401 && !isMcpToolDenied;
  const isMcpRateBlocked = mcpStatus === 429;
  const isMcpBlockedAtGateway = isMcpKeyBlocked || isMcpToolDenied || isMcpRateBlocked;
  const mcpMethod = mcpTelemetry?.rawRequest?.method || 'JSON-RPC 2.0';
  const mcpToolName = mcpTelemetry?.rawRequest?.params?.name;

  useEffect(() => {
    if (isOpen) {
      setActiveFlow(initialTab);
      setViewMode(initialMode);

      // Automatically highlight the most relevant/stopping stage
      if (initialTab === 'ai-gateway' && aiTelemetry) {
        if (isAiAuthBlocked) setSelectedStageId('ai-auth');
        else if (isAiGuardrailBlocked) setSelectedStageId('ai-armor');
        else if (isAiCached) setSelectedStageId('ai-cache');
        else if (isAiQuotaBlocked) setSelectedStageId('ai-quota');
        else setSelectedStageId('ai-router');
      } else if (initialTab === 'mcp-gateway' && mcpTelemetry) {
        if (isMcpKeyBlocked) setSelectedStageId('mcp-auth');
        else if (isMcpToolDenied) setSelectedStageId('mcp-tools');
        else if (isMcpRateBlocked) setSelectedStageId('mcp-rate');
        else if (isMcpBusinessRule) setSelectedStageId('mcp-bridge');
        else setSelectedStageId('mcp-call');
      } else {
        setSelectedStageId(initialTab === 'mcp-gateway' ? 'mcp-tools' : 'ai-router');
      }
    }
  }, [
    isOpen,
    initialTab,
    initialMode,
    aiTelemetry,
    mcpTelemetry,
    isAiAuthBlocked,
    isAiGuardrailBlocked,
    isAiCached,
    isAiQuotaBlocked,
    isMcpKeyBlocked,
    isMcpToolDenied,
    isMcpRateBlocked,
    isMcpBusinessRule,
  ]);

  if (!isOpen) return null;

  const aiStages: ArchStage[] = [
    {
      id: 'ai-auth',
      step: '01',
      title: 'Access Control',
      subtitle: 'Model & Tool Access by User / Agent Permission',
      badge: 'Security & RBAC',
      badgeColor: 'bg-blue-100 text-blue-700 border-blue-300',
      icon: <Key className="w-4 h-4 text-blue-600" />,
      policies: [
        {
          name: 'DJWT-ExtractUserIdentity', type: 'DecodeJWT',
          purpose: 'Extracts user email identity from Cloud IAP / Bearer token for per-user attribution.',
          businessPurpose: 'Reads who you are from your sign-in, so usage is tied to you.',
          lines: {
            platform: 'PreFlow, first step. Decodes the IAP / bearer JWT into the user email (JWT only; no header fallback). No identity: 401.',
            finance: 'Reads who is asking, so every cost is charged to a named person and team.',
            ai_coe: 'Reads who is asking, so model use can be tracked per person and team.',
            eng: 'Decodes your bearer JWT for per-user attribution. No JWT with an email claim: 401.',
            analysts: 'Reads who you are from your sign-in, so your requests stay tied to you.',
            support: 'Reads who you are from your sign-in, so each reply can be traced to you.',
          },
        },
        {
          name: 'VA-VerifyAPIKey', type: 'VerifyAPIKey',
          purpose: 'Validates consumer key & loads the persona API Product (Engineering & IT, Analysts, Customer Support & Sales).',
          businessPurpose: 'Checks your access key and loads your persona (Engineering & IT, Analysts, Customer Support & Sales).',
          lines: {
            platform: 'Validates the consumer key and loads the persona API product: models, token quota, routing attributes. Invalid key: 401.',
            finance: 'Checks the team’s access key and loads its budget and usage limit.',
            ai_coe: 'Checks the team’s access key and loads its approved models and usage limit.',
            eng: 'Checks your API key and loads your API product: allowed models, token quota, routing map. Bad key: 401.',
            analysts: 'Checks your team’s access key and loads the models approved for you.',
            support: 'Checks your team’s access key and loads the models approved for replies.',
          },
        },
        {
          name: 'OAS-ValidateRequest', type: 'OASValidation',
          purpose: 'Validates incoming OpenAPI 3.0 request structure and enforces named model entitlements.',
          businessPurpose: 'Checks the request is well formed and asks only for models your persona may use.',
          lines: {
            platform: 'Validates the body against the OpenAPI 3.0 spec and the product’s named models. Rejects before any target call.',
            finance: 'Refuses requests for models the team has not been given, before they cost anything.',
            ai_coe: 'Enforces each persona’s approved model list: anything outside it is refused.',
            eng: 'Checks your body against the OpenAPI spec and that the model is on your product. Fails before any model call.',
            analysts: 'Checks the request is well formed and only asks for an approved model.',
            support: 'Checks the request is well formed and only uses an approved model.',
          },
        },
      ],
      talkingPoints: [
        'Every request resolves user identity first from the JWT, failing closed with HTTP 401 if missing.',
        'Model entitlements are strictly named in the API Product (no wildcard *), preventing unauthorized use of costly models.',
        'Extracts developer & user email identity for downstream cost attribution and prepaid wallet debiting.',
      ],
      businessTitle: 'Checks who you are',
      businessSubtitle: 'And which AI models your team may use',
      businessBadge: 'Access',
      businessTalkingPoints: [
        'Every request must say who is asking. Requests with no identity are turned away.',
        'Each persona has a named list of models, so nobody can use a costly model they were not given.',
        'Knowing who asked lets every cost be charged back to the right person and team.',
      ],
      lines: {
        platform: {
          title: 'Access Control',
          subtitle: 'JWT identity, key and model entitlement, fail closed',
          badge: 'Security & RBAC',
          points: [
            'Runs first in PreFlow: identity, then key, then OAS check. Any failure returns 401 and nothing downstream runs.',
            'Models are named on each persona API product (no wildcard). Change them on the product in Dev, then Prod; no proxy redeploy.',
            'A bad product edit only affects that persona. Watch the 401 rate in Analytics after a change.',
          ],
        },
        finance: {
          title: 'Checks who is spending',
          subtitle: 'So every cost has an owner',
          badge: 'Cost ownership',
          points: [
            'Every request is tied to a person and team before anything is spent, so all AI spend can be charged back.',
            'Requests with no identity are refused and cost nothing.',
            'Teams can only use the models on their list, so nobody runs up a bill on a premium model they were not given.',
          ],
        },
        ai_coe: {
          title: 'Checks who may use which model',
          subtitle: 'Each persona’s approved model list',
          badge: 'Model access',
          points: [
            'Each persona has an explicit list of approved models. There is no “any model” option.',
            'A request for a model outside the list is refused before it reaches any provider.',
            'Changing a team’s list is a settings change, so access decisions take effect without an IT project.',
          ],
        },
        eng: {
          title: 'Key & model check',
          subtitle: 'Your API key and the model you asked for',
          badge: 'Auth: 401',
          points: [
            'Send your API key plus a bearer JWT. A missing JWT or a missing or bad key returns 401 before anything else runs.',
            'Asking for a model that is not on your API product is rejected. Call /auto if you would rather not manage model names.',
            'Requests rejected here cost nothing and use none of your token quota.',
          ],
        },
        analysts: {
          title: 'Checks who you are',
          subtitle: 'Only approved people reach the AI models',
          badge: 'Access',
          points: [
            'Every question is tied to your sign-in, so nobody else can use the AI in your name.',
            'Only models approved for your team are used, so your work never goes to an unapproved AI service.',
            'Requests with no identity are turned away before any data leaves the company.',
          ],
        },
        support: {
          title: 'Checks who you are',
          subtitle: 'And which AI models your team may use',
          badge: 'Access',
          points: [
            'Every reply is tied to your sign-in, so what goes to a customer can be traced if anyone asks.',
            'Your team uses approved models chosen for fast, low-cost replies.',
            'Requests with no identity are turned away straight away, at no cost.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? isAiAuthBlocked
          ? {
              label: `BLOCKED (${aiStatus})`,
              status: 'block',
              detail: sp({
                technical: 'Unauthorized key or model entitlement rejected',
                platform: 'VA-VerifyAPIKey or OAS-ValidateRequest failed closed',
                finance: 'Refused before any spend: key or model not allowed',
                ai_coe: 'Refused: key not accepted or model not approved',
                eng: 'Check your API key, or the model is not on your product',
                analysts: 'Access key not accepted, or this model is not approved',
                support: 'Access key not accepted, or this model is not approved',
              }),
            }
          : { label: say(voice, 'VERIFIED', 'ALLOWED'), status: 'pass', detail: `Persona: ${personaLabelForKeyTier(aiTelemetry.keyTier)}` }
        : undefined,
    },
    {
      id: 'ai-armor',
      step: '02',
      title: 'Prompt Sanitization',
      subtitle: 'Prompt Injection, Jailbreak & PII Defense',
      badge: 'Safety Perimeter',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-300',
      icon: <ShieldCheck className="w-4 h-4 text-emerald-600" />,
      policies: [
        {
          name: 'SUP-UserPrompt', type: 'SanitizeUserPrompt',
          purpose: 'Scans incoming prompt against Google Cloud Model Armor template before any LLM invocation.',
          businessPurpose: 'Screens your prompt for unsafe content before any AI model sees it.',
          lines: {
            platform: 'Request flow. Scans the prompt against the Model Armor template before any target call. Violation: 400, no tokens spent.',
            finance: 'Stops unsafe prompts before they reach a paid model, so they cost nothing.',
            ai_coe: 'Applies the company Model Armor safety template to every prompt, for every model.',
            eng: 'Screens your prompt with Model Armor before any model call. A violation returns 400 with the reason.',
            analysts: 'Screens your question for confidential or personal data before any AI model sees it.',
            support: 'Screens the question for unsafe content before any AI model sees it.',
          },
        },
        {
          name: 'SMR-SanitizeModelResponse', type: 'SanitizeModelResponse',
          purpose: 'Inspects LLM output in the response flow to redact sensitive PII or unsafe completions.',
          businessPurpose: 'Screens the answer and hides personal data or unsafe text.',
          lines: {
            platform: 'Response flow. Runs the same template over the model output and redacts PII or unsafe completions.',
            finance: 'Screens answers too, reducing the risk of costly data or conduct incidents.',
            ai_coe: 'Screens every model’s answer with the same template, so safety does not depend on the provider.',
            eng: 'Screens the model output in the response flow; flagged PII or unsafe text is redacted before you get it.',
            analysts: 'Screens the answer and hides personal data before it reaches you.',
            support: 'Screens the answer and hides personal data or unsafe text, so it is safe to send.',
          },
        },
      ],
      talkingPoints: [
        'Inspects prompts at the API edge before spending a single LLM token.',
        'Detects prompt injection, jailbreak attempts, and sensitive PII leakage uniformly across Gemini & Claude.',
        'Eliminates model-specific safety gaps by enforcing a single enterprise Model Armor template.',
      ],
      businessTitle: 'Screens the prompt',
      businessSubtitle: 'Stops unsafe requests and personal data leaks',
      businessBadge: 'Safety',
      businessTalkingPoints: [
        'Unsafe prompts are stopped before they cost anything.',
        'Attempts to trick the AI, and leaks of personal data, are caught the same way for every model.',
        'One safety standard for the whole company, whichever AI provider answers.',
      ],
      lines: {
        platform: {
          title: 'Prompt Sanitization',
          subtitle: 'Model Armor on request and response flows',
          badge: 'Safety Perimeter',
          points: [
            'SUP-UserPrompt runs before the cache and any target call; a violation returns HTTP 400 and spends no tokens.',
            'One Model Armor template covers Gemini and Claude. Tune the template, not the proxy, to change what is caught.',
            'A too-strict template shows up as a jump in 400s for every persona: test template changes in Dev first.',
          ],
        },
        finance: {
          title: 'Blocks unsafe prompts',
          subtitle: 'Before any paid model is used',
          badge: 'No spend on risk',
          points: [
            'Unsafe prompts are stopped before any model runs, so they cost nothing.',
            'Screening answers as well reduces the risk of costly data leaks.',
            'One safety check covers every provider, so there is no separate tool to pay for per model.',
          ],
        },
        ai_coe: {
          title: 'Screens prompts and answers',
          subtitle: 'One safety template for every model',
          badge: 'Responsible AI',
          points: [
            'Prompt injection, jailbreaks and personal data are caught the same way for Gemini and Claude.',
            'Answers are screened too, so safety does not depend on which model was chosen.',
            'The safety policy is set once, centrally, and applies to every team.',
          ],
        },
        eng: {
          title: 'Prompt screening',
          subtitle: 'Model Armor before your prompt reaches a model',
          badge: 'Blocked: 400',
          points: [
            'A blocked prompt returns HTTP 400 with the reason in the body. Nothing is spent and no quota is used.',
            'The same screen applies whichever model you or /auto picked, so you do not build your own filters.',
            'Model output is screened too; flagged PII is redacted before the response reaches you.',
          ],
        },
        analysts: {
          title: 'Protects your data',
          subtitle: 'Screens questions and answers for sensitive data',
          badge: 'Data protection',
          points: [
            'Your question is screened for personal and confidential data before any AI model sees it.',
            'Answers are screened as well, and personal data is hidden before it reaches you.',
            'The same protection applies whichever AI provider answers.',
          ],
        },
        support: {
          title: 'Keeps replies safe',
          subtitle: 'Screens questions and answers before you send',
          badge: 'Safe to send',
          points: [
            'Questions are screened for unsafe content before any AI model sees them.',
            'Answers are screened too, and personal data is hidden, so replies are safe to send to customers.',
            'Blocked requests come back straight away and cost nothing.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? isAiGuardrailBlocked
          ? {
              label: say(voice, 'BLOCKED BY PROMPT SANITIZATION', 'BLOCKED AS UNSAFE'),
              status: 'block',
              detail:
                aiTelemetry.guardrailMessage ||
                sp({
                  technical: 'Malicious / destructive prompt blocked at perimeter',
                  platform: 'SUP-UserPrompt raised a 400 before any target call',
                  finance: 'Unsafe prompt stopped before any spend',
                  ai_coe: 'Unsafe prompt stopped by the safety template',
                  eng: 'HTTP 400 from Model Armor; no tokens used',
                  analysts: 'Stopped before any model saw it',
                  support: 'Unsafe prompt stopped before any model saw it',
                }),
            }
          : {
              label: say(voice, 'PASSED SAFE', 'SAFE'),
              status: 'pass',
              detail: sp({
                technical: 'Zero prompt injection / jailbreak threats',
                platform: 'Model Armor template passed',
                finance: 'Passed the safety screen',
                ai_coe: 'No injection, jailbreak or personal data found',
                eng: 'No injection or jailbreak detected',
                analysts: 'No sensitive data found',
                support: 'No unsafe content found',
              }),
            }
        : undefined,
    },
    {
      id: 'ai-cache',
      step: '03',
      title: 'Semantic Cache',
      subtitle: 'Semantic Vector Similarity Matching (<100ms)',
      badge: 'Latency & Cost Saver',
      badgeColor: 'bg-purple-100 text-purple-700 border-purple-300',
      icon: <Database className="w-4 h-4 text-purple-600" />,
      policies: [
        {
          name: 'SCL-Semantic-Cache-Lookup', type: 'SemanticCacheLookup',
          purpose: 'Computes embeddings for incoming prompt and queries vector cache store for high-similarity matches.',
          businessPurpose: 'Looks for an earlier answer to a question that means the same thing.',
          lines: {
            platform: 'Embeds the prompt and queries the vector store. A hit short-circuits routing, quota and the target call.',
            finance: 'Looks for an earlier answer to the same question. A match costs $0.',
            ai_coe: 'Looks for an earlier answer with the same meaning, so no model needs to run.',
            eng: 'Embeds your prompt and checks the vector cache. On a hit you get the stored response and x-gateway-cached: true.',
            analysts: 'Looks for an earlier finished answer to a question with the same meaning.',
            support: 'Looks for an earlier answer to the same customer question, so the reply is instant.',
          },
        },
        {
          name: 'SCP-Semantic-Cache-Populate', type: 'SemanticCachePopulate',
          purpose: 'Stores downstream LLM responses in cache on cache miss for subsequent similar queries.',
          businessPurpose: 'Saves new answers so the next similar question is free.',
          lines: {
            platform: 'Response flow, on a miss only. Writes the model response to the vector store for later similar prompts.',
            finance: 'Saves each new answer, so the next similar question costs nothing.',
            ai_coe: 'Saves new answers for reuse, reducing load on the models.',
            eng: 'On a miss, stores the model response so the next similar prompt is served from cache.',
            analysts: 'Saves the finished answer so the next similar question is answered instantly.',
            support: 'Saves new answers so the next customer asking the same thing gets a fast reply.',
          },
        },
      ],
      talkingPoints: [
        'Unlike exact-match HTTP caching, Semantic Caching matches intent using vector similarity.',
        'On a Cache HIT, the gateway returns the response in ~60-90ms with $0.00 upstream model cost and 0 token quota consumption.',
        'Ideal for repetitive FAQ, customer support, and agentic reasoning loops.',
      ],
      businessTitle: 'Reuses a previous answer',
      businessSubtitle: 'If a similar question was already answered',
      businessBadge: 'Saves time & cost',
      businessTalkingPoints: [
        'Matches on meaning, not exact words, so reworded questions still count.',
        'A reused answer comes back in well under a second, costs nothing and uses none of your limit.',
        'Best for repeated questions: FAQs, customer support and routine lookups.',
      ],
      lines: {
        platform: {
          title: 'Semantic Cache',
          subtitle: 'Vector similarity lookup before routing and quota',
          badge: 'Latency & Cost Saver',
          points: [
            'Lookup runs after sanitization and before the router, so a hit skips routing, quota and the target entirely.',
            'Matching is by embedding similarity; the threshold and TTL are set on the cache policies.',
            'If the cache is unavailable the request carries on to the model: slower and paid, but not failed.',
          ],
        },
        finance: {
          title: 'Reuses answers for free',
          subtitle: 'Repeat questions cost $0',
          badge: 'Cost saver',
          points: [
            'A reused answer costs $0 in model fees and comes off nobody’s budget.',
            'Matches on meaning, so reworded repeat questions are saved too.',
            'The biggest savings come from repeated work: FAQs, support replies and routine lookups.',
          ],
        },
        ai_coe: {
          title: 'Reuses a previous answer',
          subtitle: 'Same meaning, no model needed',
          badge: 'Answer reuse',
          points: [
            'Questions with the same meaning get the earlier answer; no model runs and no model is credited.',
            'Reused answers already passed the safety screen when they were first produced.',
            'Reuse frees model capacity for the work that needs it.',
          ],
        },
        eng: {
          title: 'Semantic cache',
          subtitle: 'Similar prompt seen before? ~60-90 ms, $0',
          badge: 'Cache hit: $0',
          points: [
            'A hit returns in roughly 60-90 ms with x-gateway-cached: true, $0 cost and no token quota used.',
            'Matching is on meaning (embeddings), not the exact string, so reworded prompts can hit.',
            'On a hit no model is reported: the router never ran. Turn caching off in settings to force a model call.',
          ],
        },
        analysts: {
          title: 'Reuses a previous answer',
          subtitle: 'If the same question was already answered',
          badge: 'Instant answers',
          points: [
            'If a question with the same meaning was answered before, you get that answer instantly.',
            'Only the finished answer is reused; no AI model sees your question again.',
            'Turn answer reuse off in settings when you need a fresh analysis.',
          ],
        },
        support: {
          title: 'Reuses a previous answer',
          subtitle: 'Repeat customer questions answered instantly',
          badge: 'Fast replies',
          points: [
            'Common customer questions get an earlier, already-screened answer in well under a second.',
            'Matches on meaning, so different wording from different customers still counts.',
            'Reused replies cost nothing, so busy days do not mean bigger bills.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? isAiCached
          ? {
              label: say(voice, `CACHE HIT (${aiTelemetry.latencyMs} ms)`, `REUSED (${aiTelemetry.latencyMs} ms)`),
              status: 'hit',
              detail: sp({
                technical: 'Served from Semantic Cache ($0 upstream cost)',
                platform: 'SCL hit; router, quota and target skipped',
                finance: 'Earlier answer reused, $0 model cost',
                ai_coe: 'Earlier answer reused, no model used',
                eng: 'Cache hit: $0, no quota used',
                analysts: 'Earlier answer reused instantly',
                support: 'Earlier answer reused, instant reply',
              }),
            }
          : {
              label: say(voice, `CACHE ${aiTelemetry.cacheStatus || 'BYPASSED'}`, 'NEW ANSWER'),
              status: 'neutral',
              detail: sp({
                technical: 'Forwarded to upstream model & cached on response',
                platform: 'Miss: routed upstream, SCP populates on response',
                finance: 'New answer: paid model used, saved for reuse',
                ai_coe: 'Sent to a model; answer saved for reuse',
                eng: 'Miss: sent to a model, response cached',
                analysts: 'Fresh answer from a model, saved for reuse',
                support: 'New reply from a model, saved for reuse',
              }),
            }
        : undefined,
    },
    {
      id: 'ai-router',
      step: '04',
      title: 'Smart Routing',
      subtitle: 'Dynamic Routing Across Providers & Private Models (/auto)',
      badge: 'Intelligent Routing',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
      icon: <Cpu className="w-4 h-4 text-amber-600" />,
      policies: [
        {
          name: 'KVM-GetRouterCredentials', type: 'KeyValueMapOperations',
          purpose: 'Reads the router API key from the encrypted ai-gateway-creds KVM into a private.* variable, so the secret never appears in the bundle, trace, or logs.',
          businessPurpose: 'Fetches the router’s secret from encrypted storage; it never shows in logs.',
          lines: {
            platform: 'Reads the router key from the encrypted ai-gateway-creds KVM into a private.* variable. Rotate it in the KVM; no redeploy.',
            finance: 'Fetches the router’s key from encrypted storage, so no one can use it outside the gateway.',
            ai_coe: 'Keeps the router’s credentials in encrypted storage, never in code or logs.',
            eng: 'Loads the router key from an encrypted KVM. You never handle it and it never appears in trace.',
            analysts: 'Keeps the router’s key in encrypted storage; it never appears in logs.',
            support: 'Keeps the router’s key in encrypted storage; it never appears in logs.',
          },
        },
        {
          name: 'AM-PrepRouterRequest', type: 'AssignMessage',
          purpose: 'Builds the classifier request natively (no JavaScript): the user prompt plus a choice question constraining the answer to coding | deep_reasoning | simple | general.',
          businessPurpose: 'Asks the router one question: is this coding, deep reasoning, simple or general?',
          lines: {
            platform: 'Builds the classifier request natively: the prompt plus a choice of coding | deep_reasoning | simple | general.',
            finance: 'Asks the router what kind of work this is, so cheap models handle simple work.',
            ai_coe: 'Asks the router to sort the request: coding, deep reasoning, simple or general.',
            eng: 'Builds the classifier call from your prompt; the answer is one of coding | deep_reasoning | simple | general.',
            analysts: 'Asks the router whether this is deep reasoning, coding, simple or general.',
            support: 'Asks the router whether this is a simple question or something harder.',
          },
        },
        {
          name: 'SC-ModelRouter', type: 'ServiceCallout',
          purpose: 'Calls the TypeSafe AI JEV System One router model to classify the prompt. Runs only on a cache miss (AutoRoutingFlow, after the semantic cache lookup); 2.5s timeout and continue-on-error, so a router blip degrades to the product default instead of failing the request.',
          businessPurpose: 'A small router model sorts the request. If it is slow, your persona’s default model is used instead.',
          lines: {
            platform: 'Calls the JEV System One router on a cache miss only. 2.5s timeout, continue-on-error: a router outage falls back to the product default.',
            finance: 'A small, low-cost router model sorts the request, only when no earlier answer exists.',
            ai_coe: 'The JEV System One router classifies intent. If it is slow, the persona’s default model is used.',
            eng: 'Classifies your prompt (cache miss only). If the router times out after 2.5s you get the product default model, not an error.',
            analysts: 'A small router model sorts your question. If it is slow, your team’s default model answers.',
            support: 'A small router model sorts the question quickly. If it is slow, the default model answers.',
          },
        },
        {
          name: 'JS-AutoRouting', type: 'JavaScript',
          purpose: 'Maps the returned category to a concrete model using the API Product’s routing.model.* custom attributes. Holds no model names of its own.',
          businessPurpose: 'Looks up which model your persona uses for that kind of request.',
          lines: {
            platform: 'Maps the category to a model via the product’s routing.model.* attributes. Change routing on the product, not in code.',
            finance: 'Picks the model the team has been assigned for that kind of work.',
            ai_coe: 'Applies your routing choices: the model each persona uses for each kind of work.',
            eng: 'Maps the category to a model from your API product’s routing.model.* attributes. No model names in code.',
            analysts: 'Looks up which model your team uses for that kind of question.',
            support: 'Looks up which model your team uses for that kind of question.',
          },
        },
        {
          name: 'AM-RouteGeminiTarget', type: 'AssignMessage',
          purpose: 'Routes request to Vertex AI Gemini endpoint.',
          businessPurpose: 'Sends the request to the chosen Gemini model.',
          lines: {
            platform: 'Sets the Vertex AI Gemini target for the model the router picked.',
            finance: 'Sends the request to the chosen Gemini model, from low-cost Flash-Lite to Pro.',
            ai_coe: 'Sends the request to the chosen Gemini model.',
            eng: 'Targets Vertex AI Gemini; see x-gateway-model for the model used.',
            analysts: 'Sends your question to the chosen Gemini model.',
            support: 'Sends the question to the chosen Gemini model.',
          },
        },
        {
          name: 'AM-RouteClaudeTarget', type: 'AssignMessage',
          purpose: 'Routes coding prompts to Anthropic Claude on Vertex when the persona product maps coding to Claude.',
          businessPurpose: 'Sends coding work to Claude when your persona uses it (Opus for Engineering & IT, Haiku for Customer Support & Sales).',
          lines: {
            platform: 'Sets the Claude on Vertex target when the product maps coding to Claude.',
            finance: 'Sends coding work to Claude: premium Opus for Engineering & IT, low-cost Haiku for Customer Support & Sales.',
            ai_coe: 'Sends coding work to Claude where you chose it: Opus for Engineering & IT, Haiku for Customer Support & Sales.',
            eng: 'Coding prompts go to Claude Opus on Vertex for Engineering & IT, same endpoint and key.',
            analysts: 'Sends coding work to Claude when your team uses it.',
            support: 'Sends coding questions to Claude Haiku, a fast, low-cost model.',
          },
        },
      ],
      talkingPoints: [
        'Developers call a single logical endpoint (/ai/v1/auto) without hardcoding model versions.',
        'Persona-aware routing: each persona product maps the router category to its own model, e.g. coding goes to Claude Opus (Engineering & IT), Gemini Pro (Analysts) or Claude Haiku (Customer Support & Sales).',
        'The TypeSafe AI JEV System One router classifies each prompt on intent (only on a cache miss), so coding work lands on Claude Opus 4.5 and trivial lookups on low-cost Flash-Lite.',
        'The category-to-model map lives on the API Product, so entitlements and model choices change without redeploying the proxy.',
      ],
      businessTitle: 'Picks the right model',
      businessSubtitle: 'The cheapest model that can do the job',
      businessBadge: 'Automatic model choice',
      businessTalkingPoints: [
        'Users just ask. Nobody has to know or pick a model name.',
        'Each persona has its own choices, e.g. coding goes to Claude Opus (Engineering & IT), Gemini Pro (Analysts) or Claude Haiku (Customer Support & Sales).',
        'Simple questions go to low-cost models; hard coding work goes to the strongest one.',
        'Admins change which model each persona uses in settings, with no IT project.',
      ],
      lines: {
        platform: {
          title: 'Smart Routing',
          subtitle: 'AutoRoutingFlow: router callout + product routing map',
          badge: 'Intelligent Routing',
          points: [
            'AutoRoutingFlow runs on /auto after a cache miss: KVM creds, classifier request, router callout, then JS-AutoRouting.',
            'Router failure is non-fatal: 2.5s timeout with continue-on-error falls back to the product’s default model.',
            'Category-to-model maps are routing.model.* attributes on each persona product. Edit in Dev, verify, then promote; no redeploy.',
          ],
        },
        finance: {
          title: 'Picks the cheapest fit',
          subtitle: 'Low-cost models for simple work',
          badge: 'Spend optimiser',
          points: [
            'Simple questions go to low-cost Flash-Lite; only hard work goes to premium models like Claude Opus.',
            'Each team’s model choices set its cost profile, e.g. Claude Haiku keeps Customer Support & Sales replies cheap.',
            'Routing only runs when there is no reusable answer, so reuse savings come first.',
          ],
        },
        ai_coe: {
          title: 'Applies your model strategy',
          subtitle: 'Which model each persona uses for each task',
          badge: 'Model strategy',
          points: [
            'A router sorts each request: coding, deep reasoning, simple or general.',
            'Your map picks the model per persona, e.g. coding: Claude Opus (Engineering & IT), Gemini Pro (Analysts), Claude Haiku (Customer Support & Sales).',
            'Change a persona’s models in settings; users keep asking the same way.',
            'If the router is slow, the persona’s default model answers, so users are not blocked.',
          ],
        },
        eng: {
          title: 'Auto-routing (/auto)',
          subtitle: 'One endpoint; the gateway picks the model',
          badge: 'x-gateway-model',
          points: [
            'Call /ai/v1/auto without a model. The response headers x-gateway-model and x-gateway-provider tell you what answered.',
            'Coding prompts go to Claude Opus 4.5 for Engineering & IT; trivial lookups go to low-cost Flash-Lite.',
            'Router down or slow? You get the product default model after 2.5s, not an error.',
            'Model changes happen on the gateway, so your code does not change when models do.',
          ],
        },
        analysts: {
          title: 'Picks the right model',
          subtitle: 'Deep questions get a stronger model',
          badge: 'Automatic model choice',
          points: [
            'You just ask. The gateway decides how much reasoning the question needs.',
            'Deep analysis goes to Gemini Pro; quick lookups go to a fast, low-cost model.',
            'Every model used is company-approved, so your data only goes where it is allowed.',
          ],
        },
        support: {
          title: 'Picks the right model',
          subtitle: 'Fast, low-cost models for everyday replies',
          badge: 'Automatic model choice',
          points: [
            'You just ask. Everyday questions go to a fast, low-cost model.',
            'Technical questions go to Claude Haiku, still quick and cheap per reply.',
            'Every reply shows which model wrote it.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? {
            label: isAiAutoRouted
              ? say(voice, `AUTO: ${aiTelemetry.model}`, `CHOSEN: ${aiTelemetry.model}`)
              : say(voice, `DIRECT: ${aiTelemetry.model}`, `ASKED FOR: ${aiTelemetry.model}`),
            status: isAiAutoRouted ? 'hit' : 'pass',
            detail: `Provider: ${aiTelemetry.provider || 'Google'} (${aiTelemetry.intent || 'general'})`,
          }
        : undefined,
    },
    {
      id: 'ai-quota',
      step: '05',
      title: 'Tokenomics',
      subtitle: 'Product-Driven Token Limits & Per-Minute Budgets',
      badge: 'FinOps Governance',
      badgeColor: 'bg-rose-100 text-rose-700 border-rose-300',
      icon: <Coins className="w-4 h-4 text-rose-600" />,
      policies: [
        {
          name: 'LTQ-TokenEnforce', type: 'LLMTokenQuota (LLMTokenLimitFlow, AutoRoutingFlow)',
          purpose: 'Checks accumulated token consumption against verifyapikey.VA-VerifyAPIKey.apiproduct.developer.llmQuota.limit.',
          businessPurpose: 'Checks your usage so far against your persona’s limit.',
          lines: {
            platform: 'Checks the token counter against the product’s llmQuota.limit. Over the limit: 429 with reset time.',
            finance: 'Checks the team’s usage against its limit before any model runs.',
            ai_coe: 'Enforces each persona’s usage limit, so access stays fair across teams.',
            eng: 'Checks your token usage against your product quota. Over it: 429; the reset time is in the response.',
            analysts: 'Checks your team’s usage so far against its limit.',
            support: 'Checks your team’s usage so far against its limit.',
          },
        },
        {
          name: 'LTQ-TokenCount', type: 'LLMTokenQuota (PostFlow)',
          purpose: 'Extracts exact totalTokenCount from LLM response and increments the distributed token counter.',
          businessPurpose: 'Counts exactly how much this answer used.',
          lines: {
            platform: 'PostFlow. Reads totalTokenCount from the model response and increments the distributed counter.',
            finance: 'Counts exactly how much AI usage this answer consumed.',
            ai_coe: 'Counts the tokens each answer used, per persona and model.',
            eng: 'Counts the real tokens from the model response; see x-gateway-total-tokens.',
            analysts: 'Counts exactly how much this answer used.',
            support: 'Counts exactly how much this reply used.',
          },
        },
        {
          name: 'QC-EnforceBudgetLimit', type: 'Quota (PreFlow, EnforceOnly)',
          purpose: 'Checks the per-developer USD budget counter (developer.budget.* product attributes); RF-BudgetExceeded raises the 429.',
          businessPurpose: 'Stops the request if your monthly budget is used up.',
          lines: {
            platform: 'PreFlow, enforce only. Checks the USD budget counter from developer.budget.* attributes; RF-BudgetExceeded returns 429.',
            finance: 'Stops the request once the monthly budget is used up, so there is no overspend.',
            ai_coe: 'Pauses a team once its monthly budget is used up.',
            eng: 'Checks your USD budget before the call. Exhausted budget: 429 from RF-BudgetExceeded.',
            analysts: 'Pauses requests if your team’s monthly budget is used up.',
            support: 'Pauses requests if your team’s monthly budget is used up.',
          },
        },
        {
          name: 'QC-DeductBudget', type: 'Quota (PostFlow)',
          purpose: 'Spends the real request cost in micro-dollars against the budget counter; skipped on semantic-cache hits.',
          businessPurpose: 'Takes the real cost off your budget. Reused answers cost nothing.',
          lines: {
            platform: 'PostFlow. Spends the request cost in micro-dollars against the budget counter; skipped on cache hits.',
            finance: 'Takes the exact cost off the team’s budget. Reused answers are not charged.',
            ai_coe: 'Charges the real cost to the team’s budget; reused answers are free.',
            eng: 'Deducts the actual cost (micro-dollars) from your budget after the call; cache hits are free.',
            analysts: 'Takes the real cost off your team’s budget. Reused answers cost nothing.',
            support: 'Takes the real cost off your team’s budget. Reused replies cost nothing.',
          },
        },
        {
          name: 'MLC-EnforceMonetizationLimits', type: 'MonetizationLimitsCheck',
          purpose: 'Verifies prepaid wallet balance and active rate plan subscription.',
          businessPurpose: 'Checks your prepaid credit and billing plan are active.',
          lines: {
            platform: 'Checks the developer has an active rate plan subscription and prepaid balance. Fails the request if not.',
            finance: 'Checks the team has prepaid credit and an active billing plan before any spend.',
            ai_coe: 'Checks the team’s billing plan is active before it can use the models.',
            eng: 'Checks your app has an active rate plan and prepaid balance; if not, the call is refused.',
            analysts: 'Checks your team’s prepaid credit and billing plan are active.',
            support: 'Checks your team’s prepaid credit and billing plan are active.',
          },
        },
      ],
      talkingPoints: [
        'Traditional API gateways rate-limit by HTTP requests/min, which fails when 1 prompt can consume 50 tokens or 50,000 tokens.',
        'Token limits are read dynamically from the API Product configuration — never hardcoded in policy XML.',
        'When a persona exceeds its token budget, the gateway returns HTTP 429 with exact reset telemetry.',
      ],
      businessTitle: 'Counts usage and spend',
      businessSubtitle: 'Against your team’s limit and budget',
      businessBadge: 'Cost control',
      businessTalkingPoints: [
        'Limits are set on actual AI usage, not request count: one question can use a thousand times more than another.',
        'Each persona’s limit and budget are set by admins, with no code changes.',
        'When a team hits its limit, requests pause until it resets, so there are no surprise bills.',
      ],
      lines: {
        platform: {
          title: 'Tokenomics',
          subtitle: 'Token quota + USD budget, read from the API product',
          badge: 'FinOps Governance',
          points: [
            'Enforce in the request flow (token quota, USD budget, rate plan), count and deduct in PostFlow. Any limit hit returns 429.',
            'Limits come from API product attributes, never from policy XML: change them per product, Dev before Prod.',
            'Counters are distributed across the runtime; cache hits skip the deduction so they never consume quota.',
          ],
        },
        finance: {
          title: 'Counts and caps spend',
          subtitle: 'Against each team’s limit and monthly budget',
          badge: 'Cost control',
          points: [
            'Every request is costed in real money and taken off the team’s monthly budget.',
            'When a budget or limit runs out, requests pause before any spend, so there are no surprise bills.',
            'Budgets, limits and prepaid credit are set in settings, with no code changes.',
          ],
        },
        ai_coe: {
          title: 'Keeps usage fair',
          subtitle: 'Usage limits per persona',
          badge: 'Fair use',
          points: [
            'Limits are on actual AI usage, not request count: one question can use a thousand times more than another.',
            'Each persona has its own limit, so one team cannot use up capacity meant for others.',
            'Teams that hit their limit pause until it resets; nothing needs an IT change.',
          ],
        },
        eng: {
          title: 'Token quota & budget',
          subtitle: 'Your per-minute tokens and USD budget',
          badge: 'Over limit: 429',
          points: [
            'Over your token quota or budget returns HTTP 429; back off until the reset time in the response.',
            'x-gateway-total-tokens and x-gateway-cost-usd show what each call used, and remaining quota is in the headers.',
            'Limits live on your API product, so an admin can raise them with no change on your side.',
          ],
        },
        analysts: {
          title: 'Counts usage and cost',
          subtitle: 'Against your team’s limit and budget',
          badge: 'Cost per analysis',
          points: [
            'Every answer is costed, so you can see what each analysis really took.',
            'If your team hits its limit, requests pause until it resets. Nothing is charged while paused.',
            'Reused answers are free and use none of your limit.',
          ],
        },
        support: {
          title: 'Counts usage and cost',
          subtitle: 'Against your team’s limit and budget',
          badge: 'Cost per reply',
          points: [
            'Every reply is costed; everyday replies on fast models cost a fraction of a cent.',
            'If your team hits its limit, requests pause until it resets.',
            'Reused replies are free and use none of your limit.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? isAiQuotaBlocked
          ? {
              label: say(voice, '429 QUOTA EXCEEDED', 'LIMIT REACHED'),
              status: 'block',
              detail: sp({
                technical: 'Token budget exhausted for the active persona API product',
                platform: 'LTQ / budget quota raised 429 for this product',
                finance: 'Team limit reached; paused before any spend',
                ai_coe: 'This persona’s usage limit is used up for now',
                eng: 'HTTP 429: back off until the quota resets',
                analysts: 'Your team’s usage limit is used up for now',
                support: 'Your team’s usage limit is used up for now',
              }),
            }
          : {
              label: `${aiTelemetry.totalTokens || 0} TOKENS`,
              status: 'pass',
              detail: remainingTokens
                ? sp({
                    technical: `Remaining Quota: ${remainingTokens}`,
                    platform: `Remaining quota: ${remainingTokens}`,
                    eng: `x-gateway-quota-remaining: ${remainingTokens}`,
                    business: `Left in your limit: ${remainingTokens}`,
                    finance: `Left in the team limit: ${remainingTokens}`,
                    ai_coe: `Left in the persona limit: ${remainingTokens}`,
                  })
                : sp({
                    technical: 'Within Product Token Budget',
                    platform: 'Within product token quota',
                    eng: 'Within your token quota',
                    business: 'Within your usage limit',
                    finance: 'Within the team limit',
                    ai_coe: 'Within the persona limit',
                  }),
            }
        : undefined,
    },
    {
      id: 'ai-upstream',
      step: '06',
      title: 'Multi-Model Upstream & Cost Attribution',
      subtitle: 'Vertex AI Gemini & Anthropic Claude + KVM Rate Card',
      badge: 'Multi-Cloud AI',
      badgeColor: 'bg-cyan-100 text-cyan-800 border-cyan-300',
      icon: <Server className="w-4 h-4 text-cyan-600" />,
      policies: [
        {
          name: 'KVM-GetModelRates', type: 'KeyValueMapOperations',
          purpose: 'Reads live input/output per-1k token rates from the ai-model-rates KVM.',
          businessPurpose: 'Reads the current price of the model used from the model price list.',
          lines: {
            platform: 'Reads per-1k input/output rates from the ai-model-rates KVM. Update prices in the KVM; no redeploy.',
            finance: 'Reads the current price of the model used from the model price list you maintain.',
            ai_coe: 'Reads the current price of the model used, so model choices can be compared on cost.',
            eng: 'Loads per-1k token rates for the model from the ai-model-rates KVM.',
            analysts: 'Reads the current price of the model that answered.',
            support: 'Reads the current price of the model that answered.',
          },
        },
        {
          name: 'JS-CalculateCost', type: 'JavaScript',
          purpose: 'Computes exact USD cost for the request (zeroed on a cache hit); QC-DeductBudget then spends it against the developer budget.',
          businessPurpose: 'Works out the exact cost in USD, then takes it off your monthly budget.',
          lines: {
            platform: 'Computes USD cost from tokens and rates (zero on a cache hit) and hands it to QC-DeductBudget.',
            finance: 'Works out the exact USD cost of each request; reused answers are $0.',
            ai_coe: 'Works out the exact cost of each request per model.',
            eng: 'Computes the USD cost of your call; returned as x-gateway-cost-usd (0 on a cache hit).',
            analysts: 'Works out the exact cost of each answer.',
            support: 'Works out the exact cost of each reply.',
          },
        },
        {
          name: 'DC-ModelAnalytics', type: 'DataCapture',
          purpose: 'Streams model name, token counts, latency, and cost into custom Analytics dimensions.',
          businessPurpose: 'Records who used which model, how much and at what cost, for chargeback.',
          lines: {
            platform: 'Writes dc_model_name, dc_user_email, dc_total_tokens and cost into custom analytics dimensions.',
            finance: 'Records who used which model and what it cost, for chargeback by team.',
            ai_coe: 'Records model use by persona and user, for adoption and governance reporting.',
            eng: 'Captures model, tokens, latency and cost per call for the analytics dashboard.',
            analysts: 'Records which model answered and the cost, for your team’s reporting.',
            support: 'Records which model replied and the cost, for your team’s reporting.',
          },
        },
        {
          name: 'AM-SetResponseHeaders', type: 'AssignMessage',
          purpose: 'Injects x-gateway-* trace headers (model, provider, cost-usd, total-tokens, cached) for UI inspection.',
          businessPurpose: 'Adds the model, cost and usage to the reply so you can see them here.',
          lines: {
            platform: 'Sets x-gateway-* headers (model, provider, cost-usd, total-tokens, cached) on every response.',
            finance: 'Adds the cost of each reply, so it is visible straight away.',
            ai_coe: 'Adds which model and provider answered to every reply.',
            eng: 'Adds x-gateway-model, -provider, -cost-usd, -total-tokens and -cached to your response.',
            analysts: 'Adds which model answered, and the cost, to every reply.',
            support: 'Adds which model replied, and the cost, to every reply.',
          },
        },
      ],
      talkingPoints: [
        'Abstracts credential management: the gateway authenticates to Vertex AI / Model Garden via Google Cloud Workload Identity.',
        'Calculates real-time per-request USD cost using live KVM rate cards and injects x-gateway-* telemetry headers.',
        'Feeds the Analytics & Cost dashboard with custom analytics dimensions (dc_model_name, dc_user_email, dc_total_tokens) to track consumption across tools and models.',
      ],
      businessTitle: 'Gets the answer and records the cost',
      businessSubtitle: 'Gemini or Claude, priced from the model price list',
      businessBadge: 'Chargeback',
      businessTalkingPoints: [
        'Teams never handle AI provider passwords: the gateway signs in for them.',
        'Every request is priced as it happens, using the current model price list.',
        'Spend by user, team and model feeds the Analytics & Cost dashboard for chargeback.',
      ],
      lines: {
        platform: {
          title: 'Upstream & Cost Attribution',
          subtitle: 'Vertex AI targets, KVM rate card, DataCapture',
          badge: 'Multi-Cloud AI',
          points: [
            'Targets authenticate with Workload Identity; no provider keys in the bundle. Upstream errors pass through with the provider’s status.',
            'Cost uses the ai-model-rates KVM: update rates in the KVM and every call is priced correctly, no redeploy.',
            'DataCapture feeds the Analytics dashboard (dc_model_name, dc_user_email, dc_total_tokens) for per-model, per-user views.',
          ],
        },
        finance: {
          title: 'Prices every request',
          subtitle: 'From the model price list, charged to the team',
          badge: 'Chargeback',
          points: [
            'Every request is priced as it happens, from the current model price list.',
            'Spend by user, team and model feeds the Analytics & Cost dashboard, ready for chargeback.',
            'Change a model price in one place and every new request uses it.',
          ],
        },
        ai_coe: {
          title: 'Gets the answer',
          subtitle: 'Gemini or Claude, through one gateway',
          badge: 'Multi-model',
          points: [
            'Gemini and Claude are reached through the same gateway, so adding a provider does not change how teams work.',
            'Teams never hold provider credentials: the gateway signs in for them.',
            'Model use by persona and user is recorded for adoption and governance reports.',
          ],
        },
        eng: {
          title: 'Model call & Analytics',
          subtitle: 'Model call with tokens and cost tracked per call',
          badge: 'Usage analytics',
          points: [
            'The gateway authenticates to model for you; no provider keys in your code.',
            'Each response carries additional headers for logging and debugging.',
            'Upstream model errors are passed back with the provider status, so you can tell them from gateway rejections.',
          ],
        },
        analysts: {
          title: 'Gets your answer',
          subtitle: 'From an approved model, with the cost shown',
          badge: 'Approved models',
          points: [
            'Your question goes only to company-approved models on Google Cloud.',
            'No one on your team handles AI provider passwords: the gateway signs in.',
            'Each answer shows which model produced it and what it cost.',
          ],
        },
        support: {
          title: 'Gets your reply',
          subtitle: 'From an approved model, with the cost shown',
          badge: 'Approved models',
          points: [
            'Replies come only from company-approved models.',
            'Each reply shows which model wrote it and what it cost.',
            'Usage is recorded so your team’s AI costs are clear.',
          ],
        },
      },
      liveStatus: aiTelemetry
        ? {
            label: `$${parseFloat(aiTelemetry.costUsd || '0').toFixed(6)} USD`,
            status: 'pass',
            detail: sp({
              technical: `Round-trip latency: ${aiTelemetry.latencyMs} ms`,
              platform: `Round-trip latency: ${aiTelemetry.latencyMs} ms`,
              eng: `Round-trip latency: ${aiTelemetry.latencyMs} ms`,
              business: `Response time: ${aiTelemetry.latencyMs} ms`,
            }),
          }
        : undefined,
    },
  ];

  // MCP proxy PreFlow, in execution order: API key (01) -> tool filter (02, same VerifyAPIKey
  // against the product's tools/call/<tool> operations) -> rate limit (03) -> MCP call (04) ->
  // optional JSON-RPC -> REST translation (05, only for APIs Apigee hosts as MCP).
  const mcpStages: ArchStage[] = [
    {
      id: 'mcp-auth',
      step: '01',
      title: 'API Key Check',
      subtitle: 'Agent Key Verification (x-api-key)',
      badge: 'Missing / Bad Key: 401',
      badgeColor: 'bg-blue-100 text-blue-700 border-blue-300',
      icon: <Key className="w-4 h-4 text-blue-600" />,
      policies: [
        {
          name: 'VA-VerifyAPIKey', type: 'VerifyAPIKey',
          purpose: 'Verifies the agent consumer key (x-api-key) on tools/list and tools/call. Missing, invalid or revoked key: HTTP 401.',
          businessPurpose: 'Checks the assistant’s access key.',
          lines: {
            platform: 'Runs on tools/list and tools/call. Missing, invalid or revoked key: 401 oauth.v2.InvalidApiKey. The handshake (initialize, ping) stays keyless.',
            finance: 'Checks the assistant’s access key, so every tool call is attributed to a team.',
            ai_coe: 'Checks the assistant’s access key and which persona it belongs to.',
            eng: 'Checks your x-api-key on tools/list and tools/call. Missing or bad key: 401.',
            analysts: 'Checks the assistant’s access key.',
            support: 'Checks the assistant’s access key.',
          },
        },
      ],
      talkingPoints: [
        'Agents send standard MCP JSON-RPC 2.0 messages over HTTP POST to one path, /mcp.',
        'The MCP handshake (initialize, ping) stays keyless; tools/list and tools/call need a valid key, or HTTP 401 and nothing else runs.',
        'The same API key used on the AI Gateway identifies the agent and its persona through its Developer App.',
      ],
      businessTitle: 'Checks the assistant’s access key',
      businessSubtitle: 'Only known assistants can use business tools',
      businessBadge: 'Access key',
      businessTalkingPoints: [
        'Every AI assistant has its own access key, tied to a persona.',
        'Requests without a valid key are turned away before any business system is touched.',
      ],
      lines: {
        platform: {
          title: 'API Key Check',
          subtitle: 'VerifyAPIKey on tools/list and tools/call',
          badge: 'Bad Key: 401',
          points: [
            'All agents hit one proxy path, /mcp, with the same x-api-key they use on the AI Gateway.',
            'VA-VerifyAPIKey runs on tools/list and tools/call: missing, invalid or revoked key returns 401 and nothing else runs.',
            'The persona comes from the Developer App; move an agent between personas by changing its app, not the proxy.',
          ],
        },
        finance: {
          title: 'Checks the access key',
          subtitle: 'Every tool call is tied to a team',
          badge: 'Access key',
          points: [
            'Every assistant has its own key, so every tool call can be attributed to a team.',
            'Requests without a valid key are refused before any system does any work.',
          ],
        },
        ai_coe: {
          title: 'Checks the access key',
          subtitle: 'Only known assistants can use tools',
          badge: 'Access key',
          points: [
            'All assistants use one standard (MCP) to reach business tools, through one gateway.',
            'Each assistant’s key tells the gateway which persona it is: Engineering & IT, Customer Support & Sales, or Analysts & Knowledge Workers.',
          ],
        },
        eng: {
          title: 'API key check',
          subtitle: 'JSON-RPC 2.0 POST to /mcp with your x-api-key',
          badge: 'Bad key: 401',
          points: [
            'POST JSON-RPC 2.0 to /mcp: tools/list to discover, tools/call to execute.',
            'Same API key as the AI Gateway. Missing or bad key: 401 oauth.v2.InvalidApiKey.',
            'No backend URLs, schemas or credentials in your agent code.',
          ],
        },
        analysts: {
          title: 'Checks your assistant',
          subtitle: 'Only your team’s assistant, with its own key',
          badge: 'Access key',
          points: [
            'Your assistant uses its own access key to look up business metrics.',
            'It never holds passwords for the business systems: the gateway handles access.',
          ],
        },
        support: {
          title: 'Checks your assistant',
          subtitle: 'Only your team’s assistant, with its own key',
          badge: 'Access key',
          points: [
            'Your assistant uses its own access key to look up customers and orders.',
            'It never holds passwords for the customer systems: the gateway handles access.',
          ],
        },
      },
      liveStatus: mcpTelemetry
        ? isMcpKeyBlocked
          ? {
              label: `BLOCKED (${mcpStatus})`,
              status: 'block',
              detail: sp({
                technical: 'API key missing, invalid or revoked',
                platform: 'VA-VerifyAPIKey rejected the key (401)',
                finance: 'Refused: access key not accepted',
                ai_coe: 'Refused: access key not accepted',
                eng: '401: check your x-api-key',
                analysts: 'Access key not accepted',
                support: 'Access key not accepted',
              }),
            }
          : {
              label: say(voice, 'KEY VERIFIED', 'ALLOWED'),
              status: 'pass',
              detail: sp({
                technical: `${mcpMethod}: consumer key verified`,
                platform: `${mcpMethod}: key verified`,
                eng: `${mcpMethod}: key valid`,
                business: 'Access key OK',
              }),
            }
        : undefined,
    },
    {
      id: 'mcp-tools',
      step: '02',
      title: 'Tools Filter',
      subtitle: 'Per-Tool Entitlements from the API Product (tools/call/<tool>)',
      badge: 'Not on Product: 401',
      badgeColor: 'bg-purple-100 text-purple-700 border-purple-300',
      icon: <ShieldCheck className="w-4 h-4 text-purple-600" />,
      policies: [
        {
          name: 'PP-MCP', type: 'MCP Protocol Policy',
          purpose: 'Parses the JSON-RPC 2.0 envelope and exposes the MCP method and tool name, which are matched against the tools/call/<tool> operations on the key’s API product. tools/list is filtered to entitled tools; a tools/call for any other tool gets HTTP 401 InvalidApiKeyForGivenResource.',
          businessPurpose: 'Reads which tool the assistant wants, shows only the tools your persona may use, and refuses the rest.',
          lines: {
            platform: 'ParsePayload (JSON-RPC 2.0, protocol MCP) exposes the tool name; it is matched against the product’s tools/call/<tool> operations. tools/list is filtered; any other tool: 401 oauth.v2.InvalidApiKeyForGivenResource.',
            finance: 'Reads which tool is wanted and lets each team use only the tools it has been given.',
            ai_coe: 'Reads which tool is wanted and enforces which tools each persona may see and use, tool by tool.',
            eng: 'Parses your JSON-RPC body; params.name is checked against your API product. tools/list only returns your tools; any other tool returns 401 “Invalid ApiKey for given resource”.',
            analysts: 'Shows only the tools your team may use, and refuses the rest.',
            support: 'Shows only the tools your team may use, and refuses the rest.',
          },
        },
      ],
      talkingPoints: [
        'Entitlement is per tool, not per API: each persona product lists the exact tools/call/<tool> operations it may use.',
        'Customer Support & Sales: Customer Service Tools MCP (7 tools, e.g. getCustomer, getOrderStatus, issueRefund). Analysts & Knowledge Workers: Business Insights Tools MCP (5 tools, e.g. getRevenueTrends, runForecast). Engineering & IT: every tool.',
        'A tool that is not on the product is hidden from tools/list and a direct tools/call returns HTTP 401 (e.g. an Analyst key calling getCustomer). The MCP server is never called.',
      ],
      businessTitle: 'Shows each team only its tools',
      businessSubtitle: 'Each persona sees and uses only its own tools',
      businessBadge: 'Tool access',
      businessTalkingPoints: [
        'Access is decided tool by tool, not all or nothing.',
        'Customer Support & Sales only see and use customer, order and refund tools.',
        'Analysts & Knowledge Workers only use business insight tools. Engineering & IT can use every tool.',
      ],
      lines: {
        platform: {
          title: 'Tools Filter',
          subtitle: 'Per-tool operations on the persona API product',
          badge: 'Not on Product: 401',
          points: [
            'Entitlements are tools/call/<tool> operations on each product: Customer Service Tools MCP gets the 7 customer tools (searchCustomers to issueRefund), Business Insights Tools MCP gets the 5 insights tools, Enterprise Tools MCP gets all.',
            'PP-MCP exposes the tool name; tools/list is filtered, and any other tool returns 401 InvalidApiKeyForGivenResource before the MCP server is called.',
            'Grant or revoke a tool by editing the product in Dev, then promote. No proxy change.',
          ],
        },
        finance: {
          title: 'Each team uses only its tools',
          subtitle: 'Tools are given to teams one by one',
          badge: 'Tool access',
          points: [
            'Each team only uses the tools it has been given, so tool use stays within agreed scope.',
            'Refused calls stop here and never load the business systems.',
          ],
        },
        ai_coe: {
          title: 'Decides who uses which tool',
          subtitle: 'Tool-by-tool access per persona',
          badge: 'Tool access',
          points: [
            'Access is decided tool by tool, not all or nothing.',
            'Customer Support & Sales use customer and order tools; Analysts & Knowledge Workers use business insight tools; Engineering & IT use every tool.',
            'Assistants only see the tools they may use, so they do not try the rest.',
          ],
        },
        eng: {
          title: 'Tools filter',
          subtitle: 'Only tools on your product are listed or callable',
          badge: 'Not on product: 401',
          points: [
            'tools/list only returns tools on your API product; Engineering & IT gets the full catalogue.',
            'A tools/call for a tool outside your product (e.g. getProductMargins on a Support key) returns HTTP 401 “Invalid ApiKey for given resource”. The MCP server is never called.',
          ],
        },
        analysts: {
          title: 'Shows only your team’s tools',
          subtitle: 'Your team sees only its own tools',
          badge: 'Tool access',
          points: [
            'Your assistant can only use the business insight tools your team is approved for.',
            'Other teams cannot use your tools, so confidential figures such as product margins stay with the people who need them.',
          ],
        },
        support: {
          title: 'Shows only your team’s tools',
          subtitle: 'Your team sees only its own tools',
          badge: 'Tool access',
          points: [
            'Your assistant only uses customer, order and refund tools.',
            'It cannot reach systems your team should not use, so replies only contain data you may share.',
          ],
        },
      },
      liveStatus: mcpTelemetry
        ? isMcpToolDenied
          ? {
              label: say(voice, `NOT ON PRODUCT (${mcpStatus})`, 'NOT ALLOWED'),
              status: 'block',
              detail: sp({
                technical: `${mcpToolName || 'Tool'} is not on the key’s API product`,
                platform: `401 InvalidApiKeyForGivenResource: ${mcpToolName || 'tool'} not on the product`,
                finance: 'This team has not been given this tool',
                ai_coe: 'This persona is not allowed this tool',
                eng: `401: ${mcpToolName || 'this tool'} is not on your API product`,
                analysts: 'This tool is not available to your team',
                support: 'This tool is not available to your team',
              }),
            }
          : isMcpKeyBlocked
            ? undefined
            : {
                label: say(voice, 'TOOL ENTITLED', 'ALLOWED'),
                status: 'hit',
                detail: sp({
                  technical: mcpToolName ? `${mcpToolName} is on the product` : 'tools/list filtered to entitled tools',
                  platform: mcpToolName ? `${mcpToolName} entitled on the product` : 'tools/list filtered to the product',
                  eng: mcpToolName ? `${mcpToolName} is on your product` : 'Listed only your entitled tools',
                  business: 'Your persona may use this tool',
                  finance: 'This team may use this tool',
                  analysts: 'Your team may use this tool',
                  support: 'Your team may use this tool',
                }),
              }
        : undefined,
    },
    {
      id: 'mcp-rate',
      step: '03',
      title: 'Rate Limit',
      subtitle: 'Per-App & Per-Tool Quota from the API Product',
      badge: 'Over Limit: 429',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
      icon: <Zap className="w-4 h-4 text-amber-600" />,
      policies: [
        {
          name: 'Q-Limit', type: 'Quota',
          purpose: 'Enforces the quota configured on the API product (per app, and per tool via the tools/call/<tool> operation config) to protect downstream systems of record.',
          businessPurpose: 'Caps how often tools can be used, to protect customer and business systems.',
          lines: {
            platform: 'UseQuotaConfigInAPIProduct from VA-VerifyAPIKey, so the per-tool operation quota on the product applies. Over the limit: 429.',
            finance: 'Caps how often tools can be used, so a runaway assistant cannot run up load or cost.',
            ai_coe: 'Caps how often each assistant can use each tool, for fair use of business systems.',
            eng: 'Quota from your API product, per tool (e.g. runForecast 2/min). Over it: 429; back off and retry.',
            analysts: 'Caps how often tools can be used, to protect the reporting systems.',
            support: 'Caps how often tools can be used, to protect the customer and order systems.',
          },
        },
      ],
      talkingPoints: [
        'Prevents runaway agent loops from overwhelming enterprise systems of record.',
        'Limits are set on the API product, per tool (e.g. runForecast 2/min, issueRefund 5/min), so each persona can get a different pace without a proxy change.',
      ],
      businessTitle: 'Keeps tool use at a safe pace',
      businessSubtitle: 'Not too many tool calls in a short time',
      businessBadge: 'Usage limits',
      businessTalkingPoints: [
        'An assistant stuck in a loop cannot flood core business systems.',
        'Each team gets its own limit, tool by tool.',
      ],
      lines: {
        platform: {
          title: 'Rate Limit',
          subtitle: 'Product quota, per app and per tool',
          badge: 'Over Limit: 429',
          points: [
            'Q-Limit reads its quota from the product VA-VerifyAPIKey matched, including the per-tool operation quota.',
            'Over the limit: 429 and the MCP server is not called. Raise the limit on the product, not in the proxy.',
          ],
        },
        finance: {
          title: 'Caps tool use',
          subtitle: 'A limit on tool calls per team',
          badge: 'Usage limits',
          points: [
            'A cap on tool calls stops a runaway assistant from running up load and cost.',
            'Limits are set per team and per tool.',
          ],
        },
        ai_coe: {
          title: 'Keeps tool use fair',
          subtitle: 'A pace limit per persona and per tool',
          badge: 'Usage limits',
          points: [
            'An assistant stuck in a loop cannot flood core business systems.',
            'Each persona gets its own limit per tool, adjustable in its product.',
          ],
        },
        eng: {
          title: 'Rate limit',
          subtitle: 'Per-tool quota on your API product',
          badge: 'Over limit: 429',
          points: [
            'Too many calls returns 429. Back off and retry.',
            'The limit comes from your product’s tool operation, so each tool has its own rate (runForecast: 2/min, the 3rd call gets 429).',
          ],
        },
        analysts: {
          title: 'Keeps lookups at a safe pace',
          subtitle: 'Not too many lookups in a short time',
          badge: 'Usage limits',
          points: [
            'A cap on lookups, such as 2 forecasts a minute, protects the reporting systems.',
            'If you hit it, wait a few seconds and try again.',
          ],
        },
        support: {
          title: 'Keeps lookups at a safe pace',
          subtitle: 'Not too many lookups in a short time',
          badge: 'Usage limits',
          points: [
            'A cap on lookups keeps the customer and order systems fast for everyone.',
            'If you hit it, wait a few seconds before looking it up again.',
          ],
        },
      },
      liveStatus: mcpTelemetry
        ? isMcpRateBlocked
          ? {
              label: say(voice, 'THROTTLED (429)', 'LIMIT REACHED'),
              status: 'block',
              detail: sp({
                technical: 'Quota exceeded for this app / tool',
                platform: 'Q-Limit rejected the call (429)',
                finance: 'Refused: tool call cap reached',
                ai_coe: 'Refused: tool call cap reached',
                eng: '429: back off and retry',
                analysts: 'Too many lookups, try again shortly',
                support: 'Too many lookups, try again shortly',
              }),
            }
          : isMcpKeyBlocked || isMcpToolDenied
            ? undefined
            : {
                label: say(voice, 'WITHIN QUOTA', 'OK'),
                status: 'pass',
                detail: sp({
                  technical: 'Within product quota',
                  platform: 'Within Q-Limit',
                  eng: 'Within rate limit',
                  business: 'Within usage limit',
                }),
              }
        : undefined,
    },
    {
      id: 'mcp-call',
      step: '04',
      title: 'MCP Call',
      subtitle: 'Forward to MCP Server: Apigee-Hosted, BigQuery or ServiceNow',
      badge: 'MCP Server',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-300',
      icon: <Server className="w-4 h-4 text-emerald-600" />,
      policies: [],
      talkingPoints: [
        'The gateway forwards the governed JSON-RPC call to the MCP server: Customer Service, Business Insights and the industry packs (hosted by Apigee), Google’s managed BigQuery MCP server, or a third-party server such as ServiceNow.',
        'The same controls apply to every MCP server, whoever runs it.',
        'Every tool invocation is logged centrally with persona, tool, latency and status.',
      ],
      businessTitle: 'The tool does the work',
      businessSubtitle: 'Customer data, insights, industry systems, BigQuery or ServiceNow',
      businessBadge: 'Business tools',
      businessTalkingPoints: [
        'Business systems stay private; assistants only ever talk to the gateway.',
        'Every tool use is recorded in one place, for audit.',
      ],
      lines: {
        platform: {
          title: 'MCP Call',
          subtitle: 'Apigee-hosted, BigQuery and ServiceNow MCP servers',
          badge: 'MCP Server',
          points: [
            'The proxy forwards the call to the MCP server: Customer Service, Business Insights and the industry packs are hosted by Apigee; BigQuery (Google-managed) and ServiceNow (third-party) sit behind the same policies.',
            'Every call is logged centrally with status and latency.',
          ],
        },
        finance: {
          title: 'The tool does the work',
          subtitle: 'Customer data, insights, or a partner system',
          badge: 'Business tools',
          points: [
            'Existing systems, BigQuery and partner tools such as ServiceNow answer; there is no new platform to pay for.',
            'Every tool use is recorded in one place, for reporting and audit.',
          ],
        },
        ai_coe: {
          title: 'The tool does the work',
          subtitle: 'In-house and partner tools, one set of rules',
          badge: 'Business tools',
          points: [
            'In-house tools (customer service, business insights, industry packs), BigQuery and partner tools (ServiceNow) are governed the same way.',
            'Every tool use is recorded in one place, for governance and audit.',
          ],
        },
        eng: {
          title: 'MCP call',
          subtitle: 'To an Apigee-hosted, BigQuery or ServiceNow MCP server',
          badge: 'MCP Server',
          points: [
            'Your call is forwarded to the MCP server; you only ever call the gateway.',
            'Server errors come back as the JSON-RPC error or HTTP status shown here (e.g. -32602 for bad arguments), and each call is in Cloud Logging.',
          ],
        },
        analysts: {
          title: 'The insights system answers',
          subtitle: 'Aggregated business metrics',
          badge: 'Business tools',
          points: [
            'Only aggregated figures come back, never individual customer data, and the system stays private.',
            'Every lookup is recorded, so access to confidential figures can be audited.',
          ],
        },
        support: {
          title: 'The customer system answers',
          subtitle: 'Customer and order data, or approval requests in ServiceNow',
          badge: 'Business tools',
          points: [
            'Order status and prices come straight from the system of record, so replies are accurate.',
            'Every lookup is recorded in one place.',
          ],
        },
      },
      liveStatus: mcpTelemetry
        ? isMcpBlockedAtGateway
          ? undefined
          : {
              label: `HTTP ${mcpTelemetry.status}`,
              status: mcpTelemetry.status === 200 ? 'pass' : 'warn',
              detail: sp({
                technical: `MCP server responded in ${mcpTelemetry.latencyMs} ms`,
                platform: `MCP server responded in ${mcpTelemetry.latencyMs} ms`,
                eng: `Server responded in ${mcpTelemetry.latencyMs} ms`,
                business: `Response time: ${mcpTelemetry.latencyMs} ms`,
              }),
            }
        : undefined,
    },
    {
      id: 'mcp-bridge',
      step: '05',
      title: 'JSON-RPC → REST (Optional)',
      subtitle: 'Only for APIs Converted to MCP and Hosted by Apigee',
      badge: 'Optional',
      badgeColor: 'bg-slate-100 text-slate-700 border-slate-300',
      icon: <Workflow className="w-4 h-4 text-slate-600" />,
      policies: [
        {
          name: 'RF-RefundLimit', type: 'RaiseFault',
          purpose: 'Business rule on the REST proxy, before the backend: an issueRefund over $50 returns HTTP 403 REFUND_LIMIT for every persona. Industry packs raise their own limit the same way (e.g. FOLIO_CREDIT_LIMIT).',
          businessPurpose: 'Stops refunds over $50 for supervisor approval, whoever asks.',
          lines: {
            platform: 'RaiseFault on the REST proxy: issueRefund over $50 returns 403 REFUND_LIMIT for every persona; industry packs use their own limit code (e.g. FOLIO_CREDIT_LIMIT).',
            finance: 'Refunds over $50 are stopped for supervisor approval, for every team.',
            ai_coe: 'Business rules apply to AI too: refunds over $50 need a supervisor.',
            eng: 'issueRefund over $50 returns 403 REFUND_LIMIT, whatever your persona; raise an approval request instead.',
            analysts: 'Large refunds need a supervisor, whoever asks.',
            support: 'Refunds over $50 need supervisor approval.',
          },
        },
      ],
      talkingPoints: [
        'Optional: only for REST APIs converted to MCP tools and hosted by Apigee (Customer Service, Business Insights, industry packs). Native MCP servers such as BigQuery and ServiceNow are called as-is at step 04.',
        'Existing REST services become MCP tools without rewriting backend code; arguments (order and customer IDs) are checked against the tool schema.',
        'Business rules run at the REST proxy before the backend: refunds over $50 get 403 REFUND_LIMIT for every persona.',
      ],
      businessTitle: 'Existing systems as AI tools (optional)',
      businessSubtitle: 'Only for in-house APIs turned into tools',
      businessBadge: 'Optional',
      businessTalkingPoints: [
        'In-house systems become AI tools without being rewritten.',
        'BigQuery and partner tools such as ServiceNow already speak MCP, so they skip this step.',
        'Business rules apply here too: refunds over $50 need supervisor approval.',
      ],
      lines: {
        platform: {
          title: 'JSON-RPC → REST (Optional)',
          subtitle: 'Only for APIs converted to MCP and hosted by Apigee',
          badge: 'Optional',
          points: [
            'Applies to Customer Service and Business Insights: private Cloud Run REST APIs served as MCP tools by Apigee; no extra MCP server to deploy or patch.',
            'BigQuery and ServiceNow are native MCP servers, so their calls skip this step.',
            'Bad arguments fail against the tool schema with JSON-RPC -32602, before the REST backend.',
            'The REST proxy also enforces business rules: refunds over $50 return 403 REFUND_LIMIT.',
          ],
        },
        finance: {
          title: 'Reuses APIs (optional)',
          subtitle: 'In-house APIs become AI tools, nothing to build',
          badge: 'Optional',
          points: [
            'Existing APIs become AI tools without being rewritten, so there is no new project to fund.',
            'Refunds over $50 are stopped for supervisor approval, for every team.',
            'BigQuery and partner tools such as ServiceNow skip this step.',
          ],
        },
        ai_coe: {
          title: 'APIs as tools (optional)',
          subtitle: 'Only for in-house APIs turned into tools',
          badge: 'Optional',
          points: [
            'In-house APIs become AI tools without being rewritten, which speeds up adoption.',
            'BigQuery and partner tools such as ServiceNow already speak MCP and skip this step.',
          ],
        },
        eng: {
          title: 'JSON-RPC → REST (optional)',
          subtitle: 'Only for APIs Apigee hosts as MCP',
          badge: 'Optional',
          points: [
            'Customer Service, Business Insights and the industry packs are REST APIs exposed as MCP tools by Apigee: your tools/call becomes the REST call.',
            'Arguments are schema-checked first; a bad order ID (ORD-####) or customer ID returns JSON-RPC -32602.',
            'issueRefund over $50 returns 403 REFUND_LIMIT from the REST proxy, whatever your persona.',
            'Native MCP servers (BigQuery, ServiceNow) skip this step.',
          ],
        },
        analysts: {
          title: 'Insights APIs (optional)',
          subtitle: 'Existing reporting APIs, used as AI tools',
          badge: 'Optional',
          points: [
            'Your assistant reads from the existing reporting system, so answers use real figures.',
            'Requests are checked before they reach the system.',
          ],
        },
        support: {
          title: 'Customer APIs (optional)',
          subtitle: 'Existing customer APIs, used as AI tools',
          badge: 'Optional',
          points: [
            'Your assistant reads from the live customer and order system, so order status in replies is accurate.',
            'Order and customer IDs are checked before they reach the system.',
            'Refunds over $50 need supervisor approval.',
          ],
        },
      },
      liveStatus: mcpTelemetry && !isMcpBlockedAtGateway
        ? {
            label: say(voice, 'BRIDGED TO REST', 'CONNECTED'),
            status: 'pass',
            detail: sp({
              technical: 'Apigee-hosted MCP: tool call translated to REST',
              platform: 'Apigee-hosted MCP: translated to REST',
              eng: 'Tool call translated to the REST API',
              business: 'Existing system answered',
            }),
          }
        : undefined,
    },
  ];

  // Stage copy in the acting persona's voice: the speaker's own line, else business / technical.
  const own = (s: ArchStage) => s.lines?.[speaker];
  const stageTitle = (s: ArchStage) => own(s)?.title ?? speak(speaker, { technical: s.title, business: s.businessTitle });
  const stageSubtitle = (s: ArchStage) => own(s)?.subtitle ?? speak(speaker, { technical: s.subtitle, business: s.businessSubtitle });
  const stageBadge = (s: ArchStage) => own(s)?.badge ?? speak(speaker, { technical: s.badge, business: s.businessBadge });
  const stagePoints = (s: ArchStage) =>
    own(s)?.points ?? speak(speaker, { technical: s.talkingPoints, business: s.businessTalkingPoints });
  const policyPurpose = (p: ArchStage['policies'][number]) =>
    speak(speaker, { technical: p.purpose, business: p.businessPurpose, ...p.lines });
  /** "04 Smart Routing"-style labels for the stages a short-circuit skipped, in the speaker's words. */
  const skipped = (stages: ArchStage[]) => stages.map((s) => `${s.step} ${stageTitle(s)}`);

  // Determine exact executed stages and short-circuit termination info when in 'request-flow' mode
  let visibleStages: ArchStage[] = activeFlow === 'ai-gateway' ? aiStages : mcpStages;
  let terminationInfo: TerminationInfo | null = null;

  if (viewMode === 'request-flow') {
    if (activeFlow === 'ai-gateway' && aiTelemetry) {
      if (isAiAuthBlocked) {
        visibleStages = aiStages.slice(0, 1); // Only Step 01 executed
        const is401 = aiStatus === 401;
        terminationInfo = {
          stoppedAtStep: '01',
          stoppedAtTitle: stageTitle(aiStages[0]),
          reasonTitle: sp({
            technical: `Request Blocked at Step 01 — HTTP ${aiStatus} ${is401 ? 'Unauthorized' : 'Forbidden'}`,
            business: is401 ? 'Stopped at step 01: we could not tell who you are' : 'Stopped at step 01: this model is not in your persona',
            platform: `Step 01 failed closed: HTTP ${aiStatus} ${is401 ? 'Unauthorized' : 'Forbidden'}`,
            finance: 'Stopped at step 01, before any spend',
            ai_coe: is401 ? 'Stopped at step 01: caller not identified' : 'Stopped at step 01: model not approved for this persona',
            eng: `HTTP ${aiStatus} at step 01: ${is401 ? 'check your API key' : 'model not on your API product'}`,
            analysts: is401 ? 'Stopped at step 01: we could not tell who you are' : 'Stopped at step 01: this model is not approved for you',
            support: is401 ? 'Stopped at step 01: we could not tell who you are' : 'Stopped at step 01: this model is not approved for you',
          }),
          reasonDescription: sp({
            technical:
              'Authentication or API Product model entitlement check failed (VA-VerifyAPIKey / OAS-ValidateRequest). Downstream policies (Prompt Sanitization, Semantic Cache, Smart Routing, Tokenomics, and Upstream Models) were never executed.',
            business:
              'The access key was not accepted, or the model asked for is not one your persona may use. Nothing else ran and nothing was charged.',
            platform:
              'VA-VerifyAPIKey or OAS-ValidateRequest raised the fault in PreFlow, so no later policy or target ran. If this is unexpected, check the key’s app status and the models named on the persona API product.',
            finance:
              'The access key was not accepted, or the model asked for is not one this team has been given. No model ran, so nothing was spent or charged.',
            ai_coe:
              'The caller could not be identified, or asked for a model outside its approved list. The request never reached a model provider.',
            eng:
              `${is401 ? '401: the API key is missing, invalid or revoked, or the model you asked for is not on your API product (use /auto or an allowed model).' : '403: your prepaid wallet is empty; top it up or ask Finance.'} Nothing else ran and no quota was used.`,
            analysts:
              'Your access could not be confirmed, or the model asked for is not approved for your team. Your question was not sent to any AI model.',
            support:
              'Your access could not be confirmed, or the model asked for is not approved for your team. Nothing was sent to any AI model and nothing was charged.',
          }),
          badgeText: say(voice, 'SHORT-CIRCUITED AT AUTH', 'STOPPED AT ACCESS'),
          type: 'blocked-security',
          skippedStages: skipped(aiStages.slice(1)),
        };
      } else if (isAiGuardrailBlocked) {
        visibleStages = aiStages.slice(0, 2); // Only Steps 01 & 02 executed
        terminationInfo = {
          stoppedAtStep: '02',
          stoppedAtTitle: stageTitle(aiStages[1]),
          reasonTitle: sp({
            technical: 'Prompt Sanitization Triggered — Prompt Blocked at the Perimeter',
            business: 'Stopped at step 02: the prompt was unsafe',
            platform: 'SUP-UserPrompt raised HTTP 400 at step 02',
            finance: 'Stopped at step 02: unsafe prompt, $0 spent',
            ai_coe: 'Stopped at step 02 by the safety template',
            eng: 'HTTP 400 at step 02: prompt blocked by Model Armor',
            analysts: 'Stopped at step 02: sensitive or unsafe content',
            support: 'Stopped at step 02: the question was unsafe',
          }),
          reasonDescription:
            aiTelemetry.guardrailMessage ||
            sp({
              technical:
                'SUP-UserPrompt.xml detected a safety violation (Prompt Injection, Jailbreak, or Destructive intent) and immediately terminated execution. Semantic Cache, Smart Routing, Tokenomics, and Foundation Models were never invoked ($0.00 cost, 0 tokens consumed).',
              business:
                'The safety screen found an attempt to trick the AI or cause harm, and stopped the request. No AI model saw it, and it cost nothing.',
              platform:
                'SUP-UserPrompt matched the Model Armor template (injection, jailbreak or destructive intent) and faulted with 400. Cache, router, quota and target never ran. False positives are tuned in the template, not the proxy.',
              finance:
                'The safety screen stopped the request before any model ran. It cost $0 and nothing came off the team’s budget.',
              ai_coe:
                'The company safety template flagged an injection, jailbreak or harmful request. No model saw it, whichever model would have been chosen.',
              eng:
                'Model Armor flagged the prompt (injection, jailbreak or destructive intent) and returned 400 with the reason. No tokens or quota used; rephrase and resend.',
              analysts:
                'The safety screen found sensitive or unsafe content in the question and stopped it. No AI model saw it, so nothing left the company.',
              support:
                'The safety screen stopped this question before any AI model saw it, so no unsafe reply could be produced. It cost nothing.',
            }),
          badgeText: say(voice, 'BLOCKED AT PERIMETER (HTTP 400)', 'BLOCKED AS UNSAFE'),
          type: 'blocked-security',
          skippedStages: skipped(aiStages.slice(2)),
        };
      } else if (isAiCached) {
        visibleStages = aiStages.slice(0, 3); // Steps 01, 02 & 03 executed (Cache Hit short-circuit)
        terminationInfo = {
          stoppedAtStep: '03',
          stoppedAtTitle: stageTitle(aiStages[2]),
          reasonTitle: sp({
            technical: `Semantic Cache HIT — Response Served in ${aiTelemetry.latencyMs} ms`,
            business: `Earlier answer reused, in ${aiTelemetry.latencyMs} ms`,
            platform: `SCL hit at step 03: served in ${aiTelemetry.latencyMs} ms`,
            finance: `Earlier answer reused: $0, in ${aiTelemetry.latencyMs} ms`,
            ai_coe: `Earlier answer reused, no model used (${aiTelemetry.latencyMs} ms)`,
            eng: `Cache hit: ${aiTelemetry.latencyMs} ms, $0, no quota used`,
            analysts: `Earlier answer reused, in ${aiTelemetry.latencyMs} ms`,
            support: `Earlier reply reused, in ${aiTelemetry.latencyMs} ms`,
          }),
          reasonDescription: sp({
            technical:
              'SCL-Semantic-Cache-Lookup.xml matched the prompt embedding in the vector store and returned the cached completion immediately. The AutoRoutingFlow router call (JEV System One), token-quota / budget deduction, and upstream LLM inference were completely bypassed ($0.00 upstream model cost, 0 quota tokens deducted).',
            business:
              'A question with the same meaning was answered before, so that answer came straight back. No model was used, nothing came off your budget, and none of your limit was used.',
            platform:
              'SCL-Semantic-Cache-Lookup matched the prompt embedding and returned the stored completion. AutoRoutingFlow, token quota, budget deduction and the target were skipped by design.',
            finance:
              'A question with the same meaning was answered before, so that answer was reused. No model fee, nothing off the team’s budget: this is where reuse saves money.',
            ai_coe:
              'A question with the same meaning was answered before, so that answer was reused. The router did not run and no model is credited for this reply.',
            eng:
              'Your prompt matched a cached one by embedding similarity. You got the stored response with x-gateway-cached: true; no router call, no model call, no tokens or budget used.',
            analysts:
              'A question with the same meaning was answered before, so that finished answer came straight back. No AI model saw your question this time. Turn answer reuse off for a fresh analysis.',
            support:
              'A customer question with the same meaning was answered before, so that already-screened reply came straight back, fast and at no cost.',
          }),
          badgeText: say(voice, 'CACHE SHORT-CIRCUIT ($0 COST)', 'ANSWER REUSED ($0 COST)'),
          type: 'cache-hit',
          skippedStages: skipped(aiStages.slice(3)),
        };
      } else if (isAiQuotaBlocked) {
        visibleStages = aiStages.slice(0, 5); // Steps 01 -> 05 executed; Step 06 blocked
        terminationInfo = {
          stoppedAtStep: '05',
          stoppedAtTitle: stageTitle(aiStages[4]),
          reasonTitle: sp({
            technical: 'Token Quota Exhausted — Request Throttled at Step 05 (HTTP 429)',
            business: 'Stopped at step 05: your team’s limit is reached',
            platform: 'Step 05 quota enforcement returned HTTP 429',
            finance: 'Stopped at step 05: team limit reached, no spend',
            ai_coe: 'Stopped at step 05: persona usage limit reached',
            eng: 'HTTP 429 at step 05: token quota or budget exhausted',
            analysts: 'Stopped at step 05: your team’s limit is reached',
            support: 'Stopped at step 05: your team’s limit is reached',
          }),
          reasonDescription: sp({
            technical:
              'LTQ-TokenEnforce.xml blocked the request because the caller exceeded the per-minute LLM token quota configured on their persona API product. Upstream Foundation Model invocation was prevented.',
            business:
              'Your persona has used its AI allowance for now. The request was paused before any model ran, so nothing extra was spent.',
            platform:
              'LTQ-TokenEnforce (or the budget quota via RF-BudgetExceeded) faulted with 429 against the persona product’s limits. The target never ran. Raise the limit on the product if this persona needs more.',
            finance:
              'This team has used its AI allowance for now. The request stopped before any model ran, so nothing was spent beyond the agreed limit.',
            ai_coe:
              'This persona has used its fair-use allowance for now. Requests resume when the limit resets, or when its limit is raised in settings.',
            eng:
              'You hit your token quota (or USD budget) on your API product. Back off until the reset time in the response; no model was called.',
            analysts:
              'Your team has used its AI allowance for now. The request paused before any model ran; try again after the limit resets.',
            support:
              'Your team has used its AI allowance for now. Try again after the limit resets, or reuse an earlier reply.',
          }),
          badgeText: say(voice, 'THROTTLED AT QUOTA (HTTP 429)', 'LIMIT REACHED'),
          type: 'blocked-quota',
          skippedStages: skipped(aiStages.slice(5)),
        };
      }
    } else if (activeFlow === 'mcp-gateway' && mcpTelemetry) {
      if (isMcpKeyBlocked) {
        visibleStages = mcpStages.slice(0, 1); // Step 01 only
        terminationInfo = {
          stoppedAtStep: '01',
          stoppedAtTitle: stageTitle(mcpStages[0]),
          reasonTitle: sp({
            technical: `MCP Request Blocked at Step 01 — HTTP ${mcpStatus} Unauthorized`,
            business: 'Stopped at step 01: the access key was not accepted',
            platform: `Step 01 rejected the key: HTTP ${mcpStatus}`,
            finance: 'Stopped at step 01: access key refused',
            ai_coe: 'Stopped at step 01: assistant not identified',
            eng: `HTTP ${mcpStatus} at step 01: check your API key`,
            analysts: 'Stopped at step 01: access key not accepted',
            support: 'Stopped at step 01: access key not accepted',
          }),
          reasonDescription: sp({
            technical: 'VA-VerifyAPIKey rejected the consumer key (missing, invalid or revoked). Tools filter, rate limit and the MCP server were never reached.',
            business: 'The assistant’s access key was not accepted, so no tool was listed or used and no business system was touched.',
            platform:
              'VA-VerifyAPIKey faulted with 401 (missing, invalid or revoked key). The tools filter, Q-Limit and the MCP server never ran. Check the app’s status and credential.',
            finance: 'The assistant’s key was refused, so no business system did any work.',
            ai_coe: 'The assistant could not be identified, so it was not given any tools.',
            eng: '401: the x-api-key is missing, invalid or revoked. Nothing else ran and no quota was used.',
            analysts: 'The assistant’s access was not confirmed, so no business system was touched.',
            support: 'The assistant’s access was not confirmed, so no customer system was touched.',
          }),
          badgeText: say(voice, `BLOCKED AT API KEY (HTTP ${mcpStatus})`, 'STOPPED AT ACCESS'),
          type: 'blocked-security',
          skippedStages: skipped(mcpStages.slice(1)),
        };
      } else if (isMcpToolDenied) {
        visibleStages = mcpStages.slice(0, 2); // Steps 01 & 02
        terminationInfo = {
          stoppedAtStep: '02',
          stoppedAtTitle: stageTitle(mcpStages[1]),
          reasonTitle: sp({
            technical: `Tools Filter Denied — ${mcpToolName || 'tool'} is not on the API product (HTTP ${mcpStatus})`,
            business: 'Stopped at step 02: this tool is not for your persona',
            platform: `Step 02: ${mcpToolName || 'tool'} not on the product (HTTP ${mcpStatus})`,
            finance: 'Stopped at step 02: tool not given to this team',
            ai_coe: 'Stopped at step 02: tool not allowed for this persona',
            eng: `HTTP ${mcpStatus} at step 02: ${mcpToolName || 'tool'} is not on your API product`,
            analysts: 'Stopped at step 02: this tool is not for your team',
            support: 'Stopped at step 02: this tool is not for your team',
          }),
          reasonDescription: sp({
            technical:
              'The key is valid, but VA-VerifyAPIKey found no tools/call/<tool> operation for this tool on the key’s API product and returned 401 “Invalid ApiKey for given resource”. Rate limit and the MCP server were never invoked.',
            business:
              'Your persona is not allowed to use this tool, so the request stopped here. The business system behind it was never reached.',
            platform:
              'VA-VerifyAPIKey returned 401 oauth.v2.InvalidApiKeyForGivenResource: the tool is not an operation on the persona product. Q-Limit and the MCP server did not run. Grant the tool on the product (Dev first) if this persona should have it.',
            finance: 'This team has not been given this tool, so the request stopped here. The business system was never used.',
            ai_coe: 'This persona is not allowed this tool under current access rules. The business system behind it was never reached.',
            eng: 'Your key is valid but the tool is not on your API product, so you get 401 “Invalid ApiKey for given resource”. Use tools/list to see what you can call.',
            analysts: 'Your team is not allowed to use this tool, so no record was read. Confidential systems stay limited to the teams that need them.',
            support: 'Your team is not allowed to use this tool, so the request stopped here. Nothing from that system can end up in a reply.',
          }),
          badgeText: say(voice, `TOOL NOT ON PRODUCT (HTTP ${mcpStatus})`, 'NOT ALLOWED'),
          type: 'blocked-security',
          skippedStages: skipped(mcpStages.slice(2)),
        };
      } else if (isMcpRateBlocked) {
        visibleStages = mcpStages.slice(0, 3); // Steps 01 -> 03
        terminationInfo = {
          stoppedAtStep: '03',
          stoppedAtTitle: stageTitle(mcpStages[2]),
          reasonTitle: sp({
            technical: 'Rate Limit Exceeded — Request Throttled at Step 03 (HTTP 429)',
            business: 'Stopped at step 03: too many tool calls',
            platform: 'Step 03 Q-Limit returned HTTP 429',
            finance: 'Stopped at step 03: tool call cap reached',
            ai_coe: 'Stopped at step 03: fair-use cap reached',
            eng: 'HTTP 429 at step 03: rate limit hit, back off',
            analysts: 'Stopped at step 03: too many lookups',
            support: 'Stopped at step 03: too many lookups',
          }),
          reasonDescription: sp({
            technical: 'Q-Limit rejected the call against the quota on the API product (per app / per tool). The MCP server was never invoked.',
            business: 'The assistant made too many tool calls in a short time, so this one was paused. No business system was touched.',
            platform:
              'Q-Limit (UseQuotaConfigInAPIProduct) faulted with 429 against the product’s per-tool quota. The MCP server was not called, which is exactly what the quota is there to protect.',
            finance: 'The assistant hit its cap on tool calls. No business system was used.',
            ai_coe: 'The assistant hit its fair-use cap on tool calls. Calls resume when the limit resets, or when its limit is raised on the product.',
            eng: '429: too many tool calls for your product’s quota; back off and retry. The MCP server was not called.',
            analysts: 'The assistant made too many lookups in a short time. Wait a few seconds and try again.',
            support: 'The assistant made too many lookups in a short time. Wait a few seconds before looking it up again.',
          }),
          badgeText: say(voice, 'THROTTLED AT RATE LIMIT (HTTP 429)', 'LIMIT REACHED'),
          type: 'blocked-quota',
          skippedStages: skipped(mcpStages.slice(3)),
        };
      } else if (isMcpBusinessRule) {
        // All five gateway steps ran; the REST proxy refused the call on a business rule.
        const amt = mcpRefundRequested !== undefined ? ` ($${mcpRefundRequested} requested)` : '';
        terminationInfo = {
          stoppedAtStep: '05',
          stoppedAtTitle: stageTitle(mcpStages[4]),
          reasonTitle: sp({
            technical: 'Business rule at REST proxy: refund over $50 needs supervisor approval (403 REFUND_LIMIT)',
            business: 'Refund over $50 needs supervisor approval',
            platform: 'REST proxy business rule: 403 REFUND_LIMIT (refund over $50)',
            finance: 'Refund over $50 held for supervisor approval',
            ai_coe: 'Business rule applied: refund over $50 needs approval',
            eng: 'HTTP 403 REFUND_LIMIT: refund over $50 needs supervisor approval',
          }),
          reasonDescription: sp({
            technical: `All five gateway steps passed. The customer-service-v1 REST proxy then enforced the refund limit${amt} and returned 403 REFUND_LIMIT as a JSON-RPC tool error, before the Cloud Run backend was called.`,
            business: `Every check passed, but refunds over $50${amt} need a supervisor’s approval, so no refund was issued. This rule applies to every team.`,
            platform: `Steps 01-05 ran. The REST proxy business rule refused the refund${amt}: HTTP 403, result.isError=true, error REFUND_LIMIT, limit 50. The Cloud Run backend was not called. Applies to every persona.`,
            finance: `Refunds over $50${amt} are held for supervisor approval, so no money was paid out. The rule applies to every team.`,
            ai_coe: `The assistant was allowed to use the tool, but the refund${amt} is over the $50 limit set for every persona, so it needs a supervisor’s approval.`,
            eng: `Your call passed steps 01-05; the REST proxy returned 403 with result.isError=true and error REFUND_LIMIT (limit 50${mcpRefundRequested !== undefined ? `, requested ${mcpRefundRequested}` : ''}). Retry with an amount of 50 or less, or escalate.`,
            support: `Every check passed, but refunds over $50${amt} need a supervisor’s approval. Ask a supervisor, or offer $50 or less.`,
          }),
          badgeText: say(voice, 'BUSINESS RULE AT REST PROXY (HTTP 403)', 'NEEDS APPROVAL'),
          type: 'business-rule',
          skippedStages: [
            sp({
              technical: 'Cloud Run backend (customer-service-v1)',
              platform: 'Cloud Run backend',
              eng: 'Cloud Run backend',
              business: 'Refund payout',
            }),
          ],
        };
      }
    }
  }

  const allCurrentStages = activeFlow === 'ai-gateway' ? aiStages : mcpStages;
  const activeStage =
    visibleStages.find((s) => s.id === selectedStageId) ||
    allCurrentStages.find((s) => s.id === selectedStageId) ||
    visibleStages[visibleStages.length - 1] ||
    allCurrentStages[0];

  const getStatusBadgeClasses = (status: 'pass' | 'hit' | 'warn' | 'block' | 'neutral') => {
    switch (status) {
      case 'hit':
        return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30';
      case 'pass':
        return 'bg-blue-500/15 text-blue-700 border-blue-500/30';
      case 'warn':
        return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
      case 'block':
        return 'bg-rose-500/20 text-rose-700 border-rose-500/40 font-bold';
      default:
        return 'bg-slate-500/15 text-slate-700 border-slate-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  {activeFlow === 'overview'
                    ? sp({
                        technical: 'Enterprise AI & Agent Platform — Solution Architecture',
                        business: 'How your AI requests are governed',
                        platform: 'AI & MCP Gateway — Solution Architecture',
                        finance: 'Where AI spend is counted and controlled',
                        ai_coe: 'Where model, access and safety are decided',
                        eng: 'What your request goes through',
                        analysts: 'How your questions and data are protected',
                        support: 'How your replies are kept safe and fast',
                      })
                    : viewMode === 'request-flow'
                      ? sp({
                          technical: 'Live Request Execution Trace Flow',
                          business: 'What happened to your last request',
                          platform: 'Executed policy trace, last request',
                          finance: 'What your last request cost, step by step',
                          ai_coe: 'Checks your last request went through',
                          eng: 'Trace of your last request',
                          analysts: 'What happened to your last question',
                          support: 'What happened to your last reply',
                        })
                      : sp({
                          technical: 'Enterprise AI & Tools Gateway Architecture Blueprint',
                          business: 'Every check your AI requests pass',
                          platform: 'AI & Tools Gateway policy blueprint',
                          finance: 'Every cost control on an AI request',
                          ai_coe: 'Every governance check on an AI request',
                          eng: 'Every step your request goes through',
                          analysts: 'Every check that protects your questions',
                          support: 'Every check before a reply reaches you',
                        })}
                </h2>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${
                    activeFlow === 'overview'
                      ? 'bg-purple-100 text-purple-700 border-purple-300'
                      : viewMode === 'request-flow'
                        ? terminationInfo?.type === 'blocked-security' || terminationInfo?.type === 'blocked-quota'
                          ? 'bg-rose-100 text-rose-700 border-rose-300'
                          : terminationInfo?.type === 'business-rule'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-emerald-100 text-emerald-700 border-emerald-300'
                        : 'bg-blue-100 text-blue-700 border-blue-300'
                  }`}
                >
                  {activeFlow === 'overview'
                    ? say(voice, 'Start Here · High-Level View', 'Start here · Overview')
                    : viewMode === 'request-flow'
                      ? terminationInfo
                        ? terminationInfo.badgeText
                        : say(voice, 'END-TO-END EXECUTED (ALL STEPS PASSED)', 'ALL CHECKS PASSED')
                      : say(voice, 'Interactive Demo Reference', 'Click a step to learn more')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {activeFlow === 'overview'
                  ? sp({
                      technical:
                        'Follow one agent request through Apigee: every LLM call goes through the AI Gateway, every tool call through the MCP Gateway. Click a gateway to drill into its pipeline.',
                      business:
                        'Follow one question from start to answer. Every AI answer and every business tool your assistant uses passes the same checks. Click a gateway to see them.',
                      platform:
                        'One agent loop through both proxies: LLM calls via ai-gateway-v1, tool calls via the MCP proxy. Click a gateway to see which policies run where.',
                      finance:
                        'Follow one question from start to answer and see where its cost is checked, counted and charged. Click a gateway to see each control.',
                      ai_coe:
                        'Follow one question from start to answer and see where the model is chosen, access is checked and safety is applied. Click a gateway for detail.',
                      eng:
                        'Follow one agent loop: LLM calls to the AI Gateway, tool calls to the MCP Gateway, same key for both. Click a gateway for the status codes each step can return.',
                      analysts:
                        'Follow one question from start to answer and see where your data is screened and when an earlier answer can be reused. Click a gateway for detail.',
                      support:
                        'Follow one question from start to answer and see why the reply is safe to send and how it comes back fast. Click a gateway for detail.',
                    })
                  : viewMode === 'request-flow'
                    ? sp({
                        technical:
                          'Showing the exact policies executed for the tested request. Downstream policies after a block or cache hit are omitted.',
                        business:
                          'Only the checks your last request went through. If it was stopped or reused an answer, later steps are left out.',
                        platform:
                          'Only the policies that executed for the last request. After a fault or cache hit, later policies did not run and are omitted.',
                        finance:
                          'Only the steps your last request went through. If it was stopped or reused an answer, later (paid) steps never ran.',
                        ai_coe:
                          'Only the checks your last request went through. If it was stopped or reused an answer, later steps are left out.',
                        eng:
                          'Only the steps your last call went through. If it was rejected or served from cache, later steps did not run.',
                        analysts:
                          'Only the checks your last question went through. If it was stopped or reused an answer, later steps are left out.',
                        support:
                          'Only the checks your last question went through. If it was stopped or reused a reply, later steps are left out.',
                      })
                    : sp({
                        technical:
                          'Click any stage in the pipeline to inspect active XML policies, governance controls, and demo talking points.',
                        business: 'Click any step to see what it protects and why it matters.',
                        platform: 'Click a stage to see its policies, where they attach, what they return on failure and how to change them.',
                        finance: 'Click a step to see where cost is checked, counted or saved.',
                        ai_coe: 'Click a step to see how it governs model choice, access or safety.',
                        eng: 'Click a step to see what it does to your request and the error it can return.',
                        analysts: 'Click a step to see how it protects your data and your results.',
                        support: 'Click a step to see how it keeps your replies safe and fast.',
                      })}
              </p>
            </div>
          </div>

          {/* Right Controls: View Mode Toggle + Segmented Switcher + Close Button */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Toggle between Actual Request Flow vs Full Blueprint */}
            {activeFlow !== 'overview' && (
              <div className="flex items-center bg-slate-200/70 p-1 rounded-xl border border-slate-300/80 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('request-flow')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    viewMode === 'request-flow'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title={sp({
                    technical: 'Show only the policies that executed for the last tested request',
                    business: 'Show only the checks your last request went through',
                    platform: 'Show only the policies that executed for the last request',
                    eng: 'Show only the steps your last call went through',
                  })}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{say(voice, 'Tested Request Flow', 'Your last request')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('full-blueprint')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    viewMode === 'full-blueprint'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title={sp({
                    technical: 'Show all architecture stages in the reference blueprint',
                    business: 'Show every check a request can go through',
                    platform: 'Show every policy stage in the proxy',
                    eng: 'Show every step a call can go through',
                  })}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{say(voice, 'Full Architecture', 'All checks')}</span>
                </button>
              </div>
            )}

            {/* Gateway Switcher */}
            <div className="flex items-center bg-slate-200/70 p-1 rounded-xl border border-slate-300/80 text-xs">
              <button
                type="button"
                onClick={() => setActiveFlow('overview')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  activeFlow === 'overview'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title={sp({
                  technical: 'High-level solution architecture — the starting point',
                  business: 'The big picture: start here',
                  platform: 'Both proxies end to end: start here',
                  eng: 'The whole agent loop: start here',
                })}
              >
                <Network className="w-3.5 h-3.5" />
                <span>{say(voice, 'Solution Overview', 'Overview')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFlow('ai-gateway');
                  setSelectedStageId('ai-router');
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  activeFlow === 'ai-gateway'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title={sp({
                  technical: 'AI Gateway proxy pipeline',
                  business: 'Checks on every AI answer',
                  platform: 'ai-gateway-v1 policy pipeline',
                  finance: 'Where AI spend is checked and counted',
                  ai_coe: 'Model choice, access and safety checks',
                  eng: 'What your LLM calls go through',
                })}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Gateway</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveFlow('mcp-gateway');
                  setSelectedStageId('mcp-tools');
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  activeFlow === 'mcp-gateway'
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title={sp({
                  technical: 'MCP Tools Gateway proxy pipeline',
                  business: 'Checks on every business tool your assistant uses',
                  platform: 'MCP proxy policy pipeline',
                  finance: 'Controls on every business tool used',
                  ai_coe: 'Who may use which business tool',
                  eng: 'What your tools/call requests go through',
                })}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{say(voice, 'MCP Tools', 'Tools')}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition cursor-pointer"
              title={say(voice, 'Close Blueprint', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {activeFlow === 'overview' ? (
            <AgentFlowDiagram
              onDrillDown={(flow) => {
                setActiveFlow(flow);
                setViewMode('full-blueprint');
                setSelectedStageId(flow === 'ai-gateway' ? 'ai-router' : 'mcp-tools');
              }}
            />
          ) : (
            /* Interactive Pipeline Flowchart (AI Gateway OR MCP Tools Gateway) */
            <>
              {/* Pipeline Steps Grid */}
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {viewMode === 'request-flow'
                        ? sp({
                            technical: `Executed Pipeline Path (${visibleStages.length} of ${allCurrentStages.length} Stages Executed)`,
                            business: `Steps your request went through (${visibleStages.length} of ${allCurrentStages.length})`,
                            platform: `Executed stages (${visibleStages.length} of ${allCurrentStages.length})`,
                            eng: `Steps your call went through (${visibleStages.length} of ${allCurrentStages.length})`,
                          })
                        : activeFlow === 'ai-gateway'
                          ? sp({
                              technical: 'AI Gateway Proxy Pipeline (PreFlow ➔ Target ➔ PostFlow)',
                              business: 'Checks on every AI request, in order',
                              platform: 'ai-gateway-v1: PreFlow ➔ Target ➔ PostFlow',
                              finance: 'Cost controls on every AI request, in order',
                              ai_coe: 'Governance on every AI request, in order',
                              eng: 'Your LLM call, step by step',
                              analysts: 'Protection on every question, in order',
                              support: 'Checks on every reply, in order',
                            })
                          : sp({
                              technical: 'MCP Tools Gateway Proxy Pipeline (API Key ➔ Tools Filter ➔ Rate Limit ➔ MCP Call ➔ REST)',
                              business: 'Checks on every tool request, in order',
                              platform: 'MCP proxy: API key ➔ tools filter ➔ rate limit ➔ MCP call ➔ REST (optional)',
                              finance: 'Controls on every tool request, in order',
                              ai_coe: 'Governance on every tool request, in order',
                              eng: 'Your tools/call request, step by step',
                              analysts: 'Protection on every lookup, in order',
                              support: 'Checks on every lookup, in order',
                            })}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {sp({
                      technical: 'Click any executed step below to inspect its XML policies & telemetry',
                      business: 'Click a step to see what it does for you',
                      platform: 'Click a stage for its policies and failure modes',
                      finance: 'Click a step to see its cost impact',
                      ai_coe: 'Click a step to see what it governs',
                      eng: 'Click a step for its policies and error codes',
                      analysts: 'Click a step to see how it protects you',
                      support: 'Click a step to see what it does for your replies',
                    })}
                  </span>
                </div>

                {/* Dynamic Flow Container */}
                <div className="flex flex-col lg:flex-row items-stretch gap-3">
                  {/* Rendered Executed Stages */}
                  <div
                    className={`grid grid-cols-1 sm:grid-cols-2 ${
                      visibleStages.length === 1
                        ? 'lg:grid-cols-1 lg:w-1/3'
                        : visibleStages.length === 2
                          ? 'lg:grid-cols-2 lg:w-1/2'
                          : visibleStages.length === 3
                            ? 'lg:grid-cols-3 lg:w-3/5'
                            : visibleStages.length === 5
                              ? 'lg:grid-cols-5 flex-1'
                              : 'lg:grid-cols-6 flex-1'
                    } gap-2.5`}
                  >
                    {visibleStages.map((stage, idx) => {
                      const isSelected = stage.id === activeStage.id;
                      const isBlockingStep = stage.liveStatus?.status === 'block';
                      const isCacheHitStep = stage.liveStatus?.status === 'hit' && stage.id === 'ai-cache';

                      return (
                        <div
                          key={stage.id}
                          onClick={() => setSelectedStageId(stage.id)}
                          className={`relative rounded-xl p-3.5 border transition cursor-pointer flex flex-col justify-between ${
                            isBlockingStep
                              ? 'bg-rose-50/90 border-2 border-rose-600 ring-4 ring-rose-500/20 shadow-lg'
                              : isCacheHitStep
                                ? 'bg-emerald-50/90 border-2 border-emerald-600 ring-4 ring-emerald-500/20 shadow-lg'
                                : isSelected
                                  ? 'bg-blue-50/80 border-blue-600 ring-2 ring-blue-500/20 shadow-md'
                                  : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div>
                            {/* Step number & icon */}
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span
                                className={`text-[11px] font-mono font-bold ${
                                  isBlockingStep
                                    ? 'text-rose-600'
                                    : isCacheHitStep
                                      ? 'text-emerald-600'
                                      : 'text-slate-400'
                                }`}
                              >
                                STEP {stage.step}
                              </span>
                              <div
                                className={`p-1.5 rounded-lg border shadow-2xs ${
                                  isBlockingStep
                                    ? 'bg-rose-600 text-white border-rose-700'
                                    : isCacheHitStep
                                      ? 'bg-emerald-600 text-white border-emerald-700'
                                      : 'bg-white border-slate-200/80'
                                }`}
                              >
                                {isBlockingStep ? (
                                  <ShieldAlert className="w-4 h-4 text-white" />
                                ) : (
                                  stage.icon
                                )}
                              </div>
                            </div>

                            {/* Badge */}
                            <div className="mb-1.5">
                              <span
                                className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                  isBlockingStep
                                    ? 'bg-rose-600 text-white border-rose-700'
                                    : stage.badgeColor
                                }`}
                              >
                                {isBlockingStep ? say(voice, '⛔ BLOCKED HERE', '⛔ STOPPED HERE') : stageBadge(stage)}
                              </span>
                            </div>

                            {/* Title & Subtitle */}
                            <h4
                              className={`text-xs font-bold leading-snug mb-1 ${
                                isBlockingStep
                                  ? 'text-rose-950'
                                  : 'text-slate-900'
                              }`}
                            >
                              {stageTitle(stage)}
                            </h4>
                            <p
                              className={`text-[11px] leading-tight ${
                                isBlockingStep
                                  ? 'text-rose-700 font-medium'
                                  : 'text-slate-500'
                              }`}
                            >
                              {stageSubtitle(stage)}
                            </p>
                          </div>

                          {/* Live Telemetry Badge if available */}
                          {stage.liveStatus && (
                            <div className="mt-3 pt-2 border-t border-slate-200/80">
                              <div
                                className={`px-2 py-1 rounded text-[10px] font-bold border flex items-center justify-between ${getStatusBadgeClasses(
                                  stage.liveStatus.status
                                )}`}
                              >
                                <span className="truncate">{stage.liveStatus.label}</span>
                                {stage.liveStatus.status === 'pass' || stage.liveStatus.status === 'hit' ? (
                                  <CheckCircle2 className="w-3 h-3 shrink-0 ml-1" />
                                ) : stage.liveStatus.status === 'block' ? (
                                  <Ban className="w-3 h-3 shrink-0 ml-1" />
                                ) : null}
                              </div>
                            </div>
                          )}

                          {/* Connector arrow indicator on desktop */}
                          {idx < visibleStages.length - 1 && (
                            <div className="hidden lg:flex absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-white border border-slate-300 items-center justify-center text-slate-400 shadow-2xs">
                              <ArrowRight className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Short-Circuit Explanation Callout (rendered when downstream policies were NOT executed).
                      Deliberately NOT styled like a step card: white callout, coloured left accent and a
                      pointer toward the stopped step, so it reads as "why", not as another stage. */}
                  {terminationInfo && (
                    <div
                      className={`relative flex-1 rounded-xl p-4 sm:p-5 bg-white border border-slate-200 border-l-4 shadow-sm flex flex-col justify-between text-slate-900 ${
                        terminationInfo.type === 'cache-hit'
                          ? 'border-l-emerald-500'
                          : terminationInfo.type === 'business-rule'
                            ? 'border-l-amber-500'
                            : 'border-l-rose-500'
                      }`}
                    >
                      {/* Pointer toward the stopped step (desktop layout only) */}
                      <span
                        aria-hidden="true"
                        className={`hidden lg:block absolute -left-[12px] top-1/2 -translate-y-1/2 w-0 h-0 border-y-[8px] border-y-transparent border-r-[8px] ${
                          terminationInfo.type === 'cache-hit'
                            ? 'border-r-emerald-500'
                            : terminationInfo.type === 'business-rule'
                              ? 'border-r-amber-500'
                              : 'border-r-rose-500'
                        }`}
                      />
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            <Info className="w-3.5 h-3.5" />
                            {sp({
                              technical: `Explanation · why step ${terminationInfo.stoppedAtStep} ended the request`,
                              business: `Why your request ended at step ${terminationInfo.stoppedAtStep}`,
                              platform: `Why step ${terminationInfo.stoppedAtStep} ended the flow`,
                              eng: `Why your call ended at step ${terminationInfo.stoppedAtStep}`,
                            })}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${
                              terminationInfo.type === 'cache-hit'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : terminationInfo.type === 'business-rule'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {terminationInfo.badgeText}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold mb-1.5 flex items-center gap-2 text-slate-900">
                          {terminationInfo.type === 'cache-hit' ? (
                            <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : terminationInfo.type === 'business-rule' ? (
                            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                          )}
                          <span>{terminationInfo.reasonTitle}</span>
                        </h4>

                        <p className="text-xs leading-relaxed text-slate-600 mb-4">
                          {terminationInfo.reasonDescription}
                        </p>
                      </div>

                      {/* List of Omitted Downstream Policies */}
                      <div className="pt-3 border-t border-slate-200">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                          {terminationInfo.type === 'business-rule'
                            ? sp({ technical: 'Not called:', business: 'Not done:', eng: 'Not called:' })
                            : sp({ technical: 'Downstream stages not executed:', business: 'Steps skipped:', finance: 'Steps skipped (not charged):', eng: 'Steps that did not run:' })}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {terminationInfo.skippedStages.map((skipped) => (
                            <span
                              key={skipped}
                              className="px-2 py-0.5 rounded-md text-[10px] font-mono line-through bg-slate-50 border border-slate-200 text-slate-400"
                            >
                              {skipped}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Stage Detailed Inspector Panel */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left 7 Cols: Executed Policies Table */}
                  <div className="lg:col-span-7 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-4 h-4 text-blue-600" />
                        <h3 className="text-sm font-bold text-slate-900">
                          {sp({
                            technical: `Stage ${activeStage.step}: ${stageTitle(activeStage)} — Active Gateway Policies`,
                            business: `Step ${activeStage.step}: ${stageTitle(activeStage)} — how it works`,
                            platform: `Stage ${activeStage.step}: ${stageTitle(activeStage)} — policies`,
                            finance: `Step ${activeStage.step}: ${stageTitle(activeStage)} — what it controls`,
                            ai_coe: `Step ${activeStage.step}: ${stageTitle(activeStage)} — what it governs`,
                            eng: `Step ${activeStage.step}: ${stageTitle(activeStage)} — policies`,
                          })}
                        </h3>
                      </div>
                      {voice === 'technical' && (
                        <span className="text-xs font-mono text-slate-500">
                          {activeFlow === 'ai-gateway' ? 'apiproxy/policies/' : 'mcp/apiproxy/policies/'}
                        </span>
                      )}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] font-bold uppercase text-slate-500">
                            <th className="py-2.5 px-3.5">{say(voice, 'Policy Name (XML)', 'Apigee policy')}</th>
                            <th className="py-2.5 px-3">{say(voice, 'Policy Type', 'Type')}</th>
                            <th className="py-2.5 px-3.5">{say(voice, 'Execution Role', 'What it does')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {activeStage.policies.length === 0 && (
                            <tr>
                              <td colSpan={3} className="py-3 px-3.5 text-slate-500 italic">
                                {say(voice, 'No gateway policy at this step.', 'Nothing for the gateway to check at this step.')}
                              </td>
                            </tr>
                          )}
                          {activeStage.policies.map((pol) => (
                            <tr key={pol.name} className="hover:bg-slate-50/80">
                              <td className="py-2.5 px-3.5 font-mono font-semibold text-blue-600 whitespace-nowrap">
                                {pol.name}.xml
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {pol.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-600 leading-relaxed">
                                {policyPurpose(pol)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Right 5 Cols: Presenter Demo Walkthrough Talking Points & Live Trace Correlation */}
                  <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-emerald-600" />
                        <h4 className="text-sm font-bold text-slate-900">
                          {sp({
                            technical: 'Customer Demo Talking Points',
                            business: 'Why it matters',
                            platform: 'Operating notes',
                            finance: 'What it means for spend',
                            ai_coe: 'What it means for governance',
                            eng: 'What it means for your code',
                            analysts: 'What it means for you',
                            support: 'What it means for your replies',
                          })}
                        </h4>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                        {stagePoints(activeStage).map((point, i) => (
                          <div key={i} className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                            <div className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-[10px]">
                              {i + 1}
                            </div>
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Live Telemetry Correlation Box */}
                    {activeStage.liveStatus && (
                      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-slate-400">
                            {sp({ technical: 'Last Playground Request Status', business: 'Your last request', platform: 'Last request status', eng: 'Your last call' })}
                          </div>
                          <div className="text-xs font-semibold text-slate-800 mt-0.5">
                            {activeStage.liveStatus.detail}
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${getStatusBadgeClasses(activeStage.liveStatus.status)}`}>
                          {activeStage.liveStatus.label}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {viewMode === 'request-flow'
                ? sp({
                    technical:
                      'Viewing exact execution flow for the tested request. Switch to "Full Architecture" in the top bar to see all stages.',
                    business: 'Showing only your last request. Choose "All checks" at the top to see every step.',
                    platform: 'Executed policies only. Switch to "Full Architecture" at the top to see every stage.',
                    finance: 'Showing only your last request. Choose "All checks" at the top to see every cost control.',
                    ai_coe: 'Showing only your last request. Choose "All checks" at the top to see every governance step.',
                    eng: 'Showing only your last call. Switch to "Full Architecture" at the top to see every step.',
                    analysts: 'Showing only your last question. Choose "All checks" at the top to see every step.',
                    support: 'Showing only your last question. Choose "All checks" at the top to see every step.',
                  })
                : sp({
                    technical:
                      'Tip: Click "Request Flow" next to any Target URL in the playground to see the exact flow for that request.',
                    business: 'Tip: open the request flow on any reply in the playground to see what happened to it.',
                    platform: 'Tip: "Request Flow" on any playground reply shows the policies that ran for that call.',
                    finance: 'Tip: open the request flow on any playground reply to see what that request cost.',
                    ai_coe: 'Tip: open the request flow on any playground reply to see which model and checks it got.',
                    eng: 'Tip: "Request Flow" next to any Target URL shows where that call stopped and why.',
                    analysts: 'Tip: open the request flow on any reply to see how that question was protected.',
                    support: 'Tip: open the request flow on any reply to see the checks it passed before reaching you.',
                  })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition cursor-pointer shadow-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
