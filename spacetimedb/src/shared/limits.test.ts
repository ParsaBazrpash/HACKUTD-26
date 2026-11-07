import { describe, expect, it } from 'vitest';
import { displayNameKey, isIdentityHex, isUuidV4, isValidDisplayName, MAX_DISPLAY_NAME, normalizeDisplayName } from './limits';

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

describe('display names (T15)', () => {
  it('applies NFKC, so look-alike compatibility forms collapse', () => {
    expect(normalizeDisplayName(cp(0xff21, 0xff22))).toBe('AB'); // fullwidth AB
    expect(normalizeDisplayName(cp(0xfb01))).toBe('fi'); // ligature
  });
  it('strips control and bidi characters', () => {
    expect(normalizeDisplayName('Da' + cp(0x202e) + 'na')).toBe('Dana');
    expect(normalizeDisplayName('Da' + cp(0x0007) + 'na')).toBe('Dana');
    expect(normalizeDisplayName(cp(0x2066) + 'Dana' + cp(0x2069))).toBe('Dana');
    expect(normalizeDisplayName('Da' + cp(0x200b) + 'na')).toBe('Dana');
    expect(normalizeDisplayName('Da' + cp(0x0085) + 'na')).toBe('Dana');
  });
  it('trims and validates length by code points', () => {
    expect(normalizeDisplayName('  Dana  ')).toBe('Dana');
    expect(isValidDisplayName('')).toBe(false);
    expect(isValidDisplayName('a'.repeat(MAX_DISPLAY_NAME))).toBe(true);
    expect(isValidDisplayName('a'.repeat(MAX_DISPLAY_NAME + 1))).toBe(false);
    expect(isValidDisplayName(cp(0x1f600).repeat(MAX_DISPLAY_NAME))).toBe(true);
  });
  it('a name made only of stripped characters becomes empty and invalid', () => {
    expect(isValidDisplayName(normalizeDisplayName(cp(0x202e, 0x200b, 0x0007)))).toBe(false);
  });
  it('case-insensitive key collapses case', () => {
    expect(displayNameKey('Dana')).toBe(displayNameKey('dANA'));
  });
});

describe('id validators', () => {
  it('accepts v4 uuids and rejects others', () => {
    expect(isUuidV4('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuidV4('11111111-1111-1111-8111-111111111111')).toBe(false); // v1
    expect(isUuidV4('11111111-1111-4111-8111-11111111111G')).toBe(false);
    expect(isUuidV4('11111111-1111-4111-8111-111111111111 ')).toBe(false);
    expect(isUuidV4(5)).toBe(false);
  });
  it('identity hex is exactly 64 lowercase hex chars', () => {
    expect(isIdentityHex('a'.repeat(64))).toBe(true);
    expect(isIdentityHex('A'.repeat(64))).toBe(false);
    expect(isIdentityHex('a'.repeat(63))).toBe(false);
  });
});
