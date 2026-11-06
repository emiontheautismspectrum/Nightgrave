import { describe, expect, it } from 'vitest';
import { clampLines } from '../src/render/textFit';

describe('clampLines (the champion message on phones)', () => {
  it('wraps on words, keeps short text whole', () => {
    expect(clampLines('Parry the night away', 30, 2)).toEqual(['Parry the night away']);
    expect(clampLines('Parry the night away', 10, 2)).toEqual(['Parry the', 'night away']);
  });
  it('at most maxLines with a clean "..." and never wider than maxChars', () => {
    const out = clampLines('Supercalifragilistic parries forever and ever, night', 16, 2);
    expect(out).toHaveLength(2);
    expect(out[1]!.endsWith('...')).toBe(true);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(16);
  });
  it('breaks a word longer than a line; collapses whitespace; empty in, empty out', () => {
    expect(clampLines('WWWWWWWWWWWWWWWW', 10, 1)).toEqual(['WWWWWWW...']);
    expect(clampLines('a   b\n c', 20, 2)).toEqual(['a b c']);
    expect(clampLines('', 20, 2)).toEqual([]);
  });
});
