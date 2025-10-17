#!/usr/bin/env python3
import os
import sys
import json
import base64
import argparse
import pathlib
import hashlib
from typing import List, Dict

from dotenv import load_dotenv
from PIL import Image
import google.generativeai as genai

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCREENS_DIR_DEFAULT = ROOT / 'figma_screens'
LOGS_DIR = ROOT / 'logs'
OUTPUT_PATH_DEFAULT = LOGS_DIR / 'screen_nodes.json'
SCREENS_MANIFEST = LOGS_DIR / 'screens_manifest.json'


def list_image_files(directory: pathlib.Path) -> List[pathlib.Path]:
    exts = {'.png', '.jpg', '.jpeg', '.webp'}
    return sorted([p for p in directory.iterdir() if p.suffix.lower() in exts])


def has_id_prefix(name: str) -> bool:
    # Helper (unused now): starts with digits + '__'
    i = 0
    while i < len(name) and name[i].isdigit():
        i += 1
    return i > 0 and name[i:i+2] == '__'


def file_sha1(path: pathlib.Path) -> str:
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()


def image_to_base64(path: pathlib.Path) -> str:
    with Image.open(path) as img:
        # Normalize to PNG for consistent upload
        img = img.convert('RGBA')
        from io import BytesIO
        buf = BytesIO()
        img.save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode('utf-8')


def describe_screen(model, image_b64: str, filename: str, *, timeout_sec: int = 30, max_retries: int = 2) -> Dict:
    prompt = (
        "You are documenting UI screens as graph nodes. "
        "Given a single app screen image, return a short JSON with fields: "
        "id (string), name (human-readable concise title), description (1-2 lines). "
        "Do not include transitions or links. Keep it specific to what the screen shows. "
        f"Use the filename as a hint: {filename}."
    )

    # Gemini's Python SDK expects input as parts; we send text + image
    # Best-effort with retry
    last_err = None
    for attempt in range(max(1, int(max_retries)) + 1):
        try:
            response = model.generate_content([
                {"text": prompt},
                {"inline_data": {"mime_type": "image/png", "data": image_b64}},
            ], request_options={"timeout": int(timeout_sec)})
            break
        except Exception as e:
            last_err = e
            if attempt >= max(1, int(max_retries)):
                # Fallback: deterministic stub to keep pipeline moving
                return {
                    "id": filename,
                    "name": filename.rsplit('.', 1)[0],
                    "description": "Screen image analyzed with fallback due to LLM timeout.",
                }
            continue

    text = response.text or "{}"
    # Attempt to parse JSON directly; if the model included code fences, strip them
    cleaned = text.strip()
    if cleaned.startswith('```'):
        cleaned = cleaned.strip('`')
        if cleaned.startswith('json'):
            cleaned = cleaned[4:]
    try:
        obj = json.loads(cleaned)
    except Exception:
        raise RuntimeError('LLM response did not return valid JSON for describe_screen')
    return obj


def main():
    load_dotenv()
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not api_key:
        print('Missing GEMINI_API_KEY in .env')
        sys.exit(1)

    # Ensure SDK picks REST public endpoint instead of Vertex fallback
    os.environ.setdefault('GOOGLE_API_KEY', api_key)

    parser = argparse.ArgumentParser(description='Analyze screens and generate node log with integer IDs')
    parser.add_argument('--start-id', type=int, default=1, help='Starting integer ID (default: 1)')
    parser.add_argument('--screens-dir', type=str, default=str(SCREENS_DIR_DEFAULT), help='Directory containing screen images')
    parser.add_argument('--out', type=str, default=str(OUTPUT_PATH_DEFAULT), help='Path to write screen_nodes.json')
    parser.add_argument('--timeout-sec', type=int, default=int(os.getenv('LLM_TIMEOUT_SEC', '30')), help='Per-call timeout')
    parser.add_argument('--retries', type=int, default=int(os.getenv('LLM_RETRIES', '2')), help='Number of retries on timeout/error')
    args = parser.parse_args()

    screens_dir = pathlib.Path(args.screens_dir)
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not screens_dir.exists():
        print(f'No screens directory found at {screens_dir}')
        sys.exit(1)

    genai.configure(api_key=api_key)
    model_name = os.getenv('MODEL_NAME', 'gemini-2.5-pro')
    model = genai.GenerativeModel(model_name)

    imgs = list_image_files(screens_dir)
    if not imgs:
        print('No images found to analyze.')
        sys.exit(0)

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    nodes = []
    manifest = []
    if SCREENS_MANIFEST.exists():
        try:
            manifest = json.loads(SCREENS_MANIFEST.read_text(encoding='utf-8'))
        except Exception:
            manifest = []

    for idx, p in enumerate(imgs, start=args.start_id):
        img_b64 = image_to_base64(p)
        node = describe_screen(model, img_b64, p.name, timeout_sec=args.timeout_sec, max_retries=args.retries)
        # Force integral ID and ensure required fields
        node['id'] = int(idx)
        if 'name' not in node:
            node['name'] = p.stem
        if 'description' not in node:
            node['description'] = 'UI screen'
        # Keep original filename; mapping to id is stored in screen_nodes.json
        node['file'] = p.name
        # Attach figma node id if present in manifest
        try:
            rec = next((m for m in manifest if m.get('filename') == p.name), None)
            if rec and rec.get('node_id'):
                node['screen_id'] = str(rec['node_id'])
        except Exception:
            pass
        nodes.append(node)
        print(f'Analyzed: {p.name}')

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(nodes, f, ensure_ascii=False, indent=2)
    print(f'Wrote {len(nodes)} nodes to {out_path}')


if __name__ == '__main__':
    main()


