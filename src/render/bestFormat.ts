/** Best Scores row formatting (pure; no Phaser). */
import type { BestEntry } from '../storage';

/**
 * Best-score rows in FIXED columns (the lines are centred as a whole, so every row must have the same width):
 * rank 2 | score 7 | hero 6 | date 10 | time 5  =  36 characters, for filled and empty rows alike.
 */
export const BEST_COLS = { rank: 2, score: 7, hero: 6, date: 10, time: 5 };
export function fmtBestRow(rank: string, score: string, hero: string, date: string, time: string): string {
  const c = BEST_COLS;
  return `${rank.padStart(c.rank)} ${score.padStart(c.score)} ${hero.padEnd(c.hero)} ${date.padEnd(c.date)} ${time.padStart(c.time)}`;
}
export const BEST_HEADER = fmtBestRow('#', 'SCORE', 'HERO', 'DATE', 'TIME');
export const fmtEntry = (i: number, e: BestEntry | undefined): string =>
  e ? fmtBestRow(`${i + 1}`, String(e.score), e.hero.toUpperCase(), e.date, `${e.secs.toFixed(0)}S`) : fmtBestRow(`${i + 1}`, '-', '', '', '');

