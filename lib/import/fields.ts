// Suggested column mapping. Only these four fields are ever used; every other column is ignored.

export const FIELD_KEYS = ['time', 'host', 'title', 'severity'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type Mapping = Record<FieldKey, string | null>;

export const SYNONYMS: Record<FieldKey, readonly string[]> = {
  time: [
    'timestamp',
    '@timestamp',
    'time',
    '_time',
    'eventtime',
    'created',
    'createdtime',
    'firstactivity',
    'detect_time',
    'alert_time',
    'timegenerated',
    'createdtimestamp',
    'createddatetime',
    'metadata.eventcreationtime',
    'createdat',
    'date',
  ],
  host: [
    'host',
    'hostname',
    'host.name',
    'devicename',
    'computername',
    'device.hostname',
    'device',
    'dest',
    'agent.name',
    'endpoint',
    'compromisedentity',
    'event.computername',
    'computer',
    'evidence.0.devicednsname',
  ],
  title: [
    'title',
    'alerttitle',
    'alertname',
    'name',
    'rule.name',
    'rulename',
    'finding_info.title',
    'detectname',
    'signature',
    'threatname',
    'message',
    'event.action',
    'rule.description',
    'kibana.alert.rule.name',
    'event.detectname',
    'searchname',
  ],
  // Names that carry the word ("High") come before ones that carry a number (70).
  severity: [
    'severityname',
    'event.severityname',
    'severity',
    'severity_id',
    'event.severity',
    'priority',
    'level',
    'rule.level',
    'alertseverity',
    'kibana.alert.severity',
    'urgency',
  ],
};

const PREFIXES = ['_source.', 'result.', 'fields.'];

/** Lowercase, drop wrapper prefixes, and ignore spaces, underscores and hyphens ("Device Name" = devicename). */
export function normalizeKey(key: string): string {
  let k = key.slice(0, 200).trim().toLowerCase();
  // Azure portal headers end with a note such as " [UTC]".
  if (k.endsWith(']')) {
    const open = k.lastIndexOf('[');
    if (open > 0 && k.length - open <= 22) k = k.slice(0, open).trimEnd();
  }
  for (const p of PREFIXES) if (k.startsWith(p)) k = k.slice(p.length);
  let out = '';
  for (const ch of k) if (ch !== ' ' && ch !== '_' && ch !== '-') out += ch;
  return out;
}

export function suggestMapping(columns: readonly string[]): Mapping {
  const byNorm = new Map<string, string>();
  for (const c of columns) {
    const n = normalizeKey(c);
    if (!byNorm.has(n)) byNorm.set(n, c);
  }
  const out: Mapping = { time: null, host: null, title: null, severity: null };
  for (const field of FIELD_KEYS) {
    for (const syn of SYNONYMS[field]) {
      const hit = byNorm.get(normalizeKey(syn));
      if (hit !== undefined) {
        out[field] = hit;
        break;
      }
    }
  }
  return out;
}
