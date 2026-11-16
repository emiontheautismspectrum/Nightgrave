/**
 * New-boss report (FEATURES.bosses): every boss at its FIRST encounter (wave 3, the dev option firstBoss), the skilled
 * bot, both heroes, the new rows ENABLED. The old bosses are measured the same way for comparison.
 * Run: npx vite-node tools/bot/bosses_report.ts [seeds=50] [difficulty=hard] [bosses=eye,lich,thorn,toller]
 *
 * Targets (Hard, 50 seeds; docs/ROADMAP_V2.md package B, stages B3 and B5):
 * - the IMMORTAL skilled bot (on a death the killer is removed and the death counted, method [H]) dies 0.3-0.7 times
 *   per fight with a new boss (today's bosses: 0.2-0.6);
 * - heroes within +-15% per boss (deaths per fight, and the share of fights the mortal bot survives);
 * - fights last 22-32 s (intro to defeat, immortal bot);
 * - entity caps per fight: Toller toll orbs alive (one toll <= 30), knell rings alive <= 1, blooms <= 3, walls <= 1.
 */
import { withFeatures } from '../../src/data/features';
import type { HeroId } from '../../src/data/heroes';
import type { Difficulty } from '../../src/data/tuning';
import { Sim, step } from '../../src/sim/sim';
import type { BossKind, SimState } from '../../src/sim/state';
import { SkilledBot } from '../../tests/skilled';

const N = Number(process.argv[2] ?? 50);
const D = (process.argv[3] ?? 'hard') as Difficulty;
const KINDS = (process.argv[4] ?? 'eye,lich,thorn,toller').split(',') as BossKind[];
/** Row overrides for tuning (tools only): NG_ROWS='{"toller":{"toll":{"count":8}}}' deep-merges into the rows. */
function merge(a: unknown, b: unknown): unknown {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
  return out;
}
const BASE = withFeatures('bosses');
const F = (process.env.NG_ROWS ? { ...BASE, bosses: merge(BASE.bosses, JSON.parse(process.env.NG_ROWS)) } : BASE) as typeof BASE;
const HEROES: HeroId[] = ['knight', 'wisp'];

interface Fight { deaths: number; secs: number; causes: Record<string, number>; caps: { toll: number; knell: number; blooms: number; walls: number } }

/** The cause of a death: the boss attack (by its serial) or the threat kind. */
function cause(by: number, s: SimState, patterns: Map<number, string>): string {
  if (by === -3) return 'hedge';
  if (by === -2) return 'sigil';
  if (by === -1) return patterns.get(s.beams[0]?.serial ?? -1) ?? 'beam';
  const pr = s.projectiles.find((p) => p.id === by);
  return pr ? (pr.boss ? (patterns.get(pr.boss) ?? `boss ${pr.kind}`) : pr.kind) : 'new';
}

