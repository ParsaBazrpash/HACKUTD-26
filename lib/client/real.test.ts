/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing over the harness's untyped rows */
// Two-client integration tests: the real client, the real crypto, the real
// Spacetime module (on the module test harness), one IndexedDB per browser.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HarnessHub } from '@/tests/support/harness-backend';
import { IncidentStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { parseInviteFragment } from '@/lib/crypto/invite';
import { RealIncidentClient } from './real';

let n = 0;
const all: { client: RealIncidentClient }[] = [];
function browser(hub: HarnessHub, name: string) {
  const db = makeTestStore(`${name}-${++n}`);
  const backend = hub.backend(name);
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.test',
    storeFor: (id) => new IncidentStore(id, db),
    now: () => Number(hub.h.clock.now().microsSinceUnixEpoch / 1000n),
    waitMs: 200,
  });
  all.push({ client });
  return { name, backend, client, db };
}
type Browser = ReturnType<typeof browser>;
const fragmentOf = (url: string) => url.slice(url.indexOf('#') + 1);

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(all.map((b) => b.client.whenIdle()));
  }
}

async function startIncident(hub: HarnessHub) {
  const cmd = browser(hub, 'cmd');
  const { incidentId } = await cmd.client.createIncident({ title: 'Ransomware at Lakeside', displayName: 'Casey' });
  await settle();
  return { cmd, incidentId };
}

async function joinAs(hub: HarnessHub, cmd: Browser, role: 'counsel' | 'technical' | 'executive', name: string) {
  const b = browser(hub, name);
  const { url } = await cmd.client.createInvite({ role });
  await b.client.redeemInvite({ fragment: fragmentOf(url), displayName: name });
  await settle();
  return b;
}

async function joinAndAdmit(hub: HarnessHub, cmd: Browser, role: 'counsel' | 'technical' | 'executive', name: string) {
  const b = await joinAs(hub, cmd, role, name);
  const pending = cmd.client.getState().members.find((m) => m.displayName === name)!;
  await cmd.client.admitMember(pending.memberId);
  await settle();
  return b;
}

const texts = (b: Browser, ch: 'command' | 'privileged' | 'technical') =>
  b.client.getState().channels.find((c) => c.kind === ch)?.messages.map((m) => m.text) ?? [];

describe('create incident', () => {
  it('commander holds the keys, appears verified, and the title comes back through the verified fold', async () => {
    const hub = new HarnessHub();
    const { cmd, incidentId } = await startIncident(hub);
    const s = cmd.client.getState();
    expect(s.connection).toBe('ready');
    expect(s.me).toMatchObject({ role: 'commander', state: 'active', displayName: 'Casey', verified: true });
    expect(s.me?.safetyCode).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(s.incident).toMatchObject({ id: incidentId, title: 'Ransomware at Lakeside' });
    expect(s.integrity.ok).toBe(true);
    expect(s.channels.map((c) => c.kind).sort()).toEqual(['command', 'privileged', 'technical']);
  });

  it('rejects an empty title or name before anything is sent', async () => {
    const hub = new HarnessHub();
    const cmd = browser(hub, 'cmd');
    await expect(cmd.client.createIncident({ title: '  ', displayName: 'Casey' })).rejects.toThrow();
    await expect(cmd.client.createIncident({ title: 'x', displayName: '' })).rejects.toThrow();
    expect(hub.h.db.incident.count()).toBe(0n);
  });
});

