/** One-off bounded search (Stage 5 follow-up): is a dodge-bot loss survivable without parry? Run: npx vitest run tools/bot/dodge_search.test.ts --dir tools */
import { it } from 'vitest';
import { BTN_DASH, type InputFrame } from '../../src/sim/input';
import { Sim } from '../../src/sim/sim';
import { botInput } from '../../tests/bot';

type Ov = { from: number; to: number; dx: number; dy: number; dash: boolean };
const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

function play(seed: number, wave: number, ovs: Ov[]): { won: boolean; death: number; why: string } {
  const sim = new Sim(seed, 'easy', { startWave: wave });
  let why = '';
  while (sim.state.alive && sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 90) {
    const t = sim.state.tick;
    const o = ovs.find((v) => t >= v.from && t < v.to);
    let f: InputFrame = botInput(sim, { parry: false });
    if (o) {
      const h = sim.state.hero;
      f = { cursor: true, mx: Math.round(h.x + o.dx * 40), my: Math.round(h.y + o.dy * 40), buttons: o.dash && t === o.from ? BTN_DASH : 0 };
    }
    const pr = new Map(sim.state.projectiles.map((q) => [q.id, q]));
    sim.step(f);
    for (const e of sim.state.events) if (e.type === 'death') { const q = pr.get(e.by); why = e.by < 0 ? 'beam' : `${q?.kind} boss=${q?.boss}`; }
  }
  return { won: sim.state.bossesDefeated === 1, death: sim.state.tick, why };
}

it('search', () => {
  for (const [wave, name] of [[3, 'eye'], [7, 'lich']] as const)
    for (let seed = 1; seed <= 10; seed++) {
      const base = play(seed, wave, []);
      if (base.won) continue;
      let sims = 1;
      let found: Ov[] | null = null;
      const queue: [Ov[], number][] = [[[], base.death]];
      while (queue.length && sims < 2000 && !found) {
        const [ovs, death] = queue.shift()!;
        for (const back of [15, 30, 50, 80]) for (const [dx, dy] of DIRS) for (const dash of [false, true]) {
          if (sims >= 2000 || found) break;
          const o: Ov = { from: Math.max(0, death - back), to: death - back + Math.min(back, 30), dx: dx!, dy: dy!, dash };
          const r = play(seed, wave, [...ovs, o]);
          sims++;
          if (r.won) found = [...ovs, o];
          else if (r.death > death + 30 && ovs.length < 4) queue.push([[...ovs, o], r.death]);
        }
      }
      console.log(`${name} seed ${seed}: bot dies at ${base.death} (${base.why}); ${sims} variations; ${found ? `SURVIVABLE with ${found.length} evade change(s): ${JSON.stringify(found.map((o) => [o.from, o.dx.toFixed(2), o.dy.toFixed(2), o.dash]))}` : 'no surviving path found'}`);
    }
}, 600000);
