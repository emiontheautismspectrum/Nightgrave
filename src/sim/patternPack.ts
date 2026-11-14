/**
 * PATTERN PACK (FEATURES.patternPack, src/data/features.ts): ten set pieces built from the EXISTING threats only
 * (small / large orbs, rune shards, blades, wraiths, stalkers). No new entity kind, sprite, string or sound: a rune
 * piece shows the rune glow, a caster piece the stalker's own telegraph, an edge piece starts at least the fairness
 * distance away, like every edge spawn.
 *
 * Nothing in this file runs while the block is disabled: the director adds the pack to its pool only through
 * `params.pack` (null when off), and `runPatternPack` is called only then. So the PRNG is consumed here only when the
 * block is enabled. Violet stays parryable; red (blades) appears only in `crossfire` and `stalkerPair`.
 *
 * Fairness (tests/pattern_pack.test.ts): nothing appears within the fairness distance (60 px) of the hero without a
 * visible cue of at least 15 ticks; every piece leaves a walking hero a way out; entity caps per piece are
 * `packEntityCaps`.
 */
import { HOLLOWS, RUNES } from '../data/arena';
import { PACK_KEYS, type PackKey, type PatternPack } from '../data/features';
import { TUNING } from '../data/tuning';
import { dcos, dsin, PI, rotate } from './dmath';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Caster, CasterAttack, PackEvent, Projectile, ProjectileKind, SimState } from './state';

/** The spawner (waves.spawnProjectile), injected to avoid an import cycle (as for the bosses). */
export type PackSpawn = (
  s: SimState,
  p: SimParams,
  kind: ProjectileKind,
  x: number,
  y: number,
  vx: number,
  vy: number,
  extra?: { homing?: number; expires?: number; fadeEnd?: number },
  telegraphTicks?: number,
) => Projectile;

/** A pack blade is not launched at a hero this close to its stalker (the same rule as waves.CASTER_POINT_BLANK). */
export const PACK_POINT_BLANK = 16;
/** Rune pieces start this far from the rune centre (as the rune burst does). */
const RUNE_OFFSET = 4;
/** A caster's shot starts this far in front of it (as in waves.casterAttack). */
const CASTER_MUZZLE = 6;

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const countOf = (c: { count: number; countPerWave: number; maxCount: number }, wave: number): number =>
  Math.max(1, Math.min(c.maxCount, c.count + Math.floor(c.countPerWave * Math.max(0, wave))));

// ------------------------------------------------------------------ the pool

/** Total weight of the pack rows unlocked at `wave`. */
export function packWeight(pack: PatternPack, wave: number): number {
  let total = 0;
  for (const k of PACK_KEYS) if (wave >= pack[k].unlockWave) total += pack[k].weight;
  return total;
}

/** The pack row that the rest `r` of the director's single draw lands on (null: none). */
export function packPick(pack: PatternPack, wave: number, r: number): PackKey | null {
  for (const k of PACK_KEYS) {
    if (wave < pack[k].unlockWave) continue;
    r -= pack[k].weight;
    if (r < 0) return k;
  }
  return null;
}

/** Entity caps of ONE instance of each set piece, from its row: projectiles it can launch and casters it summons. */
export function packEntityCaps(pack: PatternPack): Record<PackKey, { projectiles: number; casters: number }> {
  const A = TUNING.arena;
  const longSide = Math.max(A.x1 - A.x0, A.y1 - A.y0);
  const casterShot = Math.max(TUNING.patterns.orbFan.maxCount, TUNING.casters.shardFan.count, 1);
  return {
    spiral: { projectiles: pack.spiral.maxCount, casters: 0 },
    gapRing: { projectiles: pack.gapRing.maxCount, casters: 0 },
    pincer: { projectiles: 2 * pack.pincer.maxCount, casters: 0 },
    curtain: { projectiles: Math.floor(longSide / pack.curtain.spacingPx) + 1, casters: 0 },
    echoFan: { projectiles: 2 * pack.echoFan.maxCount, casters: 0 },
    crossfire: { projectiles: 2 * pack.crossfire.maxCount, casters: 2 },
    pulseRings: { projectiles: pack.pulseRings.rings * pack.pulseRings.maxCount, casters: 0 },
    heavyLine: { projectiles: pack.heavyLine.maxCount, casters: 0 },
    slowThenFast: { projectiles: pack.slowThenFast.wraiths + 1, casters: 0 },
    stalkerPair: { projectiles: 2 * casterShot, casters: 2 },
  };
}

