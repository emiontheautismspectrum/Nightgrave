/**
 * HUNTS (package B1, docs/FEATURES.md): threats that make the player travel. Every path into this file starts with an
 * enabled block (`params.knot`), so nothing here runs, reads a block, adds state or draws from the PRNG while the
 * blocks are off.
 *
 * HEX KNOT (FEATURES.knot): a stationary hollow violet ring with fuse pips, far from the hero. Its body is harmless to
 * touch and a dash does not touch it. A pulse that covers it (THE parry zone, sim.ts) destroys it; otherwise it bursts
 * into rune shards when its fuse ends. Its life ends only at the burst or the parry.
 *
 * BRIAR LINE (FEATURES.briar): a `Wall`, a band of thorns across the arena with ONE gap, entering from the edge
 * farther from the hero after a telegraph and creeping across. Red: unparryable, lethal on touch; the dash i-frames
 * pass through it as through blades. O(1) collision per line per tick.
 */
import type { HexKnot } from '../data/features';
import { isBossWave } from './boss';
import { dcos, dsin, PI } from './dmath';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import { TICK_RATE } from '../data/tuning';
import type { Knot, Projectile, ProjectileKind, SimState, Wall } from './state';

/** The spawner (waves.spawnProjectile), injected to avoid an import cycle (as for the bosses and the pattern pack). */
export type HuntSpawn = (s: SimState, p: SimParams, kind: ProjectileKind, x: number, y: number, vx: number, vy: number, extra?: object, telegraphTicks?: number) => Projectile;

/** Rune shards of a burst start this far from the knot's centre (as the rune burst does). */
const SHARD_OFFSET = 4;
/** Placement tries for a new knot (seeded). */
const KNOT_TRIES = 8;

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/**
 * Ticks until the next wave starts, as seen by a pattern pick (the director has already counted this tick on its
 * clock): the clock on a whole wave means the next wave starts on the very next tick.
 */
export const waveTicksLeft = (s: SimState, p: SimParams): number => ((p.waveTicks - (s.waveClock % p.waveTicks)) % p.waveTicks) + 1;

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

// ------------------------------------------------------------------ briar line

/** Coordinates of a point along / across the line's axis of motion. */
const alongOf = (w: Pick<Wall, 'axis'>, x: number, y: number): number => (w.axis === 'x' ? x : y);
const acrossOf = (w: Pick<Wall, 'axis'>, x: number, y: number): number => (w.axis === 'x' ? y : x);

/** Does a circle of radius r at (x, y) overlap the corridor the gap sweeps (the whole length of its path)? */
export const inGapCorridor = (w: Wall, x: number, y: number, r: number): boolean => Math.abs(acrossOf(w, x, y) - w.gap) < w.gapHalf + r;

/**
 * The tick a line reaches a hero standing at (x, y) (its band touches the hero's circle), if nothing slows it. Used by
 * the gap rule, the tests and the renderer's gap marker.
 */
export function wallArrival(w: Wall, x: number, y: number, heroRadius: number): number {
  const dist = Math.abs(alongOf(w, x, y) - w.startPos) - (w.halfWidth + heroRadius);
  return w.move + Math.max(0, dist) / w.speed;
}

/** What a gapped wall needs from its row (the briar line's, or the Thorn Mother's hedge). */
export interface WallRow {
  readonly telegraphSeconds: number;
  readonly halfWidth: number;
  readonly gapPx: number;
  readonly reachFraction: number;
}

/**
 * Plan a wall (ONE draw: the axis). It enters from the edge farther from the hero, waits `telegraphSeconds` there and
 * creeps at `speed` px/tick. Returns the wall (gap and id not set yet) and its unslowed life in ticks.
 */
export function planWall(s: SimState, p: SimParams, c: WallRow, speed: number): { w: Wall; life: number } {
  const h = s.hero;
  const o = p.spawnOffset;
  const tele = Math.max(p.fairTelegraph, ticks(c.telegraphSeconds));
  const axis: Wall['axis'] = nextFloat(s) < 0.5 ? 'x' : 'y';
  const lo = axis === 'x' ? p.x0 : p.y0;
  const hi = axis === 'x' ? p.x1 : p.y1;
  const dir: Wall['dir'] = (axis === 'x' ? h.x > p.cx : h.y > p.cy) ? 1 : -1; // it enters from the farther edge
  const startPos = dir > 0 ? lo - o : hi + o;
  const endPos = dir > 0 ? hi + o : lo - o;
  const life = tele + Math.ceil(Math.abs(endPos - startPos) / speed);
  const w: Wall = { id: 0, axis, dir, pos: startPos, startPos, endPos, start: s.tick, move: s.tick + tele, speed, gap: 0, gapHalf: c.gapPx / 2, halfWidth: c.halfWidth };
  return { w, life };
}

