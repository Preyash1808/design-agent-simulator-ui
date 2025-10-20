#!/usr/bin/env python3
import os
import sys
import json
import pathlib
from typing import List, Dict


def normalize(s: str) -> str:
    return ''.join(ch.lower() for ch in (s or '') if ch.isalnum())


def has_id_prefix(name: str) -> bool:
    i = 0
    while i < len(name) and name[i].isdigit():
        i += 1
    return i > 0 and name[i:i+2] == '__'


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description='Prefix screen images with their screen id and update nodes json')
    parser.add_argument('--screens-dir', default='figma_screens', help='Directory containing exported screens')
    parser.add_argument('--nodes-json', required=True, help='Path to screen_nodes.json to read and update')
    args = parser.parse_args()

    screens_dir = pathlib.Path(args.screens_dir)
    nodes_path = pathlib.Path(args.nodes_json)
    if not screens_dir.exists():
        print(f'Screens dir not found: {screens_dir}')
        sys.exit(1)
    if not nodes_path.exists():
        print(f'Nodes JSON not found: {nodes_path}')
        sys.exit(1)

    nodes: List[Dict] = json.loads(nodes_path.read_text(encoding='utf-8'))
    # Build an index: normalized frame name (from file) -> list of node indices
    # We trust the nodes JSON file entries to reference files in screens_dir
    updated = 0
    for n in nodes:
        file_name = str(n.get('file') or '')
        if not file_name:
            continue
        src_path = screens_dir / file_name
        if not src_path.exists():
            # Try to locate by normalized name (ignore id prefix if present)
            stem = src_path.stem
            # remove existing id prefix in stem if any
            alt_stem = stem
            if has_id_prefix(stem):
                alt_stem = stem.split('__', 1)[1]
            candidates = list(screens_dir.glob(f'*{alt_stem}.png'))
            if candidates:
                src_path = candidates[0]
            else:
                continue
        # Build new name with id prefix if missing
        if not has_id_prefix(src_path.name):
            new_name = f"{int(n['id'])}__{src_path.name}"
            dst_path = src_path.with_name(new_name)
            try:
                src_path.rename(dst_path)
                n['file'] = dst_path.name
                updated += 1
            except Exception as e:
                print(f'WARN: rename failed for {src_path.name}: {e}')
                continue
        else:
            # Ensure nodes JSON matches actual file name if path differs
            n['file'] = src_path.name

    # Write back nodes json
    nodes_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Updated {updated} filenames; wrote {nodes_path}')


if __name__ == '__main__':
    main()


