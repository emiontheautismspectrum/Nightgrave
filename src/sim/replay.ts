import { ARENA_LAYOUT } from '../data/arena';
import { TUNING, type Difficulty } from '../data/tuning';
import { sanitizeInput, type InputFrame } from './input';
import { Sim, type SimOptions } from './sim';
import { toSeed } from './rng';

export const REPLAY_VERSION = 1;

/** FNV-1a fingerprint of TUNING: a replay only plays back under the tuning it was recorded with. */
export function tuningHash(): string {
  // spawn geometry is part of the rules (decorative layout fields such as the calm zone are not)
  const L = ARENA_LAYOUT;
  const src = JSON.stringify(TUNING) + JSON.stringify([L.arena, L.heroSpawn, L.portal, L.portalClearRadius, L.hollows, L.runes, (L as { propAnchors?: unknown }).propAnchors]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
/** Hard cap on replay length (2 hours at 60 Hz) so untrusted replays cannot exhaust CPU/memory. */
export const MAX_REPLAY_TICKS = 60 * 60 * 120;

/** Run-length encoded input log: each run is [count, cursor(0|1), mx, my, buttons]. */
export interface Replay {
  v: number;
  /** tuningHash() at record time. */
  tuning: string;
  seed: number;
  difficulty: Difficulty;
  runs: [number, number, number, number, number][];
}

export function encodeReplay(seed: number, difficulty: Difficulty, frames: readonly InputFrame[]): Replay {
  const runs: Replay['runs'] = [];
  for (const raw of frames) {
    const f = sanitizeInput(raw);
    const c = f.cursor ? 1 : 0;
    const last = runs[runs.length - 1];
    if (last && last[1] === c && last[2] === f.mx && last[3] === f.my && last[4] === f.buttons) last[0]++;
    else runs.push([1, c, f.mx, f.my, f.buttons]);
  }
  return { v: REPLAY_VERSION, tuning: tuningHash(), seed: toSeed(seed), difficulty, runs };
}

const isDifficulty = (d: unknown): d is Difficulty => typeof d === 'string' && Object.hasOwn(TUNING.difficulty, d);

/** Decode an untrusted replay. Throws on malformed structure; every frame is sanitized. */
export function decodeReplay(data: unknown): { seed: number; difficulty: Difficulty; frames: InputFrame[] } {
  if (!data || typeof data !== 'object') throw new Error('replay: not an object');
  const r = data as Partial<Replay>;
  if (r.v !== REPLAY_VERSION) throw new Error('replay: unsupported version');
  if (r.tuning !== tuningHash()) throw new Error('replay: recorded with different tuning');
  if (typeof r.seed !== 'number' || !Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff)
    throw new Error('replay: bad seed');
  if (!isDifficulty(r.difficulty)) throw new Error('replay: bad difficulty');
  if (!Array.isArray(r.runs)) throw new Error('replay: bad runs');
  const frames: InputFrame[] = [];
  for (const run of r.runs) {
    if (!Array.isArray(run) || run.length !== 5) throw new Error('replay: bad run');
    const [count, c, mx, my, buttons] = run as unknown[];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) throw new Error('replay: bad run length');
    if (frames.length + count > MAX_REPLAY_TICKS) throw new Error('replay: too long');
    const f = sanitizeInput({ cursor: c === 1, mx: mx as number, my: my as number, buttons: buttons as number });
    for (let i = 0; i < count; i++) frames.push({ ...f });
  }
  return { seed: r.seed, difficulty: r.difficulty, frames };
}

/** Re-simulate a replay from scratch. Same replay => same final state and score. */
export function playReplay(data: unknown, options: SimOptions = {}): Sim {
  const { seed, difficulty, frames } = decodeReplay(data);
  const sim = new Sim(seed, difficulty, options);
  for (const f of frames) {
    if (!sim.state.alive) break;
    sim.step(f);
  }
  return sim;
}
