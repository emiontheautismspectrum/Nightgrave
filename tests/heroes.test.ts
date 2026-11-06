/**
 * The heroes pass: hero data in the run and in the replay core, facing, the shared parry zone (arc), the Knight's
 * guard, the Wisp's ember trail and their interactions, and daily fairness (no hero code touches the PRNG).
 */
import { describe, expect, it } from 'vitest';
import { HEROES, HERO_IDS, HERO_RULES, type HeroId } from '../src/data/heroes';
import type { Difficulty } from '../src/data/tuning';
import { BTN_DASH, BTN_PARRY, NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { makeParams } from '../src/sim/params';
import { inParryZone } from '../src/sim/parryZone';
import { decodeReplay, encodeReplay, playReplay } from '../src/sim/replay';
import { isInvulnerable, Sim, spawnProjectile } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/state';
import { decodeInputLog, encodeInputLog, logHero } from '../src/shared/replayCodec';
import { dailySeed } from '../src/shared/daily';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { verifyItem, type PendingItem } from '../tools/verify/core';
import { botInputClamped } from './bot';
import { TUNING } from '../src/data/tuning';

const idle = (): InputFrame => ({ ...NEUTRAL_INPUT });
const parry = (): InputFrame => ({ ...NEUTRAL_INPUT, buttons: BTN_PARRY });
const ev = (sim: Sim, f: InputFrame): SimEvent[] => (sim.step(f), [...sim.state.events]);
const wait = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) sim.step(idle()); };
const fresh = (hero: HeroId) => new Sim(7, 'medium', { spawner: false, hero });
const DEG = Math.PI / 180;
const rad = (deg: number): [number, number] => [Math.cos(deg * DEG), Math.sin(deg * DEG)];

describe('hero data', () => {
  it('every shipped hero has a definition with sane numbers and two stat lines', () => {
    for (const id of HERO_IDS) {
      const h = HEROES[id];
      expect(h.id).toBe(id);
      expect(h.lines).toHaveLength(2);
      expect(h.parry.radius).toBeGreaterThan(HERO_RULES.overlapPx);
      expect(h.parry.arcDegrees).toBeGreaterThan(0);
      expect(h.parry.arcDegrees).toBeLessThanOrEqual(360);
      expect(h.dashDistance).toBeGreaterThan(0);
    }
  });
  it('the hero changes the params, never the threats', () => {
    const k = makeParams('hard', 'knight');
    const w = makeParams('hard', 'wisp');
    expect(k.parryRadius).toBe(HEROES.knight.parry.radius);
    expect(w.parryRadius).toBe(HEROES.wisp.parry.radius);
    expect(k.parryFull).toBe(false);
    expect(w.parryFull).toBe(true);
    for (const key of ['speed', 'density', 'smallRadius', 'heroRadius', 'heroSpeed', 'dashTicks', 'dashCooldown', 'multCap'] as const)
      expect(k[key as keyof typeof k]).toEqual(w[key as keyof typeof w]);
  });
});

