export const PROD_READ_ONLY_MESSAGE: string;
export type ChangeKind = 'added' | 'removed' | 'changed';

export interface DiffRow {
  section: string;
  key: string;
  dev: string | null;
  prod: string | null;
  kind: ChangeKind;
}

export function modelQuotaMap(product: unknown): Map<string, string>;
export function diffProducts(devProduct: unknown, prodProduct: unknown): DiffRow[];
export function diffRateCards(
  devRates: Record<string, { input?: number; output?: number; tier?: string }> | null | undefined,
  prodRates: Record<string, { input?: number; output?: number; tier?: string }> | null | undefined,
): DiffRow[];
