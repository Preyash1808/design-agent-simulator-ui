from __future__ import annotations

import json
import pathlib
from typing import Any, Dict, List, Tuple


def _load_users(persona_json_path: pathlib.Path) -> List[Dict[str, Any]]:
    try:
        data = json.loads(persona_json_path.read_text(encoding='utf-8'))
        return [p for p in data if isinstance(p, dict)]
    except Exception:
        return []


def _ocean_of(user: Dict[str, Any]) -> Dict[str, float]:
    """Extract OCEAN in a robust way from both old and new schemas.

    Accepts either floats or {value: float} sub-objects.
    """
    o = user.get('ocean') or {}
    def v(k: str) -> float:
        try:
            raw = o.get(k)
            if isinstance(raw, dict):
                raw = raw.get('value')
            return float(raw if raw is not None else 0.0)
        except Exception:
            return 0.0
    return {'O': v('O'), 'C': v('C'), 'E': v('E'), 'A': v('A'), 'N': v('N')}


KEYWORDS: Dict[str, Dict[str, float]] = {
    # openness
    'curious': {'O': 1.0}, 'creative': {'O': 1.0}, 'explore': {'O': 1.0}, 'novel': {'O': 1.0},
    # conscientiousness
    'organized': {'C': 1.0}, 'careful': {'C': 1.0}, 'structured': {'C': 1.0}, 'methodical': {'C': 1.0},
    # extraversion
    'outgoing': {'E': 1.0}, 'energetic': {'E': 1.0}, 'fast': {'E': 1.0}, 'hurry': {'E': 1.0},
    # agreeableness
    'helpful': {'A': 1.0}, 'cooperative': {'A': 1.0}, 'patient': {'A': 1.0}, 'trusting': {'A': 1.0},
    # neuroticism (higher value → more sensitive)
    'anxious': {'N': 1.0}, 'worried': {'N': 1.0}, 'stressed': {'N': 1.0}, 'uncertain': {'N': 1.0},
    # domain hints
    'low vision': {'N': 0.2, 'C': 0.2}, 'in a hurry': {'E': 1.0}, 'impatient': {'E': 1.0},
}

# --- New: trait parsing and constraints ---
def _age_of(user: Dict[str, Any]) -> int:
    try:
        a = int(user.get('age')) if user.get('age') is not None else None
        if a is None:
            # try to infer from bio if pattern like "59-year-old"
            bio = str(user.get('bio') or '')
            import re
            m = re.search(r"(\d{2})-year-old", bio)
            if m:
                return int(m.group(1))
            return -1
        return a
    except Exception:
        return -1

def _text(user: Dict[str, Any]) -> str:
    return ' '.join([str(user.get('job') or ''), str(user.get('bio') or '')]).lower()

def _parse_trait_constraints(traits: str) -> Dict[str, Any]:
    t = (traits or '').lower()
    want_young = any(k in t for k in ['young','student','college','teen'])
    want_student = 'student' in t
    want_senior = any(k in t for k in ['senior','55+','elderly','older adult'])
    want_pro = any(k in t for k in ['professional','working','job','office'])
    want_cautious = 'cautious' in t
    want_reluctant = 'reluctant' in t or 'hesitant' in t
    want_tech_savvy = any(k in t for k in ['tech-savvy','digital native','tech savvy'])
    want_non_tech = any(k in t for k in ['non-tech','not tech','not tech-savvy','non tech'])

    # Early OCEAN nudges based on adjectives
    ocean_nudge = {'O': 0.5, 'C': 0.5, 'E': 0.5, 'A': 0.5, 'N': 0.5}
    if want_cautious:
        ocean_nudge['N'] = min(1.0, 0.7)
        ocean_nudge['O'] = 0.4
    if want_reluctant:
        ocean_nudge['N'] = max(ocean_nudge['N'], 0.7)
    if want_tech_savvy:
        ocean_nudge['O'] = max(ocean_nudge['O'], 0.7)
    if want_non_tech:
        ocean_nudge['O'] = min(ocean_nudge['O'], 0.4)

    return {
        'want_young': want_young,
        'want_student': want_student,
        'want_senior': want_senior,
        'want_pro': want_pro,
        'ocean_nudge': ocean_nudge,
    }

def _age_bucket(age: int) -> str:
    if age < 0:
        return 'unknown'
    if age < 25:
        return 'young'
    if age >= 55:
        return 'senior'
    return 'adult'


def _traits_to_vector(traits: str, nudge: Dict[str, float] | None = None) -> Dict[str, float]:
    if not traits:
        return {'O': 0.5, 'C': 0.5, 'E': 0.5, 'A': 0.5, 'N': 0.5}
    text = traits.lower()
    accum = {'O': 0.0, 'C': 0.0, 'E': 0.0, 'A': 0.0, 'N': 0.0}
    hits = 0.0
    for kw, vec in KEYWORDS.items():
        if kw in text:
            hits += 1.0
            for k, w in vec.items():
                accum[k] += float(w)
    if hits <= 0.0:
        base = {'O': 0.5, 'C': 0.5, 'E': 0.5, 'A': 0.5, 'N': 0.5}
        if nudge:
            for k in base:
                base[k] = float(nudge.get(k, base[k]))
        return base
    # normalize and map into [0,1] around 0.5 baseline
    out = {}
    for k in ['O','C','E','A','N']:
        val = accum[k] / hits
        v = max(0.0, min(1.0, 0.5 + (val - 0.5)))
        if nudge and k in nudge:
            # blend nudge 30%
            v = max(0.0, min(1.0, 0.7 * v + 0.3 * float(nudge[k])))
        out[k] = v
    return out


