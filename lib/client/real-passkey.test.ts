// The real client with the passkey lock on: real crypto, the real module on
// the test harness, one IndexedDB per browser, and a fake authenticator.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { UseStore } from 'idb-keyval';
import { HarnessHub } from '@/tests/support/harness-backend';
import { IncidentStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { isLockedDeviceKeys } from '@/lib/crypto/vault';
import { DeviceVault, type WebAuthnPort } from './passkey-lock';
import { DEVICE_LOCKED_MESSAGE, RealIncidentClient } from './real';

let n = 0;
const clients: RealIncidentClient[] = [];

/** One authenticator per person: PRF = HMAC(secret, salt). */
function authenticator(): WebAuthnPort {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return {
    supported: async () => true,
    create: async (salt) => ({ credentialId: new Uint8Array([1, 2, 3]), prf: hmac(sha256, secret, salt), prfEnabled: true }),
    get: async (_id, salt) => hmac(sha256, secret, salt),
  };
}

/** A browser profile: server identity, IndexedDB, passkey vault. `reload()` is a page reload. */
function profile(hub: HarnessHub, name: string, auth = authenticator()) {
  const db: UseStore = makeTestStore(`${name}-pk-${++n}`);
  const backend = hub.backend(name);
  const make = () => {
    const vault = new DeviceVault({ store: db, webauthn: auth });
    const client = new RealIncidentClient(backend, {
      origin: 'https://zerohour.test',
      storeFor: (id) => new IncidentStore(id, db),
      now: () => Number(hub.h.clock.now().microsSinceUnixEpoch / 1000n),
      waitMs: 200,
      vault,
    });
    clients.push(client);
    return { vault, client };
  };
  const p = { name, db, backend, ...make(), reload: () => Object.assign(p, make()) };
  return p;
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(clients.map((c) => c.whenIdle()));
  }
}

const fragmentOf = (url: string) => url.slice(url.indexOf('#') + 1);
const privileged = (c: RealIncidentClient) =>
  c.getState().channels.find((ch) => ch.kind === 'privileged')?.messages.map((m) => m.text) ?? [];

