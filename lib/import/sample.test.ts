import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/import/csv';
import { suggestMapping } from '@/lib/import/fields';
import { buildPlan } from '@/lib/import/plan';
import { segmentHttpText } from '@/lib/links';
import { decodeBytes, detectFormat } from '@/lib/import/read';

describe('the Lakeside EDR sample file', () => {
  const bytes = new Uint8Array(readFileSync('public/samples/edr-alerts-sample.csv'));
  const decoded = decodeBytes(bytes);

  it('is plain UTF-8 CSV with the expected columns and about 30 rows', () => {
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(detectFormat(decoded.text)).toBe('csv');
    const t = parseCsv(decoded.text);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.columns).toEqual(['Timestamp', 'DeviceName', 'AlertTitle', 'Severity', 'AccountName', 'SHA256', 'RemoteUrl']);
    expect(t.rows.length).toBeGreaterThanOrEqual(28);
    expect(t.rows.length).toBeLessThanOrEqual(32);
  });

  it('becomes lines for existing systems and new systems for the other hosts, with the URL defanged', () => {
    if (!decoded.ok) throw new Error('decode');
    const t = parseCsv(decoded.text);
    if (!t.ok) throw new Error(t.error);
    const p = buildPlan({
      rows: t.rows,
      mapping: suggestMapping(t.columns),
      fileName: 'edr-alerts-sample.csv',
      sha256: 'd'.repeat(64),
      custodian: 'Sam',
      existingSystems: ['FS-CLINIC-01 file server', 'EHR-APP-01'],
      now: Date.parse('2026-11-08T14:30:00Z'),
    });
    expect(p.skipped).toEqual([]);
    const hosts = p.systems.map((s) => s.host);
    expect(hosts).toEqual(expect.arrayContaining(['RECEPTION-PC-03', 'NURSE-WS-12', 'PACS-IMG-01']));
    expect(hosts).not.toContain('FS-CLINIC-01');
    expect(hosts).not.toContain('EHR-APP-01');
    expect(p.lines.some((l) => l.host === 'FS-CLINIC-01')).toBe(true);
    expect(p.lines.every((l) => l.flags.length === 0)).toBe(true);
    expect(1 + p.systems.length + p.lines.length).toBeLessThanOrEqual(25);
    expect(p.notImported).toEqual([]);
    expect(decoded.text).toContain('https://');
    for (const l of p.lines) expect(segmentHttpText(l.preview).every((s) => s.kind === 'text')).toBe(true);
  });
});
