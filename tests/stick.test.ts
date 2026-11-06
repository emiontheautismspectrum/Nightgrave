/**
 * The fixed touch joystick (Stick mode): pure TouchModel logic, its layout (portrait strip, landscape margin), its axis
 * output through the existing axis path (replays are plain axis frames), the Knight's aim, and old saves.
 */
import { describe, expect, it } from 'vitest';
import { STICK } from '../src/data/input';
import { portraitLayout } from '../src/render/portraitLayout';
import { TouchModel, touchButtons, touchStick, type TouchStick } from '../src/render/touch';
import { cardLines, controlsLine } from '../src/render/hints';
import { AXIS_MAX, BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { Sim } from '../src/sim/sim';
import { encodeReplay, playReplay } from '../src/sim/replay';
import { portraitGameSize } from '../src/web/screen';
import { loadSave, type KV } from '../src/storage';

const hero = { x: 240, y: 135 };
const S: TouchStick = { x: 40, y: 230, r: 30, knob: 14, zone: 45 };
const model = (stick = true) => {
  const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, stick });
  t.stickLayout = S;
  return t;
};
/** The frame the InputCollector records for a stick deflection (the existing axis path). */
const frame = (t: TouchModel, buttons = 0): InputFrame => {
  const [ax, ay] = t.stickAxis();
  return { cursor: false, mx: Math.round(ax * AXIS_MAX), my: Math.round(ay * AXIS_MAX), buttons };
};

describe('stick logic', () => {
  it('grabs inside the zone, follows the finger clamped to the ring, springs back on release', () => {
    const t = model();
    expect(t.down(1, S.x + S.zone - 1, S.y, 0, hero)).toBe('stick');
    t.move(1, S.x + S.r, S.y);
    expect(t.stickAxis()[0]).toBeCloseTo(1, 9);
    t.move(1, S.x + 400, S.y + 0.0001); // far outside: clamped to full deflection, the finger keeps the stick
    expect(Math.hypot(...t.stickAxis())).toBeCloseTo(1, 6);
    expect(t.knobOffset().x).toBeCloseTo(S.r, 3);
    t.up(1, 100);
    expect(t.stickAxis()).toEqual([0, 0]);
    expect(t.knobOffset()).toEqual({ x: 0, y: 0 });
  });
  it('a 12% dead zone, then the output starts from 0 at its edge', () => {
    const t = model();
    t.down(1, S.x, S.y, 0, hero);
    t.move(1, S.x + S.r * STICK.deadZone * 0.99, S.y);
    expect(t.stickAxis()).toEqual([0, 0]);
    t.move(1, S.x + S.r * 0.56, S.y);
    expect(t.stickAxis()[0]).toBeCloseTo((0.56 - STICK.deadZone) / (1 - STICK.deadZone), 9);
  });
  it('outside the stick zone and the buttons a touch does nothing (no drag, no second-finger parry)', () => {
    const t = model();
    expect(t.down(1, 240, 135, 0, hero)).toBe('none');
    t.move(1, 300, 135);
    expect(t.cursor).toBeNull();
    expect(t.down(2, 250, 140, 10, hero)).toBe('none');
    t.up(2, 20);
    expect(t.take()).toBe(0);
    expect(t.stickAxis()).toEqual([0, 0]);
  });
  it('multi-touch: the stick finger plus PARRY then DASH by another finger, the stick undisturbed', () => {
    const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, stick: true });
    t.stickLayout = touchStick(false, 1.5);
    const St = t.stickLayout;
    t.down(1, St.x, St.y, 0, hero);
    t.move(1, St.x, St.y - St.r);
    const [parry, dash] = touchButtons(false);
    expect(t.down(2, parry!.x, parry!.y, 5, hero)).toBe('parry');
    expect(t.take()).toBe(BTN_PARRY);
    t.up(2, 30);
    expect(t.down(3, dash!.x, dash!.y, 40, hero)).toBe('dash');
    expect(t.take()).toBe(BTN_DASH);
    t.up(3, 60);
    expect(t.stickAxis()[1]).toBeCloseTo(-1, 9);
    // a new touch in the stick zone takes it over (a lost touchend can never leave the stick stuck); the old finger's
    // moves are then ignored
    expect(t.down(4, St.x + 2, St.y, 70, hero)).toBe('stick');
    expect(t.stickAxis()).toEqual([0, 0]); // 2 px: inside the dead zone
    t.move(1, St.x, St.y + St.r);
    expect(t.stickAxis()).toEqual([0, 0]);
  });
  it('touchcancel, focus loss and a mode switch release the stick (never stuck)', () => {
    const t = model();
    t.down(1, S.x, S.y, 0, hero);
    t.move(1, S.x + S.r, S.y);
    t.cancel(1);
    expect(t.stickAxis()).toEqual([0, 0]);
    t.down(2, S.x, S.y, 0, hero);
    t.move(2, S.x + S.r, S.y);
    t.releaseAll();
    expect(t.stickAxis()).toEqual([0, 0]);
    expect(t.stickHeld()).toBe(false);
  });
  it('a re-layout while held re-anchors relatively: no jump to full deflection', () => {
    const t = model();
    t.down(1, S.x, S.y, 0, hero);
    t.move(1, S.x + 10, S.y);
    const before = t.stickAxis()[0];
    t.stickLayout = { ...S, x: S.x + 200, y: S.y - 100 }; // the stick moved far away under the finger
    t.rebase();
    t.move(1, S.x + 10, S.y); // the finger has not moved
    expect(t.stickAxis()[0]).toBeCloseTo(before, 9);
    t.move(1, S.x + 13, S.y); // it moves 3 px: the knob moves 3 px
    expect(t.knobOffset().x).toBeCloseTo(13, 9);
  });
  it('after a re-layout, a finger dragged past the ring and brought back centres the knob (re-anchored on the clamp)', () => {
    const t = model();
    t.down(1, S.x, S.y, 0, hero);
    t.stickLayout = { ...S, x: S.x + 50 };
    t.rebase();
    t.move(1, S.x, S.y); // the first move after a re-layout only sets the baseline
    t.move(1, S.x + 70, S.y); // far past the ring: clamped at +r
    expect(t.knobOffset().x).toBeCloseTo(S.r, 9);
    t.move(1, S.x + 70 - S.r, S.y); // back by r: the knob is centred again
    expect(t.stickAxis()).toEqual([0, 0]);
    expect(Math.abs(t.knobOffset().x)).toBeLessThan(1e-9);
  });
  it('Drag mode is unchanged: a drag anywhere moves the virtual cursor, the stick does nothing', () => {
    const t = model(false);
    expect(t.down(1, S.x, S.y, 0, hero)).toBe('move');
    t.move(1, S.x + 20, S.y);
    expect(t.cursor).toEqual({ x: 260, y: 135 });
    expect(t.stickAxis()).toEqual([0, 0]);
  });
});

