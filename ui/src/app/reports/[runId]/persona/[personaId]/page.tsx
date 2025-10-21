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
  const [emotionSeries, setEmotionSeries] = useState<Array<{ name: string; points: Array<{ step: number; state: string; sentiment: number }> }>>([]);
  const [emotionStates, setEmotionStates] = useState<string[]>([]);
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
        const [r1, r2, r3] = await Promise.all([
          fetch(`/api/persona_detail?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' }),
          fetch(`/api/personas?runId=${encodeURIComponent(runId)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' }),
          fetch(`/api/persona_emotions?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' }),
        ]);
        if (!r1.ok) throw new Error(`Failed to load detail (${r1.status})`);
        const j1 = await r1.json();
        const j2 = r2.ok ? await r2.json() : { personas: [] };
        let seriesOut: Array<{ name: string; points: Array<{ step: number; state: string; sentiment: number }> }> = [];
        let stateSet = new Set<string>();
        try {
          if (r3.ok) {
            const raw = await r3.json();
            const journeys = Array.isArray(raw?.emotion_journeys) ? raw.emotion_journeys : [];
            for (const j of journeys) {
              const uid = String(j?.userId || j?.user_id || 'user');
              const ptsRaw: any[] = Array.isArray(j?.emotions) ? j.emotions : [];
              const pts: Array<{ step: number; state: string; sentiment: number }> = [];
              for (const p of ptsRaw) {
                const step = Number(p?.step ?? 0);
                const stateArr = Array.isArray(p?.emotional_state) ? p.emotional_state : [];
                const primaryState = String((stateArr[0] ?? p?.emotion ?? '').toString().toLowerCase());
                const sentiment = Number(p?.sentiment_value ?? 0);
                if (step > 0 && primaryState) {
                  pts.push({ step, state: primaryState, sentiment });
                  stateSet.add(primaryState);
                }
              }
              if (pts.length) seriesOut.push({ name: uid, points: pts });
            }
          }
        } catch {}
        if (mounted) { setData(j1); setPersonasMeta(Array.isArray(j2?.personas) ? j2.personas : []); }
        if (mounted) {
          setEmotionSeries(seriesOut);
          setEmotionStates(Array.from(stateSet));
        }
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
            <h4>Sentiment Drift</h4>
            <ReactECharts
              style={{ height: 360 }}
              option={(function(){
                // Compose y-axis from known states + observed states, preserving stable ordering
                const DEFAULT_STATES = ['rage','anger','frustration','sadness','disgust','fear','surprise','neutral','calm','content','joy','excitement','delight'];
                const emotions = Array.from(new Set([ ...DEFAULT_STATES, ...emotionStates ]));
                const emotionToIndex = new Map<string, number>(emotions.map((e, i)=>[e, i]));
                // Build multi-series: one per user
                const maxStep = Math.max(10, ...emotionSeries.flatMap(s => s.points.map(p => p.step)));
                const series = emotionSeries.map((s, si) => ({
                  name: `User ${si + 1}`,
                  type: 'line',
                  smooth: 0.25,
                  showSymbol: true,
                  symbol: 'circle',
                  symbolSize: 5,
                  lineStyle: { width: 2 },
                  data: s.points
                    .map(p => [ p.step, emotionToIndex.get(p.state) ?? emotions.indexOf(p.state), p.sentiment ])
                    .filter(d => typeof d[0] === 'number' && typeof d[1] === 'number' && d[1] >= 0),
                }));
                if (!series.length) {
                  return { graphic: [{ type:'text', left:'center', top:'middle', style:{ text:'No emotion timeline available', fill:'#94a3b8', fontSize: 14 } }] } as any;
                }
                return {
                  backgroundColor: 'transparent',
                  grid: { left: 70, right: 20, top: 30, bottom: 50, containLabel: true },
                  tooltip: {
                    trigger: 'item',
                    formatter: (p: any) => {
                      const step = p?.data?.[0];
                      const idx = p?.data?.[1];
                      const sentiment = p?.data?.[2];
                      const emo = emotions[idx] || '';
                      return `${p.seriesName}<br/>Step ${step}: ${emo}<br/>Sentiment: ${typeof sentiment==='number' ? sentiment.toFixed(2) : '-'}`;
                    },
                    enterable: false,
                    showDelay: 0,
                    hideDelay: 0,
                    transitionDuration: 0.05,
                  },
                  xAxis: {
                    type: 'value',
                    min: 1,
                    max: maxStep,
                    axisLabel: { color: '#1f2937', fontWeight: 700, margin: 10, formatter: (v: any) => String(Math.round(v)) },
                    axisTick: { show: true, length: 6, lineStyle: { color: '#1f2937' } },
                    minorTick: { show: true, splitNumber: 5, length: 3, lineStyle: { color: 'rgba(17,24,39,0.45)' } },
                    axisLine: { lineStyle: { color: '#334155', width: 1.2 } },
                    splitLine: { show: true, lineStyle: { color: '#cbd5e1', type: 'dashed', width: 1 } },
                    name: 'Step', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: '#64748b', fontWeight: 600 },
                  },
                  yAxis: {
                    type: 'category',
                    data: emotions,
                    axisLabel: { color: '#1f2937', fontWeight: 700, margin: 12 },
                    axisTick: { show: true, alignWithLabel: true, length: 6, lineStyle: { color: '#1f2937' } },
                    axisLine: { lineStyle: { color: '#334155', width: 1.2 } },
                    splitLine: { show: true, lineStyle: { color: '#e5e7eb', type: 'dotted' } },
                    name: 'Emotional State', nameLocation: 'left', nameRotate: 90, nameGap: 36, nameTextStyle: { color: '#64748b', fontWeight: 600 },
                  },
                  legend: {
                    top: 6,
                    right: 10,
                    orient: 'horizontal',
                    type: 'plain',
                    icon: 'roundRect',
                    itemWidth: 18,
                    itemHeight: 8,
                    itemGap: 12,
                    padding: [6, 10],
                    backgroundColor: 'rgba(148,163,184,0.12)',
                    borderColor: 'rgba(148,163,184,0.35)',
                    borderRadius: 8,
                    textStyle: { color: '#334155', fontWeight: 700, fontSize: 12 },
                  },
                  dataZoom: [
                    { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift' },
                    { type: 'slider', xAxisIndex: 0, height: 18, bottom: 6, start: 0, end: 30 }
                  ],
                  series,
                } as any;
              })()}
            />
          </div>

          

        </div>
      )}
    </div>
  );
}
