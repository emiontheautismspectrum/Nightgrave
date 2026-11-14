/**
 * Records the golden corpus (tests/fixtures/golden_corpus.json): fixed Hard runs of the skilled bot, both heroes, as
 * compact binary input logs with their exact score, length and death tick. tests/golden_corpus.test.ts replays them.
 * The corpus pins the rules: it is re-recorded ONLY by a change that is meant to change them (docs/FEATURES.md).
 * Run: npx vite-node tools/bot/golden_record.ts <commit the rules were recorded at>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HeroId } from '../../src/data/heroes';
import { encodeInputLog } from '../../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';
import { Sim } from '../../src/sim/sim';
import { SkilledBot } from '../../tests/skilled';

/** Bot seeds per hero (the sim seed is botSeed * 7919, as in tools/bot/balance.ts): short, median and boss runs. */
const SEEDS: Record<HeroId, number[]> = {
  knight: [4, 26, 10, 8, 7, 5, 1, 15, 6, 19],
  wisp: [53, 2, 4, 20, 13, 5, 10, 7, 6, 44],
};
const CAP = 60 * 270;

const commit = process.argv[2] ?? '';
if (!/^[0-9a-f]{7,40}$/.test(commit)) {
  console.error('usage: npx vite-node tools/bot/golden_record.ts <commit hash>');
  process.exit(2);
}
const runs = [];
for (const hero of Object.keys(SEEDS) as HeroId[])
  for (const botSeed of SEEDS[hero]) {
    const seed = botSeed * 7919;
    const sim = new Sim(seed, 'hard', { hero });
    const bot = new SkilledBot(botSeed);
    let bossReached = false;
    while (sim.state.alive && sim.state.tick < CAP) {
      sim.step(bot.input(sim));
      if (sim.state.boss) bossReached = true;
    }
    if (sim.state.alive) throw new Error(`seed ${botSeed} ${hero}: the run did not end by death`);
    runs.push({ hero, seed, botSeed, score: sim.score, ticks: sim.state.tick, deathTick: sim.state.deathTick, bossReached, bossesDefeated: sim.state.bossesDefeated, log: encodeInputLog(sim.log, hero) });
  }
const out = { recordedAt: commit, tuning: tuningFingerprint(), clientVersion: CLIENT_VERSION, difficulty: 'hard', runs };
const file = join(__dirname, '..', '..', 'tests', 'fixtures', 'golden_corpus.json');
writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`golden corpus: ${runs.length} runs, ${runs.filter((r) => r.bossReached).length} reach a boss, ${runs.reduce((n, r) => n + r.ticks, 0)} ticks -> ${file}`);
