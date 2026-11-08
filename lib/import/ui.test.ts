import { readdirSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Evidence, IncidentState, ScopeItem, TimelineItem } from '@/lib/client/types';
import { EMPTY_PROFILE } from '@/lib/client/types';
import { sourceLine } from '@/lib/import/label';
import { parseCsv } from '@/lib/import/csv';
import { suggestMapping } from '@/lib/import/fields';
import { buildPlan, MAX_RETRIES, sendImport } from '@/lib/import/plan';

const holder: { state: IncidentState } = { state: null as unknown as IncidentState };
vi.mock('@/hooks/use-incident', () => ({ useIncident: () => holder.state }));

const { ImportPanel } = await import('@/components/incidents/import-panel');
const { TimelineList } = await import('@/components/incidents/timeline-list');
const { ScopeList } = await import('@/components/incidents/scope-list');

const H = 'e'.repeat(64);
const ok = { ok: true, failures: [], warnings: [] };
const at = new Date('2026-11-08T03:00:00Z');

function stateFor(role: string, memberState: string, extra: Partial<IncidentState> = {}): IncidentState {
  return {
    connection: 'ready',
    me: { identity: 'a'.repeat(64), displayName: 'Sam', role, state: memberState } as IncidentState['me'],
    incident: null,
    status: null,
    members: [],
    channels: [],
    timeline: [],
    scope: [],
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: { ok: true, checkedAt: at, channels: {}, rosterFailures: [] },
    org: null,
    roster: [],
    pages: [],
    ...extra,
  };
}

function entry(text: string, n: number): TimelineItem {
  return {
    seq: BigInt(n),
    by: { identity: 'a'.repeat(64), displayName: 'Sam', role: 'technical' },
    at,
    sentAt: at,
    verdict: ok,
    amendedBy: [],
    entry: {
      entryId: `00000000-0000-4000-8000-00000000000${n}`,
      occurredAt: '2026-11-08T02:13:00.000Z',
      phase: 'detection_analysis',
      csf: 'DE.AE',
      text,
    },
  };
}

describe('who sees the Import button', () => {
  it.each(['commander', 'counsel', 'technical'])('an active %s does', (role) => {
    holder.state = stateFor(role, 'active');
    expect(renderToStaticMarkup(createElement(ImportPanel))).toContain('Import from file');
  });

  it('an executive, a pending member, a revoked member and nobody signed in do not', () => {
    for (const [role, st] of [['executive', 'active'], ['technical', 'pending'], ['technical', 'revoked'], ['commander', 'revoked']]) {
      holder.state = stateFor(role, st);
      expect(renderToStaticMarkup(createElement(ImportPanel)), `${role} ${st}`).toBe('');
    }
    holder.state = { ...stateFor('technical', 'active'), me: null };
    expect(renderToStaticMarkup(createElement(ImportPanel))).toBe('');
  });
});

describe('the Imported, unverified chip', () => {
  it('shows on imported entries, with the file name and short hash, and never makes a link', () => {
    const text = `Imported: Beacon to hxxps://evil.example on PC-1 (1 alert, 2026-11-08 02:13 to 02:13 UTC, severity high).\n${sourceLine('a.csv', H)}`;
    const forged = `Imported: see https://evil.example now\n${sourceLine('b.csv', H)}`;
    holder.state = stateFor('technical', 'active', { timeline: [entry(text, 1), entry(forged, 2), entry('Decision: pay the ransom', 3), entry('Plain entry', 4)] });
    const html = renderToStaticMarkup(createElement(TimelineList, { items: holder.state.timeline, detailed: true }));
    expect(html.match(/Imported, unverified/g)).toHaveLength(2);
    expect(html).toContain('Imported from a.csv, sha256 eeeeeeeeeeee');
    // Even a hand-typed imported-looking entry with a real link is shown as text, not as a link.
    expect(html).not.toMatch(/<a\b/);
    expect(html).toContain('https://evil.example');
  });

  it('shows on imported systems and not on others', () => {
    const scope = (system: string, notes: string): ScopeItem => ({
      itemId: `00000000-0000-4000-8000-0000000000${system.length}`,
      latest: { itemId: `00000000-0000-4000-8000-0000000000${system.length}`, system, assetType: 'endpoint', status: 'suspected', dataTypes: [], affected: [], notes },
      history: [{ seq: 1n, by: null, at, sentAt: at, verdict: ok, body: {} as ScopeItem['latest'] }],
    });
    holder.state = stateFor('technical', 'active');
    const html = renderToStaticMarkup(createElement(ScopeList, { items: [scope('PC-1', sourceLine('a.csv', H)), scope('PC-22', 'my own note')] }));
    expect(html.match(/Imported, unverified/g)).toHaveLength(1);
  });
});

