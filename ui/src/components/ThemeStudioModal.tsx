import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Palette, Upload, Globe, Wand2, Trash2, Copy, Check, Plus, Download, FileUp, Info, Search, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useCustomerTheme } from './CustomerThemeProvider';
import { ApigeeColorSymbol } from './ApigeeLogo';
import {
  DEFAULT_THEME_ID,
  FONT_OPTIONS,
  allIndustries,
  brandHeader,
  MAX_LOGO_BYTES,
  faviconUrlForDomain,
  filterThemes,
  industryById,
  isSafeLogoUrl,
  monogramLogo,
  normalizeTheme,
  personaDisplay,
  OVERRIDABLE_PROMPTS,
  SCENARIO_LABELS,
  sanitizeFontFamily,
  slugifyThemeId,
} from '../utils/customerTheme';
import type { CustomerTheme } from '../utils/customerTheme';
import { dominantColors, normalizeHex } from '../utils/themePalette';
import { PERSONAS } from '../utils/personas';
import { ThemeExistsError, requestTheme, updateLibraryTheme } from '../services/themeLibrary';

interface ThemeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const blankTheme = (): CustomerTheme => ({
  id: '',
  name: '',
  logoUrl: '',
  wordmarkUrl: '',
  wordmarkWhite: false,
  showName: true,
  headerBg: '',
  primary: '#1a73e8',
  accent: '',
  font: 'system',
  industry: 'generic',
  builtIn: false,
});

/** Downscales raster logos so they fit comfortably in localStorage; SVGs are kept as-is. */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  if (file.type === 'image/svg+xml') {
    if (file.size > MAX_LOGO_BYTES) throw new Error('SVG is larger than 400 KB.');
    return asDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/png');
  if (url.length > MAX_LOGO_BYTES * 1.33) throw new Error('Logo is still too large after resizing.');
  return url;
}

/** Reads a logo back through a canvas to suggest brand colours. Fails on cross-origin images without CORS. */
function suggestColorsFromLogo(src: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        resolve(dominantColors(ctx.getImageData(0, 0, size, size).data, 2));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Logo could not be loaded.'));
    img.src = src;
  });
}

const ColorField: React.FC<{
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (hex: string) => void;
}> = ({ label, hint, value, placeholder, disabled, onChange }) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-slate-700 font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          disabled={disabled}
          value={normalizeHex(value) || '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 rounded-md border border-slate-300 bg-white p-0.5 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`${label} colour picker`}
        />
        <input
          type="text"
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex || e.target.value === '') onChange(hex || '');
          }}
          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
        />
      </span>
      <span className="block text-[10px] text-slate-400">{hint}</span>
    </label>
  );
};

