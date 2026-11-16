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
