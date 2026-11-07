// Gate 2 smoke test against the real Maincloud database (docs/PLAN.md Sync 2).
// Two independent clients (two Spacetime identities, two IndexedDBs) do the
// whole handshake and exchange an encrypted #privileged message.
//
//   npm run test:live
//
// It creates one test incident per run on the shared database.

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
  const db = makeTestStore(`live-${name}-${crypto.randomUUID()}`);
  const backend = new SpacetimeBackend(HOST, DB, memoryTokens());
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.live',
    storeFor: (id) => new IncidentStore(id, db),
    waitMs: 8000,
  });
  return { backend, client };
}

const until = async (pred: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for state');
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('Maincloud', () => {
  it('create, invite, redeem, admit and exchange an encrypted privileged message', async () => {
    const cmd = browser('cmd');
    const dana = browser('dana');
    const tom = browser('tom');
    await until(() => cmd.backend.connection() === 'ready' && dana.backend.connection() === 'ready' && tom.backend.connection() === 'ready');

    await cmd.client.createIncident({ title: `Live smoke ${new Date().toISOString()}`, displayName: 'Casey' });
    for (const [b, role, name] of [
      [dana, 'counsel', 'Dana'],
      [tom, 'technical', 'Tom'],
    ] as const) {
      const { url } = await cmd.client.createInvite({ role });
      await b.client.redeemInvite({ fragment: url.slice(url.indexOf('#') + 1), displayName: name });
      await until(() => cmd.client.getState().members.some((m) => m.displayName === name && m.state === 'pending'));
      const m = cmd.client.getState().members.find((x) => x.displayName === name)!;
      expect(m.linkVerified).toBe(true);
      await cmd.client.admitMember(m.memberId);
      await until(() => b.client.getState().me?.state === 'active');
    }

    await cmd.client.postMessage('privileged', { text: 'live: privileged strategy', mentions: [] });
    await dana.client.postMessage('privileged', { text: 'live: counsel reply', mentions: [] });
    await cmd.client.postMessage('technical', { text: 'live: isolate host', mentions: [] });
    await until(() => dana.client.getState().channels.find((c) => c.kind === 'privileged')?.messages.length === 2);
    await until(() => tom.client.getState().channels.find((c) => c.kind === 'technical')?.messages.length === 1);

    expect(tom.client.getState().channels.map((c) => c.kind).sort()).toEqual(['command', 'technical']);
    expect(tom.backend.rows().envelopes.some((e) => e.kind === 'privileged')).toBe(false);
    for (const b of [cmd, dana, tom]) expect((await b.client.verifyAll()).ok).toBe(true);
  });
});
