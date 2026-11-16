/**
 * THE TOLLER'S NEW MOVES (FEATURES.bossMoves.toller, docs/FEATURES.md): the PEAL and the ECHO (a lethal `Ring`) and the
 * CHAINS (a `Chain` that binds the hero). Every path into this file starts with `tollerMoves(params)` (the block AND the
 * Toller enabled) or with state that exists only then (`s.rings`, `s.chain`), so nothing here runs, adds state or
 * reads a row while either is off. No PRNG draw: every choice here is an integer hash (bossMotion.ts `hashUnit`).
 *
 * THE RING is a full red circle: lethal where the hero's circle overlaps its band outside every gap; the dash
 * i-frames pass. Walking cannot pass it: the answers are the PARRY (a pulse covering the ring's point nearest the hero
 * cuts a gap there; the first cut of a ring pays one parry) and the DASH. While a ring will reach the hero within
 * `ring.holdSeconds`, or passed him less than `ring.passedSeconds` ago, no other attack of the boss launches or
 * starts its wind-up (boss.ts).
 *
 * THE CHAIN binds a hero who stays on its spot at the landing (no damage): IRON (the dash breaks it) or BREAK (fire
 * `breakParries` pulses; no dash meanwhile; the boss then launches only allowed, parryable patterns).
 */
import type { TollerMoves } from '../data/features';
import { TICK_RATE } from '../data/tuning';
import { bandSpot, HASH, hashUnit } from './bossMotion';
import { dcos, dsin } from './dmath';
import { ticks, tollerMoves, type SimParams } from './params';
import { NEVER, type Boss, type BossAttack, type BossPattern, type Chain, type Ring, type SimState } from './state';

const rows = (p: SimParams): TollerMoves => {
  const m = tollerMoves(p);
  if (!m) throw new Error('boss: the toller moves are not enabled');
  return m;
};

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/**
 * `earlierHazardsAlive`: a projectile, wall, beam or ring of an earlier attack is alive, or an emission of one is still
 * to come. The peal, the echo and the chains are never picked then (the hero answers one thing at a time).
 */
export const earlierHazardsAlive = (s: SimState, b: Boss): boolean =>
  s.projectiles.length > 0 || s.beams.length > 0 || !!(s.walls && s.walls.length) || !!(s.rings && s.rings.length) || !!(b.pending && b.pending.length);

/** The variant of the chains the attack with this serial casts (an integer hash of the serial, by the row weights). */
export function chainKind(s: SimState, p: SimParams, b: Boss, serial: number): Chain['kind'] {
  const c = rows(p).chains;
  const total = Math.max(0, c.ironWeight) + Math.max(0, c.breakWeight);
  return total > 0 && hashUnit(s, b, HASH.chain, serial) * total < Math.max(0, c.ironWeight) ? 'iron' : 'break';
}

const dashReady = (s: SimState, p: SimParams): boolean => s.tick - s.hero.dashStart >= p.dashCooldown;

/** A parry-break bind is on: the boss launches only the allowed (parryable) patterns. */
export const breakBound = (s: SimState): boolean => !!(s.chain && s.chain.bound && s.chain.kind === 'break');

/**
 * The Toller's table with the new moves (appended after the old patterns: the old weights and the one PRNG draw of the
 * pick are unchanged). The new moves never take the last segment; the peal and the echo need the hero >= minHeroDist
 * from the bell; the chains need no chain alive. While a BREAK bind lasts only the allowed patterns remain. A new
 * move is never STARTED while an earlier hazard is alive (`mustWait`: the Toller waits for a clear field).
 */
export function tollerMoveTable(s: SimState, p: SimParams, b: Boss, old: [BossPattern, number][]): [BossPattern, number][] {
  const m = rows(p);
  if (breakBound(s)) {
    const allow = m.chains.allow as readonly BossPattern[];
    const out = old.filter(([k]) => allow.includes(k));
    return out.length ? out : [['toll', 1]];
  }
  const out = [...old];
  if (b.remaining <= 1) return out;
  const d = dist(s.hero.x, s.hero.y, b.x, b.y);
  if (d >= m.peal.minHeroDist) out.push(['peal', m.peal.weight]);
  if (d >= m.echo.minHeroDist) out.push(['echo', m.echo.weight]);
  if (!s.chain) out.push(['chains', m.chains.weight]);
  return out;
}

