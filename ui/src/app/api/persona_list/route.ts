import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function findPersonaPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', '..', 'users', 'users.json'),
    path.resolve(process.cwd(), 'users', 'users.json'),
    '/Users/ankita/Documents/workspace/design-agent-simulator/users/users.json',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

export async function GET(_req: NextRequest) {
  // Prefer reading from filesystem so we ship one copy across environments
  try {
    const p = findPersonaPath();
    if (p) {
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      return new Response(JSON.stringify({ personas: Array.isArray(data) ? data : [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  } catch {}
  // If not found, return empty list (UI can still accept typed persona IDs)
  return new Response(JSON.stringify({ personas: [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
