import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { projectName, appUrl, email, password } = await req.json();

  if (!projectName || !appUrl) {
    return new Response('Missing required parameters: projectName and appUrl', { status: 400 });
  }

  const api = process.env.SPARROW_API || '';
  if (!api) {
    return new Response('SPARROW_API not configured', { status: 500 });
  }

  const auth = req.headers.get('authorization') || '';

  try {
    const r = await fetch(`${api}/runs/preprocess-webapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {})
      },
      body: JSON.stringify({
        projectName,
        appUrl,
        email,
        password
      }),
      cache: 'no-store',
    });

    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();

    return new Response(t, {
      status: r.status,
      headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('Error calling preprocess-webapp API:', error);
    return new Response('Failed to create web app project', { status: 500 });
  }
}
