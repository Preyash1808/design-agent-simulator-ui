"use client";
import React from 'react';
import { IconChevronRight, IconChevronDown } from '../icons';
import Link from 'next/link';

type Persona = { id: string; name: string; bio?: string };
type PersonaConfig = { personaId: string; traits: string; users: string; collapsed?: boolean };

export default function PersonaPicker({ onLaunch, onBack }: { onLaunch: (configs: any[], exclusiveUsers: boolean) => void; onBack?: () => void; }) {
  const [personas, setPersonas] = React.useState<Persona[]>([]);
  const [cards, setCards] = React.useState<PersonaConfig[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [exclusiveUsers, setExclusiveUsers] = React.useState<boolean>(false);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [selectedPersonas, setSelectedPersonas] = React.useState<Map<string, number>>(new Map());

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

        console.log('[PersonaPicker] Fetching personas with token:', token ? 'present' : 'missing');
        const r = await fetch('/api/personas', {
          cache: 'no-store',
          headers
        });
        console.log('[PersonaPicker] Response status:', r.status);
        const data = await r.json();
        console.log('[PersonaPicker] Response data:', data);
        // Accept array or { personas } or { items }
        const list: any[] = Array.isArray(data)
          ? data
          : (Array.isArray((data as any)?.personas)
            ? (data as any).personas
            : (Array.isArray((data as any)?.items) ? (data as any).items : []));
        if (!mounted) return;
        const mapped: Persona[] = list.map((p: any) => ({ id: String(p.id ?? p.persona_id ?? ''), name: String(p.name ?? p.persona_name ?? `Persona ${p.id ?? ''}`), bio: (p.bio || p.traits || '') }));
        console.log('[PersonaPicker] Mapped personas:', mapped);
        setPersonas(mapped);

        // Try to load saved persona configurations from API first
        try {
          const configRes = await fetch('/api/persona_configs', { cache: 'no-store' });
          if (configRes.ok) {
            const configData = await configRes.json();
            if (Array.isArray(configData?.configs) && configData.configs.length > 0) {
              // Pre-populate selectedPersonas map from saved configs
              const preselected = new Map<string, number>();
              for (const config of configData.configs) {
                const personaId = String(config.personaId || '').trim();
                const users = Number(config.users || 0);
                if (personaId && users > 0) {
                  preselected.set(personaId, users);
                }
              }
              if (preselected.size > 0) {
                setSelectedPersonas(preselected);
              }
              setExclusiveUsers(!!configData.exclusiveUsers);
              return;
            }
          }
        } catch {}

        // Initialize with one empty card if no saved config
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

  function togglePersona(personaId: string, checked: boolean) {
    const newMap = new Map(selectedPersonas);
    if (checked) {
      // Add with default user count (3)
      newMap.set(personaId, 3);
    } else {
      newMap.delete(personaId);
    }
    setSelectedPersonas(newMap);
  }

  function updateUserCount(personaId: string, delta: number) {
    const newMap = new Map(selectedPersonas);
    const current = newMap.get(personaId) || 0;
    const updated = Math.max(0, current + delta);
    if (updated === 0) {
      newMap.delete(personaId);
    } else {
      newMap.set(personaId, updated);
    }
    setSelectedPersonas(newMap);
  }

  function setUserCount(personaId: string, count: number) {
    const newMap = new Map(selectedPersonas);
    if (count <= 0) {
      newMap.delete(personaId);
    } else {
      newMap.set(personaId, count);
    }
    setSelectedPersonas(newMap);
  }

  function resetSelection() {
    setSelectedPersonas(new Map());
  }

  function launch() {
    console.log('[PersonaPicker] launch() called');
    console.log('[PersonaPicker] selectedPersonas:', selectedPersonas);
    console.log('[PersonaPicker] personas:', personas);

    // Validate: at least one persona selected, total users <= 3000
    if (selectedPersonas.size === 0) {
      alert('Please select at least one persona.');
      return;
    }

    let total = 0;
    const cleaned: any[] = [];

    for (const [personaId, users] of selectedPersonas.entries()) {
      const persona = personas.find(p => p.id === personaId);
      console.log('[PersonaPicker] Processing personaId:', personaId, 'users:', users, 'found persona:', persona);
      if (!persona) continue;

      if (!Number.isFinite(users) || users <= 0) {
        alert(`Number of Users must be a positive number for ${persona.name}.`);
        return;
      }

      total += users;
      cleaned.push({
        personaId: Number(personaId),
        name: persona.name,
        traits: persona.bio || '',
        users
      });
    }

    console.log('[PersonaPicker] cleaned configs:', cleaned);
    console.log('[PersonaPicker] total users:', total);

    if (total > 3000) {
      alert('Total users across personas cannot exceed 3000.');
      return;
    }

    setLoading(true);
    console.log('[PersonaPicker] Calling onLaunch with:', cleaned, exclusiveUsers);
    onLaunch(cleaned, exclusiveUsers);
    setLoading(false);
  }

  const filteredPersonas = personas.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.bio && p.bio.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalUsers = Array.from(selectedPersonas.values()).reduce((sum, count) => sum + count, 0);
  const isOverLimit = totalUsers > 3000;

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div>
            <h1 className="page-title">Select Personas for Test</h1>
            <p className="meta">Choose personas and set users per group.</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6 bg-slate-50">
        {/* Left: persona list */}
        <section className="lg:col-span-2">
          {/* Search */}
          <div className="mb-3 flex items-center gap-2">
            <div className="flex grow items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white">
              <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M21 21l-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/>
              </svg>
              <input
                className="input border-0 h-auto p-0 w-full"
                placeholder="Search personas"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Persona cards */}
          <div className="space-y-3">
            {filteredPersonas.length === 0 ? (
              <div className="card text-center text-slate-600">No personas match your search.</div>
            ) : (
              filteredPersonas.map(persona => {
                const isSelected = selectedPersonas.has(persona.id);
                const userCount = selectedPersonas.get(persona.id) || 0;

                return (
                  <div
                    key={persona.id}
                    className="row-card flex items-start justify-between"
                    style={{ borderColor: isSelected ? '#cbd5e1' : undefined }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-slate-900"
                            checked={isSelected}
                            onChange={(e) => togglePersona(persona.id, e.target.checked)}
                          />
                          <span className="text-slate-900 font-medium truncate">{persona.name}</span>
                        </label>
                      </div>
                      {(() => {
                        const desc = String(persona.bio || '').trim();
                        return (
                          <div className="meta mt-1 truncate" title={desc}>
                            {desc || ''}
                          </div>
                        );
                      })()}
                      <div className="text-xs text-slate-500 mt-1">Default users: 3</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        disabled={!isSelected}
                        className="stepper-btn"
                        onClick={() => updateUserCount(persona.id, -1)}
                      >
                        –
                      </button>
                      <input
                        readOnly
                        value={userCount}
                        className="stepper-input"
                      />
                      <button
                        disabled={!isSelected}
                        className="stepper-btn"
                        onClick={() => updateUserCount(persona.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right: selection summary */}
        <aside className="lg:sticky lg:top-20 h-fit">
          <div className="sidebar">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-4 w-4 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>
              </svg>
              <h3 className="section-title">Selection Summary</h3>
            </div>

            <div className="text-sm text-slate-700 space-y-1">
              {selectedPersonas.size === 0 ? (
                <p className="text-slate-500">No personas selected yet.</p>
              ) : (
                Array.from(selectedPersonas.entries()).map(([personaId, users]) => {
                  const persona = personas.find(p => p.id === personaId);
                  if (!persona) return null;
                  return (
                    <div key={personaId} className="flex items-center justify-between">
                      <span className="truncate">{persona.name}</span>
                      <span className="tabular-nums text-slate-900">{users} users</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="divider"></div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Total users</span>
              <span className={`tabular-nums font-medium ${isOverLimit ? 'text-red-600' : 'text-slate-900'}`}>
                {totalUsers} <span className="text-slate-500">/ 3000</span>
              </span>
            </div>

            {isOverLimit && (
              <div className="mt-2 chip chip-warn">Exceeds allowed total users</div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                className="btn btn-secondary"
                onClick={resetSelection}
                disabled={selectedPersonas.size === 0}
              >
                Reset
              </button>
              <button
                className="btn btn-primary"
                onClick={launch}
                disabled={selectedPersonas.size === 0 || loading || isOverLimit}
              >
                {loading ? 'Starting Test…' : 'Start Test'}
              </button>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Personas are managed in <Link href="/configure-persona" className="underline hover:text-slate-800">Configure Personas</Link>.
            </p>
          </div>

          <div className="mt-4 card p-4 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 5l7 7-7 7"/>
              </svg>
              Next: Define Task & Screens
            </div>
          </div>
        </aside>
      </main>
    </>
  );
}


