/**
 * Nightgrave API (Cloudflare Worker + D1): the Hard "Today's best" board.
 *   GET  /api/daily[?date=YYYY-MM-DD]   top 10 + champion of today (or yesterday), edge-cached 30 s
 *   POST /api/submit                    one run; the server keeps each player's best run per UTC date
 *   DELETE /api/admin/entry/:id         moderation (Bearer ADMIN_TOKEN)
 *   POST /api/admin/clear-message/:id   moderation (Bearer ADMIN_TOKEN)
 * JSON only, never HTML; user text is never echoed back in errors; all SQL uses bound parameters.
 */
import { addDays, dailySeed, dayStartMs, utcDateKey, DATE_RE } from '../../src/shared/daily';
import { maxPossibleScore } from '../../src/shared/maxScore';
import { countTicks, MAX_REPLAY_BYTES } from '../../src/shared/replayCodec';
import { validateMessage, validateName } from '../../src/shared/text';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  IP_SALT?: string;
  ALLOWED_ORIGINS?: string;
}

export const LIMITS = {
  bodyBytes: 300 * 1024,
  graceMs: 15 * 60 * 1000,
  submitPerHourPerIp: 10,
  submitPerDayPerPlayer: 30,
  getPerMinutePerIp: 60,
  adminPerMinutePerIp: 20,
  cacheSeconds: 30,
  keepDays: 30,
};

const FIELDS: Record<string, 'string' | 'number'> = {
  date: 'string', seed: 'number', difficulty: 'string', score: 'number', durationTicks: 'number', hero: 'string',
  name: 'string', message: 'string', playerId: 'string', tuningFingerprint: 'string', clientVersion: 'string', replay: 'string',
};
const REQUIRED = Object.keys(FIELDS).filter((k) => k !== 'message');
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ------------------------------------------------------------------ helpers

function origins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const o = req.headers.get('Origin');
  return o && origins(env).includes(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : { Vary: 'Origin' };
}

function json(body: unknown, status: number, req: Request, env: Env, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cache,
      ...corsHeaders(req, env),
    },
  });
}
const reject = (reason: string, status: number, req: Request, env: Env): Response => json({ accepted: false, rank: null, reason }, status, req, env);
const notFound = (req: Request, env: Env): Response => json({ error: 'not_found' }, 404, req, env);

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two secrets (compares their SHA-256 digests byte by byte). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = a.length === 0 || b.length === 0 ? 1 : 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Raw IPs are never stored: only SHA-256(ip + IP_SALT). */
async function ipHash(req: Request, env: Env): Promise<string> {
  return sha256Hex(`${ipKey(req.headers.get('CF-Connecting-IP') ?? 'unknown')}${env.IP_SALT ?? ''}`);
}

/** IPv4 as is; IPv6 reduced to its /64 prefix (one customer owns a whole /64, rotating inside it must not help). */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Fixed-window counter in D1. Returns true if the call is within the limit. */
async function allow(env: Env, key: string, windowMs: number, limit: number, now: number): Promise<boolean> {
  const win = Math.floor(now / windowMs) * windowMs;
  const row = await env.DB.prepare(
    'INSERT INTO ratelimit (key, window, count) VALUES (?1, ?2, 1) ON CONFLICT (key, window) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(key, win).first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

function cacheKey(date: string): Request {
  return new Request(`https://nightgrave-cache.internal/api/daily/${date}`);
}
async function purge(date: string): Promise<void> {
  try {
    await caches.default.delete(cacheKey(date));
  } catch {
    /* no cache in this environment */
  }
}

interface Row {
  id: number;
  name: string;
  message: string | null;
  score: number;
  hero: string;
  duration_ticks: number;
}

async function board(env: Env, date: string): Promise<{ top: object[]; champion: { name: string; message: string | null } | null }> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, message, score, hero, duration_ticks FROM entries WHERE date = ?1 ORDER BY score DESC, achieved_at ASC, id ASC LIMIT 10',
  ).bind(date).all<Row>();
  const top = (results ?? []).map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, hero: r.hero, durationTicks: r.duration_ticks }));
  const first = results?.[0];
  // the message is stored with every entry but only ever shown for rank 1
  return { top, champion: first ? { name: first.name, message: first.message ?? null } : null };
}

// ------------------------------------------------------------------ handlers

