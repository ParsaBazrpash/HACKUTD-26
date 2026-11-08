import { describe, expect, test } from "vitest";
import {
  BOARD_LIST_CAP,
  boardEntries,
  boardKind,
  boardText,
  ownerGroups,
  recordProblems,
  stripBoardPrefix,
} from "@/components/incidents/board";
import { foldEvents } from "@/lib/client/fold";
import type { Payload } from "@/lib/protocol/events";
import { createMockIncidentClient } from "@/lib/client/mock";
import type { MemberRef, Task, TimelineItem, VerifiedEvent } from "@/lib/client/types";

const COMMANDER = { identity: "c".repeat(64), displayName: "Avery", role: "commander" as const };
const TECH = { identity: "d".repeat(64), displayName: "Tom", role: "technical" as const };
const GOOD = { ok: true, failures: [], warnings: [] };

function item(
  text: string,
  extra: { by?: MemberRef; seq?: bigint; amends?: string; occurredAt?: string; id?: string } = {},
): TimelineItem {
  const occurredAt = extra.occurredAt ?? "2026-11-08T01:00:00.000Z";
  return {
    seq: extra.seq ?? 1n,
    by: extra.by ?? COMMANDER,
    at: new Date(occurredAt),
    sentAt: null,
    verdict: GOOD,
    entry: {
      entryId: extra.id ?? crypto.randomUUID(),
      occurredAt,
      phase: "containment",
      csf: "RS.CO",
      text,
      ...(extra.amends ? { amends: extra.amends } : {}),
    },
    amendedBy: [],
  };
}

function task(title: string, status: Task["latest"]["status"], assignee?: string): Task {
  return { taskId: crypto.randomUUID(), latest: { taskId: "x", title, status, ...(assignee ? { assignee } : {}) }, history: [] };
}

function event(seq: bigint, text: string, ok: boolean): VerifiedEvent {
  return {
    channel: "record",
    seq,
    eventId: crypto.randomUUID(),
    author: TECH,
    serverTs: new Date(Number(seq) * 1000),
    sentAt: null,
    payload: {
      kind: "timeline.add",
      body: { entryId: crypto.randomUUID(), occurredAt: "2026-11-08T01:00:00.000Z", phase: "containment", csf: "RS.CO", text },
    } as Payload,
    verdict: ok ? GOOD : { ok: false, failures: ["bad_signature"], warnings: [] },
  };
}

