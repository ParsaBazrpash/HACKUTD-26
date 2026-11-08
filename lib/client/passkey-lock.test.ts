import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { get as idbGet } from 'idb-keyval';
import { useStoreForTests as makeTestStore, IncidentStore } from '@/lib/crypto/store';
import { generateLockedDeviceKeys, isLockedDeviceKeys, openLockedDeviceKeys, vaultPrfSalt } from '@/lib/crypto/vault';
import { browserWebAuthn, DeviceVault, PasskeyLockError, type WebAuthnPort } from './passkey-lock';

const A = '11111111-1111-4111-8111-111111111111';
let n = 0;

/** A fake authenticator: PRF(cred, salt) = HMAC-SHA256(secret_cred, salt), like CTAP2 hmac-secret. */
function fakeAuthenticator(opts: { prf?: 'at-create' | 'at-get' | 'none'; supported?: boolean } = {}) {
  const creds = new Map<string, Uint8Array>();
  const calls: { op: 'create' | 'get'; salt: Uint8Array; credentialId?: Uint8Array }[] = [];
  let swapSecret = false;
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  const port: WebAuthnPort = {
    supported: async () => opts.supported ?? true,
    async create(salt) {
      calls.push({ op: 'create', salt });
      const id = crypto.getRandomValues(new Uint8Array(16));
      const secret = crypto.getRandomValues(new Uint8Array(32));
      creds.set(hex(id), secret);
      const mode = opts.prf ?? 'at-create';
      return {
        credentialId: id,
        prf: mode === 'at-create' ? hmac(sha256, secret, salt) : null,
        prfEnabled: mode !== 'none',
      };
    },
    async get(credentialId, salt) {
      calls.push({ op: 'get', salt, credentialId });
      const secret = creds.get(hex(credentialId));
      if (!secret || opts.prf === 'none') return null;
      return hmac(sha256, swapSecret ? sha256(secret) : secret, salt);
    },
  };
  return { port, calls, creds, useWrongSecret: () => (swapSecret = true) };
}

function vaultWith(auth: ReturnType<typeof fakeAuthenticator>, store = makeTestStore(`pk-${++n}`)) {
  return { vault: new DeviceVault({ store, webauthn: auth.port }), store };
}

describe('passkey lock (DeviceVault)', () => {
  it('starts off, turns on with a passkey, and holds the key only in memory', async () => {
    const auth = fakeAuthenticator();
    const { vault, store } = vaultWith(auth);
    await vault.ready();
    expect(vault.getState().status).toBe('off');
    expect(await vault.isEnabled()).toBe(false);
    expect(vault.key()).toBeNull();

    await vault.enable();
    expect(vault.getState()).toMatchObject({ status: 'unlocked', busy: false, error: null });
    expect(vault.key()).not.toBeNull();
    expect(await vault.isEnabled()).toBe(true);

    // The PRF input is the vault's salt, and nothing secret is stored.
    const stored = (await idbGet('passkey-vault/v1', store)) as Record<string, unknown>;
    expect(auth.calls[0].salt).toEqual(vaultPrfSalt(stored.vaultId as Uint8Array));
    for (const v of Object.values(stored)) expect(v).not.toBeInstanceOf(CryptoKey);

    // A reload (a new vault object on the same storage) starts locked.
    const reloaded = new DeviceVault({ store, webauthn: auth.port });
    await reloaded.ready();
    expect(reloaded.getState().status).toBe('locked');
    expect(reloaded.key()).toBeNull();
  });

  it('unlocks with the same passkey, which yields the same vault key', async () => {
    const auth = fakeAuthenticator();
    const { vault, store } = vaultWith(auth);
    await vault.enable();
    const { record } = await generateLockedDeviceKeys(vault.key()!, A);

    const reloaded = new DeviceVault({ store, webauthn: auth.port });
    await reloaded.unlock();
    expect(reloaded.getState().status).toBe('unlocked');
    expect(await openLockedDeviceKeys(reloaded.key()!, record, A)).not.toBeNull();
    const get = auth.calls.at(-1)!;
    expect(get.op).toBe('get');
    expect(get.credentialId).toBeDefined();
  });

  it('a passkey that returns a different secret is refused and the vault stays locked', async () => {
    const auth = fakeAuthenticator();
    const { vault, store } = vaultWith(auth);
    await vault.enable();
    auth.useWrongSecret();
    const reloaded = new DeviceVault({ store, webauthn: auth.port });
    await expect(reloaded.unlock()).rejects.toThrow(/does not match/);
    expect(reloaded.getState()).toMatchObject({ status: 'locked', busy: false });
    expect(reloaded.getState().error).toMatch(/does not match/);
    expect(reloaded.key()).toBeNull();
  });

  it('lock() forgets the key and notifies listeners', async () => {
    const { vault } = vaultWith(fakeAuthenticator());
    await vault.enable();
    const seen: string[] = [];
    vault.subscribe(() => seen.push(vault.getState().status));
    vault.lock();
    expect(vault.key()).toBeNull();
    expect(vault.getState().status).toBe('locked');
    expect(seen).toContain('locked');
  });

  it('asks a second time when the passkey only reports PRF support at creation', async () => {
    const auth = fakeAuthenticator({ prf: 'at-get' });
    const { vault } = vaultWith(auth);
    await vault.enable();
    expect(auth.calls.map((c) => c.op)).toEqual(['create', 'get']);
    expect(vault.getState().status).toBe('unlocked');
  });

  it('a passkey without PRF changes nothing (the demo can never be locked out)', async () => {
    const { vault } = vaultWith(fakeAuthenticator({ prf: 'none' }));
    await expect(vault.enable()).rejects.toBeInstanceOf(PasskeyLockError);
    expect(vault.getState().status).toBe('off');
    expect(vault.getState().error).toMatch(/no PRF support/);
    expect(await vault.isEnabled()).toBe(false);
  });

  it('an unsupported browser reports unsupported and cannot turn the lock on', async () => {
    const { vault } = vaultWith(fakeAuthenticator({ supported: false }));
    await vault.ready();
    expect(vault.getState().status).toBe('unsupported');
    await expect(vault.enable()).rejects.toThrow(/cannot lock keys/);
    expect(await vault.isEnabled()).toBe(false);
  });

  it('a cancelled passkey prompt leaves everything as it was', async () => {
    const auth = fakeAuthenticator();
    auth.port.create = async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    };
    const { vault } = vaultWith(auth);
    await expect(vault.enable()).rejects.toThrow(/cancelled or timed out/);
    expect(vault.getState().status).toBe('off');
  });

  it('turning the lock off stores every locked incident as plain non-extractable keys', async () => {
    const auth = fakeAuthenticator();
    const { vault, store } = vaultWith(auth);
    await vault.enable();
    const s = new IncidentStore(A, store);
    const { record } = await generateLockedDeviceKeys(vault.key()!, A);
    await s.setLockedDeviceKeys(record);
    await vault.ready();

    const reloaded = new DeviceVault({ store, webauthn: auth.port });
    await expect(reloaded.disable()).rejects.toThrow(/Unlock/); // needs the passkey first
    expect(isLockedDeviceKeys(await s.getDeviceRecord())).toBe(true);

    await reloaded.unlock();
    expect(reloaded.getState().lockedIncidents).toBe(1);
    await reloaded.disable();
    const plain = await s.getDeviceKeys();
    expect(plain).toBeDefined();
    expect(plain!.signPub).toEqual(record.signPub);
    expect(plain!.signPriv.extractable).toBe(false);
    expect(reloaded.getState()).toMatchObject({ status: 'off', lockedIncidents: 0 });
    expect(await reloaded.isEnabled()).toBe(false);
  });
});

