"use client";
import React from 'react';

export interface StepIndicatorProps {
  steps: { label: string }[];
  activeIndex: number; // 0-based
  compact?: boolean; // smaller footprint variant
  onStepClick?: (index: number) => void; // optional click handler for current/past steps
}

export default function StepIndicator({ steps, activeIndex, compact = false, onStepClick }: StepIndicatorProps) {
  return (
    <div className="stepper" style={{ display: 'flex', alignItems: 'center', gap: (compact ? 8 : 12), overflowX: 'auto', paddingBottom: (compact ? 2 : 4) }}>
      {steps.map((s, i) => {
        const completed = i < activeIndex;
        const active = i === activeIndex;
        const canClick = !!onStepClick && i <= activeIndex;
        const circleBg = completed ? '#FFFFFF' : active ? '#FFFFFF' : '#FFFFFF';
        const circleColor = completed ? '#111827' : (active ? '#111827' : '#475569');
        const ring = active
          ? `inset 0 0 0 2px var(--border-strong)`
          : (completed ? `inset 0 0 0 1px var(--border-strong)` : `inset 0 0 0 1px var(--border)`);
        return (
          <div key={`${s.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: (compact ? 8 : 12) }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: (compact ? 64 : 80) }}>
              <div
                style={{
                  width: (compact ? 26 : 32),
                  height: (compact ? 26 : 32),
                  borderRadius: '50%',
                  background: circleBg,
                  color: circleColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: (compact ? 12 : 13),
                  boxShadow: ring,
                  flexShrink: 0,
                  cursor: canClick ? 'pointer' : undefined,
                  outline: 'none'
                }}
                aria-current={active ? 'step' : undefined}
                role={canClick ? 'button' : undefined}
                tabIndex={canClick ? 0 : -1}
                aria-disabled={!canClick}
                onClick={() => { if (canClick) onStepClick?.(i); }}
                onKeyDown={(e) => { if (canClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onStepClick?.(i); } }}
              >
                {completed ? '✓' : i + 1}
              </div>
              <div style={{ marginTop: (compact ? 6 : 8), fontSize: (compact ? 12 : 13), color: active || completed ? '#0F172A' : '#475569', textAlign: 'center', maxWidth: (compact ? 120 : 140), lineHeight: 1.2 }}>
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 2, width: (compact ? 56 : 84), background: completed ? 'var(--border-strong)' : 'var(--inset-sep)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}


