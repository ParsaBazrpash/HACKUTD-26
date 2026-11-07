/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing over the harness's untyped reducer and view calls */
// Test-only IncidentBackend that runs the REAL Spacetime module on the module
// test harness. Several clients share one hub (one database). Each client is a
// different Spacetime identity, sees only its own `my_*` views, and every
// reducer call goes through the same checks as production.

import { ConnectionId, Identity, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '@/spacetimedb/src/index';
import { isChannel } from '@/spacetimedb/src/shared/policy';
import type {
  AttemptRow,
  BackendRows,
  ChannelRow,
  CheckpointRow,
  ConnectionState,
  EnvelopeRow,
  EventRow,
  IncidentBackend,
  IncidentRow,
  InviteRow,
  MemberRow,
} from '@/lib/client/backend';

export type Harness = ReturnType<typeof createModuleTestHarness>;
type Auth = ReturnType<typeof TestAuth.fromJwtPayload>;

export class HarnessHub {
  readonly h: Harness;
  private readonly backends = new Set<HarnessBackend>();
  constructor() {
    this.h = createModuleTestHarness(mod.default, mod) as unknown as Harness;
    this.h.clock.set(new Timestamp(1_800_000_000_000_000n));
  }
  backend(name: string): HarnessBackend {
    const b = new HarnessBackend(this, name);
    this.backends.add(b);
    return b;
  }
  tick(): void {
    this.h.clock.set(new Timestamp(this.h.clock.now().microsSinceUnixEpoch + 1_000_000n));
  }
  advanceMinutes(min: number): void {
    this.h.clock.set(new Timestamp(this.h.clock.now().microsSinceUnixEpoch + BigInt(min) * 60_000_000n));
  }
  notify(): void {
    queueMicrotask(() => {
      for (const b of this.backends) b.fire();
    });
  }
}

const micros = (t: { microsSinceUnixEpoch: bigint }) => t.microsSinceUnixEpoch;

export class HarnessBackend implements IncidentBackend {
  private readonly auth: Auth;
  private readonly listeners = new Set<() => void>();
  online = true;
  constructor(
    private readonly hub: HarnessHub,
    readonly name: string,
  ) {
    this.auth = TestAuth.fromJwtPayload(
      JSON.stringify({ iss: 'https://test', sub: `${name}-${crypto.randomUUID()}`, aud: 'zerohour' }),
      ConnectionId.random(),
    );
  }

  fire(): void {
    for (const l of [...this.listeners]) l();
  }
  connection(): ConnectionState {
    return this.online ? 'ready' : 'offline';
  }
  identityHex(): string | null {
    return this.hub.h.withReducerTx(this.auth, (ctx: any) => ctx.sender.toHexString() as string);
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private view(v: unknown): any[] {
    return (v as (c: unknown) => any[])(this.hub.h.viewContext(this.auth));
  }

  private memberRow(m: any): MemberRow {
    return {
      memberId: m.id,
      incidentId: m.incidentId,
      identityHex: m.identity.toHexString(),
      role: m.role,
      state: m.state,
      displayName: m.displayName,
      signPub: m.signPub,
      ecdhPub: m.ecdhPub,
      joinTag: m.joinTag,
      inviteCodeHash: m.inviteCodeHash,
      admitSig: m.admitSig,
      revokeSig: m.revokeSig,
      lastCounter: m.lastCounter,
      joinedAtMicros: micros(m.joinedAt),
      admittedAtMicros: m.admittedAt ? micros(m.admittedAt) : undefined,
      revokedAtMicros: m.revokedAt ? micros(m.revokedAt) : undefined,
    };
  }

  rows(): BackendRows {
    return {
      status: this.view(mod.my_status).map((m) => this.memberRow(m)),
      incidents: this.view(mod.my_incidents).map(
        (i): IncidentRow => ({
          id: i.id,
          commanderHex: i.commander.toHexString(),
          commanderSignPub: i.commanderSignPub,
          commanderEcdhPub: i.commanderEcdhPub,
          createdAtMicros: micros(i.createdAt),
          closed: i.closed,
        }),
      ),
      members: this.view(mod.my_members).map((m) => this.memberRow(m)),
      channels: this.view(mod.my_channels).map(
        (c): ChannelRow => ({
          incidentId: c.incidentId,
          kind: c.kind,
          currentEpoch: c.currentEpoch,
          headSeq: c.headSeq,
          headHash: c.headHash,
        }),
      ),
      envelopes: this.view(mod.my_envelopes).map(
        (e): EnvelopeRow => ({
          incidentId: e.incidentId,
          kind: e.kind,
          epoch: e.epoch,
          recipientHex: e.recipient.toHexString(),
          wrapped: e.wrapped,
          iv: e.iv,
        }),
      ),
      events: this.view(mod.my_events)
        .filter((e) => isChannel(e.kind))
        .map(
          (e): EventRow => ({
            incidentId: e.incidentId,
            channel: e.kind,
            seq: e.seq,
            epoch: e.epoch,
            author: e.author.toHexString(),
            clientEventId: e.clientEventId,
            authorCounter: e.authorCounter,
            iv: e.iv,
            ciphertext: e.ciphertext,
            signature: e.signature,
            serverTsMicros: micros(e.serverTs),
            prevHash: e.prevHash,
            hash: e.hash,
          }),
        ),
      invites: this.view(mod.my_invites).map(
        (i): InviteRow => ({
          incidentId: i.incidentId,
          codeHash: i.codeHash,
          role: i.role,
          expiresAtMicros: micros(i.expiresAt),
          used: i.used,
        }),
      ),
      joinAttempts: this.view(mod.my_join_attempts).map(
        (a): AttemptRow => ({ incidentId: a.incidentId, ok: a.ok, atMicros: micros(a.at) }),
      ),
      checkpoints: this.view(mod.my_checkpoints).map(
        (c): CheckpointRow => ({ incidentId: c.incidentId, kind: c.kind, seq: c.seq, hash: c.hash, signature: c.signature }),
      ),
    };
  }

  private call(reducer: unknown, args: object): Promise<void> {
    if (!this.online) return Promise.reject(new Error('offline'));
    try {
      this.hub.tick();
      this.hub.h.withReducerTx(this.auth, (ctx: any) => (reducer as (c: unknown, a: object) => void)(ctx, args));
    } catch (e) {
      return Promise.reject(e);
    }
    this.hub.notify();
    return Promise.resolve();
  }

  createIncident(a: Parameters<IncidentBackend['createIncident']>[0]) {
    return this.call(mod.create_incident, a);
  }
  createInvite(a: Parameters<IncidentBackend['createInvite']>[0]) {
    return this.call(mod.create_invite, a);
  }
  redeemInvite(a: Parameters<IncidentBackend['redeemInvite']>[0]) {
    return this.call(mod.redeem_invite, a);
  }
  admitMember(a: Parameters<IncidentBackend['admitMember']>[0]) {
    return this.call(mod.admit_member, a);
  }
  revokeMember(a: Parameters<IncidentBackend['revokeMember']>[0]) {
    return this.call(mod.revoke_member, {
      ...a,
      rotations: a.rotations.map((r) => ({
        ...r,
        envelopes: r.envelopes.map((e) => ({
          recipient: Identity.fromString(e.recipientHex),
          wrapped: e.wrapped,
          iv: e.iv,
        })),
      })),
    });
  }
  appendEvent(a: Parameters<IncidentBackend['appendEvent']>[0]) {
    return this.call(mod.append_event, a);
  }
  postCheckpoint(a: Parameters<IncidentBackend['postCheckpoint']>[0]) {
    return this.call(mod.post_checkpoint, a);
  }
}
