/**
 * Balance report: skilled bot and dodge-only bot, 50 seeds per difficulty.
 * Run: npx vite-node tools/bot/balance.ts [seeds]
 */
import type { Difficulty } from '../../src/data/tuning';
import { BTN_DASH, BTN_PARRY } from '../../src/sim/input';
import { Sim } from '../../src/sim/sim';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 50);
const CAP = { easy: 60 * 900, medium: 60 * 540, hard: 60 * 270 } as Record<Difficulty, number>;
const q = (a: number[], f: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))] ?? 0;
};

for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
  const surv: number[] = [];
  const dodge: number[] = [];
  let kills = 0;
  let reachedBoss = 0;
  let parries = 0;
  let dashes = 0;
  let minutes = 0;
  for (let seed = 1; seed <= N; seed++) {
    const sim = new Sim(seed * 7919, d);
    const bot = new SkilledBot(seed);
    while (sim.state.alive && sim.state.tick < CAP[d]) {
      const f = bot.input(sim);
      sim.step(f);
      for (const e of sim.state.events) if (e.type === 'dash_start') dashes++;
    }
    surv.push(sim.state.survivalTicks / 60);
    parries += sim.state.parryCount;
    minutes += sim.state.survivalTicks / 3600;
    if (sim.state.bossesDefeated > 0) kills++;
    if (sim.state.bossWave >= 0) reachedBoss++;
    const dsim = new Sim(seed * 7919, d);
    const dbot = new SkilledBot(seed, false); // the same human-like player, never parrying
    while (dsim.state.alive && dsim.state.tick < CAP[d]) dsim.step(dbot.input(dsim));
    dodge.push(dsim.state.survivalTicks / 60);
  }
  void BTN_DASH;
  void BTN_PARRY;
  console.log(
    `${d.padEnd(6)} skilled median ${q(surv, 0.5).toFixed(0)}s (p25 ${q(surv, 0.25).toFixed(0)} p75 ${q(surv, 0.75).toFixed(0)}) ` +
      `boss reached ${reachedBoss}/${N} killed ${kills}/${N} parries/min ${(parries / minutes).toFixed(1)} dashes/min ${(dashes / minutes).toFixed(1)} | ` +
      `dodge-only median ${q(dodge, 0.5).toFixed(0)}s (p25 ${q(dodge, 0.25).toFixed(0)} p75 ${q(dodge, 0.75).toFixed(0)})`,
  );
}
