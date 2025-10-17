"use client";
import React from 'react';
import { IconChevronRight, IconChevronDown } from '../icons';
import PersonaModal from '../PersonaModal';

type Persona = { id: string; name: string; bio?: string };
type PersonaConfig = { personaId: string; traits: string; users: string; collapsed?: boolean };

export default function PersonaPicker({ onLaunch, onBack }: { onLaunch: (configs: any[], exclusiveUsers: boolean) => void; onBack?: () => void; }) {
  const [personas, setPersonas] = React.useState<Persona[]>([]);
  const [cards, setCards] = React.useState<PersonaConfig[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [exclusiveUsers, setExclusiveUsers] = React.useState<boolean>(false);
  const [selectedPersona, setSelectedPersona] = React.useState<Persona | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState<boolean>(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch('/api/persona_list', { cache: 'no-store' });
        const data = await r.json();
        const list: any[] = Array.isArray(data?.personas) ? data.personas : [];
        if (!mounted) return;
        const mapped: Persona[] = list.map((p: any) => ({ id: String(p.id ?? p.persona_id ?? ''), name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`), bio: p.bio }));
        setPersonas(mapped);
        // Initialize with one empty card
        setCards([{ personaId: '', traits: '', users: '', collapsed: false }]);
      } catch {
        if (!mounted) return;
        setPersonas([]);
        setCards([{ personaId: '', traits: '', users: '', collapsed: false }]);
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
    setCards(list => {
      const collapsedAll = list.map(c => ({ ...c, collapsed: true }));
      return [...collapsedAll, { personaId: '', traits: '', users: '', collapsed: false }];
    });
  }

  function removeCard(idx: number) {
    setCards(list => list.filter((_, i) => i !== idx));
  }
  function toggleCollapsed(idx: number) {
    setCards(list => {
      const expanding = !!list[idx] && list[idx].collapsed;
      return list.map((c, i) => {
        if (i === idx) return { ...c, collapsed: !c.collapsed };
        return expanding ? { ...c, collapsed: true } : c;
      });
    });
  }

  function focusCard(idx: number) {
    setCards(list => list.map((c, i) => ({ ...c, collapsed: i !== idx }))); // current expanded, others minimized
  }

  function launch() {
    // Validate: each card must have name or id, users > 0; total users <= 3000
    let total = 0;
    const cleaned: any[] = [];
    for (const c of cards) {
      const resolved = resolveFromInput(c.personaId);
      const traits = String(c.traits || '');
      const usersNum = parseInt(String(c.users || '').trim(), 10);
      const hasName = !!(resolved.name && resolved.name.trim()) || typeof resolved.personaId === 'number';
      if (!hasName) { alert('Each persona must have a name or valid ID.'); return; }
      if (!Number.isFinite(usersNum) || usersNum <= 0) { alert('Number of Users must be a positive number for each persona.'); return; }
      total += usersNum;
      const base: any = { traits, users: usersNum };
      if (resolved.personaId && resolved.personaId > 0) base.personaId = resolved.personaId;
      if (resolved.name) base.name = resolved.name;
      cleaned.push(base);
    }
    if (total > 3000) { alert('Total users across personas cannot exceed 3000.'); return; }
    setLoading(true);
    onLaunch(cleaned, exclusiveUsers);
    setLoading(false);
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

  return (
    <>
      <div className="tile">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Personas</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="muted" style={{ fontWeight: 600 }}>Total Users:</div>
            <div style={{ fontWeight: 600 }}>{cards.reduce((sum, c) => sum + (Number(c.users) || 0), 0)}</div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {cards.map((c, idx) => (
              <div key={idx} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    aria-label={c.collapsed ? 'Expand persona' : 'Collapse persona'}
                    onClick={() => toggleCollapsed(idx)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(idx); } }}
                    aria-expanded={!c.collapsed}
                    aria-controls={`persona-card-${idx}`}
                    style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}
                  >
                    <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22 }}>
                      {c.collapsed ? <IconChevronRight width={18} height={18} /> : <IconChevronDown width={18} height={18} />}
                    </span>
                    {(c.collapsed
                      ? (String(personas.find(p => String(p.id)===String(c.personaId))?.name || c.personaId || '').toString() || 'Persona')
                      : '')}
                  </button>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.personaId && personas.find(p => String(p.id) === String(c.personaId)) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => openPersonaModal(c.personaId)}
                      >
                        View Details
                      </button>
                    )}
                    {cards.length > 1 && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => removeCard(idx)}>Remove</button>
                    )}
                  </div>
                </div>
              {c.collapsed ? null : (
                <div id={`persona-card-${idx}`} className="grid" style={{ marginTop: 8 }}>
                  <label>
                    Name
                    <input value={c.personaId} onChange={(e)=>updateCard(idx, { personaId: e.target.value })} onFocus={()=>focusCard(idx)} placeholder="Type a name you want to give to the Persona" />
                  </label>
                  <label>
                    Traits
                    <textarea rows={3} value={c.traits} onChange={(e)=>updateCard(idx, { traits: e.target.value })} onFocus={()=>focusCard(idx)} placeholder="e.g., Low vision, prefers minimal prompts" />
                  </label>
                  <label>
                    Number of Users
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={c.users} onChange={(e)=>updateCard(idx, { users: e.target.value.replace(/[^0-9]/g, '') })} onFocus={()=>focusCard(idx)} placeholder="Enter count" />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button type="button" className="btn-ghost" onClick={addCard}>Add Persona</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!exclusiveUsers}
                onChange={(e)=>setExclusiveUsers(!e.target.checked)}
                style={{ accentColor: '#ffffff' }}
              />
              <span>Overlap users</span>
            </label>
            {onBack && (<button type="button" className="btn-ghost" onClick={onBack}>Back</button>)}
            <button type="button" className="btn-primary" disabled={!cards.length || loading} onClick={launch}>{loading ? 'Starting…' : 'Execute Test'}</button>
          </div>
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


