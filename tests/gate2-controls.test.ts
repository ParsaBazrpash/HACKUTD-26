import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  applyInviteHash,
  fragmentKind,
  inviteRoleFromFragment,
  membershipStatusCopy,
} from "@/components/incidents/join-link";
import {
  admitEnabled,
  canAdmitNow,
  authorizedChatChannels,
  canCompose,
  DEFAULT_INVITE_TTL_MINUTES,
  draftChatBody,
  inviteRequest,
  linkVerifiedLabel,
  REVOKE_REASON_MAX,
  revokeConfirmPhrase,
  revokeConfirmed,
  revokeEnabled,
} from "@/components/incidents/room-controls";
import { createMockIncidentClient } from "@/lib/client/mock";
import { ChatBodySchema } from "@/lib/protocol/events";
import { INVITE_TTL_DEFAULT_MIN } from "@/spacetimedb/src/shared/limits";
import type { ChannelView } from "@/lib/client/types";

const leakedChannels: ChannelView[] = [
  { kind: "record", messages: [], waitingForKeys: false },
  { kind: "command", messages: [], waitingForKeys: false },
  { kind: "privileged", messages: [], waitingForKeys: false },
  { kind: "technical", messages: [], waitingForKeys: false },
];

describe("join fragment", () => {
  test("removes a fragment immediately and keeps it for redeem", () => {
    const calls: string[] = [];
    const fragment = applyInviteHash("#i=abc&c=code&s=secret&f=fp&r=counsel", (url) => calls.push(url));
    expect(fragment).toBe("#i=abc&c=code&s=secret&f=fp&r=counsel");
    expect(calls).toEqual(["/join"]);
    expect(inviteRoleFromFragment(fragment)).toBe("counsel");
    expect(fragmentKind(fragment)).toBe("live");
  });

  test("does not invent a role or strip an empty address", () => {
    const calls: string[] = [];
    expect(applyInviteHash("", (url) => calls.push(url))).toBe("");
    expect(applyInviteHash("#", (url) => calls.push(url))).toBe("");
    expect(calls).toEqual([]);
    expect(inviteRoleFromFragment("#r=commander")).toBeNull();
    expect(inviteRoleFromFragment("#r=counsel")).toBe("counsel");
    expect(fragmentKind("#demo=1&i=1&t=2&r=technical")).toBe("demo");
    expect(fragmentKind("#r=executive")).toBe("unknown");
  });

  test("tells waiting and admitted apart", () => {
    expect(membershipStatusCopy({ state: "pending", role: "counsel", name: "Dana" })).toBe(
      "Waiting for admission as Counsel. Dana.",
    );
    expect(membershipStatusCopy({ state: "active", role: "technical", name: "Sam" })).toBe(
      "Admitted as Technical. Sam.",
    );
    expect(membershipStatusCopy({ state: "revoked", role: "counsel", name: "Dana" })).toBe(
      "Your access to this incident was revoked.",
    );
  });

  test("the join form redeems the preserved fragment and has no role picker", () => {
    const text = readFileSync("components/incidents/join-form.tsx", "utf8");
    expect(text).toContain("redeemInvite({ fragment, displayName })");
    expect(text).toContain("applyInviteHash");
    expect(text).not.toMatch(/name="role"/);
    expect(text).not.toMatch(/<select/);
  });
});

