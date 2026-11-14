/**
 * Pattern pack report (FEATURES.patternPack): the skilled bot under the production flags ("today") and under the
 * enabled variant, same seeds, both heroes. Prints the bot targets of the pack and per-piece numbers.
 * Run: npx vite-node tools/bot/pack_report.ts [seeds=100] [difficulty=hard] [startWave=0]
 *
 * Targets (Hard, 100 seeds): median survival of each hero >= 85% of today's; the heroes within 12% of each other
 * (median survival and median score); wave 8 reached by >= 8% of the runs; no single piece above 25% of all deaths.
 */
import { FEATURES, PACK_KEYS, withFeatures, type Features, type PackKey } from '../../src/data/features';
import type { HeroId } from '../../src/data/heroes';
import type { Difficulty } from '../../src/data/tuning';
import { maxPossibleScore } from '../../src/shared/maxScore';
import { Sim } from '../../src/sim/sim';
import type { Projectile } from '../../src/sim/state';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 100);
const D = (process.argv[3] ?? 'hard') as Difficulty;
const START = Number(process.argv[4] ?? 0);
const CAP = { easy: 60 * 900, medium: 60 * 540, hard: 60 * 270 }[D];
const HEROES: HeroId[] = ['knight', 'wisp'];
const PACK = withFeatures('patternPack');

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const pct = (a: number, b: number): string => `${((100 * a) / (b || 1)).toFixed(1)}%`;

interface PieceStat { picked: number; shots: number; violet: number; parried: number; deaths: number }
interface Result { surv: number[]; score: number[]; wave8: number; ratio: number; deaths: Record<string, number>; pieces: Record<PackKey, PieceStat> }

function run(hero: HeroId, features: Features): Result {
  const pieces = Object.fromEntries(PACK_KEYS.map((k) => [k, { picked: 0, shots: 0, violet: 0, parried: 0, deaths: 0 }])) as Record<PackKey, PieceStat>;
  const out: Result = { surv: [], score: [], wave8: 0, ratio: 0, deaths: {}, pieces };
  for (let seed = 1; seed <= N; seed++) {
    const sim = new Sim(seed * 7919, D, { hero, features, ...(START ? { startWave: START } : {}) });
    const bot = new SkilledBot(seed);
    const seen = new Map<number, PackKey>();
    let maxWave = 0;
    while (sim.state.alive && sim.state.tick < CAP) {
      const before = new Map<number, Projectile>(sim.state.projectiles.map((p) => [p.id, p]));
      sim.step(bot.input(sim));
      maxWave = Math.max(maxWave, sim.state.wave);
      for (const p of sim.state.projectiles)
        if (p.pack && !seen.has(p.id)) {
          seen.set(p.id, p.pack);
          pieces[p.pack].shots++;
          if (p.parryable) pieces[p.pack].violet++;
        }
      for (const e of sim.state.events) {
        if (e.type === 'pack') pieces[e.key].picked++;
        else if (e.type === 'parry_hit' || e.type === 'trail_kill') {
          const k = seen.get(e.id) ?? before.get(e.id)?.pack;
          if (k) pieces[k].parried++;
        } else if (e.type === 'death') {
          const pr = before.get(e.by) ?? sim.state.projectiles.find((p) => p.id === e.by);
          const cause = e.by === -1 ? 'beam' : e.by === -2 ? 'sigil' : pr?.pack ? `pack:${pr.pack}` : pr?.boss ? `boss ${pr.kind}` : (pr?.kind ?? 'unknown');
          out.deaths[cause] = (out.deaths[cause] ?? 0) + 1;
          if (pr?.pack) pieces[pr.pack].deaths++;
        }
      }
    }
    out.surv.push(sim.state.survivalTicks / 60);
    out.score.push(sim.score);
    if (maxWave >= 8) out.wave8++;
    out.ratio = Math.max(out.ratio, sim.score / maxPossibleScore(sim.state.tick, features));
  }
  return out;
}

