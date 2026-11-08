import { describe, expect, test } from "vitest";
import { boardEntries, boardKind, boardText, ownerGroups, stripBoardPrefix } from "@/components/incidents/board";
import { createMockIncidentClient } from "@/lib/client/mock";
import type { Task, TimelineItem } from "@/lib/client/types";

function item(text: string, extra: Partial<TimelineItem> = {}, at = "2026-11-08T01:00:00.000Z"): TimelineItem {
  return {
    seq: 1n,
    by: null,
    at: new Date(at),
    sentAt: null,
    verdict: { ok: true, failures: [], warnings: [] },
    entry: { entryId: crypto.randomUUID(), occurredAt: at, phase: "containment", csf: "RS.CO", text },
    amendedBy: [],
    ...extra,
  };
}

function task(title: string, status: Task["latest"]["status"], assignee?: string): Task {
  return { taskId: crypto.randomUUID(), latest: { taskId: "x", title, status, ...(assignee ? { assignee } : {}) }, history: [] };
}

describe("board entries", () => {
  test("only exact prefixes count", () => {
    expect(boardKind("Decision: isolate the file server")).toBe("decision");
    expect(boardKind("Known: backups are offline")).toBe("known");
    expect(boardKind("decision: lower case")).toBeNull();
    expect(boardKind("We made a Decision: later")).toBeNull();
    expect(stripBoardPrefix(boardText("known", "  backups offline "))).toBe("backups offline");
  });

  test("failed verification is hidden and counted, amended entries are replaced", () => {
    const bad = item("Decision: pay now", { verdict: { ok: false, failures: ["bad_signature"], warnings: [] } });
    const old = item("Known: five servers", { amendedBy: ["x"] });
    const fresh = item("Known: six servers", {}, "2026-11-08T02:00:00.000Z");
    const plain = item("just a note");
    const out = boardEntries([bad, old, fresh, plain]);
    expect(out.decisions).toHaveLength(0);
    expect(out.unverified).toBe(1);
    expect(out.known.map((i) => i.entry.text)).toEqual(["Known: six servers"]);
  });

  test("newest first", () => {
    const a = item("Known: a", {}, "2026-11-08T01:00:00.000Z");
    const b = item("Known: b", {}, "2026-11-08T03:00:00.000Z");
    expect(boardEntries([a, b]).known.map((i) => i.entry.text)).toEqual(["Known: b", "Known: a"]);
  });
});

describe("owners", () => {
  test("unassigned first, done work left out", () => {
    const groups = ownerGroups([task("a", "open", "aa"), task("b", "blocked"), task("c", "done", "aa"), task("d", "open", "aa")]);
    expect(groups.map((g) => g.identity)).toEqual([null, "aa"]);
    expect(groups[1]?.open).toHaveLength(2);
  });
});

describe("on the mock", () => {
  test("a recorded fact and decision land on the board through the signed timeline", async () => {
    const client = createMockIncidentClient({ origin: "http://localhost:3001", ledger: null, session: null, now: () => Date.now() });
    try {
      await client.addTimelineEntry({
        occurredAt: new Date().toISOString(),
        phase: "containment",
        csf: "RS.CO",
        text: boardText("decision", "Take the file server offline"),
      });
      const out = boardEntries(client.getState().timeline);
      expect(out.decisions.map((i) => stripBoardPrefix(i.entry.text))).toContain("Take the file server offline");
    } finally {
      client.dispose();
    }
  });
});
