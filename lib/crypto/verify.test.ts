import { describe, expect, it } from 'vitest';
import { admitStatement } from '@/spacetimedb/src/shared/encoding';
import type { ChannelKind } from '@/spacetimedb/src/shared/policy';
import type { FailureReason } from '@/lib/client/types';
import { generateDeviceKeys } from './keys';
import { sign } from './sign';
import { genesisHash } from './chain';
import { chat, TestIncident, timeline } from './testkit';
import { verifyIncident, type RawEvent, type RosterMember } from './verify';

const reasons = (r: Awaited<ReturnType<typeof verifyIncident>>, ch: ChannelKind) =>
  r.report.channels[ch]!.failures.map((f) => `${f.seq}:${f.reason}`);

async function baseline() {
  const t = await TestIncident.create();
  const counsel = await t.addMember('counsel', 'Dana Counsel');
  const tech = await t.addMember('technical', 'Sam Tech');
  const exec = await t.addMember('executive', 'Eve Exec');
  await t.append(t.commander, 'record', timeline('Ransom note found'));
  await t.append(counsel, 'record', timeline('Counsel engaged'));
  await t.append(tech, 'record', timeline('Isolated file server'));
  await t.append(counsel, 'privileged', chat('Do not pay yet'));
  await t.append(exec, 'privileged', chat('Understood'));
  await t.append(t.commander, 'command', chat('Bridge at 9'));
  await t.append(tech, 'technical', chat('IOC list attached'));
  return { t, counsel, tech, exec };
}

describe('verifyIncident: happy path', () => {
  it('verifies a clean log with no failures and decrypts payloads', async () => {
    const { t } = await baseline();
    const r = await verifyIncident(t.input('commander'));
    expect(r.report.ok).toBe(true);
    expect(r.events.length).toBe(7);
    expect(r.events.every((e) => e.verdict.ok && e.payload && e.author)).toBe(true);
    expect(r.report.channels.record!.head!.seq).toBe(3n);
    expect(r.newHeads.record!.seq).toBe(3n);
  });

  it('technical role sees no #privileged channel, keys or events (T11)', async () => {
    const { t } = await baseline();
    const r = await verifyIncident(t.input('technical'));
    expect(r.report.channels.privileged).toBeUndefined();
    expect(r.events.some((e) => e.channel === 'privileged')).toBe(false);
    expect(r.report.ok).toBe(true);
  });

  it('events without keys are "waiting for keys", not failures', async () => {
    const { t } = await baseline();
    const input = t.input('commander');
    input.getChannelKey = () => undefined;
    const r = await verifyIncident(input);
    expect(r.report.ok).toBe(true);
    expect(r.report.channels.privileged!.waitingForKeys).toBe(true);
    expect(r.events.every((e) => e.payload === null && e.verdict.warnings.includes('waiting_for_keys'))).toBe(true);
  });
});

