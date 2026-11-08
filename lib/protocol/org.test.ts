import { describe, expect, it } from 'vitest';
import { b64urlEncode } from '@/lib/crypto/b64url';
import {
  buildEnrollFragment,
  buildEnrollUrl,
  e164Schema,
  enrollTtlHoursSchema,
  orgNameSchema,
  pageRequestSchema,
  parseEnrollFragment,
  parsePageRequestBody,
  MAX_PAGE_BODY_BYTES,
} from './org';

const orgId = '11111111-1111-4111-8111-111111111111';
const frag = {
  orgId,
  code: new Uint8Array(16).fill(1),
  secret: new Uint8Array(32).fill(2),
  adminFingerprint: new Uint8Array(32).fill(3),
};

describe('enroll fragment', () => {
  it('round trips with and without a leading #', () => {
    const f = buildEnrollFragment(frag);
    expect(f.startsWith('e=')).toBe(true);
    for (const input of [f, `#${f}`]) {
      const p = parseEnrollFragment(input);
      expect(p?.orgId).toBe(orgId);
      expect(p?.code).toEqual(frag.code);
      expect(p?.secret).toEqual(frag.secret);
      expect(p?.adminFingerprint).toEqual(frag.adminFingerprint);
    }
    expect(buildEnrollUrl('https://x.test/', frag)).toBe(`https://x.test/enroll#${f}`);
  });

  it('rejects malformed fragments', () => {
    const f = buildEnrollFragment(frag);
    const [, rest] = f.split('=');
    const parts = rest.split('.');
    const bad = [
      '',
      '#',
      'e=',
      `x=${rest}`,
      `${f}&e=${rest}`,
      `${f}&x=1`,
      `e=${parts.slice(0, 3).join('.')}`,
      `e=${[...parts, 'AAAA'].join('.')}`,
      `e=${['not-a-uuid', ...parts.slice(1)].join('.')}`,
      `e=${[parts[0], b64urlEncode(new Uint8Array(15)), parts[2], parts[3]].join('.')}`,
      `e=${[parts[0], parts[1], b64urlEncode(new Uint8Array(31)), parts[3]].join('.')}`,
      `e=${[parts[0], parts[1], parts[2], b64urlEncode(new Uint8Array(33))].join('.')}`,
      `e=${[parts[0], parts[1] + '=', parts[2], parts[3]].join('.')}`,
      'e=' + 'a'.repeat(600),
    ];
    for (const b of bad) expect(parseEnrollFragment(b), b).toBeNull();
  });
});

describe('limits', () => {
  it('accepts only E.164', () => {
    for (const ok of ['+15551234567', '+12345678', '+123456789012345']) expect(e164Schema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['15551234567', '+1234567', '+1234567890123456', '+1 555 1234567', '+1-555-123-4567', '+12a45678', '+0123456789', ' +15551234567', '+15551234567 '])
      expect(e164Schema.safeParse(bad).success, bad).toBe(false);
  });

  it('bounds link TTL to 1 to 24 hours', () => {
    for (const ok of [1, 12, 24]) expect(enrollTtlHoursSchema.safeParse(ok).success).toBe(true);
    for (const bad of [0, 25, -1, 1.5, Number.NaN, '3']) expect(enrollTtlHoursSchema.safeParse(bad).success, String(bad)).toBe(false);
  });

  it('normalizes org names and bounds them to 1 to 80', () => {
    expect(orgNameSchema.parse('  Lakeside Clinic ')).toBe('Lakeside Clinic');
    expect(orgNameSchema.parse('Lake‮side')).toBe('Lakeside');
    expect(orgNameSchema.safeParse('a'.repeat(80)).success).toBe(true);
    expect(orgNameSchema.safeParse('a'.repeat(81)).success).toBe(false);
    expect(orgNameSchema.safeParse('').success).toBe(false);
    expect(orgNameSchema.safeParse('​‮ ').success).toBe(false);
  });
});

function record(n: number) {
  return {
    identity: n.toString(16).padStart(2, '0').repeat(32),
    displayName: `Person ${n}`,
    signPub: b64urlEncode(Object.assign(new Uint8Array(65).fill(n), { 0: 4 })),
    ecdhPub: b64urlEncode(Object.assign(new Uint8Array(65).fill(n), { 0: 4 })),
    sealedContact: b64urlEncode(new Uint8Array(109).fill(n)),
    enrollSig: b64urlEncode(new Uint8Array(64).fill(n)),
  };
}

function body(targets = 2) {
  return {
    orgId,
    incidentId: '22222222-2222-4222-8222-222222222222',
    pageId: '33333333-3333-4333-8333-333333333333',
    sentAt: 1_800_000_000_000,
    adminSignPub: b64urlEncode(Object.assign(new Uint8Array(65).fill(9), { 0: 4 })),
    commander: record(1),
    targets: Array.from({ length: targets }, (_, i) => ({ orgMemberId: String(i + 1), ...record(i + 10) })),
    commanderSig: b64urlEncode(new Uint8Array(64).fill(7)),
  };
}

describe('page request body', () => {
  it('accepts a well-formed body with 1 to 8 targets', () => {
    for (const n of [1, 2, 8]) expect(pageRequestSchema.safeParse(body(n)).success, String(n)).toBe(true);
    expect(parsePageRequestBody(JSON.stringify(body(8)))).not.toBeNull();
  });

  it('rejects 0 or 9 targets, duplicates, unknown fields and bad fields', () => {
    expect(pageRequestSchema.safeParse(body(0)).success).toBe(false);
    expect(pageRequestSchema.safeParse(body(9)).success).toBe(false);
    const dupId = body(2);
    dupId.targets[1].orgMemberId = '1';
    expect(pageRequestSchema.safeParse(dupId).success).toBe(false);
    const dupIdentity = body(2);
    dupIdentity.targets[1].identity = dupIdentity.targets[0].identity;
    expect(pageRequestSchema.safeParse(dupIdentity).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...body(), extra: 1 }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...body(), orgId: 'nope' }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...body(), sentAt: 1.5 }).success).toBe(false);
    const phone = body();
    (phone.commander as Record<string, unknown>).phone = '+15551234567';
    expect(pageRequestSchema.safeParse(phone).success).toBe(false);
    const shortSig = body();
    shortSig.commanderSig = b64urlEncode(new Uint8Array(63));
    expect(pageRequestSchema.safeParse(shortSig).success).toBe(false);
    const badId = body();
    badId.targets[0].orgMemberId = '-1';
    expect(pageRequestSchema.safeParse(badId).success).toBe(false);
    const oldSize = body();
    oldSize.targets[0].sealedContact = b64urlEncode(new Uint8Array(102));
    expect(pageRequestSchema.safeParse(oldSize).success).toBe(false);
    const longSealed = body();
    longSealed.targets[0].sealedContact = b64urlEncode(new Uint8Array(110));
    expect(pageRequestSchema.safeParse(longSealed).success).toBe(false);
    const shortSealed = body();
    shortSealed.targets[0].sealedContact = b64urlEncode(new Uint8Array(50));
    expect(pageRequestSchema.safeParse(shortSealed).success).toBe(false);
  });

  it('refuses a body over 16 KB before parsing it', () => {
    expect(parsePageRequestBody(JSON.stringify(body(2)))).not.toBeNull();
    const padded = JSON.stringify(body(2)) + ' '.repeat(MAX_PAGE_BODY_BYTES);
    expect(parsePageRequestBody(padded)).toBeNull();
    expect(parsePageRequestBody('not json')).toBeNull();
    expect(parsePageRequestBody('null')).toBeNull();
  });
});
