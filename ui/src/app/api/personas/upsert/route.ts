import { NextRequest } from 'next/server';
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

export async function POST(req: NextRequest) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
  const auth = req.headers.get('authorization') || '';
  const body = await req.text();
  try {
    const r = await fetch(`${api}/personas/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body,
      cache: 'no-store',
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  } catch {}

  // Fallback to local file store: upsert by name (case-insensitive)
  const uid = getUserId(req);
  if (!uid) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  let payload: any = {}; try { payload = JSON.parse(body || '{}'); } catch { payload = {}; }
  const name = String(payload?.name || '').trim();
  const traits = String(payload?.traits || '').trim();
  if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  const p = getUserPersonaPath(uid);
  let arr: any[] = []; try { if (fs.existsSync(p)) arr = JSON.parse(fs.readFileSync(p, 'utf-8')) || []; } catch {}

  const matchIdx = arr.findIndex((x: any) => String(x.name || '').toLowerCase() === name.toLowerCase());
  const nowIso = new Date().toISOString();
  if (matchIdx >= 0) {
    arr[matchIdx] = { ...arr[matchIdx], name, traits, updated_at: nowIso };
    fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf-8');
    return new Response(JSON.stringify(arr[matchIdx]), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const maxId = arr.length ? Math.max(...arr.map((x: any) => x.id || 0)) : 0;
  const newPersona = { id: maxId + 1, name, traits, created_at: nowIso, updated_at: nowIso };
  arr.push(newPersona);
  fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf-8');
  return new Response(JSON.stringify(newPersona), { status: 201, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}


