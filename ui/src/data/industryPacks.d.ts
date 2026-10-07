// Types for the generated industryPacks.js (see industries/README.md for the pack format).
import type { McpFlowOutcome } from '../utils/mcpFlows';

export interface IndustryPackTool {
  name: string;
  slot: 'pii' | 'lookup' | 'write' | 'money' | 'metrics' | 'confidential' | 'forecast';
  persona: 'ops' | 'insights';
  /** Business area, e.g. Cards, Loans, Payments. */
  area: string;
  quotaPerMin: number;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, any>; required?: string[] };
}
export interface IndustryPackPersona {
  role: string;
  label: string;
  app?: string;
  product: string;
  productDisplayName: string;
  description: string;
}
export interface IndustryPackPreset {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
  badgeText: string;
  badgeColor: string;
  title: { technical: string; analysts: string; support: string };
  description: string;
}
export interface IndustryPack {
  id: string;
  label: string;
  version: number;
  proxy: string;
  basePath: string;
  currency: string;
  personas: { ops: IndustryPackPersona; insights: IndustryPackPersona; admin: IndustryPackPersona };
  tools: IndustryPackTool[];
  limit: { tool: string; argument: string; max: number; persona: 'ops'; code: string; message: string };
  story: Record<string, any>;
  mcpPresets: IndustryPackPreset[];
  mcpPersonaFlows: Record<'support' | 'analysts' | 'eng', { id: string; outcome: McpFlowOutcome }[]>;
  /** Agent Showcase: instruction for both agents, and prompts per scenario slot. */
  showcase: {
    instruction: string;
    scenarios: Record<'lookup' | 'multi-step' | 'refund' | 'over-reach' | 'injection' | 'burst', { title: string; prompt: string; expect?: string }>;
  };
}
export declare const INDUSTRY_PACKS: IndustryPack[];
export default INDUSTRY_PACKS;
