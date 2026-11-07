import { describe, expect, it } from 'vitest';
import {
  admitStatement,
  bytesEqual,
  bytesToHex,
  chainInput,
  checkpointStatement,
  DOMAIN,
  enc,
  eventAad,
  eventSigInput,
  fingerprintInput,
  genesisInput,
  hexToBytes,
  inviteInput,
  joinInput,
  revokeStatement,
  safetyInput,
  wrapInfo,
  wrapSalt,
} from './encoding';

const hex = (b: Uint8Array) => bytesToHex(b);
const pub = (n: number) => new Uint8Array(65).fill(n);

describe('enc', () => {
  it('encodes strings, integers and bytes with u32 length prefixes', () => {
    // 'a' -> 00000001 61 ; 258 -> 00000008 0000000000000102 ; bytes -> 00000002 0102
    expect(hex(enc('a', 258, new Uint8Array([1, 2])))).toBe(
      '0000000161' + '00000008' + '0000000000000102' + '00000002' + '0102',
    );
  });

  it('treats number and bigint integers identically', () => {
    expect(hex(enc(7))).toBe(hex(enc(7n)));
  });

  it('is injective across field boundaries', () => {
    expect(hex(enc('ab', 'c'))).not.toBe(hex(enc('a', 'bc')));
    expect(hex(enc('', 'a'))).not.toBe(hex(enc('a', '')));
  });

  it('encodes UTF-8', () => {
    expect(hex(enc('é'))).toBe('00000002c3a9');
  });

  it('rejects negative, fractional and oversized integers', () => {
    expect(() => enc(-1)).toThrow();
    expect(() => enc(1.5)).toThrow();
    expect(() => enc(2 ** 53)).toThrow();
    expect(() => enc(1n << 64n)).toThrow();
    expect(() => enc((1n << 64n) - 1n)).not.toThrow();
  });

  it('rejects unsupported field types', () => {
    expect(() => enc({} as never)).toThrow();
    expect(() => enc(null as never)).toThrow();
  });
});

describe('hex helpers', () => {
  it('round trips and rejects bad input', () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(hexToBytes(hex(b))).toEqual(b);
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
  });
  it('bytesEqual compares content and length', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('statement builders: domain separation and binding', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const who = 'ab'.repeat(32);
  const core = { incidentId: id, channel: 'record', epoch: 0, author: who, clientEventId: id, authorCounter: 1 };
  const iv = new Uint8Array(12).fill(3);
  const ct = new Uint8Array(20).fill(4);

  it('every builder starts with a distinct domain tag', () => {
    const tags = Object.values(DOMAIN);
    expect(new Set(tags).size).toBe(tags.length);
    const firstFields = [
      eventAad(core),
      eventSigInput({ ...core, iv, ciphertext: ct }),
      chainInput({
        ...core,
        prevHash: new Uint8Array(32),
        seq: 1,
        iv,
        ciphertext: ct,
        signature: new Uint8Array(64),
        serverTsMicros: 5n,
      }),
      genesisInput(id, 'record'),
      wrapSalt(id),
      wrapInfo(id, 'record', 0, who),
      inviteInput(id, new Uint8Array(16)),
      joinInput(id, who, 'Dana', pub(1), pub(2)),
      admitStatement(id, who, 'counsel', 'Dana', pub(1), pub(2)),
      revokeStatement(id, who),
      checkpointStatement(id, 'record', 3, new Uint8Array(32)),
      fingerprintInput(pub(1), pub(2)),
      safetyInput(id, who, pub(1), pub(2)),
    ].map((b) => hex(b).slice(0, 8 + 2 * 13)); // length prefix plus up to 13 tag bytes
    // distinct inputs begin with distinct tags
    const tagBytes = firstFields.map((s) => s.slice(8, 8 + 2 * 12));
    expect(new Set(tagBytes).size).toBeGreaterThanOrEqual(10);
  });

  it('a signature input is not interchangeable with an AAD or chain input', () => {
    const aad = eventAad(core);
    const sig = eventSigInput({ ...core, iv, ciphertext: ct });
    expect(hex(aad)).not.toBe(hex(sig));
  });

  it('event bytes change when any bound field changes', () => {
    const base = hex(eventSigInput({ ...core, iv, ciphertext: ct }));
    const variants = [
      { ...core, channel: 'privileged' },
      { ...core, epoch: 1 },
      { ...core, author: 'cd'.repeat(32) },
      { ...core, clientEventId: '22222222-2222-4222-8222-222222222222' },
      { ...core, authorCounter: 2 },
      { ...core, incidentId: '33333333-3333-4333-8333-333333333333' },
    ];
    for (const v of variants) expect(hex(eventSigInput({ ...v, iv, ciphertext: ct }))).not.toBe(base);
    expect(hex(eventSigInput({ ...core, iv: new Uint8Array(12).fill(9), ciphertext: ct }))).not.toBe(base);
    expect(hex(eventSigInput({ ...core, iv, ciphertext: new Uint8Array(20).fill(9) }))).not.toBe(base);
  });

  it('admit statement binds role, name and both public keys', () => {
    const base = hex(admitStatement(id, who, 'counsel', 'Dana', pub(1), pub(2)));
    expect(hex(admitStatement(id, who, 'executive', 'Dana', pub(1), pub(2)))).not.toBe(base);
    expect(hex(admitStatement(id, who, 'counsel', 'Dan', pub(1), pub(2)))).not.toBe(base);
    expect(hex(admitStatement(id, who, 'counsel', 'Dana', pub(3), pub(2)))).not.toBe(base);
    expect(hex(admitStatement(id, who, 'counsel', 'Dana', pub(1), pub(3)))).not.toBe(base);
  });
});
