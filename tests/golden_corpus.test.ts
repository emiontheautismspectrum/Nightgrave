/**
 * GOLDEN CORPUS: 20 recorded Hard runs (10 Knight, 10 Wisp; the skilled bot, fixed seeds; recorded by
 * tools/bot/golden_record.ts at the commit named in the fixture). Each input log is decoded and re-simulated, and the
 * score, the length in ticks and the death tick must match EXACTLY. This test must pass unchanged before and after
 * every change that is not meant to change the rules (every "dark" merge: docs/FEATURES.md).
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeInputLog, encodeInputLog } from '../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { Sim } from '../src/sim/sim';

interface GoldenRun { hero: string; seed: number; botSeed: number; score: number; ticks: number; deathTick: number; bossReached: boolean; bossesDefeated: number; log: string }
interface Golden { recordedAt: string; tuning: string; clientVersion: string; difficulty: string; runs: GoldenRun[] }

const FILE = join(__dirname, 'fixtures', 'golden_corpus.json');
const G = JSON.parse(readFileSync(FILE, 'utf8')) as Golden;

describe('golden corpus', () => {
  it('the fixture: 20 Hard runs, 10 per hero, varied lengths, at least 3 reach a boss, under 300 KB', () => {
    expect(G.recordedAt).toMatch(/^[0-9a-f]{40}$/);
    expect(G.difficulty).toBe('hard');
    expect(G.runs.length).toBe(20);
    expect(G.runs.filter((r) => r.hero === 'knight').length).toBe(10);
    expect(G.runs.filter((r) => r.hero === 'wisp').length).toBe(10);
    expect(G.runs.filter((r) => r.bossReached).length).toBeGreaterThanOrEqual(3);
    expect(G.runs.filter((r) => r.bossesDefeated > 0).length).toBeGreaterThanOrEqual(3);
    const ticks = G.runs.map((r) => r.ticks);
    expect(Math.min(...ticks)).toBeLessThan(60 * 15);
    expect(Math.max(...ticks)).toBeGreaterThan(60 * 120);
    expect(statSync(FILE).size).toBeLessThan(300 * 1024);
  });

  it('the rules it was recorded under are the rules of this build (fingerprint and version)', () => {
    expect(tuningFingerprint()).toBe(G.tuning);
    expect(CLIENT_VERSION).toBe(G.clientVersion);
  });

  for (const r of G.runs)
    it(`${r.hero} seed ${r.seed}: score ${r.score}, ${r.ticks} ticks, death at ${r.deathTick}`, () => {
      const log = decodeInputLog(r.log, r.ticks + 1, true);
      expect(log).not.toBeNull();
      expect(log!.hero).toBe(r.hero);
      expect(log!.frames.length).toBe(r.ticks);
      const sim = new Sim(r.seed, 'hard', { hero: log!.hero });
      let bossReached = false;
      for (const f of log!.frames) {
        expect(sim.state.alive).toBe(true); // never a frame after the death
        sim.step(f);
        if (sim.state.boss) bossReached = true;
      }
      expect({ score: sim.score, ticks: sim.state.tick, deathTick: sim.state.deathTick, alive: sim.state.alive, bossReached, bossesDefeated: sim.state.bossesDefeated })
        .toEqual({ score: r.score, ticks: r.ticks, deathTick: r.deathTick, alive: false, bossReached: r.bossReached, bossesDefeated: r.bossesDefeated });
      expect(encodeInputLog(sim.log, log!.hero)).toBe(r.log); // the codec round-trips byte for byte
    });
});
