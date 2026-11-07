import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from './keys';
import { sign, verify } from './sign';

const msg = new TextEncoder().encode('canonical statement bytes');

describe('sign and verify', () => {
  it('round trips and produces 64-byte signatures', async () => {
    const k = await generateDeviceKeys();
    const sig = await sign(k.signPriv, msg);
    expect(sig.length).toBe(64);
    expect(await verify(k.signPub, msg, sig)).toBe(true);
  });

  it('fails for a different key, message, or signature', async () => {
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();
    const sig = await sign(a.signPriv, msg);
    expect(await verify(b.signPub, msg, sig)).toBe(false);
    expect(await verify(a.signPub, new TextEncoder().encode('other'), sig)).toBe(false);
    const flipped = sig.slice();
    flipped[10] ^= 1;
    expect(await verify(a.signPub, msg, flipped)).toBe(false);
    const swapped = await sign(b.signPriv, msg);
    expect(await verify(a.signPub, msg, swapped)).toBe(false);
  });

  it('never throws on malformed input', async () => {
    const a = await generateDeviceKeys();
    const sig = await sign(a.signPriv, msg);
    expect(await verify(a.signPub, msg, sig.slice(0, 63))).toBe(false);
    expect(await verify(new Uint8Array(65), msg, sig)).toBe(false);
    expect(await verify(new Uint8Array(3), msg, sig)).toBe(false);
  });

  it('is compatible with @noble/curves p256.verify (the module uses it)', async () => {
    const k = await generateDeviceKeys();
    const sig = await sign(k.signPriv, msg);
    // Web Crypto hashes the message with SHA-256 internally; give noble the digest.
    expect(p256.verify(sig, sha256(msg), k.signPub, { lowS: false, prehash: false })).toBe(true);
    const bad = sig.slice();
    bad[0] ^= 1;
    expect(p256.verify(bad, sha256(msg), k.signPub, { lowS: false, prehash: false })).toBe(false);
    // and with prehash, noble hashes for us with the curve's default hash (SHA-256)
    expect(p256.verify(sig, msg, k.signPub, { lowS: false, prehash: true })).toBe(true);
  });
});
