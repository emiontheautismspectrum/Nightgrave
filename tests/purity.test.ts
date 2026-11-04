import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dcos, dsin } from '../src/sim/dmath';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('src/sim purity', () => {
  const simFiles = files(join(__dirname, '..', 'src', 'sim'));
  const banned: [RegExp, string][] = [
    [/Math\.random/, 'Math.random'],
    [/Date\.now|new Date\b/, 'Date'],
    [/performance\.now/, 'performance.now'],
    [/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|pow|log|log2|log10|log1p|hypot|cbrt|sinh|cosh|tanh)\b/, 'non-IEEE-exact Math fn'],
    [/\*\*/, '** operator (Math.pow semantics)'],
    [/from ['"]phaser['"]/, 'Phaser import'],
    [/\b(window|document|localStorage|setTimeout|setInterval|requestAnimationFrame)\b/, 'browser global'],
  ];
  it('has files to check', () => expect(simFiles.length).toBeGreaterThan(3));
  for (const f of simFiles) {
    it(`${f.split('src')[1]} uses no clocks, randomness or engine-dependent math`, () => {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const [re, name] of banned) expect(re.test(src), `${name} found in ${f}`).toBe(false);
    });
  }
});

describe('dmath', () => {
  it('matches Math.sin/cos closely over a wide range', () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-9);
    }
  });
});
