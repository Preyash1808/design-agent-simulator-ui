"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const TeaThoughtTimeline = dynamic(() => import('../../components/TeaThoughtTimeline'), { ssr: false });
// Professional muted palette (masculine/corporate): steels, indigos, teals, slate; amber accent
const CHART_PALETTE = ['#5B6DAA', '#4B6B88', '#2F6F7E', '#64748B', '#1E3A8A', '#B45309', '#94A3B8', '#475569'];
function gradientColor(c1: string, c2: string) {
  if (typeof window !== 'undefined' && (window as any).echarts && (window as any).echarts.graphic) {
    const g = (window as any).echarts.graphic;
    return new g.LinearGradient(0, 0, 1, 0, [
      { offset: 0, color: c1 },
      { offset: 1, color: c2 },
    ]);
  }
  return c1;
}
import FancySelect from '../../components/FancySelect';
import Link from 'next/link';
import { IconQuestionCircle, IconActivity, IconDownload, IconLayers, IconX } from '../../components/icons';
import FlowSankey from '../../components/flow/FlowSankey';
import PathShareTrend from '../../components/flow/PathShareTrend';
import PathRankList from '../../components/flow/PathRankList';
import EmotionMix from '../../components/EmotionMix';

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: active ? '#1E293B' : 'transparent',
        color: active ? '#FFFFFF' : '#64748B',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        transition: 'none'
      }}
    >
      {label}
    </button>
  );
}

type Project = { id: string, name: string };
type Run = { id: string, project_id: string, started_at?: string };
type RunMetrics = {
  run_metrics?: any;
  screen_metrics?: any[];
  friction_points?: any[];
  run_persona?: any;
  run_feedback?: any[];
  llm_run_insights?: any;
};

function ActivityListCompact() {
  const [items, setItems] = React.useState<any[]>([]);
  // Start in loading=true to avoid SSR/CSR hydration mismatch on first paint
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status?attach_signed_urls=0', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        if (mounted) setItems((data.items || []).filter((x:any)=>String(x.type).toLowerCase()==='run').slice(0, 8));
      } catch {
        if (mounted) setItems([]);
      } finally { if (mounted) setLoading(false); }
    }
    load();
    return () => { mounted = false; };
  }, []);
  if (loading) return <div className="muted">Loading…</div>;
  if (!items.length) return <div className="muted">No recent activity</div>;
  return (
    <div className="grid" style={{ gap: 8 }}>
      {items.map((it:any) => (
        <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', border: '1px solid var(--border)', padding: '8px 10px', background: 'var(--elev)', borderRadius: 8 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.goal || it.name}>{it.goal || it.name || it.id}</div>
          <span className={`badge ${String(it.status).toUpperCase()==='COMPLETED'?'green':(String(it.status).toUpperCase()==='FAILED'?'red':'yellow')}`}>{String(it.status || '').toUpperCase()}</span>
          {it.report_url ? (
            <a href={it.report_url} target="_blank" rel="noreferrer">Open report</a>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>—</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const reportRef = useRef<HTMLDivElement>(null);
  const paretoRef = useRef<any>(null);
  const severityRef = useRef<any>(null);
  const radarRef = useRef<any>(null);
  const [personaCards, setPersonaCards] = useState<Array<{ persona_id: string; persona_name?: string; avg_steps: number; completion_pct: number; dropoffs: number; friction_pct: number; drift?: number | null; sentiment_start?: number | null; sentiment_end?: number | null }>>([]);
  // Start in loading=true so server and client initial render match
  const [personaLoading, setPersonaLoading] = useState(true);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [openPersonaId, setOpenPersonaId] = useState<string | null>(null);
  const [personaDetail, setPersonaDetail] = useState<any | null>(null);
  const [personaDetailLoading, setPersonaDetailLoading] = useState(false);
  const [selectedBacktrack, setSelectedBacktrack] = useState<{ name: string; count: number } | null>(null);
  // Flow insights shared state
  const [flowRuns, setFlowRuns] = useState<string[]>([]);
  const [flowSeries, setFlowSeries] = useState<Array<{ name: string, data: number[] }>>([]);
  const [flowHoverPath, setFlowHoverPath] = useState<string | null>(null);
  const [flowSelectedPath, setFlowSelectedPath] = useState<string | null>(null);
  const [flowLoading, setFlowLoading] = useState<boolean>(false);
  const [flowShowAll, setFlowShowAll] = useState<'top'|'all'>('top');
  const [flowRunWindow, setFlowRunWindow] = useState<number>(6);
  function setChartRef(ref: any, inst: any) {
    try { ref.current = inst?.getEchartsInstance ? inst.getEchartsInstance() : null; } catch { ref.current = null; }
  }
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [runQuery, setRunQuery] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [lastRequested, setLastRequested] = useState<string>("");
  const [tab, setTab] = useState<'overview'|'persona'>('overview');
  const [fbFilter, setFbFilter] = useState<string>("");
  const [fbLimit, setFbLimit] = useState<number>(8);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [showSevLegend, setShowSevLegend] = useState(false);
  const [openDropKey, setOpenDropKey] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [sevVisible, setSevVisible] = useState<Record<string, boolean>>({ S1: true, S2: true, S3: true, S4: true, S5: true });
  // Global Download modal
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [dlKind, setDlKind] = useState<'overview'|'persona'|'full'|'excel'>('overview');
  const [dlTab, setDlTab] = useState<'report'|'excel'>('report');
  // Persona density toggle
  const [personaDensity, setPersonaDensity] = useState<'comfortable'|'compact'>('comfortable');
  const recommendedKind = useMemo(() => (tab === 'persona' ? 'persona' : 'overview'), [tab]);
  const SEVERITY_COLORS: Record<string, string> = useMemo(() => ({
    S1: '#9CA3AF',
    S2: '#818CF8',
    S3: '#60A5FA',
    S4: '#34D399',
    S5: '#F59E0B',
  }), []);
  const [dlAnim, setDlAnim] = useState(false);
  useEffect(() => { setDlAnim(false); const id = setTimeout(()=>setDlAnim(true), 10); return () => clearTimeout(id); }, [dlTab]);
  const [showDlMenu, setShowDlMenu] = useState(false);
  const dlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!dlRef.current) return;
      if (!dlRef.current.contains(e.target as Node)) setShowDlMenu(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);
  // Reflect tab/persona in URL for shareability
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    if (openPersonaId) url.searchParams.set('persona', String(openPersonaId)); else url.searchParams.delete('persona');
    window.history.replaceState(null, '', url.toString());
  }, [tab, openPersonaId]);
  // Initialize from URL on load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    const pid = sp.get('persona');
    if (t === 'persona') setTab('persona');
    if (pid) setOpenPersonaId(String(pid));
  }, []);

  function timeAgo(ts?: any): string {
    try {
      const d = new Date(ts || 0);
      const diff = Math.max(0, Date.now() - d.getTime());
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      const days = Math.floor(h / 24);
      return `${days}d ago`;
    } catch { return ''; }
  }

  async function loadRecent() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status?attach_signed_urls=0', {
        headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const data = await r.json();
      const items = (data.items || []).slice(0, 8);
      setRecent(items);
    } catch {}
  }

  async function handleDownload(kind: 'overview'|'persona'|'full'|'excel') {
      const runId = String(runQuery || lastRequested || '').trim();
      if (!runId) return;
    if (kind === 'excel') {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        // Download multi‑persona Excel (Persona Summary + All Users)
        const r = await fetch(`/runs/${encodeURIComponent(runId)}/users.xlsx`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
        if (!r.ok) throw new Error(`Failed: ${r.status}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Users_All_Personas_${runId}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
      }
      return;
    }
    try {
      setDownloading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const section = (kind === 'full' ? 'full' : (kind === 'persona' ? 'persona' : 'overview'));
      const qs = new URLSearchParams({ runId, section, ...(openPersonaId ? { personaId: String(openPersonaId) } : {}), ...(token ? { token } : {})});
      const url = `/api/reports/pdf?${qs.toString()}`;
      const r = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      const ab = await r.arrayBuffer();
      const blob = new Blob([ab], { type: 'application/pdf' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `UX_Report_${section}_${runId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
    } finally { setDownloading(false); }
  }

  function describeDropReason(label: string): string {
    const k = String(label || '').toLowerCase();
    if (k.includes('back') || k.includes('close') || k === 'back_or_close') return 'Users reversed course or tried to exit. Signals confusion or a wrong turn.';
    if (k.includes('auto') || k.includes('wait') || k === 'auto_wait') return 'Users hesitated or waited for the interface to advance, indicating uncertainty or missing feedback.';
    if (k.includes('too many steps') || k === 'too_many_steps_persona') return 'Observed paths were longer than the ideal shortest path, suggesting detours or inefficiency.';
    if (k.includes('primary action unclear') || k === 'unclear_primary_cta_persona') return 'Primary action was unclear; users could not identify the next step easily.';
    if (k.includes('loop') || k === 'loop_detected') return 'Users got stuck in a repeated loop without making progress.';
    return 'Aggregated from session signals and heuristics for this run.';
  }

  async function loadProjects() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/projects', {
        headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
      });
      if (!r.ok) {
        if (r.status === 401) {
          localStorage.removeItem('sparrow_token');
          localStorage.removeItem('sparrow_user_name');
          window.dispatchEvent(new CustomEvent('authStateChanged'));
        }
        return;
      }
      const data = await r.json();
      setProjects(data.projects || []);
    } catch {}
  }

  async function loadPersonas(runId: string) {
    if (!runId) { setPersonaCards([]); return; }
    try {
      setPersonaLoading(true);
      setPersonaError(null);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch(`/api/personas?runId=${encodeURIComponent(runId)}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`Failed to load personas (${r.status})`);
      const data = await r.json();
      console.log('Personas data received:', data);
      setPersonaCards(Array.isArray(data.personas) ? data.personas : []);
    } catch (e: any) {
      setPersonaError(e?.message || 'Failed to load personas');
      setPersonaCards([]);
    } finally {
      setPersonaLoading(false);
    }
  }

  async function loadPersonaDetail(runId: string, personaId: string) {
    if (!runId || !personaId) { setPersonaDetail(null); return; }
    try {
      setPersonaDetailLoading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch(`/api/persona_detail?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`Failed to load persona detail (${r.status})`);
      let data = await r.json();
      // Fallback: if screen_files are missing, load screen_nodes using the same logic as Overview
      // Overview derives local asset base from the run's actual run_dir (which may not equal runId)
      if (!Array.isArray(data?.screen_files) || data.screen_files.length === 0) {
        try {
          let localBase = `/runs-files/${encodeURIComponent(runId)}`;
          try {
            const statusUrl = `/api/status?run_id=${encodeURIComponent(runId)}&attach_signed_urls=0`;
            const rs = await fetch(statusUrl, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
            if (rs.ok) {
              const st = await rs.json();
              const it = (Array.isArray(st?.items) ? st.items : []).find((x: any) => String(x?.id) === String(runId));
              const rd = String(it?.run_dir || '');
              const m = rd.match(/\/(?:runs)\/([^\n]+)$/); // extract subpath after /runs/
              if (m && m[1]) localBase = `/runs-files/${m[1]}`;
            }
          } catch {}

          const resp = await fetch(`${localBase}/preprocess/screen_nodes.json`, { cache: 'no-store' });
          if (resp.ok) {
            const nodes: Array<{ id: number|string; name?: string; file?: string }> = await resp.json();
            const files = (nodes || []).map(n => ({
              id: Number(n.id),
              name: String(n.name || n.id),
              image: `${localBase}/preprocess/screens/${n.file || ''}`,
            }));
            // Attach files
            data = { ...(data || {}), screen_files: files };
            // Map numeric labels in backtracks_by_screen to friendly names
            if (Array.isArray(data?.backtracks_by_screen)) {
              data = {
                ...data,
                backtracks_by_screen: data.backtracks_by_screen.map((b: any) => {
                  const s = String(b?.screen ?? '');
                  if (/^\d+$/.test(s)) {
                    const id = Number(s);
                    const f = files.find(ff => Number(ff.id) === id);
                    return { ...b, screen: f?.name || s };
                  }
                  return b;
                })
              };
            }
          }
        } catch {}
      }
      setPersonaDetail(data);
      // Initialize Flow Insights series based on current persona paths
      try {
        const topPaths: string[] = Array.isArray((data || {}).paths) ? (data.paths as any[]).map(p => String(p.path || '')).slice(0, 5) : [];
        await loadFlowTrends(runId, personaId, topPaths, flowRunWindow);
      } catch {}
    } catch (e) {
      setPersonaDetail(null);
    } finally {
      setPersonaDetailLoading(false);
    }
  }

  // Load trendlines (shares across last N runs for same project & persona)
  async function loadFlowTrends(runId: string, personaId: string, topPaths: string[], maxRuns: number = 6) {
    try {
      if (!runId || !personaId || topPaths.length === 0) { setFlowRuns([]); setFlowSeries([]); return; }
      setFlowLoading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const status = await fetch('/api/status?attach_signed_urls=0', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      const sdata = await status.json();
      const runsAll = (sdata.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
      const current = runsAll.find((x: any) => String(x.id) === String(runId));
      const projectId = current?.project_id;
      const sameProject = runsAll.filter((x: any) => !projectId || String(x.project_id) === String(projectId));
      sameProject.sort((a: any, b: any) => new Date(a.created_at || a.updated_at || 0).getTime() - new Date(b.created_at || b.updated_at || 0).getTime());
      // Pick last maxRuns and ensure current is last
      let selected = sameProject.slice(-maxRuns);
      if (!selected.find((x: any) => String(x.id) === String(runId))) {
        selected = [...selected.slice(-(maxRuns - 1)), current].filter(Boolean);
      }
      // Use MM/DD hh:mm format (month/day hour:minute)
      const labels: string[] = selected.map((x: any) => {
        const d = new Date(x.created_at || x.updated_at || x.finished_at || Date.now());
        const MM = String(d.getMonth() + 1).padStart(2, '0');
        const DD = String(d.getDate()).padStart(2, '0');
        const HH = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${MM}/${DD} ${HH}:${mi}`;
      });
      // Fetch persona paths for each run in parallel
      const results = await Promise.all(selected.map(async (x: any) => {
        try {
          const r = await fetch(`/api/persona_detail?runId=${encodeURIComponent(x.id)}&personaId=${encodeURIComponent(personaId)}`, {
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store'
          });
          if (!r.ok) return { paths: [] as any[] };
          const j = await r.json();
          return { paths: Array.isArray(j?.paths) ? j.paths : [] };
        } catch { return { paths: [] as any[] }; }
      }));
      const series = topPaths.map((p) => ({ name: p, data: results.map(rr => {
        const found = (rr.paths || []).find((it: any) => String(it.path) === p);
        return Number(found?.sharePct || 0);
      }) }));
      setFlowRuns(labels);
      setFlowSeries(series);
    } catch {
      setFlowRuns([]); setFlowSeries([]);
    } finally { setFlowLoading(false); }
  }

  // Reload trends when the run window changes (if we already have persona detail)
  useEffect(() => {
    try {
      const runId = String(runQuery || lastRequested || '').trim();
      if (!runId || !openPersonaId) return;
      const topPaths: string[] = Array.isArray(personaDetail?.paths) ? (personaDetail!.paths as any[]).map((p: any)=>String(p.path||'')).slice(0,5) : [];
      if (topPaths.length) loadFlowTrends(runId, openPersonaId, topPaths, flowRunWindow);
    } catch {}
  }, [flowRunWindow]);

  async function searchRuns(q: string) {
    try {
      if (q.length < 1) { setRuns([]); return; }
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status?attach_signed_urls=0', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      const data = await r.json();
      const onlyRuns = (data.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
      const filtered = onlyRuns
        .filter((x: any) => !selectedProject || String(x.project_id) === String(selectedProject))
        .filter((x: any) => String(x.id).toLowerCase().includes(q.toLowerCase()));
      setRuns(filtered.map((x: any) => ({ id: x.id, project_id: x.project_id, started_at: x.created_at })));
    } catch { setRuns([]); }
  }

  function pickRun(id: string) {
    setRunQuery(id);
    loadMetrics(id);
    loadPersonas(id);
  }

  async function loadMetrics(runId: string) {
    try {
      setLoading(true);
      setError(null);
      setMetrics(null);
      setLastRequested(runId);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      if (!runId) { setLoading(false); return; }
      // Try public endpoint first (has enriched fallbacks), then internal
      const endpoints = ['/api/metrics_public', '/api/metrics'];
      let data: any = null;
      let lastErr: any = null;
      for (const ep of endpoints) {
        try {
          const r = await fetch(`${ep}?run_id=${encodeURIComponent(runId)}`, {
            headers: {
              'Accept': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: 'no-store',
          });
          if (r.ok) { data = await r.json(); break; }
          lastErr = new Error(`Failed to load metrics (${r.status}) from ${ep}`);
        } catch (e) { lastErr = e; }
      }
      if (!data) throw (lastErr || new Error('Failed to load metrics'));
      setMetrics(data);
      // Load personas for this run
      loadPersonas(runId);
    } catch (e: any) {
      setError(e?.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
      setBootLoading(false);
    }
  }

  const frictionSummary = useMemo(() => {
    if (!metrics) return [] as { label: string, count: number }[];
    const catMap: Record<string, number> = (metrics.llm_run_insights?.friction_categories) || {};
    if (Object.keys(catMap).length > 0) {
      return Object.entries(catMap).map(([k, v]) => ({ label: k, count: Number(v) || 0 }))
        .sort((a, b) => b.count - a.count).slice(0, 6);
    }
    const local = new Map<string, number>();
    (metrics.friction_points || []).forEach(fp => {
      const k = String(fp.category || 'unknown');
      local.set(k, (local.get(k) || 0) + 1);
    });
    return Array.from(local.entries()).map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
  }, [metrics]);

  // Feedback helpers (summary + deduped list)
  const feedbackSummary = useMemo(() => {
    if (!metrics) return null as null | string;
    const s = (metrics.run_feedback || []).find((x: any) => String(x.kind) === 'summary');
    return s?.content ? String(s.content) : null;
  }, [metrics]);

  const feedbackList = useMemo(() => {
    if (!metrics) return [] as { content: string, count: number, id: string }[];
    const items: any[] = (metrics.run_feedback || []).filter((x: any) => String(x.kind) !== 'summary');
    const map = new Map<string, { content: string, count: number, id: string }>();
    for (const it of items) {
      const c = String(it.content || '').trim();
      if (!c) continue;
      const key = c.toLowerCase();
      if (!map.has(key)) map.set(key, { content: c, count: 1, id: String(it.id) });
      else map.get(key)!.count += 1;
    }
    let arr = Array.from(map.values());
    if (fbFilter.trim()) {
      const q = fbFilter.trim().toLowerCase();
      arr = arr.filter(x => x.content.toLowerCase().includes(q));
    }
    return arr;
  }, [metrics, fbFilter]);

  const topScreens = useMemo(() => {
    if (!metrics) return [] as { screen_id: string, dwell: number, enters: number, exits: number }[];
    const arr = (metrics.screen_metrics || []).map((x: any) => ({
      screen_id: String(x.screen_id),
      dwell: Number(x.dwell_time_ms || 0),
      enters: Number(x.enters || 0),
      exits: Number(x.exits || 0),
    }));
    return arr.sort((a, b) => b.dwell - a.dwell).slice(0, 8);
  }, [metrics]);

  // Derived KPIs for Overview
  const kpis = useMemo(() => {
    const pub = (metrics as any)?.headline;
    const hasPub = Boolean(pub && String(process.env.NEXT_PUBLIC_REPORTS_PUBLIC_MODE || '').toLowerCase() === '1');

    const totalSteps: number = hasPub ? Number(pub.avgSteps ?? 0) : Number((metrics as any)?.run_metrics?.total_steps ?? 0);
    const backtracks: number = hasPub ? Math.round(Number(pub.backtrackRate ?? 0) * (totalSteps || 1)) : Number((metrics as any)?.run_metrics?.backtracks ?? 0);
    const totalWaitSec: number = hasPub ? Number(pub.hesitationSecPerStep ?? 0) * (totalSteps || 1) : Number((metrics as any)?.run_metrics?.total_wait_time_sec ?? 0);
    const detours: number = Number((metrics as any)?.llm_run_insights?.detours_count ?? 0);
    const personaTotals = (metrics as any)?.run_persona?.extra;
    const completedTotal: number | undefined = personaTotals?.completed_total != null ? Number(personaTotals.completed_total) : undefined;
    const personasTotal: number | undefined = personaTotals?.personas_total != null ? Number(personaTotals.personas_total) : undefined;

    const completionRatePct = hasPub
      ? (pub.completionRatePct != null ? Number(pub.completionRatePct) : null)
      : (personasTotal && personasTotal > 0 && completedTotal != null
          ? Math.round((completedTotal / personasTotal) * 1000) / 10
          : ((metrics as any)?.run_metrics?.success != null
              ? ((metrics as any)?.run_metrics?.success ? 100 : 0)
              : null));
    const earlyExitPct = completionRatePct != null ? Math.max(0, Math.round((100 - completionRatePct) * 10) / 10) : null;
    const avgSteps = hasPub
      ? (pub.avgSteps != null ? Number(pub.avgSteps) : null)
      : (completedTotal && completedTotal > 0 ? Math.round(Number((metrics as any)?.run_metrics?.total_steps || 0) / completedTotal) : Number((metrics as any)?.run_metrics?.total_steps || 0) || null);
    const idealSteps = hasPub ? (pub.idealSteps != null ? Number(pub.idealSteps) : null) : null;
    const frictionIndex = hasPub ? (pub.frictionIndex ?? null) : ((metrics as any)?.run_metrics?.friction_score ?? null);
    const backtrackRatePct = hasPub
      ? (pub.backtrackRate != null ? Math.round(Number(pub.backtrackRate) * 1000) / 10 : null)
      : (totalSteps > 0 ? Math.round((backtracks / totalSteps) * 1000) / 10 : null);
    const hesitationSecPerStep = hasPub
      ? (pub.hesitationSecPerStep != null ? Number(pub.hesitationSecPerStep) : null)
      : (totalSteps > 0 ? Math.round((totalWaitSec / totalSteps) * 10) / 10 : null);
    const decisionVolatility = totalSteps > 0 ? Math.round((detours / totalSteps) * 1000) / 10 : null; // % detours per step

    return { completionRatePct, earlyExitPct, avgSteps, idealSteps, frictionIndex, backtrackRatePct, hesitationSecPerStep, decisionVolatility } as {
      completionRatePct: number | null,
      earlyExitPct: number | null,
      avgSteps: number | null,
      idealSteps: number | null,
      frictionIndex: number | null,
      backtrackRatePct: number | null,
      hesitationSecPerStep: number | null,
      decisionVolatility: number | null,
    };
  }, [metrics]);

  // Small sparkline series derived from dwell to decorate KPI cards
  const sparkSeries = useMemo(() => {
    if (!metrics) return [] as number[];
    const raw = (metrics.screen_metrics || []).map((x: any) => Number(x.dwell_time_ms || 0));
    const arr = raw.slice(0, 12);
    while (arr.length < 12) arr.push(0);
    return arr;
  }, [metrics]);

  // Derived recommendations list (from backend derived_recommendations or LLM insights)
  type RecItem = { text: string, count: number, screenId?: string, image?: string, personas?: string[] };
  type RecGroup = { screenId: string, name?: string, image?: string | null, totalCount?: number, items: RecItem[] };
  const recommendations = useMemo<RecItem[]>(() => {
    if (!metrics) return [] as RecItem[];
    const derived = (metrics as any)?.derived_recommendations as Array<{ text: string, count?: number, screenId?: string, image?: string }>;
    if (Array.isArray(derived) && derived.length) {
      return derived.slice(0, 6).map(it => ({ text: String(it.text || ''), count: Number(it.count || 0), screenId: (it as any).screenId, image: (it as any).image })) as RecItem[];
    }
    const fromIns = (((metrics as any)?.llm_run_insights || {})?.recommendations || {}).prioritized_actions as Array<{ text: string }>; 
    if (Array.isArray(fromIns) && fromIns.length) {
      return fromIns.slice(0, 6).map(it => ({ text: String((it as any).text || it || ''), count: 0 })) as RecItem[];
    }
    return [];
  }, [metrics]);

  // Grouped recommendations by screen (from backend)
  const recommendationsByScreen = useMemo<RecGroup[]>(() => {
    try {
      const arr = (metrics as any)?.recommendations_by_screen as Array<any> | undefined;
      console.log('Recommendations by screen - raw data:', arr);
      if (!Array.isArray(arr) || arr.length === 0) return [] as RecGroup[];
      const mapped = arr.map((g: any) => ({
        screenId: String(g.screenId || g.screen_id || ''),
        name: String(g.name || ''),
        image: g.image || null,
        totalCount: Number(g.totalCount || g.total || 0),
        items: Array.isArray(g.items) ? g.items.map((it: any) => ({ text: String(it.text || ''), count: Number(it.count || 0), personas: Array.isArray(it.personas) ? it.personas.map((p:string)=>String(p)) : [], raw: String(it.text_raw || it.text || '') })) : [],
      })) as RecGroup[];
      console.log('Recommendations by screen - mapped:', mapped);
      return mapped;
    } catch { return [] as RecGroup[]; }
  }, [metrics]);

  // New: audit detail rows and signals from backend
  const auditRows = useMemo(() => {
    const rows = (metrics as any)?.audit?.rows as Array<any> | undefined;
    return Array.isArray(rows) ? rows : [];
  }, [metrics]);
  const auditSignals = useMemo(() => {
    const sig = (metrics as any)?.audit?.signals as Array<any> | undefined;
    return Array.isArray(sig) ? sig : [];
  }, [metrics]);

  // Recommendations by screen (grouped) and toggle
  const recGroups = useMemo(() => {
    const g = (metrics as any)?.recommendations_by_screen as Array<any> | undefined;
    return Array.isArray(g) ? g : [];
  }, [metrics]);

  const [showAllRecs, setShowAllRecs] = React.useState(false);
  const [selectedPersonaFilters, setSelectedPersonaFilters] = React.useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());

  // Map persona names to chip CSS classes
  function getPersonaChipClass(personaName: string): string {
    const name = String(personaName || '').toLowerCase();
    if (name.includes('streamliner')) return 'chip--streamliners';
    if (name.includes('experimenter')) return 'chip--experimenters';
    if (name.includes('hesitant')) return 'chip--hesitant';
    if (name.includes('power')) return 'chip--power';
    if (name.includes('new')) return 'chip--new';
    return 'chip'; // fallback to base chip
  }

  // Map theme labels to chip CSS classes
  function getThemeChipClass(themeLabel: string): string {
    const label = String(themeLabel || '').toLowerCase();
    // Primary theme mappings
    if (label.includes('clarity')) return 'chip--clarity';
    if (label.includes('confidence')) return 'chip--confidence';
    if (label.includes('recovery')) return 'chip--recovery';
    if (label.includes('delight')) return 'chip--delight';
    // Additional color variants
    if (label.includes('teal')) return 'chip--teal';
    if (label.includes('purple')) return 'chip--purple';
    if (label.includes('amber')) return 'chip--amber';
    if (label.includes('green')) return 'chip--green';
    if (label.includes('rose')) return 'chip--rose';
    if (label.includes('mint')) return 'chip--mint';
    if (label.includes('sky')) return 'chip--sky';
    if (label.includes('yellow')) return 'chip--yellow';
    if (label.includes('lavender')) return 'chip--lavender';
    return 'chip'; // fallback to base chip
  }

  function beautifyRecommendation(text: string): string {
    let s = String(text || '').trim();
    if (!s) return '';
    // Normalize whitespace and commas
    s = s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();

    // Lead-in phrase rewrites to imperative voice
    // Handle screen-focus phrasing before generic rules to avoid 'Add this screen would...'
    s = s.replace(/^i\s+wish\s+(this\s+screen|the\s+screen)\s+would\s+just\s+focus\s+on\s+/i, 'Focus this screen on ');
    s = s.replace(/^i\s+wish\s+(this\s+screen|the\s+screen)\s+would\s+focus\s+on\s+/i, 'Focus this screen on ');
    s = s.replace(/^i\s+wish\s+(this\s+screen|the\s+screen)\s+would\s+/i, 'Make this screen ');
    s = s.replace(/^i\s+wish\s+there\s+was\s+only\s+one[ ,]*/i, 'Use a single ');
    s = s.replace(/^i\s+wish\s+there\s+was\s+a\s+clear\s+/i, 'Add a clear ');
    s = s.replace(/^i\s+wish\s+there\s+were\s+/i, 'Add ');
    s = s.replace(/^i\s+wish\s+the\s+app\s+would\s+just\s+present\s+/i, 'Present ');
    s = s.replace(/^i\s+wish\s+the\s+app\s+would\s+/i, 'Make the app ');
    s = s.replace(/^i\s+wish\s+this\s+list\s+was\s+/i, 'Group this list ');
    s = s.replace(/^i\s+wish\s+the\s+list\s+was\s+/i, 'Group the list ');
    s = s.replace(/^i\s+wish\s+/i, 'Add ');

    // "It would help if …" -> Ensure … (present tense)
    s = s.replace(/^it\s+would\s+help\s+if\s+the\s+/i, 'Ensure the ');
    s = s.replace(/^it\s+would\s+help\s+if\s+/i, 'Ensure ');
    // After Ensure, prefer present tense
    s = s.replace(/^Ensure the ([^.]*?)\bhad\b/i, (_m, pre) => `Ensure the ${pre}have`);
    s = s.replace(/^Ensure ([^.]*?)\bhad\b/i, (_m, pre) => `Ensure ${pre}have`);
    s = s.replace(/\bwere\s+placed\b/gi, 'are placed');

    // Address timing: "was only requested after I hit the 'Checkout' button" -> "Request X only after users click 'Checkout'."
    (() => {
      const m = s.match(/^(?:Ensure\s+)?(.+?)\s+was\s+only\s+requested\s+after\s+I\s+(?:hit|click|tap|press)\s+(?:the\s+)?'?(checkout|pay|buy now)'?\s+button\.?/i);
      if (m) {
        const what = m[1].replace(/^the\s+/i, '').trim();
        const btn = m[2];
        const cap = (t: string) => (t && t.length ? t[0].toUpperCase() + t.slice(1) : t);
        s = `Request ${what} only after users click '${cap(btn)}'.`;
      }
    })();

    // First-person -> user-centric
    s = s.replace(/\bso\s+i\s+can\b/gi, 'so users can');
    s = s.replace(/\bso\s+i\s+could\b/gi, 'so users can');
    s = s.replace(/\bi\'?m\b/gi, 'users are');
    s = s.replace(/\bi\s+am\b/gi, 'users are');
    s = s.replace(/\busers are not\b/gi, "users aren't");
    s = s.replace(/\bi\s+don'?t\s+have\s+to\b/gi, "users don't have to");
    s = s.replace(/\bi\s+do\s+not\s+have\s+to\b/gi, 'users do not have to');
    // Drop possessive "my" in common phrases
    s = s.replace(/\bmy\s+(favorites?)\b/gi, '$1');
    s = s.replace(/\bmy\s+(cart\s+summary|order\s+summary|cart|order|wishlist|account|address|profile)\b/gi, (_m, noun) => `the ${noun}`);

    // Cleanups
    s = s.replace(/^Make the app would\b/i, 'Make the app');
    s = s.replace(/\s{2,}/g, ' ').trim();

    // Capitalize first letter and ensure final punctuation
    s = s[0].toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(s)) s += '.';
    return s;
  }

  type ProblemScreen = { screenId: string, name: string, description?: string, image?: string, score?: number };
  const problemScreens = useMemo<ProblemScreen[]>(() => {
    if (!metrics) return [] as ProblemScreen[];
    // Prefer server-provided structured list when present
    if (Array.isArray((metrics as any)?.problemScreens) && ((metrics as any).problemScreens as any[]).length > 0) {
      return ((metrics as any).problemScreens as any[]).slice(0, 3).map((it: any): ProblemScreen => ({
        screenId: String(it.screenId || ''),
        name: String(it.name || ''),
        description: String(it.description || ''),
        image: String(it.image || ''),
        score: (typeof it.score === 'number' ? it.score : undefined),
      }));
    }
    // Internal mode fallback: derive by severity from friction_points and enrich with best-effort names
    const fps: any[] = (metrics.friction_points || []);
    if (fps.length > 0) {
      const map = new Map<string, { score: number, name: string }>();
      const nameMap = new Map<string, string>();
      for (const x of (metrics.screen_metrics || []) as any[]) nameMap.set(String(x.screen_id), String(x.screen_id));
      for (const fp of fps) {
        const sid = String(fp.screen_id || '');
        if (!sid) continue;
        const sev = Math.max(1, Math.min(5, Number(fp.severity || 1)));
        map.set(sid, { score: (map.get(sid)?.score || 0) + sev, name: nameMap.get(sid) || `#${sid}` });
      }
      return Array.from(map.entries())
        .sort((a, b) => (b[1].score - a[1].score))
        .slice(0, 3)
        .map(([sid, v]): ProblemScreen => ({ screenId: sid, name: v.name, score: v.score }));
    }
    // Fallback 2: when no friction_points, use top dwell-time screens from screen_metrics
    const sm: any[] = (metrics.screen_metrics || []);
    if (Array.isArray(sm) && sm.length) {
      const ranked = sm
        .map((x: any) => ({ id: String(x.screen_id), dwell: Number(x.dwell_time_ms || 0), enters: Number(x.enters || 0), exits: Number(x.exits || 0) }))
        .filter(x => x.id && (x.dwell > 0 || x.enters > 0 || x.exits > 0))
        .sort((a, b) => (b.dwell - a.dwell));
      const top = ranked.slice(0, 3);
      return top.map((t) => ({ screenId: t.id, name: `Screen ${t.id}`, description: undefined, score: t.dwell }));
    }
    return [];
  }, [metrics]);

  const topDropoffReasons = useMemo(() => {
    if (!metrics) return [] as { label: string, count: number }[];
    // Prefer server-provided dropoffReasons when available
    const list = (metrics as any)?.dropoffReasons as Array<{ label: string, count: number }>;
    if (Array.isArray(list) && list.length) {
      return list.slice(0, 3).map(it => ({ label: String(it.label || ''), count: Number(it.count || 0) }));
    }
    // Prefer TEA themes when present
    const themes = (metrics.llm_run_insights?.themes || []) as Array<{ label: string, frequency: number, severity_1_5?: number }>;
    if (themes.length) {
      return themes
        .slice()
        .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
        .slice(0, 3)
        .map(t => ({ label: t.label, count: Number(t.frequency || 0) }));
    }
    // Fallback: explicit backtrack reasons
    const backs = (metrics.llm_run_insights?.backtrack_reasons || {}) as Record<string, number>;
    if (Object.keys(backs).length) {
      return Object.entries(backs).map(([label, count]) => ({ label, count: Number(count || 0) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    }
    // Fallback: friction categories aggregation
    const cats = (metrics.llm_run_insights?.friction_categories || {}) as Record<string, number>;
    if (Object.keys(cats).length) {
      return Object.entries(cats).map(([label, count]) => ({ label, count: Number(count || 0) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    }
    // Next: derive from raw friction_points categories
    const fps = (metrics.friction_points || []) as any[];
    if (fps.length) {
      const map = new Map<string, number>();
      for (const fp of fps) {
        const k = String(fp.category || 'other');
        map.set(k, (map.get(k) || 0) + 1);
      }
      return Array.from(map.entries()).map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    }
    // Heuristic synthesis from metrics
    if (String(process.env.NEXT_PUBLIC_REPORTS_PUBLIC_MODE || '').toLowerCase() === '1') {
      const pub: any = (metrics as any).headline || {};
      const totalSteps = Number(pub.avgSteps || 0);
      const idealSteps = Number(pub.idealSteps || 0);
      const backtrackRate = Number(pub.backtrackRate || 0);
      const hesitation = Number(pub.hesitationSecPerStep || 0);
      const tooManySteps = (idealSteps && totalSteps && totalSteps > idealSteps) ? (totalSteps - idealSteps) : 0;
      const candidates: Array<{ label: string, count: number }> = [];
      if (backtrackRate > 0) candidates.push({ label: 'back_or_close', count: Math.max(1, Math.round(backtrackRate * (totalSteps || 1))) });
      if (hesitation > 1.0) candidates.push({ label: 'auto_wait', count: Math.max(1, Math.round(hesitation)) });
      if (tooManySteps > 0) candidates.push({ label: 'too_many_steps_persona', count: tooManySteps });
      return candidates.slice(0, 3);
    } else {
    const rm: any = (metrics as any)?.run_metrics || {};
    const totalSteps = Number(rm.total_steps || 0);
    const shortest = Number(rm.shortest_path_steps || 0);
    const backtracks = Number(rm.backtracks || 0);
    const waitSec = Number(rm.total_wait_time_sec || 0);
    const avgWait = totalSteps > 0 ? waitSec / totalSteps : 0;
    const tooManySteps = (shortest && totalSteps && totalSteps > shortest) ? (totalSteps - shortest) : 0;
    const candidates: Array<{ label: string, count: number }> = [];
    if (backtracks > 0) candidates.push({ label: 'back_or_close', count: backtracks });
    if (avgWait > 1.0) candidates.push({ label: 'auto_wait', count: Math.max(1, Math.round(avgWait)) });
    if (tooManySteps > 0) candidates.push({ label: 'too_many_steps_persona', count: tooManySteps });
    if (!candidates.length && totalSteps > 0) {
      const detours = Number((metrics as any)?.llm_run_insights?.detours_count || 0);
      candidates.push({ label: 'unclear_primary_cta_persona', count: Math.max(1, detours || Math.round(totalSteps * 0.1)) });
    }
    return candidates.slice(0, 3);
    }
  }, [metrics]);

  const auditIssues = useMemo(() => {
    if (!metrics) return [] as { label: string, count: number }[];
    // Prefer server-provided issues when available
    if (Array.isArray((metrics as any)?.issues) && ((metrics as any).issues as any[]).length > 0) {
      const issues = (metrics as any).issues as Array<{ label: string, count?: number, sharePct?: number }>;
      // Limit to top 5 for clearer snapshot
      return issues.slice(0, 5).map(it => ({ label: it.label, count: Number(it.count ?? it.sharePct ?? 0) }));
    }
    // Aggregate from multiple sources to ensure up to 5 categories
    const friendly: Record<string, string> = {
      loop_detected: 'Users got stuck in a loop',
      auto_wait: 'Auto-advancing screen confusion',
      back_or_close: 'Users tried to go back/close',
      unclear_primary_cta_persona: 'Primary action unclear',
      choice_overload_persona: 'Too many choices on screen',
      resistance_to_prompts_persona: 'Users resisted prompts/permissions',
      anxiety_wait_persona: 'Long waits increased uncertainty',
      too_many_steps_persona: 'Too many steps',
    } as any;
    const prettyCopy: Record<string, string> = { ambiguous_labels: 'Ambiguous labels', missing_context: 'Missing context', redundant_steps: 'Redundant steps' } as any;
    const humanize = (raw: string): string => {
      const keep = new Set(['CTA','AI','UI','UX']);
      const s = String(raw || '').replace(/[_\-]+/g, ' ').trim();
      const parts = s.split(/\s+/).map((w, i, arr) => {
        const upper = w.toUpperCase();
        if (keep.has(upper)) return upper;
        const low = w.toLowerCase();
        if (i !== 0 && i !== arr.length - 1 && ['of','in','to','and','the','a','an','for','on','by','at'].includes(low)) return low;
        return low.charAt(0).toUpperCase() + low.slice(1);
      });
      return parts.join(' ');
    };
    const acc = new Map<string, number>();
    const add = (label: string, count: number) => {
      const key = humanize(label);
      if (!key) return;
      acc.set(key, (acc.get(key) || 0) + Math.max(0, Number(count || 0)));
    };
    // 1) friction categories
    const cats = (metrics.llm_run_insights?.friction_categories || {}) as Record<string, number>;
    for (const [k, v] of Object.entries(cats || {})) add(friendly[k] || k, Number(v || 0));
    // 2) backtrack reasons
    const backs = (metrics.llm_run_insights?.backtrack_reasons || {}) as Record<string, number>;
    for (const [k, v] of Object.entries(backs || {})) add(friendly[k] || k, Number(v || 0));
    // 3) themes (frequency)
    const themes = (metrics.llm_run_insights?.themes || []) as Array<{ label: string, frequency: number }>;
    for (const t of (themes || [])) add(t.label, Number(t.frequency || 0));
    // 4) copy IA issues
    const copy = (metrics.llm_run_insights?.copy_ia_issues || {}) as Record<string, number>;
    for (const [k, v] of Object.entries(copy || {})) add(prettyCopy[k] || k, Number(v || 0));

    let arr = Array.from(acc.entries()).map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Ultimate fallback: derive from raw friction_points if no aggregated insights
    if (!arr.length) {
      try {
        const fps = ((metrics as any).friction_points || []) as Array<{ category?: string; type?: string; severity?: number }>;
        if (fps.length) {
          const m = new Map<string, number>();
          for (const fp of fps) {
            const raw = String((fp.category || fp.type || 'other') || '');
            const key = humanize(friendly[raw] || raw);
            const sev = Math.max(1, Math.min(5, Number(fp.severity || 1)));
            m.set(key, (m.get(key) || 0) + sev);
          }
          arr = Array.from(m.entries()).map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        }
      } catch {}
    }
    return arr;
  }, [metrics]);

  const [auditMode, setAuditMode] = useState<'pareto'|'severity'>('pareto');
  // Mapping: internal heuristic keys → human-readable + full title
  const HEURISTIC_DISPLAY: Record<string, { label: string, full: string }> = useMemo(() => ({
    'Visibility of system status': { label: 'Keep users informed', full: 'Visibility of system status' },
    'Aesthetic and minimalist design': { label: 'Simplify the interface', full: 'Aesthetic and minimalist design' },
    'Match between system and the real world': { label: 'Use familiar language', full: 'Match between system and the real world' },
    'Consistency and standards': { label: 'Stay consistent', full: 'Consistency and standards' },
    'Flexibility and efficiency of use': { label: 'Support quick actions', full: 'Flexibility and efficiency of use' },
  }), []);
  const auditParetoOption = useMemo(() => {
    if (!auditIssues.length) return null as any;
    const ranked = auditIssues.slice().sort((a,b)=>b.count-a.count);
    const labelsFull = ranked.map(i=>i.label);
    const labels = labelsFull.map(l=> (HEURISTIC_DISPLAY[l]?.label || l));
    const counts = ranked.map(i=>i.count);
    const total = counts.reduce((s,n)=>s+Number(n||0),0) || 1;
    let acc = 0;
    const cumulative = counts.map(n => { acc += Number(n||0); return Math.round((acc/total)*100); });
    const wrap = (s: string) => {
      const words = String(s).split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > 18) { lines.push(line.trim()); line = w; }
        else { line += ' ' + w; }
      }
      if (line.trim()) lines.push(line.trim());
      return lines.slice(0, 3).join('\n');
    };
    // Simple color scale from low→high impact
    const max = Math.max(...counts, 1);
    const barColors = counts.map(c => {
      const t = Math.max(0, Math.min(1, c / max));
      // interpolate blue→amber→red
      if (t < 0.5) return '#60A5FA';
      if (t < 0.8) return '#F59E0B';
      return '#EF4444';
    });
    return {
      backgroundColor: 'transparent',
      tooltip: { 
        trigger: 'axis', 
        confine: true,
        formatter: (params: any) => {
          try {
            const bar = Array.isArray(params) ? params.find((p:any)=>p.seriesType==='bar') : params;
            const idx = bar?.dataIndex ?? 0;
            const full = labelsFull[idx] || labels[idx];
            const val = Number(counts[idx]||0);
            const pct = Math.round((val/total)*100);
            return `${HEURISTIC_DISPLAY[full]?.full || full}: <b>${val}</b> (${pct}%)`;
          } catch { return ''; }
        }
      },
      grid: { left: 80, right: 70, top: 40, bottom: 70 },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#cbd5e1', interval: 0, rotate: 0, lineHeight: 16, formatter: wrap } },
      yAxis: [
        { type: 'value', name: 'Count', nameLocation: 'middle', nameGap: 45, axisLabel: { color: '#cbd5e1' }, splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
        { type: 'value', name: 'Cumulative %', nameLocation: 'middle', nameGap: 50, min: 0, max: 100, axisLabel: { color: '#cbd5e1' }, splitLine: { show: false } }
      ],
      series: [
        { 
          type: 'bar', name: 'Count', data: counts,
          itemStyle: {
            color: (params:any) => barColors[params.dataIndex] || '#5B6DAA',
            borderRadius: [4,4,0,0]
          },
          label: {
            show: true,
            position: 'top',
            color: '#9CA3AF',
            fontSize: 11,
            formatter: (p:any) => {
              const v = Number(p.value||0);
              const pct = Math.round((v/total)*100);
              return `${v} (${pct}%)`;
            }
          }
        },
        { type: 'line', name: 'Cumulative %', yAxisIndex: 1, data: cumulative, smooth: true, symbol: 'none', lineStyle: { color: '#94A3B8', width: 2 } }
      ]
    } as any;
  }, [auditIssues]);

  const auditSeverityOption = useMemo(() => {
    const themes = (metrics?.llm_run_insights?.themes || []) as Array<{ label: string, frequency: number, severity_1_5: number }>;
    if (!themes.length && !auditIssues.length) return null as any;
    const sev: Record<string, { s1: number, s2: number, s3: number, s4: number, s5: number }> = {};
    if (themes.length) {
      for (const t of themes) {
        const l = String(t.label);
        if (!sev[l]) sev[l] = { s1:0,s2:0,s3:0,s4:0,s5:0 };
        const bucket = Math.max(1, Math.min(5, Math.round(Number(t.severity_1_5||3))));
        const key = ('s'+bucket) as keyof typeof sev[string];
        sev[l][key] += Number(t.frequency||0);
      }
    }
    for (const i of auditIssues) {
      if (!sev[i.label]) sev[i.label] = { s1:0,s2:0,s3:i.count||0,s4:0,s5:0 };
    }
    const labels = Object.keys(sev);
    const order = labels.slice().sort((a,b)=>{
      const sa = Object.values(sev[a]).reduce((s,n)=>s+Number(n),0);
      const sb = Object.values(sev[b]).reduce((s,n)=>s+Number(n),0);
      return sb-sa;
    });
    const toPos = (x:number)=>x; const toNeg=(x:number)=>-x;
    const s1 = order.map(l=>toNeg(sev[l].s1));
    const s2 = order.map(l=>toNeg(sev[l].s2));
    const s3 = order.map(l=>toNeg(sev[l].s3));
    const s4 = order.map(l=>toPos(sev[l].s4));
    const s5 = order.map(l=>toPos(sev[l].s5));
    const prettyTitle = (s: string) => {
      const keepUpper = new Set(['CTA','AI','UI','UX']);
      const lowerWords = new Set(['of','in','to','and','the','a','an','for','on','by','at']);
      return String(s)
        .split(/\s+/)
        .map((w, idx, arr) => {
          const clean = w.replace(/[^a-zA-Z\-]/g,'');
          const upper = clean.toUpperCase();
          if (keepUpper.has(upper)) return upper;
          const lower = clean.toLowerCase();
          if (idx!==0 && idx!==arr.length-1 && lowerWords.has(lower)) return lower;
          // handle hyphenated words
          return lower.split('-').map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join('-');
        })
        .join(' ');
    };
    // Compute dynamic left padding and wrapping to avoid truncation
    const maxLabelLen = order.reduce((m, l) => Math.max(m, prettyTitle(l).length), 0);
    const gridLeft = Math.min(320, Math.max(160, Math.round(maxLabelLen * 7)));
    const wrap = (s: string) => {
      const words = String(s).replace(/\//g, ' / ').split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        const next = (line + ' ' + w).trim();
        if (next.length > 24) { lines.push(line.trim()); line = w; }
        else { line = next; }
      }
      if (line.trim()) lines.push(line.trim());
      return lines.slice(0, 3).join('\n');
    };
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: gridLeft, right: 30, top: 16, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: '#cbd5e1', formatter: (v:number)=>Math.abs(v) } },
      yAxis: { type: 'category', data: order.map(prettyTitle), axisLabel: { color: '#cbd5e1', interval: 0, width: gridLeft - 40 as any, overflow: 'break' as any, lineHeight: 18 as any, margin: 12 as any, formatter: wrap } },
      legend: { show: false, data: ['S1','S2','S3','S4','S5'], textStyle: { color: '#cbd5e1' } },
      series: [
        { type:'bar', name:'S1', stack:'sev', data: s1, itemStyle:{ color:'#9CA3AF' } },
        { type:'bar', name:'S2', stack:'sev', data: s2, itemStyle:{ color:'#818CF8' } },
        { type:'bar', name:'S3', stack:'sev', data: s3, itemStyle:{ color:'#60A5FA' } },
        { type:'bar', name:'S4', stack:'sev', data: s4, itemStyle:{ color:'#34D399' } },
        { type:'bar', name:'S5', stack:'sev', data: s5, itemStyle:{ color:'#F59E0B' } },
      ]
    } as any;
  }, [metrics, auditIssues]);

  function toggleSeverity(name: 'S1'|'S2'|'S3'|'S4'|'S5') {
    try {
      const inst = severityRef.current;
      if (inst && inst.dispatchAction) {
        inst.dispatchAction({ type: 'legendToggleSelect', name });
      }
    } catch (e) {}
    setSevVisible(v => ({ ...v, [name]: !v[name] }));
  }

  function resolveApiUrl(p?: string): string {
    const u = String(p || '');
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) return u;
    // go through proxy to avoid mixed-origin or auth issues
    const path = u.startsWith('/') ? u : `/${u}`;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const qs = token ? `&token=${encodeURIComponent(token)}` : '';
      return `/api/proxy_image?path=${encodeURIComponent(path)}${qs}`;
    } catch {
      return `/api/proxy_image?path=${encodeURIComponent(path)}`;
    }
  }

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { loadRecent(); }, []);
  // Fallback: reveal UI fast even if network is slow
  useEffect(() => { const t = setTimeout(()=> setBootLoading(false), 700); return () => clearTimeout(t); }, []);
  // On first load, auto-select latest COMPLETED run and its project, then fetch metrics
  useEffect(() => {
    async function loadLatestCompleted() {
      try {
        if (selectedProject || runQuery) return; // do not override user's selection
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status?attach_signed_urls=0', {
          headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          cache: 'no-store',
        });
        if (!r.ok) {
          if (r.status === 401) {
            localStorage.removeItem('sparrow_token');
            localStorage.removeItem('sparrow_user_name');
            window.dispatchEvent(new CustomEvent('authStateChanged'));
          }
          return;
        }
        const data = await r.json();
        const runsOnly = (data.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
        const completed = runsOnly.filter((x: any) => String(x.status).toUpperCase() === 'COMPLETED');
        if (completed.length === 0) return;
        completed.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        const last = completed[0];
        if (!last?.id) return;
        setSelectedProject(String(last.project_id || ''));
        setRunQuery(String(last.id));
        // Fetch metrics immediately
        loadMetrics(String(last.id));
      } catch (e) {}
      finally {
        // Ensure UI becomes interactive even if no runs found
        setBootLoading(false);
      }
    }
    loadLatestCompleted();
  }, []);
  useEffect(() => { if (runQuery.length >= 1) searchRuns(runQuery); else setRuns([]); }, [runQuery, selectedProject]);
  // Auto load metrics when both project and run id present (debounced)
  useEffect(() => {
    if (!selectedProject || runQuery.length < 3) return;
    const t = setTimeout(() => {
      if (lastRequested !== runQuery) loadMetrics(runQuery);
    }, 450);
    return () => clearTimeout(t);
  }, [selectedProject, runQuery, lastRequested]);

  async function openLatestCompleted() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status?attach_signed_urls=0', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const runsOnly = (data.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
      const completed = runsOnly.filter((x: any) => String(x.status).toUpperCase() === 'COMPLETED');
      if (!completed.length) return;
      completed.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      const last = completed[0];
      if (!last?.id) return;
      setSelectedProject(String(last.project_id || ''));
      setRunQuery(String(last.id));
      loadMetrics(String(last.id));
    } catch (e) {}
  }

  if (bootLoading) return <div>Loading...</div>;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Reports</h2>
      </div>

      {showDownloadModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={()=>setShowDownloadModal(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:10070, display:'flex', alignItems:'center', justifyContent:'center', padding:'4vh 2vw' }}
        >
          <div onClick={(e)=>e.stopPropagation()} style={{ width:'min(560px, 94vw)', background:'rgba(17,24,39,0.96)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'0 24px 60px rgba(0,0,0,0.6)', padding:16 }}>
            <h3 style={{ margin:0, fontSize:22 }}>Download Report</h3>
            <div style={{ height: 8 }} />

            {/* Segmented primary selector - available on both Overview and Persona tabs */}
              <div role="tablist" aria-label="Download type" style={{ position:'relative', display:'inline-grid', gridTemplateColumns:'1fr 1fr', border:'1px solid var(--border)', borderRadius:999, overflow:'hidden', marginBottom:12 }}>
                <span aria-hidden style={{ position:'absolute', top:2, bottom:2, left: dlTab==='report' ? 2 : '50%', width:'calc(50% - 4px)', background:'linear-gradient(180deg, rgba(147,197,253,0.25), rgba(147,197,253,0.12))', borderRadius:999, transition:'left .22s ease, background .22s ease' }} />
                <button role="tab" aria-selected={dlTab==='report'} onClick={()=>{ setDlTab('report'); if (dlKind==='excel') setDlKind(recommendedKind); }} style={{ padding:'6px 16px', background:'transparent', border:'none', color:'#e5e7eb', cursor:'pointer', zIndex:1 }}>Report</button>
                <button role="tab" aria-selected={dlTab==='excel'} onClick={()=>{ setDlTab('excel'); setDlKind('excel'); }} style={{ padding:'6px 16px', background:'transparent', border:'none', color:'#e5e7eb', cursor:'pointer', zIndex:1 }}>Personas</button>
            </div>

            {dlTab==='excel' ? (
              <div className="grid" style={{ gap:6, transition:'opacity .2s ease, transform .2s ease', opacity: dlAnim ? 1 : 0, transform: dlAnim ? 'translateY(0)' : 'translateY(6px)' }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                  <input type="radio" name="dlKind" checked={true} readOnly />
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}><IconLayers width={14} height={14} /> Includes all personas + user‑level data for analysis.</span>
              </label>
            </div>
            ) : (
              <div role="radiogroup" aria-label="Report" className="grid" style={{ gap:6, transition:'opacity .2s ease, transform .2s ease', opacity: dlAnim ? 1 : 0, transform: dlAnim ? 'translateY(0)' : 'translateY(6px)' }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', cursor:'pointer' }}>
                  <input type="radio" name="dlKind" checked={dlKind==='full'} onChange={()=>setDlKind('full')} />
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}><IconDownload width={14} height={14} /> Full Report (Overview + Persona Explorer)</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', cursor:'pointer' }}>
                  <input type="radio" name="dlKind" checked={dlKind==='overview'} onChange={()=>setDlKind('overview')} />
                  <span style={{ flex:1, display:'inline-flex', alignItems:'center', gap:8 }}><IconDownload width={14} height={14} /> Overview Report</span>
                  {recommendedKind==='overview' && <span className="badge">Recommended</span>}
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', cursor:'pointer' }}>
                  <input type="radio" name="dlKind" checked={dlKind==='persona'} onChange={()=>setDlKind('persona')} />
                  <span style={{ flex:1, display:'inline-flex', alignItems:'center', gap:8 }}><IconDownload width={14} height={14} /> Persona Explorer Report</span>
                  {recommendedKind==='persona' && <span className="badge">Recommended</span>}
                </label>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:14 }}>
              <button className="btn-ghost" onClick={()=>setShowDownloadModal(false)}>Cancel</button>
              <button className="btn-ghost" onClick={()=>{ handleDownload(dlKind); setShowDownloadModal(false); }}>Download</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        <div className="row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label>
            Project
            <FancySelect
              value={selectedProject}
              onChange={setSelectedProject}
              placeholder="Select project"
              options={projects.map(p => ({ value: p.id, label: p.name }))}
              searchable={false}
            />
          </label>
          <label>
            Run Id
            <input
              placeholder="Type at least 3 characters"
              value={runQuery}
              onChange={e => setRunQuery(e.target.value)}
              disabled={false}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-ghost btn-sm" type="button" onClick={openLatestCompleted}>Open latest completed</button>
          <span className="muted" style={{ fontSize: 12 }}>(or type a Run Id below)</span>
        </div>
        {(loading || error) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {loading && <span className="muted">Loading…</span>}
            {error && <span className="muted" style={{ color: '#fca5a5' }}>{error}</span>}
          </div>
        )}
      </div>
      {bootLoading ? (
        <div className="tile" style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div ref={reportRef} className="grid" style={{ marginTop: 16 }}>
          {/* Tabs + Download button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10 }}>
              <TabButton label="Overview" active={tab==='overview'} onClick={() => setTab('overview')} />
              <TabButton label="Persona Explorer" active={tab==='persona'} onClick={() => setTab('persona')} />
            </div>
            <button
              onClick={() => { setDlTab('report'); setDlKind(recommendedKind); setShowDownloadModal(true); setShowDlMenu(false); }}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                color: '#FFFFFF',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <IconDownload width={16} height={16} />
              Download
            </button>
          </div>

          {tab === 'overview' && (
          <>
            {/* moved link up to tabs row; keeping spacing compact here */}
            {!metrics ? (
              <div className="tile" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight: 180 }}>
                <div className="muted">Pick a project and run, or click "Open latest completed".</div>
              </div>
            ) : (
            <>
            <div className="tile">
              <h4>Overview</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(240px, 1fr))', gap: 16, marginTop: 10 }}>
                <Stat label="Completion Rate" subtitle="Share of personas who reached the goal" value={kpis.completionRatePct != null ? `${kpis.completionRatePct}%` : '-'} />
                <Stat label="Early-Exit Rate" subtitle="Stopped before finishing" value={kpis.earlyExitPct != null ? `${kpis.earlyExitPct}%` : '-'} />
                <Stat label="Backtrack Rate" subtitle="Share of steps that reversed course" value={kpis.backtrackRatePct != null ? `${kpis.backtrackRatePct}%` : '-'} />
                <Stat label="Ideal Steps" subtitle="Shortest path steps" value={kpis.idealSteps != null ? String(kpis.idealSteps) : '—'} />
                <Stat label="Avg Steps (Completed)" subtitle="Average steps among completed runs" value={kpis.avgSteps != null ? (Number.isInteger(kpis.avgSteps) ? String(kpis.avgSteps) : (Math.round(Number(kpis.avgSteps) * 100) / 100).toFixed(2)) : '-'} />
                <Stat label="Hesitation (s/Step)" subtitle="Average wait per step" value={kpis.hesitationSecPerStep != null ? String(kpis.hesitationSecPerStep) : '-'} />

                {/* Friction Index - Special Card */}
                <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 16, padding: 20, minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#92400E', marginBottom: 8 }}>Friction Index</div>
                  <div style={{ fontSize: 30, fontWeight: 600, color: '#78350F', marginBottom: 4 }}>{kpis.frictionIndex != null ? String(kpis.frictionIndex) : '-'}</div>
                  <div style={{ fontSize: 12, color: '#92400E' }}>Overall friction score</div>
                </div>

                {/* Decision Volatility - Special Card */}
                <div style={{ background: '#FECACA', border: '1px solid #FCA5A5', borderRadius: 16, padding: 20, minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#991B1B', marginBottom: 8 }}>Decision Volatility</div>
                  <div style={{ fontSize: 30, fontWeight: 600, color: '#7F1D1D', marginBottom: 4 }}>{kpis.decisionVolatility != null ? `${kpis.decisionVolatility}%` : '—'}</div>
                  <div style={{ fontSize: 12, color: '#991B1B' }}>Detours per step</div>
                </div>
              </div>
              {(metrics as any)?.run_metrics?.report_csv_url && (
                <div style={{ marginTop: 14 }}>
                  <a href={(metrics as any).run_metrics.report_csv_url} target="_blank" rel="noreferrer" style={{ color: '#3B82F6', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Download CSV</a>
                </div>
              )}
            </div>
          <div className="tile">
              <h4>Problem Areas</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Most Problematic Screen</div>
                  <div style={{ border: '1px solid var(--border)', padding: '12px 14px', background: 'var(--elev)', borderRadius: 8 }}>
                    {problemScreens.length === 0 && <div className="muted">No clear problem screen detected</div>}
                    {problemScreens.length > 0 && (
                      <div className="grid" style={{ gap: 12 }}>
                        {problemScreens.map((ps, i) => (
                          <div
                            key={ps.screenId + i}
                            style={{
                              display: 'grid', gridTemplateColumns: '64px 1fr', gap: 12, alignItems: 'center',
                              padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12,
                              background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
                              position: 'relative', boxShadow: '0 6px 22px rgba(0,0,0,0.28)'
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget.style as any).boxShadow = '0 10px 28px rgba(0,0,0,0.38)';
                              (e.currentTarget.style as any).transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget.style as any).boxShadow = '0 6px 22px rgba(0,0,0,0.28)';
                              (e.currentTarget.style as any).transform = 'translateY(0)';
                            }}
                          >
                            <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: ps.image ? 'zoom-in' : 'default' }} onClick={() => { if (ps.image) setPreviewImg(resolveApiUrl(ps.image)); }}>
                              {ps.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img alt={ps.name} src={resolveApiUrl(ps.image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span className="muted" style={{ fontSize: 11 }}>no image</span>
                              )}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ fontWeight: 900, fontSize: 18 as any, letterSpacing: 0.2 as any }}>{ps.name || `Screen ${ps.screenId}`}</div>
                                {(ps.score ?? null) !== null && (
                                  <span style={{ fontSize: 11, color: '#e5e7eb', background: 'rgba(147,197,253,0.12)', border: '1px solid rgba(147,197,253,0.25)', borderRadius: 999, padding: '2px 8px' }}>score {ps.score}</span>
                                )}
                              </div>
                              {(() => {
                                const row = auditRows.find((r:any)=> String(r.screenId||'') === String(ps.screenId||''));
                                let extra = '';
                                try {
                                  if (row) {
                                    const cats = Object.entries(row.categories||{})
                                      .sort((a:any,b:any)=> Number(b[1]) - Number(a[1]))
                                      .slice(0,2)
                                      .map(([k,v])=> `${String(k||'').replace(/_/g,' ')}×${v}`)
                                      .join(', ');
                                    extra = `${cats ? ` Top signals: ${cats}.` : ''} Dwell ${row.dwellMs||0}ms, Exits ${row.exits||0}.`;
                                  }
                                } catch {}
                                const text = `${ps.description || ''}${extra}`.trim();
                                return text ? (
                                  <div className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{text}</div>
                                ) : null;
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Top Drop-off Reasons</div>
                  <div className="grid" style={{ gap: 10 }}>
                    {topDropoffReasons.length === 0 && <div className="muted">No signals</div>}
                    {topDropoffReasons.map((r, i) => {
                      const raw = String(r.label || '');
                      const pretty = raw
                        .split('_')
                        .map((w, idx) => {
                          const t = w.trim();
                          if (!t) return t;
                          const upper = t.toUpperCase();
                          if (['CTA','AI','UI','UX'].includes(upper)) return upper;
                          if (['or','and','to','of','in','a','an','the'].includes(t)) return t;
                          return t.charAt(0).toUpperCase() + t.slice(1);
                        })
                        .join(' ');
                      const n = Number(r.count || 0);
                      const rounded = (Math.abs(n - Math.round(n)) < 0.05) ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1);
                      const accent = ['#5B6DAA','#2F6F7E','#34D399','#A78BFA','#F59E0B'][i % 5];
                      const itemKey = raw + '|' + i;
                      const isOpen = openDropKey === itemKey;
                      const toggle = () => setOpenDropKey(k => (k === itemKey ? null : itemKey));
                      return (
                        <div key={itemKey} role="listitem" style={{
                          position: 'relative',
                          border: '1px solid var(--border)',
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))',
                          borderRadius: 12,
                          padding: '10px 14px 10px 16px',
                          boxShadow: '0 6px 18px rgba(0,0,0,0.22)'
                        }}>
                          <span aria-hidden style={{ position: 'absolute', left: -1, top: -1, bottom: -1, width: 4, borderTopLeftRadius: 12, borderBottomLeftRadius: 12, background: accent }} />
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={isOpen}
                            onClick={toggle}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span aria-hidden style={{ display: 'inline-block', transform: `rotate(${isOpen ? 90 : 0}deg)`, transition: 'transform .15s ease' }}>▸</span>
                              <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>{pretty}</span>
                      </div>
                            <span title="occurrences" style={{
                              border: '1px solid rgba(148,163,184,0.25)',
                              background: 'rgba(255,255,255,0.05)',
                              color: '#cbd5e1',
                              padding: '2px 10px',
                              borderRadius: 999,
                              fontVariantNumeric: 'tabular-nums',
                              minWidth: 44,
                              textAlign: 'center'
                            }}>×{rounded}</span>
                  </div>
                          <div
                            className="muted"
                            style={{
                              marginTop: isOpen ? 8 : 0,
                              lineHeight: 1.55,
                              fontSize: 13 as any,
                              overflow: 'hidden',
                              maxHeight: isOpen ? 140 : 0,
                              opacity: isOpen ? 1 : 0,
                              transition: 'max-height .24s ease, opacity .24s ease, margin-top .24s ease'
                            }}
                          >
                            {describeDropReason(raw)}
                </div>
              </div>
                      );
                    })}
            </div>
                </div>
              </div>
            </div>

            {/* Recommendations moved below UX Audit */}
          <div className="tile">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                  UX Audit Snapshot
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Severity legend"
                    onMouseEnter={() => setShowSevLegend(true)}
                    onMouseLeave={() => setShowSevLegend(false)}
                    onFocus={() => setShowSevLegend(true)}
                    onBlur={() => setShowSevLegend(false)}
                    onClick={() => setShowSevLegend(v => !v)}
                    style={{ display: 'inline-flex', alignItems: 'center', color: '#cbd5e1', cursor: 'pointer', position: 'relative' }}
                  >
                    <IconQuestionCircle width={16} height={16} />
                    {showSevLegend && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '120%',
                          transform: 'none',
                          width: 240,
                          background: 'rgba(2,6,23,0.94)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '8px 10px',
                          boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
                          zIndex: 30,
                          fontWeight: 400,
                        }}
                        onMouseEnter={() => setShowSevLegend(true)}
                        onMouseLeave={() => setShowSevLegend(false)}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>Severity legend</div>
                        <div className="muted" style={{ lineHeight: 1.45, fontSize: 12, fontWeight: 400 }}>
                          <div>S1 – Minor nuisance, low impact</div>
                          <div>S2 – Noticeable friction, occasional disruption</div>
                          <div>S3 – Significant usability issue, frequent disruption</div>
                          <div>S4 – Major blocker for many users</div>
                          <div>S5 – Critical blocker (prevents task completion)</div>
          </div>
          </div>
          )}
                  </span>
                </h4>
                <div role="tablist" aria-label="Audit mode" style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                  <button
                    role="tab"
                    aria-selected={auditMode==='pareto'}
                    onClick={()=>setAuditMode('pareto')}
                    style={{
                      padding: '6px 16px',
                      background: auditMode==='pareto' ? 'linear-gradient(135deg, #3B82F6, #2563EB)' : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      color: auditMode==='pareto' ? '#FFFFFF' : '#64748B',
                      fontWeight: auditMode==='pareto' ? 600 : 500,
                      cursor: 'pointer',
                      boxShadow: auditMode==='pareto' ? '0 2px 4px rgba(59, 130, 246, 0.3)' : 'none'
                    }}
                  >
                    Pareto
                  </button>
                  <button
                    role="tab"
                    aria-selected={auditMode==='severity'}
                    onClick={()=>setAuditMode('severity')}
                    style={{
                      padding: '6px 16px',
                      background: auditMode==='severity' ? 'linear-gradient(135deg, #3B82F6, #2563EB)' : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      color: auditMode==='severity' ? '#FFFFFF' : '#64748B',
                      fontWeight: auditMode==='severity' ? 600 : 500,
                      cursor: 'pointer',
                      boxShadow: auditMode==='severity' ? '0 2px 4px rgba(59, 130, 246, 0.3)' : 'none'
                    }}
                  >
                    Severity
                  </button>
                      </div>
                  </div>
              {(!auditIssues.length && !(metrics?.llm_run_insights?.themes||[]).length) && <div className="muted">No audit issues</div>}
              {auditIssues.length > 0 && (
                <div className="muted" style={{ margin: '6px 0 8px' }}>
                  {(function(){
                    const ranked = auditIssues.slice().sort((a:any,b:any)=>b.count-a.count);
                    const top = ranked[0];
                    const total = ranked.reduce((s:any,n:any)=>s+Number(n.count||0),0) || 1;
                    const pct = Math.round((Number(top?.count||0)/total)*100);
                    const name = (top?.label ? (HEURISTIC_DISPLAY[top.label]?.label || top.label) : '—');
                    return `Top issue: ${name} (${top?.count||0}, ${pct}%)`;
                  })()}
                </div>
              )}
              {(auditMode==='pareto' && auditParetoOption) && (
                <ReactECharts
                  onChartReady={(i:any)=>setChartRef(paretoRef, { getEchartsInstance: ()=>i })}
                  style={{ height: 360 }}
                  option={auditParetoOption}
                  onEvents={{
                    click: (params:any) => {
                      try {
                        const label = String(params?.name || '');
                        const full = Object.keys(HEURISTIC_DISPLAY).find(k => HEURISTIC_DISPLAY[k].label === label) || label;
                        setFbFilter(full.split(' ')[0]); // light filter seed
                      } catch {}
                    }
                  }}
                />
              )}
              {(auditMode==='severity' && auditSeverityOption) && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  {(['S1','S2','S3','S4','S5'] as const).map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSeverity(key)}
                      aria-pressed={sevVisible[key]}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        border: `1px solid rgba(148,163,184,${sevVisible[key]?0.35:0.18})`,
                        background: sevVisible[key]
                          ? 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))'
                          : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
                        color: '#e5e7eb',
                        padding: '6px 10px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontSize: 12 as any,
                        fontWeight: (700 as any),
                      }}
                      title={key}
                    >
                      <span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, background: SEVERITY_COLORS[key], display: 'inline-block', boxShadow: '0 0 0 1px rgba(0,0,0,0.25) inset' }} />
                      {key}
                    </button>
                  ))}
          </div>
                <ReactECharts onChartReady={(i:any)=>setChartRef(severityRef, { getEchartsInstance: ()=>i })} style={{ height: 360 }} option={auditSeverityOption} />
              </>
              )}
              {auditRows.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>Audit Details (per screen)</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: '#cbd5e1' }}>
                          <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>Screen</th>
                          <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>Enters</th>
                          <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>Exits</th>
                          <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>Dwell (ms)</th>
                          {(['S1','S2','S3','S4','S5'] as const).map(k => (
                            <th key={k} style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>{k}</th>
                          ))}
                          <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>Top Categories</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRows.map((r:any, i:number) => {
                          const cats = Object.entries(r.categories||{}).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).slice(0,3).map(([k,v])=>`${k||'unknown'}×${v}`).join(', ');
                          return (
                            <tr key={String(r.screenId||i)} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 34, height: 26, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                  {r.image ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt="scr" src={resolveApiUrl(r.image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : null}
                                </div>
                                <span>{r.name || r.screenId}</span>
                              </td>
                              <td style={{ padding: '8px 6px' }}>{r.enters}</td>
                              <td style={{ padding: '8px 6px' }}>{r.exits}</td>
                              <td style={{ padding: '8px 6px' }}>{r.dwellMs}</td>
                              {(['S1','S2','S3','S4','S5'] as const).map(k => (
                                <td key={k} style={{ padding: '8px 6px' }}>{(r.severity||{})[k] ?? 0}</td>
                              ))}
                              <td style={{ padding: '8px 6px' }}>{cats}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {auditSignals.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>Recent Signals</div>
                  <div className="grid" style={{ gap: 10 }}>
                    {auditSignals.map((s:any, i:number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.03)' }}>
                        <span className="badge" style={{ color: '#e5e7eb' }}>{String(s.category||'').replace(/_/g,' ')}</span>
                        <span className="muted">{s.screen}</span>
                        <span className="muted" style={{ marginLeft: 'auto' }}>S{Math.max(1,Math.min(5,Number(s.severity||1)))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>

            {/* removed status helper link per request */}
            </>
            )}
          </>
          )}

          {tab === 'overview' && (
          <>
          {/* Recommendations (grouped by screen) */}
          <div className="tile" style={{ transition: 'none' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0 }}>Recommendations</h4>
            </div>

            {/* Persona & Theme filter chips */}
            {(() => {
              // Extract unique personas from all recommendations (dynamic)
              const personaSet = new Set<string>();

              recommendationsByScreen.forEach(group => {
                group.items.forEach(item => {
                  if (Array.isArray(item.personas)) {
                    item.personas.forEach(p => {
                      personaSet.add(p);
                    });
                  }
                });
              });

              const uniquePersonas = Array.from(personaSet);
              // Fixed theme chips
              const themeChips = ['Clarity', 'Confidence', 'Recovery', 'Delight'];

              if (uniquePersonas.length > 0) {
                return (
                  <div className="filters" style={{ marginTop: 12 }}>
                    {/* Filter icon */}
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.6 }}>
                      <path d="M2 3h12M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>

                    {/* Persona chips - dynamically show all personas */}
                    <span className="filters__label">Personas:</span>
                    {uniquePersonas.map((persona, idx) => (
                      <button
                        key={idx}
                        className={`chip ${getPersonaChipClass(persona)} ${selectedPersonaFilters.has(persona) ? 'is-active' : ''}`}
                        onClick={() => {
                          const newFilters = new Set(selectedPersonaFilters);
                          if (newFilters.has(persona)) {
                            newFilters.delete(persona);
                          } else {
                            newFilters.add(persona);
                          }
                          setSelectedPersonaFilters(newFilters);
                        }}
                      >
                        {persona}
                      </button>
                    ))}

                    {/* Divider between personas and themes */}
                    <span className="filters__divider" />

                    {/* Theme chips - fixed list, always shown but disabled */}
                    <span className="filters__label">Themes:</span>
                    {themeChips.map((theme, idx) => (
                      <button
                        key={idx}
                        className={`chip ${getThemeChipClass(theme)}`}
                        disabled
                        style={{ opacity: 0.5, cursor: 'not-allowed' }}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                );
              }
              return null;
            })()}
            {recommendationsByScreen.length === 0 && recommendations.length === 0 && (
              <div className="muted">No recommendations yet</div>
            )}
            {/* Grouped accordion */}
            {recommendationsByScreen.length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 12 }}>
                {(() => {
                  // Filter groups and items by selected personas (multi-select)
                  const groups = recommendationsByScreen
                    .map(g => ({
                      ...g,
                      items: g.items.filter(item => {
                        // If no filters selected, show all
                        if (selectedPersonaFilters.size === 0) return true;
                        // If filters selected, item must have at least one matching persona
                        if (!Array.isArray(item.personas)) return false;
                        return item.personas.some(p => selectedPersonaFilters.has(p));
                      })
                    }))
                    .filter(g => g.items.length > 0);

                  // Always show all recommendations
                  return groups.map((g, gi) => {
                    const sectionKey = `${g.screenId||gi}`;
                    const isCollapsed = collapsedSections.has(sectionKey);

                    return (
                    <div key={`recg-${sectionKey}`} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto auto', gap: 10, alignItems: 'center', padding: '10px 12px', borderBottom: isCollapsed ? 'none' : '1px solid rgba(148,163,184,0.12)' }}>
                        <div
                          style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: g.image ? 'zoom-in' : 'default' }}
                          onClick={(e) => { e.stopPropagation(); if (g.image) setPreviewImg(resolveApiUrl(String(g.image))); }}
                        >
                          {g.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={g.name||'screen'} src={resolveApiUrl(String(g.image))} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ color: '#94a3b8', fontSize: 10 }}>image</div>
                          )}
                        </div>
                        <div style={{ fontWeight: 800, color: '#0F172A' }}>{g.name || `Screen ${g.screenId}`}</div>
                        <div>
                          {g.totalCount ? (
                            <span className="muted" style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '2px 10px' }}>×{g.totalCount}</span>
                          ) : null}
                        </div>
                        {/* Expand/Collapse arrow */}
                        <button
                          onClick={() => {
                            const newCollapsed = new Set(collapsedSections);
                            if (isCollapsed) {
                              newCollapsed.delete(sectionKey);
                            } else {
                              newCollapsed.add(sectionKey);
                            }
                            setCollapsedSections(newCollapsed);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#475569',
                            transition: 'transform 0.2s ease'
                          }}
                        >
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s ease' }}>
                            <path d="M5 12.5L10 7.5L15 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                      {!isCollapsed && Array.isArray(g.items) && g.items.length > 0 && (
                        <div style={{ padding: '0 12px 12px 12px', display: 'grid', gap: 6 }}>
                          {g.items.map((r, i) => {
                            // Random P1/P2/P3 assignment
                            const priorities = ['P1', 'P2', 'P3'];
                            const randomPriority = priorities[i % 3];

                            return (
                              <div key={`recl-${gi}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 10, minHeight: 44 }}>
                                <div style={{ color: '#0F172A', flex: 1, lineHeight: 1.5 }}>
                                  {beautifyRecommendation(r.text)}
                                  {' '}
                                  {Array.isArray(r.personas) && r.personas.map((persona: string, pi: number) => (
                                    <span key={pi} className={`chip ${getPersonaChipClass(persona)}`} style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
                                      {persona} • {r.count || 0}
                                    </span>
                                  ))}
                                </div>

                                {/* Theme chip on extreme right (disabled) */}
                                <span className="chip" style={{ fontSize: 11, padding: '3px 8px', opacity: 0.5, cursor: 'not-allowed', flexShrink: 0 }}>
                                  {randomPriority}
                                </span>
                              </div>
                            );
                          })}

                          {/* CTAs at end of section */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                className="btn-gradient btn-sm"
                                onClick={() => {/* Play Clip logic */}}
                                style={{ fontSize: 13 }}
                              >
                                Play Clip
                              </button>
                              <button
                                className="btn-gradient btn-sm"
                                onClick={() => {/* Detailed TEA logic */}}
                                style={{ fontSize: 13 }}
                              >
                                Detailed TEA
                              </button>
                            </div>
                            <button
                              className="btn-primary btn-sm"
                              onClick={() => {/* Send to Backlog logic */}}
                              style={{ fontSize: 13 }}
                            >
                              Send to Backlog
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  });
                })()}
              </div>
            )}
            {/* Flat legacy list as fallback */}
            {recommendationsByScreen.length === 0 && recommendations.length > 0 && (
              <div style={{ marginTop: 6, display: 'grid', gap: 12 }}>
                {recommendations.map((r, i) => (
                  <div key={`rec-${i}`} style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 10, alignItems: 'start' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)', cursor: r.image ? 'zoom-in' : 'default' }} onClick={() => { if (r.image) setPreviewImg(resolveApiUrl(r.image)); }}>
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="rec" src={resolveApiUrl(r.image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 10 }}>image</div>
                      )}
                    </div>
                    <div style={{ lineHeight: 1.5 }}>
                      <div style={{ color: '#e5e7eb' }}>{beautifyRecommendation(r.text)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', height: 48, justifyContent: 'flex-end' }}>
                      {r.count ? (
                        <span title="occurrences" style={{
                          border: '1px solid rgba(148,163,184,0.25)',
                          background: 'rgba(255,255,255,0.05)',
                          color: '#cbd5e1',
                          padding: '2px 10px',
                          borderRadius: 999,
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: 36,
                          textAlign: 'center'
                        }}>×{r.count}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
            )}

          {tab === 'persona' && (
            <>
              <div className="tile">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>Persona Cards</h4>
                  <div role="tablist" aria-label="Density" style={{ position: 'relative', display: 'inline-grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                    <span aria-hidden style={{ position: 'absolute', top: 2, bottom: 2, left: (personaDensity==='comfortable' ? 2 : '50%'), width: 'calc(50% - 4px)', background: 'linear-gradient(180deg, rgba(59,130,246,0.25), rgba(59,130,246,0.12))', borderRadius: 999, transition: 'left .18s ease' }} />
                    <button role="tab" aria-selected={personaDensity==='comfortable'} onClick={()=>setPersonaDensity('comfortable')} style={{ padding: '6px 14px', background: 'transparent', border: 'none', color: '#e5e7eb', cursor: 'pointer', zIndex: 1, fontSize: 12 }}>Comfortable</button>
                    <button role="tab" aria-selected={personaDensity==='compact'} onClick={()=>setPersonaDensity('compact')} style={{ padding: '6px 14px', background: 'transparent', border: 'none', color: '#e5e7eb', cursor: 'pointer', zIndex: 1, fontSize: 12 }}>Compact</button>
                  </div>
                </div>
                {personaLoading && <div className="muted" style={{ marginTop: 8 }}>Loading personas…</div>}
                {personaError && <div className="muted" style={{ marginTop: 8, color: '#fca5a5' }}>{personaError}</div>}
                {!personaLoading && personaCards.length === 0 && <div className="muted" style={{ marginTop: 8 }}>No personas found</div>}
                {personaCards.length > 0 && (
                  <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: (personaDensity==='compact'?10:16), marginTop: 12 }}>
                    {personaCards.map((p) => {
                      console.log('Rendering persona card:', p);
                      return (
                      <button key={p.persona_id}
                        onClick={(e) => { e.stopPropagation(); setOpenPersonaId(p.persona_id); loadPersonaDetail(String(runQuery || lastRequested), p.persona_id); }}
                        style={{ 
                          textAlign: 'left' as any, 
                          border: '1px solid var(--border)', 
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))', 
                          color: '#e5e7eb', 
                          borderRadius: (personaDensity==='compact'?10:12), 
                          padding: (personaDensity==='compact'?'12px 14px':'16px 18px'), 
                          cursor: 'pointer', 
                          boxShadow: '0 6px 22px rgba(0,0,0,0.28)',
                          transition: 'all 0.2s ease',
                          position: 'relative',
                          overflow: 'hidden',
                          backdropFilter: 'saturate(120%) blur(6px)',
                          WebkitBackdropFilter: 'saturate(120%) blur(6px)'
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget.style as any).boxShadow = '0 10px 28px rgba(0,0,0,0.38)';
                          (e.currentTarget.style as any).transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget.style as any).boxShadow = '0 6px 22px rgba(0,0,0,0.28)';
                          (e.currentTarget.style as any).transform = 'translateY(0)';
                        }}>
                        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                          {/* subtle top highlight sweep */}
                          <span style={{ position: 'absolute', left: -40, right: -40, top: -20, height: 56, background: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))', filter: 'blur(18px)', opacity: 0.25 }} />
                          {/* thin accent bar on left */}
                          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg, rgba(147,197,253,0.55), rgba(34,211,238,0.35))' }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: (personaDensity==='compact'?2:4) }}>
                          <div style={{ fontWeight: 900, fontSize: (personaDensity==='compact'?16:18), letterSpacing: '0.3px' }}>{p.persona_name || `Persona #${p.persona_id}`}</div>
                          </div>
                        {/* floating completion pill */}
                        <span className="badge" style={{ 
                          position: 'absolute',
                          top: 10,
                          right: 12,
                          background: p.completion_pct >= 100 ? 'rgba(52,211,153,0.18)' : p.completion_pct >= 80 ? 'rgba(34,211,238,0.18)' : 'rgba(245,158,11,0.18)', 
                          border: p.completion_pct >= 100 ? '1px solid rgba(52,211,153,0.45)' : p.completion_pct >= 80 ? '1px solid rgba(34,211,238,0.45)' : '1px solid rgba(245,158,11,0.45)', 
                          color: p.completion_pct >= 100 ? '#34D399' : p.completion_pct >= 80 ? '#22d3ee' : '#F59E0B',
                          fontWeight: 800,
                          fontSize: 12,
                          padding: '4px 10px',
                          borderRadius: 999,
                          boxShadow: p.completion_pct >= 100 
                            ? '0 0 0 3px rgba(52,211,153,0.06), 0 4px 16px rgba(52,211,153,0.16)'
                            : p.completion_pct >= 80 
                              ? '0 0 0 3px rgba(34,211,238,0.06), 0 4px 16px rgba(34,211,238,0.16)'
                              : '0 0 0 3px rgba(245,158,11,0.06), 0 4px 16px rgba(245,158,11,0.16)'
                        }}>{p.completion_pct}%</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: (personaDensity==='compact'?8:12), marginTop: (personaDensity==='compact'?8:12) }}>
                          <div style={{ 
                            background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))', 
                            borderRadius: 10, 
                            padding: '10px 12px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            backdropFilter: 'blur(4px)',
                            WebkitBackdropFilter: 'blur(4px)'
                          }}>
                            <div className="muted" style={{ fontSize: (personaDensity==='compact'?10:11), fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#60A5FA' }} />
                              Avg Steps
                          </div>
                            <div style={{ fontWeight: 900, fontSize: (personaDensity==='compact'?18:20), color: '#60A5FA', marginTop: 2 }}>{p.avg_steps}</div>
                          </div>
                          <div style={{ 
                            background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))', 
                            borderRadius: 10, 
                            padding: '10px 12px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            backdropFilter: 'blur(4px)',
                            WebkitBackdropFilter: 'blur(4px)'
                          }}>
                            <div className="muted" style={{ fontSize: (personaDensity==='compact'?10:11), fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: (p.dropoffs > 0 ? '#F87171' : '#34D399') }} />
                              Drop-offs
                          </div>
                            <div style={{ fontWeight: 900, fontSize: (personaDensity==='compact'?18:20), color: p.dropoffs > 0 ? '#F87171' : '#34D399', marginTop: 2 }}>{p.dropoffs}</div>
                        </div>
                          <div style={{ 
                            background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))', 
                            borderRadius: 10, 
                            padding: '10px 12px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            backdropFilter: 'blur(4px)',
                            WebkitBackdropFilter: 'blur(4px)'
                          }}>
                            <div className="muted" style={{ fontSize: (personaDensity==='compact'?10:11), fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: (p.friction_pct > 0 ? '#F59E0B' : '#34D399') }} />
                              Friction %
                            </div>
                            <div style={{ fontWeight: 900, fontSize: (personaDensity==='compact'?18:20), color: p.friction_pct > 0 ? '#F59E0B' : '#34D399', marginTop: 2 }}>{p.friction_pct}%</div>
                          </div>
                          <div title={(p.drift == null ? 'No TEA sentiment available for this persona/run' : `Start ${p.sentiment_start?.toFixed?.(2)}, End ${p.sentiment_end?.toFixed?.(2)}, Δ ${(p.drift>0?'+':'')}${p.drift?.toFixed?.(2)}`)}
                            style={{ 
                              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))', 
                              borderRadius: 10, 
                              padding: '10px 12px',
                              border: '1px solid rgba(255,255,255,0.06)',
                              backdropFilter: 'blur(4px)',
                              WebkitBackdropFilter: 'blur(4px)'
                            }}>
                            <div className="muted" style={{ fontSize: (personaDensity==='compact'?10:11), fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Drift</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: (personaDensity==='compact'?6:8), marginTop: 2 }}>
                              {/* tiny 2-point sparkline */}
                              <svg width="46" height="14" viewBox="0 0 46 14" preserveAspectRatio="none" aria-hidden>
                                {typeof p.sentiment_start === 'number' && typeof p.sentiment_end === 'number' ? (
                                  <>
                                    <polyline
                                      fill="none"
                                      stroke="#93c5fd"
                                      strokeWidth="2"
                                      points={(function(){
                                        const s0 = Number(p.sentiment_start||0); const s1 = Number(p.sentiment_end||0);
                                        // normalize into [2,12]
                                        const min = Math.min(s0, s1, -1);
                                        const max = Math.max(s0, s1, 1);
                                        const y = (v:number)=>{
                                          const t = (v - min) / Math.max(0.0001, (max - min));
                                          return 12 - t * 10; // 2..12 padding
                                        };
                                        const p0 = `2,${y(s0).toFixed(2)}`;
                                        const p1 = `44,${y(s1).toFixed(2)}`;
                                        return `${p0} ${p1}`;
                                      })()}
                                    />
                                  </>
                                ) : null}
                              </svg>
                              <div style={{ fontWeight: 800, fontSize: (personaDensity==='compact'?18:20), color: (typeof p.drift === 'number' ? (p.drift > 0 ? '#34d399' : (p.drift < 0 ? '#f87171' : '#e5e7eb')) : '#9ca3af') }}>
                                {typeof p.drift === 'number' ? (p.drift > 0 ? `+${p.drift.toFixed(2)}` : p.drift.toFixed(2)) : 'N/A'}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="muted" style={{ 
                          fontSize: 11, 
                          marginTop: (personaDensity==='compact'?8:12), 
                          textAlign: 'center',
                          opacity: 0.7,
                          fontStyle: 'italic',
                          letterSpacing: '0.3px'
                        }}>Click for detailed TEA analysis and user paths</div>
                      </button>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>

              {openPersonaId && (
                <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10060, display: 'flex', justifyContent: 'flex-end' }} onClick={() => { setOpenPersonaId(null); setPersonaDetail(null); }}>
                  <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(860px, 92vw)', height: '100%', background: 'rgba(17,24,39,0.96)', borderLeft: '1px solid var(--border)', boxShadow: '0 0 40px rgba(0,0,0,0.5)', padding: 16, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ margin: 0 }}>{personaCards.find(p => p.persona_id === openPersonaId)?.persona_name || `Persona #${openPersonaId}`}</h3>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          title="Download Excel"
                          onClick={() => {
                            try {
                              const runId = String(runQuery || lastRequested || '').trim();
                              if (!runId || !openPersonaId) return;
                              const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
                              const a = document.createElement('a');
                              const qs = new URLSearchParams({ runId, personaId: String(openPersonaId), format: 'xlsx', ...(token ? { token } : {}) }).toString();
                              a.href = `/api/persona_detail?${qs}`;
                              a.download = '';
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            } catch {}
                          }}
                          className="btn-ghost btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, padding: 0, borderRadius: 999, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(2,6,23,0.55)', boxShadow: '0 8px 18px rgba(0,0,0,0.30)' }}
                          aria-label="Download Excel"
                        >
                          <IconDownload width={17} height={17} />
                        </button>
                        {/* Removed "View full report" per request */}
                        <button
                          onClick={() => { setOpenPersonaId(null); setPersonaDetail(null); setSelectedBacktrack(null); }}
                          className="btn-ghost btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, padding: 0 }}
                          aria-label="Close"
                          title="Close"
                        >
                          <IconX width={16} height={16} />
                        </button>
                      </div>
                    </div>
                    {personaDetailLoading && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
                    {(!personaDetailLoading && !personaDetail) && <div className="muted" style={{ marginTop: 8 }}>No detail</div>}
                    {personaDetail && (
                      <>
                        {/* Emotion mix */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <h4>Emotion Mix</h4>
                          <ReactECharts style={{ height: 260 }} option={(function(){
                            // Prefer DB TEA aggregate; if empty, fall back to journey emotions array
                            const teaEmo = (personaDetail?.tea?.emotions && typeof personaDetail.tea.emotions === 'object') ? personaDetail.tea.emotions : {};
                            const hasTea = Object.keys(teaEmo || {}).length > 0;
                            const pretty = (s: string) => String(s || '')
                              .replace(/_/g, ' ')
                              .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
                            const journeyArr: Array<{ name?: string; count?: number; color?: string; emoji?: string; }>
                              = Array.isArray((personaDetail as any)?.emotions) ? (personaDetail as any).emotions : [];
                            const colorByName: Record<string, { color?: string; emoji?: string; }>
                              = (journeyArr || []).reduce((acc:any, e:any) => { acc[String(e?.name||'').toLowerCase()] = { color: e?.color, emoji: e?.emoji }; return acc; }, {});

                            // Build pairs and sort desc
                            let pairs: Array<{ name: string; value: number; color?: string; emoji?: string }>; 
                            if (hasTea) {
                              pairs = Object.keys(teaEmo || {}).map((k) => {
                                const key = String(k||'');
                                const meta = colorByName[key.toLowerCase()] || {};
                                return { name: pretty(key), value: Number((teaEmo as any)[k] || 0), color: meta.color, emoji: meta.emoji };
                              });
                            } else {
                              pairs = (journeyArr || []).map((e:any) => ({ name: pretty(String(e?.name||'')), value: Number(e?.count||0), color: e?.color, emoji: e?.emoji }));
                            }
                            pairs = pairs.filter(p => Number.isFinite(p.value) && p.value > 0).sort((a,b)=>b.value-a.value);
                            const total = pairs.reduce((s,p)=> s + p.value, 0);
                            const labels = pairs.map(p => (p.emoji ? `${p.emoji} ${p.name}` : p.name));
                            const seriesData = pairs.map((p, i) => ({
                              value: p.value,
                              itemStyle: { color: p.color || CHART_PALETTE[i % CHART_PALETTE.length], borderRadius: [4,4,4,4] },
                            }));

                            return {
                              backgroundColor: 'transparent',
                              grid: { left: 140, right: 24, top: 24, bottom: 40 },
                              xAxis: {
                                type: 'value',
                                name: 'Users',
                                nameTextStyle: { color: '#cbd5e1' },
                                nameGap: 16,
                                axisLabel: { color: '#cbd5e1' },
                                splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.15)' } },
                              },
                              yAxis: {
                                type: 'category',
                                name: 'Emotion',
                                nameTextStyle: { color: '#cbd5e1' },
                                nameGap: 10,
                                data: labels,
                                axisLabel: { color: '#cbd5e1', interval: 0, width: 120 as any, overflow: 'truncate' as any, lineHeight: 18 as any, margin: 10 as any },
                              },
                              series: [{ 
                                type: 'bar', 
                                data: seriesData, 
                                barWidth: 16,
                                label: {
                                  show: true,
                                  position: 'right',
                                  color: '#e5e7eb',
                                  fontSize: 11,
                                  formatter: (p:any) => {
                                    const v = Number(p?.value||0);
                                    const pct = total>0 ? ((v/total)*100).toFixed(1) : '0.0';
                                    return `${v} (${pct}%)`;
                                  },
                                },
                              }],
                              tooltip: { 
                                trigger: 'item', 
                                backgroundColor: 'rgba(2,6,23,0.92)',
                                borderColor: 'rgba(148,163,184,0.25)',
                                textStyle: { color: '#e5e7eb' },
                                formatter: (p: any) => {
                                  const v = Number(p.value)||0;
                                  const pct = total>0 ? ((v/total)*100).toFixed(1) : '0.0';
                                  return `${p.name}: <b>${v}</b> users (${pct}%)`;
                                }
                              }
                            };
                          })()} />
                        </div>

                        {/* Emotion Mix */}
                        {Array.isArray((personaDetail as any)?.emotions) && (personaDetail as any).emotions.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <EmotionMix
                              emotions={Array.isArray((personaDetail as any).emotions) ? (personaDetail as any).emotions : []}
                              emotionJourney={Array.isArray((personaDetail as any).emotion_journey) ? (personaDetail as any).emotion_journey : []}
                            />
                          </div>
                        )}

                        {/* Sentiment drift */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <h4>Sentiment Drift</h4>
                          <ReactECharts style={{ height: 220 }} option={(function(){
                            const seriesData = Array.isArray((personaDetail as any)?.sentiment_series)
                              ? ((personaDetail as any).sentiment_series as Array<{ idx:number; valence:number; screen_name?:string }> )
                              : [];
                            const xs = seriesData.length > 1
                              ? seriesData.map((p,i)=> p.screen_name || `#${i+1}`)
                              : ['Start','End'];
                            const ys = seriesData.length > 1
                              ? seriesData.map(p=> Number(p.valence ?? 0.5))
                              : [Number(personaDetail?.tea?.sentiment_start ?? 0), Number(personaDetail?.tea?.sentiment_end ?? 0)];
                            const s0 = ys[0] ?? 0;
                            const s1 = ys[ys.length-1] ?? 0;
                            const base = 0.5;
                            return {
                              backgroundColor: 'transparent',
                              grid: { left: 60, right: 20, top: 20, bottom: 50 },
                              xAxis: { 
                                type: 'category', 
                                data: xs, 
                                axisLabel: { color: '#cbd5e1', interval: (seriesData.length>8? 'auto' : 0) },
                                name: (seriesData.length>1 ? 'Screens' : 'Test Phase'),
                                nameLocation: 'middle',
                                nameGap: 25,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 }
                              },
                              yAxis: { 
                                type: 'value', 
                                min: 0, max: 1,
                                axisLabel: { color: '#cbd5e1' },
                                splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } },
                                name: 'Sentiment Score',
                                nameLocation: 'middle',
                                nameGap: 40,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 }
                              },
                              series: [{ 
                                type: 'line', 
                                data: ys, 
                                smooth: true, 
                                lineStyle: { width: 3, color: (s1 - s0 >= 0 ? '#34D399' : '#F87171') }, 
                                areaStyle: { color: (s1 - s0 >= 0 ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)') },
                                symbol: 'circle',
                                symbolSize: 6,
                                itemStyle: { color: '#93c5fd' }
                              }, {
                                // baseline at 0.5
                                type: 'line',
                                data: ys.map(()=> base),
                                smooth: false,
                                lineStyle: { width: 1, color: 'rgba(148,163,184,0.35)', type: 'dashed' },
                                symbol: 'none',
                                tooltip: { show: false }
                              }],
                              tooltip: { 
                                trigger: 'axis',
                                formatter: (params: any) => {
                                  try {
                                    const param = Array.isArray(params) ? params[0] : params;
                                    const phase = param?.name ?? '';
                                    const rawVal = param?.value;
                                    const valNum = typeof rawVal === 'number' ? rawVal : Number(rawVal);
                                    const valText = Number.isFinite(valNum) ? valNum.toFixed(3) : String(rawVal ?? '0');
                                    const change = s1 - s0;
                                    const direction = change > 0 ? '↑' : change < 0 ? '↓' : '→';
                                    return `${phase}: ${valText}<br/>Δ ${direction} ${Math.abs(change).toFixed(3)}`;
                                  } catch {
                                    return '';
                                  }
                                }
                              },
                            };
                          })()} />
                        </div>

                        {/* Flow Insights (Sankey + Trendlines + Ranked List) */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0 }}>Flow Insights</h4>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <label className="muted" style={{ fontSize: 12 }}>Runs:</label>
                              <div style={{ width: 90 }}>
                                <FancySelect
                                  value={String(flowRunWindow)}
                                  onChange={(v)=>setFlowRunWindow(Number(v)||1)}
                                  options={[1,4,6,8,10].map(n=>({ value: String(n), label: String(n) }))}
                                  searchable={false}
                                />
                              </div>
                              <div role="tablist" aria-label="Paths scope" style={{ position:'relative', display:'inline-grid', gridTemplateColumns:'1fr 1fr', border:'1px solid var(--border)', borderRadius:999, overflow:'hidden' }}>
                                <span aria-hidden style={{ position:'absolute', top:2, bottom:2, left: (flowShowAll==='top'?2:'50%'), width:'calc(50% - 4px)', background:'linear-gradient(180deg, rgba(59,130,246,0.25), rgba(59,130,246,0.12))', borderRadius:999, transition:'left .18s ease' }} />
                                <button role="tab" aria-selected={flowShowAll==='top'} onClick={()=>setFlowShowAll('top')} style={{ padding:'6px 12px', background:'transparent', border:'none', color:'#e5e7eb', cursor:'pointer', zIndex:1, fontSize:12 }}>Top 5</button>
                                <button role="tab" aria-selected={flowShowAll==='all'} onClick={()=>setFlowShowAll('all')} style={{ padding:'6px 12px', background:'transparent', border:'none', color:'#e5e7eb', cursor:'pointer', zIndex:1, fontSize:12 }}>All</button>
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                            Top navigation paths, how they connect between screens, and how each path's share changes across recent runs.
                          </div>
                          <div style={{ display: 'grid', gap: 12 }}>
                            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                            <FlowSankey
                              paths={(personaDetail?.paths || []).slice(0, flowShowAll==='top'?5:Infinity)}
                              totalUsers={Number((personaDetail as any)?.tea?.users_total || (personaDetail as any)?.users_total || (personaCards.find(p=>p.persona_id===openPersonaId) as any)?.users_total || 0)}
                              hoveredPath={flowHoverPath}
                              selectedPath={flowSelectedPath}
                              onHover={setFlowHoverPath}
                              onSelect={(p)=>setFlowSelectedPath(p)}
                            />
                            </div>
                            <div style={{ borderTop: '1px dashed rgba(148,163,184,0.18)' }} />
                            <PathShareTrend
                              runs={flowRuns}
                              series={flowSeries}
                              hoveredPath={flowHoverPath}
                              onHover={setFlowHoverPath}
                            />
                            {(personaDetail?.paths || []).length > 0 && (
                              <div style={{ overflowX: 'auto' }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: '2px 0 8px' }}>Path Distribution</div>
                                <PathRankList
                                  items={(function(){
                                    const arr = (personaDetail?.paths || []);
                                    if (flowShowAll==='all') return arr;
                                    const top = arr.slice(0,5);
                                    const rest = arr.slice(5);
                                    const totalOther = rest.reduce((s:any,it:any)=> s + Number(it.sharePct||0), 0);
                                    const usersOther = rest.reduce((s:any,it:any)=> s + Number(it.count||0), 0);
                                    if (rest.length>0) top.push({ path: 'Other', sharePct: Math.round(totalOther*10)/10, count: usersOther });
                                    return top;
                                  })()}
                                  hoveredPath={flowHoverPath}
                                  selectedPath={flowSelectedPath}
                                  onHover={setFlowHoverPath}
                                  onSelect={(p)=>setFlowSelectedPath(p)}
                                />
                            </div>
                          )}
                          </div>
                        </div>

                        {/* Exits */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                            <h4 style={{ margin: 0 }}>Drop‑off Reasons</h4>
                          </div>
                          <ReactECharts style={{ height: 220 }} option={(function(){
                            const items: Array<{reason:string; count:number}> = personaDetail?.exits || [];
                            const labels = items.map(i=>i.reason);
                            const vals = items.map(i=>Number(i.count||0));
                            const total = vals.reduce((sum, val) => sum + val, 0);
                            
                            // Handle empty data case
                            if (items.length === 0 || (items.length === 1 && items[0].reason === 'No drop-offs recorded')) {
                              // Render an empty chart and let overlay show message
                              return { grid:{}, xAxis:{show:false}, yAxis:{show:false}, series:[] } as any;
                            }
                            
                            const maxLabelLen = labels.reduce((m, s) => Math.max(m, String(s || '').length), 0);
                            const estWidth = Math.min(320, Math.max(180, Math.round(maxLabelLen * 7)));
                            return { 
                              backgroundColor: 'transparent', 
                              grid: { left: estWidth + 30, right: 20, top: 40, bottom: 50 }, 
                              xAxis: { 
                                type:'value', 
                                axisLabel:{ color:'#cbd5e1' },
                                name: 'Number of Users',
                                nameLocation: 'middle',
                                nameGap: 25,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 }
                              }, 
                              yAxis:{ 
                                type:'category', 
                                data: labels, 
                                axisLabel:{ color:'#cbd5e1', interval: 0 as any, width: estWidth as any, overflow: 'break' as any, lineHeight: 16 as any, margin: 10 as any }
                              }, 
                              series:[{ 
                                type:'bar', 
                                data: vals, 
                                itemStyle:{ color:'#f59e0b', borderRadius:[4,4,4,4] } 
                              }], 
                              tooltip:{ 
                                trigger:'item',
                                formatter: (params: any) => {
                                  const count = Number(params.value) || 0;
                                  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
                                  return `${params.name}: ${count} users (${percentage}%)`;
                                }
                              } 
                            };
                          })()} />
                          {(function(){
                            const items: Array<{reason:string; count:number}> = personaDetail?.exits || [];
                            if (items.length === 0 || (items.length === 1 && items[0].reason === 'No drop-offs recorded')) {
                              return (
                                <div style={{ height: 220, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div className="muted" style={{ fontSize: 12 }}>No data available</div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        {/* Backtracks by screen */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0 }}>Backtracks by Screen</h4>
                            {selectedBacktrack && (
                              <button className="btn-ghost btn-sm" onClick={() => setSelectedBacktrack(null)}>Back</button>
                            )}
                          </div>
                          {!selectedBacktrack ? (
                            <ReactECharts
                              style={{ height: 280 }}
                              option={(function(){
                            const items: Array<{screen:string; count:number}> = personaDetail?.backtracks_by_screen || [];
                            if (!items || items.length === 0) {
                              return { grid:{}, xAxis:{show:false}, yAxis:{show:false}, series:[] } as any;
                            }
                            const files: Array<{id:number; name:string; image?:string}> = (personaDetail?.screen_files || []) as any;
                            const toFriendly = (s: string): string => {
                              const raw = String(s || '');
                              if (/^\d+$/.test(raw)) {
                                const id = Number(raw);
                                const f = files.find(ff => Number(ff?.id) === id);
                                return f?.name ? String(f.name) : raw;
                              }
                              return raw;
                            };
                            const labelsFull = items.map(i=>toFriendly(i.screen));
                            const vals = items.map(i=>Number(i.count||0));
                            // Word-wrap helper: break on spaces and slashes into up to 3 lines
                            const wrapLabel = (s: string) => {
                              const words = String(s).replace(/\//g, ' / ').split(/\s+/);
                              const lines: string[] = [];
                              let line = '';
                              for (const w of words) {
                                const next = (line + ' ' + w).trim();
                                if (next.length > 16) { lines.push(line.trim()); line = w; }
                                else line = next;
                              }
                              if (line.trim()) lines.push(line.trim());
                              return lines.slice(0, 3).join('\n');
                            };
                            const total = vals.reduce((sum, val) => sum + val, 0);
                            return {
                              backgroundColor: 'transparent',
                              grid: { left: 50, right: 20, top: 30, bottom: 120 },
                              xAxis: { 
                                type:'category',
                                data: labelsFull,
                                axisLabel:{ color:'#cbd5e1', interval: 0, rotate: 0 as any, formatter: wrapLabel, lineHeight: 16 as any, margin: 12 as any },
                                name: 'Screen Name',
                                nameLocation: 'middle', 
                                nameGap: 60,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 },
                                triggerEvent: true,
                              },
                              yAxis:{ 
                                type:'value', 
                                name: 'Number of Backtracks', 
                                nameLocation: 'middle',
                                nameGap: 40,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 },
                                axisLabel:{ color:'#cbd5e1' } 
                              },
                              series:[{ 
                                type:'bar', 
                                data: vals, 
                                itemStyle:{ color:'#34d399', borderRadius:[4,4,0,0] } 
                              }],
                              tooltip:{ 
                                trigger:'item', 
                                formatter:(p:any)=> {
                                  const idx = p.dataIndex;
                                  const count = vals[idx];
                                  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
                                  const fullName = labelsFull[idx];
                                  return `${fullName}: ${count} backtracks (${percentage}%)`;
                                }
                              }
                            };
                              })()}
                              onEvents={{
                                click: (p: any) => {
                                  try {
                                      const items: Array<{screen:string; count:number}> = personaDetail?.backtracks_by_screen || [];
                                      const files: Array<{id:number; name:string; image?:string}> = (personaDetail?.screen_files || []) as any;
                                      const toFriendly = (s: string): string => {
                                        const raw = String(s || '');
                                        if (/^\d+$/.test(raw)) {
                                          const id = Number(raw);
                                          const f = files.find(ff => Number(ff?.id) === id);
                                          return f?.name ? String(f.name) : raw;
                                        }
                                        return raw;
                                      };
                                    if (p && p.componentType === 'xAxis' && typeof p.value !== 'undefined') {
                                      const axisLabel = String(p.value);
                                      const labels = items.map(i=>toFriendly(i.screen));
                                      const idx = labels.findIndex(l => l === axisLabel);
                                      if (idx >= 0) {
                                        const lab = labels[idx];
                                        const cnt = Number(items[idx]?.count || 0);
                                        setSelectedBacktrack({ name: String(lab), count: cnt });
                                      }
                                    } else if (p && p.componentType === 'series' && typeof p.dataIndex === 'number') {
                                      const lab = toFriendly((items[p.dataIndex]?.screen) || '');
                                      const cnt = Number(items[p.dataIndex]?.count || 0);
                                      setSelectedBacktrack({ name: String(lab), count: cnt });
                                    }
                                  } catch {}
                                }
                              }}
                            />
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'center', marginTop: 10 }}>
                              <div style={{ width: 220, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
                                {(() => {
                                  const files: Array<{id:number; name:string; image?:string}> = (personaDetail?.screen_files || []) as any;
                                  // If selected name is a numeric id, match by id too
                                  const maybeId = String(selectedBacktrack?.name || '').match(/^\d+$/) ? Number(selectedBacktrack?.name) : null;
                                  const found = files.find((f:any)=> String(f.name) === String(selectedBacktrack?.name));
                                  const foundById = maybeId != null ? (files.find(f => Number(f.id) === maybeId) as any) : null;
                                  const img = (found?.image || foundById?.image) ? resolveApiUrl((found?.image || foundById?.image) as string) : null;
                                  return img ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt={String(selectedBacktrack?.name||'screen')} src={img} style={{ display: 'block', width: '220px', height: 'auto' }} />
                                  ) : (
                                    <div style={{ height: 140, display: 'grid', placeItems: 'center' }} className="muted">no image</div>
                                  );
                                })()}
                              </div>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 18 }}>{selectedBacktrack?.name}</div>
                                <div className="muted" style={{ marginTop: 6 }}>Backtracks: <b>{selectedBacktrack?.count}</b></div>
                              </div>
                            </div>
                          )}
                          {(function(){
                            const items: Array<{screen:string; count:number}> = personaDetail?.backtracks_by_screen || [];
                            if (!items || items.length === 0) {
                              return (
                                <div style={{ height: 220, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  <div className="muted" style={{ fontSize: 12 }}>No data available</div>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        {/* Unique thoughts */}
                        <div className="tile" style={{ marginTop: 12 }}>
                          <h4>Unique TEA Thoughts</h4>
                          {Array.isArray((personaDetail as any)?.tea_thoughts) && (personaDetail as any).tea_thoughts.length > 0 ? (
  <div style={{ marginTop: 8 }}>
    <TeaThoughtTimeline teaThoughts={Array.isArray((personaDetail as any).tea_thoughts) ? (personaDetail as any).tea_thoughts : []} />
  </div>
                          ) : (
                            <div className="muted" style={{ marginTop: 8 }}>No thoughts</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 2vw' }}
        >
          <div style={{ position: 'relative', maxWidth: '96vw', maxHeight: '92vh', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset', background: 'rgba(17,24,39,0.9)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImg}
              alt="Screen"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '96vw',
                maxHeight: '92vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block'
              }}
            />
            <button
              onClick={() => setPreviewImg(null)}
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#e5e7eb', border: '1px solid rgba(229,231,235,0.2)', borderRadius: 999, padding: '6px 10px', cursor: 'pointer' }}
              aria-label="Close preview"
            >×</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, variant = 'plain', series = [], accent = '#60A5FA', subtitle }: { label: string, value: string, variant?: 'plain' | 'gauge' | 'spark', series?: number[], accent?: string, subtitle?: string }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 16,
        padding: 20,
        minHeight: 120,
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>{value}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>{subtitle}</div>
      )}
    </div>
  );
}

function Bar({ label, value, max, right, variant = 'plain', emphasis = false }: { label: string, value: number, max: number, right?: string, variant?: 'plain' | 'glossy' | 'ice', emphasis?: boolean }) {
  const pct = Math.max(4, Math.min(100, Math.round((value / (max || 1)) * 100)));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, alignItems: 'center' }}>
        <span className="muted" style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420,
          color: undefined, fontWeight: 600 as any
        }}>{label}</span>
        <span className="muted" style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 999, padding: '2px 8px', background: 'rgba(255,255,255,0.05)' }}>{right || value}</span>
      </div>
      {variant === 'glossy' ? (
        <div style={{ height: 12, background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(180,83,9,0.22)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, rgba(180,83,9,0.92), rgba(234,88,12,0.92))', boxShadow: '0 0 12px rgba(180,83,9,0.45)', borderRadius: 999 }} />
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: '50%', background: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0))', pointerEvents: 'none' }} />
        </div>
      ) : variant === 'ice' ? (
        <div style={{ height: 14, background: 'rgba(17,24,39,0.68)', border: '1px solid rgba(209,213,219,0.09)', borderRadius: 12, position: 'relative', overflow: 'hidden', boxShadow: '0 3px 12px rgba(0,0,0,0.25)' }}>
          <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, rgba(30,30,36,0.0), rgba(59,130,246,0.09))', position: 'absolute', inset: 0 }} />
          <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, rgba(236,72,153,0.0), rgba(255,255,255,0.12))', position: 'absolute', inset: 0, mixBlendMode: 'overlay' as any }} />
          <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.045))', borderRadius: 12 }} />
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: '38%', background: 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0))' }} />
        </div>
      ) : (
        <div className="progress" style={{ height: 10, background: 'rgba(180,83,9,0.12)', borderColor: 'rgba(180,83,9,0.24)' }}>
          <span style={{ width: pct + '%', background: 'linear-gradient(90deg,#b45309,#ea580c)', boxShadow: '0 0 8px rgba(234,88,12,0.32)' }} />
        </div>
      )}
    </div>
  );
}

