/**
 * The localisation layer (render side only: the sim, replays, scores and the board never depend on the language).
 * `t(key, params)` returns the current language's text with `{name}` placeholders filled in; a key missing in a
 * language falls back to English, an unknown key to the key itself (never throws). The language comes from the stored
 * setting ('auto' = the browser, src/i18n/detect.ts) and is applied to <html lang> and the page title.
 */
import { en, type Catalog, type Key } from './en';
import { ru } from './ru';
import { detectLang } from './detect';
import { HTML_LANG, isLang, LANGS, type Lang, type LangSetting } from './langs';

export { LANGS, OWN_NAME, type Lang, type LangSetting } from './langs';
export { LANG_SETTINGS as LANG_SETTINGS_LIST } from './langs';
export type { Key } from './en';

const CATALOG: Record<Lang, Partial<Catalog>> = { en, ru };
let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export const getLang = (): Lang => lang;

/** The language a setting means right now ('auto' = detected from the browser). */
export function resolveLang(setting: LangSetting | undefined, nav?: Parameters<typeof detectLang>[0]): Lang {
  if (isLang(setting)) return setting;
  return detectLang(nav);
}

/** Text for a key in the current language (English if missing there; the key itself if unknown). */
export function t(key: Key, params?: Record<string, string | number>): string {
  const s = CATALOG[lang][key] ?? en[key] ?? String(key);
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Switch the language (no-op when unchanged); listeners re-render. */
export function setLang(l: Lang): void {
  const next = LANGS.includes(l) ? l : 'en';
  applyDocument(next);
  if (next === lang) return;
  lang = next;
  for (const f of [...listeners]) f(lang);
}

/** How many listeners are registered (tests: a language switch must not leak any). */
export const langListenerCount = (): number => listeners.size;

/** Called after the language changed. Returns an unsubscribe function. */
export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The stored setting changed by the player: store it (only a MANUAL choice; 'auto' stays 'auto') and apply it. */
export function chooseLang(setting: LangSetting, store: (s: LangSetting) => void): void {
  store(setting);
  setLang(resolveLang(setting));
}

/** <html lang> (screen readers, hyphenation, fonts). The page title stays the game's name in every language. */
function applyDocument(l: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[l];
}
