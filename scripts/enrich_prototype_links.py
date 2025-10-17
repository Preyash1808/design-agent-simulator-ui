#!/usr/bin/env python3
"""
Enrich prototype_links.json with action guidance for each edge.

For every link, adds two fields:
- click_target: where to click on the source screen (spatial, UI element)
- user_intent: what this action means to the customer (detailed intention)

It uses the exported screen images in figma_screens/ to help the model infer
the click target and intent. Requires GEMINI_API_KEY in .env; if missing, a
deterministic fallback description will be generated.

Usage:
  python scripts/enrich_prototype_links.py \
    --input logs/prototype_links.json \
    --out logs/prototype_links_enriched.json
"""

import os
import sys
import json
import pathlib
import argparse
from typing import Dict, Any, List, Optional, Tuple

from dotenv import load_dotenv
import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCREENS_DIR_DEFAULT = ROOT / 'figma_screens'
LOGS_DIR = ROOT / 'logs'
NODES_JSON = LOGS_DIR / 'screen_nodes.json'


def normalize_name(s: str) -> str:
    return ''.join(ch.lower() for ch in s if ch.isalnum())


def compose_user_intent(dest_desc: Optional[str], element_name: Optional[str], label_hint: Optional[str]) -> str:
    label = (label_hint or element_name or 'the element').strip()
    base = f"Tap {label} to continue."
    if dest_desc and dest_desc.strip():
        # Keep it user-facing and concise
        return f"{base} This takes you to a view where {dest_desc.strip()}"
    return f"{base} This moves you to the next step of your task."


def craft_click_target(element_name: Optional[str], label_hint: Optional[str], region_hint: Optional[str], bbox_hint: Optional[dict], elem_type: Optional[str], source_desc: Optional[str]) -> str:
    label = (label_hint or element_name or 'the control').strip()
    region = (region_hint or 'a prominent area').strip()
    parts: List[str] = []
    parts.append(f"Locate {label}")
    # Include region when available
    if region:
        parts.append(f"near the {region}")
    # Include bbox when available
    try:
        if bbox_hint is not None:
            x = float(bbox_hint.get('x') or 0.0)
            y = float(bbox_hint.get('y') or 0.0)
            w = float(bbox_hint.get('w') or 0.0)
            h = float(bbox_hint.get('h') or 0.0)
            if w > 0 and h > 0:
                parts.append("(highlighted area)")
    except Exception:
        pass
    if elem_type:
        parts.append(f"({elem_type})")
    if source_desc and source_desc.strip():
        parts.append(f"on this screen: {source_desc.strip()}")
    return ' '.join(parts).strip() + "."


# --- Figma helpers (file key + node geometry) ---
def extract_file_key(figma_url_or_key: Optional[str]) -> Optional[str]:
    if not figma_url_or_key:
        return None
    # Already a key
    if '/' not in figma_url_or_key and ':' not in figma_url_or_key and len(figma_url_or_key) >= 20:
        return figma_url_or_key
    try:
        from urllib.parse import urlparse
        parsed = urlparse(figma_url_or_key)
        parts = [p for p in (parsed.path or '').split('/') if p]
        for token in ('design', 'file'):
            if token in parts:
                idx = parts.index(token)
                if idx + 1 < len(parts):
                    return parts[idx + 1]
    except Exception:
        pass
    return None


def figma_fetch_nodes_geometry(token: Optional[str], file_key: Optional[str], ids: list[str]) -> dict:
    """Return mapping id -> dict(absoluteBoundingBox, type, name).

    Uses the /v1/files/{key}/nodes endpoint in chunks.
    """
    out: dict = {}
    if not token or not file_key or not ids:
        return out
    base = f"https://api.figma.com/v1/files/{file_key}/nodes"
    headers = {'X-Figma-Token': token}
    # Chunk to stay well below URL size limits
    chunk_size = 60
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        try:
            res = requests.get(base, headers=headers, params={'ids': ','.join(chunk)}, timeout=60)
            res.raise_for_status()
            data = res.json() or {}
            nodes = (data.get('nodes') or {})
            for nid, node_wrap in nodes.items():
                node = (node_wrap or {}).get('document') or {}
                bb = (node.get('absoluteBoundingBox') or {})
                out[nid] = {
                    'absoluteBoundingBox': bb,
                    'type': node.get('type'),
                    'name': node.get('name'),
                }
        except Exception:
            continue
    return out


