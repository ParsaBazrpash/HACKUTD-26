import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  canPage,
  latestPages,
  notInIncident,
  pageChip,
  pickCheck,
  reachability,
  showImHere,
} from "@/components/incidents/paging";
import { createMockIncidentClient } from "@/lib/client/mock";
import { PAGE_TIMELINE_MS } from "@/lib/client/mock-org";
import type { PageView, PageStatus, RosterMember } from "@/lib/client/types";

function page(status: PageStatus, extra: Partial<PageView> = {}): PageView {
  return {
    pageId: "p",
    orgMemberId: 1n,
    displayName: "Pat",
    role: "technical",
    status,
    carrierReported: true,
    joined: false,
    updatedAt: new Date(0),
    ...extra,
  };
}

function member(extra: Partial<RosterMember>): RosterMember {
  return {
    orgMemberId: 1n,
    identity: "aa",
    displayName: "Pat",
    state: "active",
    fingerprint: "f",
    safetyCode: "c",
    enrolledAt: new Date(0),
    approvedAt: new Date(0),
    keyChanged: false,
    ...extra,
  };
}

describe("page chips are honest", () => {
  test("acknowledged is carrier reported, never joined", () => {
    const chip = pageChip(page("acknowledged"));
    expect(chip.label).toBe("Acknowledged");
    expect(chip.hint).toBe("By phone, reported by the carrier.");
    expect(pageChip(page("acknowledged", { carrierReported: false })).hint).toContain("not yet confirmed");
  });
  test("joined only when a signed action arrived", () => {
    expect(pageChip(page("acknowledged")).label).not.toBe("Joined");
    expect(pageChip(page("acknowledged", { joined: true })).label).toBe("Joined");
  });
  test("retry only for no answer, busy and failed", () => {
    const retryable = (["requested", "calling", "ringing", "acknowledged", "no_answer", "busy", "failed"] as PageStatus[])
      .filter((s) => pageChip(page(s)).retry);
    expect(retryable).toEqual(["no_answer", "busy", "failed"]);
    expect(pageChip(page("no_answer", { joined: true })).retry).toBe(false);
  });
});

describe("picker rules", () => {
  test("pending, revoked and key-changed people cannot be picked", () => {
    expect(pickCheck(member({ state: "pending" }))).toMatchObject({ pickable: false });
    expect(pickCheck(member({ state: "revoked" }))).toMatchObject({ pickable: false });
    expect(pickCheck(member({ keyChanged: true }))).toMatchObject({ pickable: false });
    expect(pickCheck(member({}))).toEqual({ pickable: true });
  });
  test("people already in the room are not offered", () => {
    const roster = [member({ identity: "aa" }), member({ orgMemberId: 2n, identity: "bb" })];
    expect(notInIncident(roster, new Set(["aa"])).map((m) => m.identity)).toEqual(["bb"]);
  });
  test("reachability counts the latest page once", () => {
    const pages = [
      page("no_answer", { updatedAt: new Date(1) }),
      page("acknowledged", { updatedAt: new Date(2) }),
      page("acknowledged", { orgMemberId: 2n, displayName: "Sam", joined: true }),
    ];
    expect(latestPages(pages)).toHaveLength(2);
    expect(reachability(pages)).toMatchObject({ paged: 2, acknowledged: 1, joined: 1, joinedNames: ["Sam"] });
  });
});

describe("on the mock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T20:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  function make(viewer?: "commander" | "technical") {
    return createMockIncidentClient({ origin: "http://localhost:3001", ledger: null, session: null, seedOrg: true, viewer, now: () => Date.now() });
  }

  test("commander can page, a member cannot", () => {
    const c = make();
    const m = make("technical");
    try {
      expect(canPage(c.getState())).toBe(true);
      expect(canPage(m.getState())).toBe(false);
      expect(m.getState().roster).toHaveLength(0);
    } finally {
      c.dispose();
      m.dispose();
    }
  });

  test("pick, page, ring, join, then retry the one who did not answer", async () => {
    const client = make();
    try {
      const s0 = client.getState();
      const candidates = notInIncident(s0.roster, new Set(s0.members.map((x) => x.identity)));
      const pickable = candidates.filter((m) => pickCheck(m).pickable);
      expect(candidates.length).toBeGreaterThan(pickable.length);
      expect(pickable.length).toBeGreaterThanOrEqual(3);
      const ids = pickable.slice(0, 3).map((m) => m.orgMemberId);
      await client.addFromRoster(ids.map((orgMemberId) => ({ orgMemberId, role: "technical" as const })));
      await client.page(ids);
      expect(reachability(client.getState().pages)).toMatchObject({ paged: 3, joined: 0 });
      await vi.advanceTimersByTimeAsync(PAGE_TIMELINE_MS.noAnswer);
      const after = client.getState().pages;
      const failed = latestPages(after).filter((p) => pageChip(p).retry);
      for (const p of failed) await client.page([p.orgMemberId]);
      await vi.advanceTimersByTimeAsync(PAGE_TIMELINE_MS.joined);
      const end = reachability(client.getState().pages);
      expect(end.joined).toBe(3);
      expect(client.getState().pages.every((p) => pageChip(p).label === "Joined")).toBe(true);
    } finally {
      client.dispose();
    }
  });

  test("I'm here shows for a roster member until they post", async () => {
    const client = make();
    try {
      const s = client.getState();
      const target = s.roster.find((m) => m.displayName === "Morgan Diaz");
      if (!target) throw new Error("fixture changed");
      expect(showImHere(s)).toBe(false);
      await client.addFromRoster([{ orgMemberId: target.orgMemberId, role: "technical" }]);
    } finally {
      client.dispose();
    }
    const member = createMockIncidentClient({
      origin: "http://localhost:3001",
      ledger: null,
      session: null,
      seedOrg: true,
      viewer: "technical",
      now: () => Date.now(),
    });
    try {
      const s = member.getState();
      expect(s.me?.role).toBe("technical");
      expect(showImHere({ ...s, channels: [], timeline: [] })).toBe(true);
      await member.announcePresence();
      expect(showImHere(member.getState())).toBe(false);
    } finally {
      member.dispose();
    }
  });
});
