#!/usr/bin/env python3
"""
Extract prototype navigation links from a specific Figma page within a file.

Before: This script used a hardcoded file key and node id.
Now:    It accepts --figma-url and --page, resolves file key from URL,
        fetches the full file JSON, finds the page by name, and extracts
        screen→screen prototype links only within that page.
"""

import os
import sys
import json
import argparse
import csv
from typing import Dict, Any, List, Optional, Any
from dataclasses import dataclass
import requests
from dotenv import load_dotenv
from urllib.parse import urlparse


@dataclass
class PrototypeLink:
    source_screen_name: str
    source_screen_id: str
    source_element_name: str
    source_element_id: str
    destination_screen_name: str
    destination_screen_id: str
    # Optional prototype metadata for better analytics/annotation
    trigger_type: Optional[str] = None
    action_type: Optional[str] = None
    delay_ms: Optional[int] = None
    is_click_anywhere: Optional[bool] = None
    is_auto_delay: Optional[bool] = None
    # Deterministic matching helpers
    elem_bbox_norm: Optional[Dict[str, float]] = None  # {x,y,w,h} normalized to source frame
    ui_role: Optional[str] = None  # e.g., product_card, nav_back, nav_cart, nav_search
    meta: Optional[Dict[str, Any]] = None  # free-form parsed metadata (e.g., product_name/id)


def extract_file_key(figma_url: str) -> str:
    parsed = urlparse(figma_url)
    parts = [p for p in parsed.path.split('/') if p]
    try:
        design_index = parts.index('design')
        return parts[design_index + 1]
    except Exception:
        pass
    try:
        file_index = parts.index('file')
        return parts[file_index + 1]
    except Exception:
        pass
    raise ValueError('Could not parse Figma file key from URL')


def fetch_file(token: str, file_key: str) -> Dict[str, Any]:
    res = requests.get(
        f'https://api.figma.com/v1/files/{file_key}',
        headers={'X-Figma-Token': token},
        timeout=60,
    )
    res.raise_for_status()
    return res.json()


def find_page_document(file_json: Dict[str, Any], page_name: str) -> Dict[str, Any]:
    for page in (file_json.get('document', {}) or {}).get('children', []) or []:
        if page.get('name') == page_name:
            return page
    # Fallback: case-insensitive match
    for page in (file_json.get('document', {}) or {}).get('children', []) or []:
        if str(page.get('name', '')).strip().lower() == page_name.strip().lower():
            return page
    raise SystemExit(f'Page not found in Figma file: {page_name}')


