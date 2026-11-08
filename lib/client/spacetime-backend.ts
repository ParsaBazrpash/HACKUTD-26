// IncidentBackend over the generated Spacetime bindings (docs/PLAN.md 6.4).
//
// Subscribes ONLY to the role-filtered `my_*` views. Tables are never read
// directly (they are private). Rows are converted to plain data; nothing here
// interprets ciphertext. Browser only.

// Must load before the bindings: swaps the SDK's eval-based codecs so the
// production CSP can keep 'unsafe-eval' out of script-src (see strict-csp.ts).
import './strict-csp';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '@/src/module_bindings';
import { isChannel, type ChannelKind } from '@/spacetimedb/src/shared/policy';
import type {
  BackendRows,
  ConnectionState,
  IncidentBackend,
  MemberRow,
  OrgBackend,
  OrgMemberRow,
  OrgRows,
} from './backend';

const TOKEN_KEY = 'zh-spacetime-token';

/** Where the Spacetime auth token lives. Defaults to localStorage. */
export interface TokenStore {
  read(): string | undefined;
  write(token: string): void;
}

export const localTokenStore: TokenStore = {
  read() {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  write(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage may be unavailable (private window); the session still works */
    }
  },
};

const micros = (t: { microsSinceUnixEpoch: bigint }) => t.microsSinceUnixEpoch;

type OrgMemberWire = {
  id: bigint;
  orgId: string;
  identity: Identity;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  joinTag: Uint8Array;
  sealedContact: Uint8Array;
  state: string;
  enrollSig: Uint8Array;
  revokeSig: Uint8Array;
  enrolledAt: { microsSinceUnixEpoch: bigint };
  approvedAt?: { microsSinceUnixEpoch: bigint } | undefined;
  revokedAt?: { microsSinceUnixEpoch: bigint } | undefined;
};

const orgMemberRow = (m: OrgMemberWire): OrgMemberRow => ({
  orgMemberId: m.id,
  orgId: m.orgId,
  identityHex: m.identity.toHexString(),
  displayName: m.displayName,
  signPub: m.signPub,
  ecdhPub: m.ecdhPub,
  joinTag: m.joinTag,
  sealedContact: m.sealedContact,
  state: m.state,
  enrollSig: m.enrollSig,
  revokeSig: m.revokeSig,
  enrolledAtMicros: micros(m.enrolledAt),
  approvedAtMicros: m.approvedAt ? micros(m.approvedAt) : undefined,
  revokedAtMicros: m.revokedAt ? micros(m.revokedAt) : undefined,
});

export class SpacetimeBackend implements IncidentBackend {
  private conn: DbConnection | null = null;
  private state: ConnectionState = 'connecting';
  private identity: string | null = null;
  private readonly listeners = new Set<() => void>();
  private cache: BackendRows | null = null;
  private pending = false;

  constructor(
    private readonly host: string,
    private readonly dbName: string,
    private readonly tokens: TokenStore = localTokenStore,
  ) {
    this.connect();
  }

