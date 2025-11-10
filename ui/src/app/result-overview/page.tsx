"use client";
import React, { useState } from 'react';

type TestCase = {
  id: string;
  name: string;
  status: 'passed' | 'failed';
  tags: string[];
  issues?: Array<{
    type: string;
    title: string;
    description: string;
  }>;
};

// Dummy test data
const DUMMY_TEST_CASES: TestCase[] = [
  {
    id: '1',
    name: 'Toggle notification settings',
    status: 'failed',
    tags: ['network'],
    issues: [
      {
        type: 'Network',
        title: 'Request payload too large',
        description: 'POST request exceeds 1MB limit causing 413 error'
      }
    ]
  },
  { id: '2', name: 'Apply discount code', status: 'passed', tags: [] },
  { id: '3', name: 'Submit credentials', status: 'passed', tags: [] },
  {
    id: '4',
    name: 'Submit credentials',
    status: 'failed',
    tags: ['accessibility', 'network'],
    issues: [
      {
        type: 'Network',
        title: 'Request payload too large',
        description: 'POST request exceeds 1MB limit causing 413 error'
      },
      {
        type: 'Accessibility',
        title: 'Missing button labels',
        description: 'Navigation buttons lack aria-label attributes'
      },
      {
        type: 'Accessibility',
        title: 'Heading order broken',
        description: 'Page skips from h2 to h4, violating hierarchy'
      }
    ]
  },
  { id: '5', name: 'Verify confirmation message', status: 'passed', tags: [] },
  { id: '6', name: 'Click login button', status: 'passed', tags: [] },
];

type FilterType = 'all' | 'passed' | 'failed';
type IssueFilterType = 'all' | 'visual' | 'network' | 'accessibility';

