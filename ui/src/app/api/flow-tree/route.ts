import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  if (!api) {
    return new Response(JSON.stringify({ error: 'Backend API not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  try {
    const auth = req.headers.get('authorization') || '';
    const runId = req.nextUrl.searchParams.get('run_id');

    if (!runId) {
      return new Response(JSON.stringify({ error: 'Missing run_id parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const backendUrl = `${api}/api/flow-tree?run_id=${encodeURIComponent(runId)}`;

    const r = await fetch(backendUrl, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (r.status === 401) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-auth-logout': '1'
        }
      });
    }

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const text = await r.text();

    return new Response(text, {
      status: r.status,
      headers: {
        'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8'
      }
    });
  } catch (err: any) {
    console.error('Error proxying flow-tree request:', err);
    return new Response(
      JSON.stringify({
        error: 'Backend unreachable',
        detail: String(err?.message || err)
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}