def _cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
    import math
    keys = ['O','C','E','A','N']
    num = sum(a[k]*b[k] for k in keys)
    da = math.sqrt(sum(a[k]*a[k] for k in keys))
    db = math.sqrt(sum(b[k]*b[k] for k in keys))
    return (num / (da*db)) if (da > 0 and db > 0) else 0.0


def resolve_personas(persona_plan: List[Dict[str, Any]], persona_json_path: pathlib.Path, allow_overlap: bool = True) -> Dict[str, Any]:
    """Resolve free-text trait personas into concrete user IDs from the static persona list.

    Returns: { 'personas': [ { 'slot': int, 'name': str, 'traits': str, 'users': int, 'user_ids': [int], 'matches': [{id:int, score:float}] } ] }
    """
    users = _load_users(persona_json_path)
    # Precompute candidate features (OCEAN + selected categorical + numeric)
    candidates: List[Tuple[int, Dict[str, Any]]] = []  # (id, features)
    for u in users:
        try:
            uid = int(u.get('id'))
        except Exception:
            continue
        features = {
            **_ocean_of(u),
            'cats': {
                'risk_appetite': str(u.get('risk_appetite','')).lower(),
                'work_style': str(u.get('work_style','')).lower(),
                'communication_style': str(u.get('communication_style','')).lower(),
                'industry': str(u.get('industry','')).lower(),
                'experience_level': str(u.get('experience_level','')).lower(),
            },
            'num': {
                'age': float(u.get('age') or 0.0),
            }
        }
        candidates.append((uid, features))

    taken: set[int] = set()
    out_list: List[Dict[str, Any]] = []
    for p in persona_plan or []:
        slot = int(p.get('slot') or 0)
        name = str(p.get('name') or '').strip() or f'Persona {slot}'
        traits = str(p.get('traits') or '').strip()
        users_needed = max(1, int(p.get('users') or 1))
        constraints = _parse_trait_constraints(traits)
        vec = _traits_to_vector(traits, constraints.get('ocean_nudge'))
        # Parse soft constraints from free-text traits (e.g., "high risk", "remote-first", "age 45")
        t = traits.lower()
        want: Dict[str, Any] = {
            'cats': {
                'risk_appetite': ('high' if 'high risk' in t else ('low' if 'low risk' in t else None)),
                'work_style': ('remote-first' if 'remote' in t else None),
                'communication_style': ('direct' if 'direct' in t else None),
                'industry': None,
                'experience_level': ('senior' if 'senior' in t else ('junior' if 'junior' in t else None)),
            },
            'num': {
                'age': None,
            }
        }
        # crude age extraction
        import re as _re
        m = _re.search(r'age\s*(\d{2})', t)
        if m:
            try: want['num']['age'] = float(m.group(1))
            except Exception: pass

        def score(feat: Dict[str, Any]) -> float:
            # ocean similarity (60%)
            ocean_sim = _cosine({k: feat[k] for k in ['O','C','E','A','N']}, vec)
            # categorical (30%)
            total = 0; hits = 0.0
            for k, dv in want['cats'].items():
                if not dv: continue
                total += 1
                uv = feat['cats'].get(k)
                if not uv: continue
                hits += 1.0 if uv == dv else (0.5 if dv in uv or uv in dv else 0.0)
            cat_sim = (hits/total) if total else 1.0
            # numeric (10%)
            if want['num']['age'] is not None:
                au = feat['num'].get('age') or 0.0
                ad = float(want['num']['age'])
                num_sim = max(0.0, 1.0 - abs(au - ad)/50.0)
            else:
                num_sim = 1.0
            # soft boosts from explicit phrases (avoid walrus operator for broad compatibility)
            boost = 0.0
            age_val = feat['num'].get('age')
            try:
                age_num = float(age_val) if age_val is not None else None
            except Exception:
                age_num = None
            if constraints.get('want_student') and age_num is not None and age_num <= 25:
                boost += 0.05
            if constraints.get('want_senior') and age_num is not None and age_num >= 55:
                boost += 0.08
            if constraints.get('want_young') and age_num is not None and age_num < 25:
                boost += 0.06
            return 0.6*ocean_sim + 0.3*cat_sim + 0.1*num_sim + boost

        scored: List[Tuple[int, float]] = []
        for uid, feat in candidates:
            if not allow_overlap and uid in taken:
                continue
            scored.append((uid, score(feat)))
        scored.sort(key=lambda it: (it[1], -it[0]), reverse=True)
        chosen = [uid for uid, _ in scored[:users_needed]]
        if not allow_overlap:
            taken.update(chosen)
        out_list.append({
            'slot': slot,
            'name': name,
            'traits': traits,
            'users': users_needed,
            'user_ids': chosen,
            'matches': [{'id': uid, 'score': round(sc, 3)} for uid, sc in scored[:max(users_needed*2, users_needed)]],
        })

    return {'personas': out_list}


