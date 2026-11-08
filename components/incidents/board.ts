// Pure rules for the status board. The board adds no new event kind: it reads
// verified #record entries (timeline.add) and tasks, so everything on it is
// encrypted, signed and hash chained like the rest of the room.

import type { IntegrityReport, Task, TimelineItem } from "@/lib/client/types";

export const BOARD_PREFIXES = { decision: "Decision: ", known: "Known: " } as const;
export type BoardKind = keyof typeof BOARD_PREFIXES;

export function boardKind(text: string): BoardKind | null {
  if (text.startsWith(BOARD_PREFIXES.decision)) return "decision";
  if (text.startsWith(BOARD_PREFIXES.known)) return "known";
  return null;
}

export function boardText(kind: BoardKind, text: string): string {
  return `${BOARD_PREFIXES[kind]}${text.trim()}`;
}

export function stripBoardPrefix(text: string): string {
  const kind = boardKind(text);
  return kind ? text.slice(BOARD_PREFIXES[kind].length) : text;
}

export type BoardEntry = {
  item: TimelineItem;
  /** Author of the earlier entry this one replaces, when it replaces one. */
  replaces: string | null;
};

export type BoardEntries = {
  /** Decisions by the commander only. */
  decisions: BoardEntry[];
  /** "Decision: " lines from anyone else. They are proposals until the commander records them. */
  proposed: BoardEntry[];
  known: BoardEntry[];
};

const isCommander = (item: TimelineItem) => item.by?.role === "commander";

/** True when `amender` may replace `target` on the board. Only a later entry replaces an earlier one. */
function replaces(amender: TimelineItem, target: TimelineItem): boolean {
  if (target === amender || target.seq >= amender.seq) return false;
  const kind = boardKind(amender.entry.text);
  if (!kind || kind !== boardKind(target.entry.text)) return false;
  // Nobody but the commander replaces a commander decision.
  return kind !== "decision" || !isCommander(target) || isCommander(amender);
}

/**
 * Entry ids are chosen by the author and nothing makes them unique, so the first entry by server
 * order (seq) owns an id. A later entry that reuses the id can never be the target of an amendment.
 */
export function entryOwners(timeline: readonly TimelineItem[]): Map<string, TimelineItem> {
  const owners = new Map<string, TimelineItem>();
  const bySeq = [...timeline].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  for (const item of bySeq) if (!owners.has(item.entry.entryId)) owners.set(item.entry.entryId, item);
  return owners;
}

/**
 * Newest first by server order (seq), never by the author-chosen date. An entry is hidden only
 * when a later entry of the same board kind amends it, so an untagged amendment cannot erase it.
 * foldEvents already drops events that failed verification, so none reach this function.
 * Replaced entries are tracked as items, not ids, so reusing an id cannot hide another entry.
 */
export function boardEntries(timeline: readonly TimelineItem[]): BoardEntries {
  const out: BoardEntries = { decisions: [], proposed: [], known: [] };
  const byId = entryOwners(timeline);
  const sorted = [...timeline].sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0));
  const replaced = new Set<TimelineItem>();
  for (const item of sorted) {
    const amends = item.entry.amends ? byId.get(item.entry.amends) : undefined;
    if (amends && replaces(item, amends)) replaced.add(amends);
  }
  for (const item of sorted) {
    const kind = boardKind(item.entry.text);
    if (!kind || replaced.has(item)) continue;
    const amends = item.entry.amends ? byId.get(item.entry.amends) : undefined;
    const earlier = amends && replaces(item, amends) ? (amends.by?.displayName ?? "an unknown member") : null;
    const list = kind === "known" ? out.known : isCommander(item) ? out.decisions : out.proposed;
    list.push({ item, replaces: earlier });
  }
  return out;
}

/** Number of problems found on #record. The board counts these because hidden entries are not in state. */
export function recordProblems(integrity: IntegrityReport): number {
  const record = integrity.channels.record;
  if (!record) return 0;
  return record.failures.length > 0 ? record.failures.length : record.ok ? 0 : 1;
}

export const BOARD_LIST_CAP = 8;

export type OwnerGroup = { identity: string | null; open: Task[]; };

/** Open work (not done) grouped by owner. Unassigned work comes first so it is not missed. */
export function ownerGroups(tasks: readonly Task[]): OwnerGroup[] {
  const groups = new Map<string | null, Task[]>();
  for (const task of tasks) {
    if (task.latest.status === "done") continue;
    const key = task.latest.assignee ?? null;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()]
    .map(([identity, open]) => ({ identity, open }))
    .sort((a, b) => (a.identity === null ? -1 : b.identity === null ? 1 : b.open.length - a.open.length));
}
