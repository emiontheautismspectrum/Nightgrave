/**
 * The hunts (package B1): the hex knot (FEATURES.knot), tested in the ENABLED variants. The production flags stay dark
 * (tests/features.test.ts, tests/golden_corpus.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TUNING } from '../src/data/tuning';
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { inParryZone } from '../src/sim/parryZone';
import { ticks } from '../src/sim/params';
import { Sim, spawnProjectile } from '../src/sim/sim';
import type { Knot, SimEvent } from '../src/sim/state';
import { resolved, SPOTS, walkingSolver } from './pack_tools';
import { BRIAR, KNOT, sigilHook, startKnots, startLine } from './hunt_tools';
import { inGapCorridor, wallArrival } from '../src/sim/hunts';
import { mulberryInputs } from './scripted';
import { SkilledBot } from './skilled';

const KC = KNOT.knot;
const IDLE: InputFrame = { cursor: false, mx: 0, my: 0, buttons: 0 };
const FUSE = ticks(KC.fuseSeconds);

/** A bare variant run (no director) with one knot placed by hand at (x, y), the hero at (hx, hy). */
function bare(hero: 'knight' | 'wisp' | 'classic', x: number, y: number, hx = 240, hy = 135, features: Features = KNOT): { sim: Sim; k: Knot } {
  const sim = new Sim(1, 'hard', { hero, features, spawner: false });
  sim.state.hero.x = hx;
  sim.state.hero.y = hy;
  const k: Knot = { id: sim.state.nextId++, x, y, r: KC.radius, start: 0, burst: FUSE, shards: KC.shards, speed: 1, angle: 0 };
  sim.state.knots!.push(k);
  return { sim, k };
}

/** Step without the director but with the knot fuses (spawner: false skips the director; the fuses run here). */
function stepBare(sim: Sim, input: InputFrame = IDLE): SimEvent[] {
  sim.step(input);
  return sim.state.events;
}

describe('hex knot: dark and the pool', () => {
  it('the production flags: no knot block, no knots field, no knot pick', () => {
    expect(FEATURES.knot.enabled).toBe(false);
    const sim = new Sim(5, 'hard', { hero: 'knight', startWave: 6 });
    expect(sim.params.knot).toBeNull();
    expect('knots' in sim.state).toBe(false);
    for (const f of mulberryInputs(3, 60 * 30)) sim.step(f);
    expect('knots' in sim.state).toBe(false);
  });

  it('the rows: wave 2+, at most 2, a 4 s fuse, 8 shards, 90 px from the hero, 30 px inside the edge, trail-proof', () => {
    expect([KC.unlockWave, KC.maxActive, KC.fuseSeconds, KC.shards, KC.minHeroDist, KC.edgeInset, KC.trailProof]).toEqual([2, 2, 4, 8, 90, 30, true]);
    expect(KC.maxActive * KC.shards).toBeLessThanOrEqual(16); // the entity cap of a burst
  });

  it('the single draw is unchanged: before wave 2 a knot run is the production run (same PRNG, same spawns)', () => {
    const a = new Sim(31337, 'hard', { hero: 'wisp' });
    const b = new Sim(31337, 'hard', { hero: 'wisp', features: KNOT });
    const bot = new SkilledBot(4);
    while (a.state.wave < KC.unlockWave && a.state.alive) {
      const f = bot.input(a);
      a.step(f);
      b.step(f);
      const { knots, ...rest } = b.state;
      expect(knots).toEqual([]);
      expect(JSON.stringify(rest)).toBe(JSON.stringify(a.state));
    }
    expect(a.state.tick).toBeGreaterThan(60 * 20);
  });

  it('knots join the pool from wave 2: created >= 90 px from the hero, >= 30 px inside, spaced, at most 2, never in a boss fight', () => {
    let made = 0;
    let both = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Sim(seed * 101, 'hard', { hero: seed % 2 ? 'knight' : 'wisp', features: KNOT });
      const bot = new SkilledBot(seed);
      while (sim.state.alive && sim.state.tick < 60 * 150) {
        const before = { ...sim.state.hero };
        sim.step(bot.input(sim));
        const s = sim.state;
        for (const e of s.events)
          if (e.type === 'knot') {
            made++;
            expect(s.wave).toBeGreaterThanOrEqual(2);
            expect(s.boss).toBeNull();
            // the director runs after the hero moved: the distance holds for the hero's position on that tick
            expect(Math.hypot(e.x - s.hero.x, e.y - s.hero.y)).toBeGreaterThanOrEqual(KC.minHeroDist - 1e-9);
            expect(Math.hypot(e.x - before.x, e.y - before.y)).toBeGreaterThan(KC.minHeroDist - 3);
            expect(e.x).toBeGreaterThanOrEqual(TUNING.arena.x0 + KC.edgeInset);
            expect(e.x).toBeLessThanOrEqual(TUNING.arena.x1 - KC.edgeInset);
            expect(e.y).toBeGreaterThanOrEqual(TUNING.arena.y0 + KC.edgeInset);
            expect(e.y).toBeLessThanOrEqual(TUNING.arena.y1 - KC.edgeInset);
          }
        const ks = s.knots!;
        expect(ks.length).toBeLessThanOrEqual(KC.maxActive);
        if (ks.length === 2) both++;
        for (const a of ks) for (const b of ks) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(KC.spacingPx);
        if (s.boss) expect(ks).toEqual([]);
      }
    }
    expect(made).toBeGreaterThan(30);
    expect(both).toBeGreaterThan(0);
  });
});

