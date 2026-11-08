// Cleaning of every string that came from an import file (plan.md rules 7 to 11 and 16).
// Nothing here uses a regex that can backtrack on file text; patterns are anchored and
// only run on strings that were length checked first.

import { segmentHttpText } from '@/lib/links';

// Same ranges as spacetimedb/src/shared/limits.ts (copied, not imported, so limits.ts stays untouched):
// controls, bidi marks and overrides, isolates, and invisible format characters.
const STRIPPED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x061c, 0x061c],
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];

function isStripped(cp: number): boolean {
  for (const [lo, hi] of STRIPPED_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

/** Cuts to at most `max` code points. */
export function capCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join('');
}

/**
 * NFKC, line breaks and tabs become spaces, control, bidi and zero-width characters
 * are removed, runs of spaces collapse, trim, cap. Input is cut first so a huge cell
 * never reaches the normalizer.
 */
export function cleanText(raw: string, max: number): string {
  const head = raw.length > max * 4 + 64 ? raw.slice(0, max * 4 + 64) : raw;
  const spaced = head.normalize('NFKC').replace(/[\t\n\r]/g, ' ');
  let out = '';
  let lastSpace = false;
  for (const ch of spaced) {
    const cp = ch.codePointAt(0) as number;
    if (isStripped(cp) || /\p{Cf}/u.test(ch)) continue;
    const space = cp === 0x20 || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x3000;
    if (space) {
      if (lastSpace) continue;
      out += ' ';
      lastSpace = true;
    } else {
      out += ch;
      lastSpace = false;
    }
  }
  return capCodePoints(out.trim(), max);
}

// ASCII only: real EDR and SIEM host names are DNS or NetBIOS names, and any other letter
// (Cherokee, Cyrillic, Greek and so on) can imitate a system that is already on the record.
// NFKC (in cleanText) still turns full-width letters into ASCII first.
const HOST_OK = /^[A-Za-z0-9 ._\-\\()]{1,120}$/;

export type HostResult = { ok: true; host: string } | { ok: false; reason: string };

export function cleanHost(raw: string): HostResult {
  if (raw.length > 400) return { ok: false, reason: 'unsafe host name' };
  const host = cleanText(raw, 120);
  if (!HOST_OK.test(host)) return { ok: false, reason: 'unsafe host name' };
  return { ok: true, host };
}

function hasLink(s: string): boolean {
  return segmentHttpText(s).some((p) => p.kind === 'link');
}

/**
 * Makes sure `segmentHttpText` finds no link: every http:// or https:// (any case) becomes
 * hxxp:// or hxxps://, repeated until nothing is left. As a last resort the scheme separator is broken.
 */
export function defang(s: string): string {
  let out = s;
  for (let i = 0; i < 8 && hasLink(out); i += 1) {
    out = out.replace(/https?:\/\//gi, (m) => (m.length === 8 ? 'hxxps://' : 'hxxp://'));
  }
  if (hasLink(out)) out = out.replace(/:\/\//g, '[://]');
  return out;
}

/** A title or other free text from the file: cleaned, defanged, capped. Empty string when nothing is left. */
export function cleanTitle(raw: string, max = 200): string {
  return capCodePoints(defang(cleanText(raw, max)), max);
}

const SEVERITY_OK = /^[\p{L}\p{N} _\-]{1,20}$/u;

/** Severity as the file words it, or null when it is not a short plain word. */
export function cleanSeverity(raw: string): string | null {
  const s = cleanText(raw, 21);
  return SEVERITY_OK.test(s) ? s : null;
}

/** A file name that cannot carry a link, a path or markup. */
export function cleanFileName(raw: string): string {
  const base = cleanText(raw, 100);
  let out = '';
  for (const ch of base) out += /[\p{L}\p{N} ._\-()]/u.test(ch) ? ch : '_';
  // The Source line allows 100 UTF-16 units, so cap by units, not code points.
  while (out.length > 100) out = Array.from(out).slice(0, -1).join('');
  return out.replace(/^\.+/, '').trim() || 'import';
}

// --- Times -------------------------------------------------------------------

export const FUTURE_SLACK_MS = 5 * 60 * 1000;
export const OLD_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
const EPOCH_S = /^\d{9,10}(?:\.\d{1,6})?$/;
const EPOCH_MS = /^\d{12,13}$/;

export type TimeResult =
  | { ok: true; iso: string; ms: number; flags: string[] }
  | { ok: false; reason: string };

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseTime(raw: string, now: number): TimeResult {
  const s = raw.trim();
  if (s.length === 0) return { ok: false, reason: 'no time' };
  if (s.length > 40) return { ok: false, reason: 'unreadable time' };
  const flags: string[] = [];
  let ms: number;
  if (EPOCH_MS.test(s)) {
    ms = Number(s);
  } else if (EPOCH_S.test(s)) {
    ms = Math.round(Number(s) * 1000);
  } else {
    const m = ISO.exec(s);
    if (!m) return { ok: false, reason: 'unreadable time' };
    const [, ys, mos, ds, hs = '00', mis = '00', ss = '00', frac = '', zone] = m;
    const year = Number(ys);
    const month = Number(mos);
    const day = Number(ds);
    const hour = Number(hs);
    const minute = Number(mis);
    const second = Number(ss);
    if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month) || hour > 23 || minute > 59 || second > 59) {
      return { ok: false, reason: 'unreadable time' };
    }
    let offsetMin = 0;
    if (zone === undefined) {
      flags.push('no time zone, read as UTC');
    } else if (zone !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const oh = Number(digits.slice(0, 2));
      const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
      if (oh > 23 || om > 59) return { ok: false, reason: 'unreadable time' };
      offsetMin = sign * (oh * 60 + om);
    }
    const millis = frac ? Number(`0.${frac}`) * 1000 : 0;
    ms = Date.UTC(year, month - 1, day, hour, minute, second) + Math.floor(millis) - offsetMin * 60_000;
  }
  if (!Number.isFinite(ms)) return { ok: false, reason: 'unreadable time' };
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 2000 || year > 2100) return { ok: false, reason: 'unreadable time' };
  if (ms > now + FUTURE_SLACK_MS) return { ok: false, reason: 'dated in the future' };
  if (ms < now - OLD_AFTER_MS) flags.push('older than 30 days');
  return { ok: true, iso: date.toISOString(), ms, flags };
}
