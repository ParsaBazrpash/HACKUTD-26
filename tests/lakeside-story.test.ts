import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKindAllowed, PayloadSchema, type Payload, type PayloadKind } from '@/lib/protocol/events';
import {
  BEATS,
  BOT_KEYS,
  CAST,
  LIVE_BEATS,
  isActionBeat,
  resolveBeat,
  type CastKey,
  type PayloadBeat,
  type ResolveCtx,
} from '@/lib/scenario/lakeside-story';

const T0 = new Date('2026-11-08T08:13:00.000Z'); // 02:13 CST
const FILE = 'lib/scenario/lakeside-story.ts';

/** A uuid v4 shaped id derived from a label, stable across the test. */
function uuidFor(label: string): string {
  const h = createHash('sha256').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const identityFor = (key: string) => createHash('sha256').update(`id:${key}`).digest('hex');

const ctx: ResolveCtx = {
  t0: T0,
  person: (k) => identityFor(k),
  localId: (k) => uuidFor(`local:${k}`),
  entryId: (k) => uuidFor(`entry:${k}`),
};

const castByKey = new Map<string, (typeof CAST)[number]>(CAST.map((c) => [c.key, c]));
const payloadBeats = BEATS.filter((b): b is PayloadBeat => !isActionBeat(b));

/** Adds the ids the client generates, so the result can be checked against the full schema. */
function fullPayload(beat: PayloadBeat, index: number): Payload {
  const r = resolveBeat(beat, ctx);
  const body: Record<string, unknown> = { ...r.body };
  if (r.kind === 'timeline.add') body.entryId = beat.kind === 'timeline.add' && beat.key ? uuidFor(`entry:${beat.key}`) : uuidFor(`entry#${index}`);
  if (r.kind === 'evidence.add') body.evidenceId = uuidFor(`evidence#${index}`);
  if (r.kind === 'chat.post') body.messageId = uuidFor(`message#${index}`);
  return { v: 1, kind: r.kind, sentAt: T0.toISOString(), body } as Payload;
}

describe('Lakeside story', () => {
  it('has a unique cast and a bot for every bot slot', () => {
    expect(new Set(CAST.map((c) => c.key)).size).toBe(CAST.length);
    expect(new Set(CAST.map((c) => c.displayName)).size).toBe(CAST.length);
    expect(BOT_KEYS).toEqual(['jordan', 'sam', 'lee', 'priya', 'drew', 'casey']);
  });

  it('parses every payload beat with the payload schema once resolved', () => {
    payloadBeats.forEach((beat, i) => {
      const parsed = PayloadSchema.safeParse(fullPayload(beat, i));
      expect(parsed.success, `beat ${i} (${beat.kind} at ${beat.at} by ${beat.by}) ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    });
  });

  it('lets every beat author write its kind in its channel', () => {
    for (const [i, beat] of BEATS.entries()) {
      const author = castByKey.get(beat.by);
      expect(author, `beat ${i} author ${beat.by}`).toBeDefined();
      expect(author?.role, `beat ${i} author has an incident role`).not.toBeNull();
      if (isActionBeat(beat)) {
        expect(author?.role, `beat ${i} action by commander`).toBe('commander');
        continue;
      }
      expect(isKindAllowed(beat.kind, beat.channel, author!.role!), `beat ${i} ${beat.kind} in #${beat.channel} by ${beat.by}`).toBe(true);
    }
    for (const [i, live] of LIVE_BEATS.entries()) {
      const author = castByKey.get(live.by);
      expect(author?.player, `live beat ${i}`).toBe('bot');
      expect(isKindAllowed('chat.post', live.channel, author!.role!), `live beat ${i} in #${live.channel} by ${live.by}`).toBe(true);
    }
  });

  it('keeps the beats in time order, with the commander only doing commander things', () => {
    const times = BEATS.map((b) => b.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const beat of BEATS) {
      if (beat.kind === 'incident.title' || beat.kind === 'status.set' || isActionBeat(beat)) expect(beat.by).toBe('avery');
    }
  });

  it('carries the real SHA-256 of each evidence string', () => {
    const evidence = payloadBeats.filter((b) => b.kind === 'evidence.add');
    expect(evidence.length).toBe(3);
    for (const beat of evidence) {
      if (beat.kind !== 'evidence.add') continue;
      const digest = createHash('sha256').update(beat.body.artifact, 'utf8').digest('hex');
      expect(beat.body.sha256).toBe(digest);
    }
  });

  it('has unique timeline keys, resolvable references and amendments that point backwards', () => {
    const seen = new Map<string, { index: number; by: CastKey }>();
    for (const [i, beat] of BEATS.entries()) {
      if (beat.kind !== 'timeline.add') continue;
      if (beat.key) {
        expect(seen.has(beat.key), `duplicate timeline key ${beat.key}`).toBe(false);
        seen.set(beat.key, { index: i, by: beat.by });
      }
      const target = beat.body.amends;
      if (target) {
        const earlier = seen.get(target);
        expect(earlier, `amendment ${i} points at an earlier timeline beat`).toBeDefined();
        expect(earlier!.index).toBeLessThan(i);
        expect(earlier!.by, 'only the owner amends an entry').toBe(beat.by);
      }
    }
    expect([...seen.keys()].length).toBeGreaterThan(0);

    // Scope and task keys may repeat (a later beat updates the item), but must not collide across the two kinds.
    const scopeKeys = new Set(BEATS.flatMap((b) => (b.kind === 'scope.set' ? [b.key] : [])));
    const taskKeys = new Set(BEATS.flatMap((b) => (b.kind === 'task.set' ? [b.key] : [])));
    for (const k of scopeKeys) expect(taskKeys.has(k), `key ${k} used for scope and task`).toBe(false);

    // Every person reference is a cast member.
    const refs: string[] = [];
    for (const b of BEATS) {
      refs.push(b.by);
      if (b.kind === 'task.set' && b.body.assignee) refs.push(b.body.assignee);
      if (b.kind === 'deadline.update' && b.body.owner) refs.push(b.body.owner);
      if (b.kind === 'chat.post') refs.push(...(b.body.mentions ?? []));
      if (b.kind === 'ui.page') refs.push(...b.who);
      if (b.kind === 'ui.revoke') refs.push(b.who);
    }
    for (const r of refs) expect(castByKey.has(r), `unknown cast key ${r}`).toBe(true);
  });

  it('resolves people to identities and drops people who are not in the incident', () => {
    const task = payloadBeats.find((b) => b.kind === 'task.set' && b.body.assignee === 'sam')!;
    const withSam = resolveBeat(task, ctx);
    expect(withSam.body.assignee).toBe(identityFor('sam'));
    const without = resolveBeat(task, { ...ctx, person: () => undefined });
    expect('assignee' in without.body).toBe(false);
  });

  it('uses every task status and every channel, and tells the intended story', () => {
    const statuses = new Set(BEATS.flatMap((b) => (b.kind === 'task.set' ? [b.body.status] : [])));
    expect([...statuses].sort()).toEqual(['blocked', 'done', 'in_progress', 'open']);
    const channels = new Set(payloadBeats.map((b) => b.channel));
    expect([...channels].sort()).toEqual(['command', 'privileged', 'record', 'technical']);
    const decisions = BEATS.filter((b) => b.kind === 'timeline.add' && b.body.text.startsWith('Decision:'));
    expect(decisions.filter((b) => b.by === 'avery').length).toBe(4);
    expect(decisions.filter((b) => b.by !== 'avery').length).toBe(1);
    const text = readFileSync(FILE, 'utf8');
    for (const needle of ['41_200', '12,400', '342', '37 charts', '18.6 GB']) expect(text, needle).toContain(needle);
  });

  it('has no em dash and no phone number outside the fictional range', () => {
    const text = readFileSync(FILE, 'utf8');
    expect(text).not.toContain('—');
    expect(text).not.toContain('–');
    const phones = text.match(/\+?\d{1,2}[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/g) ?? [];
    for (const p of phones) expect(p, `phone-like text ${p}`).toMatch(/^\+1\d{3}5550(1\d\d)$/);
    const e164 = text.match(/\+1\d{10}/g) ?? [];
    expect(e164.length).toBe(BOT_KEYS.length);
    for (const p of e164) expect(p).toMatch(/^\+1\d{3}5550(1\d\d)$/);
  });

  it('imports only types from the protocol and policy files', () => {
    const text = readFileSync(FILE, 'utf8');
    const imports = [...text.matchAll(/^import (type )?[\s\S]*?from '([^']+)';/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) {
      expect(m[1], `import from ${m[2]} must be type only`).toBe('type ');
      expect(['@/spacetimedb/src/shared/policy', '@/lib/protocol/events']).toContain(m[2]);
    }
  });

  it('fails the policy check for a technical author on status.set (negative)', () => {
    const status = payloadBeats.find((b) => b.kind === 'status.set')!;
    expect(isKindAllowed(status.kind as PayloadKind, status.channel, 'commander')).toBe(true);
    const copy: PayloadBeat = { ...status, by: 'sam' };
    expect(isKindAllowed(copy.kind, copy.channel, castByKey.get(copy.by)!.role!)).toBe(false);
  });

  it('fails the policy check for an executive on a record kind and the schema for a bad body (negative)', () => {
    const task = payloadBeats.find((b) => b.kind === 'task.set')!;
    expect(isKindAllowed(task.kind, task.channel, 'executive')).toBe(false);
    const bad = fullPayload(task, 0) as { body: Record<string, unknown> };
    expect(PayloadSchema.safeParse({ ...bad, body: { ...bad.body, status: 'finished' } }).success).toBe(false);
  });
});
