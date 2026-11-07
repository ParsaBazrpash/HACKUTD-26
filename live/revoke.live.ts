// Revoke rehearsal against the real Maincloud database (docs/PLAN.md A5, T13).
//
//   npm run test:live
//
// Three real clients. The commander revokes one counsel member mid-incident.
// The revoked device is locked and wiped, the server stops showing it anything,
// and the remaining members keep working in the next key epoch.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IncidentStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { RealIncidentClient } from '@/lib/client/real';
import { SpacetimeBackend, type TokenStore } from '@/lib/client/spacetime-backend';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';
const DB = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'zerohour-hackutd26';

const memoryTokens = (): TokenStore => {
  let t: string | undefined;
  return { read: () => t, write: (v) => void (t = v) };
};

function browser(name: string) {
  const db = makeTestStore(`revoke-${name}-${crypto.randomUUID()}`);
  const backend = new SpacetimeBackend(HOST, DB, memoryTokens());
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.live',
    storeFor: (id) => new IncidentStore(id, db),
    waitMs: 8000,
  });
  return { backend, client, db };
}
type Browser = ReturnType<typeof browser>;

const until = async (pred: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for state');
    await new Promise((r) => setTimeout(r, 100));
  }
};

const texts = (b: Browser, ch: 'command' | 'privileged' | 'technical') =>
  b.client.getState().channels.find((c) => c.kind === ch)?.messages.map((m) => m.text) ?? [];

describe('Maincloud revoke rehearsal', () => {
  it('locks the revoked device, rotates keys, and the rest keep working', async () => {
    const cmd = browser('cmd');
    const dana = browser('dana');
    const erin = browser('erin');
    await until(() => [cmd, dana, erin].every((b) => b.backend.connection() === 'ready'));

    const { incidentId } = await cmd.client.createIncident({ title: `Revoke rehearsal ${new Date().toISOString()}`, displayName: 'Casey' });
    for (const [b, name] of [
      [dana, 'Dana'],
      [erin, 'Erin'],
    ] as const) {
      const { url } = await cmd.client.createInvite({ role: 'counsel' });
      await b.client.redeemInvite({ fragment: url.slice(url.indexOf('#') + 1), displayName: name });
      await until(() => cmd.client.getState().members.some((m) => m.displayName === name && m.state === 'pending'));
      await cmd.client.admitMember(cmd.client.getState().members.find((m) => m.displayName === name)!.memberId);
      await until(() => b.client.getState().me?.state === 'active');
    }

    await cmd.client.postMessage('privileged', { text: 'before revoke', mentions: [] });
    await until(() => texts(dana, 'privileged').length === 1 && texts(erin, 'privileged').length === 1);

    const danaMember = cmd.client.getState().members.find((m) => m.displayName === 'Dana')!;
    await cmd.client.revokeMember(danaMember.memberId, 'rehearsal');
    await until(() => dana.client.getState().me?.state === 'revoked');

    // Dana is locked, her keys are gone, and the server shows her nothing.
    const ds = dana.client.getState();
    expect(ds.channels).toEqual([]);
    expect(await new IncidentStore(incidentId, dana.db).getDeviceKeys()).toBeUndefined();
    await until(() => dana.backend.rows().events.length === 0 && dana.backend.rows().envelopes.length === 0);

    // The others continue in the next epoch, with history intact.
    await cmd.client.postMessage('privileged', { text: 'after revoke', mentions: [] });
    await erin.client.postMessage('privileged', { text: 'erin after', mentions: [] });
    await until(() => texts(cmd, 'privileged').length === 3 && texts(erin, 'privileged').length === 3);
    expect(texts(erin, 'privileged')).toEqual(['before revoke', 'after revoke', 'erin after']);
    for (const b of [cmd, erin]) expect((await b.client.verifyAll()).ok).toBe(true);
    expect(cmd.client.getState().members.find((m) => m.displayName === 'Dana')).toMatchObject({ state: 'revoked', verified: true });
  });
});
