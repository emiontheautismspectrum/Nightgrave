/** The zoomed portrait view never changes what touch input produces (the replay is the same in both orientations). */
import { describe, expect, it } from 'vitest';
import { TouchModel, touchButtons } from '../src/render/touch';
import { PORTRAIT } from '../src/data/view';

const opts = { sensitivity: 1.5, leftHanded: false, secondFingerParry: true };
const hero = { x: 240, y: 135 };

function drag(view: 'full' | 'zoomed', x0: number, y0: number): { x: number; y: number } | null {
  const t = new TouchModel(opts);
  t.view = view;
  t.down(1, x0, y0, 0, hero);
  t.move(1, x0 + 30, y0);
  t.move(1, x0 + 30, y0 + 12);
  t.up(1, 500);
  return t.cursor;
}

describe('touch in the zoomed portrait view', () => {
  it('the same drag (game px) moves the virtual cursor identically in both views', () => {
    expect(drag('zoomed', 60, 150)).toEqual(drag('full', 200, 120));
  });
  it('buttons sit in the portrait bottom strip, below the world window, inside the screen', () => {
    for (const lh of [false, true])
      for (const b of touchButtons(lh, 'zoomed')) {
        expect(b.y - b.r).toBeGreaterThanOrEqual(PORTRAIT.h - PORTRAIT.bottomH);
        expect(b.y + b.r).toBeLessThanOrEqual(PORTRAIT.h);
        expect(b.x - b.r).toBeGreaterThanOrEqual(0);
        expect(b.x + b.r).toBeLessThanOrEqual(PORTRAIT.w);
      }
  });
  it('a finger held across a view switch re-anchors: no jump, and it is never read as a tap', () => {
    const t = new TouchModel(opts);
    t.down(1, 300, 150, 0, hero);
    t.move(1, 310, 150);
    const before = { ...t.cursor! };
    t.view = 'zoomed';
    t.rebase();
    t.move(1, 40, 300); // the same finger, now in the 216x384 screen space
    expect(t.cursor).toEqual(before);
    t.move(1, 50, 300);
    expect(t.cursor!.x).toBeCloseTo(before.x + 15);
    // a second finger held across the switch and lifted quickly does not parry
    t.down(2, 100, 100, 1000, hero);
    t.rebase();
    t.move(2, 100, 100);
    t.up(2, 1050);
    expect(t.take()).toBe(0);
  });
});
