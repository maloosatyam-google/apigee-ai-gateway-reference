import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  User,
  Bot,
  Sparkles,
  Terminal,
  Database,
  ArrowRight,
  Server,
} from 'lucide-react';
import { speak, usePersonaVoice } from '../utils/voice';
import type { Lines, Speaker } from '../utils/voice';
import { useCustomerTheme } from './CustomerThemeProvider';
import { BRAND_LOGOS, type BrandLogoId } from './brandLogos';

/** The optional last MCP Gateway step, drawn larger and in amber (like its REST API) so it stands out. */
const HOSTED_MCP_CHIP = 'Apigee-hosted MCP (→ REST)';
const HOSTED_MCP_COLOR = '#d97706';

/**
 * Animated walkthrough of a single agent loop through Apigee:
 * User → Agent → AI Gateway → Gemini on Vertex AI (tool call) → Agent → MCP Gateway →
 * (last step: Apigee-hosted MCP, JSON-RPC → REST) → REST API → Agent → AI Gateway → Gemini (final answer)
 * → Agent → User.
 * Other models (Claude, Bedrock, OpenAI, ...), a self-hosted MCP server and 3rd-party MCP
 * servers are drawn as the other backends the gateways front; the walkthrough does not travel to them.
 *
 * Rendered as an SVG with a fixed viewBox so it scales to the modal width
 * without scrolling. The moving "packet" is positioned with
 * SVGPathElement.getPointAtLength driven by requestAnimationFrame, so
 * pause / step / replay are fully controllable. Honors prefers-reduced-motion
 * (no moving packet; steps just highlight).
 */

type NodeId = 'user' | 'agent' | 'aigw' | 'mcpgw' | 'vertex' | 'claude' | 'rest' | 'loans' | 'thirdparty';
type Tone = 'request' | 'response' | 'tool';

/** Per-speaker copy for a step. Missing fields fall back to the step's own tag/title/caption. */
type StepLines = Partial<Record<Speaker, { tag?: string; title?: string; caption?: string }>>;

interface Hop {
  kind: 'hop';
  path: PathId;
  tone: Tone;
  tag: string;
  title: string;
  caption: string;
  lines?: StepLines;
}
interface Process {
  kind: 'process';
  node: 'aigw' | 'mcpgw';
  chips: string[];
  title: string;
  caption: string;
  lines?: StepLines;
}
type Step = Hop | Process;

type PathId =
  | 'user-agent'
  | 'agent-user'
  | 'agent-aigw'
  | 'aigw-agent'
  | 'aigw-vertex'
  | 'vertex-aigw'
  | 'agent-mcpgw'
  | 'mcpgw-agent'
  | 'mcpgw-rest'
  | 'rest-mcpgw'
  // Not travelled in the walkthrough: they show the other backends the gateways front.
  | 'aigw-claude'
  | 'claude-aigw'
  | 'mcpgw-loans'
  | 'loans-mcpgw'
  | 'mcpgw-thirdparty'
  | 'thirdparty-mcpgw';

const PATHS: Record<PathId, string> = {
  'user-agent': 'M150,245 L222,245',
  'agent-user': 'M222,285 L150,285',
  'agent-aigw': 'M372,220 C410,220 400,105 440,105',
  'aigw-agent': 'M440,150 C412,150 404,245 372,245',
  // Every backend link is a pair: request out on the upper line, response back on the lower.
  // Backends line up with the gateway they sit behind (AI Gateway 20-240, MCP Gateway 285-505).
  'aigw-vertex': 'M740,61 L820,61',
  'vertex-aigw': 'M820,83 L740,83',
  'aigw-claude': 'M740,177 L820,177',
  'claude-aigw': 'M820,199 L740,199',
  'agent-mcpgw': 'M372,285 C404,285 410,375 440,375',
  'mcpgw-agent': 'M440,420 C400,420 412,310 372,310',
  'mcpgw-loans': 'M740,309 L820,309',
  'loans-mcpgw': 'M820,331 L740,331',
  'mcpgw-thirdparty': 'M740,385 L820,385',
  'thirdparty-mcpgw': 'M820,407 L740,407',
  // From the gateway's last step (Apigee-hosted MCP chip) straight out to the REST API.
  'mcpgw-rest': 'M724,473 L820,473',
  'rest-mcpgw': 'M820,489 L724,489',
};

const AI_CHIPS = ['Access Control', 'Prompt Sanitization', 'Semantic Cache', 'Token Quotas', 'Smart Routing (Model Selection)'];
// Same order as the MCP blueprint steps 01-05.
const MCP_CHIPS = ['API Key Check', 'Tools Filter', 'Rate Limits', 'MCP Call', 'Apigee-hosted MCP (→ REST)'];

/**
 * Per-speaker display labels for the chips above. The technical label stays the
 * key (used for chip state). Keep each label no longer than
 * 'Smart Routing (Model Selection)' so it fits the chip box.
 */
