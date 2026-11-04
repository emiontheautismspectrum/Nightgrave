/**
 * Wave director: decides what spawns when. Everything is driven by the sim's seeded PRNG and tick
 * counter, so the same seed + inputs always produce the same threats.
 */
import { RUNES } from '../data/arena';
import { dcos, dsin, PI, rotate } from './dmath';
import type { SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Projectile, ProjectileKind, SimState } from './state';

export interface DirectorOptions {
  /** Test-only: start the run at this wave (all threat types unlocked). Not part of replays. */
  startWave?: number;
}

const dist2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export const waveSpeed = (p: SimParams, wave: number): number => Math.min(p.speedCap, 1 + p.speedStep * Math.max(0, wave));
export const waveDensity = (p: SimParams, wave: number): number =>
  Math.min(p.densityCap, 1 + p.densityStep * Math.max(0, wave)) * p.density;

/**
 * The single entry point for creating projectiles. `telegraphTicks` = how long the spawn was visibly
 * announced. The spawn event carries distance and telegraph so the fairness rule is checkable.
 */
export function spawnProjectile(
  s: SimState,
  p: SimParams,
  kind: ProjectileKind,
  x: number,
  y: number,
  vx: number,
  vy: number,
  extra: Partial<Pick<Projectile, 'homing' | 'turnC' | 'turnS' | 'expires' | 'fadeEnd'>> = {},
  telegraphTicks = 0,
): Projectile {
  const radius =
    kind === 'orb_large' ? p.largeRadius
    : kind === 'rune_shard' ? p.shardRadius
    : kind === 'blade' ? p.bladeRadius
    : kind === 'wraith' ? p.wraithRadius
    : p.smallRadius;
  const pr: Projectile = {
    id: s.nextId++,
    kind,
    x,
    y,
    vx,
    vy,
    radius,
    parryable: kind !== 'blade',
    born: s.tick,
    speed: Math.sqrt(vx * vx + vy * vy),
    homing: extra.homing ?? 0,
    turnC: extra.turnC ?? 1,
    turnS: extra.turnS ?? 0,
    expires: extra.expires ?? -1,
    fadeEnd: extra.fadeEnd ?? -1,
  };
  s.projectiles.push(pr);
  s.events.push({
    type: 'spawn',
    id: pr.id,
    kind,
    dist: Math.sqrt(dist2(x, y, s.hero.x, s.hero.y)),
    telegraphTicks,
  });
  return pr;
}

/** A point on the spawn ring at least fairDistance from the hero (deterministic retries, then the far side). */
function edgePoint(s: SimState, p: SimParams): [number, number] {
  const fair2 = p.fairDistance * p.fairDistance;
  for (let i = 0; i < 6; i++) {
    const a = nextFloat(s) * 2 * PI;
    const x = p.cx + dcos(a) * p.spawnRadius;
    const y = p.cy + dsin(a) * p.spawnRadius;
    if (dist2(x, y, s.hero.x, s.hero.y) >= fair2) return [x, y];
  }
  const dx = s.hero.x - p.cx;
  const dy = s.hero.y - p.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return [p.cx + p.spawnRadius, p.cy];
  return [p.cx - (dx / d) * p.spawnRadius, p.cy - (dy / d) * p.spawnRadius];
}

/** Unit vector from (x, y) towards the hero, rotated by a random error in [-spread, spread]. */
function aimAtHero(s: SimState, x: number, y: number, spread: number): [number, number] {
  const dx = s.hero.x - x;
  const dy = s.hero.y - y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return rotate(dx / d, dy / d, range(s, -spread, spread));
}

const countFor = (c: { count: number; countPerWave: number; maxCount: number }, wave: number): number =>
  Math.min(c.maxCount, c.count + Math.floor(c.countPerWave * wave));

// ------------------------------------------------------------------ patterns

function streamOrb(s: SimState, p: SimParams, sp: number): void {
  const [x, y] = edgePoint(s, p);
  const large = nextFloat(s) < p.streamLargeChance;
  const [dx, dy] = aimAtHero(s, x, y, p.spread);
  const v = (large ? p.largeSpeed : p.smallSpeed) * sp;
  spawnProjectile(s, p, large ? 'orb_large' : 'orb_small', x, y, dx * v, dy * v);
}

function orbFan(s: SimState, p: SimParams, sp: number): void {
  const c = p.patterns.orbFan;
  const n = countFor(c, s.wave);
  const [x, y] = edgePoint(s, p);
  const [ax, ay] = aimAtHero(s, x, y, 0.1);
  const v = p.smallSpeed * sp;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : -c.arc / 2 + (c.arc * i) / (n - 1);
    const [dx, dy] = rotate(ax, ay, off);
    spawnProjectile(s, p, 'orb_small', x, y, dx * v, dy * v);
  }
}

function heavyOrbs(s: SimState, p: SimParams, sp: number): void {
  const n = countFor(p.patterns.heavyOrbs, s.wave);
  for (let i = 0; i < n; i++) {
    const [x, y] = edgePoint(s, p);
    const [dx, dy] = aimAtHero(s, x, y, p.spread);
    const v = p.largeSpeed * sp;
    spawnProjectile(s, p, 'orb_large', x, y, dx * v, dy * v);
  }
}

