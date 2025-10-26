"use client";
import React, { useState } from 'react';

interface JourneyStep {
  step: number;
  timestamp: number;
  page_title: string;
  page_url: string;
  element_count: number;
  action: {
    action: string;
    element_id?: number;
    reasoning: string;
    text?: string;
  };
  success: boolean;
  screenshot: string;
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

interface JourneyTabProps {
  journeyData: JourneyData;
  runId: string;
}

export function JourneyTab({ journeyData, runId }: JourneyTabProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  function getActionIcon(action: string): string {
    switch (action.toLowerCase()) {
      case 'click': return '👆';
      case 'type': return '⌨️';
      case 'select': return '🔽';
      case 'complete': return '✅';
      default: return '▶️';
    }
  }

  function getActionText(stepAction: JourneyStep['action']): string {
    const { action, text } = stepAction;
    if (action === 'type' && text) {
      return `Typed "${text}"`;
    }
    if (action === 'select' && text) {
      return `Selected "${text}"`;
    }
    if (action === 'click') {
      return 'Clicked element';
    }
    if (action === 'complete') {
      return 'Goal completed';
    }
    return action;
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString();
  }

  function getScreenshotUrl(step: number): string {
    const api = process.env.NEXT_PUBLIC_SPARROW_API || '';
    return `${api}/runs-files/${runId}/screenshots/step_${String(step).padStart(3, '0')}.png`;
  }

  function getPageName(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname === '/' ? 'Home' : urlObj.pathname.split('/').filter(Boolean).pop() || 'Page';
    } catch {
      return 'Page';
    }
  }

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

  const uniquePages = getUniquePages(journeyData.journey);

  return (
    <div className="tile">
      <h4>Test Journey</h4>

      {/* Summary */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: 12,
        background: 'var(--elev-2)',
        borderRadius: 8,
        marginBottom: 16
      }}>
        <span>
          Status: <strong style={{ color: journeyData.completed ? '#10b981' : '#ef4444' }}>
            {journeyData.completed ? '✓ Completed' : '✗ Failed'}
          </strong>
        </span>
        <span>{journeyData.step_count} steps</span>
        <span>{journeyData.elapsed_seconds}s</span>
      </div>

      {/* Page Flow Overview */}
      <div style={{ marginBottom: 24 }}>
        <h5 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Page Flow</h5>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          background: '#FFFFFF',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflowX: 'auto'
        }}>
          {uniquePages.map((page, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span style={{ color: 'var(--muted)' }}>→</span>}
              <div style={{
                padding: '6px 12px',
                background: 'var(--elev-2)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: 'nowrap'
              }}>
                {getPageName(page)}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Detailed Steps Timeline */}
      <h5 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Detailed Steps</h5>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {journeyData.journey.map((step: JourneyStep) => (
          <div
            key={step.step}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 16,
              background: '#FFFFFF'
            }}
          >
            {/* Step Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--muted)',
                  minWidth: 40
                }}>
                  [{step.step}]
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  {step.page_url.length > 60 ? step.page_url.substring(0, 60) + '...' : step.page_url}
                </span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {formatTime(step.timestamp)}
              </span>
            </div>

            {/* Step Content */}
            <div style={{ display: 'grid', gap: 12 }}>
              {/* Action */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 8,
                background: 'var(--elev-2)',
                borderRadius: 6
              }}>
                <span style={{ fontSize: 20 }}>{getActionIcon(step.action.action)}</span>
                <span style={{ fontWeight: 500 }}>{getActionText(step.action)}</span>
              </div>

              {/* Reasoning */}
              <div style={{
                padding: 10,
                background: '#F8FAFC',
                borderLeft: '3px solid #3B82F6',
                borderRadius: 4,
                fontSize: 13,
                fontStyle: 'italic',
                color: '#475569'
              }}>
                💭 {step.action.reasoning}
              </div>

              {/* Status & Screenshot */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: step.success ? '#ECFDF5' : '#FEE2E2',
                  color: step.success ? '#10b981' : '#ef4444'
                }}>
                  {step.success ? '✓ Success' : '✗ Failed'}
                </div>

                {/* Screenshot Thumbnail */}
                <img
                  src={getScreenshotUrl(step.step)}
                  alt={`Step ${step.step}`}
                  onClick={() => setSelectedScreenshot(getScreenshotUrl(step.step))}
                  style={{
                    width: 150,
                    height: 100,
                    objectFit: 'cover',
                    cursor: 'pointer',
                    borderRadius: 6,
                    border: '1px solid var(--border)'
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Screenshot Lightbox */}
      {selectedScreenshot && (
        <div
          onClick={() => setSelectedScreenshot(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 20,
            cursor: 'pointer'
          }}
        >
          <img
            src={selectedScreenshot}
            alt="Full screenshot"
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              borderRadius: 8
            }}
          />
        </div>
      )}
    </div>
  );
}
