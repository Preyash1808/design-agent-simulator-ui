#!/usr/bin/env python3
import os
import sys
import json
import base64
import requests
from functools import lru_cache
import pathlib
import argparse
import concurrent.futures
import random

from dotenv import load_dotenv
import threading
import time
ROOT = pathlib.Path(__file__).resolve().parent.parent
FIGMA_CONFIG = ROOT / 'config' / 'figma.config.json'



def encode_image_png(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode('utf-8')


def _bound_words(text: str, min_words: int = 50, max_words: int = 75) -> str:
    """Clamp text to roughly the requested word range without breaking words."""
    words = [w for w in (text or '').split() if w]
    if not words:
        return ''
    if len(words) <= max_words and len(words) >= min_words:
        return ' '.join(words)
    if len(words) < min_words:
        # Pad gently by repeating a neutral clause
        pad = (min_words - len(words))
        words = words + (['This perspective helps me decide the next step.'] * ((pad // 8) + 1))
    return ' '.join(words[:max_words])


def _fallback_emotion_detail(label: str, narrative: str) -> str:
    base = (
        f"I feel {label.lower() if label else 'engaged'} as I take in this screen. "
        "The full-bleed imagery and minimal controls set a clear tone and nudge me toward exploration. "
        "Seeing navigation at the bottom and familiar icons at the top reassures me there are straightforward paths forward. "
        "My attention hovers over the likely next step while I confirm what action best advances my purpose."
    )
    return _bound_words(base, 50, 75)


def _normalize_gist(text: str, max_words: int = 12) -> str:
    import re
    s = (text or '').lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    parts = [p for p in s.split() if p]
    return " ".join(parts[:max_words])


def _to_float(x, default: float = 0.5) -> float:
    try:
        v = float(x)
        if v != v:  # NaN check
            return default
        return max(0.0, min(1.0, v))
    except Exception:
        return default


def _append_jsonl(log_path: pathlib.Path, obj: dict) -> None:
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open('a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
    except Exception:
        # best-effort logging; never crash the run
        pass


# --------------------
# LLM rate limiter and retry wrapper (accuracy-neutral)
# --------------------
_LLM_LOCK = threading.Lock()
_LLM_TOKENS = 0
_LLM_WINDOW_START = 0.0
_LLM_LAST_TS = 0.0

def _rate_limited_generate(model, parts_or_prompt, timeout_sec: int = 30):
    """Token-bucket-ish limiter by QPS; set via env LLM_QPS (default 8). Retries with backoff on 429/5xx."""
    qps = float(os.getenv('LLM_QPS', '8'))
    max_retries = int(os.getenv('LLM_MAX_RETRIES', '4'))
    base_sleep = float(os.getenv('LLM_RETRY_BASE_SEC', '0.5'))
    for attempt in range(max_retries + 1):
        # simple QPS gate
        if qps > 0:
            with _LLM_LOCK:
                now = time.time()
                global _LLM_LAST_TS
                # ensure at most qps per second
                min_interval = 1.0 / qps
                wait = max(0.0, (_LLM_LAST_TS + min_interval) - now)
                if wait > 0:
                    time.sleep(wait)
                _LLM_LAST_TS = time.time()
        try:
            if isinstance(parts_or_prompt, list):
                return model.generate_content(parts_or_prompt, request_options={"timeout": timeout_sec})
            else:
                return model.generate_content([{ 'text': str(parts_or_prompt) }], request_options={"timeout": timeout_sec})
        except Exception as e:
            msg = str(e).lower()
            retriable = ('429' in msg) or ('rate' in msg) or ('temporarily unavailable' in msg) or ('timeout' in msg) or ('503' in msg) or ('500' in msg)
            if attempt >= max_retries or not retriable:
                raise
            sleep = (base_sleep * (2 ** attempt)) * (1.0 + 0.2 * random.random())
            time.sleep(min(sleep, 8.0))


# --------------------
# User/persona utilities
# --------------------
def load_user_by_id(users_path: pathlib.Path, user_id: str | int) -> dict | None:
    try:
        data = json.loads(users_path.read_text(encoding='utf-8'))
    except Exception:
        return None
    # data may be a list or an object with key 'users'
    users = []
    if isinstance(data, list):
        users = data
    elif isinstance(data, dict):
        users = data.get('users') or data.get('data') or []
    target = str(user_id)
    for u in users:
        try:
            if str(u.get('id') or u.get('user_id') or u.get('uid')) == target:
                return u
        except Exception:
            continue
    return None


def derive_user_bias(user: dict | None) -> dict:
    ocean = (user or {}).get('ocean') or {}
    O = float(ocean.get('O') or ocean.get('o') or 0.5)
    C = float(ocean.get('C') or ocean.get('c') or 0.5)
    E = float(ocean.get('E') or ocean.get('e') or 0.5)
    A = float(ocean.get('A') or ocean.get('a') or 0.5)
    N = float(ocean.get('N') or ocean.get('n') or 0.5)
    risk = str((user or {}).get('risk_appetite') or '').lower()
    risk_high = 1.0 if risk in {'high','very high','vh','h'} else 0.0
    bias = {
        'O': O, 'C': C, 'E': E, 'A': A, 'N': N,
        'verbosity': 0.5 + 0.5 * max(0.0, min(1.0, O)),
        'emotion_amplification': 0.3 + 0.7 * max(0.0, min(1.0, N)),
        'exploration_tendency': 0.3 + 0.4 * risk_high,
        'tone_agreeableness': 0.5 + 0.5 * max(0.0, min(1.0, A)),
        'structure_focus': 0.4 + 0.6 * max(0.0, min(1.0, C)),
        'expressiveness': 0.4 + 0.6 * max(0.0, min(1.0, E)),
    }
    return bias


def persona_instructions_for(user: dict | None, bias: dict | None) -> str | None:
    if not user and not bias:
        return None
    ocean = (user or {}).get('ocean') or {}
    pieces = []
    if user:
        name = str(user.get('name') or user.get('full_name') or 'User')
        pieces.append(f"Persona name: {name}.")
        if ocean:
            pieces.append(
                f"OCEAN: O={ocean.get('O', ocean.get('o', 0.5))} C={ocean.get('C', ocean.get('c', 0.5))} "
                f"E={ocean.get('E', ocean.get('e', 0.5))} A={ocean.get('A', ocean.get('a', 0.5))} N={ocean.get('N', ocean.get('n', 0.5))}."
            )
        if user.get('risk_appetite'):
            pieces.append(f"Risk appetite: {user.get('risk_appetite')}.")
        if user.get('communication_style'):
            pieces.append(f"Communication style: {user.get('communication_style')}.")
        if user.get('work_style'):
            pieces.append(f"Work style: {user.get('work_style')}.")
    if bias:
        pieces.append(
            "Style controls: "
            f"verbosity={bias.get('verbosity'):.2f}, expressiveness={bias.get('expressiveness'):.2f}, "
            f"structure_focus={bias.get('structure_focus'):.2f}, tone_agreeableness={bias.get('tone_agreeableness'):.2f}, "
            f"emotion_amplification={bias.get('emotion_amplification'):.2f}, exploration_tendency={bias.get('exploration_tendency'):.2f}. "
            "Use these to shape tone, detail level, emotional intensity, and preference for structured flows."
        )
    return " ".join(pieces)


def adjust_severity_by_persona(heuristic: str, severity_0_1: float, user: dict | None) -> float:
    if not user:
        return float(max(0.0, min(1.0, severity_0_1)))
    ocean = (user or {}).get('ocean') or {}
    O = float(ocean.get('O') or ocean.get('o') or 0.5)
    C = float(ocean.get('C') or ocean.get('c') or 0.5)
    E = float(ocean.get('E') or ocean.get('e') or 0.5)
    A = float(ocean.get('A') or ocean.get('a') or 0.5)
    N = float(ocean.get('N') or ocean.get('n') or 0.5)
    h = (heuristic or '').lower()
    factor = 1.0
    if 'visibility' in h or 'status' in h:
        factor *= 1.0 + 0.30 * N + 0.15 * (1.0 - C)
    if 'aesthetic' in h or 'minimal' in h:
        factor *= 1.0 + 0.25 * O + 0.10 * C
    if 'consistency' in h or 'standards' in h:
        factor *= 1.0 + 0.30 * C
    if 'control' in h or 'freedom' in h:
        factor *= 1.0 + 0.25 * (1.0 - A) + 0.10 * C
    if 'recognition' in h or 'recall' in h:
        # If literacy present and low, boost more
        lit = user.get('digital_literacy') if isinstance(user, dict) else None
        try:
            litf = float(lit)
        except Exception:
            litf = None
        if litf is not None:
            factor *= 1.0 + 0.30 * (1.0 - max(0.0, min(1.0, litf)))
        else:
            factor *= 1.0 + 0.20 * (1.0 - O)
    # Clamp severity
    return float(max(0.0, min(1.0, severity_0_1 * factor)))


# --------------------
# Deterministic first-action bias layer
# --------------------
def _map_llm_action_to_key(text: str) -> str | None:
    # Simplified: prefer direct phrases; otherwise let similarity drive selection
    s = (text or '').lower()
    if not s:
        return None
    if any(k in s for k in ['back', 'go back', 'previous']):
        return 'back'
    if 'search' in s:
        return 'search'
    if any(k in s for k in ['grid', 'categories', 'catalog']):
        return 'grid'
    if any(k in s for k in ['wishlist', 'favorite', 'heart']):
        return 'wishlist'
    return None


def _map_click_target_to_key(text: str) -> str | None:
    s = (text or '').lower()
    if not s:
        return None
    if 'search' in s:
        return 'search'
    if any(k in s for k in ['back', 'chevron']):
        return 'back'
    if any(k in s for k in ['grid', 'categories', 'browse']):
        return 'grid'
    if any(k in s for k in ['heart', 'wishlist']):
        return 'wishlist'
    return None


def _goal_affinity_for(action: str, goal: str | None) -> float:
    g = (goal or '').lower()
    # Defaults for generic shopping; tuned for "select item + add to wishlist"
    base = {
        'search': 0.85,
        'grid': 0.80,
        'wishlist': 0.20,
        'profile': 0.10,
    }
    if 'wishlist' in g or ('select' in g and 'item' in g):
        base['search'] = 0.90
        base['grid'] = 0.80
        base['wishlist'] = 0.20
        base['profile'] = 0.10
    return base.get(action, 0.50)


def _ui_visibility_flag(audit: dict | None) -> bool:
    issues = list((audit or {}).get('issues') or []) if isinstance(audit, dict) else []
    txt = (' '.join([str(i.get('problem_my_experience') or '') for i in issues]) + ' ' +
           ' '.join([str(i.get('recommendation_user_voice') or '') for i in issues])).lower()
    return any(k in txt for k in ['difficult to see', 'blend', 'contrast', 'hard to see', 'squint'])


def _ui_confidence_for(action: str, audit: dict | None, hard_to_see: bool | None = None) -> float:
    # Start neutral; give +0.1 bonus to bottom bar grid if no visibility complaints
    # Penalize top-right icons when visibility issues detected
    if hard_to_see is None:
        hard_to_see = _ui_visibility_flag(audit)
    if action in {'search', 'wishlist'}:
        return 0.0 if not hard_to_see else -0.10
    if action == 'grid':
        return 0.10
    return 0.0


def _ambiguity_penalty_for(action: str, goal: str | None, N: float) -> float:
    g = (goal or '').lower()
    penalty = 0.0
    if action == 'wishlist' and ('wishlist' in g or 'save' in g):
        # Opening wishlist does not add new; ambiguous toward goal
        penalty += 0.20 * (0.6 + 0.4 * max(0.0, min(1.0, N)))
    return penalty


def _small_adjustments(action: str, E: float, A: float) -> float:
    bonus = 0.0
    if action == 'grid' and E > 0.6:
        bonus += 0.05
    if action == 'search' and A < 0.3:
        bonus += 0.05
    if action == 'search' and A > 0.7:
        bonus -= 0.05
    return bonus


def _compose_action_instruction(action: str, candidates: dict, goal: str | None) -> str:
    """Generate a concise, natural instruction without hardcoded phrasing.
    Prefers neutral wording that fits a variety of layouts (e.g., 'search bar' at 'top').
    """
    info = candidates.get(action) or {}
    label = (info.get('label') or action).strip()
    location = (info.get('location') or '').strip()
    loc_part = f" at the {location}" if location else ''
    # Minimal intent heuristics; avoid UI-specific positions that may not match every layout
    if action == 'search':
        intent = 'find items'
    elif action == 'grid':
        intent = 'browse products'
    elif action == 'wishlist':
        intent = 'open your wishlist'
    elif action == 'profile':
        intent = 'open your profile'
    else:
        intent = 'continue'
    return f"Use the {label}{loc_part} to {intent}."


_MODEL_CACHE: dict[str, object] = {}

def _get_generative_model(model_name: str):
    try:
        import google.generativeai as genai
    except Exception:
        return None
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        return None
    try:
        if not _MODEL_CACHE.get('__READY__'):
            genai.configure(api_key=api_key)
            _MODEL_CACHE['__READY__'] = True
    except Exception:
        return None
    if model_name not in _MODEL_CACHE:
        try:
            _MODEL_CACHE[model_name] = genai.GenerativeModel(model_name)
        except Exception:
            return None
    return _MODEL_CACHE.get(model_name)

def _llm_compose_action_text(model_name: str, goal: str | None, narrative: str, action_key: str, struct: dict) -> str:
    """Ask the LLM to produce a concise, first‑person instruction for the decided action.
    Returns empty string on failure.
    """
    try:
        model = _get_generative_model(model_name)
        if model is None:
            return ''
        control = str(struct.get('control') or '').strip()
        location = str(struct.get('location') or '').strip()
        rationale = str(struct.get('rationale') or '').strip()
        pieces = [
            "Write a single, concise, first-person instruction for the immediate tap/click to progress.",
            f"Overall goal: {goal or ''}",
            f"Screen description: {narrative[:600]}",
            f"Chosen action key: {action_key}",
        ]
        if control:
            pieces.append(f"Control hint: {control}")
        if location:
            pieces.append(f"Location hint: {location}")
        if rationale:
            pieces.append(f"Why: {rationale}")
        pieces.append("Constraints: 6-20 words, plain imperative, no quotes, no UI jargon unless visible (e.g., 'Search').")
        prompt = "\n".join(pieces)
        resp = _rate_limited_generate(model, [{ 'text': prompt }], timeout_sec=int(os.getenv('LLM_TIMEOUT_SEC','30')))
        text = (getattr(resp, 'text', '') or '').strip()
        if text.startswith('```'):
            text = text.strip('`')
            if text.startswith('json'):
                text = text[4:]
        # Keep it single-line and short
        return ' '.join(text.split())[:240]
    except Exception:
        return ''


def _read_figma_file_key() -> str | None:
    try:
        cfg = json.loads(FIGMA_CONFIG.read_text(encoding='utf-8'))
        url = str(cfg.get('figmaFileUrl') or '').strip()
        if not url:
            return None
        from urllib.parse import urlparse
        parts = [p for p in urlparse(url).path.split('/') if p]
        for marker in ('design', 'file'):
            if marker in parts:
                i = parts.index(marker)
                if i + 1 < len(parts):
                    return parts[i+1]
    except Exception:
        return None
    return None


def _fetch_figma_nodes(token: str, file_key: str, ids: list[str]) -> dict:
    out: dict = {}
    if not token or not file_key or not ids:
        return out
    CHUNK = 80
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i+CHUNK]
        try:
            r = requests.get(
                f'https://api.figma.com/v1/files/{file_key}/nodes',
                headers={'X-Figma-Token': token},
                params={'ids': ','.join(chunk)},
                timeout=30,
            )
            r.raise_for_status()
            data = r.json().get('nodes', {})
            for k, v in data.items():
                out[str(k)] = (v or {}).get('document') or {}
        except Exception:
            continue
    return out


def _map_node_name_to_key(name: str) -> str | None:
    s = (name or '').lower()
    if not s:
        return None
    if any(k in s for k in ['search', 'magnify', 'magnifier', 'input', 'field']):
        return 'search'
    if any(k in s for k in ['grid', 'category', 'categories', 'browse', 'catalog']):
        return 'grid'
    if any(k in s for k in ['wishlist', 'favorite', 'heart']):
        return 'wishlist'
    if any(k in s for k in ['profile', 'account', 'user']):
        return 'profile'
    if any(k in s for k in ['back', 'chevron', 'arrow-left']):
        return 'back'
    return None


def _infer_anchor_from_text(text: str) -> tuple[float, float]:
    t = (text or '').lower()
    # Defaults to center if nothing is found
    ax, ay = 0.5, 0.5
    if 'top' in t:
        ay = 0.10
    if 'bottom' in t:
        ay = 0.90
    if 'left' in t:
        ax = 0.10
    if 'right' in t:
        ax = 0.90
    if 'center' in t or 'middle' in t:
        ax = 0.5
    # Common phrases
    if 'top-right' in t or ('top' in t and 'right' in t):
        ax, ay = 0.90, 0.10
    if 'top-left' in t or ('top' in t and 'left' in t):
        ax, ay = 0.10, 0.10
    if 'bottom-right' in t or ('bottom' in t and 'right' in t):
        ax, ay = 0.90, 0.90
    if 'bottom-left' in t or ('bottom' in t and 'left' in t):
        ax, ay = 0.10, 0.90
    # Heuristic: mentions of 'search bar' or 'search' imply top
    if 'search' in t and 'bottom' not in t:
        ay = 0.10
    return ax, ay


def _centroid_red_dot(img_path: pathlib.Path) -> tuple[float, float] | None:
    try:
        from PIL import Image
        im = Image.open(img_path).convert('RGB')
        w, h = im.size
        r, g, b = im.split()
        pts = []
        for y in range(h):
            for x in range(w):
                rv, gv, bv = r.getpixel((x, y)), g.getpixel((x, y)), b.getpixel((x, y))
                if rv >= 200 and gv <= 130 and bv <= 130:
                    pts.append((x, y))
        if not pts:
            return None
        sx = sum(p[0] for p in pts) / len(pts)
        sy = sum(p[1] for p in pts) / len(pts)
        return sx / max(w, 1.0), sy / max(h, 1.0)
    except Exception:
        return None


def _to_frame_coords(elem_bb: dict, frame_bb: dict, img_w: int, img_h: int) -> tuple[float, float, float, float]:
    try:
        ex, ey, ew, eh = float(elem_bb['x']), float(elem_bb['y']), float(elem_bb['width']), float(elem_bb['height'])
        fx, fy, fw, fh = float(frame_bb['x']), float(frame_bb['y']), float(frame_bb['width']), float(frame_bb['height'])
        rx, ry = ex - fx, ey - fy
        sx, sy = img_w / max(fw, 1.0), img_h / max(fh, 1.0)
        return rx * sx, ry * sy, ew * sx, eh * sy
    except Exception:
        return 0.0, 0.0, 0.0, 0.0


def _token_set(s: str) -> set[str]:
    import re
    toks = re.findall(r"[a-z0-9]+", (s or '').lower())
    return set(toks)


def _intent_bbox_from_text(text: str, iw: int, ih: int) -> tuple[float, float, float, float]:
    t = (text or '').lower()
    # Defaults to a modest box around an inferred anchor
    ax, ay = _infer_anchor_from_text(text)
    w, h = 0.22 * iw, 0.12 * ih
    # If intent mentions product/image/card, use a larger content-region box and avoid header band
    product_like = any(k in t for k in ['product', 'image', 'photo', 'card', 'thumbnail', 'tile'])
    if product_like:
        # Nudge down from header and expand width/height to cover a typical grid tile
        header_band = 0.12 * ih
        if ay * ih < header_band:
            ay = (header_band + 0.18 * ih) / ih
        w, h = 0.36 * iw, 0.28 * ih
    x, y = max(0.0, ax * iw - w / 2.0), max(0.0, ay * ih - h / 2.0)
    # Heuristics for common controls
    if any(k in t for k in ['search products here', 'search bar', 'text field', 'input']):
        x, y = 0.05 * iw, 0.06 * ih
        w, h = 0.90 * iw, 0.12 * ih
    elif 'search icon' in t or ('search' in t and 'icon' in t):
        x, y = 0.82 * iw, 0.03 * ih
        w, h = 0.14 * iw, 0.10 * ih
    elif 'back' in t or 'top-left' in t or 'left arrow' in t or 'chevron' in t:
        x, y = 0.02 * iw, 0.03 * ih
        w, h = 0.14 * iw, 0.10 * ih
    elif 'grid' in t:
        # Bottom bar, second from left
        x, y = 0.22 * iw, 0.86 * ih
        w, h = 0.18 * iw, 0.12 * ih
    elif 'wishlist' in t or 'heart' in t:
        # Prefer header heart
        x, y = 0.86 * iw, 0.04 * ih
        w, h = 0.12 * iw, 0.10 * ih
    # Clamp within frame
    x = max(0.0, min(x, iw - w))
    y = max(0.0, min(y, ih - h))
    return x, y, w, h


def _rect_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = aw * ah
    area_b = bw * bh
    return inter / max(1e-6, area_a + area_b - inter)


def _rect_coverage(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> tuple[float, float]:
    """Return (coverage, inter_area) where coverage = area(a∩b) / area(a).
    a is the intent box; b is the link bbox.
    """
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(1e-6, aw * ah)
    return (inter / area_a, inter)


# --------------------
# Semantic similarity (embeddings with graceful fallback)
# --------------------
def _cosine_sim(a: list[float], b: list[float]) -> float:
    try:
        import math
        da = math.sqrt(sum(x*x for x in a)) or 1.0
        db = math.sqrt(sum(x*x for x in b)) or 1.0
        dot = sum(x*y for x,y in zip(a,b))
        v = dot / (da*db)
        # clamp to [0,1]
        return max(0.0, min(1.0, (v + 1.0) / 2.0))
    except Exception:
        return 0.0


@lru_cache(maxsize=4096)
def _embed_text_gemini(text: str) -> list[float] | None:
    try:
        import google.generativeai as genai
        api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
        if not api_key:
            return None
        # Configure once per process (cached flag)
        try:
            if not getattr(_embed_text_gemini, '_GENAI_READY', False):
                genai.configure(api_key=api_key)
                setattr(_embed_text_gemini, '_GENAI_READY', True)
        except Exception:
            genai.configure(api_key=api_key)
        model_name = os.getenv('EMBED_MODEL', 'text-embedding-004')
        resp = genai.embed_content(model=model_name, content=text[:3000])
        vec = (resp.get('embedding') if isinstance(resp, dict) else getattr(resp, 'embedding', None)) or None
        if isinstance(vec, list) and vec:
            return [float(x) for x in vec]
        return None
    except Exception:
        return None


def _semantic_similarity(t1: str, t2: str) -> float:
    t1 = (t1 or '').strip()
    t2 = (t2 or '').strip()
    if not t1 or not t2:
        return 0.0
    # Try embeddings
    v1 = _embed_text_gemini(t1)
    v2 = _embed_text_gemini(t2) if v1 is not None else None
    if v1 is not None and v2 is not None:
        return _cosine_sim(v1, v2)
    # Fallback: token Jaccard
    a, b = _token_set(t1), _token_set(t2)
    inter = len(a & b)
    union = max(1, len(a | b))
    return inter / union


def _fuse_match_to_link(llm_text: str, links: list[dict], current_screen: dict, screens_dir: pathlib.Path) -> dict | None:
    # Inputs
    token = os.getenv('FIGMA_TOKEN') or ''
    file_key = _read_figma_file_key() or ''
    img_file = str(current_screen.get('file') or '')
    sid = str(current_screen.get('screen_id') or '')
    annotated_dir = screens_dir.parent / 'annotated'
    # Image size for normalization
    try:
        from PIL import Image
        iw, ih = (Image.open(screens_dir / img_file).size if img_file else (1080, 1920))
    except Exception:
        iw, ih = (1080, 1920)

    # Fetch Figma nodes (frame + source elements)
    elem_ids = [str(ln.get('source_element_id')) for ln in (links or []) if ln.get('source_element_id')]
    need_ids = list({*(elem_ids or []), sid} - {None})
    node_docs = _fetch_figma_nodes(token, file_key, need_ids) if need_ids else {}
    frame_doc = node_docs.get(sid, {})
    f_bb = frame_doc.get('absoluteBoundingBox') or {}

    # Expected anchor and intent bbox from LLM phrasing
    ax, ay = _infer_anchor_from_text(llm_text)
    intent_box = _intent_bbox_from_text(llm_text, iw, ih)
    action_key = _map_llm_action_to_key(llm_text) or ''

    # Optional pre-filter: if LLM intent is search, restrict to search-like links or frame-wide
    cands = []
    if action_key == 'search':
        for ln in (links or []):
            lk = _map_click_target_to_key(str(ln.get('click_target') or '')) or ''
            if lk == 'search' or str(ln.get('source_element_id') or '') == sid:
                cands.append(ln)
    if not cands:
        cands = links or []

    best = None
    best_score = -1.0
    for ln in cands:
        # Scores
        s_loc, s_ann, s_sem = 0.0, 0.0, 0.0
        # Figma element center vs anchor and intent coverage
        elem_doc = node_docs.get(str(ln.get('source_element_id')), {})
        e_bb = elem_doc.get('absoluteBoundingBox') or {}
        is_frame_wide = False
        if e_bb and f_bb:
            ex, ey, ew, eh = _to_frame_coords(e_bb, f_bb, iw, ih)
            cx, cy = ex + ew / 2.0, ey + eh / 2.0
            nx, ny = cx / max(iw, 1.0), cy / max(ih, 1.0)
            dist = ((nx - ax) ** 2 + (ny - ay) ** 2) ** 0.5
            center_close = max(0.0, 1.0 - min(dist * 2.5, 1.0))
            # Coverage with intent region (recall-style)
            cov, inter = _rect_coverage(intent_box, (ex, ey, ew, eh))
            # Thresholds
            cov_tau = float(os.getenv('MATCH_COVERAGE_TAU', '0.75'))
            inter_min = float(os.getenv('MATCH_INTER_MIN', '1000'))
            if cov >= cov_tau and inter >= inter_min:
                s_loc = 1.0
            else:
                s_loc = max(0.0, min(1.0, 0.6 * cov + 0.4 * center_close))
            # Frame-wide element → treat as click-anywhere
            fw, fh = max(iw, 1.0), max(ih, 1.0)
            if (ew / fw) >= 0.95 and (eh / fh) >= 0.95:
                is_frame_wide = True
                # For search intent, a frame-wide target means tapping anywhere (including the search bar)
                if action_key == 'search':
                    s_loc = 1.0
        # Annotated red-dot proximity (if available)
        if annotated_dir.exists() and img_file and ln.get('linkId') is not None:
            ann_name = f"{sid}__{ln.get('linkId')}__{pathlib.Path(img_file).stem}.png"
            ann_path = annotated_dir / ann_name
            dot = _centroid_red_dot(ann_path)
            if dot and e_bb and f_bb:
                ex, ey, ew, eh = _to_frame_coords(e_bb, f_bb, iw, ih)
                dx, dy = dot[0] * iw, dot[1] * ih
                inside = (ex <= dx <= ex + ew) and (ey <= dy <= ey + eh)
                if inside:
                    s_ann = 1.0
                else:
                    cx, cy = ex + ew / 2.0, ey + eh / 2.0
                    dn = (((dx / iw) - (cx / iw)) ** 2 + ((dy / ih) - (cy / ih)) ** 2) ** 0.5
                    s_ann = max(0.0, 1.0 - min(dn * 2.5, 1.0))
            else:
                # No dot in annotation ⇒ wait/anywhere — treat as full support
                s_ann = 1.0
        # Semantics/key alignment and UI role bias
        link_key = _map_click_target_to_key(str(ln.get('click_target') or '')) or ''
        # Base semantic from key match
        if action_key and link_key:
            if link_key == action_key:
                s_sem = 1.0
            elif link_key == 'back' and action_key != 'back':
                s_sem = -1.0
            else:
                s_sem = 0.0
        # Light bias only: penalize back unless intent explicitly says back
        if link_key == 'back' and action_key != 'back':
            s_sem -= 0.25

        # Deterministic boost if metadata matches structured hints in intent
        intent_lc = (llm_text or '').lower()
        meta = ln.get('meta') or {}
        if isinstance(meta, dict):
            pn = str(meta.get('product_name') or '').lower()
            pid = str(meta.get('product_id') or '').lower()
            if pn and any(tok in pn for tok in ['diamond', 'ring']) and 'ring' in intent_lc:
                s_sem += 0.25
            if pid and pid in intent_lc:
                s_sem += 0.40
            if (meta.get('role') or '').lower() == 'product_card':
                s_sem += 0.10

        # Embedding/lexical semantic similarity on rich text (dominant signal now)
        cand_text_parts = [
            str(ln.get('user_intent') or ''),
            str(ln.get('click_target') or ''),
            str(ln.get('source_element_name') or ''),
            str(meta.get('product_name') or '') if isinstance(meta, dict) else '',
            str(meta.get('product_id') or '') if isinstance(meta, dict) else '',
        ]
        cand_text = ' '.join([p for p in cand_text_parts if p])
        s_embed = _semantic_similarity(llm_text or '', cand_text)

        # Final score: let semantics dominate; keep small spatial/annotation influence
        score = 0.20 * s_loc + 0.20 * s_ann + 0.15 * s_sem + 0.45 * s_embed
        if score > best_score:
            best_score = score
            best = ln

    return best if best_score >= 0.35 else None

def compute_first_action(persona_user: dict | None, audit: dict | None, goal: str | None,
                         llm_action_text: str | None, delta: float, tie: float, min_score: float,
                         allowed_actions: set[str] | None = None) -> dict:
    ocean = (persona_user or {}).get('ocean') or {}
    O = float(ocean.get('O') or ocean.get('o') or 0.5)
    C = float(ocean.get('C') or ocean.get('c') or 0.5)
    E = float(ocean.get('E') or ocean.get('e') or 0.5)
    A = float(ocean.get('A') or ocean.get('a') or 0.5)
    N = float(ocean.get('N') or ocean.get('n') or 0.5)
    risk = str((persona_user or {}).get('risk_appetite') or '').lower()
    risk_high = 1.0 if risk in {'high','very high','vh','h'} else 0.0

    # Candidate actions
    candidates = {
        'search': {
            'location': 'top',
            'label': 'search bar',
        },
        'grid': {
            'location': 'bottom bar, 2nd from left',
            'label': 'grid icon',
        },
        'wishlist': {
            'location': 'header or bottom bar',
            'label': 'wishlist heart',
        },
        'profile': {
            'location': 'bottom bar, right',
            'label': 'profile icon',
        }
    }

    # Scoring
    scores: dict = {}
    breakdown: dict = {}
    hard_to_see = _ui_visibility_flag(audit)
    for a in candidates.keys():
        goal_aff = _goal_affinity_for(a, goal)
        structure = 0.0
        structure += 0.2 if C > 0.6 and a == 'search' else 0.0
        structure -= 0.1 if C > 0.6 and a == 'grid' else 0.0
        structure += 0.1 if C < 0.4 and a == 'grid' else 0.0
        structure -= 0.1 if C < 0.4 and a == 'search' else 0.0

        exploration = 0.0
        if O > 0.7 or risk_high:
            exploration += 0.2 if a == 'grid' else 0.0
            exploration -= 0.1 if a == 'search' else 0.0
        elif O < 0.4:
            exploration += 0.1 if a == 'search' else 0.0

        # Synergies
        if O > 0.7 and C < 0.4:
            exploration += 0.05 if a == 'grid' else 0.0
        if C > 0.7 and N < 0.4:
            goal_aff += 0.10

        ui_conf = _ui_confidence_for(a, audit, hard_to_see)
        amb = _ambiguity_penalty_for(a, goal, N)
        small = _small_adjustments(a, E, A)

        total = 0.5 * goal_aff + 0.2 * structure + 0.15 * exploration + 0.1 * ui_conf - 0.1 * amb + small
        # Mild stochasticity: lower C => more variance
        total += random.normalvariate(0.0, 0.05 * (1.0 - max(0.0, min(1.0, C))))
        scores[a] = total
        breakdown[a] = {
            'goal_affinity': round(goal_aff, 3),
            'structure_bias': round(structure, 3),
            'exploration_bias': round(exploration, 3),
            'ui_confidence': round(ui_conf, 3),
            'ambiguity_penalty': round(amb, 3),
            'small_adjustments': round(small, 3),
            'total': round(total, 3),
        }

    # Decide
    ordered = sorted(
        [(k, v) for k, v in scores.items() if (not allowed_actions or k in allowed_actions)],
        key=lambda kv: kv[1], reverse=True
    )
    top, second = ordered[0], (ordered[1] if len(ordered) > 1 else (None, None))
    top_key, top_score = top[0], float(top[1])
    second_score = float(second[1]) if second[0] is not None else -1.0
    gap = float(top_score - second_score) if second[0] is not None else 1.0

    # Eligibility & minimum score
    decision = top_key
    if top_score < min_score:
        # pick the best above min_score or fallback to top
        for k, v in ordered:
            if v >= min_score:
                decision = k
                break
        else:
            decision = top_key

    llm_key = _map_llm_action_to_key(llm_action_text or '')
    decision_method = 'aligned'
    override_reason = ''
    tie_policy = ''
    if llm_key is None:
        decision_method = 'fallback'
        override_reason = 'LLM suggestion missing or unrecognized; used deterministic top action.'
    else:
        # If LLM differs and gap exceeds delta, override; if tie-ish, use tie policy
        if llm_key != decision and abs(scores.get(decision, 0.0) - scores.get(llm_key, -1.0)) >= float(delta):
            decision_method = 'overridden'
            override_reason = 'Deterministic scoring favored a different action given persona and goal.'
        elif llm_key != decision and gap < float(tie):
            # tie policy by persona
            if O > 0.6 or risk_high:
                decision = 'grid'
                tie_policy = 'exploratory'
            elif C > 0.6 and N < 0.6:
                decision = 'search'
                tie_policy = 'structured'
            else:
                decision = decision  # keep top
            decision_method = 'aligned' if decision == llm_key else 'overridden'
            override_reason = 'Tie policy applied.' if decision_method == 'overridden' else ''
        else:
            decision = llm_key
            decision_method = 'aligned'

    # Build natural-language instruction with preference order:
    # 1) Use LLM's own phrasing if it maps to the same decided key
    # 2) Else try to have the LLM compose a short instruction for the decided action
    # 3) Else fall back to a deterministic dynamic composition (no fixed phrases)
    final_text = ''
    if llm_key == decision and isinstance(llm_action_text, str) and llm_action_text.strip():
        final_text = llm_action_text.strip()
    if not final_text:
        # Try LLM composition for the decided action (best effort)
        final_text = _llm_compose_action_text(os.getenv('MODEL_NAME', 'gemini-2.5-pro'), goal or '', '', decision, {}) or ''
    if not final_text:
        final_text = _compose_action_instruction(decision, candidates, goal)

    struct = {
        'llm_suggested_action': llm_key or '',
        'deterministic_override_action': decision,
        'final_action': decision,
        'decision_method': decision_method,
        'override_reason': override_reason,
        'scores': breakdown,
        'score_gap': round(gap, 3),
        'decision_thresholds': {
            'delta': float(delta), 'tie': float(tie), 'min_score': float(min_score)
        },
        'tie_policy': tie_policy,
        'eligibility_notes': {
            'top_right_icons_visibility_penalty_applied': bool(hard_to_see)
        }
    }
    # Add normalized control/location/rationale for convenience
    if decision in candidates:
        struct.update({
            'control': candidates[decision]['label'],
            'location': candidates[decision]['location'],
            'rationale': 'Chosen based on persona- and goal-weighted scoring.',
        })
    # Natural-language versions of the suggested/override actions
    struct['llm_suggested_text'] = str(llm_action_text or '')
    struct['deterministic_text'] = final_text
    return {
        'first_action_text': final_text,
        'first_action_key': decision,
        'first_action_struct': struct,
    }


def build_links_review_prompt(goal: str, links: list[dict], persona_note: str | None) -> str:
    bullets = []
    for ln in links[:12]:
        ct = str(ln.get('click_target') or '')
        lid = ln.get('linkId')
        label = str(ln.get('source_element_name') or '')
        bullets.append(f"- linkId={lid} label='{label}' target='{ct}'")
    links_text = "\n".join(bullets) if bullets else "- (none)"
    persona_line = (persona_note or '').strip()
    return (
        "You are the same user viewing the same screen, but your previous intended action wasn't possible because no matching tap target existed. "
        f"User goal: {goal}. \n"
        "Here are the available tap targets (each has a unique linkId):\n"
        f"{links_text}\n\n"
        "Task: In FIRST PERSON, write a ~150‑word reflection reviewing these options and your willingness to try each given your goal. "
        "Then choose exactly one of these options as your next step.\n"
        "Return STRICT JSON with keys: {\n"
        "  links_review_narrative,\n"
        "  second_emotion, second_emotion_detail,\n"
        "  second_narrative, second_goal_based_narrative,\n"
        "  second_action, second_action_struct,\n"
        "  chosen_link_id\n"
        "}.\n"
        "Rules: chosen_link_id must be one of the linkId values listed above. second_action should describe that same link unambiguously."
        + (f"\nPersona context: {persona_line}" if persona_line else "")
    )


def generate_second_step_with_llm(goal: str, links: list[dict], persona_user: dict | None, model_name: str) -> dict:
    try:
        import google.generativeai as genai
    except Exception as e:
        return {}
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        return {}
    try:
        if not getattr(generate_second_step_with_llm, '_GENAI_READY', False):
            genai.configure(api_key=api_key)
            setattr(generate_second_step_with_llm, '_GENAI_READY', True)
    except Exception:
        genai.configure(api_key=api_key)
    persona_note = persona_instructions_for(persona_user, derive_user_bias(persona_user))
    prompt = build_links_review_prompt(goal, links, persona_note)
    try:
        model = _get_generative_model(model_name) or genai.GenerativeModel(model_name)
        resp = _rate_limited_generate(model, [{ 'text': prompt }], timeout_sec=int(os.getenv('LLM_TIMEOUT_SEC','30')))
        text = (getattr(resp, 'text', '') or '').strip()
        if text.startswith('```'):
            text = text.strip('`')
            if text.startswith('json'):
                text = text[4:]
        data = json.loads(text)
        # Ensure chosen_link_id parsed as is; keep dict shape
        if isinstance(data, dict):
            return data
        return {}
    except Exception:
        return {}


def build_base_prompt() -> str:
    return (
        "You are acting as a real user looking at a single mobile app screen image. "
        "Write a FIRST-PERSON narrative (100–200 words) about what you see, what this screen is about, "
        "what you think you can do next, and how you feel. Include an explicit emotion label at the end. "
        "Be concrete about layout (top, bottom, icons you notice) and primary action. "
        "Also include 1–3 short micro_thoughts (first-person, 2–8 words each) and an emotion_curve array of 2–3 labels showing how feelings shift while reading the screen (e.g., ['curious','uncertain','motivated']). "
        "Return STRICT JSON with keys: {\"narrative\": string, \"emotion\": string, \"emotion_detail\": string (50-75 words), \"micro_thoughts\": string[], \"emotion_curve\": string[]}."
    )


def build_goal_prompt(goal: str) -> str:
    return (
        "You are the same user, but now consider the user's overall goal when viewing this same screen. "
        f"Overall goal: {goal}. "
        "Write a FIRST-PERSON narrative (100–200 words) focused on how this screen helps or blocks progress toward the goal, "
        "and what you intend to do next to make progress. Then specify the immediate next tap as a concise instruction: "
        "where to tap (element and on-screen location, e.g., 'top-right search icon', 'grid tab in bottom bar'), and why. "
        "Return STRICT JSON with keys: {\"goal_based_narrative\": string, \"first_action\": string, \"goal_emotion_detail\": string (50-75 words), \"first_action_struct\": { \"control\": string, \"location\": string, \"rationale\": string } }."
    )


def build_ux_audit_prompt(goal: str | None = None) -> str:
    base = (
        "Generate a FIRST-PERSON UX audit snapshot from this single screen context. "
        "Use Nielsen/NN/good-practice heuristics. For each detected issue, write: \n"
        "- heuristic (string)\n"
        "- problem_my_experience (1-3 sentences, first person)\n"
        "- recommendation_user_voice (1-2 sentences starting with 'I wish' or 'It would help if')\n"
        "- feeling (short clause in first person)\n"
        "- severity_0_1 (number, 0..1 where 1 is severe)\n"
        "Return STRICT JSON with keys: {\"issues\": [ ... ], \"overall_reflection\": string}. "
        "Keep issues concise and actionable (max 3 issues)."
    )
    if goal and str(goal).strip():
        base += f" Consider the user's overall goal: {goal}."
    return base


def generate_first_person_description(image_path: pathlib.Path, model_name: str, goal: str | None = None, user: dict | None = None, previous_input: str | None = None, available_links: list[dict] | None = None) -> dict:
    try:
        import google.generativeai as genai
    except Exception as e:
        raise RuntimeError(f"google-generativeai not installed or failed to import: {e}")

    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        raise RuntimeError('Missing GEMINI_API_KEY/GOOGLE_API_KEY in environment/.env')

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)

    # --- Pass 1: baseline narrative (no goal bias) ---
    persona_note = persona_instructions_for(user, derive_user_bias(user))
    parts1 = [
        {"text": build_base_prompt()},
        {"inline_data": {"mime_type": "image/png", "data": encode_image_png(image_path)}},
    ]
    if persona_note:
        parts1.append({"text": persona_note})
    if previous_input:
        parts1.append({"text": f"Previous screen input (for continuity): {previous_input}"})
    resp1 = _rate_limited_generate(model, parts1, timeout_sec=int(os.getenv('LLM_TIMEOUT_SEC', '30')))
    text1 = (getattr(resp1, 'text', '') or '').strip()
    if text1.startswith('```'):
        text1 = text1.strip('`')
        if text1.startswith('json'):
            text1 = text1[4:]
    try:
        data1 = json.loads(text1)
    except Exception:
        data1 = {"narrative": text1[:1000].strip(), "emotion": "Neutral"}

    out: dict = {
        "narrative": str(data1.get('narrative') or '').strip() or (text1[:1000].strip() or "I am viewing a mobile screen."),
        "emotion": str(data1.get('emotion') or 'Neutral').strip() or 'Neutral',
    }
    # Optional extras from base pass
    mt = data1.get('micro_thoughts') if isinstance(data1, dict) else None
    ec = data1.get('emotion_curve') if isinstance(data1, dict) else None
    if isinstance(mt, list):
        out['micro_thoughts'] = [str(x)[:80] for x in mt[:3] if str(x).strip()]
    if isinstance(ec, list):
        out['emotion_curve'] = [str(x)[:40] for x in ec[:3] if str(x).strip()]
    emo_detail = str(data1.get('emotion_detail') or '').strip()
    if not emo_detail:
        emo_detail = _fallback_emotion_detail(out["emotion"], out["narrative"])
    else:
        emo_detail = _bound_words(emo_detail, 50, 75)
    out["emotion_detail"] = emo_detail

    # --- Pass 2: goal-focused narrative and first action ---
    if goal and str(goal).strip():
        parts2 = [
            {"text": build_goal_prompt(goal)},
            {"inline_data": {"mime_type": "image/png", "data": encode_image_png(image_path)}},
        ]
        if persona_note:
            parts2.append({"text": persona_note})
        if previous_input:
            parts2.append({"text": f"Previous screen input (for continuity): {previous_input}"})
        resp2 = _rate_limited_generate(model, parts2, timeout_sec=int(os.getenv('LLM_TIMEOUT_SEC', '30')))
        text2 = (getattr(resp2, 'text', '') or '').strip()
        if text2.startswith('```'):
            text2 = text2.strip('`')
            if text2.startswith('json'):
                text2 = text2[4:]
        try:
            data2 = json.loads(text2)
        except Exception:
            data2 = {}
        gbn = str(data2.get('goal_based_narrative') or '').strip()
        first = str(data2.get('first_action') or '').strip()
        ged = str(data2.get('goal_emotion_detail') or '').strip()
        fas = data2.get('first_action_struct') if isinstance(data2, dict) else None
        if not gbn:
            gbn = (
                f"With my goal '{goal}', I would focus on the most direct control visible here and proceed—"
                f"for example, use search at the top-right or open the grid/catalog tab in the bottom bar to find an item and save it."
            )
        if not first:
            first = (
                "Tap the most relevant control for the goal: e.g., the top-right search icon to find an item, "
                "or the grid/catalog tab in the bottom bar to browse products, then add one to the wishlist."
            )
        if not ged:
            ged = _fallback_emotion_detail(out.get("emotion", "Neutral"), gbn)
        else:
            ged = _bound_words(ged, 50, 75)
        out["goal_based_narrative"] = gbn
        out["first_action"] = first
        out["goal_emotion_detail"] = ged
        if isinstance(fas, dict):
            out["first_action_struct"] = {
                "control": str(fas.get('control') or '').strip() or "",
                "location": str(fas.get('location') or '').strip() or "",
                "rationale": str(fas.get('rationale') or '').strip() or "",
            }

        # LLM is source of truth for first_action; constrain only by available_links
        llm_action_text = out.get('first_action')
        # Build allowed_actions set from available_links (passed in) if present
        allowed_actions: set[str] | None = None
        try:
            links_to_use = available_links if isinstance(available_links, list) else out.get('available_links')
            if isinstance(links_to_use, list) and links_to_use:
                allowed: set[str] = set()
                for ln in links_to_use:
                    k = _map_click_target_to_key(ln.get('click_target'))
                    if k:
                        allowed.add(k)
                if allowed:
                    allowed_actions = allowed
        except Exception:
            allowed_actions = None

        llm_key = _map_llm_action_to_key(llm_action_text or '')
        chosen_allowed = True
        if allowed_actions is not None and llm_key not in allowed_actions:
            chosen_allowed = False
        if allowed_actions is None and isinstance(out.get('available_links'), list):
            chosen_allowed = any(_map_click_target_to_key((ln.get('click_target') or '')) == llm_key for ln in out.get('available_links'))

        # Annotate struct with decision source
        fas_here = out.get('first_action_struct') or {}
        fas_here['decision_source'] = 'llm'
        fas_here['final_action'] = llm_key or ''
        out['first_action_struct'] = fas_here

        # If LLM-intended action not available, run second-step recovery with LLM constrained to links
        if not chosen_allowed and isinstance(links_to_use, list) and links_to_use:
            # Mark UX audit entry for broken affordance
            ua = out.setdefault('ux_audit', {'issues': []})
            try:
                ua.setdefault('issues', []).append({
                    'heuristic': 'Visibility of system status',
                    'problem_my_experience': 'I intended to use this control, but there was no tappable target on this screen for that action.',
                    'recommendation_user_voice': 'I wish the intended control was truly tappable here or an obvious alternative was highlighted.',
                    'feeling': 'feeling blocked and uncertain',
                    'severity_0_1': 0.7
                })
            except Exception:
                pass

            # Ask LLM to review available links and propose second action
            second = generate_second_step_with_llm(goal or '', links_to_use or [], user, os.getenv('MODEL_NAME', 'gemini-2.5-pro'))
            if isinstance(second, dict) and second:
                out['links_review_narrative'] = str(second.get('links_review_narrative') or '')
                out['second_emotion'] = str(second.get('second_emotion') or '')
                out['second_emotion_detail'] = str(second.get('second_emotion_detail') or '')
                out['second_narrative'] = str(second.get('second_narrative') or '')
                out['second_goal_based_narrative'] = str(second.get('second_goal_based_narrative') or '')
                out['second_action'] = str(second.get('second_action') or '')
                if isinstance(second.get('second_action_struct'), dict):
                    out['second_action_struct'] = second.get('second_action_struct')
                # new: carry chosen_link_id for deterministic binding
                if 'chosen_link_id' in second:
                    out['chosen_link_id'] = second.get('chosen_link_id')
                # Override final action with second action
                # final_action selection: prefer second_action if present; else fallback to first_action
                if out.get('second_action'):
                    out['final_action'] = out['second_action']
                    out['final_action_struct'] = out.get('second_action_struct') or {}
                else:
                    out['final_action'] = out.get('first_action')
                    out['final_action_struct'] = out.get('first_action_struct') or {}
            else:
                # No LLM second step; set final_action to first_action
                out['final_action'] = out.get('first_action')
                out['final_action_struct'] = out.get('first_action_struct') or {}
        else:
            # First action was available; final_action equals first_action
            out['final_action'] = out.get('first_action')
            out['final_action_struct'] = out.get('first_action_struct') or {}

        # --- Pass 3: UX audit snapshot (heuristics + overall reflection) ---
        parts3 = [
            {"text": build_ux_audit_prompt(goal)},
            {"inline_data": {"mime_type": "image/png", "data": encode_image_png(image_path)}},
        ]
        if persona_note:
            parts3.append({"text": persona_note})
        if previous_input:
            parts3.append({"text": f"Previous screen input (for continuity): {previous_input}"})
        try:
            resp3 = _rate_limited_generate(model, parts3, timeout_sec=int(os.getenv('LLM_TIMEOUT_SEC', '30')))
            text3 = (getattr(resp3, 'text', '') or '').strip()
            if text3.startswith('```'):
                text3 = text3.strip('`')
                if text3.startswith('json'):
                    text3 = text3[4:]
            data3 = json.loads(text3)
            issues = data3.get('issues') or []
            overall = str(data3.get('overall_reflection') or '').strip()
        except Exception:
            issues = []
            overall = ''
        # Fallback minimal audit
        if not issues:
            issues = [
                {
                    "heuristic": "Visibility of system status",
                    "problem_my_experience": "I tapped an action but didn’t see a clear confirmation. I wasn’t sure if it worked.",
                    "recommendation_user_voice": "I wish the app showed a quick checkmark or toast so I’d know it succeeded.",
                    "feeling": "It made me pause and second‑guess the result.",
                    "severity_0_1": 0.6
                }
            ]
        if not overall:
            overall = (
                "As I used this screen, I felt curious but occasionally unsure whether my actions were registering. "
                "Clearer confirmations and a more direct path toward my goal would help me move forward confidently."
            )
        out["ux_audit"] = {"issues": issues, "overall_reflection": overall}

    return out


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Describe a screen image in first-person using Gemini')
    parser.add_argument('--image', required=False, help='Path to the screenshot image (PNG/JPG)')
    parser.add_argument('--screen-id', type=int, default=None, help='Optional screen id to resolve image via screen_nodes.json (single-screen mode)')
    parser.add_argument('--source-screen-id', type=int, default=None, help='Journey mode: source screen id')
    parser.add_argument('--target-screen-id', type=int, default=None, help='Journey mode: target screen id')
    parser.add_argument('--screen-nodes', default=None, help='Path to screen_nodes.json for resolving --screen-id')
    parser.add_argument('--screens-dir', default=None, help='Directory containing screen images; inferred from screen_nodes.json if omitted')
    parser.add_argument('--links-json', default=None, help='Path to prototype_links_enriched.json to enumerate available links (no decisions)')
    parser.add_argument('--model', default=os.getenv('MODEL_NAME', 'gemini-2.5-pro'), help='Gemini model name')
    parser.add_argument('--out', default='-', help='Output path for JSON; use - for stdout')
    parser.add_argument('--goal', default=None, help='Optional overall user goal to generate goal_based_narrative and first_action')
    parser.add_argument('--max-issues', type=int, default=int(os.getenv('UX_MAX_ISSUES', '3')), help='Maximum UX audit issues to include (default 3)')
    parser.add_argument('--min-severity', type=float, default=float(os.getenv('UX_MIN_SEVERITY', '0.0')), help='Minimum severity_0_1 to include (0..1, default 0.0)')
    parser.add_argument('--user-id', default=None, help='Optional user id to bias outputs')
    parser.add_argument('--users-path', default=str(pathlib.Path(__file__).resolve().parent.parent / 'users' / 'users.json'), help='Path to users.json for persona lookup')
    parser.add_argument('--user-ids', default=None, help='Comma-separated list of user ids to run in parallel (journey mode supported)')
    parser.add_argument('--persona', dest='persona_id', default=None, help='Optional persona id; when set, create proj/test/persona{persona}/user{user} alongside preprocess')
    args = parser.parse_args()

    # Journey mode gate: if source-screen-id and target-screen-id provided, we will iterate screens.
    journey_mode = args.source_screen_id is not None and args.target_screen_id is not None

    # Resolve image path via --image or --screen-id
    img_path: pathlib.Path
    resolved_screen_id: str | None = None
    if args.image:
        img_path = pathlib.Path(args.image)
        # Try to resolve screen_id by matching filename in screen_nodes.json if provided
        if args.screen_nodes:
            try:
                nodes_path_try = pathlib.Path(args.screen_nodes)
                if nodes_path_try.exists():
                    nodes_try = json.loads(nodes_path_try.read_text(encoding='utf-8'))
                    base = img_path.name
                    for n in (nodes_try or []):
                        if str(n.get('file') or '') == base:
                            resolved_screen_id = str(n.get('screen_id') or '') or None
                            break
            except Exception:
                pass
    elif args.screen_id is not None or journey_mode:
        if not args.screen_nodes:
            print("ERROR: --screen-nodes is required when using --screen-id or journey mode", file=sys.stderr)
            sys.exit(2)
        nodes_path = pathlib.Path(args.screen_nodes)
        if not nodes_path.exists():
            print(f"ERROR: screen_nodes.json not found at {nodes_path}", file=sys.stderr)
            sys.exit(2)
        try:
            nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"ERROR: failed to read screen_nodes.json: {e}", file=sys.stderr)
            sys.exit(2)
        # Helper to fetch record by numeric id
        def get_rec_by_id(num_id: int):
            for n in (nodes or []):
                try:
                    if int(n.get('id')) == int(num_id):
                        return n
                except Exception:
                    continue
            return None

        if journey_mode:
            # Defer single image resolution; we'll iterate below
            rec_src = get_rec_by_id(int(args.source_screen_id))
            if not rec_src:
                print(f"ERROR: source screen id {args.source_screen_id} not found in {nodes_path}", file=sys.stderr)
                sys.exit(2)
            # we will use screens_dir for each step
            screens_dir = pathlib.Path(args.screens_dir) if args.screens_dir else nodes_path.parent / 'screens'
            img_path = screens_dir / str(rec_src.get('file') or '')
            resolved_screen_id = str(rec_src.get('screen_id') or '') or None
        else:
            rec = get_rec_by_id(int(args.screen_id))
            if not rec:
                print(f"ERROR: screen id {args.screen_id} not found in {nodes_path}", file=sys.stderr)
                sys.exit(2)
            filename = str(rec.get('file') or '').strip()
            if not filename:
                print(f"ERROR: record for screen id {args.screen_id} lacks 'file' field", file=sys.stderr)
                sys.exit(2)
            resolved_screen_id = str(rec.get('screen_id') or '') or None
            # Infer screens dir if not provided: <nodes_dir>/screens
            screens_dir = pathlib.Path(args.screens_dir) if args.screens_dir else nodes_path.parent / 'screens'
            img_path = screens_dir / filename
    else:
        print("ERROR: provide either --image or --screen-id with --screen-nodes", file=sys.stderr)
        sys.exit(2)

    if not img_path.exists():
        print(f"Image not found: {img_path}", file=sys.stderr)
        sys.exit(1)

    # For non-PNG inputs, read bytes directly; SDK accepts image/png; converting is optional here
    if img_path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
        print("Warning: unusual image extension; proceeding anyway", file=sys.stderr)

    # Resolve persona
    persona_user = None
    if args.user_id:
        persona_user = load_user_by_id(pathlib.Path(args.users_path), args.user_id)

    # Parallel multi-user execution (runs each user in its own thread)
    if args.user_ids:
        ids = [s.strip() for s in str(args.user_ids).split(',') if s.strip()]
        if not ids:
            print('ERROR: --user-ids provided but empty', file=sys.stderr)
            sys.exit(2)

        # Prepare helpers captured from outer scope
        if args.out and args.out != '-':
            base_out_dir = pathlib.Path(args.out).parent
        else:
            try:
                base_out_dir = pathlib.Path(args.screen_nodes).parent if args.screen_nodes else pathlib.Path('.')
            except Exception:
                base_out_dir = pathlib.Path('.')
        src_tag = args.source_screen_id if args.source_screen_id is not None else 'src'
        tgt_tag = args.target_screen_id if args.target_screen_id is not None else 'tgt'

        def run_for_user(user_id_value: str):
            user_persona = load_user_by_id(pathlib.Path(args.users_path), user_id_value)
            out_user = base_out_dir / f"journey_{src_tag}_to_{tgt_tag}_user{user_id_value}.json"
            # Journey vs single
            if not journey_mode:
                res_single = generate_first_person_description(img_path, args.model, args.goal, user_persona, previous_input=None)
                out_user.parent.mkdir(parents=True, exist_ok=True)
                out_user.write_text(json.dumps(res_single, ensure_ascii=False, indent=2), encoding='utf-8')
                return
            # Journey mode
            steps_local: list[dict] = []
            # Streaming logs
            stream_local = out_user.parent / (out_user.stem + '.jsonl')
            if stream_local.exists():
                stream_local.unlink()
            stream_test = None
            if args.persona_id:
                try:
                    preprocess_dir = out_user.parent
                    proj_root = preprocess_dir.parent
                    test_dir = proj_root / 'test' / f"persona{args.persona_id}" / f"user{user_id_value}"
                    test_dir.mkdir(parents=True, exist_ok=True)
                    stream_test = test_dir / (out_user.stem + '.jsonl')
                    if stream_test.exists():
                        stream_test.unlink()
                except Exception:
                    stream_test = None

            # Seed current record
            current_rec_local = None
            try:
                # get_rec_by_id defined earlier in journey setup
                current_rec_local = get_rec_by_id(int(args.source_screen_id)) if 'get_rec_by_id' in locals() else None
            except Exception:
                current_rec_local = None
            current_sid_local = str(current_rec_local.get('screen_id')) if current_rec_local else resolved_screen_id
            target_sid_local = None
            try:
                tr_local = get_rec_by_id(int(args.target_screen_id)) if 'get_rec_by_id' in locals() else None
                if tr_local:
                    target_sid_local = str(tr_local.get('screen_id') or '') or None
            except Exception:
                target_sid_local = None
            prev_in = None
            visited_sids: list[str] = []
            max_hops = int(os.getenv('JOURNEY_MAX_STEPS', '10'))
            for hop in range(max_hops):
                curr_file = current_rec_local.get('file') if current_rec_local else None
                curr_img = (screens_dir / curr_file) if curr_file else img_path
                links_here = []
                if args.links_json:
                    try:
                        enp = pathlib.Path(args.links_json)
                        rows = json.loads(enp.read_text(encoding='utf-8')) if enp.exists() else []
                    except Exception:
                        rows = []
                    sid_here = str(current_sid_local)
                    for row in (rows or []):
                        try:
                            if str(row.get('source_screen_id') or '') == sid_here:
                                links_here.append({
                                    'linkId': row.get('linkId'),
                                    'click_target': row.get('click_target'),
                                    'user_intent': row.get('user_intent'),
                                    'elem_bbox_norm': row.get('elem_bbox_norm'),
                                    'ui_role': row.get('ui_role'),
                                    'meta': row.get('meta'),
                                    'source_element_name': row.get('source_element_name'),
                                    'source_element_id': row.get('source_element_id'),
                                    'destination_screen_id': row.get('destination_screen_id'),
                                })
                        except Exception:
                            continue
                one_raw = generate_first_person_description(curr_img, args.model, args.goal, user_persona, prev_in, available_links=links_here)
                frame_name = str((current_rec_local or {}).get('name') or (current_rec_local or {}).get('file') or '')
                header = {
                    'step': hop + 1,
                    'screen_id': current_sid_local,
                    'frame_name': frame_name,
                    'screen_header': f"Screen Step {hop+1}",
                }
                if links_here:
                    header['available_links'] = links_here
                one = { **header, **one_raw }
                # Pre-enrich with baseline metrics
                one['is_goal_screen'] = bool(target_sid_local and str(current_sid_local) == str(target_sid_local))
                # Emotion before action
                one['emotion_before_action'] = one.get('emotion')
                _append_jsonl(stream_local, one)
                if stream_test is not None:
                    _append_jsonl(stream_test, one)
                if target_sid_local and str(current_sid_local) == str(target_sid_local):
                    steps_local.append(one)
                    break
                # Choose next via first_action else fallback from links
                next_sid = None
                try:
                    chosen = None
                    fa = one.get('first_action') if isinstance(one.get('first_action'), str) else ''
                    if fa and fa.strip():
                        cand = _fuse_match_to_link(fa or '', one.get('available_links') or [], current_rec_local or {}, screens_dir)
                        if cand and cand.get('destination_screen_id'):
                            chosen = cand
                            one['final_action'] = one.get('first_action')
                            one['final_action_struct'] = one.get('first_action_struct') or {}
                            one['action_type'] = 'primary'
                    if not chosen:
                        # Fallback lexical overlap
                        def _toks(s: str) -> set:
                            import re
                            return set(t for t in re.findall(r'[a-zA-Z0-9]+', (s or '').lower()) if len(t) > 2)
                        pref_text = ' '.join([
                            str(one.get('links_review_narrative') or ''),
                            str(one.get('goal_based_narrative') or ''),
                            str(args.goal or ''),
                            str(fa or ''),
                        ])
                        q = _toks(pref_text)
                        best_ln, best_sc = None, -1
                        for ln in (one.get('available_links') or []):
                            cand_text = ' '.join([
                                str(ln.get('user_intent') or ''),
                                str(ln.get('click_target') or ''),
                                str(ln.get('source_element_name') or ''),
                            ])
                            sc = len(q.intersection(_toks(cand_text)))
                            if sc > best_sc and ln.get('destination_screen_id'):
                                best_ln, best_sc = ln, sc
                        if best_ln:
                            chosen = best_ln
                            one['action_type'] = 'fallback'
                    if chosen:
                        next_sid = str(chosen.get('destination_screen_id'))
                        if not one.get('final_action'):
                            one['final_action'] = str(chosen.get('click_target') or '')
                            one['final_action_struct'] = {
                                'control': str(chosen.get('source_element_name') or ''),
                                'location': '',
                                'rationale': 'Chosen from available_links based on user goal/preferences',
                                'decision_source': 'fallback_available_links',
                                'linkId': chosen.get('linkId'),
                            }
                        # decision confidence via embedding similarity top-2
                        try:
                            inten = fa or one.get('final_action') or ''
                            scores = []
                            for ln in (one.get('available_links') or []):
                                cand_text = ' '.join([
                                    str(ln.get('user_intent') or ''),
                                    str(ln.get('click_target') or ''),
                                    str(ln.get('source_element_name') or ''),
                                ])
                                scores.append(_semantic_similarity(inten, cand_text))
                            scores.sort(reverse=True)
                            one['decision_confidence'] = round(float(scores[0] - (scores[1] if len(scores) > 1 else 0.0)), 3) if scores else 0.0
                        except Exception:
                            one['decision_confidence'] = 0.0
                except Exception:
                    next_sid = None
                # Enrich per-step metrics
                one['next_screen_id'] = next_sid or ''
                one['backtrack_flag'] = bool(next_sid and next_sid in visited_sids)
                # Dwell time and hesitation
                try:
                    import random as _rnd
                    dwell = max(0.6, min(6.0, 2.0 + _rnd.normalvariate(0.0, 0.6)))
                except Exception:
                    dwell = 2.0
                one['time_on_screen'] = round(float(dwell), 3)
                one['hesitation_score'] = one['time_on_screen']
                # Friction metrics
                try:
                    issues = ((one.get('ux_audit') or {}).get('issues') or [])
                    one['friction_points'] = int(len(issues))
                    one['severity_weighted_friction'] = round(float(sum(float((it or {}).get('severity_0_1') or 0.0) for it in issues)), 3)
                except Exception:
                    one['friction_points'] = 0
                    one['severity_weighted_friction'] = 0.0
                # Exit flag if no next and not at goal
                one['exit_flag'] = bool((not next_sid) and not one.get('is_goal_screen'))
                # Emotion after action
                one['emotion_after_action'] = one.get('second_emotion') or one.get('emotion')
                # Simple TEA label placeholder
                one['tea_cluster_label'] = None
                steps_local.append(one)
                if not next_sid or not nodes:
                    break
                current_sid_local = next_sid
                visited_sids.append(current_sid_local)
                current_rec_local = None
                for n in (nodes or []):
                    if str(n.get('screen_id') or '') == str(current_sid_local):
                        current_rec_local = n
                        break
                prev_in = (one.get('links_review_narrative') or one.get('goal_based_narrative') or '')
            res_journey = {'journey': steps_local}
            out_user.parent.mkdir(parents=True, exist_ok=True)
            out_user.write_text(json.dumps(res_journey, ensure_ascii=False, indent=2), encoding='utf-8')

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(ids))) as ex:
            futs = [ex.submit(run_for_user, uid) for uid in ids]
            for f in concurrent.futures.as_completed(futs):
                _ = f.result()
        # After all users complete, build a persona-level summary in proj/test/persona{persona}
        try:
            if args.persona_id:
                persona_root = base_out_dir.parent / 'test' / f"persona{args.persona_id}"
                persona_root.mkdir(parents=True, exist_ok=True)
                summaries = []
                agg = {
                    'total_users': 0,
                    'completed': 0,
                    'early_exits': 0,
                    'total_steps': 0,
                    'total_backtracks': 0,
                    'sum_friction_weighted': 0.0,
                    'sum_hesitation': 0.0,
                    'decision_volatility': 0,
                }
                for uid in ids:
                    user_dir = persona_root / f"user{uid}"
                    # Prefer test stream; fallback to local .jsonl
                    stem = f"journey_{src_tag}_to_{tgt_tag}_user{uid}"
                    stream_path = user_dir / (stem + '.jsonl')
                    if not stream_path.exists():
                        stream_path = base_out_dir / (stem + '.jsonl')
                    steps = []
                    try:
                        if stream_path.exists():
                            for line in stream_path.read_text(encoding='utf-8').splitlines():
                                try:
                                    rec = json.loads(line)
                                    steps.append(rec)
                                except Exception:
                                    continue
                    except Exception:
                        steps = []
                    # Aggregate per-user metrics
                    completed = any(bool(s.get('is_goal_screen')) for s in steps)
                    early_exit = (steps and bool(steps[-1].get('exit_flag')))
                    backtracks = sum(1 for s in steps if bool(s.get('backtrack_flag')))
                    sum_fr = sum(float(s.get('severity_weighted_friction') or 0.0) for s in steps)
                    sum_hs = sum(float(s.get('hesitation_score') or 0.0) for s in steps)
                    volatility = sum(1 for s in steps if (s.get('action_type') not in (None, 'primary')))
                    summary = {
                        'user_id': uid,
                        'steps': len(steps),
                        'screens': [{'step': s.get('step'), 'screen_id': s.get('screen_id'), 'frame_name': s.get('frame_name')} for s in steps],
                        'final_action': (steps[-1].get('final_action') if steps else ''),
                        'friction_issues_total': int(sum(len((s.get('ux_audit') or {}).get('issues') or []) for s in steps)),
                        'completed': completed,
                        'early_exit': early_exit,
                        'backtracks': backtracks,
                        'sum_friction_weighted': round(sum_fr, 3),
                        'sum_hesitation': round(sum_hs, 3),
                        'decision_volatility': volatility,
                    }
                    summaries.append(summary)
                    # Update persona aggregates
                    agg['total_users'] += 1
                    agg['completed'] += int(completed)
                    agg['early_exits'] += int(early_exit)
                    agg['total_steps'] += len(steps)
                    agg['total_backtracks'] += backtracks
                    agg['sum_friction_weighted'] += sum_fr
                    agg['sum_hesitation'] += sum_hs
                    agg['decision_volatility'] += volatility
                # Write summary file in persona folder
                aggregate = {
                    'persona_id': args.persona_id,
                    'users_count': agg['total_users'],
                    'completion_rate': round((agg['completed'] / max(1, agg['total_users'])), 3),
                    'early_exit_rate': round((agg['early_exits'] / max(1, agg['total_users'])), 3),
                    'avg_steps': round((agg['total_steps'] / max(1, agg['total_users'])), 3),
                    'total_backtracks': agg['total_backtracks'],
                    'avg_friction_weighted': round((agg['sum_friction_weighted'] / max(1, agg['total_users'])), 3),
                    'avg_hesitation_s': round((agg['sum_hesitation'] / max(1, agg['total_users'])), 3),
                    'decision_volatility_rate': round((agg['decision_volatility'] / max(1, agg['total_users'])), 3),
                }
                (persona_root / 'summary.json').write_text(json.dumps({'persona_id': args.persona_id, 'users': summaries, 'aggregate': aggregate}, ensure_ascii=False, indent=2), encoding='utf-8')
                # Build run-level (all-personas) summary at proj/test/summary.json
                try:
                    test_root = base_out_dir.parent / 'test'
                    totals = {
                        'personas_count': 0,
                        'users_count': 0,
                        'completed': 0,
                        'early_exits': 0,
                        'total_steps': 0,
                        'total_backtracks': 0,
                        'sum_friction_weighted': 0.0,
                        'sum_hesitation': 0.0,
                        'decision_volatility': 0,
                    }
                    per_persona: list[dict] = []
                    if test_root.exists():
                        for pdir in sorted([p for p in test_root.iterdir() if p.is_dir() and p.name.startswith('persona')]):
                            sp = pdir / 'summary.json'
                            if not sp.exists():
                                continue
                            try:
                                pdata = json.loads(sp.read_text(encoding='utf-8'))
                            except Exception:
                                continue
                            agg_p = pdata.get('aggregate') or {}
                            users_list = pdata.get('users') or []
                            users_count = int(agg_p.get('users_count') or len(users_list) or 0)
                            # Derive if aggregate missing
                            if not agg_p:
                                comp = sum(1 for u in users_list if u.get('completed'))
                                early = sum(1 for u in users_list if u.get('early_exit'))
                                steps_sum = sum(int(u.get('steps') or 0) for u in users_list)
                                bktr = sum(int(u.get('backtracks') or 0) for u in users_list)
                                fr = sum(float(u.get('sum_friction_weighted') or 0.0) for u in users_list)
                                hs = sum(float(u.get('sum_hesitation') or 0.0) for u in users_list)
                                vol = sum(int(u.get('decision_volatility') or 0) for u in users_list)
                                agg_p = {
                                    'users_count': users_count,
                                    'completion_rate': (comp / max(1, users_count)),
                                    'early_exit_rate': (early / max(1, users_count)),
                                    'avg_steps': (steps_sum / max(1, users_count)),
                                    'total_backtracks': bktr,
                                    'avg_friction_weighted': (fr / max(1, users_count)),
                                    'avg_hesitation_s': (hs / max(1, users_count)),
                                    'decision_volatility_rate': (vol / max(1, users_count)),
                                }
                            per_persona.append({'persona_id': pdata.get('persona_id'), **agg_p})
                            totals['personas_count'] += 1
                            totals['users_count'] += int(agg_p.get('users_count') or 0)
                            totals['completed'] += int(round((agg_p.get('completion_rate') or 0.0) * (agg_p.get('users_count') or 0)))
                            totals['early_exits'] += int(round((agg_p.get('early_exit_rate') or 0.0) * (agg_p.get('users_count') or 0)))
                            totals['total_steps'] += int(round((agg_p.get('avg_steps') or 0.0) * (agg_p.get('users_count') or 0)))
                            totals['total_backtracks'] += int(agg_p.get('total_backtracks') or 0)
                            totals['sum_friction_weighted'] += float(agg_p.get('avg_friction_weighted') or 0.0) * (agg_p.get('users_count') or 0)
                            totals['sum_hesitation'] += float(agg_p.get('avg_hesitation_s') or 0.0) * (agg_p.get('users_count') or 0)
                            totals['decision_volatility'] += int(round((agg_p.get('decision_volatility_rate') or 0.0) * (agg_p.get('users_count') or 0)))
                    run_summary = {
                        'personas_count': totals['personas_count'],
                        'users_count': totals['users_count'],
                        'completion_rate': round(totals['completed'] / max(1, totals['users_count']), 3),
                        'early_exit_rate': round(totals['early_exits'] / max(1, totals['users_count']), 3),
                        'avg_steps': round(totals['total_steps'] / max(1, totals['users_count']), 3),
                        'total_backtracks': totals['total_backtracks'],
                        'avg_friction_weighted': round(totals['sum_friction_weighted'] / max(1, totals['users_count']), 3),
                        'avg_hesitation_s': round(totals['sum_hesitation'] / max(1, totals['users_count']), 3),
                        'decision_volatility_rate': round(totals['decision_volatility'] / max(1, totals['users_count']), 3),
                        'personas': per_persona,
                    }
                    (test_root / 'summary.json').write_text(json.dumps(run_summary, ensure_ascii=False, indent=2), encoding='utf-8')
                except Exception:
                    pass
        except Exception:
            pass
        # Done; exit early to avoid single-user run
        return

    try:
        if not journey_mode:
            result = generate_first_person_description(img_path, args.model, args.goal, persona_user, previous_input=None)
        else:
            # Journey loop from source to target using available links and final_action
            steps: list[dict] = []
            # Optional streaming log path
            stream_log = None
            try:
                outp = pathlib.Path(args.out) if args.out and args.out != '-' else None
                if outp:
                    # Write a companion .jsonl in same folder
                    stream_log = outp.parent / (outp.stem + '.jsonl')
                    # Truncate existing file
                    if stream_log.exists():
                        stream_log.unlink()
            except Exception:
                stream_log = None
            current_rec = get_rec_by_id(int(args.source_screen_id)) if 'get_rec_by_id' in locals() else None
            current_screen_id = str(current_rec.get('screen_id')) if current_rec else resolved_screen_id
            target_sid = None
            # Resolve target screen_id string
            tr = get_rec_by_id(int(args.target_screen_id)) if 'get_rec_by_id' in locals() else None
            if tr:
                target_sid = str(tr.get('screen_id') or '') or None
            previous_input = None
            max_hops = int(os.getenv('JOURNEY_MAX_STEPS', '150'))
            for hop in range(max_hops):
                # Resolve image path for current
                curr_file = current_rec.get('file') if current_rec else None
                curr_img = (screens_dir / curr_file) if curr_file else img_path
                # Compute available_links for this current screen (before generation) if links-json provided
                links = []
                if args.links_json:
                    try:
                        enp = pathlib.Path(args.links_json)
                        rows = json.loads(enp.read_text(encoding='utf-8')) if enp.exists() else []
                    except Exception:
                        rows = []
                    sid_here = str(current_screen_id)
                for row in (rows or []):
                        try:
                            if str(row.get('source_screen_id') or '') == sid_here:
                                links.append({
                                    'linkId': row.get('linkId'),
                                    'click_target': row.get('click_target'),
                                'user_intent': row.get('user_intent'),
                                    'source_element_name': row.get('source_element_name'),
                                    'source_element_id': row.get('source_element_id'),
                                    'destination_screen_id': row.get('destination_screen_id'),
                                })
                        except Exception:
                            continue
                # Generate per-screen logs with link constraints
                one_raw = generate_first_person_description(curr_img, args.model, args.goal, persona_user, previous_input, available_links=links)
                # Compose a front-matter header so screen_id and frame_name appear first
                frame_name = str((current_rec or {}).get('name') or (current_rec or {}).get('file') or '')
                header = {
                    'step': hop + 1,
                    'screen_id': current_screen_id,
                    'frame_name': frame_name,
                    'screen_header': f"Screen Step {hop+1}",
                }
                if links:
                    header['available_links'] = links
                # Ensure header keys come first in output order
                one = { **header, **one_raw }
                # Stream this step to jsonl immediately (best effort)
                if stream_log is not None:
                    _append_jsonl(stream_log, one)
                # Decide final_action already computed inside generate; if not, fallback
                final_text = one.get('final_action') or one.get('first_action')
                final_struct = one.get('final_action_struct') or one.get('first_action_struct')
                # Move to next screen if not target
                if target_sid and str(current_screen_id) == str(target_sid):
                    steps.append(one)
                    result = {'journey': steps}
                    break
                next_sid = None
                # Prefer deterministic binding using chosen_link_id from second_action when present.
                try:
                    chosen_link = None
                    # 0) chosen_link_id direct
                    chosen_id = one.get('chosen_link_id')
                    if chosen_id is not None:
                        for ln in (one.get('available_links') or []):
                            if str(ln.get('linkId')) == str(chosen_id) and ln.get('destination_screen_id'):
                                chosen_link = ln
                                break

                    # 1) Try final_action text (second_action if present, else first_action)
                    if not chosen_link:
                        intent_text = (one.get('final_action') or one.get('first_action')) or ''
                        if intent_text and isinstance(intent_text, str) and intent_text.strip():
                            cand = _fuse_match_to_link(intent_text, one.get('available_links') or [], current_rec or {}, screens_dir)
                            if cand and cand.get('destination_screen_id'):
                                chosen_link = cand

                    # Fallback 1: semantic key match (align action key to link key)
                    if not chosen_link:
                        try:
                            action_key = _map_llm_action_to_key((one.get('final_action') or one.get('first_action') or '')) or ''
                        except Exception:
                            action_key = ''
                        if action_key:
                            for ln in (one.get('available_links') or []):
                                lk = _map_click_target_to_key(str(ln.get('click_target') or '')) or ''
                                if lk == action_key and ln.get('destination_screen_id'):
                                    chosen_link = ln
                                    break

                    # Fallback 2: token overlap between goal/narratives and link texts
                    if not chosen_link:
                        def _toks(s: str) -> set:
                            import re
                            return set(t for t in re.findall(r'[a-zA-Z0-9]+', (s or '').lower()) if len(t) > 2)
                        pref_text = ' '.join([
                            str(one.get('links_review_narrative') or ''),
                            str(one.get('goal_based_narrative') or ''),
                            str(args.goal or ''),
                            str((one.get('final_action') or one.get('first_action') or '')),
                        ])
                        q = _toks(pref_text)
                        best, best_sc = None, -1
                        for ln in (one.get('available_links') or []):
                            cand_text = ' '.join([
                                str(ln.get('user_intent') or ''),
                                str(ln.get('click_target') or ''),
                                str(ln.get('source_element_name') or ''),
                            ])
                            sc = len(q.intersection(_toks(cand_text)))
                            if sc > best_sc and ln.get('destination_screen_id'):
                                best, best_sc = ln, sc
                        if best:
                            chosen_link = best

                    if chosen_link:
                        next_sid = str(chosen_link.get('destination_screen_id'))
                        if not one.get('final_action'):
                            one['final_action'] = str(chosen_link.get('click_target') or '')
                            one['final_action_struct'] = {
                                'control': str(chosen_link.get('source_element_name') or ''),
                                'location': '',
                                'rationale': 'Chosen from available_links based on user goal/preferences',
                                'decision_source': 'fallback_available_links',
                                'linkId': chosen_link.get('linkId'),
                            }
                except Exception:
                    next_sid = None
                steps.append(one)
                if not next_sid or not nodes:
                    result = {'journey': steps}
                    break
                # advance current
                current_screen_id = next_sid
                # update record by screen_id match
                current_rec = None
                for n in (nodes or []):
                    if str(n.get('screen_id') or '') == str(current_screen_id):
                        current_rec = n
                        break
                previous_input = (one.get('links_review_narrative') or one.get('goal_based_narrative') or '')
            else:
                result = {'journey': steps}
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

    # Post-process UX audit: dedup + filter by severity + limit count
    try:
        # attach persona metadata back on the result
        if persona_user:
            result['persona_user'] = persona_user
        audit = result.get('ux_audit') if isinstance(result, dict) else None
        issues = list((audit or {}).get('issues') or [])
        if issues:
            # Preserve raw
            result['ux_audit_raw'] = {'issues': issues}
            # Deduplicate by heuristic + problem gist, keep highest severity
            best: dict = {}
            for it in issues:
                h = str(it.get('heuristic') or '').strip() or 'General usability'
                gist = _normalize_gist(str(it.get('problem_my_experience') or ''))
                key = f"{h}|{gist}"
                sev = it.get('severity_0_1')
                if sev is None:
                    # Try severity 1-5 mapping
                    sev15 = it.get('severity')
                    sev = (float(sev15) - 1.0) / 4.0 if isinstance(sev15, (int, float)) else 0.5
                sev = _to_float(sev, 0.5)
                # Persona-weight severity adjustment
                sev = adjust_severity_by_persona(h, sev, result.get('persona_user') if isinstance(result, dict) else None)
                it['severity_0_1'] = sev
                if key not in best or _to_float(best[key].get('severity_0_1'), 0.5) < sev:
                    best[key] = it
            deduped = list(best.values())
            # Filter by min severity
            filtered = [it for it in deduped if _to_float(it.get('severity_0_1'), 0.5) >= float(args.min_severity or 0.0)]
            # Sort by severity desc
            filtered.sort(key=lambda x: _to_float(x.get('severity_0_1'), 0.5), reverse=True)
            # Limit to max issues
            limited = filtered[: max(1, int(args.max_issues or 3))]
            result['ux_audit']['issues'] = limited
            # Snapshot aggregation for quick analytics
            snap: dict = {}
            for it in deduped:
                h = str(it.get('heuristic') or 'General usability')
                s = _to_float(it.get('severity_0_1'), 0.5)
                rec = snap.setdefault(h, {'count': 0, 'sum': 0.0})
                rec['count'] += 1
                rec['sum'] += s
            snapshot = {k: {'count': v['count'], 'avg_severity': round((v['sum']/max(1,v['count'])), 3)} for k, v in snap.items()}
            result['ux_audit_snapshot'] = snapshot
    except Exception:
        pass

    # Available links (enumeration only; no decisions)
    try:
        if args.links_json and resolved_screen_id:
            links_path = pathlib.Path(args.links_json)
            links = []
            if links_path.exists():
                try:
                    rows = json.loads(links_path.read_text(encoding='utf-8'))
                except Exception:
                    rows = []
                for row in (rows or []):
                    try:
                        if str(row.get('source_screen_id') or '') == str(resolved_screen_id):
                            links.append({
                                'linkId': row.get('linkId'),
                                'click_target': row.get('click_target'),
                                'user_intent': row.get('user_intent'),
                                'elem_bbox_norm': row.get('elem_bbox_norm'),
                                'ui_role': row.get('ui_role'),
                                'meta': row.get('meta'),
                                'source_element_name': row.get('source_element_name'),
                                'source_element_id': row.get('source_element_id'),
                            })
                    except Exception:
                        continue
            result['available_links'] = links
    except Exception:
        # best-effort; do not fail the run
        pass

    # Create test/persona{persona}/user{user} alongside preprocess when --persona is provided
    try:
        if args.persona_id and args.out and args.out != '-':
            outp_for_dirs = pathlib.Path(args.out)
            # Expect out path like proj/preprocess/...
            preprocess_dir = outp_for_dirs.parent
            proj_root = preprocess_dir.parent
            test_dir = proj_root / 'test' / f"persona{args.persona_id}" / f"user{args.user_id or 'unknown'}"
            test_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Non-fatal
        pass

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out == '-' or not args.out:
        print(payload)
    else:
        outp = pathlib.Path(args.out)
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(payload, encoding='utf-8')
        print(f"Wrote {outp}")


if __name__ == '__main__':
    main()


