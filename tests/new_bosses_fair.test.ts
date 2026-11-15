/**
 * Fairness of the new bosses (FEATURES.bosses, enabled variants only): every attack starts with a wind-up of >= 15
 * ticks, no boss shot appears within 60 px of the hero without a ground cue of >= 15 ticks, nothing attacks during the
 * intro, and a WALKING hero (no parry, no dash; the solver of tests/pack_tools.ts) gets through every attack alone,
 * from the centre, the corners and the edges, on 200 seeds, and through random attack sequences across attack
 * boundaries (200 seeds per boss).
 */
import { describe, expect, it } from 'vitest';
import type { NewBossKind } from '../src/data/features';
import type { Difficulty } from '../src/data/tuning';
import { Sim } from '../src/sim/sim';
import { botInput } from './bot';
import { attacks, onlyAttack, PATTERNS, startFight, THORN, TOLLER } from './boss_tools';
import { SPOTS, walkingSolver } from './pack_tools';

const KINDS: [NewBossKind, typeof THORN][] = [['thorn', THORN], ['toller', TOLLER]];
const ACTIVE: NewBossKind[] = (process.env.NG_BOSSES?.split(',') as NewBossKind[] | undefined) ?? ['thorn', 'toller'];

describe('new bosses: fairness fuzz', () => {
  for (const [kind, f] of KINDS)
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      it.runIf(ACTIVE.includes(kind))(`${kind} ${d}: wind-up >= 15 ticks, no boss shot within 60 px uncued, nothing in the intro`, () => {
        for (let seed = 1; seed <= 12; seed++) {
          const sim = new Sim(seed * 31, d, { hero: seed % 2 ? 'knight' : 'wisp', features: f, startWave: 3, firstBoss: kind });
          let launched = 0;
          while (sim.state.bossesDefeated === 0 && sim.state.tick < 60 * 90) {
            sim.state.alive = true;
            sim.step(botInput(sim));
            const s = sim.state;
            const b = s.boss;
            if (b?.attack && s.tick - 1 === b.attack.windStart) expect(b.attack.fire - b.attack.windStart).toBeGreaterThanOrEqual(15);
            for (const e of s.events) {
              if (e.type === 'boss_attack') {
                launched++;
                expect(s.tick - 1).toBeGreaterThanOrEqual(b!.introEnd);
              }
              if (e.type === 'spawn') {
                const pr = s.projectiles.find((q) => q.id === e.id);
                if (!pr?.boss) continue;
                expect(e.telegraphTicks).toBeGreaterThanOrEqual(15);
                const cued = pr.kind === 'rune_shard' && kind === 'thorn'; // a bloom: a lit ground spot
                if (!cued) expect(e.dist).toBeGreaterThanOrEqual(60 - 1e-6);
              }
            }
          }
          expect(sim.state.bossesDefeated).toBe(1);
          expect(launched).toBe(sim.params[kind]!.segments);
        }
      });
});

const SEEDS = Number(process.env.NG_SEEDS ?? 200);

describe('new bosses: a walking hero gets through every attack alone (200 seeds; centre, corners, edges)', () => {
  for (const [kind] of KINDS)
    for (const pattern of PATTERNS[kind])
      it.runIf(ACTIVE.includes(kind))(`${kind} ${pattern}`, { timeout: 600_000 }, () => {
        const f = onlyAttack(kind, pattern);
        const how: Record<string, number> = {};
        const stuck: string[] = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
          const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
          const piece = startFight(kind, seed * 7, hx, hy, f);
          const r = walkingSolver(piece, 15, attacks(1));
          how[r.how.startsWith('walk') ? 'walk' : r.how] = (how[r.how.startsWith('walk') ? 'walk' : r.how] ?? 0) + 1;
          if (!r.ok) stuck.push(`seed ${seed * 7} ${spot}`);
        }
        console.log(`walking solver, ${kind} ${pattern}: ${JSON.stringify(how)}`);
        expect(stuck).toEqual([]);
      });
});

describe('new bosses: random attack sequences across attack boundaries (walking only, 200 seeds per boss)', () => {
  for (const [kind, f] of KINDS)
    it.runIf(ACTIVE.includes(kind))(`${kind}: four attacks in a row (seeded picks), every hero spot`, { timeout: 900_000 }, () => {
      const how: Record<string, number> = {};
      const stuck: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const [spot, hx, hy] = SPOTS[seed % SPOTS.length]!;
        const piece = startFight(kind, seed * 13 + 1, hx, hy, f);
        const r = walkingSolver(piece, 20, attacks(4));
        how[r.how.startsWith('walk') ? 'walk' : r.how] = (how[r.how.startsWith('walk') ? 'walk' : r.how] ?? 0) + 1;
        if (!r.ok) stuck.push(`seed ${seed * 13 + 1} ${spot}`);
      }
      console.log(`walking solver, ${kind} sequences of 4: ${JSON.stringify(how)}`);
      expect(stuck).toEqual([]);
    });
});
