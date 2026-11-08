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

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

/** True when a spreadsheet would read text that starts this way as a formula. */
export function startsLikeFormula(s: string): boolean {
  return s.length > 0 && FORMULA_START.has(s[0]);
}

/** For any future spreadsheet export: a leading apostrophe keeps a cell from being read as a formula. */
export function neutralizeFormula(s: string): string {
  return startsLikeFormula(s) ? `'${s}` : s;
}

export function cleanHost(raw: string): HostResult {
  if (raw.length > 400) return { ok: false, reason: 'unsafe host name' };
  const host = cleanText(raw, 120);
  // A host that a spreadsheet would read as a formula is refused (real host names never start this way).
  if (!HOST_OK.test(host) || startsLikeFormula(host)) return { ok: false, reason: 'unsafe host name' };
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
// Kibana Discover: "Nov 8, 2026 @ 08:13:05.123", and the older "November 8th 2026, 08:13:05.123".
const KIBANA = /^([A-Za-z]{3,9}) (\d{1,2}), (\d{4}) @ (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const KIBANA_OLD = /^([A-Za-z]{3,9}) (\d{1,2})(?:st|nd|rd|th) (\d{4}), (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
// US style: "11/8/2026 8:13", "11/8/2026, 8:13:05 PM".
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?: ?([AaPp][Mm]))?$/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthNumber(word: string): number {
  const w = word.toLowerCase();
  const idx = MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
  return idx < 0 ? 0 : idx + 1;
}
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
  } else if (KIBANA.test(s) || KIBANA_OLD.test(s) || US.test(s)) {
    let parts: { y: number; mo: number; d: number; h: number; mi: number; sec: number; ms: number };
    const k = KIBANA.exec(s);
    const ko = k ? null : KIBANA_OLD.exec(s);
    const u = k || ko ? null : US.exec(s);
    if (k) {
      parts = { y: Number(k[3]), mo: monthNumber(k[1]), d: Number(k[2]), h: Number(k[4]), mi: Number(k[5]), sec: Number(k[6] ?? 0), ms: Number((k[7] ?? '0').padEnd(3, '0')) };
    } else if (ko) {
      parts = { y: Number(ko[3]), mo: monthNumber(ko[1]), d: Number(ko[2]), h: Number(ko[4]), mi: Number(ko[5]), sec: Number(ko[6]), ms: Number((ko[7] ?? '0').padEnd(3, '0')) };
    } else if (u) {
      let hour = Number(u[4]);
      const ampm = u[8]?.toLowerCase();
      if (ampm) {
        if (hour < 1 || hour > 12) return { ok: false, reason: 'unreadable time' };
        hour = (hour % 12) + (ampm === 'pm' ? 12 : 0);
      }
      parts = { y: Number(u[3]), mo: Number(u[1]), d: Number(u[2]), h: hour, mi: Number(u[5]), sec: Number(u[6] ?? 0), ms: Number((u[7] ?? '0').padEnd(3, '0')) };
      flags.push('read as month/day/year');
    } else {
      return { ok: false, reason: 'unreadable time' };
    }
    if (parts.mo < 1 || parts.mo > 12 || parts.d < 1 || parts.d > daysIn(parts.y, parts.mo) || parts.h > 23 || parts.mi > 59 || parts.sec > 59) {
      return { ok: false, reason: 'unreadable time' };
    }
    flags.push('no time zone, read as UTC');
    ms = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.sec, parts.ms);
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
