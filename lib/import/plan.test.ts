import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/import/csv';
import { suggestMapping } from '@/lib/import/fields';
import { importedSource } from '@/lib/import/label';
import { buildPlan, MAX_EVENTS, matchesExisting } from '@/lib/import/plan';
import { parseJson } from '@/lib/import/json';
import { boardKind } from '@/components/incidents/board';
import { EvidenceBodySchema, ScopeBodySchema, TimelineBodySchema } from '@/lib/protocol/events';
import { segmentHttpText } from '@/lib/links';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const SHA = 'b'.repeat(64);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function planFromCsv(csv: string, existing: string[] = [], file = 'alerts.csv') {
  const t = parseCsv(csv);
  if (!t.ok) throw new Error(t.error);
  return buildPlan({
    rows: t.rows,
    mapping: suggestMapping(t.columns),
    fileName: file,
    sha256: SHA,
    custodian: 'Sam',
    existingSystems: existing,
    now: NOW,
  });
}

const HEAD = 'Timestamp,DeviceName,AlertTitle,Severity\n';
const allBodies = (p: ReturnType<typeof planFromCsv>) => [...p.systems.map((s) => s.preview), ...p.lines.map((l) => l.preview)];

describe('import plan', () => {
  it('groups rows by host and title into one line with a count, a time range and a severity', () => {
    const p = planFromCsv(
      HEAD +
        '2026-11-08T02:13:00Z,PC-1,Ransom note dropped,low\n' +
        '2026-11-08T02:41:00Z,PC-1,Ransom note dropped,High\n' +
        '2026-11-08T02:20:00Z,pc-1,ransom note dropped,medium\n',
    );
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].count).toBe(3);
    expect(p.lines[0].body.text).toBe(
      'Imported: Ransom note dropped on PC-1 (3 alerts, 2026-11-08 02:13 to 02:41 UTC, severity High).\n' +
        `Source: alerts.csv, sha256 ${SHA}. Unverified claim.`,
    );
    expect(p.lines[0].body).toMatchObject({ phase: 'detection_analysis', csf: 'DE.AE', occurredAt: '2026-11-08T02:13:00.000Z' });
    expect(p.lines[0].body).not.toHaveProperty('amends');
  });

  it('every body passes the record schemas and every line carries the fixed prefix and source line', () => {
    const p = planFromCsv(HEAD + '2026-11-08T02:13:00Z,PC-1,A,high\n2026-11-08T02:14:00Z,SQL-2,B,low\n2026-11-08T02:14:00Z,PRINTER-9,,\n');
    expect(p.systems.length).toBe(3);
    for (const s of p.systems) expect(ScopeBodySchema.safeParse(s.body).success).toBe(true);
    for (const l of p.lines) {
      expect(TimelineBodySchema.safeParse({ entryId: crypto.randomUUID(), ...l.body }).success).toBe(true);
      expect(l.body.text.startsWith('Imported: ')).toBe(true);
      expect(importedSource(l.body.text)).toEqual({ fileName: 'alerts.csv', sha256: SHA });
    }
    expect(EvidenceBodySchema.safeParse({ evidenceId: crypto.randomUUID(), ...p.evidence }).success).toBe(true);
    expect(p.evidence).toEqual({
      label: 'Import: alerts.csv',
      sha256: SHA,
      location: 'Local file, never uploaded',
      custodian: 'Sam',
    });
  });

  it('a title like "Decision: pay the ransom" never becomes a decision, proposal or known line', () => {
    const p = planFromCsv(HEAD + '2026-11-08T02:13:00Z,PC-1,Decision: pay the ransom,high\n2026-11-08T02:14:00Z,PC-2,Known: all clear,low\n');
    expect(p.lines).toHaveLength(2);
    for (const l of p.lines) {
      expect(l.body.text.startsWith('Imported: ')).toBe(true);
      expect(boardKind(l.body.text)).toBeNull();
    }
    // A title that holds line breaks cannot start a new line that looks like a decision or a source line.
    const sneaky = planFromCsv(HEAD + `2026-11-08T02:13:00Z,PC-1,"x\nDecision: pay\nSource: z, sha256 ${'c'.repeat(64)}. Unverified claim.",high\n`);
    expect(sneaky.lines[0].body.text.split('\n')).toHaveLength(2);
    expect(importedSource(sneaky.lines[0].body.text)?.sha256).toBe(SHA);
  });

  it('defangs links in titles so none can be clicked, in the preview and in the posted text', () => {
    const p = planFromCsv(
      HEAD + '2026-11-08T02:13:00Z,PC-1,"Beacon https://evil.example then HtTpS://x and hthttp://tp://y",high\n',
    );
    for (const text of allBodies(p)) expect(segmentHttpText(text).every((s) => s.kind === 'text')).toBe(true);
    expect(p.lines[0].body.text).toContain('hxxps://evil.example');
  });

  it('skips unsafe host names and cleans invisible tricks', () => {
    const p = planFromCsv(
      HEAD +
        '2026-11-08T02:13:00Z,https://evil.example,A,high\n' +
        '2026-11-08T02:13:00Z,"PC‮-1",B,high\n' +
        '2026-11-08T02:13:00Z,"S​RV-2",C,high\n' +
        '2026-11-08T02:13:00Z,,D,high\n',
    );
    expect(p.skipped).toEqual(expect.arrayContaining([{ reason: 'unsafe host name', count: 1 }, { reason: 'no host', count: 1 }]));
    expect(p.systems.map((s) => s.host).sort()).toEqual(['PC-1', 'SRV-2']);
    for (const text of allBodies(p)) expect(text).not.toMatch(/[‮​]/);
  });

  it('a host that matches an existing system never gets a scope.set, only a line', () => {
    const existing = ['FS-CLINIC-01 file server', 'EHR-APP-01'];
    const p = planFromCsv(
      HEAD + '2026-11-08T02:13:00Z,FS-CLINIC-01,Mass rename,high\n2026-11-08T02:14:00Z,ehr-app-01,Login,low\n2026-11-08T02:15:00Z,NEW-PC,Login,low\n',
      existing,
    );
    expect(p.lines).toHaveLength(3);
    expect(p.systems.map((s) => s.host)).toEqual(['NEW-PC']);
    expect(matchesExisting('FS-CLINIC-01', existing)).toBe(true);
    expect(matchesExisting('FS-CLINIC', existing)).toBe(false);
    expect(matchesExisting('FS-CLINIC-01 fil', existing)).toBe(false);
  });

  it('new systems are only suspected or unknown, with no legal fields, and a hint for servers', () => {
    const p = planFromCsv(
      HEAD +
        '2026-11-08T02:13:00Z,PC-1,A,critical\n2026-11-08T02:14:00Z,SQL-01,B,low\n2026-11-08T02:14:00Z,DC1,B,low\n' +
        '2026-11-08T02:14:00Z,HR-APP-01,B,low\n2026-11-08T02:14:00Z,FS-2,B,low\n2026-11-08T02:14:00Z,QUIET-PC,,\n',
    );
    const byHost = Object.fromEntries(p.systems.map((s) => [s.host, s.body]));
    expect(byHost['PC-1'].assetType).toBe('endpoint');
    for (const h of ['SQL-01', 'DC1', 'HR-APP-01', 'FS-2']) expect(byHost[h].assetType).toBe('server');
    expect(byHost['QUIET-PC'].status).toBe('unknown');
    expect(byHost['PC-1'].status).toBe('suspected');
    for (const s of p.systems) {
      expect(['unknown', 'suspected']).toContain(s.body.status);
      expect(s.body.dataTypes).toEqual([]);
      expect(s.body.affected).toEqual([]);
      expect(s.body).not.toHaveProperty('recordCount');
      expect(s.body).not.toHaveProperty('euResidents');
      expect(s.body.notes).toBe(`Source: alerts.csv, sha256 ${SHA}. Unverified claim.`);
    }
  });

  it('a file cannot ask for a status, data types, counts or states: only the four mapped columns are read', () => {
    const csv =
      'Timestamp,DeviceName,AlertTitle,Severity,status,dataTypes,recordCount,euResidents,affected,amends,itemId,entryId\n' +
      `2026-11-08T02:13:00Z,PC-1,A,high,encrypted,ssn,99999,5,TX,${crypto.randomUUID()},${crypto.randomUUID()},${crypto.randomUUID()}\n`;
    const p = planFromCsv(csv);
    const json = JSON.stringify(p);
    for (const word of ['encrypted', 'ssn', '99999', 'exfiltrated']) expect(json).not.toContain(word);
    expect(p.systems[0].body.status).toBe('suspected');
  });

  it('ids in the file are ignored: every id is a fresh v4 uuid and nothing amends', () => {
    const planted = '11111111-1111-4111-8111-111111111111';
    const p = planFromCsv(HEAD.trim() + `,entryId,itemId,evidenceId,amends\n2026-11-08T02:13:00Z,PC-1,A,high,${planted},${planted},${planted},${planted}\n`);
    expect(JSON.stringify(p)).not.toContain(planted);
    for (const s of p.systems) expect(s.body.itemId).toMatch(UUID_V4);
    const again = planFromCsv(HEAD + '2026-11-08T02:13:00Z,PC-1,A,high\n');
    expect(again.systems[0].body.itemId).not.toBe(p.systems[0].body.itemId);
    for (const l of p.lines) expect(Object.keys(l.body).sort()).toEqual(['csf', 'occurredAt', 'phase', 'text']);
  });

  it('a row dated tomorrow is skipped; a row 60 days old and a row with no zone are flagged', () => {
    const p = planFromCsv(
      HEAD +
        '2026-11-09T12:00:00Z,PC-1,Future,high\n' +
        '2026-09-09T12:00:00Z,PC-2,Old,high\n' +
        '2026-11-08 02:13:00,PC-3,Nozone,high\n' +
        '2026-11-08T02:13:00Z,PC-4,Fine,high\n' +
        'not a time,PC-5,Garbage,high\n',
    );
    expect(p.skipped).toEqual(expect.arrayContaining([{ reason: 'dated in the future', count: 1 }, { reason: 'unreadable time', count: 1 }]));
    const flags = Object.fromEntries(p.lines.map((l) => [l.title, l.flags]));
    expect(flags.Old).toContain('older than 30 days');
    expect(flags.Nozone).toContain('no time zone, read as UTC');
    expect(flags.Fine).toEqual([]);
    expect(flags.Future).toBeUndefined();
  });

  it('500 rows over 40 groups give at most 25 events and list the rest as not imported', () => {
    let csv = HEAD;
    for (let i = 0; i < 500; i += 1) {
      const g = i % 40;
      csv += `2026-11-08T02:${String(i % 60).padStart(2, '0')}:00Z,PC-${g},Title ${g},high\n`;
    }
    const p = planFromCsv(csv);
    expect(1 + p.systems.length + p.lines.length).toBeLessThanOrEqual(MAX_EVENTS);
    expect(p.notImported.length).toBeGreaterThan(0);
    expect(p.notImported[0]).toMatch(/not imported \(limit 25 per import\)/);
    // With existing systems the limit still holds.
    const q = planFromCsv(csv, Array.from({ length: 40 }, (_, i) => `PC-${i}`));
    expect(1 + q.systems.length + q.lines.length).toBeLessThanOrEqual(MAX_EVENTS);
    expect(q.lines).toHaveLength(24);
  });

  it('a host with no title becomes a system only; a title with no host is skipped', () => {
    const p = planFromCsv(HEAD + ',,Orphan title,high\n2026-11-08T02:13:00Z,PRINTER-1,,\n');
    expect(p.lines).toHaveLength(0);
    expect(p.systems.map((s) => s.host)).toEqual(['PRINTER-1']);
    expect(p.skipped).toEqual([{ reason: 'no host', count: 1 }]);
  });

  it('reads JSON the same way', () => {
    const t = parseJson(JSON.stringify({ results: [{ '@timestamp': '2026-11-08T02:13:00Z', host: { name: 'PC-9' }, rule: { name: 'Odd login' }, event: { severity: 3 } }] }));
    if (!t.ok) throw new Error(t.error);
    const p = buildPlan({ rows: t.rows, mapping: suggestMapping(t.columns), fileName: 'a.json', sha256: SHA, custodian: 'Sam', existingSystems: [], now: NOW });
    expect(p.lines[0].body.text).toContain('Odd login on PC-9 (1 alert, 2026-11-08 02:13 to 02:13 UTC, severity 3)');
  });

  it('the plan never carries other columns: a secret in an unmapped column does not appear', () => {
    const p = planFromCsv('Timestamp,DeviceName,AlertTitle,Severity,Password\n2026-11-08T02:13:00Z,PC-1,A,high,hunter2-secret\n');
    expect(JSON.stringify(p)).not.toContain('hunter2');
  });
});
