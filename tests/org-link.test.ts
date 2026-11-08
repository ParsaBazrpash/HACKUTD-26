import { expect, test } from "vitest";
import { applyEnrollHash, looksLikePhone, toUsE164, usPhoneDigits } from "@/components/org/org-link";

test("the enrollment fragment is read once and stripped from the address bar", () => {
  const replaced: string[] = [];
  expect(applyEnrollHash("#demo=1&o=x&t=y", (url) => replaced.push(url))).toBe("#demo=1&o=x&t=y");
  expect(replaced).toEqual(["/enroll"]);
});

test("an empty fragment is not stripped and yields nothing", () => {
  const replaced: string[] = [];
  expect(applyEnrollHash("", (url) => replaced.push(url))).toBe("");
  expect(applyEnrollHash("#", (url) => replaced.push(url))).toBe("");
  expect(replaced).toEqual([]);
});

test("phone numbers must be international format", () => {
  expect(looksLikePhone("+15555550123")).toBe(true);
  for (const bad of ["5555550123", "+05555550123", "+1555", "+1555555012345678", "+1 555 555 0123", ""]) {
    expect(looksLikePhone(bad)).toBe(false);
  }
});

import { passkeyGateFor } from "@/components/org/use-passkey-ready";

test("outside the demo only an unlocked passkey passes the gate", () => {
  for (const status of ["off", "locked", "checking", "unsupported"] as const) {
    const gate = passkeyGateFor(status, false);
    expect(gate.ready, status).toBe(false);
    expect(gate.reason, status).toBeTruthy();
  }
  expect(passkeyGateFor("unlocked", false).ready).toBe(true);
  expect(passkeyGateFor("off", true).ready).toBe(true);
});

test("the fixed +1 prefix turns exactly 10 typed digits into E.164", () => {
  expect(toUsE164("5555550123")).toBe("+15555550123");
  expect(toUsE164("(555) 555-0123")).toBe("+15555550123");
  expect(toUsE164("+1 555 555 0123")).toBe("+15555550123");
  expect(toUsE164("15555550123")).toBe("+15555550123");
  for (const bad of ["", "555555012", "55555501234", "abcdefghij", "+44 20 7946 0958"]) {
    expect(toUsE164(bad), bad).toBeNull();
  }
});

test("the phone field keeps at most 10 digits and drops a pasted country code", () => {
  expect(usPhoneDigits("55555501234567")).toBe("5555550123");
  expect(usPhoneDigits("+1 (555) 555-0123")).toBe("5555550123");
  expect(usPhoneDigits("1234567890")).toBe("1234567890");
});
