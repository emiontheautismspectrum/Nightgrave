/**
 * Hunts report (FEATURES.knot + FEATURES.briar): the skilled bot with the hunt blocks ENABLED against the same flags
 * without them, both with and without the pattern pack, both heroes, same seeds.
 * Run: npx vite-node tools/bot/hunts_report.ts [seeds=50] [difficulty=hard] [immortalSeeds=seeds]
 *
 * Targets (Hard, 50 seeds; docs/ROADMAP_V2.md package B, stage B1):
 * - the skilled bot parries >= 60% of the knots that end (burst or parried) in its runs;
 * - wave hazard, deaths per minute in waves 0-2 and 4-6, with the immortal skilled bot (method [H] of ROADMAP_V2
 *   section 1: on a death the killer is removed and the death counted): within +15% of the same measurement without
 *   the hunt blocks;
 * - heroes within +-12% of each other (median survival and median score);
 * - median survival within -15% of the same variant without the hunt blocks;
 * - no hunt threat (knot shards, briar lines) above 25% of all deaths;
 * - the score bound stays above every run.
 */
import { FEATURES, withFeatures, type FeatureKey, type Features } from '../../src/data/features';
import type { HeroId } from '../../src/data/heroes';
import type { Difficulty } from '../../src/data/tuning';
import { maxPossibleScore } from '../../src/shared/maxScore';
import type { InputFrame } from '../../src/sim/input';
import { Sim, step } from '../../src/sim/sim';
import type { SimState } from '../../src/sim/state';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 50);
const D = (process.argv[3] ?? 'hard') as Difficulty;
const NI = Number(process.argv[4] ?? N);
const CAP = { easy: 60 * 900, medium: 60 * 540, hard: 60 * 270 }[D];
const HEROES: HeroId[] = ['knight', 'wisp'];
/** Waves of the hazard bands (row 2 of the ROADMAP_V2 diagnosis table); the immortal run stops at the first boss after them. */
const BANDS: [string, number[]][] = [['0-2', [0, 1, 2]], ['4-6', [4, 5, 6]]];
const IMMORTAL_UNTIL_WAVE = 7;

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const pct = (a: number, b: number): string => `${((100 * a) / (b || 1)).toFixed(1)}%`;
const gap = (a: number, b: number): number => Math.abs(a - b) / Math.max(a, b, 1e-9);

/** Track which projectiles are knot shards (spawned on a knot's burst tick, at the knot). */
function tagShards(s: SimState, shards: Set<number>): void {
  for (const e of s.events)
    if (e.type === 'knot_end' && e.how === 'burst')
      for (const pr of s.projectiles) if (pr.kind === 'rune_shard' && pr.born === s.tick - 1 && Math.hypot(pr.x - e.x, pr.y - e.y) < 12) shards.add(pr.id);
}

/** The cause of a death event: 'knot' (a knot shard), 'briar', or the usual causes. */
function causeOf(by: number, before: SimState, shards: Set<number>): string {
  if (by === -3) return 'briar';
  if (by === -2) return 'sigil';
  if (by === -1) return 'beam';
  if (shards.has(by)) return 'knot';
  const pr = before.projectiles.find((p) => p.id === by);
  return pr ? (pr.boss ? `boss ${pr.kind}` : pr.pack ? `pack ${pr.pack}` : pr.kind) : 'unknown';
}

interface Mortal { surv: number[]; score: number[]; deaths: Record<string, number>; knotsEnded: number; knotsParried: number; lines: number; ratio: number }

