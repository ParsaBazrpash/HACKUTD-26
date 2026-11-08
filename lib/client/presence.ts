// Live presence helpers (my_presence view). Presence says whether a person's browser is connected
// right now. It is not proof of anything: the server reports it, and a dishonest server could lie.
// It only helps the commander notice a seat nobody is using any more.

import type { PresenceRow } from './backend';
import type { MemberView } from './types';

/** Identity hex to presence row. Undefined when this backend has no presence (old module, mock). */
export function presenceMap(rows: readonly PresenceRow[] | undefined): ReadonlyMap<string, PresenceRow> | undefined {
  if (!rows) return undefined;
  return new Map(rows.map((r) => [r.identityHex, r]));
}

/** The MemberView presence fields. Unknown presence leaves both unset so the UI says nothing. */
export function presenceFields(
  map: ReadonlyMap<string, PresenceRow> | undefined,
  identityHex: string,
): Pick<MemberView, 'online' | 'lastSeenAt'> {
  if (!map) return {};
  const row = map.get(identityHex);
  if (!row) return { online: false };
  return { online: row.connections > 0, lastSeenAt: new Date(Number(row.lastSeenMicros / 1000n)) };
}

/** An active seat with no browser connected for this long gets the "may have lost access" hint. */
export const STALE_SEAT_MS = 30 * 60 * 1000;

/** True when an active member looks like nobody is using the seat: offline and not seen for a while (or never). */
export function looksStale(member: Pick<MemberView, 'state' | 'online' | 'lastSeenAt'>, nowMs: number): boolean {
  if (member.state !== 'active' || member.online !== false) return false;
  if (!member.lastSeenAt) return true;
  return nowMs - member.lastSeenAt.getTime() >= STALE_SEAT_MS;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAgo(at: Date, nowMs: number): string {
  const ms = Math.max(0, nowMs - at.getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
