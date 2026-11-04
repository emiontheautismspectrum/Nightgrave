import { describe, expect, it } from 'vitest';
import manifest from '../assets/atlas/manifest.json';
import { TUNING } from '../src/data/tuning';

describe('sim arena matches the generated art', () => {
  it('play centre equals the hero spawn of the arena layout', () => {
    expect([TUNING.arena.centerX, TUNING.arena.centerY]).toEqual(manifest.layout.heroSpawn);
  });
  it('the (interim) play circle stays inside the arena rectangle', () => {
    const [x0, y0, x1, y1] = manifest.layout.arena as [number, number, number, number];
    const { centerX: cx, centerY: cy, playRadius: r } = TUNING.arena;
    expect(cx - r).toBeGreaterThanOrEqual(x0);
    expect(cx + r).toBeLessThanOrEqual(x1);
    expect(cy - r).toBeGreaterThanOrEqual(y0);
    expect(cy + r).toBeLessThanOrEqual(y1);
  });
});
