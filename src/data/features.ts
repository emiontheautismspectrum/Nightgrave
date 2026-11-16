/**
 * FEATURE BLOCKS (docs/FEATURES.md, docs/ROADMAP_V2.md sections 4 and 6). A block is a set of rules that ships DARK:
 * all of its data lives here from the first merge, behind `enabled: false`.
 *
 * - A disabled block is never read by the sim (only its `enabled` flag is) and is NOT part of the fingerprint:
 *   `tuningHash()` appends the ENABLED blocks only, and nothing at all when none is enabled.
 * - The flags reach the sim through `SimParams` (`makeParams(difficulty, hero, features)`), which defaults to these
 *   production `FEATURES`: bots and tests run an enabled variant without editing this file (`withFeatures`).
 * - A replay recorded by a variant carries `tuningHash(variant)`, which no production build accepts.
 * - Enabling a block in production changes the rules: it changes the fingerprint and needs a `CLIENT_VERSION` bump
 *   and the cut-over of docs/DEPLOY.md.
 */

/** The set pieces of the pattern pack, in pool order (they come AFTER the existing patterns of TUNING.patterns). */
export const PACK_KEYS = ['spiral', 'gapRing', 'pincer', 'curtain', 'echoFan', 'crossfire', 'pulseRings', 'heavyLine', 'slowThenFast', 'stalkerPair'] as const;
export type PackKey = (typeof PACK_KEYS)[number];

/** Every pack row: its weight in the director's pool and the first wave it may be picked in (like TUNING.patterns). */
interface PackRow {
  readonly weight: number;
  readonly unlockWave: number;
}
/** A count that grows with the wave: min(maxCount, count + floor(countPerWave * wave)). */
interface Counted {
  readonly count: number;
  readonly countPerWave: number;
  readonly maxCount: number;
}

/**
 * PATTERN PACK: ten set pieces built from the existing threats only (orbs, rune shards, blades, wraiths, stalkers).
 * Violet stays parryable; red (blades) appears only in `crossfire` and `stalkerPair`. Times in seconds, distances in
 * px, angles in radians. The entity cap of each pattern follows from its row (`packEntityCap`).
 */
export interface PatternPack {
  readonly enabled: boolean;
  /**
   * The long pieces (curtain, crossfire, stalkerPair) are not started in the last `bossLeadSeconds` before a boss
   * wave, so they are over, or nearly, when the boss makes its first attack.
   */
  readonly bossLeadSeconds: number;
  /**
   * A rune glows, then emits small orbs one by one over `seconds` while the direction turns `turns` full circles; the
   * first orb flies at the hero's position when the rune lit up, +- `aimRad`.
   */
  readonly spiral: PackRow & Counted & { readonly telegraphSeconds: number; readonly seconds: number; readonly turns: number; readonly aimRad: number };
  /** A rune burst whose shard ring has ONE gap of `gapRad`; the gap opens within `gapAimRad` of the hero's direction. */
  readonly gapRing: PackRow & Counted & { readonly telegraphSeconds: number; readonly gapRad: number; readonly gapAimRad: number };
  /** Two orb fans from opposite edges, both aimed at the hero (`count` is per fan). */
  readonly pincer: PackRow & Counted & { readonly arc: number };
  /**
   * A line of large orbs, `spacingPx` apart, sweeps the arena from the edge farther from the hero at `speedFactor` x
   * the large-orb speed. One gap of `gapPx` (centre to centre), within `reachFraction` of the distance the hero can
   * WALK before the line arrives. At most one curtain at a time.
   */
  readonly curtain: PackRow & { readonly spacingPx: number; readonly gapPx: number; readonly reachFraction: number; readonly speedFactor: number };
  /** An orb fan, then the same fan `echoSeconds` later, turned by half the gap between its rays. */
  readonly echoFan: PackRow & Counted & { readonly arc: number; readonly echoSeconds: number };
  /**
   * Two stalkers step out of hollows on two different sides and cast at the same moment: `count` blades each, side by
   * side in lanes `laneGapPx` apart, all leaving at the end of the cast (the usual caster tell).
   */
  readonly crossfire: PackRow & Counted & { readonly idleSeconds: number; readonly laneGapPx: number };
  /** One rune fires `rings` full shard rings `ringGapSeconds` apart, each turned by a third of the shard spacing. */
  readonly pulseRings: PackRow & Counted & { readonly telegraphSeconds: number; readonly rings: number; readonly ringGapSeconds: number };
  /** Large orbs from points `spacingPx` apart along the far edge, flying parallel, launched `staggerSeconds` apart. */
  readonly heavyLine: PackRow & Counted & { readonly spacingPx: number; readonly staggerSeconds: number };
  /**
   * `wraiths` wraiths, then `delaySeconds` later ONE small orb at `fastFactor` x the orb speed, from a point at least
   * `minDist` away, aimed ahead of the hero's drift since the wraiths appeared (`leadFraction` of the flight time).
   */
  readonly slowThenFast: PackRow & { readonly wraiths: number; readonly delaySeconds: number; readonly fastFactor: number; readonly minDist: number; readonly leadFraction: number };
  /** Two stalkers; the second casts `staggerSeconds` after the first (first: a violet fan; second: any attack). */
  readonly stalkerPair: PackRow & { readonly idleSeconds: number; readonly staggerSeconds: number };
}