describe('hex knot: the fuse and the burst', () => {
  it('bursts exactly at the end of its 4 s fuse into 8 rune shards, telegraphed by the whole fuse', () => {
    const { sim, k } = bare('wisp', 120, 80);
    for (let t = 0; t < FUSE; t++) {
      const ev = stepBare(sim);
      expect(ev.some((e) => e.type === 'spawn'), `tick ${t}`).toBe(false);
      expect(sim.state.knots).toHaveLength(1);
    }
    const ev = stepBare(sim);
    const spawns = ev.filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(KC.shards);
    for (const e of spawns) {
      expect(e.type === 'spawn' && e.kind).toBe('rune_shard');
      expect(e.type === 'spawn' && e.telegraphTicks).toBe(FUSE);
    }
    expect(ev).toContainEqual({ type: 'knot_end', id: k.id, x: 120, y: 80, how: 'burst' });
    expect(sim.state.knots).toEqual([]);
    expect(sim.state.projectiles.every((pr) => pr.kind === 'rune_shard' && pr.parryable)).toBe(true);
  });

  it('the fuse is counted in ticks: Slow Time does not slow it, and it is the same on every difficulty', () => {
    const { sim } = bare('wisp', 120, 80);
    sim.state.slowUntil = 1e9;
    let t = 0;
    while (sim.state.knots!.length) (stepBare(sim), t++);
    expect(t).toBe(FUSE + 1);
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const p = new Sim(1, d, { features: KNOT }).params;
      expect(ticks(p.knot!.fuseSeconds)).toBe(240);
    }
  });

  it('the shards scale like rune shards: speed = shard speed x the wave speed (difficulty included)', () => {
    for (const d of ['easy', 'hard'] as const) {
      const piece = startKnots(5, 8, 240, 135, 1, d)!;
      const k = piece.sim.state.knots![0]!;
      expect(k.speed).toBeCloseTo(piece.sim.params.shardSpeed * Math.min(TUNING.waves.speedCap, 1 + TUNING.waves.speedStep * 8), 9);
    }
  });

  it('the body is harmless, a dash does not touch it, and its life ends only at the burst or a parry', () => {
    const { sim } = bare('knight', 140, 135, 120, 135);
    for (let t = 0; t < 30; t++) stepBare(sim, { cursor: true, mx: 160, my: 135, buttons: t === 2 ? BTN_DASH : 0 });
    expect(sim.state.alive).toBe(true);
    expect(sim.state.knots).toHaveLength(1);
  });
});

