import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  STORAGE_KEY,
  THEME_VAR_NAMES,
  allThemes,
  googleFontHref,
  industryById,
  setLibraryIndustries,
  allIndustries,
  addLibraryIndustry as registerLibraryIndustry,
  libraryThemesFrom,
  monogramLogo,
  normalizeTheme,
  parseStoredThemes,
  resolveActiveThemeId,
  sanitizeFontFamily,
  setDisplayIndustry,
  themeCssVars,
  themeHexPalette,
} from '../utils/customerTheme';
import type { CustomerTheme } from '../utils/customerTheme';
import { fetchThemeLibrary } from '../services/themeLibrary';

export type LibraryStatus = 'loading' | 'ready' | 'unavailable';

interface CustomerThemeState {
  /** The theme on screen: the draft being edited in the Theme panel, else the active one. */
  theme: CustomerTheme;
  /** The saved, selected theme (ignores any preview). */
  activeTheme: CustomerTheme;
  themes: CustomerTheme[];
  isDefault: boolean;
  /** Logo to show top-left, or null for the Apigee logo. */
  logoSrc: string | null;
  /**
   * Themed hex for a Tailwind family/shade (e.g. hex('blue', 600, '#2563eb')), for
   * SVG attributes and inline styles that cannot use the CSS variables. Returns
   * `fallback` under the default theme.
   */
  hex: (family: string, shade: number, fallback: string) => string;
  setActiveId: (id: string) => void;
  /** Adds or replaces a custom theme (built-ins are read-only) and selects it. */
  saveTheme: (theme: CustomerTheme) => void;
  deleteTheme: (id: string) => void;
  /**
   * Industry for the Apigee default theme, for local testing and quick demos.
   * Kept in this browser across reloads; a hard refresh resets it to Generic.
   */
  setDefaultIndustry: (industry: string) => void;
  /** Live preview while editing; null ends the preview. */
  setPreview: (theme: CustomerTheme | null) => void;
  /** Shared library (Cloud Storage via /api/themes): load state and actions. */
  libraryStatus: LibraryStatus;
  libraryError: string;
  refreshLibrary: (fresh?: boolean) => Promise<void>;
  /** Adds a theme the agent just saved to the library, and selects it. */
  addLibraryTheme: (raw: unknown) => CustomerTheme | null;
  /** Adds an industry the agent just added to the library. */
  addLibraryIndustry: (raw: unknown) => void;
  /** Bumps when library industries change, so industry pickers re-read allIndustries(). */
  industriesVersion: number;
}

const CustomerThemeContext = createContext<CustomerThemeState | null>(null);

const FONT_LINK_ID = 'customer-theme-font';
// Last library listing, so a library theme can be applied on first paint
// (e.g. ?customer=<id>) before /api/themes answers.
const LIBRARY_CACHE_KEY = 'apigee_theme_library_cache_v1';
// Industry picked for the Apigee default theme (browser only, never in the library).
const DEFAULT_INDUSTRY_KEY = 'apigee_default_theme_industry_v1';
// Industries the agent added, cached so themes using them render right on first paint.
const LIBRARY_INDUSTRY_CACHE_KEY = 'apigee_theme_library_industries_v1';