/**
 * HEX KNOT (package B1 "Hunts"): a stationary hollow violet ring on a fuse, far from the hero. Its body is harmless.
 * A pulse that covers it (the ONE parry zone, radius `radius`) destroys it: it scores like a parried projectile (the
 * first kill of a pulse pays parryBase x the multiplier and steps it, later kills extraKillPoints) and refreshes the
 * chain, but it is never PERFECT and gives no guard charge. Not destroyed when the fuse ends (counted in ticks, not
 * slowed by Slow Time, the same on every difficulty), it bursts into `shards` rune shards. No knot is created in the
 * last `fuseSeconds + bossLeadSeconds` before a boss wave, so every fuse has ended when the boss arrives.
 */
export interface HexKnot {
  readonly enabled: boolean;
  readonly weight: number;
  readonly unlockWave: number;
  readonly maxActive: number;
  readonly fuseSeconds: number;
  readonly shards: number;
  /** Created at least this far from the hero and this far inside the arena edge, and `spacingPx` from another knot. */
  readonly minHeroDist: number;
  readonly edgeInset: number;
  readonly spacingPx: number;
  /** The body radius the parry zone tests against (the sprite is 12 x 12). */
  readonly radius: number;
  /** The Wisp's ember trail does not destroy knots (ROADMAP_V2 open question 4). */
  readonly trailProof: boolean;
  readonly bossLeadSeconds: number;
}

/**
 * BRIAR LINE (package B1 "Hunts"): a band of thorns (red, unparryable, lethal on touch; the dash i-frames pass) across
 * the whole arena with ONE gap of `gapPx`. It enters from the edge farther from the hero after `telegraphSeconds` of
 * warning and creeps at `speed` px/s (x the difficulty and wave speed, slowed by Slow Time like projectiles). The gap
 * centre lies within `reachFraction` of the distance the hero can WALK before the line arrives. At most `maxActive`;
 * never with a pattern-pack curtain alive (both ways); none is started that would (unslowed) still be alive
 * `bossLeadSeconds` before a boss wave, and a line still there at a boss intro withers.
 */
export interface BriarLine {
  readonly enabled: boolean;
  readonly weight: number;
  readonly unlockWave: number;
  readonly maxActive: number;
  readonly telegraphSeconds: number;
  readonly speed: number;
  /** Half the thickness of the band (px). */
  readonly halfWidth: number;
  readonly gapPx: number;
  readonly reachFraction: number;
  readonly bossLeadSeconds: number;
}

