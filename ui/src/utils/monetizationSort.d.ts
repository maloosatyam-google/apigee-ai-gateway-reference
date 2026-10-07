export type AttributionSortColumn = 'name' | 'tier' | 'billing' | 'consumed' | 'balance' | 'quota';
export type SortDirection = 'asc' | 'desc';

export interface SortableDeveloper {
  email: string;
  name?: string;
}

export interface SortableAttribution {
  userEmail: string;
  name?: string;
  tier?: string;
  badge?: string;
  billingType?: string;
  totalConsumedUsd?: number;
  totalTokens?: number;
  currentBalanceUsd?: number;
}

export function sortDeveloperList<T extends SortableDeveloper>(devs: T[]): T[];
export function defaultAttributionSortDirection(column: AttributionSortColumn): SortDirection;
export function sortAttributionTable<T extends SortableAttribution>(
  rows: T[],
  column: AttributionSortColumn,
  direction: SortDirection
): T[];
