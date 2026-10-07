import { AppTab } from '../types';
import { speak, type Speaker } from '../utils/voice';

/**
 * Actions the tour can fire to produce live telemetry mid-narration.
 *
 * A tour that only describes the UI is a worse version of the documentation. These fire the
 * same preset handlers the demo chips use, so the narration lands on a real response with
 * real numbers instead of on a description of one.
 */
export type TourActionId = 'auto-simple' | 'auto-coding' | 'cache-seed' | 'cache-hit';

/** One speaker's wording for a step. Missing fields fall back via speak(). */
export interface TourStepCopy {
  title?: string;
  body?: string;
  note?: string;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * `data-tour-id` of the element to tether the step to.
   * Omit for a step that should float centrally (intro/outro).
   */
  target?: string;
  /** Tab that must be active for `target` to exist. The tour switches to it on entry. */
  tab?: AppTab;
  /** Step is only reachable as the admin persona; skipped otherwise with a note. */
  adminOnly?: boolean;
  /** Fires a real gateway call when the step is entered. */
  action?: TourActionId;
  /** Secondary line, rendered muted - the "why this matters" rather than the "what". */
  note?: string;
  /**
   * Business-voice copy (Finance, AI CoE, Analysts, Customer Support & Sales). Used when a
   * business speaker has no line of its own in `lines`; the technical fields above stay the
   * source of truth and the final fallback.
   */
  businessTitle?: string;
  businessBody?: string;
  businessNote?: string;
  /**
   * Per-speaker copy. The tour narrates in the voice of whoever is acting on the step's tab:
   * steps on playground tabs (AI Gateway, Tools) are read by eng / analysts / support; steps
   * on admin tabs (Analytics, Admin Console) by platform / finance / ai_coe; steps without a
   * tab can be read by all six.
   */
  lines?: Partial<Record<Speaker, TourStepCopy>>;
}

/** Resolve a step's title / body / note for the acting speaker. */
export function tourCopy(step: TourStep, speaker: Speaker): { title: string; body: string; note?: string } {
  const own = step.lines?.[speaker];
  return {
    title: own?.title ?? speak(speaker, { technical: step.title, business: step.businessTitle }),
    body: own?.body ?? speak(speaker, { technical: step.body, business: step.businessBody }),
    note:
      own?.note ??
      (step.note === undefined ? undefined : speak(speaker, { technical: step.note, business: step.businessNote })),
  };
}

