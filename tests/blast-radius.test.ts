import { afterEach, describe, expect, test } from "vitest";
import {
  attachCardText,
  buildBlastModel,
  cardMessageText,
  channelHref,
  cardPreviewText,
  exposureStep,
  NODE_CAP,
  parseCardMessage,
  RING_CAP,
  RINGS,
  ringOf,
  roundTripNote,
  shortCount,
  stateDeadlines,
  US_TILES,
} from "@/components/incidents/blast-radius-model";
import type { IncidentState, MemberRef, ScopeBody, ScopeItem } from "@/lib/client/types";
import { EMPTY_PROFILE } from "@/lib/client/types";
import { computeDeadlines } from "@/lib/legal";
import { authorizedChatChannels, draftChatBody, pickChatChannel } from "@/components/incidents/room-controls";
import { medianSync, recordSync, resetSyncSamples, syncCount, syncSampleSince, syncSamples } from "@/lib/client/sync-meter";

const DANA: MemberRef = { identity: "b".repeat(64), displayName: "Dana", role: "technical" };
const OK = { ok: true, failures: [], warnings: [] };
const NOW = new Date("2026-11-08T09:00:00Z");

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function item(n: number, partial: Partial<ScopeBody> & Pick<ScopeBody, "status">, at = NOW, versions = 1): ScopeItem {
  const latest: ScopeBody = {
    itemId: uuid(n),
    system: `SYS-${n}`,
    assetType: "server",
    dataTypes: [],
    affected: [],
    notes: "",
    ...partial,
  };
  const history = Array.from({ length: versions }, (_, i) => ({
    seq: BigInt(n * 10 + i),
    by: DANA,
    at: i === versions - 1 ? at : new Date(at.getTime() - 60_000),
    sentAt: at,
    verdict: OK,
    body: latest,
  }));
  return { itemId: latest.itemId, latest, history };
}

function state(scope: ScopeItem[], partial: Partial<IncidentState> = {}): IncidentState {
  return {
    connection: "ready",
    me: null,
    incident: null,
    status: null,
    members: [],
    channels: [],
    timeline: [],
    scope,
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: { ok: true, checkedAt: NOW, channels: {}, rosterFailures: [] },
    org: null,
    roster: [],
    pages: [],
    ...partial,
  };
}

