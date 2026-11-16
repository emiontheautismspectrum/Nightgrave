/**
 * Feature flags (src/data/features.ts, docs/FEATURES.md): every block ships dark; a disabled block is never read by
 * the sim and is not in the fingerprint; a variant run can never be decoded, replayed or verified as a production run.
 */
import { describe, expect, it } from 'vitest';
import { ARENA_LAYOUT } from '../src/data/arena';
import { enabledFeaturesText, FEATURE_FLAGS, FEATURES, flagOn, NEW_BOSS_KINDS, withFeatures, type FeatureFlag, type FeatureKey, type Features } from '../src/data/features';
import { HERO_RULES, HEROES, TEST_HEROES } from '../src/data/heroes';
import { TUNING } from '../src/data/tuning';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { makeParams } from '../src/sim/params';
import { decodeReplay, encodeReplay, playReplay, replayOf, tuningHash } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import { mulberryInputs } from './scripted';

const KEYS = Object.keys(FEATURES) as FeatureKey[];
/** Every switch: the plain blocks and the rows of the `bosses` group. */
const FLAGS = FEATURE_FLAGS;
const VARIANT = withFeatures('patternPack');

/** The fingerprint exactly as it was computed before the flags existed (src/sim/replay.ts at d9831fd). */
function legacyHash(): string {
  const L = ARENA_LAYOUT;
  const src = JSON.stringify(TUNING) + JSON.stringify([HEROES, TEST_HEROES, HERO_RULES]) + JSON.stringify([L.arena, L.heroSpawn, L.portal, L.portalClearRadius, L.hollows, L.runes, (L as { propAnchors?: unknown }).propAnchors]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A proxy of a disabled block (or row) that throws on any read except `enabled`. */
function sealed<T extends object>(block: T, name: string): T {
  return new Proxy(block, {
    get(_t, prop) {
      if (prop === 'enabled') return false;
      throw new Error(`disabled block ${name} was read (${String(prop)})`);
    },
    ownKeys() {
      throw new Error(`disabled block ${name} was enumerated`);
    },
  });
}

/** `features` whose DISABLED blocks (and disabled rows of the `bosses` group) throw on any read except `enabled`. */
export function guarded(features: Features): Features {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(features) as FeatureKey[]) {
    if (k === 'bosses') {
      const rows: Record<string, unknown> = {};
      for (const b of NEW_BOSS_KINDS) rows[b] = features.bosses[b].enabled ? features.bosses[b] : sealed(features.bosses[b], `bosses.${b}`);
      out[k] = rows;
      continue;
    }
    const block = features[k];
    out[k] = block.enabled ? block : sealed(block, k);
  }
  return out as unknown as Features;
}

describe('feature flags: the production build is dark', () => {
  it('every block is disabled and the table is frozen', () => {
    expect(KEYS.length).toBeGreaterThan(0);
    expect(FLAGS).toEqual(['patternPack', 'knot', 'briar', 'thorn', 'toller']);
    for (const k of FLAGS) expect(flagOn(FEATURES, k), k).toBe(false);
    expect(Object.isFrozen(FEATURES)).toBe(true);
    for (const k of KEYS) expect(Object.isFrozen(FEATURES[k])).toBe(true);
    expect(Object.isFrozen(FEATURES.bosses)).toBe(true);
    for (const b of NEW_BOSS_KINDS) expect(Object.isFrozen(FEATURES.bosses[b]), b).toBe(true);
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

describe('feature flags: the bosses group (one switch per new boss)', () => {
  it('withFeatures: "bosses" enables both rows, "thorn" / "toller" one; the group never has a flag of its own', () => {
    expect('enabled' in FEATURES.bosses).toBe(false);
    const both = withFeatures('bosses');
    expect([both.bosses.thorn.enabled, both.bosses.toller.enabled]).toEqual([true, true]);
    expect(withFeatures('thorn', 'toller')).toEqual(both);
    expect([withFeatures('thorn').bosses.thorn.enabled, withFeatures('thorn').bosses.toller.enabled]).toEqual([true, false]);
    expect([withFeatures('toller').bosses.thorn.enabled, withFeatures('toller').bosses.toller.enabled]).toEqual([false, true]);
    expect(withFeatures('knot').bosses).toBe(FEATURES.bosses); // untouched rows are the production objects
    expect(FEATURES.bosses.thorn.enabled || FEATURES.bosses.toller.enabled).toBe(false);
    expect(Object.isFrozen(both.bosses) && Object.isFrozen(both.bosses.toller.toll)).toBe(true);
  });

  it('a disabled row is not in the fingerprint and never read; an enabled row is, by its values', () => {
    const edited: Features = { ...FEATURES, bosses: { ...FEATURES.bosses, thorn: { ...FEATURES.bosses.thorn, segments: 99 } } };
    expect(tuningHash(edited)).toBe('f0214eba');
    const th = withFeatures('thorn');
    expect(enabledFeaturesText(th)).toContain('"bosses"');
    expect(enabledFeaturesText(th)).not.toContain('"toller"');
    const thEdited: Features = { ...th, bosses: { ...th.bosses, thorn: { ...th.bosses.thorn, segments: 13 } } };
    expect(tuningHash(thEdited)).not.toBe(tuningHash(th));
    // editing the DISABLED toller row of the thorn variant changes nothing
    const thOther: Features = { ...th, bosses: { ...th.bosses, toller: { ...th.bosses.toller, segments: 10 } } };
    expect(tuningHash(thOther)).toBe(tuningHash(th));
    expect(makeParams('hard', 'knight', guarded(FEATURES)).thorn).toBeNull();
    expect(makeParams('hard', 'knight', guarded(FEATURES)).toller).toBeNull();
    expect(makeParams('hard', 'knight', th).thorn).toBe(th.bosses.thorn);
  });

  it('a dark build through two boss fights: guarded rows are never read and the state is identical', () => {
    const G = guarded(FEATURES);
    const frames = mulberryInputs(13, 60 * 70);
    const a = new Sim(4243, 'hard', { hero: 'knight', features: G, startWave: 3 });
    const b = new Sim(4243, 'hard', { hero: 'knight', startWave: 3 });
    for (const f of frames) {
      a.state.alive = b.state.alive = true; // immortal: walk through the whole fight
      a.step(f);
      b.step(f);
    }
    expect(a.state.bossWave).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(Object.keys(b.state.bossMet)).toEqual(['eye', 'lich']);
  });
});

describe('feature flags: an enabled variant', () => {
  it('withFeatures enables only the named blocks and never touches the production table', () => {
    expect(VARIANT.patternPack.enabled).toBe(true);
    expect(FEATURES.patternPack.enabled).toBe(false);
    expect({ ...VARIANT.patternPack, enabled: false }).toEqual(FEATURES.patternPack);
    expect(withFeatures()).toEqual(FEATURES);
  });

  it('a variant is frozen too, and a value that cannot be fingerprinted is refused', () => {
    expect(Object.isFrozen(VARIANT) && Object.isFrozen(VARIANT.patternPack) && Object.isFrozen(VARIANT.patternPack.spiral)).toBe(true);
    expect(() => ((VARIANT.patternPack as { enabled: boolean }).enabled = false)).toThrow();
    const withTurns = (turns: unknown): Features => ({ ...VARIANT, patternPack: { ...VARIANT.patternPack, spiral: { ...VARIANT.patternPack.spiral, turns: turns as number } } });
    for (const bad of [NaN, Infinity, -Infinity, undefined, -0]) expect(() => tuningHash(withTurns(bad)), String(bad)).toThrow(/fingerprint/);
    expect(tuningHash(withTurns(0))).not.toBe(tuningHash(withTurns(1.5)));
    // the same odd value in a DISABLED block is never looked at
    expect(tuningHash({ ...FEATURES, patternPack: { ...FEATURES.patternPack, spiral: { ...FEATURES.patternPack.spiral, turns: NaN } } })).toBe('f0214eba');
    // "enabled" must be exactly true everywhere: a truthy 1 is off for the sim AND for the fingerprint
    const one = { ...FEATURES, patternPack: { ...FEATURES.patternPack, enabled: 1 as unknown as boolean } };
    expect(tuningHash(one)).toBe('f0214eba');
    expect(makeParams('hard', 'knight', one).pack).toBeNull();
  });

  it('has a different fingerprint, which covers the rows of the enabled block and not the key order', () => {
    const v = tuningHash(VARIANT);
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(v).not.toBe(tuningHash());
    const edited: Features = { ...VARIANT, patternPack: { ...VARIANT.patternPack, spiral: { ...VARIANT.patternPack.spiral, weight: 99 } } };
    expect(tuningHash(edited)).not.toBe(v);
    const reordered = Object.fromEntries(Object.entries(VARIANT.patternPack).reverse()) as unknown as Features['patternPack'];
    expect(Object.keys(reordered)).not.toEqual(Object.keys(VARIANT.patternPack));
    expect(tuningHash({ ...VARIANT, patternPack: reordered })).toBe(v);
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
    // replayOf(sim) always encodes under the flags the Sim was built with
    expect(replayOf(sim)).toEqual(encodeReplay(77, 'hard', 'knight', sim.log, undefined, VARIANT));
    expect(replayOf(new Sim(1, 'hard', { hero: 'wisp' })).tuning).toBe('f0214eba');
    const r = JSON.parse(JSON.stringify(replayOf(sim))) as { tuning: string };
    expect(r.tuning).toBe(tuningHash(VARIANT));
    expect(r.tuning).not.toBe(tuningFingerprint());
    expect(() => decodeReplay(r)).toThrow(/different tuning/);
    expect(() => playReplay(r)).toThrow(/different tuning/);
    // under its own flags it replays exactly
    const again = playReplay(r, { features: VARIANT });
    expect(again.score).toBe(sim.score);
    expect(again.state.tick).toBe(sim.state.tick);
  });

  it('every combination of blocks: its own fingerprint, its replay refused by production, played back under its flags', () => {
    const combos: FeatureFlag[][] = [];
    for (let m = 1; m < 1 << FLAGS.length; m++) combos.push(FLAGS.filter((_k, i) => m & (1 << i)));
    expect(combos.length).toBe((1 << FLAGS.length) - 1);
    const hashes = new Set<string>(['f0214eba']);
    for (const combo of combos) {
      const f = withFeatures(...combo);
      for (const k of FLAGS) expect(flagOn(f, k), `${combo} ${k}`).toBe(combo.includes(k));
      const h = tuningHash(f);
      expect(hashes.has(h), combo.join('+')).toBe(false);
      hashes.add(h);
      const sim = new Sim(99, 'hard', { hero: 'wisp', features: f });
      for (const fr of mulberryInputs(3, 60 * 20)) sim.step(fr);
      const r = JSON.parse(JSON.stringify(replayOf(sim))) as { tuning: string };
      expect(r.tuning).toBe(h);
      expect(() => decodeReplay(r), combo.join('+')).toThrow(/different tuning/);
      expect(() => playReplay(r), combo.join('+')).toThrow(/different tuning/);
      expect(playReplay(r, { features: f }).score).toBe(sim.score);
      // never under the flags of another combination either
      for (const other of combos) if (other !== combo) expect(() => decodeReplay(r, withFeatures(...other))).toThrow(/different tuning/);
    }
  });

  it('a replay is never re-simulated under flags other than the ones its fingerprint names', () => {
    const prod = encodeReplay(77, 'hard', 'wisp', mulberryInputs(5, 600));
    expect(prod.tuning).toBe('f0214eba');
    expect(() => playReplay(prod, { features: VARIANT })).toThrow(/different tuning/);
    expect(() => decodeReplay(prod, VARIANT)).toThrow(/different tuning/);
    expect(playReplay(prod).state.tick).toBeGreaterThan(0);
  });
});