const CHIP_LABEL: Record<string, Lines<string>> = {
  'Access Control': {
    technical: 'Access Control (API key)',
    finance: 'Identifies the team to bill',
    ai_coe: 'Checks team access',
    eng: 'API key check (401 if bad)',
    analysts: 'Confirms it is you',
    support: 'Confirms it is you',
  },
  'Prompt Sanitization': {
    technical: 'Prompt Sanitization',
    finance: 'Blocks misuse before it costs',
    ai_coe: 'Safety screen (injection, PII)',
    eng: 'Prompt screening (400 if hit)',
    analysts: 'Keeps confidential data out',
    support: 'Screens for unsafe content',
  },
  'Semantic Cache': {
    technical: 'Semantic Cache',
    finance: 'Reuses answers, no new spend',
    ai_coe: 'Reuses vetted answers',
    eng: 'Semantic cache (hit = fast)',
    analysts: 'Reuses earlier answers',
    support: 'Instant reuse of past answers',
  },
  'Token Quotas': {
    technical: 'Token Quotas (429 on limit)',
    finance: 'Budget check before spend',
    ai_coe: 'Fair-use limit per team',
    eng: 'Token quota (429 if over)',
    analysts: 'Checks your usage limit',
    support: 'Checks your usage limit',
  },
  'Smart Routing (Model Selection)': {
    technical: 'Smart Routing (Model Selection)',
    finance: 'Picks the best-value model',
    ai_coe: 'Routes to the approved model',
    eng: 'Model auto-routing',
    analysts: 'Picks the right model',
    support: 'Picks a fast, low-cost model',
  },
  'API Key Check': {
    technical: 'API Key Check (401)',
    finance: 'Identifies the team to bill',
    ai_coe: 'Checks the assistant’s key',
    eng: 'API key check (401 if bad)',
    analysts: 'Confirms it is your assistant',
    support: 'Confirms it is your assistant',
  },
  'Tools Filter': {
    technical: 'Tools Filter (per product)',
    finance: 'Only approved tools per team',
    ai_coe: 'Only tools this team may use',
    eng: 'Tools filter (401 if not)',
    analysts: 'Only approved data tools',
    support: 'Only approved service tools',
  },
  'Rate Limits': {
    technical: 'Rate Limits (429)',
    finance: 'Caps runaway tool calls',
    ai_coe: 'Fair-use limit on tools',
    eng: 'Rate limit (429 if over)',
    analysts: 'Limits how often',
    support: 'Limits how often',
  },
  'MCP Call': {
    technical: 'MCP Call (self / 3rd-party)',
    finance: 'Existing tool does the work',
    ai_coe: 'In-house or partner tool',
    eng: 'Forwarded to the MCP server',
    analysts: 'The data tool answers',
    support: 'The service tool answers',
  },
  'Apigee-hosted MCP (→ REST)': {
    technical: 'Apigee-hosted MCP → REST (Optional)',
    finance: 'Existing APIs as tools (Optional)',
    ai_coe: 'Existing APIs as tools (Optional)',
    eng: 'Apigee-hosted MCP → REST (Optional)',
    analysts: 'Reads existing systems (Optional)',
    support: 'Reads existing systems (Optional)',
  },
};

const PROMPT_QUOTE = '“Customer says order 1042 is late.”';
const ANSWER_QUOTE = '“Apologise: order 1042 is delayed. Offer a goodwill credit.”';
const TOOL_CALL_PAYLOAD = 'functionCall: getOrderStatus { orderId: "ORD-1042" }';
const TOOL_RESULT_PAYLOAD = '{ orderId: "ORD-1042", status: "Delayed", total: 144 }';

