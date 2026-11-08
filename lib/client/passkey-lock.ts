// Passkey lock for this browser's device keys (opt-in).
//
// One passkey per browser profile. Its WebAuthn PRF output derives the vault
// key (lib/crypto/vault.ts) that encrypts the device keys of every incident
// created or joined while the lock is on. The vault key lives in memory only:
// a reload, a new tab or "Lock now" locks again, and the real client then
// refuses to open those incidents until the passkey unlocks them.
//
// Existing incidents keep their plain keys: browsers cannot encrypt a key that
// was created non-extractable, so the lock applies from the moment it is on.
// Turning the lock off re-stores every locked incident's keys in the plain
// non-extractable form, so the lock can always be undone while it is unlocked.
//
// There is no server in this flow. The challenge is random and never checked,
// because the passkey is not used to log in anywhere: only its PRF output is
// used, and only on this device. Nothing here is logged or sent.

import { del, get, set, type UseStore } from 'idb-keyval';
import { bytesEqual } from '@/spacetimedb/src/shared/encoding';
import { randomBytes } from '@/lib/crypto/hash';
import { defaultKeyStore, IncidentStore, lockedIncidentIds } from '@/lib/crypto/store';
import {
  deriveVault,
  isLockedDeviceKeys,
  newVaultId,
  openLockedDeviceKeys,
  PRF_OUTPUT_LEN,
  VAULT_ID_LEN,
  type VaultKey,
  vaultPrfSalt,
  verifierMatches,
} from '@/lib/crypto/vault';

export type PasskeyLockStatus = 'checking' | 'unsupported' | 'off' | 'locked' | 'unlocked';

export interface PasskeyLockState {
  status: PasskeyLockStatus;
  /** True while a passkey prompt or a key operation is running. */
  busy: boolean;
  /** Last failure, safe to show. Never contains key material. */
  error: string | null;
  /** Incidents on this device whose keys need the passkey. */
  lockedIncidents: number;
}

/** What the real client needs from the vault. */
export interface DeviceVaultPort {
  /** The vault key while unlocked, else null. */
  key(): VaultKey | null;
  /** True when new device keys must be passkey-locked. */
  isEnabled(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

/** The two WebAuthn ceremonies, behind a seam so tests can use a fake authenticator. */
export interface WebAuthnPort {
  supported(): Promise<boolean>;
  create(prfSalt: Uint8Array): Promise<{ credentialId: Uint8Array; prf: Uint8Array | null; prfEnabled: boolean }>;
  get(credentialId: Uint8Array, prfSalt: Uint8Array): Promise<Uint8Array | null>;
}

interface VaultRecord {
  v: 1;
  vaultId: Uint8Array;
  credentialId: Uint8Array;
  verifier: Uint8Array;
  createdAtMs: number;
}

const RECORD_KEY = 'passkey-vault/v1';

export class PasskeyLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyLockError';
  }
}

function isVaultRecord(x: unknown): x is VaultRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    r.v === 1 &&
    r.vaultId instanceof Uint8Array &&
    r.vaultId.length === VAULT_ID_LEN &&
    r.credentialId instanceof Uint8Array &&
    r.credentialId.length > 0 &&
    r.verifier instanceof Uint8Array &&
    typeof r.createdAtMs === 'number'
  );
}

/** Maps a WebAuthn or vault failure to a message the UI can show. */
function messageFor(e: unknown): string {
  if (e instanceof PasskeyLockError) return e.message;
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey request was cancelled or timed out.';
  if (name === 'SecurityError') return 'Passkeys need a secure page (HTTPS or localhost).';
  if (name === 'NotSupportedError') return 'This browser or passkey cannot do this.';
  return 'The passkey step failed. Nothing was changed.';
}

export class DeviceVault implements DeviceVaultPort {
  private state: PasskeyLockState = { status: 'checking', busy: false, error: null, lockedIncidents: 0 };
  private readonly listeners = new Set<() => void>();
  private vaultKey: VaultKey | null = null;
  private started: Promise<void> | null = null;

  constructor(
    private readonly deps: { store: UseStore; webauthn: WebAuthnPort; now?: () => number },
  ) {}

  // --- observable state --------------------------------------------------------

