"use client";
import React from 'react';

export interface SegOption {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedToggleProps {
  value: string;
  options: SegOption[];
  onChange: (key: string) => void;
}

export default function SegmentedToggle({ value, options, onChange }: SegmentedToggleProps) {
  return (
    <div
      className="segmented-toggle"
      role="tablist"
      aria-label="Select Project Mode"
      style={{
        display: 'inline-flex',
        background: '#FFFFFF',
        borderRadius: 10,
        padding: 4,
        gap: 4,
        border: '1px solid #E2E8F0'
      }}
    >
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.key)}
            className={active ? 'seg-on' : 'seg-off'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: active ? '#1E293B' : 'transparent',
              color: active ? '#FFFFFF' : '#64748B',
              fontWeight: active ? 600 : 500,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {opt.icon ? <span aria-hidden>{opt.icon}</span> : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}


