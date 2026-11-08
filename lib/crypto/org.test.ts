import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from './keys';
import {
  computeEnrollJoinTag,
  enrollLinkHash,
  openContact,
  orgSafetyCode,
  sealContact,
  signEnrollment,
  signPageRequest,
  signRevocation,
  verifyEnrollJoinTag,
  verifyEnrollment,
  verifyPageRequest,
  verifyRevocation,
  type EnrollmentFields,
} from './org';
import { contactAad, contactSalt } from '@/lib/protocol/org';
import { SEALED_CONTACT_LEN } from '@/spacetimedb/src/shared/org';

const orgId = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const incidentId = '33333333-3333-4333-8333-333333333333';
const pageId = '44444444-4444-4444-8444-444444444444';
const idA = 'ab'.repeat(32);
const idB = 'cd'.repeat(32);
const PHONE = '+15551234567';

async function pagerKeys() {
  const p = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { priv: p.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey('raw', p.publicKey)) };
}

async function enrollFields(): Promise<EnrollmentFields> {
  const k = await generateDeviceKeys();
  const pager = await pagerKeys();
  return {
    orgId,
    identityHex: idA,
    displayName: 'Dana',
    signPub: k.signPub,
    ecdhPub: k.ecdhPub,
    sealedContact: await sealContact(pager.pub, orgId, idA, PHONE),
  };
}

describe('enrollment certificate', () => {
  it('verifies and rejects wrong key or any edited field', async () => {
    const admin = await generateDeviceKeys();
    const other = await generateDeviceKeys();
    const f = await enrollFields();
    const sig = await signEnrollment(admin.signPriv, f);
    expect(sig.length).toBe(64);
    expect(await verifyEnrollment(admin.signPub, f, sig)).toBe(true);
    expect(await verifyEnrollment(other.signPub, f, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, { ...f, orgId: otherOrg }, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, { ...f, identityHex: idB }, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, { ...f, displayName: 'Dane' }, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, { ...f, signPub: other.signPub }, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, { ...f, ecdhPub: other.ecdhPub }, sig)).toBe(false);
    const swapped = f.sealedContact.slice();
    swapped[swapped.length - 1] ^= 1;
    expect(await verifyEnrollment(admin.signPub, { ...f, sealedContact: swapped }, sig)).toBe(false);
    expect(await verifyEnrollment(admin.signPub, f, sig.slice(0, 63))).toBe(false);
    expect(await verifyEnrollment(new Uint8Array(65), f, sig)).toBe(false);
  });
});

describe('revocation', () => {
  it('verifies and rejects edits', async () => {
    const admin = await generateDeviceKeys();
    const other = await generateDeviceKeys();
    const f = { orgId, orgMemberId: 7n, identityHex: idA, reason: 'lost phone' };
    const sig = await signRevocation(admin.signPriv, f);
    expect(await verifyRevocation(admin.signPub, f, sig)).toBe(true);
    expect(await verifyRevocation(other.signPub, f, sig)).toBe(false);
    expect(await verifyRevocation(admin.signPub, { ...f, orgMemberId: 8n }, sig)).toBe(false);
    expect(await verifyRevocation(admin.signPub, { ...f, orgId: otherOrg }, sig)).toBe(false);
    expect(await verifyRevocation(admin.signPub, { ...f, identityHex: idB }, sig)).toBe(false);
    expect(await verifyRevocation(admin.signPub, { ...f, reason: 'other' }, sig)).toBe(false);
  });

  it('is not interchangeable with an enrollment signature (domain separation)', async () => {
    const admin = await generateDeviceKeys();
    const f = await enrollFields();
    const sig = await signEnrollment(admin.signPriv, f);
    expect(await verifyRevocation(admin.signPub, { orgId, orgMemberId: 1n, identityHex: idA, reason: 'x' }, sig)).toBe(false);
  });
});