// ------------------------------------------------------------------ geometry helpers

type Side = 0 | 1 | 2 | 3; // top, right, bottom, left of the spawn rectangle (the arena grown by spawnOffset)

/** Point at fraction u (0..1) of a side of the spawn rectangle. */
function sidePoint(p: SimParams, side: Side, u: number): [number, number] {
  const o = p.spawnOffset;
  const x0 = p.x0 - o;
  const y0 = p.y0 - o;
  const w = p.x1 - p.x0 + 2 * o;
  const h = p.y1 - p.y0 + 2 * o;
  return side === 0 ? [x0 + u * w, y0] : side === 1 ? [x0 + w, y0 + u * h] : side === 2 ? [x0 + u * w, y0 + h] : [x0, y0 + u * h];
}

/** Distance from the hero to the line a side of the spawn rectangle lies on. */
function sideDistance(s: SimState, p: SimParams, side: Side): number {
  const o = p.spawnOffset;
  return side === 0 ? s.hero.y - (p.y0 - o) : side === 1 ? p.x1 + o - s.hero.x : side === 2 ? p.y1 + o - s.hero.y : s.hero.x - (p.x0 - o);
}

/** A seeded point on `side` at least `min` from the hero (6 tries, then the end of the side farther from the hero). */
function farSidePoint(s: SimState, p: SimParams, side: Side, min: number): [number, number] {
  for (let i = 0; i < 6; i++) {
    const [x, y] = sidePoint(p, side, nextFloat(s));
    if (d2(x, y, s.hero.x, s.hero.y) >= min * min) return [x, y];
  }
  const a = sidePoint(p, side, 0);
  const b = sidePoint(p, side, 1);
  return d2(a[0], a[1], s.hero.x, s.hero.y) >= d2(b[0], b[1], s.hero.x, s.hero.y) ? a : b;
}

/** A seeded point anywhere on the spawn rectangle at least `min` from the hero (6 tries, then the farthest corner). */
function farPoint(s: SimState, p: SimParams, min: number): [number, number] {
  for (let i = 0; i < 6; i++) {
    const [x, y] = sidePoint(p, Math.floor(nextFloat(s) * 4) as Side, nextFloat(s));
    if (d2(x, y, s.hero.x, s.hero.y) >= min * min) return [x, y];
  }
  let best = sidePoint(p, 0, 0);
  for (const c of [sidePoint(p, 0, 1), sidePoint(p, 2, 0), sidePoint(p, 2, 1)])
    if (d2(c[0], c[1], s.hero.x, s.hero.y) > d2(best[0], best[1], s.hero.x, s.hero.y)) best = c;
  return best;
}

/**
 * Unit vector from (x, y) to (tx, ty), turned by a seeded error in [-spread, spread] (no draw when spread is 0).
 * Never a zero vector: a target exactly on the origin (the hero standing on a rune) aims along +x.
 */
function aimAt(s: SimState, x: number, y: number, tx: number, ty: number, spread: number): [number, number] {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const ux = d > 1e-6 ? dx / d : 1;
  const uy = d > 1e-6 ? dy / d : 0;
  return spread > 0 ? rotate(ux, uy, range(s, -spread, spread)) : [ux, uy];
}

/** Can the hero's centre be at (x, y)? (the arena shrunk by heroInset) */
const heroCanStand = (p: SimParams, x: number, y: number): boolean =>
  x >= p.x0 + p.heroInset && x <= p.x1 - p.heroInset && y >= p.y0 + p.heroInset && y <= p.y1 - p.heroInset;

