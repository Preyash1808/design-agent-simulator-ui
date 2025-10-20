#!/usr/bin/env python3
"""
Render a visual graph using actual screen images as nodes and arrows for links.

Inputs (from a single run folder):
- screen_nodes.json: includes integral id, name, file, screen_id (figma id)
- prototype_links_enriched.json: includes source/destination figma screen ids and linkId
- screens/ folder: copied page screens for this run (filenames match screen_nodes.json)

Output:
- PNG image with thumbnails laid out radially, each annotated with screen_nodes.id and name
- Arrows between screens for each link, annotated with linkId
"""

import argparse
import json
import math
import pathlib
from typing import Dict, Any, List, Tuple, Optional

from PIL import Image, ImageDraw, ImageFont


def load_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding='utf-8'))


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def radial_positions(n: int, cx: int, cy: int, radius: int) -> List[Tuple[int, int]]:
    if n <= 0:
        return []
    coords: List[Tuple[int, int]] = []
    for i in range(n):
        theta = 2.0 * math.pi * (i / n)
        x = cx + int(math.cos(theta) * radius)
        y = cy + int(math.sin(theta) * radius)
        coords.append((x, y))
    return coords


def fit_image(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    w, h = img.size
    scale = min(target_w / max(1, w), target_h / max(1, h))
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    return img.resize((nw, nh), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description='Render an image graph with screen thumbnails and link IDs')
    parser.add_argument('--run-dir', required=True, help='Path to a logs/run_* folder')
    parser.add_argument('--out', default=None, help='Output PNG path (default: run_dir/image_graph.png)')
    parser.add_argument('--canvas', type=int, nargs=2, default=[8000, 8000], help='Canvas size WxH (default: 8000 8000)')
    parser.add_argument('--thumb', type=int, nargs=2, default=[700, 1200], help='Max thumbnail size WxH (default: 700 1200)')
    args = parser.parse_args()

    run_dir = pathlib.Path(args.run_dir)
    nodes_path = run_dir / 'screen_nodes.json'
    links_path = run_dir / 'prototype_links_enriched.json'
    screens_dir = run_dir / 'screens'
    if not nodes_path.exists() or not links_path.exists() or not screens_dir.exists():
        raise SystemExit('Missing run artifacts (screen_nodes.json, prototype_links_enriched.json, screens/)')

    nodes = load_json(nodes_path)
    links = load_json(links_path)

    # Build figma screen_id (string) -> (node_id:int, name:str, file:str)
    figma_to_node: Dict[str, Tuple[int, str, str]] = {}
    node_ids_order: List[int] = []
    for n in nodes:
        try:
            nid = int(n.get('id'))
        except Exception:
            continue
        name = str(n.get('name') or '')
        file = str(n.get('file') or '')
        figma_id = str(n.get('screen_id') or '')
        if figma_id:
            figma_to_node[figma_id] = (nid, name, file)
        node_ids_order.append(nid)

    # Collect unique node ids present in links
    node_ids: List[int] = []
    def push_unique(x: int):
        if x not in node_ids:
            node_ids.append(x)

    edges: List[Tuple[int, int, int]] = []  # (src_id, dest_id, linkId)
    for l in links:
        s_fig = str(l.get('source_screen_id') or '')
        d_fig = str(l.get('destination_screen_id') or '')
        src = figma_to_node.get(s_fig)
        dst = figma_to_node.get(d_fig)
        if not src or not dst:
            continue
        src_id, _, _ = src
        dst_id, _, _ = dst
        push_unique(src_id)
        push_unique(dst_id)
        edges.append((src_id, dst_id, int(l.get('linkId') or 0)))

    # Stable order
    node_ids.sort()

    # Layout
    W, H = args.canvas
    cx, cy = W // 2, H // 2
    radius = min(W, H) // 2 - 600
    centers = radial_positions(len(node_ids), cx, cy, radius)
    id_to_center: Dict[int, Tuple[int, int]] = {nid: pos for nid, pos in zip(node_ids, centers)}

    # Create canvas
    img = Image.new('RGB', (W, H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    title_font = load_font(36)
    label_font = load_font(28)
    small_font = load_font(24)

    # Preload thumbs and boxes
    id_to_box: Dict[int, Tuple[int, int, int, int]] = {}
    max_tw, max_th = args.thumb

    # Draw nodes (thumbnails)
    for nid in node_ids:
        # Find node record by id
        rec = next((n for n in nodes if int(n.get('id') or -1) == nid), None)
        if not rec:
            continue
        fn = rec.get('file') or ''
        name = rec.get('name') or ''
        p = screens_dir / fn
        try:
            base = Image.open(p).convert('RGB')
        except Exception:
            # placeholder
            base = Image.new('RGB', (max_tw, max_th), color=(245, 245, 245))
        thumb = fit_image(base, max_tw, max_th)
        tw, th = thumb.size
        cxn, cyn = id_to_center.get(nid, (cx, cy))
        x1 = cxn - tw // 2
        y1 = cyn - th // 2
        x2 = x1 + tw
        y2 = y1 + th
        img.paste(thumb, (x1, y1))
        id_to_box[nid] = (x1, y1, x2, y2)
        # Label bar
        label = f"id={nid} {name}"
        lh = title_font.getbbox(label)[3] - title_font.getbbox(label)[1]
        draw.rectangle([x1, y1 - lh - 10, x1 + (tw), y1 - 2], fill=(245, 250, 255), outline=(60, 110, 200))
        draw.text((x1 + 8, y1 - lh - 8), label, fill=(20, 40, 90), font=title_font)

    # Helper to anchor line on box edge towards target
    def anchor_towards(box: Tuple[int, int, int, int], target: Tuple[int, int]) -> Tuple[int, int]:
        x1, y1, x2, y2 = box
        cx0, cy0 = (x1 + x2) // 2, (y1 + y2) // 2
        tx, ty = target
        dx, dy = tx - cx0, ty - cy0
        if abs(dx) * (y2 - y1) > abs(dy) * (x2 - x1):
            return (x2 if dx > 0 else x1, cy0)
        return (cx0, y2 if dy > 0 else y1)

    # Draw edges with linkId labels
    def draw_arrow(p1: Tuple[int, int], p2: Tuple[int, int], color=(80, 80, 80), width=5):
        draw.line([p1, p2], fill=color, width=width)
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        head_len, head_w = 26, 14
        hx, hy = p2[0] - int(ux * head_len), p2[1] - int(uy * head_len)
        px, py = -uy, ux
        p_left = (hx + int(px * head_w), hy + int(py * head_w))
        p_right = (hx - int(px * head_w), hy - int(py * head_w))
        draw.polygon([p2, p_left, p_right], fill=color)

    for (src_id, dst_id, link_id) in edges:
        if src_id not in id_to_box or dst_id not in id_to_box:
            continue
        b1 = id_to_box[src_id]
        b2 = id_to_box[dst_id]
        c2 = ((b2[0] + b2[2]) // 2, (b2[1] + b2[3]) // 2)
        c1 = ((b1[0] + b1[2]) // 2, (b1[1] + b1[3]) // 2)
        a1 = anchor_towards(b1, c2)
        a2 = anchor_towards(b2, c1)
        # Offset a bend point outward from canvas center to reduce overlap
        mx, my = (a1[0] + a2[0]) // 2, (a1[1] + a2[1]) // 2
        vx, vy = mx - cx, my - cy
        nn = math.hypot(vx, vy) or 1.0
        ox, oy = int(vx / nn * 120), int(vy / nn * 120)
        pB = (mx + ox, my + oy)
        draw_arrow(a1, pB)
        draw_arrow(pB, a2)
        # Label linkId near bend
        label = f"linkId={link_id}"
        lw = small_font.getbbox(label)[2] - small_font.getbbox(label)[0]
        lh = small_font.getbbox(label)[3] - small_font.getbbox(label)[1]
        lx, ly = pB[0] - lw // 2, pB[1] - lh // 2
        draw.rectangle([lx - 6, ly - 4, lx + lw + 6, ly + lh + 4], fill=(248, 248, 248), outline=(120, 120, 120))
        draw.text((lx, ly), label, fill=(10, 10, 10), font=small_font)

    out_path = pathlib.Path(args.out) if args.out else (run_dir / 'image_graph.png')
    img.save(out_path)
    print(f"Image graph written → {out_path}")


if __name__ == '__main__':
    main()


