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
  /**
   * Bosses (CLAUDE.md "Bosses"): every `everyNthWave`-th wave is replaced by a boss, alternating Eye Sentinel and Lich
   * Mage. Boss HP = number of attacks (`segments`, 10-15): each launched attack removes exactly one segment. The boss is
   * defeated when the bar is empty AND its final attack's projectiles/beam are gone. Counts scale with the difficulty
   * density (rounded) but never exceed the minimum-gap limit; speeds use the difficulty speed, +encounterSpeedStep per
   * later encounter with the same boss (cap encounterSpeedCap). Boss bodies never collide and never kill.
   */
  bosses: {
    everyNthWave: 4,
    introSeconds: 2.0,
    breakSeconds: 2.0,
    deathSeconds: 1.0,
    killScore: 1000,
    /** Extra segments removed when a boss projectile is parried (reflected). 0 = off (CLAUDE.md default). */
    reflectBonusSegments: 0 as number,
    encounterSpeedStep: 0.05,
    encounterSpeedCap: 0.2,
    /** Minimum angle between neighbouring projectiles of a ring or fan (keeps a gap after density scaling). */
    minGapRad: 0.3,
    /** No pickup spawns while the boss has this many segments or fewer left. */
    pickupBlockSegments: 3,
    eye: {
      segments: 12,
      x: 240,
      y: 62,
      cadenceSeconds: 2.0,
      windupSeconds: 0.5,
      ring: { weight: 3, count: 12, speed: 52, spinRad: 0.21, curveRadPerSecond: 0.25 },
      /** Unparryable rotating beam: thin-line telegraph, then sweeps sweepDeg at degPerSecond (<= 60) and ends. */
      beam: { weight: 2, windupSeconds: 0.7, degPerSecond: 50, sweepDeg: 80, halfWidth: 2, length: 440, offsetMinPx: 18, offsetMaxPx: 34 },
      spawns: { weight: 2, count: 4, maxCount: 6, minHeroDist: 80, edgeInset: 20, spread: 0.12 },
    },
    lich: {
      segments: 12,
      cadenceSeconds: 2.0,
      windupSeconds: 0.4,
      teleportOutSeconds: 0.3,
      teleportInSeconds: 0.3,
      /** Never teleports within this distance of the hero. */
      minHeroDist: 80,
      fan: { weight: 3, count: 5, arc: 1.0 },
      wraiths: { weight: 2, count: 2, maxCount: 3 },
      triple: { weight: 2, spacingPx: 9 },
    },
  },
  /** Boss drop: each ember charge lengthens the parry active window for the rest of the run (stacking, capped). */
  emberCharge: { stepSeconds: 0.02, capSeconds: 0.08 },
  /**
   * Pickups: at most one on the map, seeded spawn points (>= minHeroDist from the hero, >= edgeInset inside the arena,
   * outside the portal clear radius and prop anchors), walk-over collection within `radius`. Taking the same kind again
   * refreshes its timer (no stacking). Slow Time slows projectiles only (beams and timers keep their pace). Double Score
   * doubles survival and parry points (never the boss kill bonus).
   */
  pickups: {
    firstSeconds: 20,
    intervalMinSeconds: 22,
    intervalMaxSeconds: 34,
    lifeSeconds: 12,
    radius: 8,
    minHeroDist: 40,
    edgeInset: 24,
    propClear: 10,
    points: 50,
    slowTime: { weight: 1, seconds: 6, factor: 0.5 },
    doubleScore: { weight: 1, seconds: 10, factor: 2 },
  },
  difficulty: {
    easy: { speed: 0.8, density: 0.7 },
    medium: { speed: 1.0, density: 1.0 },
    hard: { speed: 1.25, density: 1.4 },
  } satisfies Record<Difficulty, { speed: number; density: number }>,
} as const;
