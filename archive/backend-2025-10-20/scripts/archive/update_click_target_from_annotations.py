#!/usr/bin/env python3
import os
import sys
import json
import pathlib
import base64
from typing import Dict, Any, List, Optional
import time

from dotenv import load_dotenv
import requests


ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'config' / 'figma.config.json'


def read_config() -> Dict[str, Any]:
    return json.loads(CONFIG.read_text(encoding='utf-8'))


def extract_file_key(figma_url: str) -> str:
    from urllib.parse import urlparse
    parts = [p for p in urlparse(figma_url).path.split('/') if p]
    for marker in ('design', 'file'):
        if marker in parts:
            i = parts.index(marker)
            if i + 1 < len(parts):
                return parts[i+1]
    raise SystemExit('Could not parse file key')


def fetch_nodes(token: str, file_key: str, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    CHUNK = 80
    for i in range(0, len(ids), CHUNK):
        r = requests.get(
            f'https://api.figma.com/v1/files/{file_key}/nodes',
            headers={'X-Figma-Token': token},
            params={'ids': ','.join(ids[i:i+CHUNK])},
            timeout=60,
        )
        r.raise_for_status()
        data = r.json().get('nodes', {})
        for k, v in data.items():
            out[k] = (v or {}).get('document') or {}
    return out


def determine_is_wait(elem_doc: Dict[str, Any], frame_doc: Dict[str, Any], link: Dict[str, Any]) -> bool:
    action_key = str(link.get('action_key') or link.get('trigger') or '').lower()
    if 'wait' in action_key or 'delay' in action_key:
        return True
    e_bb = elem_doc.get('absoluteBoundingBox') or {}
    f_bb = frame_doc.get('absoluteBoundingBox') or {}
    try:
        ex, ey, ew, eh = float(e_bb['x']), float(e_bb['y']), float(e_bb['width']), float(e_bb['height'])
        fx, fy, fw, fh = float(f_bb['x']), float(f_bb['y']), float(f_bb['width']), float(f_bb['height'])
        if fw > 0 and fh > 0:
            nw = ew / fw
            nh = eh / fh
            if nw > 0.95 and nh > 0.95:
                return True
    except Exception:
        pass
    return False


def build_prompt(is_wait: bool) -> str:
    if is_wait:
        return (
            "You are given an annotated screenshot. The blue border indicates a timed/auto-advance or whole-screen transition. "
            "Write STRICT JSON with one field only: {\"click_target\": string} describing what the user should do (e.g., wait briefly), "
            "and where their attention should be (e.g., status/loader area), in 1–2 specific sentences. No extra keys or commentary."
        )
    return (
        "You are given an annotated screenshot. A red dot marks the exact tappable element. "
        "Write STRICT JSON with one field only: {\"click_target\": string} describing precisely where to tap (position like top-right/bottom center, visible label/icon, nearby context) in 1–2 sentences. "
        "Be concrete and avoid generic phrasing. No extra keys or commentary."
    )


def generate_click_target(model_name: str, image_path: pathlib.Path, is_wait: bool) -> Optional[str]:
    try:
        import google.generativeai as genai
        key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
        if not key:
            return None
        # Ensure REST key is picked up
        os.environ.setdefault('GOOGLE_API_KEY', key)
        genai.configure(api_key=key)
        model = genai.GenerativeModel(model_name)
        prompt = build_prompt(is_wait)
        b64 = base64.b64encode(image_path.read_bytes()).decode('utf-8')
        parts = [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/png", "data": b64}},
        ]
        resp = model.generate_content(parts)
        text = (resp.text or '').strip()
        if text.startswith('```'):
            text = text.strip('`')
            if text.startswith('json'):
                text = text[4:]
        data = json.loads(text)
        return str(data.get('click_target') or '').strip() or None
    except Exception:
        return None


def find_annotated_image(annotated_dir: pathlib.Path, link: Dict[str, Any]) -> Optional[pathlib.Path]:
    lid = link.get('linkId')
    if not lid:
        return None
    # Pattern: *__<linkId>__*.png
    pat = f"*__{lid}__*.png"
    matches = sorted(annotated_dir.glob(pat))
    return matches[0] if matches else None


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Populate click_target from annotated images via LLM vision')
    parser.add_argument('--enriched', required=True)
    parser.add_argument('--annotated-dir', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--model', default=os.getenv('MODEL_NAME', 'gemini-2.5-pro'))
    args = parser.parse_args()

    load_dotenv()
    token = os.getenv('FIGMA_TOKEN')
    cfg = read_config()
    file_key = extract_file_key(cfg.get('figmaFileUrl', ''))

    enriched_path = pathlib.Path(args.enriched)
    annotated_dir = pathlib.Path(args.annotated_dir)
    links: List[Dict[str, Any]] = json.loads(enriched_path.read_text(encoding='utf-8'))

    # Figma context for is_wait detection
    id_pool = set()
    for l in links:
        for k in ('source_element_id', 'source_screen_id'):
            v = l.get(k)
            if isinstance(v, str):
                id_pool.add(v)
    node_docs = fetch_nodes(token, file_key, sorted(id_pool)) if token else {}

    updated: List[Dict[str, Any]] = []
    for l in links:
        img_path = find_annotated_image(annotated_dir, l)
        if not img_path:
            updated.append(l)
            continue
        elem = node_docs.get(str(l.get('source_element_id')), {})
        frame = node_docs.get(str(l.get('source_screen_id')), {})
        is_wait = determine_is_wait(elem, frame, l)
        text = generate_click_target(args.model, img_path, is_wait)
        if text:
            l['click_target'] = text
        updated.append(l)

    outp = pathlib.Path(args.out)
    outp.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Updated click_target from annotated images → {outp}')


if __name__ == '__main__':
    main()


