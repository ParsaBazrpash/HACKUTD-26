// Live blast radius: pure helpers for the map and for live cards in chat.
//
// Everything here reads the folded, verified incident state on this device.
// Nothing is sent to the server, and a card shared to chat carries only a
// pointer, never record data: each reader draws the card from their own record.

import type { MemberRef, ScopeItem } from "@/lib/client/types";
import type { ComputedDeadline } from "@/lib/legal";

// --- Rings -------------------------------------------------------------------

/** Rings from the center out. The dashed edge sits between "suspected" and "unknown". */
export const RINGS = ["exfiltrated", "encrypted", "suspected", "unknown", "closed"] as const;
export type Ring = (typeof RINGS)[number];

const RING_OF_STATUS: Record<string, Ring> = {
  exfiltrated: "exfiltrated",
  encrypted: "encrypted",
  suspected: "suspected",
  unknown: "unknown",
  contained: "closed",
  eradicated: "closed",
  restored: "closed",
};

/** Statuses inside the blast radius (the same set as the overview count). */
export const EXPOSED_STATUSES: ReadonlySet<string> = new Set(["suspected", "encrypted", "exfiltrated"]);

export function ringOf(status: string): Ring {
  return RING_OF_STATUS[status] ?? "unknown";
}

export const VIEW = 440;
export const CENTER = VIEW / 2;
export const RING_RADIUS: Record<Ring, number> = {
  exfiltrated: 62,
  encrypted: 102,
  suspected: 142,
  unknown: 176,
  closed: 206,
};
/** Rings with more nodes than this show the first ones and a "+N" count. */
export const RING_CAP = 28;
/** Systems shown on the map at most; the list under the map still has every system. */
export const NODE_CAP = RINGS.length * RING_CAP;

export interface MapNode {
  itemId: string;
  system: string;
  status: string;
  assetType: string;
  ring: Ring;
  x: number;
  y: number;
  /** Number of versions on the record. Changes when anyone updates the system. */
  version: number;
  recordCount?: number;
  updatedAt: Date | null;
  updatedBy: MemberRef | null;
}

export interface StateExposure {
  code: string;
  /** Residents on systems inside the blast radius. */
  exposed: number;
  /** Residents on systems outside it (unknown or closed). */
  other: number;
  systems: { itemId: string; system: string; status: string; count: number }[];
}

export interface BlastModel {
  nodes: MapNode[];
  hiddenByRing: Record<Ring, number>;
  total: number;
  exposed: number;
  closed: number;
  unknown: number;
  exposedRecords: number;
  /** Exposed systems with no record count yet. */
  uncountedSystems: number;
  euResidents: number;
  states: Map<string, StateExposure>;
  /** Two-letter codes that are not a US state or DC, kept as text. */
  otherCodes: { code: string; exposed: number }[];
  /** Exposed systems holding data that have no resident list yet. */
  unmappedSystems: number;
  lastChange: { itemId: string; system: string; status: string; at: Date; by: MemberRef | null } | null;
}

function finite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function validDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/** Evenly spaced points on a ring; a per-ring offset keeps rings from lining up. */
export function ringPoints(count: number, radius: number, ringIndex: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (count <= 0) return out;
  const start = -Math.PI / 2 + ringIndex * 0.41;
  for (let i = 0; i < count; i++) {
    const angle = start + (i * 2 * Math.PI) / count;
    out.push({
      x: Math.round((CENTER + radius * Math.cos(angle)) * 10) / 10,
      y: Math.round((CENTER + radius * Math.sin(angle)) * 10) / 10,
    });
  }
  return out;
}