/** The row every new boss shares (the old bosses keep theirs in TUNING.bosses, which is always hashed). */
interface NewBossRow {
  readonly enabled: boolean;
  /** HP = attacks (clamped to 10..15), the time between attack starts, the default wind-up (>= 15 ticks). */
  readonly segments: number;
  readonly cadenceSeconds: number;
  readonly windupSeconds: number;
  /** Where the body stands for the whole fight (top-centre, like the Eye). */
  readonly x: number;
  readonly y: number;
}
/** A weighted attack of a new boss (one launch = one segment, however long it emits). */
interface AttackRow {
  readonly weight: number;
}

/**
 * THORN MOTHER (package B3): a huge root-and-thorn matriarch at the top of the clearing. Her attacks are ROOTS that
 * erupt from the ground. Counts scale with the difficulty density like the old bosses' (capped), speeds with the
 * difficulty speed and the encounter bonus. No knots in her fight.
 */
export interface ThornMother extends NewBossRow {
  /**
   * A root line with ONE gap (the `Wall` entity of the briar line, owned by the attack serial): red, lethal, creeping;
   * the dash i-frames pass. The same placement and fairness as the briar line (the gap within `reachFraction` of the
   * walking reach). The gap's lane never passes within `bossClearPx` of her body (else a spore fan is the attack).
   * Never picked while a wall or a pattern-pack curtain is alive.
   */
  readonly hedge: AttackRow & { readonly telegraphSeconds: number; readonly speed: number; readonly halfWidth: number; readonly gapPx: number; readonly reachFraction: number; readonly bossClearPx: number };
  /**
   * `count` (max `maxCount`) ground blooms at seeded spots >= `minHeroDist` from the hero and `spacingPx` apart light
   * up during the wind-up; each bursts into a violet shard ring of `shards` (max `maxShards`) with ONE gap of `gapRad`
   * (centred within `gapAimRad` of the hero's direction), the first at the launch, then one every `staggerSeconds`.
   */
  readonly bloom: AttackRow & { readonly count: number; readonly maxCount: number; readonly staggerSeconds: number; readonly minHeroDist: number; readonly edgeInset: number; readonly spacingPx: number; readonly shards: number; readonly maxShards: number; readonly gapRad: number; readonly gapAimRad: number };
  /** A short red arc: `count` (max `maxCount`) blades over `arc` rad from her body, along the wind-up's line. */
  readonly lash: AttackRow & { readonly count: number; readonly maxCount: number; readonly arc: number; readonly speedFactor: number };
  /** A violet orb fan of `count` small orbs over `arc` rad, aimed at the hero at the launch. */
  readonly spores: AttackRow & { readonly count: number; readonly arc: number };
}

/**
 * THE TOLLER (package B5): a tall bell-headed figure with chains. It keeps a BEAT of `beatTicks`: every attack starts
 * (its wind-up) and launches on a beat tick; `cadenceSeconds` is a whole number of beats; wind-ups are counted in
 * beats (`windupBeats`, >= 15 ticks).
 */
export interface TheToller extends NewBossRow {
  readonly beatTicks: number;
  readonly windupBeats: number;
  /**
   * `rings` violet orb rings on consecutive beats, `count` (max `maxCount`) orbs each, every ring with ONE gap of
   * `gapRad` (at least 1.6 x the ring spacing, so it reads). The rhythm: parry ring 1, walk through ring 2's gap
   * (centred within `gapAimRad` of the hero's direction), parry ring 3; ring k's gap is turned by (k - 1) x
   * `gapStepRad` from ring 2's (at least the gap + 0.5 rad: two consecutive gaps never overlap).
   */
  readonly toll: AttackRow & { readonly rings: number; readonly count: number; readonly maxCount: number; readonly gapRad: number; readonly gapStepRad: number; readonly gapAimRad: number; readonly speed: number };
  /**
   * The red beam (the Eye's beam entity) swung out from the bell and back: pass 1 sweeps `sweepDeg` at `degPerSecond`
   * (<= 60) from a start line fixed at the wind-up (offset from the hero like the Eye's), pass 2 starts when pass 1
   * ends and sweeps back to the start line. Everything behind the start line is safe for the whole attack.
   */
  readonly pendulum: AttackRow & { readonly windupBeats: number; readonly degPerSecond: number; readonly sweepDeg: number; readonly halfWidth: number; readonly length: number; readonly offsetMinPx: number; readonly offsetMaxPx: number };
  /** A ring of `count` (max `maxCount`) red blades with TWO gaps of `gapRad`; never two knells alive at once. */
  readonly knell: AttackRow & { readonly count: number; readonly maxCount: number; readonly gapRad: number; readonly gapAimRad: number; readonly speedFactor: number };
}