/** A seeded rune with no telegraph on it (-1: every rune is busy). */
function freeRune(s: SimState): number {
  let rune = Math.floor(nextFloat(s) * RUNES.length);
  for (let i = 0; i < RUNES.length && s.telegraphs.some((t) => t.rune === rune); i++) rune = (rune + 1) % RUNES.length;
  return s.telegraphs.some((t) => t.rune === rune) || !RUNES[rune] ? -1 : rune;
}

/**
 * Light a rune from now until `fire` (the piece's LAST emission): the rune glows, and is marked on the edge of a
 * zoomed view, for the whole piece. The director's own burst for this telegraph is empty (0 shards).
 */
function lightRune(s: SimState, rune: number, fire: number): void {
  const r = RUNES[rune]!;
  s.telegraphs.push({ id: s.nextId++, rune, x: r.x, y: r.y, start: s.tick, fire, shards: 0, speed: 0 });
  s.events.push({ type: 'telegraph', id: s.nextId - 1, rune });
}

function tagged(pr: Projectile, pack: PackKey): Projectile {
  pr.pack = pack;
  return pr;
}

/** `n` projectiles from one point over `arc` around the unit direction (ax, ay). */
function fan(s: SimState, p: SimParams, spawn: PackSpawn, pack: PackKey, kind: ProjectileKind, x: number, y: number, ax: number, ay: number, n: number, arc: number, v: number): void {
  for (let i = 0; i < n; i++) {
    const [dx, dy] = rotate(ax, ay, n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1));
    tagged(spawn(s, p, kind, x, y, dx * v, dy * v), pack);
  }
}

/** A stalker at a hollow with fixed timings (the usual phases; `cast` is the length of its wind-up). */
function stalker(s: SimState, p: SimParams, hollow: number, attack: CasterAttack, idle: number, cast: number, pack: PackKey): Caster {
  const h = HOLLOWS[hollow]!;
  const k = p.hollowInset;
  const x = h.side === 'left' ? h.x + k : h.side === 'right' ? h.x - k : h.x;
  const y = h.side === 'top' ? h.y + k : h.side === 'bottom' ? h.y - k : h.y;
  const start = s.tick;
  const appear0 = start + p.casterTele;
  const appear = appear0 + p.casterRise;
  const castStart = appear + idle;
  const fire = castStart + cast;
  const c: Caster = { id: s.nextId++, kind: 'stalker', source: hollow, x, y, start, appear0, appear, castStart, fire, end: fire + p.casterDissolve, attack, pack };
  s.casters.push(c);
  s.events.push({ type: 'caster', id: c.id, kind: 'stalker', source: hollow });
  return c;
}

const freeHollows = (s: SimState): number[] => HOLLOWS.map((_h, i) => i).filter((i) => !s.casters.some((c) => c.source === i));

// ------------------------------------------------------------------ the ten set pieces

type Start = (s: SimState, p: SimParams, pack: PatternPack, sp: number, spawn: PackSpawn, q: PackEvent[]) => boolean;

/**
 * 1. A rune emits small orbs one by one while the direction turns: a spiral with wide lanes between its arms. The
 * first orb flies at where the hero stood when the rune lit up (+- aimRad), so the spiral always asks for one step.
 */
const spiral: Start = (s, p, pack, sp, _spawn, q) => {
  const c = pack.spiral;
  const rune = freeRune(s);
  if (rune < 0) return false;
  const r = RUNES[rune]!;
  const tele = Math.max(p.fairTelegraph, ticks(c.telegraphSeconds));
  const emit = ticks(c.seconds);
  const n = countOf(c, s.wave);
  const [ux, uy] = aimAt(s, r.x, r.y, s.hero.x, s.hero.y, c.aimRad);
  const sign = nextFloat(s) < 0.5 ? -1 : 1;
  const v = p.smallSpeed * sp;
  lightRune(s, rune, s.tick + tele + emit);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = rotate(ux, uy, (sign * c.turns * 2 * PI * i) / n);
    q.push({ op: 'shot', at: s.tick + tele + Math.round((i * emit) / Math.max(1, n - 1)), pack: 'spiral', kind: 'orb_small', x: r.x + dx * RUNE_OFFSET, y: r.y + dy * RUNE_OFFSET, vx: dx * v, vy: dy * v, tele: s.tick });
  }
  return true;
};

