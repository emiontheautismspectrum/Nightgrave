import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../src/data/tuning';
import { encodeReplay, playReplay } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import { botInput } from './bot';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
/** Generous budget: intro 2 s + 12 attacks at ~2 s + the last attack's flight; 90 s of game time. */
const BUDGET = 60 * 90;

function finishes(seed: number, d: Difficulty, wave: number, parry: boolean): boolean {
  const sim = new Sim(seed, d, { startWave: wave });
  while (sim.state.alive && sim.state.bossesDefeated === 0 && sim.state.tick < BUDGET) sim.step(botInput(sim, { parry }));
  return sim.state.bossesDefeated === 1;
}

const results: string[] = [];

describe('boss bots (simple, deterministic)', () => {
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
    for (const parry of [false, true])
      for (const [boss, wave] of [['eye', 3], ['lich', 7]] as const)
        it(`${d} ${parry ? 'parry' : 'dodge-only'} bot vs ${boss}`, () => {
          const won = SEEDS.filter((s) => finishes(s, d, wave, parry)).length;
          results.push(`${d.padEnd(6)} ${parry ? 'parry ' : 'dodge '} ${boss.padEnd(4)} ${won}/${SEEDS.length}`);
          // Easy must be beaten by both bots (a dumb bot may still slip on a seed or two); Medium/Hard are reported only
          if (d === 'easy') expect(won).toBeGreaterThanOrEqual(8);
        });
  it('report', () => {
    console.log(`boss bot results (fights won / seeds):\n${results.join('\n')}`);
  });
});

describe('golden replays', () => {
  // bot runs through the first boss on every difficulty: recorded score/tick/bosses must never drift silently
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
    it(`${d}: golden bot run`, () => {
      const sim = new Sim(7, d);
      while (sim.state.alive && sim.state.tick < 60 * 120) sim.step(botInput(sim));
      const rep = playReplay(JSON.parse(JSON.stringify(encodeReplay(7, d, sim.log))));
      expect(rep.score).toBe(sim.score);
      expect({ score: sim.score, tick: sim.state.tick, bosses: sim.state.bossesDefeated, alive: sim.state.alive }).toMatchSnapshot();
    });
});
