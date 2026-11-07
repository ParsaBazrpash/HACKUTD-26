import { describe, expect, it } from 'vitest';
import { fingerprint, fingerprintBytes, generateDeviceKeys, importEcdhPub, importSignPub, isRawPublicKey, safetyCode } from './keys';

describe('device keys', () => {
  it('generates 65-byte public keys and non-extractable private keys', async () => {
    const k = await generateDeviceKeys();
    expect(k.signPub.length).toBe(65);
    expect(k.ecdhPub.length).toBe(65);
    expect(k.signPub[0]).toBe(4);
    expect(k.signPriv.extractable).toBe(false);
    expect(k.ecdhPriv.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', k.signPriv)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', k.ecdhPriv)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', k.ecdhPriv)).rejects.toThrow();
  });

  it('rejects malformed or off-curve public keys', async () => {
    const k = await generateDeviceKeys();
    expect(isRawPublicKey(k.signPub)).toBe(true);
    expect(isRawPublicKey(k.signPub.slice(0, 64))).toBe(false);
    const compressedMarker = k.signPub.slice();
    compressedMarker[0] = 2;
    expect(isRawPublicKey(compressedMarker)).toBe(false);
    await expect(importSignPub(compressedMarker)).rejects.toThrow();
    const offCurve = k.signPub.slice();
    offCurve[64] ^= 1; // flip a coordinate bit
    await expect(importSignPub(offCurve)).rejects.toThrow();
    await expect(importEcdhPub(offCurve)).rejects.toThrow();
  });

  it('fingerprint is 8 groups of 4 hex and depends on both keys', async () => {
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();
    expect(fingerprint(a.signPub, a.ecdhPub)).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
    expect(fingerprint(a.signPub, a.ecdhPub)).not.toBe(fingerprint(a.signPub, b.ecdhPub));
    expect(fingerprint(a.signPub, a.ecdhPub)).not.toBe(fingerprint(b.signPub, a.ecdhPub));
    expect(fingerprintBytes(a.signPub, a.ecdhPub).length).toBe(32);
  });

  it('safety code is 12 digits in 4 groups and binds incident, identity and keys', async () => {
    const a = await generateDeviceKeys();
    const id = 'ab'.repeat(32);
    const inc = '11111111-1111-4111-8111-111111111111';
    const code = safetyCode(inc, id, a.signPub, a.ecdhPub);
    expect(code).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(safetyCode(inc, id, a.signPub, a.ecdhPub)).toBe(code);
    expect(safetyCode(inc, 'cd'.repeat(32), a.signPub, a.ecdhPub)).not.toBe(code);
    expect(safetyCode('22222222-2222-4222-8222-222222222222', id, a.signPub, a.ecdhPub)).not.toBe(code);
    const b = await generateDeviceKeys();
    expect(safetyCode(inc, id, b.signPub, a.ecdhPub)).not.toBe(code);
  });
});
