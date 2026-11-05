/**
 * Bosses (CLAUDE.md "Bosses"). Pure, seeded, tick-based. A boss replaces every 4th wave; its HP is the number of attacks
 * it makes: each attack removes exactly one segment at the moment it is launched. The fight ends only when the bar is
 * empty AND the final attack's projectiles/beam are gone (no timer, no retreat). Bodies never collide or kill.
 */
import { HOLLOWS, PORTAL } from '../data/arena';
import { dcos, dsin, rotate } from './dmath';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Beam, Boss, BossAttack, BossKind, BossPattern, SimState } from './state';

/** Spawner callback (waves.spawnProjectile), injected to avoid an import cycle. */
export type Spawn = (
  s: SimState,
  p: SimParams,
  kind: 'orb_small' | 'orb_large' | 'wraith',
  x: number,
  y: number,
  vx: number,
  vy: number,
  extra: { homing?: number; expires?: number; fadeEnd?: number; turnC?: number; turnS?: number; boss?: number },
  telegraphTicks: number,
) => void;

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export const isBossWave = (p: SimParams, wave: number): boolean =>
  p.bosses.everyNthWave > 0 && (wave + 1) % p.bosses.everyNthWave === 0;
/** Boss kind for a boss wave: the n-th boss wave (0-based) alternates eye, lich, eye, ... */
export const bossKindFor = (p: SimParams, wave: number): BossKind =>
  (Math.floor((wave + 1) / p.bosses.everyNthWave) - 1) % 2 === 0 ? 'eye' : 'lich';

const clampSegments = (n: number): number => Math.max(10, Math.min(15, Math.round(n)));
/** Density-scaled count, capped so neighbours stay >= minGapRad apart over `arc` (a full ring: 2*pi). */
function scaledCount(p: SimParams, base: number, arc: number, ring: boolean, max = 64): number {
  const n = Math.max(1, Math.round(base * p.density));
  const gapCap = ring ? Math.floor(arc / p.bosses.minGapRad) : Math.floor(arc / p.bosses.minGapRad) + 1;
  return Math.max(1, Math.min(n, gapCap, max));
}

/** Lich teleport spots: the portal altar and the stalkers' standing points in front of each hollow. */
export function lichSpots(p: SimParams): [number, number][] {
  const k = p.hollowInset + 4;
  const out: [number, number][] = [[PORTAL.x, PORTAL.y]];
  for (const h of HOLLOWS)
    out.push([h.side === 'left' ? h.x + k : h.side === 'right' ? h.x - k : h.x, h.side === 'top' ? h.y + k : h.side === 'bottom' ? h.y - k : h.y]);
  return out;
}

export function startBoss(s: SimState, p: SimParams, wave: number): void {
  const kind = bossKindFor(p, wave);
  const B = p.bosses;
  const encounter = s.bossMet[kind];
  s.bossMet[kind]++;
  const cfg = kind === 'eye' ? B.eye : B.lich;
  const segments = clampSegments(cfg.segments);
  const introEnd = s.tick + ticks(B.introSeconds);
  // the lich materialises at the portal unless the hero stands there, then at the farthest spot
  let x: number = B.eye.x;
  let y: number = B.eye.y;
  if (kind === 'lich') {
    [x, y] = pickLichSpot(s, p, -1, -1);
  }
  s.boss = {
    kind,
    wave,
    encounter,
    segments,
    remaining: segments,
    x,
    y,
    start: s.tick,
    introEnd,
    nextAt: introEnd,
    attack: null,
    serial: 0,
    hitTick: -1,
    deathTick: -1,
    speed: 1 + Math.min(B.encounterSpeedCap, B.encounterSpeedStep * encounter),
  };
  s.events.push({ type: 'boss_intro', kind });
}

/** A teleport destination >= minHeroDist from the hero (seeded), never the current spot; fallback: the farthest. */
function pickLichSpot(s: SimState, p: SimParams, curX: number, curY: number): [number, number] {
  const min2 = p.bosses.lich.minHeroDist * p.bosses.lich.minHeroDist;
  const spots = lichSpots(p).filter(([x, y]) => x !== curX || y !== curY);
  const ok = spots.filter(([x, y]) => d2(x, y, s.hero.x, s.hero.y) >= min2);
  if (ok.length > 0) return ok[Math.floor(nextFloat(s) * ok.length)] ?? ok[0]!;
  let best = spots[0]!;
  for (const sp of spots) if (d2(sp[0], sp[1], s.hero.x, s.hero.y) > d2(best[0], best[1], s.hero.x, s.hero.y)) best = sp;
  return best;
}

