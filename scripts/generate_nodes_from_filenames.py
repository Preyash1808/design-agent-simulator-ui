#!/usr/bin/env python3
"""
Fallback node generator that does NOT require an LLM.

Builds screen_nodes.json from a screens directory by parsing filenames
produced by export_figma_screens.py (format: "<Page>__<FrameName>[__N].png").

Each node:
- id (int, incremental)
- name (FrameName)
- description (short user-centric summary based on the name)
- file (original filename)

Usage:
  python scripts/generate_nodes_from_filenames.py \
    --screens-dir figma_screens \
    --out logs/screen_nodes.json \
    --start-id 1
"""

import argparse
import json
import pathlib
import re
from typing import List, Dict


def sanitize_name(s: str) -> str:
    s = re.sub(r"[_\-]+", " ", s).strip()
    s = re.sub(r"\s+", " ", s)
    return s or "Screen"


def frame_name_from_filename(stem: str) -> str:
    # Expect "Page__FrameName[__N]"
    if "__" in stem:
        _, rest = stem.split("__", 1)
    else:
        rest = stem
    # Strip optional numeric suffix after another "__"
    if "__" in rest:
        rest = rest.split("__", 1)[0]
    return sanitize_name(rest)


def main():
    parser = argparse.ArgumentParser(description="Generate screen_nodes.json from filenames")
    parser.add_argument("--screens-dir", default="figma_screens")
    parser.add_argument("--out", default="logs/screen_nodes.json")
    parser.add_argument("--start-id", type=int, default=1)
    args = parser.parse_args()

    screens_dir = pathlib.Path(args.screens_dir)
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    images: List[pathlib.Path] = sorted(
        [p for p in screens_dir.glob("*.png")]
    )
    nodes: List[Dict] = []
    next_id = int(args.start_id)
    for img in images:
        name = frame_name_from_filename(img.stem)
        desc = f"This view shows '{name}', presenting content and actions to continue the task."
        nodes.append({
            "id": int(next_id),
            "name": name,
            "description": desc,
            "file": img.name,
        })
        next_id += 1

    out_path.write_text(json.dumps(nodes, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(nodes)} nodes to {out_path}")


if __name__ == "__main__":
    main()