/** The new bosses, one row each: every row is its own flag (`withFeatures('thorn')`, or both with 'bosses'). */
export interface NewBosses {
  readonly thorn: ThornMother;
  readonly toller: TheToller;
}
export const NEW_BOSS_KINDS = ['thorn', 'toller'] as const;
export type NewBossKind = (typeof NEW_BOSS_KINDS)[number];

/**
 * BOSS ORDER (package U3b): every boss wave draws its kind among ALL bosses of the run (the Eye, the Lich and every
 * enabled new boss) instead of the fixed cycle, with no immediate repeat. The draw is an integer hash of (seed, n)
 * (boss.ts `randomBossKind`): no PRNG draw, so nothing else shifts. With only the two old bosses it is an
 * alternation whose first boss is drawn.
 */
export interface BossOrder {
  readonly enabled: boolean;
}

/** A drifting body (BOSS MOTION): its speed (px/s, along a straight line to its target) and its render-only bob. */
interface DriftRow {
  readonly speed: number;
  /** RENDER ONLY (the sim's x, y carry no bob): amplitude (px) and period (s) of the bob drawn on top. */
  readonly bobPx: number;
  readonly bobSeconds: number;
}

/**
 * BOSS MOTION (package U3b): the bodies move (src/sim/bossMotion.ts). Every body is HELD (does not move) from the
 * start of an attack (the Lich's teleport-out, every wind-up) to its launch, and while a beam, a deferred emission or
 * a ring of the boss is alive: telegraphs fixed at the wind-up start always match the attack. Motion begins at the
 * intro's end. Targets and spots come from an integer hash of (seed, boss start, pick): no PRNG draw.
 */
export interface BossMotion {
  readonly enabled: boolean;
  /** The drift band: at least `inset` px inside the arena on every side, and no lower than y = `yMax`. */
  readonly inset: number;
  readonly yMax: number;
  /** A drift target is never within this distance of the hero at the moment it is picked. */
  readonly minHeroDist: number;
  /** Eye Sentinel: slides between seeded targets in the band. */
  readonly eye: DriftRow;
  /** Lich Mage: drifts the same way; its teleports stay as they are, and the drift goes on from the new spot. */
  readonly lich: DriftRow;
  /**
   * Thorn Mother: stands; before every `relocateEvery`-th attack she SINKS (`sinkSeconds`, she cannot launch) and
   * EMERGES (`emergeSeconds`) at a seeded band spot >= `emergeMinHeroDist` from the hero, then winds up there.
   */
  readonly thorn: { readonly relocateEvery: number; readonly sinkSeconds: number; readonly emergeSeconds: number; readonly emergeMinHeroDist: number };
  /** The Toller does not drift (speed 0): it teleports only with its `peal` (FEATURES.bossMoves). */
  readonly toller: { readonly speed: number };
}

