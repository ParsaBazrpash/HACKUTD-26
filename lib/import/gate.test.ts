import { describe, expect, it } from 'vitest';
import { canSend, findDuplicate, startsChecked } from '@/lib/import/gate';

const H = 'a'.repeat(64);
const ev = (sha256: string, who: string) => ({ body: { sha256 }, who });

describe('the duplicate block and the starting checkboxes', () => {
  it('finds an evidence row with the same hash and not one with another hash', () => {
    const list = [ev('b'.repeat(64), 'x'), ev(H, 'Alex')];
    expect(findDuplicate(list, H)?.who).toBe('Alex');
    expect(findDuplicate(list, 'c'.repeat(64))).toBeUndefined();
    expect(findDuplicate([], H)).toBeUndefined();
  });

  it('a duplicate blocks sending until "Import again anyway" is ticked', () => {
    const base = { total: 3, sending: false, sent: false };
    expect(canSend({ ...base, duplicate: true, again: false })).toBe(false);
    expect(canSend({ ...base, duplicate: true, again: true })).toBe(true);
    expect(canSend({ ...base, duplicate: false, again: false })).toBe(true);
  });

  it('nothing selected, a running send or a finished send blocks sending', () => {
    const base = { duplicate: false, again: false };
    expect(canSend({ ...base, total: 0, sending: false, sent: false })).toBe(false);
    expect(canSend({ ...base, total: 2, sending: true, sent: false })).toBe(false);
    expect(canSend({ ...base, total: 2, sending: false, sent: true })).toBe(false);
  });

  it('flagged rows start unchecked and clean rows start checked', () => {
    expect(startsChecked([])).toBe(true);
    expect(startsChecked(['older than 30 days'])).toBe(false);
    expect(startsChecked(['no time zone, read as UTC', 'older than 30 days'])).toBe(false);
  });
});
