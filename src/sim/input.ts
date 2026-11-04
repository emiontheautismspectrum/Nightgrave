/**
 * One input frame per simulation tick. Replays are (seed, difficulty, frames[]).
 *
 * - cursor === true:  (mx, my) is the cursor target in integer internal pixels.
 * - cursor === false: (mx, my) is a movement axis, integers in [-AXIS_MAX, AXIS_MAX].
 * - buttons: bitmask of buttons PRESSED on this tick (rising edges only; holding does nothing).
 */
export interface InputFrame {
  cursor: boolean;
  mx: number;
  my: number;
  buttons: number;
}

export const BTN_PARRY = 1;
export const BTN_DASH = 2;
export const BTN_MASK = BTN_PARRY | BTN_DASH;
export const AXIS_MAX = 100;
/** Cursor coordinates are clamped to this window around the arena (internal pixels). */
export const CURSOR_LIMIT = 4096;

export const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze({ cursor: false, mx: 0, my: 0, buttons: 0 });

function toInt(v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const t = Math.trunc(v) | 0; // | 0 also folds -0 into 0
  return t < lo ? lo : t > hi ? hi : t;
}

/**
 * Normalise an untrusted frame (live input, decoded replay, or server-side log) into canonical form.
 * The simulation only ever sees sanitized frames, so garbage can never produce NaN state.
 */
export function sanitizeInput(f: Partial<InputFrame> | null | undefined): InputFrame {
  if (!f || typeof f !== 'object') return { ...NEUTRAL_INPUT };
  const cursor = f.cursor === true;
  const lim = cursor ? CURSOR_LIMIT : AXIS_MAX;
  return {
    cursor,
    mx: toInt(f.mx, -lim, lim),
    my: toInt(f.my, -lim, lim),
    buttons: toInt(f.buttons, 0, BTN_MASK) & BTN_MASK,
  };
}
