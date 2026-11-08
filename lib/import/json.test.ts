import { describe, expect, it } from 'vitest';
import { MAX_CELL, MAX_COLUMNS, MAX_ROWS } from '@/lib/import/csv';
import { parseJson, parseNdjson } from '@/lib/import/json';

function ok(r: ReturnType<typeof parseJson>) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('json reader', () => {
  it('reads an array of objects and flattens nested keys to dotted names', () => {
    const r = ok(parseJson('[{"host":{"name":"A","ip":["1.1.1.1","2.2.2.2"]},"n":5,"ok":true,"gone":null}]'));
    const row = r.rows[0];
    expect(row.get('host.name')).toBe('A');
    expect(row.get('host.ip.1')).toBe('2.2.2.2');
    expect(row.get('n')).toBe('5');
    expect(row.get('ok')).toBe('true');
    expect(row.has('gone')).toBe(false);
  });

  it.each(['results', 'records', 'Records', 'alerts', 'data', 'value', 'events', 'hits'])('unwraps a list under %s', (key) => {
    expect(ok(parseJson(`{"${key}":[{"a":"1"}],"other":[{"a":"2"}]}`)).rows).toHaveLength(1);
  });

  it('unwraps an Elastic style hits.hits list', () => {
    expect(ok(parseJson('{"hits":{"total":1,"hits":[{"_source":{"host":{"name":"A"}}}]}}')).rows[0].get('_source.host.name')).toBe('A');
  });

  it('explains when there is no list', () => {
    const r = parseJson('{"a":1}');
    expect(!r.ok && r.error).toMatch(/No list/);
    expect(parseJson('"text"').ok).toBe(false);
    expect(parseJson('not json').ok).toBe(false);
  });

  it('ignores __proto__, constructor and prototype keys and never pollutes Object.prototype', () => {
    const text =
      '[{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"a":{"__proto__":{"polluted":"yes"},"b":"1"},"prototype":"x","host":"H"}]';
    const r = ok(parseJson(text));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    const keys = [...r.rows[0].keys()];
    expect(keys.sort()).toEqual(['a.b', 'host']);
    expect(ok(parseNdjson(`{"constructor.prototype.polluted":"yes","__proto__":{"polluted":1},"x":"1"}`)).rows[0].has('constructor.prototype.polluted')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('gives a clean result for a file nested 100,000 levels deep', () => {
    const deepArray = '['.repeat(100_000) + ']'.repeat(100_000);
    const r1 = parseJson(deepArray);
    expect(r1.ok).toBe(false);
    const deepObject = '{"a":'.repeat(100_000) + '1' + '}'.repeat(100_000);
    const r2 = parseJson(`[${deepObject}]`);
    // Either it is refused cleanly or it is read with the deep part ignored. Never a crash.
    if (r2.ok) {
      for (const key of r2.rows[0].keys()) expect(key.split('.').length).toBeLessThanOrEqual(7);
    } else {
      expect(typeof r2.error).toBe('string');
    }
    expect(parseNdjson(deepObject).ok === true || parseNdjson(deepObject).ok === false).toBe(true);
  });

  it('flattens at most six levels', () => {
    const r = ok(parseJson('[{"a":{"b":{"c":{"d":{"e":{"f":{"g":"deep"},"x":"1"}}}}}}]'));
    const keys = [...r.rows[0].keys()];
    expect(keys.every((k) => k.split('.').length <= 6)).toBe(true);
    expect(keys).not.toContain('a.b.c.d.e.f.g');
  });

  it('stops at 5,000 rows', () => {
    const rows = (n: number) => JSON.stringify(Array.from({ length: n }, () => ({ a: 1 })));
    expect(parseJson(rows(MAX_ROWS)).ok).toBe(true);
    const over = parseJson(rows(MAX_ROWS + 1));
    expect(!over.ok && over.error).toMatch(/5,000/);
  });

  it('stops at 200 columns', () => {
    const obj = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, 'x']));
    expect(parseJson(JSON.stringify([obj(MAX_COLUMNS)])).ok).toBe(true);
    const over = parseJson(JSON.stringify([obj(MAX_COLUMNS + 1)]));
    expect(!over.ok && over.error).toMatch(/200/);
    // Columns spread over many rows count too.
    const spread = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ [`k${i}`]: 'x' })));
    expect(parseJson(spread).ok).toBe(false);
  });

  it('stops at an 8 KB value', () => {
    const r = parseJson(JSON.stringify([{ a: 'x'.repeat(MAX_CELL + 1) }]));
    expect(!r.ok && r.error).toMatch(/8 KB/);
    expect(parseJson(JSON.stringify([{ a: 'x'.repeat(MAX_CELL) }])).ok).toBe(true);
  });

  it('skips items that are not objects', () => {
    expect(ok(parseJson('[1,"two",null,[3],{"a":"1"}]')).rows).toHaveLength(1);
  });
});

describe('ndjson reader', () => {
  it('reads one object per line and unwraps a result key', () => {
    const r = ok(parseNdjson('{"preview":false,"result":{"host":"A","_time":"1"}}\n\n{"host":"B"}\r\n'));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].get('host')).toBe('A');
    expect(r.rows[0].has('preview')).toBe(false);
  });

  it('names the bad line', () => {
    const r = parseNdjson('{"a":1}\n{broken\n');
    expect(!r.ok && r.error).toMatch(/Line 2/);
  });

  it('stops at 5,000 rows', () => {
    const lines = Array.from({ length: MAX_ROWS + 1 }, () => '{"a":1}').join('\n');
    expect(parseNdjson(lines).ok).toBe(false);
  });
});
