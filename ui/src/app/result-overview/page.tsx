"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import jsPDF from 'jspdf';
import FancySelect from '../../components/FancySelect';

type Project = { id: string; name: string; run_dir?: string; kind?: string; created_at?: string; updated_at?: string };

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
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterType>('all');
  const [issueFilter, setIssueFilter] = useState<IssueFilterType>('all');
  const [selectedTest, setSelectedTest] = useState<TestCase | null>(null);
  const [activeTab, setActiveTab] = useState<'issues' | 'repro'>('issues');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

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

  // Load projects from API
  async function loadProjects() {
    try {
      setLoading(true);
      setError('');
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Load all projects from the projects API
      const res = await fetch('/api/projects', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();
      const allProjects: any[] = Array.isArray(data?.projects) ? data.projects : [];

      // Map projects to our Project type
      const mappedProjects: Project[] = allProjects.map(p => ({
        id: String(p.id),
        name: String(p.name || p.id),
        kind: p.kind,
        created_at: p.created_at,
        updated_at: p.updated_at
      }));

      setProjects(mappedProjects);

      // Always auto-select the most recently created project if none is selected
      if (mappedProjects.length > 0) {
        const sorted = [...mappedProjects].sort((a, b) => {
          const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
          const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
          return dateB - dateA;
        });
        const mostRecent = sorted[0];

        // If no project is currently selected, or selected project is not in the list, select the most recent
        if (!selectedProject || !mappedProjects.find(p => p.id === selectedProject)) {
          setSelectedProject(mostRecent.id);
        }
      }
    } catch (err) {
      console.error('Error loading projects:', err);
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  // Run Test Again Handler
  const handleRunTestAgain = () => {
    setShowConfirmModal(true);
  };

  const confirmRunTestAgain = () => {
    setShowConfirmModal(false);
    // TODO: Add API call to run test again
  };

  // PDF Download Handler
  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPosition = margin;

    // Helper function to add new page if needed
    const checkAndAddPage = (requiredSpace: number) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };

    // Helper function to wrap text
    const wrapText = (text: string, maxWidth: number) => {
      return doc.splitTextToSize(text, maxWidth);
    };

    // Header - QA Report
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('QA Report', margin, yPosition);
    yPosition += 10;

    // Project Name
    const selectedProjectObj = projects.find(p => p.id === selectedProject);
    const projectName = selectedProjectObj?.name || 'Unknown Project';
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text(`Project: ${projectName}`, margin, yPosition);
    yPosition += 6;

    // Generated Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const generatedDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.text(`Generated on: ${generatedDate}`, margin, yPosition);
    yPosition += 15;

    // Metrics Section
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Summary', margin, yPosition);
    yPosition += 8;

    // Metric Cards
    const cardWidth = (pageWidth - margin * 2 - 10) / 3;
    const cardHeight = 25;
    const cardSpacing = 5;

    // Total Tests Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, yPosition, cardWidth, cardHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('TOTAL TESTS', margin + 5, yPosition + 7);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(totalTests.toString(), margin + 5, yPosition + 18);

    // Pass Rate Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin + cardWidth + cardSpacing, yPosition, cardWidth, cardHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('PASS RATE', margin + cardWidth + cardSpacing + 5, yPosition + 7);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`${passRate}%`, margin + cardWidth + cardSpacing + 5, yPosition + 18);

    // Total Issues Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin + (cardWidth + cardSpacing) * 2, yPosition, cardWidth, cardHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('TOTAL ISSUES', margin + (cardWidth + cardSpacing) * 2 + 5, yPosition + 7);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(totalIssues.toString(), margin + (cardWidth + cardSpacing) * 2 + 5, yPosition + 18);

    yPosition += cardHeight + 15;

    // Test Cases Section - Spreadsheet Style
    checkAndAddPage(30);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Test Cases', margin, yPosition);
    yPosition += 8;

    // Column widths for 4-column layout (Number, Test Case, Error, Repro Steps)
    const colGap = 2;
    const numColWidth = 10;
    const testCaseColWidth = 45;
    const errorColWidth = 55;
    const reproColWidth = 60;

    const numColX = margin;
    const testCaseColX = numColX + numColWidth + colGap;
    const errorColX = testCaseColX + testCaseColWidth + colGap;
    const reproColX = errorColX + errorColWidth + colGap;

    // Draw table header
    doc.setFillColor(240, 240, 240);
    doc.rect(numColX, yPosition, numColWidth, 8, 'F');
    doc.rect(testCaseColX, yPosition, testCaseColWidth, 8, 'F');
    doc.rect(errorColX, yPosition, errorColWidth, 8, 'F');
    doc.rect(reproColX, yPosition, reproColWidth, 8, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('No.', numColX + 2, yPosition + 5.5);
    doc.text('Test Case', testCaseColX + 2, yPosition + 5.5);
    doc.text('Error', errorColX + 2, yPosition + 5.5);
    doc.text('Repro Steps', reproColX + 2, yPosition + 5.5);

    yPosition += 8;

    // Draw header border
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, yPosition, margin + numColWidth + testCaseColWidth + errorColWidth + reproColWidth + colGap * 3, yPosition);
    yPosition += 1;

    // Iterate through all test cases
    DUMMY_TEST_CASES.forEach((test, index) => {
      const rowStartY = yPosition;

      // Calculate row height based on content
      const reproSteps = [
        'Navigate to the test page',
        `Perform action: ${test.name}`,
        'Observe the result'
      ];

      let maxRowHeight = 12; // minimum height with padding

      // Calculate test case column height
      let testCaseHeight = 5; // Base height for test name

      // Calculate error column height
      let errorHeight = 5; // Base height
      if (test.status === 'failed' && test.issues && test.issues.length > 0) {
        errorHeight = test.issues.reduce((acc, issue) => {
          const titleLines = wrapText(`${issue.title}: ${issue.description}`, errorColWidth - 4);
          return acc + (titleLines.length * 3.5) + 6; // 6 = badge height + spacing
        }, 2);
      }

      // Calculate repro steps height with proper spacing
      const reproHeight = reproSteps.reduce((acc, step, idx) => {
        const stepLines = wrapText(`${idx + 1}. ${step}`, reproColWidth - 4);
        return acc + (stepLines.length * 3.5);
      }, 2);

      // Use the maximum of all column heights plus padding
      maxRowHeight = Math.max(maxRowHeight, testCaseHeight, errorHeight, reproHeight) + 4; // +4 for top/bottom padding

      // Check if we need a new page
      checkAndAddPage(maxRowHeight + 5);

      const finalRowStartY = yPosition; // Update after potential page break

      // Draw row background based on status
      if (test.status === 'passed') {
        doc.setFillColor(240, 253, 244);
      } else {
        doc.setFillColor(254, 242, 242);
      }
      doc.rect(numColX, finalRowStartY, numColWidth + testCaseColWidth + errorColWidth + reproColWidth + colGap * 3, maxRowHeight, 'F');

      // COLUMN 1: Number
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      doc.text((index + 1).toString(), numColX + 2, finalRowStartY + 5);

      // COLUMN 2: Test Case
      let testCaseY = finalRowStartY + 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);

      // Test name
      const testNameLines = wrapText(test.name, testCaseColWidth - 4);
      doc.text(testNameLines[0], testCaseColX + 2, testCaseY);

      // COLUMN 3: Error details
      let errorY = finalRowStartY + 5;
      if (test.status === 'failed' && test.issues && test.issues.length > 0) {
        test.issues.forEach((issue, issueIdx) => {
          doc.setFontSize(7);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);

          // Issue type badge
          let badgeWidth = 15;
          if (issue.type === 'Network') {
            doc.setFillColor(224, 231, 255);
            doc.setTextColor(67, 56, 202);
          } else if (issue.type === 'Accessibility') {
            doc.setFillColor(209, 250, 229);
            doc.setTextColor(4, 120, 87);
            badgeWidth = 22;
          } else {
            doc.setFillColor(254, 243, 199);
            doc.setTextColor(146, 64, 14);
          }

          doc.roundedRect(errorColX + 2, errorY - 2, badgeWidth, 3, 0.5, 0.5, 'F');
          doc.setFontSize(6);
          doc.text(issue.type, errorColX + 3, errorY);
          errorY += 4;

          // Error description
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
          const errorLines = wrapText(`${issue.title}: ${issue.description}`, errorColWidth - 4);
          errorLines.forEach((line) => {
            doc.text(line, errorColX + 2, errorY);
            errorY += 3.5;
          });

          errorY += 2;
        });
      } else {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('-', errorColX + 2, errorY);
      }

      // COLUMN 4: Reproduction Steps
      let reproY = finalRowStartY + 5;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);

      reproSteps.forEach((step, idx) => {
        const stepLines = wrapText(`${idx + 1}. ${step}`, reproColWidth - 4);
        stepLines.forEach((line) => {
          doc.text(line, reproColX + 2, reproY);
          reproY += 3.5;
        });
      });

      yPosition = finalRowStartY + maxRowHeight;

      // Draw row border
      doc.setDrawColor(220, 220, 220);
      doc.line(numColX, yPosition, numColX + numColWidth + testCaseColWidth + errorColWidth + reproColWidth + colGap * 3, yPosition);
    });

    // Save the PDF
    doc.save(`QA-Report-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Result Overview</h2>
      </div>

      {/* Project Selector and Actions */}
      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 700, flex: '0 0 420px', listStyle: 'none', display: 'grid', gap: '6px' }}>
            <span style={{ listStyle: 'none' }}>Project</span>
            <FancySelect
              value={selectedProject}
              onChange={(val) => {
                if (val) { // Only allow non-empty selections
                  setSelectedProject(val);
                }
              }}
              placeholder="Select project"
              options={projects.map(p => ({ value: p.id, label: p.name }))}
              searchable={false}
              compact
            />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn-sm"
              onClick={handleRunTestAgain}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                background: '#0F172A',
                color: '#FFFFFF',
                border: '1px solid #0F172A',
                boxShadow: '0 1px 2px rgba(15,23,42,0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                borderRadius: '999px',
                fontWeight: 700,
                letterSpacing: '.2px',
                cursor: 'pointer',
                transition: 'transform .05s ease, background .2s ease, box-shadow .2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#1E293B'}
              onMouseOut={(e) => e.currentTarget.style.background = '#0F172A'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              Run Test Again
            </button>
            <button
              className="btn-sm"
              onClick={handleDownloadPDF}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                background: '#3B82F6',
                color: '#FFFFFF',
                border: '1px solid #3B82F6',
                boxShadow: '0 1px 2px rgba(59,130,246,0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                borderRadius: '999px',
                fontWeight: 700,
                letterSpacing: '.2px',
                cursor: 'pointer',
                transition: 'transform .05s ease, background .2s ease, box-shadow .2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#2563EB'}
              onMouseOut={(e) => e.currentTarget.style.background = '#3B82F6'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              Download
            </button>
          </div>
        </div>
        {(loading || error) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {loading && <span className="muted">Loading projects…</span>}
            {error && <span className="muted" style={{ color: '#fca5a5' }}>{error}</span>}
          </div>
        )}
      </div>

      {/* Metric Cards */}
      <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: '24px' }}>
        {/* Total Tests Card */}
        <div className="tile">
          <div style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Tests
            </h4>
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

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
              Confirm run test again!
            </h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#64748B', lineHeight: '1.5' }}>
              By confirming, you will lose access to the previous test runs. We recommend downloading report first.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  backgroundColor: 'white',
                  color: '#64748B',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRunTestAgain}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#0F172A',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
