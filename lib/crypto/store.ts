// Local persistence in IndexedDB via idb-keyval (docs/PLAN.md 6.5).
//
// Per incident: device key pairs (private keys are non-extractable CryptoKeys,
// stored by structured clone and never exported), the pinned commander keys,
// unwrapped channel keys (non-extractable), invite secrets (commander only),
// pinned chain heads and the last author counter. Nothing else persists.
// Callers must never log anything read from here.
//
// With the passkey lock on (lib/crypto/vault.ts), the device keys are stored
// as a LockedDeviceKeys record (ciphertext plus public keys) and channel keys
// are not stored at all: after unlock they are unwrapped again from the
// server's envelopes and held in memory only.

import { createStore, del, get, keys as idbKeys, set, type UseStore } from 'idb-keyval';
import type { ChannelKind } from '@/spacetimedb/src/shared/policy';
import type { Role } from '@/spacetimedb/src/shared/policy';
import type { DeviceKeys } from './keys';
import { isLockedDeviceKeys, type LockedDeviceKeys } from './vault';

export interface PinnedCommander {
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  fingerprint: Uint8Array; // full 32 bytes
}

export interface StoredInvite {
  secret: Uint8Array;
  role: Role;
  expiresAtMs: number;
}

export interface StoredHead {
  seq: bigint;
  hash: Uint8Array;
}

let defaultStore: UseStore | null = null;
function db(): UseStore {
  defaultStore ??= createStore('zerohour', 'v1');
  return defaultStore;
}

/** The browser's default key store, shared with the passkey vault record. */
export function defaultKeyStore(): UseStore {
  return db();
}

/** Incident ids whose device keys are passkey-locked in this store. */
export async function lockedIncidentIds(store: UseStore = db()): Promise<string[]> {
  const out: string[] = [];
  for (const key of await idbKeys(store)) {
    if (typeof key !== 'string' || !key.endsWith('/device')) continue;
    const id = key.slice(0, -'/device'.length);
    if (isLockedDeviceKeys(await get(key, store))) out.push(id);
  }
  return out;
}

/** For tests: use a fresh isolated store. */
export function useStoreForTests(name: string): UseStore {
  return createStore(name, 'v1');
}

const k = (incidentId: string, part: string) => `${incidentId}/${part}`;

export class IncidentStore {
  constructor(
    readonly incidentId: string,
    private readonly store: UseStore = db(),
  ) {}

  // --- device keys
  /** Whatever is stored for this device: plain keys, a passkey-locked record, or nothing. */
  getDeviceRecord(): Promise<DeviceKeys | LockedDeviceKeys | undefined> {
    return get<DeviceKeys | LockedDeviceKeys>(k(this.incidentId, 'device'), this.store);
  }
  /** Plain (not passkey-locked) device keys, if that is what is stored. */
  async getDeviceKeys(): Promise<DeviceKeys | undefined> {
    const r = await this.getDeviceRecord();
    return r && !isLockedDeviceKeys(r) ? r : undefined;
  }
  setDeviceKeys(v: DeviceKeys): Promise<void> {
    return set(k(this.incidentId, 'device'), v, this.store);
  }
  setLockedDeviceKeys(v: LockedDeviceKeys): Promise<void> {
    if (!isLockedDeviceKeys(v)) return Promise.reject(new TypeError('invalid locked device keys'));
    return set(k(this.incidentId, 'device'), v, this.store);
  }
  /** True when this incident's device keys are passkey-locked. */
  async isPasskeyLocked(): Promise<boolean> {
    return isLockedDeviceKeys(await this.getDeviceRecord());
  }

  // --- pinned commander
  getCommander(): Promise<PinnedCommander | undefined> {
    return get<PinnedCommander>(k(this.incidentId, 'commander'), this.store);
  }
  setCommander(v: PinnedCommander): Promise<void> {
    return set(k(this.incidentId, 'commander'), v, this.store);
  }

  // --- fingerprint the joiner expects the commander to have (from the invite link)
  getExpectedFingerprint(): Promise<Uint8Array | undefined> {
    return get<Uint8Array>(k(this.incidentId, 'expected-fp'), this.store);
  }
  setExpectedFingerprint(fp: Uint8Array): Promise<void> {
    return set(k(this.incidentId, 'expected-fp'), fp, this.store);
  }

  // --- channel keys (non-extractable CryptoKey, one per channel and epoch)
  getChannelKey(kind: ChannelKind, epoch: number): Promise<CryptoKey | undefined> {
    return get<CryptoKey>(k(this.incidentId, `ck/${kind}/${epoch}`), this.store);
  }
  /** Skipped when the device keys are passkey-locked: channel keys then live in memory only. */
  async setChannelKey(kind: ChannelKind, epoch: number, key: CryptoKey): Promise<void> {
    if (await this.isPasskeyLocked()) return;
    await set(k(this.incidentId, `ck/${kind}/${epoch}`), key, this.store);
  }

  // --- invite secrets (commander), by codeHash hex
  getInvite(codeHashHex: string): Promise<StoredInvite | undefined> {
    return get<StoredInvite>(k(this.incidentId, `invite/${codeHashHex}`), this.store);
  }
  setInvite(codeHashHex: string, v: StoredInvite): Promise<void> {
    return set(k(this.incidentId, `invite/${codeHashHex}`), v, this.store);
  }
  delInvite(codeHashHex: string): Promise<void> {
    return del(k(this.incidentId, `invite/${codeHashHex}`), this.store);
  }

  // --- pinned heads
  getHead(kind: ChannelKind): Promise<StoredHead | undefined> {
    return get<StoredHead>(k(this.incidentId, `head/${kind}`), this.store);
  }
  /** Pins a head only if it advances (higher seq) the existing pin. */
  async advanceHead(kind: ChannelKind, head: StoredHead): Promise<void> {
    const cur = await this.getHead(kind);
    if (!cur || head.seq > cur.seq) await set(k(this.incidentId, `head/${kind}`), head, this.store);
  }

  // --- author counter
  async getCounter(): Promise<bigint> {
    return (await get<bigint>(k(this.incidentId, 'counter'), this.store)) ?? 0n;
  }
  async advanceCounter(n: bigint): Promise<void> {
    if (n > (await this.getCounter())) await set(k(this.incidentId, 'counter'), n, this.store);
  }

  /**
   * Removes everything stored for this incident, including device keys. Used
   * when this device is revoked. Pinned heads are kept only if `keepHeads`.
   */
  async wipe(): Promise<void> {
    const prefix = `${this.incidentId}/`;
    for (const key of await idbKeys(this.store)) {
      if (typeof key === 'string' && key.startsWith(prefix)) await del(key, this.store);
    }
  }
}
