import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode } from './b64url';

describe('b64url', () => {
  it('matches Node base64url for many lengths', () => {
    for (let n = 0; n < 70; n++) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      const expected = Buffer.from(b).toString('base64url');
      expect(b64urlEncode(b)).toBe(expected);
      expect(b64urlDecode(expected)).toEqual(b);
    }
  });
  it('rejects padding, other alphabets, whitespace and non-canonical tails', () => {
    expect(() => b64urlDecode('QQ==')).toThrow();
    expect(() => b64urlDecode('a+b/')).toThrow();
    expect(() => b64urlDecode('ab cd')).toThrow();
    expect(() => b64urlDecode('A')).toThrow(); // impossible length
    expect(() => b64urlDecode('QR')).toThrow(); // trailing bits not zero ("QQ" is canonical)
    expect(b64urlDecode('QQ')).toEqual(new Uint8Array([0x41]));
  });
});
