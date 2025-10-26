"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconPlus } from '../../components/icons';

type Project = { id: string; name: string; status: string; created_at?: string; updated_at?: string; test_type?: string };
type Persona = { id: string; name: string; bio?: string };
type Run = {
  id: string;
  project_id: string;
  goal?: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  name?: string;
  project_name?: string;
};

export default function LaunchTestPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Fetch projects
      const projectsRes = await fetch('/api/projects', { headers, cache: 'no-store' });
      if (projectsRes.ok) {
        const projectsData = await projectsRes.json();
        setProjects(Array.isArray(projectsData.projects) ? projectsData.projects : []);
      }

      // Fetch personas
      const personasRes = await fetch('/api/user_personas', { headers, cache: 'no-store' });
      if (personasRes.ok) {
        const personasData = await personasRes.json();
        setPersonas(Array.isArray(personasData.personas) ? personasData.personas : []);
      }

      // Fetch runs
      const runsRes = await fetch('/api/status?attach_signed_urls=0', { headers, cache: 'no-store' });
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const runItems = (runsData.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
        setRuns(runItems);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  // If no projects exist, show empty state
  if (!loading && projects.length === 0) {
    return (
      <main className="flex-1 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Welcome to AI Usability</h1>
          <p className="text-slate-600 mb-6">Run usability tests before you launch. Let's set up your first project.</p>
          <button
            onClick={() => router.push('/configure-test')}
            className="flex items-center gap-2 px-6 py-3 rounded-lg mx-auto transition-colors hover:bg-slate-800 cursor-pointer"
            style={{ width: 'fit-content', fontSize: '15px', fontWeight: '600', backgroundColor: '#000000', color: '#FFFFFF', border: 'none' }}
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

  // Calculate stats
  const totalProjects = projects.length;
  const readyProjects = projects.filter(p => String(p.status).toUpperCase() === 'COMPLETED' || String(p.status).toUpperCase() === 'READY').length;
  const processingProjects = projects.filter(p => String(p.status).toUpperCase() === 'PROCESSING' || String(p.status).toUpperCase() === 'RUNNING').length;

  // Runs in last 24 hours
  const last24h = Date.now() - (24 * 60 * 60 * 1000);
  const recentRuns = runs.filter(r => {
    const created = new Date(r.created_at || 0).getTime();
    return created > last24h;
  });
  const completedRuns = recentRuns.filter(r => String(r.status).toUpperCase() === 'COMPLETED').length;
  const queuedRuns = recentRuns.filter(r => {
    const s = String(r.status).toUpperCase();
    return s === 'QUEUED' || s === 'RUNNING' || s === 'INPROGRESS';
  }).length;
  const failedRuns = recentRuns.filter(r => String(r.status).toUpperCase() === 'FAILED').length;

  // Show last 3 projects by their most recent run (any status).
  // Derive project status from the latest run status.
  const recentRunsSorted = runs
    .slice()
    .sort((a, b) => {
      const at = new Date(a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    });

  const seenProjects = new Set<string>();
  const last4CompletedProjects = recentRunsSorted
    .filter(r => {
      if (!r.project_id) return false;
      const pid = String(r.project_id);
      if (seenProjects.has(pid)) return false;
      seenProjects.add(pid);
      return true;
    })
    .slice(0, 3)
    .map(r => {
      const p = projects.find(pp => String(pp.id) === String(r.project_id));
      return {
        id: String(r.project_id),
        name: p?.name || String(r.name || r.project_name || 'Project'),
        status: String(r.status || ''),
        updated_at: r.updated_at || r.created_at,
        created_at: r.created_at,
      } as Project;
    });

  // Decide which list to display:
  // - If user is searching, search across ALL projects by name
  // - Otherwise, show the last 3 completed projects derived above
  const filteredProjects = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      const all = projects
        .filter(p => p.name.toLowerCase().includes(q))
        .sort((a, b) => {
          const at = new Date(a.updated_at || a.created_at || 0).getTime();
          const bt = new Date(b.updated_at || b.created_at || 0).getTime();
          return bt - at;
        });
      return all;
    }
    return last4CompletedProjects;
  })();

  // Get recent runs (last 3)
  const recentRunsList = runs.slice(0, 3);

  function timeAgo(ts?: string): string {
    if (!ts) return '';
    try {
      const diff = Date.now() - new Date(ts).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch {
      return '';
    }
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="page-title">Home</h1>
            <p className="meta">Start new tests, manage personas, and resume projects.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/configure-persona"><button className="btn btn-secondary">Manage Personas</button></Link>
            <Link href="/configure-test"><button className="btn btn-primary">New Project</button></Link>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <section className="py-6">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
              <h3 className="section-title mb-2">Projects</h3>
              <div className="text-2xl font-semibold text-slate-900">{totalProjects} <span className="meta">total</span></div>
              <div className="mt-2 flex gap-2 text-sm flex-wrap">
                {readyProjects > 0 && <span className="chip chip-success">{readyProjects} ready</span>}
                {processingProjects > 0 && <span className="chip chip-pending">{processingProjects} processing</span>}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
              <h3 className="section-title mb-2">Personas</h3>
              <div className="text-2xl font-semibold text-slate-900">{personas.length} <span className="meta">total</span></div>
              <div className="mt-3 flex gap-2 flex-wrap">
                {personas.slice(0, 3).map(p => (
                  <span key={p.id} className="chip chip-neutral">{p.name}</span>
                ))}
                {personas.length > 3 && <span className="chip chip-neutral">+{personas.length - 3} more</span>}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-card">
              <h3 className="section-title mb-2">Runs (24h)</h3>
              <div className="flex gap-6 text-slate-800">
                <div><div className="text-2xl font-semibold">{completedRuns}</div><div className="meta">completed</div></div>
                <div><div className="text-2xl font-semibold">{queuedRuns}</div><div className="meta">running</div></div>
                <div><div className="text-2xl font-semibold">{failedRuns}</div><div className="meta">failed</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Projects List */}
      <section>
        <div className="max-w-7xl mx-auto px-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
          <h3 className="section-title">Projects</h3>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white">
              <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 21l-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/></svg>
              <input
                className="input border-0 h-auto p-0"
                placeholder="Search projects"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filteredProjects.length === 0 && (
          <div className="row">
            <div className="min-w-0 text-center w-full">
              <p className="meta">No projects found</p>
            </div>
          </div>
        )}

        {filteredProjects.map(project => {
          const status = String(project.status || '').toUpperCase();
          const isReady = status === 'COMPLETED' || status === 'READY';
          const isProcessing = status === 'PROCESSING' || status === 'RUNNING';
          const chipClass = isReady ? 'chip-success' : isProcessing ? 'chip-pending' : 'chip-neutral';
          const statusLabel = isReady ? 'Ready' : isProcessing ? 'Processing…' : status || 'Unknown';

          const testType = project.test_type || 'figma';
          const testTypeLabel = testType === 'webapp' ? 'Web App' : 'Figma';
          const testTypeIcon = testType === 'webapp' ? '🌐' : '🎨';

          return (
            <div key={project.id} className="row">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <a className="text-slate-900 font-medium truncate hover:underline">{project.name}</a>
                  <span className={`chip ${chipClass}`}>{statusLabel}</span>
                  <span className="chip chip-neutral" style={{ fontSize: '11px', padding: '2px 8px' }}>
                    {testTypeIcon} {testTypeLabel}
                  </span>
                </div>
                <div className="meta mt-0.5">Updated {timeAgo(project.updated_at || project.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/configure-test?project=${project.id}`}>
                  <button className="btn btn-secondary">Open</button>
                </Link>
                <Link href="/reports">
                  <button className="btn btn-ghost">Results</button>
                </Link>
              </div>
            </div>
          );
        })}
          </div>
        </div>
      </section>

      {/* Recent Runs */}
      <section className="py-6">
        <div className="max-w-7xl mx-auto px-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Recent runs</h3>
              <Link href="/status">
                <button className="btn btn-ghost">View all</button>
              </Link>
            </div>

            {recentRunsList.length === 0 && (
              <div className="row">
                <div className="min-w-0 text-center w-full">
                  <p className="meta">No runs yet</p>
                </div>
              </div>
            )}

            {recentRunsList.map(run => {
              const project = projects.find(p => p.id === run.project_id);
              const status = String(run.status || '').toUpperCase();
              const chipClass =
                status === 'COMPLETED' ? 'chip-success' :
                status === 'FAILED' ? 'chip-error' :
                status === 'RUNNING' || status === 'QUEUED' ? 'chip-pending' :
                'chip-neutral';
              const statusLabel = status === 'COMPLETED' ? 'Done' : status || 'Unknown';

              return (
                <div key={run.id} className="row">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-900 font-medium truncate">{project?.name || 'Unknown Project'}</span>
                      <span className={`chip ${chipClass}`}>{statusLabel}</span>
                    </div>
                    <div className="meta mt-0.5">{run.goal || 'No goal specified'} · {timeAgo(run.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href="/reports">
                      <button className="btn btn-secondary">View Report</button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
