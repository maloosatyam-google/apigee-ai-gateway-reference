import type { IndustryPack } from '../data/industryPacks';
import type { McpPresetScenario, McpTool } from '../types';
import type { BusinessCopy } from '../services/defaultSettings';

export type { IndustryPack } from '../data/industryPacks';
export declare function industryPackFor(industryId: string | undefined | null, packs?: IndustryPack[]): IndustryPack | null;
export declare function industryPackIds(packs?: IndustryPack[]): string[];
export declare function industryMcpEndpoint(
  pack: IndustryPack,
  envId: string,
  localUrl?: string,
): { requestUrl: string; displayEndpoint: string; local: boolean };
export declare function packPresets(pack: IndustryPack): (McpPresetScenario & BusinessCopy)[];
export declare function packTools(pack: IndustryPack): McpTool[];
export type PackPersonaKey = 'ops' | 'insights' | 'admin';
export declare function personaKeyForUser(activeUser: string | undefined): PackPersonaKey;
export declare function toolNamesForPersona(pack: IndustryPack, personaKey: PackPersonaKey): string[];
export declare function packAreas(pack: IndustryPack, onlyNames?: string[]): { area: string; persona: 'ops' | 'insights'; tools: string[] }[];
export declare function toolArea(toolName: string, packs?: IndustryPack[]): { area: string; persona: 'ops' | 'insights'; industry: string } | null;
export declare function simulateGateway(
  pack: IndustryPack,
  personaKey: PackPersonaKey,
  toolName: string,
  args?: Record<string, any>,
  recent?: number[],
  now?: number,
): { status: 401 | 403 | 429; body: any; limitCode?: string } | null;
export declare function showcaseScenariosFor<T extends { id: string; title: string; prompt: string; expect: string }>(
  scenarios: T[],
  pack: IndustryPack | null,
): T[];