describe('stick layout', () => {
  const PHONES: [number, number, number][] = [[390, 844, 3], [412, 915, 2.625], [360, 800, 3], [375, 667, 2], [430, 932, 3], [390, 664, 3]];
  for (const [vw, vh, dpr] of PHONES)
    for (const lh of [false, true])
      it(`portrait ${vw}x${vh}${lh ? ' left-handed' : ''}: >= 120 CSS px base, >= 56 knob, in the strip, clear of the buttons`, () => {
        const { w, h, k } = portraitGameSize(vw, vh, dpr);
        const L = portraitLayout(w, h, k, dpr, lh);
        const css = k / dpr;
        const St = L.stick;
        expect(St.r * 2 * css).toBeGreaterThanOrEqual(STICK.portrait);
        expect(St.knob * 2 * css).toBeGreaterThanOrEqual(STICK.knob);
        expect(St.x - St.r).toBeGreaterThanOrEqual(0);
        expect(St.x + St.r).toBeLessThanOrEqual(w);
        expect(St.y + St.r).toBeLessThanOrEqual(h);
        expect(St.y - St.r).toBeGreaterThanOrEqual(L.bar.y + 10); // under the boss bar, below the world window
        expect(St.y - St.zone).toBeGreaterThan(L.pause.y + L.pause.h);
        for (const b of L.buttons) expect(Math.hypot(b.x - St.x, b.y - St.y)).toBeGreaterThan(St.zone + b.hit);
        if (lh) expect(St.x).toBeGreaterThan(w / 2);
        else expect(St.x).toBeLessThan(w / 2);
      });
  for (const [vw, vh, dpr] of [[320, 548, 2], [280, 653, 3], [344, 882, 3]] as const)
    it(`narrow portrait ${vw}x${vh}: the stick shrinks so its base never reaches the DASH / PARRY hit circles`, () => {
      const { w, h, k } = portraitGameSize(vw, vh, dpr);
      for (const lh of [false, true]) {
        const L = portraitLayout(w, h, k, dpr, lh);
        for (const b of L.buttons) expect(Math.hypot(b.x - L.stick.x, b.y - L.stick.y)).toBeGreaterThan(L.stick.r + b.hit);
        expect(L.stick.x - L.stick.r).toBeGreaterThanOrEqual(0);
      }
    });
  it('landscape: in the corner opposite the buttons, never over a button, the pause button or the HUD band', () => {
    for (const cssPerPx of [1, 1.333, 2, 2.4])
      for (const lh of [false, true]) {
        const St = touchStick(lh, cssPerPx);
        expect(St.r * 2 * cssPerPx).toBeGreaterThanOrEqual(STICK.landscapeMin - 2);
        expect(St.y + St.r).toBeLessThanOrEqual(270);
        expect(St.y - St.r).toBeGreaterThan(27);
        for (const b of touchButtons(lh)) expect(Math.hypot(b.x - St.x, b.y - St.y)).toBeGreaterThan(St.zone + (b.hit ?? b.r));
        if (lh) expect(St.x).toBeGreaterThan(240);
        else expect(St.x).toBeLessThan(240);
      }
  });
});