function pickPattern(s: SimState, p: SimParams, kind: BossKind): BossPattern {
  const opts: [BossPattern, number][] =
    kind === 'eye'
      ? [['ring', p.bosses.eye.ring.weight], ['beam', p.bosses.eye.beam.weight], ['spawns', p.bosses.eye.spawns.weight]]
      : [['fan', p.bosses.lich.fan.weight], ['wraiths', p.bosses.lich.wraiths.weight], ['triple', p.bosses.lich.triple.weight]];
  let total = 0;
  for (const [, w] of opts) total += w;
  let r = nextFloat(s) * total;
  for (const [k, w] of opts) {
    r -= w;
    if (r < 0) return k;
  }
  return opts[0]![0];
}

/** Begin the next attack sequence: pick the pattern; the lich teleports first; then a wind-up of >= 15 ticks. */
function beginAttack(s: SimState, p: SimParams, b: Boss): void {
  const t = s.tick;
  const pattern = pickPattern(s, p, b.kind);
  let tpOut = t;
  let tpIn = t;
  let wind: number;
  if (b.kind === 'lich') {
    tpIn = t + ticks(p.bosses.lich.teleportOutSeconds);
    wind = Math.max(15, ticks(p.bosses.lich.windupSeconds));
    const windStart = tpIn + ticks(p.bosses.lich.teleportInSeconds);
    b.attack = { pattern, tpOut, tpIn, windStart, fire: windStart + wind, dirX: 0, dirY: 0, sign: 1, points: [] };
    return;
  }
  wind = Math.max(15, ticks(pattern === 'beam' ? p.bosses.eye.beam.windupSeconds : p.bosses.eye.windupSeconds));
  const a: BossAttack = { pattern, tpOut, tpIn, windStart: t, fire: t + wind, dirX: 0, dirY: 0, sign: 1, points: [] };
  prepareTelegraph(s, p, b, a);
  b.attack = a;
}

/** Fix what the wind-up shows: the beam's start line, or the spawn points. Called when the wind-up starts. */
function prepareTelegraph(s: SimState, p: SimParams, b: Boss, a: BossAttack): void {
  const h = s.hero;
  if (a.pattern === 'beam') {
    const c = p.bosses.eye.beam;
    const dx = h.x - b.x;
    const dy = h.y - b.y;
    const r = Math.sqrt(dx * dx + dy * dy) || 1;
    // start line offset from the hero by a reachable 18-34 px (perpendicular), sweeping towards and past him;
    // everything behind the start line is safe for the whole sweep (it only rotates away from it)
    const q = Math.min(0.93, range(s, c.offsetMinPx, c.offsetMaxPx) / r);
    const sign = nextFloat(s) < 0.5 ? -1 : 1;
    const cs = Math.sqrt(1 - q * q);
    const [ux, uy] = [dx / r, dy / r];
    // rotate the hero direction by -sign * asin(q)
    a.dirX = ux * cs + uy * sign * q;
    a.dirY = -ux * sign * q + uy * cs;
    a.sign = sign;
  } else if (a.pattern === 'spawns') {
    const c = p.bosses.eye.spawns;
    const n = Math.min(c.maxCount, Math.max(1, Math.round(c.count * p.density)));
    const min2 = c.minHeroDist * c.minHeroDist;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 8; k++) {
        const x = range(s, p.x0 + c.edgeInset, p.x1 - c.edgeInset);
        const y = range(s, p.y0 + c.edgeInset, p.y1 - c.edgeInset);
        if (d2(x, y, h.x, h.y) >= min2 && a.points.every(([px, py]) => d2(px, py, x, y) >= 30 * 30)) {
          a.points.push([x, y]);
          break;
        }
      }
    }
  }
}