/** 2. A dense rune burst with ONE gap, opened near the hero's direction when the ring is launched. */
const gapRing: Start = (s, p, pack, sp, _spawn, q) => {
  const c = pack.gapRing;
  const rune = freeRune(s);
  if (rune < 0) return false;
  const r = RUNES[rune]!;
  const tele = Math.max(p.fairTelegraph, ticks(c.telegraphSeconds));
  lightRune(s, rune, s.tick + tele);
  q.push({ op: 'ring', at: s.tick + tele, pack: 'gapRing', x: r.x, y: r.y, n: Math.max(2, countOf(c, s.wave)), speed: p.shardSpeed * sp, gap: c.gapRad, aim: true, off: range(s, -c.gapAimRad, c.gapAimRad), tele: s.tick });
  return true;
};

/** 3. Two orb fans from opposite edges, crossing at the hero. */
const pincer: Start = (s, p, pack, sp, spawn) => {
  const c = pack.pincer;
  const n = countOf(c, s.wave);
  const sides: [Side, Side] = nextFloat(s) < 0.5 ? [3, 1] : [0, 2];
  const v = p.smallSpeed * sp;
  for (const side of sides) {
    const [x, y] = farSidePoint(s, p, side, p.fairDistance);
    const [ax, ay] = aimAt(s, x, y, s.hero.x, s.hero.y, 0.1);
    fan(s, p, spawn, 'pincer', 'orb_small', x, y, ax, ay, n, c.arc, v);
  }
  return true;
};

/**
 * 4. A line of large orbs sweeps the arena from the edge farther from the hero. Its one gap lies within reachFraction
 * of the distance the hero can WALK before the line arrives, and never on a blood sigil when that can be avoided.
 */
const curtain: Start = (s, p, pack, sp, spawn) => {
  const c = pack.curtain;
  if (s.projectiles.some((pr) => pr.pack === 'curtain')) return false; // at most one curtain at a time
  const h = s.hero;
  const o = p.spawnOffset;
  const v = p.largeSpeed * sp * c.speedFactor;
  const sideways = nextFloat(s) < 0.5; // true: a vertical line sweeping left / right
  const dir = sideways ? (h.x > p.cx ? 1 : -1) : h.y > p.cy ? 1 : -1; // it comes from the farther edge
  const line = sideways ? (dir > 0 ? p.x0 - o : p.x1 + o) : dir > 0 ? p.y0 - o : p.y1 + o;
  const lo = sideways ? p.y0 : p.x0;
  const hi = sideways ? p.y1 : p.x1;
  const along = sideways ? h.y : h.x;
  const arrive = Math.abs((sideways ? h.x : h.y) - line) / v; // ticks until it reaches the hero's row / column
  const reach = c.reachFraction * p.heroSpeed * arrive;
  const half = c.gapPx / 2;
  const clampGap = (g: number): number => Math.min(hi - half, Math.max(lo + half, g));
  const off = range(s, -1, 1) * reach;
  const onSigil = (g: number): boolean => s.sigils.some((sg) => Math.abs((sideways ? sg.y : sg.x) - g) < half + sg.r);
  let gap = clampGap(along + off);
  if (onSigil(gap)) gap = clampGap(along - off);
  if (onSigil(gap)) gap = clampGap(along);
  const span = hi - lo;
  const count = Math.floor(span / c.spacingPx) + 1;
  const first = lo + (span - (count - 1) * c.spacingPx) / 2; // centred: no free lane at either end
  for (let i = 0; i < count; i++) {
    const at = first + i * c.spacingPx;
    if (Math.abs(at - gap) < half) continue;
    if (sideways) tagged(spawn(s, p, 'orb_large', line, at, dir * v, 0), 'curtain');
    else tagged(spawn(s, p, 'orb_large', at, line, 0, dir * v), 'curtain');
  }
  return true;
};

