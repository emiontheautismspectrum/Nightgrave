/**
 * The NEW BOSSES (FEATURES.bosses, docs/FEATURES.md): the Thorn Mother and the Toller. Every path into this file starts
 * with a boss of a new kind, which exists only while its row is enabled (`params.thorn`, `params.toller`), so nothing
 * here runs, reads a row, adds state or draws from the PRNG while the rows are off.
 *
 * ONE ATTACK = ONE SEGMENT, also when it emits over time: the segment is removed at the launch (boss.ts `launch`);
 * the later emissions wait in `boss.pending` with the SAME serial, and the boss is defeated only once the queue is
 * empty and nothing of the final attack (projectiles, beams, walls) is left.
 */
import type { TheToller, ThornMother } from '../data/features';
import { TICK_RATE } from '../data/tuning';
import { dcos, dsin, PI, rotate } from './dmath';
import { placeWall, planWall } from './hunts';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Spawn } from './boss';
import type { Beam, Boss, BossAttack, BossEmission, BossPattern, SimState } from './state';

/** The attacks of the new bosses. */
export type NewPattern = Exclude<BossPattern, 'ring' | 'beam' | 'spawns' | 'fan' | 'wraiths' | 'triple'>;
type ShotKind = 'orb_small' | 'orb_large' | 'wraith' | 'rune_shard' | 'blade';

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
/** Unit direction from (x, y) to the hero; straight down when the hero stands exactly there. */
function aimAt(s: SimState, x: number, y: number): [number, number] {
  const dx = s.hero.x - x;
  const dy = s.hero.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d > 1e-6 ? [dx / d, dy / d] : [0, 1];
}

const thornRow = (p: SimParams): ThornMother => {
  if (!p.thorn) throw new Error('boss: thorn is not enabled');
  return p.thorn;
};
const tollerRow = (p: SimParams): TheToller => {
  if (!p.toller) throw new Error('boss: toller is not enabled');
  return p.toller;
};

/** A count scaled by the difficulty density (rounded, >= 1), capped at `max`. */
const scaled = (p: SimParams, base: number, max: number): number => Math.max(1, Math.min(max, Math.round(base * p.density)));

/**
 * A boss shot under the 60 px rule of boss.ts: an UNTELEGRAPHED-near shot that would appear within the fairness
 * distance is moved along its own line to just beyond it (aimed shots back, radial shots forward); one that would then
 * leave the field is dropped. `cued` = a ground cue the player saw at that very spot (a bloom): spawned in place.
 */
function shot(s: SimState, p: SimParams, spawn: Spawn, serial: number, tele: number, kind: ShotKind, x: number, y: number, vx: number, vy: number, aimed: boolean, cued = false): void {
  const h = s.hero;
  const fair2 = p.fairDistance * p.fairDistance;
  const m = p.despawnMargin - 2;
  if (!cued && d2(x, y, h.x, h.y) < fair2) {
    const v = Math.sqrt(vx * vx + vy * vy) || 1;
    const dx = vx / v;
    const dy = vy / v;
    const qd = (x - h.x) * dx + (y - h.y) * dy;
    const r60 = p.fairDistance + 0.5;
    const disc = Math.sqrt(Math.max(0, qd * qd - d2(x, y, h.x, h.y) + r60 * r60));
    const tt = aimed ? -qd - disc : -qd + disc;
    x += dx * tt;
    y += dy * tt;
    if (x < p.x0 - m || x > p.x1 + m || y < p.y0 - m || y > p.y1 + m) return;
  }
  spawn(s, p, kind, x, y, vx, vy, { boss: serial }, tele);
}

/**
 * A gap that READS as a gap: at least `gapRad`, and at least 1.6 x the ring's natural spacing (2 pi / n), so a sparse
 * ring (fewer projectiles on an easier difficulty) still shows its gap clearly.
 */
export const readableGap = (n: number, gapRad: number): number => Math.max(gapRad, (1.6 * 2 * PI) / Math.max(1, n));

