// Rows to an import plan (plan.md rules 7 to 17). Pure: no network, no storage, no logging.
// Only the four mapped fields are read. Ids from the file are never used.

import { capCodePoints, cleanHost, cleanSeverity, cleanTitle, parseTime } from '@/lib/import/clean';
import type { Mapping } from '@/lib/import/fields';
import { sourceLine } from '@/lib/import/label';
import type { Row } from '@/lib/import/csv';
import {
  EvidenceBodySchema,
  ScopeBodySchema,
  TimelineBodySchema,
  type EvidenceBody,
  type ScopeBody,
  type TimelineBody,
} from '@/lib/protocol/events';

export const MAX_EVENTS = 25; // the append bucket is 30
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000001';

export interface PlannedSystem {
  key: string;
  host: string;
  body: ScopeBody;
  /** The exact text that will be posted. */
  preview: string;
  flags: string[];
}

export interface PlannedLine {
  key: string;
  host: string;
  title: string;
  count: number;
  body: Omit<TimelineBody, 'entryId'>;
  preview: string;
  flags: string[];
}

export interface ImportPlan {
  evidence: Omit<EvidenceBody, 'evidenceId'>;
  systems: PlannedSystem[];
  lines: PlannedLine[];
  /** Counts of skipped rows by reason. */
  skipped: { reason: string; count: number }[];
  /** Groups and systems left out because of the per import limit. */
  notImported: string[];
  rowCount: number;
}

export interface PlanInput {
  rows: readonly Row[];
  mapping: Mapping;
  fileName: string;
  sha256: string;
  custodian: string;
  /** Names of systems already on the record. */
  existingSystems: readonly string[];
  now?: number;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  fatal: 5,
  high: 4,
  error: 4,
  medium: 3,
  moderate: 3,
  warning: 3,
  low: 2,
  info: 1,
  informational: 1,
};

function isServerName(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes('srv') || h.includes('sql') || h.includes('-app') || /(^|[^a-z])dc([^a-z]|$)/.test(h) || /(^|[^a-z])fs-/.test(h);
}

/** Equal, or the existing name starts with the host plus a space ("FS-CLINIC-01 file server"). */
export function matchesExisting(host: string, existing: readonly string[]): boolean {
  const h = host.toLowerCase();
  return existing.some((e) => {
    const n = e.trim().toLowerCase();
    return n === h || n.startsWith(`${h} `);
  });
}

function stamp(ms: number, withDate: boolean): string {
  const iso = new Date(ms).toISOString();
  return withDate ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(11, 16);
}

function get(row: Row, col: string | null): string {
  return col === null ? '' : (row.get(col) ?? '');
}

interface Group {
  host: string;
  title: string;
  count: number;
  firstMs: number;
  lastMs: number;
  severity: string | null;
  rank: number;
  flags: Set<string>;
}

export function buildEvidence(fileName: string, sha256: string, custodian: string): Omit<EvidenceBody, 'evidenceId'> {
  return {
    label: `Import: ${fileName}`,
    sha256,
    location: 'Local file, never uploaded',
    custodian: capCodePoints(custodian, 120),
  };
}

