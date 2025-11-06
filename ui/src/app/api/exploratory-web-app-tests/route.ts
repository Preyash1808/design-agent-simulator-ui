import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { projectId, taskName, numAgents, maxMinutes, goal, expectedUrl, requiredElements, excludedElements } = await req.json();

  if (!projectId) {
    return new Response('Missing required parameter: projectId', { status: 400 });
  }

  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  if (!api) {
    return new Response(JSON.stringify({ error: 'Backend API not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const auth = req.headers.get('authorization') || '';

  try {
    const r = await fetch(`${api}/runs/exploratory-web-app-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {})
      },
      body: JSON.stringify({
        projectId,
        numAgents: numAgents ?? 6,
        maxMinutes: maxMinutes ?? 25,
        taskName: taskName || undefined,
        goal: goal || undefined,
        expectedUrl: expectedUrl || undefined,
        requiredElements: requiredElements || undefined,
        excludedElements: excludedElements || undefined,
      }),
    });

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();

    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' }
    });
  } catch (err: any) {
    console.error('Error proxying exploratory-web-app-tests request:', err);
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
