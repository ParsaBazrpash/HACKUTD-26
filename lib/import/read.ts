// Reading an import file in the browser (plan.md rules 1 to 3). The file is never uploaded:
// only its bytes are hashed and decoded here.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ImportFormat = 'csv' | 'json' | 'ndjson';

export type ReadResult =
  | { ok: true; text: string; sha256: string; size: number; format: ImportFormat }
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
  const sha256 = await sha256Hex(bytes);
  return { ok: true, text: decoded.text, sha256, size: bytes.length, format: detectFormat(decoded.text) };
}
