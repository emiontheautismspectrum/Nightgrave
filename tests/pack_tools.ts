/**
 * Test tools for the pattern pack (FEATURES.patternPack): the enabled variant, a harness that starts ONE set piece
 * alone with the hero placed anywhere, and a walking-only solver (no parry, no dash) in the style of
 * tools/bot/dodge_search.test.ts. Not part of the game.
 */
import { PACK_KEYS, withFeatures, type Features, type PackKey } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import type { InputFrame } from '../src/sim/input';
import type { SimParams } from '../src/sim/params';
import { Sim, step, type SimOptions } from '../src/sim/sim';
import type { SimState } from '../src/sim/state';
import { botInput } from './bot';

/** The production flags with the pattern pack enabled. */
export const PACK: Features = withFeatures('patternPack');

/** A variant whose pool holds ONE pack row (the other pack rows weigh 0). */
export function onlyPiece(key: PackKey): Features {
  const pp = { ...PACK.patternPack } as Record<string, unknown>;
  for (const k of PACK_KEYS) pp[k] = { ...PACK.patternPack[k], weight: k === key ? 1 : 0 };
  return { ...PACK, patternPack: pp as unknown as Features['patternPack'] };
}

const IDLE: InputFrame = { cursor: false, mx: 0, my: 0, buttons: 0 };

/** Hero start points: the centre, the four corners and the four edge midpoints of the area the hero can stand on. */
export const SPOTS: readonly (readonly [string, number, number])[] = [
  ['centre', 240, 135], ['top-left', 52, 31], ['top-right', 428, 31], ['bottom-left', 52, 239], ['bottom-right', 428, 239],
  ['top', 240, 31], ['bottom', 240, 239], ['left', 52, 135], ['right', 428, 135],
];

export interface Piece {
  key: PackKey;
  sim: Sim;
  /** The tick the piece started on (its `pack` event). */
  start: number;
  /** Ids of every projectile and caster the piece produced so far (kept up to date by `watch`). */
  projectiles: Set<number>;
  casters: Set<number>;
}

/**
 * Start ONE instance of a set piece alone: the existing patterns weigh 0, the stream is off, no boss, the hero stands
 * at (hx, hy) when the director picks it. Returns null if the piece could not start (it fell back to an orb fan).
 */
export function startPiece(key: PackKey, seed: number, wave: number, hx: number, hy: number, difficulty: Difficulty = 'hard', options: SimOptions = {}): Piece | null {
  const sim = new Sim(seed, difficulty, { hero: 'wisp', ...options, features: onlyPiece(key), startWave: wave, bosses: false });
  const p = sim.params as { patterns: unknown };
  p.patterns = Object.fromEntries(Object.entries(sim.params.patterns).map(([k, v]) => [k, typeof v === 'object' ? { ...v, weight: 0 } : v]));
  sim.state.streamTimer = 1e9;
  sim.state.hero.x = hx;
  sim.state.hero.y = hy;
  sim.state.patternAt = sim.params.graceTicks;
  for (let i = 0; i < sim.params.graceTicks + 5; i++) {
    sim.step(IDLE);
    if (sim.state.events.some((e) => e.type === 'pack' && e.key === key)) {
      sim.state.patternAt = 1e9; // nothing else is ever picked
      const piece: Piece = { key, sim, start: sim.state.tick - 1, projectiles: new Set(), casters: new Set() };
      watch(piece.sim.state, piece);
      return piece;
    }
    if (sim.state.tick > sim.params.graceTicks + 1) break;
  }
  return null;
}

/** Record the entities the piece owns (call after every step). */
export function watch(s: SimState, piece: Pick<Piece, 'key' | 'projectiles' | 'casters'>): void {
  for (const pr of s.projectiles) if (pr.pack === piece.key) piece.projectiles.add(pr.id);
  for (const c of s.casters) if (c.pack === piece.key) piece.casters.add(c.id);
}

/** Nothing of the piece is left: no queued emission, telegraph, caster or projectile. */
export const resolved = (s: SimState): boolean =>
  s.projectiles.length === 0 && s.casters.length === 0 && s.telegraphs.length === 0 && (s.packQueue?.length ?? 0) === 0;

