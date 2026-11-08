import { describe, expect, it } from 'vitest';
import { parseCsv, type TableResult } from '@/lib/import/csv';
import { parseJson, parseNdjson } from '@/lib/import/json';
import { buildPlan } from '@/lib/import/plan';
import { convertSeverity, isPlatformId, missingFields, PLATFORM_IDS, PLATFORMS, suggestForPlatform, type PlatformId } from '@/lib/import/platforms';
import { decodeBytes } from '@/lib/import/read';

const NOW = Date.parse('2026-11-08T14:30:00Z');

function run(id: PlatformId, t: TableResult) {
  if (!t.ok) throw new Error(t.error);
  const mapping = suggestForPlatform(id, t.columns);
  const plan = buildPlan({ rows: t.rows, mapping, fileName: 'x', sha256: 'a'.repeat(64), custodian: 'Sam', existingSystems: [], now: NOW, platform: id });
  return { mapping, plan };
}

const text = (p: ReturnType<typeof run>) => p.plan.lines.map((l) => l.body.text.split('\n')[0]);

describe('every platform preset maps its own export with no manual picking', () => {
  it('Splunk CSV and JSON export', () => {
    const csv = '_time,dest,rule_name,urgency,user\n2026-11-08T08:13:05.000+00:00,PACS-IMG-01,Brute force,high,x\n';
    const a = run('splunk', parseCsv(csv));
    expect(a.mapping).toEqual({ time: '_time', host: 'dest', title: 'rule_name', severity: 'urgency' });
    expect(text(a)[0]).toContain('Brute force on PACS-IMG-01 (1 alert, 2026-11-08 08:13 to 08:13 UTC, severity high)');
    const nd = run('splunk', parseNdjson('{"preview":false,"result":{"_time":"2026-11-08T08:13:05.000+00:00","host":"LAB-WS-05","signature":"Odd logon","severity":"low"}}'));
    expect(nd.mapping).toMatchObject({ host: 'host', title: 'signature' });
    expect(nd.plan.lines).toHaveLength(1);
  });

  it('Microsoft Defender CSV', () => {
    const csv = 'Timestamp,AlertId,Title,Category,Severity,DeviceName\n2026-11-08T08:13:05Z,x,Ransom note dropped,Ransomware,High,nurse-ws-12\n';
    const a = run('defender', parseCsv(csv));
    expect(a.mapping).toEqual({ time: 'Timestamp', host: 'DeviceName', title: 'Title', severity: 'Severity' });
    expect(a.plan.lines).toHaveLength(1);
  });

  it('Microsoft Sentinel CSV with Azure [UTC] headers', () => {
    const csv = 'TimeGenerated [UTC],AlertName,AlertSeverity,CompromisedEntity\n2026-11-08T08:13:05Z,Suspicious sign-in,Medium,RECEPTION-PC-03\n';
    const a = run('sentinel', parseCsv(csv));
    expect(a.mapping).toEqual({ time: 'TimeGenerated [UTC]', host: 'CompromisedEntity', title: 'AlertName', severity: 'AlertSeverity' });
    expect(a.plan.lines).toHaveLength(1);
  });

  it('CrowdStrike Alerts API JSON turns the numeric severity into words', () => {
    const file = JSON.stringify({ resources: [{ created_timestamp: '2026-11-08T08:13:05Z', device: { hostname: 'NURSE-WS-12' }, name: 'Lateral movement', severity: 75 }] });
    const a = run('crowdstrike', parseJson(file));
    expect(a.mapping).toMatchObject({ time: 'created_timestamp', host: 'device.hostname', title: 'name', severity: 'severity' });
    expect(text(a)[0]).toContain('severity High');
  });

  it('CrowdStrike streaming events (epoch milliseconds)', () => {
    const line = JSON.stringify({ metadata: { eventCreationTime: 1794125585123 }, event: { ComputerName: 'PACS-IMG-01', DetectName: 'Credential theft', SeverityName: 'Critical', Severity: 90 } });
    const a = run('crowdstrike', parseNdjson(line));
    expect(a.mapping).toEqual({ time: 'metadata.eventCreationTime', host: 'event.ComputerName', title: 'event.DetectName', severity: 'event.SeverityName' });
    expect(text(a)[0]).toContain('severity Critical');
  });

  it('Elastic search API alerts and a Kibana CSV report with display dates', () => {
    const api = JSON.stringify({ hits: { hits: [{ _source: { '@timestamp': '2026-11-08T08:13:05.000Z', host: { name: 'BILLING-PC-02' }, kibana: { alert: { rule: { name: 'Archive tool' }, severity: 'medium' } } } }] } });
    const a = run('elastic', parseJson(api));
    expect(a.mapping).toEqual({ time: '_source.@timestamp', host: '_source.host.name', title: '_source.kibana.alert.rule.name', severity: '_source.kibana.alert.severity' });
    expect(a.plan.lines).toHaveLength(1);
    const csv = '@timestamp,host.name,kibana.alert.rule.name,kibana.alert.severity\n"Nov 8, 2026 @ 08:13:05.123",BILLING-PC-02,Archive tool,high\n';
    const b = run('elastic', parseCsv(csv));
    expect(b.plan.skipped).toEqual([]);
    expect(b.plan.lines[0].flags).toContain('no time zone, read as UTC');
  });

  it('Wazuh alerts.json turns the rule level into words', () => {
    const lines = [3, 7, 10, 13].map((level, i) =>
      JSON.stringify({ timestamp: `2026-11-08T08:1${i}:05.123+0000`, agent: { name: `WAZ-${i}` }, rule: { level, description: `Rule ${i}` } }),
    );
    const a = run('wazuh', parseNdjson(lines.join('\n')));
    expect(a.mapping).toEqual({ time: 'timestamp', host: 'agent.name', title: 'rule.description', severity: 'rule.level' });
    expect(text(a).map((t) => /severity (\w+)/.exec(t)?.[1])).toEqual(['Low', 'Medium', 'High', 'Critical']);
  });

  it('Datadog CSV turns the log status into words', () => {
    const csv = 'date,host,message,status,service\n2026-11-08T08:13:05.123Z,LAB-WS-05,Auth failure burst,error,sshd\n2026-11-08T08:14:05.123Z,LAB-WS-05,Disk almost full,warn,os\n';
    const a = run('datadog', parseCsv(csv));
    expect(a.mapping).toEqual({ time: 'date', host: 'host', title: 'message', severity: 'status' });
    expect(text(a).map((t) => /severity (\w+)/.exec(t)?.[1]).sort()).toEqual(['High', 'Medium']);
  });

  it('AWS Security Hub and GuardDuty findings', () => {
    const file = JSON.stringify({ Findings: [{ CreatedAt: '2026-11-08T08:13:05.000Z', Title: 'Unusual API calls', Severity: { Label: 'HIGH', Normalized: 70 }, Resource: { InstanceDetails: { InstanceId: 'i-0abc123' } } }] });
    const a = run('aws', parseJson(file));
    expect(a.mapping).toEqual({ time: 'CreatedAt', host: 'Resource.InstanceDetails.InstanceId', title: 'Title', severity: 'Severity.Label' });
    expect(text(a)[0]).toContain('Unusual API calls on i-0abc123');
  });

  it('AWS resource ARNs are refused as host names, never posted', () => {
    const file = JSON.stringify({ Findings: [{ CreatedAt: '2026-11-08T08:13:05.000Z', Title: 'X', Severity: { Label: 'LOW' }, Resources: [{ Id: 'arn:aws:ec2:us-east-1:111122223333:instance/i-0abc' }] }] });
    const a = run('aws', parseJson(file));
    expect(a.plan.lines).toHaveLength(0);
    expect(a.plan.skipped).toEqual([{ reason: 'unsafe host name', count: 1 }]);
  });

  it('Generic keeps guessing and manual choices', () => {
    const csv = 'Timestamp,DeviceName,AlertTitle,Severity\n2026-11-08T08:13:05Z,PC-1,A,high\n';
    const a = run('generic', parseCsv(csv));
    expect(a.mapping).toEqual({ time: 'Timestamp', host: 'DeviceName', title: 'AlertTitle', severity: 'Severity' });
  });
});

