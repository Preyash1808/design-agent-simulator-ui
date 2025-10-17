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
    <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 16, maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
      {items.map((t, i) => {
        const emo = t.emotion || {};
        const tint = (emo.color ? hexToRgba(emo.color, 0.12) : 'rgba(148,163,184,0.10)');
        const thumbSrc = toProxyUrl(t.screen_thumbnail_url);
        return (
          <React.Fragment key={`${t.screen_id ?? 'x'}_${i}`}>
            {/* timeline rail + dot */}
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, bottom: (i === items.length - 1 ? '50%' : 0), left: 9, width: 2, background: '#E2E8F0' }} />
              <div style={{ position: 'absolute', top: '50%', marginTop: -5, left: 4, width: 10, height: 10, borderRadius: 999, background: getEmotionTextColor(emo.name), boxShadow: '0 0 0 3px #FFFFFF, 0 0 0 4px #E2E8F0' }} />
            </div>
            {/* card */}
            <div className="tea-card" style={{
              position: 'relative',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 16,
              padding: '20px 18px',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.06)',
              transition: 'box-shadow 0.2s ease, transform 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.08)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.06)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              {/* Emotion badge in top-right corner */}
              {(emo.emoji || emo.name) && (
                <div style={{
                  position: 'absolute',
                  top: 14,
                  right: 14,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: getEmotionBgColor(emo.name),
                  color: getEmotionTextColor(emo.name),
                  border: `1px solid ${getEmotionBorderColor(emo.name)}`,
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600
                }}>
                  <span aria-hidden style={{ fontSize: 16 }}>{emo.emoji || '😐'}</span>
                  <span>{emo.name || 'Neutral'}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 16 }}>
                {/* Thumbnail */}
                {thumbSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbSrc} alt={t.screen_name || ''} width={64} height={64} style={{ borderRadius: 12, objectFit: 'cover', border: '1px solid #E2E8F0', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: 12, background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, border: '1px solid #E2E8F0', flexShrink: 0 }}>No image</div>
                )}

                <div style={{ flex: 1, minWidth: 0, paddingRight: 100 }}>
                  {/* Title - Screen name */}
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', marginBottom: 8 }}>
                    {t.screen_name || `Screen ${t.screen_id ?? ''}`}
                  </div>

                  {/* Thought - Larger and italic */}
                  <div style={{ marginBottom: 16, fontStyle: 'italic', color: '#334155', fontSize: 15, lineHeight: 1.5 }}>
                    {quoteThought(t.thought_text)}
                  </div>

                  {/* Action - Smaller gray text */}
                  {t.action && (
                    <div style={{ color: '#64748B', fontSize: 13, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>Action:</span> {t.action}
                    </div>
                  )}

                  {/* Goal (if present) */}
                  {t.goal && (
                    <div style={{ color: '#64748B', fontSize: 13, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>Goal:</span> {t.goal}
                    </div>
                  )}

                  {/* Traits and badges row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
                    {renderTraits(t.traits)}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {typeof t.friction === 'number' && t.friction > 0 && (
                        <span style={{ borderRadius: 999, background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#DC2626', padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                          Friction {t.friction?.toFixed(2)}
                        </span>
                      )}
                      {t.success && (
                        <span style={{ borderRadius: 999, background: '#D1FAE5', border: '1px solid #6EE7B7', color: '#047857', padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                          Goal ✓
                        </span>
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

// Stronger emotion color differentiation
function getEmotionBgColor(emotionName?: string): string {
  const name = String(emotionName || '').toLowerCase();
  if (name.includes('frustrated') || name.includes('angry')) return '#FEE2E2';
  if (name.includes('impatient') || name.includes('annoyed')) return '#FED7AA';
  if (name.includes('anxious') || name.includes('worried')) return '#FEF3C7';
  if (name.includes('confused') || name.includes('uncertain')) return '#E0E7FF';
  if (name.includes('confident') || name.includes('satisfied')) return '#D1FAE5';
  if (name.includes('excited') || name.includes('joyful')) return '#DBEAFE';
  if (name.includes('curious')) return '#E9D5FF';
  return '#F1F5F9';
}

function getEmotionTextColor(emotionName?: string): string {
  const name = String(emotionName || '').toLowerCase();
  if (name.includes('frustrated') || name.includes('angry')) return '#DC2626';
  if (name.includes('impatient') || name.includes('annoyed')) return '#EA580C';
  if (name.includes('anxious') || name.includes('worried')) return '#CA8A04';
  if (name.includes('confused') || name.includes('uncertain')) return '#4F46E5';
  if (name.includes('confident') || name.includes('satisfied')) return '#047857';
  if (name.includes('excited') || name.includes('joyful')) return '#0369A1';
  if (name.includes('curious')) return '#7C3AED';
  return '#475569';
}

function getEmotionBorderColor(emotionName?: string): string {
  const name = String(emotionName || '').toLowerCase();
  if (name.includes('frustrated') || name.includes('angry')) return '#FCA5A5';
  if (name.includes('impatient') || name.includes('annoyed')) return '#FDBA74';
  if (name.includes('anxious') || name.includes('worried')) return '#FDE047';
  if (name.includes('confused') || name.includes('uncertain')) return '#A5B4FC';
  if (name.includes('confident') || name.includes('satisfied')) return '#6EE7B7';
  if (name.includes('excited') || name.includes('joyful')) return '#7DD3FC';
  if (name.includes('curious')) return '#C4B5FD';
  return '#CBD5E1';
}


