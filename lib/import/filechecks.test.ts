import { describe, expect, it } from 'vitest';
import { cleanHost, neutralizeFormula, startsLikeFormula } from '@/lib/import/clean';
import { parseCsv, MAX_CELL, MAX_COLUMNS, MAX_ROWS } from '@/lib/import/csv';
import { parseJson, parseNdjson } from '@/lib/import/json';
import { suggestMapping } from '@/lib/import/fields';
import { buildPlan } from '@/lib/import/plan';
import { MAX_FILE_BYTES, readImportFile, scanParsed, scanText, sniffBinaryType } from '@/lib/import/read';

const enc = (s: string) => new TextEncoder().encode(s);
const file = (bytes: Uint8Array) => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer });
const pad = (head: number[], total = 200) => new Uint8Array([...head, ...new Array(total - head.length).fill(0x41)]);

describe('1. the first bytes decide the file type, not the name', () => {
  const cases: Array<[string, number[]]> = [
    ['Windows program', [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]],
    ['Linux program', [0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]],
    ['macOS program', [0xcf, 0xfa, 0xed, 0xfe]],
    ['zip or xlsx', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]],
    ['old Office (OLE)', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]],
    ['gzip', [0x1f, 0x8b, 0x08, 0x00]],
    ['7-Zip', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0]],
    ['pcap', [0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00]],
    ['EVTX', [0x45, 0x6c, 0x66, 0x46, 0x69, 0x6c, 0x65, 0x00]],
  ];
  for (const [name, head] of cases) {
    it(`refuses a ${name} even when it is called alerts.csv`, async () => {
      // Padded with plain letters so only the signature gives it away.
      const r = await readImportFile(file(pad(head)));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not a text export|never opened|not valid text|binary/);
    });
  }

  it('says what the file is', () => {
    expect(sniffBinaryType(pad([0x25, 0x50, 0x44, 0x46]))).toBe('a PDF');
    expect(sniffBinaryType(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('an image');
  });

  it('does not refuse real text that starts with letters like MZ, ID3 or BZh', async () => {
    for (const text of ['MZ,host\n1,2\n', 'ID3,host\n1,2\n', 'BZh,x\n1,2\n', 'GIF8,x\n1,2\n']) {
      const r = await readImportFile(file(enc(text)));
      expect(r.ok, text).toBe(true);
    }
    // ...but the same letters followed by binary bytes are refused.
    expect((await readImportFile(file(new Uint8Array([0x4d, 0x5a, 0x00, 0x01, 0x02])))).ok).toBe(false);
  });

  it('a UTF-8 byte order mark in front does not hide the signature', async () => {
    // An all-text PDF would otherwise decode as valid UTF-8 and be read as CSV.
    const pdf = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')]);
    const r = await readImportFile(file(pdf));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/a PDF/);
    // A real CSV with a BOM still imports.
    expect((await readImportFile(file(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Timestamp,DeviceName\n1,2\n')])))).ok).toBe(true);
  });
});

describe('2. hidden and binary characters', () => {
  // Every hidden character in this file is written as an escape, so a reader of the test sees exactly what it checks.
  const OVERRIDES = ['\u202E', '\u202A', '\u2066', '\u2069'];

  it('removes right-to-left overrides and isolates anywhere in the file and says so', async () => {
    for (const ch of OVERRIDES) {
      const r = await readImportFile(file(enc(`Timestamp,DeviceName,AlertTitle\n2026-11-08T08:13:05Z,PC-1,invoice ${ch}gpj.exe\n`)));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings[0]).toMatch(/^1 right-to-left override or isolate character was removed, so text shows in its real order/);
    }
  });

  it('an EDR export of a right-to-left override attack still imports, with the real file name order', async () => {
    const csv = 'Timestamp,DeviceName,AlertTitle,FileName\n2026-11-08T08:13:05Z,NURSE-WS-12,Masquerading: invoice\u202Efdp.exe,invoice\u202Efdp.exe\n';
    const r = await readImportFile(file(enc(csv)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toHaveLength(1);
    const t = parseCsv(r.text);
    if (!t.ok) throw new Error(t.error);
    const plan = buildPlan({ rows: t.rows, mapping: suggestMapping(t.columns), fileName: 'alerts.csv', sha256: 'a'.repeat(64), custodian: 'Sam', existingSystems: [], now: Date.parse('2026-11-08T14:30:00Z') });
    expect(plan.lines[0].body.text).toContain('Masquerading: invoicefdp.exe on NURSE-WS-12');
    for (const ch of OVERRIDES) expect(plan.lines[0].body.text).not.toContain(ch);
  });

  it('reports zero-width characters, tag characters and stray controls, which are removed later', async () => {
    const csv = 'Timestamp,DeviceName,AlertTitle\n2026-11-08T08:13:05Z,PC-1,ab\u200Bc\u200D\u0007d\u{E0041}\n' + '2026-11-08T08:13:06Z,PC-2,fine title here and some more text to dilute\n'.repeat(60);
    const r = await readImportFile(file(enc(csv)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual(['3 hidden characters were removed.', '1 control character was removed.']);
    }
  });

  it('never refuses ordinary right-to-left marks, and reports them because cleaning removes them', () => {
    expect(scanText('a\tb\r\nc\u200Ed\u200F').refuse).toBeNull();
    expect(scanText('a\tb\r\nc\u200Ed\u200F').warnings).toEqual(['2 hidden characters were removed.']);
    expect(scanText('a\tb\r\nc').warnings).toEqual([]);
  });

  it('refuses a file that is mostly control characters', async () => {
    const junk = new Uint8Array(2000);
    for (let i = 0; i < junk.length; i += 1) junk[i] = i % 3 === 0 ? 0x41 : 0x01 + (i % 6);
    const r = await readImportFile(file(junk));
    expect(r.ok).toBe(false);
    expect(scanText('\u0001\u0002\u0003 plain').refuse).not.toBeNull();
  });

  it('keeps a real export with a few stray controls: a Ctrl-Z at the end, colour codes in a log message', async () => {
    const tiny = 'Timestamp,DeviceName,AlertTitle\n2026-11-08T08:13:05Z,PC-1,Ransomware\n\u001a';
    const colours =
      'date,host,service,status,message\n' +
      Array.from({ length: 10 }, (_, i) => `2026-11-08T08:1${i}:05.000Z,web-01,ehr-api,error,"\u001b[31mERROR\u001b[0m db timeout after 3000ms"`).join('\n');
    for (const text of [tiny, colours]) {
      const r = await readImportFile(file(enc(text)));
      expect(r.ok, text).toBe(true);
      if (r.ok) expect(r.warnings.at(-1)).toMatch(/control characters? (was|were) removed/);
    }
  });

  it('checks JSON escapes after parsing: \\u202e, \\u200b and \\u0007 are reported like raw characters', async () => {
    const json = '[{"Timestamp":"2026-11-08T08:13:05Z","DeviceName":"PC-1","Title":"invoice \\u202Egpj.exe \\u200B\\u0007 and more text to dilute the control"}]';
    const r = await readImportFile(file(enc(json)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The raw text holds only ASCII, so the text check alone finds nothing...
    expect(r.warnings).toEqual([]);
    const t = parseJson(r.text);
    if (!t.ok) throw new Error(t.error);
    // ...and the check on what was parsed finds all three.
    const scan = scanParsed(r.format, r.warnings, t.columns, t.rows);
    expect(scan.refuse).toBeNull();
    expect(scan.warnings).toHaveLength(3);
    expect(scan.warnings[0]).toMatch(/^1 right-to-left override/);
    // NDJSON too, and a file of escaped control characters is refused like a raw one.
    const nd = parseNdjson('{"a":"\\u0001\\u0002\\u0003\\u0004"}\n{"a":"x"}\n');
    if (!nd.ok) throw new Error(nd.error);
    expect(scanParsed('ndjson', [], nd.columns, nd.rows).refuse).not.toBeNull();
    // CSV cells are slices of the text, so the text check stands for them.
    expect(scanParsed('csv', ['w'], ['a'], [new Map([['a', '\u202E']])])).toEqual({ refuse: null, warnings: ['w'], found: true });
  });

  it('still refuses NUL bytes and invalid UTF-8', async () => {
    expect((await readImportFile(file(new Uint8Array([0x61, 0x2c, 0x62, 0x0a, 0x00, 0x31])))).ok).toBe(false);
    expect((await readImportFile(file(new Uint8Array([0x61, 0xff, 0xfe, 0x62, 0xc3, 0x28])))).ok).toBe(false);
  });
});

describe('3. nothing imported can be read as a spreadsheet formula', () => {
  it('recognizes the formula starters and neutralizes them for any future export', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(startsLikeFormula(s)).toBe(true);
      expect(neutralizeFormula(s)).toBe(`'${s}`);
    }
    for (const s of ['', 'PC-1', 'Imported: x', '1+1', "'=1"]) expect(neutralizeFormula(s)).toBe(s);
  });

  it('a host that starts like a formula is refused', () => {
    for (const h of ['=cmd', '+1', '-1', '@x', '-HOST', '--help', '=1+1']) {
      expect(cleanHost(h)).toEqual({ ok: false, reason: 'unsafe host name' });
    }
    expect(cleanHost('PC-1-')).toEqual({ ok: true, host: 'PC-1-' });
  });

  it('no string in a plan starts with a formula character, whatever the file holds', () => {
    const csv = [
      'Timestamp,DeviceName,AlertTitle,Severity',
      '2026-11-08T08:13:05Z,=cmd|\' /C calc\'!A0,=HYPERLINK("http://evil"),+1',
      '2026-11-08T08:13:05Z,PC-1,=1+1,-2',
      '2026-11-08T08:13:05Z,PC-2,@SUM(A1),=3',
      '2026-11-08T08:13:05Z,-PC-3,+cmd,high',
      '2026-11-08T08:13:05Z,PC-4,"\tTAB",high',
      '2026-11-08T08:13:05Z,PC-5,\tleading tab,high',
    ].join('\n');
    const t = parseCsv(csv);
    if (!t.ok) throw new Error(t.error);
    const plan = buildPlan({ rows: t.rows, mapping: suggestMapping(t.columns), fileName: '=evil.csv', sha256: 'a'.repeat(64), custodian: 'Sam', existingSystems: [], now: Date.parse('2026-11-08T14:30:00Z') });
    const strings = [
      plan.evidence.label,
      plan.evidence.location,
      ...plan.systems.flatMap((s) => [s.body.system, s.body.notes, s.preview]),
      ...plan.lines.flatMap((l) => [l.body.text, l.preview]),
    ];
    expect(strings.length).toBeGreaterThan(5);
    for (const s of strings) expect(startsLikeFormula(s), s).toBe(false);
    expect(plan.systems.map((x) => x.host).sort()).toEqual(['PC-1', 'PC-2', 'PC-4', 'PC-5']);
  });
});

describe('4. hard caps', () => {
  it('2 MB, 5,000 rows, 200 columns and 8 KB per cell all stop with a message', async () => {
    expect((await readImportFile(file(new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61)))).ok).toBe(false);
    expect(parseCsv(`a\n${'x\n'.repeat(MAX_ROWS + 1)}`).ok).toBe(false);
    expect(parseCsv(`${Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(',')}\n1`).ok).toBe(false);
    expect(parseCsv(`a\n${'x'.repeat(MAX_CELL + 1)}`).ok).toBe(false);
  });

  it('a worst-case 2 MB file of quotes and commas is rejected or parsed in well under a second', async () => {
    const start = Date.now();
    const body = '"",'.repeat(Math.floor(MAX_FILE_BYTES / 3) - 10);
    const r = await readImportFile(file(enc(`a\n${body}`)));
    if (r.ok) parseCsv(r.text);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
