import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { decodeBytes, detectFormat, MAX_FILE_BYTES, readImportFile, sha256Hex } from '@/lib/import/read';

const enc = (s: string) => new TextEncoder().encode(s);
const file = (bytes: Uint8Array, size = bytes.length) => ({ size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer });

describe('reading an import file', () => {
  it('refuses a file over 2 MB before reading any of it', async () => {
    let read = false;
    const r = await readImportFile({
      size: MAX_FILE_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    });
    expect(r.ok).toBe(false);
    expect(read).toBe(false);
  });

  it('accepts exactly 2 MB', async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES).fill(0x61);
    const r = await readImportFile(file(bytes));
    expect(r.ok).toBe(true);
  });

  it('refuses a file whose real length is over the limit even if it reports a small size', async () => {
    const r = await readImportFile(file(new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61), 10));
    expect(r.ok).toBe(false);
  });

  it('refuses an empty file', async () => {
    expect((await readImportFile(file(new Uint8Array(0)))).ok).toBe(false);
  });

  it('refuses a file with a NUL byte', async () => {
    const bytes = new Uint8Array([0x61, 0x2c, 0x62, 0x0a, 0x00, 0x31]);
    const r = await readImportFile(file(bytes));
    expect(r.ok).toBe(false);
  });

  it('refuses invalid UTF-8', async () => {
    const r = await readImportFile(file(new Uint8Array([0x61, 0xff, 0xfe, 0x62, 0xc3, 0x28])));
    expect(r.ok).toBe(false);
  });

  it('strips a UTF-8 BOM', () => {
    const d = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('a,b')]));
    expect(d).toEqual({ ok: true, text: 'a,b' });
  });

  it('accepts UTF-16 only with its BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
    expect(decodeBytes(le)).toEqual({ ok: true, text: 'a,b' });
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x2c, 0x00, 0x62]);
    expect(decodeBytes(be)).toEqual({ ok: true, text: 'a,b' });
    // The same bytes without a BOM contain NULs and are refused as binary.
    expect(decodeBytes(new Uint8Array([0x61, 0x00, 0x2c, 0x00, 0x62, 0x00])).ok).toBe(false);
  });

  it('hashes the exact bytes (matches shasum)', async () => {
    const bytes = enc('Timestamp,DeviceName\r\n2026-11-08T02:13:00Z,FS-CLINIC-01\r\n');
    const r = await readImportFile(file(bytes));
    expect(r.ok && r.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    // A BOM changes the hash even though the text is the same.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(await sha256Hex(withBom)).not.toBe(await sha256Hex(bytes));
  });

  it('detects the format from content, not from a name', () => {
    expect(detectFormat('  [{"a":1}]')).toBe('json');
    expect(detectFormat('{"results":[{"a":1}]}')).toBe('json');
    expect(detectFormat('{\n  "results": [\n    {"a":1}\n  ]\n}')).toBe('json');
    expect(detectFormat('{"a":1}\n{"a":2}\n')).toBe('ndjson');
    expect(detectFormat('a,b\n1,2')).toBe('csv');
    expect(detectFormat('<html><script>alert(1)</script>')).toBe('csv');
  });
});
