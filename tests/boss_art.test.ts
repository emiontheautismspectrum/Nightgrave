/**
 * Boss art stage (ART-B): the new art is DARK. A production run draws exactly the sprites it drew before (the Eye and
 * the old `lich_mage_*`), a flagged run draws the new families; every frame the render can ask for exists in the
 * atlas; the art is byte-identical on a re-run. Render only reads the sim.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import atlas from '../assets/atlas/nightgrave.json';
import manifest from '../assets/atlas/manifest.json';
import { FEATURES, withFeatures, type Features } from '../src/data/features';
import { TICK_RATE } from '../src/data/tuning';
import { BossMemo, bossFx, bossLook, bossPose, CAST_ROW, eyeLean, ringRuns, useNewBossArt, type BossPose } from '../src/render/bossArt';
import { edgeMarkers } from '../src/render/edgeMarkers';
import { makeParams, ticks, type SimParams } from '../src/sim/params';
import { Sim } from '../src/sim/sim';
import { inRingGap, ringGap } from '../src/sim/tollerMoves';
import type { Boss, BossKind, Ring, SimState } from '../src/sim/state';
import { SkilledBot } from './skilled';

const FRAMES = atlas.frames as Record<string, { frame: { w: number; h: number }; trimmed: boolean; sourceSize: { w: number; h: number } }>;
const SPRITES = manifest.sprites as Record<string, { w: number; h: number; frames: number; group: string }>;
const ALL = withFeatures('bosses', 'bossOrder', 'bossMotion', 'bossMoves');

/**
 * FROZEN: the body's frame choice of src/render/BossView.ts before the boss art stage (main at 0.10.0), copied line
 * for line. The production path must keep returning exactly this.
 */
const OLD_LOOK: Record<'eye' | 'lich', { name: string; originY: number; dy: number; box: number[]; hovers: boolean }> = {
  eye: { name: 'eye_sentinel', originY: 0.5, dy: 0, box: [-22, -20, 22, 22], hovers: true },
  lich: { name: 'lich_mage', originY: 1, dy: 4, box: [-12, -36, 12, 4], hovers: false },
};
function frozen(st: SimState, p: SimParams, b: Boss): [string, number, number, number] {
  const HIT_TICKS = 8;
  const t = st.tick;
  const name = OLD_LOOK[b.kind as 'eye' | 'lich'].name;
  const eye = b.kind === 'eye';
  const lich = b.kind === 'lich';
  const a = b.attack;
  const prog = (s0: number, s1: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(((t - s0) / Math.max(1, s1 - s0)) * n)));
  let f: [string, number];
  let alpha = 1;
  let rise = 0;
  const idle = (): [string, number] => [`${name}_idle`, (t >> 3) & 3];
  if (b.deathTick >= 0) f = [`${name}_death`, prog(b.deathTick, b.deathTick + ticks(p.bosses.deathSeconds), 6)];
  else if (t < b.introEnd) {
    if (eye) {
      f = [`${name}_idle`, (t >> 3) & 3];
      rise = Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 40);
      alpha = Math.min(1, (t - b.start) / 40);
    } else f = [`${name}_teleport_in`, prog(b.start, b.introEnd, 4)];
  } else if (b.hitTick >= 0 && t - b.hitTick < HIT_TICKS) f = [`${name}_hit`, (t - b.hitTick) < HIT_TICKS / 2 ? 0 : 1];
  else if (a && lich && t < a.tpIn) f = [`${name}_teleport_out`, prog(a.tpOut, a.tpIn, 4)];
  else if (a && lich && t < a.windStart) f = [`${name}_teleport_in`, prog(a.tpIn, a.windStart, 4)];
  else if (a && t >= a.windStart) f = [eye ? `${name}_charge` : `${name}_cast`, prog(a.windStart, a.fire, eye ? 3 : 4)];
  else f = idle();
  return [f[0], f[1], alpha, rise];
}

interface Seen {
  body: Set<string>;
  fx: Set<string>;
  poses: BossPose[];
}