function cacheIndustries(list: unknown[]) {
  try {
    localStorage.setItem(LIBRARY_INDUSTRY_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or disabled */
  }
}

/**
 * The saved default-theme industry, or Generic after a hard refresh
 * (window.__HARD_RELOAD__ comes from /reload-hint.js, see server/reloadHint.js).
 */
function readDefaultIndustry(): string {
  try {
    if ((window as any).__HARD_RELOAD__ === true) {
      localStorage.removeItem(DEFAULT_INDUSTRY_KEY);
      return 'generic';
    }
    const saved = localStorage.getItem(DEFAULT_INDUSTRY_KEY);
    return saved && industryById(saved).id === saved ? saved : 'generic';
  } catch {
    return 'generic';
  }
}

function readCachedLibrary(): CustomerTheme[] {
  try {
    return libraryThemesFrom(JSON.parse(localStorage.getItem(LIBRARY_CACHE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function readInitial(): { activeId: string; requestedId: string | null; custom: CustomerTheme[]; library: CustomerTheme[] } {
  let stored = { activeId: DEFAULT_THEME_ID, custom: [] as CustomerTheme[] };
  try {
    stored = parseStoredThemes(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* private mode / storage disabled: fall back to defaults */
  }
  try {
    // Before anything resolves an industry id (default-theme industry, active theme).
    setLibraryIndustries(JSON.parse(localStorage.getItem(LIBRARY_INDUSTRY_CACHE_KEY) || '[]'));
  } catch {
    /* no cache */
  }
  const params = new URLSearchParams(window.location.search);
  const runtimeId = (window as any).__RUNTIME_CONFIG__?.CUSTOMER_THEME;
  const library = readCachedLibrary();
  const queryId = params.get('customer');
  const runtime = typeof runtimeId === 'string' ? runtimeId : null;
  const activeId = resolveActiveThemeId({
    queryId,
    runtimeId: runtime,
    savedId: stored.activeId,
    themes: allThemes(stored.custom, library),
  });
  // A library theme added since the cache was written is applied once the library loads.
  const requestedId = queryId || runtime || stored.activeId || null;
  return { activeId, requestedId: requestedId !== activeId ? requestedId : null, custom: stored.custom, library };
}

export const CustomerThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initial] = useState(readInitial);
  const [custom, setCustom] = useState<CustomerTheme[]>(initial.custom);
  const [activeId, setActiveIdState] = useState<string>(initial.activeId);
  const [preview, setPreview] = useState<CustomerTheme | null>(null);
  const [library, setLibrary] = useState<CustomerTheme[]>(initial.library);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>('loading');
  const [libraryError, setLibraryError] = useState('');
  const pendingId = useRef<string | null>(initial.requestedId);
  const [industriesVersion, setIndustriesVersion] = useState(0);
  // Saved in this browser; a hard refresh puts the default theme back on Generic.
  const [defaultIndustry, setDefaultIndustryState] = useState(readDefaultIndustry);
  const setDefaultIndustry = useCallback((industry: string) => {
    const id = industryById(industry).id;
    setDefaultIndustryState(id);
    try {
      if (id === 'generic') localStorage.removeItem(DEFAULT_INDUSTRY_KEY);
      else localStorage.setItem(DEFAULT_INDUSTRY_KEY, id);
    } catch {
      /* storage disabled: still applies for this page */
    }
  }, []);

  const themes = useMemo(
    () => allThemes(custom, library).map((t) => (t.id === DEFAULT_THEME_ID ? { ...t, industry: defaultIndustry } : t)),
    [custom, library, defaultIndustry],
  );
  const activeTheme = themes.find((t) => t.id === activeId) || DEFAULT_THEME;
  const previewTheme = useMemo(() => (preview ? normalizeTheme(preview) : null), [preview]);
  const theme = previewTheme || activeTheme;
  const isDefault = theme.id === DEFAULT_THEME_ID;
  const logoSrc = isDefault ? null : theme.logoUrl || monogramLogo(theme.name, theme.primary || '#2563eb');
  // Set during render (idempotent) so children rendering in this pass already see it.
  setDisplayIndustry(theme.industry);
  const palette = useMemo(() => themeHexPalette(theme), [theme]);
  const hex = useCallback(
    (family: string, shade: number, fallback: string) => palette?.[family]?.[shade] ?? fallback,
    [palette],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, custom }));
    } catch (e) {
      console.warn('Could not save customer themes (logo too large for localStorage?)', e);
    }
  }, [activeId, custom]);

  // Remember what index.html shipped with, so the Apigee default can be restored exactly.
  const originals = useRef<{ title: string; favicon: string | null } | null>(null);
  if (originals.current === null && typeof document !== 'undefined') {
    originals.current = {
      title: document.title,
      favicon: document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null,
    };
  }

  // Apply colours, font, tab title and favicon to the document.
  useEffect(() => {
    const root = document.documentElement;
    for (const name of THEME_VAR_NAMES) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value);

    const family = theme.font === 'system' ? null : sanitizeFontFamily(theme.font);
    const href = family ? googleFontHref(family) : null;
    let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (href) {
      if (!link) {
        link = document.createElement('link');
        link.id = FONT_LINK_ID;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== href) link.href = href;
      root.style.setProperty('--brand-font', `'${family}'`);
    } else {
      link?.remove();
      root.style.removeProperty('--brand-font');
    }

    const base = originals.current;
    document.title = isDefault ? base?.title || document.title : `${theme.name} · AI & Tools Gateway`;
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (icon) {
      const nextIcon = isDefault ? base?.favicon : logoSrc;
      if (nextIcon) {
        icon.removeAttribute('type');
        icon.href = nextIcon;
      }
    }
    root.dataset.customerTheme = theme.id;
  }, [theme, isDefault, logoSrc]);

  const storeLibrary = useCallback((next: CustomerTheme[]) => {
    setLibrary(next);
    try {
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(next));
    } catch {
      /* storage full or disabled: the library still works, just without the first-paint cache */
    }
    const want = pendingId.current;
    if (want && next.some((t) => t.id === want)) {
      pendingId.current = null;
      setActiveIdState(want);
    }
  }, []);

  const refreshLibrary = useCallback(
    async (fresh = false) => {
      setLibraryStatus((s) => (s === 'ready' ? s : 'loading'));
      try {
        const data = await fetchThemeLibrary(fresh);
        if (!data.available) {
          setLibraryStatus('unavailable');
          setLibraryError(data.error || 'Theme library unavailable.');
          return;
        }
        cacheIndustries(setLibraryIndustries(data.industries));
        setIndustriesVersion((v) => v + 1);
        storeLibrary(libraryThemesFrom(data));
        setLibraryStatus('ready');
        setLibraryError('');
      } catch (e: any) {
        setLibraryStatus('unavailable');
        setLibraryError(e?.message || 'Theme library unavailable.');
      }
    },
    [storeLibrary],
  );

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const addLibraryTheme = useCallback(
    (raw: unknown) => {
      const [t] = libraryThemesFrom([raw]);
      if (!t) return null;
      setLibrary((prev) => {
        const next = [...prev.filter((p) => p.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name));
        try {
          localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(next));
        } catch {
          /* see storeLibrary */
        }
        return next;
      });
      pendingId.current = null;
      setActiveIdState(t.id);
      return t;
    },
    [],
  );

  const addLibraryIndustry = useCallback((raw: unknown) => {
    if (!registerLibraryIndustry(raw)) return;
    cacheIndustries(allIndustries().filter((i) => i.source === 'library'));
    setIndustriesVersion((v) => v + 1);
  }, []);

  const setActiveId = useCallback((id: string) => {
    pendingId.current = null;
    setActiveIdState(id);
  }, []);
  const saveTheme = useCallback((t: CustomerTheme) => {
    const clean = normalizeTheme({ ...t, builtIn: false });
    if (!clean) return;
    setCustom((prev) => {
      const i = prev.findIndex((p) => p.id === clean.id);
      if (i === -1) return [...prev, clean];
      const next = prev.slice();
      next[i] = clean;
      return next;
    });
    setActiveIdState(clean.id);
  }, []);
  const deleteTheme = useCallback((id: string) => {
    setCustom((prev) => prev.filter((p) => p.id !== id));
    setActiveIdState((cur) => (cur === id ? DEFAULT_THEME_ID : cur));
  }, []);

  const value = useMemo<CustomerThemeState>(
    () => ({
      theme,
      activeTheme,
      themes,
      isDefault,
      logoSrc,
      hex,
      setActiveId,
      saveTheme,
      deleteTheme,
      setDefaultIndustry,
      setPreview,
      libraryStatus,
      libraryError,
      refreshLibrary,
      addLibraryTheme,
      addLibraryIndustry,
      industriesVersion,
    }),
    [theme, activeTheme, themes, isDefault, logoSrc, hex, setActiveId, saveTheme, deleteTheme, setDefaultIndustry, libraryStatus, libraryError, refreshLibrary, addLibraryTheme, addLibraryIndustry, industriesVersion],
  );

  return <CustomerThemeContext.Provider value={value}>{children}</CustomerThemeContext.Provider>;
};

/** Current customer theme; outside the provider, the Apigee default. */
export function useCustomerTheme(): CustomerThemeState {
  const ctx = useContext(CustomerThemeContext);
  if (ctx) return ctx;
  return {
    theme: DEFAULT_THEME,
    activeTheme: DEFAULT_THEME,
    themes: allThemes(),
    isDefault: true,
    logoSrc: null,
    hex: (_family, _shade, fallback) => fallback,
    setActiveId: () => undefined,
    saveTheme: () => undefined,
    deleteTheme: () => undefined,
    setDefaultIndustry: () => undefined,
    setPreview: () => undefined,
    libraryStatus: 'unavailable',
    libraryError: '',
    refreshLibrary: async () => undefined,
    addLibraryTheme: () => null,
    addLibraryIndustry: () => undefined,
    industriesVersion: 0,
  };
}