describe('verifyIncident: tamper cases', () => {
  async function tampered(mutate: (ev: Record<ChannelKind, RawEvent[]>, t: TestIncident) => void, rehash = false) {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    mutate(ev, t);
    if (rehash) {
      // an attacker who recomputes the chain hashes after editing
      for (const c of Object.keys(ev) as ChannelKind[]) {
        let prev: Uint8Array | null = null;
        for (const e of ev[c]) {
          if (prev) e.prevHash = prev;
          e.hash = t.rehash(e);
          prev = e.hash;
        }
      }
    }
    return { t, r: await verifyIncident(t.input('commander', ev)) };
  }

  it('flipped ciphertext byte: chain, signature and decryption all fail (T3)', async () => {
    const { r } = await tampered((ev) => {
      ev.record[1].ciphertext[2] ^= 1;
    });
    const f = reasons(r, 'record');
    expect(f).toContain('2:chain_broken');
    expect(f).toContain('2:bad_signature');
    expect(f).toContain('2:cannot_decrypt');
    expect(r.report.ok).toBe(false);
  });

  it('flipped ciphertext with recomputed hashes still fails signature and decryption', async () => {
    const { r } = await tampered((ev) => {
      ev.record[1].ciphertext[2] ^= 1;
    }, true);
    const f = reasons(r, 'record');
    expect(f).toContain('2:bad_signature');
    expect(f).toContain('2:cannot_decrypt');
    expect(f).not.toContain('2:chain_broken');
  });

  it('server edits server_ts or author_counter: hash and replay checks catch it', async () => {
    const a = await tampered((ev) => {
      ev.record[0].serverTsMicros += 5n;
    });
    expect(reasons(a.r, 'record')).toContain('1:chain_broken');
    const b = await tampered((ev) => {
      ev.record[0].authorCounter += 10n;
    });
    expect(reasons(b.r, 'record')).toContain('1:chain_broken');
    expect(reasons(b.r, 'record')).toContain('1:bad_signature'); // counter is signed
    expect(reasons(b.r, 'record')).toContain('1:cannot_decrypt'); // and bound in the AAD
  });

  it('wrong AAD context: an event moved to another channel fails (T7)', async () => {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    // copy the #privileged event 1 into #command as if the server relocated it
    const moved = { ...ev.privileged[0], channel: 'command' as const, seq: 2n, prevHash: ev.command[0].hash };
    moved.hash = t.rehash(moved);
    ev.command.push(moved);
    const r = await verifyIncident(t.input('commander', ev));
    const f = reasons(r, 'command');
    expect(f).toContain('2:bad_signature');
    expect(f).toContain('2:cannot_decrypt');
  });

  it('wrong epoch: event claiming a different epoch fails', async () => {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    ev.record[0].epoch = 1;
    const input = t.input('commander', ev);
    const r = await verifyIncident(input);
    const f = reasons(r, 'record');
    expect(f).toContain('1:bad_signature');
    expect(f).toContain('1:chain_broken');
  });

  it('wrong author: attributing an event to another member fails', async () => {
    const { t, tech } = await baseline();
    const ev = t.cloneEvents();
    ev.record[0].author = tech.identityHex;
    const r = await verifyIncident(t.input('commander', ev));
    const f = reasons(r, 'record');
    expect(f).toContain('1:bad_signature');
  });

  it('swapped signature fails', async () => {
    const { r } = await tampered((ev) => {
      ev.record[0].signature = ev.record[1].signature.slice();
    }, true);
    expect(reasons(r, 'record')).toContain('1:bad_signature');
  });

  it('reordered events (swapped seq) are detected', async () => {
    const { r } = await tampered((ev) => {
      const [a, b] = [ev.record[0], ev.record[1]];
      a.seq = 2n;
      b.seq = 1n;
    });
    expect(r.report.channels.record!.ok).toBe(false);
    expect(reasons(r, 'record').some((x) => x.endsWith('chain_broken'))).toBe(true);
  });

  it('deleted event produces a gap and a broken link', async () => {
    const { r } = await tampered((ev) => {
      ev.record.splice(1, 1);
    });
    expect(reasons(r, 'record')).toContain('3:gap');
  });

  it('deleted first event is a gap at the first delivered event', async () => {
    const { r } = await tampered((ev) => {
      ev.record.splice(0, 1);
    });
    expect(reasons(r, 'record')).toContain('2:gap');
  });

  it('broken prevHash link is detected even if the event hash is recomputed', async () => {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    ev.record[2].prevHash = new Uint8Array(32).fill(1);
    ev.record[2].hash = t.rehash(ev.record[2]);
    const r = await verifyIncident(t.input('commander', ev));
    expect(reasons(r, 'record')).toContain('3:chain_broken');
  });

  it('server withholding the tail is detected via the channel head', async () => {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    const head = { seq: ev.record[2].seq, hash: ev.record[2].hash };
    ev.record.pop();
    const input = t.input('commander', ev);
    input.channels.record!.serverHead = head;
    const r = await verifyIncident(input);
    expect(reasons(r, 'record')).toContain('3:gap');
  });

  it('an empty channel whose server head is the genesis head is clean', async () => {
    const t = await TestIncident.create();
    const input = t.input('commander');
    input.channels.command!.serverHead = { seq: 0n, hash: genesisHash(t.incidentId, 'command') };
    const r = await verifyIncident(input);
    expect(r.report.ok).toBe(true);
    // A server claiming a different head for an empty channel is caught.
    input.channels.command!.serverHead = { seq: 0n, hash: new Uint8Array(32) };
    const bad = await verifyIncident(input);
    expect(reasons(bad, 'command')).toContain('0:chain_broken');
  });

  it('a pending member revoked before admission is not a roster failure', async () => {
    const t = await TestIncident.create();
    const p = await t.addMember('technical', 'Tom', 'pending');
    await t.revoke(p, 1_800_000_500_000_000n);
    const r = await verifyIncident(t.input('commander'));
    expect(r.report.rosterFailures).toEqual([]);
    expect(r.report.ok).toBe(true);
  });

  it('replayed event id is flagged (T6)', async () => {
    const { t, tech } = await baseline();
    const dupId = t.events.record[0].clientEventId;
    await t.append(tech, 'record', timeline('replay'), { eventId: dupId });
    const r = await verifyIncident(t.input('commander'));
    expect(r.events.some((e) => e.verdict.failures.includes('replay'))).toBe(true);
  });

  it('non-increasing author counter is flagged (T6)', async () => {
    const { t, tech } = await baseline();
    await t.append(tech, 'record', timeline('stale counter'), { counter: 1n });
    const r = await verifyIncident(t.input('commander'));
    const bad = r.events.filter((e) => e.verdict.failures.includes('replay'));
    expect(bad.length).toBe(1);
    expect(bad[0].seq).toBe(4n);
  });

  it('author counter is enforced across channels', async () => {
    const { t, tech } = await baseline();
    // tech already used counters 1 and 2 across #record and #technical
    await t.append(tech, 'technical', chat('reuse counter 2'), { counter: 2n });
    const r = await verifyIncident(t.input('commander'));
    expect(r.events.some((e) => e.channel === 'technical' && e.verdict.failures.includes('replay'))).toBe(true);
  });

  it('rewritten whole history is caught by the pinned head (T4)', async () => {
    const { t } = await baseline();
    const first = await verifyIncident(t.input('commander'));
    const pins = first.newHeads;
    // attacker rebuilds #record consistently from scratch, with different content
    const t2 = new TestIncident();
    Object.assign(t2, { incidentId: t.incidentId, members: t.members, channelKeys: t.channelKeys, commander: t.commander });
    t2.events = { record: [], command: [], privileged: [], technical: [] };
    const tech = [...t.members.values()].find((m) => m.role === 'technical')!;
    await t2.append(t.commander, 'record', timeline('Nothing happened'), { counter: 100n });
    await t2.append(tech, 'record', timeline('All clear'), { counter: 100n });
    await t2.append(tech, 'record', timeline('All clear again'), { counter: 101n });
    const input = t.input('commander', { ...t.events, record: t2.events.record }, pins);
    const r = await verifyIncident(input);
    expect(r.report.channels.record!.pinnedOk).toBe(false);
    expect(reasons(r, 'record').some((x) => x.endsWith('history_rewritten'))).toBe(true);
    expect(r.report.ok).toBe(false);
    expect(r.newHeads.record).toBeUndefined();
  });

  it('rollback (fewer events than the pinned head) is caught', async () => {
    const { t } = await baseline();
    const first = await verifyIncident(t.input('commander'));
    const ev = t.cloneEvents();
    ev.record.pop();
    const r = await verifyIncident(t.input('commander', ev, first.newHeads));
    expect(reasons(r, 'record')).toContain('3:history_rewritten');
  });

  it('pinned heads only advance and only over fully verified prefixes', async () => {
    const { t } = await baseline();
    const ev = t.cloneEvents();
    ev.record[1].ciphertext[0] ^= 1; // corrupt event 2
    const r = await verifyIncident(t.input('commander', ev));
    expect(r.newHeads.record?.seq).toBe(1n);
  });
});