/** Run a fight (the hero kept alive, a skilled bot playing) and feed the view's pure parts exactly as BossView does. */
function watch(features: Features, kind: BossKind | null, seed: number, seconds: number, each?: (sim: Sim, pose: BossPose | null, memo: BossMemo) => void): Seen {
  const sim = new Sim(seed, 'hard', { hero: seed % 2 ? 'wisp' : 'knight', features, startWave: 3, ...(kind ? { firstBoss: kind } : {}) });
  const bot = new SkilledBot(3);
  const memo = new BossMemo();
  const seen: Seen = { body: new Set(), fx: new Set(), poses: [] };
  while (sim.state.tick < seconds * TICK_RATE) {
    sim.state.alive = true;
    sim.step(bot.input(sim));
    for (const e of sim.state.events) memo.onEvent(e, sim.state);
    memo.observe(sim.state);
    const pose = bossPose(sim.state, sim.params, memo);
    if (pose) {
      seen.poses.push(pose);
      if (pose.visible) seen.body.add(pose.key);
      expect(FRAMES[`${pose.key}_${pose.frame}`], `${pose.key}_${pose.frame}`).toBeDefined();
    }
    for (const s of bossFx(sim.state, sim.params, memo)) {
      seen.fx.add(s.key);
      expect(FRAMES[`${s.key}_${s.frame}`], `${s.key}_${s.frame}`).toBeDefined();
    }
    each?.(sim, pose, memo);
  }
  return seen;
}

describe('boss art: which art a run draws', () => {
  it('useNewBossArt: off in production and for the blocks that are not bosses; on for any boss row, motion or moves', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) for (const h of ['knight', 'wisp'] as const) expect(useNewBossArt(makeParams(d, h))).toBe(false);
    expect(useNewBossArt(makeParams('hard', 'knight', FEATURES))).toBe(false);
    for (const f of ['patternPack', 'knot', 'briar', 'bossOrder'] as const) expect(useNewBossArt(makeParams('hard', 'knight', withFeatures(f)))).toBe(false);
    for (const f of ['thorn', 'toller', 'bosses', 'bossMotion', 'bossMoves'] as const) expect(useNewBossArt(makeParams('hard', 'knight', withFeatures(f)))).toBe(true);
  });

  it('the looks: production keeps the old families, origins and boxes; the flagged Lich is the new family', () => {
    for (const k of ['eye', 'lich'] as const) {
      const L = bossLook(k, false);
      expect({ name: L.name, originY: L.originY, dy: L.dy, box: L.box, hovers: L.hovers }).toEqual(OLD_LOOK[k]);
      expect(L.originX).toBe(0.5);
      expect(L.base).toBeUndefined(); // sorted by the box's bottom, as before
    }
    expect(bossLook('eye', true)).toEqual(bossLook('eye', false)); // the Eye keeps its art
    expect(bossLook('lich', true).name).toBe('lich_king');
    expect(bossLook('thorn', true).name).toBe('thorn_mother');
    expect(bossLook('toller', true).name).toBe('toller');
    // every body stays <= 64 px high; the box of a redrawn body covers its sprite around its origin
    for (const k of ['eye', 'lich', 'thorn', 'toller'] as const) {
      const L = bossLook(k, true);
      const S = SPRITES[`${L.name}_idle`]!;
      expect(S.h).toBeLessThanOrEqual(64);
      expect(S.w).toBeLessThanOrEqual(48);
      if (k === 'eye') continue; // its old (loose) box is kept
      expect(L.box[0]).toBeLessThanOrEqual(-Math.floor(S.w * L.originX) + 4);
      expect(L.box[2]).toBeGreaterThanOrEqual(Math.ceil(S.w * (1 - L.originX)) - 4);
      expect(L.box[1]).toBeLessThanOrEqual(-Math.floor(S.h * L.originY) + L.dy + 2);
      expect(L.box[3]).toBeGreaterThanOrEqual(Math.ceil(S.h * (1 - L.originY)) + L.dy - 2);
    }
  });
});

