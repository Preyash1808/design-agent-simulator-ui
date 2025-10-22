import { NextRequest } from 'next/server';
import path from 'path';

export async function POST(req: NextRequest) {
  const { page = '', figmaUrl, outDir, projectName } = await req.json();
  if (!figmaUrl) return new Response('Missing figmaUrl', { status: 400 });
  const api = process.env.SPARROW_API || '';
  if (api) {
    // Use a timeout so the UI doesn't hang if backend is slow/unreachable
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const auth = req.headers.get('authorization') || undefined;
    try {
      const r = await fetch(`${api}/runs/preprocess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({ page, figmaUrl, outDir, projectName, verbose: true }),
        signal: controller.signal,
        cache: 'no-store',
      });
      const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
    } catch (err) {
      // Return a quick failure so the client stops loading
      return new Response(JSON.stringify({ error: 'preprocess backend timeout' }), { status: 504 });
    } finally {
      clearTimeout(timeout);
    }
  }
  // No fallback: require backend configured even in development
  return new Response(JSON.stringify({ error: 'SPARROW_API not configured' }), { status: 500 });
}