/** 5. An orb fan, then the same fan again, turned by half the gap between its rays. */
const echoFan: Start = (s, p, pack, sp, spawn, q) => {
  const c = pack.echoFan;
  const n = countOf(c, s.wave);
  const [x, y] = farPoint(s, p, p.fairDistance);
  const [ax, ay] = aimAt(s, x, y, s.hero.x, s.hero.y, 0.1);
  const v = p.smallSpeed * sp;
  fan(s, p, spawn, 'echoFan', 'orb_small', x, y, ax, ay, n, c.arc, v);
  const half = (n > 1 ? c.arc / (n - 1) : c.arc) / 2;
  const [bx, by] = rotate(ax, ay, nextFloat(s) < 0.5 ? -half : half);
  const at = s.tick + ticks(c.echoSeconds);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = rotate(bx, by, n === 1 ? 0 : -c.arc / 2 + (c.arc * i) / (n - 1));
    q.push({ op: 'shot', at, pack: 'echoFan', kind: 'orb_small', x, y, vx: dx * v, vy: dy * v, tele: -1 });
  }
  return true;
};

/**
 * 6. Two stalkers on two different sides cast blades at the same moment, `count` blades each. The wind-up is held
 * for the whole burst, so the casters (and their edge markers) announce every blade; the last blade is the caster's
 * own attack.
 */
const crossfire: Start = (s, p, pack, sp, _spawn, q) => {
  const c = pack.crossfire;
  if (s.casters.length + 2 > p.casterMax) return false;
  const free = freeHollows(s);
  if (free.length < 2) return false;
  const a = free[Math.floor(nextFloat(s) * free.length)] ?? free[0]!;
  const other = free.filter((i) => HOLLOWS[i]!.side !== HOLLOWS[a]!.side);
  if (other.length === 0) return false;
  const b = other[Math.floor(nextFloat(s) * other.length)] ?? other[0]!;
  const n = countOf(c, s.wave);
  const gap = ticks(c.burstGapSeconds);
  const idle = ticks(c.idleSeconds);
  const v = p.bladeSpeed * sp;
  for (const hollow of [a, b]) {
    const cs = stalker(s, p, hollow, 'blade', idle, p.casterCast + (n - 1) * gap, 'crossfire');
    for (let i = 0; i < n - 1; i++)
      q.push({ op: 'aim', at: cs.castStart + p.casterCast + i * gap, pack: 'crossfire', kind: 'blade', x: cs.x, y: cs.y, speed: v, spread: 0.08, minDist: PACK_POINT_BLANK, tele: s.tick });
  }
  return true;
};

/** 7. One rune fires several full shard rings, each turned by a fraction of the shard spacing. */
const pulseRings: Start = (s, p, pack, sp, _spawn, q) => {
  const c = pack.pulseRings;
  const rune = freeRune(s);
  if (rune < 0) return false;
  const r = RUNES[rune]!;
  const tele = Math.max(p.fairTelegraph, ticks(c.telegraphSeconds));
  const gap = ticks(c.ringGapSeconds);
  const rings = Math.max(1, Math.round(c.rings));
  const n = countOf(c, s.wave);
  const base = nextFloat(s) * 2 * PI;
  lightRune(s, rune, s.tick + tele + (rings - 1) * gap);
  for (let k = 0; k < rings; k++)
    q.push({ op: 'ring', at: s.tick + tele + k * gap, pack: 'pulseRings', x: r.x, y: r.y, n, speed: p.shardSpeed * sp, gap: 0, aim: false, off: base + (k * 2 * PI) / n / rings, tele: s.tick });
  return true;
};

