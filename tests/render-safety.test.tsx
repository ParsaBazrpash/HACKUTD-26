import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IncidentState, TimelineItem, ScopeItem, ChannelMessage } from '@/lib/client/types';

// Hostile text must reach the screen only as escaped text. These tests render
// the real components that show user-supplied text (messages, timeline, scope)
// and check the markup. They cover threat row T21.

const holder: { state: IncidentState | null } = { state: null };
vi.mock('@/hooks/use-incident', () => ({
  useIncident: () => holder.state,
}));

const { SafeText } = await import('@/components/incidents/safe-text');
const { TimelineList } = await import('@/components/incidents/timeline-list');
const { ScopeList } = await import('@/components/incidents/scope-list');
const { ChannelsBoard } = await import('@/components/incidents/channels-board');
const { EMPTY_PROFILE } = await import('@/lib/client/types');

const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>alert(1)</script>';
const SVG = '<svg onload=alert(1)>';
const JS_LINK = '[click](javascript:alert(1)) javascript:alert(1) <a href="javascript:alert(1)">x</a>';
const DATA_LINK = 'data:text/html,<script>alert(1)</script> vbscript:msgbox(1)';
// U+202E right-to-left override, U+2066 isolate, U+200B zero width space.
const BIDI = 'invoice ‮gpj.exe‬ ⁦hidden⁩​';
const HOSTILE = [IMG, SCRIPT, SVG, JS_LINK, DATA_LINK, BIDI].join(' | ');

const ok = { ok: true, failures: [], warnings: [] };
const member = { identity: 'a'.repeat(64), displayName: `Eve ${IMG}`, role: 'technical' as const };
const at = new Date('2026-11-08T12:00:00Z');

function expectInert(html: string) {
  expect(html).not.toMatch(/<img/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<svg/i);
  expect(html).not.toMatch(/href=["']?\s*(javascript|data|vbscript):/i);
  expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
  // The text is still shown, as escaped text.
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('javascript:alert(1)');
}

function baseState(): IncidentState {
  return {
    connection: 'live',
    me: { ...member, displayName: 'Me', state: 'active' },
    incident: null,
    status: null,
    members: [],
    channels: [],
    timeline: [],
    scope: [],
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: { ok: true, checkedAt: at, channels: {}, rosterFailures: [] },
    org: null,
    roster: [],
    pages: [],
  } as unknown as IncidentState;
}

describe('render safety (T21, script injection via decrypted text)', () => {
  it('SafeText escapes hostile markup and never emits a non-http link', () => {
    const html = renderToStaticMarkup(createElement(SafeText, { text: HOSTILE }));
    expectInert(html);
  });

  it('SafeText keeps real http links as safe anchors', () => {
    const html = renderToStaticMarkup(createElement(SafeText, { text: 'see https://example.com/a now' }));
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('SafeText passes bidi controls through as text, not markup', () => {
    const html = renderToStaticMarkup(createElement(SafeText, { text: BIDI }));
    expect(html).toContain('‮');
    expect(html).not.toMatch(/<[a-z][^>]*‮/i);
  });

  it('messages render hostile text and author names as escaped text', () => {
    const message: ChannelMessage = {
      seq: 1n,
      messageId: 'm1',
      author: member,
      sentAt: at,
      serverTs: at,
      text: HOSTILE,
      mentions: [],
      verdict: ok,
    };
    holder.state = { ...baseState(), channels: [{ kind: 'technical', messages: [message], waitingForKeys: false }] };
    const html = renderToStaticMarkup(createElement(ChannelsBoard, {}));
    expectInert(html);
    expect(html).toContain('Eve &lt;img');
  });

  it('timeline entries render hostile text as escaped text', () => {
    const item = {
      seq: 1n,
      by: member,
      at,
      sentAt: at,
      verdict: ok,
      amendedBy: [],
      entry: {
        entryId: '00000000-0000-4000-8000-000000000001',
        occurredAt: at.toISOString(),
        phase: 'containment',
        csf: 'RS.MI',
        text: HOSTILE,
      },
    } as unknown as TimelineItem;
    holder.state = { ...baseState(), timeline: [item] };
    const html = renderToStaticMarkup(createElement(TimelineList, { items: [item], detailed: true }));
    expectInert(html);
    expect(html).toContain('Eve &lt;img');
  });

  it('scope items render system name and notes as escaped text', () => {
    const latest = {
      itemId: '00000000-0000-4000-8000-000000000002',
      system: HOSTILE,
      assetType: 'server',
      status: 'encrypted',
      dataTypes: [],
      affected: [],
      notes: HOSTILE,
    };
    const item = {
      itemId: latest.itemId,
      latest,
      history: [{ seq: 1n, by: member, at, sentAt: at, verdict: ok, body: latest }],
    } as unknown as ScopeItem;
    const html = renderToStaticMarkup(createElement(ScopeList, { items: [item] }));
    expectInert(html);
  });
});
