// Ensure this route is executed dynamically on the Node runtime
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function POST(req: Request) {
  const body = await req.json();
  const api =
    process.env.SPARROW_API ||
    process.env.NEXT_PUBLIC_SPARROW_API ||
    (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8000' : '');
  if (!api) return new Response(JSON.stringify({ detail: 'Backend API not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  try {
    const r = await fetch(`${api}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ detail: 'Backend unreachable', error: String(err) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}

// Note: Only POST is implemented; Next will return 405 for other methods automatically

