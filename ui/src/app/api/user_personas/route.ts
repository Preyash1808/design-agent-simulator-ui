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
      // Try to create if doesn't exist
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }
  // Fallback: create in current directory
  const fallback = path.resolve(process.cwd(), 'user_personas');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function getUserPersonaPath(userId: string): string {
  const dir = getUserPersonasDir();
  return path.join(dir, `${userId}.json`);
}

function getUserIdFromRequest(req: NextRequest): string | null {
  // Try to get user ID from Authorization header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // For now, use token as user ID (in production, decode JWT)
    return token;
  }

  // Fallback: try to get from cookie or query param
  const cookies = req.cookies;
  const userIdCookie = cookies.get('sparrow_user_id');
  if (userIdCookie) {
    return userIdCookie.value;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const filePath = getUserPersonaPath(userId);

    // If file doesn't exist, return empty array
    if (!fs.existsSync(filePath)) {
      return new Response(JSON.stringify({ personas: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return new Response(JSON.stringify({ personas: Array.isArray(data) ? data : [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Failed to fetch personas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const body = await req.json();
    const { persona } = body;

    if (!persona || !persona.name) {
      return new Response(JSON.stringify({ error: 'Persona name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const filePath = getUserPersonaPath(userId);

    // Read existing personas or start with empty array
    let personas: any[] = [];
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      personas = Array.isArray(data) ? data : [];
    }

    // Generate new ID
    const maxId = personas.length > 0 ? Math.max(...personas.map((p: any) => p.id || 0)) : 0;
    const newId = maxId + 1;

    // Create new persona with minimal required fields
    const newPersona = {
      id: newId,
      name: persona.name,
      bio: persona.bio || persona.traits || '',
      traits: persona.traits || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Add to personas array
    personas.push(newPersona);

    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(personas, null, 2), 'utf-8');

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

export async function PUT(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const body = await req.json();
    const { personaId, persona } = body;

    if (!personaId) {
      return new Response(JSON.stringify({ error: 'Persona ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const filePath = getUserPersonaPath(userId);

    if (!fs.existsSync(filePath)) {
      return new Response(JSON.stringify({ error: 'No personas found for user' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    let personas = Array.isArray(data) ? data : [];

    // Find and update persona
    const index = personas.findIndex((p: any) => p.id === personaId);
    if (index === -1) {
      return new Response(JSON.stringify({ error: 'Persona not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    personas[index] = {
      ...personas[index],
      ...persona,
      id: personaId, // Preserve original ID
      updatedAt: new Date().toISOString()
    };

    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(personas, null, 2), 'utf-8');

    return new Response(JSON.stringify({ success: true, persona: personas[index] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Failed to update persona' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const { searchParams } = new URL(req.url);
    const personaId = searchParams.get('id');

    if (!personaId) {
      return new Response(JSON.stringify({ error: 'Persona ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const filePath = getUserPersonaPath(userId);

    if (!fs.existsSync(filePath)) {
      return new Response(JSON.stringify({ error: 'No personas found for user' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    let personas = Array.isArray(data) ? data : [];

    // Filter out the persona to delete
    const filtered = personas.filter((p: any) => p.id !== Number(personaId));

    if (filtered.length === personas.length) {
      return new Response(JSON.stringify({ error: 'Persona not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf-8');

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Failed to delete persona' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
