// Milestone M0: the org roster and phone paging story, end to end, in the mock.
//
// Run `ZH_SCENARIO_LOG=1 npx vitest run tests/roster-scenario.test.ts` to print
// a readable transcript. Everything is demo data: no phone is called.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryLedger, createMemorySession } from "@/lib/client/demo-ledger";
import { createMockIncidentClient } from "@/lib/client/mock";
import { MAX_OPEN_ENROLL_LINKS, PAGE_TIMELINE_MS } from "@/lib/client/mock-org";
import type { IncidentClient, IncidentState, PageView, RosterMember } from "@/lib/client/types";
import { ORG_DEMO_LABEL } from "@/lib/scenario/org";

const LOG = process.env.ZH_SCENARIO_LOG === "1";
const ORIGIN = "http://localhost:3001";
const PHONE = "+15555550123";
const lines: string[] = [];

function say(line: string): void {
  lines.push(line);
  if (LOG) process.stdout.write(`${line}\n`);
}

function make(seedOrg: boolean) {
  return createMockIncidentClient({
    origin: ORIGIN,
    ledger: null,
    session: null,
    seedOrg,
    now: () => Date.now(),
  });
}

function person(state: IncidentState, name: string): RosterMember {
  const found = state.roster.find((m) => m.displayName === name);
  if (!found) throw new Error(`${name} is not on the roster`);
  return found;
}

function pageOf(state: IncidentState, name: string): PageView {
  const found = state.pages.find((p) => p.displayName === name);
  if (!found) throw new Error(`${name} has no page`);
  return found;
}

function render(state: IncidentState, names: string[]): string {
  return names
    .map((name) => {
      const p = pageOf(state, name);
      const flag = p.carrierReported ? "carrier" : "pending";
      return `${name}: ${p.status} (${flag})${p.joined ? ", joined" : ""}`;
    })
    .join(" | ");
}

