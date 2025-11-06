"use client";
import React, { useEffect, useState } from 'react';
import FancySelect from '../../components/FancySelect';

type Project = { id: string; name: string; run_dir?: string; kind?: string; created_at?: string; updated_at?: string };
type Goal = { id: string; task_name?: string; task_id?: string | number; goal?: string; status?: string; finished_at?: string; created_at?: string; updated_at?: string; project_id?: string };
type TestResult = {
  id: string;
  category: string;
  path: string[];
};

const CATEGORIES = [
  { name: 'Application & JS Runtime Errors', count: 3, total: 8 },
  { name: 'Navigation & State Management', count: 2, total: 6 },
  { name: 'API & Network', count: 1, total: 5 },
  { name: 'Data Integrity', count: 0, total: 4 },
  { name: 'Form & Input Validation', count: 4, total: 9 },
  { name: 'User Friction & Interaction', count: 1, total: 7 },
  { name: 'Visual, Layout & Device', count: 2, total: 5 },
  { name: 'Performance', count: 2, total: 6 },
  { name: 'Accessibility', count: 0, total: 7 },
  { name: 'Environment & Configuration', count: 1, total: 4 }
];

// Dummy test results data
const DUMMY_RESULTS: TestResult[] = [
  { id: '1', category: 'Form & Input Validation', path: ['Report', 'Pop-Up', 'Persona Explorer', 'Download Persona'] },
  { id: '2', category: 'Form & Input Validation', path: ['Report', 'Pop-Up', 'Overview', 'Download Overview'] },
  { id: '3', category: 'Form & Input Validation', path: ['Report', 'Form'] },
  { id: '4', category: 'Performance', path: ['Report', 'Pop-Up', 'Download TV'] },
  { id: '5', category: 'Performance', path: ['Report', 'Persona Explorer', 'Charts', 'Export'] },
  { id: '6', category: 'Application & JS Runtime Errors', path: ['Login', 'Authentication', 'Error Handler'] },
  { id: '7', category: 'Navigation & State Management', path: ['Dashboard', 'Navigation', 'Menu'] },
  { id: '8', category: 'API & Network', path: ['Data Fetch', 'API Call', 'Response'] },
  { id: '9', category: 'User Friction & Interaction', path: ['Button', 'Click', 'Action'] },
  { id: '10', category: 'Visual, Layout & Device', path: ['Layout', 'Responsive', 'Mobile'] },
  { id: '11', category: 'Visual, Layout & Device', path: ['Grid', 'Display', 'Rendering'] },
  { id: '12', category: 'Environment & Configuration', path: ['Config', 'Environment', 'Settings'] },
];

