import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');

  if (!runId) {
    return new Response('Missing runId parameter', { status: 400 });
  }

  const api = process.env.SPARROW_API || '';
  if (!api) {
    return new Response('SPARROW_API not configured', { status: 500 });
  }

  const auth = req.headers.get('authorization') || '';

  try {
    const r = await fetch(`${api}/runs-files/${runId}/journey.json`, {
      method: 'GET',
      headers: {
        ...(auth ? { Authorization: auth } : {})
      },
    });

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();

    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('Error fetching journey data:', error);
    return new Response('Failed to fetch journey data', { status: 500 });
  }
}