  getState = (): PasskeyLockState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  key(): VaultKey | null {
    return this.vaultKey;
  }

  async isEnabled(): Promise<boolean> {
    return isVaultRecord(await get(RECORD_KEY, this.deps.store));
  }

  /** Resolves once the first status check is done. */
  ready(): Promise<void> {
    return this.start();
  }

  private start(): Promise<void> {
    this.started ??= this.recompute().catch(() => {
      this.patch({ status: 'unsupported' });
    });
    return this.started;
  }

  private patch(p: Partial<PasskeyLockState>): void {
    this.state = { ...this.state, ...p };
    for (const l of [...this.listeners]) l();
  }

  private async recompute(extra: Partial<PasskeyLockState> = {}): Promise<void> {
    const rec = await get(RECORD_KEY, this.deps.store);
    const lockedIncidents = (await lockedIncidentIds(this.deps.store)).length;
    let status: PasskeyLockStatus;
    if (isVaultRecord(rec)) status = this.vaultKey ? 'unlocked' : 'locked';
    else status = (await this.deps.webauthn.supported()) ? 'off' : 'unsupported';
    this.patch({ status, lockedIncidents, ...extra });
  }

  /** Runs one action at a time; failures land in state.error and are rethrown as PasskeyLockError. */
  private async run(fn: () => Promise<void>): Promise<void> {
    await this.start();
    if (this.state.busy) throw new PasskeyLockError('A passkey step is already running.');
    this.patch({ busy: true, error: null });
    try {
      await fn();
      await this.recompute({ busy: false, error: null });
    } catch (e) {
      const error = messageFor(e);
      await this.recompute({ busy: false, error }).catch(() => this.patch({ busy: false, error }));
      throw new PasskeyLockError(error);
    }
  }

  private async vaultFromPrf(prf: Uint8Array, vaultId: Uint8Array) {
    if (prf.length !== PRF_OUTPUT_LEN) throw new PasskeyLockError('This passkey returned an unexpected secret.');
    try {
      return await deriveVault(prf, vaultId);
    } finally {
      prf.fill(0);
    }
  }

  // --- actions -------------------------------------------------------------------

  /** Creates the passkey and turns the lock on for incidents created or joined from now on. */
  enable(): Promise<void> {
    return this.run(async () => {
      if (await this.isEnabled()) throw new PasskeyLockError('The passkey lock is already on.');
      if (!(await this.deps.webauthn.supported())) {
        throw new PasskeyLockError('This browser cannot lock keys with a passkey. Your keys stay as they are.');
      }
      const vaultId = newVaultId();
      const salt = vaultPrfSalt(vaultId);
      const created = await this.deps.webauthn.create(salt);
      let prf = created.prf;
      // Some authenticators only report PRF support at creation; ask once more for the value.
      if (!prf && created.prfEnabled) prf = await this.deps.webauthn.get(created.credentialId, salt);
      if (!prf) {
        throw new PasskeyLockError(
          'This passkey cannot produce the secret needed to lock keys (no PRF support). Nothing was changed. You can delete the "HAVEN device lock" passkey.',
        );
      }
      const { key, verifier } = await this.vaultFromPrf(prf, vaultId);
      const rec: VaultRecord = {
        v: 1,
        vaultId,
        credentialId: created.credentialId.slice(),
        verifier,
        createdAtMs: (this.deps.now ?? Date.now)(),
      };
      await set(RECORD_KEY, rec, this.deps.store);
      this.vaultKey = key;
    });
  }

  /** Asks for the passkey and holds the vault key in memory until the page closes or lock() runs. */
  unlock(): Promise<void> {
    return this.run(async () => {
      const rec = await get(RECORD_KEY, this.deps.store);
      if (!isVaultRecord(rec)) throw new PasskeyLockError('The passkey lock is not on.');
      if (this.vaultKey && bytesEqual(this.vaultKey.vaultId, rec.vaultId)) return;
      const prf = await this.deps.webauthn.get(rec.credentialId, vaultPrfSalt(rec.vaultId));
      if (!prf) throw new PasskeyLockError('This passkey did not return its secret, so the keys stay locked.');
      const { key, verifier } = await this.vaultFromPrf(prf, rec.vaultId);
      if (!verifierMatches(rec.verifier, verifier)) {
        throw new PasskeyLockError('That passkey does not match the one that locked these keys.');
      }
      this.vaultKey = key;
    });
  }

