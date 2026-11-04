/**
 * Every gameplay number lives here. Times are in seconds, distances in internal pixels,
 * speeds in pixels per second. The simulation converts them to ticks at TICK_RATE.
 */
export const TICK_RATE = 60;

export type Difficulty = 'easy' | 'medium' | 'hard';

export const TUNING = {
  arena: { width: 480, height: 270, heroMargin: 8, despawnMargin: 24 },
  hero: { speed: 150, radius: 3 },
  parry: { radius: 28, activeSeconds: 0.15, cooldownSeconds: 0.4, bufferSeconds: 0.1 },
  dash: { distance: 80, durationSeconds: 0.2, invulnSeconds: 0.2, cooldownSeconds: 3, bufferSeconds: 0.1 },
  /** Multiplier is stored as integer hundredths inside the sim (100 = x1.00). */
  multiplier: { start: 1, step: 0.25, cap: 5, resetSeconds: 5 },
  score: { survivalPerSecond: 10, parryBase: 25 },
  orbs: {
    small: { radius: 2.5, speed: 75 },
    large: { radius: 4.5, speed: 55 },
    largeChance: 0.2,
    /** Max aim error in radians, uniform in [-spread, +spread]. */
    spread: 0.3,
  },
  /** Stage 1 placeholder spawner (waves arrive in Stage 2). */
  spawner: { graceSeconds: 1, startIntervalSeconds: 0.9, minIntervalSeconds: 0.3, rampSeconds: 90 },
  difficulty: {
    easy: { speed: 0.8, density: 0.7 },
    medium: { speed: 1.0, density: 1.0 },
    hard: { speed: 1.25, density: 1.4 },
  } satisfies Record<Difficulty, { speed: number; density: number }>,
} as const;
