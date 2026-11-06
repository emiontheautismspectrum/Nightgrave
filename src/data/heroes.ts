/**
 * Heroes as DATA. Every gameplay number of a hero lives here; the sim reads it through makeParams (src/sim/params.ts)
 * and dispatches on `ability.kind`, never on a hero name. Adding a hero = one HeroDef entry + art (+ a new `ability`
 * branch in the sim only if it brings a new mechanic). TUNING's fingerprint covers this file (src/sim/replay.ts).
 */

/** The shipped heroes, in replay-byte order (the index is stored in the replay core: append only, never reorder). */
export const HERO_IDS = ['knight', 'wisp'] as const;
export type HeroId = (typeof HERO_IDS)[number];
/** Test-only hero: the pre-heroes rules (full circle, radius 22, no ability). Never in HERO_IDS, never in a replay. */
export type TestHeroId = 'classic';
export type AnyHeroId = HeroId | TestHeroId;

export const isHeroId = (v: unknown): v is HeroId => typeof v === 'string' && (HERO_IDS as readonly string[]).includes(v);

/** A hero ability (typed): the sim switches on `kind`. */
export type HeroAbility =
  | { kind: 'none' }
  /** Every successful pulse adds a charge (max `charges`); a FULL guard absorbs one lethal PARRYABLE hit. */
  | { kind: 'guard'; charges: number; invulnSeconds: number }
  /** The dash leaves a burning line that destroys parryable (non-armored) projectiles for `seconds`. */
  | { kind: 'trail'; seconds: number; halfWidth: number; killPoints: number; maxKills: number };

export interface HeroDef {
  id: AnyHeroId;
  name: string;
  /** Hero select screen: two short stat lines (<= 19 characters each: they sit side by side on desktop). */
  lines: [string, string];
  parry: {
    radius: number;
    /** 360 = full circle; below 360 the arc is centred on the hero's aim. */
    arcDegrees: number;
    activeSeconds?: number;
    maxKillsPerPulse?: number;
  };
  dashDistance: number;
  ability: HeroAbility;
}

/**
 * FROZEN after the balance pass (tools/bot/balance.ts, skilled bot, Hard): the start values were Knight radius 28 /
 * guard 3 and Wisp radius 20 / trail 5 pts x 4; the Knight was far ahead (survival x1.36, score x1.9 on 150 seeds).
 * Knight radius 24 / arc 120 and Wisp radius 22 / trail 10 pts x 5 put both heroes' Hard median survival and score
 * within +-12% of each other on seeds 1-50 and on seeds 1-150.
 */
export const HEROES: Record<HeroId, HeroDef> = {
  knight: {
    id: 'knight',
    name: 'KNIGHT',
    lines: ['FRONT SHIELD ARC', '3 PARRIES = 1 GUARD'],
    parry: { radius: 24, arcDegrees: 120, maxKillsPerPulse: 3 },
    dashDistance: 80,
    ability: { kind: 'guard', charges: 3, invulnSeconds: 0.6 },
  },
  wisp: {
    id: 'wisp',
    name: 'WISP',
    lines: ['FULL RING PARRY', 'DASH BURNS SHOTS'],
    parry: { radius: 22, arcDegrees: 360, maxKillsPerPulse: 3 },
    dashDistance: 100,
    ability: { kind: 'trail', seconds: 0.8, halfWidth: 3, killPoints: 10, maxKills: 5 },
  },
};

/** The pre-heroes rules, for tests and the old golden numbers only. */
export const TEST_HEROES: Record<TestHeroId, HeroDef> = {
  classic: {
    id: 'classic',
    name: 'CLASSIC',
    lines: ['TEST ONLY', 'TEST ONLY'],
    parry: { radius: 22, arcDegrees: 360, maxKillsPerPulse: 3 },
    dashDistance: 80,
    ability: { kind: 'none' },
  },
};

export const heroDef = (id: AnyHeroId): HeroDef => (id === 'classic' ? TEST_HEROES.classic : HEROES[id]);

/** Facing and parry-zone rules shared by every hero. */
export const HERO_RULES = {
  /** The aim follows the cursor only when it is farther than this from the hero (px). */
  aimDeadzonePx: 3,
  /** A projectile whose centre is closer than this always counts as inside the parry zone (no blind spot). */
  overlapPx: 6,
};