def normalize_rect(child_bb: dict, frame_bb: dict) -> Optional[dict]:
    try:
        fx = float(frame_bb.get('x'))
        fy = float(frame_bb.get('y'))
        fw = float(frame_bb.get('width'))
        fh = float(frame_bb.get('height'))
        cx = float(child_bb.get('x'))
        cy = float(child_bb.get('y'))
        cw = float(child_bb.get('width'))
        ch = float(child_bb.get('height'))
        if fw <= 0 or fh <= 0 or cw < 0 or ch < 0:
            return None
        return {
            'x': max(0.0, (cx - fx) / fw),
            'y': max(0.0, (cy - fy) / fh),
            'w': min(1.0, cw / fw),
            'h': min(1.0, ch / fh),
        }
    except Exception:
        return None


def region_from_norm_bbox(nb: Optional[dict]) -> Optional[str]:
    if not nb:
        return None
    x = float(nb.get('x') or 0.0)
    y = float(nb.get('y') or 0.0)
    w = float(nb.get('w') or 0.0)
    h = float(nb.get('h') or 0.0)
    cx = x + w / 2.0
    cy = y + h / 2.0
    horiz = 'left' if cx < 0.33 else ('right' if cx > 0.67 else 'center')
    vert = 'top' if cy < 0.33 else ('bottom' if cy > 0.67 else 'middle')
    if vert == 'middle' and horiz == 'center':
        return 'center'
    return f"{vert}-{horiz}"
def should_use_llm() -> bool:
    """Return True if LLM calls are enabled (default) and an API key exists."""
    if os.getenv('ENRICH_USE_LLM', '1') not in {'1', 'true', 'TRUE'}:
        return False
    return bool(os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY'))

def llm_timeout_seconds() -> int:
    try:
        return max(5, int(os.getenv('LLM_TIMEOUT_SEC', '20')))
    except Exception:
        return 20



def find_screen_image(screen_name: str, screens_dir: pathlib.Path) -> Optional[pathlib.Path]:
    if not screens_dir.exists():
        return None
    target = normalize_name(screen_name)
    best: Optional[pathlib.Path] = None
    for p in sorted(screens_dir.iterdir()):
        if not p.is_file():
            continue
        if p.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
            continue
        base = p.stem
        parts = base.split('__', 1)
        candidate = normalize_name(parts[1] if len(parts) > 1 else base)
        if candidate == target:
            return p
        if target and target in candidate and best is None:
            best = p
    return best


def build_prompt(source_screen: str, element_name: str, dest_screen: str,
                 source_desc: Optional[str], dest_desc: Optional[str],
                 elem_type: Optional[str], region_hint: Optional[str],
                 label_hint: Optional[str], bbox_hint: Optional[dict]) -> str:
    return (
        "You are a UX assistant. Analyze the provided mobile app screen image(s). "
        "The first image is the current view where the action happens; a second image (if present) shows the next view after the tap. "
        f"The tappable element is named '{element_name}'.\n"
        + (f"Context about current view: {source_desc}.\n" if source_desc else "")
        + (f"Context about next view: {dest_desc}.\n" if dest_desc else "")
        + (f"Element metadata → type: {elem_type or 'unknown'}, region: {region_hint or 'unspecified'}, "
           f"label: {label_hint or 'none'}, "
           + (f"normalized_bbox: x={bbox_hint.get('x'):.3f}, y={bbox_hint.get('y'):.3f}, w={bbox_hint.get('w'):.3f}, h={bbox_hint.get('h'):.3f}.\n" if bbox_hint else "")
        )
        + "\nTask: Return STRICT JSON with two fields only (do NOT use internal screen names in the wording):\n"
        "- click_target: Write 2–4 sentences describing exactly where the user taps on the current view. Mention position (top/bottom/center/left/right), spatial cues (e.g., 'top-right', 'bottom center'), visible label/icon/color if present, and nearby context. Speak as if guiding a real user. Avoid generic phrasing.\n"
        "- user_intent: 2–4 sentences from the user’s perspective that explain what this action is and why they are doing it, based on what the next view enables them to do. Avoid technical terms or internal names.\n\n"
        "Constraints: Be concrete (mention region/label if available); no extra keys; output JSON only (no code fences)."
    )


def llm_screen_summary(image_path: Optional[pathlib.Path], desc_hint: Optional[str]) -> str:
    """Generate a user-perspective screen summary. Falls back gracefully if LLM is disabled/unavailable."""
    if not should_use_llm():
        # Fallback: deterministic summary using hints
        base = "This view presents the main content for the current step. It shows key information and actions."
        if desc_hint:
            return f"{base} Context: {desc_hint.strip()}"
        return base
    try:
        import base64
        import google.generativeai as genai

        prompt = (
            "You are a UX assistant. Describe THIS VIEW (not using internal names) from a user's perspective in 3-5 sentences. "
            "Explain the primary goal of the view, key UI elements and where they appear (e.g., top navigation, list, primary button at the bottom), "
            "the key action(s) a user can take next and why, and what the user expects after acting. "
            "Return STRICT JSON with {\"screen_summary\": string} and nothing else."
        )
        parts: list[dict] = [{"text": prompt}]
        if image_path and image_path.exists():
            b64 = base64.b64encode(image_path.read_bytes()).decode('utf-8')
            parts.append({"inline_data": {"mime_type": "image/png", "data": b64}})
        if desc_hint:
            parts.append({"text": f"Context hint: {desc_hint}"})
        api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv('MODEL_NAME', 'gemini-2.5-pro'))
        resp = model.generate_content(parts, request_options={"timeout": llm_timeout_seconds()})
        text = (resp.text or '').strip()
        if text.startswith('```'):
            text = text.strip('`')
            if text.startswith('json'):
                text = text[4:]
        data = json.loads(text)
        summary = str(data.get('screen_summary') or '').strip()
        if not summary:
            raise ValueError('empty')
        return summary
    except Exception:
        # Soft fallback to unblock pipeline
        base = "This view presents the main content for the current step. It shows key information and actions."
        if desc_hint:
            return f"{base} Context: {desc_hint.strip()}"
        return base


