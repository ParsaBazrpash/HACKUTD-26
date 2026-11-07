import { describe, expect, it } from 'vitest';
import { CHANNELS, ROLES } from '@/spacetimedb/src/shared/policy';
import {
  isKindAllowed,
  KIND_POLICY,
  PAYLOAD_KINDS,
  parsePayloadBytes,
  type Payload,
  PayloadSchema,
  serializePayload,
} from './events';

const U = '11111111-1111-4111-8111-111111111111';
const ID = 'ab'.repeat(32);
const sentAt = '2026-11-07T14:00:00.000Z';
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const valid: Record<string, unknown> = {
  'incident.title': { title: 'Ransomware at Lakeside' },
  'status.set': { severity: 'SEV1', phase: 'containment', summary: 'Isolating hosts' },
  'timeline.add': { entryId: U, occurredAt: sentAt, phase: 'detection_analysis', csf: 'DE.AE', text: 'Ransom note found' },
  'scope.set': {
    itemId: U,
    system: 'HR database',
    assetType: 'database',
    status: 'exfiltrated',
    dataTypes: ['ssn'],
    recordCount: 12400,
    affected: [{ state: 'TX', count: 9800 }],
    notes: '',
  },
  'task.set': { taskId: U, title: 'Reset domain admin', status: 'open' },
  'profile.set': {
    publicCompany: false,
    hipaaCoveredEntity: true,
    nydfsRegulated: false,
    defenseContractor: false,
    bank: false,
    euDataSubjects: false,
  },
  'legal.discovery': { determinedAt: sentAt, basis: 'Forensics confirmed exfiltration' },
  'legal.materiality': { determinedAt: sentAt, basis: '' },
  'deadline.update': { ruleId: 'gdpr-33', status: 'in_progress', note: '' },
  'evidence.add': { evidenceId: U, label: 'Memory image', sha256: 'a'.repeat(64), location: 'vault', custodian: 'Sam' },
  'roster.admit': { memberIdentity: ID, role: 'counsel', displayName: 'Dana' },
  'roster.revoke': { memberIdentity: ID, reason: 'left the team' },
  'chat.post': { messageId: U, text: 'hello', mentions: [] },
};

const env = (kind: string, body: unknown) => ({ v: 1, kind, sentAt, body });

