import { describe, expect, it } from 'vitest';
import { pagerRefusalMessage } from '@/lib/client/real';

describe('pagerRefusalMessage', () => {
  it('names the setting to check for each pager refusal code', () => {
    expect(pagerRefusalMessage('untrusted_admin', 403)).toContain('ORG_ADMIN_SIGN_PUB');
    expect(pagerRefusalMessage('not_allowed', 403)).toContain('PAGER_ALLOWED_NUMBERS');
    expect(pagerRefusalMessage('malformed_contact', 400)).toContain('pager key');
    expect(pagerRefusalMessage('stale', 400)).toContain('clock');
    expect(pagerRefusalMessage('unavailable', 503)).toContain('(pager: unavailable)');
  });
  it('falls back to the HTTP status when the body had no code', () => {
    expect(pagerRefusalMessage(undefined, 500)).toContain('HTTP 500');
  });
});
