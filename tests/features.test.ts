/**
 * Feature flags (src/data/features.ts, docs/FEATURES.md): every block ships dark; a disabled block is never read by
 * the sim and is not in the fingerprint; a variant run can never be decoded, replayed or verified as a production run.
 */
import { describe, expect, it } from 'vitest';
import { ARENA_LAYOUT } from '../src/data/arena';
import { enabledFeaturesText, FEATURES, withFeatures, type FeatureKey, type Features } from '../src/data/features';
import { HERO_RULES, HEROES, TEST_HEROES } from '../src/data/heroes';
import { TUNING } from '../src/data/tuning';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { makeParams } from '../src/sim/params';
import { decodeReplay, encodeReplay, playReplay, tuningHash } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import { mulberryInputs } from './scripted';

const KEYS = Object.keys(FEATURES) as FeatureKey[];
const VARIANT = withFeatures('patternPack');

/** The fingerprint exactly as it was computed before the flags existed (src/sim/replay.ts at d9831fd). */
function legacyHash(): string {
  const L = ARENA_LAYOUT;
  const src = JSON.stringify(TUNING) + JSON.stringify([HEROES, TEST_HEROES, HERO_RULES]) + JSON.stringify([L.arena, L.heroSpawn, L.portal, L.portalClearRadius, L.hollows, L.runes, (L as { propAnchors?: unknown }).propAnchors]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** `features` whose DISABLED blocks throw on any read except `enabled`. */
function guarded(features: Features): Features {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(features) as FeatureKey[]) {
    const block = features[k];
    out[k] = block.enabled
      ? block
      : new Proxy(block, {
          get(t, prop) {
            if (prop === 'enabled') return false;
            throw new Error(`disabled block ${k} was read (${String(prop)})`);
          },
          ownKeys() {
            throw new Error(`disabled block ${k} was enumerated`);
          },
        });
  }
  return out as unknown as Features;
}

describe('feature flags: the production build is dark', () => {
  it('every block is disabled and the table is frozen', () => {
    expect(KEYS.length).toBeGreaterThan(0);
    for (const k of KEYS) expect(FEATURES[k].enabled, k).toBe(false);
    expect(Object.isFrozen(FEATURES)).toBe(true);
    for (const k of KEYS) expect(Object.isFrozen(FEATURES[k])).toBe(true);
    expect(() => ((FEATURES.patternPack as { enabled: boolean }).enabled = true)).toThrow(); // modules are strict
  });

  it('PINNED: fingerprint f0214eba and version 0.10.0 (a dark merge changes neither)', () => {
    expect(tuningHash()).toBe('f0214eba');
    expect(tuningFingerprint()).toBe('f0214eba');
    expect(CLIENT_VERSION).toBe('0.10.0');
  });

  it('with no block enabled the hashed text is byte-identical to the pre-flags text (nothing appended)', () => {
    expect(enabledFeaturesText(FEATURES)).toBe('');
    expect(tuningHash(FEATURES)).toBe(legacyHash());
    expect(tuningHash()).toBe(legacyHash());
  });

  it('a disabled block is not in the fingerprint: changing its rows changes nothing', () => {
    const edited: Features = { ...FEATURES, patternPack: { ...FEATURES.patternPack, spiral: { ...FEATURES.patternPack.spiral, weight: 99 } } };
    expect(tuningHash(edited)).toBe(tuningHash());
    expect(tuningHash(guarded(FEATURES))).toBe(tuningHash()); // not even read
  });

  it('a disabled block is never read by the sim (params, a whole run, the replay round trip)', () => {
    const G = guarded(FEATURES);
    expect(makeParams('hard', 'knight', G).pack).toBeNull();
    const frames = mulberryInputs(11, 60 * 40);
    const a = new Sim(4242, 'hard', { hero: 'wisp', features: G, startWave: 9 });
    const b = new Sim(4242, 'hard', { hero: 'wisp', startWave: 9 });
    for (const f of frames) {
      a.step(f);
      b.step(f);
    }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const r = encodeReplay(4242, 'hard', 'wisp', mulberryInputs(11, 600), undefined, G);
    expect(playReplay(r, { features: G }).score).toBe(playReplay(r).score);
  });
});

describe('feature flags: an enabled variant', () => {
  it('withFeatures enables only the named blocks and never touches the production table', () => {
    expect(VARIANT.patternPack.enabled).toBe(true);
    expect(FEATURES.patternPack.enabled).toBe(false);
    expect({ ...VARIANT.patternPack, enabled: false }).toEqual(FEATURES.patternPack);
    expect(withFeatures()).toEqual(FEATURES);
  });

  it('has a different fingerprint, which covers the rows of the enabled block and not the key order', () => {
    const v = tuningHash(VARIANT);
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(v).not.toBe(tuningHash());
    const edited: Features = { ...VARIANT, patternPack: { ...VARIANT.patternPack, spiral: { ...VARIANT.patternPack.spiral, weight: 99 } } };
    expect(tuningHash(edited)).not.toBe(v);
    const reordered = Object.fromEntries(Object.entries(VARIANT.patternPack).reverse()) as unknown as Features['patternPack'];
    expect(Object.keys(reordered)).not.toEqual(Object.keys(VARIANT.patternPack));
    expect(tuningHash({ patternPack: reordered })).toBe(v);
  });

  it('reaches the sim through SimParams (and only there)', () => {
    expect(makeParams('hard', 'knight').pack).toBeNull();
    expect(makeParams('hard', 'knight', VARIANT).pack).toBe(VARIANT.patternPack);
    expect(new Sim(1, 'hard', { hero: 'knight' }).features).toBe(FEATURES);
    expect(new Sim(1, 'hard', { hero: 'knight', features: VARIANT }).params.pack).toBe(VARIANT.patternPack);
  });

  it('a variant replay carries the variant fingerprint and cannot be decoded or played by a production build', () => {
    const sim = new Sim(77, 'hard', { hero: 'knight', features: VARIANT });
    for (const f of mulberryInputs(5, 60 * 30)) sim.step(f);
    const r = JSON.parse(JSON.stringify(encodeReplay(77, 'hard', 'knight', sim.log, undefined, sim.features))) as { tuning: string };
    expect(r.tuning).toBe(tuningHash(VARIANT));
    expect(r.tuning).not.toBe(tuningFingerprint());
    expect(() => decodeReplay(r)).toThrow(/different tuning/);
    expect(() => playReplay(r)).toThrow(/different tuning/);
    // under its own flags it replays exactly
    const again = playReplay(r, { features: VARIANT });
    expect(again.score).toBe(sim.score);
    expect(again.state.tick).toBe(sim.state.tick);
  });

  it('a replay is never re-simulated under flags other than the ones its fingerprint names', () => {
    const prod = encodeReplay(77, 'hard', 'wisp', mulberryInputs(5, 600));
    expect(prod.tuning).toBe('f0214eba');
    expect(() => playReplay(prod, { features: VARIANT })).toThrow(/different tuning/);
    expect(() => decodeReplay(prod, VARIANT)).toThrow(/different tuning/);
    expect(playReplay(prod).state.tick).toBeGreaterThan(0);
  });
});