  /** Forgets the vault key. Locked incidents close until the next unlock. */
  lock(): void {
    if (!this.vaultKey) return;
    this.vaultKey = null;
    this.patch({ status: 'locked', error: null });
  }

  /**
   * Turns the lock off: every locked incident's keys are stored again as plain
   * non-extractable keys, then the vault record is deleted. Needs the vault
   * unlocked. Stops before deleting anything if one record will not open.
   */
  disable(): Promise<void> {
    return this.run(async () => {
      const rec = await get(RECORD_KEY, this.deps.store);
      if (!isVaultRecord(rec)) throw new PasskeyLockError('The passkey lock is not on.');
      const key = this.vaultKey;
      if (!key || !bytesEqual(key.vaultId, rec.vaultId)) throw new PasskeyLockError('Unlock with your passkey first.');
      for (const incidentId of await lockedIncidentIds(this.deps.store)) {
        const s = new IncidentStore(incidentId, this.deps.store);
        const locked = await s.getDeviceRecord();
        if (!isLockedDeviceKeys(locked)) continue;
        const keys = await openLockedDeviceKeys(key, locked, incidentId);
        if (!keys) throw new PasskeyLockError('One incident\'s keys would not unlock, so the lock stays on.');
        await s.setDeviceKeys(keys);
      }
      await del(RECORD_KEY, this.deps.store);
      this.vaultKey = null;
    });
  }
}

// --- browser WebAuthn ----------------------------------------------------------

function bytesOf(src: BufferSource): Uint8Array {
  const view = src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return view.slice();
}

const asBuffer = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/** navigator.credentials with the PRF extension. User verification is required on both ceremonies. */
export function browserWebAuthn(): WebAuthnPort {
  return {
    async supported() {
      if (typeof window === 'undefined' || !window.isSecureContext) return false;
      if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) return false;
      if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
        try {
          const caps = await PublicKeyCredential.getClientCapabilities();
          if (caps['extension:prf'] === false) return false;
        } catch {
          // Unknown: enable() still fails safely if the passkey returns no PRF.
        }
      }
      return true;
    },

    async create(prfSalt) {
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { name: 'HAVEN' },
          user: { id: asBuffer(randomBytes(16)), name: 'HAVEN device lock', displayName: 'HAVEN device lock' },
          challenge: asBuffer(randomBytes(32)),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          attestation: 'none',
          timeout: 120_000,
          extensions: { prf: { eval: { first: asBuffer(prfSalt) } } },
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new PasskeyLockError('No passkey was created.');
      const prf = cred.getClientExtensionResults().prf;
      const first = prf?.results?.first;
      return {
        credentialId: new Uint8Array(cred.rawId).slice(),
        prf: first ? bytesOf(first) : null,
        prfEnabled: prf?.enabled === true || first !== undefined,
      };
    },

    async get(credentialId, prfSalt) {
      const cred = (await navigator.credentials.get({
        publicKey: {
          challenge: asBuffer(randomBytes(32)),
          allowCredentials: [{ type: 'public-key', id: asBuffer(credentialId) }],
          userVerification: 'required',
          timeout: 120_000,
          extensions: { prf: { eval: { first: asBuffer(prfSalt) } } },
        },
      })) as PublicKeyCredential | null;
      const first = cred?.getClientExtensionResults().prf?.results?.first;
      return first ? bytesOf(first) : null;
    },
  };
}

// --- one vault per tab -----------------------------------------------------------

let singleton: DeviceVault | undefined;

/** The browser's passkey lock, one per tab. Browser only. */
export function getDeviceVault(): DeviceVault {
  if (typeof window === 'undefined') throw new Error('The passkey lock is only available in the browser.');
  singleton ??= new DeviceVault({ store: defaultKeyStore(), webauthn: browserWebAuthn() });
  return singleton;
}

/** Snapshot for server rendering and the first client render. */
export const PASSKEY_LOCK_SERVER_STATE: PasskeyLockState = {
  status: 'checking',
  busy: false,
  error: null,
  lockedIncidents: 0,
};
