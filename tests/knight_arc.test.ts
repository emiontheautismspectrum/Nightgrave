/**
 * The Knight's always-visible shield arc (render-only): the drawn geometry is the nominal sim parry zone, centred on
 * the hero's sim position, radius and arc from src/data/heroes.ts; crisp 1 px pixels; and the sim / tuning are untouched.
 */
import { describe, expect, it } from 'vitest';
import { HEROES, HERO_RULES } from '../src/data/heroes';
import { makeParams } from '../src/sim/params';
import { inParryZone } from '../src/sim/parryZone';
import { arcGeom, arcPixels } from '../src/render/knightArc';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';

const K = HEROES.knight;
const DEG = Math.PI / 180;
const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('knight arc geometry', () => {
  for (const aimDeg of [0, 45, 90, 135, 180, -90])
    it(`aim ${aimDeg} deg: endpoints at aim +- arcDegrees / 2, radius = the parry radius, centre = the sim position`, () => {
      const g = arcGeom(K, 200.25, 140.5, Math.cos(aimDeg * DEG), Math.sin(aimDeg * DEG))!;
      expect(g).not.toBeNull();
      expect(g.cx).toBe(200.25);
      expect(g.cy).toBe(140.5); // hero.y exactly: the point the sim measures from (no sprite offset)
      expect(g.r).toBe(K.parry.radius);
      expect(norm(g.start - (aimDeg - K.parry.arcDegrees / 2) * DEG)).toBeCloseTo(0, 9);
      expect(norm(g.end - (aimDeg + K.parry.arcDegrees / 2) * DEG)).toBeCloseTo(0, 9);
      // the endpoints lie on the sim zone boundary: just inside the nominal zone, and the sim agrees they are inside
      const p = makeParams('hard', 'knight');
      for (const a of [g.start, g.end]) {
        // 1e-4 rad inward along the circle: the boundary itself is a float tie
        const ai = a - Math.sign(a - (g.start + g.end) / 2) * 1e-4;
        const x = g.cx + Math.cos(ai) * (g.r - 1e-6);
        const y = g.cy + Math.sin(ai) * (g.r - 1e-6);
        expect(inParryZone(g.cx, g.cy, Math.cos(aimDeg * DEG), Math.sin(aimDeg * DEG), x, y, 0, p)).toBeGreaterThanOrEqual(0);
        // a little further around the circle (outside the arc) the sim says "outside" (for a 0-radius point)
        const b = a + Math.sign(a - (g.start + g.end) / 2) * 2 * DEG;
        expect(inParryZone(g.cx, g.cy, Math.cos(aimDeg * DEG), Math.sin(aimDeg * DEG), g.cx + Math.cos(b) * 20, g.cy + Math.sin(b) * 20, 0, p)).toBe(-1);
      }
    });

  it('takes radius and arc from heroes.ts (no copied numbers): a changed HeroDef changes the drawing', () => {
    const def = { ...K, parry: { ...K.parry, radius: K.parry.radius + 7, arcDegrees: 90 } };
    const g = arcGeom(def, 0, 0, 1, 0)!;
    expect(g.r).toBe(K.parry.radius + 7);
    expect(g.end - g.start).toBeCloseTo(90 * DEG, 12);
    expect(makeParams('hard', 'knight').parryRadius).toBe(K.parry.radius);
  });

  it('a full ring hero (Wisp) has no persistent arc', () => {
    expect(arcGeom(HEROES.wisp, 0, 0, 1, 0)).toBeNull();
  });

  it('pixels: integers, 1 px apart (a connected thin line), each once, all at the radius, endpoints first and last', () => {
    const out: number[] = [];
    for (const aimDeg of [0, 33, 90, 135, 180, -90]) {
      const g = arcGeom(K, 240.4, 135.6, Math.cos(aimDeg * DEG), Math.sin(aimDeg * DEG))!;
      const len = arcPixels(g, 0, out);
      const seen = new Set<string>();
      for (let i = 0; i < len; i += 2) {
        const x = out[i]!;
        const y = out[i + 1]!;
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(seen.has(`${x},${y}`)).toBe(false);
        seen.add(`${x},${y}`);
        // the visible pixel centre (x + 0.5, y + 0.5) is within 0.71 px of the true arc (no half-pixel bias)
        expect(Math.abs(Math.hypot(x + 0.5 - g.cx, y + 0.5 - g.cy) - g.r)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-9);
        if (i > 0) expect(Math.max(Math.abs(x - out[i - 2]!), Math.abs(y - out[i - 1]!))).toBe(1);
      }
      expect(out[0]).toBe(Math.floor(g.cx + Math.cos(g.start) * g.r));
      expect(out[len - 2]).toBe(Math.floor(g.cx + Math.cos(g.end) * g.r));
      // the pulse's inner row adds pixels without repeating any (no alpha stacking)
      const both = arcPixels(g, 1, out, len);
      const all = new Set<string>();
      for (let i = 0; i < both; i += 2) all.add(`${out[i]},${out[i + 1]}`);
      expect(all.size).toBe(both / 2);
      expect(both).toBeGreaterThan(len);
    }
  });

  it('the drawn arc never claims more than the sim: every visible pixel centre, any aim and sub-pixel position, is inside the real zone for a 1 px shot', () => {
    const p = makeParams('hard', 'knight');
    const out: number[] = [];
    for (let deg = 0; deg < 360; deg += 7)
      for (const [hx, hy] of [[240, 135], [240.3, 135.7], [200.9, 100.1]] as const) {
        const ax = Math.cos(deg * DEG);
        const ay = Math.sin(deg * DEG);
        const g = arcGeom(K, hx, hy, ax, ay)!;
        const len = arcPixels(g, 0, out);
        for (let i = 0; i < len; i += 2) expect(inParryZone(hx, hy, ax, ay, out[i]! + 0.5, out[i + 1]! + 0.5, 1, p)).toBeGreaterThanOrEqual(0);
      }
    expect(HERO_RULES.overlapPx).toBeLessThan(K.parry.radius);
  });
});

describe('render-only change', () => {
  it('the tuning fingerprint and CLIENT_VERSION are pinned (a change needs a coordinated Worker + Pages deploy)', () => {
    expect(tuningFingerprint()).toBe('f0214eba');
    expect(CLIENT_VERSION).toBe('0.10.0');
  });
});
