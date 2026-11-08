import { loadPagerConfig } from '@/lib/pager/config';
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
  const result = await handlePage(raw, { cfg: loadPagerConfig(), fetch, now: Date.now, seen });
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
