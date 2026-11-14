/**
 * The pattern pack (FEATURES.patternPack, src/sim/patternPack.ts), tested in the ENABLED variant: the production flags
 * stay dark (tests/features.test.ts, tests/golden_corpus.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { HOLLOWS, RUNES } from '../src/data/arena';
import { FEATURES, PACK_KEYS, type Features, type PackKey } from '../src/data/features';
import { TUNING, type Difficulty } from '../src/data/tuning';
import { dailySeed } from '../src/shared/daily';
import { encodeInputLog } from '../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../src/shared/version';
import { packEntityCaps, packPick, packWeight, PACK_POINT_BLANK } from '../src/sim/patternPack';
import { encodeReplay, playReplay, tuningHash } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import type { Projectile, SimEvent } from '../src/sim/state';
import { CASTER_POINT_BLANK } from '../src/sim/waves';
import { verifyItem, type PendingItem } from '../tools/verify/core';
import { botInput } from './bot';
import { PACK, resolved, SPOTS, startPiece, walkingSolver, watch, type Piece } from './pack_tools';
import { mulberryInputs } from './scripted';
import { SkilledBot } from './skilled';

const PP = PACK.patternPack;
const CAPS = packEntityCaps(PP);
const IDLE = { cursor: false, mx: 0, my: 0, buttons: 0 };
const ang = (pr: { vx: number; vy: number }): number => Math.atan2(pr.vy, pr.vx);
/** Smallest absolute difference between two angles. */
const angDiff = (a: number, b: number): number => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Step an immortal hero (test only) and return the events of the tick. */
function stepImmortal(sim: Sim, input = IDLE): SimEvent[] {
  sim.state.alive = true;
  sim.step(input);
  return sim.state.events;
}

/** Let a started piece play out with a standing, immortal hero; returns every projectile it launched (at its spawn point). */
function playOut(piece: Piece, seconds = 16): Projectile[] {
  const born = new Map<number, Projectile>();
  const grab = () => {
    watch(piece.sim.state, piece);
    // a projectile has already moved once on the tick it was born: step straight shots back to their spawn point
    for (const pr of piece.sim.state.projectiles)
      if (pr.pack === piece.key && pr.born === piece.sim.state.tick - 1 && !born.has(pr.id)) born.set(pr.id, { ...pr, x: pr.homing > 0 ? pr.x : r6(pr.x - pr.vx), y: pr.homing > 0 ? pr.y : r6(pr.y - pr.vy) });
  };
  grab();
  const end = piece.start + seconds * 60;
  while (piece.sim.state.tick < end && !resolved(piece.sim.state)) {
    stepImmortal(piece.sim);
    grab();
  }
  return [...born.values()];
}

