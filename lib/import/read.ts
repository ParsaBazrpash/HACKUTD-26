// Reading an import file in the browser (plan.md rules 1 to 3). The file is never uploaded:
// only its bytes are hashed and decoded here.

import { isStrippedChar } from '@/lib/import/clean';
import type { Row } from '@/lib/import/csv';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ImportFormat = 'csv' | 'json' | 'ndjson';

export type ReadResult =
  | { ok: true; text: string; sha256: string; size: number; format: ImportFormat; warnings: string[] }
  /** `check` names the checklist line that refused the file, when one did. */
  | { ok: false; error: string; check?: 'type' | 'limits' };

export interface FileLike {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type DecodeResult = { ok: true; text: string } | { ok: false; error: string };

// --- What the first bytes say the file really is, whatever its name or MIME type says ---------

// "weak" signatures are plain ASCII that could start a real text file (a column named MZ or ID3), so they only
// count when the first bytes also look binary.
const SIGNATURES: ReadonlyArray<{ bytes: readonly number[]; kind: string; weak?: boolean }> = [
  { bytes: [0x4d, 0x5a], weak: true, kind: 'a Windows program' }, // MZ
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: 'a Linux program' }, // ELF
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], kind: 'a macOS program' }, // Mach-O
  { bytes: [0xca, 0xfe, 0xba, 0xbe], kind: 'a program or Java class' },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], kind: 'an old Office file (OLE)' },
  { bytes: [0x25, 0x50, 0x44, 0x46], kind: 'a PDF' }, // %PDF
  { bytes: [0x1f, 0x8b], kind: 'a gzip archive' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], kind: 'a 7-Zip archive' },
  { bytes: [0x52, 0x61, 0x72, 0x21], weak: true, kind: 'a RAR archive' },
  { bytes: [0x42, 0x5a, 0x68], weak: true, kind: 'a bzip2 archive' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], kind: 'an image' }, // PNG
  { bytes: [0xff, 0xd8, 0xff], kind: 'an image' }, // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38], weak: true, kind: 'an image' }, // GIF8
  { bytes: [0x4f, 0x67, 0x67, 0x53], weak: true, kind: 'an audio file' }, // OggS
  { bytes: [0x49, 0x44, 0x33], weak: true, kind: 'an audio file' }, // ID3
  { bytes: [0xd4, 0xc3, 0xb2, 0xa1], kind: 'a packet capture' }, // pcap
  { bytes: [0xa1, 0xb2, 0xc3, 0xd4], kind: 'a packet capture' },
  { bytes: [0x0a, 0x0d, 0x0d, 0x0a], kind: 'a packet capture' }, // pcapng
  { bytes: [0x45, 0x6c, 0x66, 0x46, 0x69, 0x6c, 0x65, 0x00], kind: 'a Windows event log (EVTX)' },
];

function looksBinary(head: Uint8Array): boolean {
  for (const b of head) if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) return true;
  return false;
}

/** The kind of file the first bytes show, or null when they look like text. Zip (including xlsx) is handled by the caller. */
export function sniffBinaryType(bytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) {
      if (!sig.weak || looksBinary(bytes.subarray(0, 512))) return sig.kind;
    }
  }
  return null;
}

// More than 1 in 10 characters being controls is binary junk, not text. A few stray ones (a Ctrl-Z at the end,
// colour codes in a log message) are only reported: cleaning removes them from anything imported.
const CONTROL_LIMIT = 0.1;

export interface TextScan {
  /** Why the text is refused, or null. */
  refuse: string | null;
  /** Things that were found and will be removed or flagged. */
  warnings: string[];
  /** True when hidden, direction-changing or control characters were found (and will be removed). */
  found: boolean;
}

interface Counts {
  chars: number;
  controls: number;
  overrides: number;
  hidden: number;
}

// Counts exactly what cleaning removes (isStrippedChar), so "none found" in the preview is true for every
// character cleaning would take out: controls, bidi marks, overrides and isolates, zero-width and tag characters,
// variation selectors and blank fillers.
function count(text: string, c: Counts): void {
  c.chars += text.length;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if ((cp >= 0x20 && cp < 0x7f) || cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) c.controls += 1;
    else if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) c.overrides += 1;
    else if (isStrippedChar(ch)) c.hidden += 1;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function verdict(c: Counts): TextScan {
  if (c.chars > 0 && c.controls / c.chars > CONTROL_LIMIT) {
    return { refuse: 'The file is mostly control characters, so it is not a text export. It was not imported.', warnings: [], found: true };
  }
  const warnings: string[] = [];
  if (c.overrides > 0) {
    warnings.push(
      `${plural(c.overrides, 'right-to-left override or isolate character was', 'right-to-left override or isolate characters were')} removed, so text shows in its real order. A file name that hides its real extension this way is a known malware trick.`,
    );
  }
  if (c.hidden > 0) warnings.push(`${plural(c.hidden, 'hidden character was', 'hidden characters were')} removed.`);
  if (c.controls > 0) warnings.push(`${plural(c.controls, 'control character was', 'control characters were')} removed.`);
  return { refuse: null, warnings, found: warnings.length > 0 };
}

