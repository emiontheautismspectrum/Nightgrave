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
  /** A rune glows, then emits small orbs one by one over `seconds` while the direction turns `turns` full circles. */
  readonly spiral: PackRow & Counted & { readonly telegraphSeconds: number; readonly seconds: number; readonly turns: number };
  /** A rune burst whose shard ring has ONE gap of `gapRad`; the gap opens within `gapAimRad` of the hero's direction. */
  readonly gapRing: PackRow & Counted & { readonly telegraphSeconds: number; readonly gapRad: number; readonly gapAimRad: number };
  /** Two orb fans from opposite edges, both aimed at the hero (`count` is per fan). */
  readonly pincer: PackRow & Counted & { readonly arc: number };
  /**
   * A line of large orbs, `spacingPx` apart, sweeps the arena from the edge farther from the hero. One gap of `gapPx`
   * (centre to centre), within `reachFraction` of the distance the hero can WALK before the line arrives. At most one
   * curtain at a time.
   */
  readonly curtain: PackRow & { readonly spacingPx: number; readonly gapPx: number; readonly reachFraction: number };
  /** An orb fan, then the same fan `echoSeconds` later, turned by half the gap between its rays. */
  readonly echoFan: PackRow & Counted & { readonly arc: number; readonly echoSeconds: number };
  /**
   * Two stalkers step out of hollows on two different sides and cast blades at the same time: `count` blades each,
   * `burstGapSeconds` apart, every blade aimed at the hero when it leaves (crossing lines). Telegraph = the casters.
   */
  readonly crossfire: PackRow & Counted & { readonly idleSeconds: number; readonly burstGapSeconds: number };
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

export interface Features {
  readonly patternPack: PatternPack;
}
export type FeatureKey = keyof Features;

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
    spiral: { weight: 1.5, unlockWave: 1, telegraphSeconds: 0.6, seconds: 1.2, turns: 1.5, count: 10, countPerWave: 0.5, maxCount: 16 },
    gapRing: { weight: 1.5, unlockWave: 2, telegraphSeconds: 0.6, gapRad: 0.7, gapAimRad: 0.5, count: 16, countPerWave: 0.5, maxCount: 22 },
    pincer: { weight: 1.5, unlockWave: 3, arc: 0.6, count: 3, countPerWave: 0.2, maxCount: 5 },
    curtain: { weight: 1.2, unlockWave: 4, spacingPx: 14, gapPx: 44, reachFraction: 0.6 },
    echoFan: { weight: 1.5, unlockWave: 5, arc: 0.7, echoSeconds: 0.5, count: 3, countPerWave: 0.25, maxCount: 6 },
    crossfire: { weight: 1.2, unlockWave: 6, idleSeconds: 1.0, burstGapSeconds: 0.25, count: 2, countPerWave: 0.1, maxCount: 3 },
    pulseRings: { weight: 1.2, unlockWave: 8, telegraphSeconds: 0.6, rings: 3, ringGapSeconds: 0.4, count: 8, countPerWave: 0.25, maxCount: 12 },
    heavyLine: { weight: 1.2, unlockWave: 9, spacingPx: 22, staggerSeconds: 0.15, count: 4, countPerWave: 0.2, maxCount: 7 },
    slowThenFast: { weight: 1.2, unlockWave: 11, wraiths: 2, delaySeconds: 1.2, fastFactor: 1.4, minDist: 150, leadFraction: 0.7 },
    stalkerPair: { weight: 1.2, unlockWave: 13, idleSeconds: 1.2, staggerSeconds: 0.7 },
  },
});

/** A copy of the production flags with the named blocks enabled (bots and tests; never the game). */
export function withFeatures(...enable: FeatureKey[]): Features {
  const out = { ...FEATURES } as { -readonly [K in FeatureKey]: Features[K] };
  for (const k of enable) out[k] = { ...FEATURES[k], enabled: true };
  return out;
}

/** JSON with sorted keys: the same rules always give the same text, whatever order an object was built in. */
function canonical(v: unknown): string {
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
  for (const k of (Object.keys(features) as FeatureKey[]).sort()) if (features[k].enabled === true) on.push([k, features[k]]);
  return on.length ? canonical(on) : '';
}
