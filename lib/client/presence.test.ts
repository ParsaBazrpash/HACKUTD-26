import { describe, expect, it } from 'vitest';
import { formatAgo, looksStale, presenceFields, presenceMap, STALE_SEAT_MS } from './presence';

const HEX = 'ab'.repeat(32);

describe('presence fields', () => {
  it('says nothing when the backend has no presence (old module or mock)', () => {
    expect(presenceFields(presenceMap(undefined), HEX)).toEqual({});
  });

  it('marks a member offline with no time when the server has never seen them', () => {
    expect(presenceFields(presenceMap([]), HEX)).toEqual({ online: false });
  });

  it('maps connections to online and keeps last seen', () => {
    const map = presenceMap([{ identityHex: HEX, connections: 2, lastSeenMicros: 1_800_000_000_000_000n }]);
    expect(presenceFields(map, HEX)).toEqual({ online: true, lastSeenAt: new Date(1_800_000_000_000) });
    const off = presenceMap([{ identityHex: HEX, connections: 0, lastSeenMicros: 1_800_000_000_000_000n }]);
    expect(presenceFields(off, HEX).online).toBe(false);
  });
});

describe('stale seat hint', () => {
  const now = 1_800_000_000_000;
  it('only flags active members who are offline long enough or never seen', () => {
    expect(looksStale({ state: 'active', online: false }, now)).toBe(true);
    expect(looksStale({ state: 'active', online: false, lastSeenAt: new Date(now - STALE_SEAT_MS) }, now)).toBe(true);
    expect(looksStale({ state: 'active', online: false, lastSeenAt: new Date(now - 60_000) }, now)).toBe(false);
    expect(looksStale({ state: 'active', online: true }, now)).toBe(false);
    // Unknown presence never triggers the hint.
    expect(looksStale({ state: 'active' }, now)).toBe(false);
    expect(looksStale({ state: 'pending', online: false }, now)).toBe(false);
    expect(looksStale({ state: 'revoked', online: false }, now)).toBe(false);
  });

  it('formats how long ago', () => {
    expect(formatAgo(new Date(now - 10_000), now)).toBe('just now');
    expect(formatAgo(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
    expect(formatAgo(new Date(now - 3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatAgo(new Date(now - 72 * 3_600_000), now)).toBe('3 days ago');
    expect(formatAgo(new Date(now + 60_000), now)).toBe('just now');
  });
});
