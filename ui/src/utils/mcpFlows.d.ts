export type McpFlowOutcome = 'works' | 'blocked' | 'limit';
export declare const MCP_PERSONA_FLOWS: Record<'eng' | 'analysts' | 'support', { id: string; outcome: McpFlowOutcome }[]>;
export declare function orderPresetsForPersona<T extends { id: string }>(
  presets: T[],
  speaker: string,
  flows?: Partial<Record<string, { id: string; outcome: McpFlowOutcome }[]>>,
): { preset: T; step?: number; outcome?: McpFlowOutcome }[];
