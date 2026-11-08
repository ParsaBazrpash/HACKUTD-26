import 'server-only';

import { b64urlDecode } from '@/lib/crypto/b64url';
import { bytesEqual } from '@/lib/crypto/hash';
import { openContact, verifyEnrollment, verifyPageRequest } from '@/lib/crypto/org';
import { parsePageRequestBody, type PageRequestWire } from '@/lib/protocol/org';
import type { PagerConfig } from './config';
import { pagerUpdate, readPagerState, type MemberRow } from './spacetime';
import { placeCall } from './twilio';

/** A request may be at most this far from the pager's clock, either way. */
export const PAGE_MAX_SKEW_MS = 120_000;

export type Refusal =
  | 'unavailable'
  | 'bad_body'
  | 'untrusted_admin'
  | 'stale'
  | 'replay'
  | 'bad_certificate'
  | 'bad_signature'
  | 'state_mismatch'
  | 'malformed_contact'
  | 'not_allowed';

export interface PageResult {
  status: number;
  body: { ok: true; dialed: number; failed: number } | { ok: false; error: Refusal };
}

export interface PageDeps {
  cfg: PagerConfig | null;
  fetch: typeof fetch;
  now: () => number;
  /** pageId to expiry time. One per server instance; the Spacetime page rows guard across instances. */
  seen: Map<string, number>;
}

const refuse = (status: number, error: Refusal): PageResult => ({ status, body: { ok: false, error } });

export const newSeenPages = (): Map<string, number> => new Map();

async function importPagerKey(pkcs8: string): Promise<CryptoKey | null> {
  try {
    const raw = b64urlDecode(pkcs8);
    return await crypto.subtle.importKey('pkcs8', raw as unknown as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } catch {
    return null;
  }
}

function matches(row: MemberRow, orgId: string, identity: string, rec: { signPub: string; ecdhPub: string; sealedContact: string }): boolean {
  return (
    row.orgId === orgId &&
    row.identity === identity &&
    row.state === 'active' &&
    bytesEqual(row.signPub, b64urlDecode(rec.signPub)) &&
    bytesEqual(row.ecdhPub, b64urlDecode(rec.ecdhPub)) &&
    bytesEqual(row.sealedContact, b64urlDecode(rec.sealedContact))
  );
}

/** Verifies everything first. Twilio is called only after every check passes for every target. */
export async function handlePage(rawBody: string, deps: PageDeps): Promise<PageResult> {
  const { cfg } = deps;
  if (!cfg) return refuse(503, 'unavailable');
  const req: PageRequestWire | null = parsePageRequestBody(rawBody);
  if (!req) return refuse(400, 'bad_body');

  // 1. Trusted admin key (all certificates in a request use the one key in the body).
  const adminPub = b64urlDecode(req.adminSignPub);
  if (!cfg.adminPins.some((p) => bytesEqual(p, adminPub))) return refuse(403, 'untrusted_admin');

  // 2. Freshness and replay (the replay check is recorded only after the commander signature passes).
  const now = deps.now();
  if (Math.abs(now - req.sentAt) > PAGE_MAX_SKEW_MS) return refuse(400, 'stale');
  for (const [k, exp] of deps.seen) if (exp <= now) deps.seen.delete(k);
  if (deps.seen.has(req.pageId)) return refuse(409, 'replay');

  // 3. Admin certificates on the commander and every target.
  const records = [req.commander, ...req.targets];
  for (const r of records) {
    const ok = await verifyEnrollment(
      adminPub,
      {
        orgId: req.orgId,
        identityHex: r.identity,
        displayName: r.displayName,
        signPub: b64urlDecode(r.signPub),
        ecdhPub: b64urlDecode(r.ecdhPub),
        sealedContact: b64urlDecode(r.sealedContact),
      },
      b64urlDecode(r.enrollSig),
    );
    if (!ok) return refuse(403, 'bad_certificate');
  }

  // 4. Commander's signature over the targets rebuilt from the body: each orgMemberId paired with its identity.
  const targetRefs = req.targets.map((t) => ({ orgMemberId: BigInt(t.orgMemberId), identityHex: t.identity }));
  const sigOk = await verifyPageRequest(
    b64urlDecode(req.commander.signPub),
    { orgId: req.orgId, incidentId: req.incidentId, pageId: req.pageId, sentAtMs: req.sentAt, targets: targetRefs },
    b64urlDecode(req.commanderSig),
  );
  if (!sigOk) return refuse(403, 'bad_signature');
  deps.seen.set(req.pageId, now + 2 * PAGE_MAX_SKEW_MS);

  // 5. Spacetime must agree: commander and targets active and unchanged, a fresh 'requested' page row for each target.
  const state = await readPagerState(cfg, deps.fetch);
  if (!state) return refuse(503, 'unavailable');
  const commanderRow = state.members.find((m) => m.orgId === req.orgId && m.identity === req.commander.identity);
  if (!commanderRow || !matches(commanderRow, req.orgId, req.commander.identity, req.commander)) return refuse(403, 'state_mismatch');
  for (const t of req.targets) {
    const row = state.members.find((m) => m.orgId === req.orgId && m.orgMemberId === t.orgMemberId);
    if (!row || !matches(row, req.orgId, t.identity, t)) return refuse(403, 'state_mismatch');
    const page = state.pages.find((p) => p.pageId === req.pageId && p.orgMemberId === t.orgMemberId);
    if (!page || page.status !== 'requested' || page.incidentId !== req.incidentId || page.requestedBy !== req.commander.identity) {
      return refuse(403, 'state_mismatch');
    }
  }

  // 6. Open every sealed number (exactly 109 bytes, checked inside openContact) and apply the allowlist.
  const key = await importPagerKey(cfg.pagerPrivateKey);
  if (!key) return refuse(503, 'unavailable');
  const numbers: { orgMemberId: string; to: string }[] = [];
  for (const t of req.targets) {
    const to = await openContact(key, req.orgId, t.identity, b64urlDecode(t.sealedContact));
    if (to === null) return refuse(400, 'malformed_contact');
    if (cfg.allowedNumbers.size > 0 && !cfg.allowedNumbers.has(to)) return refuse(403, 'not_allowed');
    numbers.push({ orgMemberId: t.orgMemberId, to });
  }

  // 7. Only now dial.
  let dialed = 0;
  let failed = 0;
  await Promise.all(
    numbers.map(async ({ orgMemberId, to }) => {
      const ok = await placeCall(cfg, deps.fetch, to, req.pageId, orgMemberId);
      await pagerUpdate(cfg, deps.fetch, req.pageId, orgMemberId, ok ? 'calling' : 'failed');
      if (ok) dialed++;
      else failed++;
    }),
  );
  return { status: 200, body: { ok: true, dialed, failed } };
}
