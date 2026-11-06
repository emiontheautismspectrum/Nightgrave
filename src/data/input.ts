/**
 * Input-layer settings (render side). NOT part of TUNING: they never reach the sim directly; they only shape the
 * per-tick cursor BEFORE it is recorded, so replays and the verifier stay exact.
 */
export type TouchSmoothing = 'off' | 'low' | 'high';

export const TOUCH_INPUT = {
  /**
   * Per-tick exponential low-pass of the touch virtual cursor: the recorded cursor moves this share of the way to the
   * finger's target every tick (1 = no smoothing).
   */
  smoothing: { off: 1, low: 0.45, high: 0.25 } satisfies Record<TouchSmoothing, number>,
  /** Finger jitter below this many game px is ignored (with smoothing on). */
  deadZonePx: 2,
  /** Default drag sensitivity (was 1.5; phone playtests found steering too abrupt). */
  defaultSensitivity: 1,
} as const;
