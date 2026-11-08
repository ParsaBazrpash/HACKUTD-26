// Canonical encoding and statement builders (docs/PLAN.md 4.2).
//
// This file is shared by the Spacetime module and the browser client. It must
// not import anything. Every signature, AAD, HMAC, hash and KDF input in
// ZeroHour is built with `enc()` and starts with a domain tag, so a value
// signed or hashed for one purpose can never be replayed for another.
// Never sign or hash JSON.

export type EncField = string | number | bigint | Uint8Array;

/** Domain tags. The first field of every `enc()` call is one of these. */
export const DOMAIN = {
  eventAad: 'zh1/event-aad',
  eventSig: 'zh1/event-sig',
  chain: 'zh1/chain',
  genesis: 'zh1/genesis',
  wrapSalt: 'zh1/wrap-salt',
  wrap: 'zh1/wrap',
  invite: 'zh1/invite',
  join: 'zh1/join',
  admit: 'zh1/admit',
  revoke: 'zh1/revoke',
  checkpoint: 'zh1/checkpoint',
  fp: 'zh1/fp',
  safety: 'zh1/safety',
} as const;

export type DomainTag = (typeof DOMAIN)[keyof typeof DOMAIN];

const U64_MAX = (1n << 64n) - 1n;
const textEncoder = new TextEncoder();

function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError('enc: field too long');
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

function u64be(v: number | bigint): Uint8Array {
  let n: bigint;
  if (typeof v === 'bigint') {
    n = v;
  } else {
    if (!Number.isSafeInteger(v)) throw new RangeError('enc: integer must be a safe integer');
    n = BigInt(v);
  }
  if (n < 0n || n > U64_MAX) throw new RangeError('enc: integer out of u64 range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
}

function fieldBytes(f: EncField): Uint8Array {
  if (typeof f === 'string') return textEncoder.encode(f);
  if (typeof f === 'number' || typeof f === 'bigint') return u64be(f);
  if (f instanceof Uint8Array) return f;
  throw new TypeError('enc: unsupported field type');
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Canonical encoding: for each field, `u32be(len) || bytes`. Strings are
 * UTF-8, integers (number or bigint) are 8-byte big-endian unsigned, and
 * Uint8Array is raw. The length prefix makes the encoding injective, so two
 * different field lists never produce the same bytes.
 */
export function enc(...fields: EncField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    const b = fieldBytes(f);
    parts.push(u32be(b.length), b);
  }
  return concatBytes(...parts);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const HEX = '0123456789abcdef';

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new TypeError('hexToBytes: invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// Statement builders. Each returns the exact bytes that are signed, hashed or
// fed to a KDF. Hashing and signing happen elsewhere (Web Crypto in the
// browser, @noble in the module); building the bytes here guarantees both
// sides agree.
// ---------------------------------------------------------------------------

export interface EventCore {
  incidentId: string;
  /** Channel kind (record, command, privileged, technical), not the payload kind. */
  channel: string;
  epoch: number;
  /** Author identity, lowercase hex of `identity.toHexString()`. */
  author: string;
  clientEventId: string;
  authorCounter: number | bigint;
}

/** AES-GCM additional data for an event ciphertext (PLAN 4.7). */
export function eventAad(e: EventCore): Uint8Array {
  return enc(DOMAIN.eventAad, e.incidentId, e.channel, e.epoch, e.author, e.clientEventId, e.authorCounter);
}

/** Bytes the author signs for an event (PLAN 4.7). */
export function eventSigInput(e: EventCore & { iv: Uint8Array; ciphertext: Uint8Array }): Uint8Array {
  return enc(
    DOMAIN.eventSig,
    e.incidentId,
    e.channel,
    e.epoch,
    e.author,
    e.clientEventId,
    e.authorCounter,
    e.iv,
    e.ciphertext,
  );
}

/** Bytes hashed (SHA-256) to produce an event's chain hash (PLAN 4.7). */
export function chainInput(
  e: EventCore & {
    prevHash: Uint8Array;
    seq: number | bigint;
    iv: Uint8Array;
    ciphertext: Uint8Array;
    signature: Uint8Array;
    serverTsMicros: number | bigint;
  },
): Uint8Array {
  return enc(
    DOMAIN.chain,
    e.prevHash,
    e.seq,
    e.incidentId,
    e.channel,
    e.epoch,
    e.author,
    e.clientEventId,
    e.authorCounter,
    e.iv,
    e.ciphertext,
    e.signature,
    e.serverTsMicros,
  );
}

/** Bytes hashed (SHA-256) to produce `prevHash` for seq 1 of a channel. */
export function genesisInput(incidentId: string, channel: string): Uint8Array {
  return enc(DOMAIN.genesis, incidentId, channel);
}

/** HKDF salt for channel-key wrapping (PLAN 4.6). */
export function wrapSalt(incidentId: string): Uint8Array {
  return enc(DOMAIN.wrapSalt, incidentId);
}

/** HKDF info, also the AES-GCM AAD, for wrapping a channel key (PLAN 4.6). */
export function wrapInfo(incidentId: string, channel: string, epoch: number, recipientIdentityHex: string): Uint8Array {
  return enc(DOMAIN.wrap, incidentId, channel, epoch, recipientIdentityHex);
}

/** Bytes hashed (SHA-256) to produce an invite's `codeHash` (PLAN 4.4). */
export function inviteInput(incidentId: string, code: Uint8Array): Uint8Array {
  return enc(DOMAIN.invite, incidentId, code);
}

/** Message authenticated with HMAC-SHA256 under the invite secret (PLAN 4.4). */
export function joinInput(
  incidentId: string,
  identityHex: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
): Uint8Array {
  return enc(DOMAIN.join, incidentId, identityHex, displayName, signPub, ecdhPub);
}

/** Statement the commander signs to admit a member (PLAN 4.5). */
export function admitStatement(
  incidentId: string,
  memberIdentityHex: string,
  role: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
): Uint8Array {
  return enc(DOMAIN.admit, incidentId, memberIdentityHex, role, displayName, signPub, ecdhPub);
}

/**
 * Statement the commander signs to revoke a member (PLAN 4.5). It names the keys, like the admission
 * certificate, so a revocation of one enrollment cannot be copied onto a later enrollment of the same person.
 */
export function revokeStatement(
  incidentId: string,
  memberIdentityHex: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
): Uint8Array {
  return enc(DOMAIN.revoke, incidentId, memberIdentityHex, signPub, ecdhPub);
}

/** Statement the commander signs for a checkpoint (PLAN 4.10). */
export function checkpointStatement(incidentId: string, channel: string, seq: number | bigint, hash: Uint8Array): Uint8Array {
  return enc(DOMAIN.checkpoint, incidentId, channel, seq, hash);
}

/** Bytes hashed (SHA-256) to produce a member fingerprint (PLAN 4.3). */
export function fingerprintInput(signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array {
  return enc(DOMAIN.fp, signPub, ecdhPub);
}

/** Bytes hashed (SHA-256) to produce a member's safety code (PLAN 4.3). */
export function safetyInput(incidentId: string, identityHex: string, signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array {
  return enc(DOMAIN.safety, incidentId, identityHex, signPub, ecdhPub);
}
