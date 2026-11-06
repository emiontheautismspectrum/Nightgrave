import { TICK_RATE, type Difficulty } from '../data/tuning';
import { AXIS_MAX, BTN_DASH, BTN_PARRY, sanitizeInput, type InputFrame } from './input';
import { beamHits, onBossParry } from './boss';
import { makeParams, ticks, type SimParams } from './params';
import { isDouble, isSlow, runPickups } from './pickups';
import { toSeed } from './rng';
import { NEVER, type Hero, type Projectile, type SimState } from './state';
import { inParryZone, segDist2 } from './parryZone';
import type { AnyHeroId } from '../data/heroes';
import { isFading, moveProjectile, runDirector, sigilHits, splitBurst, type DirectorOptions } from './waves';

export { spawnProjectile } from './waves';

export interface SimOptions extends DirectorOptions {
  /** Disable the wave director (tests place projectiles by hand). Default true. */
  spawner?: boolean;
  /**
   * The hero of the run (part of the run definition: it changes the rules). Default: the test-only 'classic' hero
   * (the pre-heroes rules) so the old tests keep their numbers; the game, the verifier and the bots always pass it.
   */
  hero?: AnyHeroId;
}

export function createState(seed: number, difficulty: Difficulty, hero: AnyHeroId = 'classic', p: SimParams = makeParams(difficulty, hero)): SimState {
  const s = toSeed(seed);
  return {
    seed: s,
    difficulty,
    heroId: hero,
    trail: [],
    trailKills: 0,
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
      parryKills: 0,
      parryClose: false,
      parryScored: true,
      parryBufferedUntil: -1,
      dashStart: NEVER,
      dashBufferedUntil: -1,
      dashDirX: 1,
      dashDirY: 0,
      // the hero spawns at the arena centre: the initial aim is to the right (the sprite faces right)
      aimX: 1,
      aimY: 0,
      guardCharges: 0,
      guardInvulnUntil: -1,
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
    wave: -1,
    streamTimer: 0,
    patternAt: p.graceTicks + Math.round(p.gapMin),
    telegraphs: [],
    casters: [],
    sigils: [],
    waveClock: 0,
    boss: null,
    beams: [],
    bossMet: { eye: 0, lich: 0 },
    bossesDefeated: 0,
    bossWave: -1,
    breakUntil: -1,
    bossScore: 0,
    emberCharges: 0,
    pickup: null,
    pickupAt: ticks(p.pickups.firstSeconds),
    pickupScore: 0,
    slowUntil: -1,
    doubleUntil: -1,
    doubleTicks: 0,
    events: [],
  };
}

// ------------------------------------------------------------------ queries (render + tests)

/** Parry active ticks, lengthened by ember charges (capped). */
export const parryActiveTicks = (s: SimState, p: SimParams): number =>
  p.parryActiveByCharge[Math.min(s.emberCharges, p.parryActiveByCharge.length - 1)] ?? p.parryActive;
export const isParryActive = (s: SimState, p: SimParams): boolean => s.tick - s.hero.parryStart < parryActiveTicks(s, p);
export const isDashing = (s: SimState, p: SimParams): boolean => s.tick - s.hero.dashStart < p.dashTicks;
/** ONE invulnerability test (the sim and the renderer): the dash i-frames or the Knight's guard break. */
export const isInvulnerable = (s: SimState, p: SimParams): boolean => s.tick - s.hero.dashStart < p.dashInvuln || s.tick < s.hero.guardInvulnUntil;
/** Cooldown of the current/last parry: short after a hit, long after a whiff. */
export const parryCooldownOf = (s: SimState, p: SimParams): number =>
  !s.hero.parryHit ? p.parryWhiffCooldown : s.hero.parryScored ? p.parryCooldown : p.parryCrackCooldown;
export const parryCooldownLeft = (s: SimState, p: SimParams): number =>
  Math.max(0, parryCooldownOf(s, p) - (s.tick - s.hero.parryStart));
export const dashCooldownLeft = (s: SimState, p: SimParams): number =>
  Math.max(0, p.dashCooldown - (s.tick - s.hero.dashStart));
export { isFading };

/**
 * Total score as an integer: survival (Double Score ticks count twice) + parry points (doubled under Double Score at
 * award time) + pickup points + boss kills (fixed, never multiplied).
 */
export function score(s: SimState, p: SimParams): number {
  return (
    Math.floor(((s.survivalTicks + s.doubleTicks) * p.survivalPerSecond) / TICK_RATE) +
    Math.floor(s.parryScoreHundredths / 100) +
    s.pickupScore +
    s.bossScore
  );
}