describe('browser WebAuthn calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubBrowser(ext: AuthenticationExtensionsClientOutputs) {
    const create = vi.fn(async () => ({ rawId: new Uint8Array([9, 9, 9]).buffer, getClientExtensionResults: () => ext }));
    const get = vi.fn(async () => ({ rawId: new Uint8Array([9, 9, 9]).buffer, getClientExtensionResults: () => ext }));
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { credentials: { create, get } });
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({ 'extension:prf': true }) });
    return { create, get };
  }

  it('requires user verification, asks for PRF with the vault salt, and pins the credential on unlock', async () => {
    const out = new Uint8Array(32).fill(4);
    const { create, get } = stubBrowser({ prf: { enabled: true, results: { first: out.buffer } } });
    const port = browserWebAuthn();
    expect(await port.supported()).toBe(true);
    const salt = new Uint8Array(32).fill(1);

    const made = await port.create(salt);
    expect(made).toEqual({ credentialId: new Uint8Array([9, 9, 9]), prf: out, prfEnabled: true });
    const cOpts = (create.mock.calls[0] as unknown as [CredentialCreationOptions])[0].publicKey!;
    expect(cOpts.authenticatorSelection?.userVerification).toBe('required');
    expect(cOpts.attestation).toBe('none');
    expect(cOpts.rp.id).toBeUndefined(); // bound to this origin's own domain
    expect(cOpts.extensions?.prf?.eval?.first).toEqual(salt);

    expect(await port.get(made.credentialId, salt)).toEqual(out);
    const gOpts = (get.mock.calls[0] as unknown as [CredentialRequestOptions])[0].publicKey!;
    expect(gOpts.userVerification).toBe('required');
    expect(gOpts.allowCredentials).toEqual([{ type: 'public-key', id: made.credentialId }]);
    expect(gOpts.extensions?.prf?.eval?.first).toEqual(salt);
  });

  it('reports unsupported when the browser says it has no PRF, or the page is not secure', async () => {
    stubBrowser({});
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({ 'extension:prf': false }) });
    expect(await browserWebAuthn().supported()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({}) });
    vi.stubGlobal('window', { isSecureContext: false });
    expect(await browserWebAuthn().supported()).toBe(false);
  });
});
