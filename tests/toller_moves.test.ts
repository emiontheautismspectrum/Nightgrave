/**
 * The Toller's new moves (FEATURES.bossMoves.toller, docs/FEATURES.md): the ring (peal, echo), its cuts and the launch
 * deferral, and the chains (iron, parry-break). Enabled VARIANTS only; production stays dark.
 */
import { describe, expect, it } from 'vitest';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TUNING } from '../src/data/tuning';
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { makeParams, tollerMoves } from '../src/sim/params';
import { Sim } from '../src/sim/sim';
import type { BossPattern, Ring, SimState } from '../src/sim/state';
import { earlierHazardsAlive, inRingGap, ringBlocks, ringGap, ringHits } from '../src/sim/tollerMoves';
import { ringReturning } from '../src/render/edgeMarkers';
import { onlyTollerMove } from './boss_tools';
import { mulberryInputs } from './scripted';

const MOVES = withFeatures('toller', 'bossMoves');
const M = MOVES.bossMoves.toller;
const BEAT = MOVES.bosses.toller.beatTicks;
const IDLE: InputFrame = { cursor: false, mx: 0, my: 0, buttons: 0 };

/** A Toller fight (first boss, wave 3) with the hero put at (hx, hy) before the intro ends. */
function tollerFight(f: Features, seed: number, hx: number, hy: number, d: 'easy' | 'medium' | 'hard' = 'hard', hero: 'knight' | 'wisp' = 'wisp'): Sim {
  const sim = new Sim(seed, d, { hero, features: f, startWave: 3, firstBoss: 'toller' });
  sim.state.streamTimer = 1e9;
  while (!sim.state.boss) sim.step(IDLE);
  sim.state.hero.x = hx;
  sim.state.hero.y = hy;
  return sim;
}

/** Run until `stop` (or the fight ends), immortal unless `mortal`; `input` decides each frame. */
function run(sim: Sim, input: (sim: Sim) => InputFrame, stop: (sim: Sim) => boolean, mortal = false, limit = 60 * 90): void {
  const end = sim.state.tick + limit;
  while (sim.state.tick < end && sim.state.bossesDefeated === 0 && !stop(sim)) {
    if (!mortal) sim.state.alive = true;
    else if (!sim.state.alive) return;
    sim.step(input(sim));
  }
}

const launched = (s: SimState, k?: BossPattern): boolean => s.events.some((e) => e.type === 'boss_attack' && (k === undefined || e.pattern === k));

