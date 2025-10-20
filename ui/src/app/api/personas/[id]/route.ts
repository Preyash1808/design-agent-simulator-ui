// Route handler types compatible with Next 15 (params as Promise)
import type { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getUserPersonasDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '..', 'user_personas'),
    path.resolve(process.cwd(), '..', '..', 'user_personas'),
    path.resolve(process.cwd(), 'user_personas'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }
  const fallback = path.resolve(process.cwd(), 'user_personas');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function getUserPersonaPath(userId: string): string {
  const dir = getUserPersonasDir();
  return path.join(dir, `${userId}.json`);
}

function getUserId(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.substring(7);
  return null;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
  const { id } = await context.params;
  try {
    const r = await fetch(`${api}/personas/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    // Fallback to local store
    return new Response(JSON.stringify({ error: 'backend unreachable', detail: String(err) }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
  const auth = req.headers.get('authorization') || '';
  const { id } = await context.params;
  const body = await req.text();
  try {
    const r = await fetch(`${api}/personas/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body,
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch (err: any) {
    // Fallback local update
    const uid = getUserId(req);
    if (!uid) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    const p = getUserPersonaPath(uid);
    let arr: any[] = [];
    try { if (fs.existsSync(p)) arr = JSON.parse(fs.readFileSync(p, 'utf-8')) || []; } catch {}
    let patch: any = {}; try { patch = JSON.parse(body || '{}'); } catch {}
    const idx = arr.findIndex((x: any) => String(x.id) === String(id));
    if (idx === -1) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    arr[idx] = { ...arr[idx], ...patch, updated_at: new Date().toISOString() };
    fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf-8');
    return new Response(JSON.stringify(arr[idx]), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
  const { id } = await context.params;
  try {
    const auth = req.headers.get('authorization') || '';
    const r = await fetch(`${api}/personas/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...(auth ? { Authorization: auth } : {}) } });
    return new Response(null, { status: r.status });
  } catch (err: any) {
    // Fallback local delete
    const uid = getUserId(req);
    if (!uid) return new Response('unauthorized', { status: 401 });
    const p = getUserPersonaPath(uid);
    let arr: any[] = []; try { if (fs.existsSync(p)) arr = JSON.parse(fs.readFileSync(p, 'utf-8')) || []; } catch {}
    const filtered = arr.filter((x: any) => String(x.id) !== String(id));
    fs.writeFileSync(p, JSON.stringify(filtered, null, 2), 'utf-8');
    return new Response(null, { status: 204 });
  }
}


