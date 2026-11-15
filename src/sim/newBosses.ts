/**
 * The NEW BOSSES (FEATURES.bosses, docs/FEATURES.md): the Thorn Mother and the Toller. Every path into this file starts
 * with a boss of a new kind, which exists only while its row is enabled (`params.thorn`, `params.toller`), so nothing
 * here runs, reads a row, adds state or draws from the PRNG while the rows are off.
 */
import type { SimParams } from './params';
import type { Spawn } from './boss';
import type { Boss, BossAttack, BossPattern, SimState } from './state';

/** The attacks of the new bosses. */
export type NewPattern = Exclude<BossPattern, 'ring' | 'beam' | 'spawns' | 'fan' | 'wraiths' | 'triple'>;

export function beginNewAttack(_s: SimState, _p: SimParams, b: Boss, _pattern: BossPattern): BossAttack {
  throw new Error(`boss: the ${b.kind}'s attacks are not implemented yet`);
}

export function launchNew(_s: SimState, _p: SimParams, b: Boss, _a: BossAttack, _pattern: NewPattern, _spawn: Spawn): void {
  throw new Error(`boss: the ${b.kind}'s attacks are not implemented yet`);
}
