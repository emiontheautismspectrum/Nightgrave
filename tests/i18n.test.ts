/**
 * The localisation layer: every key in every language with the same placeholders, no empty text, no unused key, no
 * hard-coded UI text left in the render / web code, every character of every language in the bitmap font, the English
 * text unchanged, detection, the stored setting (old saves load as 'auto'), formatting and the runtime fallback.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { getLang, resolveLang, setLang, t } from '../src/i18n';
import { detectLang } from '../src/i18n/detect';
import { LANG_SETTINGS, LANGS } from '../src/i18n/langs';
import { fmtDate, fmtDayMonth, fmtDec, fmtInt, plural } from '../src/i18n/format';
import { HERO_IDS, HEROES } from '../src/data/heroes';
import { loadSave, validateSave, type KV } from '../src/storage';

const CATALOGS: Record<string, Record<string, string>> = { en, ru };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.ts$/.test(n)) out.push(p);
  }
  return out;
}
/** Code without comments (block and line comments). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const SRC = [...files('src/render'), ...files('src/web'), ...files('src/net'), 'src/main.ts', 'src/storage.ts'].map((f) => ({ f, s: code(readFileSync(f, 'utf8')) }));

describe('catalogs', () => {
  it('every language has every key, with the same placeholders, and no empty text', () => {
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      expect(Object.keys(cat).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(cat)) {
        expect(typeof v, `${lang} ${k}`).toBe('string');
        expect(v.trim().length, `${lang} ${k} is empty`).toBeGreaterThan(0);
        expect(placeholders(v), `${lang} ${k} placeholders`).toEqual(placeholders(en[k as keyof typeof en]));
      }
    }
  });

  it('every character of every language is in the bitmap font (else it would render as "?"); no em dash, no "N" sign', () => {
    const xml = readFileSync('public/fonts/px8.xml', 'utf8');
    const ids = new Set([...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])));
    for (const [lang, cat] of Object.entries(CATALOGS))
      for (const [k, v] of Object.entries(cat)) {
        for (const ch of v) if (ch !== '\n') expect(ids.has(ch.codePointAt(0)!), `${lang} ${k}: '${ch}' U+${ch.codePointAt(0)!.toString(16)} is not in px8`).toBe(true);
        expect(v, `${lang} ${k}`).not.toMatch(/[—№]/);
      }
  });

  it('no key is unused (literal keys in the code, plus the documented dynamic families)', () => {
    const all = SRC.map((x) => x.s).join('\n');
    // keys built at runtime: `hero.${id}.name`, `diff.${d}`, `textErr.${code}`, `reason.${code}`, `settings.smooth.${v}`
    const DYNAMIC = [/^hero\.(knight|wisp)\.(name|short|line1|line2)$/, /^diff\.(easy|medium|hard)$/, /^textErr\./, /^reason\./, /^settings\.smooth\./];
    const unused = Object.keys(en).filter((k) => !all.includes(`'${k}'`) && !DYNAMIC.some((r) => r.test(k)));
    expect(unused).toEqual([]);
  });

  it('the English hero names and lines are the HeroDef text (one source for the stats)', () => {
    for (const h of HERO_IDS) {
      expect(en[`hero.${h}.name`]).toBe(HEROES[h].name);
      expect([en[`hero.${h}.line1`], en[`hero.${h}.line2`]]).toEqual(HEROES[h].lines);
      expect(en[`hero.${h}.short`]).toBe(HEROES[h].name.toUpperCase());
    }
  });

  it('the English text is the text before localisation (every former literal, placeholders normalised)', () => {
    const norm = (s: string) => s.replace(/\$\{[^}]*\}/g, '{}').replace(/\{\w+\}/g, '{}');
    const values = new Set(Object.values(en).map(norm));
    const before: string[] = JSON.parse(readFileSync('tests/i18n_en_before.json', 'utf8'));
    expect(before.filter((s) => !values.has(norm(s)))).toEqual([]);
    // composed lines: the same text as before
    setLang('en');
    expect(t('panel.you', { score: '-' })).toBe('YOU - BEST TODAY  -');
  });
});

describe('no hard-coded UI text', () => {
  it('no string literal with a letter goes to addText / setTextValue / setText / textContent in src/render, src/web', () => {
    const ALLOW = new Set(['II', '<', '>', '?', '...', 'X']);
    const bad: string[] = [];
    const pats = [
      /addText\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
      /setTextValue\(\s*[^,()]+,\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
      /\.setText\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
      /textContent\s*=\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
      /(?:title|label|placeholder)\s*:\s*(?:\(\)\s*=>\s*)?(['"`])((?:\\.|(?!\1).)*)\1/g,
    ];
    for (const { f, s } of SRC.filter((x) => /src\/(render|web)\//.test(x.f)))
      for (const re of pats)
        for (const m of s.matchAll(re)) {
          // template parts are code (cut from the first unclosed `${`); catalog keys ('champ.today') are not text
          const lit = m[2]!.replace(/\$\{[^}]*\}/g, '').replace(/\$\{[\s\S]*$/, '');
          if (/^[a-z]+\.[\w.]+$/.test(lit)) continue;
          if (/\p{L}/u.test(lit) && !ALLOW.has(lit)) bad.push(`${f}: ${m[0].slice(0, 80)}`);
        }
    expect(bad).toEqual([]);
  });
});

describe('language selection', () => {
  it('detects from navigator.languages in order of preference; uz -> ru for now; unknown -> en; never throws', () => {
    expect(detectLang({ languages: ['ru-RU', 'en'] })).toBe('ru');
    expect(detectLang({ languages: ['de-DE', 'ru'] })).toBe('ru');
    expect(detectLang({ languages: ['en-US', 'ru'] })).toBe('en');
    expect(detectLang({ languages: ['uz-Latn-UZ'] })).toBe('ru');
    expect(detectLang({ languages: ['uz'] })).toBe('ru');
    expect(detectLang({ languages: ['fr', 'de'] })).toBe('en');
    expect(detectLang({ languages: [], language: 'RU' })).toBe('ru');
    expect(detectLang({ languages: [], language: '' })).toBe('en');
    expect(detectLang({})).toBe('en');
    expect(detectLang(undefined)).toBe('en');
    expect(detectLang({ languages: ['rus'] })).toBe('en'); // a prefix must end at a subtag boundary
    const throwing = Object.defineProperty({}, 'languages', { get: () => { throw new Error('blocked'); } });
    expect(detectLang(throwing)).toBe('en');
  });

  it('the setting: a manual choice wins, auto follows the browser', () => {
    expect(resolveLang('en', { languages: ['ru'] })).toBe('en');
    expect(resolveLang('ru', { languages: ['en'] })).toBe('ru');
    expect(resolveLang('auto', { languages: ['ru'] })).toBe('ru');
    expect(resolveLang(undefined, { languages: ['ru'] })).toBe('ru');
    expect(LANG_SETTINGS).toEqual(['auto', ...LANGS]);
  });

  it('an old save without the field loads as auto, nothing else lost; unknown / malformed values are ignored', () => {
    const old = { v: 1, settings: { master: 50, touchHintSeen: true }, hero: 'wisp', difficulty: 'hard', best: { easy: [], medium: [], hard: [{ score: 1234, hero: 'wisp', date: '2026-11-01', secs: 61.2 }] }, daily: [], playerId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d', boardName: 'Котик' };
    const kv: KV = { getItem: () => JSON.stringify(old), setItem: () => undefined };
    const s = loadSave(kv);
    expect(s.settings.language).toBe('auto');
    expect(s.settings.master).toBe(50);
    expect(s.hero).toBe('wisp');
    expect(s.best.hard[0]!.score).toBe(1234);
    expect(s.playerId).toBe(old.playerId);
    expect(s.boardName).toBe('Котик');
    for (const bad of ['de', 'RU', '', null, 5, { x: 1 }, ['ru'], '__proto__', 'ru ']) expect(validateSave({ ...old, settings: { language: bad } }).settings.language).toBe('auto');
    expect(validateSave({ ...old, settings: { language: 'ru' } }).settings.language).toBe('ru');
    expect(validateSave({ ...old, settings: { language: 'en' } }).settings.language).toBe('en');
  });

  it('t(): placeholders, the English fallback for a missing key, the key itself when unknown; setLang ignores junk', () => {
    setLang('en');
    expect(t('death.score', { score: 5 })).toBe('SCORE 5');
    expect(t('hud.wave', {})).toBe('WAVE {n}'); // a missing parameter stays visible, never throws
    expect(t('no.such.key' as never)).toBe('no.such.key');
    setLang('ru');
    expect(getLang()).toBe('ru');
    // a key missing in a language falls back to English (runtime safety; the type forbids it at build time)
    const k = 'common.back' as const;
    const saved = ru[k];
    delete (ru as Record<string, string>)[k];
    expect(t(k)).toBe(en[k]);
    (ru as Record<string, string>)[k] = saved;
    setLang('xx' as never);
    expect(getLang()).toBe('en');
  });
});

describe('formatting', () => {
  it('English is unchanged; Russian groups thousands, uses a decimal comma and DD.MM.YYYY', () => {
    expect(fmtInt(1234567, 'en')).toBe('1234567');
    expect(fmtInt(1234567, 'ru')).toBe('1 234 567');
    expect(fmtInt(999, 'ru')).toBe('999');
    expect(fmtInt(-12345, 'ru')).toBe('-12 345');
    expect(fmtDec(2.5, 2, 'en')).toBe('2.50');
    expect(fmtDec(2.5, 2, 'ru')).toBe('2,50');
    expect(fmtDate('2026-11-08', 'en')).toBe('2026-11-08');
    expect(fmtDate('2026-11-08', 'ru')).toBe('08.11.2026');
    expect(fmtDate('junk', 'ru')).toBe('junk');
    expect(fmtDayMonth('2026-11-08', 'en')).toBe('11-08');
    expect(fmtDayMonth('2026-11-08', 'ru')).toBe('08.11');
  });
  it('plural(): Intl plural rules through one helper', () => {
    const f = { one: 'ВОЛНА', few: 'ВОЛНЫ', many: 'ВОЛН', other: 'ВОЛНЫ' };
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, f, 'ru'))).toEqual(['ВОЛНА', 'ВОЛНЫ', 'ВОЛН', 'ВОЛН', 'ВОЛНА', 'ВОЛНЫ', 'ВОЛН']);
    expect(plural(1, { one: 'WAVE', other: 'WAVES' }, 'en')).toBe('WAVE');
    expect(plural(3, { one: 'WAVE', other: 'WAVES' }, 'en')).toBe('WAVES');
  });
});
