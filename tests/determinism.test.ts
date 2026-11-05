import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { decodeReplay, encodeReplay, playReplay } from '../src/sim/replay';
import { mulberryInputs } from './scripted';

function run(seed: number, frames = mulberryInputs(seed * 7 + 3, 60 * 60)) {
  const sim = new Sim(seed, 'hard');
  for (const f of frames) sim.step(f);
  return sim;
}

describe('determinism', () => {
  for (const seed of [1, 42, 1337, 20261104, 0xffffffff]) {
    it(`seed ${seed}: same seed + same inputs => identical state and score`, () => {
      const a = run(seed);
      const b = run(seed);
      expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
      expect(b.score).toBe(a.score);
      expect(a.state.tick).toBeGreaterThan(0);
    });
  }

  it('different seeds produce different runs', () => {
    const frames = mulberryInputs(99, 600);
    const a = run(1, frames);
    const b = run(2, frames);
    expect(JSON.stringify(a.state.projectiles)).not.toBe(JSON.stringify(b.state.projectiles));
  });

  for (const seed of [5, 77, 31337]) {
    it(`seed ${seed}: replay (encode -> JSON -> decode -> play) reproduces the run exactly`, () => {
      const live = run(seed);
      const json = JSON.stringify(encodeReplay(seed, 'hard', live.log));
      const replayed = playReplay(JSON.parse(json));
      // `events` is a per-tick render buffer; the live sim was stepped (as no-ops) after death, the replay was not.
      const strip = (st: object) => JSON.stringify({ ...st, events: undefined });
      expect(strip(replayed.state)).toBe(strip(live.state));
      expect(replayed.score).toBe(live.score);
      expect(replayed.log.length).toBe(live.log.length);
    });
  }

  it('a scripted run actually exercises spawns, parries and (usually) death', () => {
    let parries = 0;
    let deaths = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = run(seed);
      parries += s.state.parryCount;
      deaths += s.state.alive ? 0 : 1;
    }
    expect(parries).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
  });

  it('replay RLE compresses idle runs', () => {
    const r = encodeReplay(1, 'easy', Array.from({ length: 500 }, () => ({ cursor: true, mx: 10, my: 10, buttons: 0 })));
    expect(r.runs).toEqual([[500, 1, 10, 10, 0]]);
    expect(decodeReplay(r).frames.length).toBe(500);
  });
});

describe('replay validation', () => {
  it('rejects a replay recorded under different tuning', () => {
    const r = encodeReplay(1, 'hard', []);
    expect(() => decodeReplay({ ...r, tuning: 'deadbeef' })).toThrow(/tuning/);
  });
  it('rejects malformed replays', () => {
    const r = encodeReplay(1, 'hard', []);
    for (const bad of [null, 1, {}, { ...r, v: 2 }, { ...r, seed: -1 }, { ...r, seed: 1.5 }, { ...r, difficulty: '__proto__' },
      { ...r, runs: [[1e300, 1, 0, 0, 0]] }, { ...r, runs: [[0, 1, 0, 0, 0]] }, { ...r, runs: [[1, 1, 0, 0]] }]) {
      expect(() => decodeReplay(bad)).toThrow();
    }
  });
});
