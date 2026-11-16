/**
 * DEV PREVIEW of dark feature blocks (docs/FEATURES.md "Dev preview"): `npm run dev` ONLY. main.ts calls this inside
 * `if (import.meta.env.DEV)`, so in a production build the call and this module are dead code (tests/prodbundle.test.ts
 * checks it). `?flags=bosses,knot,briar,patternPack,bossOrder,bossMotion,bossMoves` (any subset by name; `thorn` /
 * `toller` one boss each) builds the
 * run's Sim with `withFeatures(...)`, `?boss=thorn|toller|eye|lich` forces the first boss (an unrecorded option, like
 * `?wave=`). A preview run is never saved, never submitted, never counts as a best and shows a PREVIEW tag.
 */
import { FEATURE_FLAGS, withFeatures, type FeatureFlag, type Features } from '../data/features';
import type { BossKind } from '../sim/state';

export interface DevPreview {
  features: Features;
  /** The switches that were turned on (for the console). */
  flags: (FeatureFlag | 'bosses')[];
  firstBoss?: BossKind;
}

const NAMES: readonly string[] = [...FEATURE_FLAGS, 'bosses'];
const BOSSES: readonly BossKind[] = ['eye', 'lich', 'thorn', 'toller'];

/** Parse the preview parameters; null when the URL asks for none (then the run is an ordinary dev run). */
export function parseDevPreview(q: URLSearchParams): DevPreview | null {
  const flags = (q.get('flags') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is FeatureFlag | 'bosses' => NAMES.includes(x));
  const b = q.get('boss');
  const firstBoss = BOSSES.find((k) => k === b);
  if (!flags.length && !firstBoss) return null;
  return { features: withFeatures(...flags), flags, ...(firstBoss ? { firstBoss } : {}) };
}
