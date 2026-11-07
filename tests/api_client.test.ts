/**
 * The board client: a timeout on every request, ONE retry (after a pause) for the board GET only, never a retry of a
 * POST, and every failure ends as null (the game shows the board as unavailable and keeps working).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const board = { date: '2026-11-05', serverNow: '2026-11-05T12:00:00.000Z', top: [], champion: null };
const ok = () => new Response(JSON.stringify(board), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE', 'https://api.test');
  return import('../src/net/api');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('board client', () => {
  it('GET board: one retry after a network failure, then success', async () => {
    const api = await load();
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    vi.useFakeTimers();
    const p = api.fetchBoard();
    await vi.advanceTimersByTimeAsync(api.GET_RETRY_MS + 400);
    expect(await p).toMatchObject({ date: '2026-11-05', top: [] });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('GET board: two failures -> null after exactly two attempts (offline: the game keeps working)', async () => {
    const api = await load();
    const f = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', f);
    vi.useFakeTimers();
    const p = api.fetchBoard();
    await vi.advanceTimersByTimeAsync(api.GET_RETRY_MS + 400);
    expect(await p).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('POST submit and POST me are never retried; a failure is null', async () => {
    const api = await load();
    const f = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', f);
    expect(await api.submitRun({ x: 1 })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(await api.fetchMe('2026-11-05', '00000000-0000-4000-8000-000000000001')).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('every request carries an abort signal (the 4 s timeout) and omits credentials', async () => {
    const api = await load();
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', f);
    await api.fetchBoard();
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.credentials).toBe('omit');
  });
  it('a timeout aborts the request and ends as null', async () => {
    const api = await load();
    const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))));
    vi.stubGlobal('fetch', f);
    vi.useFakeTimers();
    const p = api.submitRun({ x: 1 });
    await vi.advanceTimersByTimeAsync(4100);
    expect(await p).toBeNull();
  });
});
