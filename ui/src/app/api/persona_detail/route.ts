export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Prefer explicit API base if provided; otherwise rely on Next rewrites (relative fetch)
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || process.env.BACKEND_URL || '';
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId') || '';
  const personaId = searchParams.get('personaId') || '';
  const format = (searchParams.get('format') || '').toLowerCase();
  const tokenParam = searchParams.get('token') || '';
  if (!runId || !personaId) return new Response('missing runId/personaId', { status: 400 });
  let auth = (typeof Headers !== 'undefined' ? new Headers(req.headers as any).get('authorization') : null) || '';
  if (!auth && tokenParam) auth = `Bearer ${tokenParam}`;

  // If a format is requested via GET (e.g., link click), proxy the file download
  if (format === 'xlsx' || format === 'csv') {
    try {
      const url = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv?format=${encodeURIComponent(format)}`;
      const r = await fetch(url, {
        headers: { ...(auth ? { Authorization: auth } : {}) },
        cache: 'no-store',
      });
      const buf = await r.arrayBuffer();
      const ct = r.headers.get('content-type') || (format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8');
      const cd = r.headers.get('content-disposition') || `attachment; filename="users_${runId}_${personaId}.${format}"`;
      return new Response(buf, { status: r.status, headers: { 'Content-Type': ct, 'Content-Disposition': cd, 'Cache-Control': 'no-store' } });
    } catch {
      return new Response('download failed', { status: 500 });
    }
  }
  const r = await fetch(`${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}`, {
    headers: { ...(auth ? { Authorization: auth } : {}) },
    cache: 'no-store',
  });
  const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
  let bodyText = await r.text();
  try {
    if (ct.includes('application/json')) {
      let obj: any = {};
      try { obj = JSON.parse(bodyText || '{}'); } catch {}
      // Enrich with screen_files if missing, mirroring Overview behavior
      if (!Array.isArray(obj?.screen_files) || obj.screen_files.length === 0) {
        try {
          // Resolve actual run_dir from backend status
          // Use our Next proxy to backend status endpoint if no absolute base provided
          const statusUrl = api
            ? `${api}/status?run_id=${encodeURIComponent(runId)}&attach_signed_urls=0`
            : `/api/status?run_id=${encodeURIComponent(runId)}&attach_signed_urls=0`;
          const rs = await fetch(statusUrl, {
            headers: { ...(auth ? { Authorization: auth } : {}) },
            cache: 'no-store',
          });
          if (rs.ok) {
            const st = await rs.json();
            const it = (Array.isArray(st?.items) ? st.items : []).find((x: any) => String(x?.id) === String(runId));
            const rd = String(it?.run_dir || '');
            let localBase = `/runs-files/${encodeURIComponent(runId)}`; // default
            try {
              const m = rd.match(/\/runs\/(.+)$/);
              if (m && m[1]) localBase = `/runs-files/${m[1]}`;
            } catch {}
            // Load screen_nodes.json from backend (fastapi serves /runs-files)
            const nodesUrl = api ? `${api}${localBase}/preprocess/screen_nodes.json` : `${localBase}/preprocess/screen_nodes.json`;
            const nodesResp = await fetch(nodesUrl, { cache: 'no-store' });
            if (nodesResp.ok) {
              const nodes: Array<{ id: number|string; name?: string; file?: string }> = await nodesResp.json();
              const files = (nodes || []).map(n => ({
                id: Number(n.id),
                name: String(n.name || n.id),
                image: `${localBase}/preprocess/screens/${n.file || ''}`,
              }));
              obj = { ...(obj || {}), screen_files: files };
              // Map numeric screen ids to names in backtracks_by_screen
              if (Array.isArray(obj?.backtracks_by_screen)) {
                obj.backtracks_by_screen = obj.backtracks_by_screen.map((b: any) => {
                  const s = String(b?.screen ?? '');
                  if (/^\d+$/.test(s)) {
                    const id = Number(s);
                    const f = files.find(ff => Number(ff.id) === id);
                    return { ...b, screen: f?.name || s };
                  }
                  return b;
                });
              }
            }
          }
        } catch {}
      }
      bodyText = JSON.stringify(obj);
    }
  } catch {}
  return new Response(bodyText, { status: r.status, headers: { 'Content-Type': ct.includes('application/json') ? ct : 'application/json; charset=utf-8' } });
}

// Proxy CSV download of persona users
export async function POST(req: Request) {
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || '';
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId') || '';
  const personaId = searchParams.get('personaId') || '';
  const format = (searchParams.get('format') || '').toLowerCase();
  const tokenParam = searchParams.get('token') || '';
  if (!api || !runId || !personaId) return new Response('missing api or runId/personaId', { status: 400 });
  let auth = (typeof Headers !== 'undefined' ? new Headers(req.headers as any).get('authorization') : null) || '';
  if (!auth && tokenParam) auth = `Bearer ${tokenParam}`;
  if (!auth && tokenParam) auth = `Bearer ${tokenParam}`;
  const url = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv${format ? `?format=${encodeURIComponent(format)}` : ''}`;
  const r = await fetch(url, {
    headers: { ...(auth ? { Authorization: auth } : {}) },
    cache: 'no-store',
  });
  const buf = await r.arrayBuffer();
  const ct = r.headers.get('content-type') || (format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
  const cd = r.headers.get('content-disposition') || `attachment; filename="users_${runId}_${personaId}.${format === 'xlsx' ? 'xlsx' : 'csv'}"`;
  return new Response(buf, { status: r.status, headers: { 'Content-Type': ct, 'Content-Disposition': cd, 'Cache-Control': 'no-store' } });
}