const today = Object.fromEntries(HEROES.map((h) => [h, run(h, FEATURES)])) as Record<HeroId, Result>;
const pack = Object.fromEntries(HEROES.map((h) => [h, run(h, PACK)])) as Record<HeroId, Result>;

console.log(`pattern pack report: ${D}, ${N} seeds${START ? `, start wave ${START}` : ''}`);
for (const [name, r] of [['today', today], ['pack ', pack]] as const)
  for (const h of HEROES)
    console.log(`  ${name} ${h.padEnd(6)} survival median ${median(r[h].surv).toFixed(1)} s | score median ${median(r[h].score).toFixed(0)} | wave 8+ ${pct(r[h].wave8, N)} | best score / bound ${r[h].ratio.toFixed(3)}`);

const gap = (a: number, b: number): number => Math.abs(a - b) / Math.max(a, b);
const all = HEROES.flatMap((h) => Object.values(pack[h].deaths)).reduce((x, y) => x + y, 0);
const pieceDeaths = (k: PackKey): number => HEROES.reduce((n, h) => n + pack[h].pieces[k].deaths, 0);
const worst = [...PACK_KEYS].sort((a, b) => pieceDeaths(b) - pieceDeaths(a))[0]!;
const checks: [string, boolean, string][] = [
  ...HEROES.map((h): [string, boolean, string] => [`${h}: median survival >= 85% of today`, median(pack[h].surv) >= 0.85 * median(today[h].surv), `${median(pack[h].surv).toFixed(1)} s vs ${median(today[h].surv).toFixed(1)} s (${pct(median(pack[h].surv), median(today[h].surv))})`]),
  ['heroes within 12%: median survival', gap(median(pack.knight.surv), median(pack.wisp.surv)) <= 0.12, pct(gap(median(pack.knight.surv), median(pack.wisp.surv)), 1)],
  ['heroes within 12%: median score', gap(median(pack.knight.score), median(pack.wisp.score)) <= 0.12, pct(gap(median(pack.knight.score), median(pack.wisp.score)), 1)],
  ...HEROES.map((h): [string, boolean, string] => [`${h}: wave 8 reached by >= 8%`, pack[h].wave8 / N >= 0.08, `${pct(pack[h].wave8, N)} (today ${pct(today[h].wave8, N)})`]),
  ['no piece above 25% of all deaths', pieceDeaths(worst) / (all || 1) <= 0.25, `${worst} ${pct(pieceDeaths(worst), all)}`],
  ['score bound above every run', Math.max(pack.knight.ratio, pack.wisp.ratio) < 1, `best ratio ${Math.max(pack.knight.ratio, pack.wisp.ratio).toFixed(3)}`],
];
console.log('targets:');
for (const [name, ok, detail] of checks) console.log(`  ${ok ? 'PASS' : 'MISS'}  ${name}: ${detail}`);

console.log('per piece (both heroes): picked | survived (instances without a death by it) | deaths (share of all deaths) | violet shots destroyed by the hero');
for (const k of PACK_KEYS) {
  const t = HEROES.reduce((a, h) => ({ picked: a.picked + pack[h].pieces[k].picked, violet: a.violet + pack[h].pieces[k].violet, parried: a.parried + pack[h].pieces[k].parried, deaths: a.deaths + pack[h].pieces[k].deaths }), { picked: 0, violet: 0, parried: 0, deaths: 0 });
  console.log(`  ${k.padEnd(13)} ${String(t.picked).padStart(5)} | ${t.picked ? pct(t.picked - t.deaths, t.picked).padStart(6) : '     -'} | ${String(t.deaths).padStart(3)} (${pct(t.deaths, all)}) | ${t.violet ? pct(t.parried, t.violet) : '-'}`);
}
const causes: Record<string, number> = {};
for (const h of HEROES) for (const [k, v] of Object.entries(pack[h].deaths)) causes[k] = (causes[k] ?? 0) + v;
console.log(`deaths by cause (pack): ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
