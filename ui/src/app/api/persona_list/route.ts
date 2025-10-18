import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function findPersonaPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', 'users', 'users.json'),
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { persona } = body;

    if (!persona || !persona.name) {
      return new Response(JSON.stringify({ error: 'Persona name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const p = findPersonaPath();
    if (!p) {
      return new Response(JSON.stringify({ error: 'Persona storage not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Read existing personas
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw);
    const personas = Array.isArray(data) ? data : [];

    // Generate new ID
    const maxId = personas.length > 0 ? Math.max(...personas.map((p: any) => p.id || 0)) : 0;
    const newId = maxId + 1;

    // Create new persona with minimal required fields
    const newPersona = {
      id: newId,
      name: persona.name,
      bio: persona.bio || persona.traits || '',
      age: 30,
      gender: 'Other',
      ethnicity: 'Not Specified',
      religion: 'Not Specified',
      education_level: 'Bachelor\'s',
      employment_type: 'Full-Time',
      financial_status: 'Medium',
      risk_appetite: 'Medium',
      work_style: 'Hybrid',
      political_orientation: 'Moderate',
      diet_type: 'Balanced',
      love_language: 'Quality Time',
      communication_style: 'Balanced',
      city: 'Unknown',
      country: 'Unknown',
      job_title: 'Professional',
      industry: 'General',
      experience_level: 'Mid',
      ocean: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 }
    };

    // Add to personas array
    personas.push(newPersona);

    // Write back to file
    fs.writeFileSync(p, JSON.stringify(personas, null, 2), 'utf-8');

    return new Response(JSON.stringify({ success: true, persona: newPersona }), {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Failed to create persona' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
