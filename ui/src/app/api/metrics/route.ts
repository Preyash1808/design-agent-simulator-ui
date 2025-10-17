import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  const runId = req.nextUrl.searchParams.get('run_id') || '';
  if (!api || !runId) {
    return new Response(JSON.stringify({ error: 'missing' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const auth = req.headers.get('authorization') || '';
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(`${api}/runs/${encodeURIComponent(runId)}/metrics`, {
      headers: { 'Accept': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      cache: 'no-store',
      signal: controller.signal,
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'timeout', items: [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-backend-timeout': '1' } });
  } finally {
    try { if (timeoutId) clearTimeout(timeoutId); } catch {}
  }
}


