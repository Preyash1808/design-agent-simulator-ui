#!/usr/bin/env python3
import os
import sys
import json
import pathlib
from typing import Dict, Any, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw

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


def normalize(s: str) -> str:
    return ''.join(ch.lower() for ch in (s or '') if ch.isalnum())


def find_screen_image(screens_dir: pathlib.Path, screen_name: str) -> Optional[pathlib.Path]:
    target = normalize(screen_name)
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


def to_frame_coords(elem_bb: Dict[str, Any], frame_bb: Dict[str, Any], img_w: int, img_h: int) -> Tuple[float, float, float, float]:
    ex, ey, ew, eh = float(elem_bb['x']), float(elem_bb['y']), float(elem_bb['width']), float(elem_bb['height'])
    fx, fy, fw, fh = float(frame_bb['x']), float(frame_bb['y']), float(frame_bb['width']), float(frame_bb['height'])
    rx, ry = ex - fx, ey - fy
    sx, sy = img_w / max(fw, 1.0), img_h / max(fh, 1.0)
    return rx * sx, ry * sy, ew * sx, eh * sy


def draw_dot(img: Image.Image, cx: float, cy: float, color=(255, 64, 64), radius=None) -> None:
    draw = ImageDraw.Draw(img)
    r = radius or max(10, int(min(img.size) * 0.018))
    bbox = [int(cx - r), int(cy - r), int(cx + r), int(cy + r)]
    draw.ellipse(bbox, fill=color, outline=(0, 0, 0), width=max(2, r // 4))


def draw_frame_border(img: Image.Image, color=(40, 120, 255), width=None) -> None:
    draw = ImageDraw.Draw(img)
    w = width or max(6, int(min(img.size) * 0.01))
    x1, y1, x2, y2 = 0 + w // 2, 0 + w // 2, img.size[0] - w // 2, img.size[1] - w // 2
    draw.rectangle([x1, y1, x2, y2], outline=color, width=w)


def load_screen_node_id_map(nodes_json_path: Optional[pathlib.Path]) -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    if not nodes_json_path or not nodes_json_path.exists():
        return mapping
    try:
        nodes: List[Dict[str, Any]] = json.loads(nodes_json_path.read_text(encoding='utf-8'))
        for n in nodes:
            fn = str(n.get('file') or '')
            if not fn:
                continue
            base = fn[:-4] if fn.lower().endswith('.png') else fn
            parts = base.split('__', 1)
            frame_part = parts[1] if len(parts) > 1 else base
            if '__' in frame_part:
                frame_part = frame_part.split('__', 1)[0]
            key = normalize(frame_part)
            try:
                mapping[key] = int(n.get('id'))
            except Exception:
                continue
    except Exception:
        pass
    return mapping


def annotate_links(enriched_path: pathlib.Path, screens_dir: pathlib.Path, out_dir: pathlib.Path, token: str, file_key: str, nodes_json_path: Optional[pathlib.Path] = None) -> int:
    links: List[Dict[str, Any]] = json.loads(enriched_path.read_text(encoding='utf-8'))
    screen_id_map = load_screen_node_id_map(nodes_json_path)
    # Collect nodes to fetch
    id_pool = set()
    for l in links:
        for k in ('source_element_id', 'source_screen_id'):
            v = l.get(k)
            if isinstance(v, str):
                id_pool.add(v)
    node_docs = fetch_nodes(token, file_key, sorted(id_pool))

    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for l in links:
        screen_name = l.get('source_screen_name') or ''
        img_path = find_screen_image(screens_dir, screen_name)
        if not img_path or not img_path.exists():
            continue
        elem = node_docs.get(str(l.get('source_element_id')), {})
        frame = node_docs.get(str(l.get('source_screen_id')), {})
        e_bb = elem.get('absoluteBoundingBox') or {}
        f_bb = frame.get('absoluteBoundingBox') or {}
        img = Image.open(img_path).convert('RGBA')
        w, h = img.size
        # Use extracted flags when present (preferred)
        is_wait = bool(l.get('is_auto_delay'))
        is_click_anywhere = bool(l.get('is_click_anywhere'))
        action_key = str(l.get('action_key') or l.get('trigger') or '').lower()
        # Heuristic fallback only if explicit flags missing
        if l.get('is_auto_delay') is None:
            is_wait = ('wait' in action_key) or ('delay' in action_key)
        if e_bb and f_bb:
            ex, ey, ew, eh = to_frame_coords(e_bb, f_bb, w, h)
            nx, ny, nw, nh = (ex / max(w,1.0), ey / max(h,1.0), ew / max(w,1.0), eh / max(h,1.0))
            if nw > 0.95 and nh > 0.95:
                # Large element covering frame → treat as frame-level click
                is_click_anywhere = True if l.get('is_click_anywhere') is None else bool(l.get('is_click_anywhere'))
        else:
            # Missing geometry; if trigger says delay, keep wait flag, otherwise default to frame-level
            if not is_wait:
                is_click_anywhere = True

        # Colors
        color_wait = (0, 160, 150)       # teal for auto-delay
        color_click_any = (255, 140, 0)  # orange for click-anywhere
        if is_wait:
            draw_frame_border(img, color=color_wait)
        elif is_click_anywhere:
            draw_frame_border(img, color=color_click_any)
        else:
            cx, cy = ex + ew / 2.0, ey + eh / 2.0
            draw_dot(img, cx, cy)
        # Save
        lid = l.get('linkId') or 'link'
        # Add screen node id prefix if available
        key = normalize(screen_name)
        sid = screen_id_map.get(key)
        prefix = f"{sid}__" if isinstance(sid, int) else ''
        safe_name = f"{prefix}{lid}__{img_path.stem}.png"
        out_path = out_dir / safe_name
        img.save(out_path)
        count += 1
    return count


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Annotate source elements on screen images')
    parser.add_argument('--enriched', required=True, help='Path to prototype_links_enriched.json')
    parser.add_argument('--screens-dir', required=True, help='Folder with source screen images')
    parser.add_argument('--out-dir', required=True, help='Folder to write annotated images')
    parser.add_argument('--nodes-json', default=None, help='Optional path to screen_nodes.json for this run')
    args = parser.parse_args()

    load_dotenv()
    token = os.getenv('FIGMA_TOKEN')
    if not token:
        print('Missing FIGMA_TOKEN in env')
        sys.exit(1)
    cfg = read_config()
    key = extract_file_key(cfg.get('figmaFileUrl', ''))

    enriched_path = pathlib.Path(args.enriched)
    screens_dir = pathlib.Path(args.screens_dir)
    out_dir = pathlib.Path(args.out_dir)

    nodes_json_path = pathlib.Path(args.nodes_json) if args.nodes_json else None
    n = annotate_links(enriched_path, screens_dir, out_dir, token, key, nodes_json_path)
    print(f'Annotated {n} images → {out_dir}')


if __name__ == '__main__':
    main()