def llm_describe_action(image_path: pathlib.Path, dest_image_path: Optional[pathlib.Path],
                        source_screen: str, element_name: str, dest_screen: str,
                        source_desc: Optional[str], dest_desc: Optional[str],
                        elem_type: Optional[str], region_hint: Optional[str],
                        label_hint: Optional[str], bbox_hint: Optional[dict]) -> Dict[str, str]:
    if not should_use_llm():
        return {
            "click_target": craft_click_target(element_name, label_hint, region_hint, bbox_hint, elem_type, source_desc),
            "user_intent": compose_user_intent(dest_desc, element_name, label_hint),
        }
    try:
        import base64
        import google.generativeai as genai

        with open(image_path, 'rb') as f:
            src_b64 = base64.b64encode(f.read()).decode('utf-8')
        dst_part = None
        if dest_image_path and dest_image_path.exists():
            with open(dest_image_path, 'rb') as f:
                dst_b64 = base64.b64encode(f.read()).decode('utf-8')
            dst_part = {"inline_data": {"mime_type": "image/png", "data": dst_b64}}

        crop_part = None
        if bbox_hint is not None:
            try:
                from PIL import Image
                from io import BytesIO
                img = Image.open(image_path).convert('RGBA')
                W, H = img.size
                nx = float(bbox_hint.get('x') or 0.0)
                ny = float(bbox_hint.get('y') or 0.0)
                nw = float(bbox_hint.get('w') or 0.0)
                nh = float(bbox_hint.get('h') or 0.0)
                mx = max(0, int(nx * W) - 8)
                my = max(0, int(ny * H) - 8)
                mw = int(nw * W) + 16
                mh = int(nh * H) + 16
                box = (mx, my, min(W, mx + mw), min(H, my + mh))
                crop = img.crop(box)
                buf = BytesIO()
                crop.save(buf, format='PNG')
                crop_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
                crop_part = {"inline_data": {"mime_type": "image/png", "data": crop_b64}}
            except Exception:
                crop_part = None

        prompt = build_prompt(source_screen, element_name, dest_screen, source_desc, dest_desc,
                              elem_type, region_hint, label_hint, bbox_hint)
        api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
        if not api_key:
            raise RuntimeError('Missing GEMINI_API_KEY/GOOGLE_API_KEY')
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(os.getenv('MODEL_NAME', 'gemini-2.5-pro'))
        parts = [{"text": prompt}, {"inline_data": {"mime_type": "image/png", "data": src_b64}}]
        if crop_part is not None:
            parts.append(crop_part)
        if dst_part is not None:
            parts.append(dst_part)
        resp = model.generate_content(parts, request_options={"timeout": llm_timeout_seconds()})
        text = (resp.text or '').strip()
        if text.startswith('```'):
            text = text.strip('`')
            if text.startswith('json'):
                text = text[4:]
        data = json.loads(text)
        click_target = str(data.get('click_target') or '').strip()
        user_intent = str(data.get('user_intent') or '').strip()
        if not click_target or not user_intent:
            raise ValueError('Missing required fields')
        return {"click_target": click_target, "user_intent": user_intent}
    except Exception:
        # Soft fallback: deterministic
        return {
            "click_target": craft_click_target(element_name, label_hint, region_hint, bbox_hint, elem_type, source_desc),
            "user_intent": compose_user_intent(dest_desc, element_name, label_hint),
        }