describe('hex knot: the parry', () => {
  const parryAt = (hero: 'knight' | 'wisp', kx: number, ky: number, hx: number, hy: number, setup?: (sim: Sim) => void) => {
    const { sim, k } = bare(hero, kx, ky, hx, hy);
    setup?.(sim);
    const ev = stepBare(sim, { cursor: false, mx: 0, my: 0, buttons: BTN_PARRY });
    return { sim, k, ev };
  };

  it('a pulse that covers it destroys it: 25 x the multiplier, one step, the reset timer, never PERFECT', () => {
    const { sim, k, ev } = parryAt('wisp', 250, 135, 240, 135, (s) => (s.state.multiplier = 150));
    expect(ev).toContainEqual({ type: 'parry_hit', id: k.id, x: 250, y: 135, points: 37.5, multiplier: 1.5, perfect: false, multAfter: 1.75 });
    expect(ev).toContainEqual({ type: 'knot_end', id: k.id, x: 250, y: 135, how: 'parry' });
    expect(sim.state.multiplier).toBe(175);
    expect(sim.state.lastParryTick).toBe(0);
    expect(sim.state.parryScoreHundredths).toBe(3750);
    expect(sim.state.knots).toEqual([]);
    expect(sim.score).toBe(37);
  });

  it('even right on the hero it is never PERFECT, and under Double Score it pays x2', () => {
    const { sim, ev } = parryAt('wisp', 241, 135, 240, 135, (s) => (s.state.doubleUntil = 1e9));
    const hit = ev.find((e) => e.type === 'parry_hit');
    expect(hit && hit.type === 'parry_hit' && [hit.perfect, hit.points]).toEqual([false, 50]);
    expect(ev.some((e) => e.type === 'mult_step' && e.perfect)).toBe(false);
    expect(sim.state.multiplier).toBe(125);
  });

  it('it never gives a Knight guard charge, also as the first kill of a pulse', () => {
    const { sim } = parryAt('knight', 255, 135, 240, 135);
    expect(sim.state.knots).toEqual([]);
    expect(sim.state.hero.guardCharges).toBe(0);
    expect(sim.state.events.some((e) => e.type === 'guard_gain')).toBe(false);
  });

  it('the ONE zone: the Knight arc and the Wisp circle treat a knot exactly like an orb at the same spot', () => {
    for (const hero of ['knight', 'wisp'] as const)
      for (let a = 0; a < 24; a++)
        for (const dist of [8, 18, 24, 27, 29, 33]) {
          const x = 240 + Math.cos((a * Math.PI) / 12) * dist;
          const y = 135 + Math.sin((a * Math.PI) / 12) * dist;
          const { sim } = parryAt(hero, x, y, 240, 135);
          const p = sim.params;
          const inside = inParryZone(240, 135, 1, 0, x, y, KC.radius, p) >= 0;
          expect(sim.state.knots!.length === 0, `${hero} ${a} ${dist}`).toBe(inside);
        }
  });

  it('a knot counts as one kill of the pulse (maxKillsPerPulse), nearest first', () => {
    const { sim, k } = bare('wisp', 252, 135, 240, 135);
    const p = sim.params;
    for (const dx of [-4, -6, -8]) spawnProjectile(sim.state, p, 'orb_small', 240 + dx, 135, 0, 0);
    stepBare(sim, { cursor: false, mx: 0, my: 0, buttons: BTN_PARRY });
    expect(sim.state.hero.parryKills).toBe(p.parryMaxKills);
    expect(sim.state.knots!.map((q) => q.id)).toEqual([k.id]); // the three nearer orbs took the pulse
    const sim2 = bare('wisp', 245, 135, 240, 135).sim;
    for (const dx of [-8, -10, -12]) spawnProjectile(sim2.state, sim2.params, 'orb_small', 240 + dx, 135, 0, 0);
    stepBare(sim2, { cursor: false, mx: 0, my: 0, buttons: BTN_PARRY });
    expect(sim2.state.knots).toEqual([]);
    expect(sim2.state.projectiles).toHaveLength(1);
  });

  it('the Wisp ember trail does not destroy knots (trailProof); with trailProof off it would', () => {
    const run = (features: Features) => {
      const { sim } = bare('wisp', 200, 135, 160, 135, features);
      for (let t = 0; t < 20; t++) stepBare(sim, { cursor: true, mx: 260, my: 135, buttons: t === 0 ? BTN_DASH : 0 });
      return sim;
    };
    const proof = run(KNOT);
    expect(proof.state.hero.x).toBeGreaterThan(205); // the dash and its trail went right through the knot
    expect(proof.state.knots).toHaveLength(1);
    expect(proof.state.events.some((e) => e.type === 'trail_kill')).toBe(false);
    const off: Features = { ...KNOT, knot: { ...KNOT.knot, trailProof: false } };
    expect(run(off).state.knots).toEqual([]);
  });
});

