/**
 * BOSS MOTION (FEATURES.bossMotion, docs/FEATURES.md): the bodies move. Every path into this file starts with an
 * enabled block (`params.motion`), so nothing here runs, adds state or reads a row while it is off; nothing here draws
 * from the PRNG (targets and spots come from an integer hash of (seed, boss start, pick)).
 *
 * THE HOLD: a body never moves from the start of an attack (the Lich's teleport-out, every wind-up) until its launch,
 * nor while a beam, a deferred emission or a ring of the boss is alive. A telegraph fixed at the wind-up start (a
 * beam's start line, a lash's line, spawn points) therefore always matches the attack it announces.
 */
import type { BossMotion } from '../data/features';
import { TICK_RATE } from '../data/tuning';
import { orderHash } from './boss';
import type { SimParams } from './params';
import type { Boss, SimState } from './state';

/**
 * The `cycle` arguments of orderHash used by U3b (the boss order uses -1, the cycle permutation 0, 1, 2, ...): motion
 * and the new moves (FEATURES.bossMoves) each have their own family.
 */
export const HASH = { driftX: -2, driftY: -3, sinkX: -4, sinkY: -5, tollX: -6, tollY: -7, chain: -8, tollGap: -9, tollSign: -10 } as const;

/** A value in [0, 1) from the integer hash of (seed, boss start, salt, i). Integer math only until the division. */
export function hashUnit(s: SimState, b: Boss, salt: number, i: number): number {
  return orderHash((s.seed ^ Math.imul(b.start + 1, 0x27d4eb2d)) >>> 0, salt, i) / 4294967296;
}

/** A band: at least `inset` px inside the arena, no lower than `yMax`. */
export interface Band {
  readonly inset: number;
  readonly yMax: number;
}

/**
 * A spot in the band at least `minDist` from the hero (16 hashed candidates, the first that is far enough; else the
 * farthest of them). `saltX` / `saltY` pick the hash families of the two coordinates, `n` the pick.
 */
export function bandSpot(s: SimState, p: SimParams, b: Boss, band: Band, saltX: number, saltY: number, n: number, minDist: number): [number, number] {
  const x0 = p.x0 + band.inset;
  const x1 = p.x1 - band.inset;
  const y0 = p.y0 + band.inset;
  const y1 = Math.max(y0, Math.min(band.yMax, p.y1 - band.inset));
  const h = s.hero;
  let best: [number, number] = [x0, y0];
  let bd = -1;
  for (let k = 0; k < 16; k++) {
    const x = x0 + hashUnit(s, b, saltX, n * 16 + k) * (x1 - x0);
    const y = y0 + hashUnit(s, b, saltY, n * 16 + k) * (y1 - y0);
    const d2 = (x - h.x) * (x - h.x) + (y - h.y) * (y - h.y);
    if (d2 >= minDist * minDist) return [x, y];
    if (d2 > bd) {
      bd = d2;
      best = [x, y];
    }
  }
  return best;
}

/** Is the body held now? (An attack in progress, a beam or a deferred emission of the boss alive.) */
export const bodyHeld = (s: SimState, b: Boss): boolean => b.attack !== null || s.beams.length > 0 || !!(b.pending && b.pending.length);

/** The drift speed of a kind in px/s (0: it does not drift). A new boss's row exists only while it is enabled. */
function driftSpeed(m: BossMotion, b: Boss): number {
  switch (b.kind) {
    case 'eye':
      return m.eye.speed;
    case 'lich':
      return m.lich.speed;
    case 'thorn':
      return 0; // she stands; she relocates by sinking (relocation below)
    case 'toller':
      return m.toller.speed;
    default:
      return unknown(b.kind);
  }
}
function unknown(x: never): never {
  throw new Error(`motion: unknown boss ${String(x)}`);
}

/**
 * One motion tick (after the intro, while the boss fights): a drifting body moves `speed` px/s along a straight line
 * to its target; on arrival it picks the next one (in the band, >= minHeroDist from the hero now). A body outside the
 * band (the Lich after a teleport) simply drifts back in towards its target: never a jump.
 */
export function moveBoss(s: SimState, p: SimParams, b: Boss): void {
  const m = p.motion;
  if (!m) return;
  const speed = driftSpeed(m, b);
  if (speed <= 0 || bodyHeld(s, b)) return;
  const d = (b.drift ??= { tx: b.x, ty: b.y, n: 0 });
  const step = speed / TICK_RATE;
  const dx = d.tx - b.x;
  const dy = d.ty - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= step) {
    b.x = d.tx;
    b.y = d.ty;
    [d.tx, d.ty] = bandSpot(s, p, b, m, HASH.driftX, HASH.driftY, d.n++, m.minHeroDist);
    return;
  }
  b.x += (dx / dist) * step;
  b.y += (dy / dist) * step;
}

/** Thorn Mother: does the attack that starts now begin with a sink (every `relocateEvery`-th attack, never the first)? */
export function sinkDue(p: SimParams, b: Boss): boolean {
  const every = p.motion && b.kind === 'thorn' ? Math.round(p.motion.thorn.relocateEvery) : 0;
  return every > 0 && b.serial > 0 && b.serial % every === 0;
}

/** Thorn Mother: where she emerges (a band spot >= emergeMinHeroDist from the hero at the moment she is sunk). */
export function emergeSpot(s: SimState, p: SimParams, b: Boss): [number, number] {
  const m = p.motion!;
  return bandSpot(s, p, b, m, HASH.sinkX, HASH.sinkY, b.serial, m.thorn.emergeMinHeroDist);
}