async function getDaily(req: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(req.url);
  const today = utcDateKey(new Date(now));
  const date = url.searchParams.get('date') ?? today;
  if (!DATE_RE.test(date) || (date !== today && date !== addDays(today, -1))) return json({ error: 'date' }, 400, req, env);
  let cached: Response | undefined;
  try {
    cached = await caches.default.match(cacheKey(date));
  } catch {
    cached = undefined;
  }
  let data: { top: object[]; champion: object | null };
  if (cached) data = (await cached.json()) as typeof data; // cached hits never touch D1
  else {
    if (!(await allow(env, `get:${await ipHash(req, env)}`, 60_000, LIMITS.getPerMinutePerIp, now))) return json({ error: 'rate' }, 429, req, env);
    data = await board(env, date);
    try {
      await caches.default.put(cacheKey(date), new Response(JSON.stringify(data), { headers: { 'Cache-Control': `public, max-age=${LIMITS.cacheSeconds}` } }));
    } catch {
      /* no cache here */
    }
  }
  // serverNow is never cached: the client uses it for the Hard seed date; CORS headers are added per request
  return json({ date, serverNow: new Date(now).toISOString(), ...data }, 200, req, env, `public, max-age=${LIMITS.cacheSeconds}`);
}

/** Parse and validate a submission. Returns a reason code or the clean fields. */
export function checkBody(raw: unknown, now: number):
  | { reason: string; status: number }
  | { v: { date: string; score: number; durationTicks: number; hero: string; name: string; message: string | null; playerId: string; replay: string } } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'invalid', status: 400 };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const t = FIELDS[k];
    if (!Object.hasOwn(FIELDS, k) || !t) return { reason: 'invalid', status: 400 };
    if (typeof o[k] !== t) return { reason: 'invalid', status: 400 };
  }
  for (const k of REQUIRED) if (!(k in o)) return { reason: 'invalid', status: 400 };
  for (const k of ['seed', 'score', 'durationTicks']) if (!Number.isSafeInteger(o[k])) return { reason: 'invalid', status: 400 };
  if (o.hero !== 'knight' && o.hero !== 'wisp') return { reason: 'invalid', status: 400 };
  if (!UUID4.test(o.playerId as string)) return { reason: 'invalid', status: 400 };
  // 2. Hard only; today, or yesterday until 00:15 UTC
  if (o.difficulty !== 'hard') return { reason: 'invalid', status: 400 };
  const date = o.date as string;
  const today = utcDateKey(new Date(now));
  const start = dayStartMs(date);
  const okDate = date === today || (date === addDays(today, -1) && now - dayStartMs(today) < LIMITS.graceMs);
  if (!Number.isFinite(start) || !okDate) return { reason: 'date', status: 400 };
  // 3. seed and versions
  if (o.seed !== dailySeed(date)) return { reason: 'invalid', status: 400 };
  if (o.tuningFingerprint !== tuningFingerprint() || o.clientVersion !== CLIENT_VERSION) return { reason: 'outdated', status: 409 };
  // 4. duration: >= 1 s and no longer than the time since 00:00 UTC of that date (+ the grace)
  const d = o.durationTicks as number;
  if (d < 60 || d > Math.floor(((now - start + LIMITS.graceMs) / 1000) * 60)) return { reason: 'duration', status: 400 };
  // 5. plausibility
  const score = o.score as number;
  if (score < 0 || score > maxPossibleScore(d)) return { reason: 'too_high', status: 400 };
  // 6. replay decodes, fits and matches the duration (cheap: run lengths only, stops past durationTicks)
  const replay = o.replay as string;
  if (replay.length > Math.ceil((MAX_REPLAY_BYTES * 4) / 3) + 4 || countTicks(replay, d) !== d) return { reason: 'replay', status: 400 };
  // 7. text
  const name = validateName(o.name);
  if (!name.ok) return { reason: name.error === 'words' ? 'words' : 'name', status: 400 };
  let message: string | null = null;
  if (o.message !== undefined && o.message !== '') {
    const m = validateMessage(o.message);
    if (!m.ok) return { reason: m.error === 'words' ? 'words' : 'message', status: 400 };
    message = m.value;
  }
  return { v: { date, score, durationTicks: d, hero: o.hero as string, name: name.value, message, playerId: o.playerId as string, replay } };
}

