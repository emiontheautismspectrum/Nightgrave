/**
 * Knight aim fix: FACING = where the hero goes, for every input source. The aim turns to this tick's movement intent
 * when the intended step is >= aimMinStep (HERO_RULES.aimMinStepFrac x the max step); a turn of more than 90 degrees
 * needs aimTurnTicks consistent ticks (anti-jitter); a dash never turns it.
 */
import { describe, expect, it } from 'vitest';
import { HERO_RULES } from '../src/data/heroes';
import { BTN_DASH, NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { Sim } from '../src/sim/sim';

const DEG = Math.PI / 180;
const fresh = () => new Sim(5, 'medium', { spawner: false, hero: 'knight' });
const angle = (x: number, y: number) => Math.atan2(y, x);
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** Walk with the cursor `ahead` px in front of the hero (integer cursor, like a real client) for n ticks. */
function walk(sim: Sim, deg: number, ahead: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const h = sim.state.hero;
    sim.step({ cursor: true, mx: Math.round(h.x + Math.cos(deg * DEG) * ahead), my: Math.round(h.y + Math.sin(deg * DEG) * ahead), buttons: 0 });
  }
}

describe('aim follows the movement', () => {
  for (const deg of [0, 45, 90, 135, 180, -45, -90, -135])
    it(`cursor just ahead of a walking hero (${deg} deg): the aim turns to the walking direction`, () => {
      const sim = fresh();
      walk(sim, deg + 180, 2, 4); // first walk the other way
      walk(sim, deg, 2, 6); // the cursor only 2 px ahead: inside the old 3 px dead zone
      const h = sim.state.hero;
      const x0 = h.x;
      const y0 = h.y;
      walk(sim, deg, 2, 1);
      // the aim IS the direction the hero just moved (and close to the intended walking direction)
      expect(angDiff(angle(h.aimX, h.aimY), angle(h.x - x0, h.y - y0))).toBeLessThan(1e-9);
      expect(angDiff(angle(h.aimX, h.aimY), deg * DEG)).toBeLessThan(25 * DEG);
    });

  it('the old freeze case: medium speed with the cursor right under / just ahead of the hero (was frozen by the 3 px dead zone)', () => {
    const sim = fresh();
    const h = sim.state.hero;
    expect([h.aimX, h.aimY]).toEqual([1, 0]);
    // walk down at ~1.5 px / tick with the cursor 1-2 px ahead: never more than 3 px away
    for (let i = 0; i < 20; i++) sim.step({ cursor: true, mx: Math.round(h.x), my: Math.round(h.y + 1.5), buttons: 0 });
    expect(h.aimY).toBeGreaterThan(0.9);
  });

  it('a resting cursor never turns the aim: on the hero, or flickering between two adjacent pixels', () => {
    const sim = fresh();
    const h = sim.state.hero;
    walk(sim, 90, 6, 10); // aim down
    const rest = [Math.round(h.x) + 3, Math.round(h.y)];
    for (let i = 0; i < 4; i++) sim.step({ cursor: true, mx: rest[0]!, my: rest[1]!, buttons: 0 }); // settle on the cursor (aim turns right: a real move)
    const aim = [h.aimX, h.aimY];
    for (let i = 0; i < 200; i++) sim.step({ cursor: true, mx: rest[0]! + (i % 2), my: rest[1]!, buttons: 0 });
    // the hero follows the 1 px flicker, but each reversal lasts one tick: never 2 consistent ticks -> no flip
    expect(Math.abs(h.aimX * aim[0]! + h.aimY * aim[1]!)).toBeGreaterThan(0.99);
    for (let i = 0; i < 50; i++) sim.step({ cursor: true, mx: Math.round(h.x), my: Math.round(h.y), buttons: 0 });
    expect(Math.abs(h.aimX * aim[0]! + h.aimY * aim[1]!)).toBeGreaterThan(0.99);
  });

  it('a step below aimMinStep never turns the aim (axis input below 25%)', () => {
    const sim = fresh();
    const h = sim.state.hero;
    const below = Math.floor(HERO_RULES.aimMinStepFrac * 100) - 1;
    for (let i = 0; i < 30; i++) sim.step({ cursor: false, mx: 0, my: below, buttons: 0 });
    expect([h.aimX, h.aimY]).toEqual([1, 0]);
    sim.step({ cursor: false, mx: 0, my: below + 2, buttons: 0 });
    expect(h.aimY).toBeCloseTo(1, 9); // a 90 degree turn: immediate
  });

  it('axis input: the movement direction (analog), a reversal needs 2 consistent ticks', () => {
    const sim = fresh();
    const h = sim.state.hero;
    sim.step({ cursor: false, mx: 70, my: -70, buttons: 0 });
    expect(angDiff(angle(h.aimX, h.aimY), -45 * DEG)).toBeLessThan(1e-9);
    sim.step({ cursor: false, mx: -100, my: 0, buttons: 0 }); // 135 degrees away: pending
    expect(angDiff(angle(h.aimX, h.aimY), -45 * DEG)).toBeLessThan(1e-9);
    sim.step({ cursor: false, mx: -100, my: 0, buttons: 0 });
    expect(h.aimX).toBeCloseTo(-1, 9);
    expect(HERO_RULES.aimTurnTicks).toBe(2);
  });

  it('a dash never turns the aim, whatever the input during it', () => {
    const sim = fresh();
    const h = sim.state.hero;
    walk(sim, 0, 6, 5);
    sim.step({ cursor: true, mx: Math.round(h.x) - 60, my: Math.round(h.y), buttons: BTN_DASH }); // dash left
    for (let i = 0; i < sim.params.dashTicks - 1; i++) sim.step({ cursor: true, mx: Math.round(h.x), my: Math.round(h.y) + 60, buttons: 0 });
    expect(h.aimX).toBeCloseTo(1, 9);
  });

  it('is a pure function of the input log and always a unit vector', () => {
    let r = 7;
    const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const log: InputFrame[] = [];
    for (let i = 0; i < 3000; i++) {
      const k = rnd();
      if (k < 0.5) log.push({ cursor: true, mx: Math.floor(rnd() * 480), my: Math.floor(rnd() * 270), buttons: rnd() < 0.03 ? BTN_DASH : 0 });
      else if (k < 0.8) log.push({ cursor: false, mx: Math.floor(rnd() * 201) - 100, my: Math.floor(rnd() * 201) - 100, buttons: 0 });
      else log.push({ ...NEUTRAL_INPUT });
    }
    const run = () => {
      const sim = new Sim(3, 'hard', { hero: 'knight' });
      const out: number[] = [];
      for (const f of log) {
        sim.state.alive = true;
        sim.step(f);
        const { aimX, aimY } = sim.state.hero;
        expect(Math.abs(Math.hypot(aimX, aimY) - 1)).toBeLessThan(1e-9);
        out.push(aimX, aimY);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