describe('verifyIncident: checkpoints (PLAN 4.10)', () => {
  it('a valid commander checkpoint is reported as verified and keeps the report green', async () => {
    const { t } = await baseline();
    const input = t.input('commander');
    input.checkpoints = [await t.checkpoint('record', 2n), await t.checkpoint('record', 3n)];
    const r = await verifyIncident(input);
    expect(r.report.ok).toBe(true);
    expect(r.report.channels.record!.latestCheckpoint).toEqual({
      seq: 3n,
      hashHex: expect.any(String),
      verified: true,
    });
  });

  it('a fresh device (no pinned head) still catches a rewritten history via the checkpoint', async () => {
    const { t } = await baseline();
    const cp = await t.checkpoint('record', 2n);
    const ev = t.cloneEvents();
    ev.record[1].ciphertext[0] ^= 1;
    ev.record[1].hash = t.rehash(ev.record[1]);
    ev.record[2].prevHash = ev.record[1].hash;
    ev.record[2].hash = t.rehash(ev.record[2]);
    const input = t.input('commander', ev);
    input.checkpoints = [cp];
    const r = await verifyIncident(input);
    expect(reasons(r, 'record')).toContain('2:history_rewritten');
    expect(r.report.channels.record!.latestCheckpoint?.verified).toBe(false);
    expect(r.report.ok).toBe(false);
    expect(r.newHeads.record?.seq).toBe(1n);
  });

  it('truncation below a signed checkpoint is caught without any pin', async () => {
    const { t } = await baseline();
    const cp = await t.checkpoint('record', 3n);
    const ev = t.cloneEvents();
    ev.record.pop();
    const input = t.input('commander', ev);
    input.checkpoints = [cp];
    const r = await verifyIncident(input);
    expect(reasons(r, 'record')).toContain('3:history_rewritten');
    expect(r.report.ok).toBe(false);
  });

  it('a checkpoint not signed by the pinned commander is flagged, not trusted', async () => {
    const { t, counsel } = await baseline();
    const input = t.input('commander');
    input.checkpoints = [await t.checkpoint('record', 2n, undefined, counsel)];
    const r = await verifyIncident(input);
    expect(reasons(r, 'record')).toContain('2:history_rewritten');
    expect(r.report.channels.record!.latestCheckpoint?.verified).toBe(false);
    expect(r.report.ok).toBe(false);
  });

  it('a checkpoint over a different hash than the delivered event is flagged on that event', async () => {
    const { t } = await baseline();
    const input = t.input('commander');
    input.checkpoints = [await t.checkpoint('record', 2n, new Uint8Array(32).fill(9))];
    const r = await verifyIncident(input);
    const ev = r.events.find((e) => e.channel === 'record' && e.seq === 2n)!;
    expect(ev.verdict.failures).toContain('history_rewritten');
  });
});

