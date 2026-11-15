/**
 * Test tools for the hunts (FEATURES.knot, FEATURES.briar): the enabled variants, and a harness that creates hex knots
 * alone, with the hero placed anywhere, for the walking-only solver of tests/pack_tools.ts. Not part of the game.
 */
import { withFeatures, type FeatureKey, type Features, type PackKey } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import type { InputFrame } from '../src/sim/input';
import type { SimParams } from '../src/sim/params';
import { Sim, type SimOptions } from '../src/sim/sim';
import type { SimState } from '../src/sim/state';
import { bloodSigil } from '../src/sim/waves';
import type { SolveOptions } from './pack_tools';
import type { Piece } from './pack_tools';

export const KNOT: Features = withFeatures('knot');
export const BRIAR: Features = withFeatures('briar');

/** Every enabled combination of the hunt blocks, with and without the pattern pack (bots and tests only). */
export const COMBOS: readonly (readonly FeatureKey[])[] = [['knot'], ['briar'], ['knot', 'briar'], ['knot', 'patternPack'], ['briar', 'patternPack'], ['knot', 'briar', 'patternPack']];

const IDLE: InputFrame = { cursor: false, mx: 0, my: 0, buttons: 0 };

/** Zero the weights of the existing patterns (the stream is switched off by the caller). */
function onlyHunts(sim: Sim): void {
  const p = sim.params as { patterns: unknown };
  p.patterns = Object.fromEntries(Object.entries(sim.params.patterns).map(([k, v]) => [k, typeof v === 'object' ? { ...v, weight: 0 } : v]));
}

/**
 * Create `count` hex knots (1 or 2) alone: the existing patterns weigh 0, the stream is off, no boss, the hero stands
 * at (hx, hy). Returns null if the director could not place them. The result is a `Piece` for walkingSolver.
 */
export function startKnots(seed: number, wave: number, hx: number, hy: number, count = 1, difficulty: Difficulty = 'hard', options: SimOptions = {}): Piece | null {
  const sim = new Sim(seed, difficulty, { hero: 'wisp', ...options, features: options.features ?? KNOT, startWave: wave, bosses: false });
  onlyHunts(sim);
  sim.state.streamTimer = 1e9;
  sim.state.hero.x = hx;
  sim.state.hero.y = hy;
  sim.state.patternAt = sim.params.graceTicks;
  let made = 0;
  let start = -1;
  for (let i = 0; i < sim.params.graceTicks + 10 && made < count; i++) {
    sim.step(IDLE);
    if (sim.state.events.some((e) => e.type === 'knot')) {
      made++;
      if (start < 0) start = sim.state.tick - 1;
      sim.state.patternAt = sim.state.tick; // the next pick on the next tick
    }
  }
  sim.state.patternAt = 1e9;
  if (made < count) return null;
  return { key: 'knot' as unknown as PackKey, sim, start, projectiles: new Set(), casters: new Set() };
}

/**
 * Start ONE briar line alone (the existing patterns weigh 0, the stream is off, no boss), the hero at (hx, hy).
 * sigils = true: first up to two blood sigils are placed by the game's own rule (away from the hero), so the gap must
 * avoid them; `sigilHook` then keeps adding sigils by that rule while the line is alive (the corridor rule applies).
 * Returns null if the line could not start (every gap choice crossed a sigil).
 */
export function startLine(seed: number, wave: number, hx: number, hy: number, sigils = false, difficulty: Difficulty = 'hard', options: SimOptions = {}): Piece | null {
  const sim = new Sim(seed, difficulty, { hero: 'wisp', ...options, features: options.features ?? BRIAR, startWave: wave, bosses: false });
  onlyHunts(sim);
  const s = sim.state;
  s.streamTimer = 1e9;
  s.hero.x = hx;
  s.hero.y = hy;
  if (sigils) for (let i = 0; i < 2; i++) bloodSigil(s, sim.params);
  s.patternAt = sim.params.graceTicks;
  for (let i = 0; i < sim.params.graceTicks + 3; i++) {
    sim.step(IDLE);
    if (s.events.some((e) => e.type === 'briar')) {
      s.patternAt = 1e9;
      return { key: 'briar' as unknown as PackKey, sim, start: s.tick - 1, projectiles: new Set(), casters: new Set() };
    }
  }
  return null;
}

/** While a line is alive, a new blood sigil is attempted every 20 ticks (by the game's rule); done when all is clear. */
export const sigilHook: SolveOptions = {
  hook: (s: SimState, p: SimParams) => {
    if (s.walls?.length && s.tick % 20 === 0) bloodSigil(s, p);
  },
  done: (s: SimState) => !s.walls?.length && !s.projectiles.length && !s.sigils.some((g) => s.tick < g.end),
};