describe('invite, redeem, admit', () => {
  it('walks the full handshake and exchanges an encrypted privileged message', async () => {
    const hub = new HarnessHub();
    const { cmd, incidentId } = await startIncident(hub);
    const dana = await joinAs(hub, cmd, 'counsel', 'Dana');

    // The joiner is pending, pinned the commander, and sees only the commander and themselves.
    const ds = dana.client.getState();
    expect(ds.me).toMatchObject({ role: 'counsel', state: 'pending' });
    expect(ds.members.map((m) => m.displayName).sort()).toEqual(['Casey', 'Dana']);
    expect(ds.channels).toEqual([]);
    expect(ds.integrity.ok).toBe(true);

    // The commander sees the verified link and the same safety code the joiner sees.
    const pending = cmd.client.getState().members.find((m) => m.displayName === 'Dana')!;
    expect(pending).toMatchObject({ state: 'pending', linkVerified: true, verified: false });
    expect(pending.safetyCode).toBe(ds.me?.safetyCode);

    await cmd.client.admitMember(pending.memberId);
    await settle();
    const after = dana.client.getState();
    expect(after.me).toMatchObject({ state: 'active', verified: true });
    expect(after.channels.map((c) => c.kind).sort()).toEqual(['command', 'privileged', 'technical']);
    expect(after.incident?.title).toBe('Ransomware at Lakeside');

    await cmd.client.postMessage('privileged', { text: 'Engage outside counsel', mentions: [] });
    await dana.client.postMessage('privileged', { text: 'Agreed. Preserve logs.', mentions: [] });
    await settle();
    expect(texts(cmd, 'privileged')).toEqual(['Engage outside counsel', 'Agreed. Preserve logs.']);
    expect(texts(dana, 'privileged')).toEqual(['Engage outside counsel', 'Agreed. Preserve logs.']);
    const msg = dana.client.getState().channels.find((c) => c.kind === 'privileged')!.messages[1];
    expect(msg.verdict.ok).toBe(true);
    expect(msg.author).toMatchObject({ displayName: 'Dana', role: 'counsel' });

    // The server only ever stores ciphertext.
    const stored = [...hub.h.db.event.iter()].filter((e) => e.incidentId === incidentId);
    const bytes = new TextDecoder('utf-8').decode(stored[stored.length - 1].ciphertext);
    expect(bytes).not.toContain('Preserve');
    expect(cmd.client.getState().integrity.ok).toBe(true);
    expect(dana.client.getState().integrity.ok).toBe(true);
  });

  it('technical has no #privileged channel, key, envelope or event', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    const tom = await joinAndAdmit(hub, cmd, 'technical', 'Tom');
    await cmd.client.postMessage('privileged', { text: 'privileged strategy', mentions: [] });
    await cmd.client.postMessage('technical', { text: 'isolate the file server', mentions: [] });
    await settle();

    const ts = tom.client.getState();
    expect(ts.channels.map((c) => c.kind).sort()).toEqual(['command', 'technical']);
    expect(texts(tom, 'technical')).toEqual(['isolate the file server']);
    const rows = tom.backend.rows();
    expect(rows.envelopes.some((e) => e.kind === 'privileged')).toBe(false);
    expect(rows.channels.some((c) => c.kind === 'privileged')).toBe(false);
    expect(rows.events.some((e) => e.channel === 'privileged')).toBe(false);
    await expect(tom.client.postMessage('privileged', { text: 'hello', mentions: [] })).rejects.toThrow();
    const erin = await joinAndAdmit(hub, cmd, 'executive', 'Erin');
    expect(erin.client.getState().channels.map((c) => c.kind).sort()).toEqual(['command', 'privileged']);
    expect(erin.backend.rows().envelopes.some((e) => e.kind === 'technical')).toBe(false);
    // Counsel can read #technical but executives cannot.
    expect(dana.client.getState().channels.map((c) => c.kind)).toContain('technical');
  });

  it('role limits on #record are enforced client-side too', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const exec = await joinAndAdmit(hub, cmd, 'executive', 'Erin');
    await expect(
      exec.client.addTimelineEntry({
        occurredAt: new Date().toISOString(),
        phase: 'detection_analysis',
        csf: 'DE.AE',
        text: 'nope',
      }),
    ).rejects.toThrow();
    await expect(exec.client.setStatus({ severity: 'SEV1', phase: 'containment', summary: 'x' })).rejects.toThrow();
  });

  it('record actions fold through verified events', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    await cmd.client.setStatus({ severity: 'SEV2', phase: 'containment', summary: 'Contained VPN' });
    await cmd.client.addTimelineEntry({
      occurredAt: '2027-01-15T02:13:00.000Z',
      phase: 'detection_analysis',
      csf: 'DE.AE',
      text: 'EDR alert on file server',
    });
    await dana.client.setProfile({
      publicCompany: false,
      hipaaCoveredEntity: true,
      nydfsRegulated: false,
      defenseContractor: false,
      bank: false,
      euDataSubjects: false,
    });
    await dana.client.recordDiscovery({ determinedAt: '2027-01-15T04:00:00.000Z', basis: 'Forensics confirmed exfiltration' });
    await settle();
    for (const b of [cmd, dana]) {
      const s = b.client.getState();
      expect(s.status).toMatchObject({ severity: 'SEV2', summary: 'Contained VPN' });
      expect(s.timeline.map((t) => t.entry.text)).toEqual(['EDR alert on file server']);
      expect(s.profile.hipaaCoveredEntity).toBe(true);
      expect(s.discovery?.basis).toBe('Forensics confirmed exfiltration');
      expect(s.integrity.ok).toBe(true);
    }
  });
});