export function buildPlan(input: PlanInput): ImportPlan {
  const now = input.now ?? Date.now();
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  const groups = new Map<string, Group>();
  const hostOrder: string[] = []; // lowercase host, first seen
  const hostNames = new Map<string, string>();
  const hostHasAlerts = new Set<string>();

  for (const row of input.rows) {
    const rawHost = get(row, input.mapping.host);
    if (rawHost.trim() === '') {
      skip('no host');
      continue;
    }
    const host = cleanHost(rawHost);
    if (!host.ok) {
      skip(host.reason);
      continue;
    }
    const hostKey = host.host.toLowerCase();
    const title = cleanTitle(get(row, input.mapping.title), 200);

    if (title === '') {
      // A host with no alert text is a system only.
      if (!hostNames.has(hostKey)) {
        hostNames.set(hostKey, host.host);
        hostOrder.push(hostKey);
      }
      continue;
    }
    const time = parseTime(get(row, input.mapping.time), now);
    if (!time.ok) {
      skip(time.reason);
      continue;
    }
    if (!hostNames.has(hostKey)) {
      hostNames.set(hostKey, host.host);
      hostOrder.push(hostKey);
    }
    hostHasAlerts.add(hostKey);

    const gkey = `${hostKey}\u0000${title.toLowerCase()}`;
    let g = groups.get(gkey);
    if (!g) {
      g = {
        host: hostNames.get(hostKey) as string,
        title,
        count: 0,
        firstMs: time.ms,
        lastMs: time.ms,
        severity: null,
        rank: -1,
        flags: new Set(),
      };
      groups.set(gkey, g);
    }
    g.count += 1;
    g.firstMs = Math.min(g.firstMs, time.ms);
    g.lastMs = Math.max(g.lastMs, time.ms);
    for (const f of time.flags) g.flags.add(f);
    const sev = cleanSeverity(get(row, input.mapping.severity));
    if (sev !== null) {
      const rank = SEVERITY_RANK[sev.toLowerCase()] ?? 0;
      if (g.severity === null || rank > g.rank) {
        g.severity = sev;
        g.rank = rank;
      }
    }
  }

  const source = sourceLine(input.fileName, input.sha256);
  const budget = MAX_EVENTS - 1; // one evidence row goes first
  let used = 0;
  const notImported: string[] = [];
  const systems: PlannedSystem[] = [];
  const lines: PlannedLine[] = [];
  const systemDone = new Set<string>();

  const makeSystem = (hostKey: string): PlannedSystem | null => {
    const host = hostNames.get(hostKey) as string;
    const body: ScopeBody = {
      itemId: crypto.randomUUID(),
      system: host,
      assetType: isServerName(host) ? 'server' : 'endpoint',
      status: hostHasAlerts.has(hostKey) ? 'suspected' : 'unknown',
      dataTypes: [],
      affected: [],
      notes: source,
    };
    if (!ScopeBodySchema.safeParse(body).success) return null;
    return {
      key: `sys:${hostKey}`,
      host,
      body,
      preview: `New system: ${host} (${body.assetType}, ${body.status}). ${source}`,
      flags: [],
    };
  };

  const ordered = [...groups.values()].sort((a, b) => b.count - a.count || a.firstMs - b.firstMs);
  for (const g of ordered) {
    const hostKey = g.host.toLowerCase();
    const needSystem = !matchesExisting(g.host, input.existingSystems) && !systemDone.has(hostKey);
    const slots = 1 + (needSystem ? 1 : 0);
    if (used + 1 > budget) {
      notImported.push(`${g.title} on ${g.host} (${g.count} alert${g.count === 1 ? '' : 's'})`);
      continue;
    }
    let system: PlannedSystem | null = null;
    if (needSystem && used + slots <= budget) system = makeSystem(hostKey);
    const sameDay = new Date(g.firstMs).toISOString().slice(0, 10) === new Date(g.lastMs).toISOString().slice(0, 10);
    const range = `${stamp(g.firstMs, true)} to ${stamp(g.lastMs, !sameDay)} UTC`;
    const sev = g.severity ?? 'not given';
    const text =
      `Imported: ${g.title} on ${g.host} (${g.count} alert${g.count === 1 ? '' : 's'}, ${range}, severity ${sev}).\n${source}`;
    const body = {
      occurredAt: new Date(g.firstMs).toISOString(),
      phase: 'detection_analysis' as const,
      csf: 'DE.AE' as const,
      text,
    };
    if (!TimelineBodySchema.safeParse({ entryId: PLACEHOLDER_ID, ...body }).success) {
      skip('failed the record check');
      continue;
    }
    if (system) {
      systems.push(system);
      systemDone.add(hostKey);
      used += 1;
    } else if (needSystem && !systemDone.has(hostKey)) {
      notImported.push(`system ${g.host}`);
      systemDone.add(hostKey);
    }
    lines.push({
      key: `line:${hostKey}\u0000${g.title.toLowerCase()}`,
      host: g.host,
      title: g.title,
      count: g.count,
      body,
      preview: text,
      flags: [...g.flags],
    });
    used += 1;
  }

  // Hosts with no alert text become systems if there is room left.
  for (const hostKey of hostOrder) {
    if (systemDone.has(hostKey)) continue;
    const host = hostNames.get(hostKey) as string;
    if (matchesExisting(host, input.existingSystems)) continue;
    systemDone.add(hostKey);
    if (used + 1 > budget) {
      notImported.push(`system ${host}`);
      continue;
    }
    const s = makeSystem(hostKey);
    if (!s) continue;
    systems.push(s);
    used += 1;
  }

  lines.sort((a, b) => Date.parse(a.body.occurredAt) - Date.parse(b.body.occurredAt));

  return {
    evidence: buildEvidence(input.fileName, input.sha256, input.custodian),
    systems,
    lines,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    notImported: notImported.map((n) => `${n}: not imported (limit ${MAX_EVENTS} per import)`),
    rowCount: input.rows.length,
  };
}

