// Chat scenario bar step picker helpers (ChatPlayground.tsx). Plain JS for unit tests.

export const STEP_MENU_WIDTH = 240;
export const STEP_MENU_HOVER_DELAY_MS = 600;
export const STEP_MENU_CLOSE_DELAY_MS = 200;

/**
 * Fixed position for the picker: just above the chip, left-aligned with it, and kept inside
 * the viewport horizontally. `rect` is the chip's getBoundingClientRect().
 */
export function stepMenuPosition(rect, viewportWidth, viewportHeight, menuWidth = STEP_MENU_WIDTH, gap = 6) {
  const left = Math.max(8, Math.min(rect.left, viewportWidth - menuWidth - 8));
  return { left, bottom: viewportHeight - rect.top + gap };
}

/** The step a plain chip click runs after `step` has run, for a chip with `count` steps. */
export function nextStepIndex(step, count) {
  return (step + 1) % count;
}