export default function ResultOverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bootLoading, setBootLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>(DUMMY_RESULTS);
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [realCategories, setRealCategories] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState("");

  // Track if we've done initial auto-selection
  const hasAutoSelectedProject = React.useRef(false);
  const hasAutoSelectedGoal = React.useRef(false);

  // Store owner_id from API to determine data mode
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // Feature flag: Determine data mode based on owner_id
  // Case 1: owner_id === '63cac160-146a-48a5-b142-3cfecc5c676a' → use real API data
  // Case 2: owner_id === 'a546b498-445d-4c50-a5b4-8e02a346c2a3' → use hardcoded demo data
  // Case 3: otherwise → follow NEXT_PUBLIC_USE_REAL_DATA flag
  const determineDataMode = (owner_id: string | null): boolean => {
    if (owner_id === '63cac160-146a-48a5-b142-3cfecc5c676a') {
      console.log('[Result Overview] Owner ID matched real data case - using real API data');
      return true;
    } else if (owner_id === 'a546b498-445d-4c50-a5b4-8e02a346c2a3') {
      console.log('[Result Overview] Owner ID matched demo data case - using hardcoded dummy data');
      return false;
    } else {
      const flagValue = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true') : true;
      console.log(`[Result Overview] Owner ID ${owner_id} - following flag value:`, flagValue);
      return flagValue;
    }
  };
  const useRealData = determineDataMode(ownerId);

  async function loadProjects() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Use status API like Reports page to get runs
      const res = await fetch('/api/status?attach_signed_urls=0', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load status');
      const data = await res.json();

      // Extract and store owner_id from response
      if (data.owner_id) {
        setOwnerId(data.owner_id);
        console.log('[Result Overview] Extracted owner_id from status API:', data.owner_id);
      }

      // Filter to only webapp_tests runs
      const allRuns = (data.items || []).filter((x: any) => String(x.type).toLowerCase() === 'run');
      const webappRuns = allRuns.filter((x: any) => String(x.kind || '').toLowerCase() === 'webapp_tests');

      // Extract unique projects from runs
      const projectMap = new Map<string, Project>();
      webappRuns.forEach((run: any) => {
        if (run.project_id && !projectMap.has(run.project_id)) {
          projectMap.set(run.project_id, {
            id: run.project_id,
            name: run.project_name || run.name || 'Unnamed Project',
            kind: run.kind,
            created_at: run.created_at,
            updated_at: run.updated_at || run.finished_at
          });
        }
      });

      const functionalProjects = Array.from(projectMap.values());
      setProjects(functionalProjects);

      // Store all runs for later filtering
      setGoals(webappRuns.map((r: any) => ({
        id: r.id,
        task_name: r.task_name,
        task_id: r.task_id,
        goal: r.goal,
        status: r.status,
        finished_at: r.finished_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        project_id: r.project_id
      })));

      // Auto-select the most recently created project (only once on initial load)
      if (functionalProjects.length > 0 && !hasAutoSelectedProject.current) {
        // Sort by updated_at descending (most recent first)
        const sorted = [...functionalProjects].sort((a, b) => {
          const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
          const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
          return dateB - dateA;
        });
        const mostRecent = sorted[0];
        console.log('[Results Overview] Auto-selecting most recent project:', mostRecent.name);
        setSelectedProject(mostRecent.id);
        hasAutoSelectedProject.current = true;
      }
    } catch (err) {
      console.error('Error loading projects:', err);
      setError('Failed to load projects');
    } finally {
      setBootLoading(false);
    }
  }

  async function loadGoals(projectId: string) {
    if (!projectId) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Filter goals (runs) that were loaded in loadProjects() for this project
      const projectRuns = goals.filter((g: any) => g.project_id === projectId);

      // Auto-select the most recently completed run (only once on initial load)
      if (!hasAutoSelectedGoal.current && projectRuns.length > 0) {
        // Filter to only completed runs
        const completedRuns = projectRuns.filter((g: Goal) =>
          String(g.status || '').toUpperCase() === 'COMPLETED'
        );

        if (completedRuns.length > 0) {
          // Sort by finished_at or updated_at descending (most recent first)
          const sorted = [...completedRuns].sort((a, b) => {
            const dateA = new Date(a.finished_at || a.updated_at || a.created_at || 0).getTime();
            const dateB = new Date(b.finished_at || b.updated_at || b.created_at || 0).getTime();
            return dateB - dateA;
          });
          const mostRecentCompleted = sorted[0];
          console.log('[Results Overview] Auto-selecting most recent completed run:', mostRecentCompleted.task_name || mostRecentCompleted.goal);
          setSelectedGoal(mostRecentCompleted.id);
          hasAutoSelectedGoal.current = true;
        }
      }
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  async function loadResultsData(runId: string) {
    if (!runId) {
      setTestResults(DUMMY_RESULTS);
      setRealCategories([]);
      return;
    }

    // If feature flag is disabled, use demo data
    if (!useRealData) {
      console.log('[Results Overview] Using demo data (NEXT_PUBLIC_USE_REAL_DATA=false)');
      setTestResults(DUMMY_RESULTS);
      setRealCategories([]);
      return;
    }

    try {
      setLoadingResults(true);
      setResultsError("");
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Fetch metrics from the public API
      const res = await fetch(`/api/metrics_public?run_id=${encodeURIComponent(runId)}`, { headers, cache: 'no-store' });
      if (!res.ok) {
        console.warn('Failed to load results data, using demo');
        setTestResults(DUMMY_RESULTS);
        setRealCategories([]);
        return;
      }

      const data = await res.json();

      // Map API data to our format
      // For now, use demo data but you can extend this to parse real API data
      // The metrics_public endpoint returns issues, recommendations, etc.
      if (data.derived_ux_issues && data.derived_ux_issues.length > 0) {
        const mappedCategories = data.derived_ux_issues.map((issue: any) => ({
          name: issue.label || issue.heuristic,
          count: issue.count || 0,
          total: issue.count || 0
        }));
        setRealCategories(mappedCategories);
      } else {
        setRealCategories([]);
      }

      // For now, keep using dummy results as the structure for actual test results
      // needs to be defined based on your backend data
      setTestResults(DUMMY_RESULTS);

    } catch (err: any) {
      console.error('Error loading results data:', err);
      setResultsError(err.message || 'Failed to load results');
      setTestResults(DUMMY_RESULTS);
      setRealCategories([]);
    } finally {
      setLoadingResults(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadGoals(selectedProject);
    } else {
      setSelectedGoal('');
    }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedGoal) {
      loadResultsData(selectedGoal);
    } else {
      setTestResults(DUMMY_RESULTS);
      setRealCategories([]);
    }
  }, [selectedGoal]);

  // Use real categories if available, otherwise use hardcoded demo
  const displayCategories = (useRealData && realCategories.length > 0) ? realCategories : CATEGORIES;

  // Filter results based on selected category
  const filteredResults = selectedCategory
    ? testResults.filter(result => result.category === selectedCategory)
    : testResults;

  if (bootLoading) return <div>Loading...</div>;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Result Overview</h2>
      </div>

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
              }}
              placeholder={selectedProject ? "Select a task" : "Select project first"}
              options={goals.filter((g: Goal) => g.project_id === selectedProject).map(g => ({
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
        {(loading || error || loadingResults || resultsError) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {loading && <span className="muted">Loading tasks…</span>}
            {error && <span className="muted" style={{ color: '#fca5a5' }}>{error}</span>}
            {loadingResults && <span className="muted">Loading results…</span>}
            {resultsError && <span className="muted" style={{ color: '#fca5a5' }}>{resultsError}</span>}
          </div>
        )}
        {!loadingResults && !resultsError && realCategories.length > 0 && useRealData && (
          <div style={{ fontSize: 14, color: '#10b981', marginTop: 8 }}>
            ✓ Loaded {realCategories.length} issue categories from run
          </div>
        )}
        {!useRealData && (
          <div style={{ fontSize: 14, color: '#f59e0b', marginTop: 8 }}>
            ⚠ Using demo data (set NEXT_PUBLIC_USE_REAL_DATA=true to use real data)
          </div>
        )}
      </div>

      {/* Search Filter */}
      <div style={{ marginTop: 16 }}>
        <input
          id="search"
          placeholder="Search categories, paths"
          style={{
            width: '100%',
            borderRadius: 12,
            border: '1px solid #E2E8F0',
            background: '#FFFFFF',
            padding: '8px 12px',
            fontSize: 14,
            outline: 'none'
          }}
          onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.5)'}
          onBlur={(e) => e.target.style.boxShadow = 'none'}
        />
      </div>

      {/* Main Content */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 16 }}>
        {/* Sidebar Categories */}
        <aside>
          <div style={{ borderRadius: 16, border: '1px solid #E2E8F0', background: '#FFFFFF', padding: 12 }}>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#6B7280' }}>CATEGORIES</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* All Categories button */}
              <button
                onClick={() => setSelectedCategory(null)}
                className={selectedCategory === null ? 'active' : ''}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderRadius: 12,
                  transition: 'all 0.2s',
                  background: selectedCategory === null ? '#FFFFFF' : 'transparent',
                  border: selectedCategory === null ? '1px solid #E2E8F0' : '1px solid transparent',
                  color: '#1F2937',
                  cursor: 'pointer',
                  fontWeight: 500,
                  boxShadow: selectedCategory === null ? '0 1px 2px rgba(15,23,42,0.06)' : 'none'
                }}
                onMouseEnter={(e) => { if (selectedCategory !== null) e.currentTarget.style.background = '#F9FAFB'; }}
                onMouseLeave={(e) => { if (selectedCategory !== null) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>All Categories</span>
                <span style={{ fontSize: 14, color: '#6B7280' }}>{testResults.length}</span>
              </button>

              {/* Category items */}
              {displayCategories.map((category) => (
                <button
                  key={category.name}
                  onClick={() => setSelectedCategory(category.name)}
                  className={selectedCategory === category.name ? 'active' : ''}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 12,
                    transition: 'all 0.2s',
                    background: selectedCategory === category.name ? '#FFFFFF' : 'transparent',
                    border: selectedCategory === category.name ? '1px solid #E2E8F0' : '1px solid transparent',
                    color: '#1F2937',
                    cursor: 'pointer',
                    fontWeight: 500,
                    boxShadow: selectedCategory === category.name ? '0 1px 2px rgba(15,23,42,0.06)' : 'none'
                  }}
                  onMouseEnter={(e) => { if (selectedCategory !== category.name) e.currentTarget.style.background = '#F9FAFB'; }}
                  onMouseLeave={(e) => { if (selectedCategory !== category.name) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span>{category.name}</span>
                  <span style={{ fontSize: 14, color: '#6B7280' }}>
                    {category.count}/{category.total}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Table */}
        <section>
          <div style={{ overflow: 'hidden', borderRadius: 16, border: '1px solid #E2E8F0', background: '#FFFFFF' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F9FAFB', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6B7280' }}>
                  <th style={{ padding: '12px 16px' }}>Category</th>
                  <th style={{ padding: '12px 16px' }}>Path</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 14, color: '#6B7280' }}>
                      No results found.
                    </td>
                  </tr>
                ) : (
                  filteredResults.map((result, index) => (
                    <tr key={result.id} style={{ background: index % 2 === 0 ? '#FFFFFF' : 'rgba(249, 250, 251, 0.5)' }}>
                      <td style={{ padding: '12px 16px', verticalAlign: 'top', fontSize: 14, color: '#1F2937' }}>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setSelectedResult(result);
                            setShowSidebar(true);
                          }}
                          style={{
                            color: '#3b82f6',
                            textDecoration: 'underline',
                            cursor: 'pointer'
                          }}
                        >
                          {result.category}
                        </a>
                      </td>
                      <td style={{ padding: '12px 16px', verticalAlign: 'top', fontSize: 14, color: '#374151' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                          {result.path.map((step, stepIndex) => (
                            <React.Fragment key={stepIndex}>
                              <span style={{ borderRadius: 999, background: '#F3F4F6', padding: '2px 8px', fontSize: 12, color: '#374151' }}>
                                {step}
                              </span>
                              {stepIndex < result.path.length - 1 && (
                                <span style={{ color: '#9CA3AF', fontSize: 14 }}>›</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Category Details Sidebar Modal */}
      {showSidebar && selectedResult && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowSidebar(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              zIndex: 999
            }}
          />

          {/* Sidebar */}
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: 480,
            height: '100vh',
            background: '#fff',
            boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            overflow: 'auto',
            padding: 24
          }}>
            {/* Close Button */}
            <button
              onClick={() => setShowSidebar(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                border: 'none',
                background: 'transparent',
                fontSize: 24,
                cursor: 'pointer',
                color: '#64748b',
                padding: 4
              }}
            >
              ×
            </button>

            {/* Title */}
            <h2 style={{ margin: '0 0 24px 0', fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
              Issue Details
            </h2>

            {/* Name (Category) */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Name</h3>
              <div style={{
                padding: 12,
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 14,
                color: '#0f172a',
                fontWeight: 600
              }}>
                {selectedResult.category}
              </div>
            </div>

            {/* Path */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Path</h3>
              <div style={{
                padding: 12,
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                fontFamily: 'monospace',
                color: '#475569'
              }}>
                {selectedResult.path.join(' → ')}
              </div>
            </div>

            {/* Evidence */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Evidence (What Actually Happened)</h3>
              <div style={{
                padding: 12,
                background: '#fef2f2',
                borderRadius: 8,
                border: '1px solid #fecaca',
                fontSize: 13,
                color: '#0f172a',
                lineHeight: 1.6
              }}>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>Issue detected in "{selectedResult.category}" category</li>
                  <li>User followed path: {selectedResult.path.join(' → ')}</li>
                  <li>Critical issue affecting user experience at this step</li>
                  <li>Issue requires immediate attention and review</li>
                </ul>
              </div>
            </div>

            {/* Repro Steps */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Repro Steps</h3>
              <div style={{
                padding: 12,
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0'
              }}>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
                  {selectedResult.path.map((step, index) => (
                    <li key={index}>Navigate to "{step}"</li>
                  ))}
                  <li>Observe the issue in the "{selectedResult.category}" category</li>
                </ol>
              </div>
            </div>

            {/* Issue Badge */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              color: '#dc2626'
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              {selectedResult.category}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
