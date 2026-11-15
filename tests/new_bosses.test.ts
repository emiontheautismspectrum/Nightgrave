/**
 * The new bosses (FEATURES.bosses, docs/FEATURES.md): the seeded boss order, bossMet per kind, the forced first boss of
 * the dev preview, and the score bound. Every test runs an enabled VARIANT (withFeatures); production stays dark.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TUNING } from '../src/data/tuning';
import { earliestBossDefeat, maxPossibleScore } from '../src/shared/maxScore';
import { bossCycle, bossKindFor, orderHash } from '../src/sim/boss';
import { makeParams } from '../src/sim/params';
import { encodeReplay } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import type { BossKind, SimState } from '../src/sim/state';
import { mulberryInputs } from './scripted';
import { botInput } from './bot';
import { onlyAttack } from './boss_tools';

const N = TUNING.bosses.everyNthWave;
const bossWave = (n: number): number => (n + 1) * N - 1;
const VARIANTS: [string, Features][] = [['thorn', withFeatures('thorn')], ['toller', withFeatures('toller')], ['both', withFeatures('bosses')]];
const idle = { cursor: false, mx: 0, my: 0, buttons: 0 };

describe('boss order', () => {
  it('with no new boss enabled: exactly the old alternation eye, lich, eye, ... for every seed', () => {
    const p = makeParams('hard', 'knight');
    expect(bossCycle(p)).toEqual(['eye', 'lich']);
    for (const seed of [0, 1, 7, 123456, 0xffffffff])
      for (let n = 0; n < 40; n++) expect(bossKindFor(p, bossWave(n), seed)).toBe(n % 2 === 0 ? 'eye' : 'lich');
  });

  for (const [name, f] of VARIANTS)
    it(`${name}: every cycle holds each enabled boss once; the same seed gives the same order; seeds differ`, () => {
      const p = makeParams('hard', 'wisp', f);
      const cyc = bossCycle(p);
      expect(cyc.length).toBe(name === 'both' ? 4 : 3);
      const orders = new Set<string>();
      const firsts = new Set<BossKind>();
      for (let seed = 1; seed <= 200; seed++) {
        const seq: BossKind[] = [];
        for (let n = 0; n < cyc.length * 6; n++) seq.push(bossKindFor(p, bossWave(n), seed));
        for (let c = 0; c < 6; c++) expect([...seq.slice(c * cyc.length, (c + 1) * cyc.length)].sort()).toEqual([...cyc].sort());
        // pure: the same (params, wave, seed) always gives the same kind
        for (let n = 0; n < seq.length; n++) expect(bossKindFor(p, bossWave(n), seed)).toBe(seq[n]);
        orders.add(seq.join(','));
        firsts.add(seq[0]!);
      }
      expect(orders.size).toBeGreaterThan(150);
      expect([...firsts].sort()).toEqual([...cyc].sort()); // a new boss can be the first boss of the night
    });

  it('the hash is integer-only and seed-sensitive', () => {
    expect(orderHash(1, 0, 1)).toBe(orderHash(1, 0, 1));
    expect(orderHash(1, 0, 1)).not.toBe(orderHash(2, 0, 1));
    expect(orderHash(1, 0, 1)).not.toBe(orderHash(1, 1, 1));
    expect(Number.isInteger(orderHash(9, 9, 9)) && orderHash(9, 9, 9) >= 0 && orderHash(9, 9, 9) < 2 ** 32).toBe(true);
  });

  it('NO PRNG draw: up to the first boss intro a variant run is identical to production (bossMet aside)', () => {
    for (const [, f] of VARIANTS) {
      const a = new Sim(31337, 'hard', { hero: 'knight' });
      const b = new Sim(31337, 'hard', { hero: 'knight', features: f });
      for (const fr of mulberryInputs(4, 60 * 60)) {
        a.state.alive = b.state.alive = true;
        a.step(fr);
        b.step(fr);
        if (a.state.events.some((e) => e.type === 'boss_intro')) break;
      }
      expect(a.state.boss).not.toBeNull();
      const strip = (s: SimState): unknown => ({ ...s, bossMet: null, boss: s.boss ? { ...s.boss, kind: null, x: 0, y: 0 } : null, events: [] });
      // the rng may differ only by the lich's spot draw at the intro (the eye and the new bosses draw nothing there)
      if (a.state.boss!.kind !== 'lich' && b.state.boss!.kind !== 'lich') expect(JSON.stringify(strip(b.state))).toBe(JSON.stringify(strip(a.state)));
      expect(b.state.tick).toBe(a.state.tick);
    }
  });
});

describe('bossMet and the encounter speed bonus per kind', () => {
  it('production state has eye and lich only; a variant adds exactly its enabled kinds', () => {
    expect(new Sim(1, 'hard').state.bossMet).toEqual({ eye: 0, lich: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('thorn') }).state.bossMet).toEqual({ eye: 0, lich: 0, thorn: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('toller') }).state.bossMet).toEqual({ eye: 0, lich: 0, toller: 0 });
    expect(new Sim(1, 'hard', { features: withFeatures('bosses') }).state.bossMet).toEqual({ eye: 0, lich: 0, thorn: 0, toller: 0 });
  });

  it('every kind counts its own encounters; the speed bonus follows the count of THAT kind', () => {
    const f = withFeatures('bosses');
    const sim = new Sim(5, 'easy', { hero: 'wisp', features: f, startWave: 3 });
    const met: BossKind[] = [];
    const speeds: number[] = [];
    while (met.length < 8 && sim.state.tick < 60 * 60 * 12) {
      sim.state.alive = true;
      sim.step(idle);
      const b = sim.state.boss;
      if (sim.state.events.some((e) => e.type === 'boss_intro') && b) {
        met.push(b.kind);
        speeds.push(b.speed);
        expect(b.encounter).toBe(met.filter((k) => k === b.kind).length - 1);
        expect(b.speed).toBeCloseTo(1 + Math.min(TUNING.bosses.encounterSpeedCap, TUNING.bosses.encounterSpeedStep * b.encounter), 12);
      }
      // only the order and the counters are under test: empty the bar at once (the boss is defeated without attacking)
      if (b && b.deathTick < 0) b.remaining = 0;
    }
    expect(met.length).toBe(8);
    for (const k of ['eye', 'lich', 'thorn', 'toller'] as const) expect(met.filter((m) => m === k).length).toBe(2);
    expect(sim.state.bossMet).toEqual({ eye: 2, lich: 2, thorn: 2, toller: 2 });
  });
});

describe('the forced first boss (dev preview; unrecorded)', () => {
  it('forces only the FIRST boss, only an enabled kind; later bosses follow the seeded order', () => {
    const f = withFeatures('bosses');
    for (const k of ['thorn', 'toller', 'eye', 'lich'] as const) {
      const sim = new Sim(77, 'easy', { features: f, startWave: 3, firstBoss: k });
      for (let i = 0; i < 80; i++) sim.step(idle);
      expect(sim.state.boss?.kind).toBe(k);
    }
    // a disabled kind is ignored (production flags): the usual eye
    const prod = new Sim(77, 'easy', { startWave: 3, firstBoss: 'thorn' });
    for (let i = 0; i < 80; i++) prod.step(idle);
    expect(prod.state.boss?.kind).toBe('eye');
    expect(prod.state.bossMet).toEqual({ eye: 1, lich: 0 });
  });

  it('a replay can never carry it: the replay has no such field and the verifier and the Worker never pass options', () => {
    const f = withFeatures('bosses');
    const sim = new Sim(77, 'easy', { features: f, firstBoss: 'toller' });
    for (const fr of mulberryInputs(2, 120)) sim.step(fr);
    const r = encodeReplay(77, 'easy', 'knight', sim.log, undefined, f) as unknown as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/firstBoss|startWave|toller/);
    const verifier = readFileSync('tools/verify/core.ts', 'utf8');
    expect(verifier).not.toMatch(/firstBoss|startWave|features/);
    for (const file of ['server/src/index.ts', 'server/src/verify.ts']) {
      let src = '';
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      expect(src).not.toMatch(/firstBoss|startWave/);
    }
  });
});

describe('score bound with the new bosses', () => {
  it('a dark build keeps the exact old bound; a variant bound is never smaller', () => {
    for (const k of [1, 2, 3, 6]) expect(earliestBossDefeat(k)).toBe(earliestBossDefeat(k, FEATURES));
    for (const [, f] of VARIANTS) {
      for (const k of [1, 2, 3, 6]) expect(earliestBossDefeat(k, f)).toBeLessThanOrEqual(earliestBossDefeat(k));
      for (const n of [60 * 30, 60 * 120, 60 * 600]) expect(maxPossibleScore(n, f)).toBeGreaterThanOrEqual(maxPossibleScore(n));
    }
  });
});

// ------------------------------------------------------------------ the Thorn Mother

const fightThorn = (seed: number, d: 'easy' | 'medium' | 'hard', f: Features = THORN_V, each?: (sim: Sim) => void, immortal = true): Sim => {
  const sim = new Sim(seed, d, { hero: seed % 2 ? 'knight' : 'wisp', features: f, startWave: 3, firstBoss: 'thorn' });
  while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 120) {
    if (immortal) sim.state.alive = true; // test only: every attack of the fight is observed
    sim.step(botInput(sim));
    each?.(sim);
  }
  return sim;
};
const THORN_V = withFeatures('thorn');

describe('thorn mother: segments and defeat', () => {
  it('12 segments, one per launched attack, at the 2.0 s cadence; the kill is paid once, after her last wall and bloom', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let launches = 0;
      let kills = 0;
      let lastFire = -1;
      const gaps: number[] = [];
      let lastWallGone = -1;
      let defeatTick = -1;
      const sim = fightThorn(seed, 'hard', THORN_V, (s) => {
        for (const e of s.state.events) {
          if (e.type === 'boss_attack') {
            launches++;
            expect(e.remaining).toBe(12 - launches);
            if (lastFire >= 0) gaps.push(s.state.tick - 1 - lastFire);
            lastFire = s.state.tick - 1;
          }
          if (e.type === 'boss_defeated') {
            kills++;
            defeatTick = s.state.tick - 1;
          }
          if (e.type === 'briar_end') lastWallGone = s.state.tick - 1;
        }
        if (s.state.boss && s.state.boss.deathTick < 0) expect(s.state.knots ?? []).toEqual([]);
      });
      expect(sim.state.boss === null || sim.state.boss.deathTick >= 0).toBe(true);
      expect(launches).toBe(12);
      expect(kills).toBe(1);
      expect(sim.state.bossScore).toBe(1000);
      for (const g of gaps) expect(g).toBe(120);
      expect(defeatTick).toBeGreaterThanOrEqual(lastWallGone);
      expect(defeatTick).toBeGreaterThanOrEqual(lastFire);
    }
  });

  it('a bar emptied by a bloom launch pays the kill once, only after the last bloom burst and its shards are gone', () => {
    const f = onlyAttack('thorn', 'bloom');
    const sim = new Sim(3, 'hard', { hero: 'wisp', features: f, startWave: 3, firstBoss: 'thorn' });
    let lastBloom = -1;
    let defeated = -1;
    let n = 0;
    while (sim.state.tick < 60 * 40 && defeated < 0) {
      sim.state.alive = true;
      const b = sim.state.boss;
      if (b && b.deathTick < 0 && b.serial === 0 && b.remaining > 1) b.remaining = 1; // the first launch empties the bar
      sim.step(idle);
      for (const e of sim.state.events) {
        if (e.type === 'boss_bloom') (lastBloom = sim.state.tick - 1, n++);
        if (e.type === 'boss_defeated') defeated = sim.state.tick - 1;
      }
    }
    expect(n).toBeGreaterThanOrEqual(2);
    expect(defeated).toBeGreaterThan(lastBloom);
    expect(sim.state.bossesDefeated).toBe(1);
    expect(sim.state.bossScore).toBe(1000);
  });
});

describe('thorn mother: the attacks', () => {
  it('hedge: a boss-owned root wall (her serial), red and lethal, never two at once, never with a curtain, never withered by the intro rule', () => {
    const f = onlyAttack('thorn', 'hedge', withFeatures('thorn', 'briar', 'knot'));
    let walls = 0;
    for (let seed = 1; seed <= 20; seed++)
      fightThorn(seed, 'hard', f, (sim) => {
        const s = sim.state;
        expect((s.walls ?? []).length).toBeLessThanOrEqual(1);
        // the hunts never start in her fight: only HER walls, and no knot at all
        if (s.boss && s.boss.deathTick < 0) {
          for (const w of s.walls ?? []) expect(w.boss).toBeGreaterThan(0);
          expect(s.knots ?? []).toEqual([]);
        }
        for (const e of s.events) {
          if (e.type === 'briar') {
            walls++;
            expect(e.boss).toBe(s.boss?.serial);
          }
          if (e.type === 'briar_end') expect(e.how).toBe('crossed');
        }
      });
    expect(walls).toBeGreaterThan(40);
  });

  it('bloom: 1..3 spots >= 90 px from the hero at the wind-up, each a violet shard ring with one gap >= 0.5 rad, 0.3 s apart, cued >= 15 ticks', () => {
    const f = onlyAttack('thorn', 'bloom');
    let rings = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const times: number[] = [];
      fightThorn(seed, 'hard', f, (sim) => {
        const s = sim.state;
        const a = s.boss?.attack;
        if (a?.pattern === 'bloom' && s.tick - 1 === a.windStart) {
          expect(a.points.length).toBeGreaterThanOrEqual(1);
          expect(a.points.length).toBeLessThanOrEqual(3);
          for (const [x, y] of a.points) expect(Math.hypot(x - s.hero.x, y - s.hero.y)).toBeGreaterThanOrEqual(90 - 3); // the hero moved one tick
        }
        if (s.events.some((e) => e.type === 'boss_bloom')) {
          times.push(s.tick - 1);
          const born = s.projectiles.filter((pr) => pr.born === s.tick - 1 && pr.boss > 0);
          for (const e of s.events) if (e.type === 'spawn' && born.some((b) => b.id === e.id)) expect(e.telegraphTicks).toBeGreaterThanOrEqual(15);
          // group by bloom centre: the largest angular gap of each ring is >= 0.5 rad
          const byCentre = new Map<string, number[]>();
          for (const pr of born) {
            expect(pr.kind).toBe('rune_shard');
            expect(pr.parryable).toBe(true);
            const ang = Math.atan2(pr.vy, pr.vx);
            const cx = Math.round(pr.x - Math.cos(ang) * 4);
            const cy = Math.round(pr.y - Math.sin(ang) * 4);
            const key = `${cx},${cy}`;
            byCentre.set(key, [...(byCentre.get(key) ?? []), ang]);
          }
          for (const angs of byCentre.values()) {
            rings++;
            const a2 = angs.map((x) => (x + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
            let gap = a2[0]! + 2 * Math.PI - a2[a2.length - 1]!;
            for (let i = 1; i < a2.length; i++) gap = Math.max(gap, a2[i]! - a2[i - 1]!);
            expect(gap).toBeGreaterThanOrEqual(0.5);
          }
        }
      });
      for (let i = 1; i < times.length; i++) if (times[i]! - times[i - 1]! < 60) expect(times[i]! - times[i - 1]!).toBe(18);
    }
    expect(rings).toBeGreaterThan(100);
  });

  it('lash: red unparryable blades along the wind-up line; spores: a violet fan aimed at the hero', () => {
    for (const [pattern, kind, parryable] of [['lash', 'blade', false], ['spores', 'orb_small', true]] as const) {
      let shots = 0;
      fightThorn(5, 'hard', onlyAttack('thorn', pattern), (sim) => {
        const s = sim.state;
        for (const pr of s.projectiles)
          if (pr.boss > 0 && pr.born === s.tick - 1) {
            shots++;
            expect(pr.kind).toBe(kind);
            expect(pr.parryable).toBe(parryable);
          }
      });
      expect(shots).toBeGreaterThan(24);
    }
  });
});

// ------------------------------------------------------------------ the Toller

const TOLLER_V = withFeatures('toller');
const fightToller = (seed: number, d: 'easy' | 'medium' | 'hard', f: Features = TOLLER_V, each?: (sim: Sim) => void): Sim => {
  const sim = new Sim(seed, d, { hero: seed % 2 ? 'knight' : 'wisp', features: f, startWave: 3, firstBoss: 'toller' });
  while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 120) {
    sim.state.alive = true;
    sim.step(botInput(sim));
    each?.(sim);
  }
  return sim;
};
/** The largest angular gap of a set of directions (radians). */
function largestGap(angs: number[]): { size: number; at: number } {
  const a = angs.map((x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
  let best = { size: a[0]! + 2 * Math.PI - a[a.length - 1]!, at: a[a.length - 1]! + (a[0]! + 2 * Math.PI - a[a.length - 1]!) / 2 };
  for (let i = 1; i < a.length; i++) if (a[i]! - a[i - 1]! > best.size) best = { size: a[i]! - a[i - 1]!, at: (a[i]! + a[i - 1]!) / 2 };
  return best;
}
const angDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('the toller: segments, the beat and the defeat', () => {
  it('14 segments, one per launch; every wind-up and every launch on a 30-tick beat from the intro end', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let launches = 0;
      let kills = 0;
      fightToller(seed, 'hard', TOLLER_V, (sim) => {
        const s = sim.state;
        const b = s.boss;
        if (b?.attack && s.tick - 1 === b.attack.windStart) expect((b.attack.windStart - b.introEnd) % 30).toBe(0);
        for (const e of s.events) {
          if (e.type === 'boss_attack') {
            launches++;
            expect(e.remaining).toBe(14 - launches);
            expect((s.tick - 1 - b!.introEnd) % 30).toBe(0);
          }
          if (e.type === 'boss_toll') expect((s.tick - 1 - b!.introEnd) % 30).toBe(0);
          if (e.type === 'boss_defeated') kills++;
        }
        expect(s.beams.length).toBeLessThanOrEqual(1);
      });
      expect(launches).toBe(14);
      expect(kills).toBe(1);
    }
  });

  it('a bar emptied by the launch of a toll pays the kill exactly once, after the third ring and its orbs are gone', () => {
    const f = onlyAttack('toller', 'toll');
    const sim = new Sim(4, 'hard', { hero: 'wisp', features: f, startWave: 3, firstBoss: 'toller' });
    const rings: number[] = [];
    let defeated = -1;
    let kills = 0;
    let lastOrbGone = -1;
    while (sim.state.tick < 60 * 40 && sim.state.bossesDefeated === 0) {
      sim.state.alive = true;
      const b = sim.state.boss;
      if (b && b.deathTick < 0 && b.serial === 0 && b.remaining > 1) b.remaining = 1;
      const had = sim.state.projectiles.some((pr) => pr.boss > 0);
      sim.step(idle);
      if (had && !sim.state.projectiles.some((pr) => pr.boss > 0)) lastOrbGone = sim.state.tick - 1;
      for (const e of sim.state.events) {
        if (e.type === 'boss_toll') rings.push(sim.state.tick - 1);
        if (e.type === 'boss_defeated') (defeated = sim.state.tick - 1, kills++);
      }
    }
    expect(rings.length).toBe(3);
    expect(rings[1]! - rings[0]!).toBe(30);
    expect(rings[2]! - rings[1]!).toBe(30);
    expect(kills).toBe(1);
    expect(defeated).toBeGreaterThan(rings[2]!);
    expect(defeated).toBeGreaterThanOrEqual(lastOrbGone);
    expect(sim.state.bossScore).toBe(1000);
  });
});