describe('pattern pack: rows and the pool', () => {
  it('the unlock plan: spiral 1, gapRing 2, pincer 3, curtain 4, echoFan 5, crossfire 6, pulseRings 8, heavyLine 9, slowThenFast 11, stalkerPair 13', () => {
    expect(PACK_KEYS.map((k) => [k, PP[k].unlockWave])).toEqual([
      ['spiral', 1], ['gapRing', 2], ['pincer', 3], ['curtain', 4], ['echoFan', 5], ['crossfire', 6], ['pulseRings', 8], ['heavyLine', 9], ['slowThenFast', 11], ['stalkerPair', 13],
    ]);
    for (const k of PACK_KEYS) {
      expect(PP[k].weight, k).toBeGreaterThan(0);
      // no pack piece (the ones with blades least of all) before the existing blades' unlock wave
      expect(PP[k].unlockWave, k).toBeGreaterThanOrEqual(TUNING.patterns.blades.unlockWave);
    }
    expect(PACK_POINT_BLANK).toBe(CASTER_POINT_BLANK);
  });

  it('packWeight / packPick: locked rows never count, the rows are walked in PACK_KEYS order', () => {
    expect(packWeight(PP, 0)).toBe(0);
    expect(packPick(PP, 0, 0)).toBeNull();
    expect(packWeight(PP, 1)).toBe(PP.spiral.weight);
    expect(packPick(PP, 1, 0)).toBe('spiral');
    expect(packPick(PP, 1, PP.spiral.weight)).toBeNull(); // past the end: the director falls back as before
    expect(packWeight(PP, 2)).toBeCloseTo(PP.spiral.weight + PP.gapRing.weight, 12);
    expect(packPick(PP, 2, PP.spiral.weight + 1e-9)).toBe('gapRing');
    let r = 1e-9;
    for (const k of PACK_KEYS) {
      expect(packPick(PP, 99, r)).toBe(k);
      r += PP[k].weight;
    }
    expect(packWeight(PP, 99)).toBeCloseTo(PACK_KEYS.reduce((a, k) => a + PP[k].weight, 0), 12);
  });

  it('the existing pool is untouched: with every pack row at weight 0 the enabled run equals the production run (same draws)', () => {
    const pp = { ...PP } as Record<string, unknown>;
    for (const k of PACK_KEYS) pp[k] = { ...PP[k], weight: 0 };
    const zero = { ...PACK, patternPack: pp as unknown as Features['patternPack'] };
    for (const [seed, wave] of [[3, 0], [8, 6], [21, 14]] as const) {
      const a = new Sim(seed, 'hard', { hero: 'knight', startWave: wave, features: zero });
      const b = new Sim(seed, 'hard', { hero: 'knight', startWave: wave });
      for (const f of mulberryInputs(seed, 60 * 45)) {
        a.step(f);
        b.step(f);
      }
      expect(a.state.packQueue).toEqual([]);
      expect('packQueue' in b.state).toBe(false); // no new state while the block is off
      expect(JSON.stringify({ ...a.state, packQueue: undefined })).toBe(JSON.stringify(b.state));
    }
  });

  it('a piece is never picked before its unlock wave, and every piece is picked in a long night', { timeout: 60_000 }, () => {
    const seen = new Map<PackKey, number>();
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Sim(seed * 131, 'hard', { hero: 'wisp', features: PACK, bosses: false });
      while (sim.state.tick < 60 * 15 * 18) {
        for (const e of stepImmortal(sim, botInput(sim)))
          if (e.type === 'pack') {
            expect(sim.state.wave, e.key).toBeGreaterThanOrEqual(PP[e.key].unlockWave);
            seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
          }
      }
    }
    for (const k of PACK_KEYS) expect(seen.get(k) ?? 0, k).toBeGreaterThan(0);
  });
});

describe('pattern pack: never during a boss intro or fight', () => {
  it('no piece starts from the boss intro to the end of the break; queued emissions finish; pieces start again after', { timeout: 60_000 }, () => {
    let fights = 0;
    let picksOutside = 0;
    for (const [seed, wave] of [[1, 2], [2, 6], [3, 10], [4, 14], [5, 6], [6, 10]] as const) {
      const sim = new Sim(seed * 977, 'hard', { hero: 'knight', startWave: wave, features: PACK });
      let bossStart = -1;
      let after = 0;
      while (sim.state.tick < 60 * 150 && after < 60 * 20) {
        const fighting = sim.state.boss !== null || sim.state.breakUntil > sim.state.tick; // before the step
        const events = stepImmortal(sim, botInput(sim));
        const s = sim.state;
        const picked = events.filter((e) => e.type === 'pack').length;
        if (events.some((e) => e.type === 'boss_intro')) {
          bossStart = s.tick;
          fights++;
        }
        if (fighting || s.boss !== null) expect(picked, `seed ${seed} tick ${s.tick}`).toBe(0);
        else picksOutside += picked;
        if (s.boss && bossStart >= 0 && s.tick - bossStart > 60 * 6) {
          // whatever was queued before the intro is long finished (the longest piece lasts under 6 s)
          expect(s.packQueue).toEqual([]);
          expect(s.casters.filter((c) => c.pack).length).toBe(0);
          expect(s.projectiles.filter((pr) => pr.pack && pr.kind !== 'wraith').length).toBe(0);
        }
        if (bossStart >= 0 && !s.boss && s.breakUntil <= s.tick) after++;
      }
      expect(bossStart, `seed ${seed}: the boss came`).toBeGreaterThan(0);
      expect(after, `seed ${seed}: the fight ended`).toBeGreaterThan(0);
    }
    expect(fights).toBeGreaterThanOrEqual(6);
    expect(picksOutside).toBeGreaterThan(20);
  });
});

