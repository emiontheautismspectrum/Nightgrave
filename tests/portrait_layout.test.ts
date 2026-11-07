/**
 * The phone-portrait run layout WITHOUT the console shell (SHELL.enabled = false, the switch): exactly the previous
 * layout (round buttons in the bottom strip, crisp camera zoom). The shell layout: tests/shell.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { portraitLayout } from '../src/render/portraitLayout';
import { SHELL } from '../src/data/shell';
import { portraitGameSize } from '../src/web/screen';

const PHONES: [string, number, number, number][] = [['iPhone 14', 390, 844, 3], ['Pixel 7', 412, 915, 2.625], ['360x800', 360, 800, 3], ['SE 375x667', 375, 667, 2], ['iPhone 14 Safari bars', 390, 664, 3]];

describe('portrait run layout, shell switched off', () => {
  for (const [name, vw, vh, dpr] of PHONES)
    for (const lh of [false, true])
      it(`${name}${lh ? ' (left-handed)' : ''}`, () => {
        const { w, h, k } = portraitGameSize(vw, vh, dpr);
        const L = portraitLayout(w, h, k, dpr, lh, 1, { ...SHELL, enabled: false });
        expect(L.shell).toBeNull();
        for (const b of L.buttons) expect(b.hitW).toBeUndefined(); // round buttons, as before
        const css = k / dpr;
        const [parry, dash] = L.buttons;
        expect(parry!.r * 2 * css).toBeGreaterThanOrEqual(88);
        expect(dash!.r * 2 * css).toBeGreaterThanOrEqual(64);
        for (const b of L.buttons) {
          expect((b.hit - b.r) * css).toBeGreaterThanOrEqual(12 - 1e-9);
          // inside the screen and below the world window (never over the playfield)
          expect(b.x - b.r).toBeGreaterThanOrEqual(0);
          expect(b.x + b.r).toBeLessThanOrEqual(w);
          expect(b.y + b.r).toBeLessThanOrEqual(h);
          expect(b.y - b.r).toBeGreaterThanOrEqual(L.view.y + L.view.h);
          // never over the pause button
          expect(b.y - b.hit).toBeGreaterThan(L.pause.y + L.pause.h);
        }
        expect(Math.hypot(parry!.x - dash!.x, parry!.y - dash!.y)).toBeGreaterThan(parry!.hit + dash!.hit);
        // the thumb side: PARRY in the bottom corner of its side
        if (lh) expect(parry!.x).toBeLessThan(w / 2);
        else expect(parry!.x).toBeGreaterThan(w / 2);
        // the window is filled with at most the world height, at a crisp zoom
        expect(L.view.h / L.zoom).toBeLessThanOrEqual(270 + 1e-9);
        expect(Math.abs(L.zoom * k - Math.round(L.zoom * k))).toBeLessThan(1e-9);
        expect(L.zoom).toBeGreaterThanOrEqual(1);
        // the boss bar sits between the window and the buttons
        expect(L.bar.y).toBeGreaterThanOrEqual(L.view.y + L.view.h);
        expect(L.bar.y + 10).toBeLessThanOrEqual(Math.min(...L.buttons.map((b) => b.y - b.hit)));
      });

  it('switched off, the layout is the previous one (frozen numbers, iPhone 14)', () => {
    const L = portraitLayout(291, 633, 4, 3, false, 1, { ...SHELL, enabled: false });
    expect(L.view).toEqual({ x: 0, y: 30, w: 291, h: 481 });
    expect(L.zoom).toBe(2);
    expect(L.buttons).toEqual([
      { id: 'parry', x: 250, y: 589, r: 33, hit: 42 },
      { id: 'dash', x: 173, y: 577, r: 24, hit: 33 },
    ]);
    expect(L.stick).toEqual({ x: 53, y: 580, r: 45, knob: 21, zone: 60 });
    expect(L.pause).toEqual({ x: 268, y: 3, w: 19, h: 14 });
    expect(L.bar).toEqual({ x: 8, y: 515, w: 275 });
  });
});
