/**
 * Persona voice: the UI talks in the language of whoever is acting.
 *
 *   technical  Platform Admin (admin persona) and Engineering & IT (consumer persona).
 *              Apigee terms are fine: API product, API key, token quota, KVM rate card,
 *              rate plan, developer, proxy, policy names.
 *   business   Finance and AI CoE (admin personas), Analysts & Knowledge Workers and
 *              Customer Support & Sales (consumer personas). Plain outcomes first:
 *              who can use which AI, what it costs, what is protected. Apigee terms
 *              only as a small secondary hint, if at all.
 *
 * Which persona decides the voice depends on the screen:
 *   Admin Console, Ask Apigee, Analytics  -> the admin persona (top-right on those tabs)
 *   AI Gateway / Tools Gateway playgrounds -> the consumer persona (top-right on those tabs)
 *   Architecture modal, guided tour        -> whichever of the two applies on the current tab
 *
 * Usage in a component:
 *   const { voice, speaker, sp } = usePersonaVoice('admin');   // or 'persona' / 'active'
 *   <h2>{say(voice, 'Allowed models & token quotas', 'Which AI models each team can use')}</h2>
 *   <p>{sp({ technical: '…', finance: '…', ai_coe: '…' })}</p>   // one line per persona
 *   <p>{term(voice, 'budget')}</p>
 *
 * Keep ids, API payloads, data keys and anything a test asserts unchanged: only
 * human-readable copy changes with the voice.
 */
import { createContext, useContext } from 'react';
import type { AdminRole, UserPersona } from '../types';
import { rewordPersonaNames } from './customerTheme';

export type Voice = 'technical' | 'business';

export function voiceForAdminRole(role: AdminRole | undefined): Voice {
  return !role || role === 'platform' ? 'technical' : 'business';
}

export function voiceForPersona(persona: UserPersona | undefined): Voice {
  return !persona || persona === 'admin' ? 'technical' : 'business';
}

/** Pick the technical or business wording. */
export function say<T>(voice: Voice, technical: T, business: T): T {
  return rewordPersonaNames(voice === 'technical' ? technical : business);
}

/**
 * Shared glossary so every screen uses the same words. Technical wording is the
 * Apigee concept; business wording is what a Finance, AI CoE or line-of-business
 * reader would call it.
 */
