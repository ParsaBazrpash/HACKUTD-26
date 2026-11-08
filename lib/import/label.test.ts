import { describe, expect, it } from 'vitest';
import { importedNotesSource, importedSource, sourceLine } from '@/lib/import/label';

const H = 'a'.repeat(64);

describe('imported labels', () => {
  it('finds the file name and hash in an imported entry', () => {
    const text = `Imported: Beacon on PC-1 (2 alerts, x to y UTC, severity high).\n${sourceLine('alerts.csv', H)}`;
    expect(importedSource(text)).toEqual({ fileName: 'alerts.csv', sha256: H });
  });

  it('needs the fixed prefix, a valid Source line at the end, and a 64 character lowercase hash', () => {
    const src = sourceLine('a.csv', H);
    expect(importedSource(`Decision: pay the ransom\n${src}`)).toBeNull();
    expect(importedSource(`Imported: x\n${src}\nmore`)).toBeNull();
    expect(importedSource(`Imported: x\nSource: a.csv, sha256 ${'A'.repeat(64)}. Unverified claim.`)).toBeNull();
    expect(importedSource(`Imported: x\nSource: a.csv, sha256 ${'a'.repeat(63)}. Unverified claim.`)).toBeNull();
    expect(importedSource(`Imported: x ${src}`)).toBeNull();
    expect(importedSource('Imported: x')).toBeNull();
    expect(importedSource('')).toBeNull();
  });

  it('reads system notes that are exactly one Source line', () => {
    expect(importedNotesSource(sourceLine('a.csv', H))).toEqual({ fileName: 'a.csv', sha256: H });
    expect(importedNotesSource(`note\n${sourceLine('a.csv', H)}`)).toBeNull();
  });
});
