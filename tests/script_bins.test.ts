import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every command the project runs must resolve to a binary that is really installed, never to one that only happened to
 * be pulled in by another package (vitest 4 stopped installing vite-node and the verify-replays workflow broke with
 * "vite-node: not found"). Sources: package.json scripts (root and server/), every `run:` of .github/workflows, the
 * commands the e2e scripts spawn, and every `npx <name>` in tests-e2e, tools, docs and CLAUDE.md.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const serverPkg = JSON.parse(read('server/package.json')) as { scripts: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

// shell builtins and tools that come from the system, not from node_modules
const SYSTEM = new Set(['cd', 'echo', 'test', 'exit', 'true', 'false', 'export', 'set', 'sh', 'bash', 'node', 'npm', 'git', 'python3', 'curl', 'cp', 'mv', 'rm', 'mkdir', 'grep', 'cat']);

/** A binary is available when node_modules/.bin has it (root first; server/ for the Worker's own tools). */
function hasBin(name: string, where: 'root' | 'server'): boolean {
  if (existsSync(join(ROOT, 'node_modules', '.bin', name))) return true;
  if (where === 'server') {
    // the Worker's devDependencies are installed separately (npm --prefix server ci): a declared one counts
    if (existsSync(join(ROOT, 'server', 'node_modules', '.bin', name))) return true;
    return Object.hasOwn({ ...serverPkg.dependencies, ...serverPkg.devDependencies }, name);
  }
  return false;
}

type Use = { bin: string; where: 'root' | 'server'; from: string };
type ScriptRef = { script: string; from: string };

/** Splits a shell command into segments and returns the external binaries it starts and the npm scripts it runs. */
function parseCommand(cmd: string, where: 'root' | 'server', from: string, bins: Use[], scripts: ScriptRef[]): void {
  let cwd = where;
  for (const seg of cmd.split(/&&|\|\||;|\|/)) {
    const words = seg.trim().split(/\s+/).filter((w) => w !== '');
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift(); // leading VAR=value
    const [first, ...rest] = words;
    if (first === undefined) continue;
    if (first === 'cd') {
      cwd = rest[0] === '..' ? 'root' : /^server\/?$/.test(rest[0] ?? '') ? 'server' : cwd;
      continue;
    }
    if (first === 'npx') {
      const name = rest.find((w) => !w.startsWith('-'));
      if (name) bins.push({ bin: name, where: cwd, from });
      continue;
    }
    if (first === 'npm') {
      // npm run <script> / npm run -s <script> (the root package only; --prefix runs another package)
      if (rest[0] === 'run' && !rest.includes('--prefix') && cwd === 'root') {
        const name = rest.slice(1).find((w) => !w.startsWith('-'));
        if (name) scripts.push({ script: name, from });
      }
      continue;
    }
    if (SYSTEM.has(first) || first.startsWith('$') || first.startsWith('.') || first.startsWith('/')) continue;
    bins.push({ bin: first, where: cwd, from });
  }
}

function collect(): { bins: Use[]; scripts: ScriptRef[]; files: { file: string; from: string }[] } {
  const bins: Use[] = [];
  const scripts: ScriptRef[] = [];
  const files: { file: string; from: string }[] = [];
  for (const [k, v] of Object.entries(pkg.scripts)) parseCommand(v, 'root', `package.json scripts.${k}`, bins, scripts);
  for (const [k, v] of Object.entries(serverPkg.scripts)) parseCommand(v, 'server', `server/package.json scripts.${k}`, bins, scripts);

  // workflow steps: `run: cmd` and block scalars (`run: |` followed by more-indented lines)
  for (const wf of readdirSync(join(ROOT, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = read(join('.github', 'workflows', wf)).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i] ?? '');
      if (!m) continue;
      let body = (m[2] ?? '').trim();
      if (/^[|>][-+]?$/.test(body)) {
        const block: string[] = [];
        const indent = (m[1] ?? '').length;
        while (i + 1 < lines.length && (lines[i + 1]?.trim() === '' || (lines[i + 1]?.search(/\S/) ?? -1) > indent)) block.push(lines[++i] ?? '');
        body = block.join('\n');
      }
      for (const line of body.split('\n')) parseCommand(line.replace(/#.*$/, ''), 'root', `.github/workflows/${wf}`, bins, scripts);
    }
  }

  // e2e scripts: commands handed to execSync / spawn as string literals, and binaries reached by their path
  for (const f of readdirSync(join(ROOT, 'tests-e2e')).filter((n) => n.endsWith('.cjs'))) {
    const src = read(join('tests-e2e', f));
    for (const m of src.matchAll(/\b(?:execSync|spawnSync|spawn|exec)\(\s*(['"`])((?:(?!\1).)*)\1(?:\s*,\s*\{\s*cwd:\s*([^}]*))?/g)) {
      const where = /'server'/.test(m[3] ?? '') ? 'server' : 'root';
      parseCommand((m[2] ?? '').replace(/\$\{[^}]*\}/g, 'X'), where, `tests-e2e/${f}`, bins, scripts);
    }
    for (const m of src.matchAll(/execFileSync\(\s*'([^']+)'/g)) parseCommand(m[1] ?? '', 'root', `tests-e2e/${f}`, bins, scripts);
    for (const m of src.matchAll(/'node_modules'((?:\s*,\s*'[^']+')+)\s*\)/g)) {
      const parts = [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((p) => p[1] ?? '');
      files.push({ file: join('node_modules', ...parts), from: `tests-e2e/${f}` });
    }
  }

  // documented one-liners: `npx <name>` in tests-e2e, tools, docs and CLAUDE.md (the Worker's tools live in server/)
  const docs = [
    'CLAUDE.md',
    'README.md',
    ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f)),
    ...readdirSync(join(ROOT, 'tests-e2e')).filter((f) => f.endsWith('.cjs')).map((f) => join('tests-e2e', f)),
    ...readdirSync(join(ROOT, 'tools'), { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ts|cjs|mjs|js)$/.test(f)).map((f) => join('tools', f)),
  ].filter((p) => existsSync(join(ROOT, p)));
  for (const p of docs)
    for (const m of read(p).matchAll(/\bnpx\s+(?:-{1,2}[a-z-]+\s+)*([a-z@][a-z0-9@/._-]*)/g))
      bins.push({ bin: m[1] ?? '', where: m[1] === 'wrangler' ? 'server' : 'root', from: p });
  return { bins, scripts, files };
}

describe('every script binary exists', () => {
  const { bins, scripts, files } = collect();

  it('finds the known commands (the parser works)', () => {
    const names = new Set(bins.map((b) => b.bin));
    for (const n of ['vite', 'vitest', 'tsc', 'vite-node', 'wrangler']) expect(names, n).toContain(n);
    expect(bins.filter((b) => b.from.startsWith('.github/workflows/')).length + scripts.filter((s) => s.from.startsWith('.github/workflows/')).length).toBeGreaterThan(0);
    expect(scripts.map((s) => s.script)).toContain('verify:pending');
  });

  it('each binary is installed (node_modules/.bin), not only reachable through another package', () => {
    const missing = bins.filter((b) => !hasBin(b.bin, b.where)).map((b) => `${b.bin} (${b.from})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('each `npm run <script>` names an existing script', () => {
    expect(scripts.filter((s) => !Object.hasOwn(pkg.scripts, s.script)).map((s) => `${s.script} (${s.from})`)).toEqual([]);
  });

  it('each node_modules path an e2e script runs directly exists', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !existsSync(join(ROOT, f.file))).map((f) => `${f.file} (${f.from})`)).toEqual([]);
  });
});
