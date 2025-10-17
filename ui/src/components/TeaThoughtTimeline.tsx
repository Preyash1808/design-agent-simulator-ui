"use client";
import React, { useMemo } from "react";

type Emotion = { name?: string; emoji?: string; color?: string; valence?: number };

export type TeaThought = {
  screen_id?: number | null;
  screen_name?: string;
  screen_thumbnail_url?: string | null;
  thought_text: string;
  emotion?: Emotion;
  goal?: string | null;
  action?: string | null;
  traits?: Record<string, number> | null;
  friction?: number | null;
  success?: boolean | null;
};

function toProxyUrl(u?: string | null): string | undefined {
  const x = String(u || "");
  if (!x) return undefined;
  if (/^https?:\/\//i.test(x)) return x;
  const path = x.startsWith("/") ? x : `/${x}`;
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
    const qs = token ? `&token=${encodeURIComponent(token)}` : '';
    return `/api/proxy_image?path=${encodeURIComponent(path)}${qs}`;
  } catch {
    return `/api/proxy_image?path=${encodeURIComponent(path)}`;
  }
}

export default function TeaThoughtTimeline({ teaThoughts }: { teaThoughts: TeaThought[] }) {
  // Sort in UI: negative (lower valence / higher friction / not success) first
  const items = useMemo(() => {
    const arr = Array.isArray(teaThoughts) ? [...teaThoughts] : [];
    const negLex = new Map<string, number>([
      ['frustrated', 1.0], ['angry', 0.95], ['anxious', 0.92], ['impatient', 0.9], ['confused', 0.88],
      ['lost', 0.86], ['disoriented', 0.86], ['blocked', 0.85], ['stuck', 0.84], ['skeptical', 0.8],
      ['hesitant', 0.78], ['uncertain', 0.76], ['cautious', 0.7], ['overwhelmed', 0.9], ['annoyed', 0.88],
    ]);
    const posLex = new Set(['joy', 'joyful', 'excited', 'confident', 'focused', 'organized', 'relieved', 'calm', 'satisfied']);
    const negativityFromName = (name?: string): number => {
      const n = String(name || '').toLowerCase().trim();
      if (!n) return -1; // unknown
      for (const [k, v] of negLex.entries()) if (n.includes(k)) return v;
      if (posLex.has(n)) return 0.0;
      if (n === 'neutral' || n === 'curious') return 0.2;
      return -1; // unknown
    };
    const score = (t: TeaThought) => {
      const nameNeg = negativityFromName(t?.emotion?.name);
      const valence = typeof t?.emotion?.valence === 'number' ? Number(t.emotion!.valence) : 0.5; // 0..1
      const negVal = (nameNeg >= 0 ? nameNeg : (1 - valence));
      const fr = typeof t?.friction === 'number' ? Number(t.friction) : 0.0; // higher means worse
      const succPenalty = t?.success ? 0.2 : 0.0; // success lowers negativity slightly
      // Heuristic weighting: emotion dominates, then friction
      return (negVal * 2.0) + (fr * 0.8) - succPenalty;
    };
    arr.sort((a, b) => score(b) - score(a));
    return arr;
  }, [teaThoughts]);
  if (!items.length) return <div className="muted">—</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 12, maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
      {items.map((t, i) => {
        const emo = t.emotion || {};
        const tint = (emo.color ? hexToRgba(emo.color, 0.12) : 'rgba(148,163,184,0.10)');
        const thumbSrc = toProxyUrl(t.screen_thumbnail_url);
        return (
          <React.Fragment key={`${t.screen_id ?? 'x'}_${i}`}>
            {/* timeline rail + dot */}
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, bottom: (i === items.length - 1 ? '50%' : 0), left: 9, width: 2, background: 'rgba(148,163,184,0.18)' }} />
              <div style={{ position: 'absolute', top: '50%', marginTop: -4, left: 5, width: 8, height: 8, borderRadius: 999, background: emo.color || '#94A3B8', boxShadow: '0 0 0 2px rgba(0,0,0,0.6)' }} />
            </div>
            {/* card */}
            <div className="tile" style={{ background: tint, border: '1px solid rgba(148,163,184,0.2)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {thumbSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbSrc} alt={t.screen_name || ''} width={60} height={60} style={{ borderRadius: 8, objectFit: 'cover', background: '#0f172a' }} />
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 8, background: 'rgba(148,163,184,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>No image</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.screen_name || `Screen ${t.screen_id ?? ''}`}
                    </div>
                    {(emo.emoji || emo.name) && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: emo.color ? hexToRgba(emo.color, 0.2) : 'rgba(148,163,184,0.18)', color: '#e5e7eb', border: '1px solid rgba(148,163,184,0.25)', padding: '4px 8px', borderRadius: 999, fontSize: 12 }}>
                        <span aria-hidden>{emo.emoji || '😐'}</span>
                        <span>{emo.name || 'Neutral'}</span>
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 8, fontStyle: 'italic', color: '#cbd5e1' }}>
                    {quoteThought(t.thought_text)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, color: '#cbd5e1', fontSize: 12 }}>
                    {t.goal && <span><b>Goal:</b> {t.goal}</span>}
                    {t.action && <span><b>Action:</b> {t.action}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                    {renderTraits(t.traits)}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {typeof t.friction === 'number' && t.friction > 0 && (
                        <span style={{ borderRadius: 999, background: 'rgba(248,113,113,0.18)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca', padding: '3px 8px', fontSize: 12 }}>friction {t.friction?.toFixed(2)}</span>
                      )}
                      {t.success && (
                        <span style={{ borderRadius: 999, background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.35)', color: '#bbf7d0', padding: '3px 8px', fontSize: 12 }}>goal</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function quoteThought(s: string) {
  const t = String(s || '').trim();
  if (!t) return '—';
  return /[“”]/.test(t) ? t : `“${t}”`;
}

function hexToRgba(hex?: string, alpha: number = 0.1) {
  if (!hex) return `rgba(148,163,184,${alpha})`;
  const m = hex.replace('#','');
  const bigint = parseInt(m.length===3 ? m.split('').map(c=>c+c).join('') : m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderTraits(traits?: Record<string, number> | null) {
  if (!traits) return null;
  const keys = ['O','C','E','A','N'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {keys.map(k => (
        <div key={k} title={k} style={{ width: 28 }}>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(100 * clamp(traits[k] ?? 0, 0, 1))}%`, background: 'rgba(99,102,241,0.6)' }} />
          </div>
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 10, marginTop: 3 }}>{k}</div>
        </div>
      ))}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }


