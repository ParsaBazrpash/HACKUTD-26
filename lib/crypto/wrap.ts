// Channel-key wrapping for a recipient (docs/PLAN.md 4.6):
//   shared = ECDH(myEcdhPriv, peerEcdhPub)
//   kek    = HKDF-SHA256(shared, salt = enc('zh1/wrap-salt', incidentId),
//                        info = enc('zh1/wrap', incidentId, kind, epoch, recipientIdentityHex))
//   wrapped = AES-GCM(kek, iv, rawKey, aad = info)
// The commander wraps with its ECDH private key and the recipient's public key;
// a recipient unwraps with its own private key and the pinned commander public key.
// The commander's own envelope uses its own public key as the peer.

import { IV_LEN, WRAPPED_KEY_LEN } from '@/spacetimedb/src/shared/limits';
import { wrapInfo, wrapSalt } from '@/spacetimedb/src/shared/encoding';
import { CHANNEL_KEY_LEN } from './seal';
import { buf, randomBytes } from './hash';
import { importEcdhPub } from './keys';

export interface WrapContext {
  incidentId: string;
  kind: string;
  epoch: number;
  recipientIdentityHex: string;
}

export interface Wrapped {
  wrapped: Uint8Array; // 48 bytes
  iv: Uint8Array; // 12 bytes
}

async function deriveKek(myEcdhPriv: CryptoKey, peerEcdhPub: Uint8Array, ctx: WrapContext): Promise<CryptoKey> {
  const peer = await importEcdhPub(peerEcdhPub);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, myEcdhPriv, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buf(wrapSalt(ctx.incidentId)),
      info: buf(wrapInfo(ctx.incidentId, ctx.kind, ctx.epoch, ctx.recipientIdentityHex)),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapChannelKey(
  myEcdhPriv: CryptoKey,
  recipientEcdhPub: Uint8Array,
  ctx: WrapContext,
  rawKey: Uint8Array,
): Promise<Wrapped> {
  if (rawKey.length !== CHANNEL_KEY_LEN) throw new TypeError('invalid channel key');
  const kek = await deriveKek(myEcdhPriv, recipientEcdhPub, ctx);
  const iv = randomBytes(IV_LEN);
  const aad = wrapInfo(ctx.incidentId, ctx.kind, ctx.epoch, ctx.recipientIdentityHex);
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad) }, kek, buf(rawKey)),
  );
  if (out.length !== WRAPPED_KEY_LEN) throw new Error('unexpected wrapped length');
  return { wrapped: out, iv };
}

/** Returns the raw 32-byte channel key, or null if the envelope does not authenticate. */
export async function unwrapChannelKey(
  myEcdhPriv: CryptoKey,
  peerEcdhPub: Uint8Array,
  ctx: WrapContext,
  env: Wrapped,
): Promise<Uint8Array | null> {
  try {
    if (env.wrapped.length !== WRAPPED_KEY_LEN || env.iv.length !== IV_LEN) return null;
    const kek = await deriveKek(myEcdhPriv, peerEcdhPub, ctx);
    const aad = wrapInfo(ctx.incidentId, ctx.kind, ctx.epoch, ctx.recipientIdentityHex);
    const raw = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(env.iv), additionalData: buf(aad) }, kek, buf(env.wrapped)),
    );
    return raw.length === CHANNEL_KEY_LEN ? raw : null;
  } catch {
    return null;
  }
}
