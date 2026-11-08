/**
 * Picking a language for the 'auto' setting from the browser (pure; the navigator is passed in, tests use fakes).
 * The table is DATA. The browser's languages are read in order of preference; the first one the game knows wins
 * (English, or a row of the table): ['de', 'ru'] -> ru, ['en-US', 'ru'] -> en, nothing known -> en. Uzbek players are sent to Russian
 * for now (many read Russian); the row changes to 'uz' when Uzbek ships, and since the automatic choice is never
 * stored, players re-detect then.
 */
import type { Lang } from './langs';

export const DETECT: readonly { prefix: string; lang: Lang }[] = [
  { prefix: 'en', lang: 'en' },
  { prefix: 'ru', lang: 'ru' },
  { prefix: 'uz', lang: 'ru' },
];

/** The language for 'auto': `navigator.languages`, else `navigator.language`, else English (also on any error). */
export function detectLang(nav: { languages?: readonly string[]; language?: string } | undefined = typeof navigator === 'undefined' ? undefined : navigator): Lang {
  try {
    const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const code = raw.trim().toLowerCase();
      if (!code) continue;
      for (const row of DETECT) if (code === row.prefix || code.startsWith(`${row.prefix}-`) || code.startsWith(`${row.prefix}_`)) return row.lang;
    }
  } catch {
    /* a throwing navigator getter: English */
  }
  return 'en';
}