/**
 * Looks for hidden and binary content in decoded text. Text that is mostly control characters is refused.
 * Bidi overrides and isolates (Trojan Source tricks), zero-width, tag and stray control characters are reported;
 * cleaning removes them from every string that is imported, so a hidden file extension shows in its real order.
 * They are not refused: an EDR export of a right-to-left override attack must still import with its exact bytes.
 */
export function scanText(text: string): TextScan {
  const c: Counts = { chars: 0, controls: 0, overrides: 0, hidden: 0 };
  count(text, c);
  return verdict(c);
}

/**
 * The same check on what the parser produced. For CSV every cell is a slice of the file text, so the check on the
 * text already covered it. In JSON and NDJSON an escape such as \u202e, \u200b or \u0007 only becomes a character
 * once parsed, so the column names and values are checked here instead.
 */
export function scanParsed(format: ImportFormat, textWarnings: readonly string[], columns: readonly string[], rows: readonly Row[]): TextScan {
  if (format === 'csv') return { refuse: null, warnings: [...textWarnings], found: textWarnings.length > 0 };
  const c: Counts = { chars: 0, controls: 0, overrides: 0, hidden: 0 };
  for (const col of columns) count(col, c);
  for (const row of rows) for (const value of row.values()) count(value, c);
  return verdict(c);
}

/** Fatal UTF-8; UTF-16 only when its byte order mark is present; BOM removed; binary refused. */
export function decodeBytes(bytes: Uint8Array): DecodeResult {
  let label: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  let start = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    label = 'utf-16le';
    start = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    label = 'utf-16be';
    start = 2;
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  // Checked after a UTF-8 byte order mark too, so a BOM in front does not hide the signature.
  const sniffed = label === 'utf-8' ? sniffBinaryType(bytes.subarray(start)) : null;
  if (sniffed !== null) {
    return {
      ok: false,
      error: `This file is ${sniffed}, not a text export. Only CSV, JSON and NDJSON text can be imported. It was not opened.`,
    };
  }
  // Excel workbooks and other zip files start with "PK". They are never opened here.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] <= 0x08 && bytes[3] <= 0x08) {
    return { ok: false, error: 'This looks like an Excel workbook or a zip file, which is never opened here. In Excel, use Save As and pick CSV UTF-8, then import that file.' };
  }
  if (label === 'utf-8') {
    for (let i = start; i < bytes.length; i += 1) {
      if (bytes[i] === 0) return { ok: false, error: 'This looks like a binary file (it contains NUL bytes). Export it as CSV or JSON.' };
    }
  }
  let text: string;
  try {
    text = new TextDecoder(label, { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return { ok: false, error: 'The file is not valid text. Save it as UTF-8 and try again. From Excel, use Save As and pick CSV UTF-8.' };
  }
  if (text.includes('\u0000')) {
    return { ok: false, error: 'This looks like a binary file (it contains NUL bytes). Export it as CSV or JSON.' };
  }
  return { ok: true, text };
}

/** Looks at the content only, never at the file name or the browser's MIME type. */
export function detectFormat(text: string): ImportFormat {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const first = text[i];
  if (first === '[') return 'json';
  if (first === '{') {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length > 1 && lines.every((l) => l.trimStart().startsWith('{'))) return 'ndjson';
    return 'json';
  }
  return 'csv';
}

export async function readImportFile(file: FileLike): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'The file is larger than 2 MB. Export a shorter time range.', check: 'limits' };
  }
  if (file.size === 0) return { ok: false, error: 'The file is empty.' };
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { ok: false, error: 'The file could not be read.' };
  }
  const bytes = new Uint8Array(buf);
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'The file is larger than 2 MB. Export a shorter time range.', check: 'limits' };
  }
  const decoded = decodeBytes(bytes);
  if (!decoded.ok) return { ok: false, error: decoded.error, check: 'type' };
  const scan = scanText(decoded.text);
  if (scan.refuse) return { ok: false, error: scan.refuse, check: 'type' };
  const sha256 = await sha256Hex(bytes);
  return { ok: true, text: decoded.text, sha256, size: bytes.length, format: detectFormat(decoded.text), warnings: scan.warnings };
}
