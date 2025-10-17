#!/usr/bin/env python3
"""
Simulate a goal-directed user traversal over the preprocessed graph.

Inputs:
- run-dir: path to a logs/run_* folder (uses latest if omitted)
- source screen name (human, case-insensitive)
- target screen name and/or target screen_nodes id
- goal: plain-text user goal

Behavior:
- At each screen, list available actions (outgoing links) and log the user's
  pre-action thought based on the goal and screen context.
- Choose the next action by scoring edges against the goal (keyword overlap).
- Move along the chosen edge if available; otherwise list all available actions.
- Stop when reaching the target screen (by name or screen_nodes id), or after
  15 minutes (or max steps), logging the outcome.

Outputs (under run-dir/simulations/<timestamp>/):
- traversal_log.jsonl: one JSON object per event/step
- path.json: final path summary (screens, linkIds)
- transcript.txt: human-readable trace
"""

import argparse
import json
import os
import re
import time
import pathlib
import shutil
import random
from typing import Dict, Any, List, Tuple, Optional


ROOT = pathlib.Path(__file__).resolve().parent.parent

# --- Image hashing helpers for source/target image matching ---
from PIL import Image

def average_hash(path: pathlib.Path, size: int = 8) -> Optional[int]:
    try:
        with Image.open(path) as im:
            im = im.convert('L').resize((size, size), Image.BILINEAR)
            pixels = list(im.getdata())
            avg = sum(pixels) / float(len(pixels)) if pixels else 0.0
            bits = 0
            for idx, p in enumerate(pixels):
                if p >= avg:
                    bits |= (1 << idx)
            return bits
    except Exception:
        return None

