export async function POST() {
  const api =
    process.env.SPARROW_API ||
    process.env.NEXT_PUBLIC_SPARROW_API ||
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:8000' : '');
  if (!api) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  try {
    const r = await fetch(`${api}/logout`, { method: 'POST' });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
}