type Policy = (s: SimState, p: SimParams) => InputFrame;

const walkTo = (x: number, y: number): Policy => () => ({ cursor: true, mx: x, my: y, buttons: 0 });
/** The heuristic bot restricted to walking: it never parries and its dash presses are removed. */
const walkBot: Policy = (s, p) => ({ ...botInput({ state: s, params: p } as unknown as Sim, { parry: false }), buttons: 0 });

/** Play a policy on a COPY of the state until the piece is resolved (survived), the hero dies or the time is up. */
function play(s0: SimState, p: SimParams, opts: SimOptions, policy: Policy, limit: number): { ok: boolean; death: number } {
  const s = structuredClone(s0);
  while (s.alive && s.tick < limit && !resolved(s)) step(s, policy(s, p), p, opts);
  return { ok: s.alive, death: s.tick };
}

export interface WalkResult {
  ok: boolean;
  /** How it was solved: 'stay', 'bot', 'walk x,y', 'detour' (walk somewhere, then the walking bot), or 'none'. */
  how: string;
  /** Simulations tried. */
  tries: number;
}

/**
 * WALKING-ONLY SOLVER: is there a way through the piece without parry and without dash? Tries, in order: standing
 * still; the walking bot; walking straight to a point of a 24 px grid and waiting there (nearest points first); then a
 * bounded search over "walk in one of 8 directions for a while, then let the walking bot continue" (the override
 * search of tools/bot/dodge_search.test.ts, without the dash).
 */
export function walkingSolver(piece: Piece, seconds = 15): WalkResult {
  const s0 = piece.sim.state;
  const p = piece.sim.params;
  const opts = piece.sim.options;
  const limit = s0.tick + seconds * 60;
  let tries = 0;
  const attempt = (policy: Policy): { ok: boolean; death: number } => (tries++, play(s0, p, opts, policy, limit));
  if (attempt(() => IDLE).ok) return { ok: true, how: 'stay', tries };
  const bot = attempt(walkBot);
  if (bot.ok) return { ok: true, how: 'bot', tries };
  const grid: [number, number][] = [];
  for (let x = p.x0 + p.heroInset; x <= p.x1 - p.heroInset; x += 24) for (let y = p.y0 + p.heroInset; y <= p.y1 - p.heroInset; y += 23.1) grid.push([Math.round(x), Math.round(y)]);
  const hd = (g: [number, number]): number => (g[0] - s0.hero.x) * (g[0] - s0.hero.x) + (g[1] - s0.hero.y) * (g[1] - s0.hero.y);
  grid.sort((a, b) => hd(a) - hd(b));
  for (const [x, y] of grid) if (attempt(walkTo(x, y)).ok) return { ok: true, how: `walk ${x},${y}`, tries };
  // detours: from tick `from`, walk in one direction for `len` ticks, then the walking bot again
  const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);
  type Ov = { from: number; to: number; dx: number; dy: number };
  const withOvs = (ovs: Ov[]): Policy => (s, pp) => {
    const o = ovs.find((v) => s.tick >= v.from && s.tick < v.to);
    return o ? { cursor: true, mx: Math.round(s.hero.x + o.dx * 40), my: Math.round(s.hero.y + o.dy * 40), buttons: 0 } : walkBot(s, pp);
  };
  const queue: [Ov[], number][] = [[[], bot.death]];
  while (queue.length && tries < 1500) {
    const [ovs, death] = queue.shift()!;
    for (const back of [15, 30, 50, 80, 120])
      for (const [dx, dy] of DIRS) {
        const from = Math.max(s0.tick, death - back);
        const o: Ov = { from, to: from + Math.min(back, 40), dx, dy };
        const r = attempt(withOvs([...ovs, o]));
        if (r.ok) return { ok: true, how: 'detour', tries };
        if (r.death > death + 30 && ovs.length < 3) queue.push([[...ovs, o], r.death]);
      }
  }
  return { ok: false, how: 'none', tries };
}
