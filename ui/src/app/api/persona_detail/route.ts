export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Prefer explicit API base if provided; otherwise default to local backend
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || process.env.BACKEND_URL || 'http://localhost:8000';
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
    const headers = { ...(auth ? { Authorization: auth } : {}) } as any;
    try {
      let tried: string[] = [];
      let r: Response | null = null;
      if (format === 'xlsx') {
        // Try direct XLSX route first
        const url1 = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.xlsx`;
        tried.push(url1);
        r = await fetch(url1, { headers, cache: 'no-store' });
        if (!r.ok) {
          // Fallback to CSV route with format=xlsx (older backend style)
          const url2 = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv?format=xlsx`;
          tried.push(url2);
          r = await fetch(url2, { headers, cache: 'no-store' });
        }
      } else {
        const urlCsv = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv`;
        tried.push(urlCsv);
        r = await fetch(urlCsv, { headers, cache: 'no-store' });
      }
      if (!r) return new Response('download failed', { status: 500, headers: { 'x-proxy-tried': tried.join(' ') } });
      const buf = await r.arrayBuffer();
      const ct = r.headers.get('content-type') || (format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8');
      const cd = r.headers.get('content-disposition') || `attachment; filename="users_${runId}_${personaId}.${format}"`;
      return new Response(buf, { status: r.status, headers: { 'Content-Type': ct, 'Content-Disposition': cd, 'Cache-Control': 'no-store', 'x-proxy-tried': tried.join(' ') } });
    } catch (e: any) {
      return new Response('download failed', { status: 500, headers: { 'x-proxy-error': String(e) } });
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
  const api = process.env.SPARROW_API || process.env.NEXT_PUBLIC_SPARROW_API || 'http://localhost:8000';
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId') || '';
  const personaId = searchParams.get('personaId') || '';
  const format = (searchParams.get('format') || '').toLowerCase();
  const tokenParam = searchParams.get('token') || '';
  if (!api || !runId || !personaId) return new Response('missing api or runId/personaId', { status: 400 });
  let auth = (typeof Headers !== 'undefined' ? new Headers(req.headers as any).get('authorization') : null) || '';
  if (!auth && tokenParam) auth = `Bearer ${tokenParam}`;
  const tried: string[] = [];
  let r: Response | null = null;
  if (format === 'xlsx') {
    const url1 = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.xlsx`;
    tried.push(url1);
    r = await fetch(url1, { headers: { ...(auth ? { Authorization: auth } : {}) }, cache: 'no-store' });
    if (!r.ok) {
      const url2 = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv?format=xlsx`;
      tried.push(url2);
      r = await fetch(url2, { headers: { ...(auth ? { Authorization: auth } : {}) }, cache: 'no-store' });
    }
  } else {
    const urlCsv = `${api}/runs/${encodeURIComponent(runId)}/persona/${encodeURIComponent(personaId)}/users.csv`;
    tried.push(urlCsv);
    r = await fetch(urlCsv, { headers: { ...(auth ? { Authorization: auth } : {}) }, cache: 'no-store' });
  }
  if (!r) return new Response('download failed', { status: 500, headers: { 'x-proxy-tried': tried.join(' ') } });
  const buf = await r.arrayBuffer();
  const ct = r.headers.get('content-type') || (format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
  const cd = r.headers.get('content-disposition') || `attachment; filename="users_${runId}_${personaId}.${format === 'xlsx' ? 'xlsx' : 'csv'}"`;
  return new Response(buf, { status: r.status, headers: { 'Content-Type': ct, 'Content-Disposition': cd, 'Cache-Control': 'no-store', 'x-proxy-tried': tried.join(' ') } });
}

