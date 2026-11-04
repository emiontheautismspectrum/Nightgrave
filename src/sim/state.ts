import type { Difficulty } from '../data/tuning';

/** Sentinel start tick meaning "never happened" (JSON-safe, unlike -Infinity). */
export const NEVER = -1_000_000_000;

export type ProjectileKind = 'orb_small' | 'orb_large';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  parryable: boolean;
  /** Tick on which it was spawned (render uses it for animation phase). */
  born: number;
}

export interface Hero {
  x: number;
  y: number;
  /** Last non-zero movement direction (unit vector); used for dash direction and facing. */
  dirX: number;
  dirY: number;
  facing: 1 | -1;
  /** Tick on which the current/last parry started (NEVER = long ago). Active while tick - parryStart < parryActive. */
  parryStart: number;
  /** A parry press is buffered until this tick (inclusive); -1 = none. */
  parryBufferedUntil: number;
  /** Tick on which the current/last dash started (NEVER = long ago). */
  dashStart: number;
  dashBufferedUntil: number;
  dashDirX: number;
  dashDirY: number;
}

export type SimEvent =
  | { type: 'parry_start' }
  | { type: 'parry_hit'; x: number; y: number; points: number; multiplier: number }
  | { type: 'dash_start'; dirX: number; dirY: number }
  | { type: 'spawn'; id: number }
  | { type: 'death'; x: number; y: number; by: number };

export interface SimState {
  seed: number;
  difficulty: Difficulty;
  /** Number of ticks simulated so far. */
  tick: number;
  rng: number;
  hero: Hero;
  projectiles: Projectile[];
  nextId: number;
  alive: boolean;
  /** Tick on which the hero died (-1 while alive). */
  deathTick: number;
  /** Ticks survived (stops at death). */
  survivalTicks: number;
  /** Parry score in hundredths of a point (integer: avoids float drift). */
  parryScoreHundredths: number;
  /** Multiplier in hundredths (100 = x1.00). */
  multiplier: number;
  /** Tick of the last successful parry (-1 = never). */
  lastParryTick: number;
  parryCount: number;
  /** Fractional spawn timer in ticks. */
  spawnTimer: number;
  /** Events emitted during the most recent tick only (render reads them). */
  events: SimEvent[];
}
