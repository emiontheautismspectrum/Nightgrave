/**
 * The new bosses (FEATURES.bosses, docs/FEATURES.md): the seeded boss order, bossMet per kind, the forced first boss of
 * the dev preview, and the score bound. Every test runs an enabled VARIANT (withFeatures); production stays dark.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TUNING } from '../src/data/tuning';
import { earliestBossDefeat, maxPossibleScore } from '../src/shared/maxScore';
import { bossCycle, bossKindFor, orderHash } from '../src/sim/boss';
import { makeParams } from '../src/sim/params';
import { encodeReplay } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import type { BossKind, SimState } from '../src/sim/state';
import { mulberryInputs } from './scripted';

const N = TUNING.bosses.everyNthWave;
const bossWave = (n: number): number => (n + 1) * N - 1;
const VARIANTS: [string, Features][] = [['thorn', withFeatures('thorn')], ['toller', withFeatures('toller')], ['both', withFeatures('bosses')]];
const idle = { cursor: false, mx: 0, my: 0, buttons: 0 };

describe('boss order', () => {
  it('with no new boss enabled: exactly the old alternation eye, lich, eye, ... for every seed', () => {
    const p = makeParams('hard', 'knight');
    expect(bossCycle(p)).toEqual(['eye', 'lich']);
    for (const seed of [0, 1, 7, 123456, 0xffffffff])
      for (let n = 0; n < 40; n++) expect(bossKindFor(p, bossWave(n), seed)).toBe(n % 2 === 0 ? 'eye' : 'lich');
  });

  for (const [name, f] of VARIANTS)
    it(`${name}: every cycle holds each enabled boss once; the same seed gives the same order; seeds differ`, () => {
      const p = makeParams('hard', 'wisp', f);
      const cyc = bossCycle(p);
      expect(cyc.length).toBe(name === 'both' ? 4 : 3);
      const orders = new Set<string>();
      const firsts = new Set<BossKind>();
      for (let seed = 1; seed <= 200; seed++) {
        const seq: BossKind[] = [];
        for (let n = 0; n < cyc.length * 6; n++) seq.push(bossKindFor(p, bossWave(n), seed));
        for (let c = 0; c < 6; c++) expect([...seq.slice(c * cyc.length, (c + 1) * cyc.length)].sort()).toEqual([...cyc].sort());
        // pure: the same (params, wave, seed) always gives the same kind
        for (let n = 0; n < seq.length; n++) expect(bossKindFor(p, bossWave(n), seed)).toBe(seq[n]);
        orders.add(seq.join(','));
        firsts.add(seq[0]!);
      }
      expect(orders.size).toBeGreaterThan(150);
      expect([...firsts].sort()).toEqual([...cyc].sort()); // a new boss can be the first boss of the night
    });

  it('the hash is integer-only and seed-sensitive', () => {
    expect(orderHash(1, 0, 1)).toBe(orderHash(1, 0, 1));
    expect(orderHash(1, 0, 1)).not.toBe(orderHash(2, 0, 1));
    expect(orderHash(1, 0, 1)).not.toBe(orderHash(1, 1, 1));
    expect(Number.isInteger(orderHash(9, 9, 9)) && orderHash(9, 9, 9) >= 0 && orderHash(9, 9, 9) < 2 ** 32).toBe(true);
  });

  it('NO PRNG draw: up to the first boss intro a variant run is identical to production (bossMet aside)', () => {
    for (const [, f] of VARIANTS) {
      const a = new Sim(31337, 'hard', { hero: 'knight' });
      const b = new Sim(31337, 'hard', { hero: 'knight', features: f });
      for (const fr of mulberryInputs(4, 60 * 60)) {
        a.state.alive = b.state.alive = true;
        a.step(fr);
        b.step(fr);
        if (a.state.events.some((e) => e.type === 'boss_intro')) break;
      }
      expect(a.state.boss).not.toBeNull();
      const strip = (s: SimState): unknown => ({ ...s, bossMet: null, boss: s.boss ? { ...s.boss, kind: null, x: 0, y: 0 } : null, events: [] });
      // the rng may differ only by the lich's spot draw at the intro (the eye and the new bosses draw nothing there)
      if (a.state.boss!.kind !== 'lich' && b.state.boss!.kind !== 'lich') expect(JSON.stringify(strip(b.state))).toBe(JSON.stringify(strip(a.state)));
      expect(b.state.tick).toBe(a.state.tick);
    }
  });
});

describe('bossMet and the encounter speed bonus per kind', () => {
  it('production state has eye and lich only; a variant adds exactly its enabled kinds', () => {
    expect(new Sim(1, 'hard').state.bossMet).toEqual({ eye: 0, lich: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('thorn') }).state.bossMet).toEqual({ eye: 0, lich: 0, thorn: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('toller') }).state.bossMet).toEqual({ eye: 0, lich: 0, toller: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('bosses') }).state.bossMet).toEqual({ eye: 0, lich: 0, thorn: 0, toller: 0 });
  });

  it('every kind counts its own encounters; the speed bonus follows the count of THAT kind', () => {
    const f = withFeatures('bosses');
    const sim = new Sim(5, 'easy', { hero: 'wisp', features: f, startWave: 3 });
    const met: BossKind[] = [];
    const speeds: number[] = [];
    while (met.length < 8 && sim.state.tick < 60 * 60 * 12) {
      sim.state.alive = true;
      sim.step(idle);
      const b = sim.state.boss;
      if (sim.state.events.some((e) => e.type === 'boss_intro') && b) {
        met.push(b.kind);
        speeds.push(b.speed);
        expect(b.encounter).toBe(met.filter((k) => k === b.kind).length - 1);
        expect(b.speed).toBeCloseTo(1 + Math.min(TUNING.bosses.encounterSpeedCap, TUNING.bosses.encounterSpeedStep * b.encounter), 12);
      }
      // only the order and the counters are under test: empty the bar at once (the boss is defeated without attacking)
      if (b && b.deathTick < 0) b.remaining = 0;
    }
    expect(met.length).toBe(8);
    for (const k of ['eye', 'lich', 'thorn', 'toller'] as const) expect(met.filter((m) => m === k).length).toBe(2);
    expect(sim.state.bossMet).toEqual({ eye: 2, lich: 2, thorn: 2, toller: 2 });
  });
});

describe('the forced first boss (dev preview; unrecorded)', () => {
  it('forces only the FIRST boss, only an enabled kind; later bosses follow the seeded order', () => {
    const f = withFeatures('bosses');
    for (const k of ['thorn', 'toller', 'eye', 'lich'] as const) {
      const sim = new Sim(77, 'easy', { features: f, startWave: 3, firstBoss: k });
      for (let i = 0; i < 80; i++) sim.step(idle);
      expect(sim.state.boss?.kind).toBe(k);
    }
    // a disabled kind is ignored (production flags): the usual eye
    const prod = new Sim(77, 'easy', { startWave: 3, firstBoss: 'thorn' });
    for (let i = 0; i < 80; i++) prod.step(idle);
    expect(prod.state.boss?.kind).toBe('eye');
    expect(prod.state.bossMet).toEqual({ eye: 1, lich: 0 });
  });

  it('a replay can never carry it: the replay has no such field and the verifier and the Worker never pass options', () => {
    const f = withFeatures('bosses');
    const sim = new Sim(77, 'easy', { features: f, firstBoss: 'toller' });
    for (const fr of mulberryInputs(2, 120)) sim.step(fr);
    const r = encodeReplay(77, 'easy', 'knight', sim.log, undefined, f) as unknown as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/firstBoss|startWave|toller/);
    const verifier = readFileSync('tools/verify/core.ts', 'utf8');
    expect(verifier).not.toMatch(/firstBoss|startWave|features/);
    for (const file of ['server/src/index.ts', 'server/src/verify.ts']) {
      let src = '';
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      expect(src).not.toMatch(/firstBoss|startWave/);
    }
  });
});

describe('score bound with the new bosses', () => {
  it('a dark build keeps the exact old bound; a variant bound is never smaller', () => {
    for (const k of [1, 2, 3, 6]) expect(earliestBossDefeat(k)).toBe(earliestBossDefeat(k, FEATURES));
    for (const [, f] of VARIANTS) {
      for (const k of [1, 2, 3, 6]) expect(earliestBossDefeat(k, f)).toBeLessThanOrEqual(earliestBossDefeat(k));
      for (const n of [60 * 30, 60 * 120, 60 * 600]) expect(maxPossibleScore(n, f)).toBeGreaterThanOrEqual(maxPossibleScore(n));
    }
  });
});
