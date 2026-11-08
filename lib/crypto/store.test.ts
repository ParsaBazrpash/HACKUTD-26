import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from './keys';
import { generateChannelKeyBytes, importChannelKey } from './seal';
import { IncidentStore, useStoreForTests } from './store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('IncidentStore (IndexedDB)', () => {
  it('stores device keys as non-extractable CryptoKeys and they still work after a round trip', async () => {
    const s = new IncidentStore(A, useStoreForTests('t1'));
    const k = await generateDeviceKeys();
    await s.setDeviceKeys(k);
    const back = await s.getDeviceKeys();
    expect(back).toBeDefined();
    expect(back!.signPriv.extractable).toBe(false);
    expect(back!.signPub).toEqual(k.signPub);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, back!.signPriv, new Uint8Array([1, 2, 3]));
    expect(sig.byteLength).toBe(64);
  });

  it('stores channel keys per kind and epoch, non-extractable', async () => {
    const s = new IncidentStore(A, useStoreForTests('t2'));
    await s.setChannelKey('privileged', 0, await importChannelKey(generateChannelKeyBytes()));
    expect(await s.getChannelKey('privileged', 0)).toBeDefined();
    expect(await s.getChannelKey('privileged', 1)).toBeUndefined();
    expect(await s.getChannelKey('technical', 0)).toBeUndefined();
    await expect(crypto.subtle.exportKey('raw', (await s.getChannelKey('privileged', 0))!)).rejects.toThrow();
  });

  it('pinned heads and counters only advance', async () => {
    const s = new IncidentStore(A, useStoreForTests('t3'));
    await s.advanceHead('record', { seq: 5n, hash: new Uint8Array(32).fill(5) });
    await s.advanceHead('record', { seq: 3n, hash: new Uint8Array(32).fill(3) });
    expect((await s.getHead('record'))!.seq).toBe(5n);
    await s.advanceHead('record', { seq: 6n, hash: new Uint8Array(32).fill(6) });
    expect((await s.getHead('record'))!.seq).toBe(6n);
    await s.advanceCounter(4n);
    await s.advanceCounter(2n);
    expect(await s.getCounter()).toBe(4n);
  });

  it('wipe removes one incident completely and leaves others alone (T13)', async () => {
    const st = useStoreForTests('t4');
    const a = new IncidentStore(A, st);
    const b = new IncidentStore(B, st);
    for (const s of [a, b]) {
      await s.setDeviceKeys(await generateDeviceKeys());
      await s.setChannelKey('record', 0, await importChannelKey(generateChannelKeyBytes()));
      await s.setInvite('aa', { secret: new Uint8Array(32), role: 'counsel', expiresAtMs: 1 });
      await s.advanceHead('record', { seq: 1n, hash: new Uint8Array(32) });
      await s.advanceCounter(3n);
    }
    await a.wipe();
    expect(await a.getDeviceKeys()).toBeUndefined();
    expect(await a.getChannelKey('record', 0)).toBeUndefined();
    expect(await a.getInvite('aa')).toBeUndefined();
    expect(await a.getHead('record')).toBeUndefined();
    expect(await a.getCounter()).toBe(0n);
    expect(await b.getDeviceKeys()).toBeDefined();
    expect(await b.getChannelKey('record', 0)).toBeDefined();
  });
});

describe('OrgStore', () => {
  it('stores only locked org keys, never replaces a cached roster entry, and stays out of the incident lock list', async () => {
    const { OrgStore, lockedIncidentIds, orgIdsOnDevice } = await import('./store');
    const { deriveVault, generateLockedOrgKeys, newVaultId } = await import('./vault');
    const db = useStoreForTests('org1');
    const o = new OrgStore(A, db);
    const { key } = await deriveVault(new Uint8Array(32).fill(1), newVaultId());
    const { record } = await generateLockedOrgKeys(key, A);
    await o.setLockedKeys(record);
    await expect(o.setLockedKeys({ ...record, v: 2 } as never)).rejects.toThrow();
    expect(await orgIdsOnDevice(db)).toEqual([A]);
    expect(await lockedIncidentIds(db)).toEqual([]);

    const e = { identityHex: 'aa', signPub: new Uint8Array(65).fill(4), ecdhPub: new Uint8Array(65).fill(4), sealedContactHash: new Uint8Array(32) };
    await o.addToRoster({ '1': e });
    await o.addToRoster({ '1': { ...e, identityHex: 'bb' }, '2': e });
    const r = await o.getRoster();
    expect(r['1'].identityHex).toBe('aa');
    expect(Object.keys(r).sort()).toEqual(['1', '2']);

    await new OrgStore(B, db).setPin({ adminFingerprint: new Uint8Array(32), role: 'member' });
    await o.wipe();
    expect(await o.getLockedKeys()).toBeUndefined();
    expect(await new OrgStore(B, db).getPin()).toBeDefined();
  });
});
