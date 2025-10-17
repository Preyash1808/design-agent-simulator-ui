// Ensure this route is executed dynamically on the Node runtime
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function POST(req: Request) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ detail: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const email = body?.email;
    const password = body?.password;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return new Response(JSON.stringify({ detail: 'email and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const api =
      process.env.SPARROW_API ||
      process.env.NEXT_PUBLIC_SPARROW_API ||
      (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8000' : '');
    if (!api) return new Response(JSON.stringify({ detail: 'Backend API not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    const r = await fetch(`${api}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const t = await r.text();
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    console.error('Auth login route error:', err);
    return new Response(JSON.stringify({ detail: 'UI auth route error', error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Note: Only POST is implemented; Next will return 405 for other methods automatically

