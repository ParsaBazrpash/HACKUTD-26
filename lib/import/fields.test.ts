import { describe, expect, it } from 'vitest';
import { suggestMapping } from '@/lib/import/fields';

describe('column mapping suggestions', () => {
  it('maps a Defender style export', () => {
    expect(suggestMapping(['Timestamp', 'DeviceName', 'AlertTitle', 'Severity', 'AccountName'])).toEqual({
      time: 'Timestamp',
      host: 'DeviceName',
      title: 'AlertTitle',
      severity: 'Severity',
    });
  });

  it('maps ECS and OCSF flattened names, case-insensitively', () => {
    expect(suggestMapping(['@timestamp', 'host.name', 'rule.name', 'event.severity'])).toEqual({
      time: '@timestamp',
      host: 'host.name',
      title: 'rule.name',
      severity: 'event.severity',
    });
    expect(suggestMapping(['TIME', 'device.hostname', 'finding_info.title', 'severity_id'])).toMatchObject({
      time: 'TIME',
      host: 'device.hostname',
      title: 'finding_info.title',
      severity: 'severity_id',
    });
  });

  it('ignores spaces and underscores, and wrapper prefixes', () => {
    expect(suggestMapping(['Detect Time', 'Computer Name', 'Detect Name', 'Level'])).toMatchObject({
      time: 'Detect Time',
      host: 'Computer Name',
      title: 'Detect Name',
      severity: 'Level',
    });
    expect(suggestMapping(['result._time', '_source.host.name'])).toMatchObject({ time: 'result._time', host: '_source.host.name' });
  });

  it('leaves a field empty when nothing matches', () => {
    expect(suggestMapping(['foo', 'bar'])).toEqual({ time: null, host: null, title: null, severity: null });
  });
});