export function buildBlastModel(scope: readonly ScopeItem[]): BlastModel {
  const byRing: Record<Ring, ScopeItem[]> = { exfiltrated: [], encrypted: [], suspected: [], unknown: [], closed: [] };
  const states = new Map<string, StateExposure>();
  const other = new Map<string, number>();
  let exposed = 0;
  let closed = 0;
  let unknown = 0;
  let exposedRecords = 0;
  let uncountedSystems = 0;
  let euResidents = 0;
  let unmappedSystems = 0;
  let lastChange: BlastModel["lastChange"] = null;

  for (const item of scope) {
    const body = item?.latest;
    if (!body || typeof item.itemId !== "string") continue;
    const ring = ringOf(body.status);
    byRing[ring].push(item);
    const isExposed = EXPOSED_STATUSES.has(body.status);
    if (isExposed) exposed++;
    else if (ring === "closed") closed++;
    else unknown++;

    if (isExposed) {
      const count = finite(body.recordCount);
      if (count > 0) exposedRecords += count;
      else uncountedSystems++;
      euResidents += finite(body.euResidents);
    }

    const residents = Array.isArray(body.affected) ? body.affected : [];
    const holdsData = Array.isArray(body.dataTypes) && body.dataTypes.length > 0;
    if (isExposed && holdsData && residents.length === 0) unmappedSystems++;
    for (const resident of residents) {
      const count = finite(resident?.count);
      const code = typeof resident?.state === "string" ? resident.state : "";
      if (count === 0 || !/^[A-Z]{2}$/.test(code)) continue;
      if (!US_TILES[code]) {
        if (isExposed) other.set(code, (other.get(code) ?? 0) + count);
        continue;
      }
      const row = states.get(code) ?? { code, exposed: 0, other: 0, systems: [] };
      if (isExposed) row.exposed += count;
      else row.other += count;
      row.systems.push({ itemId: item.itemId, system: body.system, status: body.status, count });
      states.set(code, row);
    }

    const last = item.history?.[item.history.length - 1];
    if (last && validDate(last.at) && (!lastChange || last.at.getTime() > lastChange.at.getTime())) {
      lastChange = { itemId: item.itemId, system: body.system, status: body.status, at: last.at, by: last.by ?? null };
    }
  }

  const nodes: MapNode[] = [];
  const hiddenByRing: Record<Ring, number> = { exfiltrated: 0, encrypted: 0, suspected: 0, unknown: 0, closed: 0 };
  RINGS.forEach((ring, ringIndex) => {
    // Stable order so a node keeps its place until its own ring changes.
    const items = [...byRing[ring]].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    const shown = items.slice(0, RING_CAP);
    hiddenByRing[ring] = items.length - shown.length;
    const points = ringPoints(shown.length, RING_RADIUS[ring], ringIndex);
    shown.forEach((item, i) => {
      const last = item.history?.[item.history.length - 1];
      nodes.push({
        itemId: item.itemId,
        system: item.latest.system,
        status: item.latest.status,
        assetType: item.latest.assetType,
        ring,
        x: points[i].x,
        y: points[i].y,
        version: item.history?.length ?? 1,
        ...(finite(item.latest.recordCount) > 0 ? { recordCount: item.latest.recordCount } : {}),
        updatedAt: last && validDate(last.at) ? last.at : null,
        updatedBy: last?.by ?? null,
      });
    });
  });

  for (const row of states.values()) row.systems.sort((a, b) => b.count - a.count);

  return {
    nodes,
    hiddenByRing,
    total: exposed + closed + unknown,
    exposed,
    closed,
    unknown,
    exposedRecords,
    uncountedSystems,
    euResidents,
    states,
    otherCodes: [...other.entries()].map(([code, n]) => ({ code, exposed: n })).sort((a, b) => b.exposed - a.exposed),
    unmappedSystems,
    lastChange,
  };
}

/** Shade step for a state tile: 0 none, 1 under 250, 2 under 1,000, 3 under 10,000, 4 at 10,000 or more. */
export function exposureStep(count: number): 0 | 1 | 2 | 3 | 4 {
  const n = finite(count);
  if (n === 0) return 0;
  if (n < 250) return 1;
  if (n < 1000) return 2;
  if (n < 10000) return 3;
  return 4;
}