describe('hex knot: the boss rule', () => {
  it('no knot is alive when a boss wave starts (60 seeds, both heroes): every fuse ends before, nothing is cancelled', () => {
    let bosses = 0;
    let late = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = new Sim(seed * 7, 'hard', { hero: seed % 2 ? 'knight' : 'wisp', features: KNOT, startWave: 2 });
      const bot = new SkilledBot(seed);
      let lastEnd = -1;
      while (sim.state.alive && sim.state.tick < 60 * 40) {
        sim.step(bot.input(sim));
        for (const e of sim.state.events) {
          expect(e.type === 'knot_end' && e.how === 'cancel').toBe(false);
          if (e.type === 'knot_end') lastEnd = sim.state.tick;
          if (e.type === 'boss_intro') {
            bosses++;
            expect(sim.state.knots).toEqual([]);
            if (lastEnd >= sim.state.tick - 60 * KC.bossLeadSeconds) late++;
          }
        }
      }
    }
    expect(bosses).toBeGreaterThan(20);
    expect(late).toBe(0); // the last fuse ended at least bossLeadSeconds before the boss wave
  });

  it('the explicit rule: a knot still there when a boss wave begins is removed without a burst', () => {
    const sim = new Sim(3, 'hard', { hero: 'wisp', features: KNOT, startWave: 3 });
    sim.state.knots!.push({ id: 9999, x: 100, y: 100, r: 5, start: 0, burst: 10_000, shards: 8, speed: 1, angle: 0 });
    const all: SimEvent[] = [];
    while (!sim.state.boss) (sim.step(IDLE), all.push(...sim.state.events));
    expect(all).toContainEqual({ type: 'knot_end', id: 9999, x: 100, y: 100, how: 'cancel' });
    expect(sim.state.knots).toEqual([]);
    expect(all.filter((e) => e.type === 'spawn' && e.kind === 'rune_shard' && e.telegraphTicks > 1000)).toEqual([]);
  });
});

describe('hex knot: fairness (walking-only solver, 200 seeds; centre, corners and edges)', () => {
  it('a hero who ignores knots entirely (no parry, no dash) can always survive their bursts (1 or 2 knots)', { timeout: 120_000 }, () => {
    const waves = [2, 5, 8, 12, 16, 24];
    const how: Record<string, number> = {};
    const stuck: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
      const wave = waves[seed % waves.length]!;
      const piece = startKnots(seed * 53 + 11, wave, hx, hy, 1 + (seed % 2));
      expect(piece, `seed ${seed} ${spot}: no knot`).not.toBeNull();
      for (const k of piece!.sim.state.knots!) expect(Math.hypot(k.x - hx, k.y - hy)).toBeGreaterThanOrEqual(KC.minHeroDist);
      const r = walkingSolver(piece!);
      how[r.how.split(' ')[0]!] = (how[r.how.split(' ')[0]!] ?? 0) + 1;
      if (!r.ok) stuck.push(`seed ${seed} ${spot} wave ${wave}`);
    }
    expect(stuck).toEqual([]);
    console.log(`walking solver, knot bursts: ${JSON.stringify(how)}`);
  });

  it('the solver ends with nothing left: the bursts really happened and were survived', () => {
    const piece = startKnots(77, 8, 52, 31, 2)!;
    const s = piece.sim;
    let shards = 0;
    while (!resolved(s.state) && s.state.tick < 60 * 20) {
      s.state.alive = true;
      s.step(IDLE);
      shards += s.state.events.filter((e) => e.type === 'spawn' && e.kind === 'rune_shard').length;
    }
    expect(shards).toBe(2 * KC.shards);
  });
});

describe('hex knot: variants and replays', () => {
  it('a knot variant replay carries its own fingerprint, refused by production', async () => {
    const { decodeReplay, replayOf, tuningHash, playReplay } = await import('../src/sim/replay');
    for (const f of [KNOT, withFeatures('knot', 'patternPack')]) {
      const sim = new Sim(77, 'hard', { hero: 'knight', features: f });
      const bot = new SkilledBot(77);
      while (sim.state.alive && sim.state.tick < 60 * 50) sim.step(bot.input(sim));
      expect(sim.state.wave).toBeGreaterThanOrEqual(2);
      const r = JSON.parse(JSON.stringify(replayOf(sim)));
      expect(r.tuning).toBe(tuningHash(f));
      expect(r.tuning).not.toBe('f0214eba');
      expect(() => decodeReplay(r)).toThrow(/different tuning/);
      expect(playReplay(r, { features: f }).score).toBe(sim.score);
    }
  });
});