describe('pattern pack: fairness and the colour language', () => {
  it('no pack projectile appears within 60 px of the hero without a cue of >= 15 ticks; violet parryable, red = blades only', { timeout: 120_000 }, () => {
    const fair = TUNING.fairness.minSpawnDistance;
    const spawned = new Map<PackKey, number>();
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      for (let seed = 1; seed <= 8; seed++) {
        const sim = new Sim(seed * 53 + 1, d, { hero: seed % 2 ? 'knight' : 'wisp', startWave: [1, 3, 5, 8, 11, 13, 16, 24][seed - 1]!, features: PACK });
        const bot = new SkilledBot(seed);
        while (sim.state.tick < 60 * 100) {
          const events = stepImmortal(sim, bot.input(sim));
          const s = sim.state;
          for (const e of events) {
            if (e.type !== 'spawn') continue;
            const pr = s.projectiles.find((q) => q.id === e.id);
            if (!pr?.pack) continue;
            spawned.set(pr.pack, (spawned.get(pr.pack) ?? 0) + 1);
            expect(e.dist >= fair || e.telegraphTicks >= 15, `${d} seed ${seed} tick ${s.tick}: ${pr.pack} ${pr.kind} at ${e.dist.toFixed(1)} px, cue ${e.telegraphTicks} ticks`).toBe(true);
            expect(pr.parryable).toBe(pr.kind !== 'blade');
            if (pr.kind === 'blade') expect(['crossfire', 'stalkerPair']).toContain(pr.pack);
            else expect(['orb_small', 'orb_large', 'rune_shard', 'wraith']).toContain(pr.kind); // existing kinds only
          }
          for (const c of s.casters) {
            if (!c.pack || c.start !== s.tick - 1) continue;
            // the usual caster phases: telegraph, rise, idle, a wind-up of >= 15 ticks before anything is launched
            expect(c.kind).toBe('stalker');
            expect(c.appear - c.start).toBe(sim.params.casterTele + sim.params.casterRise);
            expect(c.fire - c.castStart).toBeGreaterThanOrEqual(15);
            for (const q of s.packQueue ?? []) if (q.op === 'aim' && q.x === c.x && q.y === c.y) expect(q.at - c.castStart).toBeGreaterThanOrEqual(15);
          }
          expect(s.casters.length).toBeLessThanOrEqual(TUNING.casters.maxActive);
          // at most one curtain on the field
          expect(new Set(s.projectiles.filter((pr) => pr.pack === 'curtain').map((pr) => pr.born)).size).toBeLessThanOrEqual(1);
        }
      }
    for (const k of PACK_KEYS) expect(spawned.get(k) ?? 0, k).toBeGreaterThan(0);
  });
});

describe('pattern pack: every piece alone (200 seeds each; centre, corners and edges; waves up to the caps)', () => {
  const wavesOf = (key: PackKey): number[] => [PP[key].unlockWave, PP[key].unlockWave + 2, 8, 12, 16, 24].filter((w) => w >= PP[key].unlockWave);

  for (const key of PACK_KEYS)
    it(`${key}: a walking hero (no parry, no dash) always has a way out; at most ${CAPS[key].projectiles} projectiles${CAPS[key].casters ? ` and ${CAPS[key].casters} casters` : ''}`, { timeout: 120_000 }, () => {
      const waves = wavesOf(key);
      const how: Record<string, number> = {};
      const stuck: string[] = [];
      for (let seed = 1; seed <= 200; seed++) {
        const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
        const wave = waves[seed % waves.length]!;
        const piece = startPiece(key, seed * 31 + 7, wave, hx, hy);
        expect(piece, `${key} seed ${seed} could not start`).not.toBeNull();
        const r = walkingSolver(piece!);
        how[r.how.split(' ')[0]!] = (how[r.how.split(' ')[0]!] ?? 0) + 1;
        if (!r.ok) stuck.push(`seed ${seed} ${spot} wave ${wave}`);
        // the entity cap of ONE instance
        playOut(piece!);
        expect(piece!.projectiles.size, `${key} seed ${seed}`).toBeLessThanOrEqual(CAPS[key].projectiles);
        expect(piece!.projectiles.size + piece!.casters.size, `${key} seed ${seed}`).toBeGreaterThan(0);
        expect(piece!.casters.size, `${key} seed ${seed}`).toBeLessThanOrEqual(CAPS[key].casters);
      }
      expect(stuck, `${key}: no walking-only way out`).toEqual([]);
      console.log(`walking solver, ${key}: ${JSON.stringify(how)}`);
    });

  it('the caps stay small', () => {
    expect(CAPS).toEqual({
      spiral: { projectiles: 16, casters: 0 }, gapRing: { projectiles: 20, casters: 0 }, pincer: { projectiles: 10, casters: 0 }, curtain: { projectiles: 28, casters: 0 },
      echoFan: { projectiles: 12, casters: 0 }, crossfire: { projectiles: 6, casters: 2 }, pulseRings: { projectiles: 36, casters: 0 }, heavyLine: { projectiles: 7, casters: 0 },
      slowThenFast: { projectiles: 3, casters: 0 }, stalkerPair: { projectiles: 14, casters: 2 },
    });
  });
});