/** The Toller's toll: orbs per ring, the gap of each ring, and how far the next ring's gap turns (never aligned). */
export function tollGeometry(p: SimParams): { n: number; gap: number; step: number } {
  const c = tollerRow(p).toll;
  const n = scaled(p, c.count, c.maxCount);
  const gap = readableGap(n, c.gapRad);
  return { n, gap, step: Math.max(c.gapStepRad, gap + 0.5) };
}

/**
 * `n` unit directions evenly over the circle minus ONE gap of `gap` rad centred on the unit direction (gx, gy); the
 * gap is exact. Vector math only (dmath rotations: no engine-dependent Math functions in the sim).
 */
function gappedRing(n: number, gx: number, gy: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  const span = 2 * PI - gap;
  for (let k = 0; k < n; k++) out.push(rotate(gx, gy, gap / 2 + (n === 1 ? span / 2 : (span * k) / (n - 1))));
  return out;
}

/**
 * `n` projectiles over the circle minus TWO gaps of `gap` rad centred at g1 and g2 (g2 - g1 within (gap, 2 pi - gap)):
 * each arc between the gaps gets its share, its ends exactly on the gap edges.
 */
function twoGapRing(n: number, gx: number, gy: number, d: number, gap: number): [number, number][] {
  // gap 1 on (gx, gy), gap 2 turned by d (0 < d < 2 pi) from it
  const la = Math.max(0, d - gap);
  const lb = Math.max(0, 2 * PI - d - gap);
  const na = Math.max(0, Math.min(n, Math.round((n * la) / (la + lb || 1))));
  const out: [number, number][] = [];
  const arc = (from: number, len: number, m: number): void => {
    for (let k = 0; k < m; k++) out.push(rotate(gx, gy, from + (m === 1 ? len / 2 : (len * k) / (m - 1))));
  };
  arc(gap / 2, la, na);
  arc(d + gap / 2, lb, n - na);
  return out;
}

// ------------------------------------------------------------------ the pick

/** Can a hedge start now? Never while a wall (hers or a briar line) or a pattern-pack curtain is alive. */
export const hedgeFree = (s: SimState): boolean => !(s.walls && s.walls.length) && !s.projectiles.some((pr) => pr.pack === 'curtain');

/** The weighted attack table of a new boss (an attack that cannot start now is left out: still ONE draw). */
export function newPatternTable(s: SimState, p: SimParams, kind: 'thorn' | 'toller'): [BossPattern, number][] {
  if (kind === 'thorn') {
    const c = thornRow(p);
    const out: [BossPattern, number][] = [];
    if (hedgeFree(s)) out.push(['hedge', c.hedge.weight]);
    out.push(['bloom', c.bloom.weight], ['lash', c.lash.weight], ['spores', c.spores.weight]);
    return out;
  }
  const c = tollerRow(p);
  const out: [BossPattern, number][] = [['toll', c.toll.weight]];
  // never two beams at once: no pendulum while one swings (either pass) or its second pass is still to come; and
  // never a pendulum wind-up over a toll that is still ringing (the previous attack's orbs in flight: walking behind
  // the start line would mean walking through the rings)
  const b = s.boss;
  const swinging = s.beams.length > 0 || !!b?.pending?.some((e) => e.op === 'swing');
  const ringing = !!b && b.serial > 0 && s.projectiles.some((pr) => pr.boss === b.serial && pr.kind === 'orb_small');
  if (!swinging && !ringing) out.push(['pendulum', c.pendulum.weight]);
  if (!knellAlive(s)) out.push(['knell', c.knell.weight]); // never two knell rings at once
  return out;
}

/** A knell ring is still flying (the Toller's only blades). */
export const knellAlive = (s: SimState): boolean => s.projectiles.some((pr) => pr.boss > 0 && pr.kind === 'blade');

/** The Toller keeps its beat: the next attack starts on the first beat tick (counted from the intro end) >= `at`. */
export function onBeat(p: SimParams, b: Boss, at: number): number {
  const beat = Math.max(1, Math.round(tollerRow(p).beatTicks));
  return b.introEnd + Math.ceil((at - b.introEnd) / beat) * beat;
}