describe('boss art: production is unchanged', () => {
  it('a production run draws exactly the old keys, frames, alpha and rise, and no effect sprite (both bosses, whole fights)', () => {
    const old = /^(eye_sentinel_(idle|charge|hit|death)|lich_mage_(idle|cast|teleport_out|teleport_in|hit|death))$/;
    const all = new Set<string>();
    for (const [kind, seed] of [['eye', 5], ['lich', 6], [null, 7], ['lich', 8]] as const) {
      const seen = watch(FEATURES, kind, seed, 75, (sim, pose) => {
        const b = sim.state.boss;
        expect(useNewBossArt(sim.params)).toBe(false);
        if (!b) return expect(pose).toBeNull();
        const [key, frame, alpha, rise] = frozen(sim.state, sim.params, b);
        expect(pose).toEqual({ key, frame, alpha, rise, dx: 0, dy: 0, visible: true });
        expect(key).toMatch(old);
        expect(bossFx(sim.state, sim.params, new BossMemo())).toEqual([]);
      });
      for (const k of seen.body) all.add(k);
      expect(seen.fx.size).toBe(0);
    }
    // the runs really showed both old bosses in every state
    for (const k of ['eye_sentinel_idle', 'eye_sentinel_charge', 'eye_sentinel_hit', 'lich_mage_idle', 'lich_mage_cast', 'lich_mage_teleport_out', 'lich_mage_teleport_in', 'lich_mage_hit'])
      expect(all, k).toContain(k);
    for (const k of all) expect(k).toMatch(old);
  });

  it('the old sprites are still in the atlas, whole (never trimmed), with their sizes', () => {
    const old: Record<string, [number, number, number]> = {
      eye_sentinel_idle: [48, 48, 4], eye_sentinel_charge: [48, 48, 3], eye_sentinel_hit: [48, 48, 2], eye_sentinel_death: [48, 48, 6], eye_beam: [16, 4, 2],
      lich_mage_idle: [32, 40, 4], lich_mage_cast: [32, 40, 4], lich_mage_teleport_out: [32, 40, 4], lich_mage_teleport_in: [32, 40, 4], lich_mage_hit: [32, 40, 2], lich_mage_death: [32, 40, 6],
    };
    for (const [n, [w, h, c]] of Object.entries(old)) {
      expect([SPRITES[n]!.w, SPRITES[n]!.h, SPRITES[n]!.frames]).toEqual([w, h, c]);
      for (let i = 0; i < c; i++) expect([FRAMES[`${n}_${i}`]!.frame.w, FRAMES[`${n}_${i}`]!.frame.h, FRAMES[`${n}_${i}`]!.trimmed]).toEqual([w, h, false]);
    }
  });

  it('the code-drawn telegraphs of the old bosses are the same lines of BossView (beam line, spawn circles)', () => {
    const src = readFileSync(new URL('../src/render/BossView.ts', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    expect(src).toContain("case 'beam': case 'pendulum': this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1); this.gfx.lineBetween(b.x, b.y, b.x + a.dirX * 440, b.y + a.dirY * 440); break;");
    expect(src).toContain("case 'spawns': this.gfx.lineStyle(1, COL.violet, 1); for (const [x, y] of a.points) this.gfx.strokeCircle(Math.round(x), Math.round(y), Math.max(2, Math.round(8 - k * 6))); break;");
    // and the old Lich's keys are still what the production path asks for
    expect(readFileSync(new URL('../src/render/bossArt.ts', import.meta.url), 'utf8')).toContain("name: 'lich_mage'");
  });
});

describe('boss art: a flagged run draws the new families', () => {
  it('the Lich: only lich_king rows (never the old art), with the grasp row, the bone hands and the soulfire embers', () => {
    const body = new Set<string>();
    const fx = new Set<string>();
    for (const seed of [21, 22, 23]) {
      const seen = watch(ALL, 'lich', seed, 60, (sim, pose) => {
        if (sim.state.boss?.kind === 'lich') expect(pose!.key).toMatch(/^lich_king_/);
      });
      for (const k of seen.body) body.add(k);
      for (const k of seen.fx) fx.add(k);
    }
    for (const k of ['lich_king_idle', 'lich_king_cast', 'lich_king_grasp', 'lich_king_teleport_out', 'lich_king_teleport_in', 'lich_king_hit']) expect(body, k).toContain(k);
    for (const k of ['bone_hand', 'grasp_crack', 'lich_king_soulfire']) expect(fx, k).toContain(k);
    for (const k of body) expect(k).not.toMatch(/^lich_mage_/);
  });

  it('the Lich with ONE flag (any boss row, motion or moves alone) is already the new family', () => {
    for (const f of ['thorn', 'bossMotion', 'bossMoves'] as const) {
      const seen = watch(withFeatures(f), 'lich', 31, 20);
      expect([...seen.body].every((k) => k.startsWith('lich_king_'))).toBe(true);
      expect(seen.body.size).toBeGreaterThan(1);
    }
  });

  it('the Thorn Mother: idle 6f, cast, hedge, sink and emerge; under the ground she is not drawn', () => {
    const body = new Set<string>();
    let hidden = 0;
    let moved = 0;
    let sunkAt: [number, number] | null = null;
    const idleFrames = new Set<number>();
    for (const seed of [41, 42, 43]) {
      const seen = watch(ALL, 'thorn', seed, 70, (sim, pose) => {
        const b = sim.state.boss;
        if (!b || b.kind !== 'thorn' || !pose) return;
        const a = b.attack;
        const t = sim.state.tick;
        if (pose.key === 'thorn_mother_idle') idleFrames.add(pose.frame);
        const busy = b.deathTick >= 0 || t < b.introEnd || (b.hitTick >= 0 && t - b.hitTick < 8);
        if (a && a.tpIn > a.tpOut && t < a.windStart && !busy) {
          // the sim's phases drive it: [tpOut, tpIn] the sink row, its last slot under the ground (the state drawn AT
          // tpIn still holds the old spot: she must not show there); (tpIn, windStart) the emerge row at the new spot
          if (t <= a.tpIn) {
            expect(pose.key).toBe('thorn_mother_sink');
            if (t >= a.tpIn - 1) expect(pose.visible).toBe(false);
            if (t === a.tpOut) expect([pose.visible, pose.frame]).toEqual([true, 0]);
            sunkAt = [b.x, b.y];
          } else {
            expect(pose.key).toBe('thorn_mother_emerge');
            expect(pose.visible).toBe(true);
            if (t === a.tpIn + 1 && sunkAt) moved += Math.hypot(b.x - sunkAt[0], b.y - sunkAt[1]) > 1 ? 1 : 0;
          }
        } else expect(pose.visible).toBe(true);
        if (!pose.visible) hidden++;
        expect(pose.alpha).toBe(1); // the new rows fade by their own dither, never by alpha
      });
      for (const k of seen.body) body.add(k);
    }
    for (const k of ['thorn_mother_idle', 'thorn_mother_cast', 'thorn_mother_lash', 'thorn_mother_hedge', 'thorn_mother_sink', 'thorn_mother_emerge', 'thorn_mother_hit']) expect(body, k).toContain(k);
    expect(hidden).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0); // she is first seen again at the NEW spot
    expect([...idleFrames].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('the Toller: the bell keeps its beat, the throw row casts the chain, the peal fades it out and in; chain links and coils', () => {
    const body = new Set<string>();
    const fx = new Set<string>();
    for (const seed of [51, 52, 53, 54, 55, 56]) {
      const seen = watch(ALL, 'toller', seed, 70, (sim, pose) => {
        const b = sim.state.boss;
        if (!b || b.kind !== 'toller' || !pose) return;
        const a = b.attack;
        if (pose.key === 'toller_throw') expect(a?.pattern).toBe('chains');
        if (a && a.pattern === 'chains' && pose.key !== 'toller_hit' && pose.key !== 'toller_tp_in' && sim.state.tick >= a.windStart && b.deathTick < 0) expect(pose.key).toBe('toller_throw');
      });
      for (const k of seen.body) body.add(k);
      for (const k of seen.fx) fx.add(k);
    }
    for (const k of ['toller_idle', 'toller_cast', 'toller_strike', 'toller_throw', 'toller_tp_in', 'toller_hit']) expect(body, k).toContain(k);
    expect(fx).toContain('toller_tp_out');
    expect([...fx].some((k) => k === 'chain_iron' || k === 'chain_violet')).toBe(true);
    expect([...fx].some((k) => k === 'chain_wrap_iron' || k === 'chain_wrap_violet')).toBe(true);
  });

  it('colour language: a red (unparryable) attack never winds up on the violet cast row; the hands show to the launch tick, over the props', () => {
    // the patterns the edge markers call red are exactly the ones with a row of their own (the Eye keeps its charge row)
    const red = ['pendulum', 'knell', 'lash', 'hedge', 'peal', 'echo', 'grasp'] as const;
    for (const k of red) expect(CAST_ROW[k], k).toBeDefined();
    expect(Object.keys(CAST_ROW).sort()).toEqual([...red, 'chains'].sort());
    let redWinds = 0;
    let fireTicks = 0;
    for (const [kind, seed] of [['thorn', 44], ['toller', 57], ['lich', 24]] as const)
      watch(ALL, kind, seed, 60, (sim, pose, memo) => {
        const b = sim.state.boss;
        const a = b?.attack;
        if (!b || !a || !pose || b.kind === 'eye') return;
        const t = sim.state.tick;
        const m = edgeMarkers(sim.state, sim.params, { x0: b.x + 200, y0: 0, x1: b.x + 300, y1: 270 }, 90).find((x) => x.key === 'b');
        if (/_(cast)$/.test(pose.key)) expect(m?.color, `${a.pattern} on ${pose.key}`).not.toBe('red');
        if (m?.color === 'red' && /_(lash|hedge|grasp|strike)$/.test(pose.key)) redWinds++;
        if (a.pattern === 'grasp' && t >= a.windStart && t <= a.fire && b.deathTick < 0) {
          const fx = bossFx(sim.state, sim.params, memo);
          expect(fx.filter((s) => s.key === 'bone_hand').length).toBeGreaterThanOrEqual(a.points.length);
          expect(fx.filter((s) => s.key === 'grasp_crack').length).toBeGreaterThanOrEqual(a.points.length);
          for (const s of fx) if (s.key === 'bone_hand' || s.key === 'grasp_crack') expect(s.base).toBe('over');
          if (t === a.fire) fireTicks++;
        }
      });
    expect(redWinds).toBeGreaterThan(0);
    expect(fireTicks).toBeGreaterThan(0);
  });

  it('the Eye keeps its art; with the motion it leans 1-2 whole px against its velocity, never without it', () => {
    let leaned = 0;
    const seen = watch(ALL, 'eye', 61, 40, (sim, pose, memo) => {
      const b = sim.state.boss;
      if (!b || b.kind !== 'eye' || !pose) return;
      expect(pose.key).toMatch(/^eye_sentinel_(idle|charge|hit|death)$/);
      expect(Number.isInteger(pose.dx) && Number.isInteger(pose.dy)).toBe(true);
      expect(Math.abs(pose.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(pose.dy)).toBeLessThanOrEqual(2);
      if (pose.dx) {
        leaned++;
        expect(Math.sign(pose.dx)).toBe(-Math.sign(memo.vx));
      }
      const still = bossPose(sim.state, sim.params, memo, false)!; // EFFECTS LOW: no render motion
      expect([still.dx, still.dy]).toEqual([0, 0]);
      expect([still.key, still.frame, still.rise]).toEqual([pose.key, pose.frame, pose.rise]);
    });
    expect(leaned).toBeGreaterThan(0);
    expect(seen.fx.size).toBe(0);
    expect(eyeLean(0, 0)).toEqual([0, 0]);
    expect(eyeLean(0.2, -0.2)).toEqual([-1, 1]);
    expect(eyeLean(5, -5)).toEqual([-2, 2]);
  });

  it('render never changes the sim: the same run with and without the view has the same state', () => {
    const plain = new Sim(77, 'hard', { hero: 'wisp', features: ALL, startWave: 3, firstBoss: 'toller' });
    const bot = new SkilledBot(3);
    for (let i = 0; i < 40 * TICK_RATE; i++) {
      plain.state.alive = true;
      plain.step(bot.input(plain));
    }
    let viewed: Sim | null = null;
    watch(ALL, 'toller', 77, 40, (sim) => {
      viewed = sim;
    });
    expect(JSON.stringify(viewed!.state)).toBe(JSON.stringify(plain.state));
  });

  it('a paused state drawn again keeps the memo (no lean flicker, no second teleport)', () => {
    const sim = new Sim(61, 'hard', { hero: 'wisp', features: ALL, startWave: 3, firstBoss: 'eye' });
    const bot = new SkilledBot(3);
    const memo = new BossMemo();
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      sim.state.alive = true;
      sim.step(bot.input(sim));
      memo.observe(sim.state);
    }
    const before = [memo.vx, memo.vy, memo.tick];
    memo.observe(sim.state);
    memo.observe(sim.state);
    expect([memo.vx, memo.vy, memo.tick]).toEqual(before);
  });
});

describe('boss art: atlas', () => {
  const NEW: Record<string, [number, number, number]> = {
    thorn_mother_idle: [48, 64, 6], thorn_mother_cast: [48, 64, 4], thorn_mother_lash: [48, 64, 4], thorn_mother_hedge: [48, 64, 4], thorn_mother_hit: [48, 64, 2],
    thorn_mother_death: [48, 64, 6], thorn_mother_sink: [48, 64, 6], thorn_mother_emerge: [48, 64, 6],
    lich_king_idle: [40, 64, 6], lich_king_cast: [40, 64, 4], lich_king_grasp: [40, 64, 4], lich_king_hit: [40, 64, 2], lich_king_death: [40, 64, 6],
    lich_king_teleport_out: [40, 64, 4], lich_king_teleport_in: [40, 64, 4], lich_king_soulfire: [40, 40, 6],
    bone_hand: [16, 16, 4], grasp_crack: [24, 24, 4],
    toller_idle: [40, 56, 4], toller_cast: [40, 56, 4], toller_hit: [40, 56, 2], toller_death: [40, 56, 6],
    toller_tp_out: [40, 56, 4], toller_tp_in: [40, 56, 4], toller_throw: [40, 56, 4], toller_strike: [40, 56, 4],
    chain_iron: [8, 8, 2], chain_violet: [8, 8, 2], chain_wrap_iron: [16, 16, 2], chain_wrap_violet: [16, 16, 2],
  };

  it('every new frame name exists in the atlas JSON with its source size; the atlas is still 512 x 1024', () => {
    for (const [n, [w, h, c]] of Object.entries(NEW)) {
      expect([SPRITES[n]?.w, SPRITES[n]?.h, SPRITES[n]?.frames, SPRITES[n]?.group], n).toEqual([w, h, c, 'gameplay']);
      for (let i = 0; i < c; i++) {
        const f = FRAMES[`${n}_${i}`];
        expect(f, `${n}_${i}`).toBeDefined();
        expect([f!.sourceSize.w, f!.sourceSize.h]).toEqual([w, h]);
        expect(f!.frame.w * f!.frame.h).toBeGreaterThan(0);
      }
    }
    expect(atlas.meta.size).toEqual({ w: 512, h: 1024 });
  });

  it('only the dark boss frames are stored trimmed; every other frame is whole', () => {
    const trim = /^(thorn_mother_|lich_king_|toller_tp_|toller_throw|toller_strike)/;
    let trimmed = 0;
    for (const [n, f] of Object.entries(FRAMES)) {
      if (f.trimmed) {
        trimmed++;
        expect(n).toMatch(trim);
      } else expect([f.frame.w, f.frame.h]).toEqual([f.sourceSize.w, f.sourceSize.h]);
    }
    expect(trimmed).toBeGreaterThan(20);
  });
});

describe('boss art: the ring raster', () => {
  const ring = (r: number, gaps: Ring['gaps'] = [], x = 240, y = 135): Ring =>
    ({ id: 1, serial: 1, echo: false, x, y, r, startR: 8, maxR: 0, speed: 1, back: 0, halfWidth: 2, phase: 'grow', holdStart: -1, holdUntil: -1, gaps, paid: false, near: -1 });
  const pixels = (rg: Ring, clip: [number, number, number, number] = [0, 0, 480, 270]): Map<string, string> => {
    const px = new Map<string, string>();
    let runs = 0;
    ringRuns(rg, clip, (x, y, w, tone) => {
      runs++;
      expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && w > 0).toBe(true);
      expect(x >= clip[0] && x + w <= clip[2] && y >= clip[1] && y < clip[3]).toBe(true);
      for (let i = 0; i < w; i++) {
        expect(px.has(`${x + i},${y}`)).toBe(false); // no pixel drawn twice
        px.set(`${x + i},${y}`, tone);
      }
    });
    expect(runs).toBeLessThan(4000);
    return px;
  };

  it('a whole ring: a band as thick as the lethal one, a dark outer edge, a blood core, a dithered inner edge', () => {
    const rg = ring(60);
    const px = pixels(rg);
    for (let y = 60; y < 210; y++)
      for (let x = 160; x < 320; x++) {
        const d = Math.hypot(x + 0.5 - rg.x, y + 0.5 - rg.y);
        const tone = px.get(`${x},${y}`);
        if (d > 62 || d < 58) expect(tone, `${x},${y}`).toBeUndefined();
        else if (d > 61) expect(tone).toBe('bloodDark');
        else if (d >= 59) expect(tone).toBe('blood');
        else expect(tone === undefined || tone === 'bloodDark').toBe(true);
      }
    const inner = [...px].filter(([k]) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return Math.hypot(x + 0.5 - rg.x, y + 0.5 - rg.y) < 59;
    });
    expect(inner.length).toBeGreaterThan(60); // the inner edge is there, and it is a dither (about half of its pixels)
    expect(inner.length).toBeLessThan(2 * Math.PI * 58.5 * 0.8);
  });

  it('a cut gap is empty where the sim says so; next to it the edges are torn but the core is solid up to the cut', () => {
    // (a fractional centre, as the Toller's spots are)
    for (const rg of [ring(80, [ringGap(1, 0, 0.45)]), ring(80.4, [ringGap(1, 0, 0.45)], 95.5, 69.5), ring(120, [ringGap(0.6, 0.8, 0.45), ringGap(-1, 0, 0.3)], 240.3, 100.7)]) {
      const px = pixels(rg);
      let near = 0;
      let far = 0;
      for (const k of px.keys()) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        const [dx, dy] = [x + 0.5 - rg.x, y + 0.5 - rg.y];
        const d = Math.hypot(dx, dy);
        expect(inRingGap(rg, dx / d, dy / d, d, 0)).toBe(false); // nothing is drawn inside a cut
      }
      // every pixel of the core outside the cuts is drawn (the lethal band is never under-drawn at a torn end)
      for (let y = 0; y < 270; y++)
        for (let x = 0; x < 480; x++) {
          const [dx, dy] = [x + 0.5 - rg.x, y + 0.5 - rg.y];
          const d = Math.hypot(dx, dy);
          if (d > rg.r + 1 || d < rg.r - 1) continue;
          if (inRingGap(rg, dx / d, dy / d, d, 0)) expect(px.has(`${x},${y}`)).toBe(false);
          else expect(px.get(`${x},${y}`), `${x},${y}`).toBe('blood');
        }
      // the edges: within the tear (8 px of arc past the first cut) they hold fewer pixels than far from any cut
      const g = rg.gaps[0]!;
      const half = Math.atan2(g.sin, g.cos);
      for (const [k, tone] of px) {
        if (tone !== 'bloodDark') continue;
        const [x, y] = k.split(',').map(Number) as [number, number];
        const [dx, dy] = [x + 0.5 - rg.x, y + 0.5 - rg.y];
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * g.x + dy * g.y) / Math.hypot(dx, dy))));
        if (ang < half + 8 / rg.r) near++;
        else if (ang > Math.PI - 8 / rg.r) far++;
      }
      if (rg.gaps.length === 1) expect(near).toBeLessThan(far);
    }
  });

  it('an echo far beyond the arena costs a bounded number of runs, all inside the clip', () => {
    const px = pixels(ring(420, [ringGap(0, 1, 0.45), ringGap(-1, 0, 0.45)]));
    expect(px.size).toBeLessThan(6000);
    expect(pixels(ring(900)).size).toBe(0); // wholly off-screen
  });
});

describe('boss art: reproducible', () => {
  // the art tools need python3 with Pillow and numpy; without them the check cannot run and the test is SKIPPED
  const probe = spawnSync('python3', ['-c', 'import PIL, numpy'], { encoding: 'utf8' });
  const missing = probe.error || probe.status === null ? 'python3 is not installed' : probe.status !== 0 ? 'python3 has no Pillow / numpy (pip install -r tools/requirements.txt)' : '';
  it('two fresh builds are identical and the committed art holds the same pixels (tools/check_repro.py)', ({ skip }) => {
    if (missing) skip(`SKIPPED, tools/check_repro.py did not run: ${missing}`);
    const out = spawnSync('python3', ['tools/check_repro.py'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    // (decoded pixels for PNG / GIF, exact bytes for JSON: another Pillow / zlib writes the same pixels as other bytes)
    expect(out.stdout + out.stderr).toContain('OK: two fresh builds are identical, and the files on disk hold the same pixels');
    expect(out.status).toBe(0);
  }, 240_000);
});
