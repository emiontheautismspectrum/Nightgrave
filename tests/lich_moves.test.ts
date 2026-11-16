/**
 * The Lich's new moves (FEATURES.bossMoves.lich, docs/FEATURES.md): soulfire and grasp. Enabled VARIANTS only.
 */
import { describe, expect, it } from 'vitest';
import { withFeatures } from '../src/data/features';
import { Sim } from '../src/sim/sim';
import type { BossPattern } from '../src/sim/state';
import { lichMostly } from './boss_tools';
import { mulberryInputs } from './scripted';

const L = withFeatures('bossMoves').bossMoves.lich;
const IDLE = { cursor: false, mx: 0, my: 0, buttons: 0 };

function lichFight(f: ReturnType<typeof lichMostly>, seed: number, d: 'easy' | 'medium' | 'hard', each: (sim: Sim) => void): Sim {
  const sim = new Sim(seed, d, { hero: seed % 2 ? 'knight' : 'wisp', features: f, startWave: 3, firstBoss: 'lich' });
  const frames = mulberryInputs(seed, 60 * 100);
  for (let i = 0; sim.state.bossesDefeated === 0 && i < 60 * 100; i++) {
    sim.state.alive = true;
    sim.step(frames[i]!);
    each(sim);
  }
  return sim;
}

describe('the lich: its table with the new moves', () => {
  it('block off: the old table and the old PRNG use; block on: the new moves join after the old ones', () => {
    const seen = (f: ReturnType<typeof lichMostly> | undefined): Set<BossPattern> => {
      const out = new Set<BossPattern>();
      for (let seed = 1; seed <= 6; seed++) lichFight(f ?? withFeatures(), seed, 'hard', (sim) => sim.state.events.forEach((e) => e.type === 'boss_attack' && out.add(e.pattern)));
      return out;
    };
    expect([...seen(undefined)].sort()).toEqual(['fan', 'triple', 'wraiths']);
    expect([...seen(withFeatures('bossMoves'))].sort()).toEqual(['fan', 'grasp', 'soulfire', 'triple', 'wraiths']);
  });
});

describe('soulfire', () => {
  for (const d of ['easy', 'hard'] as const)
    it(`${d}: one segment; <= ${L.soulfire.maxCount} violet orbs from where the Lich stood, over <= ${L.soulfire.durationSeconds} s, turned >= ${L.soulfire.gapRad} rad apart`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        let launch = -1;
        let origin: [number, number] = [0, 0];
        const shots: { t: number; ang: number }[] = [];
        let segments = 0;
        const sim = lichFight(lichMostly('soulfire'), seed, d, (x) => {
          const s = x.state;
          for (const e of s.events) {
            if (e.type === 'boss_segment') segments++;
            if (e.type === 'boss_attack' && e.pattern === 'soulfire' && launch < 0) {
              launch = s.tick - 1;
              origin = [s.boss!.x, s.boss!.y];
            }
            if (e.type === 'spawn' && launch >= 0 && s.boss && s.boss.serial === 1) {
              const pr = s.projectiles.find((q) => q.id === e.id)!;
              expect(pr.kind).toBe('orb_small');
              expect(pr.parryable).toBe(true);
              expect(pr.boss).toBe(1);
              shots.push({ t: s.tick - 1, ang: Math.atan2(pr.vy, pr.vx) });
              // from the launch spot (8 px out, or moved out to 60 px from the hero along its own line)
              const off = Math.abs((pr.x - origin[0]) * pr.vy - (pr.y - origin[1]) * pr.vx) / Math.hypot(pr.vx, pr.vy);
              expect(off).toBeLessThan(1e-6);
            }
          }
        });
        expect(sim.state.bossesDefeated).toBe(1);
        expect(segments).toBe(12);
        expect(shots.length).toBeGreaterThan(1);
        expect(shots.length).toBeLessThanOrEqual(L.soulfire.maxCount);
        expect(shots[shots.length - 1]!.t - shots[0]!.t).toBeLessThanOrEqual(L.soulfire.durationSeconds * 60);
        for (let i = 1; i < shots.length; i++) {
          const da = Math.abs(((shots[i]!.ang - shots[i - 1]!.ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          expect(da).toBeGreaterThanOrEqual(L.soulfire.gapRad - 1e-9);
        }
      }
    });
});

describe('grasp', () => {
  it('hands >= 90 px from the hero and 60 px apart, lit >= 0.75 s; each bursts into 6 red blades with one gap >= 0.5 rad near the hero, 0.3 s apart', () => {
    let hands = 0;
    for (let seed = 1; seed <= 16; seed++) {
      let pts: [number, number][] = [];
      let wind = 0;
      const bursts: { t: number; x: number; y: number }[] = [];
      lichFight(lichMostly('grasp'), seed, seed % 2 ? 'hard' : 'medium', (x) => {
        const s = x.state;
        const b = s.boss;
        const a = b?.attack;
        if (a && a.pattern === 'grasp' && a.windStart === s.tick - 1) {
          pts = a.points.map(([px, py]) => [px, py]);
          wind = a.fire - a.windStart;
          expect(wind).toBeGreaterThanOrEqual(Math.round(L.grasp.telegraphSeconds * 60));
          expect(pts.length).toBeGreaterThanOrEqual(1);
          expect(pts.length).toBeLessThanOrEqual(L.grasp.maxCount);
          for (const [px, py] of pts) {
            expect(Math.hypot(px - s.hero.x, py - s.hero.y)).toBeGreaterThanOrEqual(L.grasp.minHeroDist);
            expect(px >= 48 + L.grasp.edgeInset && px <= 432 - L.grasp.edgeInset).toBe(true);
          }
          for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1])).toBeGreaterThanOrEqual(L.grasp.spacingPx);
          hands += pts.length;
        }
        for (const e of s.events) {
          if (e.type !== 'boss_grasp') continue;
          bursts.push({ t: s.tick - 1, x: e.x, y: e.y });
          const blades = s.projectiles.filter((pr) => pr.kind === 'blade' && pr.born === s.tick - 1 && Math.hypot(pr.x - e.x, pr.y - e.y) < 6);
          expect(blades.length).toBe(L.grasp.blades);
          for (const bl of blades) expect(bl.parryable).toBe(false);
          // one gap: the largest angle between neighbours, wider than the others, centred within gapAimRad of the hero
          const ang = blades.map((bl) => Math.atan2(bl.vy, bl.vx)).sort((u, v) => u - v);
          const gaps = ang.map((a0, i) => (i + 1 < ang.length ? ang[i + 1]! - a0 : ang[0]! + 2 * Math.PI - a0));
          const big = Math.max(...gaps);
          expect(big).toBeGreaterThanOrEqual(L.grasp.gapRad);
          expect(gaps.filter((g) => g > big - 1e-6).length).toBe(1);
          const i = gaps.indexOf(big);
          const mid = ang[i]! + big / 2;
          const hero = Math.atan2(s.hero.y - e.y, s.hero.x - e.x);
          expect(Math.abs(((mid - hero + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThanOrEqual(L.grasp.gapAimRad + 1e-6);
        }
      });
      for (let i = 1; i < bursts.length; i++)
        if (bursts[i]!.t - bursts[i - 1]!.t < 60) expect(bursts[i]!.t - bursts[i - 1]!.t).toBe(Math.round(L.grasp.staggerSeconds * 60));
    }
    expect(hands).toBeGreaterThan(30);
  });
});

void IDLE;
