import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('wave timing', () => {
  it('a new wave every 15 s: wave index k at tick 60 + 900k (k = 0..6)', () => {
    const sim = new Sim(7, 'medium', { bosses: false });
    const at: number[] = [];
    while (sim.state.tick < 60 + 900 * 6 + 1) {
      sim.state.alive = true; // test only: an immortal hero, so the clock can be observed
      sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
      for (const e of sim.state.events) if (e.type === 'wave') at.push(sim.state.tick - 1);
    }
    expect(at).toEqual([0, 1, 2, 3, 4, 5, 6].map((k) => 60 + 900 * k));
  });
});
