// ECDSA P-256 / SHA-256 signatures, 64-byte r||s (docs/PLAN.md 4.3 and 4.7).

import { SIG_LEN } from '@/spacetimedb/src/shared/limits';
import { buf } from './hash';
import { importSignPub } from './keys';

const ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function sign(signPriv: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, signPriv, buf(message)));
  if (sig.length !== SIG_LEN) throw new Error('unexpected signature length');
  return sig;
}

/**
 * Verifies a signature. Never throws: a malformed key, malformed signature or
 * any internal error is simply "not valid".
 */
export async function verify(
  signPub: Uint8Array | CryptoKey,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    if (!(signature instanceof Uint8Array) || signature.length !== SIG_LEN) return false;
    const key = signPub instanceof Uint8Array ? await importSignPub(signPub) : signPub;
    return await crypto.subtle.verify(ALG, key, buf(signature), buf(message));
  } catch {
    return false;
  }
}
