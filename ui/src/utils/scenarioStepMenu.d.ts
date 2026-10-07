export declare const STEP_MENU_WIDTH: number;
export declare const STEP_MENU_HOVER_DELAY_MS: number;
export declare const STEP_MENU_CLOSE_DELAY_MS: number;
export declare function stepMenuPosition(
  rect: { left: number; top: number },
  viewportWidth: number,
  viewportHeight: number,
  menuWidth?: number,
  gap?: number,
): { left: number; bottom: number };
export declare function nextStepIndex(step: number, count: number): number;
