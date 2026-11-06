/**
 * Multiplier fix: every successful pulse steps the multiplier, a PERFECT parry (a destroyed projectile whose edge is
 * within parryRadius * parryCloseFrac) steps it once more; cap, 3 s reset, cracks and whiffs; Double Score; and the
 * survival of the bots is exactly what it was before the change (scoring only).
 */
import { describe, expect, it } from 'vitest';
import { BTN_PARRY, NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { Sim, spawnProjectile } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/state';
import { TUNING } from '../src/data/tuning';
import { maxPossibleScore } from '../src/shared/maxScore';
import { botInput } from './bot';
import { SkilledBot } from './skilled';

const idle = (): InputFrame => ({ ...NEUTRAL_INPUT });
const parry = (): InputFrame => ({ ...NEUTRAL_INPUT, buttons: BTN_PARRY });
const fresh = () => {
  const sim = new Sim(1, 'medium', { spawner: false });
  return { sim, p: sim.params, h: sim.state.hero };
};
/** An orb at rest whose EDGE is `edge` px from the hero centre (to the right). */
const orbAt = (sim: Sim, edge: number, kind: 'orb_small' | 'orb_armored' = 'orb_small') => {
  const r = kind === 'orb_small' ? sim.params.smallRadius : TUNING.newThreats.armored.radius;
  return spawnProjectile(sim.state, sim.params, kind, sim.state.hero.x + edge + r, sim.state.hero.y, 0, 0);
};
const events = (sim: Sim, f: InputFrame): SimEvent[] => (sim.step(f), [...sim.state.events]);
const wait = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) sim.step(idle()); };

describe('multiplier rule', () => {
  it('every successful pulse steps once; a non-perfect kill scores at the old multiplier, +1 step', () => {
    const { sim, p } = fresh();
    orbAt(sim, p.parryRadius - 1); // inside the pulse, outside the perfect zone
    const ev = events(sim, parry());
    expect(sim.state.multiplier).toBe(p.multStart + p.multStep);
    expect(sim.state.parryScoreHundredths).toBe(p.parryBase * p.multStart);
    const hit = ev.find((e) => e.type === 'parry_hit');
    expect(hit).toMatchObject({ perfect: false, multiplier: 1, multAfter: (p.multStart + p.multStep) / 100 });
    expect(ev.filter((e) => e.type === 'mult_step')).toEqual([expect.objectContaining({ multiplier: 1.25, perfect: false })]);
  });

  it('a PERFECT kill (edge within radius * closeFraction) steps twice and says so', () => {
    const { sim, p } = fresh();
    orbAt(sim, p.parryRadius * p.parryCloseFrac - 0.01);
    const ev = events(sim, parry());
    expect(sim.state.multiplier).toBe(p.multStart + 2 * p.multStep);
    expect(ev.find((e) => e.type === 'parry_hit')).toMatchObject({ perfect: true, multAfter: 1.5 });
    expect(ev.filter((e) => e.type === 'mult_step')).toEqual([expect.objectContaining({ multiplier: 1.5, perfect: true })]);
    // just outside the perfect edge: one step only
    const b = fresh();
    orbAt(b.sim, b.p.parryRadius * b.p.parryCloseFrac + 0.01);
    b.sim.step(parry());
    expect(b.sim.state.multiplier).toBe(b.p.multStart + b.p.multStep);
  });

  it('several kills in one pulse: one step plus at most one PERFECT extra; extras score at the stepped multiplier', () => {
    const { sim, p, h } = fresh();
    for (let k = 0; k < 16; k++) spawnProjectile(sim.state, p, 'rune_shard', h.x + 3, h.y, 0, 0); // all perfect
    const ev = events(sim, parry());
    expect(sim.state.parryCount).toBe(1);
    expect(sim.state.multiplier).toBe(p.multStart + 2 * p.multStep);
    expect(ev.filter((e) => e.type === 'mult_step')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'parry_hit' && e.perfect)).toHaveLength(1);
    expect(sim.state.parryScoreHundredths).toBe(p.parryBase * p.multStart + (p.parryMaxKills - 1) * p.extraKillPoints * (p.multStart + 2 * p.multStep));
  });

  it('a pulse that cracks an armored orb and destroys a normal one is successful; a crack alone is not', () => {
    const a = fresh();
    orbAt(a.sim, 2, 'orb_armored');
    orbAt(a.sim, a.p.parryRadius - 1);
    a.sim.step(parry());
    expect(a.sim.state.parryCount).toBe(1);
    expect(a.sim.state.multiplier).toBe(a.p.multStart + a.p.multStep); // one step: the destroyed orb is not perfect
    const b = fresh();
    b.sim.state.multiplier = 300;
    b.sim.state.lastParryTick = -1;
    orbAt(b.sim, 2, 'orb_armored');
    b.sim.step(parry());
    expect(b.sim.state.parryCount).toBe(0);
    expect(b.sim.state.multiplier).toBe(300);
    expect(b.sim.state.lastParryTick).toBe(-1); // the reset timer is not refreshed by a crack
  });

  it('a far kill on the first tick and a PERFECT kill later in the same pulse: one step each, one parry', () => {
    const { sim, p, h } = fresh();
    orbAt(sim, p.parryRadius - 2); // inside the pulse, not perfect
    // an orb closing in at 7 px per tick: outside the reach on tick 1, perfect on tick 2 (the pulse is still active)
    spawnProjectile(sim.state, p, 'orb_small', h.x - (30 + p.smallRadius), h.y, 7, 0);
    const ev: SimEvent[] = [...events(sim, parry())];
    expect(sim.state.multiplier).toBe(p.multStart + p.multStep);
    for (let i = 0; i < 3; i++) ev.push(...events(sim, idle()));
    expect(sim.state.parryCount).toBe(1);
    expect(sim.state.multiplier).toBe(p.multStart + 2 * p.multStep);
    expect(ev.filter((e) => e.type === 'mult_step').map((e) => (e as { perfect: boolean }).perfect)).toEqual([false, true]);
  });

  it('a split orb parried PERFECT: one step + the extra; its children cannot be parried by the same pulse', () => {
    const { sim, p, h } = fresh();
    spawnProjectile(sim.state, p, 'orb_split', h.x + 6, h.y, 0, 0);
    sim.step(parry());
    const kids = sim.state.projectiles.length;
    expect(kids).toBe(TUNING.newThreats.split.children);
    for (let i = 0; i < 4; i++) sim.step(idle()); // the rest of the active window
    expect(sim.state.parryCount).toBe(1);
    expect(sim.state.multiplier).toBe(p.multStart + 2 * p.multStep);
    expect(sim.state.projectiles.length).toBeGreaterThan(0); // the children were not destroyed by the parent's pulse
  });

  it('never exceeds the cap', () => {
    const { sim, p } = fresh();
    sim.state.multiplier = p.multCap - p.multStep;
    orbAt(sim, 0);
    const ev = events(sim, parry());
    expect(sim.state.multiplier).toBe(p.multCap);
    expect(ev.find((e) => e.type === 'mult_step')).toMatchObject({ multiplier: p.multCap / 100 });
    wait(sim, p.parryCooldown + 1);
    orbAt(sim, 0);
    sim.step(parry());
    expect(sim.state.multiplier).toBe(p.multCap);
  });

  it('resets resetSeconds after the last successful pulse (one mult_reset event); a whiff neither steps nor refreshes', () => {
    const { sim, p } = fresh();
    orbAt(sim, p.parryRadius - 1);
    sim.step(parry());
    const last = sim.state.lastParryTick;
    const m = sim.state.multiplier;
    wait(sim, p.parryCooldown + 1);
    sim.step(parry()); // a whiff
    expect(sim.state.multiplier).toBe(m);
    expect(sim.state.lastParryTick).toBe(last);
    const resets: SimEvent[] = [];
    while (sim.state.tick < last + p.multReset + 5) resets.push(...events(sim, idle()));
    expect(sim.state.multiplier).toBe(p.multStart);
    expect(resets.filter((e) => e.type === 'mult_reset')).toHaveLength(1);
  });

  it('Double Score: parry points exactly doubled, survival ticks count twice; the boss kill bonus is not doubled', () => {
    const a = fresh();
    const b = fresh();
    b.sim.state.doubleUntil = 1e9;
    for (const x of [a, b]) {
      orbAt(x.sim, x.p.parryRadius - 1);
      x.sim.step(parry());
      wait(x.sim, 119);
    }
    expect(b.sim.state.parryScoreHundredths).toBe(2 * a.sim.state.parryScoreHundredths);
    expect(b.sim.state.doubleTicks).toBe(b.sim.state.survivalTicks);
    expect(a.sim.state.doubleTicks).toBe(0);
    // a boss fight on Easy with Double Score on all the time: the kill bonus stays the fixed killScore
    const sim = new Sim(5, 'easy', { startWave: 3 });
    while (sim.state.alive && sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 90) {
      sim.state.doubleUntil = sim.state.tick + 600;
      sim.step(botInput(sim, { parry: true }));
    }
    expect(sim.state.bossesDefeated).toBe(1);
    expect(sim.state.bossScore).toBe(TUNING.bosses.killScore);
  });
});

