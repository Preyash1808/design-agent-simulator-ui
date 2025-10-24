"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const TeaThoughtTimeline = dynamic(() => import('../../components/TeaThoughtTimeline'), { ssr: false });
// Vibrant multi-hue palette: red, orange, yellow, green, teal, blue, indigo, purple, pink
const CHART_PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#22d3ee', // light cyan
  '#10b981', // emerald (repeat for long series)
  '#fb7185', // soft red
];
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
// Convert HSL to HEX to ensure ECharts (and canvas) use distinct hues reliably
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    const s = n.toString(16).padStart(2, '0');
    return s;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
// Generate N distinct, perceptually separated colors around the hue wheel
function distinctColor(index: number, total: number, saturation = 55, lightness = 50): string {
  if (total <= 0) total = 1;
  // Golden angle approach to avoid clustering (approx 137.5 degrees)
  const goldenAngle = 137.50776405;
  const hue = (index * goldenAngle) % 360;
  return hslToHex(hue, saturation, lightness);
}
// Curated, accessible user palette (blue, green, orange first, then diverse hues)
const USER_COLORS = [
  '#3B82F6', // blue
  '#22C55E', // green
  '#F59E0B', // amber
  '#A855F7', // violet
  '#06B6D4', // cyan
  '#EF4444', // red
  '#0EA5E9', // sky
  '#84CC16', // lime
  '#F472B6', // pink
  '#7C3AED', // indigo
];
function getUserColor(index: number, total: number): string {
  if (index < USER_COLORS.length) return USER_COLORS[index];
  return distinctColor(index, total);
}
import FancySelect from '../../components/FancySelect';
import Link from 'next/link';
import { IconQuestionCircle, IconActivity, IconDownload, IconLayers, IconX } from '../../components/icons';
import FlowSankey from '../../components/flow/FlowSankey';
import PathShareTrend from '../../components/flow/PathShareTrend';
import PathRankList from '../../components/flow/PathRankList';
// import EmotionMix from '../../components/EmotionMix';

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

