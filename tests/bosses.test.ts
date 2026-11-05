import { describe, expect, it } from 'vitest';
import { TUNING, type Difficulty } from '../src/data/tuning';
import { isBossWave } from '../src/sim/boss';
import { makeParams, type SimParams } from '../src/sim/params';
import { pickupSpotOk } from '../src/sim/pickups';
import { encodeReplay, playReplay } from '../src/sim/replay';
import { createState, parryActiveTicks, score, Sim, spawnProjectile, step } from '../src/sim/sim';
import type { SimState } from '../src/sim/state';
import { botInput } from './bot';
import { mulberryInputs } from './scripted';

const EYE_WAVE = 3;
const LICH_WAVE = 7;
const idle = { cursor: false, mx: 0, my: 0, buttons: 0 };

/** Run one boss fight with the parry bot; calls `each` after every tick. */
function fight(seed: number, wave: number, d: Difficulty = 'easy', each?: (sim: Sim) => void, parry = true): Sim {
  const sim = new Sim(seed, d, { startWave: wave });
  while (sim.state.alive && sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 90) {
    sim.step(botInput(sim, { parry }));
    each?.(sim);
  }
  return sim;
}

describe('boss schedule', () => {
  it('every 4th wave is a boss wave, alternating eye and lich', () => {
    const p = makeParams('medium');
    expect([0, 1, 2, 3, 4, 5, 6, 7, 11].map((w) => isBossWave(p, w))).toEqual([false, false, false, true, false, false, false, true, true]);
    const a = new Sim(1, 'easy', { startWave: EYE_WAVE });
    const b = new Sim(1, 'easy', { startWave: LICH_WAVE });
    for (let i = 0; i < 70; i++) {
      a.step(idle);
      b.step(idle);
    }
    expect(a.state.boss?.kind).toBe('eye');
    expect(b.state.boss?.kind).toBe('lich');
    expect(a.state.boss?.segments).toBe(TUNING.bosses.eye.segments);
  });

  it('a normal run reaches the first boss after 3 waves; wave timer pauses; break, then the next wave', () => {
    const sim = new Sim(3, 'easy');
    const p = sim.params;
    let bossAt = -1;
    let defeatAt = -1;
    let waveAfter = -1;
    const caster0: number[] = [];
    while (sim.state.alive && sim.state.tick < 60 * 140 && waveAfter < 0) {
      sim.step(botInput(sim));
      for (const e of sim.state.events) {
        if (e.type === 'boss_intro') bossAt = sim.state.tick - 1;
        if (e.type === 'boss_defeated') defeatAt = sim.state.tick - 1;
        if (e.type === 'wave' && defeatAt >= 0) waveAfter = sim.state.tick - 1;
        if (e.type === 'caster' && bossAt >= 0 && defeatAt < 0) caster0.push(sim.state.tick);
      }
    }
    expect(bossAt).toBe(p.graceTicks + 3 * p.waveTicks);
    expect(caster0).toEqual([]); // no casters summoned during the fight
    if (defeatAt >= 0 && waveAfter >= 0) {
      expect(waveAfter - defeatAt).toBe(Math.round(TUNING.bosses.breakSeconds * 60));
      expect(sim.state.wave).toBe(4);
    }
  });
});

