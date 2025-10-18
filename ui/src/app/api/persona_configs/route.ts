import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function findConfigPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', '..', 'config', 'persona_configs.json'),
    path.resolve(process.cwd(), 'config', 'persona_configs.json'),
    path.resolve(process.cwd(), '..', 'config', 'persona_configs.json'),
  ];
  for (const p of candidates) {
    const dir = path.dirname(p);
    try {
      if (fs.existsSync(dir)) return p;
    } catch {}
  }
  return null;
}

export async function GET(_req: NextRequest) {
  try {
    const p = findConfigPath();
    if (p && fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  } catch {}

  // Return default empty configuration
  return new Response(JSON.stringify({ configs: [], exclusiveUsers: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { configs, exclusiveUsers } = body;

    if (!Array.isArray(configs)) {
      return new Response(JSON.stringify({ error: 'configs must be an array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const p = findConfigPath();
    if (!p) {
      return new Response(JSON.stringify({ error: 'Config storage path not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Ensure directory exists
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Prepare data to save
    const data = {
      configs: configs.map((c: any) => ({
        personaId: String(c.personaId || ''),
        traits: String(c.traits || ''),
        users: String(c.users || '')
      })),
      exclusiveUsers: !!exclusiveUsers,
      lastUpdated: new Date().toISOString()
    };

    // Write to file
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Failed to save persona configurations' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
