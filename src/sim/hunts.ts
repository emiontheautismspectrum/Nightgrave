/**
 * HUNTS (package B1, docs/FEATURES.md): threats that make the player travel. Every path into this file starts with an
 * enabled block (`params.knot`), so nothing here runs, reads a block, adds state or draws from the PRNG while the
 * blocks are off.
 *
 * HEX KNOT (FEATURES.knot): a stationary hollow violet ring with fuse pips, far from the hero. Its body is harmless to
 * touch and a dash does not touch it. A pulse that covers it (THE parry zone, sim.ts) destroys it; otherwise it bursts
 * into rune shards when its fuse ends. Its life ends only at the burst or the parry.
 */
import type { HexKnot } from '../data/features';
import { isBossWave } from './boss';
import { dcos, dsin, PI } from './dmath';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Knot, Projectile, ProjectileKind, SimState } from './state';

/** The spawner (waves.spawnProjectile), injected to avoid an import cycle (as for the bosses and the pattern pack). */
export type HuntSpawn = (s: SimState, p: SimParams, kind: ProjectileKind, x: number, y: number, vx: number, vy: number, extra?: object, telegraphTicks?: number) => Projectile;

/** Rune shards of a burst start this far from the knot's centre (as the rune burst does). */
const SHARD_OFFSET = 4;
/** Placement tries for a new knot (seeded). */
const KNOT_TRIES = 8;

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** Ticks left in the current wave (the director's clock; the next wave starts when it reaches 0). */
const waveTicksLeft = (s: SimState, p: SimParams): number => p.waveTicks - (s.waveClock % p.waveTicks);

/** Would something that lasts `life` ticks from now still be alive `lead` ticks before the next wave, a boss wave? */
export const reachesBoss = (s: SimState, p: SimParams, life: number, lead: number): boolean =>
  isBossWave(p, s.wave + 1) && waveTicksLeft(s, p) < life + lead;

export const knotFuseTicks = (k: HexKnot): number => ticks(k.fuseSeconds);

/**
 * Create a hex knot now (the director picked the row). False: it could not (the cap, no free spot, or its fuse would
 * reach the boss wave); nothing was changed except, at most, PRNG draws. `sp` = the wave speed (shard speed).
 */
export function startKnot(s: SimState, p: SimParams, sp: number): boolean {
  const c = p.knot;
  if (!c) return false;
  const knots = (s.knots ??= []);
  if (knots.length >= c.maxActive) return false;
  const fuse = knotFuseTicks(c);
  if (reachesBoss(s, p, fuse, ticks(c.bossLeadSeconds))) return false;
  const min2 = c.minHeroDist * c.minHeroDist;
  const gap2 = c.spacingPx * c.spacingPx;
  for (let i = 0; i < KNOT_TRIES; i++) {
    const x = range(s, p.x0 + c.edgeInset, p.x1 - c.edgeInset);
    const y = range(s, p.y0 + c.edgeInset, p.y1 - c.edgeInset);
    if (d2(x, y, s.hero.x, s.hero.y) < min2) continue;
    if (knots.some((k) => d2(k.x, k.y, x, y) < gap2)) continue;
    const k: Knot = { id: s.nextId++, x, y, r: c.radius, start: s.tick, burst: s.tick + fuse, shards: Math.max(1, Math.round(c.shards)), speed: p.shardSpeed * sp, angle: nextFloat(s) * 2 * PI };
    knots.push(k);
    s.events.push({ type: 'knot', id: k.id, x, y });
    return true;
  }
  return false;
}

/** Once per tick, after the director: knots whose fuse has ended burst into their shard ring (in creation order). */
export function runKnots(s: SimState, p: SimParams, spawn: HuntSpawn): void {
  const knots = s.knots;
  if (!knots || !knots.length) return;
  const keep: Knot[] = [];
  for (const k of knots) {
    if (s.tick < k.burst) {
      keep.push(k);
      continue;
    }
    for (let i = 0; i < k.shards; i++) {
      const a = k.angle + (2 * PI * i) / k.shards;
      const dx = dcos(a);
      const dy = dsin(a);
      spawn(s, p, 'rune_shard', k.x + dx * SHARD_OFFSET, k.y + dy * SHARD_OFFSET, dx * k.speed, dy * k.speed, {}, s.tick - k.start);
    }
    s.events.push({ type: 'knot_end', id: k.id, x: k.x, y: k.y, how: 'burst' });
  }
  s.knots = keep;
}

/**
 * A boss wave starts. By the creation rule no knot can still be alive here; should one be (a rule change, a test
 * forcing it), it is removed WITHOUT a burst: nothing of the waves is ever left inside a boss intro.
 */
export function huntsAtBoss(s: SimState): void {
  if (s.knots && s.knots.length) {
    for (const k of s.knots) s.events.push({ type: 'knot_end', id: k.id, x: k.x, y: k.y, how: 'cancel' });
    s.knots = [];
  }
}
