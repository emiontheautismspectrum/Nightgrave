/**
 * Package U3b (docs/FEATURES.md): the random boss order (FEATURES.bossOrder), boss motion (FEATURES.bossMotion) and
 * the new boss attacks (FEATURES.bossMoves). Every test runs an enabled VARIANT (withFeatures); production stays dark.
 */
import { describe, expect, it } from 'vitest';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TUNING } from '../src/data/tuning';
import { earliestBossDefeat } from '../src/shared/maxScore';
import { bossCycle, bossKindFor, randomBossKind } from '../src/sim/boss';
import { makeParams } from '../src/sim/params';
import { Sim } from '../src/sim/sim';
import type { BossKind, SimState } from '../src/sim/state';
import { mulberryInputs } from './scripted';

const N = TUNING.bosses.everyNthWave;
const bossWave = (n: number): number => (n + 1) * N - 1;

// ------------------------------------------------------------------ block 1: the random boss order

describe('bossOrder: every boss wave draws its kind, never the same twice in a row', () => {
  const VARIANTS: [string, Features, number][] = [
    ['old bosses only', withFeatures('bossOrder'), 2],
    ['+ thorn', withFeatures('bossOrder', 'thorn'), 3],
    ['+ both new bosses', withFeatures('bossOrder', 'bosses'), 4],
  ];

  for (const [name, f, k] of VARIANTS)
    it(`${name}: a pure function of (seed, n); no immediate repeat over 200 seeds x 12 boss waves; shares within 20% of uniform`, () => {
      const p = makeParams('hard', 'knight', f);
      const kinds = bossCycle(p);
      expect(kinds.length).toBe(k);
      const count = new Map<BossKind, number>();
      const firsts = new Set<BossKind>();
      for (let seed = 1; seed <= 200; seed++) {
        const seq: BossKind[] = [];
        for (let n = 0; n < 12; n++) seq.push(bossKindFor(p, bossWave(n), seed));
        for (let n = 1; n < seq.length; n++) expect(seq[n], `seed ${seed} n ${n}`).not.toBe(seq[n - 1]);
        // the same seed always gives the same sequence (and the chain from n = 0 is the same function)
        for (let n = 0; n < seq.length; n++) {
          expect(bossKindFor(p, bossWave(n), seed)).toBe(seq[n]);
          expect(randomBossKind(kinds, n, seed)).toBe(seq[n]);
        }
        if (k === 2) for (let n = 2; n < seq.length; n++) expect(seq[n]).toBe(seq[n - 2]); // two kinds: an alternation
        for (const x of seq) count.set(x, (count.get(x) ?? 0) + 1);
        firsts.add(seq[0]!);
      }
      expect([...firsts].sort()).toEqual([...kinds].sort()); // any boss can come first
      // over many seeds and boss waves every kind's share is within 20% of uniform
      const big = new Map<BossKind, number>();
      for (let seed = 1; seed <= 2000; seed++) for (let n = 0; n < 12; n++) big.set(randomBossKind(kinds, n, seed), (big.get(randomBossKind(kinds, n, seed)) ?? 0) + 1);
      for (const x of kinds) expect(Math.abs((big.get(x) ?? 0) / (2000 * 12) - 1 / k), x).toBeLessThan(0.2 / k);
    });

  it('different seeds give different sequences', () => {
    const p = makeParams('hard', 'knight', withFeatures('bossOrder', 'bosses'));
    const seqs = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) seqs.add(Array.from({ length: 8 }, (_, n) => bossKindFor(p, bossWave(n), seed)).join(','));
    expect(seqs.size).toBeGreaterThan(150);
  });

  it('block off: exactly the order of today (the alternation, the cycle permutation with new bosses)', () => {
    for (const [on, off] of [[withFeatures('bossOrder'), FEATURES], [withFeatures('bossOrder', 'bosses'), withFeatures('bosses')]] as const) {
      const pOff = makeParams('hard', 'knight', off);
      expect(pOff.order).toBeNull();
      expect(makeParams('hard', 'knight', on).order).toBe(on.bossOrder);
      for (let seed = 1; seed <= 30; seed++)
        for (let n = 0; n < 12; n++) {
          const kind = bossKindFor(pOff, bossWave(n), seed);
          if (off === FEATURES) expect(kind).toBe(n % 2 ? 'lich' : 'eye');
        }
    }
  });

  it('NO PRNG draw: up to the first boss intro the variant run is identical to production', () => {
    for (const seed of [31337, 4242, 7]) {
      const a = new Sim(seed, 'hard', { hero: 'knight' });
      const b = new Sim(seed, 'hard', { hero: 'knight', features: withFeatures('bossOrder') });
      for (const fr of mulberryInputs(4, 60 * 60)) {
        a.state.alive = b.state.alive = true;
        a.step(fr);
        b.step(fr);
        if (a.state.events.some((e) => e.type === 'boss_intro')) break;
      }
      expect(a.state.boss).not.toBeNull();
      const strip = (s: SimState): unknown => ({ ...s, bossMet: null, boss: s.boss ? { ...s.boss, kind: null, x: 0, y: 0 } : null, events: [] });
      if (a.state.boss!.kind === b.state.boss!.kind) expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
      else if (b.state.boss!.kind !== 'lich') expect(JSON.stringify(strip(b.state))).toBe(JSON.stringify(strip(a.state)));
    }
  });

  it('the forced first boss of the dev preview still works; later bosses follow the drawn order', () => {
    const f = withFeatures('bossOrder', 'bosses');
    for (const k of ['thorn', 'toller', 'eye', 'lich'] as const) {
      const sim = new Sim(77, 'easy', { features: f, startWave: 3, firstBoss: k });
      for (let i = 0; i < 80; i++) sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
      expect(sim.state.boss?.kind).toBe(k);
    }
  });

  it('score bound: the fastest fight over the same kinds (unchanged by the order)', () => {
    for (const k of [1, 2, 5]) {
      expect(earliestBossDefeat(k, withFeatures('bossOrder'))).toBe(earliestBossDefeat(k));
      expect(earliestBossDefeat(k, withFeatures('bossOrder', 'bosses'))).toBe(earliestBossDefeat(k, withFeatures('bosses')));
    }
  });
});

