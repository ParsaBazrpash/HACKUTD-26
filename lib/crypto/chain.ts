// Per-channel hash chain (docs/PLAN.md 4.7). The module assigns seq, serverTs
// and hash; every client recomputes them with this same code path (shared
// builders in spacetimedb/src/shared/encoding.ts, SHA-256 from @noble/hashes).

import { chainInput, genesisInput } from '@/spacetimedb/src/shared/encoding';
import { bytesEqual } from '@/spacetimedb/src/shared/encoding';
import { sha256 } from './hash';

export function genesisHash(incidentId: string, channel: string): Uint8Array {
  return sha256(genesisInput(incidentId, channel));
}

export interface ChainFields {
  incidentId: string;
  channel: string;
  epoch: number;
  author: string;
  clientEventId: string;
  authorCounter: bigint;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array;
  prevHash: Uint8Array;
  seq: bigint;
  serverTsMicros: bigint;
}

export function computeEventHash(f: ChainFields): Uint8Array {
  return sha256(chainInput(f));
}

export { bytesEqual };