describe('join safety', () => {
  it('refuses to pin a commander whose fingerprint differs from the invite link', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const { url } = await cmd.client.createInvite({ role: 'counsel' });
    const frag = fragmentOf(url).replace(/f=[^&]+/, 'f=' + b64urlEncode(new Uint8Array(32).fill(9)));
    const mallory = browser(hub, 'mallory');
    await mallory.client.redeemInvite({ fragment: frag, displayName: 'Dana' });
    await settle();
    const s = mallory.client.getState();
    expect(s.connection).toBe('error');
    expect(s.error).toMatch(/not the incident you were invited to/);
    expect(await new IncidentStore(s.me?.memberId ? '' : '', mallory.db).getCommander()).toBeUndefined();
  });

  it('commander refuses to admit a join whose tag does not match the invite secret', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const { url } = await cmd.client.createInvite({ role: 'counsel' });
    // An attacker who saw the code (but not the secret) joins with a guessed secret.
    const frag = fragmentOf(url).replace(/s=[^&]+/, 's=' + b64urlEncode(new Uint8Array(32).fill(7)));
    const evil = browser(hub, 'evil');
    await evil.client.redeemInvite({ fragment: frag, displayName: 'Dana' });
    await settle();
    const pending = cmd.client.getState().members.find((m) => m.displayName === 'Dana')!;
    expect(pending.linkVerified).toBe(false);
    await expect(cmd.client.admitMember(pending.memberId)).rejects.toThrow(/do not admit/);
    expect(hub.h.db.key_envelope.count()).toBe(4n); // only the commander's own
  });

  it('an invite works once, a bad link is rejected, and a taken name is refused', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const { url } = await cmd.client.createInvite({ role: 'counsel' });
    const a = browser(hub, 'a');
    await a.client.redeemInvite({ fragment: fragmentOf(url), displayName: 'Dana' });
    const b = browser(hub, 'b');
    await expect(b.client.redeemInvite({ fragment: fragmentOf(url), displayName: 'Dan' })).rejects.toThrow();
    await expect(b.client.redeemInvite({ fragment: 'garbage', displayName: 'Dan' })).rejects.toThrow(/not valid/);
    const { url: url2 } = await cmd.client.createInvite({ role: 'technical' });
    await expect(b.client.redeemInvite({ fragment: fragmentOf(url2), displayName: 'casey' })).rejects.toThrow();
  });
});

describe('revoke', () => {
  it('locks the target, rotates keys, and the target cannot read what comes next', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    const erin = await joinAndAdmit(hub, cmd, 'counsel', 'Erin');
    await cmd.client.postMessage('privileged', { text: 'before revoke', mentions: [] });
    await settle();
    expect(texts(dana, 'privileged')).toEqual(['before revoke']);

    const danaMember = cmd.client.getState().members.find((m) => m.displayName === 'Dana')!;
    await cmd.client.revokeMember(danaMember.memberId, 'left the engagement');
    await settle();

    // Dana is locked out and her local keys are gone.
    const ds = dana.client.getState();
    expect(ds.me).toMatchObject({ state: 'revoked' });
    expect(ds.channels).toEqual([]);
    expect(ds.timeline).toEqual([]);
    expect(await new IncidentStore(cmd.client.getState().incident!.id, dana.db).getDeviceKeys()).toBeUndefined();

    // Everyone else moved to the next epoch and can still read the past and the future.
    await cmd.client.postMessage('privileged', { text: 'after revoke', mentions: [] });
    await erin.client.postMessage('privileged', { text: 'erin after', mentions: [] });
    await settle();
    expect(texts(cmd, 'privileged')).toEqual(['before revoke', 'after revoke', 'erin after']);
    expect(texts(erin, 'privileged')).toEqual(['before revoke', 'after revoke', 'erin after']);
    expect(cmd.client.getState().integrity.ok).toBe(true);
    expect(erin.client.getState().integrity.ok).toBe(true);
    expect(cmd.client.getState().members.find((m) => m.displayName === 'Dana')).toMatchObject({ state: 'revoked', verified: true });

    // Dana's backend rows no longer include anything about the incident's content.
    const rows = dana.backend.rows();
    expect(rows.events).toEqual([]);
    expect(rows.envelopes).toEqual([]);
  });

  it('revoking a pending member needs no rotation', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    await joinAs(hub, cmd, 'technical', 'Tom');
    const tom = cmd.client.getState().members.find((m) => m.displayName === 'Tom')!;
    await cmd.client.revokeMember(tom.memberId, 'wrong person');
    await settle();
    expect(cmd.client.getState().members.find((m) => m.displayName === 'Tom')?.state).toBe('revoked');
    expect(cmd.client.getState().integrity.ok).toBe(true);
  });

  it('only the commander can invite, admit or revoke', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    await expect(dana.client.createInvite({ role: 'technical' })).rejects.toThrow();
    const me = dana.client.getState().members.find((m) => m.displayName === 'Casey')!;
    await expect(dana.client.revokeMember(me.memberId, 'coup')).rejects.toThrow();
    await expect(dana.client.admitMember(me.memberId)).rejects.toThrow();
  });
});