export const isTollerMove = (k: BossPattern): k is 'peal' | 'echo' | 'chains' => k === 'peal' || k === 'echo' || k === 'chains';

/**
 * Must the drawn new move wait before it starts? While an earlier hazard is alive (the hero answers one thing at a
 * time). The Toller then waits on its beat with the move kept (no new draw) and starts it on the first beat the field
 * is clear (every hazard ends on its own: projectiles leave, a ring lives <= its life, a bind <= maxSeconds).
 */
export const mustWait = (s: SimState, _p: SimParams, b: Boss): boolean => earlierHazardsAlive(s, b);

/**
 * The move that really starts: an IRON chain is cast only while the hero's dash is ready (the escape must exist); when
 * it is not, a toll starts instead (no draw, never a wait: a held dash key could otherwise stall the fight forever).
 */
export const startableMove = (s: SimState, p: SimParams, b: Boss, k: 'peal' | 'echo' | 'chains'): BossPattern =>
  k === 'chains' && chainKind(s, p, b, b.serial + 1) === 'iron' && !dashReady(s, p) ? 'toll' : k;

/** A wind-up of `n` beats (>= 2 for a ring), never below 15 ticks. */
const beats = (n: number, beat: number, min: number): number => Math.max(15, Math.max(min, Math.round(n)) * beat);

/** Begin a new move: its wind-up (whole beats), the fallback toll's gap (hashed), or the chain's spot. */
export function beginTollerMove(s: SimState, p: SimParams, b: Boss, pattern: 'peal' | 'echo' | 'chains', beat: number): BossAttack {
  const m = rows(p);
  const t = s.tick;
  const a: BossAttack = { pattern, tpOut: t, tpIn: t, windStart: t, fire: t, dirX: 0, dirY: 0, sign: 1, points: [] };
  if (pattern === 'chains') {
    const c = m.chains;
    const wind = Math.ceil(Math.max(15, ticks(c.telegraphSeconds), Math.round(c.windupBeats) * beat) / beat) * beat;
    a.fire = t + wind;
    const kind = chainKind(s, p, b, b.serial + 1);
    // the spot: the hero's position now (always inside the arena: the hero is clamped into it)
    s.chain = { serial: b.serial + 1, kind, x: s.hero.x, y: s.hero.y, r: c.spotRadius, start: t, land: a.fire, bound: false, until: -1, left: 0 };
    s.events.push({ type: 'boss_chain', kind, x: s.hero.x, y: s.hero.y });
    return a;
  }
  a.fire = t + beats((pattern === 'peal' ? m.peal : m.echo).windupBeats, beat, 2);
  // the toll it becomes if the hero stands too close at the launch: its gap and turn, hashed (no PRNG draw)
  const tr = p.toller!.toll;
  a.offs = [(2 * hashUnit(s, b, HASH.tollGap, b.serial + 1) - 1) * tr.gapAimRad];
  a.sign = hashUnit(s, b, HASH.tollSign, b.serial + 1) < 0.5 ? -1 : 1;
  return a;
}

/** The distance from (x, y) to the farthest arena corner. */
const farCorner = (p: SimParams, x: number, y: number): number => Math.max(dist(x, y, p.x0, p.y0), dist(x, y, p.x1, p.y0), dist(x, y, p.x0, p.y1), dist(x, y, p.x1, p.y1));

/**
 * Launch a peal or an echo: the ring leaves the bell. False: the hero is within minHeroDist of the bell (the caller
 * launches a toll instead). The peal then teleports the Toller and hastens its next attacks.
 */
