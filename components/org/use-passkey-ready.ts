"use client";

import { usePasskeyLock } from "@/components/security/passkey-lock-card";
import { isMockIncidentClient } from "@/lib/client";
import type { PasskeyLockState } from "@/lib/client/passkey-lock";

export type PasskeyGate = {
  /** True when the passkey requirement is met (or the demo skips it). */
  ready: boolean;
  /** Plain explanation when the requirement is not met. */
  reason: string | null;
};

/** Pure mapping from passkey lock status to the gate. Only "unlocked" passes outside the demo. */
export function passkeyGateFor(status: PasskeyLockState["status"], mock: boolean): PasskeyGate {
  if (mock) return { ready: true, reason: null };
  if (status === "unlocked") return { ready: true, reason: null };
  if (status === "checking") return { ready: false, reason: "Checking whether this browser can use a passkey…" };
  if (status === "unsupported") {
    return {
      ready: false,
      reason:
        "This browser cannot use a passkey, so it cannot be used here. Open this page in a current Safari, Chrome or Edge on a phone or laptop with a fingerprint, face or PIN.",
    };
  }
  if (status === "locked") return { ready: false, reason: "Unlock your passkey above to continue." };
  return { ready: false, reason: "Turn on the passkey lock above first. A passkey is required." };
}

/** The org flows need the device keys locked with a passkey. The browser demo skips the check. */
export function usePasskeyGate(): PasskeyGate {
  const state = usePasskeyLock();
  return passkeyGateFor(state.status, isMockIncidentClient());
}
