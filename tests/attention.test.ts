import { describe, expect, test } from "vitest";
import { attentionFor } from "@/components/incidents/attention";
import { createMockIncidentClient } from "@/lib/client/mock";
import type { IncidentState } from "@/lib/client/types";

function demoState(): IncidentState {
  const client = createMockIncidentClient({ origin: "http://localhost:3001", ledger: null, session: null, now: () => Date.now() });
  return client.getState();
}

function asRole(state: IncidentState, role: "commander" | "counsel" | "technical" | "executive"): IncidentState {
  if (!state.me) throw new Error("demo state has no member");
  return { ...state, me: { ...state.me, role } };
}

describe("needs attention", () => {
  test("the commander sees people waiting to be admitted and a People badge", () => {
    const state = demoState();
    expect(state.members.some((member) => member.state === "pending")).toBe(true);
    const { items, badges } = attentionFor(asRole(state, "commander"), Date.now());
    expect(items.some((item) => item.id === "pending")).toBe(true);
    expect(badges.people?.count).toBeGreaterThan(0);
  });

  test("no other role is told about pending admissions", () => {
    const state = demoState();
    for (const role of ["counsel", "technical", "executive"] as const) {
      const { items, badges } = attentionFor(asRole(state, role), Date.now());
      expect(items.some((item) => item.id === "pending")).toBe(false);
      expect(badges.people).toBeUndefined();
    }
  });

  test("a pending or revoked commander gets no admission prompt", () => {
    const state = demoState();
    if (!state.me) throw new Error("demo state has no member");
    for (const memberState of ["pending", "revoked"] as const) {
      const out = attentionFor({ ...state, me: { ...state.me, role: "commander", state: memberState } }, Date.now());
      expect(out.items.some((item) => item.id === "pending")).toBe(false);
    }
  });

  test("blocked tasks are listed and counted on the Tasks badge", () => {
    const state = demoState();
    const blocked = state.tasks.filter((task) => task.latest.status === "blocked").length;
    const { items, badges } = attentionFor(state, Date.now());
    expect(items.filter((item) => item.slug === "tasks").length).toBe(Math.min(blocked, 3) + (blocked > 3 ? 1 : 0));
    expect(badges.tasks?.count ?? 0).toBe(blocked);
  });

  test("a failed integrity check comes first", () => {
    const state = demoState();
    const failed: IncidentState = { ...state, integrity: { ...state.integrity, ok: false } };
    expect(attentionFor(failed, Date.now()).items[0]?.id).toBe("integrity");
  });

  test("without a browser clock no deadline is guessed", () => {
    const { items } = attentionFor(demoState(), null);
    expect(items.some((item) => item.slug === "legal")).toBe(false);
  });
});
