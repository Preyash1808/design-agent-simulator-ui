#!/usr/bin/env python3
import os
import sys
import json
import re
import pathlib
import argparse
import shutil
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGS_DIR = ROOT / 'logs'
CONFIG_PATH = ROOT / 'config' / 'figma.config.json'
OUTPUT_DIR = ROOT / 'figma_screens'


def read_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


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


def fetch_file(token: str, file_key: str) -> dict:
    res = requests.get(
        f'https://api.figma.com/v1/files/{file_key}',
        headers={'X-Figma-Token': token},
        timeout=60,
    )
    res.raise_for_status()
    return res.json()


def fetch_images(token: str, file_key: str, node_ids: list[str]) -> dict:
    res = requests.get(
        f'https://api.figma.com/v1/images/{file_key}',
        headers={'X-Figma-Token': token},
        params={
            'ids': ','.join(node_ids),
            'format': 'png',
            'scale': 2,
        },
        timeout=60,
    )
    res.raise_for_status()
    return res.json().get('images', {})


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[^a-zA-Z0-9\-_. ]+', '_', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name or 'untitled'


def collect_top_level_frames(document: dict, allowed_pages=None) -> tuple[list[dict], dict[str, str]]:
    frames: list[dict] = []
    page_name_by_id: dict[str, str] = {}
    pages = document.get('children', []) or []
    for page in pages:
        page_name = page.get('name') or 'Page'
        if allowed_pages is not None and page_name not in allowed_pages:
            continue
        for child in page.get('children', []) or []:
            if child.get('type') == 'FRAME':
                frames.append(child)
                page_name_by_id[child.get('id')] = page_name
    return frames, page_name_by_id


def ensure_dir(dir_path: pathlib.Path) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)


def clean_output_dir(dir_path: pathlib.Path) -> None:
    if dir_path.exists():
        shutil.rmtree(dir_path)
    dir_path.mkdir(parents=True, exist_ok=True)


def download_image(url: str, out_path: pathlib.Path) -> None:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    out_path.write_bytes(r.content)


def main():
    load_dotenv()
    token = os.getenv('FIGMA_TOKEN')
    if not token:
        print('Missing FIGMA_TOKEN. Set it in .env')
        sys.exit(1)

    config = read_config()
    parser = argparse.ArgumentParser(description='Export Figma frames as PNGs')
    parser.add_argument('--page', dest='pages', action='append', default=None,
                        help='Export only from a page with this exact name. Repeat for multiple pages.')
    parser.add_argument('--figma-url', dest='figma_url', default=None,
                        help='Figma file URL to override config file key')
    parser.add_argument('--out-dir', dest='out_dir', default=None,
                        help='Directory to write exported PNGs (defaults to figma_screens under repo root)')
    args = parser.parse_args()

    figma_url = args.figma_url or config.get('figmaFileUrl')
    if not figma_url:
        print('Missing Figma URL (pass --figma-url or set in config/figma.config.json)')
        sys.exit(1)

    file_key = extract_file_key(figma_url)
    print(f'Using Figma file key: {file_key}')

    file_data = fetch_file(token, file_key)
    allowed_pages = set(args.pages) if args.pages else None
    if allowed_pages:
        print(f'Filtering to pages: {", ".join(sorted(allowed_pages))}')
    frames, page_name_by_id = collect_top_level_frames(file_data.get('document', {}), allowed_pages)
    if not frames:
        print('No frames found to export.')
        return

    # Resolve output directory (per-run path when provided)
    out_dir = pathlib.Path(args.out_dir) if args.out_dir else OUTPUT_DIR
    clean_output_dir(out_dir)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    node_ids = [f.get('id') for f in frames]
    name_by_id = {f.get('id'): f.get('name') for f in frames}
    used_counts: dict[str, int] = {}
    images_map = fetch_images(token, file_key, node_ids)

    count = 0
    manifest: list[dict] = []
    for node_id, image_url in images_map.items():
        if not image_url:
            print(f'No image URL for frame {name_by_id.get(node_id) or node_id}')
            continue
        page_name = sanitize_filename(page_name_by_id.get(node_id) or 'Page')
        frame_name = sanitize_filename(name_by_id.get(node_id) or node_id)
        base = f'{page_name}__{frame_name}'
        used_counts[base] = used_counts.get(base, 0) + 1
        suffix = '' if used_counts[base] == 1 else f'__{used_counts[base]}'
        out_path = out_dir / f'{base}{suffix}.png'
        download_image(image_url, out_path)
        print(f'Saved: {out_path}')
        count += 1
        manifest.append({
            'file_key': file_key,
            'page_name': page_name,
            'frame_name': name_by_id.get(node_id) or node_id,
            'node_id': node_id,
            'filename': out_path.name,
        })

    # Write manifest for downstream steps
    (LOGS_DIR / 'screens_manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    print(f'Export complete. Saved {count} screens to {out_dir}')


if __name__ == '__main__':
    main()


