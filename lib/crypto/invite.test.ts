import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';
import { b64urlEncode } from './b64url';
import { generateDeviceKeys } from './keys';
import {
  buildInviteFragment,
  buildInviteUrl,
  computeJoinTag,
  inviteCodeHash,
  newInvite,
  parseInviteFragment,
  verifyJoinTag,
  type JoinFields,
} from './invite';

const incidentId = '11111111-1111-4111-8111-111111111111';

async function joinFields(): Promise<JoinFields> {
  const k = await generateDeviceKeys();
  return { incidentId, identityHex: 'ab'.repeat(32), displayName: 'Dana', signPub: k.signPub, ecdhPub: k.ecdhPub };
}

describe('invite', () => {
  it('creates a 16-byte code, 32-byte secret and a matching codeHash', () => {
    const inv = newInvite(incidentId);
    expect(inv.code.length).toBe(16);
    expect(inv.secret.length).toBe(32);
    expect(inv.codeHash).toEqual(inviteCodeHash(incidentId, inv.code));
    expect(inviteCodeHash('22222222-2222-4222-8222-222222222222', inv.code)).not.toEqual(inv.codeHash);
    expect(newInvite(incidentId).code).not.toEqual(inv.code);
  });

  it('join tag verifies with the right secret and fields, and fails otherwise (T5)', async () => {
    const inv = newInvite(incidentId);
    const f = await joinFields();
    const tag = await computeJoinTag(inv.secret, f);
    expect(tag.length).toBe(32);
    expect(await verifyJoinTag(inv.secret, f, tag)).toBe(true);
    expect(await verifyJoinTag(newInvite(incidentId).secret, f, tag)).toBe(false);
    const other = await generateDeviceKeys();
    expect(await verifyJoinTag(inv.secret, { ...f, signPub: other.signPub }, tag)).toBe(false);
    expect(await verifyJoinTag(inv.secret, { ...f, ecdhPub: other.ecdhPub }, tag)).toBe(false);
    expect(await verifyJoinTag(inv.secret, { ...f, displayName: 'Dane' }, tag)).toBe(false);
    expect(await verifyJoinTag(inv.secret, { ...f, identityHex: 'cd'.repeat(32) }, tag)).toBe(false);
    expect(await verifyJoinTag(inv.secret, f, tag.slice(1))).toBe(false);
  });

  it('what a joiner sends to the module never contains the secret (T18)', async () => {
    const inv = newInvite(incidentId);
    const f = await joinFields();
    const tag = await computeJoinTag(inv.secret, f);
    const sent = Buffer.concat([
      Buffer.from(incidentId),
      Buffer.from(inv.code),
      Buffer.from(f.displayName),
      Buffer.from(f.signPub),
      Buffer.from(f.ecdhPub),
      Buffer.from(tag),
    ]);
    expect(sent.includes(Buffer.from(inv.secret))).toBe(false);
    expect(sent.includes(Buffer.from(bytesToHex(inv.secret)))).toBe(false);
    expect(sent.includes(Buffer.from(b64urlEncode(inv.secret)))).toBe(false);
  });

  it('fragment round trips and the URL keeps the secret in the fragment only', () => {
    const inv = newInvite(incidentId);
    const frag = {
      incidentId,
      code: inv.code,
      secret: inv.secret,
      commanderFingerprint: new Uint8Array(32).fill(7),
      role: 'counsel' as const,
    };
    const parsed = parseInviteFragment('#' + buildInviteFragment(frag));
    expect(parsed).toEqual(frag);
    const url = buildInviteUrl('https://zerohour.example/', frag);
    const u = new URL(url);
    expect(u.pathname).toBe('/join');
    expect(u.search).toBe('');
    expect(u.hash.slice(1)).toBe(buildInviteFragment(frag));
    expect(url.split('#')[0].includes(b64urlEncode(inv.secret))).toBe(false);
  });

  it('parser is strict', () => {
    const inv = newInvite(incidentId);
    const good = buildInviteFragment({
      incidentId,
      code: inv.code,
      secret: inv.secret,
      commanderFingerprint: new Uint8Array(32),
      role: 'technical',
    });
    expect(parseInviteFragment(good)).not.toBeNull();
    expect(parseInviteFragment('')).toBeNull();
    expect(parseInviteFragment(good + '&x=1')).toBeNull(); // unknown key
    expect(parseInviteFragment(good + '&r=counsel')).toBeNull(); // duplicate key
    expect(parseInviteFragment(good.replace('r=technical', 'r=commander'))).toBeNull(); // not invitable
    expect(parseInviteFragment(good.replace('r=technical', 'r=admin'))).toBeNull();
    expect(parseInviteFragment(good.replace(/i=[^&]+/, 'i=not-a-uuid'))).toBeNull();
    expect(parseInviteFragment(good.replace(/c=[^&]+/, 'c=AAAA'))).toBeNull(); // wrong length
    expect(parseInviteFragment(good.replace(/s=[^&]+/, 's=!!!'))).toBeNull();
    expect(parseInviteFragment(good.split('&').slice(0, 4).join('&'))).toBeNull(); // missing key
    expect(parseInviteFragment('x'.repeat(600))).toBeNull();
  });
});