describe('segments and defeat', () => {
  for (const [name, wave] of [['eye', EYE_WAVE], ['lich', LICH_WAVE]] as const) {
    it(`${name}: exactly one segment per launched attack, on 100 seeds; ends only after the final attack is gone`, () => {
      let finished = 0;
      for (let seed = 1; seed <= 100; seed++) {
        let prev = -1;
        let attacks = 0;
        let lastLaunch = -1;
        let finalSerial = 0;
        let defeated = -1;
        let bad = '';
        const sim = fight(seed, wave, 'easy', (s) => {
          const st = s.state;
          for (const e of st.events) {
            if (e.type === 'boss_attack') {
              attacks++;
              if (prev < 0) prev = st.boss!.segments;
              if (e.remaining !== prev - 1) bad = `segment jump ${prev} -> ${e.remaining}`;
              prev = e.remaining;
              lastLaunch = st.tick - 1;
              finalSerial = st.boss?.serial ?? -1;
            }
            if (e.type === 'boss_defeated') {
              defeated = st.tick - 1;
              if (st.projectiles.some((pr) => pr.boss === finalSerial) || st.beams.some((b) => b.serial === finalSerial))
                bad = 'defeated with the final attack still alive';
            }
          }
          if (st.events.filter((e) => e.type === 'boss_attack').length > 1) bad = 'two attacks in one tick';
        });
        expect(bad).toBe('');
        if (defeated >= 0) {
          finished++;
          expect(attacks).toBe(sim.state.boss?.segments ?? TUNING.bosses[name].segments);
          expect(defeated).toBeGreaterThan(lastLaunch);
          expect(sim.state.bossScore).toBe(TUNING.bosses.killScore);
        } else {
          expect(sim.state.bossesDefeated).toBe(0);
          expect(sim.state.bossScore).toBe(0);
        }
      }
      expect(finished).toBeGreaterThan(80);
    });
  }

  it('the last attack must still be survived: a lingering final projectile delays the defeat', () => {
    const p = makeParams('easy');
    const s = createState(5, 'easy', p);
    const opts = { startWave: EYE_WAVE };
    while (!s.boss) step(s, idle, p, opts);
    const b = s.boss!;
    b.remaining = 1;
    b.nextAt = b.introEnd;
    while (s.boss && s.boss.serial === 0 && s.alive) step(s, idle, p, opts);
    // the final attack has launched: park one of its projectiles far from the hero, frozen
    s.projectiles = s.projectiles.filter((pr) => pr.boss === 0);
    s.beams = [];
    const pr = spawnProjectile(s, p, 'orb_small', 60, 230, 0, 0, { boss: b.serial });
    s.hero.x = 400;
    s.hero.y = 60;
    for (let i = 0; i < 600; i++) step(s, idle, p, opts);
    expect(s.bossesDefeated).toBe(0);
    s.projectiles = s.projectiles.filter((q) => q.id !== pr.id);
    step(s, idle, p, opts);
    expect(s.bossesDefeated).toBe(1);
    const before = s.bossScore;
    for (let i = 0; i < 300; i++) step(s, idle, p, opts);
    expect(s.bossScore).toBe(before); // +1000 exactly once
    expect(before).toBe(1000);
  });

  it('+1000 is not affected by the multiplier or Double Score', () => {
    const p = makeParams('easy');
    const s = createState(8, 'easy', p);
    const opts = { startWave: EYE_WAVE };
    while (!s.boss) step(s, idle, p, opts);
    s.boss!.remaining = 0; // empty bar, nothing in flight
    s.multiplier = p.multCap;
    s.doubleUntil = s.tick + 10_000;
    s.hero.x = 400;
    s.hero.y = 200;
    const before = score(s, p);
    const survivalBefore = s.survivalTicks + s.doubleTicks;
    step(s, idle, p, opts);
    expect(s.bossesDefeated).toBe(1);
    const survivalDelta = Math.floor(((s.survivalTicks + s.doubleTicks) * 10) / 60) - Math.floor((survivalBefore * 10) / 60);
    expect(score(s, p) - before - survivalDelta).toBe(1000);
  });
});

describe('ember charge', () => {
  it('stacks per boss kill and caps', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p);
    const base = parryActiveTicks(s, p);
    const capTicks = Math.max(1, Math.round((TUNING.parry.activeSeconds + TUNING.emberCharge.capSeconds) * 60));
    const seen: number[] = [];
    for (let n = 0; n <= 10; n++) {
      s.emberCharges = n;
      seen.push(parryActiveTicks(s, p));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[1]!).toBeGreaterThan(base);
    expect(seen[10]).toBe(capTicks);
    expect(seen[4]).toBe(capTicks);
  });

  it('a defeated boss grants one charge and a longer parry window', () => {
    const sim = fight(2, EYE_WAVE);
    expect(sim.state.bossesDefeated).toBe(1);
    expect(sim.state.emberCharges).toBe(1);
    expect(parryActiveTicks(sim.state, sim.params)).toBeGreaterThan(sim.params.parryActive);
  });
});

