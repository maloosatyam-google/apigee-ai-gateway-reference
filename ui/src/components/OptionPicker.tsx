import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface PickerOption<T extends string> {
  id: T;
  label: string;
  /** Compact label for narrower screens (the full label stays in the tooltip). */
  short?: string;
  summary: string;
}

interface OptionPickerProps<T extends string> {
  value: T;
  options: PickerOption<T>[];
  onChange: (id: T) => void;
  /** Short caption before the value, e.g. "Persona:" (shown from 1800px up). */
  caption: string;
  icon: React.ReactNode;
  footer?: string;
  /** Tailwind classes for the selected row background and check colour. */
  accent?: { row: string; check: string };
}

/** Top-right dropdown shared by the consumer persona and admin persona pickers. */
export function OptionPicker<T extends string>({
  value,
  options,
  onChange,
  caption,
  icon,
  footer,
  accent = { row: 'bg-purple-50', check: 'text-purple-600' },
}: OptionPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    // min-w-0 lets the header shrink this picker (label truncates) instead of
    // pushing the profile button off-screen on narrow windows.
    <div className="relative min-w-0 max-w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 pl-2 pr-2 py-1.5 max-w-full min-w-0 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-xs shadow-xs transition cursor-pointer"
        title={`${caption} ${current.label} (${current.summary})`}
      >
        {icon}
        <span className="text-slate-500 font-medium hidden min-[1800px]:inline shrink-0">{caption}</span>
        {/* Full label on wide screens, the short one below 1800px; both truncate if space is still tight. */}
        <span className={`font-semibold text-slate-800 whitespace-nowrap truncate min-w-0 ${current.short ? 'hidden min-[1800px]:inline' : ''}`}>{current.label}</span>
        {current.short && <span className="font-semibold text-slate-800 whitespace-nowrap truncate min-w-0 min-[1800px]:hidden">{current.short}</span>}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={caption.replace(/:$/, '')}
          className="absolute top-full right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 z-50"
        >
          {options.map((o) => {
            const selected = o.id === value;
            return (
              <li key={o.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg transition cursor-pointer ${
                    selected ? accent.row : 'hover:bg-slate-50'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${selected ? accent.check : 'text-transparent'}`} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800">{o.label}</span>
                    <span className="block text-[11px] text-slate-500">{o.summary}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {footer && (
            <li className="px-2.5 pt-1.5 pb-1 text-[10px] text-slate-400 border-t border-slate-100 mt-1">{footer}</li>
          )}
        </ul>
      )}
    </div>
  );
}
