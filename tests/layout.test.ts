import { describe, expect, it } from 'vitest';
import manifest from '../assets/atlas/manifest.json';
import { TUNING } from '../src/data/tuning';

describe('sim arena matches the generated art', () => {
  it('play circle centre equals the ritual platform centre', () => {
    expect([TUNING.arena.centerX, TUNING.arena.centerY]).toEqual(manifest.layout.ritualCenter);
  });
  it('play circle (plus hero size) stays on the platform, spawns happen outside it', () => {
    // the hero sprite extends 12 px above its sim position (drawn at y-4, 16 px tall)
    expect(TUNING.arena.playRadius + 12).toBeLessThanOrEqual(manifest.layout.platformRadius);
    expect(TUNING.arena.spawnRadius).toBeGreaterThan(manifest.layout.platformRadius);
  });
});
