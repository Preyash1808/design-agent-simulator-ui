"use client";
import React, { useState } from 'react';

interface JourneyStep {
  step: number;
  timestamp: number;
  page_title: string;
  page_url: string;
  action: {
    action: string;
    reasoning: string;
    text?: string;
  };
  success: boolean;
  screenshot: string;
}

interface ScreenshotsTabProps {
  journeyData: {
    journey: JourneyStep[];
  };
  runId: string;
}

export function ScreenshotsTab({ journeyData, runId }: ScreenshotsTabProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function getScreenshotUrl(step: number): string {
    const api = process.env.NEXT_PUBLIC_SPARROW_API || '';
    return `${api}/runs-files/${runId}/screenshots/step_${String(step).padStart(3, '0')}.png`;
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

  function truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  return (
    <div className="tile">
      <h4>Screenshots Gallery</h4>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          marginTop: 16
        }}
      >
        {journeyData.journey.map((step: JourneyStep, idx: number) => (
          <div
            key={idx}
            onClick={() => setSelectedIndex(idx)}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: '#FFFFFF'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <img
              src={getScreenshotUrl(step.step)}
              alt={`Step ${step.step}`}
              style={{
                width: '100%',
                height: 200,
                objectFit: 'cover',
                display: 'block'
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="280" height="200"%3E%3Crect fill="%23f1f5f9" width="280" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="14"%3ENo screenshot%3C/text%3E%3C/svg%3E';
              }}
            />
            <div style={{ padding: 12 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 4,
                color: 'var(--text)'
              }}>
                Step {step.step}
              </div>
              <div style={{
                fontSize: 12,
                color: 'var(--muted)',
                marginBottom: 6
              }}>
                {getActionText(step.action)}
              </div>
              <div style={{
                fontSize: 11,
                color: 'var(--muted)',
                fontFamily: 'monospace'
              }}>
                {truncate(step.page_url, 35)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox with navigation */}
      {selectedIndex !== null && (
        <div
          onClick={() => setSelectedIndex(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 20
          }}
        >
          {/* Previous button */}
          {selectedIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex(Math.max(0, selectedIndex - 1));
              }}
              style={{
                position: 'absolute',
                left: 20,
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: '#FFFFFF',
                border: 'none',
                cursor: 'pointer',
                fontSize: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }}
            >
              ←
            </button>
          )}

          {/* Image */}
          <div style={{ textAlign: 'center', maxWidth: '90%', maxHeight: '90%' }}>
            <img
              src={getScreenshotUrl(journeyData.journey[selectedIndex].step)}
              alt={`Step ${journeyData.journey[selectedIndex].step}`}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(90vh - 100px)',
                objectFit: 'contain',
                borderRadius: 8
              }}
            />
            <div style={{
              marginTop: 16,
              color: '#FFFFFF',
              fontSize: 14
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Step {journeyData.journey[selectedIndex].step} of {journeyData.journey.length}
              </div>
              <div style={{ opacity: 0.8 }}>
                {getActionText(journeyData.journey[selectedIndex].action)}
              </div>
            </div>
          </div>

          {/* Next button */}
          {selectedIndex < journeyData.journey.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex(Math.min(journeyData.journey.length - 1, selectedIndex + 1));
              }}
              style={{
                position: 'absolute',
                right: 20,
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: '#FFFFFF',
                border: 'none',
                cursor: 'pointer',
                fontSize: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }}
            >
              →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