describe("board entries", () => {
  test("only exact prefixes count", () => {
    expect(boardKind("Decision: isolate the file server")).toBe("decision");
    expect(boardKind("Known: backups are offline")).toBe("known");
    expect(boardKind("decision: lower case")).toBeNull();
    expect(boardKind("We made a Decision: later")).toBeNull();
    expect(stripBoardPrefix(boardText("known", "  backups offline "))).toBe("backups offline");
  });

  test("a forged entry never reaches the board and the record warning counts it", () => {
    const folded = foldEvents([event(1n, "Decision: pay the ransom", false), event(2n, "Known: six servers", true)], []);
    const out = boardEntries(folded.timeline);
    expect(out.decisions).toHaveLength(0);
    expect(out.proposed).toHaveLength(0);
    expect(out.known.map((e) => e.item.entry.text)).toEqual(["Known: six servers"]);
    const integrity = {
      ok: false,
      checkedAt: new Date(0),
      channels: { record: { ok: false, eventsChecked: 2, failures: [{ seq: 1n, reason: "bad_signature" as const }], head: null, pinnedOk: true, waitingForKeys: false } },
      rosterFailures: [],
    };
    expect(recordProblems(integrity)).toBe(1);
    expect(recordProblems({ ...integrity, ok: true, channels: {} })).toBe(0);
  });

  test("an untagged amendment cannot erase a decision", () => {
    const decision = item("Decision: isolate the file server", { id: crypto.randomUUID(), seq: 1n });
    const sneaky = item("never mind", { by: TECH, seq: 2n, amends: decision.entry.entryId });
    const out = boardEntries([decision, sneaky]);
    expect(out.decisions.map((e) => e.item.entry.entryId)).toEqual([decision.entry.entryId]);
  });

  test("a reused entry id cannot erase a commander decision or borrow its standing", () => {
    const id = crypto.randomUUID();
    const decision = item("Decision: restore from offline backups", { id, seq: 1n });
    const decoy = item("Decision: decoy", { by: TECH, id, seq: 2n });
    const erase = item("Decision: pay the ransom", { by: TECH, seq: 3n, amends: id });
    const out = boardEntries([decision, decoy, erase]);
    expect(out.decisions.map((e) => e.item)).toEqual([decision]);
    expect(out.proposed.map((e) => e.item.entry.text)).toEqual(["Decision: pay the ransom", "Decision: decoy"]);
    // The proposal does not claim to replace anything, because the id belongs to the commander's entry.
    expect(out.proposed[0]?.replaces).toBeNull();
  });

  test("only a later entry can replace an earlier one", () => {
    const id = crypto.randomUUID();
    const early = item("Known: six servers", { by: TECH, seq: 1n, amends: id });
    const target = item("Known: four servers", { by: TECH, seq: 2n, id });
    const out = boardEntries([early, target]);
    expect(out.known.map((e) => e.item.entry.text).sort()).toEqual(["Known: four servers", "Known: six servers"]);
  });

  test("the fold links an amendment only to the first entry with that id", () => {
    const id = crypto.randomUUID();
    const body = (text: string, extra: Record<string, string> = {}) => ({
      kind: "timeline.add",
      body: { entryId: extra.entryId ?? crypto.randomUUID(), occurredAt: "2026-11-08T01:00:00.000Z", phase: "containment", csf: "RS.CO", text, ...(extra.amends ? { amends: extra.amends } : {}) },
    }) as Payload;
    const ev = (seq: bigint, payload: Payload): VerifiedEvent => ({ ...event(seq, "x", true), payload });
    const folded = foldEvents(
      [ev(1n, body("first", { entryId: id })), ev(2n, body("reuses the id", { entryId: id })), ev(3n, body("amends it", { amends: id }))],
      [],
    );
    const first = folded.timeline.find((t) => t.entry.text === "first");
    const reuse = folded.timeline.find((t) => t.entry.text === "reuses the id");
    expect(first?.amendedBy).toHaveLength(1);
    expect(reuse?.amendedBy).toHaveLength(0);
  });

  test("a same-kind tagged amendment replaces and says who it replaces", () => {
    const first = item("Known: five servers", { by: TECH, seq: 1n });
    const next = item("Known: six servers", { seq: 2n, amends: first.entry.entryId });
    const out = boardEntries([first, next]);
    expect(out.known).toHaveLength(1);
    expect(out.known[0]).toMatchObject({ replaces: "Tom" });
    expect(out.known[0]?.item.entry.text).toBe("Known: six servers");
  });

  test("only the commander decides, others are proposals and cannot replace a decision", () => {
    const decision = item("Decision: isolate", { seq: 1n });
    const hijack = item("Decision: pay", { by: TECH, seq: 2n, amends: decision.entry.entryId });
    const out = boardEntries([decision, hijack]);
    expect(out.decisions.map((e) => e.item.entry.text)).toEqual(["Decision: isolate"]);
    expect(out.proposed.map((e) => e.item.entry.text)).toEqual(["Decision: pay"]);
  });

  test("server order wins over author dates, and the cap is visible to the caller", () => {
    const real = item("Known: real", { seq: 100n, occurredAt: "2026-11-08T01:00:00.000Z" });
    const spam = Array.from({ length: 9 }, (_, i) =>
      item(`Known: spam ${i}`, { by: TECH, seq: BigInt(i + 1), occurredAt: "2030-01-01T00:00:00.000Z" }),
    );
    const out = boardEntries([...spam, real]);
    expect(out.known[0]?.item.entry.text).toBe("Known: real");
    expect(out.known.length).toBe(10);
    expect(out.known.length).toBeGreaterThan(BOARD_LIST_CAP);
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
      expect(out.decisions.map((e) => stripBoardPrefix(e.item.entry.text))).toContain("Take the file server offline");
    } finally {
      client.dispose();
    }
  });
});
