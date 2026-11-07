// Invite fragment handling for /join. The fragment is read once, then removed
// from the address bar before redeemInvite runs.

import { ROLE_LABELS } from "@/components/incidents/labels";
import type { MemberStateName, Role } from "@/spacetimedb/src/shared/policy";

export const JOIN_PATH = "/join";

export function captureInviteHash(hash: string): { fragment: string; strip: boolean } {
  if (hash.length > 1) return { fragment: hash, strip: true };
  return { fragment: "", strip: false };
}

/** Reads the fragment and, when one is present, removes it from the address bar. */
export function applyInviteHash(hash: string, replace: (url: string) => void): string {
  const captured = captureInviteHash(hash);
  if (captured.strip) replace(JOIN_PATH);
  return captured.fragment;
}

export function inviteRoleFromFragment(fragment: string): "counsel" | "technical" | "executive" | null {
  const role = new URLSearchParams(fragment.replace(/^#/, "")).get("r");
  if (role === "counsel" || role === "technical" || role === "executive") return role;
  return null;
}

export function fragmentKind(fragment: string): "demo" | "live" | "unknown" {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (params.has("c") || params.has("s") || params.has("f")) return "live";
  if (params.get("demo") === "1") return "demo";
  return "unknown";
}

export function membershipStatusCopy(input: {
  state: MemberStateName;
  role: Role | null;
  name: string;
}): string {
  if (input.state === "revoked") return "Your access to this incident was revoked.";
  const role = input.role ? ROLE_LABELS[input.role] : "the invited role";
  if (input.state === "active") return `Admitted as ${role}. ${input.name}.`;
  return `Waiting for admission as ${role}. ${input.name}.`;
}
