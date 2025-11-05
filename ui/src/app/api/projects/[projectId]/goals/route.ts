import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  if (!api) {
    return new Response(
      JSON.stringify({ goals: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    const auth = req.headers.get('authorization') || '';
    const projectId = params.projectId;

    const url = `${api}/projects/${encodeURIComponent(projectId)}/goals`;
    const r = await fetch(url, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });

    if (r.status === 401) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-auth-logout': '1' } }
      );
    }

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();

    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' }
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'backend unreachable', detail: String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
