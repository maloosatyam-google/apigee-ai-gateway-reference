import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Horizontal scroller that shows a small arrow (over a soft fade) on each side that has
 * more content, so users can tell a chip/card row continues past the edge. Clicking an
 * arrow scrolls by ~80% of the visible width.
 *
 * Scroll state is tracked with a passive scroll listener plus Resize/Mutation observers,
 * which works in every browser (CSS scroll-state container queries are Chromium-only).
 * Arrows only render when there is overflow in that direction.
 */
export interface ScrollHintRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes for the scrolling element (layout, gap, padding). */
  className?: string;
  /** Classes for the outer wrapper (margins, width). */
  wrapperClassName?: string;
  /** Tailwind "from-*" colour the fade starts from; match the row's background. */
  fadeFrom?: string;
  children: React.ReactNode;
}

export default function ScrollHintRow({
  className = '',
  wrapperClassName = '',
  fadeFrom = 'from-white',
  children,
  ...rest
}: ScrollHintRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 2px tolerance for sub-pixel widths.
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Chips change with persona/industry; re-measure when the content changes.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [update]);

  const scrollByPage = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const arrow = (dir: 1 | -1) => {
    const right = dir === 1;
    return (
      <div
        className={`pointer-events-none absolute inset-y-0 ${right ? 'right-0 bg-gradient-to-l' : 'left-0 bg-gradient-to-r'} ${fadeFrom} to-transparent w-10 flex items-center ${right ? 'justify-end' : 'justify-start'}`}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={right ? 'Scroll right for more' : 'Scroll left'}
          title={right ? 'More' : 'Back'}
          onClick={() => scrollByPage(dir)}
          className="pointer-events-auto w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-slate-800 hover:border-slate-300 flex items-center justify-center cursor-pointer transition"
        >
          {right ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className={`relative min-w-0 ${wrapperClassName}`}>
      <div ref={ref} className={className} {...rest}>
        {children}
      </div>
      {canLeft && arrow(-1)}
      {canRight && arrow(1)}
    </div>
  );
}
