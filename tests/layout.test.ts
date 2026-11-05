import { describe, expect, it } from 'vitest';
import props from '../assets/data/arena_props.json';
import manifest from '../assets/atlas/manifest.json';
import { HOLLOWS, PORTAL, RUNES } from '../src/data/arena';
import { TUNING } from '../src/data/tuning';

describe('sim arena matches the generated art', () => {
  const A = TUNING.arena;
  it('arena rectangle and hero spawn equal the art layout', () => {
    expect([A.x0, A.y0, A.x1, A.y1]).toEqual(manifest.layout.arena);
    expect([A.centerX, A.centerY]).toEqual(manifest.layout.heroSpawn);
  });
  it('portal, hollows and runes come from the same layout the props were placed with', () => {
    expect([PORTAL.x, PORTAL.y]).toEqual(props.layout.portal);
    expect(HOLLOWS.map((h) => [h.side, h.x, h.y])).toEqual(props.layout.hollows.map((h) => [h.side, h.x, h.y]));
    expect(RUNES).toEqual(props.layout.runes);
  });
  it('8 hollows, 2 per side, each on its side of the rectangle', () => {
    expect(HOLLOWS).toHaveLength(8);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) expect(HOLLOWS.filter((h) => h.side === side)).toHaveLength(2);
    for (const h of HOLLOWS) {
      if (h.side === 'top') expect(h.y).toBe(A.y0);
      if (h.side === 'bottom') expect(h.y).toBe(A.y1);
      if (h.side === 'left') expect(h.x).toBe(A.x0);
      if (h.side === 'right') expect(h.x).toBe(A.x1);
    }
  });
});