/**
 * The guided demo.
 *
 * Ordered as a narrative rather than as a UI inventory: brand it (customer theme), then
 * govern (routing), save (cache) and prove (flow + telemetry) on the AI Gateway, then the
 * same controls for tools (MCP Gateway), then both together in the Agent Showcase, then
 * the surrounding admin surfaces. Each
 * scenario runs for real, so the numbers quoted in the copy are deliberately vague
 * ("cheapest tier", "a fraction") - hard-coded figures would be wrong the first time a
 * model price or a network condition changed.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Apigee AI Gateway, in about five minutes',
    body:
      'First I dress the demo in your customer\'s brand. Then real traffic goes through live Apigee proxies: ' +
      'prompts through the AI Gateway, tool calls through the MCP Gateway, and finally two agents side by side, ' +
      'one governed and one not. Nothing here is mocked.',
    note: 'You can leave at any point with Esc, and restart from the Guide me button.',
    businessTitle: 'How your company governs AI, in about five minutes',
    businessBody:
      'First I dress the demo in your customer\'s brand. Then real questions go to real AI models through the company ' +
      'gateway, business tools are used through the same gateway, and two AI agents answer side by side: one with ' +
      'controls, one without. Nothing is mocked.',
    // No tab: seen from whichever tab the tour was opened on, so all six speakers.
    lines: {
      platform: {
        title: 'The AI and MCP Gateways, in about five minutes',
        body:
          'Customer theme first, then real traffic through the deployed ai-gateway-v1 and MCP proxies to Vertex AI and ' +
          'the tool backends, then two agents side by side. For each call I will show which policies ran and what they decided.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
      finance: {
        title: 'Where AI spend is controlled, in five minutes',
        body:
          'Customer branding first, then real questions to real, paid AI models and business tools through the company ' +
          'gateway, then two agents side by side. I will show what each one cost and what the gateway saved.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
      ai_coe: {
        title: 'How AI use is governed, in five minutes',
        body:
          'Customer branding first, then real questions, tool calls and agents through the company gateway. I will show ' +
          'which model was chosen, which tools each team may use and what an ungoverned agent does differently.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
      eng: {
        title: 'Building on the AI and MCP Gateways, in five minutes',
        body:
          'Customer theme first, then real calls to one AI endpoint and one MCP endpoint, then two agents side by side. ' +
          'For each call I will show what the gateway did and the headers and status codes you get back.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
      analysts: {
        title: 'Your AI assistant, safely, in five minutes',
        body:
          'Customer branding first, then real research questions, data tools and agents through the company gateway. ' +
          'I will show how your data is protected and why some answers come back instantly.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
      support: {
        title: 'Fast, safe customer replies, in five minutes',
        body:
          'Customer branding first, then real questions, business tools and an AI agent through the company gateway. ' +
          'I will show why the replies are safe to send and what happens when a refund is over the limit.',
        note: 'Esc leaves at any point. Guide me restarts from the top.',
      },
    },
  },
  /*
    Theme steps first: a demo in the customer's own colours lands better than one in Apigee blue.
    No tab, so they stay on whichever tab the tour was opened on. They point at the palette button
    rather than opening Theme Studio: it is a modal <dialog>, and a modal makes the tour inert.
  */
  {
    id: 'theme-studio',
    title: 'Start in your customer\'s brand',
    body:
      'The palette button opens Theme Studio. Pick a customer from the shared library and press Apply: ' +
      'the logo, full logo, header colour, brand colours and font change across every tab.',
    note: 'Theme Studio opens over the tour. Close it to come back here.',
    businessBody:
      'The palette button opens Theme Studio. Pick your customer from the shared library and press Apply: ' +
      'their logo, colours and font are used across the whole demo.',
    businessNote: 'Theme Studio opens over the tour. Close it to come back here.',
    target: 'customer-theme',
    lines: {
      platform: {
        title: 'Start in your customer\'s brand',
        body:
          'The palette button opens Theme Studio. The customer library is shared by every presenter and stored in ' +
          'Cloud Storage, so a new customer needs no redeploy. Pick one and press Apply.',
        note: 'Theme Studio opens over the tour. Close it to come back here.',
      },
    },
  },
  {
    id: 'theme-request',
    title: 'A new customer? Let the agent build the theme',
    body:
      'In Theme Studio, press Request a theme and enter the customer name and website. The theme agent reads the site ' +
      'and asks Gemini, through this same AI Gateway with Google Search grounding. It picks the logo and full logo, ' +
      'the header colour (with a white logo on dark headers), the brand colours, the font and the industry.',
    note:
      'The theme is saved to the shared library for every presenter. You can fine-tune it in Theme Studio, ' +
      'or upload a logo, then press Save.',
    businessTitle: 'A new customer? Let the agent build the theme',
    businessBody:
      'In Theme Studio, press Request a theme and enter the customer name and website. An AI agent reads their site ' +
      'and builds the theme for you: logo, header colour, brand colours, font and industry. It takes about a minute.',
    businessNote: 'The theme is shared with every presenter, and you can adjust it before you save.',
    target: 'customer-theme',
    lines: {
      platform: {
        title: 'A new customer? Let the agent build the theme',
        body:
          'Request a theme sends the name and website to the theme agent. It reads the site CSS and logos, then calls ' +
          'Gemini through ai-gateway-v1 with Google Search grounding, so its own traffic is governed like any other.',
        note: 'If no industry fits, the agent adds one to the library, with its own persona names and prompts.',
      },
      eng: {
        title: 'A new customer? Let the agent build the theme',
        body:
          'Request a theme posts the name and website to the theme agent. It scrapes the site CSS, header colour and ' +
          'logos, then calls Gemini through the AI Gateway with Google Search grounding and writes a validated theme.',
        note: 'Themes are JSON in Cloud Storage. Edit any field in Theme Studio and press Save.',
      },
    },
  },
  {
    id: 'theme-industry',
    title: 'The industry changes the story, not just the colours',
    body:
      'Each theme has an industry. It renames the personas, swaps in industry prompts on the AI Gateway, and selects ' +
      'the industry tool pack on the MCP Gateway and in the Agent Showcase, for example banking, retail or energy tools.',
    businessBody:
      'Each theme has an industry. It changes the team names, the example questions, and the business tools used later ' +
      'in the demo, so the story matches your customer\'s business.',
    target: 'brand-logo',
  },
  {
    id: 'presets',
    title: 'The scenario shortcuts',
    body:
      'Each chip loads a prompt chosen to trigger one specific gateway behaviour. ' +
      'You can also just type your own prompt.',
    businessBody:
      'Each chip loads a question picked to show one thing the gateway does for you. ' +
      'You can also type your own.',
    target: 'scenario-presets',
    tab: 'ai-gateway',
    lines: {
      eng: {
        title: 'The scenario shortcuts',
        body:
          'Each chip sends a request built to hit one gateway path: routing, cache, quota or a guardrail block. ' +
          'Or type your own prompt and watch the same headers come back.',
      },
      analysts: {
        title: 'Ready-made questions',
        body:
          'Each chip loads a question that shows one thing the gateway does for your research, ' +
          'such as protecting data or reusing an answer. You can also type your own.',
      },
      support: {
        title: 'Ready-made questions',
        body:
          'Each chip loads a customer-style question that shows one thing the gateway does for your replies. ' +
          'You can also type your own.',
      },
    },
  },
  {
    id: 'auto-simple',
    title: 'One endpoint, many models',
    body:
      'I have sent a trivial question to /auto. The client never names a model. ' +
      'Watch the Smart Routing card on the right: the TypeSafe AI JEV System One router ' +
      'classified this as a simple lookup and picked the cheapest model.',
    target: 'telemetry-model-routing',
    tab: 'ai-gateway',
    action: 'auto-simple',
    note: 'The category-to-model map lives on the API Product as custom attributes, not in code.',
    businessTitle: 'Just ask: the right model is picked for you',
    businessBody:
      'I asked a simple question without naming a model. Watch the model card on the right: ' +
      'the gateway saw it was simple and picked the cheapest model that can answer it.',
    businessNote: 'Admins decide which model each persona uses for each kind of work, with no code changes.',
    lines: {
      eng: {
        title: 'One endpoint, many models',
        body:
          'I sent a trivial prompt to /ai/v1/auto with no model in the body. The Smart Routing card shows ' +
          'the router classed it as simple and picked the cheapest model; x-gateway-model in the response says which.',
        note: 'Your code never pins a model version, so a model change on the gateway needs no redeploy on your side.',
      },
      analysts: {
        title: 'Just ask: the model is picked for you',
        body:
          'I asked a quick factual question without choosing a model. The model card on the right shows the gateway ' +
          'saw it was simple and used a fast, low-cost model.',
        note: 'Deep analysis questions go to a stronger model automatically, so you never have to choose.',
      },
      support: {
        title: 'Just ask: the model is picked for you',
        body:
          'I asked a quick question without choosing a model. The model card shows the gateway used a fast, ' +
          'low-cost model, which is why simple replies come back quickly.',
        note: 'You never pick a model: the gateway matches it to the question.',
      },
    },
  },
  {
    id: 'auto-coding',
    title: 'Same endpoint, different model',
    body:
      'Now a coding prompt, to the exact same URL. The Smart Routing card lights up purple ' +
      'and names Claude Opus, on Vertex, through the same gateway. The reply itself carries ' +
      'the same verdict - a "Routed to" badge under the target URL.',
    target: 'telemetry-model-routing',
    tab: 'ai-gateway',
    action: 'auto-coding',
    note: 'Switching vendor costs the client nothing: no SDK change, no new credential.',
    businessTitle: 'Harder work, stronger model',
    businessBody:
      'Now a coding question, asked the same way. The model card turns purple and shows ' +
      'Claude Opus, through the same gateway. The reply also shows which model answered.',
    businessNote: 'Switching AI provider costs your teams nothing: no new tools, no new passwords.',
    lines: {
      eng: {
        title: 'Same endpoint, different model',
        body:
          'Now a coding prompt to the same URL, same key. The Smart Routing card turns purple and names Claude Opus ' +
          'on Vertex; the "Routed to" badge under the target URL shows the same thing from the response headers.',
        note: 'Different vendor, same request shape: no new SDK and no Anthropic key in your code.',
      },
      analysts: {
        title: 'Harder question, stronger model',
        body:
          'Now a harder, technical question, asked the same way. The model card turns purple and shows Claude Opus. ' +
          'Each reply shows which model answered, so you know what your analysis is based on.',
        note: 'You keep one place to ask, whichever AI provider answers.',
      },
      support: {
        title: 'Harder question, stronger model',
        body:
          'Now a technical question, asked the same way. The model card turns purple and shows Claude Opus. ' +
          'Harder questions get a stronger model; everyday replies stay on the fast one.',
        note: 'Same place to ask, same safety checks, whichever AI provider answers.',
      },
    },
  },
  {
    id: 'cache-seed',
    title: 'Now the expensive one',
    body:
      'A long analytical prompt with caching switched on. Watch the Semantic Cache card: ' +
      'on a cold cache this runs against a real model and seeds the vector store, and the ' +
      'latency and cost here are what that genuinely costs you.',
    businessTitle: 'Now an expensive question',
    businessBody:
      'A long analysis question with answer reuse switched on. The first time, a real model ' +
      'answers it, and the response time and cost shown are what it really costs.',
    target: 'telemetry-latency',
    tab: 'ai-gateway',
    action: 'cache-seed',
    lines: {
      eng: {
        title: 'Now the expensive one',
        body:
          'A long analytical prompt with caching on. On a cold cache it goes to a real model and the response is ' +
          'stored in the semantic cache; the latency and x-gateway-cost-usd here are the real price of a miss.',
      },
      analysts: {
        title: 'Now a long analysis question',
        body:
          'A long analysis question with answer reuse switched on. The first time, a real model works through it, ' +
          'so the response time and cost shown are what a full analysis really takes.',
      },
      support: {
        title: 'Now a long question',
        body:
          'A long question with answer reuse switched on. The first time, a real model writes the answer, ' +
          'so the response time and cost shown are for a brand-new reply.',
      },
    },
  },
  {
    id: 'cache-hit',
    title: 'The same question, reworded',
    body:
      'Different words, same meaning - and the Semantic Cache card turns green: Vector Cache ' +
      'Hit, $0 token cost. It matched on embedding similarity, not on an exact string. ' +
      'Compare the latency above with the previous call.',
    target: 'telemetry-semantic-cache',
    tab: 'ai-gateway',
    action: 'cache-hit',
    /*
      Deliberately not promising "cache MISS -> HIT" in the body. The vector index is
      shared and its TTL outlives a rehearsal, so the previous step is often a hit too.
      Copy that describes a transition the viewer cannot see is worse than copy that
      describes the card in front of them.
    */
    note:
      'No model is credited on a hit: the cache keys on the prompt alone and the router ' +
      'never runs, so the Smart Routing card stays quiet.',
    businessTitle: 'The same question, reworded',
    businessBody:
      'Different words, same meaning, and the answer reuse card turns green: $0 cost. ' +
      'It matched on meaning, not exact words. Compare the response time with the last one.',
    businessNote: 'No model is used for a reused answer, so the model card stays quiet.',
    lines: {
      eng: {
        title: 'The same question, reworded',
        body:
          'Different words, same meaning, and the Semantic Cache card turns green: cache hit, $0 cost, no quota used. ' +
          'It matched on embedding similarity, not the exact string. Compare the latency with the last call.',
        note: 'On a hit x-gateway-cached is true and no model is reported: the router never ran.',
      },
      analysts: {
        title: 'The same question, reworded',
        body:
          'Different words, same meaning, and the answer reuse card turns green: $0 cost. An answer to a question ' +
          'with the same meaning was reused, so it came back in a fraction of the time.',
        note: 'Only a finished answer is reused; no AI model saw your question this time.',
      },
      support: {
        title: 'The same question, reworded',
        body:
          'Different words, same meaning, and the answer reuse card turns green: $0 cost. Repeat customer questions ' +
          'get an already-checked answer back almost instantly.',
        note: 'No model ran for this reply, so it was both faster and free.',
      },
    },
  },
  {
    id: 'history',
    title: 'Every call is still inspectable',
    body:
      'Click any earlier reply, or its Telemetry button, to load that call back into the ' +
      'panel. Step back through a session and show what each call did differently.',
    businessTitle: 'Every answer can be checked later',
    businessBody:
      'Click any earlier reply, or its Telemetry button, to see its model, cost and checks again.',
    target: 'chat-messages',
    tab: 'ai-gateway',
    lines: {
      eng: {
        title: 'Every call is still inspectable',
        body:
          'Click any earlier reply, or its Telemetry button, to reload that call: status, headers, model, tokens ' +
          'and latency. Handy for comparing a failing call with a working one.',
      },
      analysts: {
        title: 'Every answer can be checked later',
        body:
          'Click any earlier reply, or its Telemetry button, to see which model answered, whether it was reused ' +
          'and what it cost. Useful when you need to show how a finding was produced.',
      },
      support: {
        title: 'Every reply can be checked later',
        body:
          'Click any earlier reply, or its Telemetry button, to see which model wrote it and the safety checks ' +
          'it passed, before you send it on.',
      },
    },
  },
  {
    id: 'request-flow',
    title: 'Prove it, policy by policy',
    body:
      'Request Flow on any reply opens the exact sequence of Apigee policies that call went ' +
      'through - auth, prompt sanitization, routing, cache, quota, cost accounting.',
    target: 'chat-messages',
    tab: 'ai-gateway',
    note: 'This is usually the moment an architect in the room starts asking good questions.',
    businessTitle: 'See every check, step by step',
    businessBody:
      '"See the steps" on any reply shows each check that request passed: who asked, safety, ' +
      'model choice, answer reuse, usage limit and cost.',
    businessNote: 'Useful when audit or risk teams ask how AI use is controlled.',
    lines: {
      eng: {
        title: 'Debug it, policy by policy',
        body:
          'Request Flow on any reply shows the policies that call went through: key check, prompt sanitization, ' +
          'cache, routing, quota, cost. A 401, 400 or 429 is shown at the step that returned it.',
        note: 'The fastest way to tell a bad key from a guardrail block from an exhausted quota.',
      },
      analysts: {
        title: 'See every check, step by step',
        body:
          '"See the steps" on any reply shows each check it passed: who asked, the screen for confidential data, ' +
          'model choice, answer reuse and cost.',
        note: 'Useful when a reviewer asks how your AI-assisted work was protected.',
      },
      support: {
        title: 'See every check, step by step',
        body:
          '"See the steps" on any reply shows each check it passed before reaching you: who asked, the safety ' +
          'screen and answer reuse.',
        note: 'Every reply has been screened before you see it, so it is safe to send.',
      },
    },
  },
  {
    id: 'settings',
    title: 'Change the conditions',
    body:
      'Switch environment, persona or caching here, then re-run a scenario to ' +
      'show the gateway reacting.',
    businessBody:
      'Switch between Sandbox and Live, change persona, or turn answer reuse on or off, ' +
      'then run a scenario again to see the difference.',
    target: 'gateway-settings',
    // No tab: normally reached from the playground, but readable from anywhere.
    lines: {
      platform: {
        title: 'Change the conditions',
        body:
          'Switch Dev or Prod, persona (API product) or caching here, then re-run a scenario to see the ' +
          'policies react. Test changes in Dev before they reach Prod.',
      },
      finance: {
        title: 'Change the conditions',
        body:
          'Switch Sandbox or Live, change persona, or turn answer reuse off, then run a scenario again ' +
          'to see how much the cost changes.',
      },
      ai_coe: {
        title: 'Change the conditions',
        body:
          'Switch persona to see each team get different models and limits, or turn answer reuse on or off, ' +
          'then run a scenario again.',
      },
      eng: {
        title: 'Change the conditions',
        body:
          'Switch Dev or Prod, persona (and so the API key) or caching here, then re-send a scenario to see ' +
          'different routing, quota headers and status codes.',
      },
      analysts: {
        title: 'Change the conditions',
        body:
          'Switch between Sandbox and Live, change persona, or turn answer reuse on or off, then ask again ' +
          'to see how depth, speed and cost change.',
      },
      support: {
        title: 'Change the conditions',
        body:
          'Switch between Sandbox and Live, change persona, or turn answer reuse on or off, then ask again ' +
          'to see how reply speed and cost change.',
      },
    },
  },
  // ---- MCP Gateway: tool calls get the same identity, entitlement and quota controls ----
  {
    id: 'mcp',
    title: 'The same governance for tools',
    body:
      'The MCP Gateway runs tool calls, not prompts, through Apigee with the same key, identity and quota checks. ' +
      'The Tools badge shows the industry pack picked by the customer theme, next to the generic Customer Service, ' +
      'BigQuery and ServiceNow tools.',
    target: 'mcp-header',
    tab: 'mcp-gateway',
    note: 'The MCP backend is currently deployed to prod only.',
    businessTitle: 'The same controls for business tools',
    businessBody:
      'The Tools tab lets an AI assistant use business systems, such as an order lookup or a refund, through the same ' +
      'gateway, with the same identity checks and usage limits. The tools match your customer\'s industry.',
    businessNote: 'Business tools are currently available in Live only.',
    lines: {
      eng: {
        title: 'The same governance for tools',
        body:
          'One MCP endpoint per tool pack: JSON-RPC tools/list and tools/call through Apigee with your usual key. ' +
          'The Tools badge shows which industry proxy and base path this theme uses.',
        note: 'The MCP backend is currently deployed to prod only.',
      },
      analysts: {
        title: 'The same controls for data tools',
        body:
          'The Tools tab lets your assistant pull metrics and forecasts through the same gateway, with the same ' +
          'checks. The tools match your customer\'s industry.',
        note: 'Business tools are currently available in Live only.',
      },
      support: {
        title: 'The same controls for business tools',
        body:
          'The Tools tab lets your assistant look up orders and customers, log cases and issue refunds through the same ' +
          'gateway, so the numbers in your reply come from the real system.',
        note: 'Business tools are currently available in Live only.',
      },
    },
  },
  {
    id: 'mcp-tools',
    title: 'Each persona sees only its own tools',
    body:
      'This list is the gateway\'s answer to tools/list for the current persona. Apigee filters it by the API product ' +
      'on the key, so switch persona in Gateway Settings and the list changes.',
    note: 'A tool that is not on your product is refused with 401 before the MCP server is reached.',
    businessTitle: 'Each team sees only its own tools',
    businessBody:
      'This list shows the tools the current team is allowed to use. Switch persona in Gateway Settings and the list ' +
      'changes: support can issue refunds, analysts can read forecasts.',
    businessNote: 'A tool a team is not allowed to use is refused before it reaches the business system.',
    target: 'mcp-tools',
    tab: 'mcp-gateway',
    lines: {
      eng: {
        title: 'Each key sees only its own tools',
        body:
          'This is tools/list as returned through Apigee: filtered to the tools on your API product. ' +
          'Switch persona (and so the key) in Gateway Settings and refresh to see a different list.',
        note: 'tools/call on a tool outside your product returns 401 from the proxy, not from the backend.',
      },
    },
  },
  {
    id: 'mcp-presets',
    title: 'Works, limited, blocked',
    body:
      'The numbered presets tell a story in order. Green calls work. Amber calls hit a business limit set on the ' +
      'gateway, such as a refund over $50, and get a 403. Red calls are blocked outright: a tool outside the ' +
      'persona (401) or a burst over the quota (429).',
    note: 'The limits live in Apigee, not in the tool server, so changing them needs no backend release.',
    businessTitle: 'Allowed, over the limit, refused',
    businessBody:
      'Run the numbered tasks in order. Green tasks work. Amber tasks go over a business limit, such as a refund over ' +
      '$50, and are stopped by the gateway. Red tasks are refused: a tool the team may not use, or too many calls at once.',
    businessNote: 'The limits are set on the gateway, so they change without touching the business systems.',
    target: 'mcp-presets',
    tab: 'mcp-gateway',
    lines: {
      eng: {
        title: 'Works, limited, blocked',
        body:
          'Run the numbered presets in order. Green: 200. Amber: 403 from a business-rule policy reading the JSON-RPC ' +
          'arguments, such as amount > 50. Red: 401 for a tool outside the product, 429 for a burst over the quota.',
        note: 'Pick a preset, check the arguments form, then press Send tools/call.',
      },
      support: {
        title: 'Allowed, over the limit, refused',
        body:
          'Run the numbered tasks in order. A small goodwill refund works. A larger one goes over the limit and is ' +
          'stopped by the gateway, so nothing over the limit goes out without approval.',
        note: 'Pick a task, check the details, then press Run tool.',
      },
    },
  },
  {
    id: 'mcp-trace',
    title: 'Every tool call, traced',
    body:
      'The right-hand pane shows the JSON-RPC request and response with the gateway headers, and Request Flow opens ' +
      'the Apigee policies the call went through, including the one that refused it.',
    businessTitle: 'Every tool use, recorded',
    businessBody:
      'The right-hand pane shows what the assistant asked for and what came back, and "See the steps" shows each ' +
      'check the gateway ran, including the one that stopped it.',
    target: 'mcp-trace',
    tab: 'mcp-gateway',
    lines: {
      eng: {
        title: 'Every tool call, traced',
        body:
          'The trace shows the raw JSON-RPC request and response, status, latency and x-gateway headers. ' +
          'Request Flow marks the policy that returned a 401, 403 or 429.',
      },
    },
  },
  // ---- Agent Showcase: the same question to an ungoverned and a governed agent ----
  {
    id: 'agent-scenarios',
    title: 'Two agents, one question',
    body:
      'The Agent Showcase sends the same customer question to two agents at once. The numbered scenarios build the ' +
      'story: a simple lookup, the same question again, an upset customer, a request over the limit, confidential ' +
      'data, a prompt injection, a burst, and finally a cheaper model.',
    note: '"What to look for" under the prompt says what each scenario should show. Reset demo data starts fresh.',
    businessTitle: 'Two AI agents, one question',
    businessBody:
      'The Agent Showcase gives the same customer question to two AI agents at the same time. Work through the ' +
      'numbered scenarios in order: each one shows a different risk and how the governed agent handles it.',
    businessNote: '"What to look for" under the question says what to watch for in each scenario.',
    target: 'agent-scenarios',
    tab: 'agent-showcase',
  },
  {
    id: 'agent-sides',
    title: 'Without governance vs with governance',
    body:
      'Left: an agent calling the model and tools directly, with every tool and no limits. Right: the same agent ' +
      'through the AI Gateway (/ai/v1/auto) and the MCP Gateway. Each column streams its model calls, tool calls, ' +
      'tokens and cost live, and marks every control the gateway applied.',
    note: 'The model picker on the left sets the ungoverned agent\'s model. Scenario 8 switches it to a cheaper one.',
    businessTitle: 'Without controls vs with controls',
    businessBody:
      'Left: an agent with direct access to the AI model and every business tool. Right: the same agent through the ' +
      'company gateway. Both columns show, live, what the agent did, what it cost and which controls stepped in.',
    target: 'agent-sides',
    tab: 'agent-showcase',
    lines: {
      eng: {
        title: 'Without governance vs with governance',
        body:
          'Left: the agent calls Vertex AI and the tool servers directly. Right: the same agent code pointed at ' +
          '/ai/v1/auto and the MCP proxies, so routing, cache, quota, guardrails and tool entitlements apply.',
        note: 'Tick "Show tool-server protocol calls" to see the MCP connect and tools/list hops too.',
      },
    },
  },
  {
    id: 'agent-approval',
    title: 'Over the limit? A person approves it',
    body:
      'Run scenario 4, a request over the business limit (a $120 refund against a $50 limit in the generic pack; ' +
      'each industry has its own). The ungoverned agent just does it. The governed agent is refused by the gateway, ' +
      'so it raises a ServiceNow ticket for a supervisor to approve instead.',
    note: 'The ticket number is in the governed column, and nothing over the limit happens until a person approves it.',
    businessTitle: 'Over the limit? A person approves it',
    businessBody:
      'Run scenario 4, a request over the business limit, such as a $120 refund when the limit is $50. The agent ' +
      'without controls just does it. The governed agent is stopped and raises a ServiceNow ticket so a supervisor can approve it.',
    businessNote: 'The agent cannot go over a limit on its own: a person stays in the loop.',
    target: 'agent-scenarios',
    tab: 'agent-showcase',
    lines: {
      eng: {
        title: 'Over the limit? A person approves it',
        body:
          'Run scenario 4. The ungoverned agent calls the refund tool directly and it succeeds. The governed agent gets ' +
          'a 403 from the MCP proxy\'s business-limit policy, then calls the ServiceNow createIncident tool to ask a supervisor.',
        note: 'The approval path is just another governed tool call, so it is traced and metered like the rest.',
      },
    },
  },
  {
    id: 'agent-scoreboard',
    title: 'Keep score',
    body:
      'After each run, a side-by-side card and a session scoreboard appear below the agents: tokens, cost, cache hits, ' +
      'blocked actions and controls applied since the last Clear. Agent comparison, here, lists every run in the session.',
    note: 'The burst scenario shows the usage limit stopping a runaway agent; the cheaper-model scenario shows what is lost without routing.',
    businessTitle: 'Keep score',
    businessBody:
      'After each run, a card and a scoreboard appear below the agents, adding up the cost and the risky actions each ' +
      'agent took, and how much governance saved. Agent comparison, here, lists every run in the session.',
    // The scoreboard only renders after the first run; the view tabs above it always exist.
    target: 'agent-views',
    tab: 'agent-showcase',
  },
  {
    id: 'agent-analytics',
    title: 'The agents\' history, from Apigee',
    body:
      'Agent comparison collects every run in this session. Agent Analytics, next to Agent Showcase at the top, shows ' +
      'both agents\' history from Apigee analytics: calls, tokens, cost and refusals over time.',
    businessTitle: 'Both agents over time',
    businessBody:
      'Agent comparison collects every run in this session. Agent Analytics, at the top, shows both agents over time: ' +
      'how much they were used, what they cost and how often they were stopped.',
    target: 'agent-page-tabs',
    tab: 'agent-showcase',
  },
  {
    id: 'analytics',
    title: 'What it all cost',
    body:
      'Traffic, tokens and spend per model and per developer, from Apigee analytics.',
    businessBody: 'Usage and spend by model and by user, ready for chargeback.',
    target: 'tab-analytics',
    tab: 'analytics',
    adminOnly: true,
    lines: {
      platform: {
        title: 'What it all cost',
        body:
          'Traffic, tokens, errors and spend per model and per developer, from the DataCapture dimensions in ' +
          'Apigee analytics. Check here after any policy or routing change.',
      },
      finance: {
        title: 'What it all cost',
        body:
          'Spend by model, team and user, with what answer reuse saved. Ready for chargeback and forecasting.',
      },
      ai_coe: {
        title: 'Who used which model',
        body:
          'Adoption by team and model, and how much traffic auto-routing sent to low-cost models versus ' +
          'premium ones.',
      },
      // Only seen if the step is locked (not admin): narrated on the playground tab.
      eng: { title: 'What it all cost', body: 'Admins see traffic, tokens and spend per model and per API key here.' },
      analysts: { title: 'What it all cost', body: 'Admins see usage and cost by team and model here.' },
      support: { title: 'What it all cost', body: 'Admins see usage and cost by team and model here.' },
    },
  },
  {
    id: 'monetization',
    title: 'Charging for it',
    body:
      'Rate plans, prepaid balances and per-developer billing - the commercial layer on top of ' +
      'the same traffic.',
    businessTitle: 'Charging it back',
    businessBody: 'Billing plans, prepaid credit and billing per user, based on the same usage.',
    target: 'tab-monetization',
    tab: 'monetization',
    adminOnly: true,
    lines: {
      platform: {
        title: 'Charging for it',
        body:
          'Rate plans, prepaid balances, token quotas and the KVM rate card, all read at runtime by the proxy. ' +
          'Change them here in Dev first; no proxy redeploy needed.',
      },
      finance: {
        title: 'Charging it back',
        body:
          'Billing plans, prepaid credit, monthly budgets and the model price list. Every request is priced ' +
          'and charged to the right team.',
      },
      ai_coe: {
        title: 'Who gets which model',
        body:
          'Which models each team may use, how auto-routing picks between them, and the usage limits that keep ' +
          'access fair.',
      },
      eng: { title: 'Charging for it', body: 'Admins set rate plans, quotas and budgets for your API key here.' },
      analysts: { title: 'Charging it back', body: 'Admins set your team’s models, limits and budget here.' },
      support: { title: 'Charging it back', body: 'Admins set your team’s models, limits and budget here.' },
    },
  },
  {
    id: 'done',
    title: 'That is the tour',
    body:
      'Re-run any scenario from the chips, or type your own prompt and watch how the gateway ' +
      'classifies it. Switch customer from the palette button to replay the story in another brand ' +
      'and industry. Guide me restarts this at any time.',
    businessBody:
      'Run any scenario again from the chips, or type your own question and see how the ' +
      'gateway handles it. Switch customer from the palette button to replay it in another brand. ' +
      'Guide me restarts this at any time.',
    // Back to the playground: the previous two steps are admin screens, and ending on one
    // of those leaves whoever took the tour looking at a billing table.
    tab: 'ai-gateway',
    lines: {
      eng: {
        title: 'That is the tour',
        body:
          'Re-send any scenario from the chips, or try your own prompt and check the routing and headers it gets. ' +
          'Guide me restarts this at any time.',
      },
      analysts: {
        title: 'That is the tour',
        body:
          'Ask any scenario again from the chips, or try one of your own research questions and see how the ' +
          'gateway handles it. Guide me restarts this at any time.',
      },
      support: {
        title: 'That is the tour',
        body:
          'Ask any scenario again from the chips, or try a real customer question and see how fast and safe the ' +
          'reply is. Guide me restarts this at any time.',
      },
    },
  },
];
