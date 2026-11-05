import { Sim } from '../../src/sim/sim';
import { SkilledBot } from '../../tests/skilled';
const causes: Record<string, number> = {};
for (let seed = 1; seed <= 40; seed++) {
  const sim = new Sim(seed * 7919, 'easy');
  const bot = new SkilledBot(seed);
  let last = '';
  while (sim.state.alive && sim.state.tick < 60 * 900) {
    const pre = new Map(sim.state.projectiles.map((q) => [q.id, q]));
    sim.step(bot.input(sim));
    for (const e of sim.state.events)
      if (e.type === 'death') {
        const q = pre.get(e.by);
        const age = q ? sim.state.tick - q.born : -1;
        last = `${e.by < 0 ? 'beam' : q?.kind}${sim.state.boss ? '@boss' : ''}${age < 12 && age >= 0 ? '(unseen)' : ''}${q?.boss ? '' : ''}`;
      }
  }
  causes[last] = (causes[last] ?? 0) + 1;
}
console.log(causes);
