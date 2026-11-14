/**
 * Test tools for the hunts (FEATURES.knot, FEATURES.briar): the enabled variants, and a harness that creates hex knots
 * alone, with the hero placed anywhere, for the walking-only solver of tests/pack_tools.ts. Not part of the game.
 */
import { withFeatures, type FeatureKey, type Features, type PackKey } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import type { InputFrame } from '../src/sim/input';
import { Sim, type SimOptions } from '../src/sim/sim';
import type { Piece } from './pack_tools';

export const KNOT: Features = withFeatures('knot');

/** Every enabled combination of the hunt blocks with and without the pattern pack (bots and tests only). */
export const COMBOS: readonly (readonly FeatureKey[])[] = [['knot'], ['knot', 'patternPack']];

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