describe('tamper detection', () => {
  it('flipping a stored ciphertext turns every reader red at the right seq', async () => {
    const hub = new HarnessHub();
    const { cmd, incidentId } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    await cmd.client.postMessage('privileged', { text: 'one', mentions: [] });
    await cmd.client.postMessage('privileged', { text: 'two', mentions: [] });
    await settle();
    expect(dana.client.getState().integrity.ok).toBe(true);

    const rows = [...hub.h.db.event.iter()].filter((e) => e.incidentId === incidentId && e.kind === 'privileged');
    const victim = rows[1];
    const flipped = victim.ciphertext.slice();
    flipped[0] ^= 1;
    (hub.h.db.event.id as any).update({ ...victim, ciphertext: flipped });
    hub.notify();
    await settle();

    for (const b of [cmd, dana]) {
      const r = await b.client.verifyAll();
      expect(r.ok).toBe(false);
      const ch = r.channels.privileged!;
      expect(ch.ok).toBe(false);
      expect(ch.failures.some((f) => f.seq === 2n)).toBe(true);
    }
  });
});

describe('checkpoints (PLAN 4.10)', () => {
  it('the commander can sign a checkpoint; every reader verifies it; others cannot sign', async () => {
    const hub = new HarnessHub();
    const { cmd, incidentId } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    await cmd.client.postMessage('privileged', { text: 'one', mentions: [] });
    await settle();
    await expect(dana.client.signCheckpoint()).rejects.toThrow('Only the commander');
    await cmd.client.signCheckpoint();
    await settle();
    expect(hub.h.db.checkpoint.count()).toBeGreaterThan(0n);
    for (const b of [cmd, dana]) {
      const r = await b.client.verifyAll();
      expect(r.ok).toBe(true);
      expect(r.channels.privileged!.latestCheckpoint).toMatchObject({ seq: 1n, verified: true });
      expect(r.channels.record!.latestCheckpoint?.verified).toBe(true);
    }
    // Nothing new since: a second call posts nothing and does not fail.
    await cmd.client.signCheckpoint();
    const rows = [...hub.h.db.checkpoint.iter()].filter((c) => c.incidentId === incidentId);
    expect(new Set(rows.map((c) => `${c.kind}/${c.seq}`)).size).toBe(rows.length);
  });

  it('the commander client checkpoints automatically every 10 events', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    expect(hub.h.db.checkpoint.count()).toBe(0n);
    for (let i = 0; i < 11; i++) await cmd.client.postMessage('command', { text: `msg ${i}`, mentions: [] });
    await settle();
    await settle();
    const rows = [...hub.h.db.checkpoint.iter()].filter((c) => c.kind === 'command');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].seq).toBeGreaterThanOrEqual(10n);
    expect((await cmd.client.verifyAll()).channels.command!.latestCheckpoint?.verified).toBe(true);
  });

  it('removing events the commander has checkpointed turns readers red, even if the head is rewound', async () => {
    const hub = new HarnessHub();
    const { cmd, incidentId } = await startIncident(hub);
    const dana = await joinAndAdmit(hub, cmd, 'counsel', 'Dana');
    for (const t of ['a', 'b', 'c']) await cmd.client.postMessage('privileged', { text: t, mentions: [] });
    await cmd.client.signCheckpoint();
    await settle();
    const ch = [...hub.h.db.channel.iter()].find((c) => c.incidentId === incidentId && c.kind === 'privileged')!;
    const evs = [...hub.h.db.event.iter()].filter((e) => e.channelId === ch.id).sort((a, b) => Number(a.seq - b.seq));
    const last = evs[evs.length - 1];
    const prev = evs[evs.length - 2];
    (hub.h.db.event.id as any).delete(last.id);
    (hub.h.db.channel.id as any).update({ ...ch, headSeq: prev.seq, headHash: prev.hash });
    hub.notify();
    await settle();
    for (const b of [cmd, dana]) {
      const r = await b.client.verifyAll();
      expect(r.ok).toBe(false);
      expect(r.channels.privileged!.failures.some((f) => f.reason === 'history_rewritten' && f.seq === 3n)).toBe(true);
    }
  });
});

