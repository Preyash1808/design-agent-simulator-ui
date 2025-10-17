"use client";
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SpinnerPortal from '../../components/SpinnerPortal';

type Item = {
  id: string;
  type: 'project' | 'run';
  name: string; // project name
  project_name?: string;
  status: string;
  created_at: string;
  updated_at?: string;
  kind?: string;
  goal?: string;
  log_path?: string;
  figma_url?: string;
  figma_page?: string;
  report_url?: string;
};

export default function StatusPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load() {
    setLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (r.status === 401) {
        // auto-logout on unauthorized
        localStorage.removeItem('sparrow_token');
        localStorage.removeItem('sparrow_user_name');
        window.dispatchEvent(new CustomEvent('authStateChanged'));
        setItems([]);
      } else {
        const data = await r.json();
        setItems((data.items || []) as Item[]);
      }
    } catch {
      setItems([]);
    }
    setLoading(false);
  }

  // Initial load once
  useEffect(() => { load(); }, []);

  const latestProject = useMemo(() => {
    return items.find((it) => String(it.type).toLowerCase() === 'project');
  }, [items]);
  const latestInProgress = useMemo(() => {
    const s = String(latestProject?.status || '').toLowerCase();
    return s === 'inprogress' || s === 'in_progress' || s === 'in-progress';
  }, [latestProject]);

  // Poll only when the latest project is INPROGRESS
  useEffect(() => {
    if (!latestInProgress) return;
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [latestInProgress]);

  function renderStatus(status: string) {
    const k = (status || '').toLowerCase();
    if (k === 'completed') return <span className="badge green">COMPLETED</span>;
    if (k === 'failed') return <span className="badge red">FAILED</span>;
    if (k === 'inprogress' || k === 'in_progress' || k === 'in-progress') return <span className="badge orange">INPROGRESS</span>;
    return <span className="muted">{status || '-'}</span>;
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [items, pageSize]);
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return (
    <>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}>
        <button
          onClick={() => { if (typeof window !== 'undefined' && window.history.length > 1) { window.history.back(); } else { window.location.href = '/'; } }}
          title="Back"
          aria-label="Back"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(148,163,184,0.35)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
            color: '#e5e7eb',
            padding: '6px 12px',
            borderRadius: 999,
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(2,6,23,0.35)'
          }}
          onMouseEnter={(e) => {
            (e.currentTarget.style as any).background = 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))';
            (e.currentTarget.style as any).transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget.style as any).background = 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))';
            (e.currentTarget.style as any).transform = 'translateY(0)';
          }}
        >&lt;&lt;</button>
        <h2 style={{ margin: 0 }}>Status</h2>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)' }}>
              {['Id','Type','Project','Figma','Page','Goal','Status','Created At','Report'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((it) => (
              <tr key={`${it.type}-${it.id}`}>
                <td className="mono">{it.id}</td>
                <td>{it.type}</td>
                <td>{it.project_name || it.name}</td>
                <td>{it.figma_url ? <a href={it.figma_url} target="_blank">open</a> : '-'}</td>
                <td>{it.figma_page || '-'}</td>
                <td className="muted clip">{it.goal || '-'}</td>
                <td>{renderStatus(it.status)}</td>
                <td>{new Date(it.created_at).toLocaleString()}</td>
                <td>
                  {it.type === 'run' ? (
                    it.report_url ? <a href={it.report_url} target="_blank" download>persona_summary.csv</a> : '-'
                  ) : (
                    '-' 
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted" style={{ padding: '14px 12px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>No data available</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Pagination controls */}
      <div className="pagination-bar" style={{
        marginTop: 10,
        padding: '8px 10px',
        background: 'transparent',
        borderTop: '1px solid var(--border)'
      }}>
        <div className="pager-info" style={{ color: '#94a3b8', fontWeight: 600 as any }}>Showing {(items.length === 0) ? 0 : ((page - 1) * pageSize + 1)}–{Math.min(page * pageSize, items.length)} of {items.length}</div>
        <div className="pager-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Rows per page
            <select
              className="pager-select"
              value={pageSize}
              onChange={(e) => { setPage(1); setPageSize(parseInt(e.target.value) || 10); }}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: '#cbd5e1',
                borderRadius: 6,
                padding: '4px 8px'
              }}
            >
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button
            className="pager-button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: '#cbd5e1',
              borderRadius: 8,
              padding: '6px 10px'
            }}
          >Prev</button>
          <div className="muted" style={{ minWidth: 90, textAlign: 'center', color: '#cbd5e1' }}>Page {page} / {totalPages}</div>
          <button
            className="pager-button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: '#cbd5e1',
              borderRadius: 8,
              padding: '6px 10px'
            }}
          >Next</button>
        </div>
      </div>
    </div>
    <SpinnerPortal show={loading} />
    </>
  );
}


