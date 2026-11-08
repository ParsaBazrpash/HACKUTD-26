import { describe, expect, it } from 'vitest';
import { MAX_CELL, MAX_COLUMNS, MAX_ROWS, parseCsv } from '@/lib/import/csv';

function ok(text: string) {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('csv reader', () => {
  it('reads quoted fields, doubled quotes, embedded commas and newlines, CRLF and LF', () => {
    const r = ok('a,b,c\r\n1,"x, y",z\n"he said ""hi""","line1\nline2",3\r\n');
    expect(r.columns).toEqual(['a', 'b', 'c']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].get('b')).toBe('x, y');
    expect(r.rows[1].get('a')).toBe('he said "hi"');
    expect(r.rows[1].get('b')).toBe('line1\nline2');
  });

  it('picks semicolon and tab delimiters from the header line', () => {
    expect(ok('a;b\n1;2').rows[0].get('b')).toBe('2');
    expect(ok('a\tb\n1\t2').rows[0].get('b')).toBe('2');
    expect(ok('"a;b",c\n1,2').columns).toEqual(['a;b', 'c']);
  });

  it('skips blank lines and fills missing cells', () => {
    const r = ok('a,b\n\n1\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].get('b')).toBe('');
  });

  it('keeps formulas and markup as plain text', () => {
    const r = ok('a\n=cmd|\' /C calc\'!A0\n<img src=x onerror=alert(1)>');
    expect(r.rows[0].get('a')).toBe("=cmd|' /C calc'!A0");
  });

  it('stops at 5,000 rows', () => {
    const body = Array.from({ length: MAX_ROWS }, (_, i) => `${i}`).join('\n');
    expect(parseCsv(`a\n${body}`).ok).toBe(true);
    const over = parseCsv(`a\n${body}\nx`);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toMatch(/5,000/);
  });

  it('stops at 200 columns', () => {
    const header = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`).join(',');
    expect(parseCsv(`${header(MAX_COLUMNS)}\n1`).ok).toBe(true);
    const r = parseCsv(`${header(MAX_COLUMNS + 1)}\n1`);
    expect(!r.ok && r.error).toMatch(/200/);
    const wideRow = parseCsv(`a,b\n${Array.from({ length: MAX_COLUMNS + 1 }, () => 'x').join(',')}`);
    expect(wideRow.ok).toBe(false);
  });

  it('stops at an 8 KB cell, quoted or not', () => {
    expect(parseCsv(`a\n${'x'.repeat(MAX_CELL)}`).ok).toBe(true);
    const plain = parseCsv(`a\n${'x'.repeat(MAX_CELL + 1)}`);
    expect(!plain.ok && plain.error).toMatch(/8 KB/);
    expect(parseCsv(`a\n"${'x'.repeat(9000)}"`).ok).toBe(false);
  });

  it('ends cleanly on an unclosed quote', () => {
    const r = parseCsv('a,b\n1,"never closed\n2,3\n');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/quoted/);
  });

  it('refuses a header with no data', () => {
    expect(parseCsv('a,b\n').ok).toBe(false);
    expect(parseCsv('').ok).toBe(false);
  });

  it('is linear: a long run of quotes and delimiters finishes fast', () => {
    const start = Date.now();
    parseCsv(`a\n${'"",'.repeat(2000)}`);
    parseCsv(`a\n"${'""'.repeat(4000)}"`);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('never throws on random input', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ['a', ',', ';', '\t', '"', '\n', '\r', ' ', '1', '‮'];
    for (let n = 0; n < 300; n += 1) {
      let s = '';
      for (let i = 0; i < 200; i += 1) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => parseCsv(s)).not.toThrow();
    }
  });
});
