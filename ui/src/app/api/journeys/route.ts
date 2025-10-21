import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || process.env.BACKEND_URL || '';
    const runId = req.nextUrl.searchParams.get('runId') || '';
    const personaId = req.nextUrl.searchParams.get('personaId') || '';
    const token = req.nextUrl.searchParams.get('token') || '';
    if (!api || !runId || !personaId) {
      return new Response(JSON.stringify({ journeys: [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    const url = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/journeys`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ journeys: [], error: 'backend unreachable', detail: String(err) }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}