function mortal(hero: HeroId, features: Features): Mortal {
  const out: Mortal = { surv: [], score: [], deaths: {}, knotsEnded: 0, knotsParried: 0, lines: 0, ratio: 0 };
  for (let seed = 1; seed <= N; seed++) {
    const sim = new Sim(seed * 7919, D, { hero, features });
    const bot = new SkilledBot(seed);
    const shards = new Set<number>();
    while (sim.state.alive && sim.state.tick < CAP) {
      const before = { ...sim.state, projectiles: [...sim.state.projectiles] };
      sim.step(bot.input(sim));
      tagShards(sim.state, shards);
      for (const e of sim.state.events) {
        if (e.type === 'knot_end' && e.how !== 'cancel') (out.knotsEnded++, e.how === 'parry' && out.knotsParried++);
        else if (e.type === 'briar') out.lines++;
        else if (e.type === 'death') {
          const c = causeOf(e.by, before, shards);
          out.deaths[c] = (out.deaths[c] ?? 0) + 1;
        }
      }
    }
    out.surv.push(sim.state.survivalTicks / 60);
    out.score.push(sim.score);
    out.ratio = Math.max(out.ratio, sim.score / maxPossibleScore(sim.state.tick, features));
  }
  return out;
}

interface Hazard { deaths: Record<string, number>; ticks: Record<string, number>; causes: Record<string, number> }

/**
 * The immortal skilled bot [H]: when a step kills the hero, the state before the step is restored, the killer is
 * removed (the projectile, the sigil or beam or briar line touching the hero) and the death counted; then the same
 * input is stepped again. Runs until wave IMMORTAL_UNTIL_WAVE.
 */
function immortal(hero: HeroId, features: Features): Hazard {
  const out: Hazard = { deaths: {}, ticks: {}, causes: {} };
  for (const [b] of BANDS) (out.deaths[b] = 0, out.ticks[b] = 0);
  const bandOf = (w: number): string | null => BANDS.find(([, ws]) => ws.includes(Math.max(0, w)))?.[0] ?? null;
  for (let seed = 1; seed <= NI; seed++) {
    const sim = new Sim(seed * 7919, D, { hero, features });
    const bot = new SkilledBot(seed);
    const shards = new Set<number>();
    const s = sim.state;
    while (s.wave < IMMORTAL_UNTIL_WAVE && s.tick < 60 * 400) {
      const input: InputFrame = bot.input(sim);
      const snap = structuredClone(s);
      const band = bandOf(s.wave);
      step(s, input, sim.params, sim.options);
      const removed = new Set<number>();
      for (let guard = 0; !s.alive; guard++) {
        const d = s.events.find((e) => e.type === 'death');
        const by = d && d.type === 'death' ? d.by : 0;
        tagShards(s, shards);
        const c = causeOf(by, s, shards);
        out.causes[c] = (out.causes[c] ?? 0) + 1;
        if (band) out.deaths[band]!++;
        const born = by > 0 && !snap.projectiles.some((p) => p.id === by); // spawned during this very step
        if (born || guard >= 5) {
          // the killer appeared inside this step (e.g. a burst at the hero): keep the step, remove it, revive
          if (by > 0) s.projectiles = s.projectiles.filter((p) => p.id !== by);
          else if (by === -3) s.walls = [];
          else if (by === -1) s.beams = [];
          else if (by === -2) s.sigils = s.sigils.filter((g) => Math.hypot(g.x - s.hero.x, g.y - s.hero.y) > g.r + 12);
          s.alive = true;
          s.deathTick = -1;
          break;
        }
        removed.add(by);
        const r = structuredClone(snap) as unknown as Record<string, unknown>;
        for (const k of Object.keys(r)) (s as unknown as Record<string, unknown>)[k] = r[k];
        const h = s.hero;
        s.projectiles = s.projectiles.filter((p) => !removed.has(p.id));
        if (removed.has(-2)) s.sigils = s.sigils.filter((g) => Math.hypot(g.x - h.x, g.y - h.y) > g.r + 12);
        if (removed.has(-1)) s.beams = [];
        if (removed.has(-3)) s.walls = [];
        step(s, input, sim.params, sim.options);
      }
      tagShards(s, shards);
      if (band) out.ticks[band]! += 1;
    }
  }
  return out;
}

const deathsPerMin = (h: Hazard, b: string): number => h.deaths[b]! / Math.max(1e-9, h.ticks[b]! / 3600);

const HUNTS: FeatureKey[] = ['knot', 'briar'];
const VARIANTS: { name: string; off: Features; on: Features }[] = [
  { name: 'today', off: FEATURES, on: withFeatures(...HUNTS) },
  { name: 'pack ', off: withFeatures('patternPack'), on: withFeatures('patternPack', ...HUNTS) },
];

