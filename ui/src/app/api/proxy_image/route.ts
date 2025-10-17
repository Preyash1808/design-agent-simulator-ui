import { NextRequest } from 'next/server';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export async function GET(req: NextRequest) {
  try {
    // Default to local backend if env not set, so dev images work out of the box
    const apiBase = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
    const path = req.nextUrl.searchParams.get('path') || '';
    if (!path) {
      return new Response('missing path', { status: 400 });
    }
    const url = /^(https?:)?\/\//i.test(path) ? path : joinUrl(apiBase, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const auth = req.headers.get('authorization') || '';
    const tokenParam = req.nextUrl.searchParams.get('token') || '';
    const headers: Record<string,string> = {};
    if (auth) headers['Authorization'] = auth;
    else if (tokenParam) headers['Authorization'] = `Bearer ${tokenParam}`;
    const r = await fetch(url, { cache: 'no-store', signal: controller.signal, headers });
    clearTimeout(timeout);
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/png';
    return new Response(buf, { status: r.status, headers: { 'Content-Type': ct } });
  } catch (e) {
    return new Response('failed', { status: 502 });
  }
}