describe('the toller: the attacks', () => {
  it('toll: three violet rings on three beats, <= 30 orbs, each with a gap >= 0.5 rad, no two gaps aligned', () => {
    let tolls = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let gaps: number[] = [];
      let orbs = 0;
      fightToller(seed, 'hard', onlyAttack('toller', 'toll'), (sim) => {
        const s = sim.state;
        const b = s.boss!;
        if (!s.events.some((e) => e.type === 'boss_toll')) return;
        const ring = s.events.find((e) => e.type === 'boss_toll') as { ring: number };
        const born = s.projectiles.filter((pr) => pr.boss > 0 && pr.born === s.tick - 1);
        for (const pr of born) expect(pr.kind === 'orb_small' && pr.parryable).toBe(true);
        const g = largestGap(born.map((pr) => Math.atan2(pr.y - b.y, pr.x - b.x)));
        expect(g.size).toBeGreaterThanOrEqual(0.5);
        if (ring.ring === 0) (gaps = [], orbs = 0, tolls++);
        orbs += born.length;
        expect(orbs).toBeLessThanOrEqual(30);
        // the gap is THE gap (clearly wider than the ring's spacing), and no two gaps of a toll overlap (Hard)
        const spacing = (2 * Math.PI - g.size) / Math.max(1, born.length - 1);
        if (born.length >= 8) expect(g.size).toBeGreaterThanOrEqual(1.5 * spacing);
        for (const other of gaps) expect(angDiff(other, g.at)).toBeGreaterThanOrEqual(g.size - 1e-9);
        gaps.push(g.at);
      });
    }
    expect(tolls).toBeGreaterThan(200);
  });

  it('pendulum: two red beam passes of ONE attack (the second starts when the first ends), <= 60 deg/s, back to the start line', () => {
    let passes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let first: { dx: number; dy: number; end: number; serial: number } | null = null;
      fightToller(seed, 'hard', onlyAttack('toller', 'pendulum'), (sim) => {
        const s = sim.state;
        for (const bm of s.beams) {
          expect(Math.abs(Math.atan2(bm.turnS, bm.turnC)) * 60 * (180 / Math.PI)).toBeLessThanOrEqual(60 + 1e-9);
          if (bm.start !== s.tick - 1) continue;
          passes++;
          const a = s.boss!.attack;
          if (s.boss!.pending?.some((e) => e.op === 'swing' && e.serial === bm.serial)) first = { dx: bm.dirX, dy: bm.dirY, end: bm.end, serial: bm.serial };
          else {
            expect(first).not.toBeNull();
            expect(bm.serial).toBe(first!.serial);
            expect(bm.start).toBe(first!.end);
            void a;
          }
        }
        // the second pass's last direction is the first pass's start line
        const bm = s.beams[0];
        if (bm && first && bm.serial === first.serial && bm.start === first.end && s.tick === bm.end - 1 + 1) {
          expect(angDiff(Math.atan2(bm.dirY, bm.dirX), Math.atan2(first.dy, first.dx))).toBeLessThan(1e-6);
        }
      });
    }
    expect(passes).toBeGreaterThan(100);
  });

  it('knell: a ring of red blades with TWO gaps >= 0.5 rad; never two knell rings alive', () => {
    let rings = 0;
    for (let seed = 1; seed <= 30; seed++)
      fightToller(seed, 'hard', onlyAttack('toller', 'knell'), (sim) => {
        const s = sim.state;
        const b = s.boss!;
        const serials = new Set(s.projectiles.filter((pr) => pr.boss > 0 && pr.kind === 'blade').map((pr) => pr.boss));
        expect(serials.size).toBeLessThanOrEqual(1);
        // (with only the knell in its table the Toller falls back to a toll while a knell is alive: skip those orbs)
        const born = s.projectiles.filter((pr) => pr.boss > 0 && pr.born === s.tick - 1 && pr.kind === 'blade');
        if (!born.length) return;
        rings++;
        for (const pr of born) expect(pr.parryable).toBe(false);
        const a = born.map((pr) => ((Math.atan2(pr.vy, pr.vx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
        const g = a.map((x, i) => (i === 0 ? x + 2 * Math.PI - a[a.length - 1]! : x - a[i - 1]!)).sort((x, y) => y - x);
        expect(g[0]).toBeGreaterThanOrEqual(0.5);
        expect(g[1]).toBeGreaterThanOrEqual(0.5);
        void b;
      });
    expect(rings).toBeGreaterThan(100);
  });
});
