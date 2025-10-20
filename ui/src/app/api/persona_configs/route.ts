export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

// Deprecated: kept to avoid breaking clients. Returns empty config and 410 Gone on POST.
export async function GET() {
  return new Response(JSON.stringify({ configs: [], exclusiveUsers: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function POST() {
  return new Response(JSON.stringify({ error: 'persona_configs is deprecated' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
