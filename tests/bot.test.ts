import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../src/data/tuning';
import { Sim } from '../src/sim/sim';
import { median, runBot } from './bot';

describe('skill matters', () => {
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${d}: the dodging bot clearly outlives standing still`, () => {
      const bot: number[] = [];
      const still: number[] = [];
      for (let seed = 1; seed <= 8; seed++) {
        bot.push(runBot(new Sim(seed, d), 60 * 60 * 5));
        const s = new Sim(seed, d);
        while (s.state.alive && s.state.tick < 60 * 60 * 5) s.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
        still.push(s.state.survivalTicks);
      }
      expect(median(bot)).toBeGreaterThan(median(still) * 3);
    });
  }
});
