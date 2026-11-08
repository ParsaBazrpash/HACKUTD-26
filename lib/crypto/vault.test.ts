import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateChannelKeyBytes } from './seal';
import { IncidentStore, lockedIncidentIds, useStoreForTests } from './store';
import { unwrapChannelKey, wrapChannelKey } from './wrap';
import {
  deriveVault,
  generateLockedDeviceKeys,
  isLockedDeviceKeys,
  type LockedDeviceKeys,
  newVaultId,
  openLockedDeviceKeys,
  vaultPrfSalt,
  verifierMatches,
} from './vault';
import { importSignPub } from './keys';
import { sign } from './sign';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const prf = (fill: number) => new Uint8Array(32).fill(fill);

async function vault(fill = 7, vaultId = newVaultId()) {
  return (await deriveVault(prf(fill), vaultId)).key;
}

const flip = (b: Uint8Array, i = 0) => {
  const c = b.slice();
  c[i] ^= 1;
  return c;
};

describe('passkey vault (T20, T36)', () => {
  it('derives the same key and verifier from the same PRF output, and a different one otherwise', async () => {
    const id = newVaultId();
    const a = await deriveVault(prf(1), id);
    const b = await deriveVault(prf(1), id);
    const c = await deriveVault(prf(2), id);
    const d = await deriveVault(prf(1), newVaultId());
    expect(verifierMatches(a.verifier, b.verifier)).toBe(true);
    expect(verifierMatches(a.verifier, c.verifier)).toBe(false);
    expect(verifierMatches(a.verifier, d.verifier)).toBe(false);
    expect(a.key.kek.extractable).toBe(false);
    expect(a.key.kek.usages.sort()).toEqual(['unwrapKey', 'wrapKey']);
    await expect(deriveVault(new Uint8Array(16), id)).rejects.toThrow();
    expect(vaultPrfSalt(id)).toEqual(vaultPrfSalt(id));
    expect(vaultPrfSalt(id)).not.toEqual(vaultPrfSalt(newVaultId()));
  });

  it('locked keys open as working non-extractable keys that match the stored public keys', async () => {
    const v = await vault();
    const { record, keys } = await generateLockedDeviceKeys(v, A);
    expect(isLockedDeviceKeys(record)).toBe(true);
    for (const k of [keys.signPriv, keys.ecdhPriv]) expect(k.extractable).toBe(false);

    const opened = (await openLockedDeviceKeys(v, record, A))!;
    expect(opened).not.toBeNull();
    expect(opened.signPriv.extractable).toBe(false);
    expect(opened.ecdhPriv.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', opened.signPriv)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', opened.ecdhPriv)).rejects.toThrow();

    // The signing key belongs to signPub.
    const msg = new Uint8Array([1, 2, 3]);
    const sig = await sign(opened.signPriv, msg);
    const pub = await importSignPub(record.signPub);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig as BufferSource, msg)).toBe(true);

    // The ECDH key belongs to ecdhPub: a channel key wrapped to it unwraps.
    const raw = generateChannelKeyBytes();
    const ctx = { incidentId: A, kind: 'record', epoch: 0, recipientIdentityHex: 'ab'.repeat(32) };
    const w = await wrapChannelKey(opened.ecdhPriv, record.ecdhPub, ctx, raw);
    expect(await unwrapChannelKey(keys.ecdhPriv, record.ecdhPub, ctx, w)).toEqual(raw);
  });

  it('the stored record holds no usable private key', async () => {
    const { record } = await generateLockedDeviceKeys(await vault(), A);
    for (const value of Object.values(record)) expect(value).not.toBeInstanceOf(CryptoKey);
    // PKCS#8 for P-256 is 138 bytes; the stored form is that plus a 16-byte GCM tag, not the plain encoding.
    expect(record.signWrapped.length).toBe(138 + 16);
    expect(record.ecdhWrapped.length).toBe(138 + 16);
  });

  it('a different passkey, vault or incident cannot open the record', async () => {
    const id = newVaultId();
    const v = await vault(7, id);
    const { record } = await generateLockedDeviceKeys(v, A);
    expect(await openLockedDeviceKeys(await vault(8, id), record, A)).toBeNull(); // wrong passkey, same vault id
    expect(await openLockedDeviceKeys(await vault(7), record, A)).toBeNull(); // another vault
    expect(await openLockedDeviceKeys(v, record, B)).toBeNull(); // another incident
  });

  it('any edit, swap or field substitution in the record fails to open', async () => {
    const v = await vault();
    const { record } = await generateLockedDeviceKeys(v, A);
    const { record: other } = await generateLockedDeviceKeys(v, A);
    const cases: LockedDeviceKeys[] = [
      { ...record, signWrapped: flip(record.signWrapped, 20) },
      { ...record, ecdhWrapped: flip(record.ecdhWrapped, 20) },
      { ...record, signIv: flip(record.signIv) },
      // Swap the two wrapped keys (sign <-> ecdh).
      { ...record, signWrapped: record.ecdhWrapped, signIv: record.ecdhIv, ecdhWrapped: record.signWrapped, ecdhIv: record.signIv },
      // Keep this record's ciphertext but present another identity's public keys.
      { ...record, signPub: other.signPub, ecdhPub: other.ecdhPub },
      // Graft another record's signing key in.
      { ...record, signWrapped: other.signWrapped, signIv: other.signIv },
    ];
    for (const c of cases) expect(await openLockedDeviceKeys(v, c, A)).toBeNull();
    expect(await openLockedDeviceKeys(v, { ...record, vaultId: newVaultId() }, A)).toBeNull();
    expect(isLockedDeviceKeys({ ...record, v: 2 })).toBe(false);
    expect(isLockedDeviceKeys({ ...record, signIv: new Uint8Array(5) })).toBe(false);
  });

  it('a locked store keeps no channel keys and reports which incidents are locked', async () => {
    const st = useStoreForTests('vault-store');
    const v = await vault();
    const locked = new IncidentStore(A, st);
    const plain = new IncidentStore(B, st);
    const { record } = await generateLockedDeviceKeys(v, A);
    await locked.setLockedDeviceKeys(record);
    const { keys } = await generateLockedDeviceKeys(v, B);
    await plain.setDeviceKeys(keys);

    expect(await locked.isPasskeyLocked()).toBe(true);
    expect(await locked.getDeviceKeys()).toBeUndefined();
    expect(isLockedDeviceKeys(await locked.getDeviceRecord())).toBe(true);
    expect(await plain.isPasskeyLocked()).toBe(false);
    expect(await lockedIncidentIds(st)).toEqual([A]);

    const ck = await crypto.subtle.importKey('raw', generateChannelKeyBytes() as BufferSource, 'AES-GCM', false, ['encrypt']);
    await locked.setChannelKey('record', 0, ck);
    await plain.setChannelKey('record', 0, ck);
    expect(await locked.getChannelKey('record', 0)).toBeUndefined();
    expect(await plain.getChannelKey('record', 0)).toBeDefined();

    await expect(locked.setLockedDeviceKeys({ ...record, v: 2 } as unknown as LockedDeviceKeys)).rejects.toThrow();
  });
});