const STEPS: Step[] = [
  {
    kind: 'hop', path: 'user-agent', tone: 'request', tag: 'prompt',
    title: 'User asks the agent',
    caption: PROMPT_QUOTE,
    lines: {
      platform: { tag: 'prompt', title: 'User prompt reaches the agent', caption: PROMPT_QUOTE },
      eng: { tag: 'prompt', title: 'Your app sends the prompt', caption: PROMPT_QUOTE },
      finance: { tag: 'question', title: 'A user asks the assistant', caption: 'They ask why a customer’s order 1042 is late. Nothing has been spent yet.' },
      ai_coe: { tag: 'question', title: 'A user asks the assistant', caption: 'A service question about order 1042. Answering it needs a model and a tool.' },
      analysts: { tag: 'question', title: 'You ask your AI assistant', caption: `${PROMPT_QUOTE} From here on, your question stays inside company controls.` },
      support: { tag: 'question', title: 'You ask your AI assistant', caption: `${PROMPT_QUOTE} The kind of question a customer asks mid-call.` },
    },
  },
  {
    kind: 'hop', path: 'agent-aigw', tone: 'request', tag: 'LLM request',
    title: 'Agent calls the AI Gateway',
    caption: 'Prompt + tool definitions, authenticated with the agent’s API key. No model keys in agent code.',
    lines: {
      platform: { tag: 'LLM request', title: 'Agent calls the AI Gateway proxy', caption: 'Prompt + tool definitions with the agent’s API key. Provider credentials live in Apigee, so rotating them needs no agent redeploy.' },
      eng: { tag: 'LLM request', title: 'Your call hits the AI Gateway', caption: 'One endpoint, your API key in the header, prompt + tool definitions in the body. No model keys in your code.' },
      finance: { tag: 'AI request', title: 'Assistant asks the AI Gateway', caption: 'The request carries the team’s key, so every token that follows is charged to the right team.' },
      ai_coe: { tag: 'AI request', title: 'Assistant asks the AI Gateway', caption: 'Every model request goes through one gateway, so your model and access rules apply to every team.' },
      analysts: { tag: 'AI request', title: 'Assistant asks the AI Gateway', caption: 'Your question goes to the company gateway, not straight to an outside AI provider.' },
      support: { tag: 'AI request', title: 'Assistant asks the AI Gateway', caption: 'Your question goes through the company gateway, which keeps replies safe and fast.' },
    },
  },
  {
    kind: 'process', node: 'aigw', chips: AI_CHIPS,
    title: 'AI Gateway applies policies',
    caption: 'Identity verified, prompt screened for injection / PII, cache checked (miss), token budget checked, best-fit model selected.',
    lines: {
      platform: { title: 'AI Gateway policies execute', caption: 'API key verified (401), prompt sanitization (400 on injection / PII), semantic cache lookup (miss), token quota (429 if exhausted), then model selection.' },
      eng: { title: 'Gateway checks your request', caption: 'Key validated (401 if bad), prompt screened (400 if blocked), cache checked (miss), token quota checked (429 if over), model picked for you.' },
      finance: { title: 'Cost controls run first', caption: 'Team identified for billing, misuse blocked before it costs anything, earlier answers reused when possible (none here), budget checked, cheapest model that fits chosen.' },
      ai_coe: { title: 'Access and safety checks', caption: 'Team access confirmed, prompt screened for injection and personal data, cache checked (miss), fair-use limit checked, approved model chosen for this team.' },
      analysts: { title: 'Your data is protected', caption: 'Confirms it is you, keeps confidential or personal data out of the prompt, looks for an earlier answer (none), checks your limit, picks the right model.' },
      support: { title: 'Safety and speed checks', caption: 'Confirms it is you, screens for unsafe content, looks for a ready answer (none this time), checks your limit, picks a fast, low-cost model.' },
    },
  },
  {
    kind: 'hop', path: 'aigw-vertex', tone: 'request', tag: 'generateContent',
    title: 'Routed to Gemini on Vertex AI',
    caption: 'The gateway injects provider credentials and forwards to the selected model.',
    lines: {
      platform: { tag: 'generateContent', title: 'Routed to Gemini on Vertex AI', caption: 'The proxy injects provider credentials and forwards to the selected model. Upstream failures come back as 5xx from the proxy.' },
      eng: { tag: 'generateContent', title: 'Forwarded to Gemini on Vertex AI', caption: 'The gateway adds provider credentials and calls the model it picked. You never call Vertex AI directly.' },
      finance: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'Only now does a paid model call happen, on the model chosen for best value.' },
      ai_coe: { tag: 'to Gemini', title: 'Sent to Gemini on Vertex AI', caption: 'The gateway uses the approved provider account, so teams never hold their own AI keys.' },
      analysts: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'The gateway passes your screened question to the company’s approved AI provider.' },
      support: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'The gateway signs in to the AI provider and passes the question on.' },
    },
  },
  {
    kind: 'hop', path: 'vertex-aigw', tone: 'tool', tag: 'tool_call',
    title: 'Model replies with a tool call',
    caption: TOOL_CALL_PAYLOAD,
    lines: {
      platform: { tag: 'tool_call', title: 'Model returns a tool call', caption: TOOL_CALL_PAYLOAD },
      eng: { tag: 'tool_call', title: 'Model responds with a tool call', caption: TOOL_CALL_PAYLOAD },
      finance: { tag: 'needs a tool', title: 'The model needs order data', caption: 'It asks the customer service system for the status of order 1042 instead of guessing.' },
      ai_coe: { tag: 'needs a tool', title: 'The model asks for a tool', caption: 'Gemini requests getOrderStatus for ORD-1042, grounding its answer in company data.' },
      analysts: { tag: 'needs a tool', title: 'The model looks up real data', caption: 'It asks the customer service system for order 1042 instead of guessing, so the answer is accurate.' },
      support: { tag: 'needs a tool', title: 'The model checks real data', caption: 'It checks the status of order 1042, so you tell the customer the real situation.' },
    },
  },
  {
    kind: 'hop', path: 'aigw-agent', tone: 'tool', tag: 'tool_call',
    title: 'Tool call returned to the agent',
    caption: 'Tokens are metered and costed against the credential before the response is returned.',
    lines: {
      platform: { tag: 'tool_call', title: 'Tool call returned, tokens metered', caption: 'Token counts are recorded against the API key and costed from the rate card before the response leaves the proxy.' },
      eng: { tag: 'tool_call', title: 'Tool call back to your agent', caption: 'Tokens are counted against your key before the response returns. Your agent now runs the tool.' },
      finance: { tag: 'needs a tool', title: 'Cost recorded, back to assistant', caption: 'Tokens are priced and charged to the team before the reply goes back, so spend is tracked per request.' },
      ai_coe: { tag: 'needs a tool', title: 'Back to the assistant', caption: 'Model usage is recorded per team, so you can see which models each team really uses.' },
      analysts: { tag: 'needs a tool', title: 'Back to the assistant', caption: 'The assistant now fetches the data the model asked for.' },
      support: { tag: 'needs a tool', title: 'Back to the assistant', caption: 'The assistant now fetches the order status the model asked for.' },
    },
  },
  {
    kind: 'hop', path: 'agent-mcpgw', tone: 'tool', tag: 'tools/call',
    title: 'Agent calls the MCP Gateway',
    caption: 'JSON-RPC tools/call getOrderStatus, same API key as the LLM call.',
    lines: {
      platform: { tag: 'tools/call', title: 'Agent calls the MCP Gateway', caption: 'JSON-RPC tools/call getOrderStatus, same API key as the LLM call. One credential governs both proxies.' },
      eng: { tag: 'tools/call', title: 'Your agent calls the MCP Gateway', caption: 'JSON-RPC tools/call getOrderStatus with the same API key you used for the LLM call.' },
      finance: { tag: 'tool request', title: 'Assistant asks the Tools Gateway', caption: 'Same team key as the AI call, so tool usage is attributed to the same team.' },
      ai_coe: { tag: 'tool request', title: 'Assistant asks the Tools Gateway', caption: 'Tool access runs through one gateway, with the same team identity as the model call.' },
      analysts: { tag: 'tool request', title: 'Assistant asks the Tools Gateway', caption: 'It asks to use the order status lookup through the company gateway, never directly.' },
      support: { tag: 'tool request', title: 'Assistant asks the Tools Gateway', caption: 'It asks to use the order status tool, with the same access key.' },
    },
  },
  {
    kind: 'process', node: 'mcpgw', chips: MCP_CHIPS,
    title: 'MCP Gateway applies policies',
    caption: 'API key checked, tools filtered to the persona’s product, rate limit checked, call forwarded to the MCP server, translated to REST for Apigee-hosted tools.',
    lines: {
      platform: { title: 'MCP Gateway policies execute', caption: 'API key verified (401), tool on the persona product (401 if not), rate limit checked (429), MCP server called, JSON-RPC → REST for Apigee-hosted tools.' },
      eng: { title: 'Gateway checks your tool call', caption: 'Key checked (401), tool must be on your product (401), rate limit checked (429), call forwarded to the MCP server, mapped to REST if Apigee hosts it.' },
      finance: { title: 'Tool use is controlled', caption: 'Team identified, only tools approved for this team allowed, runaway call volumes capped, then the existing tool does the work.' },
      ai_coe: { title: 'Tool access is governed', caption: 'Assistant identified, only tools approved for this persona allowed, fair-use limit applied, then the in-house or partner tool runs.' },
      analysts: { title: 'Tools Gateway protects data', caption: 'Checks who is asking, allows only the data tools your team is approved for, limits how often, then the tool answers.' },
      support: { title: 'Tools Gateway runs checks', caption: 'Checks who is asking, confirms your team may use this tool, limits how often, then the service tool answers.' },
    },
  },
  {
    kind: 'hop', path: 'mcpgw-rest', tone: 'tool', tag: 'REST call',
    title: 'Apigee-hosted MCP calls the REST API',
    caption: 'The gateway’s last step is the Apigee-hosted MCP server: it turns the tool call into a call to the existing Customer Service REST API. No MCP server to build or run.',
    lines: {
      platform: { tag: 'REST call', title: 'Apigee-hosted MCP → REST', caption: 'Last MCP Gateway step: tool name and arguments map to the REST URL, verb and parameters of the private Cloud Run API; arguments are schema-checked (-32602). Refunds over $50 get 403 REFUND_LIMIT.' },
      eng: { tag: 'REST call', title: 'Translated to a REST call', caption: 'Apigee hosts the MCP server: getOrderStatus becomes a GET on the existing Customer Service API. No MCP server code; bad arguments return JSON-RPC -32602.' },
      finance: { tag: 'lookup', title: 'The existing system is asked', caption: 'Apigee turns the existing system into an AI tool, so there is no new build or running cost.' },
      ai_coe: { tag: 'lookup', title: 'The existing system is asked', caption: 'An existing company API becomes an AI tool without a new integration project. Refunds over $50 still need a supervisor.' },
      analysts: { tag: 'lookup', title: 'The existing system is asked', caption: 'The request goes to the system of record, so the status is current.' },
      support: { tag: 'lookup', title: 'The existing system is asked', caption: 'Your existing orders & customers system is asked for order 1042.' },
    },
  },
  {
    kind: 'hop', path: 'rest-mcpgw', tone: 'response', tag: 'tool result',
    title: 'The REST API answers',
    caption: TOOL_RESULT_PAYLOAD,
    lines: {
      platform: { tag: 'tool result', title: 'REST response wrapped as the tool result', caption: TOOL_RESULT_PAYLOAD },
      eng: { tag: 'tool result', title: 'Tool result returned', caption: TOOL_RESULT_PAYLOAD },
      finance: { tag: 'result', title: 'The system replies', caption: 'Order 1042: delayed, $144.' },
      ai_coe: { tag: 'result', title: 'The system replies', caption: 'Order 1042: delayed, straight from company data.' },
      analysts: { tag: 'result', title: 'The system replies', caption: 'Order 1042: delayed, from the system of record.' },
      support: { tag: 'result', title: 'The system replies', caption: 'Order 1042: delayed.' },
    },
  },
  {
    kind: 'hop', path: 'mcpgw-agent', tone: 'response', tag: 'tool result',
    title: 'Tool result back to the agent',
    caption: 'The call is logged with the tool name and caller for the Tools Gateway analytics.',
    lines: {
      platform: { tag: 'tool result', title: 'Tool result back to the agent', caption: 'Logged with tool name and caller in Tools Gateway analytics; use it to trace failed or throttled calls.' },
      eng: { tag: 'tool result', title: 'Tool result back to your agent', caption: 'Returned as a JSON-RPC result. The call is logged with the tool name and your key for debugging.' },
      finance: { tag: 'result', title: 'Result back to the assistant', caption: 'Each tool call is logged by team, ready for chargeback and reporting.' },
      ai_coe: { tag: 'result', title: 'Result back to the assistant', caption: 'Who used which tool is recorded, for audit and adoption tracking.' },
      analysts: { tag: 'result', title: 'Result back to the assistant', caption: 'Who used which data tool is recorded, for audit.' },
      support: { tag: 'result', title: 'Result back to the assistant', caption: 'The order status is ready for the assistant to use in your reply.' },
    },
  },
  {
    kind: 'hop', path: 'agent-aigw', tone: 'request', tag: 'LLM + tool result',
    title: 'Agent sends the tool result to the AI Gateway',
    caption: 'Second LLM turn: the conversation now includes the tool response.',
    lines: {
      platform: { tag: 'LLM + tool result', title: 'Second LLM turn to the AI Gateway', caption: 'The conversation now includes the tool response; the same proxy and policies handle every turn.' },
      eng: { tag: 'LLM + tool result', title: 'Your agent sends the tool result', caption: 'Second LLM call: the conversation now includes the tool response, same endpoint and key.' },
      finance: { tag: 'AI request + data', title: 'Assistant sends the data back', caption: 'Second model call: it is metered and charged just like the first.' },
      ai_coe: { tag: 'AI request + data', title: 'Assistant sends the data back', caption: 'Second round: the model gets the order data it asked for.' },
      analysts: { tag: 'AI request + data', title: 'Assistant sends the data back', caption: 'Second round: the question now comes with the order data.' },
      support: { tag: 'AI request + data', title: 'Assistant sends the data back', caption: 'Second round: the question now comes with the order status.' },
    },
  },
  {
    kind: 'process', node: 'aigw', chips: ['Access Control', 'Token Quotas', 'Smart Routing (Model Selection)'],
    title: 'Policies applied again',
    caption: 'Identity, quota and routing run again. Model Armor is skipped: this turn carries tool output, not a new user prompt.',
    lines: {
      platform: { title: 'Policies applied again', caption: 'Auth, token quota and routing run again. SUP-UserPrompt (Model Armor) is skipped: it only runs when flow.userPrompt is set, and a tool-result turn has no new user text.' },
      eng: { title: 'Checked again', caption: 'Key, quota and routing are checked again, so a 401 or 429 can happen on this call. No Model Armor screen: the turn has no new user prompt.' },
      finance: { title: 'Budget checked again', caption: 'Every round is checked against the budget and metered, not just the first. No second safety screen is paid for.' },
      ai_coe: { title: 'Checked again', caption: 'Access, usage limits and model choice apply again. The safety screen is skipped: the user asked nothing new, this is company data.' },
      analysts: { title: 'Checked again', caption: 'Access and limits are checked again. Your question was already screened on the first round, so it is not screened twice.' },
      support: { title: 'Checked again', caption: 'Access and limits are checked again. Your question was already screened, so there is no second screen.' },
    },
  },
  {
    kind: 'hop', path: 'aigw-vertex', tone: 'request', tag: 'generateContent',
    title: 'Forwarded to Vertex AI',
    caption: 'The model now has the data it needs to answer.',
    lines: {
      platform: { tag: 'generateContent', title: 'Forwarded to Vertex AI', caption: 'Same routing and injected credentials as the first turn.' },
      eng: { tag: 'generateContent', title: 'Forwarded to Vertex AI', caption: 'The model now has the data it needs to answer.' },
      finance: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'Second paid model call, again on the best-value model.' },
      ai_coe: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'The approved model now has the data it needs to answer.' },
      analysts: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'The model now has real data to base its answer on.' },
      support: { tag: 'to Gemini', title: 'Sent to Gemini', caption: 'The model now has what it needs to answer.' },
    },
  },
  {
    kind: 'hop', path: 'vertex-aigw', tone: 'response', tag: 'final answer',
    title: 'Model returns the final answer',
    caption: 'Plain-text answer, no further tool calls.',
    lines: {
      platform: { tag: 'final answer', title: 'Model returns the final answer', caption: 'Plain-text response, no further tool calls; the agent loop ends here.' },
      eng: { tag: 'final answer', title: 'Model returns the final answer', caption: 'Plain-text answer, no further tool calls.' },
      finance: { tag: 'answer', title: 'The model answers', caption: 'A plain answer, no more tool calls and no further spend.' },
      ai_coe: { tag: 'answer', title: 'The model answers', caption: 'A grounded answer, no more tools needed.' },
      analysts: { tag: 'answer', title: 'The model answers', caption: 'An answer based on real order data.' },
      support: { tag: 'answer', title: 'The model answers', caption: 'A plain answer, no more tools needed.' },
    },
  },
  {
    kind: 'hop', path: 'aigw-agent', tone: 'response', tag: 'final answer',
    title: 'Answer returned to the agent',
    caption: 'Tokens metered; spend and model usage appear in the AI Gateway analytics.',
    lines: {
      platform: { tag: 'final answer', title: 'Answer returned, tokens metered', caption: 'Tokens metered; spend and model usage appear in AI Gateway analytics for alerting and capacity planning.' },
      eng: { tag: 'final answer', title: 'Answer returned to your agent', caption: 'Tokens counted against your quota; latency and usage show in the AI Gateway analytics.' },
      finance: { tag: 'answer', title: 'Spend recorded, answer returned', caption: 'The cost is charged to the team and shows in the Analytics & Cost dashboard.' },
      ai_coe: { tag: 'answer', title: 'Answer back to the assistant', caption: 'Model usage by team shows in the Analytics & Cost dashboard.' },
      analysts: { tag: 'answer', title: 'Answer back to the assistant', caption: 'Similar questions later can reuse this answer, so they come back faster and cost less.' },
      support: { tag: 'answer', title: 'Answer back to the assistant', caption: 'Similar customer questions later can be answered instantly from this one.' },
    },
  },
  {
    kind: 'hop', path: 'agent-user', tone: 'response', tag: 'response',
    title: 'Agent responds to the user',
    caption: ANSWER_QUOTE,
    lines: {
      platform: { tag: 'response', title: 'Agent responds to the user', caption: ANSWER_QUOTE },
      eng: { tag: 'response', title: 'Your app gets the response', caption: ANSWER_QUOTE },
      finance: { tag: 'answer', title: 'The user gets the answer', caption: `${ANSWER_QUOTE} The cost of this answer is known and charged to the team.` },
      ai_coe: { tag: 'answer', title: 'The user gets the answer', caption: `${ANSWER_QUOTE} Model, tool and safety rules applied at every step.` },
      analysts: { tag: 'answer', title: 'You get the answer', caption: `${ANSWER_QUOTE} Based on real data, with confidential data kept protected.` },
      support: { tag: 'answer', title: 'You get the answer', caption: `${ANSWER_QUOTE} Checked and safe to share with the customer.` },
    },
  },
];