/** Launch the attack: exactly one segment is removed here, before anything else can happen. */
function launch(s: SimState, p: SimParams, b: Boss, a: BossAttack, spawn: Spawn): void {
  b.serial++;
  b.remaining--;
  b.hitTick = s.tick;
  s.events.push({ type: 'boss_segment', remaining: b.remaining, reflected: false });
  s.events.push({ type: 'boss_attack', kind: b.kind, pattern: a.pattern, remaining: b.remaining });
  const serial = b.serial;
  const tele = a.fire - a.windStart;
  const h = s.hero;
  const fair2 = p.fairDistance * p.fairDistance;
  const sp = b.speed * p.diffSpeed;
  const shoot = (kind: 'orb_small' | 'orb_large' | 'wraith', x: number, y: number, vx: number, vy: number, extra = {}): void => {
    if (d2(x, y, h.x, h.y) < fair2) return; // never spawn within 60 px of the hero
    spawn(s, p, kind, x, y, vx, vy, { ...extra, boss: serial }, tele);
  };
  const aim = (x: number, y: number): [number, number] => {
    const dx = h.x - x;
    const dy = h.y - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / d, dy / d];
  };
  if (a.pattern === 'ring') {
    const c = p.bosses.eye.ring;
    const n = scaledCount(p, c.count, 2 * 3.141592653589793, true);
    const base = c.spinRad * b.serial;
    const v = (c.speed / 60) * sp;
    const curve = (c.curveRadPerSecond / 60) * (b.serial % 2 === 0 ? 1 : -1); // the ring rotates as it expands
    for (let k = 0; k < n; k++) {
      const ang = base + (2 * 3.141592653589793 * k) / n;
      const dx = dcos(ang);
      const dy = dsin(ang);
      shoot('orb_small', b.x + dx * 10, b.y + dy * 10, dx * v, dy * v, { turnC: dcos(curve), turnS: dsin(curve) });
    }
  } else if (a.pattern === 'beam') {
    const c = p.bosses.eye.beam;
    const w = ((Math.min(60, c.degPerSecond) * 3.141592653589793) / 180 / 60) * a.sign;
    const beam: Beam = {
      serial,
      x: b.x,
      y: b.y,
      dirX: a.dirX,
      dirY: a.dirY,
      turnC: dcos(w),
      turnS: dsin(w),
      start: s.tick,
      end: s.tick + Math.max(1, Math.round((c.sweepDeg / Math.min(60, c.degPerSecond)) * 60)),
      halfWidth: c.halfWidth,
      length: c.length,
    };
    s.beams.push(beam);
  } else if (a.pattern === 'spawns') {
    const c = p.bosses.eye.spawns;
    const v = p.smallSpeed * b.speed;
    for (const [x, y] of a.points) {
      const [dx, dy] = rotate(...aim(x, y), range(s, -c.spread, c.spread));
      shoot('orb_small', x, y, dx * v, dy * v);
    }
  } else if (a.pattern === 'fan') {
    const c = p.bosses.lich.fan;
    const n = scaledCount(p, c.count, c.arc, false);
    const [ax, ay] = aim(b.x, b.y);
    const v = p.smallSpeed * b.speed;
    for (let k = 0; k < n; k++) {
      const [dx, dy] = rotate(ax, ay, n === 1 ? 0 : -c.arc / 2 + (c.arc * k) / (n - 1));
      shoot('orb_small', b.x + ax * 8, b.y + ay * 8, dx * v, dy * v);
    }
  } else if (a.pattern === 'wraiths') {
    const c = p.bosses.lich.wraiths;
    const n = Math.min(c.maxCount, Math.max(1, Math.round(c.count * p.density)));
    const [ax, ay] = aim(b.x, b.y);
    const v = p.wraithSpeed * b.speed;
    for (let k = 0; k < n; k++) {
      const off = n === 1 ? 0 : -0.9 + (1.8 * k) / (n - 1);
      const [dx, dy] = rotate(ax, ay, off);
      const expires = s.tick + p.wraithLife;
      shoot('wraith', b.x + dx * 12, b.y + dy * 12, dx * v, dy * v, { homing: p.wraithSteer, expires, fadeEnd: expires + p.wraithFade });
    }
  } else {
    const c = p.bosses.lich.triple;
    const [ax, ay] = aim(b.x, b.y);
    const v = p.largeSpeed * b.speed * 1.3;
    for (let k = 0; k < 3; k++) {
      const o = 8 - k * c.spacingPx; // three in a row along the aim line, the first one leading
      shoot('orb_large', b.x + ax * o, b.y + ay * o, ax * v, ay * v);
    }
  }
}

