import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { projectId, goal, maxMinutes, taskName, expectedUrl, requiredElements, excludedElements, personas } = await req.json();

  if (!projectId || !goal) {
    return new Response('Missing required parameters: projectId and goal', { status: 400 });
  }

  const api = process.env.SPARROW_API || '';
  if (!api) {
    return new Response('SPARROW_API not configured', { status: 500 });
  }

  const auth = req.headers.get('authorization') || '';

  try {
    const r = await fetch(`${api}/runs/web-app-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {})
      },
      body: JSON.stringify({
        projectId,
        goal,
        maxMinutes: maxMinutes ?? 5,
        taskName,
        expectedUrl,
        requiredElements,
        excludedElements,
        personas: personas || undefined
      }),
    });

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();

    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('Error calling web-app-tests API:', error);
    return new Response('Failed to start web app test', { status: 500 });
  }
}
