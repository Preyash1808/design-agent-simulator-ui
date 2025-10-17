"use client";
import React from 'react';

export default function PathRankList({
  items,
  palette = ['#5B6DAA', '#4B6B88', '#2F6F7E', '#64748B', '#1E3A8A', '#B45309', '#94A3B8', '#475569'],
  onHover,
  onSelect,
  hoveredPath,
  selectedPath,
}: {
  items: Array<{ path: string; sharePct?: number; count?: number }>;
  palette?: string[];
  onHover?: (path: string | null) => void;
  onSelect?: (path: string) => void;
  hoveredPath?: string | null;
  selectedPath?: string | null;
}) {
  const max = Math.max(1, ...items.map((x) => Number(x.sharePct || 0)));
  function splitSteps(p: string): string[] { return String(p || '').split('>').map(s=>s.trim()).filter(Boolean); }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((it, idx) => {
        const pct = Number(it.sharePct || 0);
        const color = palette[idx % palette.length];
        const isActive = hoveredPath === it.path || selectedPath === it.path;
        const steps = splitSteps(it.path);
        return (
          <button
            key={it.path}
            onMouseEnter={() => onHover && onHover(it.path)}
            onMouseLeave={() => onHover && onHover(null)}
            onClick={() => onSelect && onSelect(it.path)}
            style={{
              textAlign: 'left',
              border: '1px solid var(--border)',
              background: isActive ? 'rgba(59,130,246,0.08)' : 'rgba(15,23,42,0.35)',
              color: '#e2e8f0',
              padding: '8px 10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: '0 0 auto', boxShadow: '0 0 0 2px rgba(255,255,255,0.06)' }} />
                {/* single-line, horizontally scrollable steps */}
                <div
                  style={{
                    position: 'relative',
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                    display: 'block',
                    // Reserve space for overlay scrollbar so it doesn't cover chips
                    paddingBottom: 12,
                    marginBottom: -12,
                    // Helps some browsers reserve gutter space
                    scrollbarGutter: 'stable both-edges' as any,
                    maskImage: 'linear-gradient(90deg, rgba(0,0,0,1), rgba(0,0,0,1) 95%, rgba(0,0,0,0))',
                  }}
                >
                  {steps.map((s, i) => (
                    <React.Fragment key={i}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          background: 'rgba(148,163,184,0.12)',
                          border: '1px solid var(--border)',
                          color: '#cbd5e1',
                          borderRadius: 999,
                          padding: '2px 8px',
                          fontSize: 11,
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          verticalAlign: 'middle',
                        }}
                        title={s}
                      >
                        {s}
                      </span>
                      {i < steps.length - 1 && (
                        <span aria-hidden style={{ color: '#64748b', fontSize: 12, margin: '0 6px', verticalAlign: 'middle' }}>›</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'right' }}>{pct}%{typeof it.count === 'number' ? ` (${it.count} users)` : ''}</div>
            </div>
            {/* Horizontal bar backdrop showing % visually */}
            <div style={{ position: 'relative', height: 8, background: 'rgba(148,163,184,0.12)', borderRadius: 999, marginTop: 6 }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(pct / max) * 100}%`, background: color, borderRadius: 999, opacity: 0.9, boxShadow: isActive ? '0 0 0 1px rgba(255,255,255,0.25)' : 'none' }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}