describe('verifyIncident: roster and authorization', () => {
  it('uncertified author is rejected (T5)', async () => {
    const { t } = await baseline();
    const rogue = await t.addMember('technical', 'Rogue', 'active');
    rogue.row.admitSig = new Uint8Array(64).fill(1); // server-forged certificate
    await t.append(rogue, 'record', timeline('injected'));
    const r = await verifyIncident(t.input('commander'));
    const bad = r.events.find((e) => e.verdict.failures.includes('unknown_author'));
    expect(bad).toBeDefined();
    expect(bad!.author).toBeNull();
    expect(r.report.rosterFailures.length).toBeGreaterThan(0);
    expect(r.report.ok).toBe(false);
  });

  it('a server-swapped public key invalidates the member certificate (T5)', async () => {
    const { t, counsel } = await baseline();
    const attacker = await t.addMember('technical', 'Attacker');
    counsel.row.signPub = attacker.keys.signPub; // server swaps the key in the roster row
    const r = await verifyIncident(t.input('commander'));
    expect(r.roster.get(counsel.identityHex)!.certified).toBe(false);
    expect(r.events.some((e) => e.verdict.failures.includes('unknown_author'))).toBe(true);
  });

  it('a changed role or display name invalidates the certificate', async () => {
    const { t, tech } = await baseline();
    tech.row.role = 'commander';
    const r1 = await verifyIncident(t.input('commander'));
    expect(r1.roster.get(tech.identityHex)!.certified).toBe(false);
    tech.row.role = 'technical';
    tech.row.displayName = 'Someone Else';
    const r2 = await verifyIncident(t.input('commander'));
    expect(r2.roster.get(tech.identityHex)!.certified).toBe(false);
  });

  it('commander row with keys other than the pinned keys is rejected', async () => {
    const { t } = await baseline();
    const impostor = await t.addMember('commander', 'Fake Commander');
    const r = await verifyIncident(t.input('commander'));
    expect(r.roster.get(impostor.identityHex)!.certified).toBe(false);
    expect(r.report.rosterFailures.some((f) => f.reason.includes('pinned'))).toBe(true);
  });

  it('a later enrollment keeps earlier messages valid under the old key', async () => {
    const t = await TestIncident.create();
    const tech = await t.addMember('technical', 'Sam Tech');
    const before = await t.append(tech, 'record', timeline('before'));
    await t.revoke(tech, before.serverTsMicros + 1n);
    const keys = await generateDeviceKeys();
    const admitSig = await sign(
      t.commander.keys.signPriv,
      admitStatement(t.incidentId, tech.identityHex, 'technical', 'Sam Tech', keys.signPub, keys.ecdhPub),
    );
    const second: RosterMember = {
      memberId: 99n,
      identityHex: tech.identityHex,
      role: 'technical',
      state: 'active',
      displayName: 'Sam Tech',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      admitSig,
      revokeSig: new Uint8Array(0),
    };
    const saved = tech.keys;
    tech.keys = keys;
    const after = await t.append(tech, 'record', timeline('after'), { serverTsMicros: before.serverTsMicros + 10n });
    tech.keys = saved;
    const lateOld = await t.append(tech, 'record', timeline('old key again'), { serverTsMicros: before.serverTsMicros + 20n });
    const input = t.input('commander');
    input.members.push(second);
    const r = await verifyIncident(input);
    const byId = new Map(r.events.map((e) => [e.eventId, e]));
    expect(byId.get(before.clientEventId)!.verdict.ok).toBe(true);
    expect(byId.get(after.clientEventId)!.verdict.ok).toBe(true);
    expect(byId.get(lateOld.clientEventId)!.verdict.failures).toContain('revoked_author');
    expect(r.roster.get(tech.identityHex)!.member.state).toBe('active');
  });

  it('an old revocation signature copied onto a later enrollment of the same person is refused', async () => {
    const t = await TestIncident.create();
    const tech = await t.addMember('technical', 'Sam Tech');
    await t.revoke(tech, 1_800_000_000_000_500n);
    const oldSig = tech.row.revokeSig;
    const keys = await generateDeviceKeys();
    const admitSig = await sign(
      t.commander.keys.signPriv,
      admitStatement(t.incidentId, tech.identityHex, 'technical', 'Sam Tech', keys.signPub, keys.ecdhPub),
    );
    const second: RosterMember = {
      memberId: 99n,
      identityHex: tech.identityHex,
      role: 'technical',
      state: 'revoked',
      displayName: 'Sam Tech',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      admitSig,
      revokeSig: oldSig, // valid for the first enrollment's keys, not for these
      revokedAtMicros: 1_800_000_000_000_900n,
    };
    const input = t.input('commander');
    input.members.push(second);
    const r = await verifyIncident(input);
    expect(r.report.rosterFailures.some((f) => f.reason.includes('invalid revocation signature'))).toBe(true);
  });

  it('a return under another role keeps what the old key wrote valid', async () => {
    const t = await TestIncident.create();
    const counsel = await t.addMember('counsel', 'Dana Counsel');
    const before = await t.append(counsel, 'privileged', chat('privileged note'));
    await t.revoke(counsel, before.serverTsMicros + 1n);
    const keys = await generateDeviceKeys();
    const admitSig = await sign(
      t.commander.keys.signPriv,
      admitStatement(t.incidentId, counsel.identityHex, 'technical', 'Dana Counsel', keys.signPub, keys.ecdhPub),
    );
    const input = t.input('commander');
    input.members.push({
      memberId: 99n,
      identityHex: counsel.identityHex,
      role: 'technical',
      state: 'active',
      displayName: 'Dana Counsel',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      admitSig,
      revokeSig: new Uint8Array(0),
    });
    const r = await verifyIncident(input);
    expect(r.events.find((e) => e.eventId === before.clientEventId)!.verdict.ok).toBe(true);
  });

  it('events after revocation are invalid, earlier ones stay valid (T13)', async () => {
    const { t, tech } = await baseline();
    const before = t.events.record.find((e) => e.author === tech.identityHex)!;
    await t.revoke(tech, before.serverTsMicros + 1n);
    await t.append(tech, 'record', timeline('after revoke'), { serverTsMicros: before.serverTsMicros + 10n });
    const r = await verifyIncident(t.input('commander'));
    const byId = new Map(r.events.map((e) => [e.eventId, e]));
    expect(byId.get(before.clientEventId)!.verdict.ok).toBe(true);
    const after = r.events.find((e) => e.verdict.failures.includes('revoked_author'));
    expect(after).toBeDefined();
  });

  it('a revocation with an invalid signature is reported and not honoured', async () => {
    const { t, tech } = await baseline();
    tech.row.state = 'revoked';
    tech.row.revokedAtMicros = 1n;
    tech.row.revokeSig = new Uint8Array(64).fill(2);
    const r = await verifyIncident(t.input('commander'));
    expect(r.report.rosterFailures.some((f) => f.reason.includes('revocation'))).toBe(true);
    expect(r.events.some((e) => e.verdict.failures.includes('revoked_author'))).toBe(false);
  });

  it('role that cannot write the channel is not permitted (executive in #record)', async () => {
    const { t, exec } = await baseline();
    await t.append(exec, 'record', timeline('exec writes record'));
    const r = await verifyIncident(t.input('commander'));
    expect(r.events.some((e) => e.author?.identity === exec.identityHex && e.verdict.failures.includes('not_permitted'))).toBe(true);
  });

  it('kind not allowed for the role is not permitted (technical sets status)', async () => {
    const { t, tech } = await baseline();
    await t.append(tech, 'record', { v: 1, kind: 'status.set', sentAt: new Date(1_800_000_001_000).toISOString(), body: { severity: 'SEV1', phase: 'containment', summary: 'x' } });
    const r = await verifyIncident(t.input('commander'));
    expect(r.events.some((e) => e.verdict.failures.includes('not_permitted'))).toBe(true);
  });

  it('chat in #record and record kinds in chat channels are not permitted', async () => {
    const { t } = await baseline();
    await t.append(t.commander, 'record', chat('chat in record'));
    await t.append(t.commander, 'command', timeline('timeline in command'));
    const r = await verifyIncident(t.input('commander'));
    expect(reasons(r, 'record').some((x) => x.endsWith('not_permitted'))).toBe(true);
    expect(reasons(r, 'command').some((x) => x.endsWith('not_permitted'))).toBe(true);
  });

  it('appending in an older epoch after a newer one is flagged (stale_epoch)', async () => {
    const { t } = await baseline();
    const raw = new Uint8Array(32).fill(5);
    const { importChannelKey } = await import('./seal');
    t.channelKeys.set('command/1', await importChannelKey(raw));
    await t.append(t.commander, 'command', chat('new epoch'), { epoch: 1 });
    await t.append(t.commander, 'command', chat('old epoch'), { epoch: 0 });
    const r = await verifyIncident(t.input('commander'));
    const f: FailureReason[] = r.events.flatMap((e) => e.verdict.failures);
    expect(f).toContain('stale_epoch');
  });
});

