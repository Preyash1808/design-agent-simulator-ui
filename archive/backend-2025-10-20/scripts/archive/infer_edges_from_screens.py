#!/usr/bin/env python3
import os
import sys
import json
import re
import base64
import pathlib
from typing import Dict, List, Any

from dotenv import load_dotenv
from PIL import Image
import google.generativeai as genai

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCREENS_DIR = ROOT / 'figma_screens'
NODES_PATH = ROOT / 'logs' / 'screen_nodes.json'
LOGS_DIR = ROOT / 'logs'
EDGES_PATH = LOGS_DIR / 'screen_edges.json'


def image_to_base64(path: pathlib.Path) -> str:
    from io import BytesIO
    with Image.open(path) as img:
        img = img.convert('RGBA')
        buf = BytesIO()
        img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def load_nodes() -> List[Dict[str, Any]]:
    with open(NODES_PATH, 'r', encoding='utf-8') as f:
        nodes = json.load(f)
    # Validate minimal schema
    validated = []
    for n in nodes:
        try:
            validated.append({
                'id': int(n['id']),
                'name': str(n.get('name') or ''),
                'description': str(n.get('description') or ''),
                'file': str(n.get('file') or ''),
            })
        except Exception:
            continue
    return validated


def sanitize_action_key(text: str) -> str:
    key = text.lower()
    key = re.sub(r'[^a-z0-9]+', '_', key).strip('_')
    key = re.sub(r'_+', '_', key)
    key = key or 'action'
    return key[:80]


def ask_edges_for_screen(model, src_node: Dict[str, Any], candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Prepare prompt
    cands_brief = [
        { 'id': c['id'], 'name': c['name'] } for c in candidates
        if c['id'] != src_node['id']
    ]

    system_prompt = (
        "You are mapping app navigation as a directed graph. Given one source screen image, "
        "infer likely navigation edges to a set of destination screens based on visible UI "
        "controls like buttons, tabs, and links. Return STRICT JSON with an 'edges' array only. "
        "Each edge item must have: source (int), destination (int), action_key (string, snake_case), "
        "action_description (short phrase), and confidence (0..1). Use only destination IDs from the list. "
        "If uncertain, return an empty list."
    )

    user_brief = {
        'source': { 'id': src_node['id'], 'name': src_node['name'] },
        'destinations': cands_brief
    }

    # Send image + text
    parts = [
        { 'text': system_prompt },
        { 'text': json.dumps(user_brief, ensure_ascii=False) }
    ]

    # Include the image
    img_path = SCREENS_DIR / src_node['file']
    img_b64 = image_to_base64(img_path)
    parts.append({ 'inline_data': { 'mime_type': 'image/png', 'data': img_b64 } })

    resp = model.generate_content(parts)
    raw = (resp.text or '').strip()

    # Strip code fences if any
    if raw.startswith('```'):
        raw = raw.strip('`')
        if raw.startswith('json'):
            raw = raw[4:]

    edges: List[Dict[str, Any]] = []
    try:
        data = json.loads(raw)
        for e in data.get('edges', []):
            try:
                src = int(e.get('source', src_node['id']))
                dst = int(e['destination'])
                if not any(c['id'] == dst for c in cands_brief):
                    continue
                action_desc = str(e.get('action_description') or 'tap')
                action_key = e.get('action_key') or sanitize_action_key(action_desc)
                edges.append({
                    'source': src,
                    'destination': dst,
                    'action_key': sanitize_action_key(action_key),
                    'confidence': float(e.get('confidence', 0.5)),
                })
            except Exception:
                continue
    except Exception:
        # If parse failed, no edges for this screen
        pass
    return edges


def main():
    load_dotenv()
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print('Missing GEMINI_API_KEY in .env')
        sys.exit(1)

    if not NODES_PATH.exists():
        print(f'Missing nodes file at {NODES_PATH}')
        sys.exit(1)
    if not SCREENS_DIR.exists():
        print(f'Missing screens dir at {SCREENS_DIR}')
        sys.exit(1)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-flash')

    nodes = load_nodes()
    id_to_node = { n['id']: n for n in nodes }

    all_edges: List[Dict[str, Any]] = []

    for src in nodes:
        try:
            edges = ask_edges_for_screen(model, src, nodes)
            all_edges.extend(edges)
            print(f'Inferred {len(edges)} edges from node {src["id"]} ({src["name"]})')
        except Exception as e:
            print(f'Failed inferring edges for node {src["id"]}: {e}')

    # Assign incremental ids
    for idx, e in enumerate(all_edges, start=1):
        e['id'] = int(idx)

    # Build actions map (action_key -> description)
    actions: Dict[str, str] = {}
    for e in all_edges:
        # Describe action by combining key into a readable label
        label = e['action_key'].replace('_', ' ')
        actions.setdefault(e['action_key'], label)

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    with open(EDGES_PATH, 'w', encoding='utf-8') as f:
        json.dump({ 'actions': actions, 'edges': all_edges }, f, ensure_ascii=False, indent=2)

    print(f'Wrote {len(all_edges)} edges to {EDGES_PATH}')


if __name__ == '__main__':
    main()


