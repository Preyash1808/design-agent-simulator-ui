"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import FancySelect from '../../components/FancySelect';
import Toast from '../../components/Toast';
import SpinnerPortal from '../../components/SpinnerPortal';

export default function TestsPage() {
  const [projects, setProjects] = useState<{id: string, name: string}[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [uploadProgressPct, setUploadProgressPct] = useState<number>(0);
  const [isDraggingSource, setIsDraggingSource] = useState(false);
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState<{kind:'success'|'error', text:string}|null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const LAST_RUN_KEY = 'sparrow_last_tests_run_id';
  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);

  const sourcePreviewUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : null, [sourceFile]);
  const targetPreviewUrl = useMemo(() => targetFile ? URL.createObjectURL(targetFile) : null, [targetFile]);

  // fetch projects for dropdown (via backend when configured)
  async function loadProjects() {
    try {
      // Use our UI proxy so Authorization from the browser is forwarded
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/projects', {
        headers: {
          'Accept': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      if (!r.ok) {
        if (r.status === 401) {
          // auto-logout if unauthorized
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

  // load on mount and when auth changes
  useEffect(() => {
    loadProjects();
    const onAuth = () => loadProjects();
    window.addEventListener('authStateChanged', onAuth);
    return () => window.removeEventListener('authStateChanged', onAuth);
  }, []);

  // On first load, auto-select the most recent COMPLETED run's project if none selected
  useEffect(() => {
    (async () => {
      try {
        if (projectId) return; // do not override user selection
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status', {
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
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const runsOnly = items.filter((x: any) => (x?.type ? String(x.type).toLowerCase() === 'run' : true));
        const completed = runsOnly.filter((x: any) => String(x.status || '').toUpperCase() === 'COMPLETED');
        if (!completed.length) return;
        completed.sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
        const last = completed[0];
        const pid = String(last?.project_id || '');
        if (pid) setProjectId(pid);
      } catch {}
    })();
  }, [projectId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    let ok = false;
    try {
      if (sourceFile && targetFile) {
        const formData = new FormData();
        if (projectId) formData.set('projectId', projectId);
        formData.set('goal', goal);
        formData.set('maxMinutes', String(2));
        formData.set('source', sourceFile);
        formData.set('target', targetFile);

        // Use XHR to display upload progress for the combined payload
        const xhr = new XMLHttpRequest();
        const xhrPromise: Promise<{ status: number; responseText: string }> = new Promise((resolve, reject) => {
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const pct = Math.round((evt.loaded / evt.total) * 100);
              setUploadProgressPct(pct);
            }
          };
          xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText });
          xhr.onerror = () => reject(new Error('Network error'));
        });
        xhr.open('POST', '/api/tests');
        try {
          const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        } catch {}
        xhr.send(formData);
        const result = await xhrPromise;
        ok = result.status >= 200 && result.status < 300;
        // Extract run id to start polling
        try {
          const data = JSON.parse(result.responseText || '{}');
          const rid = data?.test_run_id || data?.db?.run_id || data?.run_id || data?.id || null;
          if (rid) {
            setActiveRunId(String(rid));
            setRunStatus('INPROGRESS');
            try { localStorage.setItem(LAST_RUN_KEY, String(rid)); } catch {}
          }
        } catch {}
      } else {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/tests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ projectId, sourceId: 15, targetId: 9, goal }),
        });
        const tx = await r.text();
        ok = r.ok;
        // Extract run id to start polling
        try {
          const data = JSON.parse(tx || '{}');
          const rid = data?.test_run_id || data?.db?.run_id || data?.run_id || data?.id || null;
          if (rid) {
            setActiveRunId(String(rid));
            setRunStatus('INPROGRESS');
            try { localStorage.setItem(LAST_RUN_KEY, String(rid)); } catch {}
          }
        } catch {}
      }
    } catch (err) {
      ok = false;
    }
    setShowToast(ok ? { kind: 'success', text: 'Run started. Check the Status page for progress.' } : { kind: 'error', text: 'Failed to start run. Verify project/inputs.' });
    setLoading(false);
  }

  // Poll run status every 20s when we have an active run id
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let intervalId: any = null;

    const poll = async () => {
      if (cancelled || !activeRunId) return;
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch(`/api/status?run_id=${encodeURIComponent(activeRunId)}`, {
          headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          cache: 'no-store',
        });
        if (!r.ok) return;
        const data = await r.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const run = items.find((it: any) => String(it?.id) === String(activeRunId));
        const status = (run?.status ? String(run.status) : '').toUpperCase();
        const startedIso = run?.created_at || run?.started_at;
        if (startedIso) {
          const ms = new Date(startedIso).getTime();
          if (!Number.isNaN(ms)) setRunStartedAtMs(ms);
        }
        if (status) {
          setRunStatus(status);
          if (status === 'COMPLETED' || status === 'FAILED') {
            if (intervalId) clearInterval(intervalId);
            try { localStorage.removeItem(LAST_RUN_KEY); } catch {}
          }
        }
      } catch {}
    };

    // immediate then interval
    poll();
    intervalId = setInterval(poll, 20000);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [activeRunId]);

  function clearRunBanner() {
    setActiveRunId(null);
    setRunStatus(null);
    setRunStartedAtMs(null);
  }

  // Rehydrate last-run if it was still in progress when leaving the page
  useEffect(() => {
    try {
      const rid = typeof window !== 'undefined' ? localStorage.getItem(LAST_RUN_KEY) : null;
      if (!rid) return;
      // Verify it's still in progress
      (async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch(`/api/status?run_id=${encodeURIComponent(rid)}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const run = items.find((it: any) => String(it?.id) === String(rid));
        const status = (run?.status ? String(run.status) : '').toUpperCase();
        const startedIso = run?.created_at || run?.started_at;
        if (startedIso) {
          const ms = new Date(startedIso).getTime();
          if (!Number.isNaN(ms)) setRunStartedAtMs(ms);
        }
        if (status === 'INPROGRESS') {
          setActiveRunId(String(rid));
          setRunStatus('INPROGRESS');
        } else {
          try { localStorage.removeItem(LAST_RUN_KEY); } catch {}
        }
      })();
    } catch {}
  }, []);

  // On mount: if no local last-run, fetch latest run and show only if it's INPROGRESS
  useEffect(() => {
    if (activeRunId) return;
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) return;
        const runs = items.filter((it: any) => (it?.type ? String(it.type).toLowerCase() : '') !== 'project');
        if (!runs.length) return;
        runs.sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
        const latest = runs[0];
        const status = (latest?.status ? String(latest.status) : '').toUpperCase();
        if (status === 'INPROGRESS' && latest?.id) {
          setActiveRunId(String(latest.id));
          setRunStatus('INPROGRESS');
          const startedIso = latest?.created_at || latest?.started_at;
          if (startedIso) {
            const ms = new Date(startedIso).getTime();
            if (!Number.isNaN(ms)) setRunStartedAtMs(ms);
          }
          try { localStorage.setItem(LAST_RUN_KEY, String(latest.id)); } catch {}
        }
      } catch {}
    })();
  }, [activeRunId]);

  // Tick elapsed seconds while in progress
  useEffect(() => {
    if (runStatus !== 'INPROGRESS' || !runStartedAtMs) return;
    const compute = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000)));
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [runStatus, runStartedAtMs]);

  function formatElapsed(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function onPickSourceClick() { sourceInputRef.current?.click(); }
  function onPickTargetClick() { targetInputRef.current?.click(); }

  function onDropSource(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSource(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) setSourceFile(file);
  }
  function onDropTarget(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingTarget(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) setTargetFile(file);
  }

  const uploading = loading && !!sourceFile && !!targetFile;

  return (
    <>
    <div className="card">
      <h2>Run Test</h2>
      <form onSubmit={onSubmit} className="grid" style={{ marginTop: 16 }}>
        <label>
          Project
          <FancySelect
            value={projectId}
            onChange={setProjectId}
            placeholder="Select project"
            options={projects.map(p => ({ value: p.id, label: p.name }))}
            searchable={false}
          />
        </label>
        
        <div className="row">
          <div className="uploader">
            <div
              className={`dropzone ${isDraggingSource ? 'dragging' : ''}`}
              onDragOver={e => { e.preventDefault(); setIsDraggingSource(true); }}
              onDragLeave={() => setIsDraggingSource(false)}
              onDrop={onDropSource}
              onClick={onPickSourceClick}
              role="button"
              aria-label="Select or drop source image"
              tabIndex={0}
            >
              <input
                ref={sourceInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => setSourceFile(e.target.files?.[0] || null)}
              />
              <div className="dz-inner">
                <div className="dz-title">Source image</div>
                <div className="dz-sub">Drag & drop or click to select</div>
              </div>
            </div>
            {sourceFile && (
              <div className="filelist">
                <div className="fileitem">
                  {sourcePreviewUrl && (<img className="thumb" src={sourcePreviewUrl} alt="Source preview" />)}
                  <div className="filemeta">
                    <div className="name">{sourceFile.name}</div>
                    <div className="sub">{Math.round(sourceFile.size/1024)} KB · {uploading ? `${uploadProgressPct}%` : 'Ready'}</div>
                    {uploading && (
                      <div className="progress"><span style={{ width: `${uploadProgressPct}%` }} /></div>
                    )}
                  </div>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setSourceFile(null)}>Remove</button>
                </div>
              </div>
            )}
          </div>

          <div className="uploader">
            <div
              className={`dropzone ${isDraggingTarget ? 'dragging' : ''}`}
              onDragOver={e => { e.preventDefault(); setIsDraggingTarget(true); }}
              onDragLeave={() => setIsDraggingTarget(false)}
              onDrop={onDropTarget}
              onClick={onPickTargetClick}
              role="button"
              aria-label="Select or drop target image"
              tabIndex={0}
            >
              <input
                ref={targetInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => setTargetFile(e.target.files?.[0] || null)}
              />
              <div className="dz-inner">
                <div className="dz-title">Target image</div>
                <div className="dz-sub">Drag & drop or click to select</div>
              </div>
            </div>
            {targetFile && (
              <div className="filelist">
                <div className="fileitem">
                  {targetPreviewUrl && (<img className="thumb" src={targetPreviewUrl} alt="Target preview" />)}
                  <div className="filemeta">
                    <div className="name">{targetFile.name}</div>
                    <div className="sub">{Math.round(targetFile.size/1024)} KB · {uploading ? `${uploadProgressPct}%` : 'Ready'}</div>
                    {uploading && (
                      <div className="progress"><span style={{ width: `${uploadProgressPct}%` }} /></div>
                    )}
                  </div>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setTargetFile(null)}>Remove</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <label>
          Goal
          <textarea rows={3} value={goal} onChange={e => setGoal(e.target.value)} required />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-primary" disabled={loading} type="submit">{loading ? (sourceFile && targetFile ? `Uploading ${uploadProgressPct}%…` : 'Running…') : 'Run Test'}</button>
          {(sourceFile || targetFile) && (
            <button className="btn-ghost" type="button" onClick={() => { setSourceFile(null); setTargetFile(null); setUploadProgressPct(0); }}>Clear files</button>
          )}
        </div>
      </form>
      {(activeRunId && runStatus) && (
        <div className="last-run" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Last Run</div>
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>Run Id: {activeRunId}</div>
          <div style={{ marginTop: 8, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {runStatus === 'COMPLETED' ? (
                <span className="text-success">Completed</span>
              ) : runStatus === 'FAILED' ? (
                <span className="text-error">Failed</span>
              ) : (
                <span>In progress…</span>
              )}
            </div>
            {runStatus === 'INPROGRESS' && (
              <div className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsedSec)}</div>
            )}
          </div>
          {runStatus === 'INPROGRESS' && (
            <div className="progress indeterminate ice" style={{ marginTop: 8 }}>
              <span style={{ width: '100%' }} />
            </div>
          )}
        </div>
      )}
      {showToast && (
        <Toast kind={showToast.kind} message={showToast.text} duration={3000} onClose={() => setShowToast(null)} />
      )}
    </div>
    <SpinnerPortal show={loading} />
    </>
  );
}
