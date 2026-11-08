/**
 * The UI languages as DATA (no imports: storage.ts and the detector read it). Adding a language: append its code here,
 * add `<code>.ts` (typed by the English catalog), its own name in OWN_NAME, and change src/i18n/detect.ts. Uzbek
 * ('uz', Latin script) is planned: see docs/I18N.md.
 */
export const LANGS = ['en', 'ru'] as const;
export type Lang = (typeof LANGS)[number];
/** The stored setting: a language, or 'auto' (follow the browser; the detected language is never stored). */
export type LangSetting = 'auto' | Lang;
export const LANG_SETTINGS: readonly LangSetting[] = ['auto', ...LANGS];
/** Each language's own name (shown in the switch whatever the current language is). */
export const OWN_NAME: Record<Lang, { short: string; long: string }> = {
  en: { short: 'EN', long: 'ENGLISH' },
  ru: { short: 'RU', long: 'РУССКИЙ' },
};
/** <html lang> per language. */
export const HTML_LANG: Record<Lang, string> = { en: 'en', ru: 'ru' };
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);
