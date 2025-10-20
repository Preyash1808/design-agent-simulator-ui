#!/usr/bin/env python3
import os
import sys
import json
import pathlib
import argparse
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / 'config' / 'figma.config.json'


def read_env():
    load_dotenv()
    token = os.getenv('FIGMA_TOKEN')
    if not token:
        print('Missing FIGMA_TOKEN in .env')
        sys.exit(1)
    return token


def read_config():
    return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))


def extract_file_key(link: str) -> str:
    parts = [p for p in urlparse(link).path.split('/') if p]
    if 'design' in parts:
        return parts[parts.index('design') + 1]
    if 'file' in parts:
        return parts[parts.index('file') + 1]
    raise SystemExit('Could not parse file key from link')


def fetch_file(token: str, file_key: str):
    r = requests.get(
        f'https://api.figma.com/v1/files/{file_key}',
        headers={'X-Figma-Token': token},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def fetch_image_url(token: str, file_key: str, node_id: str, fmt: str, scale: int, absolute: bool):
    params = {
        'ids': node_id,
        'format': fmt,
        'scale': str(scale),
    }
    if absolute:
        params['use_absolute_bounds'] = 'true'
    r = requests.get(
        f'https://api.figma.com/v1/images/{file_key}',
        headers={'X-Figma-Token': token},
        params=params,
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get('images', {}).get(node_id)


def main():
    parser = argparse.ArgumentParser(description='Export a Figma page image directly (no post-processing).')
    parser.add_argument('--page', default='Arrows 2', help='Page name to export')
    parser.add_argument('--format', default='jpg', choices=['jpg', 'png'], help='Image format (jpg has white background)')
    parser.add_argument('--scale', default=2, type=int, help='Export scale (1-4)')
    parser.add_argument('--out', default='', help='Output path (defaults to logs/<page>.<ext>)')
    parser.add_argument('--absolute-bounds', action='store_true', help='Use absolute bounds in export')
    args = parser.parse_args()

    token = read_env()
    cfg = read_config()
    key = extract_file_key(cfg.get('figmaFileUrl', ''))

    data = fetch_file(token, key)
    page = None
    for p in data['document'].get('children', []) or []:
        if p.get('name') == args.page:
            page = p
            break
    if not page:
        print(f'Page not found: {args.page}')
        sys.exit(1)

    url = fetch_image_url(token, key, page['id'], args.format, args.scale, args.absolute_bounds)
    if not url:
        print('Failed to obtain image URL')
        sys.exit(1)

    out_path = pathlib.Path(args.out) if args.out else (ROOT / 'logs' / f"{args.page}.{args.format}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    b = requests.get(url, timeout=120).content
    out_path.write_bytes(b)
    print(f'Saved {out_path.resolve()}')


if __name__ == '__main__':
    main()




