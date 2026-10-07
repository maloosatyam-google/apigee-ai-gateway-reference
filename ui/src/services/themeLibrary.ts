/**
 * Client for the shared customer theme library (/api/themes, see
 * server/themeLibrary.js). Themes and logos live in a private Cloud Storage
 * bucket, so new customers appear without a redeploy.
 */

export interface LibraryThemePayload {
  available: boolean;
  bucket?: string;
  themes: unknown[];
  /** Industries the theme agent added (see server/industryGenerator.js). */
  industries: unknown[];
  error?: string;
}

export interface ThemeRequestInput {
  name: string;
  website: string;
  /** '' lets the agent decide. */
  industry?: string;
  /** Optional uploaded logo (data:image/...;base64). */
  logoDataUrl?: string;
  /** Allowed ids, so the agent only answers with values the UI understands. */
  industries: string[];
  fonts: string[];
}

export interface ThemeAgentTrace {
  model?: string;
  grounded?: boolean;
  status?: number;
  latencyMs?: number;
  costUsd?: string;
  sources?: string[];
  steps?: string[];
  error?: string;
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchThemeLibrary(fresh = false): Promise<LibraryThemePayload> {
  const res = await fetch(`/api/themes${fresh ? '?fresh=1' : ''}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { available: false, themes: [], industries: [], error: await errorText(res) };
  const data = await res.json();
  return {
    available: Boolean(data?.available),
    bucket: data?.bucket,
    themes: Array.isArray(data?.themes) ? data.themes : [],
    industries: Array.isArray(data?.industries) ? data.industries : [],
    error: data?.error,
  };
}

/** Runs the theme agent: researches the brand through the AI Gateway and saves it to the library. */
/**
 * Thrown on a 409: the customer is already in the library (`code: 'exists'`), or
 * the theme was edited by someone else since it was loaded (`code: 'stale'`).
 * `existing` is the stored theme.
 */
export class ThemeExistsError extends Error {
  existing: unknown;
  code: 'exists' | 'stale';
  constructor(message: string, existing: unknown, code: 'exists' | 'stale' = 'exists') {
    super(message);
    this.name = 'ThemeExistsError';
    this.existing = existing;
    this.code = code;
  }
}

/** `industry` is set when the agent added a new industry for this customer. */
export async function requestTheme(input: ThemeRequestInput): Promise<{ theme: unknown; industry?: unknown; agent: ThemeAgentTrace }> {
  const res = await fetch('/api/themes/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const j = await res.json().catch(() => ({}));
    throw new ThemeExistsError(j?.error || 'That customer already exists in the library.', j?.existing);
  }
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Saves presenter edits to a library theme, for everyone. `baseUpdatedAt` is the
 * version the edit started from; if someone else saved in between, this throws
 * ThemeExistsError with code 'stale' and their version.
 */
export async function updateLibraryTheme(theme: { id: string; updatedAt?: string } & Record<string, unknown>): Promise<{ theme: unknown }> {
  const res = await fetch(`/api/themes/${encodeURIComponent(theme.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme, baseUpdatedAt: theme.updatedAt || '' }),
  });
  if (res.status === 409) {
    const j = await res.json().catch(() => ({}));
    throw new ThemeExistsError(j?.error || 'This theme was changed by someone else.', j?.existing, j?.code === 'stale' ? 'stale' : 'exists');
  }
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}
