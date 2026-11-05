import { describe, expect, it } from 'vitest';
import { BTN_PARRY } from '../src/sim/input';
import { createState, Sim, spawnProjectile, step } from '../src/sim/sim';
import { makeParams } from '../src/sim/params';
import type { SimEvent } from '../src/sim/state';
import { botInput } from './bot';

const idle = { cursor: false, mx: 0, my: 0, buttons: 0 };
const parry = { ...idle, buttons: BTN_PARRY };

describe('armored orb', () => {
  it('needs two parries: the first cracks it and pushes it 6 px away (no points), the second destroys it', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p);
    const pr = spawnProjectile(s, p, 'orb_armored', s.hero.x + 8, s.hero.y, 0, 0);
    step(s, parry, p, { spawner: false });
    expect(s.projectiles.find((q) => q.id === pr.id)?.armor).toBe(0);
    expect(s.projectiles.find((q) => q.id === pr.id)!.x).toBeCloseTo(s.hero.x + 14, 6);
    expect(s.parryScoreHundredths).toBe(0);
    for (let i = 0; i < 8; i++) step(s, idle, p, { spawner: false }); // still the same pulse: cannot be destroyed by it
    expect(s.projectiles.some((q) => q.id === pr.id)).toBe(true);
    for (let i = 0; i < p.parryCooldown; i++) step(s, idle, p, { spawner: false });
    step(s, parry, p, { spawner: false });
    expect(s.projectiles.some((q) => q.id === pr.id)).toBe(false);
    expect(s.parryScoreHundredths).toBeGreaterThan(0);
  });
  it('a cracked orb counts toward the 3-per-pulse cap', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p);
    spawnProjectile(s, p, 'orb_armored', s.hero.x + 5, s.hero.y, 0, 0);
    for (let k = 0; k < 4; k++) spawnProjectile(s, p, 'orb_small', s.hero.x + 10 + k, s.hero.y, 0, 0);
    step(s, parry, p, { spawner: false });
    expect(s.projectiles.length).toBe(5 - (p.parryMaxKills - 1)); // 1 crack + 2 kills
  });
});

describe('splitting orb', () => {
  it('bursts into 3 small orbs flying outward, never spawning inside or moving toward the hero', () => {
    for (const ang of [0, 1, 2, 3, 4, 5]) {
      const p = makeParams('hard');
      const s = createState(1, 'hard', p);
      const d = 4 + ang * 2;
      spawnProjectile(s, p, 'orb_split', s.hero.x + Math.cos(ang) * d, s.hero.y + Math.sin(ang) * d, 0, 0);
      step(s, parry, p, { spawner: false });
      const kids = s.projectiles.filter((q) => q.kind === 'orb_small');
      expect(kids.length).toBe(3);
      for (const k of kids) {
        const rx = k.x - s.hero.x;
        const ry = k.y - s.hero.y;
        expect(Math.hypot(rx, ry)).toBeGreaterThan(p.heroRadius + k.radius);
        expect(rx * k.vx + ry * k.vy).toBeGreaterThan(0); // moving away
      }
      // during the first 0.25 s they only get farther away from a hero that stands still
      let prev = kids.map((k) => Math.hypot(k.x - s.hero.x, k.y - s.hero.y));
      for (let i = 0; i < 15; i++) {
        step(s, idle, p, { spawner: false });
        const now = kids.map((k) => Math.hypot(k.x - s.hero.x, k.y - s.hero.y));
        now.forEach((v, j) => expect(v).toBeGreaterThan(prev[j]!));
        prev = now;
      }
      expect(s.alive).toBe(true);
    }
  });
});

describe('blood sigil', () => {
  it('fairness fuzz: telegraph >= 0.25 s, never under the hero, at most 2, the arena always keeps a path', () => {
    let seen = 0;
    for (const d of ['easy', 'medium', 'hard'] as const)
      for (let seed = 1; seed <= 12; seed++) {
        const sim = new Sim(seed * 31, d, { startWave: 5, bosses: false });
        while (sim.state.tick < 60 * 90) {
          sim.state.alive = true; // immortal (test only): watch every sigil
          sim.step(botInput(sim));
          const st = sim.state;
          expect(st.sigils.length).toBeLessThanOrEqual(2);
          for (const e of st.events as SimEvent[])
            if (e.type === 'sigil') {
              seen++;
              const g = st.sigils.find((x) => x.id === e.id)!;
              expect(g.fill - g.start).toBeGreaterThanOrEqual(15);
              expect(Math.hypot(g.x - st.hero.x, g.y - st.hero.y)).toBeGreaterThanOrEqual(40 - sim.params.heroSpeed);
            }
          // path: the free part of the arena (outside every sigil + hero radius) is one connected region
          if (st.sigils.length === 2 && st.tick % 30 === 0) {
            const p = sim.params;
            const W = 96;
            const H = 54;
            const free = (i: number, j: number) => {
              const x = p.x0 + (i + 0.5) * 4;
              const y = p.y0 + (j + 0.5) * 4;
              return st.sigils.every((g) => Math.hypot(g.x - x, g.y - y) > g.r + p.heroRadius + 1);
            };
            const seenC = new Uint8Array(W * H);
            let start = -1;
            let total = 0;
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (free(i, j)) (total++, start < 0 && (start = j * W + i));
            const q = [start];
            seenC[start] = 1;
            let reach = 0;
            while (q.length) {
              const c = q.pop()!;
              reach++;
              const i = c % W;
              const j = (c / W) | 0;
              for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const ni = i + a!;
                const nj = j + b!;
                if (ni < 0 || nj < 0 || ni >= W || nj >= H || seenC[nj * W + ni] || !free(ni, nj)) continue;
                seenC[nj * W + ni] = 1;
                q.push(nj * W + ni);
              }
            }
            expect(reach).toBe(total);
          }
        }
      }
    expect(seen).toBeGreaterThan(10);
  });
  it('lethal only while filled; dash i-frames pass through it; unparryable', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p);
    s.sigils.push({ id: 99, x: s.hero.x, y: s.hero.y, r: 14, start: 0, fill: 20, end: 110, gone: 128 });
    for (let i = 0; i < 19; i++) step(s, i === 0 ? parry : idle, p, { spawner: false });
    expect(s.alive).toBe(true); // telegraph: harmless
    s.tick = 30;
    s.hero.dashStart = 30;
    step(s, idle, p, { spawner: false });
    expect(s.alive).toBe(true); // dash i-frames
    s.hero.dashStart = -1e9;
    s.hero.x = s.sigils[0]!.x;
    s.hero.y = s.sigils[0]!.y;
    step(s, idle, p, { spawner: false });
    expect(s.alive).toBe(false);
  });
});