describe('page request', () => {
  const T = (id: bigint, h: string) => ({ orgMemberId: id, identityHex: h.repeat(32) });
  const t1 = T(1n, 'a1');
  const t2 = T(2n, 'b2');
  const t3 = T(3n, 'c3');
  const base = { orgId, incidentId, pageId, sentAtMs: 1_800_000_000_000, targets: [t3, t1, t2] };

  it('verifies, ignores target order, and rejects edits', async () => {
    const cmd = await generateDeviceKeys();
    const other = await generateDeviceKeys();
    const sig = await signPageRequest(cmd.signPriv, base);
    expect(await verifyPageRequest(cmd.signPub, base, sig)).toBe(true);
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: [t2, t3, t1] }, sig)).toBe(true);
    expect(await verifyPageRequest(other.signPub, base, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: [t1, t2] }, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: [...base.targets, T(4n, 'd4')] }, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, orgId: otherOrg }, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, incidentId: otherOrg }, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, pageId: otherOrg }, sig)).toBe(false);
    expect(await verifyPageRequest(cmd.signPub, { ...base, sentAtMs: base.sentAtMs + 1 }, sig)).toBe(false);
  });

  it('binds each id to its identity: swapping or changing one fails', async () => {
    const cmd = await generateDeviceKeys();
    const sig = await signPageRequest(cmd.signPriv, base);
    // Same two identities, ids exchanged.
    const swapped = [T(1n, 'b2'), T(2n, 'a1'), t3];
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: swapped }, sig)).toBe(false);
    // Right id, a different person's identity.
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: [t3, T(1n, 'ee'), t2] }, sig)).toBe(false);
  });

  it('refuses duplicate ids or identities', async () => {
    const cmd = await generateDeviceKeys();
    await expect(signPageRequest(cmd.signPriv, { ...base, targets: [t1, t1] })).rejects.toThrow();
    await expect(signPageRequest(cmd.signPriv, { ...base, targets: [t1, T(2n, 'a1')] })).rejects.toThrow();
    const sig = await signPageRequest(cmd.signPriv, base);
    expect(await verifyPageRequest(cmd.signPub, { ...base, targets: [t1, t1] }, sig)).toBe(false);
  });
});

describe('sealed contact', () => {
  it('round trips and produces fresh ciphertext each time', async () => {
    const p = await pagerKeys();
    const a = await sealContact(p.pub, orgId, idA, PHONE);
    const b = await sealContact(p.pub, orgId, idA, PHONE);
    expect(a).not.toEqual(b);
    expect(a.length).toBe(SEALED_CONTACT_LEN);
    expect(await openContact(p.priv, orgId, idA, a)).toBe(PHONE);
    expect(await openContact(p.priv, orgId, idA, b)).toBe(PHONE);
  });

  it('hides the digit count: every number seals to 109 bytes and round trips', async () => {
    const p = await pagerKeys();
    for (const n of ['+12345678', '+123456789012', '+123456789012345']) {
      const sealed = await sealContact(p.pub, orgId, idA, n);
      expect(sealed.length).toBe(109);
      expect(await openContact(p.priv, orgId, idA, sealed)).toBe(n);
    }
  });

  it('does not contain the number in the clear', async () => {
    const p = await pagerKeys();
    const a = await sealContact(p.pub, orgId, idA, PHONE);
    expect(new TextDecoder('latin1').decode(a)).not.toContain('5551234567');
  });

  it('fails with the wrong pager key', async () => {
    const p = await pagerKeys();
    const q = await pagerKeys();
    const a = await sealContact(p.pub, orgId, idA, PHONE);
    expect(await openContact(q.priv, orgId, idA, a)).toBeNull();
  });

  it('fails when the AAD is swapped (other org or other member)', async () => {
    const p = await pagerKeys();
    const a = await sealContact(p.pub, orgId, idA, PHONE);
    expect(await openContact(p.priv, otherOrg, idA, a)).toBeNull();
    expect(await openContact(p.priv, orgId, idB, a)).toBeNull();
  });

  it('fails on an edited, truncated, extended or malformed blob', async () => {
    const p = await pagerKeys();
    const a = await sealContact(p.pub, orgId, idA, PHONE);
    for (const i of [0, 3, 65, 70, 77, a.length - 1]) {
      const c = a.slice();
      c[i] ^= 1;
      expect(await openContact(p.priv, orgId, idA, c), `byte ${i}`).toBeNull();
    }
    expect(await openContact(p.priv, orgId, idA, a.slice(0, a.length - 1))).toBeNull();
    expect(await openContact(p.priv, orgId, idA, a.slice(0, 80))).toBeNull();
    expect(await openContact(p.priv, orgId, idA, new Uint8Array(0))).toBeNull();
    const longer = new Uint8Array(a.length + 1);
    longer.set(a);
    expect(await openContact(p.priv, orgId, idA, longer)).toBeNull();
  });

  it('refuses to seal anything that is not E.164', async () => {
    const p = await pagerKeys();
    for (const bad of ['5551234567', '+1 555 123 4567', '+1555', '+1555123456789012', '+0555123456', '+1555abc4567', '', '+15551234567\n']) {
      await expect(sealContact(p.pub, orgId, idA, bad), bad).rejects.toThrow();
    }
  });

  it('refuses to open a validly sealed blob whose plaintext is not E.164', async () => {
    // Same ECDH, HKDF and AES-GCM steps as sealContact, but the plaintext skips the E.164 check.
    const p = await pagerKeys();
    async function sealRaw(plaintext: string | Uint8Array, pad = true): Promise<Uint8Array> {
      const bytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
      const body = pad ? Uint8Array.from({ length: 16 }, (_, i) => bytes[i] ?? 0) : bytes;
      const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
      const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
      const peer = await crypto.subtle.importKey('raw', p.pub as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256);
      const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: contactSalt(orgId) as BufferSource, info: contactAad(orgId, idA) as BufferSource },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: contactAad(orgId, idA) as BufferSource },
          key,
          body as BufferSource,
        ),
      );
      return Uint8Array.from([...ephPub, ...iv, ...ct]);
    }
    // Control: the helper produces a blob openContact accepts when the plaintext is valid.
    expect(await openContact(p.priv, orgId, idA, await sealRaw('+442071234567'))).toBe('+442071234567');
    // Properly padded and sized, so only the E.164 check can reject these.
    for (const bad of ['5551234567890', '+1 555 123 45', 'abcdefghijkl', '+0555123456789']) {
      expect(await openContact(p.priv, orgId, idA, await sealRaw(bad)), bad).toBeNull();
    }
    // Wrong plaintext length (no padding): rejected even though the number itself is valid.
    expect(await openContact(p.priv, orgId, idA, await sealRaw('+442071234567', false))).toBeNull();
    // Zero byte in the middle, number after it: padding must be trailing only.
    const gap = new Uint8Array(16);
    gap.set(new TextEncoder().encode('+442071234567'), 0); // a valid number on its own
    gap[14] = 0x37; // stray byte after the padding starts
    expect(await openContact(p.priv, orgId, idA, await sealRaw(gap, false))).toBeNull();
    // All padding, empty number.
    expect(await openContact(p.priv, orgId, idA, await sealRaw(new Uint8Array(16), false))).toBeNull();
  });
});

