"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';

export type Option = { value: string; label: string };

type FancySelectProps = {
  options: Option[];
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
};

export default function FancySelect({ options, value, placeholder = 'Select…', onChange, disabled, searchable = true }: FancySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = useMemo(() => options.find(o => o.value === value)?.label, [options, value]);
  const filtered = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  // Close menu whenever the selected value changes (covers keyboard / external updates)
  useEffect(() => {
    setOpen(false);
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className={`select ${open ? 'open' : ''}`} ref={boxRef} aria-disabled={disabled} style={{ position: 'relative' }}>
      <button
        type="button"
        className="select-trigger"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%', textAlign: 'left',
          background: '#FFFFFF', border: '1px solid var(--border)',
          borderRadius: 12, padding: '12px 14px', color: 'var(--text)',
          fontWeight: 700
        }}
      >
        <span className={`select-value${activeLabel ? '' : ' placeholder'}`} style={{ color: activeLabel ? 'var(--text)' : 'var(--muted)' }}>
          {activeLabel || placeholder}
        </span>
        <span className="select-caret" aria-hidden style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', opacity: .7 }}>▾</span>
      </button>
      {open && (
        <div
          className="select-menu"
          role="listbox"
          style={{ position: 'absolute', left: 0, right: 0, zIndex: 50, marginTop: 8, background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 36px rgba(15,23,42,0.12)' }}
        >
          {searchable && (
            <div className="select-search" style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                style={{ width: '100%', background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' }}
              />
            </div>
          )}
          <div className="select-options" style={{ maxHeight: 260, overflow: 'auto' }}>
            {filtered.length === 0 && (
              <div className="select-empty" style={{ padding: '10px 12px', color: 'var(--muted)' }}>No matches</div>
            )}
            {filtered.map(o => (
              <div
                key={o.value}
                className={`select-option${o.value === value ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); setQuery(''); }}
                onClick={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); setQuery(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(o.value); setOpen(false); setQuery(''); } }}
                role="option"
                aria-selected={o.value === value}
                title={o.label}
                tabIndex={0}
                style={{ padding: '10px 14px', cursor: 'pointer', background: o.value === value ? 'var(--accent)' : '#FFFFFF', color: o.value === value ? 'var(--accent-text)' : 'var(--text)' }}
                onMouseEnter={(e) => { (e.currentTarget.style as any).background = 'rgba(15,23,42,0.04)'; }}
                onMouseLeave={(e) => { (e.currentTarget.style as any).background = o.value === value ? 'var(--accent)' : '#FFFFFF'; }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