describe('resume after a reload', () => {
  function memoryLast() {
    let id: string | null = null;
    return {
      get: async () => id,
      set: async (v: string) => {
        id = v;
      },
    };
  }

  it('a new client on the same device reopens the last incident without being told which', async () => {
    const hub = new HarnessHub();
    const last = memoryLast();
    const db = makeTestStore(`resume-${++n}`);
    // A reload keeps the browser's server identity and its IndexedDB.
    const backend = hub.backend('resumer');
    const open = () => {
      const client = new RealIncidentClient(backend, {
        origin: 'https://zerohour.test',
        storeFor: (id) => new IncidentStore(id, db),
        now: () => Number(hub.h.clock.now().microsSinceUnixEpoch / 1000n),
        waitMs: 200,
        lastIncident: last,
      });
      all.push({ client });
      return client;
    };
    const first = open();
    const { incidentId } = await first.createIncident({ title: 'Ransomware at Lakeside', displayName: 'Casey' });
    await settle();

    const reloaded = open();
    await settle();
    await new Promise((r) => setTimeout(r, 20));
    await settle();
    expect(reloaded.getState().incident?.id).toBe(incidentId);
    expect(reloaded.getState().me?.role).toBe('commander');
    expect(reloaded.getState().integrity.ok).toBe(true);
  });

  it('does nothing when no incident was remembered, and ignores a malformed id', async () => {
    const hub = new HarnessHub();
    const db = makeTestStore(`resume-${++n}`);
    for (const stored of [null, 'not-a-uuid', '<img src=x onerror=alert(1)>']) {
      const client = new RealIncidentClient(hub.backend('nobody'), {
        origin: 'https://zerohour.test',
        storeFor: (id) => new IncidentStore(id, db),
        waitMs: 200,
        lastIncident: { get: async () => stored, set: async () => undefined },
      });
      all.push({ client });
      await settle();
      expect(client.getState().incident).toBeNull();
    }
  });
});

describe('the invite secret stays in the browser (T18)', () => {
  it('redeeming sends the join tag and the public code, never the invite secret', async () => {
    const hub = new HarnessHub();
    const { cmd } = await startIncident(hub);
    const { url } = await cmd.client.createInvite({ role: 'counsel' });
    const fragment = fragmentOf(url);
    const secret = parseInviteFragment(fragment)!.secret;

    const joiner = browser(hub, 'Dana');
    const sent: Uint8Array[] = [];
    const original = joiner.backend.redeemInvite.bind(joiner.backend);
    joiner.backend.redeemInvite = (a) => {
      for (const v of Object.values(a)) if (v instanceof Uint8Array) sent.push(v);
      return original(a);
    };
    await joiner.client.redeemInvite({ fragment, displayName: 'Dana' });
    await settle();

    expect(sent.length).toBeGreaterThanOrEqual(4);
    const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
    for (const v of sent) expect(hex(v)).not.toContain(hex(secret));

    // Nothing stored by the module contains it either.
    const stored = JSON.stringify(
      [...hub.h.db.invite.iter(), ...hub.h.db.member.iter()],
      (_k, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? v.toString() : v),
    );
    expect(stored).not.toContain(hex(secret));
    expect(stored).not.toContain(b64urlEncode(secret));
    // Sanity: the public code is what the module does see.
    expect(sent.map(hex)).toContain(hex(parseInviteFragment(fragment)!.code));
  });
});