/** Survival ticks and a hero trajectory checksum per bot run, recorded from the code BEFORE the multiplier fix. */
const BEFORE: Record<string, number[]> = {"easy/skilled":[10585,-1994962313,12285,-242715971,11850,836593118,11091,-815031251],"easy/heuristic":[16411,1503772749,24079,252538903,11361,2037491374,27962,2051976745],"easy/dodge":[14590,667015937,2884,-1065874131,5719,-1932146648,9818,-1771053120],"medium/skilled":[11405,-1870853198,3133,731576017,18449,-923672606,3854,951380824],"medium/heuristic":[10316,-43313704,11884,137537794,11529,-1211903134,14478,-1821594766],"medium/dodge":[2921,1586580411,3133,-1973943087,6547,-340628965,10792,-2092445363],"hard/skilled":[5307,490669731,1216,-105474470,3011,-1895483426,1598,1984973053],"hard/heuristic":[5137,676071625,9635,225855451,8203,334714128,1634,938027538],"hard/dodge":[1167,1219101482,6436,-1179514845,5404,1228138308,656,-1186110566]};

describe('the multiplier fix changes the score only', () => {
  it('the same bots on the same seeds survive exactly as long, on exactly the same path', () => {
    for (const d of ['easy', 'medium', 'hard'] as const)
      for (const b of ['skilled', 'heuristic', 'dodge'] as const) {
        const arr: number[] = [];
        for (let seed = 1; seed <= 4; seed++) {
          const sim = new Sim(seed * 7919, d);
          const sk = new SkilledBot(seed, b !== 'dodge');
          let sum = 0;
          while (sim.state.alive && sim.state.tick < 60 * 600) {
            sim.step(b === 'heuristic' ? botInput(sim, { parry: true }) : sk.input(sim));
            sum = (Math.imul(sum, 31) + Math.round(sim.state.hero.x * 8) + Math.round(sim.state.hero.y * 8) * 4099) | 0;
          }
          arr.push(sim.state.survivalTicks, sum);
          // maxPossibleScore stays an upper bound for every bot run
          expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
        }
        expect(arr, `${d}/${b}`).toEqual(BEFORE[`${d}/${b}`]);
      }
  }, 120_000);
});
