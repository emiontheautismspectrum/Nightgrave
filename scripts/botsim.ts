/** Balance report: median survival of the heuristic bot per difficulty. Run: npm run bot */
import { TICK_RATE, type Difficulty } from '../src/data/tuning';
import { Sim } from '../src/sim/sim';
import { median, runBot } from '../tests/bot';

const SEEDS = Number(process.env.SEEDS ?? 40);
const CAP = 60 * TICK_RATE * 10;
for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  const secs: number[] = [];
  const waves: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sim = new Sim(seed * 7919, d);
    secs.push(runBot(sim, CAP) / TICK_RATE);
    waves.push(sim.state.wave);
  }
  const sorted = [...secs].sort((a, b) => a - b);
  console.log(
    `${d.padEnd(6)} median ${median(secs).toFixed(1)}s  p25 ${sorted[Math.floor(SEEDS * 0.25)]?.toFixed(1)}s  p75 ${sorted[Math.floor(SEEDS * 0.75)]?.toFixed(1)}s  max ${sorted[SEEDS - 1]?.toFixed(1)}s  median wave ${median(waves)}`,
  );
}
