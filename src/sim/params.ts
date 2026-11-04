import { TICK_RATE, TUNING, type Difficulty } from '../data/tuning';

/** Tuning converted to tick units for one run. Derived purely from TUNING + difficulty. */
export interface SimParams {
  difficulty: Difficulty;
  cx: number;
  cy: number;
  playRadius: number;
  spawnRadius: number;
  despawnRadius: number;
  heroSpeed: number; // px per tick
  heroRadius: number;
  parryRadius: number;
  parryActive: number; // ticks
  parryCooldown: number; // ticks, measured from activation, after a parry that hit
  parryWhiffCooldown: number; // ticks, measured from activation, after a parry that hit nothing
  parryBuffer: number; // ticks a press waits for the cooldown
  dashSpeed: number; // px per tick
  dashTicks: number;
  dashInvuln: number;
  dashCooldown: number; // ticks, measured from dash start
  dashBuffer: number;
  multStart: number; // hundredths
  multStep: number;
  multCap: number;
  multReset: number; // ticks
  survivalPerSecond: number;
  parryBase: number;
  extraKillPoints: number;
  smallRadius: number;
  smallSpeed: number; // px per tick, difficulty applied (wave multiplier applied at spawn)
  largeRadius: number;
  largeSpeed: number;
  spread: number;
  shardRadius: number;
  shardSpeed: number;
  bladeRadius: number;
  bladeSpeed: number;
  bladeSpread: number;
  bladeCurve: number; // rad per tick
  wraithRadius: number;
  wraithSpeed: number;
  wraithSteer: number;
  wraithLife: number; // ticks
  wraithFade: number;
  fairDistance: number;
  fairTelegraph: number; // ticks
  graceTicks: number;
  waveTicks: number;
  speedStep: number;
  densityStep: number;
  speedCap: number;
  densityCap: number;
  /** Difficulty density multiplier (more spawns = shorter intervals). */
  density: number;
  streamInterval: number; // ticks at density 1
  streamLargeChance: number;
  gapMin: number; // ticks at density 1
  gapMax: number;
  runeTelegraph: number; // ticks
  patterns: typeof TUNING.patterns;
}

export const ticks = (seconds: number): number => Math.max(1, Math.round(seconds * TICK_RATE));
const hundredths = (v: number): number => Math.round(v * 100);

export function makeParams(difficulty: Difficulty): SimParams {
  const T = TUNING;
  const d = T.difficulty[difficulty];
  const dashTicks = ticks(T.dash.durationSeconds);
  return {
    difficulty,
    cx: T.arena.centerX,
    cy: T.arena.centerY,
    playRadius: T.arena.playRadius,
    spawnRadius: T.arena.spawnRadius,
    despawnRadius: T.arena.despawnRadius,
    heroSpeed: T.hero.speed / TICK_RATE,
    heroRadius: T.hero.radius,
    parryRadius: T.parry.radius,
    parryActive: ticks(T.parry.activeSeconds),
    parryCooldown: ticks(T.parry.cooldownSeconds),
    parryWhiffCooldown: ticks(T.parry.whiffCooldownSeconds),
    parryBuffer: ticks(T.parry.bufferSeconds),
    dashSpeed: T.dash.distance / dashTicks,
    dashTicks,
    dashInvuln: ticks(T.dash.invulnSeconds),
    dashCooldown: ticks(T.dash.cooldownSeconds),
    dashBuffer: ticks(T.dash.bufferSeconds),
    multStart: hundredths(T.multiplier.start),
    multStep: hundredths(T.multiplier.step),
    multCap: hundredths(T.multiplier.cap),
    multReset: ticks(T.multiplier.resetSeconds),
    survivalPerSecond: T.score.survivalPerSecond,
    parryBase: T.score.parryBase,
    extraKillPoints: T.score.extraKillPoints,
    smallRadius: T.orbs.small.radius,
    smallSpeed: (T.orbs.small.speed * d.speed) / TICK_RATE,
    largeRadius: T.orbs.large.radius,
    largeSpeed: (T.orbs.large.speed * d.speed) / TICK_RATE,
    spread: T.orbs.spread,
    shardRadius: T.runeShard.radius,
    shardSpeed: (T.runeShard.speed * d.speed) / TICK_RATE,
    bladeRadius: T.blade.radius,
    bladeSpeed: (T.blade.speed * d.speed) / TICK_RATE,
    bladeSpread: T.blade.spread,
    bladeCurve: T.blade.curveRadPerSecond / TICK_RATE,
    wraithRadius: T.wraith.radius,
    wraithSpeed: (T.wraith.speed * d.speed) / TICK_RATE,
    wraithSteer: T.wraith.steer,
    wraithLife: ticks(T.wraith.lifeSeconds),
    wraithFade: ticks(T.wraith.fadeSeconds),
    fairDistance: T.fairness.minSpawnDistance,
    fairTelegraph: ticks(T.fairness.minTelegraphSeconds),
    graceTicks: ticks(T.waves.graceSeconds),
    waveTicks: ticks(T.waves.seconds),
    speedStep: T.waves.speedStep,
    densityStep: T.waves.densityStep,
    speedCap: T.waves.speedCap,
    densityCap: T.waves.densityCap,
    density: d.density,
    streamInterval: T.stream.intervalSeconds * TICK_RATE,
    streamLargeChance: T.stream.largeChance,
    gapMin: T.patterns.gapMinSeconds * TICK_RATE,
    gapMax: T.patterns.gapMaxSeconds * TICK_RATE,
    runeTelegraph: ticks(T.patterns.runeBurst.telegraphSeconds),
    patterns: T.patterns,
  };
}
