/**
 * Text rules for names and champion messages, shared by the client (live validation) and the Worker (authority).
 * NFKC normalization, trim, collapse inner whitespace; reject control, format (zero-width, bidi override) and emoji;
 * names: letters/digits of any script, space, _ - . (3-16 chars); messages add ! ? , ' : (1-40 user-perceived chars).
 * Profanity is rejected, never censored.
 */
import profanity from './profanity.json';

export type TextError = 'empty' | 'short' | 'long' | 'chars' | 'words';

export function normalizeText(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/** User-perceived characters (grapheme clusters). */
export function graphemes(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n++;
    return n;
  }
  return [...s].length;
}

/** Control/format (zero-width, bidi), surrogates, private use, unassigned, line separators, emoji and their parts. */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Regional_Indicator}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}\u20E3]|\p{Extended_Pictographic}/u;
const NAME_OK = /^[\p{L}\p{M}\p{N} _.\-]+$/u;
const MSG_OK = /^[\p{L}\p{M}\p{N} _.\-!?,':]+$/u;

/** At most this many combining marks in a row (no "zalgo" stacks over the title screen). */
const MARK_RUN = /\p{M}{3,}/u;
/** Common Cyrillic/Greek look-alikes of Latin letters (for the word filter only). */
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', в: 'b', н: 'h', і: 'i', ј: 'j',
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', κ: 'k', τ: 't', ι: 'i', υ: 'u',
};

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'l' };
/** A Cyrillic word as its Latin look-alike ("хуй" -> "xyй"): a mix of scripts is caught either way. */
const latinize = (w: string): string => [...w].map((c) => CONFUSABLE[c] ?? c).join('');
const ALL = (profanity as { words: string[] }).words.map((w) => w.toLowerCase().replace(/ё/g, 'е'));
/** Matched anywhere in the name. */
const WORDS: string[] = [...new Set(ALL.filter((w) => !w.startsWith('^')).flatMap((w) => [w, latinize(w)]))];
/** Matched only at the start of a word or of the whole name ('^' in profanity.json). */
const START_WORDS: string[] = [...new Set(ALL.filter((w) => w.startsWith('^')).map((w) => w.slice(1)).flatMap((w) => [w, latinize(w)]))];

/** Lowercase, map leetspeak, drop separators and everything that is not a letter. Two variants for 1 -> i / l. */
function skeletons(s: string): string[] {
  const base = s.toLowerCase().replace(/ё/g, 'е');
  const stripped = base.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  const latin = [...stripped].map((c) => CONFUSABLE[c] ?? c).join('');
  const out: string[] = [];
  for (const low of [base, stripped, latin])
  for (const one of ['i', 'l']) {
    let r = '';
    for (const ch of low) {
      const m = ch === '1' ? one : (LEET[ch] ?? ch);
      if (/\p{L}/u.test(m)) r += m;
    }
    out.push(r);
  }
  return out;
}

export function hasProfanity(s: string): boolean {
  const v = normalizeText(s);
  const sk = skeletons(v);
  if (WORDS.some((w) => sk.some((k) => k.includes(w)))) return true;
  // start-only words: the whole name (separators dropped: "s.u.k.a") or any word of it ("suka_bot", "Mr Suka")
  const starts = [...sk, ...v.split(/[\s_.\-!?,':]+/u).filter(Boolean).flatMap(skeletons)];
  return START_WORDS.some((w) => starts.some((k) => k.startsWith(w)));
}

export function validateName(raw: unknown): { ok: true; value: string } | { ok: false; error: TextError } {
  if (typeof raw !== 'string' || raw.length > 200) return { ok: false, error: 'long' };
  if (FORBIDDEN.test(raw.normalize('NFKC'))) return { ok: false, error: 'chars' }; // before whitespace folding
  const v = normalizeText(raw);
  if (!v) return { ok: false, error: 'empty' };
  if (FORBIDDEN.test(v) || !NAME_OK.test(v) || MARK_RUN.test(v)) return { ok: false, error: 'chars' };
  if ([...v].length > 32) return { ok: false, error: 'long' };
  const n = graphemes(v);
  if (n < 3) return { ok: false, error: 'short' };
  if (n > 16) return { ok: false, error: 'long' };
  if (hasProfanity(v)) return { ok: false, error: 'words' };
  return { ok: true, value: v };
}

export function validateMessage(raw: unknown): { ok: true; value: string } | { ok: false; error: TextError } {
  if (typeof raw !== 'string' || raw.length > 400) return { ok: false, error: 'long' };
  if (FORBIDDEN.test(raw.normalize('NFKC'))) return { ok: false, error: 'chars' }; // before whitespace folding
  const v = normalizeText(raw);
  if (!v) return { ok: false, error: 'empty' };
  if (FORBIDDEN.test(v) || !MSG_OK.test(v) || MARK_RUN.test(v)) return { ok: false, error: 'chars' };
  if ([...v].length > 80 || graphemes(v) > 40) return { ok: false, error: 'long' };
  if (hasProfanity(v)) return { ok: false, error: 'words' };
  return { ok: true, value: v };
}
