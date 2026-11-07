import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from './keys';
import { generateChannelKeyBytes } from './seal';
import { unwrapChannelKey, wrapChannelKey, type WrapContext } from './wrap';

const incidentId = '11111111-1111-4111-8111-111111111111';
const member = 'cd'.repeat(32);
const cmdr = 'ab'.repeat(32);

describe('channel key wrapping', () => {
  it('commander wraps, recipient unwraps with the pinned commander key', async () => {
    const commander = await generateDeviceKeys();
    const recipient = await generateDeviceKeys();
    const raw = generateChannelKeyBytes();
    const ctx: WrapContext = { incidentId, kind: 'privileged', epoch: 0, recipientIdentityHex: member };
    const w = await wrapChannelKey(commander.ecdhPriv, recipient.ecdhPub, ctx, raw);
    expect(w.wrapped.length).toBe(48);
    expect(w.iv.length).toBe(12);
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, ctx, w)).toEqual(raw);
  });

  it('the commander can unwrap its own envelope (self as peer) to re-wrap later', async () => {
    const commander = await generateDeviceKeys();
    const raw = generateChannelKeyBytes();
    const ctx: WrapContext = { incidentId, kind: 'record', epoch: 0, recipientIdentityHex: cmdr };
    const w = await wrapChannelKey(commander.ecdhPriv, commander.ecdhPub, ctx, raw);
    expect(await unwrapChannelKey(commander.ecdhPriv, commander.ecdhPub, ctx, w)).toEqual(raw);
  });

  it('fails for another member, another context, a swapped commander key, or tampering (T11)', async () => {
    const commander = await generateDeviceKeys();
    const recipient = await generateDeviceKeys();
    const other = await generateDeviceKeys();
    const impostor = await generateDeviceKeys();
    const raw = generateChannelKeyBytes();
    const ctx: WrapContext = { incidentId, kind: 'privileged', epoch: 1, recipientIdentityHex: member };
    const w = await wrapChannelKey(commander.ecdhPriv, recipient.ecdhPub, ctx, raw);

    expect(await unwrapChannelKey(other.ecdhPriv, commander.ecdhPub, ctx, w)).toBeNull();
    expect(await unwrapChannelKey(recipient.ecdhPriv, impostor.ecdhPub, ctx, w)).toBeNull();
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, { ...ctx, epoch: 2 }, w)).toBeNull();
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, { ...ctx, kind: 'technical' }, w)).toBeNull();
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, { ...ctx, recipientIdentityHex: cmdr }, w)).toBeNull();
    expect(
      await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, { ...ctx, incidentId: '22222222-2222-4222-8222-222222222222' }, w),
    ).toBeNull();
    const t = w.wrapped.slice();
    t[0] ^= 1;
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, ctx, { ...w, wrapped: t })).toBeNull();
    expect(await unwrapChannelKey(recipient.ecdhPriv, commander.ecdhPub, ctx, { wrapped: w.wrapped.slice(1), iv: w.iv })).toBeNull();
  });

  it('wrapping rejects keys of the wrong length', async () => {
    const commander = await generateDeviceKeys();
    const ctx: WrapContext = { incidentId, kind: 'record', epoch: 0, recipientIdentityHex: cmdr };
    await expect(wrapChannelKey(commander.ecdhPriv, commander.ecdhPub, ctx, new Uint8Array(16))).rejects.toThrow();
  });
});