describe('passkey lock in the real client (T20)', () => {
  it('a locked commander stores only wrapped keys and no channel keys, yet works normally', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    await cmd.vault.enable();
    const { incidentId } = await cmd.client.createIncident({ title: 'Ransomware at Lakeside', displayName: 'Casey' });
    await settle();

    const store = new IncidentStore(incidentId, cmd.db);
    expect(isLockedDeviceKeys(await store.getDeviceRecord())).toBe(true);
    expect(await store.getDeviceKeys()).toBeUndefined();
    for (const kind of ['record', 'command', 'privileged', 'technical'] as const) {
      expect(await store.getChannelKey(kind, 0)).toBeUndefined();
    }
    const s = cmd.client.getState();
    expect(s.me).toMatchObject({ role: 'commander', state: 'active', verified: true });
    expect(s.incident?.title).toBe('Ransomware at Lakeside');
    expect(s.integrity.ok).toBe(true);
  });

  it('after a reload nothing opens until the passkey unlocks it, and lock() closes it again', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    await cmd.vault.enable();
    const { incidentId } = await cmd.client.createIncident({ title: 'Ransomware at Lakeside', displayName: 'Casey' });
    await cmd.client.postMessage('privileged', { text: 'privileged note', mentions: [] });
    await settle();

    cmd.reload();
    await cmd.client.openIncident(incidentId);
    await settle();
    let s = cmd.client.getState();
    expect(s.error).toBe(DEVICE_LOCKED_MESSAGE);
    expect(s.incident).toBeNull();
    expect(s.channels).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('privileged note');

    await cmd.vault.unlock();
    await settle();
    s = cmd.client.getState();
    expect(s.error).toBeUndefined();
    expect(s.incident?.title).toBe('Ransomware at Lakeside');
    expect(privileged(cmd.client)).toEqual(['privileged note']);

    cmd.vault.lock();
    await settle();
    s = cmd.client.getState();
    expect(s.error).toBe(DEVICE_LOCKED_MESSAGE);
    expect(JSON.stringify(s)).not.toContain('privileged note');
    await expect(cmd.client.postMessage('privileged', { text: 'while locked', mentions: [] })).rejects.toThrow(DEVICE_LOCKED_MESSAGE);
  });

  it('a different passkey cannot open the incident', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    await cmd.vault.enable();
    const { incidentId } = await cmd.client.createIncident({ title: 'T', displayName: 'Casey' });
    await settle();

    // Same storage, a different authenticator: its PRF secret differs.
    const other = new DeviceVault({ store: cmd.db, webauthn: authenticator() });
    await expect(other.unlock()).rejects.toThrow(/does not match/);
    const client = new RealIncidentClient(cmd.backend, {
      origin: 'https://zerohour.test',
      storeFor: (id) => new IncidentStore(id, cmd.db),
      waitMs: 200,
      vault: other,
    });
    clients.push(client);
    await client.openIncident(incidentId);
    await settle();
    expect(client.getState().error).toBe(DEVICE_LOCKED_MESSAGE);
  });

  it('a locked-out joiner cannot redeem until unlocked, and nothing is sent first', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    await cmd.client.createIncident({ title: 'T', displayName: 'Casey' }); // commander without the lock
    await settle();
    const { url } = await cmd.client.createInvite({ role: 'counsel' });

    const dana = profile(hub, 'Dana');
    await dana.vault.enable();
    dana.reload(); // lock is on, vault locked
    let sent = 0;
    const original = dana.backend.redeemInvite.bind(dana.backend);
    dana.backend.redeemInvite = (a) => {
      sent++;
      return original(a);
    };
    await expect(dana.client.redeemInvite({ fragment: fragmentOf(url), displayName: 'Dana' })).rejects.toThrow(
      /Unlock with your passkey first/,
    );
    expect(sent).toBe(0);

    await dana.vault.unlock();
    await dana.client.redeemInvite({ fragment: fragmentOf(url), displayName: 'Dana' });
    await settle();
    expect(sent).toBe(1);
    const pending = cmd.client.getState().members.find((m) => m.displayName === 'Dana')!;
    expect(pending.linkVerified).toBe(true);
    await cmd.client.admitMember(pending.memberId);
    await cmd.client.postMessage('privileged', { text: 'for counsel', mentions: [] });
    await settle();
    expect(privileged(dana.client)).toEqual(['for counsel']);
    const store = new IncidentStore(cmd.client.getState().incident!.id, dana.db);
    expect(isLockedDeviceKeys(await store.getDeviceRecord())).toBe(true);
    expect(await store.getChannelKey('privileged', 0)).toBeUndefined();
  });

  it('turning the lock off brings back plain keys and the incident opens without a passkey', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    await cmd.vault.enable();
    const { incidentId } = await cmd.client.createIncident({ title: 'T', displayName: 'Casey' });
    await settle();
    await cmd.vault.disable();
    await settle();

    cmd.reload();
    await cmd.client.openIncident(incidentId);
    await settle();
    expect(cmd.vault.getState().status).toBe('off');
    expect(cmd.client.getState().error).toBeUndefined();
    expect(cmd.client.getState().me?.role).toBe('commander');
    // Plain mode stores channel keys again, as before the lock existed.
    expect(await new IncidentStore(incidentId, cmd.db).getChannelKey('record', 0)).toBeDefined();
  });

  it('incidents created before the lock was turned on keep working without the passkey', async () => {
    const hub = new HarnessHub();
    const cmd = profile(hub, 'cmd');
    const { incidentId } = await cmd.client.createIncident({ title: 'Before', displayName: 'Casey' });
    await settle();
    await cmd.vault.enable();
    cmd.reload(); // locked vault
    await cmd.client.openIncident(incidentId);
    await settle();
    expect(cmd.vault.getState().status).toBe('locked');
    expect(cmd.client.getState().error).toBeUndefined();
    expect(cmd.client.getState().incident?.title).toBe('Before');
  });
});