describe("blast radius model", () => {
  test("places each status on its ring, worst at the center", () => {
    expect(RINGS).toEqual(["exfiltrated", "encrypted", "suspected", "unknown", "closed"]);
    expect(ringOf("exfiltrated")).toBe("exfiltrated");
    expect(ringOf("contained")).toBe("closed");
    expect(ringOf("eradicated")).toBe("closed");
    expect(ringOf("restored")).toBe("closed");
    expect(ringOf("something-new")).toBe("unknown");
  });

  test("counts systems, records and residents only from exposed systems", () => {
    const model = buildBlastModel([
      item(1, { status: "exfiltrated", dataTypes: ["ssn"], recordCount: 12_400, affected: [{ state: "TX", count: 9_800 }, { state: "CA", count: 2_600 }] }),
      item(2, { status: "encrypted", dataTypes: ["other_pii"] }),
      item(3, { status: "contained", dataTypes: ["phi"], recordCount: 500, affected: [{ state: "TX", count: 40 }, { state: "OK", count: 7 }] }),
      item(4, { status: "unknown" }),
    ]);
    expect(model.total).toBe(4);
    expect(model.exposed).toBe(2);
    expect(model.closed).toBe(1);
    expect(model.unknown).toBe(1);
    expect(model.exposedRecords).toBe(12_400);
    expect(model.uncountedSystems).toBe(1);
    expect(model.unmappedSystems).toBe(1);
    expect(model.states.get("TX")).toMatchObject({ exposed: 9_800, other: 40 });
    expect(model.states.get("OK")).toMatchObject({ exposed: 0, other: 7 });
    expect(model.states.get("CA")?.systems.map((s) => s.system)).toEqual(["SYS-1"]);
  });

  test("ignores counts that are not positive finite numbers and keeps unknown codes as text", () => {
    const model = buildBlastModel([
      item(1, {
        status: "exfiltrated",
        dataTypes: ["ssn"],
        recordCount: Number.NaN,
        affected: [
          { state: "TX", count: -5 },
          { state: "CA", count: Number.POSITIVE_INFINITY },
          { state: "NY", count: 0 },
          { state: "ZZ", count: 120 },
          { state: "tx", count: 9 },
        ],
      }),
    ]);
    expect(model.states.size).toBe(0);
    expect(model.otherCodes).toEqual([{ code: "ZZ", exposed: 120 }]);
    expect(model.exposedRecords).toBe(0);
    expect(model.uncountedSystems).toBe(1);
  });

  test("the last change is the newest version on the record, with its author", () => {
    const model = buildBlastModel([
      item(1, { status: "encrypted" }, new Date("2026-11-08T08:00:00Z")),
      item(2, { status: "contained", system: "VPN" }, new Date("2026-11-08T08:30:00Z"), 3),
    ]);
    expect(model.lastChange).toMatchObject({ system: "VPN", status: "contained", by: DANA });
    expect(model.nodes.find((n) => n.system === "VPN")?.version).toBe(3);
  });

  test("a crowded ring draws its first systems and counts the rest", () => {
    const many = Array.from({ length: RING_CAP + 5 }, (_, i) => item(i + 1, { status: "suspected" }));
    const model = buildBlastModel(many);
    expect(model.nodes.filter((n) => n.ring === "suspected")).toHaveLength(RING_CAP);
    expect(model.hiddenByRing.suspected).toBe(5);
    expect(model.nodes.length).toBeLessThanOrEqual(NODE_CAP);
    for (const node of model.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    }
  });

  test("positions are stable: changing one system's status does not reorder the others", () => {
    const before = buildBlastModel([item(1, { status: "encrypted" }), item(2, { status: "encrypted" }), item(3, { status: "exfiltrated" })]);
    const after = buildBlastModel([item(1, { status: "encrypted" }), item(2, { status: "encrypted" }), item(3, { status: "contained" })]);
    const pos = (m: typeof before, id: string) => m.nodes.find((n) => n.itemId === id);
    expect(pos(after, uuid(1))).toMatchObject({ x: pos(before, uuid(1))?.x, y: pos(before, uuid(1))?.y });
    expect(pos(after, uuid(3))?.ring).toBe("closed");
  });

  test("an empty or malformed record draws nothing and does not throw", () => {
    expect(buildBlastModel([]).total).toBe(0);
    const broken = [{ itemId: uuid(9) } as unknown as ScopeItem, null as unknown as ScopeItem];
    expect(() => buildBlastModel(broken)).not.toThrow();
    expect(buildBlastModel(broken).total).toBe(0);
  });

  test("the tile map has the 50 states and DC, each in its own cell", () => {
    const codes = Object.keys(US_TILES);
    expect(codes).toHaveLength(51);
    const cells = new Set(Object.values(US_TILES).map((t) => `${t.col},${t.row}`));
    expect(cells.size).toBe(51);
    for (const tile of Object.values(US_TILES)) {
      expect(tile.col).toBeGreaterThanOrEqual(0);
      expect(tile.col).toBeLessThan(12);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeLessThan(8);
    }
  });

  test("shading steps follow the 250 and 1,000 and 10,000 resident lines", () => {
    expect([0, 1, 249, 250, 999, 1000, 9999, 10000, Number.NaN].map(exposureStep)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 0]);
    expect([7, 1234, 12_400, 2_500_000].map(shortCount)).toEqual(["7", "1.2k", "12k", "2.5M"]);
  });

  test("a state's legal clocks: Texas gets both Texas rules, other states their counsel check", () => {
    const record = state(
      [item(1, { status: "exfiltrated", dataTypes: ["ssn"], recordCount: 12_400, affected: [{ state: "TX", count: 9_800 }, { state: "CA", count: 2_600 }] })],
      { discovery: { determinedAt: new Date("2026-11-07T14:00:00-06:00"), basis: "Recorded.", by: DANA } },
    );
    const all = computeDeadlines(record, NOW);
    expect(stateDeadlines("TX", all).map((d) => d.rule.id).sort()).toEqual(["tx-521-ag", "tx-521-ind"]);
    expect(stateDeadlines("CA", all).map((d) => d.rule.id)).toEqual(["state-check-ca"]);
    expect(stateDeadlines("NY", all)).toEqual([]);
  });
});

