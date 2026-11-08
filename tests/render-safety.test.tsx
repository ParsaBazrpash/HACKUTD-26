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
const { BlastRadius, SystemDetail } = await import('@/components/incidents/blast-radius');
const { AttachedCardChip, CardPickerList } = await import('@/components/incidents/card-attach');
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

// Lucide icons are real svg elements. Strip only svgs that look exactly like an app icon:
// a lucide class, aria-hidden, and nothing inside but plain shape elements. An injected svg
// that carries a script, image, link or foreignObject is left in place and still fails.
const ICON_SHAPES = '(?:<(?:path|circle|rect|line|polyline|polygon|ellipse)\\b[^<>]*?(?:/>|></(?:path|circle|rect|line|polyline|polygon|ellipse)>))*';
const APP_ICON = new RegExp(
  `<svg\\b(?=[^>]*\\bclass="lucide\\b)(?=[^>]*\\baria-hidden="true")[^>]*>${ICON_SHAPES}</svg>`,
  'gi',
);
function withoutAppIcons(html: string): string {
  return html.replace(APP_ICON, '');
}

function expectInert(html: string) {
  expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
  const content = withoutAppIcons(html);
  expect(content).not.toMatch(/<img/i);
  expect(content).not.toMatch(/<script/i);
  expect(content).not.toMatch(/<svg/i);
  expect(content).not.toMatch(/href=["']?\s*(javascript|data|vbscript):/i);
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

  it('the live blast radius map renders hostile system and author names as escaped text', () => {
    const latest = {
      itemId: '00000000-0000-4000-8000-000000000003',
      system: HOSTILE,
      assetType: 'database',
      status: 'exfiltrated',
      dataTypes: ['ssn'],
      recordCount: 12400,
      affected: [{ state: 'TX', count: 9800 }],
      notes: HOSTILE,
    };
    const item = {
      itemId: latest.itemId,
      latest,
      history: [{ seq: 1n, by: member, at, sentAt: at, verdict: ok, body: latest }],
    } as unknown as ScopeItem;
    holder.state = { ...baseState(), scope: [item] };
    const html = renderToStaticMarkup(createElement(BlastRadius, {}));
    // Names also sit in aria-label and title attributes, where React escapes them. Blank every quoted
    // attribute value first, then no tag may carry an event-handler attribute of its own.
    expect(html.replace(/="[^"]*"/g, '=""')).not.toMatch(/<[a-z][^>]*\son\w+=/i);
    // The map's own chart is the only svg that is not an app icon; nothing injected may sit next to it.
    const content = withoutAppIcons(html);
    expect(content.match(/<svg/g) ?? []).toHaveLength(1);
    expect(content).toMatch(/<svg viewBox="[-0-9 ]+" role="group"/);
    expect(content).not.toMatch(/<img|<script|<foreignObject|<a\s[^>]*href=["']?\s*(javascript|data|vbscript):/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Eve &lt;img');
    expect(html).toContain('TX');
  });

  it('a live card in chat draws hostile system names as escaped text, and a failed message draws no card', () => {
    const latest = {
      itemId: '00000000-0000-4000-8000-000000000004',
      system: HOSTILE,
      assetType: 'server',
      status: 'encrypted',
      dataTypes: [],
      affected: [{ state: 'CA', count: 3 }],
      notes: '',
    };
    const item = {
      itemId: latest.itemId,
      latest,
      history: [{ seq: 1n, by: member, at, sentAt: at, verdict: ok, body: latest }],
    } as unknown as ScopeItem;
    const card: ChannelMessage = {
      seq: 2n,
      messageId: 'm2',
      author: member,
      sentAt: at,
      serverTs: at,
      text: `${IMG} [card:system:${latest.itemId}]`,
      mentions: [],
      verdict: ok,
    };
    const failed: ChannelMessage = {
      ...card,
      seq: 3n,
      messageId: 'm3',
      text: '[card:blast]',
      verdict: { ok: false, failures: ['bad_signature'], warnings: [] },
    };
    holder.state = {
      ...baseState(),
      scope: [item],
      channels: [{ kind: 'command', messages: [card, failed], waitingForKeys: false }],
    } as unknown as IncidentState;
    const html = renderToStaticMarkup(createElement(ChannelsBoard, {}));
    expectInert(html);
    expect(html).toContain('data-live-card="system"');
    expect(html).not.toContain('data-live-card="blast"');
    expect(html).toContain('[card:blast]');
  });
});

function hostileScopeItem(itemId: string): ScopeItem {
  const latest = {
    itemId,
    system: HOSTILE,
    assetType: 'server',
    status: 'encrypted',
    dataTypes: ['ssn'],
    recordCount: 10,
    affected: [{ state: 'TX', count: 10 }],
    notes: '',
  };
  return {
    itemId,
    latest,
    history: [{ seq: 1n, by: member, at, sentAt: at, verdict: ok, body: latest }],
  } as unknown as ScopeItem;
}

describe('render safety for the card picker (T21)', () => {
  it('the paperclip list and the attached chip show hostile system names as escaped text', () => {
    const itemId = '00000000-0000-4000-8000-000000000005';
    holder.state = { ...baseState(), scope: [hostileScopeItem(itemId)] };
    const list = renderToStaticMarkup(createElement(CardPickerList, { onPick: () => undefined }));
    expectInert(list);
    expect(list).toContain('Live blast radius');
    const chip = renderToStaticMarkup(createElement(AttachedCardChip, { card: { kind: 'system', itemId }, onRemove: () => undefined }));
    expectInert(chip);
    expect(chip).toContain('Remove the attached card');
  });

  it('a card for a system this reader does not have shows a neutral label, not the pointer', () => {
    holder.state = baseState();
    const chip = renderToStaticMarkup(
      createElement(AttachedCardChip, { card: { kind: 'system', itemId: '00000000-0000-4000-8000-0000000000ff' }, onRemove: () => undefined }),
    );
    expect(chip).toContain('A system');
    expect(chip).not.toContain('[card:');
  });
});

// Negative checks on the map controls (AGENTS.md: security logic needs a negative test).
// The module still refuses a scope.set from a role that may not write #record; these
// tests prove the screen never offers the write or a share into a channel the member
// may not post in.
describe('map controls follow the role table', () => {
  const itemId = '00000000-0000-4000-8000-000000000006';
  const allChannels = (['command', 'privileged', 'technical'] as const).map((kind) => ({ kind, messages: [], waitingForKeys: false }));

  function renderDetail(role: 'commander' | 'counsel' | 'technical' | 'executive', memberState: 'active' | 'pending' | 'revoked' = 'active') {
    const state = {
      ...baseState(),
      me: { ...member, displayName: 'Me', role, state: memberState },
      scope: [hostileScopeItem(itemId)],
      channels: allChannels,
    } as unknown as IncidentState;
    holder.state = state;
    return {
      detail: renderToStaticMarkup(createElement(SystemDetail, { state, itemId })),
      map: renderToStaticMarkup(createElement(BlastRadius, {})),
    };
  }

  function offered(html: string): string[] {
    return [...html.matchAll(/<option value="(command|privileged|technical)"/g)].map((m) => m[1]);
  }

  it('the commander gets the status picker and can share into every chat channel', () => {
    const { detail } = renderDetail('commander');
    expect(detail).toContain('Save status');
    expect(detail).toContain('Share to chat');
    expect(offered(detail)).toEqual(['command', 'privileged', 'technical']);
  });

  it('an executive cannot change a status from the map and cannot share into #technical', () => {
    const { detail, map } = renderDetail('executive');
    expect(detail).not.toContain('Save status');
    expect(detail).not.toContain('quick-status-');
    expect(offered(detail)).toEqual(['command', 'privileged']);
    expect(offered(map)).toEqual(['command', 'privileged']);
  });

  it('a technical lead never gets #privileged as a share target', () => {
    const { detail } = renderDetail('technical');
    expect(detail).toContain('Save status');
    expect(offered(detail)).toEqual(['command', 'technical']);
  });

  it('a pending or removed member gets no status picker and no share control at all', () => {
    for (const memberState of ['pending', 'revoked'] as const) {
      const { detail, map } = renderDetail('commander', memberState);
      expect(detail, memberState).not.toContain('Save status');
      expect(detail, memberState).not.toContain('Share to chat');
      expect(map, memberState).not.toContain('Share the map to chat');
      expect(offered(map), memberState).toEqual([]);
    }
  });
});
