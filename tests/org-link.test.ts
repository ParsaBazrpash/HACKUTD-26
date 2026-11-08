import { expect, test } from "vitest";
import { applyEnrollHash, looksLikePhone } from "@/components/org/org-link";

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