describe('platform safety', () => {
  it('a preset never guesses: a file from another tool gets nulls and a missing-field list', () => {
    const t = parseCsv('Timestamp,DeviceName,AlertTitle,Severity\n2026-11-08T08:13:05Z,PC-1,A,high\n');
    if (!t.ok) throw new Error('csv');
    const m = suggestForPlatform('wazuh', t.columns);
    expect(m).toEqual({ time: 'Timestamp', host: null, title: null, severity: null });
    expect(missingFields('wazuh', m)).toEqual(['host', 'title']);
    expect(missingFields('generic', m)).toEqual([]);
  });

  it('every platform is listed, with a label and a hint, and ids are validated', () => {
    for (const id of PLATFORM_IDS) {
      expect(PLATFORMS[id].id).toBe(id);
      expect(PLATFORMS[id].label.length).toBeGreaterThan(2);
      expect(PLATFORMS[id].hint.length).toBeGreaterThan(10);
      expect(isPlatformId(id)).toBe(true);
    }
    for (const bad of ['', 'proto', '__proto__', 'constructor', 'SPLUNK', 3, null]) expect(isPlatformId(bad)).toBe(false);
  });

  it('severity conversion passes unknown and hostile values through for cleaning, never throws', () => {
    expect(convertSeverity('crowdstrike', '70')).toBe('High');
    expect(convertSeverity('crowdstrike', '95')).toBe('Critical');
    expect(convertSeverity('crowdstrike', '5')).toBe('Informational');
    expect(convertSeverity('wazuh', '15')).toBe('Critical');
    expect(convertSeverity('wazuh', '0')).toBe('Informational');
    expect(convertSeverity('datadog', 'INFO')).toBe('Informational');
    expect(convertSeverity('datadog', 'constructor')).toBe('constructor');
    expect(convertSeverity('splunk', '70')).toBe('70');
    expect(convertSeverity('crowdstrike', 'x'.repeat(5000))).toHaveLength(5000);
    expect(convertSeverity('wazuh', '<script>')).toBe('<script>');
  });

  it('presets keep the host, defang and unchecked-flag rules', () => {
    const csv = 'timestamp,agent.name,rule.description,rule.level\n2026-11-08T08:13:05Z,https://evil.example,A,5\n2026-11-08T08:13:05Z,PC-1,See https://evil.example now,5\n11/8/2026 8:13,PC-2,US date,5\n';
    const a = run('wazuh', parseNdjson(csv.split('\n').slice(1).filter(Boolean).map((l) => JSON.stringify(Object.fromEntries(l.split(',').map((v, i) => [['timestamp', 'agent.name', 'rule.description', 'rule.level'][i], v])))).join('\n')));
    expect(a.plan.skipped).toEqual([{ reason: 'unsafe host name', count: 1 }]);
    expect(a.plan.lines.map((l) => l.body.text).join('\n')).not.toMatch(/https?:\/\//i);
  });

  it('an Excel workbook or zip file gets a clear message and is never parsed', () => {
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const r = decodeBytes(xlsx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Excel/);
    // Plain text that happens to start with "PK" is still text.
    expect(decodeBytes(new TextEncoder().encode('PKI,host\n1,2')).ok).toBe(true);
  });
});
