// Platform presets: for a known tool the column names, date style and severity scale are fixed,
// so the importer picks them with no dropdowns. "Generic" keeps the guessing and the manual mapping.
// Presets only choose which columns to read; every safety rule in clean.ts and plan.ts still applies.

import { FIELD_KEYS, normalizeKey, suggestMapping, type FieldKey, type Mapping } from '@/lib/import/fields';

export const PLATFORM_IDS = ['generic', 'splunk', 'defender', 'sentinel', 'crowdstrike', 'elastic', 'wazuh', 'datadog', 'aws'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface Platform {
  id: PlatformId;
  label: string;
  /** One or two sentences shown under the picker. */
  hint: string;
  /** Exact column names, most specific first. Empty for generic. */
  fields: Record<FieldKey, readonly string[]>;
}

const none: Record<FieldKey, readonly string[]> = { time: [], host: [], title: [], severity: [] };

export const PLATFORMS: Record<PlatformId, Platform> = {
  generic: {
    id: 'generic',
    label: 'Generic CSV or JSON (choose columns)',
    hint: 'For any other tool. Columns are guessed from their names, and you can change each of the four.',
    fields: none,
  },
  splunk: {
    id: 'splunk',
    label: 'Splunk',
    hint: 'Export results as CSV or JSON, or an Enterprise Security notable events export.',
    fields: {
      time: ['_time', 'time', 'timestamp'],
      host: ['dest', 'host', 'dvc', 'src'],
      title: ['rule_name', 'search_name', 'signature', 'name', 'message'],
      severity: ['urgency', 'severity'],
    },
  },
  defender: {
    id: 'defender',
    label: 'Microsoft Defender',
    hint: 'Advanced hunting and incident exports. The portal gives an Excel workbook, which is never opened here: open it in Excel, use Save As, and pick CSV UTF-8.',
    fields: {
      time: ['Timestamp', 'FirstActivity', 'CreatedTime', 'AlertTime'],
      host: ['DeviceName', 'ComputerName', 'MachineName'],
      title: ['Title', 'AlertTitle', 'AlertName'],
      severity: ['Severity'],
    },
  },
  sentinel: {
    id: 'sentinel',
    label: 'Microsoft Sentinel',
    hint: 'Export a SecurityAlert or SecurityIncident query as CSV.',
    fields: {
      time: ['TimeGenerated', 'StartTime', 'SystemAlertTime'],
      host: ['CompromisedEntity', 'HostName', 'Computer'],
      title: ['AlertName', 'DisplayName', 'Title'],
      severity: ['AlertSeverity', 'Severity'],
    },
  },
  crowdstrike: {
    id: 'crowdstrike',
    label: 'CrowdStrike Falcon (API or streaming)',
    hint: 'Alerts API JSON (resources list) or streaming and SIEM connector events. Numeric severity is turned into words.',
    fields: {
      time: ['created_timestamp', 'metadata.eventCreationTime', 'timestamp'],
      host: ['device.hostname', 'event.ComputerName', 'ComputerName', 'hostname'],
      title: ['name', 'display_name', 'event.DetectName', 'DetectName'],
      severity: ['severity_name', 'event.SeverityName', 'SeverityName', 'severity', 'event.Severity'],
    },
  },
  elastic: {
    id: 'elastic',
    label: 'Elastic or Kibana',
    hint: 'Security alerts from the search API, or a Kibana Discover CSV report (its dates are read as UTC).',
    fields: {
      time: ['@timestamp', 'kibana.alert.original_time', 'Time'],
      host: ['host.name', 'host.hostname', 'agent.name'],
      title: ['kibana.alert.rule.name', 'rule.name', 'message', 'event.action'],
      severity: ['kibana.alert.severity', 'signal.rule.severity', 'event.severity', 'kibana.alert.risk_score'],
    },
  },
  wazuh: {
    id: 'wazuh',
    label: 'Wazuh',
    hint: 'alerts.json (one JSON object per line). The rule level (0 to 15) is turned into words.',
    fields: {
      time: ['timestamp', '@timestamp'],
      host: ['agent.name'],
      title: ['rule.description'],
      severity: ['rule.level'],
    },
  },
  datadog: {
    id: 'datadog',
    label: 'Datadog',
    hint: 'Log Explorer or Security Signals CSV. The log status (error, warn, info) is turned into a severity word.',
    fields: {
      time: ['date', 'timestamp'],
      host: ['host', 'hostname'],
      title: ['message', 'title', 'evt.name'],
      severity: ['status', 'severity'],
    },
  },
  aws: {
    id: 'aws',
    label: 'AWS Security Hub or GuardDuty',
    hint: 'JSON with a Findings list. Resource ARNs are not accepted as host names, so findings need an instance id or name column.',
    fields: {
      time: ['CreatedAt', 'FirstObservedAt', 'UpdatedAt', 'time'],
      host: ['Resource.InstanceDetails.InstanceId', 'Resources.0.Id'],
      title: ['Title'],
      severity: ['Severity.Label', 'Severity.Normalized', 'Severity'],
    },
  },
};

export function isPlatformId(v: unknown): v is PlatformId {
  return typeof v === 'string' && (PLATFORM_IDS as readonly string[]).includes(v);
}

/** The preset's columns for this file. A field the file does not have stays null (no guessing). */
export function suggestForPlatform(id: PlatformId, columns: readonly string[]): Mapping {
  if (id === 'generic') return suggestMapping(columns);
  const byNorm = new Map<string, string>();
  for (const c of columns) {
    const n = normalizeKey(c);
    if (!byNorm.has(n)) byNorm.set(n, c);
  }
  const out: Mapping = { time: null, host: null, title: null, severity: null };
  for (const field of FIELD_KEYS) {
    for (const key of PLATFORMS[id].fields[field]) {
      const hit = byNorm.get(normalizeKey(key));
      if (hit !== undefined) {
        out[field] = hit;
        break;
      }
    }
  }
  return out;
}

/** Fields (other than severity) the preset could not find in the file. */
export function missingFields(id: PlatformId, mapping: Mapping): FieldKey[] {
  if (id === 'generic') return [];
  return (['time', 'host', 'title'] as const).filter((f) => mapping[f] === null);
}

// --- Severity words -------------------------------------------------------------

const NUMBER = /^\d{1,3}(?:\.\d{1,3})?$/;

function band(n: number, cuts: readonly [number, number, number, number]): string {
  if (n >= cuts[0]) return 'Critical';
  if (n >= cuts[1]) return 'High';
  if (n >= cuts[2]) return 'Medium';
  if (n >= cuts[3]) return 'Low';
  return 'Informational';
}

const DATADOG_STATUS = new Map<string, string>([
  ['emergency', 'Critical'],
  ['emerg', 'Critical'],
  ['alert', 'Critical'],
  ['critical', 'Critical'],
  ['error', 'High'],
  ['err', 'High'],
  ['warn', 'Medium'],
  ['warning', 'Medium'],
  ['notice', 'Informational'],
  ['info', 'Informational'],
  ['ok', 'Informational'],
  ['debug', 'Informational'],
]);

/** Turns a platform's own severity scale into words. Anything it does not know is passed on unchanged. */
export function convertSeverity(id: PlatformId, raw: string): string {
  const v = raw.trim();
  if (v.length > 20) return v;
  if (id === 'datadog') return DATADOG_STATUS.get(v.toLowerCase()) ?? v;
  if (!NUMBER.test(v)) return v;
  const n = Number(v);
  if (id === 'wazuh') return band(n, [12, 9, 6, 3]); // rule level 0 to 15
  if (id === 'crowdstrike' || id === 'elastic' || id === 'aws') return band(n, [90, 70, 40, 20]); // score 0 to 100
  return v;
}