describe('payload schemas', () => {
  it('has a valid example for every kind', () => {
    expect(Object.keys(valid).sort()).toEqual([...PAYLOAD_KINDS].sort());
    for (const k of PAYLOAD_KINDS) {
      const r = PayloadSchema.safeParse(env(k, valid[k]));
      expect(r.success, k).toBe(true);
    }
  });

  it('round trips through serialize and parse', () => {
    for (const k of PAYLOAD_KINDS) {
      const p = env(k, valid[k]) as Payload;
      const r = parsePayloadBytes(serializePayload(p));
      expect(r.ok).toBe(true);
    }
  });

  it('rejects unknown fields (strict)', () => {
    const r = parsePayloadBytes(bytes(env('chat.post', { ...(valid['chat.post'] as object), extra: 1 })));
    expect(r).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(parsePayloadBytes(bytes({ ...env('chat.post', valid['chat.post']), extra: 1 })).ok).toBe(false);
  });

  it('flags unknown kinds distinctly from invalid payloads', () => {
    expect(parsePayloadBytes(bytes(env('chat.delete', {})))).toEqual({ ok: false, reason: 'unknown_kind' });
    expect(parsePayloadBytes(bytes(env('chat.post', {})))).toEqual({ ok: false, reason: 'invalid_payload' });
  });

  it('rejects wrong version, bad JSON and invalid UTF-8', () => {
    expect(parsePayloadBytes(bytes({ ...env('chat.post', valid['chat.post']), v: 2 })).ok).toBe(false);
    expect(parsePayloadBytes(new TextEncoder().encode('{not json')).ok).toBe(false);
    expect(parsePayloadBytes(new Uint8Array([0xff, 0xfe, 0x7b])).ok).toBe(false);
    expect(parsePayloadBytes(bytes(null)).ok).toBe(false);
    expect(parsePayloadBytes(bytes([1, 2])).ok).toBe(false);
  });

  it('enforces length limits and formats', () => {
    const bad = (kind: string, body: object) =>
      expect(PayloadSchema.safeParse(env(kind, body)).success, kind).toBe(false);
    bad('incident.title', { title: '' });
    bad('incident.title', { title: 'x'.repeat(121) });
    bad('chat.post', { ...(valid['chat.post'] as object), text: 'x'.repeat(4001) });
    bad('chat.post', { ...(valid['chat.post'] as object), mentions: Array(21).fill(ID) });
    bad('chat.post', { ...(valid['chat.post'] as object), messageId: 'not-a-uuid' });
    bad('scope.set', { ...(valid['scope.set'] as object), affected: Array(61).fill({ state: 'TX', count: 1 }) });
    bad('scope.set', { ...(valid['scope.set'] as object), affected: [{ state: 'tx', count: 1 }] });
    bad('scope.set', { ...(valid['scope.set'] as object), recordCount: -1 });
    bad('scope.set', { ...(valid['scope.set'] as object), recordCount: 1.5 });
    bad('evidence.add', { ...(valid['evidence.add'] as object), sha256: 'A'.repeat(64) });
    bad('timeline.add', { ...(valid['timeline.add'] as object), occurredAt: 'yesterday' });
    bad('timeline.add', { ...(valid['timeline.add'] as object), phase: 'panic' });
    bad('deadline.update', { ruleId: 'Has Space', status: 'open', note: '' });
    bad('status.set', { severity: 'SEV9', phase: 'containment', summary: '' });
  });

  it('keeps hostile text as plain data', () => {
    const p = env('chat.post', { ...(valid['chat.post'] as object), text: '<img src=x onerror=alert(1)>' });
    const r = parsePayloadBytes(bytes(p));
    expect(r.ok && r.payload.kind === 'chat.post' && r.payload.body.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('serializePayload refuses invalid payloads', () => {
    expect(() => serializePayload(env('chat.post', {}) as unknown as Payload)).toThrow();
  });
});

describe('per-kind policy', () => {
  it('only the commander may author status, title and roster kinds', () => {
    for (const k of ['incident.title', 'status.set', 'roster.admit', 'roster.revoke'] as const) {
      expect(isKindAllowed(k, 'record', 'commander')).toBe(true);
      for (const r of ROLES.filter((x) => x !== 'commander')) expect(isKindAllowed(k, 'record', r), `${k} ${r}`).toBe(false);
    }
  });
  it('legal kinds are commander and counsel only', () => {
    for (const k of ['profile.set', 'legal.discovery', 'legal.materiality', 'deadline.update'] as const) {
      expect(isKindAllowed(k, 'record', 'counsel')).toBe(true);
      expect(isKindAllowed(k, 'record', 'technical')).toBe(false);
      expect(isKindAllowed(k, 'record', 'executive')).toBe(false);
    }
  });
  it('record kinds are not allowed in chat channels and vice versa', () => {
    for (const c of ['command', 'privileged', 'technical'] as const) expect(isKindAllowed('timeline.add', c, 'commander')).toBe(false);
    expect(isKindAllowed('chat.post', 'record', 'commander')).toBe(false);
  });
  it('chat respects the channel write matrix', () => {
    expect(isKindAllowed('chat.post', 'privileged', 'technical')).toBe(false);
    expect(isKindAllowed('chat.post', 'technical', 'executive')).toBe(false);
    expect(isKindAllowed('chat.post', 'command', 'executive')).toBe(true);
    expect(isKindAllowed('chat.post', 'privileged', 'executive')).toBe(true);
  });
  it('every kind has a policy on a real channel', () => {
    for (const k of PAYLOAD_KINDS) for (const c of KIND_POLICY[k].channels) expect(CHANNELS).toContain(c);
  });
});
