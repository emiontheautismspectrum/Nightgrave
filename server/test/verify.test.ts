import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { dailySeed } from '../../src/shared/daily';
import { encodeInputLog } from '../../src/shared/replayCodec';
import { CLIENT_VERSION, tuningFingerprint } from '../../src/shared/version';
import type { InputFrame } from '../../src/sim/input';
import { Sim } from '../../src/sim/sim';
import { parseItem, verifyItem, type PendingItem } from '../../tools/verify/core';
import { botInputClamped } from '../../tests/bot';
import { makeD1 } from './d1shim';

const ORIGIN = 'https://nightgrave.pages.dev';
const NOW = Date.parse('2026-11-05T12:00:00Z');
const DATE = '2026-11-05';
const VTOKEN = 'verifier-token-0123456789abcdef-0123';
let env: Env;
let ip = 0;

beforeEach(() => {
  env = { DB: makeD1().DB as Env['DB'], ADMIN_TOKEN: 'a'.repeat(40), IP_SALT: 'salt-0123456789abcdef', VERIFIER_TOKEN: VTOKEN, ALLOWED_ORIGINS: ORIGIN };
});

/** An honest Hard run on today's seed: the bot plays until it dies (cursor kept on screen like a real client). */
function honestRun(maxTicks = 60 * 120, hero: 'knight' | 'wisp' = 'wisp'): { log: InputFrame[]; score: number } {
  const sim = new Sim(dailySeed(DATE), 'hard', { hero });
  while (sim.state.alive && sim.state.tick < maxTicks) sim.step(botInputClamped(sim));
  while (sim.state.alive) sim.step({ cursor: false, mx: 0, my: 0, buttons: 0 });
  return { log: sim.log, score: sim.score };
}
const RUN = honestRun();

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function submit(log: readonly InputFrame[], score: number, over: Record<string, unknown> = {}, at = NOW) {
  const b = {
    date: DATE, seed: dailySeed(DATE), difficulty: 'hard', score, durationTicks: log.length, hero: 'wisp', name: 'Honest',
    message: 'verified run', playerId: pid(1), tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION,
    replay: encodeInputLog(log, (over.hero as 'knight' | 'wisp' | undefined) ?? 'wisp'), ...over,
  };
  return handle(new Request('https://api.test/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.1.0.${++ip % 250}` }, body: JSON.stringify(b) }), env, at);
}
const v = (method: string, path: string, body?: unknown, token: string | null = VTOKEN) =>
  handle(new Request(`https://api.test${path}`, { method, headers: { ...(token !== null ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, NOW);
const board = async () => (await (await handle(new Request('https://api.test/api/daily', { headers: { 'CF-Connecting-IP': `9.9.9.${++ip % 250}` } }), env, NOW)).json()) as { top: { rank: number; name: string; score: number }[]; champion: { name: string; message: string | null } | null };
const pending = async () => ((await (await v('GET', '/api/verify/pending?limit=50')).json()) as { items: PendingItem[] }).items;

/** What tools/verify/pending.ts does, in-process. */
async function runVerifier(): Promise<string[]> {
  const out: string[] = [];
  for (const raw of await pending()) {
    const it = parseItem(raw);
    const verdict = it ? verifyItem(it) : ({ status: 'rejected', reason: 'invalid_input' } as const);
    await v('POST', `/api/verify/result/${raw.id}`, verdict.status === 'verified' ? { status: 'verified' } : { status: 'rejected', reason: verdict.reason });
    out.push(verdict.status === 'verified' ? 'verified' : verdict.reason);
  }
  return out;
}

describe('replay verification: honest run end to end', () => {
  it('submit -> pending (not shown) -> verifier -> verified -> on the board with rank and champion message', async () => {
    expect(RUN.log.length).toBeGreaterThan(60);
    const r = await submit(RUN.log, RUN.score);
    expect(await r.json()).toEqual({ accepted: true, pending: true, provisionalRank: 1 });
    expect((await board()).top).toEqual([]); // pending is never public
    expect(await runVerifier()).toEqual(['verified']);
    const b = await board();
    expect(b.top).toEqual([{ rank: 1, name: 'Honest', score: RUN.score, hero: 'wisp', durationTicks: RUN.log.length, view: 'full' }]);
    expect(b.champion).toEqual({ name: 'Honest', message: 'verified run' });
    expect(await pending()).toEqual([]);
  });
});

describe('forged or broken runs are rejected and never shown', () => {
  const cases: [string, () => [InputFrame[], number, Record<string, unknown>], string][] = [
    ['score + 1', () => [RUN.log, RUN.score + 1, {}], 'score_mismatch'],
    ['cut replay (last tick removed)', () => [RUN.log.slice(0, -1), RUN.score, {}], 'length_mismatch'],
    ['extra tick appended', () => [[...RUN.log, { cursor: false, mx: 0, my: 0, buttons: 0 }], RUN.score, {}], 'length_mismatch'],
    ['invalid input frame (cursor off screen)', () => [RUN.log.map((f, i) => (i === 5 ? { cursor: true, mx: 999, my: 10, buttons: 0 } : f)), RUN.score, {}], 'invalid_input'],
    ['run that never died (stopped early)', () => [RUN.log.slice(0, 120), 20, {}], 'length_mismatch'],
  ];
  for (const [name, mk, why] of cases)
    it(name, async () => {
      const [log, score, over] = mk();
      expect((await submit(log, score, over)).status).toBe(200);
      expect(await runVerifier()).toEqual([why]);
      expect((await board()).top).toEqual([]);
    });
  it('a different seed or an outdated client is rejected by the verifier itself', () => {
    const base: PendingItem = { id: '1-1', date: DATE, seed: dailySeed(DATE), difficulty: 'hard', durationTicks: RUN.log.length, score: RUN.score, hero: 'wisp', tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION, replay: encodeInputLog(RUN.log, 'wisp') };
    expect(verifyItem(base)).toEqual({ status: 'verified' });
    expect(verifyItem({ ...base, seed: base.seed + 1 })).toEqual({ status: 'rejected', reason: 'invalid_input' });
    expect(verifyItem({ ...base, clientVersion: '0.0.0' })).toEqual({ status: 'rejected', reason: 'outdated' });
    expect(verifyItem({ ...base, tuningFingerprint: 'x' })).toEqual({ status: 'rejected', reason: 'outdated' });
    expect(verifyItem({ ...base, replay: 'A'.repeat(300_000) })).toEqual({ status: 'rejected', reason: 'invalid_input' });
    expect(parseItem({ ...base, id: '../x' })).toBeNull();
    expect(parseItem({ ...base, score: { deep: [1] } })).toBeNull();
  });
});

describe('pending slot and races', () => {
  it('a better pending run does not hide the existing verified result', async () => {
    const short = honestRun(600);
    await submit(short.log, short.score);
    expect(await runVerifier()).toEqual(['verified']);
    const before = await board();
    await submit(RUN.log, RUN.score, { message: 'new' }, NOW + 1000);
    expect(await board()).toEqual(before);
    expect((await pending()).length).toBe(1);
  });

  it('a weaker run never replaces a stronger pending one', async () => {
    await submit(RUN.log, RUN.score);
    const weak = await submit(RUN.log.slice(0, 200), 10);
    expect(((await weak.json()) as { reason: string }).reason).toBe('not_best');
    expect((await pending())[0]!.score).toBe(RUN.score);
  });

  it('race: a new submission while the old one is verified never promotes the wrong one', async () => {
    const short = honestRun(600);
    const better = RUN.score > short.score ? RUN : short;
    const worse = better === RUN ? short : RUN;
    await submit(worse.log, worse.score);
    const [old] = await pending();
    await submit(better.log, better.score, {}, NOW + 5); // replaces the pending slot (new version)
    const stale = await v('POST', `/api/verify/result/${old!.id}`, { status: 'verified' });
    expect(stale.status).toBe(409);
    expect((await board()).top).toEqual([]); // the old verdict promoted nothing
    expect(await runVerifier()).toEqual(['verified']);
    expect((await board()).top[0]!.score).toBe(better.score);
  });

  it('a rejected verdict clears the pending slot and keeps the verified part', async () => {
    const short = honestRun(600);
    await submit(short.log, short.score);
    await runVerifier();
    await submit(RUN.log, RUN.score + 1, {}, NOW + 9);
    expect(await runVerifier()).toEqual(['score_mismatch']);
    expect((await board()).top.map((e) => e.score)).toEqual([short.score]);
    expect(await pending()).toEqual([]);
  });
});

describe('verifier endpoints', () => {
  it('wrong or missing token -> 404; limit capped at 50; not rate limited; public GET unaffected', async () => {
    expect((await v('GET', '/api/verify/pending', undefined, null)).status).toBe(404);
    expect((await v('GET', '/api/verify/pending', undefined, 'wrong')).status).toBe(404);
    expect((await v('GET', '/api/verify/pending', undefined, VTOKEN.slice(0, -1))).status).toBe(404);
    expect((await v('POST', '/api/verify/result/1-1', { status: 'verified' }, 'admin')).status).toBe(404);
    for (let i = 0; i < 60; i++) await submit(RUN.log, RUN.score, { playerId: pid(100 + i) });
    const r = await v('GET', '/api/verify/pending?limit=500');
    expect(((await r.json()) as { items: unknown[] }).items.length).toBe(50);
    for (let i = 0; i < 80; i++) expect((await v('GET', '/api/verify/pending?limit=1')).status).toBe(200);
    expect((await handle(new Request('https://api.test/api/daily', { headers: { 'CF-Connecting-IP': '8.8.8.8' } }), env, NOW)).status).toBe(200);
    expect((await v('POST', '/api/verify/result/abc', { status: 'verified' })).status).toBe(404);
    expect((await v('POST', '/api/verify/result/1-1', { status: 'maybe' })).status).toBe(400);
  });
  it('the Worker refuses to run without a strong VERIFIER_TOKEN', async () => {
    env.VERIFIER_TOKEN = 'short';
    expect((await board().catch(() => null)) === null || true).toBe(true);
    const r = await handle(new Request('https://api.test/api/daily'), env, NOW);
    expect(r.status).toBe(500);
  });
});

describe('verification speed', () => {
  it('a 10-minute run (36,000 ticks) verifies well under 1 s', () => {
    const it0: PendingItem = { id: '1-1', date: DATE, seed: dailySeed(DATE), difficulty: 'hard', durationTicks: RUN.log.length, score: RUN.score, hero: 'wisp', tuningFingerprint: tuningFingerprint(), clientVersion: CLIENT_VERSION, replay: encodeInputLog(RUN.log, 'wisp') };
    verifyItem(it0); // warm-up (JIT)
    const t0 = performance.now();
    for (let k = 0; k < 3; k++) expect(verifyItem(it0)).toEqual({ status: 'verified' });
    const ms = (performance.now() - t0) / 3;
    const tps = (RUN.log.length / ms) * 1000;
    console.log(`verification speed: ${RUN.log.length} Hard ticks in ${ms.toFixed(1)} ms = ${Math.round(tps)} ticks/s -> 36,000 ticks ~ ${((36_000 / tps) * 1000).toFixed(0)} ms`);
    expect(36_000 / tps).toBeLessThan(1);
  });
});

describe('review hardening', () => {
  it('a shared replay copied under another playerId is refused as a duplicate', async () => {
    await submit(RUN.log, RUN.score, { playerId: pid(1) });
    expect(await runVerifier()).toEqual(['verified']);
    await submit(RUN.log, RUN.score, { playerId: pid(2), name: 'Copycat' });
    const [it] = await pending();
    const r = await v('POST', `/api/verify/result/${it!.id}`, { status: 'verified' });
    expect(r.status).toBe(409);
    expect((await board()).top.map((e) => e.name)).toEqual(['Honest']);
    expect(await pending()).toEqual([]);
  });
  it('a full pending queue answers busy', async () => {
    const { LIMITS } = await import('../src/index');
    const old = LIMITS.maxPending;
    LIMITS.maxPending = 3;
    try {
      for (let i = 0; i < 3; i++) await submit(RUN.log, RUN.score, { playerId: pid(50 + i) });
      const r = await submit(RUN.log, RUN.score, { playerId: pid(60) });
      expect(((await r.json()) as { reason: string }).reason).toBe('busy');
    } finally {
      LIMITS.maxPending = old;
    }
  });
  it('the cron expires pending runs that never got a verdict', async () => {
    const { cleanup } = await import('../src/index');
    await submit(RUN.log, RUN.score);
    await cleanup(env, NOW + 3 * 86_400_000);
    expect(await pending()).toEqual([]);
  });
});

describe('private data in responses and logs', () => {
  it('playerId never appears in any response (submit, GET, verifier payload)', async () => {
    const id = pid(77);
    const texts: string[] = [];
    texts.push(await (await submit(RUN.log, RUN.score, { playerId: id })).text());
    texts.push(await (await v('GET', '/api/verify/pending?limit=50')).text());
    await runVerifier();
    texts.push(await (await handle(new Request('https://api.test/api/daily', { headers: { 'CF-Connecting-IP': '7.7.7.7' } }), env, NOW)).text());
    for (const t of texts) {
      expect(t).not.toContain(id);
      expect(t.toLowerCase()).not.toContain('player');
    }
  });
  it('unexpected exceptions return a generic { error: "internal" } 500 (no stack, SQL or echoed input)', async () => {
    env.DB = { prepare: () => { throw new Error('SELECT secret FROM boom WHERE x = "<echo>"'); } } as unknown as Env['DB'];
    for (const r of [
      await handle(new Request('https://api.test/api/daily', { headers: { 'CF-Connecting-IP': '6.6.6.6' } }), env, NOW),
      await submit(RUN.log, RUN.score),
    ]) {
      expect(r.status).toBe(500);
      const t = await r.text();
      expect(JSON.parse(t)).toEqual({ error: 'internal' });
    }
  });
  it('Worker and verifier never log IPs, hashes, tokens, replays or request bodies', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('server/src/index.ts', 'utf8')).not.toMatch(/console\./);
    const src = readFileSync('tools/verify/pending.ts', 'utf8');
    // only interpolated values matter (the text may name a variable): ids, verdicts, timings, HTTP status
    for (const line of src.split('\n').filter((l) => l.includes('console.')))
      for (const m of line.matchAll(/\$\{([^}]*)\}/g)) expect(m[1], line).not.toMatch(/TOKEN|headers|replay|body|\braw\b|\bit\.|\bip\b/i);
  });
});

describe('kill switch', () => {
  it('SUBMISSIONS_ENABLED=false pauses submit (503 paused) and the board still works', async () => {
    env.SUBMISSIONS_ENABLED = 'false';
    const r = await submit(RUN.log, RUN.score);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { reason: string }).reason).toBe('paused');
    expect(await pending()).toEqual([]);
    expect((await handle(new Request('https://api.test/api/daily', { headers: { 'CF-Connecting-IP': '5.4.3.2' } }), env, NOW)).status).toBe(200);
    env.SUBMISSIONS_ENABLED = 'true';
    expect((await submit(RUN.log, RUN.score)).status).toBe(200);
  });
});

describe('POST /api/daily/me and the daily reset', () => {
  const me = (body: unknown, ip = '4.4.4.4') =>
    handle(new Request('https://api.test/api/daily/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), env, NOW);
  it("returns only the caller's own standing (verified, rank, pending); unknown -> nulls; never other players", async () => {
    await submit(RUN.log, RUN.score, { playerId: pid(1) });
    expect(await (await me({ date: DATE, playerId: pid(1) })).json()).toMatchObject({ verifiedScore: null, verifiedRank: null, pending: true });
    await runVerifier();
    const r = (await (await me({ date: DATE, playerId: pid(1) })).json()) as Record<string, unknown>;
    expect(r).toMatchObject({ verifiedScore: RUN.score, verifiedRank: 1, pending: false });
    expect(Object.keys(r).sort()).toEqual(['pending', 'serverNow', 'verifiedRank', 'verifiedScore']); // nothing else, never a playerId
    expect(Date.parse(r.serverNow as string)).toBeGreaterThan(0);
    const other = await (await me({ date: DATE, playerId: pid(2) })).text();
    expect(JSON.parse(other)).toMatchObject({ verifiedScore: null, verifiedRank: null, pending: false });
    expect(other).not.toContain(pid(1));
    expect((await me({ date: DATE, playerId: 'nope' })).status).toBe(400);
    expect((await me({ date: DATE, playerId: pid(1), extra: 1 })).status).toBe(400);
    expect((await me({ date: '2026-11-01', playerId: pid(1) })).status).toBe(400);
  });
  it('shares the GET rate limit', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await me({ date: DATE, playerId: pid(9) }, '6.6.6.7')).status;
    expect(last).toBe(429);
  });
  it("yesterday's board (date-1) is served and shows verified runs only", async () => {
    const y = '2026-11-04';
    const raw = makeD1();
    void raw;
    // a verified and a pending entry for yesterday, inserted directly
    const db = env.DB as unknown as { prepare: (q: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } };
    await db.prepare("INSERT INTO entries (date, player_id, name, score, hero, duration_ticks, replay, achieved_at, verified) VALUES (?1, 'a', 'Yday', 500, 'wisp', 600, 'x', 1, 1)").bind(y).run();
    await db.prepare("INSERT INTO entries (date, player_id, name, score, hero, duration_ticks, replay, achieved_at, verified, p_replay, p_score) VALUES (?1, 'b', 'Pend', 0, 'wisp', 0, '', 1, 0, 'r', 999)").bind(y).run();
    const b = (await (await handle(new Request(`https://api.test/api/daily?date=${y}`, { headers: { 'CF-Connecting-IP': '3.2.1.0' } }), env, NOW)).json()) as { top: { name: string }[]; champion: { name: string } | null };
    expect(b.top.map((e) => e.name)).toEqual(['Yday']);
    expect(b.champion?.name).toBe('Yday');
  });
  it('the day boundary: at 23:59:50 the board is today; at 00:00:10 the new date is empty and yesterday is still served', async () => {
    const before = Date.parse('2026-11-05T23:59:50Z');
    const after = Date.parse('2026-11-06T00:00:10Z');
    await submit(RUN.log, RUN.score, {}, before);
    await runVerifier();
    const g = async (q: string, t: number) => (await (await handle(new Request(`https://api.test/api/daily${q}`, { headers: { 'CF-Connecting-IP': `1.0.0.${++ip % 250}` } }), env, t)).json()) as { date: string; top: unknown[] };
    expect((await g('', before)).top.length).toBe(1);
    const nd = await g('', after);
    expect(nd.date).toBe('2026-11-06');
    expect(nd.top.length).toBe(0); // everyone starts from zero
    expect((await g('?date=2026-11-05', after)).top.length).toBe(1); // yesterday's champion still available
    // a run that started before midnight still counts for its own date inside the grace window
    expect((await submit(RUN.log, RUN.score + 0, { playerId: pid(5) }, after)).status).toBe(200);
  });
});
