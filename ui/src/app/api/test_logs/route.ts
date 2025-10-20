import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  if (!api) {
    return new Response('API not configured', { status: 500 });
  }

  const auth = req.headers.get('authorization') || '';
  const projectId = req.nextUrl.searchParams.get('project_id') || '';
  const runId = req.nextUrl.searchParams.get('run_id') || '';

  if (!projectId || !runId) {
    return new Response('Missing project_id or run_id', { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout for large ZIPs

    const url = `${api}/runs/test-logs?project_id=${encodeURIComponent(projectId)}&run_id=${encodeURIComponent(runId)}`;
    const r = await fetch(url, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (r.status === 401) {
      return new Response('Unauthorized', { 
        status: 401,
        headers: { 'x-auth-logout': '1' }
      });
    }

    if (!r.ok) {
      const text = await r.text();
      return new Response(text || 'Failed to download logs', { status: r.status });
    }

    const blob = await r.blob();
    const contentDisposition = r.headers.get('Content-Disposition') || `attachment; filename="${runId}.zip"`;

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition,
      },
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return new Response('Request timeout', { status: 504 });
    }
    return new Response('Failed to download logs', { status: 500 });
  }
}


