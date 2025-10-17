import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || 'http://localhost:8000';
  const auth = req.headers.get('authorization') || '';
  const r = await fetch(`${api}/me`, {
    method: 'GET',
    headers: { 'Authorization': auth },
  });
  const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
  const t = await r.text();
  return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
}

