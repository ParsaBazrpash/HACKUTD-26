import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  chatSeenKey,
  inPreviewWindow,
  markChatSeen,
  newestServerTime,
  PREVIEW_MS,
  previewText,
  readChatSeen,
  resetChatSeen,
  unreadMessages,
} from "@/components/incidents/chat-unread";
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

describe("side chat preview", () => {
  test("a privileged message never puts its text in the preview", () => {
    const secret = { ...msg(1, SAM, T0 + 1000), text: "Counsel: do not notify the AG until 5 pm. https://example.com/memo" } as ChannelMessage;
    const text = previewText({ channel: "privileged", message: secret });
    expect(text).toBe("Privileged message");
    expect(text).not.toContain("Counsel");
    expect(text).not.toContain("https://");
  });

  test("other channels show the words, and a card pointer as a readable label", () => {
    const plain = { ...msg(2, SAM, T0 + 1000), text: "VPN logs pulled." } as ChannelMessage;
    const card = { ...msg(3, SAM, T0 + 1000), text: "Look. [card:blast]" } as ChannelMessage;
    expect(previewText({ channel: "command", message: plain })).toBe("VPN logs pulled.");
    expect(previewText({ channel: "technical", message: card })).toBe("Look. [Live card: blast radius]");
  });

  test("the preview window is bounded on both sides, so a future server time cannot pin it", () => {
    expect(inPreviewWindow(T0 + 1000, T0)).toBe(true);
    expect(inPreviewWindow(T0, T0 + 2000)).toBe(true);
    expect(inPreviewWindow(T0 + PREVIEW_MS, T0)).toBe(false);
    expect(inPreviewWindow(T0, T0 + 10 * 60_000)).toBe(false);
    expect(inPreviewWindow(null, T0)).toBe(false);
    expect(inPreviewWindow(T0, Number.NaN)).toBe(false);
  });
});

describe("side chat read mark", () => {
  test("the mark is the newest server time in readable channels, including your own messages", () => {
    const s = state([
      { kind: "command", waitingForKeys: false, messages: [msg(1, SAM, T0 + 1000), msg(2, ME, T0 + 5000)] },
      { kind: "technical", waitingForKeys: false, messages: [msg(3, SAM, T0 + 9000)] },
    ]);
    // Riley is the executive and cannot read #technical, so its time does not move the mark.
    expect(newestServerTime(s)).toBe(T0 + 5000);
    expect(unreadMessages(s, newestServerTime(s) ?? 0)).toEqual([]);
  });

  test("no readable message, or only broken times, gives no mark", () => {
    expect(newestServerTime(state([]))).toBeNull();
    const broken = { ...msg(1, SAM, T0), serverTs: new Date(Number.NaN) } as ChannelMessage;
    expect(newestServerTime(state([{ kind: "command", waitingForKeys: false, messages: [broken] }]))).toBeNull();
  });
});

describe("shared seen mark for the side chat and the sidebar badge", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    resetChatSeen();
  });
  afterEach(() => {
    resetChatSeen();
    vi.unstubAllGlobals();
  });

  test("one mark per incident and member; no member, no mark", () => {
    expect(chatSeenKey("inc-1", ME.identity)).not.toBe(chatSeenKey("inc-1", SAM.identity));
    expect(chatSeenKey("inc-1", ME.identity)).not.toBe(chatSeenKey("inc-2", ME.identity));
    expect(chatSeenKey("inc-1", undefined)).toBeNull();
    markChatSeen(null, T0);
    expect(readChatSeen(null)).toBeUndefined();
  });

  test("the mark only moves forward and survives a reload of this tab", () => {
    const key = chatSeenKey("inc-1", ME.identity);
    expect(readChatSeen(key)).toBeUndefined();
    markChatSeen(key, T0 + 5000);
    markChatSeen(key, T0 + 1000);
    markChatSeen(key, Number.NaN);
    markChatSeen(key, null);
    expect(readChatSeen(key)).toBe(T0 + 5000);
    // A reload drops memory but keeps sessionStorage, which holds a number only.
    resetChatSeen();
    expect(readChatSeen(key)).toBe(T0 + 5000);
    expect([...store.values()]).toEqual([String(T0 + 5000)]);
  });

  test("the badge count is what arrived after the mark, and opening the chat clears it", () => {
    const key = chatSeenKey("inc-1", ME.identity);
    const s = state([{ kind: "command", waitingForKeys: false, messages: [msg(1, SAM, T0 + 1000), msg(2, SAM, T0 + 3000)] }]);
    markChatSeen(key, T0 + 2000);
    expect(unreadMessages(s, readChatSeen(key) ?? 0)).toHaveLength(1);
    markChatSeen(key, newestServerTime(s));
    expect(unreadMessages(s, readChatSeen(key) ?? 0)).toHaveLength(0);
  });
});