export interface Features {
  readonly patternPack: PatternPack;
  readonly knot: HexKnot;
  readonly briar: BriarLine;
  /** A GROUP block: it has no flag of its own, each row (`thorn`, `toller`) has one. */
  readonly bosses: NewBosses;
  readonly bossOrder: BossOrder;
  readonly bossMotion: BossMotion;
}
export type FeatureKey = keyof Features;
/** Every switch: the plain blocks and the rows of the `bosses` group. */
export type FeatureFlag = Exclude<FeatureKey, 'bosses'> | NewBossKind;
export const FEATURE_FLAGS: readonly FeatureFlag[] = ['patternPack', 'knot', 'briar', ...NEW_BOSS_KINDS, 'bossOrder', 'bossMotion'];
/** Is this switch on (exactly true)? */
export function flagOn(features: Features, flag: FeatureFlag): boolean {
  return flag === 'thorn' || flag === 'toller' ? features.bosses[flag].enabled === true : features[flag].enabled === true;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** The production flags. Every block is dark until its own enabling change (version bump + cut-over). */
export const FEATURES: Features = deepFreeze({
  patternPack: {
    enabled: false,
    bossLeadSeconds: 5,
    spiral: { weight: 1.5, unlockWave: 1, telegraphSeconds: 0.6, seconds: 1.2, turns: 1.5, aimRad: 0.05, count: 10, countPerWave: 0.5, maxCount: 16 },
    gapRing: { weight: 1.5, unlockWave: 2, telegraphSeconds: 0.6, gapRad: 0.7, gapAimRad: 0.8, count: 14, countPerWave: 0.5, maxCount: 20 },
    pincer: { weight: 1.5, unlockWave: 3, arc: 0.6, count: 3, countPerWave: 0.2, maxCount: 5 },
    curtain: { weight: 0.6, unlockWave: 4, spacingPx: 14, gapPx: 44, reachFraction: 0.3, speedFactor: 0.8 },
    echoFan: { weight: 1.5, unlockWave: 5, arc: 0.7, echoSeconds: 0.5, count: 3, countPerWave: 0.25, maxCount: 6 },
    crossfire: { weight: 1.2, unlockWave: 6, idleSeconds: 1.0, laneGapPx: 12, count: 2, countPerWave: 0.1, maxCount: 3 },
    pulseRings: { weight: 1.2, unlockWave: 8, telegraphSeconds: 0.6, rings: 3, ringGapSeconds: 0.4, count: 8, countPerWave: 0.25, maxCount: 12 },
    heavyLine: { weight: 1.2, unlockWave: 9, spacingPx: 22, staggerSeconds: 0.15, count: 4, countPerWave: 0.2, maxCount: 7 },
    slowThenFast: { weight: 1.2, unlockWave: 11, wraiths: 2, delaySeconds: 1.2, fastFactor: 1.4, minDist: 150, leadFraction: 0.7 },
    stalkerPair: { weight: 1.2, unlockWave: 13, idleSeconds: 1.2, staggerSeconds: 0.7 },
  },
  knot: { enabled: false, weight: 1.5, unlockWave: 4, maxActive: 2, fuseSeconds: 4, shards: 8, minHeroDist: 90, edgeInset: 30, spacingPx: 40, radius: 5, trailProof: true, bossLeadSeconds: 1 },
  briar: { enabled: false, weight: 1, unlockWave: 4, maxActive: 1, telegraphSeconds: 0.75, speed: 55, halfWidth: 3, gapPx: 44, reachFraction: 0.8, bossLeadSeconds: 1 },
  bosses: {
    thorn: {
      enabled: false,
      segments: 12,
      cadenceSeconds: 2.0,
      windupSeconds: 0.5,
      x: 240,
      y: 60,
      hedge: { weight: 2, telegraphSeconds: 0.75, speed: 50, halfWidth: 3, gapPx: 44, reachFraction: 0.8, bossClearPx: 24 },
      bloom: { weight: 2, count: 3, maxCount: 3, staggerSeconds: 0.3, minHeroDist: 90, edgeInset: 30, spacingPx: 60, shards: 9, maxShards: 10, gapRad: 0.6, gapAimRad: 0.8 },
      lash: { weight: 2, count: 3, maxCount: 4, arc: 0.5, speedFactor: 1 },
      spores: { weight: 3, count: 5, arc: 1.2 },
    },
    toller: {
      enabled: false,
      segments: 14,
      cadenceSeconds: 1.5,
      windupSeconds: 0.5,
      x: 240,
      y: 58,
      beatTicks: 30,
      windupBeats: 1,
      toll: { weight: 3, rings: 3, count: 9, maxCount: 10, gapRad: 1.0, gapStepRad: 1.7, gapAimRad: 0.4, speed: 80 },
      pendulum: { weight: 4, windupBeats: 2, degPerSecond: 55, sweepDeg: 50, halfWidth: 2, length: 440, offsetMinPx: 18, offsetMaxPx: 34 },
      knell: { weight: 3.5, count: 15, maxCount: 18, gapRad: 0.6, gapAimRad: 0.6, speedFactor: 1.35 },
    },
  },
  bossOrder: { enabled: false },
  bossMotion: {
    enabled: false,
    inset: 30,
    yMax: 120,
    minHeroDist: 80,
    eye: { speed: 14, bobPx: 2, bobSeconds: 2.4 },
    lich: { speed: 12, bobPx: 2, bobSeconds: 1.6 },
    thorn: { relocateEvery: 3, sinkSeconds: 0.6, emergeSeconds: 0.6, emergeMinHeroDist: 90 },
    toller: { speed: 0 },
  },
});

/**
 * A copy of the production flags with the named switches enabled (bots, tests and the dev preview; never a real run).
 * 'bosses' enables every new boss; 'thorn' / 'toller' one of them.
 */
export function withFeatures(...enable: (FeatureFlag | 'bosses')[]): Features {
  const out = { ...FEATURES } as { -readonly [K in FeatureKey]: Features[K] };
  const bosses = { ...FEATURES.bosses } as { -readonly [K in NewBossKind]: NewBosses[K] };
  for (const k of enable) {
    if (k === 'bosses') for (const b of NEW_BOSS_KINDS) (bosses as Record<NewBossKind, unknown>)[b] = { ...FEATURES.bosses[b], enabled: true };
    else if (k === 'thorn' || k === 'toller') (bosses as Record<NewBossKind, unknown>)[k] = { ...FEATURES.bosses[k], enabled: true };
    else (out as Record<FeatureKey, unknown>)[k] = { ...FEATURES[k], enabled: true };
  }
  if (NEW_BOSS_KINDS.some((b) => bosses[b] !== FEATURES.bosses[b])) out.bosses = bosses;
  return deepFreeze(out); // frozen: the flags a run was built from can never drift from the rules it simulates
}

/** JSON with sorted keys: the same rules always give the same text, whatever order an object was built in. */
function canonical(v: unknown): string {
  // a rule value must be a real one: NaN, Infinity and undefined have no distinct JSON text (two rule sets could
  // share a fingerprint), and -0 would read as 0
  if (v === undefined || (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)))) throw new Error('features: an enabled block holds a value that cannot be fingerprinted');
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * The part of the fingerprint that comes from the flags: the canonical JSON of the ENABLED blocks (sorted by name), or
 * the EMPTY string when none is enabled, so an all-dark build hashes exactly what it hashed before the flags existed.
 * A disabled block is not read past its `enabled` flag.
 */
export function enabledFeaturesText(features: Features): string {
  const on: [string, unknown][] = [];
  for (const k of (Object.keys(features) as FeatureKey[]).sort()) {
    if (k === 'bosses') {
      // a group: only its ENABLED rows, by name; a group with no row on adds nothing at all
      const rows: Record<string, unknown> = {};
      for (const b of [...NEW_BOSS_KINDS].sort()) if (features.bosses[b].enabled === true) rows[b] = features.bosses[b];
      if (Object.keys(rows).length) on.push([k, rows]);
    } else if (features[k].enabled === true) on.push([k, features[k]]);
  }
  return on.length ? canonical(on) : '';
}
