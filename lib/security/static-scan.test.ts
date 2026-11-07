// Static guard rails (T21, T23): no injection sinks anywhere in shipped source.
// This reads source files only; it never executes them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DIRS = ['app', 'components', 'hooks', 'lib', 'spacetimedb/src', 'live'];
const SKIP = new Set(['node_modules', '.next']);

function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|jsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SINKS: { name: string; re: RegExp }[] = [
  { name: 'eval', re: /\beval\s*\(/ },
  { name: 'new Function', re: /\bnew\s+Function\s*\(/ },
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/ },
  { name: 'innerHTML', re: /\.(inner|outer)HTML\s*=/ },
  { name: 'document.write', re: /document\.write\s*\(/ },
  { name: 'raw SQL from code', re: /\.sql\s*\(|\bSELECT\s+\*?\s*\w*\s+FROM\b/ },
  { name: 'javascript: URL', re: /['"`]javascript:/ },
];

describe('no injection sinks in shipped source (T21, T23)', () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const sink of SINKS) {
    it(`no ${sink.name}`, () => {
      const hits = files.filter((f) => sink.re.test(stripComments(readFileSync(f, 'utf8'))));
      expect(hits.map((h) => h.slice(ROOT.length + 1))).toEqual([]);
    });
  }

  it('subscriptions use fixed view handles from the generated bindings, never strings', () => {
    const src = stripComments(readFileSync(join(ROOT, 'lib/client/spacetime-backend.ts'), 'utf8'));
    const call = src.slice(src.indexOf('.subscribe(['));
    expect(call).toMatch(/tables\.myStatus/);
    expect(call.slice(0, call.indexOf('])'))).not.toMatch(/['"`]/);
  });
});
