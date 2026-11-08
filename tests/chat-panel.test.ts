import { describe, expect, test } from "vitest";
import { unreadMessages } from "@/components/incidents/chat-panel";
import type { ChannelMessage, IncidentState, MemberRef } from "@/lib/client/types";
import { EMPTY_PROFILE } from "@/lib/client/types";

const ME: MemberRef = { identity: "a".repeat(64), displayName: "Riley", role: "executive" };
const SAM: MemberRef = { identity: "b".repeat(64), displayName: "Sam", role: "technical" };
const OK = { ok: true, failures: [], warnings: [] };
const T0 = Date.parse("2026-11-08T10:00:00Z");

function msg(n: number, author: MemberRef | null, at: number, ok = true): ChannelMessage {
  return {
    seq: BigInt(n),
    messageId: `m${n}`,
    author,
    sentAt: new Date(at),
    serverTs: new Date(at),
    text: `message ${n}`,
    mentions: [],
    verdict: ok ? OK : { ok: false, failures: ["bad_signature"], warnings: [] },
  } as unknown as ChannelMessage;
}

function state(channels: IncidentState["channels"], me: MemberRef = ME, memberState = "active"): IncidentState {
  return {
    connection: "live",
    me: { ...me, state: memberState },
    incident: null,
    status: null,
    members: [],
    channels,
    timeline: [],
    scope: [],
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: { ok: true, checkedAt: new Date(T0), channels: {}, rosterFailures: [] },
    org: null,
    roster: [],
    pages: [],
  } as unknown as IncidentState;
}

describe("side chat new-message count", () => {
  test("counts only verified messages from someone else that arrived after the mark, oldest first", () => {
    const s = state([
      {
        kind: "command",
        waitingForKeys: false,
        messages: [msg(1, SAM, T0 - 1), msg(2, SAM, T0 + 2000), msg(3, ME, T0 + 3000), msg(4, SAM, T0 + 4000, false), msg(5, null, T0 + 5000)],
      },
      { kind: "privileged", waitingForKeys: false, messages: [msg(6, SAM, T0 + 1000)] },
    ]);
    expect(unreadMessages(s, T0).map((u) => [u.channel, u.message.messageId])).toEqual([
      ["privileged", "m6"],
      ["command", "m2"],
    ]);
  });

  test("never counts a channel this member cannot read, even if it reached the state", () => {
    const s = state([{ kind: "technical", waitingForKeys: false, messages: [msg(1, SAM, T0 + 1000)] }]);
    expect(unreadMessages(s, T0)).toEqual([]);
    expect(unreadMessages(state([{ kind: "record", waitingForKeys: false, messages: [msg(2, SAM, T0 + 1000)] }]), T0)).toEqual([]);
  });

  test("a pending or removed member sees no count", () => {
    const channels: IncidentState["channels"] = [{ kind: "command", waitingForKeys: false, messages: [msg(1, SAM, T0 + 1000)] }];
    expect(unreadMessages(state(channels, ME, "pending"), T0)).toEqual([]);
    expect(unreadMessages(state(channels, ME, "revoked"), T0)).toEqual([]);
  });

  test("a bad server time is ignored instead of counted", () => {
    const broken = { ...msg(1, SAM, T0 + 1000), serverTs: new Date(Number.NaN) } as ChannelMessage;
    expect(unreadMessages(state([{ kind: "command", waitingForKeys: false, messages: [broken] }]), T0)).toEqual([]);
  });
});