describe('reflect bonus', () => {
  function parryBossShot(bonus: number): SimState {
    const base = makeParams('easy');
    const p: SimParams = { ...base, bosses: { ...base.bosses, reflectBonusSegments: bonus } };
    const s = createState(4, 'easy', p);
    const opts = { startWave: EYE_WAVE };
    while (!s.boss) step(s, idle, p, opts);
    s.boss!.serial = 1;
    s.boss!.remaining = 9;
    s.hero.x = 300;
    s.hero.y = 180;
    spawnProjectile(s, p, 'orb_small', 310, 180, 0, 0, { boss: 1 });
    step(s, { cursor: false, mx: 0, my: 0, buttons: 1 }, p, opts);
    return s;
  }
  it('default 0 = off', () => {
    expect(TUNING.bosses.reflectBonusSegments).toBe(0);
    const s = parryBossShot(0);
    expect(s.parryCount).toBe(1);
    expect(s.boss!.remaining).toBe(9);
  });
  it('non-zero: a parried boss projectile removes extra segments (never below 0)', () => {
    const s = parryBossShot(2);
    expect(s.parryCount).toBe(1);
    expect(s.boss!.remaining).toBe(7);
    const s2 = parryBossShot(20);
    expect(s2.boss!.remaining).toBe(0);
  });
});

describe('pickups', () => {
  it('Slow Time slows projectiles only (hero, beams and timers keep their pace)', () => {
    const p = makeParams('medium');
    const a = createState(1, 'medium', p);
    const b = createState(1, 'medium', p);
    b.slowUntil = 1_000_000;
    for (const s of [a, b]) {
      spawnProjectile(s, p, 'orb_small', 100, 100, 1, 0);
      spawnProjectile(s, p, 'wraith', 100, 200, 0.5, 0, { expires: 30, fadeEnd: 40 });
      s.beams.push({ serial: 1, x: 240, y: 62, dirX: 1, dirY: 0, turnC: 0.999, turnS: 0.0447, start: 0, end: 1000, halfWidth: 2, length: 10 });
    }
    const input = { cursor: true, mx: 400, my: 135, buttons: 0 };
    step(a, input, p, { spawner: false });
    step(b, input, p, { spawner: false });
    expect(b.projectiles[0]!.x - 100).toBeCloseTo((a.projectiles[0]!.x - 100) * TUNING.pickups.slowTime.factor, 9);
    expect(b.hero.x).toBe(a.hero.x);
    expect(b.projectiles[1]!.expires).toBe(a.projectiles[1]!.expires);
    for (let i = 0; i < 45; i++) {
      step(a, idle, p, { spawner: false });
      step(b, idle, p, { spawner: false });
    }
    expect(b.projectiles.length).toBe(a.projectiles.length); // the wraith faded at the same tick
  });

  it('spawn rules hold over long bot runs (incl. boss fights); refresh, never stack', () => {
    let spawns = 0;
    let takes = 0;
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      for (let seed = 1; seed <= 12; seed++) {
        const sim = new Sim(seed, d, { startWave: seed % 2 ? EYE_WAVE - 1 : 0 });
        const p = sim.params;
        while (sim.state.alive && sim.state.tick < 60 * 120) {
          const before = { slow: sim.state.slowUntil, dbl: sim.state.doubleUntil };
          sim.step(botInput(sim));
          const st = sim.state;
          for (const e of st.events) {
            if (e.type === 'pickup_spawn') {
              spawns++;
              const pk = st.pickup!;
              const t = st.tick - 1;
              expect(pk.born).toBe(t);
              expect(pk.expires - pk.born).toBe(TUNING.pickups.lifeSeconds * 60);
              expect(Math.hypot(pk.x - st.hero.x, pk.y - st.hero.y)).toBeGreaterThanOrEqual(TUNING.pickups.minHeroDist - p.heroSpeed - 1e-9);
              expect(pickupSpotOk({ ...st, hero: { ...st.hero, x: -999, y: -999 } }, p, pk.x, pk.y)).toBe(true);
              if (st.boss) expect(st.boss.remaining).toBeGreaterThan(TUNING.bosses.pickupBlockSegments);
            }
            if (e.type === 'pickup_take') {
              takes++;
              const t = st.tick - 1;
              const until = e.kind === 'slow' ? st.slowUntil : st.doubleUntil;
              const secs = e.kind === 'slow' ? TUNING.pickups.slowTime.seconds : TUNING.pickups.doubleScore.seconds;
              expect(until).toBe(t + secs * 60); // refreshed from now, not added to the old timer
              void before;
            }
          }
          expect(st.pickup === null || st.pickup.expires > st.tick - 1).toBe(true);
        }
      }
    expect(spawns).toBeGreaterThan(20);
    expect(takes).toBeGreaterThanOrEqual(0);
  });

  it('taking the same pickup twice refreshes the timer instead of stacking', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p);
    s.tick = 100;
    s.pickupAt = 1e9;
    s.pickup = { id: 1, kind: 'slow', x: s.hero.x, y: s.hero.y, born: 100, expires: 800 };
    step(s, idle, p);
    const first = s.slowUntil;
    for (let i = 0; i < 60; i++) step(s, idle, p);
    s.pickup = { id: 2, kind: 'slow', x: s.hero.x, y: s.hero.y, born: s.tick, expires: s.tick + 700 };
    const t = s.tick;
    step(s, idle, p);
    expect(first).toBe(100 + 360);
    expect(s.slowUntil).toBe(t + 360);
    expect(s.pickupScore).toBe(2 * TUNING.pickups.points);
  });

  it('Double Score doubles survival and parry points while active', () => {
    const p = makeParams('easy');
    const a = createState(1, 'easy', p);
    const b = createState(1, 'easy', p);
    b.doubleUntil = 1_000_000;
    for (let i = 0; i < 600; i++) {
      step(a, idle, p, { spawner: false });
      step(b, idle, p, { spawner: false });
    }
    expect(score(b, p)).toBe(2 * score(a, p));
  });
});

