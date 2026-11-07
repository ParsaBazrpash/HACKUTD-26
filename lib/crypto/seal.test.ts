import { describe, expect, it } from 'vitest';
import { eventAad } from '@/spacetimedb/src/shared/encoding';
import { generateChannelKeyBytes, importChannelKey, open, seal } from './seal';

const id = '11111111-1111-4111-8111-111111111111';
const who = 'ab'.repeat(32);
const core = { incidentId: id, channel: 'privileged', epoch: 0, author: who, clientEventId: id, authorCounter: 1 };
const plaintext = new TextEncoder().encode('Counsel: do not pay before we call the FBI.');

async function key() {
  return importChannelKey(generateChannelKeyBytes());
}

describe('seal and open', () => {
  it('round trips', async () => {
    const k = await key();
    const s = await seal(k, plaintext, eventAad(core));
    expect(s.iv.length).toBe(12);
    expect(await open(k, s.iv, s.ciphertext, eventAad(core))).toEqual(plaintext);
  });

  it('ciphertext does not contain the plaintext (T1)', async () => {
    const k = await key();
    const s = await seal(k, plaintext, eventAad(core));
    expect(Buffer.from(s.ciphertext).includes(Buffer.from('FBI'))).toBe(false);
    expect(s.ciphertext.length).toBe(plaintext.length + 16);
  });

  it('uses a fresh IV every time (T29)', async () => {
    const k = await key();
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) ivs.add(Buffer.from((await seal(k, plaintext, eventAad(core))).iv).toString('hex'));
    expect(ivs.size).toBe(50);
  });

  it('fails when any AAD field differs (T7)', async () => {
    const k = await key();
    const s = await seal(k, plaintext, eventAad(core));
    const variants = [
      { ...core, channel: 'command' },
      { ...core, epoch: 1 },
      { ...core, author: 'cd'.repeat(32) },
      { ...core, clientEventId: '22222222-2222-4222-8222-222222222222' },
      { ...core, authorCounter: 2 },
      { ...core, incidentId: '33333333-3333-4333-8333-333333333333' },
    ];
    for (const v of variants) expect(await open(k, s.iv, s.ciphertext, eventAad(v)), JSON.stringify(v)).toBeNull();
  });

  it('fails on a flipped ciphertext byte, flipped tag, wrong key, wrong iv', async () => {
    const k = await key();
    const s = await seal(k, plaintext, eventAad(core));
    const aad = eventAad(core);
    const flipped = s.ciphertext.slice();
    flipped[3] ^= 1;
    expect(await open(k, s.iv, flipped, aad)).toBeNull();
    const tag = s.ciphertext.slice();
    tag[tag.length - 1] ^= 1;
    expect(await open(k, s.iv, tag, aad)).toBeNull();
    expect(await open(await key(), s.iv, s.ciphertext, aad)).toBeNull();
    const iv = s.iv.slice();
    iv[0] ^= 1;
    expect(await open(k, iv, s.ciphertext, aad)).toBeNull();
  });

  it('rejects out-of-range sizes without throwing', async () => {
    const k = await key();
    expect(await open(k, new Uint8Array(12), new Uint8Array(5), eventAad(core))).toBeNull();
    expect(await open(k, new Uint8Array(12), new Uint8Array(16401), eventAad(core))).toBeNull();
    await expect(seal(k, new Uint8Array(0), eventAad(core))).rejects.toThrow();
    await expect(seal(k, new Uint8Array(12289), eventAad(core))).rejects.toThrow();
  });

  it('imported channel keys are not extractable', async () => {
    const k = await key();
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
});
