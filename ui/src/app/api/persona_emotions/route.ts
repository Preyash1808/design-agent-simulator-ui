import type { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  const runId = req.nextUrl.searchParams.get('runId') || '';
  const personaId = req.nextUrl.searchParams.get('personaId') || '';
  if (!api || !runId || !personaId) {
    return new Response(JSON.stringify({ error: 'missing params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  try {
    const auth = req.headers.get('authorization') || '';
    const url = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/emotions`;
    const r = await fetch(url, {
      headers: { ...(auth ? { Authorization: auth } : {}) },
      cache: 'no-store',
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'backend unreachable', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}


