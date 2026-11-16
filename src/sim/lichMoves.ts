/**
 * THE LICH'S NEW MOVES (FEATURES.bossMoves.lich, docs/FEATURES.md): SOULFIRE (a violet orb spiral from its body) and
 * GRASP (bone hands bursting into red blade rings with one gap). Every path into this file starts with an enabled
 * block (`params.moves`): the Lich's table offers these patterns only then. No PRNG draw: every choice here is an
 * integer hash (bossMotion.ts `hashUnit`). No new projectile kinds; one attack = one segment (the later emissions wait
 * in `boss.pending` with the same serial, and the defeat waits for the queue).
 */
import type { LichMoves } from '../data/features';
import { HASH, hashUnit } from './bossMotion';
import { rotate } from './dmath';
import { ticks, type SimParams } from './params';
import type { Spawn } from './boss';
import { aimAt, gappedRing, readableGap, shot } from './newBosses';
import type { Boss, BossAttack, BossEmission, SimState } from './state';

const rows = (p: SimParams): LichMoves => {
  if (!p.moves) throw new Error('boss: the lich moves are not enabled');
  return p.moves.lich;
};
const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const scaled = (p: SimParams, base: number, max: number): number => Math.max(1, Math.min(max, Math.round(base * p.density)));

/** The Lich's new patterns (after its old ones: the old weights and the one PRNG draw of the pick are unchanged). */
export function lichMoveTable(p: SimParams): ['soulfire' | 'grasp', number][] {
  const m = rows(p);
  return [['soulfire', m.soulfire.weight], ['grasp', m.grasp.weight]];
}

/** The wind-up of a new move (the grasp's hands stay lit for at least telegraphSeconds). */
export const lichMoveWindup = (p: SimParams, pattern: 'soulfire' | 'grasp', wind: number): number =>
  pattern === 'grasp' ? Math.max(wind, ticks(rows(p).grasp.telegraphSeconds)) : wind;

/**
 * The grasp's hands, fixed when the wind-up starts: hashed spots inside the arena (edgeInset), >= minHeroDist from the
 * hero and spacingPx apart (16 candidates each; a hand with no free spot is left out), with a hashed gap offset each.
 */
export function prepareGrasp(s: SimState, p: SimParams, b: Boss, a: BossAttack): void {
  const c = rows(p).grasp;
  const n = scaled(p, c.count, c.maxCount);
  const min2 = c.minHeroDist * c.minHeroDist;
  const gap2 = c.spacingPx * c.spacingPx;
  const x0 = p.x0 + c.edgeInset;
  const y0 = p.y0 + c.edgeInset;
  const w = p.x1 - c.edgeInset - x0;
  const hgt = p.y1 - c.edgeInset - y0;
  const key = (b.serial + 1) * 64;
  a.offs = [];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 16; k++) {
      const x = x0 + hashUnit(s, b, HASH.graspX, key + i * 16 + k) * w;
      const y = y0 + hashUnit(s, b, HASH.graspY, key + i * 16 + k) * hgt;
      if (d2(x, y, s.hero.x, s.hero.y) < min2 || a.points.some(([px, py]) => d2(px, py, x, y) < gap2)) continue;
      a.points.push([x, y]);
      a.offs.push((2 * hashUnit(s, b, HASH.graspGap, key + i) - 1) * c.gapAimRad);
      break;
    }
}

/** Launch a new move (boss.ts already removed its one segment and set b.serial). */
export function launchLichMove(s: SimState, p: SimParams, b: Boss, a: BossAttack, pattern: 'soulfire' | 'grasp', spawn: Spawn): void {
  const serial = b.serial;
  const pend = (b.pending ??= []);
  if (pattern === 'soulfire') {
    const c = rows(p).soulfire;
    const n = scaled(p, c.count, c.maxCount);
    const step = Math.max(c.gapRad, (c.turns * 2 * 3.141592653589793) / n) * (hashUnit(s, b, HASH.soulSign, serial) < 0.5 ? -1 : 1);
    const [ax, ay] = aimAt(s, b.x, b.y);
    // the first orb flies at the hero, turned by a hashed half step at most
    const [fx, fy] = rotate(ax, ay, (hashUnit(s, b, HASH.soulAim, serial) - 0.5) * step);
    const dur = ticks(c.durationSeconds);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = rotate(fx, fy, k * step);
      const e: BossEmission = { op: 'soul', at: s.tick + (n === 1 ? 0 : Math.round((k * dur) / (n - 1))), serial, x: b.x, y: b.y, dirX: dx, dirY: dy, tele: a.windStart };
      if (k === 0) emitLich(s, p, b, e, spawn);
      else pend.push(e);
    }
    return;
  }
  const c = rows(p).grasp;
  const stagger = Math.max(1, ticks(c.staggerSeconds));
  a.points.forEach(([x, y], i) => {
    const e: BossEmission = { op: 'grasp', at: s.tick + i * stagger, serial, x, y, off: a.offs?.[i] ?? 0, tele: a.windStart };
    if (i === 0) emitLich(s, p, b, e, spawn);
    else pend.push(e);
  });
}

/** Fire one deferred emission of a new move now. */
export function emitLich(s: SimState, p: SimParams, b: Boss, e: Extract<BossEmission, { op: 'soul' | 'grasp' }>, spawn: Spawn): void {
  const tele = s.tick - e.tele;
  if (e.op === 'soul') {
    const v = p.smallSpeed * b.speed * rows(p).soulfire.speedFactor;
    shot(s, p, spawn, e.serial, tele, 'orb_small', e.x + e.dirX * 8, e.y + e.dirY * 8, e.dirX * v, e.dirY * v, false);
    return;
  }
  const c = rows(p).grasp;
  const n = Math.max(1, Math.round(c.blades));
  const [hx, hy] = aimAt(s, e.x, e.y);
  const [gx, gy] = rotate(hx, hy, e.off);
  const v = p.bladeSpeed * b.speed * c.speedFactor;
  // the hand was a lit ground cue for the whole wind-up: its blades may start where it stood (like a bloom)
  for (const [dx, dy] of gappedRing(n, gx, gy, readableGap(n, c.gapRad))) shot(s, p, spawn, e.serial, tele, 'blade', e.x + dx * 4, e.y + dy * 4, dx * v, dy * v, false, true);
  s.events.push({ type: 'boss_grasp', x: e.x, y: e.y });
}
