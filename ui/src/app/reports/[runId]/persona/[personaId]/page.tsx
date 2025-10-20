"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export default function PersonaFullPage() {
  const p = useParams() as { runId: string; personaId: string };
  const runId = String(p?.runId || '');
  const personaId = String(p?.personaId || '');
  const [data, setData] = useState<any | null>(null);
  const [personasMeta, setPersonasMeta] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBacktrack, setSelectedBacktrack] = useState<{ name: string; count: number } | null>(null);

  const personaName = useMemo(() => {
    const byId = personasMeta.find((p:any)=> String(p.persona_id) === String(personaId));
    return byId?.persona_name || `Persona #${personaId}`;
  }, [personasMeta, personaId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const [r1, r2] = await Promise.all([
          fetch(`/api/persona_detail?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' }),
          fetch(`/api/personas?runId=${encodeURIComponent(runId)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' }),
        ]);
        if (!r1.ok) throw new Error(`Failed to load detail (${r1.status})`);
        const j1 = await r1.json();
        const j2 = r2.ok ? await r2.json() : { personas: [] };
        if (mounted) { setData(j1); setPersonasMeta(Array.isArray(j2?.personas) ? j2.personas : []); }
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [runId, personaId]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{personaName}</h2>
          {/* Removed run line per request */}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-sm" href={`/reports?run=${encodeURIComponent(runId)}&tab=persona&persona=${encodeURIComponent(personaId)}`}>Back to Reports</Link>
          <a className="btn btn-sm" href={`/api/persona_detail?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}&format=xlsx`}>Download Excel</a>
        </div>
      </div>

      {loading && <div className="muted">Loading…</div>}
      {error && <div className="error">{error}</div>}
      {(!loading && !data) && <div className="muted">No data</div>}

      {!!data && (
        <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
          <div className="tile">
            <h4>Emotion Mix</h4>
            <ReactECharts style={{ height: 260 }} option={(function(){
              const emo = data?.tea?.emotions || {};
              const labels = Object.keys(emo);
              const vals = labels.map((k)=>Number(emo[k]||0));
              return { backgroundColor: 'transparent', grid: { left: 60, right: 20, top: 40, bottom: 40 }, xAxis: { type:'value', axisLabel:{ color:'#cbd5e1' } }, yAxis: { type:'category', data: labels, axisLabel:{ color:'#cbd5e1' } }, series: [{ type:'bar', data: vals, itemStyle:{ color:'#22d3ee' } }] } as any;
            })()} />
          </div>

          <div className="tile">
            <h4>Sentiment Drift</h4>
            <ReactECharts style={{ height: 240 }} option={(function(){
              const s0 = Number(data?.tea?.sentiment_start ?? 0);
              const s1 = Number(data?.tea?.sentiment_end ?? 0);
              return { backgroundColor:'transparent', xAxis:{ type:'category', data:['Start','End'], axisLabel:{ color:'#cbd5e1' } }, yAxis:{ type:'value', axisLabel:{ color:'#cbd5e1' } }, series:[{ type:'line', data:[s0, s1], areaStyle:{ color:'rgba(34,211,238,0.15)' }, lineStyle:{ color:'#22d3ee' }, itemStyle:{ color:'#22d3ee' } }] } as any;
            })()} />
          </div>

          <div className="tile">
            <h4>Top Paths</h4>
            <ReactECharts style={{ height: 320 }} option={(function(){
              const items: Array<{path:string; count?:number; sharePct?:number}> = Array.isArray(data?.paths) ? data.paths : [];
              if (!items.length) return { graphic: [{ type:'text', left:'center', top:'middle', style: { text:'No path data', fill:'#94a3b8', fontSize:14 } }] } as any;
              const edges: any[] = []; const nodesSet = new Set<string>();
              let maxValue = 0;
              for (const it of items.slice(0,5)) {
                const parts = String(it.path||'').split('>').map(s=>s.trim()).filter(Boolean);
                const value = Number(it.sharePct||it.count||1);
                maxValue = Math.max(maxValue, value);
                for (let i=0;i<parts.length;i++){
                  nodesSet.add(parts[i]);
                  if (i<parts.length-1) edges.push({
                    source: parts[i], target: parts[i+1], value,
                    lineStyle:{ color:'gradient', curveness:0.55, opacity: 0.35 + 0.65 * (value/Math.max(1,maxValue)) },
                  });
                }
              }
              function categoryColor(name:string):string{
                const n = String(name||'').toLowerCase();
                if (/(splash|welcome|home)/.test(n)) return '#5B6DAA';
                if (/(auth|login|sign|verify)/.test(n)) return '#7c3aed';
                if (/(basket|cart|checkout|order|payment|complete order)/.test(n)) return '#ec4899';
                if (/(complete|success|done|confirmation)/.test(n)) return '#10b981';
                return '#94A3B8';
              }
              const nodes = Array.from(nodesSet).map(n=>({ name:n, itemStyle:{ color: categoryColor(n), borderRadius: 6 } }));
              return {
                tooltip:{ trigger:'item', formatter:(p:any)=> p.dataType==='edge' ? `${p.data?.source} → ${p.data?.target}<br/>${p.data?.value}% of users` : p.name },
                series:[{ type:'sankey', data:nodes, links:edges, left:8,right:8,top:6,bottom:6, nodeGap:18, nodeWidth:14, draggable:false,
                  lineStyle:{ color:'gradient', curveness:0.55, shadowBlur:8, shadowColor:'rgba(0,0,0,0.35)', opacity:0.95 },
                  edgeLabel:{ show:true, color:'#e5e7eb', fontSize:10, formatter:(p:any)=>{ const v=Number(p.data?.value||0); return v>=8? `${Math.round(v)}%`:''; } },
                  label:{ color:'#cbd5e1', overflow:'break' as any, width:110, lineHeight:14, fontSize:11 },
                  levels: [{ depth:0, label:{ show:true, position:'left', align:'left', distance:4, color:'#cbd5e1' } }]
                }] } as any;
            })()} />
            {Array.isArray(data?.paths) && data.paths.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {data.paths.slice(0,5).map((p:any, i:number)=> (
                  <div key={i} className="muted" style={{ display:'flex', justifyContent:'space-between', gap: 8, fontSize: 12, padding: '6px 8px', background:'rgba(51,65,85,0.2)', border:'1px solid rgba(71,85,105,0.2)', borderRadius:4, marginTop: 6 }}>
                    <div style={{ flex:1, color:'#cbd5e1' }}>{p.path}</div>
                    <div style={{ color:'#e2e8f0' }}>{p.sharePct}% ({p.count})</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="tile">
            <h4>Drop‑off Reasons</h4>
            <ReactECharts style={{ height: 260 }} option={(function(){
              const items: Array<{reason:string; count:number}> = data?.exits || [];
              const labels = items.map(i=>i.reason); const vals = items.map(i=>Number(i.count||0));
              if (!items.length || (items.length===1 && items[0].reason==='No drop-offs recorded')) return { graphic:[{ type:'text', left:'center', top:'middle', style:{ text:'No drop-offs recorded', fill:'#94a3b8', fontSize:14 } }] } as any;
              return { backgroundColor:'transparent', grid:{ left:60,right:20,top:40,bottom:50 }, xAxis:{ type:'value', axisLabel:{ color:'#cbd5e1' } }, yAxis:{ type:'category', data: labels, axisLabel:{ color:'#cbd5e1' } }, series:[{ type:'bar', data: vals, itemStyle:{ color:'#94a3b8' } }] } as any;
            })()} />
          </div>

          <div className="tile">
            <h4>Backtracks by Screen</h4>
            <ReactECharts
              style={{ height: 260 }}
              option={(function(){
              const items: Array<{screen:string; screen_id?: string|number|null; count:number}> = data?.backtracks_by_screen || [];
              const labels = items.map(i=>i.screen); const vals = items.map(i=>Number(i.count||0));
              return { backgroundColor:'transparent', grid:{ left:60,right:20,top:40,bottom:50 }, xAxis:{ type:'value', axisLabel:{ color:'#cbd5e1' } }, yAxis:{ type:'category', data: labels, axisLabel:{ color:'#cbd5e1' } }, series:[{ type:'bar', data: vals, itemStyle:{ color:'#f59e0b' } }], tooltip: { trigger: 'axis' as any } } as any;
            })()}
              onEvents={{
                click: (params: any) => {
                  try {
                    const name = String(params.name || '');
                    const idx = (data?.backtracks_by_screen || []).findIndex((x:any)=> String(x.screen)===name);
                    const count = idx>=0 ? Number((data?.backtracks_by_screen || [])[idx].count||0) : 0;
                    setSelectedBacktrack({ name, count });
                  } catch {}
                }
              }}
            />

            {/* Clickable screen names (alternative to bar click) */}
            <div style={{ marginTop: 8, display:'flex', flexWrap:'wrap', gap: 8 }}>
              {(data?.backtracks_by_screen || []).map((b:any)=> (
                <button key={b.screen}
                  onClick={()=> setSelectedBacktrack({ name: String(b.screen), count: Number(b.count||0) })}
                  className="btn-ghost btn-sm"
                  style={{ border:'1px solid var(--border)', borderRadius: 999, padding:'4px 10px', fontSize:12 }}
                >{String(b.screen)}</button>
              ))}
            </div>

            {/* Preview selected screen */}
            {selectedBacktrack && (
              <div style={{ marginTop: 12, display:'flex', alignItems:'flex-start', gap: 12 }}>
                <button className="btn-ghost btn-sm" onClick={()=>setSelectedBacktrack(null)}>Back</button>
                <div style={{ border:'1px solid var(--border)', borderRadius: 10, padding: 10, background:'rgba(30,41,59,0.5)' }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{selectedBacktrack.name}</div>
                  <div className="muted" style={{ marginBottom: 8 }}>Backtracks: <b>{selectedBacktrack.count}</b></div>
                  {(function(){
                    const files = Array.isArray(data?.screen_files) ? data.screen_files : [];
                    const byName = files.find((f:any)=> String(f.name) === String(selectedBacktrack.name));
                    const img = byName?.image;
                    return img ? <img alt={selectedBacktrack.name} src={img} style={{ width: 240, height: 'auto', display:'block', borderRadius: 6 }} /> : <div className="muted">No image</div>;
                  })()}
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