export const GLOSSARY = {
  persona: { technical: 'API product', business: 'persona' },
  personas: { technical: 'API products', business: 'personas' },
  apiKey: { technical: 'API key', business: 'access key' },
  developer: { technical: 'developer', business: 'user' },
  developers: { technical: 'developers', business: 'users' },
  tokenQuota: { technical: 'token quota', business: 'usage limit' },
  tokenQuotas: { technical: 'token quotas', business: 'usage limits' },
  tokensPerMinute: { technical: 'tokens / min', business: 'tokens a minute' },
  budget: { technical: 'developer budget', business: 'monthly budget' },
  rateCard: { technical: 'KVM rate card', business: 'model price list' },
  ratePlan: { technical: 'rate plan', business: 'billing plan' },
  ratePlans: { technical: 'rate plans', business: 'billing plans' },
  subscription: { technical: 'subscription', business: 'enrolment' },
  wallet: { technical: 'prepaid wallet', business: 'prepaid credit' },
  autoRouting: { technical: 'auto-routing', business: 'automatic model choice' },
  routingTarget: { technical: 'routing target', business: 'model used' },
  guardrails: { technical: 'guardrail policies', business: 'safety controls' },
  semanticCache: { technical: 'semantic cache', business: 'answer reuse' },
  proxy: { technical: 'proxy', business: 'gateway' },
  devEnv: { technical: 'Dev', business: 'Sandbox' },
  prodEnv: { technical: 'Prod', business: 'Live' },
  mcpTool: { technical: 'MCP tool', business: 'business tool' },
  mcpServer: { technical: 'MCP server', business: 'tool connector' },
  latency: { technical: 'latency', business: 'response time' },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export function term(voice: Voice, key: GlossaryKey): string {
  return GLOSSARY[key][voice];
}

/** Capitalised glossary term, for headings and labels. */
export function Term(voice: Voice, key: GlossaryKey): string {
  const t = term(voice, key);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Speaker: the six personas, each with its own voice (on top of the two-way
 * technical/business split above).
 *   platform  Platform Admin     operations: reliability, config, policies, rollout
 *   finance   Finance            spend, budgets, prepaid credit, chargeback, forecasts
 *   ai_coe    AI CoE             model strategy, which team gets which model, adoption, safety
 *   eng       Engineering & IT   building and integrating: endpoints, keys, quotas, latency
 *   analysts  Analysts & KW      research and analysis: accuracy, depth, sources, data safety
 *   support   Support & Sales    customer replies: fast, on-brand, safe to send, low cost
 */
export type Speaker = 'platform' | 'finance' | 'ai_coe' | 'eng' | 'analysts' | 'support';
export const ADMIN_SPEAKERS: Speaker[] = ['platform', 'finance', 'ai_coe'];
export const PERSONA_SPEAKERS: Speaker[] = ['eng', 'analysts', 'support'];

export function speakerForAdminRole(role: AdminRole | undefined): Speaker {
  return role === 'finance' ? 'finance' : role === 'ai_coe' ? 'ai_coe' : 'platform';
}

export function speakerForPersona(persona: UserPersona | undefined): Speaker {
  return persona === 'loans_agent' ? 'analysts' : persona === 'sales_agent' ? 'support' : 'eng';
}

export function voiceForSpeaker(speaker: Speaker): Voice {
  return speaker === 'platform' || speaker === 'eng' ? 'technical' : 'business';
}

/**
 * Copy for each speaker. `technical` is required (Platform Admin / Engineering &
 * IT fallback); `business` is the fallback for the four business speakers; a
 * speaker key overrides both.
 */
export type Lines<T> = { technical: T; business?: T } & Partial<Record<Speaker, T>>;

/** Pick the line for a speaker: its own line, else its voice's line, else technical. */
export function speak<T>(speaker: Speaker, lines: Lines<T>): T {
  const own = lines[speaker];
  const picked = own !== undefined
    ? own
    : voiceForSpeaker(speaker) === 'business' && lines.business !== undefined ? lines.business : lines.technical;
  // Display copy: persona names follow the customer theme's industry (no-op for Generic).
  return rewordPersonaNames(picked);
}

export interface PersonaVoiceState {
  adminRole: AdminRole;
  persona: UserPersona;
  adminVoice: Voice;
  personaVoice: Voice;
  /** Voice for the current tab: admin voice on admin/analytics tabs, persona voice elsewhere. */
  activeVoice: Voice;
  adminSpeaker: Speaker;
  personaSpeaker: Speaker;
  activeSpeaker: Speaker;
}

export const PersonaVoiceContext = createContext<PersonaVoiceState>({
  adminRole: 'platform',
  persona: 'admin',
  adminVoice: 'technical',
  personaVoice: 'technical',
  activeVoice: 'technical',
  adminSpeaker: 'platform',
  personaSpeaker: 'eng',
  activeSpeaker: 'platform',
});

/**
 * `scope` picks which persona decides the voice:
 *   'admin'   Admin Console, Ask Apigee, Analytics
 *   'persona' AI Gateway / Tools Gateway playgrounds
 *   'active'  Architecture modal, guided tour, anything shown on several tabs
 */
export function usePersonaVoice(scope: 'admin' | 'persona' | 'active' = 'active') {
  const state = useContext(PersonaVoiceContext);
  const voice = scope === 'admin' ? state.adminVoice : scope === 'persona' ? state.personaVoice : state.activeVoice;
  const speaker = scope === 'admin' ? state.adminSpeaker : scope === 'persona' ? state.personaSpeaker : state.activeSpeaker;
  /**
   * Bound `speak` for this scope: sp({ technical, business?, platform?, finance?, ... }).
   * String copy has persona names reworded for the customer theme's industry (see speak).
   */
  const sp = <T,>(lines: Lines<T>): T => speak(speaker, lines);
  return { ...state, voice, speaker, sp };
}
