import { describe, expect, test } from "vitest";
import {
  deadlineOwners,
  draftDeadlineMark,
  draftDetermination,
  parseLocalInput,
  toLocalSecondsValue,
} from "@/components/incidents/legal-inputs";
import type { MemberView } from "@/lib/client/types";

const NOW = new Date(2026, 10, 8, 9, 30, 0).getTime();
const BASIS = "Ransom note found, and logs confirm attacker access.";

function member(identity: string, role: MemberView["role"], memberState: MemberView["state"] = "active"): MemberView {
  return {
    identity,
    displayName: identity.slice(0, 4),
    role,
    memberId: 1n,
    state: memberState,
    fingerprint: "",
    verified: true,
  } as MemberView;
}

describe("legal inputs", () => {
  test("local values keep seconds and round-trip", () => {
    const at = new Date(2026, 10, 8, 2, 13, 45);
    const value = toLocalSecondsValue(at);
    expect(value).toBe("2026-11-08T02:13:45");
    expect(parseLocalInput(value)?.getTime()).toBe(at.getTime());
    expect(parseLocalInput("2026-11-08T02:13")?.getSeconds()).toBe(0);
  });

  test("impossible dates and loose text are refused", () => {
    expect(parseLocalInput("2026-02-30T10:00")).toBeNull();
    expect(parseLocalInput("yesterday")).toBeNull();
    expect(parseLocalInput("")).toBeNull();
  });

  test("a discovery time in the future is refused, a small clock skew is not", () => {
    const future = toLocalSecondsValue(new Date(NOW + 60 * 60_000));
    const skew = toLocalSecondsValue(new Date(NOW + 60_000));
    expect(draftDetermination({ kind: "legal.discovery", value: future, basis: BASIS, now: NOW })).toMatchObject({ ok: false });
    expect(draftDetermination({ kind: "legal.discovery", value: skew, basis: BASIS, now: NOW }).ok).toBe(true);
  });

  test("a time more than a year back is refused as a likely wrong year", () => {
    const old = toLocalSecondsValue(new Date(NOW - 400 * 24 * 3_600_000));
    const result = draftDetermination({ kind: "legal.discovery", value: old, basis: BASIS, now: NOW });
    expect(result).toMatchObject({ ok: false });
  });

  test("a basis is required and the body is an ISO instant", () => {
    const value = toLocalSecondsValue(new Date(NOW - 3_600_000));
    expect(draftDetermination({ kind: "legal.discovery", value, basis: "  ", now: NOW })).toMatchObject({ ok: false });
    const ok = draftDetermination({ kind: "legal.discovery", value, basis: `  ${BASIS} `, now: NOW });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.body.basis).toBe(BASIS);
      expect(ok.body.determinedAt).toBe(new Date(NOW - 3_600_000).toISOString());
    }
  });

  test("materiality cannot come before discovery", () => {
    const discoveryAt = new Date(NOW - 3_600_000);
    const before = toLocalSecondsValue(new Date(NOW - 2 * 3_600_000));
    const after = toLocalSecondsValue(new Date(NOW - 60_000));
    expect(draftDetermination({ kind: "legal.materiality", value: before, basis: BASIS, now: NOW, discoveryAt })).toMatchObject({
      ok: false,
      reason: "Materiality cannot be earlier than discovery.",
    });
    expect(draftDetermination({ kind: "legal.materiality", value: after, basis: BASIS, now: NOW, discoveryAt }).ok).toBe(true);
  });

  test("closing a deadline needs a note, opening one does not", () => {
    const base = { ruleId: "tx-521-ag", owner: "" };
    expect(draftDeadlineMark({ ...base, status: "done", note: "" })).toMatchObject({ ok: false });
    expect(draftDeadlineMark({ ...base, status: "not_applicable", note: " " })).toMatchObject({ ok: false });
    expect(draftDeadlineMark({ ...base, status: "done", note: "Filed on the portal." }).ok).toBe(true);
    expect(draftDeadlineMark({ ...base, status: "open", note: "" }).ok).toBe(true);
  });

  test("owners are active commander and counsel, and a current owner is kept", () => {
    const commander = member("c".repeat(64), "commander");
    const counsel = member("a".repeat(64), "counsel");
    const technical = member("b".repeat(64), "technical");
    const revoked = member("d".repeat(64), "counsel", "revoked");
    const members = [commander, counsel, technical, revoked];
    expect(deadlineOwners(members).map((m) => m.identity)).toEqual([commander.identity, counsel.identity]);
    expect(deadlineOwners(members, revoked.identity).map((m) => m.identity)).toContain(revoked.identity);
    expect(deadlineOwners(members, technical.identity).map((m) => m.identity)).toContain(technical.identity);
  });
});