def load_screen_nodes() -> Dict[str, Dict[str, Any]]:
    mapping: Dict[str, Dict[str, Any]] = {}
    try:
        nodes: List[Dict[str, Any]] = json.loads(NODES_JSON.read_text(encoding='utf-8')) if NODES_JSON.exists() else []
        for n in nodes:
            name = str(n.get('name') or '')
            if not name:
                continue
            mapping[normalize_name(name)] = n
    except Exception:
        pass
    return mapping


def get_screen_context(name: str, nodes_by_name: Dict[str, Dict[str, Any]], screens_dir: pathlib.Path) -> Tuple[Optional[pathlib.Path], Optional[str]]:
    img = find_screen_image(name, screens_dir)
    desc = None
    key = normalize_name(name)
    node = nodes_by_name.get(key)
    if node:
        desc = str(node.get('description') or '')
    return img, desc


def enrich_links(links: List[Dict[str, Any]], screens_dir: pathlib.Path) -> List[Dict[str, Any]]:
    nodes_by_name = load_screen_nodes()
    try:
        nodes_list = json.loads(NODES_JSON.read_text(encoding='utf-8')) if NODES_JSON.exists() else []
    except Exception:
        nodes_list = []
    frame_name_to_ids: Dict[str, List[int]] = {}
    frame_name_to_desc: Dict[str, str] = {}
    for n in nodes_list:
        fn = str(n.get('file') or '')
        if not fn:
            continue
        base = fn[:-4] if fn.endswith('.png') else fn
        parts = base.split('__', 1)
        frame_part = parts[1] if len(parts) > 1 else base
        # mapping skipped for brevity…

    # Pre-fetch Figma geometry for all involved nodes to classify controls (e.g., back button)
    figma_token = os.getenv('FIGMA_TOKEN')
    file_key = extract_file_key(os.getenv('FIGMA_FILE_URL') or os.getenv('FIGMA_FILE_KEY'))
    all_ids: list[str] = []
    frame_ids: set[str] = set()
    for link in links:
        sid = str(link.get('source_screen_id') or '')
        eid = str(link.get('source_element_id') or '')
        did = str(link.get('destination_screen_id') or '')
        if sid:
            frame_ids.add(sid)
            all_ids.append(sid)
        if eid:
            all_ids.append(eid)
        if did:
            all_ids.append(did)
    geo_map = figma_fetch_nodes_geometry(figma_token, file_key, list(dict.fromkeys(all_ids)))

    enriched: List[Dict[str, Any]] = []
    for link in links:
        src_name = link.get('source_screen_name') or 'Screen'
        elem_name = link.get('source_element_name') or 'element'
        dst_name = link.get('destination_screen_name') or 'Next Screen'

        img, src_desc = get_screen_context(src_name, nodes_by_name, screens_dir)
        dst_img, dst_desc = get_screen_context(dst_name, nodes_by_name, screens_dir)

        # region/label/bbox lookup using Figma geometry where possible
        source_frame_bb = (geo_map.get(str(link.get('source_screen_id')) or '') or {}).get('absoluteBoundingBox') or {}
        elem_bb = (geo_map.get(str(link.get('source_element_id')) or '') or {}).get('absoluteBoundingBox') or {}
        nb = normalize_rect(elem_bb, source_frame_bb) if elem_bb and source_frame_bb else None
        region_hint = region_from_norm_bbox(nb)

        # Heuristic classification: back button if element is near top-left and element name suggests back
        elem_name_lower = (elem_name or '').strip().lower()
        is_backish_name = any(k in elem_name_lower for k in ['back', 'arrow', 'chevron'])
        is_top_left = False
        if nb:
            is_top_left = (nb.get('x', 1) <= 0.15 and nb.get('y', 1) <= 0.18 and nb.get('w', 0) <= 0.15)
        is_back_button = is_backish_name or is_top_left

        elem_type = None
        if img is None:
            details = {
                'click_target': craft_click_target(elem_name, None, region_hint or "top-left" if is_back_button else (region_hint or "prominent area"), nb, elem_type, src_desc),
                'user_intent': compose_user_intent(dst_desc, elem_name, None),
            }
        else:
            llm = llm_describe_action(img, dst_img, src_name, elem_name, dst_name,
                                      src_desc, dst_desc, elem_type, region_hint, None, nb)
            details = {
                # ✅ use LLM’s click_target if available
                'click_target': llm.get('click_target') or craft_click_target(elem_name, None, region_hint, nb, elem_type, src_desc),
                'user_intent': llm.get('user_intent') or compose_user_intent(dst_desc, elem_name, None),
            }

        new_link = dict(link)
        # If we identify a back button, normalize wording to back behavior
        if is_back_button:
            new_link['click_target'] = "Tap the left-pointing back arrow at the top-left inside the header/search bar to return to the previous screen."
            new_link['user_intent'] = "I want to go back to the previous screen."
        else:
            new_link['click_target'] = details['click_target']
            new_link['user_intent'] = details['user_intent']

        # Normalize wording for special trigger types so text matches behavior
        try:
            if bool(link.get('is_auto_delay')):
                # Prefer explicit wait phrasing; include delay when available
                d_ms = link.get('delay_ms')
                sec_txt = ''
                try:
                    if d_ms is not None:
                        sec = int(round(float(d_ms) / 1000.0))
                        if sec > 0:
                            sec_txt = f" (~{sec}s)"
                except Exception:
                    sec_txt = ''
                new_link['click_target'] = f"No tap required — wait for this screen to advance automatically{sec_txt}."
                new_link['user_intent'] = "I'm waiting briefly for the next step to load and continue."
            elif bool(link.get('is_click_anywhere')) and not is_back_button:
                # Frame-level tap anywhere
                new_link['click_target'] = "Tap anywhere on this screen to continue."
                # Keep user_intent concise and neutral; preserve if already non-empty and not generic
                if not new_link.get('user_intent'):
                    new_link['user_intent'] = "I’m progressing to the next step by tapping anywhere."
        except Exception:
            pass
        new_link['source_screen_description'] = src_desc or llm_screen_summary(img, src_desc)
        new_link['destination_screen_description'] = dst_desc or llm_screen_summary(dst_img, dst_desc)
        enriched.append(new_link)
    return enriched