/** One fight with the immortal skilled bot: deaths, length, causes, the largest entity counts seen. */
function immortal(kind: BossKind, hero: HeroId, seed: number): Fight {
  const sim = new Sim(seed * 7919, D, { hero, features: F, startWave: 3, firstBoss: kind });
  const bot = new SkilledBot(seed);
  const s = sim.state;
  const out: Fight = { deaths: 0, secs: 0, causes: {}, caps: { toll: 0, knell: 0, blooms: 0, walls: 0 } };
  let start = -1;
  const patterns = new Map<number, string>();
  while (s.bossesDefeated === 0 && s.tick < 60 * 120) {
    const input = bot.input(sim);
    const snap = structuredClone(s);
    step(s, input, sim.params, sim.options);
    for (let guard = 0; !s.alive; guard++) {
      const d = s.events.find((e) => e.type === 'death');
      const by = d && d.type === 'death' ? d.by : 0;
      if (s.boss && s.tick - 1 >= s.boss.start) {
        out.deaths++;
        const c = cause(by, snap, patterns);
        out.causes[c] = (out.causes[c] ?? 0) + 1;
      }
      const r = structuredClone(snap) as unknown as Record<string, unknown>;
      for (const k of Object.keys(r)) (s as unknown as Record<string, unknown>)[k] = r[k];
      if (by > 0) s.projectiles = s.projectiles.filter((p) => p.id !== by);
      else if (by === -3) s.walls = [];
      else if (by === -1) s.beams = [];
      else if (by === -2) s.sigils = s.sigils.filter((g) => Math.hypot(g.x - s.hero.x, g.y - s.hero.y) > g.r + 12);
      step(s, input, sim.params, sim.options);
      if (guard >= 5 && !s.alive) {
        s.alive = true; // the killer appeared inside the step: keep it, revive
        s.deathTick = -1;
      }
    }
    if (s.events.some((e) => e.type === 'boss_intro')) start = s.tick - 1;
    for (const e of s.events) if (e.type === 'boss_attack' && s.boss) patterns.set(s.boss.serial, e.pattern);
    const b = s.boss;
    if (b) {
      const toll = s.projectiles.filter((p) => p.boss > 0 && p.kind === 'orb_small' && kind === 'toller');
      const perSerial = new Map<number, number>();
      for (const p of toll) perSerial.set(p.boss, (perSerial.get(p.boss) ?? 0) + 1);
      out.caps.toll = Math.max(out.caps.toll, ...perSerial.values(), 0);
      out.caps.knell = Math.max(out.caps.knell, new Set(s.projectiles.filter((p) => p.boss > 0 && p.kind === 'blade' && kind === 'toller').map((p) => p.boss)).size);
      const lit = (b.attack?.pattern === 'bloom' && s.tick >= b.attack.windStart ? b.attack.points.length : 0) + (b.pending ?? []).filter((e) => e.op === 'bloom').length;
      out.caps.blooms = Math.max(out.caps.blooms, lit);
      out.caps.walls = Math.max(out.caps.walls, s.walls?.length ?? 0);
    }
  }
  out.secs = (s.tick - start) / 60;
  return out;
}

/** The mortal skilled bot: did it survive the fight? */
function survives(kind: BossKind, hero: HeroId, seed: number): boolean {
  const sim = new Sim(seed * 7919, D, { hero, features: F, startWave: 3, firstBoss: kind });
  const bot = new SkilledBot(seed);
  while (sim.state.alive && sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 120) sim.step(bot.input(sim));
  return sim.state.bossesDefeated === 1;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(a, b, 1e-9);

console.log(`boss report: ${D}, ${N} seeds per hero, first encounter, FEATURES.bosses enabled`);
for (const kind of KINDS) {
  const per: Record<string, { dpf: number; win: number; secs: number[]; causes: Record<string, number>; caps: Fight['caps'] }> = {};
  for (const hero of HEROES) {
    const fights: Fight[] = [];
    let win = 0;
    for (let seed = 1; seed <= N; seed++) {
      fights.push(immortal(kind, hero, seed));
      if (survives(kind, hero, seed)) win++;
    }
    const causes: Record<string, number> = {};
    const caps = { toll: 0, knell: 0, blooms: 0, walls: 0 };
    for (const f of fights) {
      for (const [k, v] of Object.entries(f.causes)) causes[k] = (causes[k] ?? 0) + v;
      for (const k of Object.keys(caps) as (keyof typeof caps)[]) caps[k] = Math.max(caps[k], f.caps[k]);
    }
    per[hero] = { dpf: fights.reduce((a, f) => a + f.deaths, 0) / N, win: win / N, secs: fights.map((f) => f.secs), causes, caps };
  }
  const k = per.knight!;
  const w = per.wisp!;
  const all = [...k.secs, ...w.secs];
  console.log(`${kind.padEnd(6)} deaths/fight knight ${k.dpf.toFixed(2)} wisp ${w.dpf.toFixed(2)} (both ${((k.dpf + w.dpf) / 2).toFixed(2)}, heroes ${(rel(k.dpf, w.dpf) * 100).toFixed(0)}% apart)` +
    ` | mortal wins knight ${(k.win * 100).toFixed(0)}% wisp ${(w.win * 100).toFixed(0)}% (${(rel(k.win, w.win) * 100).toFixed(0)}% apart)` +
    ` | fight s median ${median(all).toFixed(1)} min ${Math.min(...all).toFixed(1)} max ${Math.max(...all).toFixed(1)}`);
  console.log(`       causes knight ${JSON.stringify(k.causes)} wisp ${JSON.stringify(w.causes)} | caps ${JSON.stringify(k.caps)} ${JSON.stringify(w.caps)}`);
}