async function ms(n: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(n);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T20:00:00.000Z"));
  lines.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("M0: org roster and paging in the mock", () => {
  test("create an org, enroll, approve, add three people, page, retry, revoke", async () => {
    say("== HAVEN org roster and paging (mock) ==");
    say(`   ${ORG_DEMO_LABEL}`);
    const client = make(false);
    try {
      await ms(0);
      expect(client.getState().org).toBeNull();

      // 1. Create the org.
      const created = await client.createOrg({ name: "Lakeside Family Clinic", displayName: "Avery Chen", phone: PHONE });
      let s = client.getState();
      expect(created.orgId).toBe(s.org?.orgId);
      expect(s.org).toMatchObject({ name: "Lakeside Family Clinic", myRole: "admin" });
      expect(s.roster).toHaveLength(1);
      say(`1. Org created: ${s.org?.name}, admin Avery Chen, fingerprint ${s.org?.adminFingerprint} (demo stand-in)`);

      // 2. Enrollment link and enrolment through the link.
      const link = await client.createEnrollLink({ ttlHours: 4 });
      expect(link.url.startsWith(`${ORIGIN}/enroll#`)).toBe(true);
      const fragment = link.url.slice(link.url.indexOf("#"));
      say("2. Enrollment link made (valid 4 hours, demo token)");
      const { safetyCode } = await client.enroll({ fragment, displayName: "Casey Brooks", phone: PHONE });
      s = client.getState();
      const casey = person(s, "Casey Brooks");
      expect(casey.state).toBe("pending");
      expect(casey.safetyCode).toBe(safetyCode);
      say(`   Casey Brooks enrolled from a phone, pending. Safety code ${safetyCode} (demo stand-in)`);

      // 3. Approve after the safety code is read aloud.
      await client.approveMember(casey.orgMemberId);
      expect(person(client.getState(), "Casey Brooks")).toMatchObject({ state: "active" });
      say("3. Admin read the code back on a call and approved Casey Brooks: active");
      // No phone number is kept anywhere in the state.
      expect(JSON.stringify(client.getState(), (_, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("5555550123");
    } finally {
      client.dispose();
    }
  });

  test("seeded Lakeside clinic: add three from the roster, page, no answer, retry, revoke", async () => {
    const client = make(true);
    try {
      let s = client.getState();
      expect(s.org).toMatchObject({ name: "Lakeside Family Clinic", myRole: "admin" });
      const names = s.roster.map((m) => `${m.displayName} (${m.state})`);
      say("");
      say("== Seeded Lakeside Family Clinic ==");
      say(`   Roster: ${names.join(", ")}`);
      expect(s.roster.map((m) => m.state).filter((x) => x === "pending")).toHaveLength(1);
      expect(person(s, "Taylor Nguyen").state).toBe("revoked");
      expect(person(s, "Casey Brooks")).toMatchObject({ state: "pending" });
      expect(person(s, "Casey Brooks").safetyCode).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
      const before = s.members.length;

      // 4. Add three people from the roster.
      const morgan = person(s, "Morgan Diaz");
      const priya = person(s, "Priya Shah");
      const lee = person(s, "Lee Carter");
      await client.addFromRoster([
        { orgMemberId: morgan.orgMemberId, role: "technical" },
        { orgMemberId: priya.orgMemberId, role: "executive" },
        { orgMemberId: lee.orgMemberId, role: "technical" },
      ]);
      s = client.getState();
      expect(s.members.length).toBe(before + 3);
      for (const name of ["Morgan Diaz", "Priya Shah", "Lee Carter"]) {
        expect(s.members.find((m) => m.displayName === name)).toMatchObject({ state: "active" });
      }
      say("4. Added to the incident from the roster: Morgan Diaz (technical), Priya Shah (executive), Lee Carter (technical)");

      // 5. Page the three.
      const { pageId } = await client.page([morgan.orgMemberId, priya.orgMemberId, lee.orgMemberId]);
      const trio = ["Morgan Diaz", "Priya Shah", "Lee Carter"];
      s = client.getState();
      expect(s.pages).toHaveLength(3);
      for (const p of s.pages) {
        expect(p.pageId).toBe(pageId);
        expect(p).toMatchObject({ status: "requested", carrierReported: false, joined: false });
      }
      say("5. Page sent (simulated, no real call)");
      say(`   t+0.0s  ${render(s, trio)}`);

      await ms(PAGE_TIMELINE_MS.calling);
      s = client.getState();
      for (const n of trio) expect(pageOf(s, n).status).toBe("calling");
      say(`   t+0.5s  ${render(s, trio)}`);

      await ms(PAGE_TIMELINE_MS.ringing - PAGE_TIMELINE_MS.calling);
      s = client.getState();
      for (const n of trio) expect(pageOf(s, n).status).toBe("ringing");
      say(`   t+1.5s  ${render(s, trio)}`);

      await ms(PAGE_TIMELINE_MS.acknowledged - PAGE_TIMELINE_MS.ringing);
      s = client.getState();
      for (const n of ["Morgan Diaz", "Priya Shah"]) {
        expect(pageOf(s, n)).toMatchObject({ status: "acknowledged", carrierReported: true, joined: false });
      }
      expect(pageOf(s, "Lee Carter").status).toBe("ringing");
      say(`   t+4.0s  ${render(s, trio)}`);

      await ms(PAGE_TIMELINE_MS.joined - PAGE_TIMELINE_MS.acknowledged);
      s = client.getState();
      for (const n of ["Morgan Diaz", "Priya Shah"]) expect(pageOf(s, n).joined).toBe(true);
      expect(pageOf(s, "Lee Carter").joined).toBe(false);
      const heres = s.channels
        .find((c) => c.kind === "command")
        ?.messages.filter((m) => m.text === "I'm here.") ?? [];
      expect(heres.map((m) => m.author?.displayName).sort()).toEqual(["Morgan Diaz", "Priya Shah"]);
      say(`   t+7.0s  ${render(s, trio)}`);
      say('   Morgan Diaz and Priya Shah posted "I\'m here." in the command channel');

      // Lee Carter never answers.
      await ms(PAGE_TIMELINE_MS.noAnswer - PAGE_TIMELINE_MS.joined);
      s = client.getState();
      expect(pageOf(s, "Lee Carter")).toMatchObject({ status: "no_answer", carrierReported: true, joined: false });
      say(`   t+20.0s ${render(s, ["Lee Carter"])}`);

      // 6. Retry: page Lee again.
      const retry = await client.page([lee.orgMemberId]);
      expect(retry.pageId).not.toBe(pageId);
      s = client.getState();
      expect(pageOf(s, "Lee Carter")).toMatchObject({ pageId: retry.pageId, status: "requested", joined: false });
      say("6. Retry: the admin pages Lee Carter again");
      await ms(PAGE_TIMELINE_MS.joined);
      s = client.getState();
      expect(pageOf(s, "Lee Carter")).toMatchObject({ status: "acknowledged", carrierReported: true, joined: true });
      // The first page's other rows were not touched.
      expect(pageOf(s, "Morgan Diaz").pageId).toBe(pageId);
      say(`   +7.0s   ${render(s, ["Lee Carter"])}`);
      const leeHeres = s.channels
        .find((c) => c.kind === "command")
        ?.messages.filter((m) => m.text === "I'm here." && m.author?.displayName === "Lee Carter");
      expect(leeHeres).toHaveLength(1);

      // 7. Revoke Taylor Nguyen's lost phone (already revoked in the seed): a second revoke is refused.
      const taylor = person(s, "Taylor Nguyen");
      expect(taylor.state).toBe("revoked");
      await expect(client.revokeOrgMember(taylor.orgMemberId, "lost phone")).rejects.toThrow("already revoked");
      // Revoke Morgan Diaz as a second lost phone: leaves the incident and the roster.
      await client.revokeOrgMember(morgan.orgMemberId, "Lost phone, reported at 21:40.");
      s = client.getState();
      expect(person(s, "Morgan Diaz").state).toBe("revoked");
      expect(s.members.find((m) => m.displayName === "Morgan Diaz")?.state).toBe("revoked");
      expect(s.pages.some((p) => p.displayName === "Morgan Diaz")).toBe(false);
      await expect(client.page([morgan.orgMemberId])).rejects.toThrow("not an approved org member");
      await expect(
        client.addFromRoster([{ orgMemberId: taylor.orgMemberId, role: "technical" }]),
      ).rejects.toThrow("not an approved org member");
      say("7. Taylor Nguyen (lost phone) is revoked: cannot be added or paged. Morgan Diaz revoked too, page dropped.");
      say("== end ==");
    } finally {
      client.dispose();
    }
  });
});

describe("mock org: refusals", () => {
  async function seeded(): Promise<IncidentClient & { dispose(): void }> {
    return make(true);
  }

  test("a non-admin viewer cannot run org actions and sees no roster", async () => {
    const client = createMockIncidentClient({
      origin: ORIGIN,
      ledger: createMemoryLedger(),
      session: createMemorySession(),
      viewer: "technical",
    });
    try {
      const s = client.getState();
      expect(s.org?.myRole).toBe("member");
      expect(s.roster).toEqual([]);
      expect(s.pages).toEqual([]);
      await expect(client.createEnrollLink({ ttlHours: 1 })).rejects.toThrow("Only the org admin");
      await expect(client.approveMember(8n)).rejects.toThrow("Only the org admin");
      await expect(client.page([5n])).rejects.toThrow("Only the org admin");
      await expect(client.addFromRoster([{ orgMemberId: 5n, role: "technical" }])).rejects.toThrow("Only the org admin");
      await expect(client.revokeOrgMember(5n, "x")).rejects.toThrow("Only the org admin");
    } finally {
      client.dispose();
    }
  });

  test("createOrg refuses a second org, a bad phone and a bad name", async () => {
    const withOrg = await seeded();
    await expect(withOrg.createOrg({ name: "Other", displayName: "Avery Chen", phone: PHONE })).rejects.toThrow("already has an org");
    withOrg.dispose();
    const blank = make(false);
    await expect(blank.createOrg({ name: "Clinic", displayName: "Avery Chen", phone: "555-0123" })).rejects.toThrow("international format");
    await expect(blank.createOrg({ name: "Clinic", displayName: "Avery Chen", phone: "+0555555012" })).rejects.toThrow("international format");
    await expect(blank.createOrg({ name: "   ", displayName: "Avery Chen", phone: PHONE })).rejects.toThrow("org name");
    expect(blank.getState().org).toBeNull();
    blank.dispose();
  });

  test("enrollment refuses live, forged, expired and malformed links, bad phones and duplicate names", async () => {
    const client = make(true);
    try {
      await expect(client.createEnrollLink({ ttlHours: 0 })).rejects.toThrow("1 to 24 hours");
      await expect(client.createEnrollLink({ ttlHours: 25 })).rejects.toThrow("1 to 24 hours");
      await expect(client.createEnrollLink({ ttlHours: 1.5 })).rejects.toThrow("1 to 24 hours");
      const link = await client.createEnrollLink({ ttlHours: 1 });
      const fragment = link.url.slice(link.url.indexOf("#"));
      const orgId = client.getState().org?.orgId ?? "";

      await expect(client.enroll({ fragment: "#c=abc&s=def", displayName: "Jules Park", phone: PHONE })).rejects.toThrow("live enrollment");
      await expect(client.enroll({ fragment: "", displayName: "Jules Park", phone: PHONE })).rejects.toThrow("not valid");
      await expect(
        client.enroll({ fragment: `#demo=1&o=${orgId}&t=0000000000000000`, displayName: "Jules Park", phone: PHONE }),
      ).rejects.toThrow("not valid");
      await expect(
        client.enroll({ fragment: `#demo=1&o=00000000-0000-4000-8000-00000000beef&t=abc`, displayName: "Jules Park", phone: PHONE }),
      ).rejects.toThrow("not for an org in this browser");
      await expect(client.enroll({ fragment, displayName: "Jules Park", phone: "not a phone" })).rejects.toThrow("international format");
      await expect(client.enroll({ fragment, displayName: "CASEY BROOKS", phone: PHONE })).rejects.toThrow("already in use");
      await expect(client.enroll({ fragment, displayName: "", phone: PHONE })).rejects.toThrow("display name");
      expect(client.getState().roster).toHaveLength(11);

      vi.setSystemTime(Date.now() + 2 * 3_600_000);
      await expect(client.enroll({ fragment, displayName: "Jules Park", phone: PHONE })).rejects.toThrow("expired");
      expect(client.getState().roster).toHaveLength(11);
    } finally {
      client.dispose();
    }
  });

  test("open enrollment links are capped", async () => {
    const client = make(true);
    try {
      for (let i = 0; i < MAX_OPEN_ENROLL_LINKS; i += 1) await client.createEnrollLink({ ttlHours: 1 });
      await expect(client.createEnrollLink({ ttlHours: 1 })).rejects.toThrow("Too many");
    } finally {
      client.dispose();
    }
  });

  test("approve, revoke, add and page validate their targets", async () => {
    const client = make(true);
    try {
      const s = client.getState();
      const avery = person(s, "Avery Chen");
      const jordan = person(s, "Jordan Hale");
      const casey = person(s, "Casey Brooks");
      const morgan = person(s, "Morgan Diaz");
      await expect(client.approveMember(jordan.orgMemberId)).rejects.toThrow("not waiting");
      await expect(client.approveMember(999n)).rejects.toThrow("not on this org's roster");
      await expect(client.revokeOrgMember(avery.orgMemberId, "x")).rejects.toThrow("admin cannot be revoked");
      await expect(client.revokeOrgMember(jordan.orgMemberId, "x".repeat(201))).rejects.toThrow("200 characters");
      await expect(client.revokeOrgMember(999n, "x")).rejects.toThrow("not on this org's roster");
      await expect(client.addFromRoster([])).rejects.toThrow("at least one");
      await expect(client.addFromRoster([{ orgMemberId: casey.orgMemberId, role: "technical" }])).rejects.toThrow("not an approved");
      await expect(
        client.addFromRoster([{ orgMemberId: morgan.orgMemberId, role: "commander" as unknown as "technical" }]),
      ).rejects.toThrow("cannot be added");
      await expect(
        client.addFromRoster([
          { orgMemberId: morgan.orgMemberId, role: "technical" },
          { orgMemberId: morgan.orgMemberId, role: "technical" },
        ]),
      ).rejects.toThrow("once");
      // Nothing was added by the failed calls.
      expect(client.getState().members.some((m) => m.displayName === "Morgan Diaz")).toBe(false);
      // Paging needs an incident member and an approved person.
      await expect(client.page([morgan.orgMemberId])).rejects.toThrow("not in the incident yet");
      await expect(client.page([casey.orgMemberId])).rejects.toThrow("not an approved");
      await expect(client.page([])).rejects.toThrow("at least one");
      await expect(client.page([jordan.orgMemberId, jordan.orgMemberId])).rejects.toThrow("once");
      const nine = Array.from({ length: 9 }, (_, i) => BigInt(i + 1));
      await expect(client.page(nine)).rejects.toThrow("at most 8");
      expect(client.getState().pages).toEqual([]);
    } finally {
      client.dispose();
    }
  });

  test("dispose clears pending timers", async () => {
    const client = make(true);
    const jordan = person(client.getState(), "Jordan Hale");
    await client.page([jordan.orgMemberId]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await ms(30_000);
  });

  test("each client gets fresh fixtures", async () => {
    const a = make(true);
    const b = make(true);
    try {
      const casey = person(a.getState(), "Casey Brooks");
      await a.approveMember(casey.orgMemberId);
      expect(person(a.getState(), "Casey Brooks").state).toBe("active");
      expect(person(b.getState(), "Casey Brooks").state).toBe("pending");
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