/**
 * Place the gap of a planned wall (ONE draw) and put it on the field. The gap centre lies within reachFraction of the
 * distance the hero can WALK before the line arrives; never into a blood sigil, nor (`avoid`, a boss wall) through
 * the boss's body (three choices, else false: nothing is placed). `boss` = the attack serial of a boss-owned wall
 * (the key exists only then).
 */
export function placeWall(s: SimState, p: SimParams, w: Wall, c: WallRow, boss?: number, avoid?: { x: number; y: number; r: number }): boolean {
  const h = s.hero;
  const half = w.gapHalf;
  const axis = w.axis;
  const reach = c.reachFraction * p.heroSpeed * (wallArrival(w, h.x, h.y, p.heroRadius) - s.tick);
  const clo = axis === 'x' ? p.y0 : p.x0;
  const chi = axis === 'x' ? p.y1 : p.x1;
  const across = acrossOf(w, h.x, h.y);
  const clamp = (g: number): number => Math.min(chi - half, Math.max(clo + half, g));
  const off = range(s, -1, 1) * reach;
  for (const g of [clamp(across + off), clamp(across - off), clamp(across)]) {
    w.gap = g;
    if (s.sigils.some((sg) => inGapCorridor(w, sg.x, sg.y, sg.r))) continue; // never a gap into a blood sigil
    if (avoid && inGapCorridor(w, avoid.x, avoid.y, avoid.r)) continue; // a boss wall: never a gap through the boss
    w.id = s.nextId++;
    if (boss !== undefined) w.boss = boss;
    (s.walls ??= []).push(w);
    s.events.push({ type: 'briar', id: w.id, axis, dir: w.dir, gap: g, ...(boss !== undefined ? { boss } : {}) });
    return true;
  }
  return false;
}

/**
 * Start a briar line now (the director picked the row). False: it could not (the cap, a curtain on the field, the
 * boss lead, or every gap choice crosses a blood sigil); nothing was changed except, at most, PRNG draws.
 */
export function startBriar(s: SimState, p: SimParams, sp: number): boolean {
  const c = p.briar;
  if (!c) return false;
  const walls = (s.walls ??= []);
  if (walls.length >= c.maxActive) return false;
  // never two gapped walls at once: no line while a pattern-pack curtain is alive (and no curtain while a line is)
  if (s.projectiles.some((pr) => pr.pack === 'curtain')) return false;
  const speed = (c.speed * p.diffSpeed * sp) / TICK_RATE; // px per tick, like a projectile
  const { w, life } = planWall(s, p, c, speed);
  if (reachesBoss(s, p, life, ticks(c.bossLeadSeconds))) return false;
  return placeWall(s, p, w, c);
}

/** Move the lines (after the projectiles, by the same Slow Time factor `f`) and remove the ones that crossed. */
export function moveWalls(s: SimState, f: number): void {
  const walls = s.walls;
  if (!walls || !walls.length) return;
  const keep: Wall[] = [];
  for (const w of walls) {
    if (s.tick >= w.move) w.pos += w.dir * w.speed * f;
    if (w.dir > 0 ? w.pos < w.endPos : w.pos > w.endPos) keep.push(w);
    else s.events.push({ type: 'briar_end', id: w.id, how: 'crossed' });
  }
  s.walls = keep;
}

/** Is the hero touching a moving line outside its gap? (The id of that line, or 0.) Unparryable: only the dash i-frames help. */
export function wallHits(s: SimState, p: SimParams): number {
  const h = s.hero;
  for (const w of s.walls ?? []) {
    if (s.tick < w.move) continue; // the telegraph sits outside the arena
    if (Math.abs(alongOf(w, h.x, h.y) - w.pos) >= w.halfWidth + p.heroRadius) continue;
    if (Math.abs(acrossOf(w, h.x, h.y) - w.gap) <= w.gapHalf - p.heroRadius) continue; // inside the gap
    return w.id;
  }
  return 0;
}

/**
 * A boss wave starts. By the creation rules no knot and (unslowed) no line can still be alive here. A knot that is
 * (a rule change, a test forcing it) is removed WITHOUT a burst; a line that is (Slow Time stretched it) withers.
 * Nothing of the hunts is ever left inside a boss intro.
 */
export function huntsAtBoss(s: SimState): void {
  if (s.knots && s.knots.length) {
    for (const k of s.knots) s.events.push({ type: 'knot_end', id: k.id, x: k.x, y: k.y, how: 'cancel' });
    s.knots = [];
  }
  if (s.walls && s.walls.length) {
    for (const w of s.walls) s.events.push({ type: 'briar_end', id: w.id, how: 'withered' });
    s.walls = [];
  }
}