def main():
    parser = argparse.ArgumentParser(description='Enrich prototype links with action guidance')
    parser.add_argument('--input', default=str(ROOT / 'logs' / 'prototype_links.json'))
    parser.add_argument('--out', default=str(ROOT / 'logs' / 'prototype_links_enriched.json'))
    parser.add_argument('--screen-nodes', default=str(ROOT / 'logs' / 'screen_nodes.json'), help='Path to screen_nodes.json for id mapping')
    parser.add_argument('--screens-dir', default=str(SCREENS_DIR_DEFAULT), help='Directory containing exported screen images')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    args = parser.parse_args()

    load_dotenv()
    inp = pathlib.Path(args.input)
    if not inp.exists():
        print(f'Input not found: {inp}')
        sys.exit(1)
    links: List[Dict[str, Any]] = json.loads(inp.read_text(encoding='utf-8'))
    if args.verbose:
        print(f"[enrich] Input links: {len(links)}")

    if args.verbose:
        print("[enrich] Enriching links (images + screen nodes context)...")
    screens_dir = pathlib.Path(args.screens_dir)
    enriched = enrich_links(links, screens_dir)
    outp = pathlib.Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding='utf-8')
    # Attach screen_node_id and dest_node_id if possible
    try:
        nodes_path = pathlib.Path(args.screen_nodes)
        name_to_id = {}
        if nodes_path.exists():
            nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
            for n in nodes:
                key = (n.get('file') or n.get('name') or '').lower()
                try:
                    name_to_id[n.get('name')] = int(n.get('id'))
                except Exception:
                    pass
        for row in enriched:
            try:
                ssn = row.get('source_screen_name')
                dsn = row.get('destination_screen_name')
                if ssn in name_to_id:
                    row['screen_node_id'] = int(name_to_id[ssn])
                if dsn in name_to_id:
                    row['dest_node_id'] = int(name_to_id[dsn])
            except Exception:
                continue
        outp.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        pass
    print(f'Wrote {len(enriched)} enriched links to {outp}')


if __name__ == '__main__':
    main()
