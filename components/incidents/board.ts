// Pure rules for the status board. The board adds no new event kind: it reads
// verified #record entries (timeline.add) and tasks, so everything on it is
// encrypted, signed and hash chained like the rest of the room.

import type { Task, TimelineItem } from "@/lib/client/types";

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

export type BoardEntries = {
  decisions: TimelineItem[];
  known: TimelineItem[];
  /** Tagged entries that failed verification. They are counted, never shown as fact. */
  unverified: number;
};

/** Newest first. Entries that a later entry amends are left out in favor of the amendment. */
export function boardEntries(timeline: readonly TimelineItem[]): BoardEntries {
  const out: BoardEntries = { decisions: [], known: [], unverified: 0 };
  const sorted = [...timeline].sort(
    (a, b) => new Date(b.entry.occurredAt).getTime() - new Date(a.entry.occurredAt).getTime(),
  );
  for (const item of sorted) {
    const kind = boardKind(item.entry.text);
    if (!kind) continue;
    if (!item.verdict.ok) {
      out.unverified += 1;
      continue;
    }
    if (item.amendedBy.length > 0) continue;
    (kind === "decision" ? out.decisions : out.known).push(item);
  }
  return out;
}

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