console.log(`hunts report: ${D}, ${N} seeds (immortal: ${NI} seeds to wave ${IMMORTAL_UNTIL_WAVE})`);
const checks: [string, boolean, string][] = [];
for (const v of VARIANTS) {
  const res = Object.fromEntries(HEROES.map((h) => [h, { off: mortal(h, v.off), on: mortal(h, v.on) }])) as Record<HeroId, { off: Mortal; on: Mortal }>;
  const haz = D === 'hard' && NI > 0 ? (Object.fromEntries(HEROES.map((h) => [h, { off: immortal(h, v.off), on: immortal(h, v.on) }])) as Record<HeroId, { off: Hazard; on: Hazard }>) : null;
  for (const h of HEROES) {
    const r = res[h];
    console.log(`  ${v.name} ${h.padEnd(6)} without hunts: survival median ${median(r.off.surv).toFixed(1)} s, score median ${median(r.off.score).toFixed(0)}`);
    console.log(`  ${v.name} ${h.padEnd(6)} with hunts:    survival median ${median(r.on.surv).toFixed(1)} s, score median ${median(r.on.score).toFixed(0)} | knots ended ${r.on.knotsEnded}, parried ${pct(r.on.knotsParried, r.on.knotsEnded)} | lines ${r.on.lines} | best score / bound ${r.on.ratio.toFixed(3)}`);
    const all = Object.values(r.on.deaths).reduce((a, b) => a + b, 0);
    console.log(`         deaths with hunts: ${Object.entries(r.on.deaths).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    checks.push([`${v.name} ${h}: knots parried >= 60%`, r.on.knotsParried / (r.on.knotsEnded || 1) >= 0.6, pct(r.on.knotsParried, r.on.knotsEnded)]);
    checks.push([`${v.name} ${h}: median survival >= 85% of the same flags without hunts`, median(r.on.surv) >= 0.85 * median(r.off.surv), `${median(r.on.surv).toFixed(1)} vs ${median(r.off.surv).toFixed(1)} s (${pct(median(r.on.surv), median(r.off.surv))})`]);
    for (const k of ['knot', 'briar']) checks.push([`${v.name} ${h}: ${k} <= 25% of deaths`, (r.on.deaths[k] ?? 0) / (all || 1) <= 0.25, pct(r.on.deaths[k] ?? 0, all)]);
    checks.push([`${v.name} ${h}: score bound above every run`, r.on.ratio < 1, r.on.ratio.toFixed(3)]);
    if (haz)
      for (const [b] of BANDS) {
        const off = deathsPerMin(haz[h].off, b);
        const on = deathsPerMin(haz[h].on, b);
        console.log(`         hazard waves ${b} (deaths/min, immortal): without ${off.toFixed(2)}, with ${on.toFixed(2)} (${haz[h].on.deaths[b]} deaths in ${(haz[h].on.ticks[b]! / 3600).toFixed(1)} min)`);
        checks.push([`${v.name} ${h}: hazard waves ${b} within +15%`, on <= off * 1.15, `${on.toFixed(2)} vs ${off.toFixed(2)} (${pct(on, off)})`]);
      }
    if (haz) console.log(`         immortal causes with hunts: ${Object.entries(haz[h].on.causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  checks.push([`${v.name}: heroes within 12% (median survival, hunts on)`, gap(median(res.knight.on.surv), median(res.wisp.on.surv)) <= 0.12, pct(gap(median(res.knight.on.surv), median(res.wisp.on.surv)), 1)]);
  checks.push([`${v.name}: heroes within 12% (median score, hunts on)`, gap(median(res.knight.on.score), median(res.wisp.on.score)) <= 0.12, pct(gap(median(res.knight.on.score), median(res.wisp.on.score)), 1)]);
}
console.log('targets:');
for (const [name, ok, detail] of checks) console.log(`  ${ok ? 'PASS' : 'MISS'}  ${name}: ${detail}`);