describe('daily fairness: the hero never changes the spawn schedule', () => {
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${d}: identical spawns (kind, tick, position) and PRNG over 3000 ticks with empty input`, () => {
      const trace = (hero: HeroId) => {
        const sim = new Sim(dailySeed('2026-11-06'), d, { hero });
        const out: string[] = [];
        for (let t = 0; t < 3000; t++) {
          sim.state.alive = true; // keep the run going: only the schedule matters here
          sim.step(idle());
          for (const e of sim.state.events) {
            if (e.type !== 'spawn') continue;
            const pr = sim.state.projectiles.find((q) => q.id === e.id);
            out.push(`${t}:${e.kind}:${pr ? `${pr.x.toFixed(6)},${pr.y.toFixed(6)}` : '-'}`);
          }
          out.push(`r${sim.state.rng}`);
        }
        return out;
      };
      const k = trace('knight');
      expect(k.filter((x) => !x.startsWith('r')).length).toBeGreaterThan(50);
      expect(trace('wisp')).toEqual(k);
    });
  }
});

describe('facing (aim)', () => {
  it('starts toward the arena centre direction and follows the cursor beyond the dead zone only', () => {
    const sim = fresh('knight');
    const h = sim.state.hero;
    expect(Math.hypot(h.aimX, h.aimY)).toBeCloseTo(1, 9);
    // a cursor inside the dead zone keeps the previous aim
    sim.step({ cursor: true, mx: h.x, my: h.y - HERO_RULES.aimDeadzonePx + 1, buttons: 0 });
    expect([h.aimX, h.aimY]).toEqual([1, 0]);
    sim.step({ cursor: true, mx: h.x - 50, my: h.y, buttons: 0 });
    expect(h.aimX).toBeLessThan(-0.99);
  });
  it('axis input aims along the movement and keeps it when the axis is released; a dash does not turn it', () => {
    const sim = fresh('knight');
    const h = sim.state.hero;
    sim.step({ cursor: false, mx: 0, my: 100, buttons: 0 });
    expect(h.aimY).toBeCloseTo(1, 9);
    sim.step(idle());
    expect(h.aimY).toBeCloseTo(1, 9);
    sim.step({ cursor: false, mx: 0, my: 0, buttons: BTN_DASH }); // dash along the last direction, aim unchanged
    for (let i = 0; i < 5; i++) sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
    expect(h.aimY).toBeCloseTo(1, 9);
  });
  it('is a pure function of the input log: same log -> same aim every tick, never NaN, always unit length', () => {
    let r = 12345;
    const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const log: InputFrame[] = [];
    for (let i = 0; i < 2000; i++) {
      const k = rnd();
      if (k < 0.4) log.push({ cursor: true, mx: Math.floor(rnd() * 600) - 60, my: Math.floor(rnd() * 340) - 35, buttons: rnd() < 0.05 ? BTN_DASH : 0 });
      else if (k < 0.5) log.push({ cursor: true, mx: 240, my: 135, buttons: 0 }); // on the hero
      else if (k < 0.8) log.push({ cursor: false, mx: Math.floor(rnd() * 201) - 100, my: Math.floor(rnd() * 201) - 100, buttons: 0 });
      else log.push(idle());
    }
    const run = () => {
      const sim = new Sim(3, 'hard', { hero: 'knight' });
      const aims: number[] = [];
      for (const f of log) {
        sim.state.alive = true;
        sim.step(f);
        const { aimX, aimY } = sim.state.hero;
        expect(Number.isFinite(aimX) && Number.isFinite(aimY)).toBe(true);
        expect(Math.abs(Math.hypot(aimX, aimY) - 1)).toBeLessThan(1e-9);
        aims.push(aimX, aimY);
      }
      return aims;
    };
    expect(run()).toEqual(run());
  });
});

describe('the shared parry zone (arc geometry)', () => {
  const k = makeParams('hard', 'knight');
  const half = HEROES.knight.parry.arcDegrees / 2;
  const tol = Math.asin(0.1) / DEG; // a 2 px projectile 20 px away
  const w = makeParams('hard', 'wisp');
  const at = (deg: number, d: number): [number, number] => { const [c, s] = rad(deg); return [c * d, s * d]; };
  const zone = (p: typeof k, deg: number, d: number, r: number, aim = 0) => {
    const [ax, ay] = rad(aim);
    const [x, y] = at(deg, d);
    return inParryZone(0, 0, ax, ay, x, y, r, p) >= 0;
  };
  it('inside the arc, outside it, and the asin(r / d) edge tolerance', () => {
    expect(zone(k, 0, 20, 2)).toBe(true);
    expect(zone(k, half - 1, 20, 2)).toBe(true);
    expect(zone(k, half + tol - 0.3, 20, 2)).toBe(true); // the edge tolerance
    expect(zone(k, half + tol + 0.3, 20, 2)).toBe(false);
    expect(zone(k, -(half + tol + 0.3), 20, 2)).toBe(false);
    expect(zone(k, 180, 20, 2)).toBe(false);
    expect(zone(k, 90 + half - 1, 20, 2, 90)).toBe(true); // the arc turns with the aim
    expect(zone(k, 90 - half - tol - 0.3, 20, 2, 90)).toBe(false);
  });
  it('reach = radius + projectile radius, and a projectile closer than overlapPx always counts', () => {
    expect(zone(k, 0, k.parryRadius + 2, 2)).toBe(true);
    expect(zone(k, 0, k.parryRadius + 2.01, 2)).toBe(false);
    expect(zone(k, 180, HERO_RULES.overlapPx - 0.01, 2)).toBe(true);
    expect(zone(k, 180, HERO_RULES.overlapPx + 0.5, 2)).toBe(false);
    expect(zone(k, 95, 3, 4)).toBe(true); // r >= d: asin clamps to 90
  });
  it('a full ring (Wisp) ignores the aim; the reach is its own radius', () => {
    for (let a = 0; a < 360; a += 15) expect(zone(w, a, w.parryRadius, 1, 37)).toBe(true);
    expect(zone(w, 0, w.parryRadius + 1.5, 1)).toBe(false);
  });
  it('the sim parry uses the arc: an orb behind the Knight is not parried, the same orb in front is', () => {
    for (const [dx, hits] of [[-15, false], [15, true]] as const) {
      const sim = fresh('knight');
      const h = sim.state.hero; // aim (1, 0)
      spawnProjectile(sim.state, sim.params, 'orb_small', h.x + dx, h.y, 0, 0);
      const e = ev(sim, parry());
      expect(e.some((x) => x.type === 'parry_hit')).toBe(hits);
    }
  });
  it('PERFECT is measured only for projectiles inside the zone', () => {
    const sim = fresh('knight');
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 9, h.y, 0, 0); // close, but behind the arc
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x + 25, h.y, 0, 0); // in the arc, not close
    const hit = ev(sim, parry()).filter((x) => x.type === 'parry_hit');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ perfect: false });
  });
});

/** Fill the Knight's guard with three successful pulses (an orb in front each time). */
function fillGuard(sim: Sim): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < 3; i++) {
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x + 15, h.y, 0, 0);
    all.push(...ev(sim, parry()));
    wait(sim, sim.params.parryCooldown + 1);
  }
  return all;
}

describe('Knight guard', () => {
  it('+1 charge per successful pulse up to the max, guard_ready once; whiffs add nothing', () => {
    const sim = fresh('knight');
    ev(sim, parry());
    wait(sim, sim.params.parryWhiffCooldown + 1);
    expect(sim.state.hero.guardCharges).toBe(0);
    const e = fillGuard(sim);
    expect(e.filter((x) => x.type === 'guard_gain').map((x) => (x as { charges: number }).charges)).toEqual([1, 2, 3]);
    expect(e.filter((x) => x.type === 'guard_ready')).toHaveLength(1);
    fillGuard(sim); // stays capped
    expect(sim.state.hero.guardCharges).toBe(3);
  });
  it('a full guard absorbs one lethal parryable hit: charges 0, projectile gone, i-frames, no points', () => {
    const sim = fresh('knight');
    fillGuard(sim);
    const before = sim.state.parryScoreHundredths;
    const h = sim.state.hero;
    const pr = spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0);
    const e = ev(sim, idle());
    expect(sim.state.alive).toBe(true);
    expect(e.find((x) => x.type === 'guard_break')).toMatchObject({ id: pr.id });
    expect(h.guardCharges).toBe(0);
    expect(sim.state.projectiles.some((q) => q.id === pr.id)).toBe(false);
    expect(sim.state.parryScoreHundredths).toBe(before);
    expect(isInvulnerable(sim.state, sim.params)).toBe(true);
    // during the guard i-frames another hit is harmless; after them it kills (the guard is empty)
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0);
    wait(sim, sim.params.ability.kind === 'guard' ? sim.params.ability.invulnTicks - 1 : 0);
    expect(sim.state.alive).toBe(true);
    wait(sim, 2);
    expect(sim.state.alive).toBe(false);
  });
  it('without a full guard a parryable hit kills', () => {
    const sim = fresh('knight');
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x + 15, h.y, 0, 0);
    ev(sim, parry());
    wait(sim, sim.params.parryCooldown + 1);
    expect(h.guardCharges).toBe(1);
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0);
    wait(sim, 1);
    expect(sim.state.alive).toBe(false);
  });
  it('unparryables still kill through a full guard (blade)', () => {
    const sim = fresh('knight');
    fillGuard(sim);
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'blade', h.x - 2, h.y, 0, 0);
    wait(sim, 1);
    expect(sim.state.alive).toBe(false);
    expect(h.guardCharges).toBe(3);
  });
  it('dash i-frames come first: no charge is spent while invulnerable', () => {
    const sim = fresh('knight');
    fillGuard(sim);
    const h = sim.state.hero;
    sim.step({ cursor: false, mx: 100, my: 0, buttons: BTN_DASH });
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x, h.y, 0, 0);
    const e = ev(sim, idle());
    expect(e.some((x) => x.type === 'guard_break')).toBe(false);
    expect(h.guardCharges).toBe(3);
  });
  it('two parryables at once: one breaks the guard, the other cannot kill on the same tick', () => {
    const sim = fresh('knight');
    fillGuard(sim);
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0);
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x, h.y + 2, 0, 0);
    const e = ev(sim, idle());
    expect(sim.state.alive).toBe(true);
    expect(e.filter((x) => x.type === 'guard_break')).toHaveLength(1);
    expect(sim.state.projectiles).toHaveLength(1);
  });
  it('parry resolves before hits: an orb on top of the hero during a pulse is parried, the guard untouched', () => {
    const sim = fresh('knight');
    fillGuard(sim);
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0); // behind, but inside overlapPx
    const e = ev(sim, parry());
    expect(e.some((x) => x.type === 'parry_hit')).toBe(true);
    expect(e.some((x) => x.type === 'guard_break')).toBe(false);
    expect(h.guardCharges).toBe(3);
  });
  it('the Wisp has no guard', () => {
    const sim = fresh('wisp');
    for (let i = 0; i < 3; i++) {
      const h = sim.state.hero;
      spawnProjectile(sim.state, sim.params, 'orb_small', h.x + 12, h.y, 0, 0);
      ev(sim, parry());
      wait(sim, sim.params.parryCooldown + 1);
    }
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 2, h.y, 0, 0);
    wait(sim, 1);
    expect(sim.state.alive).toBe(false);
  });
});

/** Wisp: dash right, wait until the dash is over; return the dash start x. */
function dashRight(sim: Sim): number {
  const x0 = sim.state.hero.x;
  const e = ev(sim, { cursor: false, mx: 100, my: 0, buttons: BTN_DASH });
  expect(e.some((x) => x.type === 'trail_start')).toBe(true);
  wait(sim, sim.params.dashTicks);
  return x0;
}
const T = HEROES.wisp.ability.kind === 'trail' ? HEROES.wisp.ability : (null as never);

describe('Wisp ember trail', () => {
  it('the dash covers the Wisp distance', () => {
    const sim = fresh('wisp');
    const x0 = dashRight(sim);
    expect(sim.state.hero.x - x0).toBeCloseTo(HEROES.wisp.dashDistance, 0);
  });
  it('burns parryables on the trail (at most maxKills per dash), not armored ones; kills score killPoints x multiplier', () => {
    const sim = fresh('wisp');
    const x0 = dashRight(sim);
    const y = sim.state.hero.y;
    const armored = spawnProjectile(sim.state, sim.params, 'orb_armored', x0 + 5, y, 0, 0);
    for (let i = 0; i < T.maxKills + 2; i++) spawnProjectile(sim.state, sim.params, 'orb_small', x0 + 15 + i * 10, y + 2, 0, 0);
    const before = sim.state.parryScoreHundredths;
    const mult = sim.state.multiplier;
    const e = ev(sim, idle());
    const kills = e.filter((x) => x.type === 'trail_kill');
    expect(kills).toHaveLength(T.maxKills);
    expect(sim.state.projectiles.some((q) => q.id === armored.id)).toBe(true);
    expect(sim.state.parryScoreHundredths - before).toBe(T.maxKills * T.killPoints * mult);
    // no multiplier step, no timer refresh, no parry
    expect(sim.state.multiplier).toBe(mult);
    expect(sim.state.lastParryTick).toBe(-1);
    expect(sim.state.parryCount).toBe(0);
    // the cap is per dash: nothing more burns until the next dash
    spawnProjectile(sim.state, sim.params, 'orb_small', x0 + 30, y, 0, 0);
    expect(ev(sim, idle()).some((x) => x.type === 'trail_kill')).toBe(false);
  });
  it('Double Score doubles trail kills', () => {
    const sim = fresh('wisp');
    const x0 = dashRight(sim);
    sim.state.doubleUntil = sim.state.tick + 100;
    spawnProjectile(sim.state, sim.params, 'orb_small', x0 + 20, sim.state.hero.y, 0, 0);
    const e = ev(sim, idle());
    expect(e.find((x) => x.type === 'trail_kill')).toMatchObject({ points: (T.killPoints * 2 * sim.state.multiplier) / 100 });
  });
  it('the trail expires after its time', () => {
    const sim = fresh('wisp');
    const x0 = dashRight(sim);
    wait(sim, Math.round(T.seconds * 60));
    spawnProjectile(sim.state, sim.params, 'orb_small', x0 + 50, sim.state.hero.y, 0, 0);
    expect(ev(sim, idle()).some((x) => x.type === 'trail_kill')).toBe(false);
    expect(sim.state.trail).toHaveLength(0);
  });
  it('the trail cannot kill a projectile the pulse already killed', () => {
    const sim = fresh('wisp');
    dashRight(sim);
    const h = sim.state.hero;
    const pr = spawnProjectile(sim.state, sim.params, 'orb_small', h.x - 10, h.y, 0, 0); // in the pulse AND on the trail
    const e = ev(sim, parry());
    expect(e.filter((x) => (x.type === 'parry_hit' || x.type === 'trail_kill') && x.id === pr.id).map((x) => x.type)).toEqual(['parry_hit']);
  });
  it('the Knight leaves no trail', () => {
    const sim = fresh('knight');
    const x0 = sim.state.hero.x;
    const e = ev(sim, { cursor: false, mx: 100, my: 0, buttons: BTN_DASH });
    expect(e.some((x) => x.type === 'trail_start')).toBe(false);
    wait(sim, sim.params.dashTicks);
    expect(sim.state.trail).toHaveLength(0);
    expect(sim.state.hero.x - x0).toBeCloseTo(HEROES.knight.dashDistance, 0);
  });
});

describe('ember charge works for both heroes', () => {
  for (const hero of HERO_IDS)
    it(`${hero}: charges widen the parry window`, () => {
      const late = (charges: number) => {
        const sim = fresh(hero);
        sim.state.emberCharges = charges;
        const h = sim.state.hero;
        ev(sim, parry());
        wait(sim, sim.params.parryActive - 1); // the base window is over after this tick
        spawnProjectile(sim.state, sim.params, 'orb_small', h.x + 12, h.y, 0, 0);
        return ev(sim, idle()).some((x) => x.type === 'parry_hit');
      };
      expect(late(0)).toBe(false);
      expect(late(4)).toBe(true);
    });
});

describe('the hero in the replay core', () => {
  const run = (hero: HeroId) => {
    const sim = new Sim(dailySeed('2026-11-06'), 'hard', { hero });
    while (sim.state.alive && sim.state.tick < 60 * 90) sim.step(botInputClamped(sim));
    while (sim.state.alive) sim.step(idle());
    return sim;
  };
  const K = run('knight');
  const W = run('wisp');
  const item = (sim: Sim, over: Partial<PendingItem> = {}): PendingItem => ({
    id: '1-1', date: '2026-11-06', seed: dailySeed('2026-11-06'), difficulty: 'hard', durationTicks: sim.log.length,
    score: sim.score, hero: sim.state.heroId, tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION,
    replay: encodeInputLog(sim.log, sim.state.heroId as HeroId), ...over,
  });
  it('the JSON replay round-trips the hero and replays to the same score', () => {
    for (const sim of [K, W]) {
      const r = encodeReplay(sim.state.seed, 'hard', sim.state.heroId as HeroId, sim.log);
      expect(decodeReplay(JSON.parse(JSON.stringify(r))).hero).toBe(sim.state.heroId);
      expect(playReplay(r).score).toBe(sim.score);
    }
  });
  it('the binary log carries the hero; old-format, missing and unknown heroes are rejected', () => {
    const b64 = encodeInputLog(K.log, 'knight');
    expect(logHero(b64)).toBe('knight');
    expect(decodeInputLog(b64)?.hero).toBe('knight');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mut = (f: (b: Uint8Array) => void) => { const b = bytes.slice(); f(b); return btoa(String.fromCharCode(...b)); };
    expect(decodeInputLog(mut((b) => { b[1] = 1; }))).toBeNull(); // the old format
    expect(decodeInputLog(mut((b) => { b[2] = HERO_IDS.length; }))).toBeNull(); // unknown hero index
    expect(decodeInputLog(mut((b) => { b[2] = 255; }))).toBeNull();
    expect(logHero(mut((b) => { b[2] = 9; }))).toBeNull();
    expect(() => encodeInputLog(K.log, 'classic' as HeroId)).toThrow();
  });
  it('the verifier verifies a Knight run and a Wisp run', () => {
    expect(K.log.length).toBeGreaterThan(120);
    expect(W.log.length).toBeGreaterThan(120);
    expect(verifyItem(item(K))).toEqual({ status: 'verified' });
    expect(verifyItem(item(W))).toEqual({ status: 'verified' });
  });
  it('a claimed hero that differs from the replay core is invalid', () => {
    expect(verifyItem(item(K, { hero: 'wisp' }))).toEqual({ status: 'rejected', reason: 'invalid_input' });
    expect(verifyItem(item(W, { hero: 'knight' }))).toEqual({ status: 'rejected', reason: 'invalid_input' });
    expect(verifyItem(item(W, { hero: 'mage' }))).toEqual({ status: 'rejected', reason: 'invalid_input' });
  });
  it('tampering the hero in the replay core (claim updated too) breaks verification', () => {
    const forged = item(K, { hero: 'wisp', replay: encodeInputLog(K.log, 'wisp') });
    expect(verifyItem(forged).status).toBe('rejected');
  });
  it('an old-format log is rejected cleanly', () => {
    const b = Uint8Array.from(atob(encodeInputLog(K.log, 'knight')), (c) => c.charCodeAt(0));
    b[1] = 1;
    expect(verifyItem(item(K, { replay: btoa(String.fromCharCode(...b)) }))).toEqual({ status: 'rejected', reason: 'invalid_input' });
  });
});

describe('maxPossibleScore bounds every hero', () => {
  it('skilled bot runs of both heroes on Hard stay under the bound; the bound includes the trail term', async () => {
    const { maxPossibleScore } = await import('../src/shared/maxScore');
    const { SkilledBot } = await import('./skilled');
    for (const hero of HERO_IDS)
      for (let seed = 1; seed <= 6; seed++) {
        const sim = new Sim(seed * 7919, 'hard', { hero });
        const bot = new SkilledBot(seed);
        while (sim.state.alive && sim.state.tick < 60 * 120) {
          sim.step(bot.input(sim));
          if (sim.state.tick % 300 === 0) expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
        }
        expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
      }
    // a 1-tick run can only hold the trail kills of one dash (and survival); the trail term is there
    expect(maxPossibleScore(1)).toBeGreaterThanOrEqual(T.maxKills * T.killPoints * TUNING.multiplier.cap * TUNING.pickups.doubleScore.factor);
  });
});

describe('hero render helpers (read-only)', () => {
  it('stat lines fit the hero select screen and name the real guard size', () => {
    for (const id of HERO_IDS) for (const l of HEROES[id].lines) expect(l.length).toBeLessThanOrEqual(19);
    const g = HEROES.knight.ability;
    expect(g.kind === 'guard' && HEROES.knight.lines.join(' ').includes(`${g.charges} PARRIES`)).toBe(true);
  });
  it('the drawn zone outline is sampled from the sim zone: an arc around the aim for the Knight, a closed ring for the Wisp', async () => {
    const { zoneOutline, trailEmbers } = await import('../src/render/heroView');
    const k = makeParams('hard', 'knight');
    const runs = zoneOutline(100, 100, 0, -1, k); // aim up
    expect(runs).toHaveLength(1);
    for (const [x, y] of runs[0]!) {
      expect(inParryZone(100, 100, 0, -1, x, y, 0, k)).toBeGreaterThanOrEqual(0);
      expect(Math.acos(-(y - 100) / Math.hypot(x - 100, y - 100)) / DEG).toBeLessThanOrEqual(HEROES.knight.parry.arcDegrees / 2 + 1e-6);
    }
    const ring = zoneOutline(100, 100, 1, 0, makeParams('hard', 'wisp'));
    expect(ring).toHaveLength(1);
    expect(ring[0]![0]).toEqual(ring[0]![ring[0]!.length - 1]);
    // embers: deterministic, fading with the remaining time, none for an empty trail
    const seg = [{ x0: 0, y0: 0, x1: 30, y1: 0, until: 48 }];
    expect(trailEmbers(seg, 0, 48, false)).toEqual(trailEmbers(seg, 0, 48, false));
    expect(trailEmbers(seg, 24, 48, false)[0]!.a).toBeCloseTo(0.5, 5);
    expect(trailEmbers([], 0, 48, true)).toEqual([]);
  });
});