describe("live cards in chat", () => {
  test("a shared card is a caption plus a pointer, never record data", () => {
    const text = cardMessageText({ kind: "system", itemId: uuid(1) }, "  Shared a system   from the blast radius. ");
    expect(text).toBe(`Shared a system from the blast radius. [card:system:${uuid(1)}]`);
    expect(parseCardMessage(text)).toEqual({ caption: "Shared a system from the blast radius.", card: { kind: "system", itemId: uuid(1) } });
    expect(cardMessageText({ kind: "blast" }, "x".repeat(1000)).length).toBeLessThan(320);
  });

  test("parses the three card kinds", () => {
    expect(parseCardMessage("[card:blast]")).toEqual({ caption: "", card: { kind: "blast" } });
    expect(parseCardMessage("see this [card:deadline:tx-521-ag]")).toEqual({ caption: "see this", card: { kind: "deadline", ruleId: "tx-521-ag" } });
  });

  test("anything malformed stays plain text", () => {
    for (const text of [
      "no card here",
      "[card:blast] then more text",
      "[card:system:not-a-uuid-at-all-but-36-characters!!]",
      `[card:system:${uuid(1).replace("-4000-", "-1000-")}]`,
      "[card:deadline:TX-UPPER]",
      `[card:deadline:${"a".repeat(41)}]`,
      "[card:map]",
      "[CARD:blast]",
      "",
    ]) {
      expect(parseCardMessage(text), text).toBeNull();
    }
    expect(parseCardMessage(42 as unknown as string)).toBeNull();
  });

  test("only the last pointer counts, and hostile captions come back as plain strings", () => {
    const hostile = '<img src=x onerror=alert(1)> [card:blast]';
    expect(parseCardMessage(hostile)).toEqual({ caption: "<img src=x onerror=alert(1)>", card: { kind: "blast" } });
    expect(parseCardMessage(`[card:blast] [card:system:${uuid(2)}]`)?.card).toEqual({ kind: "system", itemId: uuid(2) });
  });

  test("a card attached from the paperclip keeps the typed message and parses back", () => {
    const text = attachCardText("  Look at this one.\nTexas is lit.  ", { kind: "deadline", ruleId: "tx-521-ag" });
    expect(text).toBe("Look at this one.\nTexas is lit. [card:deadline:tx-521-ag]");
    expect(parseCardMessage(text)).toEqual({ caption: "Look at this one.\nTexas is lit.", card: { kind: "deadline", ruleId: "tx-521-ag" } });
    expect(attachCardText("   ", { kind: "blast" })).toBe("Shared a live card. [card:blast]");
    expect(attachCardText(undefined as unknown as string, { kind: "blast" })).toBe("Shared a live card. [card:blast]");
  });

  test("an attached card does not get around the 4000 character limit", () => {
    const tooLong = attachCardText("x".repeat(3995), { kind: "system", itemId: uuid(1) });
    expect(draftChatBody(tooLong)).toMatchObject({ ok: false });
    const fits = attachCardText("x".repeat(3900), { kind: "system", itemId: uuid(1) });
    expect(draftChatBody(fits)).toMatchObject({ ok: true });
  });

  test("the share note names this device's round trip, and the channel link stays on this site", () => {
    expect(roundTripNote(41.6)).toBe("Spacetime round trip 42 ms from this device.");
    expect(roundTripNote(41.6)).not.toMatch(/everyone/i);
    expect(channelHref("abc-123", "technical")).toBe("/incidents/abc-123/channels#technical");
    expect(channelHref("../x?y", "#z")).toBe("/incidents/..%2Fx%3Fy/channels#%23z");
  });

  test("previews and the printed report show a readable label", () => {
    expect(cardPreviewText("Shared the live blast radius. [card:blast]")).toBe("Shared the live blast radius. [Live card: blast radius]");
    expect(cardPreviewText("[card:deadline:tx-521-ag]")).toBe("[Live card: legal clock]");
    expect(cardPreviewText("plain words")).toBe("plain words");
  });
});

describe("channel links", () => {
  const all = (["command", "privileged", "technical", "record"] as const).map((kind) => ({ kind, messages: [], waitingForKeys: false }));
  const open = (role: MemberRef["role"], linked: string | null, picked: string | null = null, memberState: "active" | "pending" = "active") =>
    pickChatChannel(authorizedChatChannels(role, memberState, all), picked, linked)?.kind;

  test("a link to a channel the member cannot read lands on #command", () => {
    expect(open("technical", "privileged")).toBe("command");
    expect(open("executive", "technical")).toBe("command");
  });

  test("#record, junk and an empty link land on #command", () => {
    for (const linked of ["record", "Privileged", "technical ", "../privileged", "", null]) {
      expect(open("commander", linked), String(linked)).toBe("command");
    }
  });

  test("a link opens a channel the member can read, and an explicit pick wins over the link", () => {
    expect(open("technical", "technical")).toBe("technical");
    expect(open("counsel", "privileged")).toBe("privileged");
    expect(open("commander", "technical", "privileged")).toBe("privileged");
    expect(open("technical", "technical", "privileged")).toBe("technical");
  });

  test("a pending member opens nothing", () => {
    expect(open("commander", "command", null, "pending")).toBeUndefined();
  });
});

describe("sync meter", () => {
  afterEach(() => resetSyncSamples());

  test("keeps the last 20 round trips and ignores impossible values", () => {
    recordSync(Number.NaN, "record");
    recordSync(-1, "record");
    recordSync(500_000, "record");
    expect(syncSamples()).toHaveLength(0);
    for (let i = 1; i <= 25; i++) recordSync(i, "record");
    expect(syncSamples()).toHaveLength(20);
    expect(syncSamples()[0].ms).toBe(6);
    expect(medianSync(syncSamples())).toBe(16);
    expect(medianSync([])).toBeNull();
  });

  test("a new round trip is still noticed after the kept list is full", () => {
    for (let i = 1; i <= 25; i++) recordSync(i, "record");
    const mark = syncCount();
    expect(syncSampleSince(mark)).toBeNull();
    recordSync(99, "command");
    expect(syncSamples()).toHaveLength(20);
    expect(syncSampleSince(mark)).toMatchObject({ ms: 99, channel: "command" });
    // A rejected value is not a new round trip.
    const after = syncCount();
    recordSync(Number.NaN, "command");
    expect(syncSampleSince(after)).toBeNull();
  });
});
