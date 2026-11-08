// Deterministic fingerprints and safety codes for the mock (demo mode).
//
// They have the same shape as the real ones in lib/crypto/keys.ts, but they
// are derived from a fixed label and a serial number, not from any key. The
// same serial always gives the same code in every file that uses these.

import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();

function digest(label: string, n: number): Uint8Array {
  return sha256(enc.encode(`${label}-${n}`));
}

/** Eight groups of four lowercase hex characters, like a real fingerprint. */
export function demoFingerprint(n: number): string {
  const hex = Array.from(digest("lakeside-demo-fingerprint", n).subarray(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return hex.match(/.{4}/g)!.join(" ");
}

/** Twelve decimal digits in four groups of three, like a real safety code. */
export function demoSafety(n: number): string {
  const h = digest("lakeside-demo-safety", n);
  let v = 0n;
  for (let i = 0; i < 5; i++) v = (v << 8n) | BigInt(h[i]);
  const s = (v % 1_000_000_000_000n).toString().padStart(12, "0");
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9, 12)}`;
}
