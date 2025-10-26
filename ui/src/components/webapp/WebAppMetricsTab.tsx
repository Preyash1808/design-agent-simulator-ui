"use client";
import React from 'react';

interface JourneyStep {
  step: number;
  page_url: string;
  success: boolean;
}

interface JourneyData {
  goal: string;
  app_url: string;
  completed: boolean;
  error_message?: string;
  step_count: number;
  elapsed_seconds: number;
  journey: JourneyStep[];
  summary?: {
    total_steps: number;
    completion_rate: number;
    pages_visited: number;
    successful_actions: number;
    failed_actions: number;
  };
}

interface WebAppMetricsTabProps {
  journeyData: JourneyData;
}

function Stat({ label, subtitle, value }: { label: string; subtitle: string; value: string }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: 20,
      minHeight: 120,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {subtitle}
      </div>
    </div>
  );
}

export function WebAppMetricsTab({ journeyData }: WebAppMetricsTabProps) {
  const summary = journeyData.summary || {
    total_steps: journeyData.step_count,
    successful_actions: journeyData.journey.filter(s => s.success).length,
    failed_actions: journeyData.journey.filter(s => !s.success).length,
    pages_visited: new Set(journeyData.journey.map(s => s.page_url)).size,
    completion_rate: journeyData.completed ? 1.0 : 0.0
  };

  const successRate = summary.total_steps > 0
    ? ((summary.successful_actions / summary.total_steps) * 100).toFixed(1)
    : '0';

  function getUniquePages(steps: JourneyStep[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    steps.forEach(step => {
      if (!seen.has(step.page_url)) {
        seen.add(step.page_url);
        unique.push(step.page_url);
      }
    });
    return unique;
  }

  function getPageName(url: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      if (path === '/') return 'Home';
      const parts = path.split('/').filter(Boolean);
      return parts.pop() || 'Page';
    } catch {
      return 'Page';
    }
  }

  const uniquePages = getUniquePages(journeyData.journey);

  return (
    <div className="tile">
      <h4>Test Metrics</h4>

      {/* Metrics Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        marginTop: 16
      }}>
        {/* Completion Status */}
        <div style={{
          background: journeyData.completed ? '#ECFDF5' : '#FEE2E2',
          border: `1px solid ${journeyData.completed ? '#34D399' : '#EF4444'}`,
          borderRadius: 16,
          padding: 20,
          minHeight: 120,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 8,
            color: journeyData.completed ? '#065F46' : '#991B1B'
          }}>
            Completion Status
          </div>
          <div style={{
            fontSize: 40,
            fontWeight: 600,
            color: journeyData.completed ? '#10b981' : '#ef4444'
          }}>
            {journeyData.completed ? '✓' : '✗'}
          </div>
          <div style={{
            fontSize: 12,
            marginTop: 8,
            color: journeyData.completed ? '#065F46' : '#991B1B'
          }}>
            {journeyData.completed ? 'Goal Achieved' : 'Goal Not Achieved'}
          </div>
        </div>

        {/* Total Steps */}
        <Stat
          label="Total Steps"
          subtitle="Actions taken during test"
          value={String(summary.total_steps || journeyData.step_count)}
        />

        {/* Pages Visited */}
        <Stat
          label="Pages Visited"
          subtitle="Unique URLs navigated"
          value={String(summary.pages_visited || uniquePages.length)}
        />

        {/* Elapsed Time */}
        <Stat
          label="Elapsed Time"
          subtitle="Total test duration"
          value={`${journeyData.elapsed_seconds}s`}
        />

        {/* Success Rate */}
        <Stat
          label="Success Rate"
          subtitle="Successful actions"
          value={`${successRate}%`}
        />

        {/* Failed Actions */}
        <Stat
          label="Failed Actions"
          subtitle="Actions that didn't work"
          value={String(summary.failed_actions || 0)}
        />
      </div>

      {/* Page Navigation Flow */}
      <div style={{ marginTop: 24 }}>
        <h5 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Page Navigation Flow</h5>
        <div style={{
          padding: 16,
          background: '#FFFFFF',
          border: '1px solid var(--border)',
          borderRadius: 12
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap'
          }}>
            {uniquePages.map((page, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && (
                  <div style={{
                    fontSize: 20,
                    color: 'var(--muted)'
                  }}>
                    →
                  </div>
                )}
                <div style={{
                  padding: '10px 16px',
                  background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                  color: '#FFFFFF',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)'
                }}>
                  {getPageName(page)}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Show full URLs */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>
              Full URLs:
            </div>
            {uniquePages.map((page, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--muted)',
                  padding: '4px 0',
                  wordBreak: 'break-all'
                }}
              >
                {idx + 1}. {page}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Error Message if failed */}
      {!journeyData.completed && journeyData.error_message && (
        <div style={{
          marginTop: 16,
          background: '#FEE2E2',
          border: '1px solid #EF4444',
          borderRadius: 12,
          padding: 16
        }}>
          <div style={{
            fontWeight: 600,
            marginBottom: 8,
            color: '#991B1B',
            fontSize: 14
          }}>
            Error:
          </div>
          <div style={{ color: '#991B1B', fontSize: 13 }}>
            {journeyData.error_message}
          </div>
        </div>
      )}

      {/* Goal Display */}
      <div style={{
        marginTop: 16,
        padding: 16,
        background: '#F8FAFC',
        border: '1px solid var(--border)',
        borderRadius: 12
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--muted)',
          marginBottom: 8
        }}>
          Test Goal:
        </div>
        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
          {journeyData.goal}
        </div>
      </div>
    </div>
  );
}