// ------------------------------------------------------------------ briar line

const BC = BRIAR.briar;
const HARD_MAX_SPEED = (BC.speed * TUNING.difficulty.hard.speed * TUNING.waves.speedCap) / 60; // px per tick, unslowed

describe('briar line: dark and the rows', () => {
  it('the production flags: no briar block, no walls field', () => {
    expect(FEATURES.briar.enabled).toBe(false);
    const sim = new Sim(5, 'hard', { hero: 'knight', startWave: 6 });
    expect(sim.params.briar).toBeNull();
    expect('walls' in sim.state).toBe(false);
  });

  it('the rows: wave 4+, one at a time, 0.75 s telegraph, 55 px/s, a 44 px gap within 80% of the walking reach', () => {
    expect([BC.unlockWave, BC.maxActive, BC.telegraphSeconds, BC.speed, BC.halfWidth, BC.gapPx, BC.reachFraction]).toEqual([4, 1, 0.75, 55, 3, 44, 0.8]);
    // the worst case (Hard, the wave speed cap, unslowed) is still slower than the hero walks
    expect(HARD_MAX_SPEED).toBeLessThan(TUNING.hero.speed / 60);
  });

  it('the single draw: before wave 4 a briar run is the production run', () => {
    const a = new Sim(4242, 'hard', { hero: 'knight', startWave: 2, bosses: false });
    const b = new Sim(4242, 'hard', { hero: 'knight', features: BRIAR, startWave: 2, bosses: false });
    const bot = new SkilledBot(8);
    while (a.state.wave < BC.unlockWave && a.state.alive && a.state.tick < 60 * 60) {
      const f = bot.input(a);
      a.step(f);
      b.step(f);
      const { walls, ...rest } = b.state;
      expect(walls).toEqual([]);
      expect(JSON.stringify(rest)).toBe(JSON.stringify(a.state));
    }
    expect(a.state.tick).toBeGreaterThan(60 * 25);
  });
});

