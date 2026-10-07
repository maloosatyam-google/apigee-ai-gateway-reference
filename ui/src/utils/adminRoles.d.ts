export type AdminRole = 'platform' | 'finance' | 'ai_coe';

export type AdminCapability =
  | 'models'
  | 'quota'
  | 'routing'
  | 'guardrails'
  | 'budget'
  | 'wallet'
  | 'pricing'
  | 'rate_plans'
  | 'custom'
  | 'reset';

export interface AdminRoleInfo {
  id: AdminRole;
  label: string;
  short: string;
  summary: string;
  capabilities: AdminCapability[];
}

export const CAPABILITIES: AdminCapability[];
export const ADMIN_ROLES: AdminRoleInfo[];
export const DEFAULT_ADMIN_ROLE: AdminRole;
export function adminRoleById(id: string | undefined): AdminRoleInfo;
export function isAdminRole(id: unknown): id is AdminRole;
export function roleCan(roleId: string | undefined, capability: AdminCapability): boolean;
export function ownerLabel(capability: AdminCapability): string;
export function capabilityForChange(descriptor: { kind?: string; attribute?: string }): AdminCapability;

export type AdminConsoleTab = 'products' | 'wallets' | 'rate-cards' | 'rate-plans' | 'policies';
export type ProductConfigSection = 'models' | 'routing' | 'budget' | 'custom';
export const TAB_CAPABILITIES: Record<AdminConsoleTab, AdminCapability[]>;
export const SECTION_CAPABILITIES: Record<ProductConfigSection, AdminCapability[]>;
export function roleCanSeeTab(roleId: string | undefined, tab: string): boolean;
export function roleCanSeeSection(roleId: string | undefined, section: string): boolean;
