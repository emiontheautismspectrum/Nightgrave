/** Render-side multiplier / Double Score feedback logic (pure): tiers, reset blink, label placement. */
import { describe, expect, it } from 'vitest';
import { decayAlpha, doubleActive, labelSpot, multColor, resetTicksLeft } from '../src/render/multFeedback';
import { Sim, spawnProjectile } from '../src/sim/sim';

const fresh = () => new Sim(1, 'medium', { spawner: false });
const B = { minX: 50, maxX: 430, minY: 31, maxY: 239 };

describe('multiplier feedback', () => {
  it('HUD colour by tier: x1 white, x2+ amber, x4+ gold', () => {
    expect([100, 175, 200, 375, 400, 500].map(multColor)).toEqual(['#d9d2c0', '#d9d2c0', '#ffb347', '#ffb347', '#ffd86b', '#ffd86b']);
  });

  it('blinks slowly only in the last second before the reset, never with reduced flashes', () => {
    const sim = fresh();
    const s = sim.state;
    const p = sim.params;
    expect(resetTicksLeft(s, p)).toBe(Infinity); // x1: nothing to lose
    s.multiplier = 200;
    s.lastParryTick = 0;
    s.tick = 10;
    expect([0, 250, 500].map((ms) => decayAlpha(s, p, ms, false))).toEqual([1, 1, 1]);
    s.tick = p.multReset - 30;
    expect(decayAlpha(s, p, 0, false)).toBe(1);
    expect(decayAlpha(s, p, 250, false)).toBeLessThan(1);
    expect(decayAlpha(s, p, 250, true)).toBe(1);
  });

  it('labels never sit on the hero and move away from an approaching projectile', () => {
    const sim = fresh();
    const s = sim.state;
    const h = s.hero;
    const free = labelSpot(s, B);
    expect(free.y).toBeLessThanOrEqual(h.y - 14);
    spawnProjectile(s, sim.params, 'orb_small', h.x + 4, h.y - 30, 0, 0);
    const below = labelSpot(s, B);
    expect(below.y).toBeGreaterThanOrEqual(h.y + 14);
    // projectiles above AND below: a side spot that touches none of them
    spawnProjectile(s, sim.params, 'orb_small', h.x, h.y + 16, 0, 0);
    const side = labelSpot(s, B, [], 64);
    expect(Math.abs(side.x - h.x)).toBeGreaterThan(30);
    for (const pr of s.projectiles) expect(Math.abs(pr.x - side.x) > 38 + pr.radius || Math.abs(pr.y - side.y) > 10 + pr.radius).toBe(true);
    // the points popup of this tick is avoided like a projectile
    s.projectiles = [];
    const pts = labelSpot(s, B, [{ x: h.x, y: h.y - 22 }]);
    expect(pts.y).not.toBe(Math.round(h.y - 22));
    // a projectile that will fly through the spot above during the label's life (not there yet) is avoided too
    spawnProjectile(s, sim.params, 'orb_small', h.x - 60, h.y - 22, 2, 0);
    expect(labelSpot(s, B).y).not.toBe(Math.round(h.y - 22));
    // clamped inside the bounds: a wide label next to the left edge
    s.projectiles = [];
    h.x = 52;
    const edge = labelSpot(s, B, [], 104);
    expect(edge.x - 52).toBeGreaterThanOrEqual(B.minX);
    h.x = 240;
    // no room above (top of the arena): below
    h.y = 35;
    s.projectiles = [];
    expect(labelSpot(s, B).y).toBeGreaterThan(h.y);
  });

  it('Double Score is active exactly while the sim says so', () => {
    const s = fresh().state;
    expect(doubleActive(s)).toBe(false);
    s.doubleUntil = s.tick + 1;
    expect(doubleActive(s)).toBe(true);
  });
});