/** The Toller's beat in ticks (render: the bell swing). */
export const beatTicks = (p: SimParams): number => Math.max(1, Math.round(tollerRow(p).beatTicks));

// ------------------------------------------------------------------ the wind-up

/** Begin an attack of a new boss: the wind-up (>= 15 ticks) and what it shows (a line, the bloom spots). */
export function beginNewAttack(s: SimState, p: SimParams, b: Boss, pattern: BossPattern): BossAttack {
  const t = s.tick;
  if (b.kind === 'thorn') {
    const c = thornRow(p);
    const wind = Math.max(15, ticks(c.windupSeconds));
    const a: BossAttack = { pattern, tpOut: t, tpIn: t, windStart: t, fire: t + wind, dirX: 0, dirY: 0, sign: 1, points: [] };
    if (pattern === 'lash') [a.dirX, a.dirY] = aimAt(s, b.x, b.y); // the telegraph line: the lash follows it
    else if (pattern === 'bloom') {
      const r = c.bloom;
      const n = scaled(p, r.count, r.maxCount);
      const min2 = r.minHeroDist * r.minHeroDist;
      const gap2 = r.spacingPx * r.spacingPx;
      a.offs = [];
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 8; k++) {
          const x = range(s, p.x0 + r.edgeInset, p.x1 - r.edgeInset);
          const y = range(s, p.y0 + r.edgeInset, p.y1 - r.edgeInset);
          if (d2(x, y, s.hero.x, s.hero.y) < min2 || a.points.some(([px, py]) => d2(px, py, x, y) < gap2)) continue;
          a.points.push([x, y]);
          a.offs.push(range(s, -r.gapAimRad, r.gapAimRad));
          break;
        }
    }
    return a;
  }
  // the Toller: wind-ups are whole beats, so every launch lands on a beat tick
  const c = tollerRow(p);
  const beat = beatTicks(p);
  const wind = Math.max(15, Math.round(pattern === 'pendulum' ? c.pendulum.windupBeats : c.windupBeats) * beat);
  const a: BossAttack = { pattern, tpOut: t, tpIn: t, windStart: t, fire: t + wind, dirX: 0, dirY: 0, sign: 1, points: [] };
  if (pattern === 'pendulum') {
    // the start line, fixed now (the thin telegraph line): offset from the hero by a reachable 18-34 px, swinging
    // towards and past him; everything behind it stays safe for BOTH passes (the second one swings back to it)
    const r = c.pendulum;
    const dx = s.hero.x - b.x;
    const dy = s.hero.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const q = Math.min(0.93, range(s, r.offsetMinPx, r.offsetMaxPx) / dist);
    const sign = nextFloat(s) < 0.5 ? -1 : 1;
    const cs = Math.sqrt(1 - q * q);
    const [ux, uy] = [dx / dist, dy / dist];
    a.dirX = ux * cs + uy * sign * q;
    a.dirY = -ux * sign * q + uy * cs;
    a.sign = sign;
  } else if (pattern === 'toll') {
    a.offs = [range(s, -c.toll.gapAimRad, c.toll.gapAimRad)]; // ring 1's gap near the hero's direction
    a.sign = nextFloat(s) < 0.5 ? -1 : 1; // the way the later gaps turn
  } else if (pattern === 'knell') {
    a.offs = [range(s, -c.knell.gapAimRad, c.knell.gapAimRad), range(s, -0.5, 0.5)]; // gap 1 near the hero, gap 2 across
  }
  return a;
}

// ------------------------------------------------------------------ the launch

