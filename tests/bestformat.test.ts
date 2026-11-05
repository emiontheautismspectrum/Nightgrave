import { describe, expect, it } from 'vitest';
import { BEST_HEADER, fmtEntry } from '../src/render/bestFormat';

describe('Best Scores layout', () => {
  it('empty and filled rows share fixed columns (same width, rank at the left edge)', () => {
    const rows = [
      BEST_HEADER,
      fmtEntry(0, { score: 1234567, hero: 'knight', date: '2026-11-05', secs: 123.4 }),
      fmtEntry(1, { score: 5, hero: 'wisp', date: '2026-11-05', secs: 2 }),
      fmtEntry(2, undefined),
      fmtEntry(4, undefined),
    ];
    for (const r of rows) expect(r.length).toBe(BEST_HEADER.length);
    expect(rows[3]!.slice(0, 2)).toBe(' 3');
    expect(rows[1]!.slice(0, 2)).toBe(' 1');
    // the score column ends at the same position in every row
    const end = BEST_HEADER.indexOf('SCORE') + 'SCORE'.length;
    expect(rows[1]!.slice(end - 7, end)).toBe('1234567');
    expect(rows[3]!.slice(end - 1, end)).toBe('-');
  });
});
