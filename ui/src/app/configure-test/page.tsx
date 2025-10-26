"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import StepIndicator from '../../components/StepIndicator';
import FancySelect from '../../components/FancySelect';
import SegmentedToggle from '../../components/SegmentedToggle';
import PersonaPicker from '../../components/persona/PersonaPicker';
import { IconPlus, IconLayers } from '../../components/icons';

export default function CreateRunUnifiedPage() {
  const [useExisting, setUseExisting] = useState(false);
  const [initReady, setInitReady] = useState(false);
  const [allProjects, setAllProjects] = useState<{id:string,name:string}[]>([]);
  const [projects, setProjects] = useState<{id:string,name:string}[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [page, setPage] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [testType, setTestType] = useState<'figma'|'webapp'>('figma');
  const [appUrl, setAppUrl] = useState('');
  const [maxMinutes, setMaxMinutes] = useState(2);
  const [taskName, setTaskName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [expectedUrl, setExpectedUrl] = useState('');
  const [requiredElements, setRequiredElements] = useState('');
  const [excludedElements, setExcludedElements] = useState('');
  const [step, setStep] = useState<'choose'|'preprocess'|'tests'|'personas'|'done'>('choose');
  const [loading, setLoading] = useState(false);
  const [preprocessInfo, setPreprocessInfo] = useState<any|null>(null);
  const [status, setStatus] = useState<any|null>(null);
  const [goal, setGoal] = useState('');
  const [showErrorsChoose, setShowErrorsChoose] = useState(false);
  const [showErrorsTests, setShowErrorsTests] = useState(false);
  const [sourceFile, setSourceFile] = useState<File|null>(null);
  const [targetFile, setTargetFile] = useState<File|null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingSource, setIsDraggingSource] = useState(false);
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);
  const sourcePreviewUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : null, [sourceFile]);
  const targetPreviewUrl = useMemo(() => targetFile ? URL.createObjectURL(targetFile) : null, [targetFile]);

  // Multi-task state
  type TaskItem = {
    id: string;
    taskName: string;
    task: string;
    sourceFile: File | null;
    targetFile: File | null;
    sourcePreview: string | null;
    targetPreview: string | null;
  };
  const [tasks, setTasks] = useState<TaskItem[]>([
    { id: crypto.randomUUID(), taskName: '', task: '', sourceFile: null, targetFile: null, sourcePreview: null, targetPreview: null }
  ]);
  const [expandedTaskId, setExpandedTaskId] = useState<string>(tasks[0]?.id || '');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [preprocessStartedAtMs, setPreprocessStartedAtMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [activeRunStatus, setActiveRunStatus] = useState<string | null>(null);
  const [activeRunLog, setActiveRunLog] = useState<string | null>(null);
  const [activeTaskName, setActiveTaskName] = useState<string>('');
  const [runElapsedSec, setRunElapsedSec] = useState(0);
  const runStartRef = useRef<number | null>(null);
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [recent, setRecent] = useState<any | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [pageSeconds, setPageSeconds] = useState(0);
  const [bootLoading, setBootLoading] = useState(true);
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const [defaultCompletedProjectId, setDefaultCompletedProjectId] = useState('');
  const [hasAnyProjects, setHasAnyProjects] = useState<boolean>(true);

  const unifiedEnabled = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_UNIFIED_FLOW === '1' || process.env.NEXT_PUBLIC_UNIFIED_FLOW === 'true') : true;
  const STATE_KEY = 'sparrow_launch_state_v1';
  const restoredRef = useRef(false);
  const previousTestTypeRef = useRef<'figma'|'webapp'>(testType);

  // Reset form when testType changes (toggle between Web App and Design File)
  useEffect(() => {
    if (previousTestTypeRef.current !== testType) {
      // Reset to initial state when toggle changes
      setStep('choose');
      setProjectName('');
      setFigmaUrl('');
      setPage('');
      setAppUrl('');
      setEmail('');
      setPassword('');
      setGoal('');
      setTaskName('');
      setExpectedUrl('');
      setRequiredElements('');
      setExcludedElements('');
      setSourceFile(null);
      setTargetFile(null);
      setTasks([
        { id: crypto.randomUUID(), taskName: '', task: '', sourceFile: null, targetFile: null, sourcePreview: null, targetPreview: null }
      ]);
      setShowErrorsChoose(false);
      setShowErrorsTests(false);
      setPreprocessInfo(null);

      // Update the ref to current testType
      previousTestTypeRef.current = testType;
    }
  }, [testType]);

  useEffect(() => {
    // Restore any saved state for this login session; then compute defaults if not restored
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const raw = typeof window !== 'undefined' ? localStorage.getItem(STATE_KEY) : null;
        if (token && raw) {
          try {
            const saved = JSON.parse(raw);
            if (saved && saved.token === token) {
              if (saved.step && ['choose','preprocess','tests','personas','done'].includes(saved.step)) setStep(saved.step);
              if (typeof saved.useExisting === 'boolean') setUseExisting(!!saved.useExisting);
              if (saved.selectedProjectId) setSelectedProjectId(String(saved.selectedProjectId));
              if (saved.projectName) setProjectName(String(saved.projectName));
              if (saved.page) setPage(String(saved.page));
              if (saved.figmaUrl) setFigmaUrl(String(saved.figmaUrl));
              if (saved.goal) setGoal(String(saved.goal));
              restoredRef.current = true;
            }
          } catch {}
        }
      } catch {}
      try {
        // Prefer the most recent COMPLETED project for defaults
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status?attach_signed_urls=0', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const projectsOnly = items.filter(it => String(it.type).toLowerCase()==='project');
        // Filter by kind based on testType: figma (including null for backward compatibility) or webapp
        const matchingKind = projectsOnly.filter((p:any)=> {
          const kind = String(p.kind||'').toLowerCase();
          if (testType === 'figma') {
            // For figma, show projects with kind='figma' OR kind=null (backward compatibility)
            return kind === 'figma' || kind === '';
          } else {
            // For webapp, only show projects with kind='webapp'
            return kind === 'webapp';
          }
        });
        const completed = matchingKind.filter((p:any)=> String(p.status||'').toUpperCase()==='COMPLETED');
        const completedIds = completed.map((p:any)=> String(p.project_id || p.id || ''))
                                     .filter((s:string)=> !!s);
        setCompletedProjectIds(completedIds);
        if (completed.length > 0) {
          setUseExisting(true);
          // Pick latest COMPLETED by updated_at/created_at
          completed.sort((a:any,b:any)=> new Date(b.updated_at||b.created_at||0).getTime() - new Date(a.updated_at||a.created_at||0).getTime());
          const lastCompleted = completed[0];
          const pid = String(lastCompleted?.project_id || lastCompleted?.id || '');
          setDefaultCompletedProjectId(pid);
          if (pid) setSelectedProjectId(pid);
        } else {
          // No completed projects - start with new project
          setUseExisting(false);
        }
      } catch {}
      setInitReady(true);
    })();
    // Load projects for existing selection (can happen in parallel; UI waits on initReady)
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/projects', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        const list: any[] = Array.isArray(data?.projects) ? data.projects : [];
        const mappedProjects = list.map(p => ({ id: String(p.id), name: String(p.name||p.id) }));
        setAllProjects(mappedProjects);
        setHasAnyProjects(mappedProjects.length > 0);
      } catch {
        setHasAnyProjects(false);
      }
    })();
    // Land on Results if latest run is INPROGRESS, or if latest COMPLETED finished within last 5 minutes
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status?attach_signed_urls=0', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        const runsOnly: any[] = (data.items || []).filter((x:any) => String(x.type).toLowerCase() === 'run');
        if (!runsOnly.length) return;
        runsOnly.sort((a:any,b:any)=> new Date(b.updated_at||b.created_at||0).getTime() - new Date(a.updated_at||a.created_at||0).getTime());
        const latest = runsOnly[0];
        const latestStatus = String(latest.status || '').toUpperCase();
        const ridLatest = String(latest.id || latest.run_id || '');
        if (latestStatus === 'INPROGRESS' && ridLatest) {
          setActiveRunId(ridLatest);
          setActiveRunStatus('INPROGRESS');
          if (latest.log_path) setActiveRunLog(String(latest.log_path));
          // Restore task name from backend data if available
          if (latest.task_name) {
            setActiveTaskName(String(latest.task_name));
          }
          const started = new Date(latest.created_at || latest.started_at || latest.updated_at || Date.now()).getTime();
          runStartRef.current = started;
          setRunStartMs(started);
          setStep('done');
          return;
        }
        const completed = runsOnly.find((x:any)=> String(x.status||'').toUpperCase()==='COMPLETED');
        if (!completed) return;
        const finishedAtMs = new Date(completed.updated_at || completed.created_at || Date.now()).getTime();
        if ((Date.now() - finishedAtMs) <= 5 * 60 * 1000) {
          const rid = String(completed.id || completed.run_id || '');
          if (rid) {
            setActiveRunId(rid);
            setActiveRunStatus('COMPLETED');
            if (completed.log_path) setActiveRunLog(String(completed.log_path));
            // Restore task name from backend data if available
            if (completed.task_name) {
              setActiveTaskName(String(completed.task_name));
            }
          }
          setStep('done');
        }
      } catch {}
      finally {
        // We decide the landing step (possibly 'done') before revealing the page
        setBootLoading(false);
      }
    })();
  }, []);

  // Reload projects when testType changes
  useEffect(() => {
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/status?attach_signed_urls=0', { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const projectsOnly = items.filter(it => String(it.type).toLowerCase()==='project');
        // Filter by kind based on testType: figma (including null for backward compatibility) or webapp
        const matchingKind = projectsOnly.filter((p:any)=> {
          const kind = String(p.kind||'').toLowerCase();
          if (testType === 'figma') {
            // For figma, show projects with kind='figma' OR kind=null (backward compatibility)
            return kind === 'figma' || kind === '';
          } else {
            // For webapp, only show projects with kind='webapp'
            return kind === 'webapp';
          }
        });
        const completed = matchingKind.filter((p:any)=> String(p.status||'').toUpperCase()==='COMPLETED');
        const completedIds = completed.map((p:any)=> String(p.project_id || p.id || ''))
                                     .filter((s:string)=> !!s);
        setCompletedProjectIds(completedIds);
        if (completed.length > 0) {
          // Always set to use existing if there are completed projects
          if (!useExisting) setUseExisting(true);
          // Always update the default and selected project when testType changes
          completed.sort((a:any,b:any)=> new Date(b.updated_at||b.created_at||0).getTime() - new Date(a.updated_at||a.created_at||0).getTime());
          const lastCompleted = completed[0];
          const pid = String(lastCompleted?.project_id || lastCompleted?.id || '');
          setDefaultCompletedProjectId(pid);
          if (pid) setSelectedProjectId(pid);
        } else {
          // No completed projects for this type - clear selection and switch to new project
          setDefaultCompletedProjectId('');
          setSelectedProjectId('');
          setUseExisting(false);
        }
      } catch {}
    })();
  }, [testType]);

  // Persist state for current login session
  useEffect(() => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      if (!token) return;
      const payload = { token, step, useExisting, selectedProjectId, projectName, page, figmaUrl, goal };
      localStorage.setItem(STATE_KEY, JSON.stringify(payload));
    } catch {}
  }, [step, useExisting, selectedProjectId, projectName, page, figmaUrl, goal]);

  // Clear saved state on logout (authStateChanged without token)
  useEffect(() => {
    const onAuth = () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        if (!token) {
          localStorage.removeItem(STATE_KEY);
          setStep('choose');
        }
      } catch {}
    };
    window.addEventListener('authStateChanged', onAuth);
    return () => window.removeEventListener('authStateChanged', onAuth);
  }, []);

  // Load recent project like the old Create Project page
  function renderStatus(status?: string) {
    const k = (status || '').toLowerCase();
    let color = 'var(--muted)';
    if (k === 'completed') color = '#10b981';
    else if (k === 'failed') color = '#ef4444';
    else if (k === 'inprogress' || k === 'in_progress' || k === 'in-progress') color = '#f59e0b';
    return <span style={{ color, fontWeight: 700 }}>{status || '-'}</span>;
  }
  function formatElapsed(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  async function loadRecent() {
    setLoadingRecent(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const r = await fetch('/api/status?attach_signed_urls=0', { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      if (r.status === 401) {
        localStorage.removeItem('sparrow_token');
        localStorage.removeItem('sparrow_user_name');
        window.dispatchEvent(new CustomEvent('authStateChanged'));
        setRecent(null);
      } else {
        const data = await r.json();
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        const projectsOnly = items.filter((it:any) => String(it.type).toLowerCase() === 'project');
        // Filter by kind based on testType: figma (including null for backward compatibility) or webapp
        const matchingKind = projectsOnly.filter((p:any)=> {
          const kind = String(p.kind||'').toLowerCase();
          if (testType === 'figma') {
            // For figma, show projects with kind='figma' OR kind=null (backward compatibility)
            return kind === 'figma' || kind === '';
          } else {
            // For webapp, only show projects with kind='webapp'
            return kind === 'webapp';
          }
        });
        // Pick latest by updated_at or created_at, regardless of status
        matchingKind.sort((a:any,b:any)=> new Date(b.updated_at||b.created_at||0).getTime() - new Date(a.updated_at||a.created_at||0).getTime());
        const proj = matchingKind[0] || null;
        setRecent(proj);
        if (proj && String(proj.status).toUpperCase() !== 'COMPLETED') {
          const started = proj.created_at ? new Date(proj.created_at).getTime() : (proj.updated_at ? new Date(proj.updated_at).getTime() : null);
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
  useEffect(() => { loadRecent(); }, [testType]);
  // Fallback: always show UI within 700ms even if network is slow
  useEffect(() => { const t = setTimeout(() => setBootLoading(false), 700); return () => clearTimeout(t); }, []);
  
  // Derive the filtered project list (COMPLETED only) whenever sources change
  useEffect(() => {
    try {
      if (allProjects.length === 0) { setProjects([]); return; }
      if (completedProjectIds.length === 0) {
        // If we don't yet know completed ids, keep current selection but show empty list until status arrives
        setProjects(allProjects.filter(p => completedProjectIds.includes(p.id)));
        return;
      }
      const filtered = allProjects.filter(p => completedProjectIds.includes(p.id));
      setProjects(filtered);
      // If current selection is not in filtered set, default to latest completed
      const exists = filtered.some(p => p.id === selectedProjectId);
      if (!exists && defaultCompletedProjectId) {
        setSelectedProjectId(defaultCompletedProjectId);
      }
    } catch {}
  }, [allProjects, completedProjectIds, defaultCompletedProjectId]);
  useEffect(() => {
    if (!recent || String(recent.status).toUpperCase() === 'COMPLETED') return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recent]);

  // Page timer: increments every second while on Results tab
  useEffect(() => {
    if (step !== 'done') return;
    setPageSeconds(0);
    const id = setInterval(() => setPageSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  // Poll combined status when we have a run_id from preprocess
  useEffect(() => {
    if (!preprocessInfo?.run_id || step !== 'preprocess') return;
    let stop = false;
    const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/status?run_id=${encodeURIComponent(preprocessInfo.run_id)}`, { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        setStatus(data);
        const item = (data.items || []).find((x:any)=> String(x.type).toLowerCase()==='project' && String(x.run_dir||'').includes(preprocessInfo.run_id));
        const st = String(item?.status || '').toUpperCase();
        if (st === 'COMPLETED') {
          setStep('tests');
        } else if (st === 'FAILED') {
          // stay on preprocess but show failed
        }
      } catch {}
      if (!stop) setTimeout(tick, 4000);
    };
    tick();
    return () => { stop = true; };
  }, [preprocessInfo?.run_id, step]);

  async function startPreprocess(e: React.FormEvent) {
    e.preventDefault();
    if (useExisting && !selectedProjectId) { setShowErrorsChoose(true); return; }
    if (!useExisting && testType === 'figma' && (!figmaUrl || !projectName)) { setShowErrorsChoose(true); return; }
    if (!useExisting && testType === 'webapp' && (!appUrl || !projectName)) { setShowErrorsChoose(true); return; }
    setLoading(true);
    try {
      if (useExisting) {
        // Skip to tests step directly; ensure project is ready via status API
        setStep('tests');
      } else if (testType === 'webapp') {
        // Web app testing: Create project (preprocess) then move to test setup
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/preprocess-webapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            projectName: projectName || 'Web App Project',
            appUrl,
            email: email || undefined,
            password: password || undefined,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.detail || data?.error || 'Failed to create web app project');

        // Store project info and move to tests step
        setPreprocessInfo(data);
        setStep('tests');
      } else {
        // Figma testing: preprocess as usual
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const r = await fetch('/api/preprocess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ page, figmaUrl, projectName: projectName || page }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.detail || data?.error || 'preprocess failed');
        setPreprocessInfo(data);
        setPreprocessStartedAtMs(Date.now());
        setStep('preprocess');
      }
    } catch (err:any) {
      alert(String(err?.message || err || 'Failed'));
    }
    setLoading(false);
  }

  async function startTests(e: React.FormEvent) {
    e.preventDefault();
    if (!goal || !sourceFile || !targetFile) { setShowErrorsTests(true); return; }
    // Navigate to persona selection instead of immediately starting the run
    setStep('personas');
  }

  // Generic status refresh: uses activeRunId when present, otherwise discovers latest run
  async function refreshStatus() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const url = activeRunId ? (`/api/status?run_id=${encodeURIComponent(activeRunId)}`) : '/api/status';
      const r = await fetch(url, { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      let runItem: any = null;
      if (activeRunId) {
        runItem = (data.items || []).find((x:any)=> String(x.type).toLowerCase()==='run' && String(x.id)===String(activeRunId));
      }
      if (!runItem) {
        const runsOnly: any[] = (data.items || []).filter((x:any)=> String(x.type).toLowerCase()==='run');
        if (runsOnly.length) {
          runsOnly.sort((a:any,b:any)=> new Date(b.updated_at||b.created_at||0).getTime() - new Date(a.updated_at||a.created_at||0).getTime());
          runItem = runsOnly[0];
        }
      }
      if (runItem) {
        const rid = String(runItem.id || '');
        if (rid && !activeRunId) setActiveRunId(rid);
        setActiveRunStatus(String(runItem.status || ''));
        setActiveRunLog(runItem.log_path || null);
        if (!runStartRef.current) {
          const startedAt = new Date(runItem.created_at || runItem.started_at || runItem.updated_at || Date.now()).getTime();
          runStartRef.current = startedAt;
          setRunElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }
      }
    } catch {}
  }

  // When entering Results tab, refresh status immediately
  useEffect(() => {
    if (step !== 'done') return;
    refreshStatus();
  }, [step]);

  // Poll status every 20 seconds while on Results tab
  useEffect(() => {
    if (step !== 'done') return;
    let stop = false;
    const tick = async () => {
      try { await refreshStatus(); } catch {}
      if (!stop) setTimeout(tick, 20000);
    };
    tick();
    return () => { stop = true; };
  }, [step, activeRunId]);

  async function launchRun(personaConfigs: { personaId: number; traits: string; users: number }[], exclusiveUsers: boolean) {
    console.log('[launchRun] Called with personaConfigs:', personaConfigs, 'exclusiveUsers:', exclusiveUsers);
    console.log('[launchRun] testType:', testType);

    setLoading(true);
    try {
      const projectId = useExisting ? selectedProjectId : String(preprocessInfo?.db?.project_id || '');
      if (!projectId) throw new Error('Missing projectId');

      // Handle Web App Tests (Phase 4: Multi-persona support)
      if (testType === 'webapp') {
        if (!goal) {
          alert('Please configure the test goal before starting.');
          setLoading(false);
          return;
        }

        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;

        // Build personas array for Phase 4
        const personas = personaConfigs.map(p => ({
          personaId: p.personaId,
          name: p.name || `Persona ${p.personaId}`,  // Fixed: use short name, not full traits
          traits: p.traits,
          users: p.users
        }));

        const r = await fetch('/api/web-app-tests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            projectId,
            goal,
            maxMinutes: 5,
            taskName: taskName || undefined,
            expectedUrl: expectedUrl || undefined,
            requiredElements: requiredElements ? requiredElements.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            excludedElements: excludedElements ? excludedElements.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            personas: personas.length > 0 ? personas : undefined
          }),
        });

        const data = await r.json();
        if (!r.ok) throw new Error(data?.detail || data?.error || 'web app test failed');

        // Handle batch response (Phase 4) - Single run_id architecture
        const rid = String(data?.run_id || '');
        if (rid) {
          setActiveRunId(rid);
          setActiveTaskName(taskName || goal);
        }

        const now = Date.now();
        runStartRef.current = now;
        setRunStartMs(now);
        setRunElapsedSec(0);
        setActiveRunStatus('INPROGRESS');
        if (data?.log) setActiveRunLog(data.log);
        setStep('done');
      }
      // Handle Figma Tests (existing logic)
      else {
        console.log('[launchRun] Current state - tasks:', tasks);
        console.log('[launchRun] Old state - goal:', goal, 'sourceFile:', sourceFile, 'targetFile:', targetFile);

        // Use tasks array if available (new system), otherwise fall back to old goal/sourceFile/targetFile
        let taskToUse = null;
        let goalToUse = '';
        let sourceToUse = null;
        let targetToUse = null;

        if (tasks && tasks.length > 0) {
          // Find first valid task with all required fields
          taskToUse = tasks.find(t => t.taskName.trim() && t.task.trim() && t.sourceFile && t.targetFile);
          if (taskToUse) {
            goalToUse = taskToUse.task;
            sourceToUse = taskToUse.sourceFile;
            targetToUse = taskToUse.targetFile;
            console.log('[launchRun] Using task from tasks array:', taskToUse);
            setActiveTaskName(String(taskToUse.taskName || ''));
          }
        }

        // Fallback to old system if tasks not available
        if (!goalToUse && goal && sourceFile && targetFile) {
          goalToUse = goal;
          sourceToUse = sourceFile;
          targetToUse = targetFile;
          console.log('[launchRun] Using old goal/sourceFile/targetFile');
        }

        if (!goalToUse || !sourceToUse || !targetToUse) {
          console.error('[launchRun] Missing required fields - goalToUse:', goalToUse, 'sourceToUse:', sourceToUse, 'targetToUse:', targetToUse);
          alert('Please configure the test task and screens before starting the test.');
          setLoading(false);
          return;
        }

        const form = new FormData();
        form.set('projectId', projectId);
        form.set('goal', goalToUse); // maps to Task Description
        try { if (taskToUse?.taskName) form.set('taskName', String(taskToUse.taskName)); } catch {}
        form.set('maxMinutes', String(2));
        form.set('source', sourceToUse);
        form.set('target', targetToUse);
        try {
          form.set('personas', JSON.stringify(personaConfigs || []));
          form.set('exclusiveUsers', String(!!exclusiveUsers));
        } catch {}

        const xhr = new XMLHttpRequest();
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const p = new Promise<{status:number, body:any}>((resolve, reject) => {
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              setUploadPct(Math.round((evt.loaded/evt.total)*100));
            }
          };
          xhr.onerror = () => reject(new Error('network error'));
          xhr.onload = () => {
            try { resolve({ status: xhr.status, body: JSON.parse(xhr.responseText||'{}') }); }
            catch { resolve({ status: xhr.status, body: {} }); }
          };
        });
        xhr.open('POST', '/api/tests');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(form);
        const res = await p;
        if (res.status < 200 || res.status >= 300) throw new Error('tests start failed');
        const rid = String(res.body?.db?.run_id || res.body?.test_run_id || '');
        if (rid) {
          console.log('[LAUNCH DEBUG] Setting activeRunId:', rid);
          setActiveRunId(rid);
        }
        // initialize timer immediately
        const now = Date.now();
        console.log('[LAUNCH DEBUG] Setting runStartRef.current to:', now);
        runStartRef.current = now;
        setRunStartMs(now);
        setRunElapsedSec(0);
        setStep('done');
      }
    } catch (err:any) {
      alert(String(err?.message || err || 'Failed'));
    }
    setLoading(false);
  }

  // Poll run status after tests start (uses DB run id via /api/status?run_id=...)
  useEffect(() => {
    if (!activeRunId || step !== 'done') return;
    let stop = false;
    const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/status?run_id=${encodeURIComponent(activeRunId)}`, { headers: { 'Accept': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
        const data = await r.json();
        const runItem = (data.items || []).find((x:any)=> String(x.type).toLowerCase()==='run' && String(x.id)===String(activeRunId));
        if (runItem) {
          const status = String(runItem.status || '');
          console.log('[STATUS DEBUG] Found run item, status:', status, 'runItem:', runItem);
          setActiveRunStatus(status);
          setActiveRunLog(runItem.log_path || null);
          // Restore task name from backend data if available
          if (runItem.task_name && !activeTaskName) {
            setActiveTaskName(String(runItem.task_name));
          }
          // set start time once
          const startedAt = new Date(runItem.created_at || runItem.started_at || runItem.updated_at || Date.now()).getTime();
          if (!runStartRef.current || runStartRef.current !== startedAt) {
            console.log('[STATUS DEBUG] Setting runStartRef.current from status polling:', startedAt);
            runStartRef.current = startedAt;
            setRunStartMs(startedAt);
          }
          setRunElapsedSec(Math.max(0, Math.floor((Date.now() - (runStartRef.current || startedAt)) / 1000)));
          const st = String(runItem.status || '').toUpperCase();
          if (st === 'COMPLETED' || st === 'FAILED') {
            console.log('[STATUS DEBUG] Run completed/failed, stopping polling');
            return; // stop polling
          }
        } else {
          console.log('[STATUS DEBUG] No run item found for activeRunId:', activeRunId);
        }
      } catch {}
      if (!stop) setTimeout(tick, 20000);
    };
    tick();
    return () => { stop = true; };
  }, [activeRunId, step]);

  // live timer while INPROGRESS
  useEffect(() => {
    console.log('[TIMER DEBUG] activeRunId:', activeRunId, 'activeRunStatus:', activeRunStatus, 'runStartRef.current:', runStartRef.current);
    if (!activeRunId) {
      console.log('[TIMER DEBUG] No activeRunId, returning');
      return;
    }
    const st = String(activeRunStatus || '').toUpperCase();
    console.log('[TIMER DEBUG] Status string:', st, 'startsWith IN:', st.startsWith('IN'));
    if (!st.startsWith('IN')) {
      console.log('[TIMER DEBUG] Status does not start with IN, returning');
      return;
    }
    if (!runStartRef.current) {
      console.log('[TIMER DEBUG] No runStartRef.current, returning');
      return;
    }
    console.log('[TIMER DEBUG] Starting timer interval');
    const id = setInterval(() => {
      if (!runStartRef.current) return;
      const elapsed = Math.max(0, Math.floor((Date.now() - runStartRef.current) / 1000));
      console.log('[TIMER DEBUG] Updating elapsed time:', elapsed);
      setRunElapsedSec(elapsed);
    }, 1000);
    return () => {
      console.log('[TIMER DEBUG] Clearing timer interval');
      clearInterval(id);
    };
  }, [activeRunId, activeRunStatus, runStartMs]);

  function renderChoose() {
    if (!initReady) {
      return (
        <div className="tile">
          <h3>Select Project</h3>
          <p className="muted" style={{ marginTop: 8 }}>Loading…</p>
        </div>
      );
    }
    return (
      <div className="tile">
        <form onSubmit={startPreprocess} className={showErrorsChoose ? 'show-errors' : undefined}>
          <h3>Select Project</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <SegmentedToggle
              value={useExisting ? 'existing' : 'new'}
              options={[
                { key: 'new', label: 'New Project', icon: <IconPlus width={16} height={16} /> },
                { key: 'existing', label: 'Existing Project', icon: <IconLayers width={16} height={16} /> },
              ]}
              onChange={(k) => setUseExisting(k === 'existing')}
            />
          </div>
          {useExisting ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <label>Project</label>
              <FancySelect
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                placeholder="Select a project"
                // Only show COMPLETED projects in dropdown
                options={projects.map(p => ({ value: p.id, label: p.name || p.id }))}
                searchable={true}
              />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <label>Project Name</label>
              <input value={projectName} onChange={(e)=>setProjectName(e.target.value)} placeholder="My Project" required />

              {testType === 'figma' ? (
                <>
                  <label>Figma File URL</label>
                  <input value={figmaUrl} onChange={(e)=>setFigmaUrl(e.target.value)} required placeholder="Paste a Figma prototype or design link, e.g., https://figma.com/proto/... or /design/..." />
                </>
              ) : (
                <>
                  <label>App URL</label>
                  <input value={appUrl} onChange={(e)=>setAppUrl(e.target.value)} required placeholder="https://example.com" type="url" />

                  <label>Email (optional)</label>
                  <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="user@example.com" type="email" />

                  <label>Password (optional)</label>
                  <input value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Enter password if login required" type="password" />
                </>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              className="btn-primary"
              disabled={loading || (useExisting && (!selectedProjectId || projects.length === 0))}
              type="submit"
            >
              {loading ? 'Working...' : (useExisting ? 'Continue' : 'Create project')}
            </button>
          </div>
        </form>

        {!useExisting && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>Recent Project</h3>
          {loadingRecent ? (
            <p className="muted" style={{ marginTop: 8 }}>Loading…</p>
          ) : recent ? (
            <div style={{ display: 'grid', gridTemplateColumns: recent.figma_page ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12, marginTop: 10 }}>
              <div>
                <div className="muted">Name</div>
                <div style={{ fontWeight: 700 }}>{recent.project_name || recent.name}</div>
              </div>
              {recent.figma_page && (
                <div>
                  <div className="muted">Page</div>
                  <div>{recent.figma_page}</div>
                </div>
              )}
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
        )}
      </div>
    );
  }

  function renderPreprocess() {
    const runId = preprocessInfo?.run_id;
    const p = (status?.items || []).find((x:any)=> String(x.type).toLowerCase()==='project' && String(x.run_dir||'').includes(runId));
    const st = String(p?.status || 'INPROGRESS');
    return (
      <div className="tile">
        <h3>Preprocess</h3>
        <div>Status: <b>{st}</b></div>
        <div style={{ marginTop: 8 }}>This can take 15–20 minutes. You can navigate away; it will continue.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <a className="btn-ghost" href={preprocessInfo?.log} target="_blank" rel="noreferrer">View Logs</a>
        </div>
      </div>
    );
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

  function addNewTask() {
    const newTask: TaskItem = {
      id: crypto.randomUUID(),
      taskName: '',
      task: '',
      sourceFile: null,
      targetFile: null,
      sourcePreview: null,
      targetPreview: null
    };
    setTasks([...tasks, newTask]);
    setExpandedTaskId(newTask.id);
  }

  function removeTask(id: string) {
    if (tasks.length === 1) return; // Keep at least one task
    setTasks(tasks.filter(t => t.id !== id));
    if (expandedTaskId === id) {
      setExpandedTaskId(tasks.find(t => t.id !== id)?.id || '');
    }
  }

  function updateTask(id: string, updates: Partial<TaskItem>) {
    setTasks(tasks.map(t => {
      if (t.id === id) {
        const updated = { ...t, ...updates };
        // Update preview URLs if files changed
        if (updates.sourceFile !== undefined) {
          updated.sourcePreview = updates.sourceFile ? URL.createObjectURL(updates.sourceFile) : null;
        }
        if (updates.targetFile !== undefined) {
          updated.targetPreview = updates.targetFile ? URL.createObjectURL(updates.targetFile) : null;
        }
        return updated;
      }
      return t;
    }));
  }

  function renderTests() {
    // Web App Test Setup
    if (testType === 'webapp') {
      return (
        <div className="tile">
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!goal) { setShowErrorsTests(true); return; }
            // Navigate to persona selection instead of starting test immediately
            setStep('personas');
          }} className={showErrorsTests ? 'show-errors' : undefined}>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 20, fontWeight: 700 }}>Test Setup</h3>
              <p style={{ margin: 0, color: '#64748B', fontSize: 14 }}>
                Configure your web app test with a goal and success validation criteria
              </p>
            </div>

            {/* Task Name */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#0F172A' }}>
                Task Name
              </label>
              <input
                value={taskName}
                onChange={(e)=>setTaskName(e.target.value)}
                placeholder="e.g., pricing-navigation"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3B82F6'}
                onBlur={(e) => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            {/* Task Description */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#0F172A' }}>
                Task Description <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <textarea
                value={goal}
                onChange={(e)=>setGoal(e.target.value)}
                required
                placeholder="Describe what the AI should accomplish (e.g., Navigate to the pricing page and find the enterprise plan)"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  resize: 'vertical',
                  lineHeight: 1.5,
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#3B82F6'}
                onBlur={(e) => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            {/* Acceptance Criteria */}
            <div style={{
              marginTop: 24,
              padding: 20,
              background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
              border: '2px solid #E2E8F0',
              borderRadius: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
                  Acceptance Criteria
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#10B981',
                  background: '#D1FAE5',
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid #A7F3D0',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Optional
                </span>
              </div>

              {/* Smart Completion Info Banner */}
              <div style={{
                marginBottom: 16,
                padding: 12,
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 8,
                display: 'flex',
                gap: 10,
                alignItems: 'start'
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: '#1E40AF' }}>
                  <strong>Recommended:</strong> Leave these fields empty to use <strong>Smart Completion</strong>.
                  The AI will automatically detect when your goal is achieved based on URL and page content.
                  Only fill these fields if you need explicit validation for complex scenarios.
                </div>
              </div>

              {/* Expected URL Path */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#334155' }}>
                  Expected URL Path
                </label>
                <input
                  value={expectedUrl}
                  onChange={(e)=>setExpectedUrl(e.target.value)}
                  placeholder="💡 URL should contain this text e.g., /reports"
                  style={{
                    width: '100%',
                    background: '#FFFFFF',
                    padding: '9px 12px',
                    fontSize: 13,
                    border: '1px solid #CBD5E1',
                    borderRadius: 6,
                    transition: 'all 0.15s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#3B82F6';
                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#CBD5E1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Must Contain */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#334155' }}>
                  Must Contain <span style={{ color: '#64748B', fontWeight: 400 }}>(comma-separated)</span>
                </label>
                <input
                  value={requiredElements}
                  onChange={(e)=>setRequiredElements(e.target.value)}
                  placeholder="✓ Text elements that must appear e.g., Reports, Overview"
                  style={{
                    width: '100%',
                    background: '#FFFFFF',
                    padding: '9px 12px',
                    fontSize: 13,
                    border: '1px solid #CBD5E1',
                    borderRadius: 6,
                    transition: 'all 0.15s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#3B82F6';
                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#CBD5E1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Must NOT Contain */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#334155' }}>
                  Must NOT Contain <span style={{ color: '#64748B', fontWeight: 400 }}>(comma-separated)</span>
                </label>
                <input
                  value={excludedElements}
                  onChange={(e)=>setExcludedElements(e.target.value)}
                  placeholder="✗ Text that should NOT be on page e.g., Error, Failed to load"
                  style={{
                    width: '100%',
                    background: '#FFFFFF',
                    padding: '9px 12px',
                    fontSize: 13,
                    border: '1px solid #CBD5E1',
                    borderRadius: 6,
                    transition: 'all 0.15s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#3B82F6';
                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#CBD5E1';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn-ghost" onClick={() => setStep('choose')} disabled={loading}>
                Back
              </button>
              <button className="btn-primary" disabled={loading} type="submit">
                Continue to Personas
              </button>
            </div>
          </form>
        </div>
      );
    }

    // Figma Test Setup (existing code)
    const validateTasks = () => {
      return tasks.every(t => t.taskName.trim() && t.task.trim() && t.sourceFile && t.targetFile);
    };

    return (
      <div className="tile">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Test Tasks</h3>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={addNewTask}
            style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.6, cursor: 'not-allowed' }}
            disabled
            aria-disabled="true"
            title="Task creation is disabled in this build"
          >
            <IconPlus width={16} height={16} /> Add Task
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {tasks.map((taskItem, index) => {
            const isExpanded = expandedTaskId === taskItem.id;
            const isComplete = taskItem.taskName.trim() && taskItem.task.trim() && taskItem.sourceFile && taskItem.targetFile;

            return (
              <div
                key={taskItem.id}
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,1), rgba(249,250,251,1))',
                  border: isExpanded ? '2px solid #3B82F6' : '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 16,
                  transition: 'all 0.2s ease'
                }}
              >
                {/* Task Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                  onClick={() => setExpandedTaskId(isExpanded ? '' : taskItem.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: isComplete ? '#10B981' : '#CBD5E1',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 14
                    }}>
                      {index + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {taskItem.taskName.trim() || `Task ${index + 1}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isComplete && (
                      <span style={{
                        fontSize: 12,
                        color: '#10B981',
                        fontWeight: 600,
                        background: '#D1FAE5',
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid #A7F3D0'
                      }}>
                        ✓ Complete
                      </span>
                    )}
                    {tasks.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeTask(taskItem.id); }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '6px 10px',
                          color: '#EF4444',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    )}
                    <span style={{ color: 'var(--muted)', fontSize: 20 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    {/* Task Name */}
                    <label style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>Task Name</span>
                      <input
                        type="text"
                        value={taskItem.taskName}
                        onChange={e => updateTask(taskItem.id, { taskName: e.target.value })}
                        placeholder="e.g., Complete checkout process"
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: 12,
                          fontSize: 14
                        }}
                      />
                    </label>

                    {/* Task Description */}
                    <label style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>Task Description</span>
                      <textarea
                        rows={3}
                        value={taskItem.task}
                        onChange={e => updateTask(taskItem.id, { task: e.target.value })}
                        placeholder="Describe what the user should accomplish..."
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: 12,
                          fontSize: 14
                        }}
                      />
                    </label>

                    {/* Start & Stop Screens */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* Start Screen */}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: 'var(--text)' }}>
                          Start Screen
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            document.getElementById(`source-${taskItem.id}`)?.click();
                          }}
                          style={{
                            height: 160,
                            border: '2px dashed var(--border)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            background: taskItem.sourcePreview ? `url(${taskItem.sourcePreview}) center/cover` : '#F8FAFC',
                            position: 'relative',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3B82F6'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                        >
                        <input
                          type="file"
                          id={`source-${taskItem.id}`}
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              updateTask(taskItem.id, { sourceFile: file });
                              e.target.value = '';
                            }
                          }}
                        />
                          {!taskItem.sourceFile && (
                            <div style={{ textAlign: 'center', color: 'var(--muted)', pointerEvents: 'none' }}>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>Click to upload</div>
                              <div style={{ fontSize: 12, marginTop: 4 }}>or drag & drop</div>
                            </div>
                          )}
                          {taskItem.sourceFile && (
                            <div style={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              right: 8,
                              background: 'rgba(0,0,0,0.8)',
                              borderRadius: 8,
                              padding: 8,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                            onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 600 }}>
                                {taskItem.sourceFile.name}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateTask(taskItem.id, { sourceFile: null, sourcePreview: null });
                                }}
                                style={{
                                  background: '#EF4444',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: 6,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Stop Screen */}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: 'var(--text)' }}>
                          Stop Screen (Task Complete)
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            document.getElementById(`target-${taskItem.id}`)?.click();
                          }}
                          style={{
                            height: 160,
                            border: '2px dashed var(--border)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            background: taskItem.targetPreview ? `url(${taskItem.targetPreview}) center/cover` : '#F8FAFC',
                            position: 'relative',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3B82F6'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                        >
                        <input
                          type="file"
                          id={`target-${taskItem.id}`}
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              updateTask(taskItem.id, { targetFile: file });
                              e.target.value = '';
                            }
                          }}
                        />
                          {!taskItem.targetFile && (
                            <div style={{ textAlign: 'center', color: 'var(--muted)', pointerEvents: 'none' }}>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>Click to upload</div>
                              <div style={{ fontSize: 12, marginTop: 4 }}>or drag & drop</div>
                            </div>
                          )}
                          {taskItem.targetFile && (
                            <div style={{
                              position: 'absolute',
                              bottom: 8,
                              left: 8,
                              right: 8,
                              background: 'rgba(0,0,0,0.8)',
                              borderRadius: 8,
                              padding: 8,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                            onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 600 }}>
                                {taskItem.targetFile.name}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateTask(taskItem.id, { targetFile: null, targetPreview: null });
                                }}
                                style={{
                                  background: '#EF4444',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: 6,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn-ghost" onClick={() => setStep('choose')} disabled={loading}>
            Back
          </button>
          <button
            className="btn-primary"
            disabled={loading || !validateTasks()}
            onClick={(e) => { e.preventDefault(); if (validateTasks()) setStep('personas'); }}
          >
            {loading ? 'Processing...' : 'Continue to Personas'}
          </button>
        </div>
      </div>
    );
  }

  function renderDone() {
    return (
      <div className="tile">
        {/* Header: run id only */}
        {activeTaskName ? (
          <div className="muted" style={{ marginBottom: 6 }}>
            <span>Task: </span>
            <span style={{ opacity: .9, fontWeight: 700 }}>{activeTaskName}</span>
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 6 }}>
            <span>Run Id: </span>
            <span style={{ opacity: .9 }}>{activeRunId || '-'}</span>
          </div>
        )}
        {/* Status + inline timer (timer aligned to right) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
          <div>
          {(() => {
            const k = String(activeRunStatus || '').toUpperCase();
            const color = (k === 'COMPLETED')
              ? '#10b981'
              : (k === 'FAILED')
                ? '#ef4444'
                : ((k === 'INPROGRESS' || k === 'IN_PROGRESS' || k === 'IN-PROGRESS') ? '#f59e0b' : 'var(--muted)');
              const label = k || 'STARTED';
              return (
                <>
                  <span>Status: </span>
                  <span style={{ color, fontWeight: 700 }}>{label}</span>
                </>
              );
            })()}
          </div>
          {String(activeRunStatus || '').toUpperCase().startsWith('IN') ? (
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#cbd5e1' }}>{formatElapsed(runElapsedSec)}</span>
          ) : <span />}
        </div>
        {String(activeRunStatus || '').toUpperCase() === 'INPROGRESS' && (
          <div className="progress indeterminate ice" style={{ marginTop: 12 }}>
            <span style={{ width: '100%' }} />
          </div>
        )}
        {String(activeRunStatus || '').toUpperCase() === 'COMPLETED' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Link className="btn-ghost" href="/reports">View Result</Link>
        </div>
        )}
      </div>
    );
  }

  function renderPersonas() {
    return (
      <PersonaPicker onLaunch={(configs, exclusive) => launchRun(configs as any, exclusive)} onBack={() => setStep('tests')} />
    );
  }

  function renderEmptyState() {
    return (
      <main className="flex-1 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Welcome to AI Usability</h1>
          <p className="text-slate-600 mb-6">Run usability tests before you launch. Let's set up your first project.</p>
          <button
            className="flex items-center gap-2 px-6 py-3 rounded-lg mx-auto transition-colors"
            style={{ width: 'fit-content', fontSize: '15px', fontWeight: '600', backgroundColor: '#000000', color: '#FFFFFF', border: 'none' }}
            onClick={() => {
              setUseExisting(false);
              setStep('choose');
            }}
          >
            <IconPlus width={20} height={20} /> Create Project
          </button>
          <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px dashed #CBD5E1', textAlign: 'left' }}>
            <h2 style={{ fontSize: '13px', fontWeight: '600', color: '#64748B', marginBottom: '12px' }}>How it works</h2>
            <ol style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#64748B' }}>
              <li>1️⃣ Connect your Figma design</li>
              <li>2️⃣ Define tasks and personas</li>
              <li>3️⃣ Run tests and view results</li>
            </ol>
          </div>
        </div>
      </main>
    );
  }

  // Never show empty state - the create-run page already handles that.
  // Users coming to /configure-test should always see the form.
  const showEmptyState = false;

  return (
    <div>
      {showEmptyState ? (
        renderEmptyState()
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="dash-header" style={{ marginBottom: 0 }}>Launch Test</div>
            <div style={{
              display: 'inline-flex',
              background: '#F8FAFC',
              borderRadius: 10,
              padding: 4,
              border: '1px solid #E2E8F0'
            }}>
              <button
                type="button"
                onClick={() => setTestType('figma')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: 8,
                  background: testType === 'figma' ? '#FFFFFF' : 'transparent',
                  cursor: 'pointer',
                  fontWeight: testType === 'figma' ? 600 : 500,
                  fontSize: 14,
                  color: testType === 'figma' ? '#0F172A' : '#64748B',
                  transition: 'all 0.2s ease',
                  boxShadow: testType === 'figma' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
                  <path d="M7 7h.01"/>
                </svg>
                Design File
              </button>
              <button
                type="button"
                onClick={() => setTestType('webapp')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: 8,
                  background: testType === 'webapp' ? '#FFFFFF' : 'transparent',
                  cursor: 'pointer',
                  fontWeight: testType === 'webapp' ? 600 : 500,
                  fontSize: 14,
                  color: testType === 'webapp' ? '#0F172A' : '#64748B',
                  transition: 'all 0.2s ease',
                  boxShadow: testType === 'webapp' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                Web App
              </button>
            </div>
          </div>
          {bootLoading ? (
            <div className="tile" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
              <div className="spinner" />
            </div>
          ) : (
            <>
              <div className="tile" style={{ marginBottom: 12, padding: 12, minHeight: 'unset' as any }}>
            <StepIndicator
              steps={[
                { label: 'Project' },
                    { label: 'Test Setup' },
                    { label: 'Personas' },
                { label: 'Results' },
              ]}
                  activeIndex={(step === 'choose' || step === 'preprocess') ? 0 : step === 'tests' ? 1 : step === 'personas' ? 2 : 3}
                  onStepClick={(idx) => {
                    // Only allow navigating to current/past steps
                    const currentIdx = (step === 'choose' || step === 'preprocess') ? 0 : step === 'tests' ? 1 : step === 'personas' ? 2 : 3;
                    if (idx > currentIdx) return;
                    if (idx === 0) setStep('choose');
                    else if (idx === 1) setStep('tests');
                    else if (idx === 2) setStep('personas');
                    else setStep('done');
                  }}
            />
          </div>
          {step === 'choose' && renderChoose()}
          {step === 'preprocess' && renderPreprocess()}
          {step === 'tests' && renderTests()}
              {step === 'personas' && renderPersonas()}
          {step === 'done' && renderDone()}
            </>
          )}
        </>
      )}
    </div>
  );
}


