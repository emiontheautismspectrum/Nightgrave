/**
 * Numbers, dates and plurals per language (ONE helper each; pure). English keeps today's formats exactly. Russian:
 * thousands grouped with a space (12 345), a decimal comma (X2,50), dates DD.MM.YYYY. No Intl locale data beyond what
 * the browser has: plural rules only, with an English-style fallback when Intl is missing.
 */
import { getLang, type Lang } from './index';

/** An integer score: en "12345" (as today), ru "12 345". */
export function fmtInt(n: number, l: Lang = getLang()): string {
  const s = String(Math.trunc(n));
  if (l !== 'ru') return s;
  const neg = s.startsWith('-');
  const d = neg ? s.slice(1) : s;
  return (neg ? '-' : '') + d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A fixed-decimals number: en "2.50", ru "2,50". */
export function fmtDec(n: number, digits: number, l: Lang = getLang()): string {
  const s = n.toFixed(digits);
  return l === 'ru' ? s.replace('.', ',') : s;
}

/** A UTC date YYYY-MM-DD: en unchanged, ru DD.MM.YYYY. */
export function fmtDate(ymd: string, l: Lang = getLang()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m || l !== 'ru') return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Day and month of a YYYY-MM-DD date (the HUD's daily label): en "MM-DD" (as today), ru "DD.MM". */
export function fmtDayMonth(ymd: string, l: Lang = getLang()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd.slice(5);
  return l === 'ru' ? `${m[3]}.${m[2]}` : `${m[2]}-${m[3]}`;
}

/**
 * The plural form of n: `forms` is keyed by Intl.PluralRules categories (one / few / many / other); a missing form
 * falls back to `other`. Prefer wording without plurals ("WAVE: 3"); use this only where one is unavoidable.
 */
export function plural(n: number, forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }, l: Lang = getLang()): string {
  let cat: Intl.LDMLPluralRule = n === 1 ? 'one' : 'other';
  try {
    cat = new Intl.PluralRules(l).select(n);
  } catch {
    /* no Intl: the English rule */
  }
  return forms[cat] ?? forms.other;
}