type Project = { id: string, name: string, run_dir?: string };
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
  const flowInsightsRef = useRef<any>(null);
  const flowInsightsContainerRef = useRef<HTMLDivElement>(null);
  const [personaCards, setPersonaCards] = useState<Array<{ persona_id: string; persona_name?: string; avg_steps: number; completion_pct: number; dropoffs: number; friction_pct: number; drift?: number | null; sentiment_start?: number | null; sentiment_end?: number | null }>>([]);
  // Start in loading=true so server and client initial render match
  const [personaLoading, setPersonaLoading] = useState(true);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [openPersonaId, setOpenPersonaId] = useState<string | null>(null);
  const [personaModalTab, setPersonaModalTab] = useState<'think-aloud' | 'emotion' | 'path' | 'what-if'>('think-aloud');
  const [personaDetail, setPersonaDetail] = useState<any | null>(null);
  const [personaDetailLoading, setPersonaDetailLoading] = useState(false);
  const [personaEmoSeries, setPersonaEmoSeries] = useState<Array<{ name: string; points: Array<{ step: number; state: string; sentiment: number; screen?: string }> }>>([]);
  const [personaEmoStates, setPersonaEmoStates] = useState<string[]>([]);
  const [aggregateEmotions, setAggregateEmotions] = useState(false);
  const [selectedBacktrack, setSelectedBacktrack] = useState<{ name: string; count: number } | null>(null);
  // Flow insights shared state
  const [flowRuns, setFlowRuns] = useState<string[]>([]);
  const [flowSeries, setFlowSeries] = useState<Array<{ name: string, data: number[] }>>([]);
  const [flowHoverPath, setFlowHoverPath] = useState<string | null>(null);
  const [flowSelectedPath, setFlowSelectedPath] = useState<string | null>(null);
  const [flowLoading, setFlowLoading] = useState<boolean>(false);
  const [flowShowAll, setFlowShowAll] = useState<'top'|'all'>('top');
  const [flowRunWindow, setFlowRunWindow] = useState<number>(6);
  // Per-user journeys (step-by-step screen sequences)
  const [journeysData, setJourneysData] = useState<any[]>([]);
  const [journeysLoading, setJourneysLoading] = useState<boolean>(false);
  // Custom tooltip for Flow Insights
  const [flowTooltip, setFlowTooltip] = useState<{ visible: boolean; x: number; y: number; content: string } | null>(null);
  function setChartRef(ref: any, inst: any) {
    try { ref.current = inst?.getEchartsInstance ? inst.getEchartsInstance() : null; } catch { ref.current = null; }
  }
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [runQuery, setRunQuery] = useState("");
  // Map DB project id -> filesystem project id (slug like restructured_hyou_...)
  const [projectSlugById, setProjectSlugById] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [lastRequested, setLastRequested] = useState<string>("");
  const [goals, setGoals] = useState<Array<{ id: string; goal: string; run_dir?: string; task_id?: number|null; task_name?: string|null }>>([]);
  const [selectedGoal, setSelectedGoal] = useState("");
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
  const [dlKind, setDlKind] = useState<'overview'|'persona'|'full'|'excel'|'logs'>('full');
  const [dlTab, setDlTab] = useState<'report'|'excel'|'logs'>('report');
  // Persona density toggle
  const [personaDensity, setPersonaDensity] = useState<'comfortable'|'compact'>('comfortable');
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
  // Hide Flow Insights hover/tooltip when clicking anywhere outside the chart
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      const root = flowInsightsContainerRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) {
        try {
          const inst = flowInsightsRef.current;
          if (inst && inst.dispatchAction) inst.dispatchAction({ type: 'hideTip' } as any);
        } catch {}
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
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

  async function handleDownload(kind: 'overview'|'persona'|'full'|'excel'|'logs') {
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
    if (kind === 'logs') {
      try {
        setDownloading(true);
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        // Find the run_dir for this runId from goals
        const selectedGoalData = goals.find(g => g.id === runId);
        const runDirForLogs = selectedGoalData?.run_dir;
        
        // Extract just the directory name if run_dir is a full path
        let logRunId = runId;
        if (runDirForLogs) {
          // If run_dir is like "/path/to/test_run_20251020_084434_9ibj", extract just "test_run_20251020_084434_9ibj"
          const parts = runDirForLogs.split('/');
          logRunId = parts[parts.length - 1] || runId;
        }
        
        // Use filesystem slug when available
        const projectFsId = projectSlugById[selectedProject] || selectedProject;
        const qs = new URLSearchParams({ project_id: projectFsId, run_id: logRunId });
        const url = `/api/test_logs?${qs.toString()}`;
        const r = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
        if (!r.ok) throw new Error(`Failed: ${r.status}`);
        const blob = await r.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `${logRunId}_logs.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
      } catch (e) {
        console.error('Failed to download logs:', e);
      } finally { 
        setDownloading(false); 
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
      // Load emotion journeys for Sentiment Drift (y: emotional_state, x: step)
      try {
        const emoResp = await fetch(`/api/persona_emotions?runId=${encodeURIComponent(runId)}&personaId=${encodeURIComponent(personaId)}`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store'
        });
        if (emoResp.ok) {
          const ej = await emoResp.json();
          const journeys: any[] = Array.isArray(ej?.emotion_journeys) ? ej.emotion_journeys : [];
          const series: Array<{ name: string; points: Array<{ step: number; state: string; sentiment: number; screen?: string }> }> = [];
          const states = new Set<string>();
          const firstName = (raw: any): string => {
            let s = String(raw ?? '').trim();
            if (!s) return '';
            const at = s.indexOf('@');
            if (at > 0) s = s.slice(0, at);
            const parts = s.split(/[\s._-]+/).filter(Boolean);
            if (!parts.length) return '';
            let f = parts[0];
            if (/^user\d*$/i.test(f) || /^user$/i.test(f) || /^usr$/i.test(f) || /^guest$/i.test(f) || /^id$/i.test(f)) {
              f = parts[1] || '';
            }
            if (!f) return '';
            return f.charAt(0).toUpperCase() + f.slice(1);
          };
          for (let ji = 0; ji < journeys.length; ji++) {
            const j = journeys[ji];
            const rawName = j?.firstName ?? j?.fullName ?? j?.user_name ?? j?.name ?? j?.userName ?? j?.username ?? j?.user ?? j?.userId;
            const displayName = firstName(rawName) || `User ${ji + 1}`;
            const ptsRaw: any[] = Array.isArray(j?.emotions) ? j.emotions : [];
            const points: Array<{ step: number; state: string; sentiment: number; screen?: string }> = [];
            for (const p of ptsRaw) {
              const step = Number(p?.step ?? 0);
              const stateArr: string[] = Array.isArray(p?.emotional_state) ? p.emotional_state : [];
              const primary = String((stateArr[0] ?? p?.emotion ?? '').toString().toLowerCase());
              const sentiment = Number(p?.sentiment_value ?? 0);
              const screen = String(p?.screen_name || p?.screen || '');
              if (step > 0 && primary) { points.push({ step, state: primary, sentiment, screen }); states.add(primary); }
            }
            if (points.length) series.push({ name: displayName, points });
          }
          setPersonaEmoSeries(series);
          setPersonaEmoStates(Array.from(states));
        } else {
          setPersonaEmoSeries([]); setPersonaEmoStates([]);
        }
      } catch { setPersonaEmoSeries([]); setPersonaEmoStates([]); }
      // Initialize Flow Insights series based on current persona paths
      try {
        const topPaths: string[] = Array.isArray((data || {}).paths) ? (data.paths as any[]).map(p => String(p.path || '')).slice(0, 5) : [];
        await loadFlowTrends(runId, personaId, topPaths, flowRunWindow);
      } catch {}
      // Load per-user journeys for this persona
      try {
        await loadPersonaJourneys(runId, personaId);
      } catch {}
    } catch (e) {
      setPersonaDetail(null);
    } finally {
      setPersonaDetailLoading(false);
    }
  }

  // Load per-user journeys from backend (step-by-step sequences)
  async function loadPersonaJourneys(runId: string, personaId: string) {
    try {
      if (!runId || !personaId) { setJourneysData([]); return; }
      setJourneysLoading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const qs = new URLSearchParams({ runId, personaId, ...(token ? { token } : {}) }).toString();
      const r = await fetch(`/api/journeys?${qs}`, { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      if (!r.ok) { setJourneysData([]); return; }
      let j: any = {};
      try { j = await r.json(); } catch { j = {}; }
      let arr: any[] = [];
      if (Array.isArray(j)) arr = j;
      else if (Array.isArray(j?.journeys)) arr = j.journeys;
      // Normalize to { name, steps: [{screen_name}] }
      const pickFirstName = (raw: any): string => {
        let s = String(raw ?? '').trim();
        if (!s) return '';
        const at = s.indexOf('@');
        if (at > 0) s = s.slice(0, at);
        const parts = s.split(/[\s._-]+/).filter(Boolean);
        if (!parts.length) return '';
        let f = parts[0];
        if (/^user\d*$/i.test(f) || /^user$/i.test(f) || /^usr$/i.test(f) || /^guest$/i.test(f) || /^id$/i.test(f)) {
          f = parts[1] || '';
        }
        if (!f) return '';
        return f.charAt(0).toUpperCase() + f.slice(1);
      };
      const normalized = arr.slice(0, 50).map((it: any, idx: number) => {
        const stepsRaw = Array.isArray(it?.steps)
          ? it.steps
          : (Array.isArray(it?.sequence) ? it.sequence : (typeof it?.path === 'string' ? String(it.path).split('>').map((s: string) => ({ screen_name: s.trim() })) : []));
        const steps = (stepsRaw || []).map((s: any) => ({
          screen_name: String(s?.screen_name || s?.screen || s?.frame_name || ''),
          screen_id: s?.screen_id || s?.id || undefined
        }));
        const rawName = it?.firstName ?? it?.fullName ?? it?.name ?? it?.user_name ?? it?.username ?? it?.user ?? it?.userId;
        const name = pickFirstName(rawName) || `User ${idx + 1}`;
        return { name, steps };
      });
      setJourneysData(normalized);
    } catch {
      setJourneysData([]);
    } finally {
      setJourneysLoading(false);
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
  type RecItem = { text: string, count: number, screenId?: string, image?: string, personas?: string[], clarity_score?: number, confidence_score?: number, recovery_score?: number, delight_score?: number };
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
      if (!Array.isArray(arr) || arr.length === 0) return [] as RecGroup[];
      const mapped = arr.map((g: any) => ({
        screenId: String(g.screenId || g.screen_id || ''),
        name: String(g.name || ''),
        image: g.image || null,
        totalCount: Number(g.totalCount || g.total || 0),
        items: Array.isArray(g.items) ? g.items.map((it: any) => ({
          text: String(it.text || ''),
          count: Number(it.count || 0),
          personas: Array.isArray(it.personas) ? it.personas.map((p:string)=>String(p)) : [],
          raw: String(it.text_raw || it.text || ''),
          clarity_score: it.clarity_score !== undefined ? Number(it.clarity_score) : undefined,
          confidence_score: it.confidence_score !== undefined ? Number(it.confidence_score) : undefined,
          recovery_score: it.recovery_score !== undefined ? Number(it.recovery_score) : undefined,
          delight_score: it.delight_score !== undefined ? Number(it.delight_score) : undefined
        })) : [],
      })) as RecGroup[];
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
  const [selectedThemeSort, setSelectedThemeSort] = React.useState<'clarity' | 'confidence' | 'recovery' | 'delight' | null>(null);
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
        setSelectedGoal(String(last.id));
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
  // Fetch goals when project is selected
  useEffect(() => {
    if (!selectedProject) {
      setGoals([]);
      return;
    }
    async function loadGoals() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch(`/api/status?attach_signed_urls=0`, {
          headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          cache: 'no-store'
        });
        if (!r.ok) return;
        const data = await r.json();
        // Filter runs for the selected project and extract unique goals
        const projectRuns = (data.items || []).filter((item: any) =>
          String(item.type).toLowerCase() === 'run' &&
          String(item.project_id) === selectedProject
        );
        // Create unique goals array with run IDs, run_dir and optional task metadata
        const goalsMap = new Map();
        projectRuns.forEach((run: any) => {
          const runId = String(run.id || run.run_id || '');
          const goalText = String(run.goal || '');
          const runDir = run.run_dir ? String(run.run_dir) : undefined;
          const taskId = (run.task_id !== undefined && run.task_id !== null) ? Number(run.task_id) : null;
          const taskName = (run.task_name !== undefined && run.task_name !== null) ? String(run.task_name) : null;
          if (runId && !goalsMap.has(runId)) {
            goalsMap.set(runId, { id: runId, goal: goalText, run_dir: runDir, task_id: taskId, task_name: taskName });
          }
        });
        const goalsArr = Array.from(goalsMap.values());
        setGoals(goalsArr);

        // If no selection yet, choose the latest COMPLETED run for this project
        if (!selectedGoal) {
          try {
            const completedRuns = projectRuns.filter((x: any) => String(x.status).toUpperCase() === 'COMPLETED');
            completedRuns.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
            const latest = completedRuns[0];
            if (latest?.id) {
              setSelectedGoal(String(latest.id));
              setRunQuery(String(latest.id));
            }
          } catch {}
        }

        // Build map DB project id -> filesystem slug using project items
        const slugMap: Record<string, string> = {};
        for (const it of (data.items || [])) {
          try {
            if (String(it.type).toLowerCase() !== 'project') continue;
            const dbId = String(it.project_id || it.id || '');
            const rd = String(it.run_dir || '');
            if (!dbId || !rd) continue;
            const parts = rd.split('/');
            const slug = parts[parts.length - 1] || rd;
            if (slug) slugMap[dbId] = slug;
          } catch {}
        }
        if (Object.keys(slugMap).length) setProjectSlugById(slugMap);
      } catch (err) {
        console.error('Failed to load goals:', err);
        setGoals([]);
      }
    }
    loadGoals();
  }, [selectedProject]);

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

  function scrollToModalSection(targetId: string) {
    try {
      const el = typeof document !== 'undefined' ? document.getElementById(targetId) : null;
      if (!el) return;
      const modal = el.closest('.persona-modal') as HTMLElement | null;
      const container = modal?.querySelector('.persona-modal-content') as HTMLElement | null;
      if (container) {
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8;
        container.scrollTo({ top, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch {}
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
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:10070, display:'flex', alignItems:'center', justifyContent:'center', padding:'4vh 2vw' }}
        >
          <div onClick={(e)=>e.stopPropagation()} style={{ width:'min(560px, 94vw)', background:'#FFFFFF', border:'1px solid #E5E7EB', borderRadius:16, boxShadow:'0 24px 60px rgba(0,0,0,0.15)', padding:24 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <h3 style={{ margin:0, fontSize:22, color:'#0F172A', fontWeight:700 }}>Export Report</h3>
              <button onClick={()=>setShowDownloadModal(false)} style={{ background:'transparent', border:'none', cursor:'pointer', padding:4, display:'flex', alignItems:'center', color:'#64748B', fontSize:20 }}>✕</button>
            </div>

            {/* Segmented Tab Navigation */}
            <div role="tablist" aria-label="Download type" style={{ display:'inline-flex', background:'#F8F9FA', border:'1px solid #E5E7EB', borderRadius:8, padding:4, marginBottom:20 }}>
              <button role="tab" aria-selected={dlTab==='report'} onClick={()=>{ setDlTab('report'); if (dlKind==='excel' || dlKind==='logs') setDlKind('full'); }} style={{ padding:'8px 20px', background: dlTab==='report' ? '#FFFFFF' : 'transparent', border:'none', borderRadius:6, color:'#0F172A', cursor:'pointer', fontWeight:500, fontSize:14, boxShadow: dlTab==='report' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition:'all 0.2s ease' }}>Report</button>
              <button role="tab" aria-selected={dlTab==='excel'} onClick={()=>{ setDlTab('excel'); setDlKind('excel'); }} style={{ padding:'8px 20px', background: dlTab==='excel' ? '#FFFFFF' : 'transparent', border:'none', borderRadius:6, color:'#0F172A', cursor:'pointer', fontWeight:500, fontSize:14, boxShadow: dlTab==='excel' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition:'all 0.2s ease' }}>Personas</button>
              <button role="tab" aria-selected={dlTab==='logs'} onClick={()=>{ setDlTab('logs'); setDlKind('logs'); }} style={{ padding:'8px 20px', background: dlTab==='logs' ? '#FFFFFF' : 'transparent', border:'none', borderRadius:6, color:'#0F172A', cursor:'pointer', fontWeight:500, fontSize:14, boxShadow: dlTab==='logs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition:'all 0.2s ease' }}>Logs</button>
            </div>

            {/* Report tab content - only Full Report option */}
            {dlTab==='report' && (
              <div role="radiogroup" aria-label="Report" className="grid" style={{ gap:6 }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:8, background:'#FAFAFA', border:'1px solid #E5E7EB', cursor:'pointer' }}>
                  <input type="radio" name="dlKind" checked={dlKind==='full'} onChange={()=>setDlKind('full')} />
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8, color:'#0F172A', fontSize:14 }}><IconDownload width={16} height={16} /> Full Report (Overview + Persona Explorer)</span>
                </label>
              </div>
            )}

            {/* Personas tab content */}
            {dlTab==='excel' && (
              <div className="grid" style={{ gap:6 }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:8, background:'#FAFAFA', border:'1px solid #E5E7EB' }}>
                  <input type="radio" name="dlKind" checked={true} readOnly />
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8, color:'#0F172A', fontSize:14 }}><IconDownload width={16} height={16} /> All personas with connected user data</span>
                </label>
              </div>
            )}

            {/* Logs tab content */}
            {dlTab==='logs' && (
              <div className="grid" style={{ gap:6 }}>
                <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:8, background:'#FAFAFA', border:'1px solid #E5E7EB' }}>
                  <input type="radio" name="dlKind" checked={true} readOnly />
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8, color:'#0F172A', fontSize:14 }}><IconDownload width={16} height={16} /> Downloads complete test run logs as a zip file.</span>
                </label>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:12, marginTop:24 }}>
              <button onClick={()=>setShowDownloadModal(false)} style={{ padding:'10px 20px', background:'#FFFFFF', border:'1px solid #E5E7EB', borderRadius:8, color:'#0F172A', cursor:'pointer', fontWeight:500, fontSize:14 }}>Cancel</button>
              <button onClick={()=>{ handleDownload(dlKind); setShowDownloadModal(false); }} style={{ padding:'10px 24px', background:'#000000', color:'#FFFFFF', border:'none', borderRadius:8, cursor:'pointer', fontWeight:500, fontSize:14 }}>Export</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            Project
            <FancySelect
              value={selectedProject}
              onChange={(val) => {
                setSelectedProject(val);
                setSelectedGoal('');
                setGoals([]);
                setRunQuery('');
              }}
              placeholder="Select project"
              options={projects.map(p => ({ value: p.id, label: p.name }))}
              searchable={false}
              compact
            />
          </label>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            Task
            <FancySelect
              value={selectedGoal}
              onChange={(val) => {
                setSelectedGoal(val);
                setRunQuery(val);
              }}
              placeholder={selectedProject ? "Select a task" : "Select project first"}
              options={goals.map(g => ({
                value: g.id,
                label: (
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <span style={{ fontWeight:600, color:'#0F172A' }}>{g.task_name || (g.goal || `Goal ${g.id.slice(0,8)}`)}</span>
                    {g.task_id != null && (
                      <span style={{ fontSize:11, color:'#94A3B8', fontWeight: 500 }}>ID: task-{g.task_id}</span>
                    )}
                  </div>
                ) as any
              }))}
              searchable={true}
              compact
            />
          </label>
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
              onClick={() => { setDlTab('report'); setDlKind('full'); setShowDownloadModal(true); setShowDlMenu(false); }}
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
                <div className="muted">Select a project and goal to view metrics.</div>
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
                <ReactECharts key={aggregateEmotions ? 'emo-agg' : 'emo-users'} notMerge style={{ height: 360 }} option={(function(){
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
                })()} />
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

                    {/* Theme chips - for sorting by theme score */}
                    <span className="filters__label">Sort by:</span>
                    {themeChips.map((theme, idx) => {
                      const themeKey = theme.toLowerCase() as 'clarity' | 'confidence' | 'recovery' | 'delight';
                      const isActive = selectedThemeSort === themeKey;
                      return (
                      <button
                        key={idx}
                          className={`chip ${getThemeChipClass(theme)} ${isActive ? 'is-active' : ''}`}
                          onClick={() => {
                            // Toggle: if already selected, deselect; otherwise select
                            setSelectedThemeSort(isActive ? null : themeKey);
                          }}
                      >
                        {theme}
                      </button>
                      );
                    })}
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
                    .filter(g => g.items.length > 0)
                    .map(g => ({
                      ...g,
                      items: (() => {
                        // Sort items by selected theme score if a theme is selected
                        if (!selectedThemeSort) return g.items;
                        const scoreKey = `${selectedThemeSort}_score` as keyof RecItem;
                        return [...g.items].sort((a, b) => {
                          const scoreA = (a[scoreKey] as number) || 0;
                          const scoreB = (b[scoreKey] as number) || 0;
                          return scoreB - scoreA; // Descending order (highest score first)
                        });
                      })()
                    }));

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
                                style={{ fontSize: 13, opacity: 0.5, cursor: 'not-allowed' }}
                                disabled
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
                  <h4 style={{ margin: 0 }}>Persona</h4>
                </div>
                {personaLoading && <div className="muted" style={{ marginTop: 8 }}>Loading personas…</div>}
                {personaError && <div className="muted" style={{ marginTop: 8, color: '#fca5a5' }}>{personaError}</div>}
                {!personaLoading && personaCards.length === 0 && <div className="muted" style={{ marginTop: 8 }}>No personas found</div>}
                {personaCards.length > 0 && (
                  <>
                  <div className="persona-grid" style={{ marginTop: 12 }}>
                    {personaCards.map((p) => {
                      console.log('Rendering persona card:', p);
                      return (
                      <button key={p.persona_id}
                        onClick={(e) => { e.stopPropagation(); setOpenPersonaId(p.persona_id); loadPersonaDetail(String(runQuery || lastRequested), p.persona_id); }}
                        className="persona-card persona-card--clickable"
                        style={{ textAlign: 'left' as any }}>
                        {/* Top-right badges */}
                        <div className="persona-card__badges">
                          <span className="pc-chip">{p.completion_pct}%</span>
                        </div>

                        {/* Title */}
                        <h3 className="persona-card__title">{p.persona_name || `Persona #${p.persona_id}`}</h3>

                        {/* 2x2 Metrics Grid */}
                        <div className="persona-metrics">
                          <div className="pc-metric">
                            <div className="pc-metric__label">AVG STEPS</div>
                            <div className="pc-metric__value">{p.avg_steps}</div>
                          </div>
                          <div className="pc-metric">
                            <div className="pc-metric__label">DROP-OFFS</div>
                            <div className="pc-metric__value">{p.dropoffs}</div>
                          </div>
                          <div className="pc-metric">
                            <div className="pc-metric__label">FRICTION %</div>
                            <div className="pc-metric__value">{p.friction_pct}%</div>
                          </div>
                          <div className="pc-metric">
                            <div className="pc-metric__label">DRIFT</div>
                            <div className="pc-metric__value">
                              {typeof p.drift === 'number' ? (p.drift > 0 ? `+${p.drift.toFixed(2)}` : p.drift.toFixed(2)) : 'N/A'}
                            </div>
                          </div>
                        </div>

                        <div className="persona-card__hint">Click for detailed TEA analysis and user paths</div>
                      </button>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>

              {openPersonaId && (
                <div className="persona-modal-overlay" onClick={() => { setOpenPersonaId(null); setPersonaDetail(null); }}>
                  <div className="persona-modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(1100px, 90vw)', maxWidth: '1100px', height: '85vh' }}>
                    <div className="persona-modal-header">
                      <div>
                        <h2 className="persona-modal-title">{personaCards.find(p => p.persona_id === openPersonaId)?.persona_name || `Persona #${openPersonaId}`}</h2>
                        <p className="persona-modal-subtitle">Detailed analysis and user journey</p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          title="Download Excel"
                          onClick={async () => {
                            try {
                              const runId = String(runQuery || lastRequested || '').trim();
                              if (!runId || !openPersonaId) return;
                              const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
                              const qs = new URLSearchParams({ runId, personaId: String(openPersonaId), format: 'xlsx' }).toString();
                              const resp = await fetch(`/api/persona_detail?${qs}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
                              if (!resp.ok) { console.error('Download failed with status', resp.status); return; }
                              const buf = await resp.arrayBuffer();
                              const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `users_${runId}_${String(openPersonaId)}.xlsx`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            } catch {}
                          }}
                          className="btn-ghost btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          aria-label="Download Excel"
                        >
                          <IconDownload width={16} height={16} />
                          Download
                        </button>
                        <button
                          onClick={() => { setOpenPersonaId(null); setPersonaDetail(null); setSelectedBacktrack(null); }}
                          className="persona-modal-close"
                          aria-label="Close"
                          title="Close"
                        >
                          <IconX width={16} height={16} />
                        </button>
                      </div>
                    </div>

                    <div className="persona-modal-body" style={{ gridTemplateColumns: '240px 1fr' }}>
                      {/* Left Navigation */}
                      <nav className="persona-modal-nav">
                        <button
                          className={`persona-modal-nav-item ${personaModalTab === 'think-aloud' ? 'active' : ''}`}
                          onClick={() => setPersonaModalTab('think-aloud')}
                        >
                          Think Aloud
                        </button>
                        {personaModalTab === 'think-aloud' && (
                          <div className="persona-modal-nav-subitems">
                            <a href="#unique-tea" className="persona-modal-nav-subitem">Unique TEA</a>
                            <a href="#detailed-tea" className="persona-modal-nav-subitem" style={{ opacity: 0.5, cursor: 'not-allowed' }}>Detailed TEA</a>
                          </div>
                        )}

                        <button
                          className={`persona-modal-nav-item ${personaModalTab === 'emotion' ? 'active' : ''}`}
                          onClick={() => setPersonaModalTab('emotion')}
                        >
                          Emotion Composition
                        </button>
                        {personaModalTab === 'emotion' && (
                          <div className="persona-modal-nav-subitems">
                            <a href="#sentiment-drift" className="persona-modal-nav-subitem">Sentiment Drift</a>
                            <span className="persona-modal-nav-subitem muted" aria-disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>Emotion Mix</span>
                          </div>
                        )}

                        <button
                          className={`persona-modal-nav-item ${personaModalTab === 'path' ? 'active' : ''}`}
                          onClick={() => setPersonaModalTab('path')}
                        >
                          Path
                        </button>
                        {personaModalTab === 'path' && (
                          <div className="persona-modal-nav-subitems">
                            <a href="#flow-insights" className="persona-modal-nav-subitem" onClick={(e)=>{ e.preventDefault(); scrollToModalSection('flow-insights'); }}>Flow Insights</a>
                            <a href="#path-backtracks" className="persona-modal-nav-subitem" onClick={(e)=>{ e.preventDefault(); scrollToModalSection('path-backtracks'); }}>Backtracks</a>
                            <span className="persona-modal-nav-subitem muted" aria-disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>Exits</span>
                          </div>
                        )}

                        <button
                          className={`persona-modal-nav-item ${personaModalTab === 'what-if' ? 'active' : ''}`}
                          onClick={() => setPersonaModalTab('what-if')}
                          disabled
                          style={{ opacity: 0.5, cursor: 'not-allowed' }}
                        >
                          What-if Simulations
                        </button>
                      </nav>

                      <div className="persona-modal-content" style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                        {personaDetailLoading && <div className="muted">Loading…</div>}
                        {(!personaDetailLoading && !personaDetail) && <div className="muted">No detail</div>}
                        {personaDetail && (
                          <div className="persona-modal-tab-content">
                            {/* Think Aloud Tab */}
                            {personaModalTab === 'think-aloud' && (
                              <>
                                {/* Unique TEA Thoughts */}
                                <div id="unique-tea" className="tile">
                                  <h4>Unique TEA Thoughts</h4>
                                  {Array.isArray((personaDetail as any).tea_thoughts) && (personaDetail as any).tea_thoughts.length > 0 ? (
                                    <div style={{ marginTop: 8 }}>
                                      <TeaThoughtTimeline teaThoughts={Array.isArray((personaDetail as any).tea_thoughts) ? (personaDetail as any).tea_thoughts : []} />
                                    </div>
                                  ) : (
                                    <div className="muted" style={{ marginTop: 8 }}>No thoughts</div>
                                  )}
                                </div>

                                {/* Detailed TEA - placeholder for now */}
                                <div id="detailed-tea" className="tile" style={{ marginTop: 12 }}>
                                  <h4>Detailed TEA</h4>
                                  <div className="muted">Detailed TEA analysis coming soon</div>
                                </div>
                              </>
                            )}

                            {/* Emotion Composition Tab */}
                            {personaModalTab === 'emotion' && (
                              <>
                        {/* Emotion Mix removed per request */}

                        {/* Emotion Mix */}
                        {/* EmotionMix removed */}

                        {/* Sentiment drift from emotions API (x: step, y: emotional state) */}
                        <div id="sentiment-drift" className="tile" style={{ marginTop: 12 }}>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <h4 style={{ margin: 0 }}>Sentiment Drift</h4>
                            <label style={{ display:'inline-flex', alignItems:'center', gap: 4, fontSize: 11, color:'#0f172a' }}>
                              <div onClick={()=>setAggregateEmotions(v=>!v)} style={{ position:'relative', width: 28, height: 16, borderRadius: 999, cursor:'pointer', background: aggregateEmotions ? '#111827' : '#e5e7eb', border: '1px solid #cbd5e1' }}>
                                <div style={{ position:'absolute', top: 2, left: aggregateEmotions ? 14 : 2, width: 12, height: 12, borderRadius: 999, background: aggregateEmotions ? '#4f46e5' : '#6366f1', transition: 'left .15s ease' }} />
                              </div>
                              <span>{aggregateEmotions ? 'PERSONA' : 'USERS'}</span>
                            </label>
                          </div>
                          <div onWheel={(e) => {
                            // Allow page scroll when SHIFT is not pressed
                            if (!e.shiftKey) {
                              // Don't prevent default - let the scroll propagate
                            } else {
                              // SHIFT is pressed - prevent scroll to allow chart zoom
                              e.stopPropagation();
                            }
                          }}>
                          <ReactECharts
                            key={aggregateEmotions ? 'emo-agg' : 'emo-users'}
                            notMerge
                            style={{ height: 360 }}
                            opts={{ renderer: 'canvas' }}
                            option={(function(){
                            // Sort emotions from negative (bottom) to positive (top)
                            // 10 product-appropriate buckets equally spanning negative→positive
                            const CANON = ['frustrated','annoyed','confused','anxious','overwhelmed','neutral','focused','satisfied','confident','delighted'];
                            // Polarity scores (negative→positive) used to assign unknown labels
                            const scoreMap: Record<string, number> = {
                              'frustrated': -5,
                              'annoyed': -4,
                              'confused': -3,
                              'anxious': -2,
                              'overwhelmed': -1,
                              'neutral': 0,
                              'focused': 1,
                              'satisfied': 2,
                              'confident': 3,
                              'delighted': 4,
                              // Likely synonyms encountered from LLMs/backends
                              'rage': -5, 'angry': -4, 'anger': -4, 'irritated': -4, 'mad': -4,
                              'sad': -3, 'sadness': -3, 'disappointed': -3, 'down': -3, 'melancholy': -3,
                              'fear': -2, 'apprehensive': -2, 'worried': -2, 'concerned': -2,
                              'surprise': -1, 'curious': -1, // treat as uncertain/novelty → close to confused
                              'calm': 1, 'relaxed': 1,
                              'content': 2, 'optimistic': 2, 'satisfaction': 2,
                              'joy': 3, 'happiness': 3, 'excited': 3, 'excitement': 3,
                              'ecstatic': 4, 'delight': 4,
                            };
                            // Synonym/alias mapping from observed → canonical bucket
                            const aliasMap: Record<string, string> = {
                              // map extreme negatives to gentler product terms
                              'rage': 'frustrated', 'angry': 'annoyed', 'anger': 'annoyed', 'irritated': 'annoyed', 'mad': 'annoyed',
                              'sad': 'frustrated', 'sadness': 'frustrated', 'disappointed': 'frustrated', 'down': 'frustrated', 'melancholy': 'frustrated',
                              'fear': 'anxious', 'terrified': 'anxious', 'apprehensive': 'anxious', 'worried': 'anxious', 'concerned': 'anxious',
                              'surprise': 'confused', 'curious': 'confused',
                              'calm': 'focused', 'relaxed': 'focused',
                              'content': 'satisfied', 'optimistic': 'satisfied', 'satisfaction': 'satisfied',
                              'joy': 'confident', 'happiness': 'confident', 'excited': 'confident', 'excitement': 'confident',
                              'ecstatic': 'delighted', 'delight': 'delighted',
                            };
                            const states = CANON.slice(); // clamp to the 10 canonical buckets only
                            const indexMap = new Map(states.map((e, i) => [e, i]));
                            function bucketFor(label: string): string {
                              const raw = String(label || '').toLowerCase();
                              if (aliasMap[raw]) return aliasMap[raw];
                              if (indexMap.has(raw)) return raw;
                              // Fallback: choose closest by score
                              const target = scoreMap[raw] ?? 0;
                              let best = states[0];
                              let bestDiff = Math.abs((scoreMap[best] ?? 0) - target);
                              for (const s of states) {
                                const d = Math.abs((scoreMap[s] ?? 0) - target);
                                if (d < bestDiff) { best = s; bestDiff = d; }
                              }
                              return best;
                            }
                            const map = new Map<string, number>(states.map((s,i)=>[s,i]));
                            // Add an extra line break and capitalize first letter for display
                            const paddedStates = states.map(s => `${(s.charAt(0).toUpperCase() + s.slice(1))}\n`);
                            const maxStep = Math.max(10, ...personaEmoSeries.flatMap(s=>s.points.map(p=>p.step)));
                            let series;
                            if (!aggregateEmotions) {
                              series = personaEmoSeries.map((s, idx) => ({
                                name: s.name,
                                type: 'line', 
                                smooth: 0.25,
                                showSymbol: true,
                                symbol: 'circle',
                                symbolSize: 5,
                                lineStyle: { width: 2, color: getUserColor(idx, Math.max(1, personaEmoSeries.length)) },
                                itemStyle: { color: getUserColor(idx, Math.max(1, personaEmoSeries.length)) },
                                animation: true,
                                animationEasing: 'linear',
                                animationDuration: 400,
                                animationDelay: (i: number) => i * 24,
                                animationDurationUpdate: 300,
                                animationDelayUpdate: (i: number) => i * 18,
                                data: (s.points ?? []).map(p=>{ const observed = String(p?.state || ''); const bucket = bucketFor(observed); const yi = Number(indexMap.get(bucket) ?? -1); const stepVal = Number(p?.step ?? 0); const sentVal = Number(p?.sentiment ?? 0); const screenVal = String(p?.screen ?? ''); return [stepVal, yi, sentVal, screenVal, observed]; }).filter((d:any)=> Number(d[1]) >= 0),
                              }));
                            } else {
                              // Aggregate: build per-step list of effective scores and compute mean, then snap to bucket
                              const k = 2.0;
                              const perStep: Record<number, number[]> = {};
                              for (const s of personaEmoSeries) {
                                for (const p of (s.points ?? [])) {
                                  const observed = String(p?.state || '');
                                  const bucket = bucketFor(observed);
                                  const pol = Number(scoreMap[bucket] ?? 0);
                                  const score = pol + k * Number(p?.sentiment ?? 0);
                                  const t = Number(p?.step ?? 0);
                                  if (!perStep[t]) perStep[t] = [];
                                  perStep[t].push(score);
                                }
                              }
                              const steps = Object.keys(perStep).map(n=>Number(n)).sort((a,b)=>a-b);
                              const avg: Array<[number, number, number, string, string]> = [];
                              // simple moving average window=3
                              const window = 3; const half = Math.floor(window/2);
                              for (let i=0;i<steps.length;i++){
                                const t = steps[i];
                                // local mean
                                const local = perStep[t];
                                let mean = local.reduce((s,v)=>s+v,0)/local.length;
                                const winSteps = steps.slice(Math.max(0,i-half), Math.min(steps.length,i+half+1));
                                const winVals: number[] = [];
                                for (const w of winSteps) winVals.push(...perStep[w]);
                                if (winVals.length) mean = winVals.reduce((s,v)=>s+v,0)/winVals.length;
                                // snap to nearest bucket index
                                let best = states[0]; let bestDiff = Math.abs((scoreMap[best]??0) - mean);
                                for (const sName of states){ const d = Math.abs((scoreMap[sName]??0) - mean); if (d<bestDiff){ best = sName; bestDiff = d; } }
                                const yi = Number(indexMap.get(best) ?? -1);
                                avg.push([t, yi, mean, '', best]);
                              }
                              // Persona line (prominent)
                              const personaName = (personaCards.find(p=>p.persona_id===openPersonaId)?.persona_name || 'Persona');
                              const personaSeries = { name: personaName, type:'line', smooth:0.25, showSymbol:true, symbol:'circle', symbolSize:6, lineStyle:{ width:3, color:'#1f2937' }, itemStyle:{ color:'#1f2937' }, data: avg };
                              // Users in background (retain their colors but low opacity)
                              const userSeries = personaEmoSeries.map((s, idx) => ({
                                name: s.name,
                                type: 'line',
                                smooth: 0.25,
                                showSymbol: false,
                                symbol: 'none',
                                lineStyle: { width: 1, color: getUserColor(idx, Math.max(1, personaEmoSeries.length)), opacity: 0.35 },
                                itemStyle: { color: getUserColor(idx, Math.max(1, personaEmoSeries.length)), opacity: 0.35 },
                                animation: true,
                                animationEasing: 'linear',
                                animationDuration: 400,
                                animationDelay: (i: number) => i * 24,
                                animationDurationUpdate: 300,
                                animationDelayUpdate: (i: number) => i * 18,
                                emphasis: { focus: 'series' },
                                data: (s.points ?? []).map(p=>{ const observed = String(p?.state || ''); const bucket = bucketFor(observed); const yi = Number(indexMap.get(bucket) ?? -1); const stepVal = Number(p?.step ?? 0); const sentVal = Number(p?.sentiment ?? 0); const screenVal = String(p?.screen ?? ''); return [stepVal, yi, sentVal, screenVal, observed]; }).filter((d:any)=> Number(d[1]) >= 0),
                               }));
                              // Legend: persona first, then users
                              series = [personaSeries, ...userSeries];
                            }
                            if (!series.length) return { graphic: [{ type:'text', left:'center', top:'middle', style:{ text:'No emotion timeline available', fill:'#94a3b8', fontSize: 14 } }] } as any;
                            return {
                              backgroundColor: 'transparent',
                              grid: { left: 70, right: 20, top: 28, bottom: 40, containLabel: true },
                              xAxis: { type: 'value', min: 1, max: maxStep, axisLabel: { color: '#cbd5e1' }, name: 'Step', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: '#94a3b8' } },
                              yAxis: { type: 'category', data: paddedStates, axisLabel: { color: '#1e293b', fontWeight: 600, lineHeight: 20, margin: 12 }, name: 'Emotional State', nameLocation: 'end', nameRotate: 0, nameGap: 10, nameTextStyle: { color: '#94a3b8', padding: [0, 0, 6, 0], fontSize: 12, align: 'left' } },
                              legend: { top: 8, right: 10, textStyle: { color: '#cbd5e1' }, selectedMode: 'multiple', selected: Object.fromEntries(series.map((s: any) => [s.name, true])) },
                              dataZoom: [ { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseMove: 'shift', moveOnMouseWheel: false, preventDefaultMouseMove: false }, { type: 'slider', xAxisIndex: 0, start: 0, end: 30, height: 16, bottom: 6 } ],
                              tooltip: { trigger: 'item', formatter: (p:any)=> { const step=p?.data?.[0]; const yi=p?.data?.[1]; const sent=p?.data?.[2]; const screen=p?.data?.[3]||''; const observedRaw=p?.data?.[4]||''; const plottedRaw=states[yi]||''; const cap=(s:string)=> s ? (s.charAt(0).toUpperCase()+s.slice(1)) : s; const observed=cap(String(observedRaw)); const plotted=cap(String(plottedRaw)); const sentimentTxt=(typeof sent==='number'?(sent>=0?`+${sent.toFixed(2)}`:sent.toFixed(2)):'-'); return `${p.seriesName} · Step ${step}${screen?` · ${screen}`:''}<br/>Observed: ${observed} (sentiment ${sentimentTxt})<br/>Plotted as: ${plotted}`; }, showDelay: 0, hideDelay: 0, enterable: false, transitionDuration: 0.05 },
                              series,
                            } as any;
                          })()} />
                          </div>
                        </div>

                        {/* Flow Insights removed per request */}

                        {/* Exits */}
                        <div id="exits" className="tile" style={{ marginTop: 12, display:'none' }}>
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

                        {/* Backtracks by screen (hide in Emotion; rendered in Path tab) */}
                        <div id="backtracks" className="tile" style={{ marginTop: 12, display: 'none' }}>
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
                            // Lollipop (horizontal) chart: stems left->right with circular heads at value end
                            const maxLabelLen = labelsFull.reduce((m, s) => Math.max(m, String(s || '').length), 0);
                            const estWidth = Math.min(320, Math.max(180, Math.round(maxLabelLen * 7)));
                            return {
                              backgroundColor: 'transparent',
                              grid: { left: estWidth + 30, right: 30, top: 30, bottom: 50 },
                              xAxis: { 
                                type: 'value',
                                axisLabel: { color: '#334155', fontWeight: 600 },
                                axisLine: { lineStyle: { color: '#94a3b8' } },
                                splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.25)' } },
                                name: 'Backtracks',
                                nameLocation: 'middle', 
                                nameGap: 28,
                                nameTextStyle: { color: '#94a3b8', fontSize: 12 },
                              },
                              yAxis: {
                                type: 'category',
                                data: labelsFull,
                                axisLabel: { color: '#334155', fontSize: 12, fontWeight: 600, interval: 0 as any, width: estWidth as any, overflow: 'break' as any, lineHeight: 16 as any, margin: 12 as any },
                                axisLine: { lineStyle: { color: '#94a3b8' } },
                                axisTick: { show: false },
                              },
                              tooltip: {
                                trigger: 'item',
                                formatter: (p: any) => {
                                  const idx = p.dataIndex;
                                  const count = vals[idx];
                                  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
                                  const fullName = labelsFull[idx];
                                  return `${fullName}: ${count} backtrack${count===1?'':'s'} (${percentage}%)`;
                                }
                              },
                              series: [
                                { // stem
                                  type: 'bar',
                                  data: vals,
                                  barWidth: 6,
                                  itemStyle: { color: '#93a8e8' },
                                  z: 1,
                                  label: { show: true, position: 'right', color: '#0f172a', fontWeight: 700, formatter: (p: any) => String(p.value) }
                                },
                                { // circle head
                                  type: 'pictorialBar',
                                  data: vals,
                                  symbol: 'circle',
                                  symbolSize: 16,
                                  symbolPosition: 'end',
                                  itemStyle: { color: '#7ea0e6', borderColor: '#6b8ad6', borderWidth: 1 },
                                  z: 2
                                }
                              ]
                            } as any;
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

                              </>
                            )}

                            {/* Path Tab - Flow insights and backtracks */}
                            {personaModalTab === 'path' && (
                              <>
                                {/* Flow insights content here */}
                                <div className="tile" ref={flowInsightsContainerRef} id="flow-insights">
                                  <h4>Flow Insights</h4>
                                  <div onWheel={(e) => {
                                    // Allow page scroll when neither SHIFT nor CTRL is pressed
                                    if (!e.shiftKey && !e.ctrlKey) {
                                      // Don't prevent default - let the scroll propagate
                                    } else {
                                      // Modifier key is pressed - prevent scroll to allow chart zoom
                                      e.stopPropagation();
                                    }
                                  }}>
                                  <ReactECharts 
                                    onChartReady={(chartInstance:any)=>{
                                      setChartRef(flowInsightsRef, { getEchartsInstance: ()=>chartInstance });

                                      const chartDom = chartInstance.getDom();
                                      const journeys = journeysData;
                                      const visibleJourneys = journeys.slice(0, 30);
                                      const predefinedColors = ['#DC2626', '#16A34A', '#2563EB'];
                                      const seriesCount = visibleJourneys.length;
                                      const colors = Array.from({ length: seriesCount }, (_: any, i: number) =>
                                        i < predefinedColors.length ? predefinedColors[i] : hslToHex((360 * (i - predefinedColors.length)) / Math.max(1, seriesCount - predefinedColors.length), 50, 50)
                                      );

                                      // Helper to strip screen_id from screen key
                                      const stripScreenId = (screenKey: string): string => {
                                        const lastUnderscore = screenKey.lastIndexOf('_');
                                        return lastUnderscore > 0 ? screenKey.substring(0, lastUnderscore) : screenKey;
                                      };

                                      // Show custom tooltip on mouseover
                                      chartInstance.on('mouseover', 'series', (params: any) => {
                                        const journey = visibleJourneys[params.seriesIndex];
                                        const steps = Array.isArray(journey?.steps) ? journey.steps : [];
                                        const currentStepIdx = params.data[0];
                                        const stepNumber = currentStepIdx + 1;
                                        const prevStep = currentStepIdx > 0 ? steps[currentStepIdx - 1] : null;
                                        const nextStep = currentStepIdx < steps.length - 1 ? steps[currentStepIdx + 1] : null;

                                        // Strip screen_id from display
                                        const currentScreenName = stripScreenId(params.data[1]);

                                        let pathStr = '<div style="padding: 4px 0;">';
                                        if (prevStep) pathStr += `<span style="opacity: 0.6;">${String(prevStep?.screen_name || prevStep?.screen || '').substring(0, 20)}</span> → `;
                                        pathStr += `<span style="font-weight: 700; color: #60A5FA;">${currentScreenName}</span>`;
                                        if (nextStep) pathStr += ` → <span style="opacity: 0.6;">${String(nextStep?.screen_name || nextStep?.screen || '').substring(0, 20)}</span>`;
                                        pathStr += '</div>';

                                        const content = `<div style="min-width: 200px;">
                                          <div style="font-weight: 700; margin-bottom: 6px; color: ${colors[params.seriesIndex]};">${params.seriesName}</div>
                                          <div style="font-size: 12px; margin-bottom: 4px;"><span style="opacity: 0.7;">Step:</span> <b>${stepNumber}</b> of ${steps.length}</div>
                                          <div style="font-size: 12px; margin-bottom: 6px;"><span style="opacity: 0.7;">Screen:</span> <b>${currentScreenName}</b></div>
                                          <div style="font-size: 11px; opacity: 0.8; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; margin-top: 4px;">
                                            ${pathStr}
                                          </div>
                                        </div>`;

                                        setFlowTooltip({
                                          visible: true,
                                          x: params.event.event.clientX,
                                          y: params.event.event.clientY,
                                          content
                                        });
                                      });

                                      // Hide custom tooltip on mouseout
                                      chartInstance.on('mouseout', 'series', () => {
                                        setFlowTooltip(null);
                                      });

                                      // Hide tooltip when mouse leaves chart
                                      chartDom.addEventListener('mouseleave', () => {
                                        setFlowTooltip(null);
                                      });
                                    }}
                                    style={{ height: 400, width: '100%', margin: 0 }}
                                    opts={{ renderer: 'canvas' }}
                                    option={(() => {
                                      // Prefer real per-user journeys when available; fall back to aggregated paths
                                      const journeys = journeysData;
                                      if (Array.isArray(journeys) && journeys.length > 0) {
                                        // Build screen set using screen_name_screen_id as unique identifier
                                        // This allows duplicate names to appear separately on y-axis
                                        const screensSet = new Set<string>();
                                        const screenFrequency = new Map<string, number>();
                                        const screenPositions = new Map<string, number[]>(); // Track step positions for each screen
                                        const transitions = new Map<string, Map<string, number>>(); // Track screen-to-screen transitions
                                        let maxSteps = 0;

                                        // Helper function to create unique screen key
                                        const getScreenKey = (s: any): string => {
                                          const name = String(s?.screen_name || s?.screen || '');
                                          const id = String(s?.screen_id || s?.id || '');
                                          // Use name_id format if ID exists, otherwise just name
                                          return id ? `${name}_${id}` : name;
                                        };

                                        journeys.forEach((j: any) => {
                                          const steps = Array.isArray(j?.steps) ? j.steps : [];
                                          maxSteps = Math.max(maxSteps, steps.length);
                                          steps.forEach((s: any, stepIndex: number) => {
                                            const screenKey = getScreenKey(s);
                                            if (screenKey) {
                                              screensSet.add(screenKey);
                                              screenFrequency.set(screenKey, (screenFrequency.get(screenKey) || 0) + 1);
                                              // Track positions where this screen appears
                                              if (!screenPositions.has(screenKey)) {
                                                screenPositions.set(screenKey, []);
                                              }
                                              screenPositions.get(screenKey)!.push(stepIndex);

                                              // Track transitions to next screen
                                              if (stepIndex < steps.length - 1) {
                                                const nextScreenKey = getScreenKey(steps[stepIndex + 1]);
                                                if (nextScreenKey) {
                                                  if (!transitions.has(screenKey)) {
                                                    transitions.set(screenKey, new Map());
                                                  }
                                                  const screenTransitions = transitions.get(screenKey)!;
                                                  screenTransitions.set(nextScreenKey, (screenTransitions.get(nextScreenKey) || 0) + 1);
                                                }
                                              }
                                            }
                                          });
                                        });

                                        // Calculate average position for each screen
                                        const screenAvgPos = new Map<string, number>();
                                        screensSet.forEach(screen => {
                                          const positions = screenPositions.get(screen) || [0];
                                          const avg = positions.reduce((sum, p) => sum + p, 0) / positions.length;
                                          screenAvgPos.set(screen, avg);
                                        });

                                        // Group screens by similar journey positions with overlap for connected screens
                                        const positionBuckets = new Map<number, string[]>();
                                        const screenToBucket = new Map<string, number>();

                                        screensSet.forEach(screen => {
                                          const avgPos = screenAvgPos.get(screen) || 0;
                                          const baseBucket = Math.floor(avgPos / 3); // Group by 3-step ranges

                                          // Check if this screen has strong connections to screens in adjacent buckets
                                          let assignedBucket = baseBucket;
                                          let maxConnectionToBucket = 0;

                                          // Check buckets within ±1 range
                                          for (let b = baseBucket - 1; b <= baseBucket + 1; b++) {
                                            const screensInBucket = positionBuckets.get(b) || [];
                                            let connectionStrength = 0;

                                            screensInBucket.forEach(otherScreen => {
                                              const aToB = transitions.get(screen)?.get(otherScreen) || 0;
                                              const bToA = transitions.get(otherScreen)?.get(screen) || 0;
                                              // Prioritize bidirectional connections
                                              connectionStrength += (aToB > 0 && bToA > 0) ? (aToB + bToA) * 2 : (aToB + bToA);
                                            });

                                            if (connectionStrength > maxConnectionToBucket) {
                                              maxConnectionToBucket = connectionStrength;
                                              assignedBucket = b;
                                            }
                                          }

                                          // If no strong connections found, use base bucket
                                          if (maxConnectionToBucket < 2) {
                                            assignedBucket = baseBucket;
                                          }

                                          if (!positionBuckets.has(assignedBucket)) {
                                            positionBuckets.set(assignedBucket, []);
                                          }
                                          positionBuckets.get(assignedBucket)!.push(screen);
                                          screenToBucket.set(screen, assignedBucket);
                                        });

                                        // Optimize ordering within each bucket to minimize crossings
                                        const optimizeBucketOrder = (screens: string[]): string[] => {
                                          if (screens.length <= 1) return screens;

                                          // Calculate connection strength between each pair of screens
                                          const getConnectionWeight = (a: string, b: string): number => {
                                            const aToB = transitions.get(a)?.get(b) || 0;
                                            const bToA = transitions.get(b)?.get(a) || 0;
                                            const totalTransitions = aToB + bToA;

                                            // Strong loops (high bidirectional traffic) get exponential weight
                                            if (aToB > 0 && bToA > 0) {
                                              const minTransitions = Math.min(aToB, bToA);
                                              // More balanced loops get even higher weight
                                              const balanceFactor = minTransitions / Math.max(aToB, bToA);
                                              return totalTransitions * (3 + balanceFactor * 2); // 3x to 5x multiplier
                                            }

                                            // High one-way traffic also gets bonus
                                            if (totalTransitions >= 3) {
                                              return totalTransitions * 1.5;
                                            }

                                            return totalTransitions;
                                          };

                                          // Greedy algorithm: start with most connected pair, build outward
                                          const ordered: string[] = [];
                                          const remaining = new Set(screens);

                                          // Find the pair with strongest connection
                                          let maxWeight = 0;
                                          let bestPair: [string, string] | null = null;
                                          screens.forEach(a => {
                                            screens.forEach(b => {
                                              if (a !== b) {
                                                const weight = getConnectionWeight(a, b);
                                                if (weight > maxWeight) {
                                                  maxWeight = weight;
                                                  bestPair = [a, b];
                                                }
                                              }
                                            });
                                          });

                                          if (bestPair) {
                                            ordered.push(bestPair[0], bestPair[1]);
                                            remaining.delete(bestPair[0]);
                                            remaining.delete(bestPair[1]);
                                          } else if (screens.length > 0) {
                                            // No connections, just add first screen
                                            ordered.push(screens[0]);
                                            remaining.delete(screens[0]);
                                          }

                                          // Iteratively add screens that have strongest connection to current endpoints
                                          while (remaining.size > 0) {
                                            let bestScreen: string | null = null;
                                            let bestWeight = -1;
                                            let addToEnd = true;

                                            remaining.forEach(screen => {
                                              const weightToStart = getConnectionWeight(screen, ordered[0]);
                                              const weightToEnd = getConnectionWeight(screen, ordered[ordered.length - 1]);

                                              if (weightToEnd > bestWeight) {
                                                bestWeight = weightToEnd;
                                                bestScreen = screen;
                                                addToEnd = true;
                                              }
                                              if (weightToStart > bestWeight) {
                                                bestWeight = weightToStart;
                                                bestScreen = screen;
                                                addToEnd = false;
                                              }
                                            });

                                            if (bestScreen) {
                                              if (addToEnd) {
                                                ordered.push(bestScreen);
                                              } else {
                                                ordered.unshift(bestScreen);
                                              }
                                              remaining.delete(bestScreen);
                                            } else {
                                              // No more connections, add remaining arbitrarily
                                              const next = remaining.values().next().value;
                                              if (next) {
                                                ordered.push(next);
                                                remaining.delete(next);
                                              }
                                            }
                                          }

                                          return ordered;
                                        };

                                        // Build final screen list by processing buckets in order
                                        const screenList: string[] = [];
                                        const sortedBuckets = Array.from(positionBuckets.keys()).sort((a, b) => a - b);
                                        sortedBuckets.forEach(bucket => {
                                          const screens = positionBuckets.get(bucket) || [];
                                          const optimized = optimizeBucketOrder(screens);
                                          screenList.push(...optimized);
                                        });
                                        const xLabels = Array.from({ length: Math.max(maxSteps, 40) }, (_: any, i: number) => String(i + 1));

                                        const visibleJourneys = journeys.slice(0, 30);
                                        const seriesCount = visibleJourneys.length;

                                        // Predefined distinct colors for first 3 users, then generated colors
                                        const predefinedColors = ['#DC2626', '#16A34A', '#2563EB'];
                                        const colors = Array.from({ length: seriesCount }, (_: any, i: number) =>
                                          i < predefinedColors.length ? predefinedColors[i] : hslToHex((360 * (i - predefinedColors.length)) / Math.max(1, seriesCount - predefinedColors.length), 50, 50)
                                        );

                                        // Calculate path frequency for visual hierarchy
                                        const pathFrequency = visibleJourneys.map((j: any) => {
                                          const steps = Array.isArray(j?.steps) ? j.steps : [];
                                          return steps.length;
                                        });
                                        const maxFreq = Math.max(...pathFrequency, 1);

                                        const series = visibleJourneys.map((j: any, idx: number) => {
                                          const steps = Array.isArray(j?.steps) ? j.steps : [];
                                          // Map each step to its unique screen key (name_id)
                                          const data = steps.map((s: any, i: number) => {
                                            const screenKey = getScreenKey(s);
                                            return [i, screenKey];
                                          });

                                          // Visual hierarchy: more steps = more prominent (assuming longer = more complete)
                                          const frequency = pathFrequency[idx];
                                          const normalizedFreq = frequency / maxFreq;
                                          const lineWidth = 1.2 + (normalizedFreq * 1.3); // Range: 1.2 to 2.5
                                          const opacity = 0.5 + (normalizedFreq * 0.5); // Range: 0.5 to 1.0

                                          return {
                                            name: String(j?.name || `User ${idx + 1}`),
                                            type: 'line',
                                            data,
                                            smooth: 0.3,
                                            lineStyle: {
                                              color: colors[idx],
                                              width: lineWidth,
                                              opacity: Math.max(0.25, opacity * 0.6),
                                              cap: 'round',
                                              join: 'round'
                                            },
                                            itemStyle: { color: colors[idx], opacity: Math.max(0.4, opacity * 0.7) },
                                            showSymbol: true,
                                            symbol: 'circle',
                                            symbolSize: 4,
                                            emphasis: {
                                              focus: 'series',
                                              blurScope: 'coordinateSystem',
                                              lineStyle: { width: lineWidth + 1.5, opacity: 1, shadowBlur: 4, shadowColor: colors[idx] },
                                              itemStyle: { opacity: 1, borderWidth: 2, borderColor: '#fff', symbolSize: 6 }
                                            }
                                          };
                                        });

                                        // Calculate dynamic X-axis interval based on total steps
                                        // Show every label for <=15 steps, every 2nd for <=30, every 5th for <=60, else every 10th
                                        const xAxisInterval = maxSteps <= 15 ? 0 : maxSteps <= 30 ? 1 : maxSteps <= 60 ? 4 : 9;

                                        return {
                                          color: colors,
                                          animationDuration: 600,
                                          tooltip: {
                                            show: false
                                          },
                                          legend: {
                                            top: 10,
                                            right: 10,
                                            orient: 'horizontal',
                                            align: 'auto',
                                            type: 'scroll',
                                            textStyle: { color: '#1f2937', fontSize: 12, fontWeight: 600 },
                                            itemGap: 20,
                                            itemWidth: 40,
                                            itemHeight: 14,
                                            icon: 'path://M0,7 L15,7 M15,4 A3,3,0,1,1,15,10 A3,3,0,1,1,15,4 Z M15,7 L30,7',
                                            itemStyle: {
                                              borderWidth: 0
                                            },
                                            lineStyle: {
                                              width: 2,
                                              cap: 'round'
                                            },
                                            selectedMode: 'multiple',
                                            selected: Object.fromEntries(series.map((s: any) => [s.name, true]))
                                          },
                                          grid: { left: 140, right: 16, bottom: 50, top: 80, containLabel: false },
                                          xAxis: {
                                            type: 'category',
                                            name: 'Step',
                                            nameLocation: 'middle',
                                            nameGap: 26,
                                            nameTextStyle: { color: '#1e293b', fontWeight: 600 },
                                            axisLabel: { color: '#1e293b', fontWeight: 500, interval: xAxisInterval, fontSize: 11 },
                                            axisTick: { show: true, alignWithLabel: true, lineStyle: { color: '#cbd5e1' }, interval: 0 },
                                            minorTick: { show: true, splitNumber: 5 },
                                            boundaryGap: false,
                                            axisPointer: { show: true, type: 'line', lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 } },
                                            axisLine: { lineStyle: { color: '#cbd5e1' } },
                                            splitLine: { show: true, lineStyle: { color: '#f1f5f9', type: 'solid', width: 1 } },
                                            data: xLabels
                                          },
                                          yAxis: {
                                            type: 'category',
                                            name: 'Screen Name',
                                            nameLocation: 'end',
                                            nameRotate: 0,
                                            nameGap: 10,
                                            nameTextStyle: { color: '#1e293b', fontWeight: 800, fontSize: 14, align: 'left' },
                                            axisLabel: {
                                              color: '#334155',
                                              fontSize: 12,
                                              fontWeight: 500,
                                              lineHeight: 18,
                                              hideOverlap: false,
                                              interval: 0,
                                              width: 130,
                                              overflow: 'truncate',
                                              formatter: (v: string) => {
                                                // Strip out _<screen_id> suffix if present
                                                // Format is: screen_name_screen_id
                                                let displayName = v;
                                                const lastUnderscore = v.lastIndexOf('_');
                                                if (lastUnderscore > 0) {
                                                  // Extract just the screen name part
                                                  displayName = v.substring(0, lastUnderscore);
                                                }

                                                // Apply truncation if needed
                                                if (displayName.length > 22) {
                                                  // Smart truncation at word boundary
                                                  const truncated = displayName.substring(0, 20);
                                                  const lastSpace = truncated.lastIndexOf(' ');
                                                  return lastSpace > 10 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
                                                }
                                                return displayName;
                                              },
                                              margin: 8
                                            },
                                            axisTick: { show: true, alignWithLabel: true, lineStyle: { color: '#e2e8f0' } },
                                            axisLine: { lineStyle: { color: '#e2e8f0', width: 1 } },
                                            boundaryGap: true,
                                            data: screenList
                                          },
                                          dataZoom: [
                                            // Inside zoom X-axis
                                            {
                                              type: 'inside',
                                              xAxisIndex: 0,
                                              filterMode: 'none',
                                              zoomOnMouseWheel: 'shift',
                                              moveOnMouseMove: false,
                                              moveOnMouseWheel: false,
                                              preventDefaultMouseMove: false
                                            },
                                            // Inside zoom Y-axis (NEW)
                                            {
                                              type: 'inside',
                                              yAxisIndex: 0,
                                              filterMode: 'none',
                                              zoomOnMouseWheel: 'ctrl',
                                              moveOnMouseMove: false,
                                              moveOnMouseWheel: false,
                                              preventDefaultMouseMove: false,
                                              start: 0,
                                              end: 100
                                            },
                                            // Slider zoom X-axis
                                            {
                                              type: 'slider',
                                              xAxisIndex: 0,
                                              start: 0,
                                              end: Math.min((25 / maxSteps) * 100, 100),
                                              minSpan: (5 / maxSteps) * 100,
                                              maxSpan: 100,
                                              zoomLock: false,
                                              height: 20,
                                              bottom: 5,
                                              borderRadius: 8,
                                              backgroundColor: '#f1f5f9',
                                              borderColor: '#cbd5e1',
                                              fillerColor: 'rgba(59,130,246,0.25)',
                                              handleIcon: 'path://M0,0 L0,20 L6,20 L6,0 Z',
                                              handleSize: '100%',
                                              handleStyle: {
                                                color: '#3b82f6',
                                                borderColor: '#1e40af',
                                                borderWidth: 1.5,
                                                shadowBlur: 3,
                                                shadowColor: 'rgba(0,0,0,0.2)',
                                                borderRadius: 4
                                              },
                                              moveHandleSize: 8,
                                              showDetail: true,
                                              showDataShadow: true,
                                              brushSelect: true,
                                              dataBackground: {
                                                lineStyle: { color: '#94a3b8', width: 1 },
                                                areaStyle: { color: 'rgba(148,163,184,0.1)' }
                                              },
                                              selectedDataBackground: {
                                                lineStyle: { color: '#3b82f6', width: 1.5 },
                                                areaStyle: { color: 'rgba(59,130,246,0.15)' }
                                              },
                                              textStyle: { color: '#1e293b', fontSize: 11 },
                                              emphasis: {
                                                handleStyle: {
                                                  color: '#2563eb',
                                                  shadowBlur: 6,
                                                  shadowColor: 'rgba(37,99,235,0.4)'
                                                }
                                              },
                                              throttle: 20,
                                              realtime: true
                                            },
                                            // Slider zoom Y-axis (NEW)
                                            {
                                              type: 'slider',
                                              yAxisIndex: 0,
                                              start: 0,
                                              end: 100,
                                              minSpan: 10,
                                              maxSpan: 100,
                                              zoomLock: false,
                                              width: 20,
                                              right: 5,
                                              borderRadius: 8,
                                              backgroundColor: '#f1f5f9',
                                              borderColor: '#cbd5e1',
                                              fillerColor: 'rgba(34,197,94,0.25)',
                                              handleIcon: 'path://M0,0 L20,0 L20,6 L0,6 Z',
                                              handleSize: '100%',
                                              handleStyle: {
                                                color: '#16a34a',
                                                borderColor: '#15803d',
                                                borderWidth: 1.5,
                                                shadowBlur: 3,
                                                shadowColor: 'rgba(0,0,0,0.2)',
                                                borderRadius: 4
                                              },
                                              showDetail: false,
                                              showDataShadow: false,
                                              brushSelect: true,
                                              textStyle: { color: '#1e293b', fontSize: 11 },
                                              emphasis: {
                                                handleStyle: {
                                                  color: '#22c55e',
                                                  shadowBlur: 6,
                                                  shadowColor: 'rgba(34,197,94,0.4)'
                                                }
                                              },
                                              throttle: 20,
                                              realtime: true
                                            }
                                          ],
                                          series
                                        } as any;
                                      }

                                      // Fallback: aggregated paths
                                      const paths = personaDetail?.paths || [];
                                      if (!paths.length) {
                                        return {
                                          graphic: [{ 
                                            type: 'text', 
                                            left: 'center', 
                                            top: 'middle', 
                                            style: { 
                                              text: 'No path data available', 
                                              fill: '#94a3b8', 
                                              fontSize: 14 
                                            } 
                                          }] 
                                        };
                                      }

                                      // Extract all unique screen names from paths
                                      const allScreens = new Set<string>();
                                      paths.forEach((p: any) => {
                                        const pathStr = String(p.path || '');
                                        const screens = pathStr.split('>').map(s => s.trim()).filter(Boolean);
                                        screens.forEach(screen => allScreens.add(screen));
                                      });
                                      const screenList = Array.from(allScreens);

                                      // Create series data for top 5 paths (representing user journeys)
                                      const topPaths = paths.slice(0, 5);
                                      // Determine the maximum number of steps across the selected paths
                                      const stepCounts = topPaths.map((p: any) => {
                                        const ps = String(p.path || '');
                                        return ps.split('>').map(s => s.trim()).filter(Boolean).length;
                                      });
                                      const maxSteps = stepCounts.length ? Math.max(...stepCounts) : 0;
                                      const series = topPaths.map((path: any, index: number) => {
                                        const pathStr = String(path.path || '');
                                        const screens = pathStr.split('>').map(s => s.trim()).filter(Boolean);
                                        const userData = screens.map((screen, stepIndex) => [
                                          stepIndex + 1,
                                          screen
                                        ]);
                                        
                                        return {
                                          name: `Path ${index + 1} (${path.sharePct || 0}%)`,
                                          type: 'line',
                                          data: userData,
                                          lineStyle: { color: hslToHex((360 * index) / Math.max(1, topPaths.length), 45, 48), width: 2 },
                                          itemStyle: { color: hslToHex((360 * index) / Math.max(1, topPaths.length), 45, 48) },
                                          showSymbol: true,
                                          symbol: 'circle',
                                          symbolSize: 6,
                                          emphasis: { focus: 'series' }
                                        };
                                      });

                                      return {
                                        tooltip: {
                                          trigger: 'item',
                                          backgroundColor: 'rgba(0,0,0,0.8)',
                                          borderColor: '#374151',
                                          textStyle: { color: '#f9fafb' },
                                          formatter: function(params: any) {
                                            return `${params.seriesName}<br/>Step ${params.data[0]}: ${params.data[1]}`;
                                          }
                                        },
                                        legend: {
                                          top: 30,
                                          textStyle: { color: '#e2e8f0', fontSize: 11 }
                                        },
                                        grid: {
                                          left: '3%',
                                          right: '4%',
                                          bottom: '3%',
                                          top: '15%',
                                          containLabel: true
                                        },
                                        xAxis: {
                                          type: 'category',
                                          name: 'Step Count',
                                          nameLocation: 'middle',
                                          nameGap: 30,
                                          nameTextStyle: { color: '#94a3b8' },
                                          axisLabel: { color: '#cbd5e1', interval: 0 },
                                          axisTick: { show: true, alignWithLabel: true },
                                          boundaryGap: false,
                                          axisLine: { lineStyle: { color: '#374151' } },
                                          splitLine: { show: true, lineStyle: { color: '#374151', type: 'dashed' } },
                                          data: Array.from({ length: maxSteps }, (_: any, i: number) => String(i + 1))
                                        },
                                        yAxis: {
                                          type: 'category',
                                          name: 'Screen Name',
                                          nameLocation: 'middle',
                                          nameGap: 80,
                                          nameTextStyle: { color: '#94a3b8' },
                                          axisLabel: { color: '#cbd5e1', fontSize: 10 },
                                          axisLine: { lineStyle: { color: '#374151' } },
                                          data: screenList
                                        },
                                        series: series
                                      };
                                    })()}
                                  />
                                  </div>
                                  {/* Custom tooltip for Flow Insights */}
                                  {flowTooltip && flowTooltip.visible && (
                                    <div
                                      style={{
                                        position: 'fixed',
                                        left: flowTooltip.x + 10,
                                        top: flowTooltip.y - 10,
                                        backgroundColor: 'rgba(0,0,0,0.9)',
                                        borderColor: '#374151',
                                        borderWidth: 1,
                                        borderStyle: 'solid',
                                        borderRadius: 4,
                                        padding: 12,
                                        color: '#f9fafb',
                                        fontSize: 13,
                                        pointerEvents: 'none',
                                        zIndex: 9999,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                                      }}
                                      dangerouslySetInnerHTML={{ __html: flowTooltip.content }}
                                    />
                                  )}
                                </div>

                                {/* Backtracks lollipop chart in Path tab */}
                                <div id="path-backtracks" className="tile" style={{ marginTop: 12 }}>
                                  <h4 style={{ margin: 0 }}>Backtracks by Screen</h4>
                                  <ReactECharts
                                    style={{ height: 260 }}
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
                                      const total = vals.reduce((s,v)=>s+v,0);
                                      const maxLabelLen = labelsFull.reduce((m, s) => Math.max(m, String(s || '').length), 0);
                                      const estWidth = Math.min(320, Math.max(180, Math.round(maxLabelLen * 7)));
                                      const maxVal = Math.max(...vals, 1);
                                      return {
                                        backgroundColor:'transparent',
                                        grid:{ left: estWidth + 30, right: 80, top: 20, bottom: 40 },
                                        xAxis:{ type:'value', min: 0, axisLabel:{ color:'#334155', fontWeight:600 }, axisLine:{ lineStyle:{ color:'#94a3b8' } }, splitLine:{ show:true, lineStyle:{ color:'rgba(148,163,184,0.25)' } }, name:'Backtracks', nameLocation:'middle', nameGap:26, nameTextStyle:{ color:'#94a3b8', fontSize:12 } },
                                        yAxis:{ type:'category', data: labelsFull, axisLabel:{ color:'#334155', fontWeight:600, interval:0 as any, width: estWidth as any, overflow:'break' as any, lineHeight:16 as any, margin:12 as any }, axisLine:{ lineStyle:{ color:'#94a3b8' } }, axisTick:{ show:false } },
                                        tooltip:{ trigger:'item', formatter:(p:any)=>{ const idx=p.dataIndex; const count=vals[idx]; const pct= total?((count/total)*100).toFixed(1):'0'; const name=labelsFull[idx]; return `${name}<br/>${count} backtrack${count===1?'':'s'} (${pct}%)`; } },
                                        series:[
                                          {
                                            type:'bar',
                                            data: vals.map((v, i) => ({
                                              value: v,
                                              itemStyle: {
                                                color: `rgba(147, 168, 232, ${0.4 + (v / maxVal) * 0.6})`
                                              }
                                            })),
                                            barWidth:8,
                                            z:1,
                                            label:{
                                              show:true,
                                              position:'right',
                                              color:'#0f172a',
                                              fontWeight:700,
                                              formatter:(p:any)=>{
                                                const count = p.value;
                                                const pct = total ? ((count/total)*100).toFixed(0) : '0';
                                                return `${count} (${pct}%)`;
                                              }
                                            }
                                          },
                                          {
                                            type:'pictorialBar',
                                            data: vals,
                                            symbol:'circle',
                                            symbolSize:16,
                                            symbolPosition:'end',
                                            itemStyle:{ color:'#7ea0e6', borderColor:'#6b8ad6', borderWidth:2 },
                                            z:2,
                                            emphasis: {
                                              itemStyle: {
                                                color:'#5b7fc9',
                                                borderColor:'#4a6db8',
                                                borderWidth:2,
                                                shadowBlur: 8,
                                                shadowColor: 'rgba(107, 138, 214, 0.5)'
                                              }
                                            }
                                          }
                                        ]
                                      } as any;
                                    })()}
                                  />
                                </div>
                              </>
                            )}

                            {/* What-if Simulations Tab - Disabled */}
                            {personaModalTab === 'what-if' && (
                              <div className="tile">
                                <h4>What-if Simulations</h4>
                                <div className="muted">Coming soon</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
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

