/**
 * Touch smoothing lives in the input layer: the per-tick cursor is smoothed BEFORE it is recorded, so the replay holds
 * the smoothed cursor and the verifier replays it exactly. Mouse, keyboard and gamepad input are untouched.
 */
import { describe, expect, it } from 'vitest';
import { TouchModel } from '../src/render/touch';
import { TOUCH_INPUT, type TouchSmoothing } from '../src/data/input';
import { Sim } from '../src/sim/sim';
import type { InputFrame } from '../src/sim/input';
import { encodeInputLog } from '../src/shared/replayCodec';
import { dailySeed } from '../src/shared/daily';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { verifyItem } from '../tools/verify/core';
import { DEFAULT_SETTINGS, validateSave } from '../src/storage';

const hero = { x: 240, y: 135 };

/** A jerky finger path: sudden 18 px steps every 10 ticks (held in between) with 1 px jitter; one cursor per tick. */
function run(smoothing: TouchSmoothing, ticks = 240): { cursors: { x: number; y: number }[]; maxJump: number } {
  const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, smoothing });
  let fx = 200;
  let fy = 150;
  t.down(1, fx, fy, 0, hero);
  const cursors: { x: number; y: number }[] = [];
  let maxJump = 0;
  for (let k = 0; k < ticks; k++) {
    if (k % 10 === 0) fx += Math.floor(k / 40) % 2 ? -18 : 18; // a sudden step
    else fy += k % 2 ? 1 : -1; // jitter
    t.move(1, fx, fy);
    t.smoothTick();
    const c = { ...t.cursor! };
    const prev = cursors[cursors.length - 1];
    if (prev) maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.y - prev.y));
    cursors.push(c);
  }
  return { cursors, maxJump };
}

describe('touch smoothing', () => {
  it('the largest cursor jump per tick is clearly lower with smoothing', () => {
    const off = run('off').maxJump;
    const low = run('low').maxJump;
    const high = run('high').maxJump;
    expect(off).toBeGreaterThanOrEqual(18);
    expect(low).toBeLessThan(off * 0.6);
    expect(high).toBeLessThan(low);
  });

  it('1 px finger jitter does not move the cursor with smoothing (dead zone); off follows it exactly', () => {
    for (const [mode, moves] of [['low', false], ['off', true]] as const) {
      const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, smoothing: mode });
      t.down(1, 100, 100, 0, hero);
      const c0 = { ...t.cursor! };
      let everMoved = false;
      for (let k = 0; k < 20; k++) {
        t.move(1, 100 + ((k + 1) % 2), 100);
        t.smoothTick();
        if (t.cursor!.x !== c0.x || t.cursor!.y !== c0.y) everMoved = true;
      }
      expect(everMoved).toBe(moves); // off: the jitter goes straight into the cursor; smoothing: held back
      expect(TOUCH_INPUT.deadZonePx).toBeGreaterThan(1);
    }
  });

  it('a smoothed run records the smoothed cursor and its replay verifies with the existing verifier', () => {
    const date = '2026-11-06';
    const sim = new Sim(dailySeed(date), 'hard', { hero: 'wisp' });
    const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, smoothing: 'high' });
    t.down(1, 240, 135, 0, sim.state.hero);
    for (let k = 0; k < 600 && sim.state.alive; k++) {
      t.move(1, 240 + Math.round(60 * Math.sin(k / 20)), 135 + Math.round(30 * Math.cos(k / 13)));
      t.smoothTick();
      const c = t.cursor!;
      const f: InputFrame = { cursor: true, mx: Math.round(c.x), my: Math.round(c.y), buttons: 0 };
      sim.step(f);
    }
    const verdict = verifyItem({
      id: '1-1', date, seed: dailySeed(date), difficulty: 'hard', durationTicks: sim.log.length, score: sim.score, hero: 'wisp',
      tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION, replay: encodeInputLog(sim.log, 'wisp'),
    });
    expect(verdict).toEqual({ status: 'verified' });
  });

  it('defaults: sensitivity 1.0 and smoothing Low; an old save with the old default 1.5 moves to 1.0, a picked value stays', () => {
    expect(DEFAULT_SETTINGS.dragSensitivity).toBe(1);
    expect(DEFAULT_SETTINGS.touchSmoothing).toBe('low');
    expect(validateSave({ v: 1, settings: { dragSensitivity: 1.5 } }).settings.dragSensitivity).toBe(1);
    expect(validateSave({ v: 1, settings: { dragSensitivity: 2 } }).settings.dragSensitivity).toBe(2);
    expect(validateSave({ v: 1, settings: { dragSensitivity: 1.5, touchSmoothing: 'off' } }).settings.dragSensitivity).toBe(1.5);
    expect(validateSave({ v: 1, settings: { touchSmoothing: 'bogus' } }).settings.touchSmoothing).toBe('low');
  });
});