def find_top_level_frames(page_document: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    frames = {}
    for node in page_document.get('children', []) or []:
        if isinstance(node, dict) and node.get('type') == 'FRAME':
            frames[node['id']] = node
    return frames


def build_node_to_screen_mapping(page_document: Dict[str, Any], top_frames: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    node_to_screen: Dict[str, str] = {}

    def traverse(node: Any, current_screen_id: Optional[str] = None):
        if isinstance(node, dict):
            node_id = node.get('id')
            node_type = node.get('type')
            if node_type == 'FRAME' and node_id in top_frames:
                current_screen_id = node_id
            if node_id and current_screen_id:
                node_to_screen[node_id] = current_screen_id
            for v in node.get('children', []) or []:
                traverse(v, current_screen_id)
        elif isinstance(node, list):
            for item in node:
                traverse(item, current_screen_id)

    traverse(page_document, None)
    return node_to_screen


essential_node_types = {'FRAME', 'COMPONENT', 'INSTANCE', 'TEXT', 'VECTOR', 'ELLIPSE', 'RECTANGLE', 'GROUP'}

def find_prototype_sources(page_document: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources: List[Dict[str, Any]] = []

    def traverse(node: Any):
        if isinstance(node, dict):
            has_direct = ('transitionNodeID' in node or 'destinationId' in node)
            has_interactions = False
            has_reactions = False
            if 'interactions' in node and isinstance(node['interactions'], list):
                for interaction in node['interactions']:
                    for action in interaction.get('actions', []):
                        if isinstance(action, dict) and 'destinationId' in action:
                            has_interactions = True
            if 'reactions' in node and isinstance(node['reactions'], list):
                for reaction in node['reactions']:
                    act = reaction.get('action') if isinstance(reaction, dict) else None
                    if isinstance(act, dict) and 'destinationId' in act:
                        has_reactions = True
            if has_direct or has_interactions or has_reactions:
                sources.append(node)
            for v in node.get('children', []) or []:
                traverse(v)
        elif isinstance(node, list):
            for item in node:
                traverse(item)

    traverse(page_document)
    return sources


def extract_prototype_links(page_document: Dict[str, Any],
                            top_frames: Dict[str, Dict[str, Any]],
                            node_to_screen: Dict[str, str]) -> List[PrototypeLink]:
    sources = find_prototype_sources(page_document)
    links: List[PrototypeLink] = []
    seen = set()

    for node in sources:
        source_element_id = node.get('id')
        source_element_name = node.get('name', f'Element_{source_element_id}')
        # Skip generic container types if they are exactly named
        if source_element_name.startswith('Group') or source_element_name.startswith('Rectangle'):
            continue

        source_screen_id = node_to_screen.get(source_element_id)
        if not source_screen_id or source_screen_id not in top_frames:
            continue
        source_screen_name = top_frames[source_screen_id].get('name') or source_screen_id

        destination_node_id = (
            node.get('transitionNodeID')
            or node.get('destinationId')
        )
        if not destination_node_id and 'interactions' in node:
            for interaction in node.get('interactions', []):
                for action in interaction.get('actions', []):
                    if isinstance(action, dict) and 'destinationId' in action:
                        destination_node_id = action['destinationId']
        if not destination_node_id:
            # Try reactions API shape
            if 'reactions' in node and isinstance(node['reactions'], list):
                for reaction in node['reactions']:
                    act = reaction.get('action') if isinstance(reaction, dict) else None
                    if isinstance(act, dict) and 'destinationId' in act:
                        destination_node_id = act['destinationId']
                        break
        if not destination_node_id:
            continue

        dest_screen_id = node_to_screen.get(destination_node_id)
        if not dest_screen_id or dest_screen_id not in top_frames:
            continue
        dest_screen_name = top_frames[dest_screen_id].get('name') or dest_screen_id

        key = (source_element_id, dest_screen_id)
        if key in seen:
            continue
        seen.add(key)

        # --- Trigger/delay extraction (best-effort across API shapes) ---
        trigger_type: Optional[str] = None
        action_type: Optional[str] = None
        delay_ms: Optional[int] = None

        # Helper to coerce delay seconds → ms
        def _to_ms(v: Any) -> Optional[int]:
            try:
                f = float(v)
                if f < 0:
                    return None
                return int(round(f * 1000.0))
            except Exception:
                return None

        # Prefer reactions if available
        if isinstance(node.get('reactions'), list):
            for reaction in node.get('reactions'):
                if not isinstance(reaction, dict):
                    continue
                act = reaction.get('action') if isinstance(reaction.get('action'), dict) else {}
                dest_id = act.get('destinationId') or reaction.get('destinationId')
                if dest_id and node_to_screen.get(dest_id) == dest_screen_id:
                    trig = reaction.get('trigger') or {}
                    trigger_type = (trig.get('type') or trig or '') if trig is not None else None
                    action_type = (act.get('type') or '').upper() or None
                    # Delay can live in a few places depending on version
                    delay_ms = (
                        _to_ms(reaction.get('delay'))
                        or _to_ms((reaction.get('transition') or {}).get('delay'))
                        or _to_ms((trig or {}).get('timeout'))
                        or _to_ms((act.get('transition') or {}).get('delay') if isinstance(act, dict) else None)
                    )
                    break

        # Fall back to interactions
        if trigger_type is None and isinstance(node.get('interactions'), list):
            for inter in node.get('interactions'):
                if not isinstance(inter, dict):
                    continue
                trig = inter.get('trigger') or {}
                for action in inter.get('actions', []) or []:
                    if not isinstance(action, dict):
                        continue
                    dest_id = action.get('destinationId')
                    if dest_id and node_to_screen.get(dest_id) == dest_screen_id:
                        trigger_type = (trig.get('type') or trig or '') if trig is not None else None
                        action_type = (action.get('type') or '').upper() or None
                        delay_ms = (
                            _to_ms((trig or {}).get('delay'))
                            or _to_ms((trig or {}).get('timeout'))
                            or _to_ms((action.get('transition') or {}).get('delay') if isinstance(action.get('transition'), dict) else None)
                        )
                        break
                if trigger_type is not None:
                    break

        # Derive flags
        trig_lower = str(trigger_type or '').upper()
        is_click_anywhere = bool(source_element_id == source_screen_id and (trig_lower in {'', 'ON_CLICK', 'ON_TAP', 'ON_PRESS'}))
        is_auto_delay = bool(trig_lower in {'AFTER_TIMEOUT', 'AFTER_DELAY', 'DELAYED'} or (isinstance(delay_ms, int) and delay_ms > 0))

        # --- Compute normalized element bbox within frame (if available) ---
        def _get_bb(n: Dict[str, Any]) -> Optional[Dict[str, float]]:
            bb = n.get('absoluteBoundingBox') or None
            if not isinstance(bb, dict):
                return None
            try:
                return {
                    'x': float(bb.get('x') or 0.0),
                    'y': float(bb.get('y') or 0.0),
                    'w': float(bb.get('width') or 0.0),
                    'h': float(bb.get('height') or 0.0),
                }
            except Exception:
                return None

        elem_bb_abs = _get_bb(node) or {}
        frame_bb_abs = _get_bb(top_frames.get(source_screen_id, {})) or {}
        elem_bbox_norm: Optional[Dict[str, float]] = None
        try:
            ex, ey, ew, eh = elem_bb_abs['x'], elem_bb_abs['y'], elem_bb_abs['w'], elem_bb_abs['h']
            fx, fy, fw, fh = frame_bb_abs['x'], frame_bb_abs['y'], frame_bb_abs['w'], frame_bb_abs['h']
            nx = (ex - fx) / max(fw, 1.0)
            ny = (ey - fy) / max(fh, 1.0)
            nw = ew / max(fw, 1.0)
            nh = eh / max(fh, 1.0)
            if nw >= 0.0 and nh >= 0.0:
                elem_bbox_norm = {'x': nx, 'y': ny, 'w': nw, 'h': nh}
        except Exception:
            elem_bbox_norm = None

        # --- Parse UI role and inline metadata from element name ---
        def _parse_role(name: str) -> Optional[str]:
            s = (name or '').lower()
            if any(k in s for k in ['chevron', 'back', 'arrow']):
                return 'nav_back'
            if 'search' in s:
                return 'nav_search'
            if 'cart' in s or 'bag' in s:
                return 'nav_cart'
            if any(k in s for k in ['product', 'card', 'tile', 'item', 'thumbnail', 'photo']):
                return 'product_card'
            return None

        role = _parse_role(source_element_name)
        # Inline metadata convention: "role:product_card; product_id:xyz; product_name:Three Diamond Ring"
        def _parse_inline_meta(name: str) -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            s = (name or '')
            parts = [p.strip() for p in s.split(';')]
            for p in parts:
                if ':' in p:
                    k, v = p.split(':', 1)
                    k = k.strip().lower()
                    v = v.strip()
                    if k:
                        out[k] = v
            return out

        meta = _parse_inline_meta(source_element_name)
        if not role and isinstance(meta.get('role'), str):
            role = meta.get('role')

        links.append(PrototypeLink(
            source_screen_name=source_screen_name,
            source_screen_id=source_screen_id,
            source_element_name=source_element_name,
            source_element_id=source_element_id,
            destination_screen_name=dest_screen_name,
            destination_screen_id=dest_screen_id,
            trigger_type=trigger_type,
            action_type=action_type,
            delay_ms=delay_ms,
            is_click_anywhere=is_click_anywhere,
            is_auto_delay=is_auto_delay,
            elem_bbox_norm=elem_bbox_norm,
            ui_role=role,
            meta=meta or None,
        ))

    return links


def save_csv(links: List[PrototypeLink], csv_file: str):
    links_sorted = sorted(links, key=lambda l: (l.source_screen_name, l.destination_screen_name))
    with open(csv_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'source_screen_name', 'source_screen_id', 'source_element_name', 'source_element_id',
            'destination_screen_name', 'destination_screen_id',
        ])
        for l in links_sorted:
            writer.writerow([
                l.source_screen_name, l.source_screen_id, l.source_element_name, l.source_element_id,
                l.destination_screen_name, l.destination_screen_id,
            ])


def main():
    parser = argparse.ArgumentParser(description='Extract prototype navigation links from a Figma page')
    parser.add_argument('--token', dest='token', default=None, help='Figma personal access token (defaults to FIGMA_TOKEN from .env)')
    parser.add_argument('--figma-url', dest='figma_url', default=None, help='Figma file URL')
    parser.add_argument('--page', dest='page', required=True, help='Exact page name to extract from')
    parser.add_argument('--output', default='logs/prototype_links.json', help='JSON output file name')
    parser.add_argument('--csv', default='logs/prototype_links.csv', help='CSV output file name')
    parser.add_argument('--out-dir', default='logs', help='Output folder for this run')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    args = parser.parse_args()

    load_dotenv()
    token = args.token or os.getenv('FIGMA_TOKEN')
    if not token:
        print('Missing token. Pass --token or set FIGMA_TOKEN in .env')
        sys.exit(1)

    figma_url = args.figma_url or os.getenv('FIGMA_FILE_URL')
    if not figma_url:
        print('Missing Figma URL (pass --figma-url or set FIGMA_FILE_URL in env)')
        sys.exit(1)

    try:
        file_key = extract_file_key(figma_url)
    except Exception as e:
        print(f'Error parsing figma_url: {e}')
        sys.exit(1)

    if args.verbose:
        print('[extract_links] Starting link extraction', flush=True)
        print('[extract_links] file_key:', file_key, flush=True)
        print('[extract_links] page:', args.page, flush=True)

    # Fetch full file JSON and locate page
    file_json = fetch_file(token, file_key)
    page_doc = find_page_document(file_json, args.page)

    top_frames = find_top_level_frames(page_doc)
    node_to_screen = build_node_to_screen_mapping(page_doc, top_frames)
    links = extract_prototype_links(page_doc, top_frames, node_to_screen)

    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    links_data = [l.__dict__ for l in links]
    out_json = os.path.join(out_dir, os.path.basename(args.output))
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(links_data, f, indent=2, ensure_ascii=False)

    out_csv = os.path.join(out_dir, os.path.basename(args.csv))
    save_csv(links, out_csv)

    if args.verbose:
        print(f'[extract_links] Completed. Links: {len(links)}', flush=True)
    print(f'Saved {len(links)} prototype links')
    print(f'JSON → {out_json}')
    print(f'CSV  → {out_csv}')


if __name__ == '__main__':
    main()
