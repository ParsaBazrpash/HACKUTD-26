// Reading an import file in the browser (plan.md rules 1 to 3). The file is never uploaded:
// only its bytes are hashed and decoded here.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ImportFormat = 'csv' | 'json' | 'ndjson';

export type ReadResult =
  | { ok: true; text: string; sha256: string; size: number; format: ImportFormat; warnings: string[] }
  | { ok: false; error: string };

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

const CONTROL_LIMIT = 0.01; // more than 1% control characters is binary junk, not text

export interface TextScan {
  /** Why the text is refused, or null. */
  refuse: string | null;
  /** Things that were found and will be removed or flagged. */
  warnings: string[];
}

/**
 * Looks for hidden and binary content in decoded text. Bidi overrides and isolates (Trojan Source tricks)
 * and mostly-control-character content are refused. Zero-width and stray control characters are reported
 * and then removed by the cleaning step.
 */
export function scanText(text: string): TextScan {
  let controls = 0;
  let overrides = 0;
  let hidden = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)) controls += 1;
    else if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) overrides += 1;
    else if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff || c === 0x061c) hidden += 1;
  }
  if (overrides > 0) {
    return { refuse: 'The file contains right-to-left override or isolate characters, which can make text read differently from what it is. It was not imported.', warnings: [] };
  }
  if (text.length > 0 && controls / text.length > CONTROL_LIMIT) {
    return { refuse: 'The file is mostly control characters, so it is not a text export. It was not imported.', warnings: [] };
  }
  const warnings: string[] = [];
  if (hidden > 0) warnings.push(`${hidden} hidden zero-width ${hidden === 1 ? 'character was' : 'characters were'} removed.`);
  if (controls > 0) warnings.push(`${controls} control ${controls === 1 ? 'character was' : 'characters were'} removed.`);
  return { refuse: null, warnings };
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
  const sniffed = sniffBinaryType(bytes);
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
    return { ok: false, error: 'The file is larger than 2 MB. Export a shorter time range.' };
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
    return { ok: false, error: 'The file is larger than 2 MB. Export a shorter time range.' };
  }
  const decoded = decodeBytes(bytes);
  if (!decoded.ok) return decoded;
  const scan = scanText(decoded.text);
  if (scan.refuse) return { ok: false, error: scan.refuse };
  const sha256 = await sha256Hex(bytes);
  return { ok: true, text: decoded.text, sha256, size: bytes.length, format: detectFormat(decoded.text), warnings: scan.warnings };
}