describe('verifyIncident: payload handling', () => {
  it('invalid payload and unknown kind are flagged, not dropped', async () => {
    const { t } = await baseline();
    // a correctly sealed and signed event whose plaintext is not a valid payload
    const { createSealedEvent } = await import('./event');
    const { genesisHash } = await import('./chain');
    const author = t.commander;
    for (const [i, text] of ['{"v":1,"kind":"chat.post","sentAt":"x","body":{}}', '{"v":1,"kind":"chat.nuke","sentAt":"2026-11-07T14:00:00Z","body":{}}'].entries()) {
      const list = t.events.command;
      const prev = list[list.length - 1];
      const counter = BigInt(50 + i);
      const eventId = crypto.randomUUID();
      const core = { incidentId: t.incidentId, channel: 'command', epoch: 0, author: author.identityHex, clientEventId: eventId, authorCounter: counter };
      const sealed = await createSealedEvent(core, new TextEncoder().encode(text), t.channelKeys.get('command/0')!, author.keys.signPriv);
      t.clock += 1_000_000n;
      const ev: RawEvent = { channel: 'command', seq: BigInt(list.length + 1), epoch: 0, author: author.identityHex, clientEventId: eventId, authorCounter: counter, ...sealed, serverTsMicros: t.clock, prevHash: prev ? prev.hash : genesisHash(t.incidentId, 'command'), hash: new Uint8Array(32) };
      ev.hash = t.rehash(ev);
      list.push(ev);
    }
    const r = await verifyIncident(t.input('commander'));
    const f = r.events.flatMap((e) => e.verdict.failures);
    expect(f).toContain('invalid_payload');
    expect(f).toContain('unknown_kind');
    expect(r.events.length).toBe(9); // nothing dropped
  });

  it('clock drift over 5 minutes is a warning, not a failure', async () => {
    const { t } = await baseline();
    await t.append(t.commander, 'command', chat('skewed', 1_800_000_000_000_000n - 3_600_000_000n));
    const r = await verifyIncident(t.input('commander'));
    const skew = r.events.find((e) => e.verdict.warnings.includes('clock_drift'));
    expect(skew).toBeDefined();
    expect(skew!.verdict.ok).toBe(true);
    expect(r.report.ok).toBe(true);
  });
});
