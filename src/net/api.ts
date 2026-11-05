/**
 * Client for the Hard daily board. Online features are off when VITE_API_BASE is empty (the game is fully offline).
 * Every response is untrusted: it is re-validated here and only ever rendered with text-only APIs.
 */
import { DATE_RE } from '../shared/daily';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '';
export const online = (): boolean => API_BASE.length > 0;
const TIMEOUT_MS = 4000;

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  hero: 'knight' | 'wisp';
  durationTicks: number;
  /** How the run was seen: the whole arena, or the zoomed phone-portrait camera (metadata only). */
  view: 'full' | 'zoomed';
}
export interface Board {
  date: string;
  serverNow: string;
  top: BoardEntry[];
  champion: { name: string; message: string | null } | null;
}
export interface SubmitResult {
  accepted: boolean;
  /** Accepted runs wait for replay verification before they appear on the board. */
  pending: boolean;
  provisionalRank: number | null;
  reason?: string;
}

/**
 * Server clock offset (serverNow - local now) once the API answered. The server's UTC date is derived from it on every
 * call, so it rolls over at 00:00 UTC by itself (the Hard seed date, immune to a wrong local clock).
 */
let clockOffset: number | null = null;
export const serverNowMs = (): number => Date.now() + (clockOffset ?? 0);
export const hasServerClock = (): boolean => clockOffset !== null;
export const getServerDate = (): string | null => (clockOffset === null ? null : new Date(serverNowMs()).toISOString().slice(0, 10));
/** Test hook: set the offset directly. */
export function setClockOffsetForTest(ms: number | null): void {
  clockOffset = ms;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** Validate an untrusted board response. */
export function parseBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const date = str(o.date, 10);
  const now = str(o.serverNow, 40);
  if (!date || !DATE_RE.test(date) || !now || !Array.isArray(o.top)) return null;
  const top: BoardEntry[] = [];
  for (const e of o.top.slice(0, 10)) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const name = str(r.name, 128); // the server caps names at 32 code points
    const score = int(r.score);
    const rank = int(r.rank);
    const dur = int(r.durationTicks);
    if (!name || score === null || rank === null || dur === null || (r.hero !== 'knight' && r.hero !== 'wisp')) continue;
    top.push({ rank, name, score, hero: r.hero, durationTicks: dur, view: r.view === 'zoomed' ? 'zoomed' : 'full' });
  }
  let champion: Board['champion'] = null;
  const c = o.champion as Record<string, unknown> | null;
  if (c && typeof c === 'object' && str(c.name, 128)) champion = { name: c.name as string, message: str(c.message, 320) };
  return { date, serverNow: now, top, champion };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API_BASE}${path}`, { ...init, signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    const ct = r.headers.get('Content-Type') ?? '';
    if (!ct.includes('application/json')) throw new Error('not json');
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a day's board (default: the server's today). Null on any error (offline, timeout, bad data). */
export async function fetchBoard(date?: string): Promise<Board | null> {
  if (!online()) return null;
  try {
    const b = parseBoard(await request(`/api/daily${date ? `?date=${encodeURIComponent(date)}` : ''}`));
    if (b) {
      const t = Date.parse(b.serverNow);
      if (Number.isFinite(t)) clockOffset = t - Date.now();
    }
    return b;
  } catch {
    return null;
  }
}

export interface MyStanding {
  verifiedScore: number | null;
  verifiedRank: number | null;
  pending: boolean;
}

/** The player's own standing for a date (playerId only in the POST body). Null on any error. */
export async function fetchMe(date: string, playerId: string): Promise<MyStanding | null> {
  if (!online()) return null;
  try {
    const r = (await request('/api/daily/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, playerId }) })) as Record<string, unknown>;
    if (!r || typeof r !== 'object') return null;
    // uncached server time: corrects the offset taken from the (edge-cached) board
    const t = typeof r.serverNow === 'string' && r.serverNow.length <= 40 ? Date.parse(r.serverNow) : NaN;
    if (Number.isFinite(t)) clockOffset = t - Date.now();
    return { verifiedScore: int(r.verifiedScore), verifiedRank: int(r.verifiedRank), pending: r.pending === true };
  } catch {
    return null;
  }
}

export async function submitRun(body: Record<string, unknown>): Promise<SubmitResult | null> {
  if (!online()) return null;
  try {
    const r = (await request('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) as Record<string, unknown>;
    if (!r || typeof r !== 'object') return null;
    const rank = int(r.provisionalRank);
    const reason = typeof r.reason === 'string' && /^[a-z_]{1,20}$/.test(r.reason) ? r.reason : undefined;
    return { accepted: r.accepted === true, pending: r.pending === true, provisionalRank: rank, ...(reason ? { reason } : {}) };
  } catch {
    return null;
  }
}

/** Friendly words for each server reason code (never the raw server text). */
export function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'outdated':
      return 'GAME UPDATED: RELOAD THE PAGE';
    case 'rate':
      return 'TOO MANY TRIES: WAIT A BIT';
    case 'date':
      return 'THAT DAY IS OVER';
    case 'name':
      return 'INVALID NAME';
    case 'message':
      return 'INVALID MESSAGE';
    case 'words':
      return 'NOT ALLOWED WORDS';
    case 'too_high':
      return 'SCORE NOT PLAUSIBLE';
    case 'paused':
      return 'SUBMISSIONS ARE PAUSED';
    case 'busy':
      return 'BOARD BUSY: TRY AGAIN LATER';
    case 'not_best':
      return 'YOUR BEST (OR PENDING) TODAY IS HIGHER';
    default:
      return 'COULD NOT SUBMIT';
  }
}

/** Would `score` enter this board's top 10, and at which rank (ties: the earlier entry stays ahead)? */
export function wouldRank(board: Board | null, score: number): number | null {
  if (!board || score <= 0) return null;
  const better = board.top.filter((e) => e.score >= score).length;
  return better < 10 ? better + 1 : null;
}
