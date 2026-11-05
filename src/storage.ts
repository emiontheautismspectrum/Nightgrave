/**
 * Local save data: one versioned localStorage key. Every read and write is wrapped in try/catch and the data is
 * schema-validated on load: wrong types, out-of-range numbers, huge strings or broken JSON fall back to defaults.
 * The game fully works with storage blocked (private mode): the in-memory copy is used and writes are dropped.
 * Pure TypeScript, no Phaser and no sim imports (render-side helper).
 */
export const STORAGE_KEY = 'nightgrave.v1';
export const BEST_PER_DIFFICULTY = 5;
export const DAILY_DAYS = 7;
const MAX_RAW_CHARS = 64 * 1024;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Hero = 'knight' | 'wisp';
export type Effects = 'high' | 'low';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
export const HEROES: readonly Hero[] = ['knight', 'wisp'];

export interface Settings {
  master: number; // 0..100, steps of 10
  music: number;
  sfx: number;
  shake: boolean;
  reducedFlashes: boolean;
  effects: Effects;
  dragSensitivity: number; // 0.5..3.0, steps of 0.25
  leftHanded: boolean;
  secondFingerParry: boolean;
  haptics: boolean;
  touchHintSeen: boolean;
}

export interface BestEntry {
  score: number;
  hero: Hero;
  /** UTC date the run ended, YYYY-MM-DD. */
  date: string;
  /** Time survived in seconds (one decimal). */
  secs: number;
}

export interface SaveData {
  v: 1;
  settings: Settings;
  hero: Hero;
  difficulty: Difficulty;
  best: Record<Difficulty, BestEntry[]>;
  /** Hard "Today's best" per UTC date (newest first, at most DAILY_DAYS dates). */
  daily: { date: string; entry: BestEntry }[];
  /** Random UUID v4 for the online board (no account). A new one per session if storage is blocked. */
  playerId: string;
  /** Last name used on the board (remembered, re-validated on use). */
  boardName: string;
}

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function newPlayerId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 80,
  music: 60,
  sfx: 80,
  shake: true,
  reducedFlashes: false,
  effects: 'high',
  dragSensitivity: 1.5,
  leftHanded: false,
  secondFingerParry: true,
  haptics: false,
  touchHintSeen: false,
};

export function defaultSave(): SaveData {
  return { v: 1, settings: { ...DEFAULT_SETTINGS }, hero: 'knight', difficulty: 'medium', best: { easy: [], medium: [], hard: [] }, daily: [], playerId: newPlayerId(), boardName: '' };
}

// ------------------------------------------------------------------ validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function volume(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v / 10) * 10 : d;
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}
export function clampSensitivity(v: unknown, d = DEFAULT_SETTINGS.dragSensitivity): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0.5 && v <= 3 ? Math.round(v * 4) / 4 : d;
}

export function validEntry(v: unknown): BestEntry | null {
  if (!isObj(v)) return null;
  const { score, hero, date, secs } = v;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 1e9) return null;
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0 || secs > 1e6) return null;
  if (typeof date !== 'string' || date.length !== 10 || !DATE_RE.test(date)) return null;
  if (hero !== 'knight' && hero !== 'wisp') return null;
  return { score, hero, date, secs: Math.round(secs * 10) / 10 };
}

/** Validate untrusted data (parsed JSON). Anything wrong falls back to its default; never throws. */
export function validateSave(raw: unknown): SaveData {
  const out = defaultSave();
  if (!isObj(raw) || raw.v !== 1) return out;
  const s = isObj(raw.settings) ? raw.settings : {};
  const d = DEFAULT_SETTINGS;
  out.settings = {
    master: volume(s.master, d.master),
    music: volume(s.music, d.music),
    sfx: volume(s.sfx, d.sfx),
    shake: bool(s.shake, d.shake),
    reducedFlashes: bool(s.reducedFlashes, d.reducedFlashes),
    effects: oneOf(s.effects, ['high', 'low'], d.effects),
    dragSensitivity: clampSensitivity(s.dragSensitivity),
    leftHanded: bool(s.leftHanded, d.leftHanded),
    secondFingerParry: bool(s.secondFingerParry, d.secondFingerParry),
    haptics: bool(s.haptics, d.haptics),
    touchHintSeen: bool(s.touchHintSeen, d.touchHintSeen),
  };
  out.hero = oneOf(raw.hero, HEROES, 'knight');
  out.difficulty = oneOf(raw.difficulty, DIFFICULTIES, 'medium');
  const best = isObj(raw.best) ? raw.best : {};
  for (const k of DIFFICULTIES) {
    const list = Array.isArray(best[k]) ? (best[k] as unknown[]).slice(0, 50) : [];
    out.best[k] = sortBest(list.map(validEntry).filter((e): e is BestEntry => !!e)).slice(0, BEST_PER_DIFFICULTY);
  }
  const daily = Array.isArray(raw.daily) ? raw.daily.slice(0, 50) : [];
  const seen = new Set<string>();
  for (const it of daily) {
    if (!isObj(it) || typeof it.date !== 'string' || !DATE_RE.test(it.date) || seen.has(it.date)) continue;
    const e = validEntry(it.entry);
    if (!e) continue;
    seen.add(it.date);
    out.daily.push({ date: it.date, entry: e });
  }
  out.daily.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  out.daily = out.daily.slice(0, DAILY_DAYS);
  if (typeof raw.playerId === 'string' && UUID4.test(raw.playerId)) out.playerId = raw.playerId;
  if (typeof raw.boardName === 'string' && raw.boardName.length <= 32) out.boardName = raw.boardName;
  return out;
}

