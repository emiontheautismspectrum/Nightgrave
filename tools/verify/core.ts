/**
 * Replay verification core (pure, no network): re-simulate a submitted run with the SAME deterministic sim and compare
 * EXACTLY. A run is verified only if every input frame is valid, the run lasts exactly durationTicks, the hero died on
 * the last tick, and the final score equals the submitted score.
 */
import { decodeInputLog } from '../../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';
import { dailySeed } from '../../src/shared/daily';
import { Sim } from '../../src/sim/sim';

export type Reason = 'score_mismatch' | 'length_mismatch' | 'invalid_input' | 'outdated' | 'error';
export interface PendingItem {
  id: string;
  date: string;
  seed: number;
  difficulty: string;
  durationTicks: number;
  score: number;
  hero: string;
  tuningFingerprint: string;
  clientVersion: string;
  replay: string;
}
export type Verdict = { status: 'verified' } | { status: 'rejected'; reason: Reason };

/** Longest run we ever re-simulate (24 h): a bigger claim is not a real run. */
export const MAX_TICKS = 60 * 60 * 60 * 24;

export function verifyItem(it: PendingItem): Verdict {
  if (it.tuningFingerprint !== tuningFingerprint() || it.clientVersion !== CLIENT_VERSION) return { status: 'rejected', reason: 'outdated' };
  if (it.difficulty !== 'hard' || typeof it.date !== 'string' || it.seed !== dailySeed(it.date)) return { status: 'rejected', reason: 'invalid_input' };
  const d = it.durationTicks;
  if (!Number.isSafeInteger(d) || d < 1 || d > MAX_TICKS || !Number.isSafeInteger(it.score)) return { status: 'rejected', reason: 'length_mismatch' };
  const frames = decodeInputLog(it.replay, d + 1, true);
  if (!frames) return { status: 'rejected', reason: 'invalid_input' };
  if (frames.length !== d) return { status: 'rejected', reason: 'length_mismatch' };
  const sim = new Sim(it.seed, 'hard');
  for (let i = 0; i < frames.length; i++) {
    if (!sim.state.alive) return { status: 'rejected', reason: 'length_mismatch' }; // died before the replay ended
    sim.step(frames[i]!);
  }
  // the run must have ended by death exactly on its last tick
  if (sim.state.alive || sim.state.deathTick !== d - 1) return { status: 'rejected', reason: 'length_mismatch' };
  if (sim.score !== it.score) return { status: 'rejected', reason: 'score_mismatch' };
  return { status: 'verified' };
}

/** Untrusted JSON -> PendingItem, or null. */
export function parseItem(o: unknown): PendingItem | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const s = (k: string, max: number) => typeof r[k] === 'string' && (r[k] as string).length <= max;
  const n = (k: string) => typeof r[k] === 'number' && Number.isSafeInteger(r[k]);
  if (!s('id', 40) || !s('date', 10) || !s('difficulty', 10) || !s('hero', 10) || !s('tuningFingerprint', 40) || !s('clientVersion', 20) || !s('replay', 400_000)) return null;
  if (!n('seed') || !n('durationTicks') || !n('score')) return null;
  if (!/^\d{1,15}-\d{1,15}$/.test(r.id as string)) return null;
  return r as unknown as PendingItem;
}
