// Building and checking one sealed, signed event (docs/PLAN.md 4.7).

import { eventAad, eventSigInput, type EventCore } from '@/spacetimedb/src/shared/encoding';
import { MAX_PLAINTEXT } from '@/spacetimedb/src/shared/limits';
import { open, seal } from './seal';
import { sign } from './sign';

export interface SealedEvent {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array;
}

/**
 * Encrypts `plaintext` (already-serialized, zod-validated payload JSON) under
 * `channelKey` with the canonical AAD, then signs the canonical sigInput.
 */
export async function createSealedEvent(
  core: EventCore,
  plaintext: Uint8Array,
  channelKey: CryptoKey,
  signPriv: CryptoKey,
): Promise<SealedEvent> {
  if (plaintext.length > MAX_PLAINTEXT) throw new RangeError('payload too large');
  const { iv, ciphertext } = await seal(channelKey, plaintext, eventAad(core));
  const signature = await sign(signPriv, eventSigInput({ ...core, iv, ciphertext }));
  return { iv, ciphertext, signature };
}

/** Decrypts an event with the canonical AAD. Null on failure. */
export function openSealedEvent(
  core: EventCore,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  channelKey: CryptoKey,
): Promise<Uint8Array | null> {
  return open(channelKey, iv, ciphertext, eventAad(core));
}
