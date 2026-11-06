/**
 * Balance report per hero: the skilled bot (tests/skilled.ts; an arc hero turns to its threats like a human) and the
 * same player never parrying, N seeds per difficulty. 'classic' = the old cosmetic heroes (the pre-heroes rules,
 * test-only) for the before / after comparison. Also: the best observed score / maxPossibleScore ratio per hero.
 * Run: npx vite-node tools/bot/balance.ts [seeds] [difficulty]
 */
import type { AnyHeroId } from '../../src/data/heroes';
import type { Difficulty } from '../../src/data/tuning';
import { maxPossibleScore } from '../../src/shared/maxScore';
import { Sim } from '../../src/sim/sim';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 50);
const ONLY = process.argv[3] as Difficulty | undefined;
const CAP = { easy: 60 * 900, medium: 60 * 540, hard: 60 * 270 } as Record<Difficulty, number>;
const HEROES: AnyHeroId[] = ['classic', 'knight', 'wisp'];
const q = (a: number[], f: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))] ?? 0;
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

console.log('difficulty hero    | survival s median (p25-p75) | parries/run | max mult avg / max | score median (mean) | guard breaks / trail kills per run | bound ratio | dodge-only median s');
for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  if (ONLY && d !== ONLY) continue;
  for (const hero of HEROES) {
    const surv: number[] = [];
    const score: number[] = [];
    const parries: number[] = [];
    const maxMult: number[] = [];
    const dodge: number[] = [];
    let breaks = 0;
    let trail = 0;
    let ratio = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sim = new Sim(seed * 7919, d, { hero });
      const bot = new SkilledBot(seed);
      let mm = sim.state.multiplier;
      while (sim.state.alive && sim.state.tick < CAP[d]) {
        sim.step(bot.input(sim));
        mm = Math.max(mm, sim.state.multiplier);
        for (const e of sim.state.events) {
          if (e.type === 'guard_break') breaks++;
          else if (e.type === 'trail_kill') trail++;
        }
      }
      surv.push(sim.state.survivalTicks / 60);
      score.push(sim.score);
      parries.push(sim.state.parryCount);
      maxMult.push(mm / 100);
      ratio = Math.max(ratio, sim.score / maxPossibleScore(sim.state.tick));
      const dsim = new Sim(seed * 7919, d, { hero });
      const dbot = new SkilledBot(seed, false);
      while (dsim.state.alive && dsim.state.tick < CAP[d]) dsim.step(dbot.input(dsim));
      dodge.push(dsim.state.survivalTicks / 60);
    }
    console.log(
      `${d.padEnd(6)} ${hero.padEnd(8)} | ${q(surv, 0.5).toFixed(0).padStart(4)} (${q(surv, 0.25).toFixed(0)}-${q(surv, 0.75).toFixed(0)}) | ` +
        `${mean(parries).toFixed(1)} | ${mean(maxMult).toFixed(2)} / ${Math.max(...maxMult).toFixed(2)} | ` +
        `${q(score, 0.5).toFixed(0)} (${mean(score).toFixed(0)}) | ${(breaks / N).toFixed(2)} / ${(trail / N).toFixed(1)} | ` +
        `${ratio.toFixed(3)} | ${q(dodge, 0.5).toFixed(0)}`,
    );
  }
}