describe('pattern pack: the shape of each piece', () => {
  /** Runs `check` on many isolated instances (different seeds, spots and waves). */
  function each(key: PackKey, check: (shots: Projectile[], piece: Piece, hero: { x: number; y: number }) => void, n = 40): void {
    for (let seed = 1; seed <= n; seed++) {
      const [, hx, hy] = SPOTS[seed % SPOTS.length]!;
      const piece = startPiece(key, seed * 17 + 3, PP[key].unlockWave + (seed % 12), hx, hy)!;
      expect(piece).not.toBeNull();
      check(playOut(piece), piece, { x: hx, y: hy });
    }
  }
  const onRune = (pr: Projectile): boolean => RUNES.some((r) => Math.hypot(pr.x - r.x, pr.y - r.y) < 4.01);

  it('spiral: small orbs from one glowing rune over 1.2 s, the first one at the hero, never sooner than the telegraph', () => {
    each('spiral', (shots, piece, hero) => {
      expect(shots.length).toBeGreaterThanOrEqual(PP.spiral.count);
      expect(shots.every((pr) => pr.kind === 'orb_small' && onRune(pr))).toBe(true);
      const t0 = Math.min(...shots.map((pr) => pr.born));
      expect(t0 - piece.start).toBeGreaterThanOrEqual(36);
      expect(Math.max(...shots.map((pr) => pr.born)) - t0).toBe(72);
      const first = shots.find((pr) => pr.born === t0)!;
      const rune = RUNES.find((r) => Math.hypot(first.x - r.x, first.y - r.y) < 4.01)!;
      expect(angDiff(ang(first), Math.atan2(hero.y - rune.y, hero.x - rune.x))).toBeLessThanOrEqual(PP.spiral.aimRad + 1e-6);
      // the direction keeps turning the same way by the same step
      const sorted = [...shots].sort((a, b) => a.born - b.born);
      const steps = sorted.slice(1).map((pr, i) => angDiff(ang(pr), ang(sorted[i]!)));
      for (const st of steps) expect(st).toBeCloseTo((PP.spiral.turns * 2 * Math.PI) / shots.length, 6);
    });
  });

  it('a hero standing EXACTLY on the rune: every rune piece still launches moving shots (never a zero vector)', () => {
    for (const key of ['spiral', 'gapRing', 'pulseRings'] as const) {
      let onIt = 0;
      for (let seed = 1; seed <= 80; seed++) {
        const rune = RUNES[seed % RUNES.length]!;
        const piece = startPiece(key, seed * 13 + 5, PP[key].unlockWave + 3, rune.x, rune.y)!;
        const lit = piece.sim.state.telegraphs[0]!;
        if (lit.x === rune.x && lit.y === rune.y) onIt++;
        const shots = playOut(piece);
        expect(shots.length, `${key} seed ${seed}`).toBeGreaterThanOrEqual(PP[key].count);
        for (const pr of shots) {
          expect(Number.isFinite(pr.x) && Number.isFinite(pr.y) && Number.isFinite(pr.vx) && Number.isFinite(pr.vy)).toBe(true);
          expect(Math.hypot(pr.vx, pr.vy), `${key} seed ${seed}`).toBeGreaterThan(0.5);
        }
        expect(resolved(piece.sim.state), `${key} seed ${seed}: nothing is left on the field`).toBe(true);
      }
      expect(onIt, key).toBeGreaterThan(0);
    }
  });

  it('gapRing: one ring of shards with exactly ONE gap of >= 0.5 rad, opened toward the hero', () => {
    expect(PP.gapRing.gapRad).toBeGreaterThanOrEqual(0.5);
    each('gapRing', (shots, _piece, hero) => {
      expect(shots.every((pr) => pr.kind === 'rune_shard' && onRune(pr))).toBe(true);
      expect(new Set(shots.map((pr) => pr.born)).size).toBe(1);
      const a = shots.map(ang).sort((x, y) => x - y);
      const gaps = a.map((v, i) => (i + 1 < a.length ? a[i + 1]! - v : a[0]! + 2 * Math.PI - v));
      const widest = Math.max(...gaps);
      expect(widest).toBeGreaterThanOrEqual(0.5);
      expect(widest).toBeCloseTo(PP.gapRing.gapRad, 6);
      expect(gaps.filter((g) => g >= 0.5).length).toBe(1);
      // the gap centre lies within gapAimRad of the direction from the rune to the hero
      const i = gaps.indexOf(widest);
      const centre = a[i]! + widest / 2;
      const rune = RUNES.find((r) => Math.hypot(shots[0]!.x - r.x, shots[0]!.y - r.y) < 4.01)!;
      expect(angDiff(centre, Math.atan2(hero.y - rune.y, hero.x - rune.x))).toBeLessThanOrEqual(PP.gapRing.gapAimRad + 1e-6);
    });
  });

  it('pincer: two fans of small orbs from OPPOSITE edges, both aimed at the hero, at least 60 px away', () => {
    each('pincer', (shots, _piece, hero) => {
      const origins = [...new Set(shots.map((pr) => `${pr.x},${pr.y}`))].map((o) => o.split(',').map(Number) as [number, number]);
      expect(origins.length).toBe(2);
      const [a, b] = origins as [[number, number], [number, number]];
      // opposite sides of the spawn rectangle: left / right (x 38 and 442) or top / bottom (y 17 and 253)
      expect((a[0] === 38 && b[0] === 442) || (a[0] === 442 && b[0] === 38) || (a[1] === 17 && b[1] === 253) || (a[1] === 253 && b[1] === 17)).toBe(true);
      for (const o of origins) {
        expect(Math.hypot(o[0] - hero.x, o[1] - hero.y)).toBeGreaterThanOrEqual(60);
        const f = shots.filter((pr) => pr.x === o[0] && pr.y === o[1]);
        expect(f.length).toBe(shots.length / 2);
        const mid = Math.atan2(f.reduce((s, pr) => s + pr.vy, 0), f.reduce((s, pr) => s + pr.vx, 0));
        expect(angDiff(mid, Math.atan2(hero.y - o[1], hero.x - o[0]))).toBeLessThanOrEqual(0.1 + 1e-6);
      }
    });
  });

  it('curtain: one straight line of violet large orbs from the far edge with ONE reachable gap', () => {
    each('curtain', (shots, piece, hero) => {
      expect(shots.every((pr) => pr.kind === 'orb_large' && pr.parryable)).toBe(true);
      expect(new Set(shots.map((pr) => pr.born)).size).toBe(1);
      const sideways = shots[0]!.vy === 0;
      expect(shots.every((pr) => (sideways ? pr.vy === 0 && pr.vx === shots[0]!.vx : pr.vx === 0 && pr.vy === shots[0]!.vy))).toBe(true);
      const line = sideways ? shots[0]!.x : shots[0]!.y;
      expect(shots.every((pr) => (sideways ? pr.x : pr.y) === line)).toBe(true);
      // it comes from the edge farther from the hero and moves toward the hero's side
      const dist = Math.abs((sideways ? hero.x : hero.y) - line);
      expect(dist).toBeGreaterThanOrEqual(sideways ? 202 : 118);
      expect(Math.sign(sideways ? shots[0]!.vx : shots[0]!.vy)).toBe(Math.sign((sideways ? hero.x : hero.y) - line));
      // neighbours are spacingPx apart except across ONE gap of >= gapPx; the ends leave no lane
      const at = shots.map((pr) => (sideways ? pr.y : pr.x)).sort((x, y) => x - y);
      const lo = sideways ? 27 : 48;
      const hi = sideways ? 243 : 432;
      const edges = [lo - PP.curtain.spacingPx / 2, ...at, hi + PP.curtain.spacingPx / 2];
      const wide = edges.slice(1).map((v, i) => [v - edges[i]!, (v + edges[i]!) / 2] as const).filter(([g]) => g > PP.curtain.spacingPx + 1e-6);
      expect(wide.length).toBe(1);
      expect(wide[0]![0]).toBeGreaterThanOrEqual(PP.curtain.gapPx);
      // the gap is within reachFraction of what the hero can walk before the line arrives (+ half a gap of slack)
      const speed = Math.abs(sideways ? shots[0]!.vx : shots[0]!.vy);
      const reach = PP.curtain.reachFraction * piece.sim.params.heroSpeed * (dist / speed);
      expect(Math.abs(wide[0]![1] - (sideways ? hero.y : hero.x))).toBeLessThanOrEqual(reach + PP.curtain.gapPx / 2 + PP.curtain.spacingPx);
    });
  });

  it('echoFan: a fan, then the same fan 0.5 s later from the same point, turned by half a ray gap', () => {
    each('echoFan', (shots, _piece, hero) => {
      const births = [...new Set(shots.map((pr) => pr.born))].sort((a, b) => a - b);
      expect(births.length).toBe(2);
      expect(births[1]! - births[0]!).toBe(30);
      const a = shots.filter((pr) => pr.born === births[0]).map(ang).sort((x, y) => x - y);
      const b = shots.filter((pr) => pr.born === births[1]).map(ang).sort((x, y) => x - y);
      expect(b.length).toBe(a.length);
      expect(new Set(shots.map((pr) => `${pr.x},${pr.y}`)).size).toBe(1);
      expect(Math.hypot(shots[0]!.x - hero.x, shots[0]!.y - hero.y)).toBeGreaterThanOrEqual(60);
      const rayGap = a.length > 1 ? PP.echoFan.arc / (a.length - 1) : PP.echoFan.arc;
      expect(angDiff(b[0]!, a[0]!)).toBeCloseTo(rayGap / 2, 6);
    });
  });

  it('crossfire: two stalkers on two different sides, the same cast, every shot a blade, the last one at the cast end', () => {
    each('crossfire', (shots, piece, hero) => {
      const st = piece.sim.state;
      expect(piece.casters.size).toBe(2);
      // a hero standing on a hollow makes that stalker's blades fizzle (point blank): checked in its own test below
      if (HOLLOWS.some((h) => Math.hypot(h.x - hero.x, h.y - hero.y) < PACK_POINT_BLANK + 10)) return;
      expect(shots.every((pr) => pr.kind === 'blade' && !pr.parryable)).toBe(true);
      const births = [...new Set(shots.map((pr) => pr.born))].sort((a, b) => a - b);
      const n = shots.length / 2;
      expect(Number.isInteger(n) && n >= PP.crossfire.count && n <= PP.crossfire.maxCount).toBe(true);
      expect(births.length).toBe(n);
      for (let i = 1; i < births.length; i++) expect(births[i]! - births[i - 1]!).toBe(15);
      // two muzzles near two hollows on different sides
      const sides = new Set(shots.map((pr) => HOLLOWS.map((h) => [Math.hypot(h.x - pr.x, h.y - pr.y), h.side] as const).sort((x, y) => x[0] - y[0])[0]![1]));
      expect(sides.size).toBe(2);
      expect(st.tick).toBeGreaterThan(piece.start);
    });
  });

  it('crossfire: no blade is launched at a hero standing next to the stalker (point blank, as for every caster)', () => {
    let fizzled = 0;
    for (let seed = 1; seed <= 60; seed++) {
      // (56, 139) is where the stalker of the left hollow at y 139 stands
      const piece = startPiece('crossfire', seed * 5 + 1, 6 + (seed % 20), 60, 139)!;
      const shots = playOut(piece);
      const near = shots.filter((pr) => Math.hypot(pr.x - 56, pr.y - 139) < 10);
      expect(near.length).toBe(0);
      if (shots.length < 2 * PP.crossfire.count) fizzled++;
    }
    expect(fizzled).toBeGreaterThan(0); // that hollow was really used
  });

  it('pulseRings: three full shard rings from one rune, 0.4 s apart, each turned by a third of the shard spacing', () => {
    each('pulseRings', (shots) => {
      expect(shots.every((pr) => pr.kind === 'rune_shard' && onRune(pr))).toBe(true);
      const births = [...new Set(shots.map((pr) => pr.born))].sort((a, b) => a - b);
      expect(births.length).toBe(PP.pulseRings.rings);
      const n = shots.length / births.length;
      const firsts = births.map((t) => shots.filter((pr) => pr.born === t).map(ang).sort((x, y) => x - y));
      for (let k = 0; k < births.length; k++) {
        if (k > 0) expect(births[k]! - births[k - 1]!).toBe(24);
        expect(firsts[k]!.length).toBe(n);
        for (let i = 1; i < n; i++) expect(firsts[k]![i]! - firsts[k]![i - 1]!).toBeCloseTo((2 * Math.PI) / n, 6);
      }
      const shift = (((firsts[1]![0]! - firsts[0]![0]!) % ((2 * Math.PI) / n)) + (2 * Math.PI) / n) % ((2 * Math.PI) / n);
      expect(shift).toBeCloseTo((2 * Math.PI) / n / PP.pulseRings.rings, 6);
    });
  });

  it('heavyLine: large orbs from points along one far edge, parallel, launched one after another', () => {
    each('heavyLine', (shots, _piece, hero) => {
      expect(shots.every((pr) => pr.kind === 'orb_large')).toBe(true);
      expect(shots.length).toBeGreaterThanOrEqual(PP.heavyLine.count);
      const sorted = [...shots].sort((a, b) => a.born - b.born);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.born - sorted[i - 1]!.born).toBe(9);
        expect(sorted[i]!.vx).toBe(sorted[0]!.vx);
        expect(sorted[i]!.vy).toBe(sorted[0]!.vy);
        expect(Math.hypot(sorted[i]!.x - sorted[i - 1]!.x, sorted[i]!.y - sorted[i - 1]!.y)).toBeCloseTo(PP.heavyLine.spacingPx, 6);
      }
      for (const pr of shots) expect(Math.hypot(pr.x - hero.x, pr.y - hero.y)).toBeGreaterThanOrEqual(60);
    });
  });

  it('slowThenFast: two wraiths, then 1.2 s later one fast small orb from far away', () => {
    each('slowThenFast', (shots, piece, hero) => {
      const wraiths = shots.filter((pr) => pr.kind === 'wraith');
      const orbs = shots.filter((pr) => pr.kind === 'orb_small');
      expect(wraiths.length).toBe(PP.slowThenFast.wraiths);
      expect(orbs.length).toBe(1);
      expect(shots.length).toBe(PP.slowThenFast.wraiths + 1);
      expect(wraiths.every((w) => w.homing > 0 && w.born === wraiths[0]!.born)).toBe(true);
      expect(orbs[0]!.born - wraiths[0]!.born).toBe(72);
      expect(Math.hypot(orbs[0]!.x - hero.x, orbs[0]!.y - hero.y)).toBeGreaterThanOrEqual(PP.slowThenFast.minDist); // the hero stood still
      const normal = piece.sim.params.smallSpeed;
      expect(orbs[0]!.speed / normal).toBeGreaterThanOrEqual(PP.slowThenFast.fastFactor - 1e-9);
      // a standing hero has no drift: the orb is aimed straight at it
      expect(angDiff(ang(orbs[0]!), Math.atan2(hero.y - orbs[0]!.y, hero.x - orbs[0]!.x))).toBeLessThan(1e-6);
    });
  });

  it('slowThenFast: the fast orb leads a walking hero', () => {
    const piece = startPiece('slowThenFast', 99, 11, 100, 135)!;
    let orb: Projectile | undefined;
    for (let i = 0; i < 80 && !orb; i++) {
      stepImmortal(piece.sim, { cursor: false, mx: 100, my: 0, buttons: 0 }); // walking right
      orb = piece.sim.state.projectiles.find((pr) => pr.pack === 'slowThenFast' && pr.kind === 'orb_small');
    }
    expect(orb).toBeDefined();
    const h = piece.sim.state.hero;
    // aimed AHEAD of the hero (to its right), not at it
    const toHero = Math.atan2(h.y - orb!.y, h.x - orb!.x);
    const ahead = Math.atan2(h.y - orb!.y, h.x + 40 - orb!.x);
    expect(angDiff(ang(orb!), toHero)).toBeGreaterThan(0.01);
    expect(angDiff(ang(orb!), ahead)).toBeLessThan(angDiff(toHero, ahead) + 0.2);
  });

  it('stalkerPair: two stalkers, the second casts 0.7 s after the first; the first attack is violet', () => {
    each('stalkerPair', (_shots, piece) => {
      expect(piece.casters.size).toBe(2);
    });
    for (let seed = 1; seed <= 30; seed++) {
      const piece = startPiece('stalkerPair', seed * 7, 13, 240, 135)!;
      const cs = piece.sim.state.casters.filter((c) => c.pack === 'stalkerPair').sort((a, b) => a.fire - b.fire);
      expect(cs.length).toBe(2);
      expect(cs[0]!.source).not.toBe(cs[1]!.source);
      expect(cs[1]!.fire - cs[0]!.fire).toBe(42);
      expect(['orbFan', 'shardFan']).toContain(cs[0]!.attack);
      expect(['orbFan', 'shardFan', 'blade']).toContain(cs[1]!.attack);
    }
  });
});

