/**
 * Fixed-timestep driver for one run (render side, no Phaser): accumulates frame time, steps the sim at 60 Hz and
 * freezes it while paused. While paused no tick runs and no input is sampled or logged, so pausing can never change
 * the replay or the score. Pause has several independent reasons (menu, hidden tab, focus loss, rotation, first-run card).
 */
import { TICK_RATE } from '../data/tuning';
import type { InputFrame } from '../sim/input';
import type { Sim } from '../sim/sim';

export const STEP_MS = 1000 / TICK_RATE;
export const MAX_STEPS_PER_FRAME = 5;
/** Restart input is ignored for this long after death (the press held at death must not skip the panel). */
export const RESTART_GUARD_MS = 250;

export type PauseReason = 'menu' | 'hidden' | 'blur' | 'rotate' | 'hint';

export const canRestart = (nowMs: number, deadAtMs: number): boolean => nowMs - deadAtMs >= RESTART_GUARD_MS;

export class RunDriver {
  private acc = 0;
  private reasons = new Set<PauseReason>();

  constructor(readonly sim: Sim) {}

  get paused(): boolean {
    return this.reasons.size > 0;
  }
  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }
  pause(r: PauseReason): void {
    this.reasons.add(r);
    this.acc = 0;
  }
  /** Returns true if the run is now unpaused. */
  resume(r: PauseReason): boolean {
    this.reasons.delete(r);
    this.acc = 0; // never "catch up" the time spent paused
    return !this.paused;
  }

  /** Advance by one rendered frame. `sample` is called once per simulated tick only. Returns ticks stepped. */
  advance(deltaMs: number, sample: () => InputFrame, onTick?: () => void): number {
    if (this.paused || !this.sim.state.alive) return 0;
    this.acc = Math.min(this.acc + Math.max(0, deltaMs), STEP_MS * MAX_STEPS_PER_FRAME);
    let n = 0;
    while (this.acc >= STEP_MS && this.sim.state.alive) {
      this.acc -= STEP_MS;
      this.sim.step(sample());
      onTick?.();
      n++;
    }
    return n;
  }
}

/** A phone in portrait plays with the zoomed camera (landscape keeps the full arena). */
export const isPortraitView = (w: number, h: number, touch: boolean): boolean => touch && h > w;
