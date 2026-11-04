import { TICK_RATE, type Difficulty } from '../data/tuning';
import { dcos, dsin, PI, rotate } from './dmath';
import { AXIS_MAX, BTN_DASH, BTN_PARRY, sanitizeInput, type InputFrame } from './input';
import { makeParams, type SimParams } from './params';
import { nextFloat, range, toSeed } from './rng';
import { NEVER, type Projectile, type ProjectileKind, type SimState } from './state';

export interface SimOptions {
  /** Disable the automatic spawner (tests place projectiles by hand). Default true. */
  spawner?: boolean;
}

export function createState(seed: number, difficulty: Difficulty, p: SimParams = makeParams(difficulty)): SimState {
  const s = toSeed(seed);
  return {
    seed: s,
    difficulty,
    tick: 0,
    rng: s,
    hero: {
      x: p.cx,
      y: p.cy,
      dirX: 1,
      dirY: 0,
      facing: 1,
      parryStart: NEVER,
      parryHit: true,
      parryBufferedUntil: -1,
      dashStart: NEVER,
      dashBufferedUntil: -1,
      dashDirX: 1,
      dashDirY: 0,
    },
    projectiles: [],
    nextId: 1,
    alive: true,
    deathTick: -1,
    survivalTicks: 0,
    parryScoreHundredths: 0,
    multiplier: p.multStart,
    lastParryTick: -1,
    parryCount: 0,
    spawnTimer: 0,
    events: [],
  };
}

// ------------------------------------------------------------------ queries (render + tests)

export const isParryActive = (s: SimState, p: SimParams): boolean => s.tick - s.hero.parryStart < p.parryActive;
export const isDashing = (s: SimState, p: SimParams): boolean => s.tick - s.hero.dashStart < p.dashTicks;
export const isInvulnerable = (s: SimState, p: SimParams): boolean => s.tick - s.hero.dashStart < p.dashInvuln;
/** Cooldown of the current/last parry: short after a hit, long after a whiff. */
export const parryCooldownOf = (s: SimState, p: SimParams): number =>
  s.hero.parryHit ? p.parryCooldown : p.parryWhiffCooldown;
export const parryCooldownLeft = (s: SimState, p: SimParams): number =>
  Math.max(0, parryCooldownOf(s, p) - (s.tick - s.hero.parryStart));
export const dashCooldownLeft = (s: SimState, p: SimParams): number =>
  Math.max(0, p.dashCooldown - (s.tick - s.hero.dashStart));

/** Total score as an integer. */
export function score(s: SimState, p: SimParams): number {
  return Math.floor((s.survivalTicks * p.survivalPerSecond) / TICK_RATE) + Math.floor(s.parryScoreHundredths / 100);
}

/** Project a point onto the disc (cx, cy, r) if it lies outside it. */
export function clampToCircle(x: number, y: number, cx: number, cy: number, r: number): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 <= r * r) return [x, y];
  const d = Math.sqrt(d2);
  return [cx + (dx / d) * r, cy + (dy / d) * r];
}

// ------------------------------------------------------------------ spawning