describe('boss fairness fuzz', () => {
  for (const [name, wave] of [['eye', EYE_WAVE], ['lich', LICH_WAVE]] as const)
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      it(`${name} ${d}: wind-up >= 15 ticks, no boss shot within 60 px, no attack in the intro; lich teleports >= 80 px away`, () => {
        for (let seed = 1; seed <= 25; seed++) {
          let windStart = -1;
          const sim = fight(seed, wave, d, (s) => {
            const st = s.state;
            const b = st.boss;
            if (b?.attack && windStart < 0 && st.tick - 1 >= b.attack.windStart) windStart = b.attack.windStart;
            for (const e of st.events) {
              if (e.type === 'boss_attack') {
                const t = st.tick - 1;
                expect(t - windStart).toBeGreaterThanOrEqual(15);
                expect(t).toBeGreaterThanOrEqual(b!.introEnd);
                windStart = -1;
              }
              if (e.type === 'spawn' && st.projectiles.find((q) => q.id === e.id)?.boss) {
                expect(e.dist).toBeGreaterThanOrEqual(60);
                expect(e.telegraphTicks).toBeGreaterThanOrEqual(15);
              }
              if (e.type === 'boss_teleport') expect(Math.hypot(e.x - st.hero.x, e.y - st.hero.y)).toBeGreaterThanOrEqual(80 - s.params.heroSpeed);
            }
            for (const bm of st.beams) {
              // the beam sweeps at most 60 deg/s and at most sweepDeg in total: the rest of the circle stays safe
              expect(Math.acos(Math.min(1, bm.turnC)) * 60 * (180 / Math.PI)).toBeLessThanOrEqual(60 + 1e-6);
              expect(((bm.end - bm.start) / 60) * TUNING.bosses.eye.beam.degPerSecond).toBeLessThanOrEqual(TUNING.bosses.eye.beam.sweepDeg + 1);
            }
          });
          expect(sim.state.tick).toBeGreaterThan(0);
        }
      });
});

describe('determinism with bosses and pickups', () => {
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
    it(`${d}: same seed + inputs => identical state; replay reproduces the score`, () => {
      for (const seed of [11, 202]) {
        const frames = mulberryInputs(seed, 60 * 75);
        const run = () => {
          const sim = new Sim(seed, d, { startWave: EYE_WAVE });
          for (const f of frames) sim.step(f);
          return sim;
        };
        const a = run();
        const b = run();
        expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
        // a bot run through the first real boss (no test options) replays exactly
        const live = new Sim(seed, d);
        while (live.state.alive && live.state.tick < 60 * 110) live.step(botInput(live));
        const replayed = playReplay(JSON.parse(JSON.stringify(encodeReplay(seed, d, live.log))));
        expect(replayed.score).toBe(live.score);
        expect(replayed.state.bossesDefeated).toBe(live.state.bossesDefeated);
      }
    });
});
