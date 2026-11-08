// The one fold for both clients (docs/PLAN.md 6.2). Pure: no clock, no I/O.
//
// Input events arrive in server order with verdicts attached by verify.ts (or
// built directly by the mock). Rules:
// - Folded #record state (title, status, timeline, scope, tasks, profile,
//   legal determinations, deadline updates, evidence) only takes events whose
//   verdict is ok. A forged or tampered event never changes what the room
//   believes; it is reported through the integrity report instead.
// - Chat messages keep failing events with their verdict so the UI can mark
//   them (nothing is silently dropped).
// - Events with no readable payload (missing keys) only set `waitingForKeys`.
// - Latest wins by id in seq order; history is kept.

import { CHANNELS, type ChannelKind } from '@/spacetimedb/src/shared/policy';
import {
  EMPTY_PROFILE,
  type ChannelMessage,
  type ChannelView,
  type DeadlineUpdate,
  type Evidence,
  type FoldedState,
  type MemberRef,
  type MemberView,
  type Provenance,
  type ScopeItem,
  type ScopeVersion,
  type Task,
  type TaskVersion,
  type TimelineItem,
  type VerifiedEvent,
} from './types';

const CHAT_CHANNELS: ChannelKind[] = CHANNELS.filter((c) => c !== 'record');

const bySeq = (a: VerifiedEvent, b: VerifiedEvent) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);

function prov(e: VerifiedEvent): Provenance {
  return { seq: e.seq, by: e.author, at: e.serverTs, sentAt: e.sentAt, verdict: e.verdict };
}

function refOf(e: VerifiedEvent): MemberRef | null {
  return e.author;
}

/**
 * @param readable channels the viewer can read; chat channel views are
 * produced for exactly these (an empty channel still gets a view).
 */
export function foldEvents(
  events: VerifiedEvent[],
  _roster: MemberView[],
  readable: readonly ChannelKind[] = CHANNELS,
): FoldedState {
  void _roster; // reserved: roster is already folded into `author` by the verifier
  let title: string | null = null;
  let status: FoldedState['status'] = null;
  let profile = EMPTY_PROFILE;
  let discovery: FoldedState['discovery'] = null;
  let materiality: FoldedState['materiality'] = null;
  const timeline: TimelineItem[] = [];
  const scope = new Map<string, ScopeItem>();
  const tasks = new Map<string, Task>();
  const deadlineUpdates: Record<string, DeadlineUpdate> = {};
  const evidence: Evidence[] = [];
  const chat = new Map<ChannelKind, ChannelMessage[]>();
  const waiting = new Set<ChannelKind>();

  const record = events.filter((e) => e.channel === 'record').sort(bySeq);
  for (const e of record) {
    if (!e.payload) {
      if (e.verdict.warnings.includes('waiting_for_keys')) waiting.add('record');
      continue;
    }
    if (!e.verdict.ok) continue;
    const p = e.payload;
    switch (p.kind) {
      case 'incident.title':
        title = p.body.title;
        break;
      case 'status.set': {
        const by = refOf(e);
        if (by) status = { severity: p.body.severity, phase: p.body.phase, summary: p.body.summary, at: e.serverTs, by };
        break;
      }
      case 'timeline.add':
        timeline.push({ ...prov(e), entry: p.body, amendedBy: [] });
        break;
      case 'scope.set': {
        const v: ScopeVersion = { ...prov(e), body: p.body };
        const cur = scope.get(p.body.itemId);
        if (cur) {
          cur.latest = p.body;
          cur.history.push(v);
        } else scope.set(p.body.itemId, { itemId: p.body.itemId, latest: p.body, history: [v] });
        break;
      }
      case 'task.set': {
        const v: TaskVersion = { ...prov(e), body: p.body };
        const cur = tasks.get(p.body.taskId);
        if (cur) {
          cur.latest = p.body;
          cur.history.push(v);
        } else tasks.set(p.body.taskId, { taskId: p.body.taskId, latest: p.body, history: [v] });
        break;
      }
      case 'profile.set':
        profile = p.body;
        break;
      case 'legal.discovery': {
        const by = refOf(e);
        if (by) discovery = { determinedAt: new Date(p.body.determinedAt), basis: p.body.basis, by };
        break;
      }
      case 'legal.materiality': {
        const by = refOf(e);
        if (by) materiality = { determinedAt: new Date(p.body.determinedAt), basis: p.body.basis, by };
        break;
      }
      case 'deadline.update':
        deadlineUpdates[p.body.ruleId] = { ...prov(e), body: p.body };
        break;
      case 'evidence.add':
        evidence.push({ ...prov(e), body: p.body });
        break;
      default:
        // roster.admit / roster.revoke are informational here; the roster comes from the member rows.
        break;
    }
  }

  // Amendments: link each timeline entry that names `amends` to its target. Entry ids are chosen
  // by the author, so the first entry by seq owns an id (timeline is in seq order here), and only
  // a later entry can amend an earlier one.
  const byEntry = new Map<string, TimelineItem>();
  for (const t of timeline) if (!byEntry.has(t.entry.entryId)) byEntry.set(t.entry.entryId, t);
  for (const t of timeline) {
    const target = t.entry.amends ? byEntry.get(t.entry.amends) : undefined;
    if (target && target !== t && target.seq < t.seq) target.amendedBy.push(t.entry.entryId);
  }
  timeline.sort((a, b) => {
    const d = new Date(a.entry.occurredAt).getTime() - new Date(b.entry.occurredAt).getTime();
    return d !== 0 ? d : a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
  });

  for (const c of CHAT_CHANNELS) chat.set(c, []);
  for (const e of events.filter((x) => x.channel !== 'record').sort(bySeq)) {
    if (!e.payload) {
      if (e.verdict.warnings.includes('waiting_for_keys')) waiting.add(e.channel);
      continue;
    }
    if (e.payload.kind !== 'chat.post') continue;
    const b = e.payload.body;
    chat.get(e.channel)?.push({
      seq: e.seq,
      messageId: b.messageId,
      author: e.author,
      sentAt: e.sentAt ?? e.serverTs,
      serverTs: e.serverTs,
      text: b.text,
      mentions: b.mentions,
      replyTo: b.replyTo,
      verdict: e.verdict,
    });
  }

  const channels: ChannelView[] = CHAT_CHANNELS.filter((c) => readable.includes(c)).map((kind) => ({
    kind,
    messages: chat.get(kind) ?? [],
    waitingForKeys: waiting.has(kind),
  }));

  return {
    title,
    status,
    channels,
    timeline,
    scope: [...scope.values()],
    tasks: [...tasks.values()],
    profile,
    discovery,
    materiality,
    deadlineUpdates,
    evidence,
  };
}