def hamming_distance(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count('1')

def build_id_to_hash_map(screens_dir: pathlib.Path, id_to_file: Dict[int, str]) -> Dict[int, int]:
    out: Dict[int, int] = {}
    for sid, fname in id_to_file.items():
        p = screens_dir / fname
        if p.exists():
            ah = average_hash(p)
            if isinstance(ah, int):
                out[int(sid)] = ah
    return out
# --- end image hashing helpers ---


def list_run_dirs(logs_dir: pathlib.Path) -> List[pathlib.Path]:
    if not logs_dir.exists():
        return []
    runs = [p for p in logs_dir.iterdir() if p.is_dir() and p.name.startswith('run_')]
    runs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return runs


def normalize(s: str) -> str:
    return ''.join(ch.lower() for ch in (s or '') if ch.isalnum())


def load_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def load_personas(path: Optional[pathlib.Path]) -> List[Dict[str, Any]]:
    if not path or not path.exists():
        return []
    data = load_json(path)
    if isinstance(data, list):
        return data
    return []


def extract_ocean(persona: Dict[str, Any]) -> Dict[str, float]:
    ocean = persona.get('ocean') or {}
    def val(k: str) -> float:
        try:
            return float((ocean.get(k) or {}).get('value') or 0.0)
        except Exception:
            return 0.0
    return {
        'O': val('O'),
        'C': val('C'),
        'E': val('E'),
        'A': val('A'),
        'N': val('N'),
    }


def compute_persona_scales(persona: Dict[str, Any]) -> Dict[str, float]:
    o = extract_ocean(persona)
    O, C, E, A, N = o['O'], o['C'], o['E'], o['A'], o['N']
    # Base scales from OCEAN
    direct_scale = 1.0 + 0.6 * C + 0.2 * (1.0 - N)
    back_scale = 1.0 + 0.5 * C + 0.5 * N
    distance_scale = 1.0 + 0.5 * C - 0.2 * O
    # Contextual adjustments (ethically-safe): risk appetite, communication style, age, experience_level
    try:
        ra = str((persona.get('risk_appetite') or '').lower())
        if ra == 'high':
            direct_scale += 0.15
            back_scale -= 0.1
        elif ra == 'low':
            direct_scale -= 0.1
            back_scale += 0.1
    except Exception:
        pass
    try:
        cs = str((persona.get('communication_style') or '').lower())
        if cs == 'direct':
            direct_scale += 0.1
    except Exception:
        pass
    try:
        age = float(persona.get('age') or 0)
        if age >= 55:
            distance_scale -= 0.1  # prefer shorter paths
    except Exception:
        pass
    try:
        lvl = str((persona.get('experience_level') or '').lower())
        if lvl in ('junior','entry'):
            back_scale += 0.1
    except Exception:
        pass
    return {'direct_scale': direct_scale, 'back_scale': back_scale, 'distance_scale': distance_scale}


def dominant_trait(ocean: Dict[str, float]) -> str:
    if not ocean:
        return ''
    # Return the Big-5 key with the highest absolute deviation from 0.5 as dominant
    best = max(ocean.items(), key=lambda kv: abs(kv[1] - 0.5))
    return best[0]


def build_persona_intent_text(persona: Optional[Dict[str, Any]], goal: str, dest_name: str, click_text: str, base_intent: str) -> str:
    if not persona:
        return base_intent
    po = extract_ocean(persona)
    # pick top 2 traits for richer variety
    dominant = sorted(po.items(), key=lambda kv: abs(kv[1]-0.5), reverse=True)[:2]
    traits = [t for t, v in dominant]

    persona_context = f"{persona.get('name')} ({persona.get('job')}, {persona.get('country')})"
    ct = (click_text or '').strip()
    d = dest_name
    g = goal

    if 'C' in traits and 'N' in traits:
        return f"As {persona_context}, I want a safe and structured path. I'll {ct or 'take the clearest option'} toward '{d}' while keeping control over my goal: {g}."
    if 'O' in traits and 'E' in traits:
        return f"As {persona_context}, I'm curious and energetic. I'll {ct or 'explore the most engaging option'} to move toward '{d}' while chasing my goal: {g}."
    if 'A' in traits and 'N' in traits:
        return f"As {persona_context}, I value harmony but dislike uncertainty. I'll {ct or 'choose the least disruptive option'} to reach '{d}' and keep focused on {g}."

    return f"As {persona_context}, I'll {ct or 'act purposefully'} toward '{d}' to achieve {g}."


def build_node_maps(nodes_json_path: pathlib.Path) -> Tuple[Dict[str, int], Dict[int, str], Dict[int, str], Dict[str, int]]:
    name_to_id: Dict[str, int] = {}
    id_to_name: Dict[int, str] = {}
    id_to_file: Dict[int, str] = {}
    id_to_desc: Dict[int, str] = {}
    screenid_to_id: Dict[str, int] = {}
    nodes: List[Dict[str, Any]] = load_json(nodes_json_path)
    for n in nodes:
        try:
            nid = int(n.get('id'))
        except Exception:
            continue
        nm = str(n.get('name') or '')
        fn = str(n.get('file') or '')
        sid = str(n.get('screen_id') or '')
        if nm:
            name_to_id[nm] = nid
            id_to_name[nid] = nm
        if fn:
            id_to_file[nid] = fn
        desc = str(n.get('description') or '')
        if desc:
            id_to_desc[nid] = desc
        if sid:
            screenid_to_id[sid] = nid
    # type: ignore - extend return with desc map via attribute on tuple-like usage sites
    # We keep the original return arity but attach map via function attribute for reuse
    build_node_maps._id_to_desc = id_to_desc  # type: ignore[attr-defined]
    return name_to_id, id_to_name, id_to_file, screenid_to_id

def load_screen_node_id_map(nodes_json_path: pathlib.Path) -> Tuple[Dict[str, int], Dict[int, str]]:
    # Deprecated in favor of build_node_maps, keep for backward compat if referenced elsewhere
    name_to_id: Dict[str, int] = {}
    id_to_name: Dict[int, str] = {}
    nodes: List[Dict[str, Any]] = load_json(nodes_json_path)
    for n in nodes:
        try:
            nid = int(n.get('id'))
        except Exception:
            continue
        nm = str(n.get('name') or '')
        if nm:
            name_to_id[nm] = nid
            id_to_name[nid] = nm
    return name_to_id, id_to_name


def index_edges_by_source(links: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for l in links:
        s = str(l.get('source_screen_name') or '')
        out.setdefault(s, []).append(l)
    return out


def build_alias_to_id(nodes_json_path: pathlib.Path) -> Dict[str, int]:
    alias_to_id: Dict[str, int] = {}
    nodes: List[Dict[str, Any]] = load_json(nodes_json_path)
    for n in nodes:
        try:
            nid = int(n.get('id'))
        except Exception:
            continue
        fn = str(n.get('file') or '')
        if not fn:
            continue
        base = fn[:-4] if fn.lower().endswith('.png') else fn
        parts = base.split('__', 1)
        frame_part = parts[1] if len(parts) > 1 else base
        if '__' in frame_part:
            frame_part = frame_part.split('__', 1)[0]
        alias_to_id[normalize(frame_part)] = nid
    return alias_to_id


def index_edges_by_source_id(links: List[Dict[str, Any]], alias_to_id: Dict[str, int], screenid_to_id: Dict[str, int], name_to_id: Dict[str, int]) -> Dict[int, List[Dict[str, Any]]]:
    out: Dict[int, List[Dict[str, Any]]] = {}
    for l in links:
        # Resolve source id
        src_id = l.get('screen_node_id') if isinstance(l.get('screen_node_id'), int) else None
        if not isinstance(src_id, int):
            src_id = screenid_to_id.get(str(l.get('source_screen_id') or ''))
        if not isinstance(src_id, int):
            src_name = str(l.get('source_screen_name') or '')
            src_id = name_to_id.get(src_name) or alias_to_id.get(normalize(src_name))
        if not isinstance(src_id, int):
            continue
        # Resolve destination id
        dest_id = l.get('dest_node_id') if isinstance(l.get('dest_node_id'), int) else None
        if not isinstance(dest_id, int):
            dest_id = screenid_to_id.get(str(l.get('destination_screen_id') or ''))
        if not isinstance(dest_id, int):
            dest_name = str(l.get('destination_screen_name') or '')
            dest_id = name_to_id.get(dest_name) or alias_to_id.get(normalize(dest_name))
        # Attach computed dest id for convenience
        l2 = dict(l)
        l2['_dest_id'] = dest_id
        out.setdefault(src_id, []).append(l2)
    return out


def find_screen_image(screens_dir: pathlib.Path, screen_name: str) -> Optional[pathlib.Path]:
    target = normalize(screen_name)
    if not screens_dir.exists():
        return None
    best: Optional[pathlib.Path] = None
    for p in sorted(screens_dir.glob('*.png')):
        base = p.stem
        parts = base.split('__', 1)
        candidate = normalize(parts[1] if len(parts) > 1 else base)
        if candidate == target:
            return p
        if target and target in candidate and best is None:
            best = p
    return best


def image_path_by_id(screens_dir: pathlib.Path, screen_id: Optional[int], id_to_file: Dict[int, str]) -> Optional[pathlib.Path]:
    if not isinstance(screen_id, int) or not screens_dir.exists():
        return None
    fn = id_to_file.get(screen_id)
    if not fn:
        return None
    p = screens_dir / fn
    return p if p.exists() else None


STOPWORDS = set(
    "the a an to of for and or is are be been was were it this that with on in into from by at as you your my our their we".split()
)


def tokenize(s: str) -> List[str]:
    return [w for w in re.findall(r"[a-zA-Z0-9']+", (s or '').lower()) if w and w not in STOPWORDS]


def score_edge(goal: str, edge: Dict[str, Any], target_id: Optional[int] = None, distances: Optional[Dict[int, int]] = None, visited_recent: Optional[List[int]] = None, persona_scales: Optional[Dict[str, float]] = None) -> float:
    # Simple keyword overlap scoring across user_intent, click_target, and destination description
    goal_toks = set(tokenize(goal))
    fields = [
        str(edge.get('user_intent') or ''),
        str(edge.get('click_target') or ''),
        str(edge.get('destination_screen_description') or ''),
        str(edge.get('destination_screen_name') or ''),
    ]
    edge_toks = set()
    for f in fields:
        edge_toks.update(tokenize(f))
    overlap = goal_toks.intersection(edge_toks)
    score = float(len(overlap))
    # Optional light bonus for generic CTA language
    generic_cta = {'continue','next','submit','confirm','proceed','start','finish','done','ok','go','open'}
    if edge_toks.intersection(generic_cta):
        score += 0.3
    # Persona scales
    ps = persona_scales or {'direct_scale': 1.0, 'back_scale': 1.0, 'distance_scale': 1.0}
    # Penalize back/return/close actions when pursuing a goal
    back_tokens = {'back', 'return', 'close', 'cancel'}
    if any(bt in edge_toks for bt in back_tokens):
        score -= 6.0 * ps['back_scale']
    # Strongly prefer direct transition to the target id if known
    if target_id is not None:
        dest_id = edge.get('_dest_id') if isinstance(edge.get('_dest_id'), int) else None
        if dest_id == int(target_id):
            score += 100.0 * ps['direct_scale']
        # Prefer edges that reduce estimated distance to target
        if distances and isinstance(dest_id, int):
            d = distances.get(dest_id)
            if isinstance(d, int):
                score += ps['distance_scale'] * max(0.0, 40.0 - 10.0 * d)
    # Penalize revisiting recent nodes to avoid loops
    if visited_recent:
        dest_id = edge.get('_dest_id') if isinstance(edge.get('_dest_id'), int) else None
        if isinstance(dest_id, int):
            if dest_id in visited_recent[-2:]:
                score -= 8.0
            elif dest_id in visited_recent:
                score -= 4.0
    return score


def choose_edge(goal: str, edges: List[Dict[str, Any]], target_id: Optional[int] = None, distances: Optional[Dict[int, int]] = None, visited_recent: Optional[List[int]] = None, persona_scales: Optional[Dict[str, float]] = None) -> Tuple[Optional[Dict[str, Any]], List[Tuple[Dict[str, Any], float]]]:
    ranked: List[Tuple[Dict[str, Any], float]] = []
    for e in edges:
        ranked.append((e, score_edge(goal, e, target_id, distances, visited_recent, persona_scales)))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return (ranked[0][0] if ranked else None), ranked


def compute_distances_to_target(edges_by_source_id: Dict[int, List[Dict[str, Any]]], start_ids: List[int], target_id: Optional[int]) -> Dict[int, int]:
    if target_id is None:
        return {}
    # Build reverse adjacency for BFS from target
    rev: Dict[int, List[int]] = {}
    for src, arr in edges_by_source_id.items():
        for e in arr:
            did = e.get('_dest_id') if isinstance(e.get('_dest_id'), int) else None
            if isinstance(did, int):
                rev.setdefault(did, []).append(src)
    from collections import deque
    dist: Dict[int, int] = {int(target_id): 0}
    dq = deque([int(target_id)])
    while dq:
        u = dq.popleft()
        for v in rev.get(u, []):
            if v not in dist:
                dist[v] = dist[u] + 1
                dq.append(v)
    return dist


def find_screen_name_match(candidates: List[str], query: str) -> Optional[str]:
    qn = normalize(query)
    best = None
    best_len = 0
    for c in candidates:
        cn = normalize(c)
        if qn == cn:
            return c
        if qn and qn in cn and len(cn) > best_len:
            best = c
            best_len = len(cn)
    return best


WAIT_KEYWORDS = { 'wait', 'waiting', 'auto', 'automatically', 'loading', 'timer', 'delay' }


def is_wait_edge(edge: Dict[str, Any]) -> bool:
    text = f"{edge.get('click_target') or ''} {edge.get('user_intent') or ''} {edge.get('source_element_name') or ''} {edge.get('destination_screen_name') or ''}"
    toks = set(tokenize(text))
    return any(w in toks for w in WAIT_KEYWORDS)


# ------------------------
# Emotion instrumentation
# ------------------------
def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo


def init_emotion_state(persona: Optional[Dict[str, Any]]) -> Dict[str, float]:
    base = {
        'valence': 0.2,
        'arousal': 0.5,
        'stress': 0.2,
        'frustration': 0.1,
        'confidence': 0.5,
    }
    if not persona:
        return base
    po = extract_ocean(persona)
    # High N → higher baseline stress; High C → higher baseline confidence
    base['stress'] = clamp(0.15 + 0.6 * po.get('N', 0.0), 0.0, 1.0)
    base['confidence'] = clamp(0.45 + 0.3 * po.get('C', 0.0) - 0.2 * po.get('N', 0.0), 0.0, 1.0)
    base['valence'] = clamp(0.25 + 0.2 * (po.get('E', 0.0) - po.get('N', 0.0)), -1.0, 1.0)
    return base


def label_emotion(state: Dict[str, float]) -> str:
    v, a, s, f, c = (state.get('valence', 0.0), state.get('arousal', 0.0), state.get('stress', 0.0), state.get('frustration', 0.0), state.get('confidence', 0.0))
    if f >= 0.6 or s >= 0.6:
        return 'Stressed'
    if v >= 0.4 and c >= 0.6:
        return 'Confident'
    if a >= 0.6 and f <= 0.3 and s <= 0.4:
        return 'Focused'
    if v <= -0.2 and f >= 0.4:
        return 'Frustrated'
    return 'Neutral'


def update_emotion(state: Dict[str, float], *, wait_s: float, options_count: int, clarity_gap: float, reduces_distance: bool, auto_wait: bool, persona: Optional[Dict[str, Any]]) -> Dict[str, float]:
    # Decay existing state slightly, then apply deltas from signals
    new = {
        'valence': state.get('valence', 0.0) * 0.88,
        'arousal': state.get('arousal', 0.0) * 0.88,
        'stress': state.get('stress', 0.0) * 0.88,
        'frustration': state.get('frustration', 0.0) * 0.88,
        'confidence': state.get('confidence', 0.0) * 0.90,
    }
    po = extract_ocean(persona) if persona else {'N': 0.5, 'O': 0.5, 'C': 0.5}
    # Waiting increases arousal/stress esp. for high N
    if wait_s >= 3.0:
        w = min(1.0, (wait_s - 2.0) / 4.0)
        new['arousal'] += 0.25 * w
        new['stress'] += (0.15 + 0.35 * po.get('N', 0.5)) * w
    # Many options or unclear ranking → frustration
    if options_count >= 6:
        new['frustration'] += 0.15 + 0.15 * po.get('O', 0.5)
    if clarity_gap < 0.5:
        new['frustration'] += 0.12
    # Auto-advance without action → stress/frustration
    if auto_wait:
        new['stress'] += 0.12
        new['frustration'] += 0.08
    # Clear progress signal → confidence/valence up, stress down
    if reduces_distance:
        new['confidence'] += 0.18
        new['valence'] += 0.12
        new['stress'] -= 0.10
        new['frustration'] -= 0.06

    # Clamp ranges
    new['valence'] = clamp(new['valence'], -1.0, 1.0)
    for k in ['arousal', 'stress', 'frustration', 'confidence']:
        new[k] = clamp(new[k], 0.0, 1.0)
    return new


def compute_dynamic_wait_seconds(*, base: float, screen_desc: str, options_count: int, clarity_gap: float, emotion: Dict[str, float], persona: Optional[Dict[str, Any]], auto_wait: bool) -> float:
    """Compute a realistic, variable wait time influenced by screen complexity, clarity, emotion, and traits."""
    po = extract_ocean(persona) if persona else {}
    v = emotion.get('valence', 0.0); a = emotion.get('arousal', 0.0); s = emotion.get('stress', 0.0); f = emotion.get('frustration', 0.0)
    wait = base
    # Screen complexity heuristics
    desc = (screen_desc or '').lower()
    if any(w in desc for w in ['loading','skeleton','processing','fetching']):
        wait += 0.6  # user tends to pause on loading
    if options_count >= 6:
        wait += 0.8  # more options → more deliberation
    elif options_count >= 3:
        wait += 0.3
    # Clarity gap (top vs second option)
    if clarity_gap >= 2.0:
        wait -= 0.4  # very clear choice
    elif clarity_gap <= 0.3:
        wait += 0.5  # ambiguous choice
    # Emotion effects
    wait += 0.4 * max(0.0, f - 0.3)  # frustration increases pause
    wait += 0.3 * max(0.0, s - 0.3)
    wait -= 0.3 * max(0.0, v - 0.4)  # positive valence speeds up
    # Persona traits
    wait -= 0.3 * max(0.0, po.get('C',0.0) - 0.6)  # conscientious reduces dithering
    wait += 0.3 * max(0.0, po.get('O',0.0) - 0.6)  # openness explores more
    wait += 0.4 * max(0.0, po.get('N',0.0) - 0.6)  # neuroticism increases hesitation
    # Auto/wait edges: keep short but non-zero
    if auto_wait:
        wait = min(wait, 2.0)
        wait = max(wait, 0.6)
    # Clamp reasonable bounds
    return max(0.4, min(6.0, round(wait, 2)))

def generate_diverse_thought(available_actions, persona, event):
    """Generate diverse, persona-aware thoughts based on available actions and user context."""
    import random
    
    if not available_actions:
        return None
    
    action_count = len(available_actions)
    screen_name = event.get('screen', 'this screen')
    goal = event.get('goal', 'my task')
    
    # Extract persona traits for more realistic thoughts
    persona_traits = {}
    if persona:
        persona_traits = {
            'ocean': extract_ocean(persona),
            'age': persona.get('age', 30),
            'experience': persona.get('experience_level', 'mid'),
            'risk_appetite': persona.get('risk_appetite', 'medium'),
            'communication_style': persona.get('communication_style', 'direct')
        }
    
    # Generate thoughts based on context and persona
    thought_templates = []
    
    # Single clear path thoughts
    if action_count == 1:
        action = available_actions[0]
        destination = action.get('to', 'the next step')
        
        thought_templates = [
            f"I can see exactly what to do next - {destination} looks like the right choice.",
            f"This is straightforward - I'll go to {destination} to continue {goal}.",
            f"Perfect, there's only one way forward to {destination}.",
            f"I'm confident about this next step to {destination}.",
            f"Clear path ahead to {destination} - this should be quick."
        ]
        
        # Add persona-specific variations
        if persona_traits.get('ocean', {}).get('C', 0) > 0.6:  # High conscientiousness
            thought_templates.append(f"I like having a clear, structured path to {destination}.")
        if persona_traits.get('ocean', {}).get('N', 0) > 0.6:  # High neuroticism
            thought_templates.append(f"Good, there's only one option - I don't have to worry about choosing wrong.")
    
    # Multiple options thoughts
    elif action_count <= 3:
        destinations = [action.get('to', 'option') for action in available_actions[:3]]
        
        destinations_str = ', '.join(destinations[:2])
        if len(destinations) > 2:
            destinations_str += ' and more'
        
        thought_templates = [
            f"I have a few options here: {destinations_str}.",
            f"Let me think about these {action_count} choices to find the best path for {goal}.",
            f"I need to pick the right option from these {action_count} choices.",
            f"Which of these {action_count} options will help me {goal} most effectively?",
            f"I have {action_count} good options to choose from - let me pick the most relevant one."
        ]
        
        # Add persona-specific variations
        if persona_traits.get('ocean', {}).get('O', 0) > 0.6:  # High openness
            thought_templates.append(f"Interesting, I have {action_count} different paths to explore.")
        if persona_traits.get('risk_appetite') == 'low':
            thought_templates.append(f"I need to be careful choosing from these {action_count} options.")
    
    # Many options thoughts
    else:
        thought_templates = [
            f"Wow, there are {action_count} different ways I could go from here.",
            f"This is overwhelming - {action_count} options to choose from for {goal}.",
            f"I have too many choices here - {action_count} different paths to consider.",
            f"This is complex - I need to figure out which of these {action_count} options is best.",
            f"Lots of possibilities here - {action_count} different directions I could take."
        ]
        
        # Add persona-specific variations
        if persona_traits.get('ocean', {}).get('N', 0) > 0.6:  # High neuroticism
            thought_templates.append(f"This is stressful - {action_count} options and I don't want to pick wrong.")
        if persona_traits.get('experience') == 'junior':
            thought_templates.append(f"As someone new to this, {action_count} options feels like a lot to handle.")
    
    # Add context-specific thoughts
    if 'complete' in goal.lower() or 'finish' in goal.lower():
        thought_templates.append(f"I'm getting close to completing {goal} - need to choose carefully.")
    if 'order' in goal.lower() or 'purchase' in goal.lower():
        thought_templates.append(f"I want to make sure I complete this {goal} correctly.")
    
    # Add screen-specific thoughts
    if 'login' in screen_name.lower() or 'auth' in screen_name.lower():
        thought_templates.append("I need to get past this authentication step to continue.")
    if 'payment' in screen_name.lower() or 'checkout' in screen_name.lower():
        thought_templates.append("I need to be careful with payment details - this is important.")
    if 'error' in screen_name.lower() or 'problem' in screen_name.lower():
        thought_templates.append("Something went wrong - I need to figure out how to fix this.")
    
    # Select a random thought from templates
    if thought_templates:
        return random.choice(thought_templates)
    
    return None


# ------------------------
# TEA + UX Audit helpers
# ------------------------
def format_tea_block(step_idx: int, screen_name: str, *, emotion_label: str, emotion_reason: str, wait_seconds: float,
                     intent_text: str, action_text: str, dest_name: str, reflection_text: Optional[str]) -> str:
    """Render a TEA-style block for the transcript."""
    hesitation = bool(wait_seconds and wait_seconds >= 2.5)
    hesitation_note = f"pauses {wait_seconds:.1f} seconds — reflecting on options"
    internal_q = f"Will this action get me closer to '{dest_name}' efficiently?"
    outcome = f"User proceeds with '{action_text}'; advancing to {dest_name}"
    reflection = reflection_text or "Proceeding but watching for clarity and next-step cues."
    lines = []
    lines.append(f"### === TEA LOG ({step_idx}) ===\n")
    lines.append(f"[{screen_name}] {intent_text if intent_text else 'I will act purposefully toward my goal.'}\n\n")
    reason = (emotion_reason or 'evaluating next step').strip()
    lines.append(f" emotion: {emotion_label} (reason: {reason}) | hesitation: {str(hesitation)}\n\n")
    lines.append(f" hesitation note: {hesitation_note}\n\n")
    lines.append(f" internal question: {internal_q}\n\n")
    lines.append(f" action: {action_text}\n\n")
    lines.append(f" outcome: {outcome}\n\n")
    lines.append(f" reflection: {reflection}\n\n\n")
    return ''.join(lines)


def map_friction_to_ux_issue(screen_name: str, fp: Dict[str, Any]) -> Dict[str, Any]:
    ftype = str(fp.get('type') or '')
    issue: Dict[str, Any] = {
        'screen': screen_name,
        'problem': fp.get('description') or ftype,
        'heuristic': '',
        'recommendation': ''
    }
    if ftype == 'auto_wait':
        issue['heuristic'] = 'Visibility of system status'
        issue['recommendation'] = 'Show explicit progress/auto-advance indicator or add a Continue/Next CTA.'
    elif ftype == 'back_or_close':
        issue['heuristic'] = 'User control and freedom'
        issue['recommendation'] = 'Strengthen and prioritize the primary CTA to reduce detours/back actions.'
    elif ftype == 'loop_detected':
        issue['heuristic'] = 'Consistency and standards'
        issue['recommendation'] = 'Clarify navigation hierarchy and avoid ambiguous links to prevent loops.'
    elif ftype == 'choice_overload_persona':
        issue['heuristic'] = 'Aesthetic and minimalist design'
        issue['recommendation'] = 'Reduce parallel choices; visually emphasize the primary next step.'
    elif ftype == 'unclear_primary_cta_persona':
        issue['heuristic'] = 'Visibility of system status'
        issue['recommendation'] = "Make the primary CTA explicit (e.g., 'Continue', 'Checkout') and dominant."
    elif ftype == 'anxiety_wait_persona':
        issue['heuristic'] = 'Visibility of system status'
        issue['recommendation'] = 'Provide feedback during waits (countdown, skeleton, or progress bar).'
    elif ftype == 'too_many_steps_persona':
        issue['heuristic'] = 'Flexibility and efficiency of use'
        issue['recommendation'] = 'Shorten the critical path or add step indicators/checkpoints.'
    elif ftype == 'resistance_to_prompts_persona':
        issue['heuristic'] = 'User control and freedom'
        issue['recommendation'] = 'Minimize confirmations/permissions; batch prompts and explain benefits.'
    else:
        issue['heuristic'] = 'General usability'
        issue['recommendation'] = 'Clarify next steps and provide feedback to support task progress.'
    return issue


def describe_emotion(label: str, state: Dict[str, float], persona: Optional[Dict[str, Any]]) -> str:
    """Return a short, descriptive emotion rationale based on current state and persona."""
    v = state.get('valence', 0.0); a = state.get('arousal', 0.0); s = state.get('stress', 0.0); f = state.get('frustration', 0.0); c = state.get('confidence', 0.0)
    po = extract_ocean(persona) if persona else {}
    bits: List[str] = []
    if label == 'Confident':
        bits.append('clear next steps and stable progress')
    elif label == 'Focused':
        bits.append('decisive option stands out with minimal distraction')
    elif label == 'Stressed':
        bits.append('uncertainty or waits raise tension')
    elif label == 'Frustrated':
        bits.append('detours or mismatched expectations')
    else:
        bits.append('neutral evaluation in progress')
    if po.get('C',0)>=0.7:
        bits.append('prefers structure')
    if po.get('O',0)>=0.7:
        bits.append('curiosity encourages exploration')
    if po.get('N',0)>=0.7:
        bits.append('sensitive to ambiguity')
    return f"{label}: {', '.join(bits)} (valence {v:+.2f}, arousal {a:.2f}, stress {s:.2f}, frustration {f:.2f}, confidence {c:.2f})"


# ------------------------
# Enriched narrative builders (deterministic variety)
# ------------------------
def stable_choice(options: List[str], key: str) -> str:
    if not options:
        return ''
    try:
        import hashlib
        h = hashlib.md5(key.encode('utf-8')).hexdigest()
        idx = int(h[:8], 16) % len(options)
        return options[idx]
    except Exception:
        return options[0]


def detect_archetype(screen_name: str, screen_desc: str) -> str:
    s = (screen_name or '').lower() + ' ' + (screen_desc or '').lower()
    if 'home' in s:
        return 'home'
    if 'search results' in s or 'results' in s:
        return 'results'
    if 'search' in s:
        return 'search'
    if 'product details' in s or 'details' in s:
        return 'details'
    if 'cart' in s:
        return 'cart'
    if 'payment' in s or 'checkout' in s:
        return 'payment'
    if 'wishlist' in s or 'favorite' in s:
        return 'wishlist'
    if 'category' in s or 'bestseller' in s:
        return 'browse'
    return 'generic'


def summarize_click_target(click_text: str, default: str = 'Tap primary action') -> str:
    t = (click_text or '').strip()
    tl = t.lower()
    if not t:
        return default
    if 'add' in tl and 'cart' in tl:
        return "Taps 'Add to Cart' button"
    if 'checkout' in tl or 'payment' in tl:
        return "Taps 'Checkout'"
    if 'search' in tl and 'bar' in tl:
        return "Taps search bar"
    if 'back' in tl or 'chevron' in tl or 'top-left' in tl:
        return "Taps back arrow"
    if 'price comparison' in tl:
        return "Taps 'Price comparison'"
    if 'get started' in tl:
        return "Taps 'Get started'"
    # fallback: compress first clause
    words = t.split()
    return ' '.join(words[:8]) + ('…' if len(words) > 8 else '')


def build_enriched_intention(screen_name: str, screen_desc: str, goal: str, persona: Optional[Dict[str, Any]], archetype: str, step_idx: int) -> str:
    po = extract_ocean(persona) if persona else {}
    trait = []
    if po.get('C',0)>=0.7: trait.append('prefer clear, structured steps')
    if po.get('O',0)>=0.7: trait.append('stay open to exploring but keep progress in mind')
    if po.get('N',0)>=0.7: trait.append('avoid uncertainty and hidden interactions')
    if po.get('E',1)<=0.3: trait.append('prefer to figure things out independently')
    trait_tail = (" ("+"; ".join(trait)+")") if trait else ''
    key = f"{screen_name}|{archetype}|{step_idx}"
    intros = {
        'home': [
            f"I'll scan the starting screen and choose the most direct path toward my goal: {goal}.",
            f"I'll orient myself and pick the clearest entry point that advances {goal}.",
        ],
        'search': [
            f"I'll activate search to quickly narrow down choices relevant to {goal}.",
            f"I'll focus the search field and type a precise query to progress {goal}.",
        ],
        'results': [
            f"I'll open the most relevant result that moves me closer to {goal}.",
            f"I'll scan the grid and tap a likely candidate aligned with {goal}.",
        ],
        'details': [
            f"I'll review the product details and use the primary CTA to advance {goal}.",
            f"I'll confirm the essentials and press the main action to progress {goal}.",
        ],
        'cart': [
            f"I'll verify the cart and take the next step that advances {goal}.",
            f"I'll sanity-check quantities and proceed with the main next action toward {goal}.",
        ],
        'payment': [
            f"I'll complete the required inputs and continue to finish {goal}.",
            f"I'll provide essentials and progress through payment to finalize {goal}.",
        ],
        'wishlist': [
            f"I'll review saved items and act on the one most relevant to {goal}.",
        ],
        'browse': [
            f"I'll scan categories and choose the segment that shortens the path to {goal}.",
        ],
        'generic': [
            f"I'll identify the most intuitive control and use it to advance {goal}.",
        ],
    }
    return stable_choice(intros.get(archetype, intros['generic']), key) + trait_tail


def build_enriched_result(edge: Optional[Dict[str, Any]], archetype: str, step_idx: int) -> str:
    if not edge:
        return "Not found (no matching link). Revealing options…"
    ct = (edge.get('click_target') or '')
    action = summarize_click_target(ct)
    # Add small variety
    key = f"{archetype}|{step_idx}|{action}"
    variants = [
        action,
        action.replace('Taps', 'Clicks') if action.startswith('Taps') else action,
    ]
    return stable_choice(variants, key)


def build_tea_header(screen_name: str, screen_desc: str, archetype: str, options_brief: List[Dict[str, Any]], step_idx: int) -> str:
    # Use screen description and one or two option labels to sound observational
    labels = [ (ob.get('label') or '').split('—')[0].strip() for ob in options_brief[:2] ] if options_brief else []
    mention = ', '.join([l for l in labels if l])
    base_obs = {
        'home': [f"First screen. Orienting; primary navigation is visible. {('Options include ' + mention) if mention else ''}"],
        'search': [f"Search UI visible. Ready to type. {('I notice ' + mention) if mention else ''}"],
        'results': [f"Results grid present. Scanning for a suitable item. {('Top actions: ' + mention) if mention else ''}"],
        'details': [f"Product page with price/specs. Evaluating CTAs. {('I see ' + mention) if mention else ''}"],
        'cart': [f"Cart summary visible; totals and CTAs at bottom. {('Actions: ' + mention) if mention else ''}"],
        'payment': ["Payment flow; form fields and progress affordances."],
        'wishlist': ["Wishlist page; saved items or an empty state."],
        'browse': ["Browse categories; curated lists suggest next hops."],
        'generic': ["Screen loaded; scanning affordances before acting."],
    }
    key = f"{screen_name}|{archetype}|{step_idx}"
    return stable_choice(base_obs.get(archetype, base_obs['generic']), key)


class SessionState:
    def __init__(self) -> None:
        self.history: List[int] = []
        self.goal_progress: float = 0.0
        self.loop_count: int = 0
        self.prev_confidence: float = 0.4
        self.emotion_hint: str = ''

    def record(self, screen_id: int) -> None:
        self.history.append(screen_id)
        if len(self.history) >= 4 and len(set(self.history[-4:])) <= 2:
            self.loop_count += 1


def generate_reflection(state: SessionState) -> str:
    if state.loop_count > 2:
        return "Feels like I'm going in circles — wishlist option might be missing or unclear."
    if state.goal_progress >= 0.8:
        return "I’m close to the goal; just need a clear ‘Add to Wishlist’ affordance."
    if state.goal_progress <= 0.1 and state.loop_count >= 1:
        return "Progress stalls; this path doesn’t match my intent to save items."
    return "Still exploring, trying to make steady progress toward the goal."


def generate_ux_summary(screen_name: str, state: SessionState) -> Dict[str, str]:
    if state.loop_count > 1:
        return {
            'friction': f"Looping between screens; unclear path on '{screen_name}'.",
            'heuristic': 'User control and freedom',
            'recommendation': f"Add clearer exit or alternative action (e.g., visible 'Wishlist') on '{screen_name}'.",
        }
    if state.goal_progress < 0.2:
        return {
            'friction': 'Ambiguous primary action relative to goal',
            'heuristic': 'Match between system and the real world',
            'recommendation': "Label action aligned to user intent (e.g., 'Add to Wishlist').",
        }
    return {
        'positive': 'Clear CTA and predictable outcome',
        'heuristic': 'Visibility of system status',
        'recommendation': '',
    }


def render_tea_block_full(
    *,
    tea_idx: int,
    screen_name: str,
    screen_id: int,
    goal: str,
    persona: Optional[Dict[str, Any]],
    image_name: str,
    # metadata
    time_spent: float,
    interaction_type: str,
    goal_progress: float,
    loop_detected: bool,
    confidence_delta: float,
    friction_score: float,
    perception_text: str,
    interpretation_text: str,
    observed_ux_notes: List[str],
    pre_emotion_label: str,
    pre_emotion_state: Dict[str, float],
    internal_thought: str,
    first_decision_thought: str,
    expected_action_text: str,
    hesitation_seconds: float,
    first_action_performed: Optional[str],
    first_outcome_to: Optional[str],
    first_immediate_emotion: Optional[str],
    first_immediate_reaction: Optional[str],
    ux_feedback_during: List[str],
    reflection_text: str,
    mismatch_observation: Optional[str],
    mismatch_emotion: Optional[str],
    mismatch_ux_defect: Optional[str],
    options_brief: List[Dict[str, Any]],
    second_decision_thought: Optional[str],
    second_action_text: Optional[str],
    second_outcome_to: Optional[str],
    second_emotion: Optional[str],
    friction_points_mapped: List[Dict[str, Any]],
    positive_moments: List[str],
    suggestions: List[str],
) -> str:
    po = extract_ocean(persona) if persona else {}
    persona_bits = f"O={po.get('O',0):.2f} C={po.get('C',0):.2f} E={po.get('E',0):.2f} A={po.get('A',0):.2f} N={po.get('N',0):.2f}"
    v = pre_emotion_state.get('valence', 0.0)
    a = pre_emotion_state.get('arousal', 0.0)
    c = pre_emotion_state.get('confidence', 0.0)
    s = pre_emotion_state.get('stress', 0.0)
    f = pre_emotion_state.get('frustration', 0.0)
    hes = hesitation_seconds >= 2.5
    # Compose
    lines: List[str] = []
    lines.append(f"### === TEA LOG ({tea_idx}) ===\n")
    lines.append(f"Screen: {screen_name} (id={screen_id})\n")
    lines.append(f"Goal: {goal}\n")
    # compact metadata line
    lines.append(
        f"time_spent: {time_spent:.1f}s | interaction: {interaction_type} | goal_progress: {goal_progress:.2f} | loop_detected: {str(loop_detected)} | confidence_delta: {confidence_delta:+.2f} | friction_score: {friction_score:.2f}\n"
    )
    if persona:
        lines.append(f"Persona: {persona.get('name')} | OCEAN {persona_bits}\n")
    if image_name:
        lines.append(f"Image: {image_name}\n\n")

    # 1) Observation
    lines.append("1️⃣ Observation (Before Any Action)\n\n")
    if perception_text:
        lines.append(f"Perception: {perception_text}\n\n")
    if interpretation_text:
        lines.append(f"Interpretation: {interpretation_text}\n\n")
    if observed_ux_notes:
        lines.append("UX Audit (Observed):\n")
        for n in observed_ux_notes[:6]:
            lines.append(f"- {n}\n")
        lines.append("\n")
    lines.append(f"Emotion: {pre_emotion_label}\n\n")
    lines.append(f"Cognitive State: valence {v:+.2f}, arousal {a:.2f}, confidence {c:.2f}, stress {s:.2f}, frustration {f:.2f}\n\n")
    if internal_thought:
        lines.append(f"Internal Thought: {internal_thought}\n\n")

    # 2) First Action Decision
    lines.append("2️⃣ First Action Decision (Before Knowing Links)\n\n")
    lines.append(f"Thought: {first_decision_thought}\n\n")
    if expected_action_text:
        lines.append(f"Expected Action: {expected_action_text}\n\n")
    lines.append(f"Emotion: {pre_emotion_label}\n\n")
    lines.append(f"Hesitation: {str(hes)} ({hesitation_seconds:.1f}s)\n\n")
    lines.append(f"Internal Question: Will this action move me forward efficiently?\n\n")

    # 3) First Actual Action (if any)
    if first_action_performed and first_outcome_to:
        lines.append("3️⃣ First Actual Action (If Link Exists)\n\n")
        lines.append(f"Action Performed: {first_action_performed}\n\n")
        lines.append(f"Outcome: Proceeds to {first_outcome_to}\n\n")
        if first_immediate_emotion:
            lines.append(f"Immediate Reaction: {first_immediate_emotion}\n\n")
        if ux_feedback_during:
            lines.append("UX Feedback (During Action):\n")
            for u in ux_feedback_during[:4]:
                lines.append(f"- {u}\n")
            lines.append("\n")
        if reflection_text:
            lines.append(f"Reflection: {reflection_text}\n\n")

    # 4) Action Mismatch
    if mismatch_observation:
        lines.append("4️⃣ Action Mismatch (If No Link Found)\n\n")
        lines.append(f"Observation: {mismatch_observation}\n\n")
        if mismatch_emotion:
            lines.append(f"Emotion: {mismatch_emotion}\n\n")
        if mismatch_ux_defect:
            lines.append(f"UX Defect: {mismatch_ux_defect}\n\n")
        lines.append("Note: Revealing available links and deciding again.\n\n")

    # 5) Second Action Decision
    if options_brief and second_decision_thought:
        lines.append("5️⃣ Second Action Decision (After Revealing Links)\n\n")
        lines.append("Available Options:\n")
        for ob in options_brief[:8]:
            lines.append(f"- linkId {ob.get('linkId')} → {ob.get('to')}\n")
        lines.append("\n")
        lines.append(f"Thought: {second_decision_thought}\n\n")
        if second_action_text:
            lines.append(f"Action: {second_action_text}\n\n")
        if second_outcome_to:
            lines.append(f"Outcome: Proceeds to {second_outcome_to}\n\n")
        if second_emotion:
            lines.append(f"Emotion: {second_emotion}\n\n")

    # 6) UX Summary (Per Screen)
    lines.append("6️⃣ UX Summary (Per Screen)\n\n")
    if friction_points_mapped:
        lines.append("Friction Points:\n")
        for m in friction_points_mapped[:6]:
            lines.append(f"- {m.get('problem','')} (heuristic: {m.get('heuristic','')})\n")
        lines.append("\n")
    if positive_moments:
        lines.append("Positive Moments:\n")
        for p in positive_moments[:4]:
            lines.append(f"- {p}\n")
        lines.append("\n")
    if suggestions:
        lines.append("Suggestions:\n")
        for sgg in suggestions[:6]:
            lines.append(f"- {sgg}\n")
        lines.append("\n")

    lines.append("\n")
    return ''.join(lines)


# ------------------------
# Condensed TEA generator (post-processing)
# ------------------------
def _parse_tea_blocks_from_transcript(transcript_path: pathlib.Path) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    if not transcript_path.exists():
        return blocks
    lines = transcript_path.read_text(encoding='utf-8').splitlines()
    i = 0
    current: Optional[Dict[str, Any]] = None
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith('### === TEA LOG'):
            if current:
                blocks.append(current)
            current = {
                'raw': [], 'Screen': '', 'Image': '', 'Goal': '',
                'Perception': '', 'Interpretation': '', 'Emotion': '', 'Cognitive': '',
                'Internal Thought': '', 'Thought': '', 'Expected Action': '', 'Hesitation': '',
                'Action Performed': '', 'Outcome': '', 'Immediate Reaction': '', 'Reflection': '',
                'Friction Points': [], 'Positive Moments': [], 'Suggestions': [],
                'meta': {}
            }
        if current is not None:
            current['raw'].append(lines[i])
            if line.startswith('Screen: '):
                current['Screen'] = line[len('Screen: '):]
            elif line.startswith('Image: '):
                current['Image'] = line[len('Image: '):]
            elif line.startswith('Goal: '):
                current['Goal'] = line[len('Goal: '):]
            elif line.startswith('time_spent:'):
                # Parse compact inline metadata line
                meta: Dict[str, Any] = {}
                try:
                    parts = [p.strip() for p in line.split('|')]
                    for p in parts:
                        if ':' in p:
                            k, v = p.split(':', 1)
                            meta[k.strip()] = v.strip()
                except Exception:
                    meta = {}
                current['meta'] = meta
            elif line.startswith('Perception: '):
                current['Perception'] = line[len('Perception: '):]
            elif line.startswith('Interpretation: '):
                current['Interpretation'] = line[len('Interpretation: '):]
            elif line.startswith('Emotion: '):
                # Prefer the first Emotion within Observation pre-action
                if not current['Emotion']:
                    current['Emotion'] = line[len('Emotion: '):]
            elif line.startswith('Cognitive State: '):
                current['Cognitive'] = line[len('Cognitive State: '):]
            elif line.startswith('Internal Thought: '):
                current['Internal Thought'] = line[len('Internal Thought: '):]
            elif line.startswith('Thought: '):
                current['Thought'] = line[len('Thought: '):]
            elif line.startswith('Expected Action: '):
                current['Expected Action'] = line[len('Expected Action: '):]
            elif line.startswith('Hesitation: '):
                current['Hesitation'] = line[len('Hesitation: '):]
            elif line.startswith('Action Performed: '):
                current['Action Performed'] = line[len('Action Performed: '):]
            elif line.startswith('Outcome: '):
                current['Outcome'] = line[len('Outcome: '):]
            elif line.startswith('Immediate Reaction: '):
                current['Immediate Reaction'] = line[len('Immediate Reaction: '):]
            elif line.startswith('Reflection: '):
                # prefer first reflection (post-action)
                if not current['Reflection']:
                    current['Reflection'] = line[len('Reflection: '):]
            elif line.startswith('- '):
                # Within UX Summary we may have bullets
                if 'heuristic:' in line or 'problem:' in line or 'recommendation:' in line or 'Friction Points' in line:
                    # handled later by simple copy of raw if needed
                    pass
                elif 'Friction Points:' in line:
                    pass
        i += 1
    if current:
        blocks.append(current)
    return blocks


def _label_from_emotion_text(text: str) -> str:
    tl = (text or '').lower()
    if 'frustrat' in tl:
        return 'Mild frustration' if 'mild' in tl else 'Frustration'
    if 'optim' in tl:
        return 'Cautious optimism'
    if 'focus' in tl:
        return 'Analytical focus'
    if 'satisf' in tl or 'goal' in tl:
        return 'Goal satisfaction'
    if 'curio' in tl:
        return 'Curiosity'
    return 'Neutral'


def write_smart_condensed_log(transcript_path: pathlib.Path, output_path: pathlib.Path) -> None:
    blocks = _parse_tea_blocks_from_transcript(transcript_path)
    out_lines: List[str] = []

    # Humanization helpers
    def voice(step: int, key: str) -> str:
        variants = ['Okay', 'Hmm', 'Alright then', 'Wait', 'That’s odd']
        return stable_choice(variants, f"{key}|{step}")

    def internal_question(screen_name: str, meta: Dict[str, Any]) -> str:
        arche = detect_archetype(screen_name or '', '')
        if arche == 'search':
            return 'Will typing here actually show results, or is this another dummy field?'
        if arche == 'details':
            return 'Where’s the wishlist or a save option on this page?'
        if arche == 'cart':
            return 'Do I really want to purchase now, or just save this for later?'
        if arche == 'payment':
            return 'Is there a way to review fees before committing?'
        return 'Is this the most direct step toward my goal?'

    def emotion_reason_for(label: str, screen_name: str, per: str, interp: str, loop_flag: bool) -> str:
        s = (screen_name or '').lower()
        if loop_flag:
            return 'repeating pages without obvious progress increases doubt about the path'
        if 'cart' in s:
            return 'weighing purchase flow against the goal of saving to wishlist'
        if 'details' in s:
            return 'wishlist affordance isn’t obvious; primary CTA pushes toward cart'
        if 'search' in s or 'results' in s:
            return 'scanning options to validate relevance before committing further'
        if 'payment' in s or 'checkout' in s:
            return 'cautious about costs and commitments before confirming'
        return 'orienting and evaluating the most credible next step'

    def extract_quotes(text: str) -> List[str]:
        quotes: List[str] = []
        try:
            import re
            for m in re.finditer(r"'([^']+)'|\"([^\"]+)\"", text or ''):
                grp = m.group(1) or m.group(2)
                if grp and len(grp) <= 80:
                    quotes.append(grp.strip())
        except Exception:
            pass
        return quotes[:3]

    def hesitation_note_for(screen_name: str, seconds: float) -> str:
        arche = detect_archetype(screen_name or '', '')
        if arche in ('payment', 'cart'):
            hint = 'checking for fees and commitments'
        elif arche in ('search', 'results'):
            hint = 'scanning options and relevancy'
        elif arche in ('details',):
            hint = 'looking for a non-purchase save option'
        else:
            hint = 'orienting to available actions'
        return f"{hint} (pauses {seconds:.1f} seconds)"

    def reflection_for(meta: Dict[str, Any], loop_flag: bool) -> str:
        gp = 0.0
        cd = 0.0
        try:
            gp_raw = str(meta.get('goal_progress', '0')).rstrip('%')
            gp = float(gp_raw)
            cd = float(str(meta.get('confidence_delta', '0')).replace('s','').replace('+',''))
        except Exception:
            pass
        if loop_flag:
            return "Feels like I’m circling — need a clearer way out."
        if cd < -0.01:
            return "Less sure now — the path isn’t matching expectations."
        if gp >= 0.8:
            return "Close to the goal; scanning for the final affordance."
        return "Continuing with focus on the clearest next cue."

    # Interjection for variation (~20%)
    def interjection(idx: int) -> str:
        options = ['Oh', 'Wait', 'Alright', 'Huh', 'This seems off', 'Okay then']
        # deterministic pseudo-random selection by idx
        return stable_choice(options, f"interj|{idx}")

    # Emotion state machine
    def next_emotion(prev: Optional[str], loop_flag: bool, goal_progress: float, idx: int, loop_streak: int) -> str:
        base = (prev or 'neutral').lower()
        # escalate on loops
        if loop_flag:
            if loop_streak >= 3:
                return 'frustrated'
            return 'mildly frustrated'
        # small cadence variation
        if idx % 7 == 0 and base == 'neutral':
            return 'curious'
        # progress de-escalates
        if goal_progress >= 0.15:
            return 'relieved' if base in ('mildly frustrated', 'curious') else base
        # otherwise gradual curiosity
        if base == 'neutral':
            return 'curious'
        return base

    def choose_reflection(emo: str, loop_flag: bool, default_text: str) -> str:
        if loop_flag:
            variants = [
                "I’m going in circles; the path isn’t obvious.",
                "Still looping — this is starting to get annoying.",
                "This is going nowhere; something’s off in the navigation.",
            ]
            return stable_choice(variants, f"refl|loop")
        emo = (emo or '').lower()
        pools = {
            'neutral': [
                "Still not sure if I’m doing it right.",
                "This took longer than I expected.",
                "Continuing, but I’d like clearer cues.",
                "Alright, moving on then.",
            ],
            'curious': [
                "Let’s see if this reveals what I need.",
                "Curious if I’m finally on the right track.",
                "Exploring, but watching for confirmation.",
                "I think this might be it, but not certain yet.",
            ],
            'mildly frustrated': [
                "This should be simpler; I’m getting a bit impatient.",
                "I keep searching for something that should be obvious.",
                "Not satisfied yet — the flow feels indirect.",
                "Feels like I’m trapped in a loop — it shouldn’t be this hard.",
            ],
            'frustrated': [
                "This is getting frustrating — I’m clearly stuck.",
                "Nothing new here; I need a different path.",
                "I’m going to stop if this doesn’t change soon.",
            ],
            'relieved': [
                "Finally, something that makes sense.",
                "Better — this looks more straightforward now.",
                "Feels closer to what I expected.",
            ],
        }
        choices = pools.get(emo, pools['neutral'])
        return stable_choice(choices, f"refl|{emo}") or default_text

    prev_obs_sig = ''
    loops = 0
    first_emo, last_emo = None, None
    avg_conf: List[float] = []

    prev_scr_1: Optional[str] = None
    prev_scr_2: Optional[str] = None
    osc_active = False
    osc_a: Optional[str] = None
    osc_b: Optional[str] = None
    osc_count = 0
    displayed_emo: Optional[str] = None
    emo_counts: Dict[str, int] = {}
    first_displayed_emo: Optional[str] = None
    last_displayed_emo: Optional[str] = None
    loop_streak = 0

    loop_segment_index = 0

    def flush_loop_segment(start_idx: int, end_idx: int, a: str, b: str):
        if not a or not b or end_idx < start_idx:
            return
        nonlocal loop_segment_index
        loop_segment_index += 1
        out_lines.append(f"### **=== TEA LOOP SEGMENT ({start_idx}–{end_idx}) ===**\n\n")
        out_lines.append(f"Looping between [{a}] and [{b}] repeatedly.\n")
        out_lines.append(" internal question: Why do these two pages keep sending me back to each other?\n\n")
        if loop_segment_index >= 3:
            out_lines.append(" emotion: frustrated (reason: repeated loop segments without progress)\n\n")
            out_lines.append(" reflection: This is going nowhere; I’m clearly stuck and need a different route.\n\n\n")
        else:
            out_lines.append(" emotion: mildly frustrated (reason: repeating the same two screens without progress)\n\n")
            out_lines.append(" reflection: I’m going in circles; the navigation isn’t revealing the next step.\n\n\n")

    loop_seg_start = 0

    for idx, b in enumerate(blocks, start=1):
        scr = b.get('Screen') or ''
        meta = b.get('meta') or {}
        per = b.get('Perception') or ''
        interp = b.get('Interpretation') or ''
        base_emo = _label_from_emotion_text(b.get('Emotion') or '')
        if first_emo is None:
            first_emo = base_emo
        last_emo = base_emo
        cog = b.get('Cognitive') or ''
        # parse confidence from cognitive, if present
        if cog:
            try:
                import re
                m = re.search(r"confidence\s+([0-9.+-]+)", cog)
                if m:
                    avg_conf.append(float(m.group(1)))
            except Exception:
                pass

        # detect loop for this screen
        loop_flag = str((meta.get('loop_detected') or '')).lower() == 'true'
        if loop_flag:
            loops += 1
            loop_streak += 1
        else:
            loop_streak = 0

        # Two-screen oscillation condensation
        # Detect pattern A -> B -> A oscillation
        if prev_scr_2 and prev_scr_1 and scr == prev_scr_2 and prev_scr_1 != prev_scr_2:
            # pattern A B A ... (prev_scr_2=A, prev_scr_1=B, scr=A)
            if not osc_active:
                osc_active = True
                osc_a, osc_b = prev_scr_2, prev_scr_1
                osc_count = 2  # already saw A B
                loop_seg_start = idx - 2
            osc_count += 1
            prev_scr_2, prev_scr_1 = prev_scr_1, scr
            # skip writing this step; we will flush when pattern breaks
            continue
        else:
            # if an oscillation was active and now broke, flush as a segment
            if osc_active and osc_a and osc_b:
                flush_loop_segment(loop_seg_start, idx - 1, osc_a, osc_b)
            osc_active = False
            osc_a = osc_b = None
            osc_count = 0

        # Header in gold-standard style
        out_lines.append(f"### **=== TEA LOG ({idx}) ===**\n\n")

        # First-person screen definition line with quotes
        quotes = extract_quotes(per)
        quote_text = ("; ".join([f"'{q}'" for q in quotes])) if quotes else ''
        obs_sig = (scr + '|' + per)[:160]
        intro_voice = voice(idx, 'obs')
        # Vary intro templates
        intro_templates = [
            "{v}, back here again. {d}",
            "{v}, this layout again. {d}",
            "{v}, first scan. {d}",
            "{v}, I expected to see something else here. {d}",
            "{v}, right — the main area. {d}",
            "{v}, let’s see what stands out. {d}",
        ]
        base_desc = interp or 'Orienting myself on this screen.'
        if quote_text:
            base_desc = f"{base_desc} I notice {quote_text}."
        chosen_intro = stable_choice(intro_templates, f"intro|{idx}")
        if obs_sig == prev_obs_sig:
            monologue = f"{intro_voice}, this looks familiar. {base_desc if base_desc else 'Scanning for a clearer cue.'}"
        else:
            monologue = chosen_intro.format(v=intro_voice, d=base_desc)
        prev_obs_sig = obs_sig
        out_lines.append(f"[{scr}] {monologue}\n\n")

        # Emotion with reason and hesitation
        # Hesitation parsing: expects e.g., 'True (2.4s)' or 'False (0.8s)'
        hes_line = b.get('Hesitation') or ''
        hes_bool = 'False'
        hes_secs = 0.0
        if hes_line:
            try:
                import re
                mb = re.search(r"^(True|False)", hes_line)
                if mb:
                    hes_bool = mb.group(1)
                ms = re.search(r"([0-9]+\.?[0-9]*)s", hes_line)
                if ms:
                    hes_secs = float(ms.group(1))
            except Exception:
                pass
        # emotion modulation based on progress and loops
        gp_val = 0.0
        try:
            gp_val = float(str(meta.get('goal_progress', '0')).rstrip('%'))
        except Exception:
            gp_val = 0.0
        displayed_emo = next_emotion(displayed_emo or (base_emo or 'neutral'), loop_flag, gp_val, idx, loop_streak)
        emo_counts[displayed_emo] = emo_counts.get(displayed_emo, 0) + 1
        if first_displayed_emo is None:
            first_displayed_emo = displayed_emo
        last_displayed_emo = displayed_emo
        reason_text = emotion_reason_for(displayed_emo, scr, per, interp, loop_flag)
        out_lines.append(f" emotion: {displayed_emo} (reason: {reason_text}) | hesitation: {hes_bool}\n\n")
        out_lines.append(f" hesitation note: {hesitation_note_for(scr, hes_secs)}\n\n")

        # Internal question
        iq = internal_question(scr, meta)
        # Occasionally prepend interjection
        if idx % 5 == 0:
            iq = f"{interjection(idx)}, {iq[0].lower() + iq[1:]}"
        out_lines.append(f" internal question: {iq}\n\n")

        # Action + outcome
        perf = b.get('Action Performed') or ''
        if perf:
            out_lines.append(f" action: {perf}\n\n")
        outc = b.get('Outcome') or ''
        if outc:
            out_lines.append(f" outcome: {outc}\n\n")

        # Reflection
        refl = b.get('Reflection') or ''
        if not refl:
            # choose reflection by emotion/loop
            refl = choose_reflection(displayed_emo or 'neutral', loop_flag, reflection_for(meta, loop_flag))
        if refl:
            out_lines.append(f" reflection: {refl}\n\n\n")

        # advance oscillation trackers
        prev_scr_2, prev_scr_1 = prev_scr_1, scr

    # Session summary
    if osc_active and osc_a and osc_b:
        # flush trailing loop segment if file ended mid-oscillation
        flush_loop_segment(loop_seg_start, len(blocks), osc_a, osc_b)
    out_lines.append("=== SESSION SUMMARY ===\n")
    out_lines.append(f"Total Screens: {len(blocks)}\n")
    if loops:
        out_lines.append(f"Loops Detected: {loops}\n")
    # Use displayed emotions for the path summary
    if first_displayed_emo and last_displayed_emo:
        out_lines.append(f"Emotion Path: {first_displayed_emo} → {last_displayed_emo}\n")
    if avg_conf:
        try:
            import statistics as _st
            out_lines.append(f"Average Confidence: {_st.mean(avg_conf):.2f}\n")
        except Exception:
            pass
    # Emotional highlights
    if emo_counts:
        frac = lambda k: emo_counts.get(k, 0)
        out_lines.append(
            f"Emotion Counts: neutral={frac('neutral')}, curious={frac('curious')}, mildly frustrated={frac('mildly frustrated')}, relieved={frac('relieved')}\n"
        )
    out_lines.append("Key Insight: Narrative enriched; monitor loops and discoverability of key actions.\n")

    try:
        output_path.write_text(''.join(out_lines), encoding='utf-8')
    except Exception:
        pass


# Utility: normalize transcript whitespace and spacing
def normalize_transcript_file(transcript_path: pathlib.Path) -> None:
    """Clean transcript formatting by removing trailing spaces, collapsing excessive
    blank lines, and ensuring a single final newline."""
    try:
        raw = transcript_path.read_text(encoding='utf-8')
    except Exception:
        return
    import re
    # Strip trailing spaces/tabs at line ends
    cleaned = re.sub(r'[ \t]+$', '', raw, flags=re.MULTILINE)
    # Collapse 3+ consecutive newlines to a single blank line
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    # Trim file ends and enforce single final newline
    cleaned = cleaned.strip() + '\n'
    try:
        transcript_path.write_text(cleaned, encoding='utf-8')
    except Exception:
        pass


# ------------------------
# Screen analysis + decision helpers (LLM stubs)
# ------------------------
def analyze_screen_llm(screen_name: str, screen_desc: str, persona: Optional[Dict[str, Any]], goal: str) -> Dict[str, Any]:
    """Stub: Analyze screen and produce TEA-style insights, UX notes, and an initial intent in natural language.
    In production, replace with an LLM call using image+text context.
    """
    po = extract_ocean(persona) if persona else {}
    traits = []
    if po.get('C',0)>=0.7: traits.append('structured')
    if po.get('O',0)>=0.7: traits.append('curious')
    if po.get('N',0)>=0.7: traits.append('risk-averse')
    if po.get('E',1)<=0.3: traits.append('self-guided')
    primary_intent = f"I will look for the most intuitive way to progress my goal: {goal}."
    if 'cart' in screen_desc.lower() or 'order' in screen_desc.lower():
        primary_intent = f"I'll review order details and choose the clearest action toward my goal: {goal}."
    ux_notes = []
    if 'loading' in screen_desc.lower():
        ux_notes.append('Auto/skeleton loading: add progress indicator or explicit continue affordance.')
    return {
        'traits': traits,
        'intent_nl': primary_intent,
        'ux_notes': ux_notes,
    }


def choose_action_blind(intent_nl: str, persona: Optional[Dict[str, Any]]) -> str:
    """Decide an action in natural language without seeing concrete links (blind first decision).
    Returns a rich, trait-biased description that builds on the intent text.
    """
    po = extract_ocean(persona) if persona else {}
    trait_bits: List[str] = []
    if po.get('C',0)>=0.7:
        trait_bits.append('I prefer clear, structured next steps')
    if po.get('O',0)>=0.7:
        trait_bits.append('I follow the most visually salient, meaningful affordance')
    if po.get('N',0)>=0.7:
        trait_bits.append('I avoid uncertain or hidden interactions')
    if po.get('E',1)<=0.3:
        trait_bits.append('I prefer to explore without too much hand-holding')
    trait_tail = (" (" + "; ".join(trait_bits) + ")") if trait_bits else ""
    base = intent_nl.strip() or 'I will act on the most intuitive control to progress.'
    # Expand with concrete action pattern without knowing links
    detail = ' I will locate the primary action area (button, prominent tile, or contextual control) that clearly advances my goal and use it.'
    return base + detail + trait_tail


def match_intent_to_edge(decision_text: str, edges: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Fuzzy match a natural-language decision to an available edge using token overlap across click_target/user_intent."""
    q = set(tokenize(decision_text))
    best = None
    best_score = -1
    for e in edges:
        fields = [str(e.get('click_target') or ''), str(e.get('user_intent') or ''), str(e.get('destination_screen_name') or '')]
        toks = set()
        for f in fields:
            toks.update(tokenize(f))
        sc = len(q.intersection(toks))
        if sc > best_score:
            best = e
            best_score = sc
    return best


def main():
    parser = argparse.ArgumentParser(description='Simulate user traversal over the graph to reach a target screen (supports persona-based runs)')
    parser.add_argument('--run-dir', default=None, help='Path to logs/run_* folder (defaults to latest)')
    parser.add_argument('--source', required=False, help='Source screen name (human)')
    parser.add_argument('--source-id', type=int, default=None, help='Source screen_nodes integer ID (preferred)')
    parser.add_argument('--target-name', default=None, help='Target screen name (human)')
    parser.add_argument('--target-id', type=int, default=None, help='Target screen_nodes integer ID (if known)')
    parser.add_argument('--goal', required=True, help='User goal description')
    parser.add_argument('--max-minutes', type=float, default=15.0, help='Max simulation time in minutes (default: 15)')
    parser.add_argument('--max-steps', type=int, default=50, help='Max steps (default: 50)')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--persona-json', default=str(ROOT / 'users' / 'users.json'), help='Path to personas JSON list')
    parser.add_argument('--persona-id', type=int, default=None, help='Single persona id to run; if omitted, no persona bias')
    parser.add_argument('--persona-folder-name', default=None, help='If set, place simulations under run_dir/<persona-folder-name>/simulations')
    parser.add_argument('--append', action='store_true', help='Append to existing simulations instead of purging the folder')
    parser.add_argument('--resolved-user-id', type=int, default=None, help='Concrete resolved user id for this simulation (if any)')
    parser.add_argument('--source-image', default=None, help='Path to source screen image (e.g., source.png)')
    parser.add_argument('--target-image', default=None, help='Path to target screen image (e.g., target.png)')
    parser.add_argument('--tea', dest='tea', action='store_true', default=True, help='Emit TEA logs per step in transcript and report (default: on)')
    parser.add_argument('--no-tea', dest='tea', action='store_false', help='Disable TEA logs')
    parser.add_argument('--ux-audit', dest='ux_audit', action='store_true', default=True, help='Include UX audit issues in report (default: on)')
    parser.add_argument('--no-ux-audit', dest='ux_audit', action='store_false', help='Disable UX audit issues')
    args = parser.parse_args()

    logs_dir = ROOT / 'logs'
    run_dir = pathlib.Path(args.run_dir) if args.run_dir else (list_run_dirs(logs_dir)[0] if list_run_dirs(logs_dir) else None)
    if not run_dir or not run_dir.exists():
        raise SystemExit('Could not resolve run-dir; please pass --run-dir')

    nodes_path = run_dir / 'preprocess' / 'screen_nodes.json'
    links_path = run_dir /  'preprocess' / 'prototype_links_enriched.json'
    screens_dir = run_dir /  'preprocess' / 'screens'

    if not nodes_path.exists() or not links_path.exists():
        raise SystemExit('Missing required run artifacts: screen_nodes.json and prototype_links_enriched.json')

    # Load artifacts
    name_to_id, id_to_name, id_to_file, screenid_to_id = build_node_maps(nodes_path)
    alias_to_id = build_alias_to_id(nodes_path)
    links: List[Dict[str, Any]] = load_json(links_path)
    edges_by_source_id = index_edges_by_source_id(links, alias_to_id, screenid_to_id, name_to_id)
    # Precompute image hashes for matching if needed
    id_to_hash: Dict[int, int] = {}
    if args.source_image or args.target_image:
        id_to_hash = build_id_to_hash_map(screens_dir, id_to_file)
    # Precompute heuristic distances to target to bias choices
    distances = compute_distances_to_target(edges_by_source_id, list(edges_by_source_id.keys()), args.target_id)

    # Collect all screen names present in edges
    screen_names = sorted({str(l.get('source_screen_name') or '') for l in links}.union({str(l.get('destination_screen_name') or '') for l in links}))

    # Resolve source
    source_name = find_screen_name_match(screen_names, args.source) if args.source else None
    # Resolve target
    target_name: Optional[str] = None
    if args.target_id is not None:
        target_name = id_to_name.get(int(args.target_id))
    if not target_name and args.target_name:
        target_name = find_screen_name_match(screen_names, args.target_name)
    if not target_name:
        # As a fallback, pick the best match to the goal terms among screen names
        target_name = find_screen_name_match(screen_names, args.target_name or '') or args.target_name or ''

    # Personas
    personas = load_personas(pathlib.Path(args.persona_json))
    if args.persona_id is not None:
        personas = [p for p in personas if int(p.get('id')) == int(args.persona_id)]
    if not personas:
        personas = [{}]  # anonymous default run

    # Optional single persona to influence decision-making
    persona: Optional[Dict[str, Any]] = None
    scales: Optional[Dict[str, float]] = None
    if args.persona_id is not None:
        ps = load_personas(pathlib.Path(args.persona_json))
        for p in ps:
            try:
                if int(p.get('id')) == int(args.persona_id):
                    persona = p
                    break
            except Exception:
                continue
        if persona:
            scales = compute_persona_scales(persona)

    # Build simulations root (purge previous simulations)
    if args.persona_folder_name:
        sims_root = run_dir / args.persona_folder_name / 'simulations'
        persona_root = sims_root.parent
        persona_root.mkdir(parents=True, exist_ok=True)
    else:
        sims_root = run_dir / 'simulations'
    if sims_root.exists() and not args.append:
        try:
            shutil.rmtree(sims_root)
        except Exception:
            pass
    sims_root.mkdir(parents=True, exist_ok=True)
    sim_dir = sims_root / time.strftime('%Y%m%d_%H%M%S')
    sim_dir.mkdir(parents=True, exist_ok=True)
    log_path = sim_dir / 'traversal_log.jsonl'
    transcript_path = sim_dir / 'transcript.txt'
    path_path = sim_dir / 'path.json'
    user_report_json = sim_dir / 'user_report.json'
    user_report_txt = sim_dir / 'user_report.txt'
    tea_entries: List[Dict[str, Any]] = []

    def log_event(obj: Dict[str, Any]):
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
        if args.verbose:
            print(obj)

    # Initialize
    start_ts = time.time()
    max_end = start_ts + args.max_minutes * 60.0
    # Validate source id
    # Allow source-image matching
    source_id = None
    if args.source_image:
        sip = pathlib.Path(args.source_image)
        src_hash = average_hash(sip) if sip.exists() else None
        if isinstance(src_hash, int) and id_to_hash:
            best = None
            best_d = 1 << 30
            for sid, h in id_to_hash.items():
                d = hamming_distance(src_hash, h)
                if d < best_d:
                    best_d = d
                    best = sid
            source_id = best
    if not isinstance(source_id, int):
        source_id = args.source_id if args.source_id is not None else (name_to_id.get(source_name) if source_name else None)
    if not isinstance(source_id, int):
        # Try alias mapping from provided source name
        if args.source:
            source_id = alias_to_id.get(normalize(args.source))
    if not isinstance(source_id, int):
        raise SystemExit('Source screen id could not be resolved (pass --source-id)')

    # Allow target-image matching
    if args.target_image and args.target_id is None:
        tip = pathlib.Path(args.target_image)
        tgt_hash = average_hash(tip) if tip.exists() else None
        if isinstance(tgt_hash, int) and id_to_hash:
            best = None
            best_d = 1 << 30
            for sid, h in id_to_hash.items():
                d = hamming_distance(tgt_hash, h)
                if d < best_d:
                    best_d = d
                    best = sid
            if isinstance(best, int):
                args.target_id = int(best)

    current_id = int(source_id)
    visited: List[int] = []
    actions_taken: List[Dict[str, Any]] = []
    frictions: List[Dict[str, Any]] = []
    steps = 0
    outcome = 'timeout'

    start_event = {
        'type': 'start',
        'run_dir': str(run_dir),
        'source': id_to_name.get(current_id),
        'target_name': target_name,
        'target_id': args.target_id,
        'validation_mode': 'id' if args.target_id is not None else 'name',
        'goal': args.goal,
        'timestamp': time.time(),
    }
    if persona:
        start_event['persona'] = {'id': persona.get('id'), 'name': persona.get('name')}
    log_event(start_event)

    with open(transcript_path, 'w', encoding='utf-8') as tf:
        if persona:
            tf.write(f"Persona: {persona.get('name')} (id={persona.get('id')})\n")
            # OCEAN snapshot
            po = extract_ocean(persona)
            tf.write(f"Persona OCEAN: O={po.get('O',0):.2f} C={po.get('C',0):.2f} E={po.get('E',0):.2f} A={po.get('A',0):.2f} N={po.get('N',0):.2f}\n")
        start_img = image_path_by_id(screens_dir, current_id, id_to_file)
        tf.write(f"Start at: id={current_id} name={id_to_name.get(current_id, '')}\nTarget: id={args.target_id if args.target_id is not None else ''} name={target_name or ''}\n")
        tf.write(f"Image: {start_img.name if start_img else 'N/A'}\n")
        tf.write(f"Goal: {args.goal}\n\n")

    # Emotion state init
    emotion_state = init_emotion_state(persona)
    # Lightweight progress tracker for TEA metadata
    user_goal_progress: float = 0.0

    while steps < args.max_steps and time.time() < max_end:
        steps += 1
        # Check goal reached
        curr_id = current_id
        reached = False
        if args.target_id is not None:
            reached = (curr_id == int(args.target_id))
        elif target_name:
            reached = (normalize(id_to_name.get(curr_id, '')) == normalize(target_name))
        if reached:
            outcome = 'reached-target'
            log_event({'type': 'reached', 'screen': id_to_name.get(curr_id, ''), 'screen_id': curr_id, 'step': steps})
            with open(transcript_path, 'a', encoding='utf-8') as tf:
                tf.write(f"Reached target at step {steps}: {id_to_name.get(curr_id, '')} (id={curr_id})\n")
            break

        outgoing = edges_by_source_id.get(curr_id, [])
        # Pre-action reasoning
        options_brief = []
        for e in outgoing:
            label = (e.get('click_target') or e.get('user_intent') or e.get('destination_screen_name') or '').strip()
            # Do not truncate when TEA is enabled; keep full data for richer logs
            if not args.tea and len(label) > 140:
                label = label[:140] + '…'
            did = e.get('_dest_id') if isinstance(e.get('_dest_id'), int) else None
            options_brief.append({'to': id_to_name.get(did, ''), 'to_id': did, 'linkId': e.get('linkId'), 'label': label})

        thought = {
            'screen': id_to_name.get(curr_id, ''),
            'screen_id': curr_id,
            'goal': args.goal,
            'available_actions': options_brief,
            'timestamp': time.time(),
        }
        log_event({'type': 'pre_action_thought', **thought})

        # New: Screen-first analysis (blind to links), traits-biased intent and decision
        id_to_desc = getattr(build_node_maps, '_id_to_desc', {})  # type: ignore[attr-defined]
        screen_desc = id_to_desc.get(curr_id, '')
        screen_name_here = id_to_name.get(curr_id, '')
        analysis = analyze_screen_llm(screen_name_here, screen_desc, persona, args.goal)
        first_intent_nl = analysis.get('intent_nl') or ''
        # Build enriched intention narrative
        archetype = detect_archetype(screen_name_here, screen_desc)
        enriched_intent = build_enriched_intention(screen_name_here, screen_desc, args.goal, persona, archetype, steps)
        first_decision_nl = choose_action_blind(enriched_intent, persona)
        # Try to realize the blind decision against available edges
        first_edge = match_intent_to_edge(first_decision_nl, outgoing)
        # Transcript: Only write legacy intention/result when TEA is disabled
        if not args.tea:
            if first_edge is None:
                with open(transcript_path, 'a', encoding='utf-8') as tf:
                    tf.write(f"- First Action intention: {first_decision_nl}\n")
                # Could not realize; log UX note and reveal options
                frictions.append({'type': 'unclear_primary_cta_persona', 'screen_id': curr_id, 'screen_name': id_to_name.get(curr_id, ''), 'note': 'Blind decision not realizable; revealing options.'})
                with open(transcript_path, 'a', encoding='utf-8') as tf:
                    tf.write("- First Action result: Not found (no matching link). Revealing options…\n")
            else:
                with open(transcript_path, 'a', encoding='utf-8') as tf:
                    tf.write(f"- First Action intention: {first_decision_nl}\n")
                    tf.write(f"- First Action result: {first_edge.get('user_intent') or first_edge.get('click_target') or ''}\n")
                    # (Dedup UX notes: now summarized later under UX AUDIT (this screen))
            # Prefer to execute if it exists; set predicted_edge to our matched first_edge
            predicted_edge = first_edge
        # Persona-driven pre-action friction heuristics
        if persona:
            po = extract_ocean(persona)
            # Many options + high openness → potential drift/choice overload
            if po.get('O', 0.0) >= 0.7 and len(options_brief) >= 5:
                frictions.append({
                    'type': 'choice_overload_persona',
                    'screen_id': curr_id,
                    'screen_name': id_to_name.get(curr_id, ''),
                    'note': 'Many choices may encourage exploration and slow progress for this persona',
                })
            # High conscientiousness but no goal-oriented keywords in top options → unclear primary CTA
            if po.get('C', 0.0) >= 0.7:
                goalish = {'continue','next','submit','confirm','proceed','start','finish','done','go','open'}
                labels_toks = ' '.join((ob.get('label') or '') for ob in options_brief).lower()
                if not any(tok in labels_toks for tok in goalish):
                    frictions.append({
                        'type': 'unclear_primary_cta_persona',
                        'screen_id': curr_id,
                        'screen_name': id_to_name.get(curr_id, ''),
                        'note': 'Structured user may not see a clear next step here',
                    })
            # Additional: High neuroticism + long path so far -> stress/friction
            if po.get('N', 0.0) >= 0.7 and steps > 6:
                frictions.append({
                    'type': 'too_many_steps_persona',
                    'screen_id': curr_id,
                    'screen_name': id_to_name.get(curr_id, ''),
                    'note': f"{persona.get('name')} may feel stressed when task requires many steps."
                })
            # Additional: Low agreeableness -> resistance to permission/confirm prompts
            labels_concat = ' '.join((ob.get('label') or '') for ob in options_brief).lower()
            if po.get('A', 0.0) <= 0.3 and any(w in labels_concat for w in ['allow','confirm','agree','permissions','accept']):
                frictions.append({
                    'type': 'resistance_to_prompts_persona',
                    'screen_id': curr_id,
                    'screen_name': id_to_name.get(curr_id, ''),
                    'note': f"{persona.get('name')} may be averse to extra confirmations or permission prompts."
                })

        # Pre-compute wait edges and ranked prediction for current intent
        wait_edges = [edge for edge in outgoing if is_wait_edge(edge)]
        predicted_edge, ranked_list = choose_edge(args.goal, outgoing, args.target_id, distances, visited, scales)

        # Persona-influenced selection of a non-top edge (if applicable)
        # We keep choose_edge unchanged, but tweak selection here to introduce variation.
        if persona and ranked_list:
            po = extract_ocean(persona)
            # High openness: with some chance pick 2nd option to simulate exploration
            if po.get('O', 0.0) >= 0.7 and len(ranked_list) > 1 and random.random() < 0.28:
                predicted_edge = ranked_list[1][0]
            # High extraversion: prefer edges with clear CTA words in click_target
            elif po.get('E', 0.0) >= 0.7:
                def cta_score(item):
                    e, sc = item
                    ct = (e.get('click_target') or '').lower()
                    # encourage generic CTA tokens
                    ctas = ['continue','start','confirm','next','go','proceed','submit','finish','done','open']
                    bonus = sum(1 for t in ctas if t in ct)
                    return (bonus, sc)
                ranked_list = sorted(ranked_list, key=lambda it: cta_score(it), reverse=True)
                if ranked_list:
                    predicted_edge = ranked_list[0][0]

        current_intent_for_tea: str = ''
        with open(transcript_path, 'a', encoding='utf-8') as tf:
            curr_img = image_path_by_id(screens_dir, curr_id, id_to_file)
            tf.write(f"Step {steps} - On '{id_to_name.get(curr_id, '')}' (id={curr_id})\n")
            tf.write(f"Image: {curr_img.name if curr_img else 'N/A'}\n")
            if not args.tea:
                tf.write(f"- I want to: {args.goal}\n")
            # Persona lens
            if persona and not args.tea:
                po = extract_ocean(persona)
                lens_bits = []
                if po.get('C',0) >= 0.7: lens_bits.append('I prefer clear next steps')
                if po.get('O',0) >= 0.7: lens_bits.append('I explore but still aim to progress')
                if po.get('N',0) >= 0.7: lens_bits.append('I dislike uncertainty and long waits')
                if po.get('E',1) <= 0.3: lens_bits.append('I value self-guided, explicit instructions')
                if lens_bits and not args.tea:
                    tf.write(f"- Persona lens: {'; '.join(lens_bits)}.\n")
            if options_brief and not args.tea:
                tf.write(f"- Options ({len(options_brief)}):\n")
                for ob in options_brief[:8]:
                    tf.write(f"  • [linkId {ob.get('linkId')}] to '{ob.get('to')}' — {ob.get('label')}\n")
            elif not args.tea:
                tf.write("- No available actions from this screen.\n")
            # If first action not realizable, decide second with revealed options
            if first_edge is None and options_brief and not args.tea:
                second_decision_nl = choose_action_blind(build_enriched_intention(screen_name_here, screen_desc, args.goal, persona, archetype, steps+1), persona)
                # Now match against options again (same matcher, now likely to find)
                second_edge = match_intent_to_edge(second_decision_nl, outgoing) or (ranked_list[0][0] if 'ranked_list' in locals() and ranked_list else None)
                if second_edge is not None:
                    tf.write(f"- Second Action intention: {second_decision_nl}\n")
                    tf.write(f"- Second Action result: {build_enriched_result(second_edge, archetype, steps)}\n")
                    predicted_edge = second_edge
            # Replace legacy intention/result lines only when TEA is disabled
            current_intent_for_tea = first_intent_nl or current_intent_for_tea
            if not args.tea:
                if first_edge is None:
                    tf.write(f"- First Action intention: {first_decision_nl}\n")
                    tf.write("- First Action result: Not found (no matching link). Revealing options…\n")
                else:
                    tf.write(f"- First Action intention: {first_decision_nl}\n")
                    tf.write(f"- First Action result: {build_enriched_result(first_edge, archetype, steps)}\n")
                # If we had to reveal options and pick again, write second intention/result here too
                if first_edge is None and 'second_decision_nl' in locals():
                    # Recompute second_edge text view if available
                    se_text = ''
                    try:
                        se_text = (second_edge.get('user_intent') or second_edge.get('click_target') or '')  # type: ignore[name-defined]
                    except Exception:
                        se_text = ''
                    tf.write(f"- Second Action intention: {second_decision_nl}\n")
                    if se_text:
                        tf.write(f"- Second Action result: {se_text}\n")

        # Wait handling: if there's any wait/auto edge with implied <3s, use it; else sleep to 3s
        # Heuristic: if any wait edge exists, assume <3s and auto-transition
        chosen: Optional[Dict[str, Any]] = None
        wait_s: float = 0.0
        if wait_edges:
            chosen = wait_edges[0]
            # Log intent during wait
            log_event({'type': 'waiting', 'screen': id_to_name.get(curr_id, ''), 'screen_id': curr_id, 'note': 'Auto/wait transition detected; proceeding without action', 'linkId': chosen.get('linkId')})
            frictions.append({'type': 'auto_wait', 'screen_id': curr_id, 'screen_name': id_to_name.get(curr_id, ''), 'note': 'Screen auto-advances'})
            with open(transcript_path, 'a', encoding='utf-8') as tf:
                tf.write("- I see this screen auto-advances; I will wait briefly and let it proceed.\n")
            # dynamic wait for auto-advance
            base_wait = 0.8 if (args.max_minutes and float(args.max_minutes) <= 2.0) else 1.2
            wait_s = compute_dynamic_wait_seconds(
                base=base_wait,
                screen_desc=screen_desc,
                options_count=len(outgoing),
                clarity_gap=1.0,
                emotion=emotion_state,
                persona=persona,
                auto_wait=True,
            )
        else:
            # Persona-influenced realistic wait (base ~3s, +/- up to ~1s; clamp 0.5–5s)
            # dynamic wait using screen + persona + emotion + clarity
            # clarity_gap computed later; approximate with ranked_list if available
            approx_gap = 1.0
            try:
                top_sc = ranked_list[0][1] if ranked_list else 0.0
                second_sc = ranked_list[1][1] if ranked_list and len(ranked_list) > 1 else 0.0
                approx_gap = float(top_sc - second_sc)
            except Exception:
                approx_gap = 1.0
            base_wait = 1.2 if (args.max_minutes and float(args.max_minutes) <= 2.0) else 2.6
            wait_s = compute_dynamic_wait_seconds(
                base=base_wait,
                screen_desc=screen_desc,
                options_count=len(outgoing),
                clarity_gap=approx_gap,
                emotion=emotion_state,
                persona=persona,
                auto_wait=False,
            )
            with open(transcript_path, 'a', encoding='utf-8') as tf:
                tf.write(f"- Pause: I'll reflect for ~{wait_s:.1f}s before acting.\n")
            # Persona anxiety about waiting
            if persona and extract_ocean(persona).get('N', 0.0) >= 0.7 and wait_s >= 3.5:
                frictions.append({
                    'type': 'anxiety_wait_persona',
                    'screen_id': curr_id,
                    'screen_name': id_to_name.get(curr_id, ''),
                    'note': 'Longer reflection time may increase anxiety for this persona',
                })
            time.sleep(wait_s)

        # Emotion event (after thought and before action)
        top_score = ranked_list[0][1] if ranked_list else 0.0
        second_score = ranked_list[1][1] if ranked_list and len(ranked_list) > 1 else 0.0
        clarity_gap = float(top_score - second_score) if ranked_list else 1.0
        reduces_distance = False
        if predicted_edge:
            did = predicted_edge.get('_dest_id') if isinstance(predicted_edge.get('_dest_id'), int) else None
            if isinstance(did, int) and distances:
                reduces_distance = (distances.get(did, 1e9) < distances.get(curr_id, 1e9))
        emotion_state = update_emotion(
            emotion_state,
            wait_s=wait_s,
            options_count=len(outgoing),
            clarity_gap=clarity_gap,
            reduces_distance=reduces_distance,
            auto_wait=bool(wait_edges),
            persona=persona,
        )
        emotion_label = label_emotion(emotion_state)
        log_event({
            'type': 'emotion',
            'screen': id_to_name.get(curr_id, ''),
            'screen_id': curr_id,
            'step': steps,
            'timestamp': time.time(),
            'emotion': {
                'valence': emotion_state['valence'],
                'arousal': emotion_state['arousal'],
                'stress': emotion_state['stress'],
                'frustration': emotion_state['frustration'],
                'confidence': emotion_state['confidence'],
                'label': emotion_label,
            },
        })
        with open(transcript_path, 'a', encoding='utf-8') as tf:
            tf.write(f"- Emotion: {describe_emotion(emotion_label, emotion_state, persona)}\n")

        if not outgoing:
            outcome = 'no-outgoing'
            log_event({'type': 'stuck', 'screen': id_to_name.get(curr_id, ''), 'screen_id': curr_id, 'reason': 'no outgoing links'})
            break

        # Choose action (if not already chosen by wait)
        if chosen is None:
            chosen = predicted_edge
        ranked = ranked_list
        ranked_preview = [
            {'to': id_to_name.get(e.get('_dest_id'), ''), 'to_id': e.get('_dest_id'), 'linkId': e.get('linkId'), 'score': sc}
            for (e, sc) in ranked[:5]
        ]
        log_event({'type': 'ranked_actions', 'screen': id_to_name.get(curr_id, ''), 'screen_id': curr_id, 'top': ranked_preview})

        if not chosen:
            outcome = 'no-choice'
            log_event({'type': 'stuck', 'screen': id_to_name.get(curr_id, ''), 'screen_id': curr_id, 'reason': 'could not choose action'})
            break

        # Execute action
        dest_id = chosen.get('_dest_id') if isinstance(chosen.get('_dest_id'), int) else None
        dest = id_to_name.get(dest_id, '')
        # Before we leave the screen, summarize UX audit notes for this step
        step_frictions = [fp for fp in frictions if fp.get('screen_id') == curr_id]
        if analysis.get('ux_notes'):
            for note in analysis['ux_notes']:
                step_frictions.append({'type': 'note', 'screen_id': curr_id, 'screen_name': id_to_name.get(curr_id, ''), 'note': note})
        if step_frictions:
            with open(transcript_path, 'a', encoding='utf-8') as tf:
                tf.write("- UX AUDIT (this screen):\n")
                # Deduplicate by (problem, recommendation)
                seen = set()
                for fp in step_frictions:
                    mapped = map_friction_to_ux_issue(id_to_name.get(curr_id, ''), {'type': fp.get('type'), 'screen_id': curr_id, 'screen_name': id_to_name.get(curr_id, ''), 'description': fp.get('note')})
                    sig = (mapped.get('problem',''), mapped.get('recommendation',''))
                    if sig in seen:
                        continue
                    seen.add(sig)
                    tf.write(f"  • problem: {mapped.get('problem','')}\n")
                    tf.write(f"    heuristic: {mapped.get('heuristic','')}\n")
                    tf.write(f"    recommendation: {mapped.get('recommendation','')}\n")

        log_event({
            'type': 'action',
            'screen': id_to_name.get(curr_id, ''),
            'screen_id': curr_id,
            'chosen_linkId': chosen.get('linkId'),
            'chosen_click_target': chosen.get('click_target'),
            'chosen_user_intent': chosen.get('user_intent'),
            'destination': dest,
            'destination_id': dest_id,
            'timestamp': time.time(),
        })
        with open(transcript_path, 'a', encoding='utf-8') as tf:
            if not args.tea:
                tf.write(f"→ Take linkId {chosen.get('linkId')} to '{dest}' (id={dest_id}).\n\n")
            if args.tea:
                from_name = id_to_name.get(curr_id, '')
                # Prepare richer TEA block per requested structure
                perception_text = build_tea_header(from_name, screen_desc, archetype, options_brief, steps)
                interpretation_text = enriched_intent
                observed_ux_notes = analysis.get('ux_notes') or []
                pre_emotion_label = emotion_label
                pre_emotion_state = dict(emotion_state)
                internal_thought = stable_choice([
                    'I want to validate the next step without losing time.',
                    'I need to be sure this advances my goal directly.',
                    'I’m checking whether this is the clearest path forward.',
                ], f"{from_name}|{steps}|thought")

                expected_action_text = summarize_click_target(chosen.get('click_target') or '', f"Take linkId {chosen.get('linkId')}")
                first_action_performed = expected_action_text
                first_outcome_to = dest
                first_immediate_emotion = pre_emotion_label
                first_immediate_reaction = stable_choice([
                    'This feels like forward progress.',
                    'Seems consistent with my goal; continue.',
                    'Reasonable step; I’ll reassess on the next screen.',
                ], f"{from_name}|{steps}|react")
                ux_feedback_during = []
                reflection_text = 'Proceeding but watching for clarity and next-step cues.'

                mismatch_observation = None
                mismatch_emotion = None
                mismatch_ux_defect = None
                if 'Not found' in (first_action_result_line if 'first_action_result_line' in locals() else ''):
                    mismatch_observation = 'Intended action was not available; options were not obvious visually.'
                    mismatch_emotion = 'Irritated due to mismatch between expectation and available controls.'
                    mismatch_ux_defect = 'Primary action affordance not discoverable from the screen without revealing links.'

                second_decision_thought = second_decision_nl if 'second_decision_nl' in locals() else None
                second_action_text = summarize_click_target(second_edge.get('click_target') if 'second_edge' in locals() and second_edge else '', '') if 'second_edge' in locals() else None
                second_outcome_to = id_to_name.get(second_edge.get('_dest_id')) if 'second_edge' in locals() and second_edge else None
                second_emotion = None

                # Map current step frictions
                step_frictions = [fp for fp in frictions if fp.get('screen_id') == curr_id]
                friction_points_mapped = [map_friction_to_ux_issue(from_name, {'type': fp.get('type'), 'screen_id': curr_id, 'screen_name': from_name, 'description': fp.get('note')}) for fp in step_frictions]
                positive_moments = []
                if 'Guaranteed rate' in (screen_desc or ''):
                    positive_moments.append('Transparent rate/fee breakdown reduces cognitive load and builds trust.')
                suggestions = []

                # Provide a single blank line separation for readability
                tf.write("\n")
                tea_block_full = render_tea_block_full(
                    tea_idx=steps,
                    screen_name=from_name,
                    screen_id=curr_id,
                    goal=args.goal,
                    persona=persona,
                    image_name=(curr_img.name if 'curr_img' in locals() and curr_img else ''),
                    time_spent=wait_s,
                    interaction_type=('cta_click' if (chosen.get('click_target') or '').strip() else 'navigation'),
                    goal_progress=0.0,
                    loop_detected=(len(visited) >= 4 and len(set(visited[-4:])) <= 2),
                    confidence_delta=0.0,
                    friction_score=float(len([fp for fp in frictions if fp.get('screen_id') == curr_id])) * 0.1,
                    perception_text=perception_text,
                    interpretation_text=interpretation_text,
                    observed_ux_notes=observed_ux_notes,
                    pre_emotion_label=pre_emotion_label,
                    pre_emotion_state=pre_emotion_state,
                    internal_thought=internal_thought,
                    first_decision_thought=first_decision_nl,
                    expected_action_text=expected_action_text,
                    hesitation_seconds=wait_s,
                    first_action_performed=first_action_performed,
                    first_outcome_to=first_outcome_to,
                    first_immediate_emotion=first_immediate_emotion,
                    first_immediate_reaction=first_immediate_reaction,
                    ux_feedback_during=ux_feedback_during,
                    reflection_text=reflection_text,
                    mismatch_observation=mismatch_observation,
                    mismatch_emotion=mismatch_emotion,
                    mismatch_ux_defect=mismatch_ux_defect,
                    options_brief=options_brief,
                    second_decision_thought=second_decision_thought,
                    second_action_text=second_action_text,
                    second_outcome_to=second_outcome_to,
                    second_emotion=second_emotion,
                    friction_points_mapped=friction_points_mapped,
                    positive_moments=positive_moments,
                    suggestions=suggestions,
                )
                tf.write(tea_block_full)
                tf.write("\n")
                tea_entries.append({
                    'step': steps,
                    'screen': from_name,
                    'emotion': emotion_label,
                    'hesitation': bool(wait_s >= 2.5),
                    'hesitation_seconds': wait_s,
                    'intent': (first_intent_nl or current_intent_for_tea),
                    'action': first_action_performed,
                    'outcome_to_id': dest_id,
                    'outcome_to': dest,
                })

        visited.append(curr_id)
        current_id = dest_id if isinstance(dest_id, int) else curr_id
        # Record action
        actions_taken.append({
            'from_id': visited[-1],
            'to_id': current_id,
            'linkId': chosen.get('linkId'),
        })
        # Detect back/close intents as friction
        intent_text = f"{chosen.get('click_target') or ''} {chosen.get('chosen_user_intent') or chosen.get('user_intent') or ''}".lower()
        if any(tok in intent_text for tok in ['back', 'return', 'close', 'cancel']):
            frictions.append({'type': 'back_or_close', 'screen_id': curr_id, 'screen_name': id_to_name.get(curr_id, ''), 'linkId': chosen.get('linkId'), 'dest_id': dest_id, 'dest_name': id_to_name.get(dest_id, '')})

        # Loop guard: if we see same 2-screen oscillation repeatedly, stop early
        if len(visited) >= 6 and len(set(visited[-6:])) <= 2:
            outcome = 'loop-detected'
            log_event({'type': 'stuck', 'screen': id_to_name.get(current_id, ''), 'screen_id': current_id, 'reason': 'loop detected'})
            frictions.append({'type': 'loop_detected', 'screen_id': current_id})
            with open(transcript_path, 'a', encoding='utf-8') as tf:
                tf.write("[LOOP DETECTED] Repeated oscillation between the same screens; terminating early.\n")
            break

        # Reset chosen to allow normal selection on next step
        chosen = None

    # Finalize
    path_summary = {
        'outcome': outcome,
        'steps': steps,
        'time_sec': round(time.time() - start_ts, 2),
    }
    path_path.write_text(json.dumps(path_summary, ensure_ascii=False, indent=2), encoding='utf-8')
    end_event = {'type': 'end', **path_summary}
    if persona:
        end_event['persona'] = {'id': persona.get('id'), 'name': persona.get('name')}
    log_event(end_event)
    # Build user-facing report
    completed = (outcome == 'reached-target')
    drop_off_points: List[Dict[str, Any]] = []
    if not completed:
        drop_off_points.append({'screen_id': (visited[-1] if visited else None), 'reason': outcome})
    # Collect thoughts from simulation logs
    thoughts: List[str] = []
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    event = json.loads(line.strip())
                    if event.get('type') == 'pre_action_thought':
                        # Extract thought content from available actions
                        available_actions = event.get('available_actions', [])
                        if available_actions:
                            # Generate diverse, persona-aware thoughts
                            thought = generate_diverse_thought(available_actions, persona, event)
                            if thought:
                                thoughts.append(thought)
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    # Feedback heuristics
    feedback: List[str] = []
    if any(fp.get('type') == 'loop_detected' for fp in frictions):
        feedback.append('User experienced a loop between screens; consider clearer next-step CTAs to avoid oscillation.')
    back_count = sum(1 for fp in frictions if fp.get('type') == 'back_or_close')
    if back_count >= 1:
        feedback.append('User frequently considered going back; make primary actions more prominent.')
    if any(fp.get('type') == 'auto_wait' for fp in frictions):
        feedback.append('Auto-advancing screens may be confusing; add an explicit affordance or progress indicator.')
    if completed and path_summary.get('steps', 0) > 12:
        feedback.append('Path to completion is relatively long; consider reducing steps to completion.')
    # Persona-specific feedback
    persona_ocean = extract_ocean(persona) if persona else None
    if persona_ocean:
        O, C, E, A, N = (persona_ocean.get('O',0.0), persona_ocean.get('C',0.0), persona_ocean.get('E',0.0), persona_ocean.get('A',0.0), persona_ocean.get('N',0.0))
        pname = persona.get('name') or 'User'
        pjob = persona.get('job') or ''
        if N >= 0.7:
            feedback.append(f"{pname} ({pjob}) shows high sensitivity to uncertainty — reduce ambiguity and waiting; provide progress and reassurance copy.")
        if C >= 0.7:
            feedback.append(f"{pname} ({pjob}) prefers structured flows — streamline steps and highlight the primary next action.")
        if O >= 0.7:
            feedback.append(f"{pname} ({pjob}) enjoys exploring — support exploration but keep CTAs visually dominant to avoid wandering.")
        if E <= 0.3:
            feedback.append(f"{pname} ({pjob}) favors clear, self-guided instructions over social cues or prompts.")

    # Enrich friction points with natural-language descriptions
    enriched_frictions: List[Dict[str, Any]] = []
    recent_path_names = [id_to_name.get(i, '') for i in visited[-6:]] if visited else []
    for fp in frictions:
        ftype = fp.get('type')
        sid = fp.get('screen_id')
        sname = id_to_name.get(sid, fp.get('screen_name') or '')
        desc = ''
        if ftype == 'auto_wait':
            desc = f"On '{sname}' (id={sid}), the screen advanced automatically without an explicit action. This may cause confusion or a feeling of loss of control. Consider an explicit Continue/Next affordance or a progress indicator."
            if persona_ocean and persona_ocean.get('N', 0.0) >= 0.7:
                desc += " Persona note: elevated sensitivity to uncertainty — add a visible countdown/progress to reduce anxiety."
        elif ftype == 'back_or_close':
            did = fp.get('dest_id')
            dname = id_to_name.get(did, fp.get('dest_name') or '')
            lid = fp.get('linkId')
            desc = f"On '{sname}' (id={sid}), I considered a back/close action (linkId {lid}) leading to '{dname}' (id={did}). This suggests the primary CTA might be unclear or not compelling toward the goal (primary next action)."
            if persona_ocean and persona_ocean.get('C', 0.0) >= 0.7:
                desc += " Persona note: prefers structured, linear flows — strengthen the primary CTA to reduce detours."
        elif ftype == 'loop_detected':
            desc = f"A navigation loop was detected near '{sname}' (id={sid}). Recent path: {' → '.join(n for n in recent_path_names if n)}. This indicates ambiguous next steps or competing CTAs."
            if persona_ocean and persona_ocean.get('O', 0.0) >= 0.7:
                desc += " Persona note: exploratory behavior increases loop risk — add clearer hierarchy and guardrails."
        elif ftype == 'choice_overload_persona':
            desc = f"On '{sname}' (id={sid}), many parallel actions are available. For this persona, the breadth of options may encourage exploration over progress; highlight the primary next step."
        elif ftype == 'unclear_primary_cta_persona':
            desc = f"On '{sname}' (id={sid}), the next step is not clearly emphasized. For this persona, make the primary CTA visually dominant and explicitly labeled (e.g., 'Continue', 'Next', 'Submit')."
        elif ftype == 'anxiety_wait_persona':
            desc = f"On '{sname}' (id={sid}), longer consideration time can feel uncomfortable; provide feedback or progress cues to reassure."
        elif ftype == 'too_many_steps_persona':
            desc = f"On '{sname}' (id={sid}), the sequence of steps may feel long and tiring for some users; consider shortening the critical path or adding checkpoints."
        elif ftype == 'resistance_to_prompts_persona':
            desc = f"On '{sname}' (id={sid}), prompts or confirmations are present; some users may resist extra dialogs and abandon. Reduce unnecessary prompts or explain benefits clearly."
        else:
            desc = f"Friction encountered on '{sname}' (id={sid})."
        enriched = dict(fp)
        enriched['description'] = desc
        enriched_frictions.append(enriched)

    report = {
        'task': args.goal,
        'source_id': int(source_id),
        'target_id': int(args.target_id) if args.target_id is not None else None,
        'status': 'completed' if completed else 'not_completed',
        'steps': int(path_summary.get('steps', 0)),
        'time_sec': float(path_summary.get('time_sec', 0.0)),
        'friction_points': enriched_frictions,
        'drop_off_points': drop_off_points,
        'feedback': feedback,
        'actions': actions_taken,
        'thoughts': thoughts,
    }
    if args.tea:
        report['tea'] = tea_entries
    if args.ux_audit:
        ux_issues = [map_friction_to_ux_issue(id_to_name.get(fp.get('screen_id'), ''), fp) for fp in enriched_frictions]
        report['ux_audit'] = { 'issues': ux_issues }
    if persona:
        report['persona'] = {'id': persona.get('id'), 'name': persona.get('name')}
    if args.resolved_user_id is not None:
        report['user_id'] = int(args.resolved_user_id)
    user_report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    # Text version
    with open(user_report_txt, 'w', encoding='utf-8') as tf:
        tf.write(f"Task completion status: {'completed' if completed else 'not completed'}\n")
        tf.write(f"Steps: {report['steps']} | Time: {report['time_sec']}s\n")
        tf.write("Friction points:\n")
        if enriched_frictions:
            for fp in enriched_frictions:
                tf.write(f"- {fp.get('description')}\n")
        else:
            tf.write("- None\n")
        tf.write("Drop-off points:\n")
        if drop_off_points:
            for dp in drop_off_points:
                tf.write(f"- screen_id={dp.get('screen_id')} reason={dp.get('reason')}\n")
        else:
            tf.write("- None\n")
        tf.write("Feedback:\n")
        if feedback:
            for f in feedback:
                tf.write(f"- {f}\n")
        else:
            tf.write("- (no additional feedback)\n")
        tf.write("Thoughts:\n")
        if thoughts:
            for t in thoughts:
                tf.write(f"- {t}\n")
        else:
            tf.write("- (no thoughts recorded)\n")
        if args.tea and tea_entries:
            tf.write("\nTEA Logs:\n")
            for te in tea_entries:
                tf.write(f"- step={te['step']} screen='{te['screen']}' emotion={te['emotion']} hesitation={te['hesitation']} action='{te['action']}' → {te['outcome_to']}\n")
        if args.ux_audit:
            tf.write("\nUX AUDIT (issues):\n")
            if report.get('ux_audit', {}).get('issues'):
                for issue in report['ux_audit']['issues']:
                    tf.write(f"- screen='{issue.get('screen','')}'\n  problem: {issue.get('problem','')}\n  heuristic: {issue.get('heuristic','')}\n  recommendation: {issue.get('recommendation','')}\n")
            else:
                tf.write("- None\n")
    print(f"Traversal complete → {sim_dir}\nOutcome: {outcome}; steps={steps}")

    # Write smart condensed TEA log alongside transcript
    try:
        # Normalize transcript formatting before generating derived logs
        normalize_transcript_file(transcript_path)
        condensed = sim_dir / 'smart_condensed_TEA_log.txt'
        write_smart_condensed_log(transcript_path, condensed)
    except Exception:
        pass


if __name__ == '__main__':
    main()