export const ThemeStudioModal: React.FC<ThemeStudioModalProps> = ({ isOpen, onClose }) => {
  const {
    themes,
    activeTheme,
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
  } = useCustomerTheme();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wordmarkFileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string>(activeTheme.id);
  const [draft, setDraft] = useState<CustomerTheme>(activeTheme);
  const [domain, setDomain] = useState('');
  const [logoInput, setLogoInput] = useState('');
  const [wordmarkInput, setWordmarkInput] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  // 'request' shows the "Request a theme" form instead of the editor.
  const [mode, setMode] = useState<'edit' | 'request'>('edit');
  const [req, setReq] = useState({ name: '', website: '', industry: '', logoDataUrl: '' });
  const [requesting, setRequesting] = useState(false);
  const reqLogoRef = useRef<HTMLInputElement>(null);

  // Native <dialog>: focus trapping, Esc and the top layer come for free.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (isOpen && !d.open) {
      d.showModal();
      setSelectedId(activeTheme.id);
      setDraft(activeTheme);
      setNotice(null);
      setMode('edit');
      // Pick up themes other presenters added since the page loaded.
      refreshLibrary(true);
    } else if (!isOpen && d.open) {
      d.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // A library theme requested by link can become active after the panel opened
  // (the library loads async); follow it unless the presenter picked another one.
  const lastActiveId = useRef(activeTheme.id);
  useEffect(() => {
    const prev = lastActiveId.current;
    lastActiveId.current = activeTheme.id;
    if (isOpen && mode === 'edit' && selectedId === prev && prev !== activeTheme.id) {
      setSelectedId(activeTheme.id);
      setDraft(activeTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTheme.id]);

  // Live preview of the draft behind the dialog; ends when the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      return;
    }
    const clean = normalizeTheme({ ...draft, id: draft.id || 'draft-preview', name: draft.name || 'Customer' });
    setPreview(clean);
  }, [draft, isOpen, setPreview]);

  // Mirror the saved logo URL into the text field (uploads show a placeholder instead).
  useEffect(() => {
    setLogoInput(draft.logoUrl.startsWith('data:') ? '' : draft.logoUrl);
  }, [draft.logoUrl]);
  useEffect(() => {
    const w = draft.wordmarkUrl || '';
    setWordmarkInput(w.startsWith('data:') ? '' : w);
  }, [draft.wordmarkUrl]);

  const isBuiltIn = draft.builtIn;
  const isLibrary = draft.source === 'library';
  // Library themes are shared and editable (saved back to the bucket); the default is not.
  const readOnly = isBuiltIn && !isLibrary;
  const [saving, setSaving] = useState(false);
  const industry = industryById(draft.industry);
  const customFont = draft.font !== 'system' && !FONT_OPTIONS.some((f) => f.id === draft.font);
  const logoPreview = draft.id === DEFAULT_THEME_ID ? null : draft.logoUrl || monogramLogo(draft.name || '?', draft.primary);
  const previewHeader = brandHeader({ ...draft, id: draft.id || 'draft-preview' });
  const update = (patch: Partial<CustomerTheme>) => setDraft((d) => ({ ...d, ...patch }));

  const grouped = useMemo(() => {
    const shown = filterThemes(themes, query);
    return {
      defaults: query.trim() ? [] : shown.filter((t) => t.id === DEFAULT_THEME_ID),
      library: shown.filter((t) => t.source === 'library'),
      customers: shown.filter((t) => !t.builtIn),
      total: shown.length,
    };
  }, [themes, query]);

  const select = (t: CustomerTheme) => {
    setSelectedId(t.id);
    setDraft(t);
    setNotice(null);
    setMode('edit');
  };

  const openRequest = () => {
    setMode('request');
    setNotice(null);
    setReq({ name: query.trim(), website: '', industry: '', logoDataUrl: '' });
  };

  const handleRequestLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      setReq((r) => ({ ...r, logoDataUrl: '' }));
      const url = await fileToLogoDataUrl(file);
      setReq((r) => ({ ...r, logoDataUrl: url }));
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not read that image.' });
    }
  };

  const showExisting = (t: CustomerTheme) => {
    setQuery('');
    select(t);
    setNotice({ kind: 'error', text: `"${t.name}" already exists in the customer library, so nothing was changed. It is selected here; press Apply to use it.` });
  };

  const submitRequest = async () => {
    if (!req.name.trim() || !req.website.trim()) {
      setNotice({ kind: 'error', text: 'Customer name and website are required.' });
      return;
    }
    // Same id rule as the server (lower-case, hyphenated), so "hdfc bank" finds "HDFC Bank".
    const wanted = req.name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const known = themes.find((t) => t.source === 'library' && (t.id === wanted || t.name.toLowerCase() === req.name.trim().toLowerCase()));
    if (known) {
      showExisting(known);
      return;
    }
    setRequesting(true);
    setNotice(null);
    try {
      const { theme, industry: newIndustry, agent } = await requestTheme({
        name: req.name.trim(),
        website: req.website.trim(),
        industry: req.industry || undefined,
        logoDataUrl: req.logoDataUrl || undefined,
        industries: allIndustries().map((i) => i.id),
        fonts: FONT_OPTIONS.filter((f) => f.id !== 'system').map((f) => f.id),
      });
      // Register a newly added industry first, so the new theme renders with it.
      if (newIndustry) addLibraryIndustry(newIndustry);
      const added = addLibraryTheme(theme);
      if (!added) throw new Error('The agent returned a theme this app could not read.');
      setQuery('');
      select(added);
      const cost = agent.costUsd ? ` · $${Number(agent.costUsd).toFixed(6)}` : '';
      setNotice({
        kind: agent.error ? 'error' : 'ok',
        text: `Added "${added.name}" to the shared library.${agent.model ? ` Agent: ${agent.model} via the AI Gateway${cost}.` : ''} ${(agent.steps || []).join(' ')}`,
      });
    } catch (e: any) {
      if (e instanceof ThemeExistsError) {
        // Added by another presenter since this page loaded.
        const t = addLibraryTheme(e.existing);
        if (t) {
          showExisting(t);
          return;
        }
      }
      setNotice({ kind: 'error', text: e?.message || 'The theme request failed.' });
    } finally {
      setRequesting(false);
    }
  };


  const startNew = () => {
    setSelectedId('');
    setDraft(blankTheme());
    setDomain('');
    setNotice(null);
  };

  const duplicate = () => {
    setSelectedId('');
    setDraft({ ...draft, id: '', name: draft.id === DEFAULT_THEME_ID ? '' : `${draft.name} (copy)`, builtIn: false });
    setNotice({ kind: 'ok', text: 'Copied into a new customer theme. Edit it and press Save & apply.' });
  };

  const handleApply = async () => {
    if (isLibrary) {
      setSaving(true);
      try {
        const { theme } = await updateLibraryTheme({ ...draft });
        const saved = addLibraryTheme(theme);
        if (saved) {
          setDraft(saved);
          setActiveId(saved.id);
        }
        onClose();
      } catch (e: any) {
        if (e instanceof ThemeExistsError && e.code === 'stale') {
          // Someone else saved first: load their version rather than overwrite it.
          const t = addLibraryTheme(e.existing);
          if (t) setDraft(t);
        }
        setNotice({ kind: 'error', text: e?.message || 'Could not save to the shared library.' });
      } finally {
        setSaving(false);
      }
      return;
    }
    if (isBuiltIn) {
      // The default theme's industry is browser-only and cleared by a hard refresh (see setDefaultIndustry).
      if (draft.id === DEFAULT_THEME_ID) setDefaultIndustry(draft.industry);
      setActiveId(draft.id);
      onClose();
      return;
    }
    if (!draft.name.trim()) {
      setNotice({ kind: 'error', text: 'Give the customer a name first.' });
      return;
    }
    let id = draft.id || slugifyThemeId(draft.name);
    if (!draft.id) {
      let n = 2;
      const base = id;
      while (themes.some((t) => t.id === id)) id = `${base}-${n++}`;
    }
    const clean = normalizeTheme({ ...draft, id, builtIn: false });
    if (!clean) {
      setNotice({ kind: 'error', text: 'That theme is not valid; check the name and colours.' });
      return;
    }
    saveTheme(clean);
    setSelectedId(clean.id);
    setDraft(clean);
    onClose();
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await fileToLogoDataUrl(file);
      update({ logoUrl: url });
      setNotice({ kind: 'ok', text: isLibrary ? 'Logo loaded. It is uploaded to the shared library when you save.' : 'Logo loaded. It is stored in this browser only, never uploaded.' });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not read that image.' });
    }
  };

  const handleWordmarkUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await fileToLogoDataUrl(file);
      update({ wordmarkUrl: url });
      setNotice({ kind: 'ok', text: isLibrary ? 'Full logo loaded. It is uploaded to the shared library when you save.' : 'Full logo loaded. It is stored in this browser only, never uploaded.' });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not read that image.' });
    }
  };

  const handleFetchDomain = () => {
    const url = faviconUrlForDomain(domain);
    if (!url) {
      setNotice({ kind: 'error', text: 'Enter a website domain such as example.com.' });
      return;
    }
    update({ logoUrl: url });
    setNotice({ kind: 'ok', text: 'Using the site icon. Upload the full logo for a sharper result.' });
  };

  const handleSuggest = async () => {
    if (!draft.logoUrl) {
      setNotice({ kind: 'error', text: 'Add a logo first, then colours can be picked from it.' });
      return;
    }
    try {
      const [primary, accent] = await suggestColorsFromLogo(draft.logoUrl);
      if (!primary) throw new Error('No brand colour found (logo is greyscale?).');
      update({ primary, accent: accent || '' });
      setNotice({ kind: 'ok', text: `Picked ${primary}${accent ? ` and ${accent}` : ''} from the logo.` });
    } catch (e: any) {
      setNotice({
        kind: 'error',
        text:
          e?.name === 'SecurityError'
            ? 'That logo host does not allow colour sampling. Upload the file instead, or type the brand hex.'
            : e?.message || 'Could not read colours from the logo.',
      });
    }
  };

  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('customer', draft.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice({ kind: 'error', text: url.toString() });
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ ...draft, builtIn: false }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id || slugifyThemeId(draft.name)}.theme.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = normalizeTheme({ ...JSON.parse(await file.text()), builtIn: false });
      if (!parsed) throw new Error('Not a theme file.');
      setSelectedId('');
      setDraft({ ...parsed, id: themes.some((t) => t.id === parsed.id && t.builtIn) ? '' : parsed.id });
      setNotice({ kind: 'ok', text: `Imported "${parsed.name}". Press Save & apply to keep it.` });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not import that file.' });
    }
  };

  const ThemeRow: React.FC<{ t: CustomerTheme }> = ({ t }) => {
    const selected = t.id === selectedId;
    const logo = t.id === DEFAULT_THEME_ID ? null : t.logoUrl || monogramLogo(t.name, t.primary);
    return (
      <button
        type="button"
        onClick={() => select(t)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition cursor-pointer ${
          selected ? 'bg-white shadow-xs ring-1 ring-slate-200' : 'hover:bg-white/70'
        }`}
      >
        {logo ? (
          <img src={logo} alt="" className="w-6 h-6 rounded object-contain shrink-0 bg-white" />
        ) : (
          <ApigeeColorSymbol className="w-6 h-6 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-slate-800 truncate">{t.name}</span>
          <span className="block text-[10px] text-slate-400 truncate">{industryById(t.industry).label.replace(' (no industry mapping)', '')}</span>
        </span>
        {t.id === activeTheme.id && (
          <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1">On</span>
        )}
      </button>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="theme-studio-title"
      className="p-0 rounded-2xl border border-slate-200 shadow-2xl w-[min(960px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] bg-white text-slate-900 backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col max-h-[calc(100vh-2rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-blue-600" />
            <h2 id="theme-studio-title" className="text-base font-bold text-slate-900">Customer theme</h2>
            <span className="text-[11px] text-slate-500 hidden sm:inline">Logo, colours, font and industry wording for the audience in the room</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_1fr] overflow-hidden">
          {/* Theme list */}
          <aside className="bg-slate-50 border-r border-slate-200 p-3 space-y-3 overflow-y-auto text-xs">
            <button
              type="button"
              onClick={openRequest}
              className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-white font-semibold transition cursor-pointer ${
                mode === 'request' ? 'bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Request a theme
            </button>
            <button
              type="button"
              onClick={startNew}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Create manually (this browser)
            </button>
            <label className="relative block">
              <span className="sr-only">Search customers</span>
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by customer name"
                className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            {query.trim() && grouped.total === 0 && (
              <div className="px-1 text-[11px] text-slate-500">
                No customer matches “{query.trim()}”.{' '}
                <button type="button" onClick={openRequest} className="font-semibold text-blue-700 hover:underline cursor-pointer">
                  Request it
                </button>
              </div>
            )}
            <div className="space-y-1">{grouped.defaults.map((t) => <ThemeRow key={t.id} t={t} />)}</div>
            {grouped.customers.length > 0 && (
              <div className="space-y-1">
                <div className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Your customers</div>
                {grouped.customers.map((t) => <ThemeRow key={t.id} t={t} />)}
              </div>
            )}
            <div className="space-y-1">
              <div className="px-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <span title="Shared by every presenter; stored in Cloud Storage, added without a redeploy">Customer library</span>
                <button
                  type="button"
                  onClick={() => refreshLibrary(true)}
                  title="Reload the shared library"
                  className="p-0.5 rounded hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${libraryStatus === 'loading' ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {libraryStatus === 'unavailable' && (
                <div className="px-1 text-[10px] text-rose-600" title={libraryError}>
                  Library unavailable; showing the last copy in this browser.
                </div>
              )}
              {grouped.library.map((t) => <ThemeRow key={t.id} t={t} />)}
              {!query.trim() && libraryStatus !== 'loading' && grouped.library.length === 0 && (
                <div className="px-1 text-[10px] text-slate-400">Empty. Use Request a theme to add a customer.</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-600 hover:bg-white transition cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" /> Import theme file
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                handleImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </aside>

          {/* Request a theme */}
          {mode === 'request' ? (
          <form
            className="overflow-y-auto p-5 space-y-4 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              submitRequest();
            }}
          >
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-slate-700">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-600" />
              <span>
                The theme agent researches the brand colours, closest font and industry with Gemini <b>through the Apigee AI Gateway</b>{' '}
                (your key, so the call shows in Analytics), fetches the site icon if you don't upload a logo, and adds the customer to the
                shared library for every presenter. No redeploy needed.
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Customer name *</span>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={req.name}
                  onChange={(e) => setReq((r) => ({ ...r, name: e.target.value }))}
                  placeholder="e.g. Axis Bank"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Website *</span>
                <input
                  type="text"
                  required
                  inputMode="url"
                  value={req.website}
                  onChange={(e) => setReq((r) => ({ ...r, website: e.target.value }))}
                  placeholder="https://www.example.com"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Industry (optional)</span>
                <select
                  value={req.industry}
                  onChange={(e) => setReq((r) => ({ ...r, industry: e.target.value }))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Let the agent decide</option>
                  {allIndustries().filter((i) => i.id !== 'generic').map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                      {i.source === 'library' ? ' (added by agent)' : ''}
                    </option>
                  ))}
                </select>
                <span className="block text-[10px] text-slate-400">
                  If none of these fits, the agent adds the customer&apos;s industry (personas and scenario prompts) to the library.
                </span>
              </label>
              <div className="block space-y-1">
                <span className="text-slate-700 font-semibold block">Logo (optional)</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => reqLogoRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" /> {req.logoDataUrl ? 'Replace' : 'Upload'}
                  </button>
                  {req.logoDataUrl ? (
                    <>
                      <img src={req.logoDataUrl} alt="" className="h-7 max-w-[120px] object-contain" />
                      <button type="button" onClick={() => setReq((r) => ({ ...r, logoDataUrl: '' }))} className="text-slate-500 hover:text-rose-600 cursor-pointer">
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-400">Empty = the site's own icon</span>
                  )}
                  <input
                    ref={reqLogoRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      handleRequestLogo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>
            {notice && (
              <div
                role="status"
                className={`px-3 py-2 rounded-lg border text-[11px] ${
                  notice.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {notice.text}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={requesting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold transition cursor-pointer shadow-xs"
              >
                {requesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {requesting ? 'Agent is researching the brand…' : 'Add to library'}
              </button>
              <button
                type="button"
                onClick={() => setMode('edit')}
                disabled={requesting}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold transition cursor-pointer"
              >
                Back
              </button>
            </div>
          </form>
          ) : (
          /* Editor */
          <div className="overflow-y-auto p-5 space-y-5 text-xs">
            {isBuiltIn && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {draft.id === DEFAULT_THEME_ID
                    ? 'The standard Apigee look. Apply it to remove any customer branding. You can pick an industry for testing or a quick demo: it is kept in this browser, and a hard refresh (Cmd/Ctrl+Shift+R) resets it to Generic.'
                    : isLibrary
                      ? `Shared customer library${draft.website ? ` (${draft.website})` : ''}. Edits here are saved for every presenter (library themes can be added and edited, not removed). Or duplicate it for a variant in this browser only.`
                      : 'A read-only theme. Apply it as-is, or duplicate it to make it your own.'}{' '}
                  <button type="button" onClick={duplicate} className="font-semibold text-blue-700 hover:underline cursor-pointer">
                    Duplicate to edit
                  </button>
                </span>
              </div>
            )}

            {/* Header preview */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div
                className={`relative px-3 py-2 flex items-center gap-3 border-b border-slate-100 ${previewHeader.bg ? '' : 'bg-white'}`}
                style={previewHeader.bg ? { backgroundColor: previewHeader.bg } : undefined}
              >
                {draft.wordmarkUrl && draft.id !== DEFAULT_THEME_ID ? (
                  <img src={draft.wordmarkUrl} alt="" className={`h-8 max-w-[220px] object-contain object-left${draft.wordmarkWhite ? ' brightness-0 invert' : ''}`} />
                ) : logoPreview ? (
                  <img src={logoPreview} alt="" className={`h-7 max-w-[160px] object-contain${previewHeader.dark ? ' bg-white rounded-md p-0.5' : ''}`} />
                ) : (
                  <ApigeeColorSymbol className="w-7 h-7" />
                )}
                {draft.showName && draft.id !== DEFAULT_THEME_ID && (
                  <span className={`text-sm font-bold ${previewHeader.dark ? 'text-white' : 'text-slate-900'}`}>{draft.name || 'Customer name'}</span>
                )}
                <span className="ml-auto flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-xl p-0.5">
                  <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[11px] font-semibold">AI Gateway</span>
                  <span className="px-2.5 py-1 rounded-lg bg-cyan-600 text-white text-[11px] font-semibold">Tools</span>
                  <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold">Badge</span>
                </span>
                {previewHeader.stripe && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: previewHeader.stripe }} />}
              </div>
              <div className="px-3 py-1.5 bg-slate-50 text-[10px] text-slate-500">
                Live preview: the whole app behind this panel shows the draft until you close it.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Customer name</span>
                <input
                  type="text"
                  value={draft.name}
                  disabled={readOnly}
                  maxLength={60}
                  placeholder="e.g. Acme Bank"
                  onChange={(e) => update({ name: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                />
                <span className="block text-[10px] text-slate-400">Shown in the header and browser tab only; scenarios stay generic.</span>
              </label>
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Industry</span>
                <select
                  value={draft.industry}
                  disabled={readOnly && draft.id !== DEFAULT_THEME_ID}
                  onChange={(e) => update({ industry: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                >
                  {allIndustries().map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                      {i.source === 'library' ? ' (added by agent)' : ''}
                    </option>
                  ))}
                </select>
                <span className="block text-[10px] text-slate-400">
                  Renames the personas and swaps in industry prompts. Access and models are unchanged.
                  {draft.id === DEFAULT_THEME_ID && ' For the Apigee theme it is kept in this browser only; a hard refresh resets it to Generic.'}
                </span>
              </label>
            </div>

            {/* Logo */}
            <fieldset className="space-y-2" disabled={readOnly}>
              <legend className="text-slate-700 font-semibold mb-1">Logo</legend>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    handleUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <span className="text-slate-400">or</span>
                <div className="flex items-center gap-1.5 flex-1 min-w-[220px]">
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleFetchDomain();
                      }
                    }}
                    placeholder="customer website, e.g. example.com"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={handleFetchDomain}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Globe className="w-3.5 h-3.5" /> Use site icon
                  </button>
                </div>
              </div>
              <input
                type="url"
                value={logoInput}
                placeholder={draft.logoUrl.startsWith('data:') ? (isLibrary ? 'Uploaded image (saved to the library when you save)' : 'Uploaded image (stored in this browser)') : 'or paste an https:// logo URL'}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setLogoInput(e.target.value);
                  if (isSafeLogoUrl(v)) update({ logoUrl: v });
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              />
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={draft.showName} onChange={(e) => update({ showName: e.target.checked })} />
                  Show the name next to the logo (for icon-only logos)
                </label>
                {draft.logoUrl && (
                  <button type="button" onClick={() => update({ logoUrl: '' })} className="text-slate-500 hover:text-rose-600 cursor-pointer">
                    Remove logo (use monogram)
                  </button>
                )}
              </div>
            </fieldset>

            {/* Header: full logo with the company name and the top-row colour */}
            <fieldset className="space-y-2" disabled={readOnly}>
              <legend className="text-slate-700 font-semibold mb-1">Header (full logo and bar colour)</legend>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => wordmarkFileRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload full logo
                </button>
                <input
                  ref={wordmarkFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    handleWordmarkUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  type="url"
                  value={wordmarkInput}
                  placeholder={(draft.wordmarkUrl || '').startsWith('data:') ? 'Uploaded image' : 'or paste an https:// URL of the logo with the company name'}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setWordmarkInput(e.target.value);
                    if (v === '' || isSafeLogoUrl(v)) update({ wordmarkUrl: v });
                  }}
                  className="flex-1 min-w-[220px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                />
                {draft.wordmarkUrl && (
                  <button type="button" onClick={() => update({ wordmarkUrl: '' })} className="text-slate-500 hover:text-rose-600 cursor-pointer">
                    Remove
                  </button>
                )}
              </div>
              {draft.wordmarkUrl && (
                <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={Boolean(draft.wordmarkWhite)} onChange={(e) => update({ wordmarkWhite: e.target.checked })} />
                  Show the full logo in white (for a dark bar colour, as on the customer's site)
                </label>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ColorField
                  label="Header bar colour (optional)"
                  hint="Top row background, e.g. the orange of the customer's site. Empty = white. A white full logo needs a colour here."
                  value={draft.headerBg || ''}
                  placeholder="white"
                  disabled={readOnly}
                  onChange={(headerBg) => update({ headerBg })}
                />
                <p className="text-[10px] text-slate-400 self-center">
                  The full logo shows on wide screens (the square logo where space is tight). With a full logo or a bar colour, a
                  thin stripe in the brand colour runs under the header.
                </p>
              </div>
            </fieldset>

            {/* Colours */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-700 font-semibold">Brand colours</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={handleSuggest}
                    className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" /> Pick from logo
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ColorField
                  label="Primary"
                  hint="Buttons, active tabs, links. Shades are derived and kept readable (WCAG AA)."
                  value={draft.primary}
                  placeholder="#1a73e8"
                  disabled={readOnly}
                  onChange={(primary) => update({ primary })}
                />
                <ColorField
                  label="Accent (optional)"
                  hint="Tools / MCP Gateway highlights. Empty = follow primary."
                  value={draft.accent}
                  placeholder="same as primary"
                  disabled={readOnly}
                  onChange={(accent) => update({ accent })}
                />
              </div>
              <p className="text-[10px] text-slate-400">Green, amber and red stay fixed: they mean passed, warning and blocked.</p>
            </div>

            {/* Font */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-slate-700 font-semibold">Font</span>
                <select
                  value={customFont ? '__custom' : draft.font}
                  disabled={readOnly}
                  onChange={(e) => update({ font: e.target.value === '__custom' ? 'Lexend' : e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                  <option value="__custom">Other Google Font…</option>
                </select>
              </label>
              {customFont && (
                <label className="block space-y-1">
                  <span className="text-slate-700 font-semibold">Google Fonts family name</span>
                  <input
                    type="text"
                    value={draft.font}
                    disabled={readOnly}
                    onChange={(e) => update({ font: sanitizeFontFamily(e.target.value) || 'system' })}
                    placeholder="e.g. Lexend"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                  />
                </label>
              )}
            </div>

            {/* Persona mapping preview */}
            {industry.id !== 'generic' && (
              <div className="space-y-1.5">
                <span className="text-slate-700 font-semibold">Personas in the top-right picker</span>
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {PERSONAS.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="font-semibold text-slate-800">{personaDisplay(p, industry.id).label}</span>
                      <span className="text-[10px] text-slate-400">demo persona: {p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scenario prompt mapping */}
            {industry.id !== 'generic' && (
              <details className="group rounded-lg border border-slate-200">
                <summary className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer select-none">
                  <span className="text-slate-700 font-semibold">Scenario prompts for {industry.label}</span>
                  <span className="text-[10px] text-slate-400">
                    {OVERRIDABLE_PROMPTS.filter((id) => industry.prompts[id]).length} of {OVERRIDABLE_PROMPTS.length} AI scenarios
                  </span>
                </summary>
                <ol className="divide-y divide-slate-100 border-t border-slate-200 max-h-72 overflow-y-auto">
                  {OVERRIDABLE_PROMPTS.map((id) => (
                    <li key={id} className="px-3 py-1.5 space-y-0.5">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{SCENARIO_LABELS[id] || id}</span>
                      <span className="block text-[11px] text-slate-700">{industry.prompts[id] || 'Default prompt'}</span>
                    </li>
                  ))}
                </ol>
                <p className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-400">
                  Each prompt keeps the outcome of its scenario (verified against the gateway). MCP and agent scenarios use fixed demo data.
                </p>
              </details>
            )}

            {notice && (
              <div
                role="status"
                className={`px-3 py-2 rounded-lg border text-[11px] break-all ${
                  notice.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {notice.text}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs">
          <div className="flex items-center gap-1.5">
            {!isBuiltIn && draft.id && (
              <button
                type="button"
                onClick={() => {
                  deleteTheme(draft.id);
                  select(themes.find((t) => t.id === DEFAULT_THEME_ID)!);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            {draft.id && draft.id !== DEFAULT_THEME_ID && (
              <button
                type="button"
                onClick={handleCopyLink}
                title={isLibrary || isBuiltIn ? 'Link that opens the demo in this theme, for anyone' : 'Link that opens the demo in this theme (in a browser that has the theme saved)'}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200/60 font-semibold transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} Demo link
              </button>
            )}
            {draft.id !== DEFAULT_THEME_ID && (draft.name || draft.id) && (
              <button
                type="button"
                onClick={handleExport}
                title="Download this theme as a file, to use it on another machine"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200/60 font-semibold transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            {mode === 'edit' && (
            <button
              type="button"
              disabled={saving}
              onClick={handleApply}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition cursor-pointer shadow-xs"
            >
              {saving ? 'Saving…' : isLibrary ? 'Save to library & apply' : isBuiltIn ? 'Apply' : 'Save & apply'}
            </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
};
