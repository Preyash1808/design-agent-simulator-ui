"use client";
import React from 'react';
import PersonaModal from '../../components/PersonaModal';

type Persona = { id: string; name: string; bio?: string };
type PersonaConfig = { personaId: string; traits: string; users: string };

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

        const r = await fetch('/api/user_personas', {
          cache: 'no-store',
          headers
        });
        const data = await r.json();
        const list: any[] = Array.isArray(data?.personas) ? data.personas : [];
        if (!mounted) return;
        const mapped: Persona[] = list.map((p: any) => ({
          id: String(p.id ?? p.persona_id ?? ''),
          name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`),
          bio: p.bio
        }));
        setPersonas(mapped);

        // Try to load saved persona configurations from API first
        try {
          const configRes = await fetch('/api/persona_configs', { cache: 'no-store' });
          if (configRes.ok) {
            const configData = await configRes.json();
            if (Array.isArray(configData?.configs) && configData.configs.length > 0) {
              setCards(configData.configs);
              setExclusiveUsers(!!configData.exclusiveUsers);
              return;
            }
          }
        } catch {}

        // Fallback to localStorage
        const saved = localStorage.getItem('sparrow_persona_configs');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setCards(parsed);
              return;
            }
          } catch {}
        }

        // Initialize with one empty card
        setCards([{ personaId: '', traits: '', users: '' }]);
      } catch {
        if (!mounted) return;
        setPersonas([]);
        setCards([{ personaId: '', traits: '', users: '' }]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function resolveFromInput(input: string): { personaId: number | null; name: string } {
    const t = String(input || '').trim();
    if (!t) return { personaId: null, name: '' };
    const byId = personas.find(p => String(p.id) === t);
    if (byId) return { personaId: Number(byId.id), name: byId.name };
    const byName = personas.find(p => String(p.name).toLowerCase() === t.toLowerCase());
    if (byName) return { personaId: Number(byName.id), name: byName.name };
    const num = Number(t);
    if (!Number.isNaN(num) && num > 0) return { personaId: num, name: t };
    return { personaId: null, name: t };
  }

  function updateCard(idx: number, patch: Partial<PersonaConfig>) {
    setCards(list => list.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function addCard() {
    setCards(list => [...list, { personaId: '', traits: '', users: '' }]);
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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const updatedCards = [...cards];

      // Save each new persona to user_personas via POST endpoint
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const resolved = resolveFromInput(c.personaId);

        // Only create new personas (not existing ones with numeric IDs)
        if (resolved.personaId === null && resolved.name.trim()) {
          const response = await fetch('/api/user_personas', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              persona: {
                name: resolved.name,
                traits: c.traits,
                bio: c.traits
              }
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create persona');
          }

          const result = await response.json();
          // Update the card with the new persona ID
          updatedCards[i] = { ...c, personaId: String(result.persona.id) };
        }
      }

      // Refresh personas list from API to get newly created personas
      const refreshHeaders: Record<string, string> = { 'Accept': 'application/json' };
      if (token) {
        refreshHeaders['Authorization'] = `Bearer ${token}`;
      }
      const r = await fetch(`/api/user_personas?t=${Date.now()}`, {
        cache: 'no-store',
        headers: refreshHeaders
      });
      const data = await r.json();
      const list: any[] = Array.isArray(data?.personas) ? data.personas : [];
      const mapped: Persona[] = list.map((p: any) => ({
        id: String(p.id ?? p.persona_id ?? ''),
        name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`),
        bio: p.bio
      }));
      setPersonas(mapped);

      // Update cards with new IDs
      setCards(updatedCards);

      // Save to API
      try {
        const saveRes = await fetch('/api/persona_configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configs: updatedCards,
            exclusiveUsers
          })
        });

        if (!saveRes.ok) {
          throw new Error('Failed to save to server');
        }
      } catch (apiError) {
        console.warn('Failed to save to API, falling back to localStorage only:', apiError);
      }

      // Save to localStorage as backup
      localStorage.setItem('sparrow_persona_configs', JSON.stringify(updatedCards));
      localStorage.setItem('sparrow_exclusive_users', String(exclusiveUsers));
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
                    const personaName = String(personas.find(prs => String(prs.id) === String(p.personaId))?.name || p.personaId || '').toString() || `Persona ${i + 1}`;
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

                        <button
                          className="btn-ghost"
                          style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCard(i);
                          }}
                        >
                          Remove
                        </button>
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
                      value={selected?.personaId || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCards(arr => arr.map((it, i) => (i === sel ? { ...it, personaId: v } : it)));
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
                    disabled={loading}
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
