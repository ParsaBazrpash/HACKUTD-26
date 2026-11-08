// JSON and NDJSON rows. Parsed objects are only ever read: keys go into a Map, nothing is
// spread, assigned or merged, and the prototype keys are ignored.

import { MAX_CELL, MAX_COLUMNS, MAX_ROWS, type Row, type TableResult } from '@/lib/import/csv';

const WRAPPER_KEYS = ['results', 'records', 'Records', 'alerts', 'data', 'value', 'events', 'hits', 'resources', 'Findings'] as const;
const IGNORED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_DEPTH = 6;

type Plain = Record<string, unknown>;

function isObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function own(o: Plain, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

class CapError extends Error {}

function flatten(value: unknown, path: string, depth: number, out: Row): void {
  if (typeof value === 'string') {
    if (value.length > MAX_CELL) throw new CapError('A value is longer than 8 KB. This does not look like an alert export.');
    out.set(path, value);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    out.set(path, String(value));
  } else if (depth >= MAX_DEPTH) {
    // Deeper levels are ignored on purpose.
  } else if (Array.isArray(value)) {
    const n = Math.min(value.length, 20);
    for (let i = 0; i < n; i += 1) flatten(value[i], path ? `${path}.${i}` : String(i), depth + 1, out);
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (IGNORED_KEYS.has(key)) continue;
      flatten(value[key], path ? `${path}.${key}` : key, depth + 1, out);
    }
  }
  if (out.size > MAX_COLUMNS) throw new CapError('Too many columns (limit 200).');
}

function toRow(obj: unknown): Row | null {
  if (!isObject(obj)) return null;
  const row: Row = new Map();
  for (const key of Object.keys(obj)) {
    if (IGNORED_KEYS.has(key)) continue;
    flatten(obj[key], key, 1, row);
  }
  return row;
}

function unwrap(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!isObject(parsed)) return null;
  for (const key of WRAPPER_KEYS) {
    const v = own(parsed, key);
    if (Array.isArray(v)) return v;
    // Elastic search responses: { hits: { hits: [ ... ] } }
    if (isObject(v)) {
      const inner = own(v, 'hits');
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

function finish(items: unknown[]): TableResult {
  if (items.length > MAX_ROWS) return { ok: false, error: 'Too many rows (limit 5,000). Export a shorter time range.' };
  const rows: Row[] = [];
  const columns: string[] = [];
  const seen = new Set<string>();
  try {
    for (const item of items) {
      const row = toRow(item);
      if (!row || row.size === 0) continue;
      rows.push(row);
      for (const key of row.keys()) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
          if (columns.length > MAX_COLUMNS) return { ok: false, error: 'Too many columns (limit 200).' };
        }
      }
    }
  } catch (e) {
    if (e instanceof CapError) return { ok: false, error: e.message };
    return { ok: false, error: 'The file could not be read.' };
  }
  if (rows.length === 0) return { ok: false, error: 'No records were found in the file.' };
  return { ok: true, columns, rows };
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Includes RangeError from a very deeply nested file.
    return { ok: false };
  }
}

export function parseJson(text: string): TableResult {
  const parsed = tryParse(text);
  if (!parsed.ok) return { ok: false, error: 'The file is not valid JSON, or it is nested too deeply.' };
  const items = unwrap(parsed.value);
  if (!items) {
    return {
      ok: false,
      error: 'No list of records found. Use a JSON array, or an object with a list under results, records, alerts, data, value, events, hits, resources or Findings.',
    };
  }
  return finish(items);
}

export function parseNdjson(text: string): TableResult {
  const items: unknown[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    if (items.length >= MAX_ROWS + 1) return { ok: false, error: 'Too many rows (limit 5,000). Export a shorter time range.' };
    const parsed = tryParse(line);
    if (!parsed.ok) return { ok: false, error: `Line ${i + 1} is not valid JSON, or it is nested too deeply.` };
    const v = parsed.value;
    const wrapped = isObject(v) ? own(v, 'result') : undefined;
    items.push(isObject(wrapped) ? wrapped : v);
  }
  return finish(items);
}
