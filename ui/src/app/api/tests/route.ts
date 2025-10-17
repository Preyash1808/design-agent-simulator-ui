import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const runDir = String(form.get('runDir') || '');
    const projectId = String(form.get('projectId') || '');
    const goal = String(form.get('goal') || '');
    const maxMinutes = Number(form.get('maxMinutes') || 2);
    const source = form.get('source') as File | null;
    const target = form.get('target') as File | null;
    const personas = String(form.get('personas') || '');
    const exclusiveUsers = String(form.get('exclusiveUsers') || '');
    if (!goal || !source || !target || (!runDir && !projectId)) return new Response('Missing parameters', { status: 400 });
    if ((source as any)?.size === 0 || (target as any)?.size === 0) return new Response('Empty image file(s)', { status: 400 });
    const api = process.env.SPARROW_API || '';
    if (api) {
      const f = new FormData();
      if (runDir) f.set('runDir', runDir);
      if (projectId) f.set('projectId', projectId);
      f.set('goal', goal);
      f.set('maxMinutes', String(maxMinutes ?? 2));
      const sourceBuf = await source.arrayBuffer();
      const targetBuf = await target.arrayBuffer();
      f.set('source', new File([sourceBuf], (source as any)?.name || 'source', { type: (source as any)?.type || 'application/octet-stream' }));
      f.set('target', new File([targetBuf], (target as any)?.name || 'target', { type: (target as any)?.type || 'application/octet-stream' }));
      if (personas) f.set('personas', personas);
      if (exclusiveUsers) f.set('exclusiveUsers', exclusiveUsers);
      const auth = req.headers.get('authorization') || '';
      const r = await fetch(`${api}/runs/tests-by-images`, { method: 'POST', body: f, headers: { ...(auth ? { Authorization: auth } : {}) } });
      const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
    }
    // No fallback: require backend configured
    return new Response('SPARROW_API not configured', { status: 500 });
  }

  const { runDir, projectId, sourceId, targetId, goal, maxMinutes } = await req.json();
  if ((!runDir && !projectId) || !sourceId || !targetId || !goal) return new Response('Missing parameters', { status: 400 });
  const api = process.env.SPARROW_API || '';
  if (api) {
    const auth = req.headers.get('authorization') || '';
    const r = await fetch(`${api}/runs/tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ runDir, projectId, sourceId, targetId, goal, maxMinutes: maxMinutes ?? 2 }),
    });
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    const t = await r.text();
    return new Response(t, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
  }
  // No local fallback
  return new Response('SPARROW_API not configured', { status: 500 });
}
