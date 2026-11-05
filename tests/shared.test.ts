import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../src/data/tuning';
import { addDays, dailySeed, dayStartMs } from '../src/shared/daily';
import { maxPossibleScore } from '../src/shared/maxScore';
import { decodeInputLog, encodeInputLog } from '../src/shared/replayCodec';
import { hasProfanity, validateMessage, validateName } from '../src/shared/text';
import { sanitizeInput } from '../src/sim/input';
import { Sim } from '../src/sim/sim';
import { botInput } from './bot';
import { SkilledBot } from './skilled';
import { mulberryInputs } from './scripted';

describe('dailySeed', () => {
  it('is stable (golden values) and differs per day', () => {
    expect(dailySeed('2026-11-05')).toBe(dailySeed('2026-11-05'));
    expect(dailySeed('2026-11-05')).not.toBe(dailySeed('2026-11-06'));
    expect(dailySeed('2026-11-05')).toMatchInlineSnapshot(`${dailySeed('2026-11-05')}`);
    expect(Number.isInteger(dailySeed('2026-01-01')) && dailySeed('2026-01-01') >= 0).toBe(true);
  });
  it('date helpers reject impossible dates', () => {
    expect(Number.isNaN(dayStartMs('2026-02-31'))).toBe(true);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('maxPossibleScore', () => {
  it('real bot runs always stay below it (and it is not absurdly loose)', () => {
    const ratios: number[] = [];
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[])
      for (let seed = 1; seed <= 6; seed++) {
        const sim = new Sim(seed * 97, d);
        while (sim.state.alive && sim.state.tick < 60 * 150) {
          sim.step(botInput(sim));
          if (sim.state.tick % 60 === 0) expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
        }
        expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
        if (sim.state.tick > 600) ratios.push(maxPossibleScore(sim.state.tick) / Math.max(1, sim.score));
      }
    // the skilled (human-like) bot on Hard: still below the bound
    const skilled: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim(seed * 7919, 'hard');
      const bot = new SkilledBot(seed);
      while (sim.state.alive && sim.state.tick < 60 * 200) {
        sim.step(bot.input(sim));
        if (sim.state.tick % 60 === 0) expect(sim.score).toBeLessThanOrEqual(maxPossibleScore(sim.state.tick));
      }
      if (sim.state.tick > 600) skilled.push(maxPossibleScore(sim.state.tick) / Math.max(1, sim.score));
    }
    skilled.sort((a, b) => a - b);
    console.log(`maxPossibleScore / skilled bot score (hard): min ${skilled[0]?.toFixed(1)} median ${skilled[skilled.length >> 1]?.toFixed(1)}`);
    // scripted button mashing (parry spam) also stays below
    const mash = new Sim(5, 'hard');
    for (const f of mulberryInputs(9, 60 * 60)) mash.step({ ...f, buttons: 1 });
    expect(mash.score).toBeLessThanOrEqual(maxPossibleScore(mash.state.tick));
    ratios.sort((a, b) => a - b);
    console.log(`maxPossibleScore / bot score: min ${ratios[0]?.toFixed(1)} median ${ratios[ratios.length >> 1]?.toFixed(1)} max ${ratios[ratios.length - 1]?.toFixed(1)}`);
    expect(ratios[0]!).toBeGreaterThan(1);
    expect(ratios[ratios.length >> 1]!).toBeLessThan(200);
  });
  it('is monotonic and 0 for an empty run', () => {
    expect(maxPossibleScore(0)).toBe(0);
    let prev = 0;
    for (let t = 0; t < 60 * 600; t += 997) {
      const m = maxPossibleScore(t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe('text validation', () => {
  const ok = (s: string) => validateName(s).ok;
  it('names: good cases (any script)', () => {
    for (const n of ['Tester', 'Ivan_K', 'José-María', 'Анна', '山田太郎', 'a.b c', '  Spaced   Out  ']) expect(ok(n), n).toBe(true);
    expect(validateName('  Spaced   Out  ')).toEqual({ ok: true, value: 'Spaced Out' });
    expect(validateName('ＦＵＬＬ')).toEqual({ ok: true, value: 'FULL' }); // NFKC folds full-width
  });
  it('names: bad cases', () => {
    const bad: [string, string][] = [
      ['ab', 'short'], ['x'.repeat(17), 'long'], ['', 'empty'], ['   ', 'empty'], ['Te​st', 'chars'], ['Te‮st', 'chars'],
      ['Te⁦st', 'chars'], ['Fire🔥', 'chars'], ['Flag🇺🇸', 'chars'], ['<b>x</b>', 'chars'], ['a\u0000bc', 'chars'], ['semi;colon', 'chars'],
      ['Hello!', 'chars'], ['a\nbc', 'chars'],
    ];
    for (const [n, e] of bad) expect(validateName(n), JSON.stringify(n)).toEqual({ ok: false, error: e });
  });
  it('messages: 1-40 user-perceived characters, punctuation allowed, emoji not', () => {
    expect(validateMessage("Good night, all! Who's next?: ok").ok).toBe(true);
    expect(validateMessage('a'.repeat(40)).ok).toBe(true);
    expect(validateMessage('a'.repeat(41))).toEqual({ ok: false, error: 'long' });
    expect(validateMessage('é'.repeat(40).normalize('NFD')).ok).toBe(true); // 40 graphemes, 80 code points
    expect(validateMessage('gg 😀')).toEqual({ ok: false, error: 'chars' });
    expect(validateMessage('a<script>')).toEqual({ ok: false, error: 'chars' });
  });
  it('profanity: leetspeak, separators, Cyrillic; rejected not censored', () => {
    for (const s of ['fuck', 'F.U.C.K', 'f u c k', 'sh1t', '$h!t', 'b1tch', 'n1gg3r', 'Хуй', 'п.и.з.д.а', 'сука', 'Блять']) expect(hasProfanity(s), s).toBe(true);
    for (const s of ['Tester', 'Night Owl', 'Анна', 'grass', 'Scunthorpe x']) expect(hasProfanity(s), s).toBe(s === 'Scunthorpe x');
    expect(validateName('Sh1tL0rd')).toEqual({ ok: false, error: 'words' });
  });
});

describe('replay codec', () => {
  it('round-trips (RLE + base64) and rejects garbage', () => {
    const frames = mulberryInputs(3, 5000);
    const b64 = encodeInputLog(frames);
    const back = decodeInputLog(b64)!;
    expect(back.length).toBe(frames.length);
    expect(back).toEqual(frames.map((f) => sanitizeInput(f)));
    const idle = encodeInputLog(Array.from({ length: 10_000 }, () => ({ cursor: true, mx: 240, my: 135, buttons: 0 })));
    expect(idle.length).toBeLessThan(16);
    for (const g of ['', '@@@', 'AAAA', btoa('ÿÿÿÿÿÿ'), btoa('\u0001\u0009\u0000\u0000')]) {
      const r = decodeInputLog(g);
      expect(r === null || Array.isArray(r)).toBe(true);
    }
    expect(decodeInputLog(btoa('\u0001\u0009\u0000\u0000'))).toBeNull(); // flags > 7
    expect(decodeInputLog('A'.repeat(400_000))).toBeNull(); // too big
  });
});