/** Read at most `max` bytes of the body (a chunked body without Content-Length cannot flood memory). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

async function postSubmit(req: Request, env: Env, now: number): Promise<Response> {
  // 1. transport: JSON, size
  const ct = (req.headers.get('Content-Type') ?? '').toLowerCase();
  if (!ct.startsWith('application/json')) return reject('invalid', 415, req, env);
  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > LIMITS.bodyBytes) return reject('too_large', 413, req, env);
  const buf = await readCapped(req, LIMITS.bodyBytes);
  if (!buf) return reject('too_large', 413, req, env);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf));
  } catch {
    return reject('invalid', 400, req, env);
  }
  const c = checkBody(raw, now);
  if ('reason' in c) return reject(c.reason, c.status, req, env);
  const v = c.v;
  // 8. rate limits: per IP hash and per player
  const ip = await ipHash(req, env);
  if (!(await allow(env, `submit:${ip}`, 3_600_000, LIMITS.submitPerHourPerIp, now))) return reject('rate', 429, req, env);
  if (!(await allow(env, `player:${v.playerId}`, 86_400_000, LIMITS.submitPerDayPerPlayer, now))) return reject('rate', 429, req, env);
  // keep only the player's best run per date (insert, or update if higher)
  const res = await env.DB.prepare(
    `INSERT INTO entries (date, player_id, name, message, score, hero, duration_ticks, replay, achieved_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT (date, player_id) DO UPDATE SET
       name = excluded.name, message = excluded.message, score = excluded.score, hero = excluded.hero,
       duration_ticks = excluded.duration_ticks, replay = excluded.replay, achieved_at = excluded.achieved_at
     WHERE excluded.score > entries.score`,
  ).bind(v.date, v.playerId, v.name, v.message, v.score, v.hero, v.durationTicks, v.replay, now).run();
  const changed = (res.meta?.changes ?? 0) > 0;
  const best = await env.DB.prepare('SELECT id, score, achieved_at FROM entries WHERE date = ?1 AND player_id = ?2').bind(v.date, v.playerId).first<{ id: number; score: number; achieved_at: number }>();
  if (!best) return reject('invalid', 500, req, env);
  const above = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM entries WHERE date = ?1 AND (score > ?2 OR (score = ?2 AND (achieved_at < ?3 OR (achieved_at = ?3 AND id < ?4))))',
  ).bind(v.date, best.score, best.achieved_at, best.id).first<{ n: number }>();
  const rank = (above?.n ?? 0) + 1;
  if (changed && rank <= 10) await purge(v.date);
  // accepted = this run is now the player's entry; rank is the player's (best) rank, null outside the top 10
  return json({ accepted: changed, rank: rank <= 10 ? rank : null, ...(changed ? {} : { reason: 'not_best' }) }, 200, req, env);
}

async function admin(req: Request, env: Env, now: number, parts: string[]): Promise<Response> {
  if (!(await allow(env, `admin:${await ipHash(req, env)}`, 60_000, LIMITS.adminPerMinutePerIp, now))) return json({ error: 'rate' }, 429, req, env);
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // a missing or weak admin token disables moderation entirely (never a guessable password)
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || !(await safeEqual(token, env.ADMIN_TOKEN))) return notFound(req, env);
  const id = Number(parts[4]);
  if (!Number.isSafeInteger(id) || id < 1 || parts.length !== 5) return notFound(req, env);
  const row = await env.DB.prepare('SELECT date FROM entries WHERE id = ?1').bind(id).first<{ date: string }>();
  if (!row) return notFound(req, env);
  if (req.method === 'DELETE' && parts[3] === 'entry') await env.DB.prepare('DELETE FROM entries WHERE id = ?1').bind(id).run();
  else if (req.method === 'POST' && parts[3] === 'clear-message') await env.DB.prepare('UPDATE entries SET message = NULL WHERE id = ?1').bind(id).run();
  else return notFound(req, env);
  await purge(row.date);
  return json({ ok: true }, 200, req, env);
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/'); // ['', 'api', ...]
  const allowed = origins(env);
  const origin = req.headers.get('Origin');
  // without a salt the stored IP hashes could be reversed: refuse to run rather than store weak hashes
  if (!env.IP_SALT || env.IP_SALT.length < 16) return json({ error: 'server' }, 500, req, env);
  if (req.method === 'OPTIONS') {
    if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(req, env), 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' },
    });
  }
  try {
    if (url.pathname === '/api/daily' && req.method === 'GET') return await getDaily(req, env, now);
    if (url.pathname === '/api/submit' && req.method === 'POST') {
      // browsers always send Origin on cross-origin POST: refuse foreign sites (non-browser clients send none)
      if (origin && !allowed.includes(origin)) return reject('origin', 403, req, env);
      return await postSubmit(req, env, now);
    }
    if (parts[1] === 'api' && parts[2] === 'admin') return await admin(req, env, now, parts);
    return notFound(req, env);
  } catch {
    return json({ error: 'server' }, 500, req, env);
  }
}

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
  const oldest = addDays(utcDateKey(new Date(now)), -LIMITS.keepDays);
  await env.DB.prepare('DELETE FROM entries WHERE date < ?1').bind(oldest).run();
  await env.DB.prepare('DELETE FROM ratelimit WHERE window < ?1').bind(now - 86_400_000).run();
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env),
  scheduled: (_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void => ctx.waitUntil(cleanup(env)),
};
