/**
 * Test tools for the new bosses (FEATURES.bosses): enabled variants, a variant whose boss knows ONE attack, and a
 * harness that starts a fight with the hero placed anywhere, for the walking-only solver of tests/pack_tools.ts.
 * Not part of the game.
 */
import { withFeatures, type Features, type NewBossKind, type TheToller, type ThornMother } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import type { InputFrame } from '../src/sim/input';
import { Sim, type SimOptions } from '../src/sim/sim';
import type { BossKind, BossPattern, SimState } from '../src/sim/state';
import type { PackKey } from '../src/data/features';
import type { Piece, SolveOptions } from './pack_tools';

export const THORN: Features = withFeatures('thorn');
export const TOLLER: Features = withFeatures('toller');
export const BOTH: Features = withFeatures('bosses');

export const THORN_PATTERNS = ['hedge', 'bloom', 'lash', 'spores'] as const;
export const TOLLER_PATTERNS = ['toll', 'pendulum', 'knell'] as const;
export const PATTERNS: Record<NewBossKind, readonly BossPattern[]> = { thorn: THORN_PATTERNS, toller: TOLLER_PATTERNS };

/** A variant whose new boss `kind` picks only `pattern` (the other attacks weigh 0). */
export function onlyAttack(kind: NewBossKind, pattern: BossPattern, base: Features = withFeatures(kind)): Features {
  const row = { ...base.bosses[kind] } as Record<string, unknown>;
  for (const k of PATTERNS[kind]) row[k] = { ...(base.bosses[kind] as unknown as Record<string, object>)[k], weight: k === pattern ? 1 : 0 };
  return { ...base, bosses: { ...base.bosses, [kind]: row as unknown as ThornMother & TheToller } };
}

const IDLE: InputFrame = { cursor: false, mx: 0, my: 0, buttons: 0 };

/**
 * Start a fight with `kind` (forced first boss) on wave 3, the hero standing at (hx, hy), stepped idle up to the tick
 * before the first wind-up. The result is a `Piece` for walkingSolver.
 */
export function startFight(kind: BossKind, seed: number, hx: number, hy: number, features: Features, difficulty: Difficulty = 'hard', options: SimOptions = {}): Piece {
  const sim = new Sim(seed, difficulty, { hero: 'wisp', ...options, features, startWave: 3, firstBoss: kind });
  const s = sim.state;
  s.streamTimer = 1e9;
  s.hero.x = hx;
  s.hero.y = hy;
  while (!s.boss || s.tick < s.boss.introEnd - 1) sim.step(IDLE);
  return { key: kind as unknown as PackKey, sim, start: s.tick, projectiles: new Set(), casters: new Set() };
}

/** Nothing of the boss's attacks is alive or still to come. */
export const bossClear = (s: SimState): boolean =>
  !s.boss?.attack && !(s.boss?.pending?.length) && !s.projectiles.some((pr) => pr.boss > 0) && !s.beams.length && !s.walls?.length;

/** Solver rules: the boss makes `count` attacks, then no more; done when all of them are over. */
export function attacks(count: number): SolveOptions {
  return {
    hook: (s: SimState) => {
      const b = s.boss;
      if (b && b.serial >= count && !b.attack) b.nextAt = 1e9;
    },
    done: (s: SimState) => (s.boss?.serial ?? 0) >= count && bossClear(s),
  };
}