const TONE_COLOR: Record<Tone, string> = {
  request: '#2563eb',
  tool: '#d97706',
  response: '#059669',
};

const HOP_MS = 1500;
const CHIP_MS = 520;

function stepDuration(step: Step): number {
  return step.kind === 'hop' ? HOP_MS : step.chips.length * CHIP_MS + 300;
}

/** Nodes that are "involved" in a step, for highlighting. */
function nodesForStep(step: Step): NodeId[] {
  if (step.kind === 'process') return [step.node];
  const [a, b] = step.path.split('-') as NodeId[];
  return [a, b];
}

interface AgentFlowDiagramProps {
  onDrillDown?: (flow: 'ai-gateway' | 'mcp-gateway') => void;
  /** Start at a given step (0-based). Mainly for previews / deep links. */
  initialStep?: number;
}

export default function AgentFlowDiagram({ onDrillDown, initialStep = 0 }: AgentFlowDiagramProps) {
  const [stepIdx, setStepIdx] = useState(Math.max(0, Math.min(STEPS.length - 1, initialStep)));
  const [progress, setProgress] = useState(0);
  // 'auto' = continuous play, 'once' = animate current step then pause, 'paused'
  const [mode, setMode] = useState<'auto' | 'once' | 'paused'>('auto');
  const [speed, setSpeed] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pathRefs = useRef<Partial<Record<PathId, SVGPathElement | null>>>({});
  const [pathLens, setPathLens] = useState<Partial<Record<PathId, number>>>({});
  const listRef = useRef<HTMLOListElement | null>(null);
  const { speaker, sp } = usePersonaVoice('active');
  // Customer theme: brand-role colours as hex (SVG attributes and `${hex}14` tints cannot use CSS variables).
  const { hex } = useCustomerTheme();
  const brandBlue = hex('blue', 600, '#2563eb');
  const brandCyan = hex('cyan', 600, '#0891b2');
  const brandViolet = hex('violet', 600, '#7c3aed');
  const brandTeal = hex('teal', 600, '#0d9488');
  const brandSky = hex('sky', 600, '#0284c7');
  const toneColor: Record<Tone, string> = { ...TONE_COLOR, request: brandBlue };
  const stepTitle = (s: Step) => s.lines?.[speaker]?.title ?? s.title;
  const stepCaption = (s: Step) => s.lines?.[speaker]?.caption ?? s.caption;
  const stepTag = (s: Hop) => s.lines?.[speaker]?.tag ?? s.tag;
  const chipLabel = (c: string) => (CHIP_LABEL[c] ? speak(speaker, CHIP_LABEL[c]) : c);

  // Keep the current step visible in the step list (scroll the list only, not the page)
  useEffect(() => {
    const list = listRef.current;
    const cur = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !cur) return;
    const top = cur.offsetTop; // list is position:relative, so offsetTop is list-relative
    if (top < list.scrollTop || top + cur.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  }, [stepIdx]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const lens: Partial<Record<PathId, number>> = {};
    (Object.keys(PATHS) as PathId[]).forEach((id) => {
      const el = pathRefs.current[id];
      if (el) lens[id] = el.getTotalLength();
    });
    setPathLens(lens);
  }, []);

  // Animation loop
  useEffect(() => {
    if (mode === 'paused') return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setProgress((p) => {
        const next = p + (dt * speed) / stepDuration(STEPS[stepIdx]);
        return next >= 1 ? 1 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, stepIdx, speed]);

  // Advance when a step completes (with a short dwell so captions are readable)
  useEffect(() => {
    if (progress < 1 || mode === 'paused') return;
    if (mode === 'once') {
      setMode('paused');
      return;
    }
    const t = window.setTimeout(() => {
      if (stepIdx < STEPS.length - 1) {
        setStepIdx((i) => i + 1);
        setProgress(0);
      } else {
        setMode('paused');
      }
    }, (reducedMotion ? 1600 : 350) / speed);
    return () => window.clearTimeout(t);
  }, [progress, mode, stepIdx, speed, reducedMotion]);

  const goTo = useCallback((idx: number) => {
    setStepIdx(Math.max(0, Math.min(STEPS.length - 1, idx)));
    setProgress(0);
    setMode((m) => (m === 'auto' ? 'auto' : 'once'));
  }, []);

  const togglePlay = () => {
    if (mode === 'auto') {
      setMode('paused');
    } else {
      if (stepIdx === STEPS.length - 1 && progress >= 1) {
        setStepIdx(0);
        setProgress(0);
      }
      setMode('auto');
    }
  };

  const replay = () => {
    setStepIdx(0);
    setProgress(0);
    setMode('auto');
  };

  const step = STEPS[stepIdx];
  const activeNodes = useMemo(() => new Set(nodesForStep(step)), [step]);

  // Moving packet position
  let packet: { x: number; y: number; color: string; tag: string } | null = null;
  if (step.kind === 'hop' && !reducedMotion) {
    const el = pathRefs.current[step.path];
    const len = pathLens[step.path];
    if (el && len) {
      const pt = el.getPointAtLength(len * Math.min(progress, 1));
      packet = { x: pt.x, y: pt.y, color: toneColor[step.tone], tag: stepTag(step) };
    }
  }

  const chipState = (node: 'aigw' | 'mcpgw', label: string): 'idle' | 'active' | 'done' => {
    if (step.kind !== 'process' || step.node !== node) return 'idle';
    const i = step.chips.indexOf(label);
    if (i < 0) return 'idle';
    const at = progress * step.chips.length;
    if (at >= i + 1) return 'done';
    if (at >= i) return 'active';
    return 'idle';
  };

  const nodeBox = (
    id: NodeId,
    x: number, y: number, w: number, h: number,
    color: string, Icon: React.ElementType, title: string, subtitle: string,
  ) => {
    const on = activeNodes.has(id);
    return (
      <g>
        <rect
          x={x} y={y} width={w} height={h} rx={14}
          fill={on ? `${color}14` : '#ffffff'}
          stroke={on ? color : '#cbd5e1'}
          strokeWidth={on ? 2.5 : 1.5}
          style={{ transition: 'all 250ms ease' }}
        />
        <Icon x={x + w / 2 - 13} y={y + h / 2 - 34} width={26} height={26} color={color} />
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={14} fontWeight={700} fill="#0f172a">{title}</text>
        <text x={x + w / 2} y={y + h / 2 + 30} textAnchor="middle" fontSize={11} fill="#64748b">{subtitle}</text>
      </g>
    );
  };

  /** Smaller backend box: icon on the left, title and subtitle on the right. */
  const compactNode = (
    id: NodeId,
    x: number, y: number, w: number, h: number,
    color: string, Icon: React.ElementType, title: string, subtitle: string,
  ) => {
    const on = activeNodes.has(id);
    const cy = y + h / 2;
    // A '\n' in the subtitle starts a second line (long provider lists).
    const subLines = subtitle.split('\n');
    return (
      <g>
        <rect
          x={x} y={y} width={w} height={h} rx={12}
          fill={on ? `${color}14` : '#ffffff'}
          stroke={on ? color : '#cbd5e1'}
          strokeWidth={on ? 2.5 : 1.5}
          style={{ transition: 'all 250ms ease' }}
        />
        <Icon x={x + 12} y={cy - 11} width={22} height={22} color={color} />
        <text x={x + 42} y={cy - 2 - (subLines.length - 1) * 6} fontSize={title.length > 16 ? 12 : 13} fontWeight={700} fill="#0f172a">{title}</text>
        {subLines.map((line, i) => (
          <text key={i} x={x + 42} y={cy + 14 + i * 13 - (subLines.length - 1) * 6} fontSize={10} fill="#64748b">{line}</text>
        ))}
      </g>
    );
  };

  /** Backend box whose content is a row of brand logos under a centred title. */
  const logoNode = (
    id: NodeId,
    x: number, y: number, w: number, h: number,
    color: string, title: string, logos: (BrandLogoId | 'selfhosted')[], size = 22,
  ) => {
    const on = activeNodes.has(id);
    const gap = size < 26 ? 9 : 12;
    const rowW = logos.length * size + (logos.length - 1) * gap;
    const lx = x + (w - rowW) / 2;
    const ly = y + h / 2 + 2;
    return (
      <g>
        <rect
          x={x} y={y} width={w} height={h} rx={12}
          fill={on ? `${color}14` : '#ffffff'}
          stroke={on ? color : '#cbd5e1'}
          strokeWidth={on ? 2.5 : 1.5}
          style={{ transition: 'all 250ms ease' }}
        />
        <text x={x + w / 2} y={y + h / 2 - (size > 24 ? 12 : 9)} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">{title}</text>
        {logos.map((l, i) => {
          const lxI = lx + i * (size + gap);
          if (l === 'selfhosted') {
            return (
              <g key={l}>
                <title>Self-hosted models</title>
                <Server x={lxI} y={ly} width={size} height={size} color="#475569" />
              </g>
            );
          }
          const logo = BRAND_LOGOS[l];
          return (
            <g key={l}>
              <title>{logo.name}</title>
              <svg x={lxI} y={ly} width={size} height={size} viewBox="0 0 24 24">
                <path d={logo.path} fill={logo.color} />
              </svg>
            </g>
          );
        })}
      </g>
    );
  };

  const gatewayBox = (
    id: 'aigw' | 'mcpgw', y: number, color: string, Icon: React.ElementType,
    title: string, chips: string[], flow: 'ai-gateway' | 'mcp-gateway',
  ) => {
    const on = activeNodes.has(id);
    const x = 440, w = 300, h = 220;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={sp({
          technical: `Open the ${title} policy pipeline`,
          eng: `Open the ${title} pipeline`,
          finance: `See the ${title} cost checks`,
          ai_coe: `See the ${title} controls`,
          analysts: `See the ${title} checks`,
          support: `See the ${title} checks`,
        })}
        onClick={() => onDrillDown?.(flow)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrillDown?.(flow); } }}
        style={{ cursor: onDrillDown ? 'pointer' : 'default', outline: 'none' }}
      >
        <rect
          x={x} y={y} width={w} height={h} rx={16}
          fill={on ? `${color}10` : '#f8fafc'}
          stroke={color} strokeOpacity={on ? 1 : 0.45}
          strokeWidth={on ? 2.5 : 1.5}
          style={{ transition: 'all 250ms ease' }}
        />
        <Icon x={x + 16} y={y + 13} width={18} height={18} color={color} />
        <text x={x + 40} y={y + 27} fontSize={14} fontWeight={700} fill="#0f172a">{title}</text>
        <text x={x + w - 14} y={y + 27} textAnchor="end" fontSize={10} fontWeight={600} fill={color}>
          {sp({
            technical: 'Policies →',
            eng: 'Drill down →',
            finance: 'Cost checks →',
            ai_coe: 'See controls →',
            analysts: 'See checks →',
            support: 'See checks →',
          })}
        </text>
        {chips.map((c, i) => {
          const st = chipState(id, c);
          const cy = y + 44 + i * 34;
          const hosted = c === HOSTED_MCP_CHIP;
          const tone = hosted ? HOSTED_MCP_COLOR : color;
          const ch = hosted ? 32 : 27;
          const fill = st === 'active' ? tone : st === 'done' ? '#ecfdf5' : hosted ? '#fff7ed' : '#ffffff';
          const stroke = st === 'active' ? tone : st === 'done' ? '#10b981' : hosted ? '#fdba74' : '#e2e8f0';
          const textFill = st === 'active' ? '#ffffff' : st === 'done' ? '#047857' : hosted ? '#9a3412' : '#334155';
          return (
            <g key={c} style={{ transition: 'all 200ms ease' }}>
              <rect x={x + 16} y={cy} width={w - 32} height={ch} rx={8} fill={fill} stroke={stroke} strokeWidth={hosted ? 1.6 : 1.2}
                strokeDasharray={hosted && st === 'idle' ? '5 3' : undefined} />
              <text x={x + 30} y={cy + (hosted ? 20.5 : 18)} fontSize={12} fontWeight={hosted ? 700 : 600} fill={textFill}>
                {st === 'done' ? '✓ ' : ''}{chipLabel(c)}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  const activePath = step.kind === 'hop' ? step.path : null;

  const legendLabel = (t: Tone) =>
    t === 'request'
      ? sp({ technical: 'Request', eng: 'Request', finance: 'Question', ai_coe: 'Request', analysts: 'Question', support: 'Question' })
      : t === 'tool'
        ? sp({ technical: 'Tool call', eng: 'Tool call', finance: 'Tool use', ai_coe: 'Tool use', analysts: 'Data lookup', support: 'Data lookup' })
        : sp({ technical: 'Response', eng: 'Response', finance: 'Answer', ai_coe: 'Answer', analysts: 'Answer', support: 'Reply' });

  const mcpTitle = sp({ technical: 'MCP Gateway', eng: 'MCP Gateway', business: 'Tools Gateway' });

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => goTo(stepIdx - 1)} disabled={stepIdx === 0}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer" aria-label="Previous step">
            <SkipBack className="w-4 h-4" />
          </button>
          <button type="button" onClick={togglePlay}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 cursor-pointer" aria-label={mode === 'auto' ? 'Pause' : 'Play'}>
            {mode === 'auto' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {mode === 'auto' ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => goTo(stepIdx + 1)} disabled={stepIdx === STEPS.length - 1}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer" aria-label="Next step">
            <SkipForward className="w-4 h-4" />
          </button>
          <button type="button" onClick={replay}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer" aria-label="Replay from start">
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="ml-2 flex items-center gap-1 text-[11px] text-slate-500">
            Speed
            {[0.5, 1, 2].map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold cursor-pointer ${speed === s ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {s}×
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          {(['request', 'tool', 'response'] as Tone[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: toneColor[t] }} />
              {legendLabel(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        {/* Diagram */}
        <div className="flex-1 min-w-0 rounded-2xl border border-slate-200 bg-white p-2 flex items-center justify-center">
          <svg viewBox="0 0 1010 520" className="w-full h-auto max-h-[58vh]" role="img"
            aria-label={sp({
              technical: 'Animated request flow from user to agent, AI Gateway and MCP Gateway proxies, Gemini on Vertex AI and other models, an Apigee-hosted MCP server with its REST API, a self-hosted MCP server and 3rd-party MCP servers',
              eng: 'Animated flow of your request from app to agent, AI Gateway, Gemini or another model, MCP Gateway, and Apigee-hosted, self-hosted or 3rd-party MCP servers',
              finance: 'Animated flow showing where each question is costed: assistant, AI Gateway, Gemini or another model, Tools Gateway, and in-house or 3rd-party tools',
              ai_coe: 'Animated flow showing where model access and safety are checked: assistant, AI Gateway, Gemini or another model, Tools Gateway, and in-house or 3rd-party tools',
              analysts: 'Animated flow of your question through the assistant, AI Gateway, the AI model, Tools Gateway, and the company and 3rd-party tools',
              support: 'Animated flow of your question through the assistant, AI Gateway, the AI model, Tools Gateway, and the company and 3rd-party tools',
            })}>
            {/* Apigee boundary */}
            <rect x={425} y={6} width={330} height={508} rx={20} fill="none" stroke="#94a3b8" strokeDasharray="6 5" />
            <text x={590} y={262} textAnchor="middle" fontSize={11} fontWeight={700} fill="#64748b" letterSpacing={1.5}>APIGEE</text>

            {/* Base paths */}
            <defs>
              {/* Arrowheads show the direction of each request / response line. */}
              {([['idle', '#94a3b8'], ['request', toneColor.request], ['tool', toneColor.tool], ['response', toneColor.response]] as const).map(([k, c]) => (
                <marker key={k} id={`afd-arrow-${k}`} viewBox="0 0 10 10" refX={9} refY={5}
                  markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              ))}
            </defs>
            {(Object.keys(PATHS) as PathId[]).map((id) => (
              <path key={id} ref={(el) => { pathRefs.current[id] = el; }} d={PATHS[id]}
                fill="none" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="4 4" markerEnd="url(#afd-arrow-idle)" />
            ))}
            {/* Active path: draws in as the packet travels */}
            {activePath && step.kind === 'hop' && (
              <path d={PATHS[activePath]} fill="none" stroke={toneColor[step.tone]} strokeWidth={3} strokeLinecap="round"
                strokeDasharray={pathLens[activePath] ?? 1000}
                strokeDashoffset={reducedMotion ? 0 : (pathLens[activePath] ?? 1000) * (1 - progress)}
                markerEnd={reducedMotion || progress >= 0.97 ? `url(#afd-arrow-${step.tone})` : undefined} />
            )}

            {nodeBox('user', 20, 195, 130, 140, '#475569', User,
              sp({ technical: 'User', eng: 'Your app', finance: 'User', ai_coe: 'User', analysts: 'You', support: 'You' }),
              sp({ technical: 'Consumer / app', eng: 'Client / caller', finance: 'Team member', ai_coe: 'Team member', analysts: 'Asks a question', support: 'Asks a question' }))}
            {nodeBox('agent', 222, 185, 150, 160, brandViolet, Bot,
              sp({ technical: 'Agent', eng: 'Agent', business: 'Assistant' }),
              sp({ technical: 'ADK agent runtime', eng: 'Your ADK agent', finance: 'Works for the team', ai_coe: 'Uses approved AI', analysts: 'Works for you', support: 'Works for you' }))}
            {gatewayBox('aigw', 20, brandBlue, Sparkles, 'AI Gateway', AI_CHIPS, 'ai-gateway')}
            {gatewayBox('mcpgw', 285, brandCyan, Terminal, mcpTitle, MCP_CHIPS, 'mcp-gateway')}
            {/* Model backends behind the AI Gateway (aligned with its box, 20-240) */}
            {logoNode('vertex', 820, 20, 180, 104, '#059669',
              sp({ technical: 'Gemini · Vertex AI', eng: 'Gemini · Vertex AI', business: 'Google Gemini' }),
              ['gemini'], 30)}
            {logoNode('claude', 820, 136, 180, 104, '#b45309',
              sp({ technical: 'Other models', eng: 'Other models', business: 'Other AI models' }),
              ['anthropic', 'bedrock', 'openai', 'deepseek', 'selfhosted'], 24)}
            {/* Tool backends behind the MCP Gateway (aligned with its box, 285-505). The
                Apigee-hosted MCP server is the gateway's own last step, so only its REST API is outside. */}
            {compactNode('loans', 820, 285, 180, 70, brandTeal, Database,
              sp({ technical: 'Self-hosted MCP', eng: 'Self-hosted MCP', business: 'In-house tools' }),
              sp({ technical: '1st-party, customer-run', eng: 'Your own MCP server', finance: 'Run by the company', ai_coe: 'Built in-house', analysts: 'Company data tools', support: 'Company data tools' }))}
            {/* Industry-agnostic enterprise examples */}
            {logoNode('thirdparty', 820, 361, 180, 70, brandSky,
              sp({ technical: '3rd-party MCP', eng: '3rd-party MCP', business: 'Partner tools' }),
              ['bigquery', 'salesforce', 'sap', 'jira'], 22)}
            {compactNode('rest', 820, 445, 180, 60, '#d97706', Database, 'REST API',
              sp({ technical: 'Existing backend, via\nthe Apigee-hosted MCP', eng: 'Existing backend, via\nthe Apigee-hosted MCP', finance: 'Existing system', ai_coe: 'Existing company API', analysts: 'System of record', support: 'Orders & customers' }))}

            {/* Moving packet */}
            {packet && (
              <g pointerEvents="none">
                <circle cx={packet.x} cy={packet.y} r={9} fill={packet.color} opacity={0.25} />
                <circle cx={packet.x} cy={packet.y} r={5.5} fill={packet.color} stroke="#fff" strokeWidth={1.5} />
                {(() => {
                  const w = packet.tag.length * 6.4 + 14;
                  return (
                    <g transform={`translate(${packet.x - w / 2}, ${packet.y - 30})`}>
                      <rect width={w} height={18} rx={9} fill={packet.color} />
                      <text x={w / 2} y={12.5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">{packet.tag}</text>
                    </g>
                  );
                })()}
              </g>
            )}
          </svg>
        </div>

        {/* Step list */}
        <div className="lg:w-80 shrink-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 flex flex-col max-h-[58vh]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Step {stepIdx + 1} of {STEPS.length}
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-3 mb-2">
            <div className="text-sm font-bold text-slate-900">{stepTitle(step)}</div>
            <p className="text-xs text-slate-600 mt-1 leading-snug">{stepCaption(step)}</p>
          </div>
          <ol ref={listRef} className="relative overflow-y-auto space-y-0.5 pr-1 flex-1">
            {STEPS.map((s, i) => {
              const cur = i === stepIdx;
              const dotColor = s.kind === 'hop' ? toneColor[s.tone] : s.node === 'aigw' ? brandBlue : brandCyan;
              return (
                <li key={i}>
                  <button type="button" onClick={() => goTo(i)} aria-current={cur ? 'step' : undefined}
                    className={`w-full text-left flex items-start gap-2 px-2 py-1 rounded-lg text-[11px] cursor-pointer transition ${cur ? 'bg-white border border-blue-300 text-slate-900 font-semibold shadow-sm' : i < stepIdx ? 'text-slate-500 hover:bg-white' : 'text-slate-400 hover:bg-white'}`}>
                    <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: i <= stepIdx ? dotColor : '#cbd5e1' }} />
                    <span>{String(i + 1).padStart(2, '0')} · {stepTitle(s)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {onDrillDown && (
            <div className="pt-2 mt-2 border-t border-slate-200 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => onDrillDown('ai-gateway')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 cursor-pointer">
                <Sparkles className="w-3.5 h-3.5" />{' '}
                {sp({
                  technical: 'AI Gateway policies',
                  eng: 'AI Gateway pipeline',
                  finance: 'AI Gateway cost checks',
                  ai_coe: 'AI Gateway controls',
                  analysts: 'AI Gateway checks',
                  support: 'AI Gateway checks',
                })}{' '}
                <ArrowRight className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onDrillDown('mcp-gateway')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-white border border-cyan-300 text-cyan-700 hover:bg-cyan-50 cursor-pointer">
                <Terminal className="w-3.5 h-3.5" />{' '}
                {sp({
                  technical: 'MCP Gateway policies',
                  eng: 'MCP Gateway pipeline',
                  finance: 'Tools Gateway cost checks',
                  ai_coe: 'Tools Gateway controls',
                  analysts: 'Tools Gateway checks',
                  support: 'Tools Gateway checks',
                })}{' '}
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