describe("invite and admission", () => {
  test("invite requests use an invitable role and a bounded lifetime", () => {
    expect(DEFAULT_INVITE_TTL_MINUTES).toBe(INVITE_TTL_DEFAULT_MIN);
    expect(inviteRequest("counsel")).toEqual({ role: "counsel", ttlMinutes: 15 });
    expect(inviteRequest("technical", 60)).toEqual({ role: "technical", ttlMinutes: 60 });
    expect(() => inviteRequest("commander")).toThrow(/role/i);
    expect(() => inviteRequest("counsel", 0)).toThrow(/lifetime/i);
    expect(() => inviteRequest("counsel", 61)).toThrow(/lifetime/i);
  });

  test("creates an invite link and admits only a link-verified pending member", async () => {
    const commander = createMockIncidentClient({ origin: "https://haven.example" });
    const created = await commander.createInvite(inviteRequest("counsel", 15));
    const url = new URL(created.url);
    expect(url.origin).toBe("https://haven.example");
    expect(url.pathname).toBe("/join");
    expect(url.search).toBe("");
    expect(url.hash).toContain("r=counsel");
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now() - 1_000);

    const pending = commander.getState().members.find((member) => member.state === "pending");
    expect(pending?.linkVerified).toBe(true);
    expect(pending?.safetyCode).toBeTruthy();
    expect(pending?.fingerprint).toBeTruthy();
    expect(admitEnabled(commander.getState().me, pending!)).toBe(true);
    expect(linkVerifiedLabel(true)).toBe("Link verified");
    expect(linkVerifiedLabel(false)).toBe("Unverified: do not admit");
    expect(linkVerifiedLabel(undefined)).toBe("Link check has not finished");
    await commander.admitMember(pending!.memberId);
    expect(commander.getState().members.find((member) => member.memberId === pending!.memberId)?.state).toBe(
      "active",
    );

    const counsel = createMockIncidentClient({ viewer: "counsel" });
    const waiting = counsel.getState().members.find((member) => member.state === "pending");
    expect(admitEnabled(counsel.getState().me, waiting!)).toBe(false);
    await expect(counsel.admitMember(waiting!.memberId)).rejects.toThrow(/commander/i);
  });

  test("Admit also waits for the commander to confirm the safety code", () => {
    const commander = { role: "commander" as const, state: "active" as const };
    const verified = { state: "pending" as const, linkVerified: true };
    expect(canAdmitNow(commander, verified, false)).toBe(false);
    expect(canAdmitNow(commander, verified, true)).toBe(true);
    // The tick never overrides the link check or the role.
    expect(canAdmitNow(commander, { state: "pending", linkVerified: false }, true)).toBe(false);
    expect(canAdmitNow(commander, { state: "pending", linkVerified: undefined }, true)).toBe(false);
    expect(canAdmitNow({ role: "counsel", state: "active" }, verified, true)).toBe(false);
    expect(canAdmitNow(null, verified, true)).toBe(false);
  });

  test("keeps Admit off until the link check passes", () => {
    const commander = { role: "commander" as const, state: "active" as const };
    expect(admitEnabled(commander, { state: "pending", linkVerified: false })).toBe(false);
    expect(admitEnabled(commander, { state: "pending", linkVerified: undefined })).toBe(false);
    expect(admitEnabled(commander, { state: "pending", linkVerified: true })).toBe(true);
    expect(admitEnabled(commander, { state: "active", linkVerified: true })).toBe(false);
    expect(admitEnabled({ role: "counsel", state: "active" }, { state: "pending", linkVerified: true })).toBe(false);
    expect(admitEnabled(null, { state: "pending", linkVerified: true })).toBe(false);
    expect(admitEnabled({ role: "commander", state: "pending" }, { state: "pending", linkVerified: true })).toBe(
      false,
    );
  });
});

describe("revoke from the room", () => {
  test("only the active commander revokes, and only an active member who is not the commander", async () => {
    const commander = createMockIncidentClient();
    const state = commander.getState();
    const me = state.me!;
    const active = state.members.find((member) => member.state === "active" && member.role !== "commander")!;
    const pending = state.members.find((member) => member.state === "pending");
    expect(revokeEnabled(me, active)).toBe(true);
    expect(revokeEnabled(me, me)).toBe(false);
    expect(revokeEnabled(me, { ...active, role: "commander" })).toBe(false);
    expect(revokeEnabled(me, { ...active, state: "revoked" })).toBe(false);
    if (pending) expect(revokeEnabled(me, pending)).toBe(false);
    expect(revokeEnabled({ ...me, state: "revoked" }, active)).toBe(false);
    expect(revokeEnabled({ ...me, role: "counsel" }, active)).toBe(false);
    expect(revokeEnabled(null, active)).toBe(false);

    await commander.revokeMember(active.memberId, "Laptop seized.".slice(0, REVOKE_REASON_MAX));
    expect(commander.getState().members.find((member) => member.memberId === active.memberId)?.state).toBe("revoked");
    await expect(commander.revokeMember(me.memberId, "")).rejects.toThrow();

    const counsel = createMockIncidentClient({ viewer: "counsel" });
    const other = counsel.getState().members.find((member) => member.state === "active" && member.role !== "commander" && member.identity !== counsel.getState().me?.identity);
    expect(other).toBeDefined();
    await expect(counsel.revokeMember(other!.memberId, "")).rejects.toThrow(/commander/i);
  });

  test("the commander must type the member's name to confirm", () => {
    const member = { displayName: "  Dana Counsel " };
    expect(revokeConfirmPhrase(member)).toBe("Dana Counsel");
    expect(revokeConfirmed(member, "")).toBe(false);
    expect(revokeConfirmed(member, "dana counsel")).toBe(false);
    expect(revokeConfirmed(member, "Dana")).toBe(false);
    expect(revokeConfirmed(member, " Dana Counsel ")).toBe(true);
    // The same name typed in another Unicode form still matches.
    expect(revokeConfirmed({ displayName: "Jos\u00e9" }, "Jose\u0301")).toBe(true);
    expect(revokeConfirmPhrase({ displayName: "   " })).toBe("revoke");
  });
});

