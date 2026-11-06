/** No dead links: every relative link and image in the Markdown docs points at a file or folder in the repository. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS = ['README.md', 'CLAUDE.md', 'SECURITY.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => join('docs', f))];

/** Inline links / images `[x](target)` and reference definitions `[x]: target`, outside fenced code blocks. */
function targets(md: string): string[] {
  const text = md.replace(/```[\s\S]*?```/g, '');
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)) out.push(m[1]!);
  return out;
}

const external = (t: string): boolean => /^(https?:|mailto:|#)/i.test(t);

describe('documentation links', () => {
  it('finds the documents and their links (the check is not vacuous)', () => {
    expect(DOCS).toEqual(expect.arrayContaining(['README.md', 'docs/DEPLOY.md', 'docs/ASSETS_SPEC.md', 'docs/AUDIO_LIST.md']));
    const readme = targets(readFileSync('README.md', 'utf8')).filter((t) => !external(t));
    expect(readme.length).toBeGreaterThanOrEqual(10);
    expect(readme.filter((t) => t.startsWith('docs/screenshots/')).length).toBeGreaterThanOrEqual(4);
  });
  for (const doc of DOCS)
    it(`${doc}: every relative link and image exists`, () => {
      const dead = targets(readFileSync(doc, 'utf8'))
        .filter((t) => !external(t))
        .map((t) => decodeURIComponent(t.split('#')[0]!))
        .filter((t) => t && !existsSync(normalize(join(dirname(doc), t))));
      expect(dead).toEqual([]);
    });
});