describe('bossMoves: dark and gated', () => {
  it('the Toller rows are ignored (never read) without the Toller; nothing changes', () => {
    for (const extra of [[], ['thorn']] as const) {
      const on = withFeatures('bossMoves', ...extra);
      const sealedToller = new Proxy(on.bossMoves.toller, {
        get(_t, prop) {
          throw new Error(`bossMoves.toller read without the toller (${String(prop)})`);
        },
      });
      const G = { ...on, bossMoves: { ...on.bossMoves, toller: sealedToller } } as Features;
      expect(makeParams('hard', 'knight', G).moves).toBe(G.bossMoves);
      expect(tollerMoves(makeParams('hard', 'knight', G))).toBeNull();
      const frames = mulberryInputs(17, 60 * 80);
      const a = new Sim(4243, 'hard', { hero: 'knight', features: G, startWave: 3 });
      const b = new Sim(4243, 'hard', { hero: 'knight', features: withFeatures(...extra), startWave: 3 });
      for (const fr of frames) {
        a.state.alive = b.state.alive = true;
        a.step(fr);
        b.step(fr);
      }
      expect(a.state.bossWave).toBeGreaterThanOrEqual(7);
      expect('rings' in a.state || 'chain' in a.state).toBe(false);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  });

  it('rings and the chain exist in the state only with the block AND the Toller', () => {
    expect('rings' in new Sim(1, 'hard').state).toBe(false);
    expect('rings' in new Sim(1, 'hard', { features: withFeatures('toller') }).state).toBe(false);
    const s = new Sim(1, 'hard', { features: MOVES }).state;
    expect(s.rings).toEqual([]);
    expect(s.chain).toBeNull();
    expect(FEATURES.bossMoves.enabled).toBe(false);
  });
});

describe('the ring: geometry', () => {
  it('O(1) collision = the brute-force angle test (gaps, band, hero radius) on random points', () => {
    const p = makeParams('hard', 'knight', MOVES);
    let r = 7;
    const rnd = (): number => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 4000; n++) {
      const ring: Ring = { id: 1, serial: 1, echo: false, x: 240, y: 60, r: 40 + rnd() * 150, startR: 8, maxR: 400, speed: 1, back: 0, halfWidth: 2, phase: 'grow', holdStart: -1, holdUntil: -1, gaps: [], paid: false, near: -1e9 };
      const angles: number[] = [];
      for (let g = 0; g < 1 + Math.floor(rnd() * 4); g++) {
        const a = rnd() * 2 * Math.PI;
        angles.push(a);
        ring.gaps.push(ringGap(Math.cos(a), Math.sin(a), M.ring.cutHalfRad));
      }
      const ha = rnd() * 2 * Math.PI;
      const hd = ring.r + (rnd() - 0.5) * 16;
      const s = { hero: { x: ring.x + Math.cos(ha) * hd, y: ring.y + Math.sin(ha) * hd }, rings: [ring] } as unknown as SimState;
      const inBand = Math.abs(hd - ring.r) < ring.halfWidth + p.heroRadius;
      const t = Math.asin(Math.min(1, p.heroRadius / hd));
      const gapped = angles.some((a) => Math.abs(((ha - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= M.ring.cutHalfRad - t - 1e-9);
      const edge = angles.some((a) => Math.abs(Math.abs(((ha - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) - (M.ring.cutHalfRad - t)) < 1e-6);
      if (edge) continue;
      expect(ringHits(s, p) > 0, `n ${n}`).toBe(inBand && !gapped);
      expect(inRingGap(ring, Math.cos(ha), Math.sin(ha), hd, p.heroRadius)).toBe(gapped);
    }
  });
});

/** Face the bell (one step towards it turns the aim) and press parry when the ring's band is inside half the zone. */
function parryRing(sim: Sim): InputFrame {
  const s = sim.state;
  const h = s.hero;
  const ring = s.rings?.[0];
  const b = s.boss;
  if (!ring || !b) return IDLE;
  const d = Math.hypot(h.x - ring.x, h.y - ring.y);
  const towards = ring.phase === 'grow' ? -1 : 1; // the band comes from the centre (grow) or from outside (back)
  const ux = ((h.x - ring.x) / d) * towards;
  const uy = ((h.y - ring.y) / d) * towards;
  const gap = Math.abs(d - ring.r) - ring.halfWidth;
  const press = gap < sim.params.parryRadius * 0.6 && gap > 0 && (ring.phase === 'grow' ? ring.r < d : ring.r > d);
  return { cursor: true, mx: Math.round(h.x + ux * 3), my: Math.round(h.y + uy * 3), buttons: press ? BTN_PARRY : 0 };
}

describe('the peal', () => {
  const F = onlyTollerMove('peal');
  it('a 2-beat wind-up, a ring from the bell (r 8), out of the arena within 4.5 s on every difficulty; the Toller teleports >= 90 px from the hero', () => {
    for (const d of ['easy', 'medium', 'hard'] as const)
      for (let seed = 1; seed <= 8; seed++) {
        const sim = tollerFight(F, seed, 240, 230, d);
        let wind = -1;
        let bell: [number, number] = [0, 0];
        let ringAt = -1;
        let ended = -1;
        void sim;
        const s2 = tollerFight(F, seed, 240, 230, d);
        while (s2.state.tick < 60 * 40 && ended < 0) {
          s2.state.alive = true;
          s2.step(IDLE);
          const s = s2.state;
          const b = s.boss!;
          if (b.attack && b.attack.windStart === s.tick - 1) {
            wind = b.attack.fire - b.attack.windStart;
            bell = [b.x, b.y];
          }
          for (const e of s.events) {
            if (e.type === 'boss_ring') {
              ringAt = s.tick - 1;
              const ring = s.rings![0]!;
              expect([ring.x, ring.y]).toEqual(bell);
              expect(ring.r).toBeCloseTo(M.peal.startRadius + ring.speed, 9);
            }
            if (e.type === 'boss_teleport') {
              expect(Math.hypot(e.x - s.hero.x, e.y - s.hero.y)).toBeGreaterThanOrEqual(M.peal.teleportMinHeroDist);
              expect(e.y).toBeLessThanOrEqual(M.peal.teleportYMax);
            }
            if (e.type === 'ring_end') ended = s.tick - 1;
          }
        }
        expect(wind).toBeGreaterThanOrEqual(2 * BEAT);
        expect(wind % BEAT).toBe(0);
        expect(ringAt).toBeGreaterThan(0);
        expect(ended - ringAt, `${d} seed ${seed}`).toBeLessThanOrEqual(Math.round(M.peal.maxLeaveSeconds * 60));
      }
  });

  it('its next two attacks start 2 beats apart (hastened, on the beat), then the 3-beat cadence returns', () => {
    const f = onlyTollerMove('peal');
    // the peal plus tolls: the attacks after a peal are tolls (the next peal waits for the clear field)
    const mix = { ...f, bosses: { ...f.bosses, toller: { ...f.bosses.toller, toll: { ...f.bosses.toller.toll, weight: 1 } } } } as Features;
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const sim = tollerFight(mix, seed, 240, 230);
      // every attack start, whether the Toller waited before it, and how long its launch was deferred (a ring passing)
      const starts: { t: number; k: BossPattern; waited: boolean; defer: number }[] = [];
      let waited = false;
      void sim;
      const s2 = tollerFight(mix, seed, 240, 230);
      while (s2.state.bossesDefeated === 0 && s2.state.tick < 60 * 90) {
        s2.state.alive = true;
        const a0 = s2.state.boss?.attack;
        s2.step(IDLE);
        const b = s2.state.boss;
        if (b?.waitFor) waited = true;
        if (a0 && launched(s2.state) && starts.length) starts[starts.length - 1]!.defer = a0.defer ?? 0;
        if (b?.attack && b.attack.tpOut === s2.state.tick - 1) {
          starts.push({ t: b.attack.tpOut, k: b.attack.pattern, waited, defer: 0 });
          waited = false;
        }
      }
      for (let i = 0; i + 3 < starts.length; i++) {
        if (starts[i]!.k !== 'peal' || starts[i + 1]!.waited || starts[i + 2]!.waited || starts[i + 3]!.waited) continue;
        // start to start: the cadence (a deferred launch delays the next start by its deferral, never shortens it)
        expect(starts[i + 1]!.t - starts[i]!.t).toBe(2 * BEAT + starts[i]!.defer);
        expect(starts[i + 2]!.t - starts[i + 1]!.t).toBe(2 * BEAT + starts[i + 1]!.defer);
        expect(starts[i + 3]!.t - starts[i + 2]!.t).toBe(3 * BEAT + starts[i + 2]!.defer);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('a hero within minHeroDist of the bell at the launch gets a toll instead (one segment, named toll)', () => {
    let fell = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = tollerFight(F, seed, 240, 230);
      // walk under the bell during the wind-up
      run(sim, (x) => (x.state.boss?.attack ? { cursor: true, mx: 240, my: 100, buttons: 0 } : { cursor: true, mx: 240, my: 230, buttons: 0 }), (x) => launched(x.state));
      const e = sim.state.events.find((x) => x.type === 'boss_attack');
      if (!e || e.type !== 'boss_attack') continue;
      const close = Math.hypot(sim.state.hero.x - 240, sim.state.hero.y - 58) < M.peal.minHeroDist;
      expect(e.pattern).toBe(close ? 'toll' : 'peal');
      expect(sim.state.rings!.length).toBe(close ? 0 : 1);
      if (close) fell++;
    }
    expect(fell).toBeGreaterThan(5);
  });
});

describe('the ring: parry, dash, walking', () => {
  for (const hero of ['knight', 'wisp'] as const)
    it(`${hero}: a parry on time cuts a gap and the hero survives; the first cut pays one parry; a dash survives; standing still dies`, () => {
      let paid = 0;
      for (let seed = 1; seed <= 10; seed++) {
        // parry
        const a = tollerFight(onlyTollerMove('peal'), seed, 240, 225, 'hard', hero);
        const before = { score: a.state.parryScoreHundredths, mult: a.state.multiplier, guard: a.state.hero.guardCharges };
        run(a, parryRing, (x) => x.state.events.some((e) => e.type === 'ring_end') || (x.state.rings?.[0]?.r ?? 0) > 260, true);
        expect(a.state.alive, `${hero} seed ${seed} parry`).toBe(true);
        const ring = a.state.rings?.[0];
        if (ring) expect(ring.gaps.length).toBeGreaterThanOrEqual(1);
        expect(a.state.parryScoreHundredths - before.score).toBe(TUNING.score.parryBase * before.mult);
        expect(a.state.hero.guardCharges).toBe(before.guard); // never a guard charge from a cut
        paid++;
        // dash just before the band arrives
        const b = tollerFight(onlyTollerMove('peal'), seed, 240, 225, 'hard', hero);
        run(b, (x) => {
          const r = x.state.rings?.[0];
          const d = r ? Math.hypot(x.state.hero.x - r.x, x.state.hero.y - r.y) - r.r : 99;
          return d > 0 && d < 8 ? { cursor: true, mx: 240, my: 100, buttons: BTN_DASH } : IDLE;
        }, (x) => (x.state.rings?.[0]?.r ?? 0) > 260 || x.state.events.some((e) => e.type === 'ring_end'), true);
        expect(b.state.alive, `${hero} seed ${seed} dash`).toBe(true);
        // standing (or walking: the ring is full) dies
        const c = tollerFight(onlyTollerMove('peal'), seed, 240, 225, 'hard', hero);
        run(c, () => IDLE, (x) => (x.state.rings?.[0]?.r ?? 0) > 260, true);
        expect(c.state.alive).toBe(false);
        expect(c.state.events.find((e) => e.type === 'death')).toMatchObject({ by: -4 });
      }
      expect(paid).toBe(10);
    });

  it('the echo: holds outside the arena, returns at 70%; cut gaps persist; a cut on the way back pays nothing; life <= 8 s', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = tollerFight(onlyTollerMove('echo'), seed, 240, 225);
      let start = -1;
      let hold = -1;
      let back = -1;
      let end = -1;
      const paid: boolean[] = [];
      let gapsAtHold = 0;
      let returning = 0;
      run(sim, parryRing, (x) => end >= 0, true);
      const s2 = tollerFight(onlyTollerMove('echo'), seed, 240, 225);
      while (end < 0 && s2.state.tick < 60 * 60) {
        if (!s2.state.alive) break;
        s2.step(parryRing(s2));
        const s = s2.state;
        const ring = s.rings?.[0];
        for (const e of s.events) {
          if (e.type === 'boss_ring') start = s.tick - 1;
          if (e.type === 'ring_cut') paid.push(e.paid);
          if (e.type === 'ring_end') end = s.tick - 1;
        }
        if (ring && ringReturning(ring, s2.params)) returning++;
        if (ring && ring.phase === 'hold' && hold < 0) {
          hold = s.tick - 1;
          gapsAtHold = ring.gaps.length;
          expect(ring.r - ring.halfWidth).toBeGreaterThan(Math.hypot(Math.max(ring.x - 48, 432 - ring.x), Math.max(ring.y - 27, 243 - ring.y)));
          expect(ring.back).toBeCloseTo(ring.speed * M.echo.returnFactor, 12);
        }
        if (ring && ring.phase === 'back' && back < 0) {
          back = s.tick - 1;
          expect(ring.gaps.length).toBe(gapsAtHold); // the gaps persist
        }
      }
      expect(s2.state.alive, `seed ${seed}`).toBe(true);
      expect(back - hold).toBe(Math.round(M.echo.holdSeconds * 60));
      expect(returning, `seed ${seed}`).toBeGreaterThanOrEqual(45); // the full view's bone border marks
      expect(end - start).toBeLessThanOrEqual(M.echo.maxLifeSeconds * 60);
      expect(paid[0]).toBe(true);
      expect(paid.slice(1).every((x) => !x)).toBe(true);
      expect(paid.length).toBeGreaterThanOrEqual(2); // out and back
    }
  });
});

describe('the toller with the new moves: the rules of the whole fight', () => {
  const ALL = withFeatures('bosses', 'bossMoves');
  it('never two rings; a new move never starts while an earlier hazard lives, never takes the last segment; no launch while a ring is about to reach the hero', () => {
    const seen: Record<string, number> = {};
    for (let seed = 1; seed <= 24; seed++) {
      const sim = new Sim(seed * 3, seed % 3 === 0 ? 'medium' : 'hard', { hero: seed % 2 ? 'knight' : 'wisp', features: ALL, startWave: 3, firstBoss: 'toller' });
      const frames = mulberryInputs(seed, 60 * 100);
      for (let i = 0; sim.state.bossesDefeated === 0 && i < 60 * 100; i++) {
        const pre = structuredClone(sim.state);
        sim.state.alive = true;
        sim.step(frames[i]!);
        const s = sim.state;
        const b = s.boss;
        expect((s.rings ?? []).length).toBeLessThanOrEqual(1);
        if (b?.attack && b.attack.tpOut === s.tick - 1 && (b.attack.pattern === 'peal' || b.attack.pattern === 'echo' || b.attack.pattern === 'chains')) {
          seen[b.attack.pattern] = (seen[b.attack.pattern] ?? 0) + 1;
          expect(earlierHazardsAlive(pre, pre.boss!)).toBe(false);
          expect(b.remaining).toBeGreaterThan(1);
        }
        if (launched(s) && pre.rings?.length) {
          // the deferral rule, checked on the state the launch saw (the hero already moved this tick)
          const seenByLaunch = { ...pre, hero: { ...pre.hero, x: s.hero.x, y: s.hero.y } };
          expect(ringBlocks(seenByLaunch, sim.params), `seed ${seed} tick ${s.tick - 1}`).toBe(false);
        }
      }
      expect(sim.state.bossesDefeated).toBe(1);
    }
    for (const k of ['peal', 'echo', 'chains']) expect(seen[k] ?? 0, k).toBeGreaterThan(3);
  });
});

describe('the chains', () => {
  const F = onlyTollerMove('chains');
  /** The first chain cast of a fight with the hero idle at (hx, hy): the sim at its landing tick. */
  function toLanding(seed: number, kind?: 'iron' | 'break', input: (sim: Sim) => InputFrame = () => IDLE): Sim | null {
    const sim = tollerFight(F, seed, 300, 200);
    run(sim, input, (x) => launched(x.state));
    if (!launched(sim.state)) return null;
    const bind = sim.state.events.find((e) => e.type === 'chain_bind' || e.type === 'chain_miss');
    if (kind && (!bind || bind.type !== 'chain_bind' || bind.kind !== kind)) return null;
    return sim;
  }

  it('the spot is the hero position at the wind-up start, marked >= 0.75 s (whole beats); the landing is the launch', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = tollerFight(F, seed, 300, 200);
      run(sim, () => IDLE, (x) => !!x.state.chain);
      const c = sim.state.chain!;
      expect([c.x, c.y]).toEqual([300, 200]);
      expect(c.land - c.start).toBeGreaterThanOrEqual(45);
      expect((c.land - c.start) % BEAT).toBe(0);
      run(sim, () => IDLE, (x) => launched(x.state));
      expect(sim.state.tick - 1).toBe(c.land);
      expect(sim.state.events.some((e) => e.type === 'chain_bind')).toBe(true);
    }
  });

  it('a hero who walked out of the spot is not bound (the chain is gone)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = toLanding(seed, undefined, (x) => (x.state.chain ? { cursor: true, mx: 360, my: 200, buttons: 0 } : IDLE));
      expect(sim!.state.events.some((e) => e.type === 'chain_miss')).toBe(true);
      expect(sim!.state.chain).toBeNull();
    }
  });

  it('IRON: no movement (the aim still follows), the parry works, the dash breaks it at once; else it lasts ironSeconds', () => {
    let n = 0;
    for (let seed = 1; seed <= 40 && n < 6; seed++) {
      const sim = toLanding(seed, 'iron');
      if (!sim) continue;
      n++;
      const s = sim.state;
      const at = [s.hero.x, s.hero.y];
      const t0 = s.tick - 1;
      for (let i = 0; i < 20; i++) sim.step({ cursor: true, mx: 100, my: 100, buttons: i === 10 ? BTN_PARRY : 0 });
      expect([s.hero.x, s.hero.y]).toEqual(at);
      expect(s.hero.aimX).toBeLessThan(0); // facing up-left, where the input points
      expect(s.hero.parryStart).toBe(t0 + 11);
      expect(s.chain?.bound).toBe(true);
      sim.step({ cursor: true, mx: 100, my: 100, buttons: BTN_DASH });
      expect(s.chain).toBeNull();
      expect(s.events).toContainEqual({ type: 'chain_free', how: 'dash' });
      expect(s.hero.x).not.toBe(at[0]);
      // without the dash: free after ironSeconds (real ticks)
      const sim2 = toLanding(seed, 'iron')!;
      run(sim2, () => IDLE, (x) => x.state.events.some((e) => e.type === 'chain_free'));
      expect(sim2.state.tick - 1 - t0).toBe(Math.round(M.chains.ironSeconds * 60));
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('IRON is cast only with the dash ready (the escape exists)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = tollerFight(F, seed, 300, 200);
      run(sim, (x) => ({ ...IDLE, buttons: x.state.tick % 97 === 0 ? BTN_DASH : 0 }), () => false);
    }
    for (let seed = 1; seed <= 30; seed++) {
      const sim = tollerFight(F, seed, 300, 200);
      while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 80) {
        sim.state.alive = true;
        sim.step({ cursor: false, mx: 0, my: 0, buttons: sim.state.tick % 97 === 0 ? BTN_DASH : 0 });
        for (const e of sim.state.events)
          if (e.type === 'chain_bind' && e.kind === 'iron') expect(sim.state.tick - 1 - sim.state.hero.dashStart).toBeGreaterThanOrEqual(sim.params.dashCooldown);
        if (sim.state.boss?.attack?.pattern === 'chains' && sim.state.boss.attack.tpOut === sim.state.tick - 1 && sim.state.chain!.kind === 'iron')
          expect(sim.state.tick - 1 - sim.state.hero.dashStart).toBeGreaterThanOrEqual(sim.params.dashCooldown);
      }
    }
  });

  it('PARRY-BREAK: no dash; every pulse counts, 3 free the hero; else maxSeconds; meanwhile only tolls, their rings 2 beats apart', () => {
    let n = 0;
    for (let seed = 1; seed <= 40 && n < 6; seed++) {
      const sim = toLanding(seed, 'break');
      if (!sim) continue;
      n++;
      const s = sim.state;
      const at = [s.hero.x, s.hero.y];
      sim.step({ cursor: true, mx: 100, my: 100, buttons: BTN_DASH });
      expect(s.events.some((e) => e.type === 'dash_start')).toBe(false);
      expect([s.hero.x, s.hero.y]).toEqual(at);
      // three pulses (whiffs count too) free it
      let pulses = 0;
      run(sim, (x) => {
        const ready = x.state.tick - x.state.hero.parryStart >= 90;
        return { ...IDLE, buttons: ready ? BTN_PARRY : 0 };
      }, (x) => {
        if (x.state.events.some((e) => e.type === 'parry_start')) pulses++;
        return x.state.events.some((e) => e.type === 'chain_free');
      });
      expect(pulses).toBe(M.chains.breakParries);
      expect(s.events).toContainEqual({ type: 'chain_free', how: 'parries' });
      // without a pulse: maxSeconds; only tolls launch meanwhile, their rings boundRingBeats apart
      const sim2 = toLanding(seed, 'break')!;
      const t0 = sim2.state.tick - 1;
      const tolls: number[] = [];
      run(sim2, () => IDLE, (x) => {
        for (const e of x.state.events) {
          if (e.type === 'boss_attack' && x.state.tick - 1 > t0) expect(e.pattern).toBe('toll');
          if (e.type === 'boss_toll' && x.state.chain?.bound) tolls.push(x.state.tick - 1);
        }
        return x.state.events.some((e) => e.type === 'chain_free');
      });
      // one attack at a time: the next toll starts only once the last one's rings are out (its rings never interleave)
      for (let i = 1; i < tolls.length; i++) expect(tolls[i]! - tolls[i - 1]!).toBeGreaterThanOrEqual(M.chains.boundRingBeats * BEAT);
      expect(sim2.state.tick - 1 - t0).toBe(Math.round(M.chains.maxSeconds * 60));
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('a bind ends at once when its boss is defeated', () => {
    const sim = toLanding(2)!;
    expect(sim.state.chain?.bound).toBe(true);
    sim.state.boss!.remaining = 0;
    sim.state.boss!.deathTick = sim.state.tick;
    sim.step(IDLE);
    expect(sim.state.chain).toBeNull();
    expect(sim.state.events).toContainEqual({ type: 'chain_free', how: 'boss' });
  });
});
