"use client";
import React from 'react';
import PersonaModal from '../../components/PersonaModal';

type Persona = { id: string; name: string; bio?: string };
type PersonaConfig = { personaId: string; traits: string; users: string; displayName?: string };

export default function ConfigurePersonaPage() {
  const [personas, setPersonas] = React.useState<Persona[]>([]);
  const [cards, setCards] = React.useState<PersonaConfig[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [exclusiveUsers, setExclusiveUsers] = React.useState<boolean>(false);
  const [selectedPersona, setSelectedPersona] = React.useState<Persona | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState<boolean>(false);
  const [saveMessage, setSaveMessage] = React.useState<string>('');
  const [sel, setSel] = React.useState<number>(0);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Get auth token
        const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Fetch personas directly from backend proxy /api/personas
        const r = await fetch('/api/personas', {
          cache: 'no-store',
          headers
        });
        const data = await r.json();
        // Support both shapes: an array or { personas: [...] } or { items: [...] }
        const list: any[] = Array.isArray(data)
          ? data
          : (Array.isArray((data as any)?.personas)
            ? (data as any).personas
            : (Array.isArray((data as any)?.items) ? (data as any).items : []));
        if (!mounted) return;
        const mapped: Persona[] = list.map((p: any) => ({
          id: String(p.id ?? p.persona_id ?? ''),
          name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`),
          bio: p.bio
        }));
        setPersonas(mapped);
        // Pre-populate cards from existing personas so names show immediately
        const preCards = list
          .filter((p: any) => p && (p.id != null || p.persona_id != null))
          .map((p: any) => ({ personaId: String(p.id ?? p.persona_id ?? ''), traits: String(p.traits ?? ''), users: '', displayName: String(p.name ?? p.persona_name ?? '') } as PersonaConfig));
        setCards(preCards);
        if (preCards.length) setSel(0);
      } catch {
        if (!mounted) return;
        setPersonas([]);
        setCards([{ personaId: '', traits: '', users: '', displayName: '' }]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function resolveFromInput(input: string): { personaId: string | null; name: string } {
    const t = String(input || '').trim();
    if (!t) return { personaId: null, name: '' };
    const byId = personas.find(p => String(p.id) === t);
    if (byId) return { personaId: String(byId.id), name: byId.name };
    const byName = personas.find(p => String(p.name).toLowerCase() === t.toLowerCase());
    if (byName) return { personaId: String(byName.id), name: byName.name };
    // If not resolvable, treat as new-by-name
    return { personaId: null, name: t };
  }

  function updateCard(idx: number, patch: Partial<PersonaConfig>) {
    setCards(list => list.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function addCard() {
    setCards(list => {
      const next = [...list, { personaId: '', traits: '', users: '', displayName: '' }];
      setSel(next.length - 1);
      return next;
    });
  }

  function removeCard(idx: number) {
    const next = cards.filter((_, i) => i !== idx);
    setCards(next);
    setSel(Math.max(0, Math.min(sel, next.length - 1)));
  }

  async function saveConfigurations() {
    // Validate: each card must have name or id
    for (const c of cards) {
      const resolved = resolveFromInput(c.personaId);
      const hasName = !!(resolved.name && resolved.name.trim()) || typeof resolved.personaId === 'number';
      if (!hasName) {
        setSaveMessage('Error: Each persona must have a name or valid ID.');
        setTimeout(() => setSaveMessage(''), 3000);
        return;
      }
    }

    setLoading(true);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept':'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const updatedCards = [...cards];

      // Upsert each persona by name via backend proxy
      for (let i = 0; i < cards.length; i++) {
        const c = updatedCards[i];
        const resolved = resolveFromInput(c.personaId);
        const finalName = (() => {
          if (resolved.personaId) {
            const match = personas.find(prs => String(prs.id) === String(resolved.personaId));
            return (match?.name || resolved.name || String(c.personaId)).trim();
          }
          return (resolved.name || String(c.personaId)).trim();
        })();
        if (!finalName) continue;

        const resp = await fetch('/api/personas/upsert', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: finalName, traits: c.traits })
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(t || 'Failed to upsert persona');
        }
        let upserted: any = {};
        try { upserted = await resp.json(); } catch {}
        if (upserted && (upserted.id != null)) {
          updatedCards[i] = { ...c, personaId: String(upserted.id), displayName: finalName };
        }
      }

      // Refresh personas list from API to get newly created personas
      const refreshHeaders: Record<string, string> = { 'Accept': 'application/json' };
      if (token) {
        refreshHeaders['Authorization'] = `Bearer ${token}`;
      }
      const r = await fetch(`/api/personas?t=${Date.now()}`, {
        cache: 'no-store',
        headers: refreshHeaders
      });
      const data = await r.json();
      // Support both shapes: an array or { personas: [...] } or { items: [...] }
      const list: any[] = Array.isArray(data)
        ? data
        : (Array.isArray((data as any)?.personas)
          ? (data as any).personas
          : (Array.isArray((data as any)?.items) ? (data as any).items : []));
      const mapped: Persona[] = list.map((p: any) => ({
        id: String(p.id ?? p.persona_id ?? ''),
        name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`),
        bio: p.bio
      }));
      setPersonas(mapped);

      // Update cards with new IDs
      setCards(updatedCards);

      setSaveMessage('Configurations saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error: any) {
      setSaveMessage(`Error: ${error.message || 'Failed to save configurations.'}`);
      setTimeout(() => setSaveMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  }

  function openPersonaModal(personaId: string) {
    const persona = personas.find(p => p.id === personaId);
    if (persona) {
      setSelectedPersona(persona);
      setIsModalOpen(true);
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setSelectedPersona(null);
  }

  const selected = cards[sel];

  return (
    <>
      <div className="content">
        <div className="container">
          <div style={{ gridColumn: '1 / -1', marginBottom: '24px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: '800', margin: '4px 0 6px', color: 'var(--text)' }}>Configure Personas</h1>
            <p className="muted">Define personas and allocate test users for your usability tests.</p>
          </div>

          {/* Main grid */}
          <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '340px 1fr', gap: '24px' }}>
            {/* LEFT: list */}
            <aside>
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h2 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)', margin: 0 }}>Personas</h2>
                </div>

                <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
                  {cards.map((p, i) => {
                    const personaName = String(personas.find(prs => String(prs.id) === String(p.personaId))?.name || p.displayName || '').toString() || `Persona ${i + 1}`;
                    const isActive = sel === i;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: isActive ? 'var(--elev-2)' : '#FFFFFF',
                          cursor: 'pointer',
                          transition: 'all .15s ease'
                        }}
                        onClick={() => setSel(i)}
                      >
                        <div
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '14px',
                            fontWeight: isActive ? '700' : '600',
                            color: 'var(--text)'
                          }}
                        >
                          {personaName}
                        </div>

                        <div style={{ display:'inline-flex', gap:6 }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              (async () => {
                                try {
                                  const card = cards[i];
                                  const resolved = resolveFromInput(card.personaId);
                                  if (!resolved.personaId) { removeCard(i); return; }
                                  const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
                                  await fetch(`/api/personas/${encodeURIComponent(resolved.personaId)}`, {
                                    method: 'DELETE',
                                    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                                  });
                                } catch {}
                                removeCard(i);
                              })();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  className="btn-ghost"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={addCard}
                >
                  + Add Persona
                </button>
              </div>
            </aside>

            {/* RIGHT: editor */}
            <section>
              <div className="card">
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text)', margin: '0 0 4px' }}>Edit Persona</h3>
                <p className="muted" style={{ marginBottom: '18px', fontSize: '13px' }}>
                  Make changes on the right; select different personas on the left.
                </p>

                <div className="grid">
                  {/* Name */}
                  <label>
                    Name
                    <input
                      placeholder="e.g., Returning Shopper"
                      value={(() => {
                        const pid = selected?.personaId || "";
                        const match = personas.find(prs => String(prs.id) === String(pid));
                        return selected?.displayName || match?.name || pid;
                      })()}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCards(arr => arr.map((it, i) => (i === sel ? { ...it, personaId: v, displayName: v } : it)));
                      }}
                    />
                  </label>

                  {/* Traits */}
                  <label>
                    Traits
                    <textarea
                      rows={3}
                      placeholder="e.g., Low vision; prefers minimal prompts; anxious under time pressure"
                      value={selected?.traits || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCards(arr => arr.map((it, i) => (i === sel ? { ...it, traits: v } : it)));
                      }}
                    />
                    {/* helper chips */}
                    {selected?.traits && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                        {selected.traits.split(',').map((t, idx) => {
                          const trimmed = t.trim();
                          if (!trimmed) return null;
                          return (
                            <span key={idx} className="chip">
                              {trimmed}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </label>

                </div>

                {/* Footer with save button */}
                <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={saveConfigurations}
                    disabled={loading || cards.length === 0}
                    className="btn-primary"
                  >
                    {loading ? 'Saving…' : 'Save Configurations'}
                  </button>
                </div>
              </div>

              {saveMessage && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: saveMessage.startsWith('Error') ? '1px solid rgba(239,68,68,.35)' : '1px solid var(--accent-border)',
                  background: saveMessage.startsWith('Error') ? 'rgba(239,68,68,.12)' : 'var(--accent)',
                  color: saveMessage.startsWith('Error') ? '#ef4444' : 'var(--accent-text)'
                }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>{saveMessage}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {selectedPersona && (
        <PersonaModal
          persona={selectedPersona}
          isOpen={isModalOpen}
          onClose={closeModal}
        />
      )}
    </>
  );
}
