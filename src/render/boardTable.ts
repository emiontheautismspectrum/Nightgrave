/** The title's board table (pure: no Phaser): fixed columns rank 2, name 16, score 7, hero 6, time 5. */
import { t } from '../i18n';

/** The header row (its own spacing, so the English header is the previous one byte for byte). */
export function boardHeader(): string {
  return `${t('board.colRank').padEnd(2)} ${t('board.colName').padEnd(17)}${t('board.colScore').padStart(6)}  ${t('board.colHero').padEnd(6)}  ${t('board.colTime')}`;
}

/** One row of the table. */
export function boardRow(rank: string, name: string, score: string, hero: string, time: string): string {
  return `${rank.padStart(2)} ${name.padEnd(16)} ${score.padStart(7)}  ${hero.padEnd(6)} ${time.padStart(5)}`;
}
