// Suggested column mapping. Only these four fields are ever used; every other column is ignored.

export const FIELD_KEYS = ['time', 'host', 'title', 'severity'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type Mapping = Record<FieldKey, string | null>;

export const SYNONYMS: Record<FieldKey, readonly string[]> = {
  time: ['timestamp', '@timestamp', 'time', '_time', 'eventtime', 'created', 'createdtime', 'firstactivity', 'detect_time', 'alert_time'],
  host: ['host', 'hostname', 'host.name', 'devicename', 'computername', 'device.hostname', 'device', 'dest', 'agent.name', 'endpoint'],
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
  ],
  severity: ['severity', 'severity_id', 'event.severity', 'priority', 'level', 'rule.level'],
};

const PREFIXES = ['_source.', 'result.', 'fields.'];

/** Lowercase, drop wrapper prefixes, and ignore spaces, underscores and hyphens ("Device Name" = devicename). */
export function normalizeKey(key: string): string {
  let k = key.trim().toLowerCase();
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
