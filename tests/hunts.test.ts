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
import { KNOT, startKnots } from './hunt_tools';
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
    expect(made).toBeGreaterThan(40);
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
