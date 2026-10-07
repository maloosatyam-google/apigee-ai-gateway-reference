import type { PersonaInfo } from './personas';

export interface CustomerTheme {
  id: string;
  name: string;
  /** https URL, same-origin path or inline data:image URL; '' = monogram / Apigee logo. */
  logoUrl: string;
  /** Full logo with the company name (wide); shown in the header on wide screens. '' = use logoUrl. */
  wordmarkUrl: string;
  /** Show the full logo in white (for a dark header bar, as the customer's own site does). */
  wordmarkWhite: boolean;
  /** Show the customer name as text next to the logo (for icon-only logos). */
  showName: boolean;
  /** Top-row background (#rrggbb), e.g. ICICI orange; '' = the standard white bar. */
  headerBg: string;
  /** Brand colour (#rrggbb); '' = keep the default palette. */
  primary: string;
  /** Secondary colour for the Tools/MCP accents; '' = follow primary. */
  accent: string;
  /** Google Fonts family name, or 'system'. */
  font: string;
  industry: string;
  builtIn: boolean;
  /** 'library' for themes from the shared Cloud Storage library (/api/themes). */
  source?: 'library';
  /** Customer website host (library themes). */
  website?: string;
  /** Stored version of a library theme (sent back with edits). */
  updatedAt?: string;
}

export interface IndustryPersonaCopy {
  label: string;
  short: string;
}

export interface Industry {
  id: string;
  label: string;
  personas: Partial<Record<string, IndustryPersonaCopy>>;
  prompts: Partial<Record<string, string>>;
  /** 'library' for industries the theme agent added. */
  source?: 'library';
}

export interface FontOption {
  id: string;
  label: string;
  family: string | null;
}

export const DEFAULT_THEME_ID: string;
export const STORAGE_KEY: string;
export const MAX_LOGO_BYTES: number;
export const FONT_OPTIONS: FontOption[];
export const OVERRIDABLE_PROMPTS: string[];
export const SCENARIO_LABELS: Record<string, string>;
export const INDUSTRIES: Industry[];
export const DEFAULT_THEME: CustomerTheme;
export const THEME_VAR_NAMES: string[];
export const PRIMARY_FAMILIES: string[];
export const ACCENT_FAMILIES: string[];
export const THEMED_FAMILIES: string[];
export type HexPalette = Record<string, Record<string, string>>;
export function themeHexPalette(theme: CustomerTheme | null | undefined): HexPalette | null;
export function setDisplayIndustry(id: string | undefined): void;
export function displayPersona<T extends PersonaInfo>(persona: T): T;
export function rewordPersonaNames<T>(text: T, industryId?: string): T;
export function canonicalPersonaNames<T>(text: T, industryId?: string): T;

export function sanitizeFontFamily(name: unknown): string | null;
export function googleFontHref(family: string): string | null;
export function industryById(id: string | undefined): Industry;
export function sanitizeIndustry(raw: unknown): Industry | null;
export function setLibraryIndustries(list: unknown): Industry[];
export function addLibraryIndustry(raw: unknown): Industry | null;
export function allIndustries(): Industry[];
export function personaDisplay<T extends PersonaInfo>(persona: T, industryId: string | undefined): T;
export function themedPrompt(exampleId: string, industryId: string | undefined, fallback: string): string;
export function faviconUrlForDomain(domain: string): string | null;
export function isSafeLogoUrl(url: unknown): boolean;
export function monogramLogo(name: string, color: string): string;
export function normalizeTheme(raw: unknown): CustomerTheme | null;
export function brandHeader(theme: CustomerTheme | null | undefined): { bg: string | null; dark: boolean; stripe: string | null };
export function slugifyThemeId(name: string): string;
export function themeCssVars(theme: CustomerTheme | null | undefined): Record<string, string>;
export function parseStoredThemes(json: unknown): { activeId: string; custom: CustomerTheme[] };
export function allThemes(custom?: CustomerTheme[], library?: CustomerTheme[]): CustomerTheme[];
export function libraryThemesFrom(payload: unknown): CustomerTheme[];
export function filterThemes(themes: CustomerTheme[], query: string): CustomerTheme[];
export function resolveActiveThemeId(args: {
  queryId?: string | null;
  runtimeId?: string | null;
  savedId?: string | null;
  themes: CustomerTheme[];
}): string;