  private connect(): void {
    this.conn = DbConnection.builder()
      .withUri(this.host)
      .withDatabaseName(this.dbName)
      .withToken(this.tokens.read())
      .onConnect((conn, identity, token) => {
        this.tokens.write(token);
        this.identity = identity.toHexString();
        for (const t of [
          conn.db.myStatus,
          conn.db.myIncidents,
          conn.db.myMembers,
          conn.db.myChannels,
          conn.db.myEnvelopes,
          conn.db.myEvents,
          conn.db.myInvites,
          conn.db.myJoinAttempts,
          conn.db.myCheckpoints,
          conn.db.myOrg,
          conn.db.myOrgStatus,
          conn.db.myRoster,
          conn.db.myPages,
        ]) {
          t.onInsert(() => this.changed());
          t.onDelete(() => this.changed());
          t.onUpdate?.(() => this.changed());
        }
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            this.state = 'ready';
            this.changed();
          })
          .onError(() => {
            this.state = 'error';
            this.changed();
          })
          .subscribe([
            tables.myStatus,
            tables.myIncidents,
            tables.myMembers,
            tables.myChannels,
            tables.myEnvelopes,
            tables.myEvents,
            tables.myInvites,
            tables.myJoinAttempts,
            tables.myCheckpoints,
            tables.myOrg,
            tables.myOrgStatus,
            tables.myRoster,
            tables.myPages,
          ]);
      })
      .onConnectError(() => {
        this.state = 'error';
        this.changed();
      })
      .onDisconnect(() => {
        this.state = 'offline';
        this.changed();
      })
      .build();
  }

  private changed(): void {
    this.cache = null;
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const l of [...this.listeners]) l();
    });
  }

  connection(): ConnectionState {
    return this.state;
  }
  identityHex(): string | null {
    return this.identity;
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private memberRow(m: {
    id: bigint;
    incidentId: string;
    identity: Identity;
    role: string;
    state: string;
    displayName: string;
    signPub: Uint8Array;
    ecdhPub: Uint8Array;
    joinTag: Uint8Array;
    inviteCodeHash: string;
    admitSig: Uint8Array;
    revokeSig: Uint8Array;
    lastCounter: bigint;
    joinedAt: { microsSinceUnixEpoch: bigint };
    admittedAt?: { microsSinceUnixEpoch: bigint } | undefined;
    revokedAt?: { microsSinceUnixEpoch: bigint } | undefined;
  }): MemberRow {
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
    if (this.cache) return this.cache;
    const db = this.conn?.db;
    if (!db) {
      return { status: [], incidents: [], members: [], channels: [], envelopes: [], events: [], invites: [], joinAttempts: [], checkpoints: [] };
    }
    const out: BackendRows = {
      status: [...db.myStatus.iter()].map((m) => this.memberRow(m)),
      incidents: [...db.myIncidents.iter()].map((i) => ({
        id: i.id,
        commanderHex: i.commander.toHexString(),
        commanderSignPub: i.commanderSignPub,
        commanderEcdhPub: i.commanderEcdhPub,
        createdAtMicros: micros(i.createdAt),
        closed: i.closed,
      })),
      members: [...db.myMembers.iter()].map((m) => this.memberRow(m)),
      channels: [...db.myChannels.iter()].map((c) => ({
        incidentId: c.incidentId,
        kind: c.kind,
        currentEpoch: c.currentEpoch,
        headSeq: c.headSeq,
        headHash: c.headHash,
      })),
      envelopes: [...db.myEnvelopes.iter()].map((e) => ({
        incidentId: e.incidentId,
        kind: e.kind,
        epoch: e.epoch,
        recipientHex: e.recipient.toHexString(),
        wrapped: e.wrapped,
        iv: e.iv,
      })),
      events: [...db.myEvents.iter()]
        .filter((e): e is typeof e & { kind: ChannelKind } => isChannel(e.kind))
        .map((e) => ({
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
        })),
      invites: [...db.myInvites.iter()].map((i) => ({
        incidentId: i.incidentId,
        codeHash: i.codeHash,
        role: i.role,
        expiresAtMicros: micros(i.expiresAt),
        used: i.used,
      })),
      joinAttempts: [...db.myJoinAttempts.iter()].map((a) => ({
        incidentId: a.incidentId,
        ok: a.ok,
        atMicros: micros(a.at),
      })),
      checkpoints: [...db.myCheckpoints.iter()].map((c) => ({
        incidentId: c.incidentId,
        kind: c.kind,
        seq: c.seq,
        hash: c.hash,
        signature: c.signature,
      })),
    };
    this.cache = out;
    return out;
  }

  /** Org views and reducers. Fixed view names only. */
  readonly org: OrgBackend = {
    rows: (): OrgRows => {
      const db = this.conn?.db;
      if (!db) return { orgs: [], roster: [], own: [], pages: [] };
      return {
        orgs: [...db.myOrg.iter()].map((o) => ({
          id: o.id,
          name: o.name,
          adminHex: o.admin.toHexString(),
          adminSignPub: o.adminSignPub,
          adminEcdhPub: o.adminEcdhPub,
          createdAtMicros: micros(o.createdAt),
        })),
        roster: [...db.myRoster.iter()].map((m) => orgMemberRow(m)),
        own: [...db.myOrgStatus.iter()].map((m) => orgMemberRow(m)),
        pages: [...db.myPages.iter()].map((p) => ({
          pageId: p.pageId,
          incidentId: p.incidentId,
          orgMemberId: p.orgMemberId,
          status: p.status,
          carrierReported: p.carrierReported,
          requestedByHex: p.requestedBy.toHexString(),
          createdAtMicros: micros(p.createdAt),
          updatedAtMicros: micros(p.updatedAt),
        })),
      };
    },
    createOrg: (a) => this.reducers().createOrg(a),
    createEnrollLink: (a) => this.reducers().createEnrollLink(a),
    enrollMember: (a) => this.reducers().enrollMember(a),
    approveMember: (a) => this.reducers().approveMember(a),
    revokeOrgMember: (a) => this.reducers().revokeOrgMember(a),
    linkIncidentOrg: (a) => this.reducers().linkIncidentOrg(a),
    addFromRoster: (a) => this.reducers().addFromRoster(a),
    requestPage: (a) => this.reducers().requestPage(a),
  };

  private reducers() {
    if (!this.conn || this.state === 'offline' || this.state === 'error') throw new Error('not connected');
    return this.conn.reducers;
  }

  createIncident(a: Parameters<IncidentBackend['createIncident']>[0]) {
    return this.reducers().createIncident(a);
  }
  createInvite(a: Parameters<IncidentBackend['createInvite']>[0]) {
    return this.reducers().createInvite(a);
  }
  redeemInvite(a: Parameters<IncidentBackend['redeemInvite']>[0]) {
    return this.reducers().redeemInvite(a);
  }
  admitMember(a: Parameters<IncidentBackend['admitMember']>[0]) {
    return this.reducers().admitMember(a);
  }
  revokeMember(a: Parameters<IncidentBackend['revokeMember']>[0]) {
    return this.reducers().revokeMember({
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
    return this.reducers().appendEvent(a);
  }
  postCheckpoint(a: Parameters<IncidentBackend['postCheckpoint']>[0]) {
    return this.reducers().postCheckpoint(a);
  }
}