describe('pattern pack: determinism, replays and the verifier', () => {
  it('the enabled variant is deterministic and replays exactly under its own flags', () => {
    for (const [seed, hero] of [[11, 'knight'], [12, 'wisp']] as const) {
      const run = () => {
        const sim = new Sim(seed, 'hard', { hero, features: PACK });
        const bot = new SkilledBot(seed);
        let picks = 0;
        while (sim.state.alive && sim.state.tick < 60 * 120) {
          sim.step(bot.input(sim));
          picks += sim.state.events.filter((e) => e.type === 'pack').length;
        }
        return { sim, picks };
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(b.sim.state)).toBe(JSON.stringify(a.sim.state));
      expect(a.picks).toBeGreaterThan(0);
      const replay = JSON.parse(JSON.stringify(encodeReplay(seed, 'hard', hero, a.sim.log, undefined, PACK)));
      const again = playReplay(replay, { features: PACK });
      expect(again.score).toBe(a.sim.score);
      expect(again.state.tick).toBe(a.sim.state.tick);
      expect(() => playReplay(replay)).toThrow(/different tuning/);
    }
  });

  it('a variant run can never be verified as a production run', () => {
    const date = '2026-11-14';
    const seed = dailySeed(date);
    const record = (features: Features) => {
      const sim = new Sim(seed, 'hard', { hero: 'wisp', features });
      const bot = new SkilledBot(5);
      let picks = 0;
      while (sim.state.alive && sim.state.tick < 60 * 600) {
        sim.step(bot.input(sim));
        picks += sim.state.events.filter((e) => e.type === 'pack').length;
      }
      expect(sim.state.alive).toBe(false);
      const item: PendingItem = { id: '1-1', date, seed, difficulty: 'hard', durationTicks: sim.state.tick, score: sim.score, hero: 'wisp', tuningFingerprint: tuningHash(features), clientVersion: CLIENT_VERSION, replay: encodeInputLog(sim.log, 'wisp') };
      return { item, picks };
    };
    // control: the same bot under the production flags verifies
    expect(verifyItem(record(FEATURES).item)).toEqual({ status: 'verified' });
    const v = record(PACK);
    expect(v.picks).toBeGreaterThan(0);
    expect(v.item.tuningFingerprint).not.toBe(tuningFingerprint());
    // honest about its flags: another version's run, never verified
    expect(verifyItem(v.item)).toEqual({ status: 'rejected', reason: 'outdated' });
    // lying about them: the production rules do not reproduce the run
    const forged = verifyItem({ ...v.item, tuningFingerprint: tuningFingerprint() });
    expect(forged.status).toBe('rejected');
    expect(['length_mismatch', 'score_mismatch']).toContain((forged as { reason: string }).reason);
  });
});