/** Launch an attack of a new boss (boss.ts already removed its one segment and set b.serial). */
export function launchNew(s: SimState, p: SimParams, b: Boss, a: BossAttack, pattern: NewPattern, spawn: Spawn): void {
  const serial = b.serial;
  const tele = a.fire - a.windStart;
  switch (pattern) {
    case 'hedge': {
      const c = thornRow(p).hedge;
      const speed = (c.speed * p.diffSpeed * b.speed) / TICK_RATE;
      const { w } = planWall(s, p, c, speed);
      // the gap's lane never runs through her (her lash would meet the hero in it point-blank)
      if (placeWall(s, p, w, c, serial, { x: b.x, y: b.y, r: c.bossClearPx })) return;
      // every gap choice crossed a blood sigil or her body: the root line does not rise, a spore fan is the attack
      return launchNew(s, p, b, a, 'spores', spawn);
    }
    case 'bloom': {
      const c = thornRow(p).bloom;
      const stagger = Math.max(1, ticks(c.staggerSeconds));
      const pend = (b.pending ??= []);
      a.points.forEach(([x, y], i) => {
        const e: BossEmission = { op: 'bloom', at: s.tick + i * stagger, serial, x, y, off: a.offs?.[i] ?? 0, tele: a.windStart };
        if (i === 0) emit(s, p, b, e, spawn);
        else pend.push(e);
      });
      return;
    }
    case 'lash': {
      const c = thornRow(p).lash;
      const n = scaled(p, c.count, c.maxCount);
      const v = p.bladeSpeed * b.speed * c.speedFactor;
      for (let k = 0; k < n; k++) {
        const [dx, dy] = rotate(a.dirX, a.dirY, n === 1 ? 0 : -c.arc / 2 + (c.arc * k) / (n - 1));
        shot(s, p, spawn, serial, tele, 'blade', b.x + dx * 10, b.y + dy * 10, dx * v, dy * v, true);
      }
      return;
    }
    case 'spores': {
      const c = thornRow(p).spores;
      const n = Math.max(1, Math.min(Math.round(c.count * p.density), Math.floor(c.arc / p.bosses.minGapRad) + 1));
      const [ax, ay] = aimAt(s, b.x, b.y);
      const v = p.smallSpeed * b.speed;
      for (let k = 0; k < n; k++) {
        const [dx, dy] = rotate(ax, ay, n === 1 ? 0 : -c.arc / 2 + (c.arc * k) / (n - 1));
        shot(s, p, spawn, serial, tele, 'orb_small', b.x + ax * 8, b.y + ay * 8, dx * v, dy * v, true);
      }
      return;
    }
    case 'toll': {
      const c = tollerRow(p).toll;
      const [hx, hy] = aimAt(s, b.x, b.y);
      // the rhythm the design asks for: parry ring 1, walk through ring 2's gap, parry ring 3 (the beat is shorter
      // than the parry cooldown, two beats are longer). Ring 2's gap opens near the hero's direction; every other
      // ring's gap is turned by whole steps from it (never aligned)
      const [bx, by] = rotate(hx, hy, a.offs?.[0] ?? 0); // ring 2's gap direction
      const beat = beatTicks(p);
      const { step } = tollGeometry(p);
      const pend = (b.pending ??= []);
      const rings = Math.max(1, Math.round(c.rings));
      const mid = rings > 1 ? 1 : 0;
      for (let k = 0; k < rings; k++) {
        const [gx, gy] = rotate(bx, by, (k - mid) * a.sign * step);
        const e: BossEmission = { op: 'toll', at: s.tick + k * beat, serial, k, gapX: gx, gapY: gy, tele: a.windStart };
        if (k === 0) emit(s, p, b, e, spawn);
        else pend.push(e);
      }
      return;
    }
    case 'pendulum': {
      const c = tollerRow(p).pendulum;
      const deg = Math.min(60, c.degPerSecond); // never faster than 60 deg/s
      const w = ((deg * PI) / 180 / TICK_RATE) * a.sign;
      const n = Math.max(2, Math.round((c.sweepDeg / deg) * TICK_RATE));
      const beam: Beam = { serial, x: b.x, y: b.y, dirX: a.dirX, dirY: a.dirY, turnC: dcos(w), turnS: dsin(w), start: s.tick, end: s.tick + n, halfWidth: c.halfWidth, length: c.length };
      s.beams.push(beam);
      // pass 2 starts where pass 1 ends (it turns n - 1 times) and swings back to the start line
      const [ex, ey] = rotate(a.dirX, a.dirY, (n - 1) * w);
      (b.pending ??= []).push({ op: 'swing', at: s.tick + n, serial, dirX: ex, dirY: ey, sign: -a.sign, n });
      return;
    }
    case 'knell': {
      const c = tollerRow(p).knell;
      const n = scaled(p, c.count, c.maxCount);
      const [hx, hy] = aimAt(s, b.x, b.y);
      const [gx, gy] = rotate(hx, hy, a.offs?.[0] ?? 0); // gap 1 near the hero's direction, gap 2 across
      const v = p.bladeSpeed * b.speed * c.speedFactor;
      for (const [dx, dy] of twoGapRing(n, gx, gy, PI + (a.offs?.[1] ?? 0), readableGap(n, c.gapRad))) {
        shot(s, p, spawn, serial, tele, 'blade', b.x + dx * 10, b.y + dy * 10, dx * v, dy * v, false);
      }
      return;
    }
    default:
      return unknownPattern(pattern);
  }
}

