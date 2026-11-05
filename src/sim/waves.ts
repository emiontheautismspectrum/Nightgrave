/**
 * Wave director: decides what spawns when. Everything is driven by the sim's seeded PRNG and tick
 * counter, so the same seed + inputs always produce the same threats.
 */
import { HOLLOWS, PORTAL, RUNES } from '../data/arena';
import { dcos, dsin, PI, rotate } from './dmath';
import { isBossWave, rotateBeams, runBoss, startBoss } from './boss';
import type { SimParams } from './params';
import { nextFloat, range } from './rng';
import type { Caster, CasterAttack, CasterKind, Projectile, ProjectileKind, SimState } from './state';

export interface DirectorOptions {
  /** Test-only: start the run at this wave (all threat types unlocked). Not part of replays. */
  startWave?: number;
  /** Test-only: disable bosses (boss waves play as normal waves). Default true. */
  bosses?: boolean;
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
  extra: Partial<Pick<Projectile, 'homing' | 'turnC' | 'turnS' | 'expires' | 'fadeEnd' | 'boss'>> = {},
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
    boss: extra.boss ?? 0,
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

/** Point at distance `t` along the perimeter of the spawn rectangle (arena rect grown by spawnOffset). */
function perimeterPoint(p: SimParams, t: number): [number, number] {
  const o = p.spawnOffset;
  const x0 = p.x0 - o;
  const y0 = p.y0 - o;
  const w = p.x1 - p.x0 + 2 * o;
  const h = p.y1 - p.y0 + 2 * o;
  if (t < w) return [x0 + t, y0];
  t -= w;
  if (t < h) return [x0 + w, y0 + t];
  t -= h;
  if (t < w) return [x0 + w - t, y0 + h];
  t -= w;
  return [x0, y0 + h - t];
}

/** A point just outside the arena at least fairDistance from the hero (seeded retries, then the farthest corner). */
export function edgePoint(s: SimState, p: SimParams): [number, number] {
  const fair2 = p.fairDistance * p.fairDistance;
  const o = p.spawnOffset;
  const per = 2 * (p.x1 - p.x0 + 2 * o) + 2 * (p.y1 - p.y0 + 2 * o);
  for (let i = 0; i < 6; i++) {
    const [x, y] = perimeterPoint(p, nextFloat(s) * per);
    if (dist2(x, y, s.hero.x, s.hero.y) >= fair2) return [x, y];
  }
  const corners: [number, number][] = [
    [p.x0 - o, p.y0 - o],
    [p.x1 + o, p.y0 - o],
    [p.x1 + o, p.y1 + o],
    [p.x0 - o, p.y1 + o],
  ];
  let best = corners[0]!;
  for (const c of corners) if (dist2(c[0], c[1], s.hero.x, s.hero.y) > dist2(best[0], best[1], s.hero.x, s.hero.y)) best = c;
  return best;
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

// ------------------------------------------------------------------ casters

const SHADE_ATTACKS: CasterAttack[] = ['orbFan', 'wraith', 'shardFan'];
const STALKER_ATTACKS: CasterAttack[] = ['orbFan', 'shardFan', 'blade'];

function summon(s: SimState, p: SimParams, kind: CasterKind): boolean {
  if (s.casters.length >= p.casterMax) return false;
  let source = -1;
  let x = PORTAL.x;
  let y = PORTAL.y;
  if (kind === 'shade') {
    if (s.casters.some((c) => c.source === -1)) return false;
  } else {
    const free = HOLLOWS.map((_h, i) => i).filter((i) => !s.casters.some((c) => c.source === i));
    if (free.length === 0) return false;
    source = free[Math.floor(nextFloat(s) * free.length)] ?? free[0]!;
    const h = HOLLOWS[source]!;
    const k = p.hollowInset;
    x = h.side === 'left' ? h.x + k : h.side === 'right' ? h.x - k : h.x;
    y = h.side === 'top' ? h.y + k : h.side === 'bottom' ? h.y - k : h.y;
  }
  const attacks = kind === 'shade' ? SHADE_ATTACKS : STALKER_ATTACKS;
  const attack = attacks[Math.floor(nextFloat(s) * attacks.length)] ?? 'orbFan';
  const idle = p.casterIdleMin + Math.floor(nextFloat(s) * (p.casterIdleMax - p.casterIdleMin + 1));
  const start = s.tick;
  const appear0 = start + p.casterTele;
  const appear = appear0 + p.casterRise;
  const castStart = appear + idle;
  const fire = castStart + p.casterCast;
  const c: Caster = { id: s.nextId++, kind, source, x, y, start, appear0, appear, castStart, fire, end: fire + p.casterDissolve, attack };
  s.casters.push(c);
  s.events.push({ type: 'caster', id: c.id, kind, source });
  return true;
}

/** Hero closer than this to a caster when it fires: the cast fizzles (no point-blank shots, e.g. blades on the hero). */
export const CASTER_POINT_BLANK = 16;

/** The caster's single attack, launched from where it stands (telegraphed since c.start). */
function casterAttack(s: SimState, p: SimParams, c: Caster, sp: number): void {
  const tele = s.tick - c.start;
  if (dist2(c.x, c.y, s.hero.x, s.hero.y) < CASTER_POINT_BLANK * CASTER_POINT_BLANK) {
    s.events.push({ type: 'caster_fizzle', id: c.id });
    return;
  }
  const [ax, ay] = aimAtHero(s, c.x, c.y, 0.08);
  const ox = c.x + ax * 6;
  const oy = c.y + ay * 6;
  if (c.attack === 'orbFan' || c.attack === 'shardFan') {
    const shard = c.attack === 'shardFan';
    const n = shard ? p.shardFanCount : countFor(p.patterns.orbFan, s.wave);
    const arc = shard ? p.shardFanArc : p.patterns.orbFan.arc;
    const v = (shard ? p.shardSpeed : p.smallSpeed) * sp;
    for (let i = 0; i < n; i++) {
      const [dx, dy] = rotate(ax, ay, n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1));
      spawnProjectile(s, p, shard ? 'rune_shard' : 'orb_small', ox, oy, dx * v, dy * v, {}, tele);
    }
  } else if (c.attack === 'wraith') {
    const v = p.wraithSpeed * sp;
    const expires = s.tick + p.wraithLife;
    spawnProjectile(s, p, 'wraith', ox, oy, ax * v, ay * v, { homing: p.wraithSteer, expires, fadeEnd: expires + p.wraithFade }, tele);
  } else {
    const v = p.bladeSpeed * sp;
    spawnProjectile(s, p, 'blade', ox, oy, ax * v, ay * v, {}, tele);
  }
  s.events.push({ type: 'caster_fire', id: c.id, attack: c.attack });
}

function runCasters(s: SimState, p: SimParams, sp: number): void {
  const keep: Caster[] = [];
  for (const c of s.casters) {
    if (s.tick === c.fire) casterAttack(s, p, c, sp);
    if (s.tick < c.end) keep.push(c);
  }
  s.casters = keep;
}

type PatternKey = 'orbFan' | 'runeBurst' | 'blades' | 'wraiths' | 'heavyOrbs' | 'shade' | 'stalker';
const PATTERNS: [PatternKey, (s: SimState, p: SimParams, sp: number) => void][] = [
  ['orbFan', orbFan],
  ['runeBurst', runeBurst],
  ['blades', blades],
  ['wraiths', wraiths],
  ['heavyOrbs', heavyOrbs],
  // a summon that cannot happen (cap reached, source busy) falls back to an orb fan
  ['shade', (s, p, sp) => void (summon(s, p, 'shade') || orbFan(s, p, sp))],
  ['stalker', (s, p, sp) => void (summon(s, p, 'stalker') || orbFan(s, p, sp))],
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

function fireTelegraphs(s: SimState, p: SimParams): void {
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
}

export function runDirector(s: SimState, p: SimParams, opts: DirectorOptions): void {
  if (s.tick < p.graceTicks) return;
  const startWave = opts.startWave ?? 0;
  // boss fight (incl. its death sequence) and the break after it: the wave clock is paused, nothing new is set up;
  // rune telegraphs and casters already on the field still finish
  if (s.boss || s.breakUntil > s.tick) {
    fireTelegraphs(s, p);
    runCasters(s, p, waveSpeed(p, s.wave));
    runBoss(s, p, spawnProjectile);
    return;
  }
  if (s.beams.length > 0) rotateBeams(s); // never left behind by a removed boss
  if (s.breakUntil >= 0 && s.breakUntil <= s.tick) {
    // the break just ended: resume with fresh timers so nothing fires on the first tick
    s.breakUntil = -1;
    s.streamTimer = p.streamInterval / waveDensity(p, s.wave + 1);
    s.patternAt = s.tick + Math.round(p.gapMin / waveDensity(p, s.wave + 1));
  }
  const wave = startWave + Math.floor(s.waveClock / p.waveTicks);
  if (wave !== s.wave) {
    s.wave = wave;
    s.events.push({ type: 'wave', wave });
  }
  if (opts.bosses !== false && isBossWave(p, wave) && s.bossWave !== wave) {
    // the boss replaces this wave; the wave clock stays paused until it is defeated and the break is over
    s.bossWave = wave;
    startBoss(s, p, wave);
    s.waveClock = (wave - startWave + 1) * p.waveTicks;
    fireTelegraphs(s, p);
    runCasters(s, p, waveSpeed(p, wave));
    return;
  }
  s.waveClock++;
  const sp = waveSpeed(p, wave);
  const dens = waveDensity(p, wave);

  fireTelegraphs(s, p);
  runCasters(s, p, sp);

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
export function moveProjectile(s: SimState, pr: Projectile, f = 1): void {
  if (pr.turnS !== 0) {
    // Slow Time scales the turn with the distance moved, so curved paths keep their shape
    const ts = f === 1 ? pr.turnS : pr.turnS * f;
    const tc = f === 1 ? pr.turnC : Math.sqrt(1 - ts * ts);
    const vx = pr.vx * tc - pr.vy * ts;
    pr.vy = pr.vx * ts + pr.vy * tc;
    pr.vx = vx;
  }
  if (pr.homing > 0 && !isFading(s, pr)) {
    const dx = s.hero.x - pr.x;
    const dy = s.hero.y - pr.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      pr.vx += ((dx / d) * pr.speed - pr.vx) * pr.homing * f;
      pr.vy += ((dy / d) * pr.speed - pr.vy) * pr.homing * f;
      const v = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
      if (v > 1e-9) {
        pr.vx = (pr.vx / v) * pr.speed;
        pr.vy = (pr.vy / v) * pr.speed;
      }
    }
  }
  pr.x += pr.vx * f;
  pr.y += pr.vy * f;
}

/** Fading projectiles (an expired wraith) are visible but harmless and cannot be parried. */
export const isFading = (s: SimState, pr: Projectile): boolean => pr.expires >= 0 && s.tick >= pr.expires;
