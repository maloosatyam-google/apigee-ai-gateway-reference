import type { UserPersona } from '../types';

export interface PersonaInfo {
  id: UserPersona;
  label: string;
  short: string;
  product: string;
  mcpProduct: string;
  summary: string;
  models: string[];
}

export const PERSONAS: PersonaInfo[];
export function personaById(id: string | undefined): PersonaInfo;
export function personaAllowsModel(id: string | undefined, model: string): boolean;
export function personaForModel(currentId: string | undefined, model: string): UserPersona;
