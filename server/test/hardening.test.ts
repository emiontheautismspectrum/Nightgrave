/**
 * Security and operations hardening of the Worker: CSRF / content types, failed-token floods (hourly aggregate, capped
 * D1 work), verifier parameters, GET /api/health, the audit log (no personal data, best effort, pruned), idempotent
 * resubmission and a seeded fuzz of everything that decodes untrusted input (bounded time, never throws out).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, handle, LIMITS, resetAuthFailState, type Env } from '../src/index';
import { dailySeed } from '../../src/shared/daily';
import { countTicks, decodeInputLog, encodeInputLog, logHero } from '../../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';
import { parseItem, verifyItem } from '../../tools/verify/core';
import { makeD1 } from './d1shim';

const ORIGIN = 'https://nightgrave.com';
const VTOKEN = 'verifier-token-0123456789abcdef-0123';
const ATOKEN = 'secret-admin-token-0123456789abcdef';
const NOW = Date.parse('2026-11-05T12:00:00Z');
const DATE = '2026-11-05';
let env: Env;
let raw: ReturnType<typeof makeD1>['raw'];
let ipN = 0;
const mkEnv = (DB: unknown): Env => ({ DB: DB as Env['DB'], ADMIN_TOKEN: ATOKEN, IP_SALT: 'salt-0123456789abcdef', VERIFIER_TOKEN: VTOKEN, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` });

beforeEach(() => {
  const d = makeD1();
  raw = d.raw;
  env = mkEnv(d.DB);
  resetAuthFailState();
});

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: DATE, seed: dailySeed(DATE), difficulty: 'hard', score: 100, durationTicks: 600, hero: 'knight', name: 'Tester',
    playerId: pid(1), tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION,
    replay: encodeInputLog(Array.from({ length: 600 }, () => ({ cursor: true, mx: 77, my: 135, buttons: 0 })), 'knight'),
    ...over,
  };
}
const req = (method: string, path: string, opts: { body?: string; ct?: string | null; origin?: string | null; token?: string; ip?: string; e?: Env } = {}) => {
  const h: Record<string, string> = { 'CF-Connecting-IP': opts.ip ?? `10.9.0.${++ipN % 250}` };
  if (opts.ct !== null) h['Content-Type'] = opts.ct ?? 'application/json';
  if (opts.origin !== null) h.Origin = opts.origin ?? ORIGIN;
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  return handle(new Request(`https://api.test${path}`, { method, headers: h, ...(opts.body !== undefined ? { body: opts.body } : {}) }), opts.e ?? env, NOW);
};
const count = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;

describe('CSRF: POST only as application/json; foreign origins refused', () => {
  const meBody = JSON.stringify({ date: DATE, playerId: pid(1) });
  for (const path of ['/api/submit', '/api/daily/me'])
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null, 'application/jsonp', 'application/json-patch+json', 'text/json'])
      it(`${path}: Content-Type ${ct ?? '(none)'} -> 415`, async () => {
        const r = await req('POST', path, { body: path === '/api/submit' ? JSON.stringify(body()) : meBody, ct });
        expect(r.status).toBe(415);
      });
  it('application/json with a charset parameter is accepted; a foreign Origin is refused on both', async () => {
    expect((await req('POST', '/api/submit', { body: JSON.stringify(body()), ct: 'application/json; charset=utf-8' })).status).toBe(200);
    expect((await req('POST', '/api/daily/me', { body: meBody, ct: 'Application/JSON' })).status).toBe(200);
    expect((await req('POST', '/api/submit', { body: JSON.stringify(body({ playerId: pid(2) })), origin: 'https://evil.example' })).status).toBe(403);
    expect((await req('POST', '/api/daily/me', { body: meBody, origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('failed token floods: one aggregate row per hour and kind, capped D1 work', () => {
  it('wrong verifier / admin tokens: plain 404, counted in ONE audit row per kind, no per-attempt rows', async () => {
    for (let i = 0; i < 40; i++) expect((await req('GET', '/api/verify/pending', { token: `wrong-${i}` })).status).toBe(404);
    for (let i = 0; i < 7; i++) expect((await req('DELETE', '/api/admin/entry/1', { token: 'x'.repeat(40) })).status).toBe(404);
    const rows = raw.prepare("SELECT action, result, entry_id FROM audit WHERE action LIKE 'auth_fail_%' ORDER BY action").all();
    expect(rows).toEqual([{ action: 'auth_fail_admin', result: '7', entry_id: null }, { action: 'auth_fail_verify', result: '40', entry_id: null }]);
    expect(count("SELECT COUNT(*) AS n FROM ratelimit")).toBe(0); // no per-IP rows either
  });
  it('past the hourly cap an isolate does no D1 work at all for that kind', async () => {
    const cap = LIMITS.authFailCap;
    LIMITS.authFailCap = 5;
    try {
      let calls = 0;
      const d = makeD1();
      const DB = { prepare: (sql: string) => ((calls++, (d.DB as { prepare: (s: string) => unknown }).prepare(sql))) };
      const e = mkEnv(DB);
      for (let i = 0; i < 5; i++) await req('GET', '/api/verify/pending', { token: 'nope', e });
      const after5 = calls;
      for (let i = 0; i < 200; i++) expect((await req('GET', '/api/verify/pending', { token: 'nope', e })).status).toBe(404);
      expect(calls).toBe(after5);
      expect((d.raw.prepare("SELECT result FROM audit WHERE action = 'auth_fail_verify'").get() as { result: string }).result).toBe('5');
    } finally {
      LIMITS.authFailCap = cap;
    }
  });
  it('the right token still works while wrong ones are being counted', async () => {
    await req('GET', '/api/verify/pending', { token: 'wrong' });
    expect((await req('GET', '/api/verify/pending', { token: VTOKEN })).status).toBe(200);
  });
});

describe('quota: a flood past a limit stops writing to D1', () => {
  it('past the per-IP limit the counter row is no longer written (this isolate answers 429 from memory)', async () => {
    for (let i = 0; i < LIMITS.getPerMinutePerIp + 40; i++) await req('GET', '/api/health', { ip: '6.6.6.6' });
    const rows = raw.prepare("SELECT count FROM ratelimit WHERE key LIKE 'get:%'").all() as { count: number }[];
    expect(rows).toEqual([{ count: LIMITS.getPerMinutePerIp + 1 }]);
  });
  it('POST /api/daily/me has its own lower limit (never edge-cached)', async () => {
    const meBody = JSON.stringify({ date: DATE, playerId: pid(1) });
    const st: number[] = [];
    for (let i = 0; i <= LIMITS.mePerMinutePerIp; i++) st.push((await req('POST', '/api/daily/me', { body: meBody, ip: '6.6.6.7' })).status);
    expect(st.slice(0, LIMITS.mePerMinutePerIp).every((x) => x === 200)).toBe(true);
    expect(st[LIMITS.mePerMinutePerIp]).toBe(429);
    expect(LIMITS.mePerMinutePerIp).toBeLessThanOrEqual(10);
    expect(LIMITS.authFailCap).toBeLessThanOrEqual(100);
  });
});

describe('verifier parameters', () => {
  it('limit is an integer clamped to 1..50; result ids are N-M digits only', async () => {
    for (const l of ['-1', '0', '1e3', '9999', 'abc', '2.5', '%00']) {
      const r = await req('GET', `/api/verify/pending?limit=${l}`, { token: VTOKEN });
      expect(r.status).toBe(200);
    }
    for (const id of ['1', '1-', '-1', '1-2-3', '0x1-1', '1-1e3', '..%2f..', '1234567890123456-1'])
      expect((await req('POST', `/api/verify/result/${id}`, { token: VTOKEN, body: '{"status":"verified"}' })).status).toBe(404);
  });
});

describe('GET /api/health', () => {
  it('empty queue: ok, version, null; no-store; CORS only for allowed origins', async () => {
    const r = await req('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: CLIENT_VERSION, oldestPendingMinutes: null });
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const f = await req('GET', '/api/health', { origin: 'https://evil.example' });
    expect(f.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await req('GET', '/api/health', { origin: null })).status).toBe(200); // an uptime monitor sends no Origin
  });
  it('a pending run waiting > 90 min: ok false with HTTP 200 (the monitor reads the body)', async () => {
    expect((await req('POST', '/api/submit', { body: JSON.stringify(body()) })).status).toBe(200);
    raw.prepare('UPDATE entries SET p_at = ?1').run(NOW - 95 * 60_000);
    const r = await req('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, version: CLIENT_VERSION, oldestPendingMinutes: 95 });
    raw.prepare('UPDATE entries SET p_at = ?1').run(NOW - 30 * 60_000);
    expect(await (await req('GET', '/api/health')).json()).toEqual({ ok: true, version: CLIENT_VERSION, oldestPendingMinutes: 30 });
  });
  it('a D1 error: { ok: false } with 503 and no details', async () => {
    const broken = mkEnv({ prepare: () => { throw new Error('D1_ERROR: secret detail'); } });
    const r = await req('GET', '/api/health', { e: broken });
    expect(r.status).toBe(503);
    const t = await r.text();
    expect(JSON.parse(t)).toEqual({ ok: false });
    expect(t).not.toContain('secret');
  });
  it('the same per-IP rate limit as the public GETs', async () => {
    let last = 0;
    for (let i = 0; i <= LIMITS.getPerMinutePerIp; i++) last = (await req('GET', '/api/health', { ip: '4.4.4.4' })).status;
    expect(last).toBe(429);
  });
});

describe('audit log', () => {
  it('migration 0005: exactly the safe columns', () => {
    const cols = (raw.prepare("SELECT name FROM pragma_table_info('audit')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'at', 'action', 'entry_id', 'result']);
  });
  it('admin actions and verifier verdicts are logged without names, messages, IPs, tokens or player ids', async () => {
    await req('POST', '/api/submit', { body: JSON.stringify(body({ name: 'Visible Name', message: 'secret message' })) });
    await req('POST', '/api/submit', { body: JSON.stringify(body({ playerId: pid(2), name: 'Other', score: 200, replay: encodeInputLog(Array.from({ length: 600 }, () => ({ cursor: true, mx: 99, my: 135, buttons: 0 })), 'knight') })) });
    const items = (await (await req('GET', '/api/verify/pending', { token: VTOKEN })).json()) as { items: { id: string }[] };
    expect(items.items).toHaveLength(2);
    await req('POST', `/api/verify/result/${items.items[0]!.id}`, { token: VTOKEN, body: '{"status":"verified"}' });
    await req('POST', `/api/verify/result/${items.items[1]!.id}`, { token: VTOKEN, body: '{"status":"rejected","reason":"score_mismatch"}' });
    const id = Number(items.items[0]!.id.split('-')[0]);
    await req('POST', `/api/admin/clear-message/${id}`, { token: ATOKEN });
    await req('DELETE', `/api/admin/entry/${id}`, { token: ATOKEN });
    const rows = raw.prepare('SELECT action, entry_id, result FROM audit ORDER BY id').all() as { action: string; entry_id: number; result: string }[];
    expect(rows.map((r) => `${r.action}:${r.result}`)).toEqual(['verify:accepted', 'verify:rejected:score_mismatch', 'admin_clear_message:ok', 'admin_delete:ok']);
    const dump = JSON.stringify(raw.prepare('SELECT * FROM audit').all());
    for (const s of ['Visible Name', 'secret message', 'Other', pid(1), pid(2), VTOKEN, ATOKEN, '10.9.0.', 'salt-']) expect(dump).not.toContain(s);
  });
  it('the daily cron prunes rows older than 90 days', async () => {
    raw.prepare("INSERT INTO audit (at, action, entry_id, result) VALUES (?1, 'verify', 1, 'accepted')").run(NOW - 91 * 86_400_000);
    raw.prepare("INSERT INTO audit (at, action, entry_id, result) VALUES (?1, 'verify', 2, 'accepted')").run(NOW - 89 * 86_400_000);
    await cleanup(env, NOW);
    expect((raw.prepare('SELECT entry_id FROM audit').all() as { entry_id: number }[]).map((r) => r.entry_id)).toEqual([2]);
  });
  it('without migration 0005 (deploy order) every action still succeeds: logging is best effort', async () => {
    const d = makeD1({ upTo: '0005' });
    const e = mkEnv(d.DB);
    expect((await req('POST', '/api/submit', { body: JSON.stringify(body()), e })).status).toBe(200);
    const items = (await (await req('GET', '/api/verify/pending', { token: VTOKEN, e })).json()) as { items: { id: string }[] };
    expect((await req('POST', `/api/verify/result/${items.items[0]!.id}`, { token: VTOKEN, body: '{"status":"verified"}', e })).status).toBe(200);
    const id = Number(items.items[0]!.id.split('-')[0]);
    expect((await req('POST', `/api/admin/clear-message/${id}`, { token: ATOKEN, e })).status).toBe(200);
    expect((await req('GET', '/api/verify/pending', { token: 'wrong', e })).status).toBe(404);
    expect((await req('GET', '/api/health', { e })).status).toBe(200);
    await expect(cleanup(e, NOW)).resolves.toBeUndefined();
  });
});

describe('idempotency', () => {
  it('resubmitting the same run is harmless: no duplicate row, no score change, a clean not_best answer', async () => {
    const b = JSON.stringify(body({ score: 150 }));
    const first = await req('POST', '/api/submit', { body: b });
    expect(await first.json()).toMatchObject({ accepted: true, pending: true });
    const again = await req('POST', '/api/submit', { body: b });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ accepted: false, pending: false, provisionalRank: null, reason: 'not_best' });
    expect(count('SELECT COUNT(*) AS n FROM entries')).toBe(1);
    expect((raw.prepare('SELECT p_score, p_seq FROM entries').get() as { p_score: number; p_seq: number })).toEqual({ p_score: 150, p_seq: 1 });
  });
});

describe('fuzz: untrusted input is rejected in bounded time and never throws out of the handler', () => {
  // a seeded generator for this test only (the sim never uses Math.random)
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const bytes = (n: number) => String.fromCharCode(...Array.from({ length: n }, () => Math.floor(rnd() * 256)));
  const b64 = (n: number) => btoa(bytes(n));
  const nasty = [NaN, -1, -0, 1e308, -1e308, 2 ** 53, 2 ** 60, 1.5, 0, '', '0', null, true, [], {}, 'knight', 'mage', '__proto__', 'x'.repeat(5000)];
  const MAX_MS = 250;

  it('replay codec: random, truncated, oversized and huge-count logs', () => {
    const good = encodeInputLog(Array.from({ length: 300 }, (_, i) => ({ cursor: true, mx: i % 400, my: 100, buttons: 0 })), 'wisp');
    const cases: string[] = [good.slice(0, 7), good.slice(0, 1), `${good}A`, good.replace(/A/g, '/'), btoa('\x00\x02\x09'), btoa('\x00\x02\x00\xff\xff\xff\xff\x7f'), '', '====', '!!!', 'A'.repeat(400_000)];
    for (let i = 0; i < 300; i++) cases.push(rnd() < 0.5 ? b64(Math.floor(rnd() * 400)) : `AAI${b64(Math.floor(rnd() * 64))}`);
    // huge run counts: a varint of 2^32 - 1 followed by a frame
    cases.push(btoa(String.fromCharCode(0, 2, 0, 0xff, 0xff, 0xff, 0xff, 0x0f, 1, 0, 0)));
    for (const c of cases) {
      const t0 = performance.now();
      expect(() => decodeInputLog(c)).not.toThrow();
      expect(() => countTicks(c)).not.toThrow();
      expect(() => logHero(c)).not.toThrow();
      expect(performance.now() - t0).toBeLessThan(MAX_MS);
    }
  });

  it('verifier: random pending items are rejected or verified, never throw, in bounded time', () => {
    for (let i = 0; i < 120; i++) {
      const o: Record<string, unknown> = {
        id: pick(['1-1', '../x', '1-1-1', 'a']), date: pick([DATE, '2026-13-40', '', 'x'.repeat(20)]), seed: pick([dailySeed(DATE), -1, 1.5, NaN]),
        difficulty: pick(['hard', 'easy', '', null]), durationTicks: pick([600, -5, 0, 2 ** 40, NaN, 60 * 60 * 60 * 25]), score: pick([0, -1, 1e9, NaN]),
        hero: pick(['knight', 'wisp', 'mage', '', 7]), tuningFingerprint: pick([tuningFingerprint(), 'x']), clientVersion: pick([CLIENT_VERSION, '0.0.0']),
        replay: pick([b64(Math.floor(rnd() * 200)), '', 'A'.repeat(1000), encodeInputLog([{ cursor: false, mx: 0, my: 0, buttons: 0 }], 'knight')]),
      };
      const t0 = performance.now();
      const it0 = parseItem(o);
      if (it0) expect(['verified', 'rejected']).toContain(verifyItem(it0).status);
      expect(performance.now() - t0).toBeLessThan(MAX_MS * 4);
    }
  });

  it('POST /api/submit and /api/daily/me: random fields, numbers, nesting and sizes -> 4xx, never 500', async () => {
    const keys = Object.keys(body());
    const statuses = new Set<number>();
    for (let i = 0; i < 150; i++) {
      const o: Record<string, unknown> = body({ playerId: pid(100 + i) });
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) o[pick(keys)] = pick(nasty);
      if (rnd() < 0.2) o.replay = b64(Math.floor(rnd() * 3000));
      if (rnd() < 0.1) o.durationTicks = Math.floor(rnd() * 2 ** 31);
      let text = JSON.stringify(o);
      if (rnd() < 0.1) text = '['.repeat(20_000) + ']'.repeat(20_000); // deeply nested
      if (rnd() < 0.05) text = text.slice(0, Math.floor(rnd() * text.length)); // truncated
      if (rnd() < 0.05) text = bytes(500); // not even UTF-8 JSON
      const t0 = performance.now();
      const r = await req('POST', pick(['/api/submit', '/api/daily/me']), { body: text });
      expect(performance.now() - t0).toBeLessThan(MAX_MS * 4);
      statuses.add(r.status);
      expect(r.status).not.toBe(500);
      expect(r.headers.get('Content-Type')).toContain('application/json');
    }
    expect([...statuses].every((s) => s === 200 || (s >= 400 && s < 500))).toBe(true);
  });
});
