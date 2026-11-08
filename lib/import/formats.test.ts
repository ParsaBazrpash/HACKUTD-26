import { describe, expect, it } from 'vitest';
import { parseTime } from '@/lib/import/clean';
import { parseCsv } from '@/lib/import/csv';
import { normalizeKey, suggestMapping } from '@/lib/import/fields';
import { parseJson, parseNdjson } from '@/lib/import/json';
import { buildPlan, matchesExisting } from '@/lib/import/plan';
import type { TableResult } from '@/lib/import/csv';

const NOW = Date.parse('2026-11-08T14:30:00Z');
const SHA = 'f'.repeat(64);

function plan(t: TableResult, existing: string[] = []) {
  if (!t.ok) throw new Error(t.error);
  const mapping = suggestMapping(t.columns);
  return { mapping, plan: buildPlan({ rows: t.rows, mapping, fileName: 'x', sha256: SHA, custodian: 'Sam', existingSystems: existing, now: NOW }) };
}

describe('files in the shape of real tools import with no manual column picks', () => {
  it('CrowdStrike Falcon Alerts API JSON ({"resources": [...]})', () => {
    const file = JSON.stringify({
      resources: [
        { created_timestamp: '2026-11-08T08:13:05Z', device: { hostname: 'NURSE-WS-12' }, name: 'Lateral movement', severity_name: 'High' },
      ],
    });
    // The API names its fields severity_name and device.hostname.
    const { mapping, plan: p } = plan(parseJson(file));
    expect(mapping).toMatchObject({ time: 'created_timestamp', host: 'device.hostname', title: 'name', severity: 'severity_name' });
    expect(p.lines[0].body.text).toContain('Lateral movement on NURSE-WS-12 (1 alert, 2026-11-08 08:13 to 08:13 UTC, severity High)');
  });

  it('CrowdStrike streaming events: epoch milliseconds, word severity before the number', () => {
    const line = (t: number) =>
      JSON.stringify({ metadata: { eventCreationTime: t }, event: { ComputerName: 'PACS-IMG-01', DetectName: 'Credential theft', SeverityName: 'High', Severity: 70 } });
    const { mapping, plan: p } = plan(parseNdjson([line(1794125585123), line(1794125600000)].join('\n')));
    expect(mapping).toEqual({ time: 'metadata.eventCreationTime', host: 'event.ComputerName', title: 'event.DetectName', severity: 'event.SeverityName' });
    expect(p.lines[0].count).toBe(2);
    expect(p.lines[0].body.text).toContain('severity High');
  });

  it('AWS Security Hub / GuardDuty JSON ({"Findings": [...]})', () => {
    const file = JSON.stringify({ Findings: [{ CreatedAt: '2026-11-08T08:20:00.000Z', Title: 'Unusual API calls', Severity: { Label: 'MEDIUM' }, Resources: [{ Id: 'i-0abc' }] }] });
    const t = parseJson(file);
    expect(t.ok).toBe(true);
    if (t.ok) expect(suggestMapping(t.columns)).toMatchObject({ time: 'CreatedAt', title: 'Title' });
  });

  it('Azure portal CSV headers with a [UTC] note (Sentinel SecurityAlert)', () => {
    const csv = 'TimeGenerated [UTC],AlertName,AlertSeverity,CompromisedEntity\n2026-11-08T08:13:05Z,Suspicious sign-in,High,RECEPTION-PC-03\n';
    const { mapping, plan: p } = plan(parseCsv(csv));
    expect(mapping).toEqual({ time: 'TimeGenerated [UTC]', host: 'CompromisedEntity', title: 'AlertName', severity: 'AlertSeverity' });
    expect(p.lines).toHaveLength(1);
    expect(normalizeKey('Computer Name [UTC]')).toBe('computername');
  });

  it('Elastic and Wazuh style names find their title and severity', () => {
    expect(suggestMapping(['@timestamp', 'host.name', 'kibana.alert.rule.name', 'kibana.alert.severity'])).toEqual({
      time: '@timestamp',
      host: 'host.name',
      title: 'kibana.alert.rule.name',
      severity: 'kibana.alert.severity',
    });
    expect(suggestMapping(['timestamp', 'agent.name', 'rule.level', 'rule.description'])).toMatchObject({ title: 'rule.description', severity: 'rule.level', host: 'agent.name' });
    expect(suggestMapping(['_time', 'dest', 'rule_name', 'urgency'])).toMatchObject({ severity: 'urgency', host: 'dest', title: 'rule_name' });
  });

  it('does not pick a generic "name" column that belongs to something else', () => {
    // agent.name is a host synonym; a bare "name" must not be chosen as host or title by an "ends with" rule.
    expect(suggestMapping(['agent.name', 'user.name']).title).toBeNull();
    expect(suggestMapping(['agent.name', 'user.name']).host).toBe('agent.name');
  });
});