export function spawnProjectile(
  s: SimState,
  p: SimParams,
  kind: ProjectileKind,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Projectile {
  const pr: Projectile = {
    id: s.nextId++,
    kind,
    x,
    y,
    vx,
    vy,
    radius: kind === 'orb_large' ? p.largeRadius : p.smallRadius,
    parryable: true,
    born: s.tick,
  };
  s.projectiles.push(pr);
  s.events.push({ type: 'spawn', id: pr.id });
  return pr;
}

function spawnAimedOrb(s: SimState, p: SimParams): void {
  const ang = nextFloat(s) * 2 * PI;
  const x = p.cx + dcos(ang) * p.spawnRadius;
  const y = p.cy + dsin(ang) * p.spawnRadius;
  const large = nextFloat(s) < p.largeChance;
  const err = range(s, -p.spread, p.spread);
  let dx = s.hero.x - x;
  let dy = s.hero.y - y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  [dx, dy] = rotate(dx / d, dy / d, err);
  const speed = large ? p.largeSpeed : p.smallSpeed;
  spawnProjectile(s, p, large ? 'orb_large' : 'orb_small', x, y, dx * speed, dy * speed);
}

function runSpawner(s: SimState, p: SimParams): void {
  if (s.tick < p.graceTicks) return;
  const t = Math.min(1, (s.tick - p.graceTicks) / p.rampTicks);
  const interval = p.startInterval + (p.minInterval - p.startInterval) * t;
  s.spawnTimer -= 1;
  let guard = 0;
  while (s.spawnTimer <= 0 && guard++ < 16) {
    spawnAimedOrb(s, p);
    s.spawnTimer += interval;
  }
}

// ------------------------------------------------------------------ the tick

/**
 * Advance the simulation by exactly one tick. Pure function of (state, input, params): no clocks,
 * no Math.random. Order: input -> abilities -> hero move -> spawn -> projectile move ->
 * parry -> hits -> despawn. Does nothing once the hero is dead.
 */
export function step(s: SimState, rawInput: InputFrame, p: SimParams, opts: SimOptions = {}): void {
  s.events = [];
  if (!s.alive) return;
  const input = sanitizeInput(rawInput);
  const h = s.hero;
  const t = s.tick;

  // 1. buffer presses
  if (input.buttons & BTN_PARRY) h.parryBufferedUntil = t + p.parryBuffer;
  if (input.buttons & BTN_DASH) h.dashBufferedUntil = t + p.dashBuffer;

  // 2. movement intent (unit direction + how far the hero wants to go this tick)
  let ix = 0;
  let iy = 0;
  let want = 0;
  if (input.cursor) {
    const [tx, ty] = clampToCircle(input.mx, input.my, p.cx, p.cy, p.playRadius);
    const dx = tx - h.x;
    const dy = ty - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      ix = dx / d;
      iy = dy / d;
      want = Math.min(d, p.heroSpeed);
    }
  } else {
    const ax = input.mx / AXIS_MAX;
    const ay = input.my / AXIS_MAX;
    const m = Math.sqrt(ax * ax + ay * ay);
    if (m > 1e-6) {
      ix = ax / m;
      iy = ay / m;
      want = Math.min(m, 1) * p.heroSpeed;
    }
  }

  // 3. abilities (a buffered press fires on the first tick its cooldown allows)
  if (h.parryBufferedUntil >= t && t - h.parryStart >= parryCooldownOf(s, p)) {
    h.parryStart = t;
    h.parryHit = false;
    h.parryBufferedUntil = -1;
    s.events.push({ type: 'parry_start' });
  }
  if (h.dashBufferedUntil >= t && t - h.dashStart >= p.dashCooldown) {
    h.dashStart = t;
    h.dashBufferedUntil = -1;
    h.dashDirX = want > 0 ? ix : h.dirX;
    h.dashDirY = want > 0 ? iy : h.dirY;
    s.events.push({ type: 'dash_start', dirX: h.dashDirX, dirY: h.dashDirY });
  }

  // 4. hero movement
  let mx: number;
  let my: number;
  if (isDashing(s, p)) {
    mx = h.dashDirX * p.dashSpeed;
    my = h.dashDirY * p.dashSpeed;
  } else {
    mx = ix * want;
    my = iy * want;
    if (want > 0) {
      h.dirX = ix;
      h.dirY = iy;
    }
  }
  [h.x, h.y] = clampToCircle(h.x + mx, h.y + my, p.cx, p.cy, p.playRadius);
  if (mx > 0.01) h.facing = 1;
  else if (mx < -0.01) h.facing = -1;

  // 5. spawn + move projectiles
  if (opts.spawner !== false) runSpawner(s, p);
  for (const pr of s.projectiles) {
    pr.x += pr.vx;
    pr.y += pr.vy;
  }

  // 6. multiplier decay, then parry (parry is resolved before hits, so it always wins)
  if (s.lastParryTick >= 0 && t - s.lastParryTick >= p.multReset) s.multiplier = p.multStart;
  if (isParryActive(s, p)) {
    const keep: Projectile[] = [];
    for (const pr of s.projectiles) {
      const dx = pr.x - h.x;
      const dy = pr.y - h.y;
      const r = p.parryRadius + pr.radius;
      if (pr.parryable && dx * dx + dy * dy <= r * r) {
        const points = p.parryBase * s.multiplier; // hundredths of a point
        s.parryScoreHundredths += points;
        s.events.push({ type: 'parry_hit', x: pr.x, y: pr.y, points: points / 100, multiplier: s.multiplier / 100 });
        s.multiplier = Math.min(p.multCap, s.multiplier + p.multStep);
        s.lastParryTick = t;
        s.parryCount++;
        h.parryHit = true;
      } else keep.push(pr);
    }
    s.projectiles = keep;
  }

  // 7. hits: one hit = death
  if (!isInvulnerable(s, p)) {
    for (const pr of s.projectiles) {
      const dx = pr.x - h.x;
      const dy = pr.y - h.y;
      const r = p.heroRadius + pr.radius;
      if (dx * dx + dy * dy < r * r) {
        s.alive = false;
        s.deathTick = t;
        s.events.push({ type: 'death', x: h.x, y: h.y, by: pr.id });
        break;
      }
    }
  }

  // 8. despawn off-arena projectiles
  const dr2 = p.despawnRadius * p.despawnRadius;
  s.projectiles = s.projectiles.filter((pr) => (pr.x - p.cx) * (pr.x - p.cx) + (pr.y - p.cy) * (pr.y - p.cy) < dr2);

  if (s.alive) s.survivalTicks++;
  s.tick++;
}

/** Convenience wrapper: owns state + params and records the sanitized input log for replays. */
export class Sim {
  readonly params: SimParams;
  readonly state: SimState;
  readonly log: InputFrame[] = [];

  constructor(
    seed: number,
    readonly difficulty: Difficulty,
    readonly options: SimOptions = {},
  ) {
    this.params = makeParams(difficulty);
    this.state = createState(seed, difficulty, this.params);
  }

  step(input: InputFrame): void {
    if (!this.state.alive) {
      this.state.events = [];
      return;
    }
    const clean = sanitizeInput(input);
    this.log.push(clean);
    step(this.state, clean, this.params, this.options);
  }

  get score(): number {
    return score(this.state, this.params);
  }
}