/** Is the hero inside an active beam? (Segment distance; the beam is unparryable, dash i-frames still apply.) */
export function beamHits(s: SimState, p: SimParams): boolean {
  const h = s.hero;
  for (const bm of s.beams) {
    if (s.tick < bm.start || s.tick >= bm.end) continue;
    const rx = h.x - bm.x;
    const ry = h.y - bm.y;
    const along = rx * bm.dirX + ry * bm.dirY;
    if (along < 0 || along > bm.length) continue;
    const perp = Math.abs(-rx * bm.dirY + ry * bm.dirX);
    if (perp < bm.halfWidth + p.heroRadius) return true;
  }
  return false;
}

function rotateBeams(s: SimState): void {
  const keep: Beam[] = [];
  for (const bm of s.beams) {
    if (s.tick >= bm.end) continue;
    if (s.tick > bm.start) {
      const x = bm.dirX * bm.turnC - bm.dirY * bm.turnS;
      bm.dirY = bm.dirX * bm.turnS + bm.dirY * bm.turnC;
      bm.dirX = x;
    }
    keep.push(bm);
  }
  s.beams = keep;
}

/** The final attack is over when none of its projectiles and no beam of it remain. */
function finalAttackGone(s: SimState, b: Boss): boolean {
  return !s.projectiles.some((pr) => pr.boss === b.serial) && !s.beams.some((bm) => bm.serial === b.serial);
}

/** Remove extra segments for a reflected boss projectile (reflectBonusSegments, default 0 = off). */
export function onBossParry(s: SimState, p: SimParams, bossSerial: number): void {
  const b = s.boss;
  const bonus = Math.max(0, Math.floor(p.bosses.reflectBonusSegments));
  if (!b || bossSerial <= 0 || bonus === 0 || b.remaining <= 0 || b.deathTick >= 0) return;
  b.remaining = Math.max(0, b.remaining - bonus);
  b.hitTick = s.tick;
  s.events.push({ type: 'boss_segment', remaining: b.remaining, reflected: true });
}

/** One boss tick. Returns true while the boss fight (incl. its death sequence) is still running. */
export function runBoss(s: SimState, p: SimParams, spawn: Spawn): void {
  const b = s.boss;
  if (!b) return;
  const t = s.tick;
  rotateBeams(s);
  if (b.deathTick >= 0) {
    if (t >= b.deathTick + ticks(p.bosses.deathSeconds)) s.boss = null;
    return;
  }
  if (b.remaining <= 0) {
    b.attack = null; // nothing is launched with an empty bar (e.g. emptied by a reflect bonus mid wind-up)
    if (finalAttackGone(s, b)) {
      b.deathTick = t;
      s.bossScore += p.bosses.killScore; // fixed, never multiplied (awarded exactly once: deathTick is now set)
      s.bossesDefeated++;
      const cap = p.parryActiveByCharge.length - 1;
      s.emberCharges++;
      s.breakUntil = t + ticks(p.bosses.breakSeconds);
      s.events.push({ type: 'boss_defeated', kind: b.kind, x: b.x, y: b.y, points: p.bosses.killScore, charges: Math.min(cap, s.emberCharges) });
    }
    return;
  }
  if (t < b.introEnd) return;
  if (!b.attack && t >= b.nextAt) beginAttack(s, p, b);
  const a = b.attack;
  if (!a) return;
  if (b.kind === 'lich' && t === a.tpIn) {
    [b.x, b.y] = pickLichSpot(s, p, b.x, b.y);
    s.events.push({ type: 'boss_teleport', x: b.x, y: b.y });
  }
  if (b.kind === 'lich' && t === a.windStart) prepareTelegraph(s, p, b, a);
  if (t === a.fire) {
    launch(s, p, b, a, spawn);
    b.attack = null;
    const cad = ticks((b.kind === 'eye' ? p.bosses.eye : p.bosses.lich).cadenceSeconds);
    const pre = a.fire - a.tpOut;
    b.nextAt = t + Math.max(1, cad - pre);
  }
}