// ------------------------------------------------------------------ block 2: boss motion

const MOTION = withFeatures('bossMotion', 'bosses');
const IDLE = { cursor: false, mx: 0, my: 0, buttons: 0 };

/** A whole first-encounter fight (immortal hero, the given inputs), calling `each` after every tick. */
function fight(kind: BossKind, seed: number, f: Features, each: (sim: Sim, prev: { x: number; y: number } | null) => void, d: 'easy' | 'medium' | 'hard' = 'hard'): Sim {
  const sim = new Sim(seed, d, { hero: seed % 2 ? 'knight' : 'wisp', features: f, startWave: 3, firstBoss: kind });
  const frames = mulberryInputs(seed, 60 * 100);
  let i = 0;
  while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 100) {
    const b0 = sim.state.boss;
    const prev = b0 && b0.deathTick < 0 ? { x: b0.x, y: b0.y } : null;
    sim.state.alive = true;
    sim.step(frames[i++ % frames.length]!);
    each(sim, prev);
  }
  return sim;
}

describe('bossMotion: the bodies move, and hold still whenever an attack is in progress', () => {
  const M = MOTION.bossMotion;
  const inBand = (x: number, y: number): boolean => x >= 48 + M.inset - 1e-9 && x <= 432 - M.inset + 1e-9 && y >= 27 + M.inset - 1e-9 && y <= M.yMax + 1e-9;

  for (const kind of ['eye', 'lich'] as const)
    it(`${kind}: still in the intro, then drifts at <= ${kind === 'eye' ? M.eye.speed : M.lich.speed} px/s; held from the attack start to the launch and while a beam / emission lives`, () => {
      const speed = (kind === 'eye' ? M.eye.speed : M.lich.speed) / 60;
      for (let seed = 1; seed <= 12; seed++) {
        let moved = 0;
        let held = 0;
        let start: [number, number] | null = null;
        let beamOrigin: [number, number] | null = null;
        fight(kind, seed, MOTION, (sim, prev) => {
          const s = sim.state;
          const b = s.boss;
          if (!b || !prev || b.deathTick >= 0) return;
          const t = s.tick - 1;
          if (t < b.introEnd) {
            start ??= [b.x, b.y];
            expect([b.x, b.y]).toEqual(start);
            return;
          }
          const step = Math.hypot(b.x - prev.x, b.y - prev.y);
          const teleport = s.events.some((e) => e.type === 'boss_teleport');
          if (!teleport) expect(step).toBeLessThanOrEqual(speed + 1e-9);
          if (step > 0 && !teleport) {
            moved++;
            // a moving body has no attack, beam or emission in progress (the hold); an attack may START on the tick
            // of a move (after it: its telegraph is fixed from the new position)
            if (b.attack) expect(b.attack.tpOut, `seed ${seed} tick ${t}`).toBe(t);
            expect(s.beams.length).toBe(0);
          }
          if ((b.attack && b.attack.tpOut < t) || s.beams.length) {
            held++;
            if (!teleport) expect(step).toBe(0);
          }
          // a telegraph fixed at the wind-up start is the attack's origin: the beam leaves from the body of the wind-up
          if (b.attack?.pattern === 'beam' && t === b.attack.windStart) beamOrigin = [b.x, b.y];
          for (const bm of s.beams) if (bm.start === t && beamOrigin) expect([bm.x, bm.y]).toEqual(beamOrigin);
          // the eye never leaves the band; the lich, outside it after a teleport, only ever drifts back in
          if (kind === 'eye') expect(inBand(b.x, b.y)).toBe(true);
        });
        expect(moved, `seed ${seed}`).toBeGreaterThan(0);
        expect(held).toBeGreaterThan(0);
      }
    });

  it('a drift target is in the band and never within minHeroDist of the hero when it is picked', () => {
    let picks = 0;
    for (const kind of ['eye', 'lich'] as const)
      for (let seed = 1; seed <= 20; seed++) {
        let n = 0;
        fight(kind, seed, MOTION, (sim) => {
          const b = sim.state.boss;
          if (!b?.drift || b.drift.n === n) return;
          n = b.drift.n;
          picks++;
          expect(inBand(b.drift.tx, b.drift.ty)).toBe(true);
          expect(Math.hypot(b.drift.tx - sim.state.hero.x, b.drift.ty - sim.state.hero.y)).toBeGreaterThanOrEqual(M.minHeroDist);
        });
      }
    expect(picks).toBeGreaterThan(40);
  });

  it('thorn mother: sinks before every 3rd attack, emerges >= 90 px from the hero, launches nothing while sunk, one segment per launch', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let sinks = 0;
      let launches = 0;
      let sunkSince = -1;
      fight('thorn', seed, MOTION, (sim, prev) => {
        const s = sim.state;
        const b = s.boss;
        const t = s.tick - 1;
        for (const e of s.events) {
          if (e.type === 'boss_sink') {
            sinks++;
            expect(b!.serial % M.thorn.relocateEvery).toBe(0);
            expect(b!.serial).toBeGreaterThan(0);
            sunkSince = t;
          }
          if (e.type === 'boss_teleport') {
            expect(t - sunkSince).toBe(Math.round(M.thorn.sinkSeconds * 60));
            expect(Math.hypot(e.x - s.hero.x, e.y - s.hero.y)).toBeGreaterThanOrEqual(M.thorn.emergeMinHeroDist);
            expect(inBand(e.x, e.y)).toBe(true);
          }
          if (e.type === 'boss_attack') {
            launches++;
            const a = sunkSince >= 0 ? t - sunkSince : 1e9;
            expect(a).toBeGreaterThanOrEqual(Math.round((M.thorn.sinkSeconds + M.thorn.emergeSeconds) * 60) + 15);
            sunkSince = -1;
          }
        }
        // she never moves otherwise
        if (b && prev && !s.events.some((e) => e.type === 'boss_teleport')) expect([b.x, b.y]).toEqual([prev.x, prev.y]);
      });
      expect(launches).toBe(12);
      expect(sinks).toBe(3); // before attacks 4, 7 and 10
    }
  });

  it('the toller does not drift (it teleports only with its peal, FEATURES.bossMoves)', () => {
    fight('toller', 3, MOTION, (sim, prev) => {
      const b = sim.state.boss;
      if (b && prev) expect([b.x, b.y]).toEqual([prev.x, prev.y]);
    });
  });

  it('NO PRNG draw: with the same inputs the PRNG walks the same values with and without motion', () => {
    for (const kind of ['eye', 'lich', 'toller'] as const) {
      const trace = (f: Features): number[] => {
        const out: number[] = [];
        fight(kind, 9, f, (sim) => {
          if (out[out.length - 1] !== sim.state.rng) out.push(sim.state.rng);
        });
        return out;
      };
      expect(trace(MOTION), kind).toEqual(trace(withFeatures('bosses')));
    }
  });

  it('NO PRNG draw for the thorn mother either: her sink and her emerging spot draw nothing', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let before = 0;
      let checked = 0;
      const sim = new Sim(seed, 'hard', { hero: 'wisp', features: MOTION, startWave: 3, firstBoss: 'thorn' });
      const frames = mulberryInputs(seed, 60 * 100);
      for (let i = 0; sim.state.bossesDefeated === 0 && i < 60 * 100; i++) {
        before = sim.state.rng;
        sim.state.alive = true;
        sim.step(frames[i]!);
        const ev = sim.state.events;
        if (ev.some((e) => e.type === 'boss_teleport') && !ev.some((e) => e.type === 'pickup_spawn')) {
          expect(sim.state.rng).toBe(before);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('block off: no drift key, the bodies stand (production and the new bosses alone)', () => {
    for (const f of [FEATURES, withFeatures('bosses')])
      for (const kind of ['eye', 'thorn'] as const) {
        if (kind === 'thorn' && f === FEATURES) continue;
        fight(kind, 4, f, (sim, prev) => {
          const b = sim.state.boss;
          if (!b) return;
          expect('drift' in b).toBe(false);
          if (prev) expect([b.x, b.y]).toEqual([prev.x, prev.y]);
          expect(sim.state.events.some((e) => e.type === 'boss_sink')).toBe(false);
        });
      }
    void IDLE;
  });
});
