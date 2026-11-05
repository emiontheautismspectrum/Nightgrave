import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, handle, LIMITS, type Env } from '../src/index';
import { dailySeed } from '../../src/shared/daily';
import { maxPossibleScore } from '../../src/shared/maxScore';
import { encodeInputLog } from '../../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';
import { makeD1 } from './d1shim';

const ORIGIN = 'https://nightgrave.pages.dev';
export const VTOKEN = 'verifier-token-0123456789abcdef-0123';
const NOW = Date.parse('2026-11-05T12:00:00Z');
const DATE = '2026-11-05';
let env: Env;
let raw: ReturnType<typeof makeD1>['raw'];
let ipN = 0;

beforeEach(() => {
  const d = makeD1();
  raw = d.raw;
  env = { DB: d.DB as Env['DB'], ADMIN_TOKEN: 'secret-admin-token-0123456789abcdef', IP_SALT: 'salt-0123456789abcdef', VERIFIER_TOKEN: VTOKEN, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` };
});

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  const ticks = (over.durationTicks as number) ?? 600;
  return {
    date: DATE, seed: dailySeed(DATE), difficulty: 'hard', score: 100, durationTicks: ticks, hero: 'knight', name: 'Tester',
    playerId: pid(1), tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION,
    replay: encodeInputLog(Array.from({ length: ticks }, () => ({ cursor: true, mx: 240, my: 135, buttons: 0 }))),
    ...over,
  };
}
function post(b: unknown, opts: { now?: number; ip?: string; origin?: string | null; ct?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': opts.ct ?? 'application/json', 'CF-Connecting-IP': opts.ip ?? `10.0.0.${++ipN % 250}` };
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  return handle(new Request('https://api.test/api/submit', { method: 'POST', headers, body: opts.raw ?? JSON.stringify(b) }), env, opts.now ?? NOW);
}
const get = (q = '', now = NOW, ip = '1.1.1.1', origin: string | null = ORIGIN) =>
  handle(new Request(`https://api.test/api/daily${q}`, { headers: { 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) } }), env, now);
const vreq = (method: string, path: string, body?: unknown, token: string | null = VTOKEN) =>
  handle(new Request(`https://api.test${path}`, { method, headers: { ...(token !== null ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, NOW);
/** Server mechanics only: mark every pending submission as verified through the verifier endpoints. */
async function promoteAll(): Promise<void> {
  const { items } = (await (await vreq('GET', '/api/verify/pending?limit=50')).json()) as { items: { id: string }[] };
  for (const it of items) await vreq('POST', `/api/verify/result/${it.id}`, { status: 'verified' });
}
const reason = async (r: Response) => ((await r.json()) as { reason?: string }).reason;

describe('POST /api/submit: every rejection path', () => {
  it('accepts a valid run and returns its rank', async () => {
    const r = await post(body());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ accepted: true, pending: true, provisionalRank: 1 });
    expect(r.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  const cases: [string, Record<string, unknown> | null, { raw?: string; ct?: string; now?: number }, string][] = [
    ['content type', {}, { ct: 'text/plain' }, 'invalid'],
    ['broken JSON', null, { raw: '{"date":' }, 'invalid'],
    ['too large', null, { raw: JSON.stringify({ x: 'a'.repeat(LIMITS.bodyBytes + 10) }) }, 'too_large'],
    ['array body', null, { raw: '[]' }, 'invalid'],
    ['unknown field', { extra: 1 }, {}, 'invalid'],
    ['nested object', { name: { a: 1 } }, {}, 'invalid'],
    ['__proto__ key', null, { raw: JSON.stringify(body()).replace('{', '{"__proto__":{"x":1},') }, 'invalid'],
    ['missing field', { hero: undefined }, {}, 'invalid'],
    ['float score', { score: 1.5 }, {}, 'invalid'],
    ['unsafe integer', { score: 2 ** 60 }, {}, 'invalid'],
    ['bad hero', { hero: 'mage' }, {}, 'invalid'],
    ['bad playerId', { playerId: 'not-a-uuid' }, {}, 'invalid'],
    ['uuid v1', { playerId: '00000000-0000-1000-8000-000000000001' }, {}, 'invalid'],
    ['medium', { difficulty: 'medium' }, {}, 'invalid'],
    ['old date', { date: '2026-11-03', seed: dailySeed('2026-11-03') }, {}, 'date'],
    ['future date', { date: '2026-11-06', seed: dailySeed('2026-11-06') }, {}, 'date'],
    ['wrong seed', { seed: 123 }, {}, 'invalid'],
    ['outdated tuning', { tuningFingerprint: 'deadbeef' }, {}, 'outdated'],
    ['outdated client', { clientVersion: '0.0.1' }, {}, 'outdated'],
    ['too short', { durationTicks: 59 }, {}, 'duration'],
    ['longer than the day so far', { durationTicks: 60 * 60 * 60 * 13 }, {}, 'duration'],
    ['negative score', { score: -1 }, {}, 'too_high'],
    ['score above the bound', { score: maxPossibleScore(600) + 1 }, {}, 'too_high'],
    ['replay tick mismatch', { replay: encodeInputLog([{ cursor: true, mx: 1, my: 1, buttons: 0 }]) }, {}, 'replay'],
    ['replay garbage', { replay: '!!!notbase64' }, {}, 'replay'],
    ['short name', { name: 'ab' }, {}, 'name'],
    ['zero-width name', { name: 'Te​ster' }, {}, 'name'],
    ['bidi override', { name: 'Tes‮ter' }, {}, 'name'],
    ['emoji name', { name: 'Tester🔥' }, {}, 'name'],
    ['profane name', { name: 'Sh1tL0rd' }, {}, 'words'],
    ['cyrillic profanity', { name: 'Ваня Хуй' }, {}, 'words'],
    ['41-char message', { message: 'a'.repeat(41) }, {}, 'message'],
    ['profane message', { message: 'f u c k this' }, {}, 'words'],
  ];
  for (const [name, b, o, why] of cases)
    it(`rejects: ${name} -> ${why}`, async () => {
      const r = await post(b ? body(b) : null, o);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(await reason(r)).toBe(why);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM entries').get()).toEqual({ n: 0 });
    });

  it('foreign origins are refused; no Origin (non-browser) is allowed through validation', async () => {
    expect(await reason(await post(body(), { origin: 'https://evil.example' }))).toBe('origin');
    expect((await post(body({ playerId: pid(2) }), { origin: null })).status).toBe(200);
  });
});

describe('date and grace window', () => {
  const y = '2026-11-04';
  it("yesterday's run is accepted until 00:15 UTC and refused after", async () => {
    const at = (t: string) => post(body({ date: y, seed: dailySeed(y), durationTicks: 600 }), { now: Date.parse(t) });
    expect((await at('2026-11-05T00:14:59Z')).status).toBe(200);
    expect(await reason(await at('2026-11-05T00:15:00Z'))).toBe('date');
  });
  it('duration cannot exceed the time since 00:00 UTC (+ grace)', async () => {
    const now = Date.parse('2026-11-05T00:01:00Z'); // 1 min into the day + 15 min grace = 16 min
    expect((await post(body({ durationTicks: 16 * 60 * 60 }), { now })).status).toBe(200);
    expect(await reason(await post(body({ playerId: pid(3), durationTicks: 16 * 60 * 60 + 60 }), { now }))).toBe('duration');
  });
});

describe('board: best per player, ordering, champion', () => {
  it('keeps each player best run; top 10 ordered by score, ties won by the earlier submission', async () => {
    await post(body({ playerId: pid(1), score: 300, name: 'Alpha' }), { now: NOW });
    await post(body({ playerId: pid(1), score: 200, name: 'Alpha' }), { now: NOW + 1 }); // lower than pending: refused
    const lower = await post(body({ playerId: pid(1), score: 250 }), { now: NOW + 2 });
    expect(await lower.json()).toEqual({ accepted: false, pending: false, provisionalRank: null, reason: 'not_best' });
    await promoteAll();
    await post(body({ playerId: pid(2), score: 300, name: 'Bravo' }), { now: NOW + 10 }); // tie, later
    await post(body({ playerId: pid(3), score: 400, name: 'Charlie', message: 'Hello: night!' }), { now: NOW + 20 });
    await post(body({ playerId: pid(4), score: 100, name: 'Delta', message: 'only rank one shows' }), { now: NOW + 30 });
    for (let i = 5; i < 16; i++) await post(body({ playerId: pid(i), score: 10 + i, name: `Pl${i}` }), { now: NOW + 40 + i });
    await promoteAll();
    const b = (await (await get('', NOW + 100)).json()) as { top: { rank: number; name: string; score: number }[]; champion: unknown };
    expect(b.top.length).toBe(10);
    expect(b.top.slice(0, 4).map((e) => [e.rank, e.name, e.score])).toEqual([[1, 'Charlie', 400], [2, 'Alpha', 300], [3, 'Bravo', 300], [4, 'Delta', 100]]);
    expect(b.champion).toEqual({ name: 'Charlie', message: 'Hello: night!' });
    expect(JSON.stringify(b)).not.toContain('only rank one shows');
    // a better run updates the entry (and its time)
    const up = await post(body({ playerId: pid(1), score: 500, name: 'Alpha' }), { now: NOW + 200 });
    expect(await up.json()).toEqual({ accepted: true, pending: true, provisionalRank: 1 });
  });

  it('SQL injection strings are stored and returned as plain text', async () => {
    const evil = "Rob'); DROP--";
    const r = await post(body({ name: "x'); DROP TABLE entries;--" }));
    expect(await reason(r)).toBe('name'); // ; and ) are not allowed in names anyway
    expect((await post(body({ name: 'O-Brien.x', message: "it's ' OR '1' -- x" }))).status).toBe(200);
    await promoteAll();
    const b = (await (await get()).json()) as { champion: { message: string } };
    expect(b.champion.message).toBe("it's ' OR '1' -- x");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'entries'").get()).toEqual({ n: 1 });
    void evil;
  });
});

describe('GET /api/daily', () => {
  it('today or yesterday only; JSON with serverNow; CORS only for allowed origins', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const j = (await r.json()) as { date: string; serverNow: string };
    expect(j.date).toBe(DATE);
    expect(j.serverNow).toBe(new Date(NOW).toISOString());
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(r.headers.get('Cache-Control')).toContain('max-age=30');
    expect((await get('?date=2026-11-04')).status).toBe(200);
    expect((await get('?date=2026-11-03')).status).toBe(400);
    expect((await get('?date=<script>')).status).toBe(400);
    const foreign = await get('', NOW, '2.2.2.2', 'https://evil.example');
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('preflight: allowed origin 204 with headers, foreign 403', async () => {
    const pre = (o: string) => handle(new Request('https://api.test/api/submit', { method: 'OPTIONS', headers: { Origin: o, 'Access-Control-Request-Method': 'POST' } }), env, NOW);
    const ok = await pre(ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect((await pre('https://evil.example')).status).toBe(403);
  });
  it('unknown routes are 404 JSON', async () => {
    const r = await handle(new Request('https://api.test/admin'), env, NOW);
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('rate limits', () => {
  it('submit: 10 per hour per IP hash -> 429 rate', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(body({ playerId: pid(100 + i) }), { ip: '9.9.9.9' })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    // raw IPs are never stored
    expect(JSON.stringify(raw.prepare('SELECT key FROM ratelimit').all())).not.toContain('9.9.9.9');
  });
  it('submit: 30 per day per playerId (across IPs)', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post(body({ score: 100 + i }), { ip: `7.7.${i}.1` })).status;
    expect(last).toBe(429);
  });
  it('GET: 60 per minute per IP hash', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await get('', NOW, '5.5.5.5')).status;
    expect(last).toBe(429);
  });
});

describe('admin', () => {
  const admin = (method: string, path: string, token?: string) =>
    handle(new Request(`https://api.test${path}`, { method, headers: { 'CF-Connecting-IP': '3.3.3.3', ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}) } }), env, NOW);
  it('wrong or missing token -> 404; right token deletes and clears messages', async () => {
    await post(body({ message: 'gg' }));
    const id = (raw.prepare('SELECT id FROM entries').get() as { id: number }).id;
    expect((await admin('POST', `/api/admin/clear-message/${id}`)).status).toBe(404);
    expect((await admin('POST', `/api/admin/clear-message/${id}`, 'wrong')).status).toBe(404);
    expect((await admin('POST', `/api/admin/clear-message/${id}`, '')).status).toBe(404);
    expect((await admin('POST', `/api/admin/clear-message/${id}`, 'secret-admin-token-0123456789abcdef')).status).toBe(200);
    expect(raw.prepare('SELECT message FROM entries').get()).toEqual({ message: null });
    expect((await admin('DELETE', `/api/admin/entry/${id}`, 'secret-admin-token-0123456789abcdef')).status).toBe(200);
    expect((await admin('DELETE', `/api/admin/entry/${id}`, 'secret-admin-token-0123456789abcdef')).status).toBe(404);
    expect((await admin('DELETE', '/api/admin/entry/abc', 'secret-admin-token-0123456789abcdef')).status).toBe(404);
  });
  it('without an ADMIN_TOKEN configured, admin is always 404', async () => {
    env.ADMIN_TOKEN = undefined;
    expect((await admin('DELETE', '/api/admin/entry/1', '')).status).toBe(404);
  });
  it('admin attempts are rate limited per IP', async () => {
    let last = 0;
    for (let i = 0; i < LIMITS.adminPerMinutePerIp + 1; i++) last = (await admin('DELETE', '/api/admin/entry/1', 'guess')).status;
    expect(last).toBe(429);
  });
});

describe('scheduled cleanup', () => {
  it('deletes entries older than 30 days and old rate-limit rows', async () => {
    raw.prepare("INSERT INTO entries (date, player_id, name, score, hero, duration_ticks, replay, achieved_at) VALUES ('2026-09-01', 'p', 'Old', 1, 'knight', 60, '', 0)").run();
    raw.prepare("INSERT INTO ratelimit (key, window, count) VALUES ('x', 0, 1)").run();
    await post(body());
    await cleanup(env, NOW);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM entries').get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM ratelimit WHERE key = 'x'").get()).toEqual({ n: 0 });
  });
});

describe('review hardening', () => {
  it('a huge run-length replay is rejected cheaply (no frames built)', async () => {
    // one run of 432000 ticks in 8 base64 chars, durationTicks 60
    const r = await post(body({ durationTicks: 60, replay: btoa('\x80\xae\x1a\x01\x00\x00') }));
    expect(await reason(r)).toBe('replay');
  });
  it('IPv6 addresses share a rate-limit bucket per /64', async () => {
    const { ipKey } = await import('../src/index');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe(ipKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
    expect(ipKey('1.2.3.4')).toBe('1.2.3.4');
  });
  it('refuses to run without a strong IP_SALT; a weak ADMIN_TOKEN disables admin', async () => {
    env.IP_SALT = 'short';
    expect((await get()).status).toBe(500);
    env.IP_SALT = 'salt-0123456789abcdef';
    env.ADMIN_TOKEN = 'short-token';
    const r = await handle(new Request('https://api.test/api/admin/entry/1', { method: 'DELETE', headers: { Authorization: 'Bearer short-token' } }), env, NOW);
    expect(r.status).toBe(404);
  });
  it('zalgo, look-alike and accented profanity are rejected', async () => {
    expect(await reason(await post(body({ name: `abc${'́'.repeat(190)}` })))).toBe('name');
    expect(await reason(await post(body({ name: 'fuсk you' })))).toBe('words');
    expect(await reason(await post(body({ name: 'fück you' })))).toBe('words');
  });
});