describe('stick -> sim (plain axis frames)', () => {
  const DIRS: [string, number, number][] = [['right', 1, 0], ['left', -1, 0], ['down', 0, 1], ['up', 0, -1], ['down-right', 1, 1], ['down-left', -1, 1], ['up-right', 1, -1], ['up-left', -1, -1]];
  for (const [name, dx, dy] of DIRS)
    it(`stick ${name}: the hero moves that way; the Knight's arc turns within 2 ticks`, () => {
      const t = model();
      const sim = new Sim(1, 'medium', { spawner: false, hero: 'knight' });
      const h = sim.state.hero;
      // first face the opposite way
      for (let i = 0; i < 3; i++) sim.step({ cursor: false, mx: -dx * 100, my: -dy * 100, buttons: 0 });
      const x0 = h.x;
      const y0 = h.y;
      t.down(1, S.x, S.y, 0, hero);
      const l = Math.hypot(dx, dy);
      t.move(1, S.x + (dx / l) * S.r, S.y + (dy / l) * S.r);
      sim.step(frame(t));
      sim.step(frame(t));
      const want = Math.atan2(dy, dx);
      expect(Math.abs(Math.atan2(Math.sin(Math.atan2(h.aimY, h.aimX) - want), Math.cos(Math.atan2(h.aimY, h.aimX) - want)))).toBeLessThan(0.02);
      for (let i = 0; i < 20; i++) sim.step(frame(t));
      expect(Math.sign(Math.round(h.x - x0))).toBe(dx);
      expect(Math.sign(Math.round(h.y - y0))).toBe(dy);
    });
  it('a stick run replays exactly (axis frames, the same in both layouts)', () => {
    const t = model();
    const sim = new Sim(77, 'hard', { hero: 'wisp' });
    t.down(1, S.x, S.y, 0, hero);
    for (let i = 0; i < 600 && sim.state.alive; i++) {
      const a = (i / 40) * Math.PI;
      t.move(1, S.x + Math.cos(a) * S.r * 0.8, S.y + Math.sin(a) * S.r * 0.8);
      sim.step(frame(t, i % 50 === 0 ? BTN_PARRY : 0));
    }
    const r = encodeReplay(sim.state.seed, 'hard', 'wisp', sim.log, { input: ['touch'] });
    expect(playReplay(JSON.parse(JSON.stringify(r))).score).toBe(sim.score);
    // the same stick motion in the portrait layout (another stick position) gives the same frames
    const t2 = model();
    t2.stickLayout = { ...S, x: 150, y: 500 };
    t2.down(1, 150, 500, 0, hero);
    t2.move(1, 150 + S.r * 0.5, 500 - S.r * 0.3);
    t.move(1, S.x + S.r * 0.5, S.y - S.r * 0.3);
    expect(frame(t2)).toEqual(frame(t));
  });
});

describe('settings and hints', () => {
  it('an old save without the setting loads unchanged and means Stick', () => {
    const old = { v: 1, difficulty: 'hard', hero: 'wisp', settings: { leftHanded: true, dragSensitivity: 2, touchSmoothing: 'high' }, best: {}, daily: [] };
    const kv: KV = { getItem: () => JSON.stringify(old), setItem: () => undefined };
    const sv = loadSave(kv);
    expect(sv.settings.touchControls).toBe('stick');
    expect(sv.settings.leftHanded).toBe(true);
    expect(sv.settings.dragSensitivity).toBe(2);
    expect(sv.settings.touchSmoothing).toBe('high');
    expect(sv.hero).toBe('wisp');
  });
  it('the controls line and the first-run card match the mode', () => {
    expect(controlsLine('touch')).toBe('STICK MOVE - PARRY - DASH');
    expect(controlsLine('touch', false)).toBe('DRAG MOVE - PARRY - DASH');
    expect(cardLines('touch', false).join(' ')).not.toMatch(/DRAG|SECOND FINGER/);
    expect(cardLines('touch', false, false).join(' ')).toMatch(/DRAG ANYWHERE.*SECOND FINGER TAP = PARRY/);
  });
});
