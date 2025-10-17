"use client";
import { useEffect } from 'react';

type ToastProps = {
  kind: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
  onClose?: () => void;
};

export default function Toast({ kind, message, duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(() => { onClose?.(); }, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  return (
    <div className={`toast ${kind}`} role="alert" aria-live="polite">
      <span className="toast-icon" aria-hidden>
        {kind === 'success' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 7L9 18l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : kind === 'error' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 16h-1v-4h-1m1-4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
      </span>
      <span className="toast-text">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  );
}


