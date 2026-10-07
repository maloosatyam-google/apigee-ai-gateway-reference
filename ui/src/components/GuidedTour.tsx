import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Lock, Compass } from 'lucide-react';
import { AppTab } from '../types';
import { TOUR_STEPS, TourActionId, tourCopy } from '../services/tourSteps';
import { usePersonaVoice } from '../utils/voice';

interface GuidedTourProps {
  open: boolean;
  onClose: () => void;
  /** Admin-only steps are narrated but not navigated to when this is false. */
  isAdmin: boolean;
  onRequestTab: (tab: AppTab) => void;
  /** Fires the live gateway call attached to a step. */
  onRunAction: (action: TourActionId) => void;
}

/** The custom property the popover tethers to. One name, re-pointed per step. */
const ANCHOR_NAME = '--tour-anchor';

/**
 * The interactive product tour.
 *
 * Built on the Popover API in `manual` mode rather than as a modal: the whole point is
 * that the viewer can keep clicking the app while a step is on screen. An `auto` popover
 * would light-dismiss the moment they touched the thing the step is pointing at, and a
 * `<dialog>` would make the app inert underneath.
 *
 * Positioning uses CSS Anchor Positioning, which no browser ships everywhere yet, so
 * `index.css` carries an `@supports not` fallback that drops the step to a fixed bar at
 * the bottom of the viewport. Deliberately no polyfill: this app runs on five runtime
 * dependencies and a tour is not worth a sixth.
 */
export const GuidedTour: React.FC<GuidedTourProps> = ({
  open,
  onClose,
  isAdmin,
  onRequestTab,
  onRunAction,
}) => {
  const [index, setIndex] = useState(0);
  /**
   * Whether the current step actually found its target in the DOM.
   *
   * Drives `data-anchored`, because `position-anchor` pointing at a name nothing
   * declares does not fall back gracefully - it drops the popover in the top-left
   * corner of the viewport.
   */
  const [anchored, setAnchored] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  // The tour narrates in the voice of whoever is acting on the current tab.
  const { speaker, sp } = usePersonaVoice('active');
  const primaryRef = useRef<HTMLButtonElement>(null);

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;
  /** An admin step viewed as a non-admin: narrate it, but do not try to navigate there. */
  const isLocked = !!step?.adminOnly && !isAdmin;

  const goTo = useCallback((next: number) => {
    setIndex(Math.min(Math.max(next, 0), TOUR_STEPS.length - 1));
  }, []);

  // Restart from the top every time the tour is opened. A tour that resumes two thirds of
  // the way through is useless to the next person the demo is being given to.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Promote to the top layer. `showPopover` throws if already open, hence the guard.
  useEffect(() => {
    const el = popoverRef.current;
    if (!el || !open) return;
    try {
      el.showPopover();
    } catch {
      /* Already open, or no Popover API - the fallback CSS still renders it in flow. */
    }
    return () => {
      try {
        el.hidePopover();
      } catch {
        /* Already hidden. */
      }
    };
  }, [open]);

  /*
    MANDATORY for a non-modal popover: move focus inside it on open and on every step
    change. Without this the popover appears visually but keyboard and screen-reader
    users are left where they were, with no idea anything happened.

    `preventScroll` because the popover is in the top layer and focusing it would
    otherwise fight the scrollIntoView we run against the highlighted target below.
  */
  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  // Esc is not wired up for us: manual popovers do not close on Esc, by design.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Switch tabs for the step, and fire its live call. Keyed on the step id so re-renders
  // inside a step (there are many - every token of the streamed answer) do not re-fire it.
  useEffect(() => {
    if (!open || !step) return;
    if (step.tab && !isLocked) onRequestTab(step.tab);
    if (step.action && !isLocked) onRunAction(step.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step?.id]);

  /*
    Tether to the step's target.

    Re-resolved on a timer rather than once, for two reasons.

    First, most targets do not exist yet when the step opens: a step that fires a gateway
    call is pointing at telemetry still in flight, and the inspector cards only mount once
    a response has landed.

    Second, and less obviously, React rewrites `className` on re-render from its own
    props. Any class we added imperatively is wiped the moment the target re-renders for
    an unrelated reason - which the nav tabs do on every tab change - so the marking has
    to be re-asserted, not just set once.
  */
  useEffect(() => {
    if (!open || !step) return;
    let current: HTMLElement | null = null;

    const attach = (el: HTMLElement | null) => {
      if (current && current !== el) {
        current.style.removeProperty('anchor-name');
        current.classList.remove('tour-highlight');
      }
      const isNewTarget = el !== current;
      current = el;
      setAnchored(!!el);
      if (!el) return;

      // Idempotent: only touches the DOM when something has actually dropped off.
      if (el.style.getPropertyValue('anchor-name') !== ANCHOR_NAME) {
        el.style.setProperty('anchor-name', ANCHOR_NAME);
      }
      if (!el.classList.contains('tour-highlight')) {
        el.classList.add('tour-highlight');
      }
      // Only chase the target when it is new, or the page would scroll continuously.
      if (isNewTarget) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const resolve = () => {
      if (!step.target || isLocked) {
        attach(null);
        return;
      }
      attach(document.querySelector<HTMLElement>(`[data-tour-id="${step.target}"]`));
    };

    resolve();
    const timer = window.setInterval(resolve, 300);
    return () => {
      window.clearInterval(timer);
      attach(null);
    };
  }, [open, step, isLocked]);

  if (!open || !step) return null;

  const copy = tourCopy(step, speaker);

  return (
    <div
      ref={popoverRef}
      id="tour-step"
      role="dialog"
      aria-labelledby="tour-step-title"
      data-anchored={anchored ? 'true' : 'false'}
      // `popover` is not in @types/react 18. React passes unknown lowercase attributes
      // straight through to the DOM, so the cast is a typing concession, not a hack.
      {...({ popover: 'manual' } as Record<string, string>)}
    >
      <div className="tour-head">
        <span className="tour-progress">
          <Compass className="w-3 h-3" />
          Step {index + 1} of {TOUR_STEPS.length}
        </span>
        <button type="button" onClick={onClose} className="tour-close" aria-label="End the tour">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <h2 id="tour-step-title" className="tour-title">
        {copy.title}
      </h2>
      <p className="tour-body">{copy.body}</p>

      {isLocked ? (
        <p className="tour-locked">
          <Lock className="w-3 h-3" />
          {sp({
            technical: 'This admin screen is not available to your persona. Switch persona in Gateway Settings to follow along.',
            platform: 'This screen needs an admin role. Switch role in Gateway Settings to follow along.',
            finance: 'This screen is for admins only. Switch role in Gateway Settings to follow along.',
            ai_coe: 'This screen is for admins only. Switch role in Gateway Settings to follow along.',
            eng: 'Admin-only screen: your persona cannot open it. Switch persona in Gateway Settings to follow along.',
            analysts: 'This screen is for admins only. Switch persona in Gateway Settings to follow along.',
            support: 'This screen is for admins only. Switch persona in Gateway Settings to follow along.',
          })}
        </p>
      ) : (
        copy.note && <p className="tour-note">{copy.note}</p>
      )}

      <div className="tour-actions">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className="tour-btn tour-btn-ghost"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <button
          ref={primaryRef}
          type="button"
          onClick={() => (isLast ? onClose() : goTo(index + 1))}
          className="tour-btn tour-btn-primary"
        >
          {isLast ? 'Finish' : 'Next'}
          {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
