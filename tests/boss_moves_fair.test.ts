/**
 * Fairness of package U3b (enabled variants only; docs/FEATURES.md): moving bodies (FEATURES.bossMotion) and the new
 * attacks (FEATURES.bossMoves). Every wind-up >= 15 ticks; no boss shot appears within 60 px of the hero without a
 * ground cue; a telegraph fixed at the wind-up start is where the attack leaves from; a WALKING hero (no parry, no
 * dash; the solver of tests/pack_tools.ts) gets through random attack sequences of every boss with the body moved to
 * random spots of the band (200 seeds per boss).
 */
import { describe, expect, it } from 'vitest';
import { withFeatures, type Features } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import { Sim } from '../src/sim/sim';
import type { BossKind } from '../src/sim/state';
import { botInput } from './bot';
import { attacks, startFight } from './boss_tools';
import { SPOTS, walkingSolver } from './pack_tools';

const MOTION: Features = withFeatures('bossMotion', 'bosses');
const KINDS: BossKind[] = ['eye', 'lich', 'thorn', 'toller'];
const SEEDS = Number(process.env.NG_SEEDS ?? 200);

/** A test-only seeded spot of the drift band (the body is put there before the first wind-up). */
function bandSpot(seed: number): [number, number] {
  const m = MOTION.bossMotion;
  let r = (seed * 2654435761) >>> 0 || 1;
  const rnd = (): number => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  return [48 + m.inset + rnd() * (384 - 2 * m.inset), 27 + m.inset + rnd() * (m.yMax - 27 - m.inset)];
}

describe('bossMotion: fairness fuzz (moving bodies)', () => {
  for (const kind of KINDS)
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      it(`${kind} ${d}: wind-up >= 15 ticks, no boss shot within 60 px uncued, a beam leaves from the body of its wind-up`, () => {
        for (let seed = 1; seed <= 8; seed++) {
          const sim = new Sim(seed * 31, d, { hero: seed % 2 ? 'knight' : 'wisp', features: MOTION, startWave: 3, firstBoss: kind });
          let wind: [number, number] | null = null;
          while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 100) {
            sim.state.alive = true;
            sim.step(botInput(sim));
            const s = sim.state;
            const b = s.boss;
            const t = s.tick - 1;
            if (b?.attack && t === b.attack.windStart) {
              expect(b.attack.fire - b.attack.windStart).toBeGreaterThanOrEqual(15);
              wind = [b.x, b.y];
            }
            if (b?.attack && t > b.attack.windStart && wind) expect([b.x, b.y]).toEqual(wind); // held to the launch
            for (const bm of s.beams) if (bm.start === t) expect([bm.x, bm.y]).toEqual(wind);
            for (const e of s.events) {
              if (e.type !== 'spawn') continue;
              const pr = s.projectiles.find((q) => q.id === e.id);
              if (!pr?.boss) continue;
              expect(e.telegraphTicks).toBeGreaterThanOrEqual(15);
              const cued = pr.kind === 'rune_shard' && kind === 'thorn'; // a bloom: a lit ground spot
              if (!cued) expect(e.dist).toBeGreaterThanOrEqual(60 - 1e-6);
            }
          }
          expect(sim.state.bossesDefeated).toBe(1);
        }
      });
});

describe('bossMotion: a walking hero gets through random attack sequences, the body at random band spots (200 seeds per boss)', () => {
  for (const kind of KINDS)
    it(`${kind}: four attacks in a row, every hero spot, a random body spot`, { timeout: 900_000 }, () => {
      const how: Record<string, number> = {};
      const stuck: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
        const piece = startFight(kind, seed * 13 + 1, hx, hy, MOTION);
        const b = piece.sim.state.boss!;
        [b.x, b.y] = bandSpot(seed);
        const r = walkingSolver(piece, 20, attacks(4));
        const k = r.how.startsWith('walk') ? 'walk' : r.how;
        how[k] = (how[k] ?? 0) + 1;
        if (!r.ok) stuck.push(`seed ${seed * 13 + 1} ${spot} body ${b.x.toFixed(0)},${b.y.toFixed(0)}`);
      }
      console.log(`walking solver with motion, ${kind} sequences of 4: ${JSON.stringify(how)}`);
      expect(stuck).toEqual([]);
    });
});
