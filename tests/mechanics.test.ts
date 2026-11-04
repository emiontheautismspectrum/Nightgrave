import { describe, expect, it } from 'vitest';
import { BTN_DASH, BTN_PARRY, NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { NEVER } from '../src/sim/state';
import {
  dashCooldownLeft,
  isDashing,
  isInvulnerable,
  isParryActive,
  score,
  Sim,
  spawnProjectile,
} from '../src/sim/sim';

const idle = (): InputFrame => ({ ...NEUTRAL_INPUT });
const press = (buttons: number): InputFrame => ({ ...NEUTRAL_INPUT, buttons });
const quiet = () => new Sim(1, 'medium', { spawner: false });

/** Put a motionless orb at distance d to the right of the hero. */
function orbAt(sim: Sim, d: number, kind: 'orb_small' | 'orb_large' = 'orb_small') {
  const h = sim.state.hero;
  return spawnProjectile(sim.state, sim.params, kind, h.x + d, h.y, 0, 0);
}

describe('parry', () => {
  it('destroys an orb exactly on the boundary (dist == parryRadius + orbRadius)', () => {
    const sim = quiet();
    orbAt(sim, sim.params.parryRadius + sim.params.smallRadius);
    sim.step(press(BTN_PARRY));
    expect(sim.state.projectiles).toHaveLength(0);
    expect(sim.state.parryCount).toBe(1);
  });

  it('does not touch an orb just outside the boundary', () => {
    const sim = quiet();
    orbAt(sim, sim.params.parryRadius + sim.params.smallRadius + 0.001);
    sim.step(press(BTN_PARRY));
    expect(sim.state.projectiles).toHaveLength(1);
  });

  it('is active for exactly parryActive ticks', () => {
    const sim = quiet();
    const p = sim.params;
    sim.step(press(BTN_PARRY));
    for (let i = 1; i < p.parryActive - 1; i++) sim.step(idle());
    // ticks 0 .. parryActive-1 are active: the next tick is the last active one
    orbAt(sim, p.parryRadius);
    sim.step(idle());
    expect(sim.state.projectiles).toHaveLength(0);
    orbAt(sim, p.parryRadius);
    sim.step(idle());
    expect(sim.state.projectiles).toHaveLength(1);
  });

  it('respects the cooldown; a press inside the buffer window fires as soon as it is ready', () => {
    const sim = quiet();
    const p = sim.params;
    sim.step(press(BTN_PARRY)); // tick 0
    const start0 = sim.state.hero.parryStart;
    // advance to just before the buffer window opens, press there -> too early, dropped
    while (sim.state.tick < p.parryCooldown - p.parryBuffer - 1) sim.step(idle());
    sim.step(press(BTN_PARRY));
    while (sim.state.tick <= p.parryCooldown) sim.step(idle());
    expect(sim.state.hero.parryStart).toBe(start0);
    // press inside the buffer window -> fires exactly when the cooldown ends
    const sim2 = quiet();
    sim2.step(press(BTN_PARRY));
    while (sim2.state.tick < p.parryCooldown - p.parryBuffer) sim2.step(idle());
    sim2.step(press(BTN_PARRY));
    while (sim2.state.tick <= p.parryCooldown) sim2.step(idle());
    expect(sim2.state.hero.parryStart).toBe(p.parryCooldown);
  });

  it('beats a lethal orb overlapping the hero on the same tick', () => {
    const sim = quiet();
    orbAt(sim, 0);
    sim.step(press(BTN_PARRY));
    expect(sim.state.alive).toBe(true);
    expect(sim.state.parryCount).toBe(1);
  });

  it('scores 25 x multiplier, steps +0.25, caps at x5 and resets after 5 s idle', () => {
    const sim = quiet();
    const p = sim.params;
    let expected = 0;
    for (let i = 0; i < 20; i++) {
      // wait out the cooldown, then parry an orb
      while (sim.state.tick - sim.state.hero.parryStart < p.parryCooldown) sim.step(idle());
      const mult = sim.state.multiplier;
      expected += p.parryBase * mult;
      orbAt(sim, 5);
      sim.step(press(BTN_PARRY));
      expect(sim.state.parryScoreHundredths).toBe(expected);
    }
    expect(sim.state.multiplier).toBe(p.multCap);
    const last = sim.state.lastParryTick;
    while (sim.state.tick < last + p.multReset - 1) sim.step(idle());
    sim.step(idle());
    expect(sim.state.multiplier).toBe(p.multCap); // tick last+reset-1: still kept
    sim.step(idle());
    expect(sim.state.multiplier).toBe(p.multStart); // tick last+reset: reset
  });
});

describe('dash', () => {
  it('moves dash distance in the intended direction over dashTicks ticks', () => {
    const sim = quiet();
    const p = sim.params;
    const x0 = sim.state.hero.x;
    sim.step({ cursor: false, mx: 100, my: 0, buttons: BTN_DASH });
    for (let i = 1; i < p.dashTicks; i++) sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
    expect(sim.state.hero.x - x0).toBeCloseTo(80, 6);
    expect(isDashing(sim.state, p)).toBe(false);
  });

  it('is invulnerable for exactly dashInvuln ticks, then one hit kills', () => {
    const sim = quiet();
    const p = sim.params;
    sim.step(press(BTN_DASH)); // dashes right (default facing)
    // keep an orb glued to the hero every tick of the invulnerability window
    for (let i = 1; i < p.dashInvuln; i++) {
      orbAt(sim, 0);
      sim.step(idle());
      expect(sim.state.alive).toBe(true);
      sim.state.projectiles = [];
    }
    expect(isInvulnerable(sim.state, p)).toBe(false);
    orbAt(sim, 0);
    sim.step(idle());
    expect(sim.state.alive).toBe(false);
  });

  it('cannot dash again before the cooldown', () => {
    const sim = quiet();
    const p = sim.params;
    sim.step(press(BTN_DASH));
    const first = sim.state.hero.dashStart;
    while (sim.state.tick < p.dashCooldown - p.dashBuffer - 1) sim.step(press(BTN_DASH));
    expect(sim.state.hero.dashStart).toBe(first);
    expect(dashCooldownLeft(sim.state, p)).toBeGreaterThan(0);
    while (sim.state.tick <= p.dashCooldown) sim.step(press(BTN_DASH));
    expect(sim.state.hero.dashStart).toBe(p.dashCooldown);
  });

  it('stays inside the arena when dashing into a wall', () => {
    const sim = quiet();
    const p = sim.params;
    for (let i = 0; i < 200; i++) sim.step({ cursor: false, mx: -100, my: 0, buttons: i === 150 ? BTN_DASH : 0 });
    expect(sim.state.hero.x).toBe(p.heroMargin);
  });
});

describe('death and scoring', () => {
  it('one hit kills; after death the sim is frozen and score stops', () => {
    const sim = quiet();
    for (let i = 0; i < 120; i++) sim.step(idle());
    const before = sim.score;
    expect(before).toBe(20); // 2 s x 10 pts/s
    orbAt(sim, 0);
    sim.step(idle());
    expect(sim.state.alive).toBe(false);
    const frozen = JSON.stringify(sim.state.hero);
    for (let i = 0; i < 100; i++) sim.step({ cursor: true, mx: 0, my: 0, buttons: 3 });
    expect(sim.score).toBe(before);
    expect(JSON.stringify(sim.state.hero)).toBe(frozen);
    expect(score(sim.state, sim.params)).toBe(before);
  });

  it('a hit at exactly heroRadius + orbRadius does not kill (strict), closer does', () => {
    const sim = quiet();
    const p = sim.params;
    orbAt(sim, p.heroRadius + p.smallRadius);
    sim.step(idle());
    expect(sim.state.alive).toBe(true);
    sim.state.projectiles = [];
    orbAt(sim, p.heroRadius + p.smallRadius - 0.01);
    sim.step(idle());
    expect(sim.state.alive).toBe(false);
  });
});

describe('input handling', () => {
  it('cursor movement is capped at heroSpeed per tick and snaps onto the target', () => {
    const sim = quiet();
    const p = sim.params;
    const { x, y } = sim.state.hero;
    sim.step({ cursor: true, mx: x + 100, my: y, buttons: 0 });
    expect(sim.state.hero.x - x).toBeCloseTo(p.heroSpeed, 9);
    const s2 = quiet();
    s2.step({ cursor: true, mx: x + 1, my: y, buttons: 0 });
    expect(s2.state.hero.x).toBe(x + 1);
  });

  it('garbage input never produces NaN or leaves the arena', () => {
    const sim = quiet();
    const p = sim.params;
    const junk: unknown[] = [
      { cursor: true, mx: NaN, my: Infinity, buttons: -1 },
      { cursor: true, mx: 1e300, my: -1e300, buttons: 1e9 },
      { cursor: false, mx: 1e9, my: -1e9, buttons: 0.5 },
      { cursor: 'yes', mx: '12', my: null, buttons: {} },
      null,
      undefined,
      42,
    ];
    for (let i = 0; i < 300; i++) sim.step(junk[i % junk.length] as InputFrame);
    const h = sim.state.hero;
    for (const v of [h.x, h.y, h.dirX, h.dirY]) expect(Number.isFinite(v)).toBe(true);
    expect(h.x).toBeGreaterThanOrEqual(p.heroMargin);
    expect(h.x).toBeLessThanOrEqual(p.arenaW - p.heroMargin);
    expect(h.y).toBeGreaterThanOrEqual(p.heroMargin);
    expect(h.y).toBeLessThanOrEqual(p.arenaH - p.heroMargin);
  });

  it('diagonal axis input is normalised (no faster diagonal movement)', () => {
    const sim = quiet();
    const { x, y } = sim.state.hero;
    sim.step({ cursor: false, mx: 100, my: 100, buttons: 0 });
    const d = Math.sqrt((sim.state.hero.x - x) ** 2 + (sim.state.hero.y - y) ** 2);
    expect(d).toBeCloseTo(sim.params.heroSpeed, 9);
  });

  it('starts with nothing active', () => {
    const sim = quiet();
    expect(sim.state.hero.parryStart).toBe(NEVER);
    expect(isParryActive(sim.state, sim.params)).toBe(false);
    expect(isDashing(sim.state, sim.params)).toBe(false);
  });
});