function runeBurst(s: SimState, p: SimParams, sp: number): void {
  const c = p.patterns.runeBurst;
  let rune = Math.floor(nextFloat(s) * RUNES.length);
  for (let i = 0; i < RUNES.length && s.telegraphs.some((t) => t.rune === rune); i++) rune = (rune + 1) % RUNES.length;
  if (s.telegraphs.some((t) => t.rune === rune)) return;
  const r = RUNES[rune];
  if (!r) return;
  s.telegraphs.push({
    id: s.nextId++,
    rune,
    x: r.x,
    y: r.y,
    start: s.tick,
    fire: s.tick + p.runeTelegraph,
    shards: Math.min(c.maxShards, c.shards + Math.floor(c.shardsPerWave * s.wave)),
    speed: p.shardSpeed * sp,
  });
  s.events.push({ type: 'telegraph', id: s.nextId - 1, rune });
}

function blades(s: SimState, p: SimParams, sp: number): void {
  const n = countFor(p.patterns.blades, s.wave);
  for (let i = 0; i < n; i++) {
    const [x, y] = edgePoint(s, p);
    const [dx, dy] = aimAtHero(s, x, y, p.bladeSpread);
    const curve = range(s, -p.bladeCurve, p.bladeCurve);
    const v = p.bladeSpeed * sp;
    spawnProjectile(s, p, 'blade', x, y, dx * v, dy * v, { turnC: dcos(curve), turnS: dsin(curve) });
  }
}

function wraiths(s: SimState, p: SimParams, sp: number): void {
  const n = countFor(p.patterns.wraiths, s.wave);
  for (let i = 0; i < n; i++) {
    const [x, y] = edgePoint(s, p);
    const [dx, dy] = aimAtHero(s, x, y, 0);
    const v = p.wraithSpeed * sp;
    const expires = s.tick + p.wraithLife;
    spawnProjectile(s, p, 'wraith', x, y, dx * v, dy * v, {
      homing: p.wraithSteer,
      expires,
      fadeEnd: expires + p.wraithFade,
    });
  }
}

type PatternKey = 'orbFan' | 'runeBurst' | 'blades' | 'wraiths' | 'heavyOrbs';
const PATTERNS: [PatternKey, (s: SimState, p: SimParams, sp: number) => void][] = [
  ['orbFan', orbFan],
  ['runeBurst', runeBurst],
  ['blades', blades],
  ['wraiths', wraiths],
  ['heavyOrbs', heavyOrbs],
];

function pickPattern(s: SimState, p: SimParams): (s: SimState, p: SimParams, sp: number) => void {
  let total = 0;
  for (const [k] of PATTERNS) if (s.wave >= p.patterns[k].unlockWave) total += p.patterns[k].weight;
  let r = nextFloat(s) * total;
  for (const [k, fn] of PATTERNS) {
    if (s.wave < p.patterns[k].unlockWave) continue;
    r -= p.patterns[k].weight;
    if (r < 0) return fn;
  }
  return orbFan;
}

// ------------------------------------------------------------------ per-tick director

export function runDirector(s: SimState, p: SimParams, opts: DirectorOptions): void {
  if (s.tick < p.graceTicks) return;
  const wave = (opts.startWave ?? 0) + Math.floor((s.tick - p.graceTicks) / p.waveTicks);
  if (wave !== s.wave) {
    s.wave = wave;
    s.events.push({ type: 'wave', wave });
  }
  const sp = waveSpeed(p, wave);
  const dens = waveDensity(p, wave);

  // rune telegraphs that are due fire their ring now
  const pending = [];
  for (const t of s.telegraphs) {
    if (s.tick < t.fire) {
      pending.push(t);
      continue;
    }
    const base = nextFloat(s) * 2 * PI;
    for (let k = 0; k < t.shards; k++) {
      const a = base + (2 * PI * k) / t.shards;
      const dx = dcos(a);
      const dy = dsin(a);
      spawnProjectile(s, p, 'rune_shard', t.x + dx * 4, t.y + dy * 4, dx * t.speed, dy * t.speed, {}, s.tick - t.start);
    }
  }
  s.telegraphs = pending;

  s.streamTimer -= 1;
  if (s.streamTimer <= 0) {
    streamOrb(s, p, sp);
    s.streamTimer += p.streamInterval / dens;
  }
  if (s.tick >= s.patternAt) {
    pickPattern(s, p)(s, p, sp);
    s.patternAt = s.tick + Math.max(1, Math.round(range(s, p.gapMin, p.gapMax) / dens));
  }
}

/** Advance one projectile by a tick (curve, homing, move). */
export function moveProjectile(s: SimState, pr: Projectile): void {
  if (pr.turnS !== 0) {
    const vx = pr.vx * pr.turnC - pr.vy * pr.turnS;
    pr.vy = pr.vx * pr.turnS + pr.vy * pr.turnC;
    pr.vx = vx;
  }
  if (pr.homing > 0 && !isFading(s, pr)) {
    const dx = s.hero.x - pr.x;
    const dy = s.hero.y - pr.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      pr.vx += ((dx / d) * pr.speed - pr.vx) * pr.homing;
      pr.vy += ((dy / d) * pr.speed - pr.vy) * pr.homing;
      const v = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
      if (v > 1e-9) {
        pr.vx = (pr.vx / v) * pr.speed;
        pr.vy = (pr.vy / v) * pr.speed;
      }
    }
  }
  pr.x += pr.vx;
  pr.y += pr.vy;
}

/** Fading projectiles (an expired wraith) are visible but harmless and cannot be parried. */
export const isFading = (s: SimState, pr: Projectile): boolean => pr.expires >= 0 && s.tick >= pr.expires;
