"use client";
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export default function Home() {
  const [name, setName] = useState<string | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cached = localStorage.getItem('sparrow_user_name');
    if (cached) setName(cached);
    // Load recent activity (last project and run)
    (async () => {
      try {
        const token = localStorage.getItem('sparrow_token');
        const r = await fetch('/api/status', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        const items = (data.items || []) as any[];
        items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        // Keep full list for accurate derived picks (latest completed run may not be in first 6)
        setActivity(items);
      } catch {}
    })();
  }, []);
  const lastProject = useMemo(() => (activity || []).find((x:any) => String(x.type).toLowerCase()==='project'), [activity]);
  const lastRun = useMemo(() => (activity || []).find((x:any) => String(x.type).toLowerCase()==='run'), [activity]);
  const lastCompletedRun = useMemo(() => {
    const runs = (activity || []).filter((x:any) => String(x.type).toLowerCase()==='run' && String(x.status||'').toUpperCase()==='COMPLETED');
    if (!runs.length) return null as any;
    runs.sort((a:any,b:any)=> new Date(b.updated_at || b.finished_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.finished_at || a.created_at || 0).getTime());
    return runs[0];
  }, [activity]);

  function relTime(ts?: any): string {
    if (!ts) return '-';
    let tNum: number | null = null;
    if (typeof ts === 'number') tNum = ts;
    else if (typeof ts === 'string' && /^\d+(\.\d+)?$/.test(ts)) tNum = parseFloat(ts);
    const ms = (() => {
      if (tNum != null) {
        // Seconds vs milliseconds heuristic
        return tNum < 1e12 ? Math.floor(tNum * 1000) : Math.floor(tNum);
      }
      return new Date(ts).getTime();
    })();
    const t = ms;
    if (!isFinite(t)) return '-';
    const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }
  return (
    <div>
      <div className="dash-header">Welcome, {name ? name : 'User'}!</div>
      


      <div className="dash-row">
        <div className="tile">
          <h4>Quick Start</h4>
          <p className="muted">Get up and running with Sparrow</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
            {(process.env.NEXT_PUBLIC_UNIFIED_FLOW === '1' || process.env.NEXT_PUBLIC_UNIFIED_FLOW === 'true') ? (
              <Link className="btn-primary btn-sm" href="/create-run">Launch Test</Link>
            ) : (
              <>
                <Link className="btn-primary btn-sm" href="/preprocess">Create Project</Link>
                <Link className="btn-ghost" href="/tests">Run Test</Link>
              </>
            )}
          </div>
        </div>
        <div className="tile">
          <h4>Recent Activity</h4>
          <ul className="muted" style={{ lineHeight: 1.9, marginTop: 6 }}>
            <li>Project created {relTime(lastProject?.created_at)}</li>
            <li>Persona tests finished {relTime(lastCompletedRun?.updated_at || lastCompletedRun?.finished_at)}</li>
            <li>Report generated 3h ago</li>
          </ul>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <Link className="btn-ghost btn-sm" href="/status">See more</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