function unknownPattern(x: never): never {
  throw new Error(`boss: unknown pattern ${String(x)}`);
}

/** Fire one deferred emission now. */
function emit(s: SimState, p: SimParams, b: Boss, e: BossEmission, spawn: Spawn): void {
  switch (e.op) {
    case 'bloom': {
      const c = thornRow(p).bloom;
      const n = scaled(p, c.shards, c.maxShards);
      const [hx, hy] = aimAt(s, e.x, e.y);
      const [gx, gy] = rotate(hx, hy, e.off);
      const v = p.shardSpeed * b.speed;
      for (const [dx, dy] of gappedRing(n, gx, gy, readableGap(n, c.gapRad))) {
        shot(s, p, spawn, e.serial, s.tick - e.tele, 'rune_shard', e.x + dx * 4, e.y + dy * 4, dx * v, dy * v, false, true);
      }
      s.events.push({ type: 'boss_bloom', x: e.x, y: e.y });
      return;
    }
    case 'toll': {
      const c = tollerRow(p).toll;
      const { n, gap } = tollGeometry(p);
      const v = (c.speed * p.diffSpeed * b.speed) / TICK_RATE;
      for (const [dx, dy] of gappedRing(n, e.gapX, e.gapY, gap)) {
        shot(s, p, spawn, e.serial, s.tick - e.tele, 'orb_small', b.x + dx * 10, b.y + dy * 10, dx * v, dy * v, false);
      }
      s.events.push({ type: 'boss_toll', ring: e.k });
      return;
    }
    case 'swing': {
      const c = tollerRow(p).pendulum;
      const w = ((Math.min(60, c.degPerSecond) * PI) / 180 / TICK_RATE) * e.sign;
      s.beams.push({ serial: e.serial, x: b.x, y: b.y, dirX: e.dirX, dirY: e.dirY, turnC: dcos(w), turnS: dsin(w), start: s.tick, end: s.tick + e.n, halfWidth: c.halfWidth, length: c.length });
      return;
    }
    default:
      return unknownEmission(e);
  }
}

function unknownEmission(x: never): never {
  throw new Error(`boss: unknown emission ${JSON.stringify(x)}`);
}

/** Once per boss tick: fire the deferred emissions that are due (in queue order). */
export function runPending(s: SimState, p: SimParams, b: Boss, spawn: Spawn): void {
  const q = b.pending;
  if (!q || !q.length) return;
  const keep: BossEmission[] = [];
  for (const e of q) {
    if (e.at > s.tick) keep.push(e);
    else emit(s, p, b, e, spawn);
  }
  b.pending = keep;
}

/** Nothing of a new boss's attacks is still to come or alive (with the final attack's projectiles, checked in boss.ts). */
export const newBossClear = (s: SimState, b: Boss): boolean => !(b.pending && b.pending.length) && !(s.walls && s.walls.some((w) => w.boss !== undefined));

