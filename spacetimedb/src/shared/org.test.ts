import { describe, expect, it } from 'vitest';
import * as client from '@/lib/protocol/org';
import { bytesToHex } from './encoding';
import * as mod from './org';

const orgId = '11111111-1111-4111-8111-111111111111';
const incidentId = '33333333-3333-4333-8333-333333333333';
const pageId = '44444444-4444-4444-8444-444444444444';
const identity = 'ab'.repeat(32);
const pub = (n: number) => Object.assign(new Uint8Array(65).fill(n), { 0: 4 });
const hash = new Uint8Array(32).fill(8);
const code = new Uint8Array(16).fill(1);
const hex = (b: Uint8Array) => bytesToHex(b);

describe('client and module statements match byte for byte', () => {
  it('enroll link, join, enroll, revoke, contact, page and safety', () => {
    expect(hex(client.enrollLinkInput(orgId, code))).toBe(hex(mod.enrollLinkInput(orgId, code)));
    expect(hex(client.enrollJoinInput(orgId, identity, 'Dana', pub(1), pub(2), hash))).toBe(
      hex(mod.enrollJoinInput(orgId, identity, 'Dana', pub(1), pub(2), hash)),
    );
    expect(hex(client.enrollStatement(orgId, identity, 'Dana', pub(1), pub(2), hash))).toBe(
      hex(mod.enrollStatement(orgId, identity, 'Dana', pub(1), pub(2), hash)),
    );
    expect(hex(client.orgRevokeStatement(orgId, 5n, identity, 'lost phone'))).toBe(hex(mod.orgRevokeStatement(orgId, 5n, identity, 'lost phone')));
    expect(hex(client.contactAad(orgId, identity))).toBe(hex(mod.contactAad(orgId, identity)));
    expect(hex(client.contactSalt(orgId))).toBe(hex(mod.contactSalt(orgId)));
    expect(hex(client.pageStatement(orgId, incidentId, pageId, 1_800_000_000_000, [3n, 1n, 2n]))).toBe(
      hex(mod.pageStatement(orgId, incidentId, pageId, 1_800_000_000_000, [3n, 1n, 2n])),
    );
    expect(hex(client.orgSafetyInput(orgId, identity, pub(1), pub(2)))).toBe(hex(mod.orgSafetyInput(orgId, identity, pub(1), pub(2))));
  });

  it('limits agree', () => {
    expect(client.MAX_PAGE_TARGETS).toBe(mod.MAX_PAGE_TARGETS);
    expect(client.MAX_PAGE_BODY_BYTES).toBe(mod.MAX_PAGE_BODY_BYTES);
    for (const v of ['+15551234567', '+1234567', '5551234567', '+0123456789']) expect(client.isE164(v)).toBe(mod.isE164(v));
  });
});

describe('statements are domain separated and injective', () => {
  it('every builder starts with a distinct zh1/org tag', () => {
    const outs = [
      mod.enrollLinkInput(orgId, code),
      mod.enrollJoinInput(orgId, identity, 'Dana', pub(1), pub(2), hash),
      mod.enrollStatement(orgId, identity, 'Dana', pub(1), pub(2), hash),
      mod.orgRevokeStatement(orgId, 1n, identity, 'r'),
      mod.contactAad(orgId, identity),
      mod.contactSalt(orgId),
      mod.pageStatement(orgId, incidentId, pageId, 1, [1n]),
      mod.orgSafetyInput(orgId, identity, pub(1), pub(2)),
    ];
    const tags = outs.map((o) => new TextDecoder().decode(o.subarray(4, 4 + new DataView(o.buffer, o.byteOffset).getUint32(0))));
    expect(new Set(tags).size).toBe(outs.length);
    for (const t of tags) expect(t.startsWith('zh1/org/')).toBe(true);
  });

  it('page statement sorts targets, binds every field and rejects duplicates', () => {
    const base = mod.pageStatement(orgId, incidentId, pageId, 5, [2n, 1n]);
    expect(hex(mod.pageStatement(orgId, incidentId, pageId, 5, [1n, 2n]))).toBe(hex(base));
    expect(hex(mod.pageStatement(orgId, incidentId, pageId, 6, [1n, 2n]))).not.toBe(hex(base));
    expect(hex(mod.pageStatement(orgId, incidentId, pageId, 5, [1n, 2n, 3n]))).not.toBe(hex(base));
    expect(() => mod.pageStatement(orgId, incidentId, pageId, 5, [1n, 1n])).toThrow();
  });

  it('enroll statement binds the sealed contact hash', () => {
    const a = mod.enrollStatement(orgId, identity, 'Dana', pub(1), pub(2), hash);
    const b = mod.enrollStatement(orgId, identity, 'Dana', pub(1), pub(2), new Uint8Array(32).fill(9));
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('limits', () => {
  it('org names and TTLs', () => {
    expect(mod.isValidOrgName(mod.normalizeOrgName('Lakeside'))).toBe(true);
    expect(mod.isValidOrgName('a'.repeat(81))).toBe(false);
    expect(mod.isValidOrgName('')).toBe(false);
    expect(mod.isValidEnrollTtlHours(24)).toBe(true);
    expect(mod.isValidEnrollTtlHours(25)).toBe(false);
    expect(mod.isValidEnrollTtlHours(0)).toBe(false);
  });
});
