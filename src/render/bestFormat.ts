/** Best Scores row formatting (pure; no Phaser). */
import type { BestEntry } from '../storage';
import { t } from '../i18n';
import { fmtDate, fmtInt } from '../i18n/format';

/**
 * Best-score rows in FIXED columns (the lines are centred as a whole, so every row must have the same width):
 * rank 2 | score 7 | hero 6 | date 10 | time 5  =  36 characters, for filled and empty rows alike.
 */
export const BEST_COLS = { rank: 2, score: 7, hero: 6, date: 10, time: 5 };
export function fmtBestRow(rank: string, score: string, hero: string, date: string, time: string): string {
  const c = BEST_COLS;
  return `${rank.padStart(c.rank)} ${score.padStart(c.score)} ${hero.padEnd(c.hero)} ${date.padEnd(c.date)} ${time.padStart(c.time)}`;
}
/** The header row in the current language (column words cut to their column width only if a language is longer). */
export const BEST_HEADER = (): string => fmtBestRow(t('board.colRank'), t('board.colScore'), t('board.colHero'), t('best.colDate'), t('board.colTime'));
export const fmtEntry = (i: number, e: BestEntry | undefined): string =>
  e ? fmtBestRow(`${i + 1}`, fmtInt(e.score, undefined, BEST_COLS.score), t(`hero.${e.hero}.short`), fmtDate(e.date), t('unit.seconds', { n: e.secs.toFixed(0) })) : fmtBestRow(`${i + 1}`, '-', '', '', '');

