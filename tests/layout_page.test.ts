import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/web/layout';

describe('page layout', () => {
  it('1920x1080 at DPR 1: canvas 1440x810 + panel 360 side by side, nothing wider than the window', () => {
    const L = computeLayout(1920, 1080, 1, false);
    expect(L.mode).toBe('side');
    expect([L.game.w, L.game.h]).toEqual([1440, 810]);
    expect(L.panel!.w).toBe(360);
    expect(L.panel!.h).toBe(L.game.h);
    expect(L.panel!.x + L.panel!.w).toBeLessThanOrEqual(1920);
  });
  it('1366x768: 2x canvas with a narrower panel; 1100 wide: the panel moves under the game', () => {
    const L = computeLayout(1366, 768, 1, false);
    expect(L.mode).toBe('side');
    expect(L.device).toBe(2);
    expect(L.panel!.w).toBeGreaterThanOrEqual(280);
    expect(L.panel!.x + L.panel!.w).toBeLessThanOrEqual(1366);
    const S = computeLayout(1100, 700, 1, false);
    expect(S.mode).toBe('stack');
    expect(S.panel!.y).toBeGreaterThan(S.game.y + S.game.h);
  });
  it('every desktop size: integer device scale when >= 2 fits, no horizontal overflow, pair centred', () => {
    for (const dpr of [1, 1.25, 1.5, 2])
      for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as [number, number][]) {
        const L = computeLayout(w, h, dpr, false);
        if (L.exact) expect(Math.abs(L.device - Math.round(L.device))).toBeLessThan(1e-9);
        const right = Math.max(L.game.x + L.game.w + 4 * L.gp, L.panel ? L.panel.x + L.panel.w + 4 * L.gp : 0);
        expect(right).toBeLessThanOrEqual(w + 1e-6);
        expect(L.game.x - 4 * L.gp).toBeGreaterThanOrEqual(-1e-6);
      }
  });
  it('phones use the whole screen, no panel', () => {
    const L = computeLayout(915, 412, 2.625, true);
    expect(L.mode).toBe('phone');
    expect(L.panel).toBeNull();
  });
});
