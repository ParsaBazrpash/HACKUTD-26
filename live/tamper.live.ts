// Tamper rehearsal against the real Maincloud database (docs/PLAN.md A5, T3).
//
//   npm run test:live
//
// Builds an incident with three clients, then plays the part of a malicious
// operator: it edits one stored ciphertext with the owner's `spacetime sql`
// (the CLI must be installed and logged in as the database owner). Every
// reader must turn red at that exact event. Runs only where the CLI exists.

import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { IncidentStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { RealIncidentClient } from '@/lib/client/real';
import { SpacetimeBackend, type TokenStore } from '@/lib/client/spacetime-backend';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';
const DB = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'zerohour-hackutd26';
const SERVER = process.env.SPACETIME_SERVER || 'maincloud';

const hasCli = spawnSync('spacetime', ['--version'], { encoding: 'utf8' }).status === 0;

const memoryTokens = (): TokenStore => {
  let t: string | undefined;
  return { read: () => t, write: (v) => void (t = v) };
};

function browser(name: string) {
  const db = makeTestStore(`tamper-${name}-${crypto.randomUUID()}`);
  const backend = new SpacetimeBackend(HOST, DB, memoryTokens());
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.live',
    storeFor: (id) => new IncidentStore(id, db),
    waitMs: 8000,
  });
  return { backend, client };
}

const until = async (pred: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for state');
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe.skipIf(!hasCli)('Maincloud tamper rehearsal', () => {
  it('a flipped ciphertext turns every reader red at the edited event', async () => {
    const cmd = browser('cmd');
    const dana = browser('dana');
    await until(() => cmd.backend.connection() === 'ready' && dana.backend.connection() === 'ready');

    const { incidentId } = await cmd.client.createIncident({ title: `Tamper rehearsal ${new Date().toISOString()}`, displayName: 'Casey' });
    const { url } = await cmd.client.createInvite({ role: 'counsel' });
    await dana.client.redeemInvite({ fragment: url.slice(url.indexOf('#') + 1), displayName: 'Dana' });
    await until(() => cmd.client.getState().members.some((m) => m.displayName === 'Dana' && m.state === 'pending'));
    await cmd.client.admitMember(cmd.client.getState().members.find((m) => m.displayName === 'Dana')!.memberId);
    await until(() => dana.client.getState().me?.state === 'active');

    await cmd.client.postMessage('privileged', { text: 'rehearsal: first', mentions: [] });
    await cmd.client.postMessage('privileged', { text: 'rehearsal: second', mentions: [] });
    await until(() => dana.client.getState().channels.find((c) => c.kind === 'privileged')?.messages.length === 2);
    for (const b of [cmd, dana]) expect((await b.client.verifyAll()).ok).toBe(true);

    // The operator edits the second message in the database.
    const victim = cmd.backend
      .rows()
      .events.filter((e) => e.incidentId === incidentId && e.channel === 'privileged')
      .sort((a, b) => Number(a.seq - b.seq))[1];
    const flipped = victim.ciphertext.slice();
    flipped[0] ^= 1;
    const sql = `UPDATE event SET ciphertext = 0x${bytesToHex(flipped)} WHERE client_event_id = '${victim.clientEventId}'`;
    const r = spawnSync('spacetime', ['sql', '--server', SERVER, DB, sql], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`spacetime sql failed: ${r.stderr || r.stdout}`);

    for (const b of [cmd, dana]) {
      await until(() => b.client.getState().integrity.ok === false);
      const rep = await b.client.verifyAll();
      expect(rep.ok).toBe(false);
      expect(rep.channels.privileged!.failures.some((f) => f.seq === victim.seq)).toBe(true);
    }
  });
});
