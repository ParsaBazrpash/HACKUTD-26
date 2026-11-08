import { describe, expect, it } from 'vitest';
import { failedChecklist, fileChecklist } from './checklist';
import { parseCsv } from './csv';
import { parseJson } from './json';
import { MAX_FILE_BYTES, readImportFile, scanText } from './read';

const enc = (s: string) => new TextEncoder().encode(s);
const file = (bytes: Uint8Array) => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer });

describe('file checklist', () => {
  it('passes everything for a clean file', () => {
    expect(fileChecklist({ hiddenFound: scanText('a,b\n1,2').found }).every((l) => l.state === 'pass')).toBe(true);
  });

  it('warns when hidden characters were found', () => {
    const lines = fileChecklist({ hiddenFound: scanText('a\u202Eb').found });
    expect(lines.filter((l) => l.state === 'warn')).toHaveLength(1);
    expect(lines.some((l) => l.state === 'fail')).toBe(false);
  });

  it('"none found" is only shown when cleaning would remove nothing: marks, fillers and variation selectors count too', () => {
    for (const s of ['a\u200Fb', 'a\u200Eb', 'a\u00ADb', 'a\uFE0Fb', 'a\u3164b', 'a\u2064b', 'a\u{E0041}b', 'a\u2800b']) {
      expect(scanText(s).found, JSON.stringify(s)).toBe(true);
    }
    for (const s of ['plain text', 'tabs\tand\r\nbreaks', 'café שלום مرحبا 你好']) {
      expect(scanText(s).found, JSON.stringify(s)).toBe(false);
    }
  });

  it('makes no thoroughness claim in any label', () => {
    const labels = [...fileChecklist({ hiddenFound: false }), ...fileChecklist({ hiddenFound: true }), ...failedChecklist('type'), ...failedChecklist('limits')].map((l) => l.label);
    for (const l of labels) expect(l).not.toMatch(/safe|virus|malware free|clean file/i);
  });
});

describe('a refused file shows the line that refused it with a red cross', () => {
  it('only the failing line is shown, nothing is claimed about the rest', () => {
    expect(failedChecklist('type')).toEqual([{ label: fileChecklist({ hiddenFound: false })[0].label, state: 'fail' }]);
    expect(failedChecklist('limits')).toEqual([{ label: fileChecklist({ hiddenFound: false })[3].label, state: 'fail' }]);
  });

  it('a program, a PDF, junk or invalid text fails the type line', async () => {
    for (const bytes of [
      new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
      enc('%PDF-1.7\n'),
      new Uint8Array(300).fill(0x01),
      new Uint8Array([0x61, 0xff, 0xfe, 0x62]),
    ]) {
      const r = await readImportFile(file(bytes));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.check).toBe('type');
    }
  });

  it('a file over 2 MB, too many rows, too many columns or a huge cell fails the limits line', async () => {
    const big = await readImportFile(file(new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61)));
    expect(!big.ok && big.check).toBe('limits');
    for (const t of [
      parseCsv(`a\n${'x\n'.repeat(5001)}`),
      parseCsv(`${Array.from({ length: 201 }, (_, i) => `c${i}`).join(',')}\n1`),
      parseCsv(`a\n${'x'.repeat(8193)}`),
      parseJson(JSON.stringify([{ a: 'x'.repeat(8193) }])),
    ]) {
      expect(!t.ok && t.limit).toBe(true);
    }
  });

  it('an empty file or broken JSON shows no checklist line, only the message', async () => {
    const empty = await readImportFile(file(new Uint8Array(0)));
    expect(!empty.ok && empty.check).toBeUndefined();
    const bad = parseJson('{not json');
    expect(!bad.ok && bad.limit).toBeUndefined();
  });
});
