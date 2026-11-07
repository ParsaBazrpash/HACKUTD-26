import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';
import { computeEventHash, genesisHash } from './chain';

// Shared test vectors. The Spacetime module test (spacetimedb/src/*.test.ts)
// must reproduce exactly these hashes: they pin the client and the module to
// the same bytes.
export const VECTOR = {
  incidentId: '11111111-1111-4111-8111-111111111111',
  channel: 'record',
  genesisHex: '' as string,
  fields: {
    epoch: 0,
    author: 'ab'.repeat(32),
    clientEventId: '22222222-2222-4222-8222-222222222222',
    authorCounter: 1n,
    iv: new Uint8Array(12).fill(1),
    ciphertext: new Uint8Array(20).fill(2),
    signature: new Uint8Array(64).fill(3),
    seq: 1n,
    serverTsMicros: 1_800_000_000_000_000n,
  },
};

describe('hash chain', () => {
  it('genesis is domain-separated per incident and channel', () => {
    const a = genesisHash(VECTOR.incidentId, 'record');
    expect(a.length).toBe(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(genesisHash(VECTOR.incidentId, 'command')));
    expect(bytesToHex(a)).not.toBe(bytesToHex(genesisHash('33333333-3333-4333-8333-333333333333', 'record')));
  });

  it('pinned vectors (client and module must agree)', () => {
    const g = genesisHash(VECTOR.incidentId, VECTOR.channel);
    const h = computeEventHash({ incidentId: VECTOR.incidentId, channel: VECTOR.channel, prevHash: g, ...VECTOR.fields });
    // If these change, the module test vector must change in the same commit.
    expect(bytesToHex(g)).toBe('cdc72ea1ac6f57be4c102241c813c2a1af2e60189f34d9e55712ae0dbcc6fd4a');
    expect(bytesToHex(h)).toBe('0735bb6dcaf6260ae0408642133eec311ce5990408e1f84e0331d9db1bd0c279');
  });

  it('every bound field changes the hash', () => {
    const g = genesisHash(VECTOR.incidentId, VECTOR.channel);
    const base = { incidentId: VECTOR.incidentId, channel: VECTOR.channel, prevHash: g, ...VECTOR.fields };
    const h0 = bytesToHex(computeEventHash(base));
    const changed = [
      { ...base, seq: 2n },
      { ...base, epoch: 1 },
      { ...base, authorCounter: 2n },
      { ...base, serverTsMicros: base.serverTsMicros + 1n },
      { ...base, channel: 'command' },
      { ...base, ciphertext: new Uint8Array(20).fill(9) },
      { ...base, signature: new Uint8Array(64).fill(9) },
      { ...base, prevHash: new Uint8Array(32) },
    ];
    for (const c of changed) expect(bytesToHex(computeEventHash(c))).not.toBe(h0);
  });
});
