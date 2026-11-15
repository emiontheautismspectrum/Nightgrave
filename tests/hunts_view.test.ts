/**
 * Render side of the hunts (src/render/huntsView.ts, edge markers, sounds): render only READS sim state, and nothing
 * new is drawn or heard while the blocks are off.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../assets/atlas/manifest.json';
import { FEATURES, withFeatures } from '../src/data/features';
import { SFX_FILE, SoundDiffer } from '../src/render/audioLogic';
import { edgeMarkers } from '../src/render/edgeMarkers';
import { huntSprites, TILE } from '../src/render/huntsView';
import { SYNTH } from '../src/render/sfx';
import { Sim } from '../src/sim/sim';
import { PACK } from './pack_tools';
import { SkilledBot } from './skilled';

const FULL = { x0: 0, y0: 0, x1: 480, y1: 270 };

describe('hunts render: dark', () => {
  it('with the flags off the draw list, the edge markers and the sounds hold no hunt entity (whole runs, both heroes)', () => {
    for (const features of [FEATURES, PACK])
      for (const hero of ['knight', 'wisp'] as const) {
        const sim = new Sim(hero === 'knight' ? 12 : 13, 'hard', { hero, features, startWave: 4 });
        const bot = new SkilledBot(3);
        const sd = new SoundDiffer();
        while (sim.state.tick < 60 * 60) {
          sim.state.alive = true;
          sim.step(bot.input(sim));
          expect(huntSprites(sim.state, sim.params)).toEqual([]);
          const half = { x0: sim.state.hero.x - 70, y0: 0, x1: sim.state.hero.x + 70, y1: 270 };
          for (const m of edgeMarkers(sim.state, sim.params, half, 90)) expect(m.key).toMatch(/^(p|t|c|s|b|bp|m)\d*$/);
          for (const e of sd.tick(sim.state, sim.state.events, sim.state.tick * 16)) expect(['knot_fuse', 'knot_burst', 'briar_creep']).not.toContain(e);
        }
        expect('knots' in sim.state || 'walls' in sim.state).toBe(false);
      }
  });
});

describe('hunts render: the enabled variants', () => {
  it('the sprites exist in the atlas with the spec sizes', () => {
    const S = manifest.sprites as Record<string, { w: number; h: number; frames: number; group: string }>;
    expect([S.hex_knot, S.briar_tile, S.briar_post, S.edge_gap].map((x) => x && [x.w, x.h, x.frames, x.group])).toEqual([
      [12, 12, 4, 'gameplay'], [8, 8, 2, 'gameplay'], [8, 12, 1, 'gameplay'], [5, 5, 1, 'gameplay'],
    ]);
  });

  it('a knot: the frame is its fuse (4 pips -> 1), read from the sim ticks; render never changes the sim', () => {
    const sim = new Sim(1, 'hard', { features: withFeatures('knot'), spawner: false });
    sim.state.knots!.push({ id: 50, x: 100, y: 100, r: 5, start: 0, burst: 240, shards: 8, speed: 1, angle: 0 });
    const frames: number[] = [];
    while (sim.state.knots!.length) {
      const before = JSON.stringify(sim.state);
      const l = huntSprites(sim.state, sim.params);
      expect(JSON.stringify(sim.state)).toBe(before);
      frames.push(l[0]!.frame);
      expect(l).toHaveLength(1);
      sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
    }
    expect([frames[0], frames[59], frames[60], frames[119], frames[120], frames[180], frames[239]]).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });

  it('a line: tiles across the arena with none over the gap, a post at each side of it, bone gap markers on both edges', () => {
    const sim = new Sim(1, 'hard', { features: withFeatures('briar'), spawner: false });
    const p = sim.params;
    for (const axis of ['x', 'y'] as const) {
      sim.state.walls = [{ id: 9, axis, dir: 1, pos: 150, startPos: 38, endPos: 442, start: 0, move: 0, speed: 1, gap: 120, gapHalf: 22, halfWidth: 3 }];
      const l = huntSprites(sim.state, p);
      expect(new Set(l.map((e) => e.key)).size).toBe(l.length);
      const tiles = l.filter((e) => e.name === 'briar_tile');
      const across = (e: { x: number; y: number }) => (axis === 'x' ? e.y : e.x);
      for (const t of tiles) {
        expect(Math.abs(across(t) - 120)).toBeGreaterThanOrEqual(22 + TILE / 2);
        expect(t.angle).toBe(axis === 'x' ? 90 : 0);
        expect(axis === 'x' ? t.x : t.y).toBe(150);
      }
      const span = axis === 'x' ? p.y1 - p.y0 : p.x1 - p.x0;
      expect(tiles.length).toBeGreaterThanOrEqual(Math.floor(span / TILE) - 7);
      expect(l.filter((e) => e.name === 'briar_post').map((e) => across(e)).sort((a, b) => a - b)).toEqual([120 - 26, 120 + 26]);
      const g = l.filter((e) => e.name === 'edge_gap');
      expect(g.map((e) => across(e))).toEqual([120, 120]);
      expect(g.map((e) => (axis === 'x' ? e.x : e.y))).toEqual(axis === 'x' ? [p.x0 - 2, p.x1 + 2] : [p.y0 - 2, p.y1 + 2]);
      // during the telegraph: dimmed and still
      sim.state.walls[0]!.move = 1e9;
      expect(huntSprites(sim.state, p).filter((e) => e.name === 'briar_tile').every((e) => e.alpha < 1 && e.frame === 0)).toBe(true);
    }
  });

  it('off-view markers: a knot (violet), a line (red) and its gap (bone); none for what is in view', () => {
    const sim = new Sim(1, 'hard', { features: withFeatures('knot', 'briar'), spawner: false });
    const s = sim.state;
    s.knots!.push({ id: 50, x: 420, y: 100, r: 5, start: 0, burst: 240, shards: 8, speed: 1, angle: 0 });
    s.walls!.push({ id: 60, axis: 'x', dir: 1, pos: 60, startPos: 38, endPos: 442, start: 0, move: 0, speed: 1, gap: 200, gapHalf: 22, halfWidth: 3 });
    const view = { x0: 170, y0: 60, x1: 310, y1: 210 };
    const m = edgeMarkers(s, sim.params, view, 90);
    expect(m.find((q) => q.key === 'k50')?.color).toBe('violet');
    expect(m.find((q) => q.key === 'w60')?.color).toBe('red');
    expect(m.find((q) => q.key === 'g60')?.color).toBe('bone');
    expect(edgeMarkers(s, sim.params, FULL, 90).filter((q) => /^[kwg]\d/.test(q.key))).toEqual([]);
  });

  it('sounds: knot_fuse on a new knot, knot_burst (not a rune burst) on a burst, briar_creep on a new line; synthesized fallbacks', () => {
    const d = new SoundDiffer();
    const m = { multiplier: 100, projectiles: [] };
    expect(d.tick(m, [{ type: 'knot', id: 1, x: 0, y: 0 }], 0)).toEqual(['knot_fuse']);
    expect(d.tick(m, [{ type: 'spawn', id: 2, kind: 'rune_shard', dist: 90, telegraphTicks: 240 }, { type: 'knot_end', id: 1, x: 0, y: 0, how: 'burst' }], 10)).toEqual(['knot_burst']);
    expect(d.tick(m, [{ type: 'knot_end', id: 1, x: 0, y: 0, how: 'parry' }], 20)).toEqual([]);
    expect(d.tick(m, [{ type: 'briar', id: 3, axis: 'x', dir: 1, gap: 100 }], 30)).toEqual(['briar_creep']);
    const list = readFileSync('docs/AUDIO_LIST.md', 'utf8');
    for (const e of ['knot_fuse', 'knot_burst', 'briar_creep'] as const) {
      expect(SYNTH[e].dur).toBeGreaterThan(0);
      expect(list).toContain(`${SFX_FILE[e]}.mp3`);
    }
  });
});