/** 8. Large orbs from points along one far edge, flying parallel and launched one after another: a slanted wall. */
const heavyLine: Start = (s, p, pack, sp, _spawn, q) => {
  const c = pack.heavyLine;
  const n = countOf(c, s.wave);
  let side = Math.floor(nextFloat(s) * 4) as Side;
  if (sideDistance(s, p, side) < p.fairDistance) side = ((side + 2) % 4) as Side; // the whole edge is far enough
  const o = p.spawnOffset;
  const len = side === 0 || side === 2 ? p.x1 - p.x0 + 2 * o : p.y1 - p.y0 + 2 * o;
  const span = Math.min(len, (n - 1) * c.spacingPx);
  const mid = range(s, span / 2, len - span / 2);
  const reverse = nextFloat(s) < 0.5;
  const [mx, my] = sidePoint(p, side, mid / len);
  const [ax, ay] = aimAt(s, mx, my, s.hero.x, s.hero.y, 0.1);
  const v = p.largeSpeed * sp;
  const stagger = ticks(c.staggerSeconds);
  for (let i = 0; i < n; i++) {
    const k = reverse ? n - 1 - i : i;
    const [x, y] = sidePoint(p, side, (mid - span / 2 + (n > 1 ? (span * k) / (n - 1) : 0)) / len);
    q.push({ op: 'shot', at: s.tick + i * stagger, pack: 'heavyLine', kind: 'orb_large', x, y, vx: ax * v, vy: ay * v, tele: -1 });
  }
  return true;
};

/** 9. Wraiths to run from, then one fast small orb aimed ahead of where the hero has been drifting. */
const slowThenFast: Start = (s, p, pack, sp, spawn, q) => {
  const c = pack.slowThenFast;
  const v = p.wraithSpeed * sp;
  for (let i = 0; i < c.wraiths; i++) {
    const [x, y] = farPoint(s, p, p.fairDistance);
    const [ax, ay] = aimAt(s, x, y, s.hero.x, s.hero.y, 0);
    const expires = s.tick + p.wraithLife;
    tagged(spawn(s, p, 'wraith', x, y, ax * v, ay * v, { homing: p.wraithSteer, expires, fadeEnd: expires + p.wraithFade }), 'slowThenFast');
  }
  q.push({ op: 'lead', at: s.tick + ticks(c.delaySeconds), pack: 'slowThenFast', speed: p.smallSpeed * sp * c.fastFactor, minDist: Math.max(p.fairDistance, c.minDist), lead: c.leadFraction, hx: s.hero.x, hy: s.hero.y, t0: s.tick });
  return true;
};

const PAIR_FIRST: CasterAttack[] = ['orbFan', 'shardFan'];
const PAIR_SECOND: CasterAttack[] = ['orbFan', 'shardFan', 'blade'];

/** 10. Two stalkers; the second casts a moment after the first (a violet fan, then any stalker attack). */
const stalkerPair: Start = (s, p, pack) => {
  const c = pack.stalkerPair;
  if (s.casters.length + 2 > p.casterMax) return false;
  const free = freeHollows(s);
  if (free.length < 2) return false;
  const a = free[Math.floor(nextFloat(s) * free.length)] ?? free[0]!;
  const rest = free.filter((i) => i !== a);
  const b = rest[Math.floor(nextFloat(s) * rest.length)] ?? rest[0]!;
  const first = PAIR_FIRST[Math.floor(nextFloat(s) * PAIR_FIRST.length)] ?? 'orbFan';
  const second = PAIR_SECOND[Math.floor(nextFloat(s) * PAIR_SECOND.length)] ?? 'orbFan';
  const idle = ticks(c.idleSeconds);
  stalker(s, p, a, first, idle, p.casterCast, 'stalkerPair');
  stalker(s, p, b, second, idle + ticks(c.staggerSeconds), p.casterCast, 'stalkerPair');
  return true;
};

const STARTS: Record<PackKey, Start> = { spiral, gapRing, pincer, curtain, echoFan, crossfire, pulseRings, heavyLine, slowThenFast, stalkerPair };

/**
 * Start a set piece now (called by the director for the row it picked). False: it could not start (no free rune,
 * hollow or caster slot, a curtain already on the field) and nothing was changed except, at most, PRNG draws.
 */
export function startPackPattern(key: PackKey, s: SimState, p: SimParams, sp: number, spawn: PackSpawn): boolean {
  const pack = p.pack;
  if (!pack) return false;
  const q = (s.packQueue ??= []);
  if (!STARTS[key](s, p, pack, sp, spawn, q)) return false;
  s.events.push({ type: 'pack', key });
  return true;
}

// ------------------------------------------------------------------ deferred emissions

