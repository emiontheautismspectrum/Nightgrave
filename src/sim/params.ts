import { TICK_RATE, TUNING, type Difficulty } from '../data/tuning';

/** Tuning converted to tick units for one run. Derived purely from TUNING + difficulty. */
export interface SimParams {
  difficulty: Difficulty;
  arenaW: number;
  arenaH: number;
  heroMargin: number;
  despawnMargin: number;
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
  smallRadius: number;
  smallSpeed: number; // px per tick, difficulty applied
  largeRadius: number;
  largeSpeed: number;
  largeChance: number;
  spread: number;
  graceTicks: number;
  startInterval: number; // ticks between spawns, density applied
  minInterval: number;
  rampTicks: number;
}

export const ticks = (seconds: number): number => Math.max(1, Math.round(seconds * TICK_RATE));
const hundredths = (v: number): number => Math.round(v * 100);

export function makeParams(difficulty: Difficulty): SimParams {
  const T = TUNING;
  const d = T.difficulty[difficulty];
  const dashTicks = ticks(T.dash.durationSeconds);
  return {
    difficulty,
    arenaW: T.arena.width,
    arenaH: T.arena.height,
    heroMargin: T.arena.heroMargin,
    despawnMargin: T.arena.despawnMargin,
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
    smallRadius: T.orbs.small.radius,
    smallSpeed: (T.orbs.small.speed * d.speed) / TICK_RATE,
    largeRadius: T.orbs.large.radius,
    largeSpeed: (T.orbs.large.speed * d.speed) / TICK_RATE,
    largeChance: T.orbs.largeChance,
    spread: T.orbs.spread,
    graceTicks: ticks(T.spawner.graceSeconds),
    startInterval: (T.spawner.startIntervalSeconds * TICK_RATE) / d.density,
    minInterval: (T.spawner.minIntervalSeconds * TICK_RATE) / d.density,
    rampTicks: ticks(T.spawner.rampSeconds),
  };
}
