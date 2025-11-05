"use client";
import React, { useEffect, useState } from 'react';
import FancySelect from '../../components/FancySelect';

type Project = { id: string; name: string; run_dir?: string; kind?: string };
type Goal = { id: string; task_name?: string; task_id?: string | number; goal?: string };
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
  const [testResults] = useState<TestResult[]>(DUMMY_RESULTS);
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);

  async function loadProjects() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/projects', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();

      // Filter to only show functional test projects (kind='webapp' or kind='functional')
      const allProjects = data.projects || [];
      const functionalProjects = allProjects.filter((p: Project) => {
        const kind = String(p.kind || '').toLowerCase();
        return kind === 'webapp' || kind === 'functional';
      });

      setProjects(functionalProjects);
    } catch (err) {
      console.error('Error loading projects:', err);
      setError('Failed to load projects');
    } finally {
      setBootLoading(false);
    }
  }

  async function loadGoals(projectId: string) {
    if (!projectId) {
      setGoals([]);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/projects/${projectId}/goals`, { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json();
      setGoals(data.goals || []);
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadGoals(selectedProject);
    } else {
      setGoals([]);
      setSelectedGoal('');
    }
  }, [selectedProject]);

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
              {CATEGORIES.map((category) => (
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