/** True when the evidence body passes the record schema (used before offering the plan). */
export function evidenceIsValid(body: Omit<EvidenceBody, 'evidenceId'>): boolean {
  return EvidenceBodySchema.safeParse({ evidenceId: PLACEHOLDER_ID, ...body }).success;
}

// --- Sending -----------------------------------------------------------------

export const MAX_RETRIES = 10;

/** The three IncidentClient actions an import may call. Nothing else is ever sent. */
export interface ImportSink {
  addEvidence(b: Omit<EvidenceBody, 'evidenceId'>): Promise<void>;
  upsertScopeItem(b: ScopeBody): Promise<void>;
  addTimelineEntry(b: Omit<TimelineBody, 'entryId'>): Promise<void>;
}

export type SendOutcome =
  | { ok: true; count: number }
  | { ok: false; message: string; sent: string[]; unsent: string[] };

/**
 * Sends the evidence row first, then new systems, then timeline lines, one at a time.
 * On a "slow down" error it waits one second and retries the same event, at most 10 times.
 * Any other error stops the import and reports what was and was not sent.
 */
export async function sendImport(
  sink: ImportSink,
  plan: Pick<ImportPlan, 'evidence'>,
  systems: readonly PlannedSystem[],
  lines: readonly PlannedLine[],
  opts: { sleep?: (ms: number) => Promise<void>; onProgress?: (done: number, total: number) => void; describe?: (cause: unknown) => string } = {},
): Promise<SendOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const steps: { label: string; run: () => Promise<void> }[] = [
    { label: 'Evidence row', run: () => sink.addEvidence(plan.evidence) },
    ...systems.map((s) => ({ label: `System ${s.host}`, run: () => sink.upsertScopeItem(s.body) })),
    ...lines.map((l) => ({ label: `${l.title} on ${l.host}`, run: () => sink.addTimelineEntry(l.body) })),
  ];
  opts.onProgress?.(0, steps.length);
  for (let i = 0; i < steps.length; i += 1) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await steps[i].run();
        break;
      } catch (cause) {
        const slow = cause instanceof Error && /slow down/i.test(cause.message);
        if (slow && attempt < MAX_RETRIES) {
          await sleep(1000);
          continue;
        }
        return {
          ok: false,
          message: opts.describe ? opts.describe(cause) : 'The import stopped.',
          sent: steps.slice(0, i).map((s) => s.label),
          unsent: steps.slice(i).map((s) => s.label),
        };
      }
    }
    opts.onProgress?.(i + 1, steps.length);
  }
  return { ok: true, count: steps.length };
}
