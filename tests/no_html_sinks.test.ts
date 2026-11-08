/**
 * Untrusted text (board names, champion messages, field values) is only ever rendered with text-only APIs: no HTML
 * sink exists anywhere in the shipped code. The board fields are length-capped, no autocomplete, no spellcheck, and
 * their values are only read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(n)) out.push(p);
  }
  return out;
}
// code only: comments mentioning the forbidden APIs ("never innerHTML") are fine
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('no HTML sinks', () => {
  const all = [...files('src', /\.ts$/), ...files('server/src', /\.ts$/), ...files('tools/verify', /\.ts$/), 'index.html', 'privacy.html', 'rules.html', 'credits.html', 'license.html'];
  it('no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function / srcdoc anywhere', () => {
    expect(all.length).toBeGreaterThan(40);
    const bad: string[] = [];
    for (const f of all) {
      const src = code(readFileSync(f, 'utf8'));
      if (/\b(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|\bsrcdoc\b|createContextualFragment/.test(src)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
  it('the board fields: maxLength, autocomplete off, spellcheck off; values only read (never written into HTML)', () => {
    const src = code(readFileSync('src/render/SubmitPanel.ts', 'utf8'));
    expect(src).toMatch(/el\.maxLength = max;/);
    expect(src).toMatch(/el\.autocomplete = 'off';/);
    expect(src).toMatch(/el\.spellcheck = false;/);
    // the placeholders come from the catalog (src/i18n); the length caps stay 16 and 40
    expect(src).toMatch(/this\.field\(t\('submit\.namePh'\), 16,/);
    expect(src).toMatch(/this\.field\(t\('submit\.messagePh'\), 40,/);
    expect(src).not.toMatch(/textContent\s*=\s*[^;]*\.value/);
  });
});
