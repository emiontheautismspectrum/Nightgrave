/**
 * Input-layer settings (render side). NOT part of TUNING: they never reach the sim directly; they only shape the
 * per-tick cursor BEFORE it is recorded, so replays and the verifier stay exact.
 */
export type TouchSmoothing = 'off' | 'low' | 'high';
/** Touch movement: a FIXED on-screen joystick (default) or the relative drag trackpad. */
export type TouchControls = 'stick' | 'drag';

/**
 * The fixed virtual joystick (touch, Stick mode). Sizes in CSS px. Its output is the plain axis input (-100..100, the
 * same frames as keys / a gamepad stick): no smoothing, no sensitivity.
 */
export const STICK = {
  /** Base ring diameter: the portrait control strip, and the landscape side margin (shrunk to `landscapeMin` if the
   * margin cannot hold `landscape`; it may then reach a few px over the arena's bottom corner, drawn translucent). */
  portrait: 120,
  landscape: 100,
  landscapeMin: 88,
  knob: 56,
  /** A touch that starts within the base circle plus this grabs the stick. */
  zonePad: 20,
  /** Share of the radius that is dead; the output then starts from 0 at the dead-zone edge. */
  deadZone: 0.12,
};

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
