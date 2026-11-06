/**
 * Multiplier report: per difficulty and bot (skilled, heuristic parry bot, dodge-only), over N seeds:
 * parries per run, the share of successful pulses that stepped the multiplier, the mean of each run's highest
 * multiplier and the overall highest, mean final score and mean survival. Also prints a hash of every run's survival
 * ticks (scoring changes must leave survival identical). Run: npx vite-node tools/bot/multiplier_report.ts [seeds]
 */
import type { Difficulty } from '../../src/data/tuning';
import type { InputFrame } from '../../src/sim/input';
import { maxPossibleScore } from '../../src/shared/maxScore';
import { Sim } from '../../src/sim/sim';
import { botInput } from '../../tests/bot';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 50);
const CAP = { easy: 60 * 900, medium: 60 * 540, hard: 60 * 270 } as Record<Difficulty, number>;
type Bot = { name: string; make: (seed: number) => (sim: Sim) => InputFrame };
const BOTS: Bot[] = [
  { name: 'skilled', make: (seed) => { const b = new SkilledBot(seed); return (sim) => b.input(sim); } },
  { name: 'heuristic', make: () => (sim) => botInput(sim, { parry: true }) },
  { name: 'dodge-only', make: (seed) => { const b = new SkilledBot(seed, false); return (sim) => b.input(sim); } },
];

let hash = 2166136261;
for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  for (const bot of BOTS) {
    let parries = 0, pulses = 0, steps = 0, perfect = 0, maxSum = 0, maxAll = 0, score = 0, surv = 0, ratio = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sim = new Sim(seed * 7919, d);
      const input = bot.make(seed);
      let runMax = sim.state.multiplier;
      while (sim.state.alive && sim.state.tick < CAP[d]) {
        const before = sim.state.multiplier;
        const pc = sim.state.parryCount;
        sim.step(input(sim));
        const s = sim.state;
        if (s.parryCount > pc) pulses += s.parryCount - pc;
        if (s.multiplier > before) {
          steps++;
          if (s.multiplier - before > sim.params.multStep) perfect++;
        }
        runMax = Math.max(runMax, s.multiplier);
      }
      const s = sim.state;
      parries += s.parryCount;
      maxSum += runMax / 100;
      maxAll = Math.max(maxAll, runMax / 100);
      score += sim.score;
      ratio = Math.max(ratio, sim.score / maxPossibleScore(s.tick));
      surv += s.survivalTicks / 60;
      hash = Math.imul(hash ^ s.survivalTicks, 16777619) >>> 0;
    }
    console.log(
      `${d.padEnd(6)} ${bot.name.padEnd(10)} parries/run ${(parries / N).toFixed(1).padStart(5)}  stepped ${(pulses ? (100 * steps) / pulses : 0).toFixed(0).padStart(3)}%` +
        `  perfect ${(pulses ? (100 * perfect) / pulses : 0).toFixed(0).padStart(3)}%  avg max x${(maxSum / N).toFixed(2)}  max x${maxAll.toFixed(2)}` +
        `  score ${(score / N).toFixed(0).padStart(6)}  survival ${(surv / N).toFixed(1)}s  score/bound max ${(ratio * 100).toFixed(1)}%`,
    );
  }
}
console.log(`survival hash ${hash.toString(16)}`);