export default function ResultOverviewPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterType>('all');
  const [issueFilter, setIssueFilter] = useState<IssueFilterType>('all');
  const [selectedTest, setSelectedTest] = useState<TestCase | null>(null);
  const [activeTab, setActiveTab] = useState<'issues' | 'repro'>('issues');

  // Calculate metrics
  const totalTests = DUMMY_TEST_CASES.length;
  const passedTests = DUMMY_TEST_CASES.filter(t => t.status === 'passed').length;
  const failedTests = DUMMY_TEST_CASES.filter(t => t.status === 'failed').length;
  const passRate = Math.round((passedTests / totalTests) * 100);

  // Count issues by type
  const issuesByType = {
    visual: 27,
    network: 26,
    accessibility: 13
  };
  const totalIssues = issuesByType.visual + issuesByType.network + issuesByType.accessibility;

  // Filter test cases
  const filteredTests = DUMMY_TEST_CASES.filter(test => {
    if (statusFilter !== 'all' && test.status !== statusFilter) return false;
    if (issueFilter !== 'all') {
      if (!test.tags.includes(issueFilter)) return false;
    }
    if (searchQuery && !test.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="content">
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 className="dash-header">Result Overview</h1>
        <p className="dash-sub">
          Testing individual subgoals with visual, network, and functional issue detection
        </p>
      </div>

      {/* Metric Cards */}
      <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* Total Tests Card */}
        <div className="tile">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Tests
            </h4>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted-subtle)" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div className="stat" style={{ marginBottom: '12px' }}>
            {totalTests}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ background: '#F0FDF4', color: '#047857', border: '1px solid #BBF7D0', padding: '4px 8px', borderRadius: '999px', fontWeight: 600, fontSize: '12px' }}>Passed: {passedTests}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '4px 8px', borderRadius: '999px', fontWeight: 600, fontSize: '12px' }}>Failed: {failedTests}</span>
            </div>
          </div>
        </div>

        {/* Pass Rate Card */}
        <div className="tile">
          <div style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Pass Rate
            </h4>
          </div>
          <div className="stat">{passRate}%</div>
        </div>

        {/* Total Issues Card */}
        <div className="tile">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Issues
            </h4>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 6V10M10 14H10.01M19 10C19 14.9706 14.9706 19 10 19C5.02944 19 1 14.9706 1 10C1 5.02944 5.02944 1 10 1C14.9706 1 19 5.02944 19 10Z"
                stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="stat">{totalIssues}</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card" style={{ marginTop: '18px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
          {/* Search */}
          <div style={{ flex: '1', position: 'relative' }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 18 18"
              fill="none"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="8" cy="8" r="6" stroke="var(--muted-subtle)" strokeWidth="2"/>
              <path d="M12.5 12.5L16 16" stroke="var(--muted-subtle)" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search test cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '40px', background: 'var(--elev-2)' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Status Filters */}
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--elev-2)', gap: 0 }}>
              {(['all', 'passed', 'failed'] as FilterType[]).map((filter, idx) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  style={{
                    padding: '8px 14px',
                    border: 'none',
                    outline: 'none',
                    borderRadius: statusFilter === filter ? '6px' : 0,
                    background: statusFilter === filter ? '#0F172A' : 'transparent',
                    color: statusFilter === filter ? '#FFFFFF' : 'var(--text)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.15s',
                    boxShadow: 'none',
                    margin: 0
                  }}
                >
                  {filter === 'all' ? 'All' : filter}
                </button>
              ))}
            </div>

            {/* Issue Type Filters */}
            <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--elev-2)', gap: 0 }}>
              {(['all', 'visual', 'network', 'accessibility'] as IssueFilterType[]).map((filter, idx) => (
                <button
                  key={filter}
                  onClick={() => setIssueFilter(filter)}
                  style={{
                    padding: '8px 14px',
                    border: 'none',
                    outline: 'none',
                    borderRadius: issueFilter === filter ? '6px' : 0,
                    background: issueFilter === filter ? '#0F172A' : 'transparent',
                    color: issueFilter === filter ? '#FFFFFF' : 'var(--text)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.15s',
                    boxShadow: 'none',
                    margin: 0
                  }}
                >
                  {filter === 'all' ? 'All Issues' : filter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div style={{ fontSize: '14px', color: 'var(--muted)', fontWeight: 600, marginBottom: '12px' }}>
        Showing {filteredTests.length} test cases
      </div>

      {/* Two Column Layout */}
      <div className="dash-row">
        {/* Left: Test Cases List */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Test Cases
            </h2>
          </div>
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {filteredTests.map((test) => (
              <div
                key={test.id}
                onClick={() => setSelectedTest(test)}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--inset-sep)',
                  cursor: 'pointer',
                  background: selectedTest?.id === test.id ? 'var(--elev-2)' : 'transparent',
                  transition: 'background 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {/* Status Icon */}
                  {test.status === 'passed' ? (
                    <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '1.5px solid #047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M10 3L4.5 8.5L2 6" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  ) : (
                    <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '1.5px solid #DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M9 3L3 9M3 3L9 9" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  )}

                  {/* Test Name */}
                  <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 500, flex: 1 }}>
                    {test.name}
                  </span>

                  {/* Tags */}
                  {test.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {test.tags.map((tag) => (
                        <span
                          key={tag}
                          className={
                            tag === 'network' ? 'chip-pending' :
                            tag === 'accessibility' ? 'chip-ready' : 'chip-neutral'
                          }
                          style={{ fontSize: '11px', textTransform: 'lowercase' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Details Panel */}
        <div className="card" style={{ padding: 0 }}>
          {selectedTest ? (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                  {selectedTest.name}
                </h2>
                {selectedTest.status === 'passed' ? (
                  <span style={{ background: '#F0FDF4', color: '#047857', border: '1px solid #BBF7D0', padding: '4px 8px', borderRadius: '999px', fontWeight: 600, fontSize: '12px' }}>{selectedTest.status}</span>
                ) : (
                  <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '4px 8px', borderRadius: '999px', fontWeight: 600, fontSize: '12px' }}>{selectedTest.status}</span>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '2px solid var(--border)' }}>
                <button
                  onClick={() => setActiveTab('issues')}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: activeTab === 'issues' ? 'var(--text)' : 'var(--muted)',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'issues' ? '2px solid var(--text)' : 'none',
                    marginBottom: '-2px',
                    borderRadius: 0,
                    transition: 'all 0.15s'
                  }}
                >
                  Issues ({selectedTest.issues?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('repro')}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: activeTab === 'repro' ? 'var(--text)' : 'var(--muted)',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'repro' ? '2px solid var(--text)' : 'none',
                    marginBottom: '-2px',
                    borderRadius: 0,
                    transition: 'all 0.15s'
                  }}
                >
                  Repro Steps
                </button>
              </div>

              {/* Tab Content */}
              <div style={{ padding: '20px', maxHeight: '400px', overflowY: 'auto' }}>
                {activeTab === 'issues' && selectedTest.issues && selectedTest.issues.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {(() => {
                      // Group issues by type
                      const issuesByType = selectedTest.issues.reduce((acc, issue) => {
                        if (!acc[issue.type]) {
                          acc[issue.type] = [];
                        }
                        acc[issue.type].push(issue);
                        return acc;
                      }, {} as Record<string, typeof selectedTest.issues>);

                      return Object.entries(issuesByType).map(([type, issues]) => (
                        <div key={type}>
                          {/* Issue Type Badge with count */}
                          <div style={{ marginBottom: '8px' }}>
                            <span
                              className={type === 'Network' ? 'badge-process' : 'badge-ready'}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                            >
                              {type} ({issues.length})
                            </span>
                          </div>

                          {/* Issue Details */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {issues.map((issue, index) => (
                              <div key={index} className="card" style={{ background: 'var(--elev-2)', padding: '14px' }}>
                                <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 6px 0' }}>
                                  {issue.title}
                                </h4>
                                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0, lineHeight: '1.5' }}>
                                  {issue.description}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : activeTab === 'issues' ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted-subtle)' }}>
                    No issues found for this test case.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600, marginBottom: '8px' }}>
                      Steps to reproduce:
                    </p>
                    <ol style={{ margin: 0, paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <li style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', padding: '8px', borderRadius: '6px' }}>
                        Navigate to the test page
                      </li>
                      <li style={{
                        fontSize: '13px',
                        color: 'var(--muted)',
                        lineHeight: '1.6',
                        padding: '8px',
                        borderRadius: '6px'
                      }}>
                        Perform action: {selectedTest.name}
                        {selectedTest.status === 'failed' && selectedTest.issues && selectedTest.issues.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {selectedTest.issues.map((issue, idx) => (
                              <div
                                key={idx}
                                style={{
                                  background: '#FEF2F2',
                                  border: '1px solid #FECACA',
                                  borderRadius: '6px',
                                  padding: '10px',
                                  fontSize: '12px'
                                }}
                              >
                                <div style={{ marginBottom: '6px' }}>
                                  <strong style={{ color: 'var(--text)' }}>Expected</strong>
                                  <div style={{ color: 'var(--muted)', marginTop: '2px' }}>
                                    {issue.title}
                                  </div>
                                </div>
                                <div>
                                  <strong style={{ color: '#DC2626' }}>Actual Result</strong>
                                  <div style={{ color: '#991B1B', marginTop: '2px' }}>
                                    {issue.description}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                      <li style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', padding: '8px', borderRadius: '6px' }}>
                        Observe the result
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: 'var(--muted-subtle)', fontSize: '14px', fontWeight: 500 }}>
              Select a test case to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
