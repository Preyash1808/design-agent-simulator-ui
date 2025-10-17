"use client";
import { useEffect, useMemo, useState } from 'react';
import Toast from '../../components/Toast';
import SpinnerPortal from '../../components/SpinnerPortal';

export default function PreprocessPage() {
  const [page, setPage] = useState("");
  const [url, setUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState<{kind:'success'|'error', text:string}|null>(null);
  const [recent, setRecent] = useState<any | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  function renderStatus(status?: string) {
    const k = (status || '').toLowerCase();
    let color = 'var(--muted)';
    if (k === 'completed') color = '#10b981';
    else if (k === 'failed') color = '#ef4444';
    else if (k === 'inprogress' || k === 'in_progress' || k === 'in-progress') color = '#f59e0b';
    return <span style={{ color, fontWeight: 700 }}>{status || '-'}</span>;
  }

  async function loadRecent() {
    setLoadingRecent(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      if (r.status === 401) {
        localStorage.removeItem('sparrow_token');
        localStorage.removeItem('sparrow_user_name');
        window.dispatchEvent(new CustomEvent('authStateChanged'));
        setRecent(null);
      } else {
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const proj = items.find((it) => String(it.type).toLowerCase() === 'project');
        setRecent(proj || null);
        if (proj && String(proj.status).toUpperCase() !== 'COMPLETED') {
          const started = proj.created_at ? new Date(proj.created_at).getTime() : null;
          if (started && !Number.isNaN(started)) setElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
        } else {
          setElapsedSec(0);
        }
      }
    } catch {
      setRecent(null);
    }
    setLoadingRecent(false);
  }

  useEffect(() => { loadRecent(); }, []);

  // Tick timer while recent project exists and is not completed
  useEffect(() => {
    if (!recent || String(recent.status).toUpperCase() === 'COMPLETED') return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recent]);

  function formatElapsed(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
    const r = await fetch('/api/preprocess', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ page, figmaUrl: url, projectName }),
    });
    if (r.status === 401) {
      // force logout on unauthorized
      localStorage.removeItem('sparrow_token');
      localStorage.removeItem('sparrow_user_name');
      window.dispatchEvent(new CustomEvent('authStateChanged'));
      setShowToast({ kind: 'error', text: 'Session expired. Please sign in again.' });
      setLoading(false);
      return;
    }
    if (r.ok) {
      setShowToast({ kind: 'success', text: 'Project creation queued. Check the Status page to track progress.' });
      // Refresh recent project panel
      loadRecent();
    } else {
      setShowToast({ kind: 'error', text: 'Failed to create project. Please verify inputs.' });
    }
    setLoading(false);
  }

  return (
    <>
    <div className="card">
      <h2>Create Project</h2>
      <form onSubmit={onSubmit} className="grid" style={{ marginTop: 16 }}>
        <label>
          Project Name
          <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="My Project" />
        </label>
        <label>
          Figma File URL
          <input value={url} onChange={e => setUrl(e.target.value)} required />
        </label>
        <label>
          Figma Page
          <input value={page} onChange={e => setPage(e.target.value)} required />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary btn-sm" disabled={loading} type="submit">{loading ? 'Creating…' : 'Create Project'}</button>
        </div>
      </form>
      {showToast && (
        <Toast kind={showToast.kind} message={showToast.text} duration={3000} onClose={() => setShowToast(null)} />
      )}
    </div>

    {/* Recent Project */}
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>Recent Project</h3>
      {loadingRecent ? (
        <p className="muted" style={{ marginTop: 8 }}>Loading…</p>
      ) : recent ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 10 }}>
          <div>
            <div className="muted">Name</div>
            <div style={{ fontWeight: 700 }}>{recent.project_name || recent.name}</div>
          </div>
          <div>
            <div className="muted">Page</div>
            <div>{recent.figma_page || '-'}</div>
          </div>
          <div>
            <div className="muted">Status</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>{renderStatus(recent.status)}</div>
              {String(recent.status).toUpperCase() !== 'COMPLETED' && (
                <div className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsedSec)}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 8 }}>No recent project found.</p>
      )}
    </div>
    <SpinnerPortal show={loading} />
    </>
  );
}
