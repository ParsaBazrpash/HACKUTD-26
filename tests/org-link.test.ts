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

test("the phone field drops a pasted +1 but never cuts a longer number into a different one", () => {
  expect(usPhoneDigits("+1 (555) 555-0123")).toBe("5555550123");
  // What the form submits is toUsE164(usPhoneDigits(input)).
  const submitted = (input: string) => toUsE164(usPhoneDigits(input));
  expect(submitted("+1 (214) 555-0101")).toBe("+12145550101");
  for (const bad of ["+44 20 7946 0958", "+52 55 1234 5678", "+1 (214) 555-0101 x23", "55555501234567", "1214555010", "0214555010", "2140550101"]) {
    expect(submitted(bad), bad).toBeNull();
  }
});