describe('Kibana and US style dates', () => {
  const ok = (s: string) => {
    const r = parseTime(s, NOW);
    if (!r.ok) throw new Error(`${s}: ${r.reason}`);
    return r;
  };

  it('reads Kibana Discover dates and flags them as zone-less', () => {
    const r = ok('Nov 8, 2026 @ 08:13:05.123');
    expect(r.iso).toBe('2026-11-08T08:13:05.123Z');
    expect(r.flags).toEqual(['no time zone, read as UTC']);
    expect(ok('November 8th 2026, 08:13:05.5').iso).toBe('2026-11-08T08:13:05.500Z');
    expect(ok('Nov 8, 2026 @ 08:13').iso).toBe('2026-11-08T08:13:00.000Z');
  });

  it('reads US dates with 12 and 24 hour clocks and flags them', () => {
    expect(ok('11/8/2026 8:13').iso).toBe('2026-11-08T08:13:00.000Z');
    expect(ok('11/8/2026, 8:13:05 AM').iso).toBe('2026-11-08T08:13:05.000Z');
    expect(ok('11/8/2026 12:05 AM').iso).toBe('2026-11-08T00:05:00.000Z');
    expect(ok('11/8/2026 12:05 PM').iso).toBe('2026-11-08T12:05:00.000Z');
    expect(ok('11/8/2026 1:30:00.250pm').iso).toBe('2026-11-08T13:30:00.250Z');
    expect(ok('11/8/2026 8:13').flags).toEqual(['read as month/day/year', 'no time zone, read as UTC']);
  });

  it('still skips the future, flags old rows, and refuses nonsense in these formats', () => {
    expect(parseTime('Nov 9, 2026 @ 12:00:00.000', NOW)).toEqual({ ok: false, reason: 'dated in the future' });
    expect(parseTime('11/9/2026 12:00', NOW).ok).toBe(false);
    expect(ok('9/9/2026 12:00').flags).toContain('older than 30 days');
    for (const s of ['Foo 8, 2026 @ 08:13:05', 'Feb 31, 2026 @ 08:13:05', '13/8/2026 8:13', '11/32/2026 8:13', '11/8/2026 13:00 PM', '11/8/2026 0:30 AM', 'Nov 8, 2026 @ 25:00', 'Marchh 8, 2026 @ 08:13']) {
      expect(parseTime(s, NOW).ok, s).toBe(false);
    }
  });

  it('is fast on hostile near-matches', () => {
    const start = Date.now();
    parseTime('Nov ' + '8'.repeat(30) + ', 2026 @ 08', NOW);
    parseTime('1/1/2026 ' + '1'.repeat(28) + ':', NOW);
    parseTime('N'.repeat(40), NOW);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('a Kibana CSV imports, with every row flagged and unchecked', () => {
    const csv = '@timestamp,host.name,kibana.alert.rule.name,kibana.alert.severity\n"Nov 8, 2026 @ 08:13:05.123",NURSE-WS-12,Lateral movement,high\n';
    const { plan: p } = plan(parseCsv(csv));
    expect(p.skipped).toEqual([]);
    expect(p.lines[0].flags).toEqual(['no time zone, read as UTC']);
  });
});

describe('full domain names match short names on the record', () => {
  const existing = ['NURSE-WS-12 workstation', 'EHR-APP-01'];
  it('matches by the first label', () => {
    expect(matchesExisting('nurse-ws-12.lakeside.local', existing)).toBe(true);
    expect(matchesExisting('EHR-APP-01.corp.example', existing)).toBe(true);
    expect(matchesExisting('other.nurse-ws-12.local', existing)).toBe(false);
    expect(matchesExisting('nurse-ws-1.lakeside.local', existing)).toBe(false);
  });

  it('never matches an IP address by its first number, and an unmatched host stays new', () => {
    expect(matchesExisting('10.0.0.5', ['10 main office'])).toBe(false);
    expect(matchesExisting('x.example', existing)).toBe(false);
  });

  it('a Defender export with domain names gives lines only for hosts already on the record', () => {
    const csv = 'Timestamp,DeviceName,Title,Severity\n2026-11-08T08:13:05Z,nurse-ws-12.lakeside.local,Lateral movement,High\n2026-11-08T08:14:05Z,new-pc-9.lakeside.local,Odd logon,Low\n';
    const { plan: p } = plan(parseCsv(csv), existing);
    expect(p.lines).toHaveLength(2);
    expect(p.systems.map((s) => s.host)).toEqual(['new-pc-9.lakeside.local']);
  });
});
