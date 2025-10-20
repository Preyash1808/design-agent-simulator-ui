#!/usr/bin/env python3
import os
import sys
import json
import pathlib
import requests
from typing import Dict, Any, List, Tuple
from dotenv import load_dotenv

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
        chunk = ids[i:i+CHUNK]
        r = requests.get(
            f'https://api.figma.com/v1/files/{file_key}/nodes',
            headers={'X-Figma-Token': token},
            params={'ids': ','.join(chunk)},
            timeout=60,
        )
        r.raise_for_status()
        data = r.json().get('nodes', {})
        for k, v in data.items():
            out[k] = (v or {}).get('document') or {}
    return out


def describe_region(elem_bb: Dict[str, Any], frame_bb: Dict[str, Any]) -> str:
    try:
        ex, ey, ew, eh = float(elem_bb['x']), float(elem_bb['y']), float(elem_bb['width']), float(elem_bb['height'])
        fx, fy, fw, fh = float(frame_bb['x']), float(frame_bb['y']), float(frame_bb['width']), float(frame_bb['height'])
        cx, cy = (ex + ew/2.0) - fx, (ey + eh/2.0) - fy
        nx, ny = cx/max(fw,1.0), cy/max(fh,1.0)
        cols = ['left','center','right']
        rows = ['top','middle','bottom']
        col = cols[min(2,int(nx*3))]
        row = rows[min(2,int(ny*3))]
        if row == 'middle':
            return col
        if col == 'center':
            return row
        return f'{row}-{col}'
    except Exception:
        return 'prominent area'


def bbox_norm(elem_bb: Dict[str, Any], frame_bb: Dict[str, Any]) -> Tuple[float,float,float,float]:
    ex, ey, ew, eh = float(elem_bb.get('x',0)), float(elem_bb.get('y',0)), float(elem_bb.get('width',0)), float(elem_bb.get('height',0))
    fx, fy, fw, fh = float(frame_bb.get('x',0)), float(frame_bb.get('y',0)), float(frame_bb.get('width',1)), float(frame_bb.get('height',1))
    return ((ex-fx)/max(fw,1.0), (ey-fy)/max(fh,1.0), ew/max(fw,1.0), eh/max(fh,1.0))


def _humanize_kind(kind: str, name_hint: str, label: str) -> str:
    k = (kind or '').lower()
    n = (name_hint or '').lower()
    l = (label or '').lower()
    # Icon heuristics
    icon_keywords = ['icon', 'cart', 'back', 'menu', 'search', 'close', 'plus', 'minus', 'arrow', 'home', 'profile']
    if any(x in n for x in icon_keywords) or any(x in l for x in icon_keywords):
        return 'icon'
    # Button heuristics
    cta_words = ['continue', 'next', 'add', 'checkout', 'login', 'apply', 'submit', 'get started', 'buy', 'pay']
    if l and any(w in l for w in cta_words):
        return 'button'
    if 'button' in n:
        return 'button'
    # Link if text-like
    if k == 'text' and label:
        return 'text link'
    # Card if large container
    if k in ('frame','group','rectangle'):
        return 'interactive container'
    return k or 'element'


def _region_phrase(region: str, nb: Tuple[float,float,float,float]) -> str:
    x,y,w,h = nb
    # finer granularity
    horiz = 'center' if 0.33 <= (x + w/2) <= 0.66 else ('left' if (x + w/2) < 0.33 else 'right')
    vert = 'middle' if 0.33 <= (y + h/2) <= 0.66 else ('top' if (y + h/2) < 0.33 else 'bottom')
    if vert == 'middle':
        pos = horiz
    elif horiz == 'center':
        pos = vert
    else:
        pos = f"{vert}-{horiz}"
    # add coordinates
    rx, ry, rw, rh = (round(x,2), round(y,2), round(w,2), round(h,2))
    size_hint = 'compact' if rw*rh < 0.05 else ('large' if rw*rh > 0.2 else 'medium')
    return f"{pos} area (approx {size_hint}, bbox x≈{rx}, y≈{ry}, w≈{rw}, h≈{rh})"


def craft_click_target(kind: str, name_hint: str, label: str, region: str, nb: Tuple[float,float,float,float]) -> str:
    k = _humanize_kind(kind, name_hint, label)
    lab = f" labeled '{label}'" if label else ''
    loc = _region_phrase(region, nb)
    # Build a richer description with nearby context hints
    near = 'near the header' if 'top' in loc else ('above the bottom bar' if 'bottom' in loc else 'in the central content')
    return (
        f"Tap the {k}{lab} located in the {loc}, {near}. "
        f"This control is visually distinct in this area and is intended for this step."
    )


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Refresh click_target using Figma element locations')
    parser.add_argument('--infile', required=True)
    parser.add_argument('--outfile', required=True)
    args = parser.parse_args()

    # Load .env so FIGMA_TOKEN is available
    load_dotenv()
    token = os.getenv('FIGMA_TOKEN')
    if not token:
        print('Missing FIGMA_TOKEN in env')
        sys.exit(1)
    cfg = read_config()
    key = extract_file_key(cfg.get('figmaFileUrl',''))

    p = pathlib.Path(args.infile)
    links = json.loads(p.read_text(encoding='utf-8'))
    id_pool = set()
    for l in links:
        for k in ('source_element_id','source_screen_id'):
            v = l.get(k)
            if isinstance(v,str):
                id_pool.add(v)
    node_docs = fetch_nodes(token, key, sorted(id_pool))

    out_links = []
    for l in links:
        elem = node_docs.get(str(l.get('source_element_id')), {})
        frame = node_docs.get(str(l.get('source_screen_id')), {})
        e_bb = elem.get('absoluteBoundingBox') or {}
        f_bb = frame.get('absoluteBoundingBox') or {}
        region = describe_region(e_bb, f_bb) if e_bb and f_bb else 'prominent area'
        nb = bbox_norm(e_bb, f_bb) if e_bb and f_bb else (0.0,0.0,0.0,0.0)
        label = str(elem.get('characters') or '').strip()
        kind = (elem.get('type') or 'element').lower()
        name_hint = str(l.get('source_element_name') or '')
        l['click_target'] = craft_click_target(kind, name_hint, label, region, nb)
        out_links.append(l)

    outp = pathlib.Path(args.outfile)
    outp.write_text(json.dumps(out_links, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Updated click_target for {len(out_links)} links → {outp}')


if __name__ == '__main__':
    main()