/** Clamp a point into the hero's allowed area: the arena rectangle shrunk by heroInset. */
export function clampToArena(x: number, y: number, p: SimParams): [number, number] {
  const i = p.heroInset;
  return [x < p.x0 + i ? p.x0 + i : x > p.x1 - i ? p.x1 - i : x, y < p.y0 + i ? p.y0 + i : y > p.y1 - i ? p.y1 - i : y];
}

/**
 * Movement intent for one tick: unit direction (ix, iy) and how far the hero wants to go (want, px). Pure: the sim and
 * the renderer (dash indicator) share it, so the indicator can never disagree with the real dash.
 */
export function moveIntent(h: Pick<Hero, 'x' | 'y'>, input: InputFrame, p: SimParams): { ix: number; iy: number; want: number } {
  let ix = 0;
  let iy = 0;
  let want = 0;
  if (input.cursor) {
    const [tx, ty] = clampToArena(input.mx, input.my, p);
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
  return { ix, iy, want };
}

/** The direction a dash pressed with this input would take: toward the movement intent, else the last facing. */
export function dashDirection(h: Pick<Hero, 'x' | 'y' | 'dirX' | 'dirY'>, input: InputFrame, p: SimParams): [number, number] {
  const { ix, iy, want } = moveIntent(h, sanitizeInput(input), p);
  return want > 0 ? [ix, iy] : [h.dirX, h.dirY];
}

// ------------------------------------------------------------------ the tick

/**
 * Advance the simulation by exactly one tick. Pure function of (state, input, params, options): no
 * clocks, no Math.random. Order: input -> abilities -> hero move -> director (spawns) ->
 * projectile move -> parry -> hits -> expiry/despawn. Does nothing once the hero is dead.
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
  const { ix, iy, want } = moveIntent(h, input, p);

  // 3. abilities (a buffered press fires on the first tick its cooldown allows)
  if (h.parryBufferedUntil >= t && t - h.parryStart >= parryCooldownOf(s, p)) {
    h.parryStart = t;
    h.parryHit = false;
    h.parryKills = 0;
    h.parryClose = false;
    h.parryScored = false;
    h.parryBufferedUntil = -1;
    s.events.push({ type: 'parry_start' });
  }
  if (h.dashBufferedUntil >= t && t - h.dashStart >= p.dashCooldown) {
    h.dashStart = t;
    h.dashBufferedUntil = -1;
    [h.dashDirX, h.dashDirY] = dashDirection(h, input, p);
    s.events.push({ type: 'dash_start', dirX: h.dashDirX, dirY: h.dashDirY });
    if (p.ability.kind === 'trail') {
      s.trailKills = 0;
      s.events.push({ type: 'trail_start' });
    }
  }

  // 4. hero movement
  const px0 = h.x;
  const py0 = h.y;
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
  [h.x, h.y] = clampToArena(h.x + mx, h.y + my, p);
  if (mx > 0.01) h.facing = 1;
  else if (mx < -0.01) h.facing = -1;
  updateAim(h, input, ix, iy, want, p);
  // the Wisp's dash lays a burning line along its path
  if (p.ability.kind === 'trail' && isDashing(s, p) && (h.x !== px0 || h.y !== py0))
    s.trail.push({ x0: px0, y0: py0, x1: h.x, y1: h.y, until: t + p.ability.ticks });

  // 5. spawn + move projectiles
  if (opts.spawner !== false) {
    runDirector(s, p, opts);
    runPickups(s, p);
  }
  const f = isSlow(s) ? p.pickups.slowTime.factor : 1; // Slow Time: projectiles only (beams and timers unaffected)
  for (const pr of s.projectiles) moveProjectile(s, pr, f);

  // 6. multiplier decay, then parry (parry is resolved before hits, so it always wins vs parryables)
  if (s.lastParryTick >= 0 && t - s.lastParryTick >= p.multReset && s.multiplier !== p.multStart) {
    s.multiplier = p.multStart;
    s.events.push({ type: 'mult_reset' });
  }
  if (isParryActive(s, p)) {
    // a projectile counts only while it is inside the pulse during the active window; at most parryMaxKills per pulse
    // (nearest first). Every SUCCESSFUL pulse (at least one parryable destroyed; an armored crack alone does not count)
    // steps the multiplier once, after its first kill has scored; a PERFECT parry (a destroyed projectile whose EDGE is
    // within parryRadius * parryCloseFrac of the hero) steps it once more (at most once per pulse). Every destroyed
    // projectile, perfect or not, refreshes the reset timer; a whiff or a crack alone neither steps nor refreshes.
    // the hero's parry zone (radius + arc around the aim): THE shared zone function (src/sim/parryZone.ts)
    const cand: { pr: Projectile; d2: number }[] = [];
    for (const pr of s.projectiles) {
      if (!pr.parryable || isFading(s, pr) || pr.crackedBy === h.parryStart) continue;
      const d2 = inParryZone(h.x, h.y, h.aimX, h.aimY, pr.x, pr.y, pr.radius, p);
      if (d2 >= 0) cand.push({ pr, d2 });
    }
    cand.sort((a, b) => a.d2 - b.d2 || a.pr.id - b.pr.id);
    const hit = new Set<number>();
    const perfectEdge = p.parryRadius * p.parryCloseFrac;
    for (const { pr, d2 } of cand) {
      if (h.parryKills >= p.parryMaxKills) break;
      h.parryKills++;
      if (pr.armor > 0) {
        // armored orb: this parry only cracks the shell and pushes it a few px straight away from the hero
        pr.armor--;
        pr.crackedBy = h.parryStart;
        const d = Math.sqrt(d2) || 1;
        pr.x += ((pr.x - h.x) / d) * p.newThreats.armored.crackPush;
        pr.y += ((pr.y - h.y) / d) * p.newThreats.armored.crackPush;
        h.parryHit = true; // not a whiff (crack cooldown), but no points, no multiplier step, no reset-timer refresh
        pr.vx *= p.newThreats.armored.crackSpeedFactor;
        pr.vy *= p.newThreats.armored.crackSpeedFactor;
        pr.speed *= p.newThreats.armored.crackSpeedFactor;
        s.events.push({ type: 'parry_crack', id: pr.id, x: pr.x, y: pr.y });
        continue;
      }
      hit.add(pr.id);
      if (pr.kind === 'orb_split') splitBurst(s, p, pr);
      const first = !h.parryScored;
      const dbl = isDouble(s) ? p.pickups.doubleScore.factor : 1;
      // points use the multiplier BEFORE this pulse's step
      const points = (first ? p.parryBase : p.extraKillPoints) * s.multiplier * dbl; // hundredths of a point
      s.parryScoreHundredths += points;
      const perfect = !h.parryClose && Math.sqrt(d2) - pr.radius <= perfectEdge;
      let step = first ? p.multStep : 0;
      if (perfect) {
        step += p.multStep; // the PERFECT extra: once per pulse
        h.parryClose = true;
      }
      const after = Math.min(p.multCap, s.multiplier + step);
      s.events.push({ type: 'parry_hit', id: pr.id, x: pr.x, y: pr.y, points: points / 100, multiplier: s.multiplier / 100, perfect, multAfter: after / 100 });
      if (first) {
        s.parryCount++;
        // Knight guard: every successful pulse adds a charge (the same definition as the multiplier step)
        if (p.ability.kind === 'guard' && h.guardCharges < p.ability.charges) {
          h.guardCharges++;
          s.events.push({ type: 'guard_gain', charges: h.guardCharges });
          if (h.guardCharges === p.ability.charges) s.events.push({ type: 'guard_ready' });
        }
      }
      if (step > 0) {
        s.multiplier = after;
        s.events.push({ type: 'mult_step', multiplier: after / 100, perfect, x: h.x, y: h.y });
      }
      s.lastParryTick = t;
      h.parryHit = true;
      h.parryScored = true;
      if (first && pr.boss > 0) onBossParry(s, p, pr.boss); // reflect bonus: once per successful pulse
    }
    if (hit.size) s.projectiles = s.projectiles.filter((pr) => !hit.has(pr.id));
    // the last active tick of a parry that hit nothing: tell the renderer it was a whiff
    if (t - h.parryStart === parryActiveTicks(s, p) - 1 && !h.parryHit) s.events.push({ type: 'parry_whiff', x: h.x, y: h.y });
  }

  // 6b. the Wisp's trail: parryable, non-armored projectiles touching it burn (after the pulse: never a double kill)
  if (s.trail.length) runTrail(s, p);

  // 7. hits: one hit = death (fading projectiles are harmless); a FULL Knight guard absorbs one parryable hit
  if (p.ability.kind === 'guard' && !isInvulnerable(s, p)) guardHits(s, p);
  else if (!isInvulnerable(s, p)) {
    for (const pr of s.projectiles) {
      if (isFading(s, pr) || t < pr.safeUntil) continue;
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
    const sg = s.alive ? sigilHits(s, p) : 0;
    if (sg) {
      s.alive = false;
      s.deathTick = t;
      s.events.push({ type: 'death', x: h.x, y: h.y, by: -2 });
    }
    if (s.alive && beamHits(s, p)) {
      s.alive = false;
      s.deathTick = t;
      s.events.push({ type: 'death', x: h.x, y: h.y, by: -1 });
    }
  }

  // 8. remove faded and far-away projectiles
  const m = p.despawnMargin;
  s.projectiles = s.projectiles.filter(
    (pr) =>
      (pr.fadeEnd < 0 || t < pr.fadeEnd) &&
      pr.x > p.x0 - m && pr.x < p.x1 + m && pr.y > p.y0 - m && pr.y < p.y1 + m,
  );

  if (s.alive) {
    s.survivalTicks++;
    if (isDouble(s)) s.doubleTicks++;
  }
  s.tick++;
}

/**
 * FACING: with cursor input the aim points to the (arena-clamped) cursor when it is farther than aimDeadzone, else it
 * keeps its value; with axis input it is the movement direction while the axis is non-zero. Never a zero / NaN vector.
 */
function updateAim(h: Hero, input: InputFrame, ix: number, iy: number, want: number, p: SimParams): void {
  if (input.cursor) {
    const [tx, ty] = clampToArena(input.mx, input.my, p);
    const ax = tx - h.x;
    const ay = ty - h.y;
    const d = Math.sqrt(ax * ax + ay * ay);
    if (d > p.aimDeadzone) {
      h.aimX = ax / d;
      h.aimY = ay / d;
    }
  } else if (want > 0) {
    h.aimX = ix;
    h.aimY = iy;
  }
}

/** The Wisp's ember trail: expire old segments, burn parryable non-armored projectiles (no step, no timer, no parry). */
function runTrail(s: SimState, p: SimParams): void {
  const A = p.ability;
  const t = s.tick;
  s.trail = s.trail.filter((g) => g.until > t);
  if (A.kind !== 'trail' || !s.trail.length) return;
  const burnt = new Set<number>();
  for (const pr of s.projectiles) {
    if (s.trailKills >= A.maxKills) break;
    if (!pr.parryable || pr.kind === 'orb_armored' || isFading(s, pr)) continue;
    const r = pr.radius + A.halfWidth;
    if (!s.trail.some((g) => segDist2(pr.x, pr.y, g.x0, g.y0, g.x1, g.y1) <= r * r)) continue;
    burnt.add(pr.id);
    s.trailKills++;
    const dbl = isDouble(s) ? p.pickups.doubleScore.factor : 1;
    const points = A.killPoints * s.multiplier * dbl; // hundredths; the multiplier is used, never stepped
    s.parryScoreHundredths += points;
    s.events.push({ type: 'trail_kill', id: pr.id, x: pr.x, y: pr.y, points: points / 100 });
  }
  if (burnt.size) s.projectiles = s.projectiles.filter((pr) => !burnt.has(pr.id));
}

function die(s: SimState, by: number): void {
  s.alive = false;
  s.deathTick = s.tick;
  s.events.push({ type: 'death', x: s.hero.x, y: s.hero.y, by });
}

/**
 * Hits for a guard hero. Unparryable threats (projectiles flagged unparryable, blood sigils, boss beams) kill as
 * always. A lethal PARRYABLE projectile is absorbed by a FULL guard: the charges reset, the projectile is destroyed,
 * the hero gets guard i-frames, no points. Otherwise it kills.
 */
function guardHits(s: SimState, p: SimParams): void {
  const h = s.hero;
  const t = s.tick;
  let parryHit: Projectile | null = null;
  for (const pr of s.projectiles) {
    if (isFading(s, pr) || t < pr.safeUntil) continue;
    const dx = pr.x - h.x;
    const dy = pr.y - h.y;
    const r = p.heroRadius + pr.radius;
    if (dx * dx + dy * dy >= r * r) continue;
    if (!pr.parryable) return die(s, pr.id);
    parryHit ??= pr;
  }
  if (sigilHits(s, p)) return die(s, -2);
  if (beamHits(s, p)) return die(s, -1);
  if (!parryHit) return;
  if (p.ability.kind === 'guard' && h.guardCharges >= p.ability.charges) {
    const pr = parryHit;
    h.guardCharges = 0;
    h.guardInvulnUntil = t + p.ability.invulnTicks;
    s.projectiles = s.projectiles.filter((q) => q.id !== pr.id);
    s.events.push({ type: 'guard_break', id: pr.id, x: pr.x, y: pr.y });
    return;
  }
  die(s, parryHit.id);
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
    const hero = options.hero ?? 'classic';
    this.params = makeParams(difficulty, hero);
    this.state = createState(seed, difficulty, hero, this.params);
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
