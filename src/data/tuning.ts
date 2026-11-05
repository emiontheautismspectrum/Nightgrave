/**
 * Every gameplay number lives here. Times are in seconds, distances in internal pixels,
 * speeds in pixels per second. The simulation converts them to ticks at TICK_RATE.
 */
export const TICK_RATE = 60;

export type Difficulty = 'easy' | 'medium' | 'hard';

export const TUNING = {
  /**
   * Playable rectangle (x0..x1, y0..y1) of the 480x270 screen; must match the art (arena_layout.json, test-enforced).
   * The hero's centre is clamped `heroInset` px inside it. Edge spawns appear `spawnOffset` px outside the rectangle;
   * projectiles are removed `despawnMargin` px outside it.
   */
  arena: { x0: 48, y0: 27, x1: 432, y1: 243, centerX: 240, centerY: 135, heroInset: 4, spawnOffset: 10, despawnMargin: 24 },
  hero: { speed: 150, radius: 3 },
  /**
   * cooldownSeconds applies after a parry that destroyed something; a whiff (hit nothing) costs
   * whiffCooldownSeconds. Without the whiff penalty a fixed-rhythm parry in place is unbeatable:
   * orbs cannot cross the pulse-to-body gap during the short off-window.
   */
  parry: { radius: 28, activeSeconds: 0.15, cooldownSeconds: 0.4, whiffCooldownSeconds: 1.0, bufferSeconds: 0.1 },
  dash: { distance: 80, durationSeconds: 0.2, invulnSeconds: 0.2, cooldownSeconds: 3, bufferSeconds: 0.1 },
  /** Multiplier is stored as integer hundredths inside the sim (100 = x1.00). */
  multiplier: { start: 1, step: 0.25, cap: 5, resetSeconds: 5 },
  /**
   * A successful parry = one pulse that destroyed something. The first projectile of a pulse scores
   * parryBase x multiplier; every extra one in the same pulse scores extraKillPoints x multiplier.
   * The multiplier steps once per successful pulse (a 16-shard ring is not 16 parries).
   */
  score: { survivalPerSecond: 10, parryBase: 25, extraKillPoints: 5 },
  orbs: {
    small: { radius: 2.5, speed: 75 },
    large: { radius: 4.5, speed: 55 },
    /** Max aim error in radians, uniform in [-spread, +spread]. */
    spread: 0.3,
  },
  runeShard: { radius: 3, speed: 62 },
  /** Unparryable. Curves slightly: up to curveRadPerSecond of turn, sign chosen per blade. */
  blade: { radius: 5, speed: 80, spread: 0.25, curveRadPerSecond: 0.35 },
  /** Slow homing shadow, parryable; after lifeSeconds it fades (harmless) for fadeSeconds, then is gone. */
  wraith: { radius: 5, speed: 30, steer: 0.05, lifeSeconds: 7, fadeSeconds: 0.5 },
  /**
   * Fairness: nothing may appear closer than minSpawnDistance to the hero unless it was telegraphed
   * for at least minTelegraphSeconds (rune bursts are; edge spawns pick a far point instead).
   */
  fairness: { minSpawnDistance: 60, minTelegraphSeconds: 0.25 },
  /** A wave every `seconds`. Per wave: +speedStep speed and +densityStep density, capped. */
  waves: { seconds: 15, graceSeconds: 1, speedStep: 0.05, densityStep: 0.06, speedCap: 1.6, densityCap: 2.2 },
  /** Single aimed small orbs trickling in between set pieces (interval is divided by density). */
  stream: { intervalSeconds: 1.1, largeChance: 0.15 },
  /** Set pieces. Gap between them is uniform in [gapMin, gapMax] seconds, divided by density. */
  patterns: {
    gapMinSeconds: 1.6,
    gapMaxSeconds: 3.0,
    orbFan: { weight: 3, unlockWave: 0, count: 3, countPerWave: 0.34, maxCount: 7, arc: 0.7 },
    runeBurst: { weight: 2, unlockWave: 0, telegraphSeconds: 0.6, shards: 10, shardsPerWave: 1, maxShards: 16 },
    blades: { weight: 2, unlockWave: 1, count: 1, countPerWave: 0.34, maxCount: 4 },
    wraiths: { weight: 1.5, unlockWave: 2, count: 1, countPerWave: 0.25, maxCount: 3 },
    heavyOrbs: { weight: 1, unlockWave: 1, count: 2, countPerWave: 0.2, maxCount: 4 },
    /** Casters (see `casters`): a shade rises at the portal altar, a stalker steps out of a forest hollow. */
    shade: { weight: 2, unlockWave: 0 },
    stalker: { weight: 2.5, unlockWave: 1 },
  },
  /**
   * Casters are emitters only (never hittable or lethal). Phases: telegraph (portal ignite / eyes) -> rise/emerge ->
   * idle (seeded casterIdleMin..Max) -> cast wind-up (>= 15 ticks) -> ONE attack -> dissolve.
   */
  casters: {
    maxActive: 2,
    telegraphSeconds: 0.4,
    riseSeconds: 0.5,
    casterIdleMinSeconds: 1.0,
    casterIdleMaxSeconds: 3.0,
    castSeconds: 0.3,
    dissolveSeconds: 0.4,
    /** The stalker stands this far inside the arena from its hollow. */
    hollowInset: 8,
    shardFan: { count: 6, arc: 1.2 },
  },
  difficulty: {
    easy: { speed: 0.8, density: 0.7 },
    medium: { speed: 1.0, density: 1.0 },
    hard: { speed: 1.25, density: 1.4 },
  } satisfies Record<Difficulty, { speed: number; density: number }>,
} as const;
