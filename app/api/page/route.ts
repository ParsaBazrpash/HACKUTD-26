import { loadPagerConfig, pagerConfigProblems } from '@/lib/pager/config';
import { handlePage, newSeenPages } from '@/lib/pager/page';
import { MAX_PAGE_BODY_BYTES } from '@/lib/protocol/org';

// Node.js is the default runtime here. Cache Components rejects the `runtime` segment export, so none is set.
const seen = newSeenPages();

/** POST /api/page: the commander's signed page request. Responds with counts only, never numbers. */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PAGE_BODY_BYTES) {
    return Response.json({ ok: false, error: 'bad_body' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  const raw = await request.text();
  const cfg = loadPagerConfig();
  const result = await handlePage(raw, { cfg, fetch, now: Date.now, seen });
  if (!result.body.ok || result.detail) {
    // Vercel function log: the check that refused, and for a bad config the setting names (never values).
    console.warn(
      '[page]',
      JSON.stringify({
        status: result.status,
        error: result.body.ok ? undefined : result.body.error,
        detail: result.detail,
        configProblems: cfg ? undefined : pagerConfigProblems(),
      }),
    );
  }
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