describe('enrollment link tag', () => {
  it('hashes the code under the org and authenticates the join under the secret', async () => {
    const code = new Uint8Array(16).fill(5);
    expect(enrollLinkHash(orgId, code)).toEqual(enrollLinkHash(orgId, code));
    expect(enrollLinkHash(otherOrg, code)).not.toEqual(enrollLinkHash(orgId, code));
    const secret = new Uint8Array(32).fill(9);
    const f = await enrollFields();
    const tag = await computeEnrollJoinTag(secret, f);
    expect(await verifyEnrollJoinTag(secret, f, tag)).toBe(true);
    expect(await verifyEnrollJoinTag(new Uint8Array(32).fill(1), f, tag)).toBe(false);
    expect(await verifyEnrollJoinTag(secret, { ...f, displayName: 'Eve' }, tag)).toBe(false);
    expect(await verifyEnrollJoinTag(secret, f, tag.slice(0, 31))).toBe(false);
  });
});

describe('org safety code', () => {
  it('is stable, formatted, and bound to every input', async () => {
    const a = await generateDeviceKeys();
    const b = await generateDeviceKeys();
    const c = orgSafetyCode(orgId, idA, a.signPub, a.ecdhPub);
    expect(c).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(orgSafetyCode(orgId, idA, a.signPub, a.ecdhPub)).toBe(c);
    expect(orgSafetyCode(otherOrg, idA, a.signPub, a.ecdhPub)).not.toBe(c);
    expect(orgSafetyCode(orgId, idB, a.signPub, a.ecdhPub)).not.toBe(c);
    expect(orgSafetyCode(orgId, idA, b.signPub, a.ecdhPub)).not.toBe(c);
    expect(orgSafetyCode(orgId, idA, a.signPub, b.ecdhPub)).not.toBe(c);
  });
});