describe('briar line: the rules', () => {
  it('enters from the edge farther from the hero; the gap lies within reach; telegraph before it moves; at most one', () => {
    let lines = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const [, hx, hy] = SPOTS[seed % SPOTS.length]!;
      const piece = startLine(seed * 17 + 3, [4, 8, 12, 24][seed % 4]!, hx, hy)!;
      expect(piece).not.toBeNull();
      const s = piece.sim.state;
      const p = piece.sim.params;
      const w = s.walls![0]!;
      lines++;
      const heroA = w.axis === 'x' ? hx : hy;
      const mid = w.axis === 'x' ? p.cx : p.cy;
      // the entering edge is the farther one (the hero exactly on the middle line: either is as far)
      if (heroA !== mid) expect(Math.abs(heroA - w.startPos)).toBeGreaterThan(Math.abs(heroA - w.endPos));
      expect(w.move - w.start).toBe(ticks(BC.telegraphSeconds));
      expect(w.move - w.start).toBeGreaterThanOrEqual(45);
      const across = w.axis === 'x' ? hy : hx;
      const reach = BC.reachFraction * p.heroSpeed * (wallArrival(w, hx, hy, p.heroRadius) - w.start);
      expect(Math.abs(w.gap - across), `seed ${seed}`).toBeLessThanOrEqual(reach + 1e-9);
      const [clo, chi] = w.axis === 'x' ? [p.y0, p.y1] : [p.x0, p.x1];
      expect(w.gap - w.gapHalf).toBeGreaterThanOrEqual(clo);
      expect(w.gap + w.gapHalf).toBeLessThanOrEqual(chi);
      // the telegraph sits outside the area the hero can reach: harmless
      expect(Math.abs(w.startPos - (w.dir > 0 ? (w.axis === 'x' ? p.x0 : p.y0) : w.axis === 'x' ? p.x1 : p.y1))).toBeGreaterThanOrEqual(p.spawnOffset);
      // the line is slower than the hero walks, on every difficulty
      expect(w.speed).toBeLessThan(p.heroSpeed);
    }
    expect(lines).toBe(200);
  });

  it('lethal on touch, unparryable (a pulse does nothing), the gap is safe, the dash i-frames pass through it', () => {
    const mk = (hy: number) => {
      const sim = new Sim(1, 'hard', { hero: 'knight', features: BRIAR, spawner: false });
      sim.state.hero.x = 200;
      sim.state.hero.y = hy;
      sim.state.walls!.push({ id: 500, axis: 'x', dir: 1, pos: 190, startPos: 38, endPos: 442, start: 0, move: 0, speed: 1, gap: 135, gapHalf: 22, halfWidth: 3 });
      return sim;
    };
    const hit = mk(60);
    for (let t = 0; t < 10 && hit.state.alive; t++) hit.step({ cursor: false, mx: 0, my: 0, buttons: BTN_PARRY });
    expect(hit.state.alive).toBe(false);
    expect(hit.state.walls).toHaveLength(1); // the parry did nothing to it
    const gap = mk(135 + 18); // centre 18 px off the gap centre: 18 + 3 <= 22
    for (let t = 0; t < 30; t++) gap.step(IDLE);
    expect(gap.state.alive).toBe(true);
    const edge = mk(135 + 20); // 20 + 3 > 22: the thorns touch
    for (let t = 0; t < 30 && edge.state.alive; t++) edge.step(IDLE);
    expect(edge.state.alive).toBe(false);
    const dash = mk(60);
    dash.state.hero.x = 198;
    for (let t = 0; t < 14 && dash.state.alive; t++) dash.step({ cursor: true, mx: 150, my: 60, buttons: t === 0 ? BTN_DASH : 0 });
    expect(dash.state.alive).toBe(true);
    expect(dash.state.hero.x).toBeLessThan(dash.state.walls![0]!.pos - 6);
    // the Knight's guard i-frames do not protect from it (unparryable)
    const guard = mk(60);
    guard.state.hero.guardInvulnUntil = 1e9;
    for (let t = 0; t < 10 && guard.state.alive; t++) guard.step(IDLE);
    expect(guard.state.alive).toBe(false);
  });

  it('Slow Time slows the line like projectiles; the telegraph is not slowed', () => {
    const run = (slow: boolean) => {
      const piece = startLine(9, 8, 400, 135)!;
      const s = piece.sim.state;
      if (slow) s.slowUntil = 1e9;
      const w0 = { ...s.walls![0]! };
      let t = 0;
      while (s.walls!.length && t < 2000) (s.alive = true, piece.sim.step(IDLE), t++);
      return { t, tele: w0.move - w0.start };
    };
    const a = run(false);
    const b = run(true);
    expect(b.tele).toBe(a.tele);
    expect(b.t - a.tele).toBeGreaterThan(1.9 * (a.t - a.tele));
  });

  it('no line is started while a curtain is alive, and no curtain while a line is alive (both directions)', () => {
    const all = withFeatures('briar', 'patternPack');
    let lineWithCurtain = 0;
    let curtainWithLine = 0;
    let lines = 0;
    let curtains = 0;
    for (let seed = 1; seed <= 30; seed++) {
      // the curtain and the line weigh a lot here, so they meet often
      const f: Features = { ...all, briar: { ...all.briar, weight: 6 }, patternPack: { ...all.patternPack, curtain: { ...all.patternPack.curtain, weight: 6 } } };
      const sim = new Sim(seed * 13, 'hard', { hero: 'wisp', features: f, startWave: 4, bosses: false });
      const bot = new SkilledBot(seed);
      while (sim.state.tick < 60 * 60) {
        const hadCurtain = sim.state.projectiles.some((pr) => pr.pack === 'curtain');
        const hadLine = sim.state.walls!.length > 0;
        sim.state.alive = true;
        sim.step(bot.input(sim));
        for (const e of sim.state.events) {
          if (e.type === 'briar') (lines++, hadCurtain && lineWithCurtain++);
          if (e.type === 'pack' && e.key === 'curtain') (curtains++, hadLine && curtainWithLine++);
        }
        expect(sim.state.walls!.length > 0 && sim.state.projectiles.some((pr) => pr.pack === 'curtain' && pr.born === sim.state.tick)).toBe(false);
      }
    }
    expect([lineWithCurtain, curtainWithLine]).toEqual([0, 0]);
    expect(lines).toBeGreaterThan(20);
    expect(curtains).toBeGreaterThan(20);
  });

  it('no sigil is placed in the gap corridor while a line is alive, and a gap never opens into a sigil', () => {
    let sigils = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const [, hx, hy] = SPOTS[seed % SPOTS.length]!;
      const piece = startLine(seed * 7 + 1, 6, hx, hy, true);
      if (!piece) continue;
      const s = piece.sim.state;
      const p = piece.sim.params;
      const w = s.walls![0]!;
      for (const g of s.sigils) expect(inGapCorridor(w, g.x, g.y, g.r)).toBe(false);
      while (s.walls!.length) {
        sigilHook.hook!(s, p);
        for (const g of s.sigils) (g.start === s.tick && sigils++, expect(inGapCorridor(w, g.x, g.y, g.r)).toBe(false));
        s.alive = true;
        piece.sim.step(IDLE);
      }
    }
    expect(sigils).toBeGreaterThan(100);
  });

  it('no line is alive at a boss intro (60 seeds): none is started that would still be there; a slowed one withers', () => {
    let bosses = 0;
    let lines = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = new Sim(seed * 11, 'hard', { hero: seed % 2 ? 'knight' : 'wisp', features: withFeatures('briar', 'knot'), startWave: 4 });
      const bot = new SkilledBot(seed);
      while (sim.state.tick < 60 * 50) {
        sim.state.alive = true;
        sim.step(bot.input(sim));
        for (const e of sim.state.events) {
          if (e.type === 'briar') lines++;
          expect(e.type === 'briar_end' && e.how === 'withered' && sim.state.slowUntil <= sim.state.tick - 1).toBe(false);
          if (e.type === 'boss_intro') (bosses++, expect(sim.state.walls).toEqual([]), expect(sim.state.knots).toEqual([]));
        }
        if (sim.state.boss) expect(sim.state.walls).toEqual([]);
      }
    }
    expect(bosses).toBeGreaterThan(30);
    expect(lines).toBeGreaterThan(30);
    // forced: a line kept alive by hand into the boss wave withers at the intro
    const sim = new Sim(3, 'hard', { hero: 'wisp', features: BRIAR, startWave: 3 });
    sim.state.walls!.push({ id: 777, axis: 'y', dir: 1, pos: -100, startPos: -100, endPos: 1e6, start: 0, move: 1e9, speed: 0.01, gap: 135, gapHalf: 22, halfWidth: 3 });
    const ev: SimEvent[] = [];
    while (!sim.state.boss) (sim.step(IDLE), ev.push(...sim.state.events));
    expect(ev).toContainEqual({ type: 'briar_end', id: 777, how: 'withered' });
    expect(sim.state.walls).toEqual([]);
  });
});