export function launchRing(s: SimState, p: SimParams, b: Boss, echo: boolean, serial: number): boolean {
  const m = rows(p);
  const r = echo ? m.echo : m.peal;
  if (dist(s.hero.x, s.hero.y, b.x, b.y) < r.minHeroDist) return false;
  const far = farCorner(p, b.x, b.y);
  let speed = (r.speed * p.diffSpeed * b.speed) / TICK_RATE;
  const ring: Ring = { id: s.nextId++, serial, echo, x: b.x, y: b.y, r: r.startRadius, startR: r.startRadius, maxR: 0, speed, back: 0, halfWidth: r.halfWidth, phase: 'grow', holdStart: -1, holdUntil: -1, gaps: [], paid: false, near: NEVER };
  if (echo) {
    const e = m.echo;
    ring.maxR = far + e.edgeMarginPx;
    // never slower than a whole life of maxLifeSeconds allows (out, the hold, back at returnFactor x the speed)
    const life = Math.max(1, ticks(e.maxLifeSeconds) - ticks(e.holdSeconds));
    speed = Math.max(speed, ((ring.maxR - ring.startR) * (1 + 1 / e.returnFactor)) / life);
    ring.speed = speed;
    ring.back = speed * e.returnFactor;
  } else {
    // a peal is gone once its band is past the farthest corner; it leaves the arena within maxLeaveSeconds
    ring.maxR = far + r.halfWidth + p.heroRadius;
    ring.speed = Math.max(speed, (ring.maxR - ring.startR) / ticks(m.peal.maxLeaveSeconds));
  }
  (s.rings ??= []).push(ring);
  s.events.push({ type: 'boss_ring', id: ring.id, echo });
  if (!echo) {
    const pl = m.peal;
    [b.x, b.y] = bandSpot(s, p, b, { inset: pl.teleportInset, yMax: pl.teleportYMax }, HASH.tollX, HASH.tollY, serial, pl.teleportMinHeroDist);
    s.events.push({ type: 'boss_teleport', x: b.x, y: b.y });
    b.hasten = Math.max(0, Math.round(pl.hastenCount));
  }
  return true;
}

/** The chain lands (the attack's launch): a hero inside the spot (not dashing; IRON: with the dash ready) is bound. */
export function landChain(s: SimState, p: SimParams): void {
  const c = s.chain;
  if (!c) return;
  const m = rows(p).chains;
  const h = s.hero;
  c.land = s.tick;
  const inside = dist(h.x, h.y, c.x, c.y) <= c.r;
  const dashing = s.tick - h.dashStart < p.dashTicks;
  if (inside && !dashing && (c.kind === 'break' || dashReady(s, p))) {
    c.bound = true;
    c.until = s.tick + ticks(c.kind === 'iron' ? m.ironSeconds : m.maxSeconds);
    c.left = Math.max(1, Math.round(m.breakParries));
    s.events.push({ type: 'chain_bind', kind: c.kind });
    return;
  }
  s.chain = null;
  s.events.push({ type: 'chain_miss' });
}

/** The chain is gone (and the hero free). */
export function freeChain(s: SimState, how: 'dash' | 'parries' | 'time' | 'boss'): void {
  s.chain = null;
  s.events.push({ type: 'chain_free', how });
}

/** Once per tick, before the hero moves: a bind ends at its time; any chain ends when its boss is gone or dying. */
export function runChain(s: SimState): void {
  const c = s.chain;
  if (!c) return;
  if (!s.boss || s.boss.deathTick >= 0 || s.boss.remaining <= 0) return freeChain(s, 'boss');
  if (c.bound && s.tick >= c.until) freeChain(s, 'time');
}

/** A gap of half-angle `half` (rad) centred on the unit direction (x, y). */
export const ringGap = (x: number, y: number, half: number): Ring['gaps'][number] => ({ x, y, cos: dcos(half), sin: dsin(half) });