// ------------------------------------------------------------------ best scores

const sortBest = (l: BestEntry[]): BestEntry[] => [...l].sort((a, b) => b.score - a.score || a.secs - b.secs);

/**
 * Record a run that ENDED BY DEATH. Returns whether it beat the previous best of its difficulty.
 * `utcDate` (YYYY-MM-DD) comes from the render side (never from src/sim).
 */
export function recordRun(save: SaveData, difficulty: Difficulty, entry: BestEntry, utcDate: string): { newRecord: boolean } {
  const e = validEntry(entry);
  if (!e) return { newRecord: false };
  const list = save.best[difficulty];
  const prevBest = list[0]?.score ?? 0;
  save.best[difficulty] = sortBest([...list, e]).slice(0, BEST_PER_DIFFICULTY);
  if (difficulty === 'hard' && DATE_RE.test(utcDate)) {
    const cur = save.daily.find((d) => d.date === utcDate);
    if (!cur) save.daily.push({ date: utcDate, entry: e });
    else if (e.score > cur.entry.score) cur.entry = e;
    save.daily.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    save.daily = save.daily.slice(0, DAILY_DAYS);
  }
  return { newRecord: e.score > prevBest };
}

export function bestScore(save: SaveData, d: Difficulty): number {
  return save.best[d][0]?.score ?? 0;
}

export function todaysBest(save: SaveData, utcDate: string): BestEntry | null {
  return save.daily.find((d) => d.date === utcDate)?.entry ?? null;
}

// ------------------------------------------------------------------ persistence

/** Minimal Storage surface (window.localStorage, or a fake in tests). */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultKV(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // access itself can throw (blocked storage)
  }
}

export function loadSave(kv: KV | null = defaultKV()): SaveData {
  try {
    const raw = kv?.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_RAW_CHARS) return defaultSave();
    return validateSave(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: SaveData, kv: KV | null = defaultKV()): boolean {
  try {
    if (!kv) return false;
    kv.setItem(STORAGE_KEY, JSON.stringify(validateSave(save)));
    return true;
  } catch {
    return false; // quota, private mode, blocked: keep playing with the in-memory copy
  }
}

/** The one live save for this page (render side). */
let live: SaveData | null = null;
export function save(): SaveData {
  live ??= loadSave();
  return live;
}
export function persist(): void {
  if (live) writeSave(live);
}

/** Only runs that ended by death are saved; restart/quit from pause and dev `?wave=N` runs never are. */
export function shouldSaveRun(endedBy: 'death' | 'restart' | 'quit', devWave: number | undefined): boolean {
  return endedBy === 'death' && !devWave;
}

/**
 * Merge best scores another tab saved meanwhile into the live copy (called right before recording a run), so two
 * open tabs never erase each other's records. Settings stay this tab's.
 */
export function mergeFromDisk(kv: KV | null = defaultKV()): void {
  const disk = loadSave(kv);
  const cur = save();
  const key = (e: BestEntry) => `${e.score}|${e.hero}|${e.date}|${e.secs}`;
  for (const d of DIFFICULTIES) {
    const seen = new Set(cur.best[d].map(key));
    cur.best[d] = sortBest([...cur.best[d], ...disk.best[d].filter((e) => !seen.has(key(e)))]).slice(0, BEST_PER_DIFFICULTY);
  }
  for (const it of disk.daily) {
    const mine = cur.daily.find((x) => x.date === it.date);
    if (!mine) cur.daily.push(it);
    else if (it.entry.score > mine.entry.score) mine.entry = it.entry;
  }
  cur.daily.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  cur.daily = cur.daily.slice(0, DAILY_DAYS);
}
