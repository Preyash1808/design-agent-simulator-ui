export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId') || '';
  if (!api || !runId) return new Response('missing api or runId', { status: 400 });
  const auth = (typeof Headers !== 'undefined' ? new Headers(req.headers as any).get('authorization') : null) || '';
  const r = await fetch(`${api}/runs/${encodeURIComponent(runId)}/personas`, {
    headers: { ...(auth ? { Authorization: auth } : {}) },
    cache: 'no-store',
  });
  const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
  const t = await r.text();
  return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
}