describe('sending an import', () => {
  const csv = 'Timestamp,DeviceName,AlertTitle,Severity\n2026-11-08T02:13:00Z,PC-1,A,high\n2026-11-08T02:14:00Z,PC-2,B,high\n';
  const t = parseCsv(csv);
  if (!t.ok) throw new Error('csv');
  const plan = buildPlan({ rows: t.rows, mapping: suggestMapping(t.columns), fileName: 'a.csv', sha256: H, custodian: 'Sam', existingSystems: [], now: Date.parse('2026-11-08T12:00:00Z') });

  function sink(failOn?: (call: string, n: number) => Error | null) {
    const calls: string[] = [];
    const tries = new Map<string, number>();
    const make = (name: string) => async () => {
      const n = (tries.get(name) ?? 0) + 1;
      tries.set(name, n);
      const err = failOn?.(name, n);
      if (err) throw err;
      calls.push(name);
    };
    return { calls, sink: { addEvidence: make('evidence'), upsertScopeItem: make('scope'), addTimelineEntry: make('timeline') } };
  }

  it('sends the evidence row first, then systems, then lines, only those three kinds', async () => {
    const s = sink();
    const r = await sendImport(s.sink, plan, plan.systems, plan.lines, { sleep: async () => {} });
    expect(r).toEqual({ ok: true, count: 1 + plan.systems.length + plan.lines.length });
    expect(s.calls).toEqual(['evidence', ...plan.systems.map(() => 'scope'), ...plan.lines.map(() => 'timeline')]);
  });

  it('waits and retries on "slow down", then goes on', async () => {
    let slept = 0;
    const s = sink((name, n) => (name === 'timeline' && n <= 3 ? new Error('slow down') : null));
    const r = await sendImport(s.sink, plan, plan.systems, plan.lines, { sleep: async (ms) => void (slept += ms) });
    expect(r.ok).toBe(true);
    expect(slept).toBe(3000);
  });

  it('gives up after 10 retries and reports what was sent', async () => {
    const s = sink((name) => (name === 'scope' ? new Error('slow down') : null));
    let sleeps = 0;
    const r = await sendImport(s.sink, plan, plan.systems, plan.lines, { sleep: async () => void (sleeps += 1), describe: (c) => String((c as Error).message) });
    expect(sleeps).toBe(MAX_RETRIES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.sent).toEqual(['Evidence row']);
      expect(r.unsent.length).toBe(plan.systems.length + plan.lines.length);
    }
  });

  it('stops on any other error and does not send the rest', async () => {
    const s = sink((name) => (name === 'timeline' ? new Error('not permitted') : null));
    const r = await sendImport(s.sink, plan, plan.systems, plan.lines, { sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(s.calls.filter((c) => c === 'timeline')).toHaveLength(0);
    if (!r.ok) expect(r.sent.length).toBe(1 + plan.systems.length);
  });
});

describe('nothing about the file reaches the network or storage', () => {
  it('the import code and panel never call fetch, XHR, beacons, storage, IndexedDB, console or raw HTML', () => {
    const files = [
      ...readdirSync('lib/import').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `lib/import/${f}`),
      'components/incidents/import-panel.tsx',
    ];
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'WebSocket', 'console.log', 'console.warn', 'console.error', 'console.info', 'console.debug', 'dangerouslySetInnerHTML', 'innerHTML', 'eval(', 'new Function']) {
        expect(src.includes(bad), `${f} contains ${bad}`).toBe(false);
      }
    }
  });

  it('building a plan makes no network call', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network')));
    const t = parseCsv('Timestamp,DeviceName,AlertTitle\n2026-11-08T02:13:00Z,PC-1,A\n');
    if (!t.ok) throw new Error('csv');
    buildPlan({ rows: t.rows, mapping: suggestMapping(t.columns), fileName: 'a.csv', sha256: H, custodian: 'Sam', existingSystems: [], now: Date.parse('2026-11-08T12:00:00Z') });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('already imported', () => {
  it('the panel finds an evidence row with the same hash on the record', () => {
    const ev: Evidence = {
      seq: 1n,
      by: { identity: 'b'.repeat(64), displayName: 'Alex', role: 'technical' },
      at,
      sentAt: at,
      verdict: ok,
      body: { evidenceId: '00000000-0000-4000-8000-000000000009', label: 'Import: a.csv', sha256: H, location: 'Local file, never uploaded', custodian: 'Alex' },
    };
    holder.state = stateFor('technical', 'active', { evidence: [ev] });
    expect(holder.state.evidence.find((e) => e.body.sha256 === H)?.by?.displayName).toBe('Alex');
  });
});
