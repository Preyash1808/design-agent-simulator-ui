import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  const runId = req.nextUrl.searchParams.get('runId') || '';
  const section = req.nextUrl.searchParams.get('section') || '';
  const personaId = req.nextUrl.searchParams.get('personaId') || '';
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!api || !runId) {
    return new Response('missing api or runId', { status: 400 });
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    let auth = req.headers.get('authorization') || '';
    if (!auth && token) auth = `Bearer ${token}`;
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 15000);
    const qs = new URLSearchParams();
    if (section) qs.set('section', section);
    if (personaId) qs.set('personaId', personaId);
    const url = `${api}/runs/${encodeURIComponent(runId)}/report.pdf${qs.toString() ? `?${qs.toString()}` : ''}`;
    const r = await fetch(url, {
      headers: { ...(auth ? { Authorization: auth } : {}) },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (r.status === 401) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'x-auth-logout': '1', 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'application/pdf';
    const cd = r.headers.get('content-disposition') || `attachment; filename="report_${runId}.pdf"`;
    const len = r.headers.get('content-length') || String(buf.byteLength);
    return new Response(buf, { status: r.status, headers: { 'Content-Type': ct, 'Content-Disposition': cd, 'Content-Length': len, 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return new Response('backend unreachable', { status: 502 });
  } finally {
    if (timeoutId) {
      try { clearTimeout(timeoutId); } catch {}
    }
  }
}


