import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  if (!api) {
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const auth = req.headers.get('authorization') || '';
    const qs = req.nextUrl.search ? req.nextUrl.search : '';
    const controller = new AbortController();
    // Abort sooner than Vercel's function limit so the UI never hangs
    timeoutId = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${api}/status${qs}`, { headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, cache: 'no-store', signal: controller.signal });
    if (r.status === 401) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'x-auth-logout': '1', 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    // Soft-fail for the UI: return empty items with 200 so pages don't look "stuck"
    return new Response(JSON.stringify({ items: [], error: 'backend unreachable', detail: String(err) }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-backend-timeout': '1' } });
  } finally {
    if (timeoutId) {
      try { clearTimeout(timeoutId); } catch {}
    }
  }
}