function fire(s: SimState, p: SimParams, e: PackEvent, spawn: PackSpawn): void {
  const h = s.hero;
  const fair2 = p.fairDistance * p.fairDistance;
  if (e.op === 'shot') {
    // an edge shot with no cue of its own never appears next to the hero
    if (e.tele < 0 && d2(e.x, e.y, h.x, h.y) < fair2) return;
    tagged(spawn(s, p, e.kind, e.x, e.y, e.vx, e.vy, {}, e.tele < 0 ? 0 : s.tick - e.tele), e.pack);
  } else if (e.op === 'ring') {
    let gx = dcos(e.off);
    let gy = dsin(e.off);
    if (e.aim) {
      // the gap opens toward the hero, turned by the seeded offset; mirrored or centred when that spot is off the arena
      let ux = h.x - e.x;
      let uy = h.y - e.y;
      const d = Math.sqrt(ux * ux + uy * uy);
      if (d > 1e-6) {
        ux /= d;
        uy /= d;
      } else {
        ux = 1;
        uy = 0;
      }
      [gx, gy] = rotate(ux, uy, e.off);
      if (!heroCanStand(p, e.x + gx * d, e.y + gy * d)) [gx, gy] = rotate(ux, uy, -e.off);
      if (!heroCanStand(p, e.x + gx * d, e.y + gy * d)) [gx, gy] = [ux, uy];
    }
    const step = e.gap > 0 ? (2 * PI - e.gap) / Math.max(1, e.n - 1) : (2 * PI) / e.n;
    for (let k = 0; k < e.n; k++) {
      const [dx, dy] = rotate(gx, gy, e.gap / 2 + k * step);
      tagged(spawn(s, p, 'rune_shard', e.x + dx * RUNE_OFFSET, e.y + dy * RUNE_OFFSET, dx * e.speed, dy * e.speed, {}, s.tick - e.tele), e.pack);
    }
  } else if (e.op === 'aim') {
    if (d2(e.x, e.y, h.x, h.y) < e.minDist * e.minDist) return;
    const [ax, ay] = aimAt(s, e.x, e.y, h.x, h.y, e.spread);
    tagged(spawn(s, p, e.kind, e.x + ax * CASTER_MUZZLE, e.y + ay * CASTER_MUZZLE, ax * e.speed, ay * e.speed, {}, e.tele < 0 ? 0 : s.tick - e.tele), e.pack);
  } else {
    const [x, y] = farPoint(s, p, e.minDist);
    const dt = Math.max(1, s.tick - e.t0);
    const flight = Math.sqrt(d2(x, y, h.x, h.y)) / Math.max(1e-6, e.speed);
    // aim ahead of the hero's average drift, at a point the hero can actually be at
    const tx = Math.min(p.x1 - p.heroInset, Math.max(p.x0 + p.heroInset, h.x + ((h.x - e.hx) / dt) * flight * e.lead));
    const ty = Math.min(p.y1 - p.heroInset, Math.max(p.y0 + p.heroInset, h.y + ((h.y - e.hy) / dt) * flight * e.lead));
    const [ax, ay] = aimAt(s, x, y, tx, ty, 0);
    tagged(spawn(s, p, 'orb_small', x, y, ax * e.speed, ay * e.speed), e.pack);
  }
}

/**
 * Once per tick, after the director: launch the emissions that are due (in the order they were queued) and tag the
 * shots a pack stalker fired this tick. Emissions already queued still finish during a boss intro or fight, exactly
 * like rune telegraphs and casters already on the field; no new set piece is started there (the director's gating).
 */
export function runPatternPack(s: SimState, p: SimParams, spawn: PackSpawn): void {
  const q = s.packQueue;
  if (q && q.length) {
    const keep: PackEvent[] = [];
    for (const e of q) {
      if (e.at > s.tick) keep.push(e);
      else fire(s, p, e, spawn);
    }
    s.packQueue = keep;
  }
  for (const c of s.casters) {
    if (!c.pack || c.fire !== s.tick) continue;
    const near = (CASTER_MUZZLE + 2) * (CASTER_MUZZLE + 2);
    for (const pr of s.projectiles) if (pr.born === s.tick && !pr.pack && d2(pr.x, pr.y, c.x, c.y) <= near) pr.pack = c.pack;
  }
}