export function shortCount(count: number): string {
  const n = finite(count);
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

/** Legal rows this state's residents bring onto the incident. */
export function stateDeadlines(code: string, deadlines: readonly ComputedDeadline[]): ComputedDeadline[] {
  const lower = code.toLowerCase();
  return deadlines.filter((d) => {
    if (d.applicability === "no") return false;
    if (code === "TX") return d.rule.id === "tx-521-ind" || d.rule.id === "tx-521-ag";
    return d.rule.id === `state-check-${lower}`;
  });
}

export function stateLabel(code: string): string {
  return US_TILES[code]?.name ?? code;
}

// --- US tile grid (50 states and DC), [column, row] on a 12 by 8 grid ----------

export const US_TILES: Record<string, { name: string; col: number; row: number }> = {
  AK: { name: "Alaska", col: 0, row: 0 },
  ME: { name: "Maine", col: 11, row: 0 },
  WI: { name: "Wisconsin", col: 6, row: 1 },
  VT: { name: "Vermont", col: 10, row: 1 },
  NH: { name: "New Hampshire", col: 11, row: 1 },
  WA: { name: "Washington", col: 1, row: 2 },
  ID: { name: "Idaho", col: 2, row: 2 },
  MT: { name: "Montana", col: 3, row: 2 },
  ND: { name: "North Dakota", col: 4, row: 2 },
  MN: { name: "Minnesota", col: 5, row: 2 },
  IL: { name: "Illinois", col: 6, row: 2 },
  MI: { name: "Michigan", col: 7, row: 2 },
  NY: { name: "New York", col: 9, row: 2 },
  MA: { name: "Massachusetts", col: 10, row: 2 },
  OR: { name: "Oregon", col: 1, row: 3 },
  NV: { name: "Nevada", col: 2, row: 3 },
  WY: { name: "Wyoming", col: 3, row: 3 },
  SD: { name: "South Dakota", col: 4, row: 3 },
  IA: { name: "Iowa", col: 5, row: 3 },
  IN: { name: "Indiana", col: 6, row: 3 },
  OH: { name: "Ohio", col: 7, row: 3 },
  PA: { name: "Pennsylvania", col: 8, row: 3 },
  NJ: { name: "New Jersey", col: 9, row: 3 },
  CT: { name: "Connecticut", col: 10, row: 3 },
  RI: { name: "Rhode Island", col: 11, row: 3 },
  CA: { name: "California", col: 1, row: 4 },
  UT: { name: "Utah", col: 2, row: 4 },
  CO: { name: "Colorado", col: 3, row: 4 },
  NE: { name: "Nebraska", col: 4, row: 4 },
  MO: { name: "Missouri", col: 5, row: 4 },
  KY: { name: "Kentucky", col: 6, row: 4 },
  WV: { name: "West Virginia", col: 7, row: 4 },
  VA: { name: "Virginia", col: 8, row: 4 },
  MD: { name: "Maryland", col: 9, row: 4 },
  DE: { name: "Delaware", col: 10, row: 4 },
  AZ: { name: "Arizona", col: 2, row: 5 },
  NM: { name: "New Mexico", col: 3, row: 5 },
  KS: { name: "Kansas", col: 4, row: 5 },
  AR: { name: "Arkansas", col: 5, row: 5 },
  TN: { name: "Tennessee", col: 6, row: 5 },
  NC: { name: "North Carolina", col: 7, row: 5 },
  SC: { name: "South Carolina", col: 8, row: 5 },
  DC: { name: "District of Columbia", col: 9, row: 5 },
  OK: { name: "Oklahoma", col: 4, row: 6 },
  LA: { name: "Louisiana", col: 5, row: 6 },
  MS: { name: "Mississippi", col: 6, row: 6 },
  AL: { name: "Alabama", col: 7, row: 6 },
  GA: { name: "Georgia", col: 8, row: 6 },
  HI: { name: "Hawaii", col: 0, row: 7 },
  TX: { name: "Texas", col: 4, row: 7 },
  FL: { name: "Florida", col: 9, row: 7 },
};

// --- Live cards in chat ----------------------------------------------------------

export type LiveCard = { kind: "blast" } | { kind: "system"; itemId: string } | { kind: "deadline"; ruleId: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RULE_ID = /^[a-z0-9-]{1,40}$/;
// The pointer is the last thing in the message. Anything before it is the author's caption.
const CARD_TOKEN = /\[card:(blast|system:[0-9a-f-]{36}|deadline:[a-z0-9-]{1,40})\]\s*$/;

/** The chat text for a shared card: a readable line plus the pointer. Never any record data. */
export function cardMessageText(card: LiveCard, caption: string): string {
  const line = caption.trim().replace(/\s+/g, " ").slice(0, 300);
  return `${line} ${cardToken(card)}`.trim();
}

export function cardToken(card: LiveCard): string {
  if (card.kind === "blast") return "[card:blast]";
  if (card.kind === "system") return `[card:system:${card.itemId}]`;
  return `[card:deadline:${card.ruleId}]`;
}

/** Finds a card pointer at the end of a chat message. Anything malformed stays plain text. */
export function parseCardMessage(text: string): { caption: string; card: LiveCard } | null {
  if (typeof text !== "string") return null;
  const match = CARD_TOKEN.exec(text);
  if (!match) return null;
  const caption = text.slice(0, match.index).trim();
  const value = match[1];
  if (value === "blast") return { caption, card: { kind: "blast" } };
  if (value.startsWith("system:")) {
    const itemId = value.slice("system:".length);
    return UUID_V4.test(itemId) ? { caption, card: { kind: "system", itemId } } : null;
  }
  const ruleId = value.slice("deadline:".length);
  return RULE_ID.test(ruleId) ? { caption, card: { kind: "deadline", ruleId } } : null;
}

/** Plain-text form of a card message for previews and the printed report. */
export function cardPreviewText(text: string): string {
  const parsed = parseCardMessage(text);
  if (!parsed) return text;
  const what =
    parsed.card.kind === "blast" ? "blast radius" : parsed.card.kind === "system" ? "system" : "legal clock";
  return `${parsed.caption ? `${parsed.caption} ` : ""}[Live card: ${what}]`;
}
