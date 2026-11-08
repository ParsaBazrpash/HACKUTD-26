import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BreakGlassCard } from '@/components/org/break-glass-card';
import { CARD_HOW_TO, cardQrText, fingerprintFromEnrollFragment } from '@/components/org/break-glass-model';
import { formatFingerprint } from '@/lib/crypto/keys';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { buildEnrollFragment } from '@/lib/protocol/org';

const ADDRESS = 'https://haven-2026.vercel.app';
const FP = 'abcd 1234 abcd 1234 abcd 1234 abcd 1234';
const HOSTILE = '<img src=x onerror=alert(1)> ‮gpj.exe';

function render(props: { orgName: string | null; address?: string; adminFingerprint: string | null }) {
  return renderToStaticMarkup(createElement(BreakGlassCard, { address: ADDRESS, ...props }));
}

describe('cardQrText', () => {
  it('returns only the origin', () => {
    expect(cardQrText('https://haven-2026.vercel.app/enroll?x=1#e=secret')).toBe('https://haven-2026.vercel.app');
  });
  it('rejects non http(s) and garbage', () => {
    expect(cardQrText('javascript:alert(1)')).toBeNull();
    expect(cardQrText('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(cardQrText('not a url')).toBeNull();
    expect(cardQrText('')).toBeNull();
  });
});

describe('fingerprintFromEnrollFragment', () => {
  it('returns only the formatted fingerprint', () => {
    const code = new Uint8Array(16).fill(7);
    const secret = new Uint8Array(32).fill(9);
    const adminFingerprint = new Uint8Array(32).map((_, i) => i + 1);
    const fragment = buildEnrollFragment({ orgId: '123e4567-e89b-42d3-a456-426614174000', code, secret, adminFingerprint });
    const out = fingerprintFromEnrollFragment(fragment);
    expect(out).toBe(formatFingerprint(adminFingerprint));
    expect(out).not.toContain(b64urlEncode(code));
    expect(out).not.toContain(b64urlEncode(secret));
    expect(out).not.toContain('e=');
  });
  it('returns null on junk', () => {
    expect(fingerprintFromEnrollFragment(null)).toBeNull();
    expect(fingerprintFromEnrollFragment('')).toBeNull();
    expect(fingerprintFromEnrollFragment('e=a.b.c.d')).toBeNull();
    expect(fingerprintFromEnrollFragment('junk')).toBeNull();
  });
});

describe('BreakGlassCard markup', () => {
  it('escapes a hostile org name and holds only public facts', () => {
    const html = render({ orgName: HOSTILE, adminFingerprint: FP });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/<[^>]*\sonerror=/);
    expect(html).toContain('NOT A KEY');
    expect(html).toContain('cannot sign you in or let anyone in');
    expect(html).toContain('Lost or damaged? Ask IT or your admin for a new one.');
    expect(html).toContain('company email, chat or laptops are down or hacked');
    expect(html).not.toMatch(/one-time|single use|single-use/i);
    expect(html).toContain(ADDRESS);
    expect(html).toContain(FP);
    expect(html).not.toMatch(/\b\d{3} \d{3} \d{3} \d{3}\b|\b\d{12}\b/);
    expect(html).not.toContain('#e=');
  });
  it('uses a default heading and explains a missing fingerprint', () => {
    const html = render({ orgName: null, adminFingerprint: null });
    expect(html).toContain('Your HAVEN card');
    expect(html).toContain('Shown on the Org page after your admin approves you.');
  });
  it('has the buttons and the how-to text, without dashes', () => {
    const html = render({ orgName: 'Acme', adminFingerprint: FP });
    expect(html).toContain('Save as image');
    expect(html).toContain('>Print<');
    for (const text of [...CARD_HOW_TO.handy, CARD_HOW_TO.when, CARD_HOW_TO.where, ...CARD_HOW_TO.how]) {
      expect(html).toContain(text.replace(/'/g, '&#x27;'));
      expect(text).not.toMatch(/[–—]/);
    }
    expect(html).not.toMatch(/[–—]/);
  });
});