describe("chat composer", () => {
  test("hides #record and channels the role cannot read", () => {
    expect(authorizedChatChannels("technical", "active", leakedChannels).map((channel) => channel.kind)).toEqual([
      "command",
      "technical",
    ]);
    expect(authorizedChatChannels("executive", "active", leakedChannels).map((channel) => channel.kind)).toEqual([
      "command",
      "privileged",
    ]);
    expect(authorizedChatChannels("counsel", "pending", leakedChannels)).toEqual([]);
    expect(authorizedChatChannels(undefined, "active", leakedChannels)).toEqual([]);
    expect(canCompose("technical", "active", "privileged")).toBe(false);
    expect(canCompose("technical", "active", "record")).toBe(false);
    expect(canCompose("executive", "active", "technical")).toBe(false);
    expect(canCompose("executive", "active", "privileged")).toBe(true);
    expect(canCompose("commander", "pending", "command")).toBe(false);
  });

  test("posts a schema-valid chat body and refuses an empty one", async () => {
    const technical = createMockIncidentClient({ viewer: "technical" });
    const shown = authorizedChatChannels(
      technical.getState().me?.role,
      technical.getState().me?.state,
      technical.getState().channels,
    );
    expect(shown.map((channel) => channel.kind)).toEqual(["command", "technical"]);
    expect(shown.some((channel) => channel.kind === "privileged")).toBe(false);

    const draft = draftChatBody("  Isolate the file server.  ");
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.body).toEqual({ text: "Isolate the file server.", mentions: [] });
    expect(ChatBodySchema.safeParse({ ...draft.body, messageId: crypto.randomUUID() }).success).toBe(true);
    await technical.postMessage("technical", draft.body);
    const posted = technical.getState().channels.find((channel) => channel.kind === "technical")?.messages.at(-1);
    expect(posted?.text).toBe("Isolate the file server.");

    expect(draftChatBody("   ").ok).toBe(false);
    expect(draftChatBody("x".repeat(4001)).ok).toBe(false);
    expect(draftChatBody("x".repeat(4000)).ok).toBe(true);
    await expect(technical.postMessage("privileged", { text: "no", mentions: [] })).rejects.toThrow(/role/i);
  });
});

describe("control wiring", () => {
  test("the incident screen calls the client and does not log invite material", () => {
    const invite = readFileSync("components/incidents/invite-controls.tsx", "utf8");
    const admission = readFileSync("components/incidents/admission-controls.tsx", "utf8");
    const composer = readFileSync("components/incidents/message-composer.tsx", "utf8");
    const access = readFileSync("components/incidents/access-controls.tsx", "utf8");
    const channels = readFileSync("components/incidents/channels-board.tsx", "utf8");
    const overview = readFileSync("components/incidents/overview.tsx", "utf8");
    expect(invite).toContain("createInvite(inviteRequest(role, ttlMinutes))");
    expect(invite).not.toMatch(/console\./);
    expect(invite).not.toMatch(/sendBeacon|gtag|analytics|fetch\(/);
    expect(admission).toContain("admitMember(member.memberId)");
    expect(admission).not.toMatch(/console\./);
    expect(composer).toContain("postMessage(channel, draft.body)");
    expect(composer).not.toMatch(/console\./);
    expect(composer).not.toContain("record");
    expect(access).toContain("<InviteControls");
    expect(access).toContain("<AdmissionControls");
    expect(channels).toContain("<MessageComposer");
    expect(channels).toContain("authorizedChatChannels");
    // The Overview no longer composes chat; status changes stay behind the record policy check.
    expect(overview).not.toContain("<MessageComposer");
    expect(overview).toContain('canAuthorRecord(state.me?.role, state.me?.state, "status.set")');
    // Recent activity reads only authorized channels and never quotes #privileged text.
    expect(overview).toContain("authorizedChatChannels(state.me?.role, state.me?.state, state.channels)");
    expect(overview).toContain('message.kind === "privileged" ? "Privileged message"');
    expect(admission).toContain("revokeMember(member.memberId, DECLINE_REASON)");
    const revoke = readFileSync("components/incidents/revoke-control.tsx", "utf8");
    const people = readFileSync("components/incidents/people-board.tsx", "utf8");
    expect(revoke).toContain("revokeMember(member.memberId,");
    expect(revoke).toContain("revokeConfirmed(member, typed)");
    expect(revoke).toContain("revokeEnabled(state.me, member)");
    expect(revoke).not.toMatch(/console\./);
    expect(people).toContain("<RevokeControl member={member} />");
  });
});
