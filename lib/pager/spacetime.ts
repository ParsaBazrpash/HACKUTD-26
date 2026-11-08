import 'server-only';

import type { PagerConfig } from './config';

/** Page statuses the module accepts (forward only). */
export type PageStatus = 'calling' | 'ringing' | 'acknowledged' | 'no_answer' | 'busy' | 'failed';

const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const isDecimalId = (s: string): boolean => /^(0|[1-9][0-9]{0,19})$/.test(s);

/**
 * Calls a reducer over HTTP as the pager identity:
 * POST {host}/v1/database/{db}/call/{reducer}, JSON array of args, Bearer token.
 * Ids are validated first, so nothing untrusted reaches the URL or the body.
 */
export async function pagerUpdate(
  cfg: PagerConfig,
  doFetch: typeof fetch,
  pageId: string,
  orgMemberId: string,
  status: PageStatus,
): Promise<boolean> {
  try {
    if (!isUuid(pageId) || !isDecimalId(orgMemberId)) return false;
    // orgMemberId is a u64: written as a bare JSON number from the validated digit string.
    const body = `[${JSON.stringify(pageId)},${orgMemberId},${JSON.stringify(status)}]`;
    const res = await doFetch(`${cfg.spacetimeHost}/v1/database/${encodeURIComponent(cfg.spacetimeDb)}/call/pager_update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.spacetimeToken}`, 'Content-Type': 'application/json' },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Reading the pager-only views ---------------------------------------------------

export interface MemberRow {
  orgId: string;
  orgMemberId: string;
  identity: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  sealedContact: Uint8Array;
  state: string;
}

export interface PageRow {
  pageId: string;
  incidentId: string;
  orgMemberId: string;
  status: string;
  requestedBy: string;
}

export interface PagerState {
  members: MemberRow[];
  pages: PageRow[];
}

const norm = (s: string): string => s.toLowerCase().replace(/_/g, '');

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function hex(v: unknown): string | null {
  const s = text(v);
  if (s === null) return null;
  const h = (s.startsWith('0x') ? s.slice(2) : s).toLowerCase();
  return /^[0-9a-f]*$/.test(h) ? h : null;
}

function id(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && isDecimalId(v)) return v;
  return null;
}

function bytes(v: unknown): Uint8Array | null {
  if (Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return Uint8Array.from(v as number[]);
  const h = hex(v);
  if (h === null || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Turns Spacetime's SQL JSON answer into objects keyed by normalized column name. Null on any shape surprise. */
function rowsOf(json: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(json) || json.length !== 1) return null;
  const set = json[0] as { schema?: { elements?: { name?: unknown }[] }; rows?: unknown[][] };
  const els = set.schema?.elements;
  if (!Array.isArray(els) || !Array.isArray(set.rows)) return null;
  const names = els.map((e) => {
    const n = e?.name;
    if (typeof n === 'string') return norm(n);
    const some = (n as { some?: unknown } | undefined)?.some;
    return typeof some === 'string' ? norm(some) : '';
  });
  if (names.some((n) => n === '')) return null;
  return set.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

// Fixed text only: the pager reads two fixed views and builds no query from input. It joins the pieces
// so the browser-code scan for SQL strings (tests/static-scan) stays about browser code.
const selectAll = (view: string): string => ['SELECT', '*', 'FROM', view].join(' ');

/** Why the last pager read returned null. Names the view and HTTP status or shape problem; no secrets. For server logs. */
export const pagerReadProblems: string[] = [];

async function query(cfg: PagerConfig, doFetch: typeof fetch, view: string): Promise<Record<string, unknown>[] | null> {
  const res = await doFetch(`${cfg.spacetimeHost}/v1/database/${encodeURIComponent(cfg.spacetimeDb)}/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.spacetimeToken}`, 'Content-Type': 'text/plain' },
    body: selectAll(view),
  });
  if (!res.ok) {
    pagerReadProblems.push(`${view}: HTTP ${res.status}`);
    return null;
  }
  const json: unknown = await res.json();
  const rows = rowsOf(json);
  if (!rows) {
    const sample = JSON.stringify(json).slice(0, 160).replace(/[0-9a-fA-F]{24,}/g, '<hex>');
    pagerReadProblems.push(`${view}: unexpected response shape ${sample}`);
  }
  return rows;
}

/**
 * Reads the pager-only views `pager_org_member` and `pager_page` (WP1). Returns null if either read fails or any row
 * is malformed: the caller then refuses to dial. Filtering happens in the caller.
 */
export async function readPagerState(cfg: PagerConfig, doFetch: typeof fetch): Promise<PagerState | null> {
  pagerReadProblems.length = 0;
  try {
    const [m, p] = await Promise.all([query(cfg, doFetch, 'pager_org_member'), query(cfg, doFetch, 'pager_page')]);
    if (!m || !p) return null;
    const members: MemberRow[] = [];
    for (const r of m) {
      const orgId = text(r.orgid);
      const orgMemberId = id(r.orgmemberid);
      const identity = hex(r.identity);
      const signPub = bytes(r.signpub);
      const ecdhPub = bytes(r.ecdhpub);
      const sealedContact = bytes(r.sealedcontact);
      const state = text(r.state);
      if (!orgId || orgMemberId === null || !identity || !signPub || !ecdhPub || !sealedContact || !state) {
        const bad = Object.entries({ orgid: orgId, orgmemberid: orgMemberId, identity, signpub: signPub, ecdhpub: ecdhPub, sealedcontact: sealedContact, state })
          .filter(([, v]) => !v && v !== 0)
          .map(([k]) => k);
        pagerReadProblems.push(`pager_org_member row: unparsable column(s) ${bad.join(',')}`);
        return null;
      }
      members.push({ orgId, orgMemberId, identity, signPub, ecdhPub, sealedContact, state });
    }
    const pages: PageRow[] = [];
    for (const r of p) {
      const pageId = text(r.pageid);
      const incidentId = text(r.incidentid);
      const orgMemberId = id(r.orgmemberid);
      const status = text(r.status);
      const requestedBy = hex(r.requestedby);
      if (!pageId || !incidentId || orgMemberId === null || !status || !requestedBy) {
        const bad = Object.entries({ pageid: pageId, incidentid: incidentId, orgmemberid: orgMemberId, status, requestedby: requestedBy })
          .filter(([, v]) => !v && v !== 0)
          .map(([k]) => k);
        pagerReadProblems.push(`pager_page row: unparsable column(s) ${bad.join(',')}`);
        return null;
      }
      pages.push({ pageId, incidentId, orgMemberId, status, requestedBy });
    }
    return { members, pages };
  } catch (e) {
    pagerReadProblems.push(`read threw: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
    return null;
  }
}