/** Is a circle of radius `rad` at distance `d` (unit direction ux, uy from the centre) wholly inside a gap of the ring? */
export function inRingGap(ring: Ring, ux: number, uy: number, d: number, rad: number): boolean {
  const sinT = d > rad ? rad / d : 1;
  const cosT = Math.sqrt(1 - sinT * sinT);
  for (const g of ring.gaps) {
    if (sinT > g.sin) continue; // wider than the gap
    // angle(u, g) <= half - t  <=>  cos(angle) >= cos(half) cos(t) + sin(half) sin(t)
    if (ux * g.x + uy * g.y >= g.cos * cosT + g.sin * sinT) return true;
  }
  return false;
}

/** Is the hero touching a ring outside its gaps? (The ring's id, or 0.) O(1) per ring; unparryable to touch. */
export function ringHits(s: SimState, p: SimParams): number {
  const h = s.hero;
  for (const ring of s.rings ?? []) {
    const d = dist(h.x, h.y, ring.x, ring.y);
    if (Math.abs(d - ring.r) >= ring.halfWidth + p.heroRadius) continue;
    if (d > 1e-9 && inRingGap(ring, (h.x - ring.x) / d, (h.y - ring.y) / d, d, p.heroRadius)) continue;
    return ring.id;
  }
  return 0;
}

/** Move the rings (after the projectiles, by the same Slow Time factor `f`; the hold counts real ticks). */
export function moveRings(s: SimState, p: SimParams, f: number): void {
  const rings = s.rings;
  if (!rings || !rings.length) return;
  const t = s.tick;
  const h = s.hero;
  const keep: Ring[] = [];
  for (const ring of rings) {
    let gone = false;
    if (ring.phase === 'grow') {
      ring.r += ring.speed * f;
      if (ring.echo && ring.r >= ring.maxR) {
        ring.r = ring.maxR;
        ring.phase = 'hold';
        ring.holdStart = t;
        ring.holdUntil = t + ticks(rows(p).echo.holdSeconds);
      } else if (!ring.echo && ring.r >= ring.maxR) gone = true;
    } else if (ring.phase === 'hold') {
      if (t >= ring.holdUntil) ring.phase = 'back';
    } else {
      ring.r -= ring.back * f;
      if (ring.r <= ring.startR) gone = true;
    }
    if (gone) {
      s.events.push({ type: 'ring_end', id: ring.id });
      continue;
    }
    if (Math.abs(dist(h.x, h.y, ring.x, ring.y) - ring.r) < ring.halfWidth + p.heroRadius + 1) ring.near = t;
    keep.push(ring);
  }
  s.rings = keep;
}

/**
 * THE DEFERRAL: does a ring forbid a launch now? Yes while it will reach the hero's current distance within
 * `ring.holdSeconds` (unslowed: the earliest it can), or passed it less than `ring.passedSeconds` ago, also for the
 * returning pass of an echo.
 */
export function ringBlocks(s: SimState, p: SimParams): boolean {
  const m = rows(p).ring;
  const hold = ticks(m.holdSeconds);
  const t = s.tick;
  const h = s.hero;
  for (const ring of s.rings ?? []) {
    if (t - ring.near < ticks(m.passedSeconds)) return true;
    const d = dist(h.x, h.y, ring.x, ring.y);
    const reach = ring.halfWidth + p.heroRadius;
    // an echo out beyond the hero (past him outward, holding, or on its way back to him) keeps the field to itself
    if (ring.echo && rows(p).echo.ownsReturn && (ring.phase === 'grow' ? ring.r - reach > d : ring.r + reach >= d)) return true;
    let until: number;
    if (ring.phase === 'grow') {
      if (ring.r + reach < d) until = (d - reach - ring.r) / ring.speed;
      else if (ring.r - reach <= d) until = 0;
      else if (ring.echo) until = (ring.maxR - ring.r) / ring.speed + ticks(rows(p).echo.holdSeconds) + Math.max(0, ring.maxR - reach - d) / ring.back;
      else until = Infinity;
    } else if (ring.phase === 'hold') until = ring.holdUntil - t + Math.max(0, ring.r - reach - d) / ring.back;
    else until = ring.r - reach >= d ? (ring.r - reach - d) / ring.back : ring.r + reach >= d ? 0 : Infinity;
    if (until <= hold) return true;
  }
  return false;
}