describe('briar line: fairness (walking-only solver, 200 seeds; centre, corners and edges; sigils included)', () => {
  for (const sigils of [false, true])
    it(`a walking hero (no parry, no dash) always reaches the gap${sigils ? ', with blood sigils placed before and during the line' : ''}`, { timeout: 180_000 }, () => {
      const waves = [4, 6, 8, 12, 16, 24];
      const how: Record<string, number> = {};
      const stuck: string[] = [];
      let skipped = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
        const wave = waves[seed % waves.length]!;
        const piece = startLine(seed * 41 + 5, wave, hx, hy, sigils);
        if (!piece) {
          skipped++; // every gap choice crossed a sigil: the line did not start (an orb fan instead)
          continue;
        }
        const r = walkingSolver(piece, 20, sigils ? sigilHook : {});
        how[r.how.split(' ')[0]!] = (how[r.how.split(' ')[0]!] ?? 0) + 1;
        if (!r.ok) stuck.push(`seed ${seed} ${spot} wave ${wave}`);
      }
      expect(stuck).toEqual([]);
      expect(skipped).toBeLessThan(20);
      console.log(`walking solver, briar${sigils ? ' + sigils' : ''}: ${JSON.stringify(how)}${skipped ? `, ${skipped} not started` : ''}`);
    });
});
