// What needs a person's attention right now, for the Overview list and the sidebar badges.
// Pure: it reads the folded state and the browser clock, and decides nothing about access.
// Every item is gated on what this member's role can see or act on.

import type { IncidentState } from "@/lib/client/types";
import { computeDeadlines } from "@/lib/legal";
import { formatLead, listIntegrityFindings } from "@/components/incidents/situation";
import type { SectionBadges } from "@/components/incidents/section-nav";

export type AttentionItem = {
  id: string;
  /** Section slug the item links to ("" is the Overview). */
  slug: "" | "tasks" | "legal" | "people" | "channels" | "timeline";
  tone: "alert" | "signal";
  title: string;
  detail: string;
};

export type Attention = { items: AttentionItem[]; badges: SectionBadges };

const MAX_TASKS_LISTED = 3;

export function attentionFor(state: IncidentState, now: number | null): Attention {
  const items: AttentionItem[] = [];
  const me = state.me;
  const commander = me?.role === "commander" && me.state === "active";

  if (!state.integrity.ok) {
    const finding = listIntegrityFindings(state.integrity)[0];
    items.push({
      id: "integrity",
      slug: finding?.kind === "event" ? "timeline" : "people",
      tone: "alert",
      title: "Integrity check failed",
      detail: "Treat new entries as unverified until this is explained.",
    });
  }

  const pending = commander ? state.members.filter((member) => member.state === "pending") : [];
  if (pending.length > 0) {
    items.push({
      id: "pending",
      slug: "people",
      tone: "signal",
      title: pending.length === 1 ? "1 person is waiting to be admitted" : `${pending.length} people are waiting to be admitted`,
      detail: "Compare the safety code with them before you admit.",
    });
  }

  const blocked = state.tasks.filter((task) => task.latest.status === "blocked");
  for (const task of blocked.slice(0, MAX_TASKS_LISTED)) {
    items.push({ id: `task-${task.taskId}`, slug: "tasks", tone: "alert", title: "Blocked task", detail: task.latest.title });
  }
  if (blocked.length > MAX_TASKS_LISTED) {
    items.push({
      id: "task-more",
      slug: "tasks",
      tone: "alert",
      title: `${blocked.length - MAX_TASKS_LISTED} more blocked tasks`,
      detail: "Open Tasks to see them all.",
    });
  }

  let legal = 0;
  if (now !== null) {
    for (const deadline of computeDeadlines(state, new Date(now))) {
      const mark = deadline.recorded?.status;
      if (mark === "done" || mark === "not_applicable") continue;
      if (deadline.clockStatus !== "elapsed" && deadline.clockStatus !== "due_soon") continue;
      legal += 1;
      const lead = deadline.dueAt ? formatLead(deadline.dueAt.getTime() - now) : "Due";
      items.push({
        id: `legal-${deadline.rule.id}`,
        slug: "legal",
        tone: deadline.clockStatus === "elapsed" ? "alert" : "signal",
        title: `${deadline.rule.name}: ${lead}`,
        detail: deadline.rule.citation,
      });
    }
  }

  const badges: SectionBadges = {};
  if (blocked.length > 0) badges.tasks = { count: blocked.length, tone: "alert" };
  if (pending.length > 0) badges.people = { count: pending.length, tone: "signal" };
  if (legal > 0) badges.legal = { count: legal, tone: items.some((i) => i.slug === "legal" && i.tone === "alert") ? "alert" : "signal" };

  return { items, badges };
}
