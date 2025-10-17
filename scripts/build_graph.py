#!/usr/bin/env python3
"""
Build and save a detailed graph image from enriched prototype links.

Each unique screen becomes a node; edges represent prototype links.
Node includes: screen name, screen id, and a consolidated user-facing description.
Edge label includes: linkId, click_target, and user_intent.

Output: PNG image saved to the provided --out path.
"""

import json
import math
import pathlib
import argparse
from typing import Dict, Any, List, Tuple, Optional

from PIL import Image, ImageDraw, ImageFont


def load_enriched(path: pathlib.Path) -> List[Dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


def collect_nodes_and_edges(links: List[Dict[str, Any]]):
    # Collect nodes keyed by screen name
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []

    def ensure_node(name: str, sid: str, candidate_desc: str) -> None:
        if not name:
            return
        if name not in nodes:
            nodes[name] = {
                'name': name,
                'id': sid or '',
                'description': candidate_desc or ''
            }
        else:
            # Prefer the longer, more informative description
            prev = nodes[name].get('description') or ''
            if (candidate_desc or '') and len(candidate_desc) > len(prev):
                nodes[name]['description'] = candidate_desc

    for l in links:
        s_name = str(l.get('source_screen_name') or '')
        s_id = str(l.get('source_screen_id') or '')
        d_name = str(l.get('destination_screen_name') or '')
        d_id = str(l.get('destination_screen_id') or '')
        s_desc = str(l.get('source_screen_description') or '')
        d_desc = str(l.get('destination_screen_description') or '')

        ensure_node(s_name, s_id, s_desc)
        ensure_node(d_name, d_id, d_desc)

        # Classify edge kind: frame-level (screen→screen) vs element→screen
        src_elem_id = str(l.get('source_element_id') or '')
        src_elem_name = str(l.get('source_element_name') or '')
        edge_kind = 'element'
        if (src_elem_id and src_elem_id == s_id) or (src_elem_name and src_elem_name == s_name):
            edge_kind = 'frame'
        # Prefer explicit flags if present
        is_wait = bool(l.get('is_auto_delay'))
        is_click_anywhere = bool(l.get('is_click_anywhere'))
        # Heuristic fallback from text only if flags missing
        if l.get('is_auto_delay') is None:
            ct_txt = str(l.get('click_target') or '').lower()
            ui_txt = str(l.get('user_intent') or '').lower()
            is_wait = any(k in ct_txt or k in ui_txt for k in ['wait', 'loading', 'auto', 'automatically'])

        edges.append({
            'source': s_name,
            'target': d_name,
            'linkId': int(l.get('linkId') or 0),
            'click_target': str(l.get('click_target') or ''),
            'user_intent': str(l.get('user_intent') or ''),
            'source_element_name': str(l.get('source_element_name') or ''),
            'source_element_id': str(l.get('source_element_id') or ''),
            'edge_kind': edge_kind,
            'is_wait': bool(is_wait),
            'is_click_anywhere': bool(is_click_anywhere),
        })

    # Sort edges by linkId for deterministic labeling
    edges.sort(key=lambda e: e.get('linkId', 0))
    # Freeze node order deterministically (name)
    node_names = sorted(nodes.keys())
    ordered_nodes = [nodes[n] for n in node_names]
    return ordered_nodes, edges
def normalize(s: str) -> str:
    return ''.join(ch.lower() for ch in (s or '') if ch.isalnum())


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



def build_layers(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[int, List[str]]:
    """Assign nodes to left-to-right layers using indegree-based BFS.
    Falls back to minimal-indegree roots if there are no true roots.
    """
    names = [n['name'] for n in nodes]
    name_set = set(names)
    # adjacency and indegree by name
    adj: Dict[str, List[str]] = {n: [] for n in names}
    indeg: Dict[str, int] = {n: 0 for n in names}
    for e in edges:
        s = e.get('source')
        t = e.get('target')
        if s in name_set and t in name_set:
            adj[s].append(t)
            indeg[t] += 1

    min_indeg = min(indeg.values()) if indeg else 0
    roots = [n for n, d in indeg.items() if d == 0]
    if not roots:
        roots = [n for n, d in indeg.items() if d == min_indeg]
    # BFS layering
    layer_of: Dict[str, int] = {n: -1 for n in names}
    from collections import deque
    dq = deque()
    for r in sorted(roots):
        layer_of[r] = 0
        dq.append(r)
    while dq:
        u = dq.popleft()
        for v in adj.get(u, []):
            if layer_of[v] == -1:
                layer_of[v] = layer_of[u] + 1
                dq.append(v)
    # Any unassigned nodes: place at layer 0 (disconnected subgraphs)
    for n in names:
        if layer_of[n] == -1:
            layer_of[n] = 0

    # Group by layer and sort within layer by name
    by_layer: Dict[int, List[str]] = {}
    for n in names:
        L = layer_of[n]
        by_layer.setdefault(L, []).append(n)
    for L in by_layer:
        by_layer[L].sort()
    # Normalize layers to start at 0 with no gaps
    sorted_layers = sorted(by_layer.keys())
    remap = {old: i for i, old in enumerate(sorted_layers)}
    return {remap[L]: by_layer[L] for L in by_layer}


def load_font(size: int) -> ImageFont.ImageFont:
    # Try a few common fonts, fall back to default
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


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> List[str]:
    if not text:
        return []
    words = text.split()
    lines: List[str] = []
    line = ''
    for w in words:
        proposed = w if not line else f"{line} {w}"
        if draw.textlength(proposed, font=font) <= max_width:
            line = proposed
        else:
            if line:
                lines.append(line)
            # if single word too long, hard cut
            if draw.textlength(w, font=font) > max_width:
                # progressively split long word
                cut = ''
                for ch in w:
                    if draw.textlength(cut + ch, font=font) <= max_width:
                        cut += ch
                    else:
                        lines.append(cut)
                        cut = ch
                line = cut
            else:
                line = w
    if line:
        lines.append(line)
    return lines


def radial_layout(n: int, cx: int, cy: int, radius: int) -> List[Tuple[int, int]]:
    if n <= 0:
        return []
    coords: List[Tuple[int, int]] = []
    for i in range(n):
        theta = 2.0 * math.pi * (i / n)
        x = cx + int(math.cos(theta) * radius)
        y = cy + int(math.sin(theta) * radius)
        coords.append((x, y))
    return coords


def draw_arrow(draw: ImageDraw.ImageDraw, p1: Tuple[int, int], p2: Tuple[int, int], color=(60, 60, 60), width=3, head_len=16, head_w=8):
    # line
    draw.line([p1, p2], fill=color, width=width)
    # arrow head at p2
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    hx = p2[0] - int(ux * head_len)
    hy = p2[1] - int(uy * head_len)
    # perpendicular
    px, py = -uy, ux
    p_left = (hx + int(px * head_w), hy + int(py * head_w))
    p_right = (hx - int(px * head_w), hy - int(py * head_w))
    draw.polygon([p2, p_left, p_right], fill=color)


def render_graph(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]], out_path: pathlib.Path, layout: str = 'radial', screen_nodes_map: Optional[Dict[str, int]] = None) -> None:
    # Fonts
    title_font = load_font(34)
    label_font = load_font(26)
    small_font = load_font(22)

    # Node box and spacing (bigger canvas and boxes for clarity)
    box_w, box_h = 680, 460
    margin = 260

    # Large canvas to reduce clutter
    W, H = 7000, 7000
    img = Image.new('RGB', (W, H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Color palette for nodes (pastels)
    palette = [
        (232, 245, 255), (235, 255, 245), (255, 245, 232), (245, 235, 255), (255, 240, 245),
        (240, 255, 240), (255, 250, 230), (230, 250, 255), (250, 230, 255), (250, 255, 230),
        (235, 248, 255), (248, 235, 255), (255, 235, 245), (235, 255, 235), (255, 245, 235),
        (235, 245, 235), (245, 235, 235), (235, 235, 245), (245, 245, 235), (235, 245, 245),
    ]
    outline_color = (60, 110, 200)

    # Compute node boxes and centers per layout
    node_boxes: Dict[str, Tuple[int, int, int, int]] = {}
    node_centers: Dict[str, Tuple[int, int]] = {}
    names = [n['name'] for n in nodes]

    if layout == 'layered':
        by_layer = build_layers(nodes, edges)
        num_layers = len(by_layer)
        max_per_layer = max((len(v) for v in by_layer.values()), default=1)
        hgap = 560
        vgap = 300
        # recompute canvas for layered if needed
        W = max(W, margin * 2 + num_layers * box_w + (num_layers - 1) * hgap)
        H = max(H, margin * 2 + max_per_layer * box_h + (max_per_layer - 1) * vgap)
        if (W, H) != img.size:
            img = Image.new('RGB', (W, H), color=(255, 255, 255))
            draw = ImageDraw.Draw(img)
        for L in range(num_layers):
            col_x1 = margin + L * (box_w + hgap)
            lst = by_layer.get(L, [])
            total_height = len(lst) * box_h + max(0, len(lst) - 1) * vgap
            start_y = (H - total_height) // 2
            for i, name in enumerate(lst):
                y1 = start_y + i * (box_h + vgap)
                x1 = col_x1
                x2 = x1 + box_w
                y2 = y1 + box_h
                node_boxes[name] = (x1, y1, x2, y2)
                node_centers[name] = ((x1 + x2) // 2, (y1 + y2) // 2)
    else:
        # Radial
        cx, cy = W // 2, H // 2
        radius = min(W, H) // 2 - (margin + max(box_w, box_h))
        centers = radial_layout(len(nodes), cx, cy, radius)
        for (node, (x, y)) in zip(nodes, centers):
            name = node['name']
            x1 = x - box_w // 2
            y1 = y - box_h // 2
            x2 = x + box_w // 2
            y2 = y + box_h // 2
            node_boxes[name] = (x1, y1, x2, y2)
            node_centers[name] = (x, y)

    # Determine starting nodes by indegree (roots)
    indeg: Dict[str, int] = {n: 0 for n in names}
    for e in edges:
        s = e.get('source')
        t = e.get('target')
        if isinstance(s, str) and isinstance(t, str) and t in indeg and s in indeg:
            indeg[t] += 1
    start_nodes = {n for n, d in indeg.items() if d == 0}
    if not start_nodes and indeg:
        min_d = min(indeg.values())
        start_nodes = {n for n, d in indeg.items() if d == min_d}

    def box_anchor_towards(box: Tuple[int, int, int, int], target: Tuple[int, int]) -> Tuple[int, int]:
        x1, y1, x2, y2 = box
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        tx, ty = target
        dx, dy = tx - cx, ty - cy
        if dx == 0 and dy == 0:
            return (cx, cy)
        # Choose side by comparing normalized direction
        if abs(dx) * (y2 - y1) > abs(dy) * (x2 - x1):
            # Hit left/right
            if dx > 0:
                return (x2, cy)
            else:
                return (x1, cy)
        else:
            # Hit top/bottom
            if dy > 0:
                return (cx, y2)
            else:
                return (cx, y1)

    # Draw edges behind nodes
    color_element = (120, 120, 120)   # gray for element→screen
    color_frame = (40, 140, 255)      # blue for frame/screen→screen
    color_wait = (0, 160, 120)        # teal for wait/auto
    color_click_any = (255, 140, 0)   # orange for click-anywhere
    for e in edges:
        s = e['source']
        t = e['target']
        if s not in node_boxes or t not in node_boxes:
            continue
        sp = box_anchor_towards(node_boxes[s], node_centers[t])
        tp = box_anchor_towards(node_boxes[t], node_centers[s])
        # Pick edge color
        edge_kind = e.get('edge_kind')
        is_wait = bool(e.get('is_wait'))
        is_click_any = bool(e.get('is_click_anywhere'))
        edge_color = color_wait if is_wait else (color_click_any if is_click_any else (color_frame if edge_kind == 'frame' else color_element))
        # Draw straight polyline with slight outward offset to reduce overlap in radial
        if layout == 'radial':
            # midpoint and slight perpendicular nudge outward from center
            mx = (sp[0] + tp[0]) // 2
            my = (sp[1] + tp[1]) // 2
            # vector from image center to midpoint
            cx, cy = W // 2, H // 2
            vx, vy = mx - cx, my - cy
            nn = math.hypot(vx, vy) or 1.0
            ox, oy = int(vx / nn * 120), int(vy / nn * 120)
            pB = (mx + ox, my + oy)
            draw.line([sp, pB], fill=edge_color, width=5)
            draw.line([pB, tp], fill=edge_color, width=5)
            draw_arrow(draw, pB, tp, color=edge_color, width=5, head_len=22, head_w=12)
            label_anchor = pB
        else:
            draw.line([sp, tp], fill=edge_color, width=5)
            draw_arrow(draw, sp, tp, color=edge_color, width=5, head_len=22, head_w=12)
            label_anchor = ((sp[0] + tp[0]) // 2, (sp[1] + tp[1]) // 2)

        # Edge label
        label_w = 1000
        lines = []
        lid = e.get('linkId')
        if lid:
            lines.append(f"linkId: {lid}")
        # Add a small tag for type
        if is_wait:
            lines.append("type: wait/auto")
        elif e.get('is_click_anywhere'):
            lines.append("type: click-anywhere")
        elif edge_kind == 'frame':
            lines.append("type: screen→screen")
        else:
            lines.append("type: element→screen")
        ct = e.get('click_target') or ''
        ui = e.get('user_intent') or ''
        for section_title, text in (("click_target", ct), ("user_intent", ui)):
            if text:
                wrapped = wrap_text(draw, text, small_font, label_w)
                wrapped = wrapped[:5]
                lines.append(f"{section_title}:")
                lines.extend([f"  {ln}" for ln in wrapped])
        if lines:
            text_h = sum([small_font.getbbox(ln)[3] - small_font.getbbox(ln)[1] + 4 for ln in lines]) + 12
            x1 = label_anchor[0] - label_w // 2
            y1 = label_anchor[1] - text_h // 2
            x2 = label_anchor[0] + label_w // 2
            y2 = label_anchor[1] + text_h // 2
            # Nudge away from intersecting any node box
            def intersects(a, b):
                ax1, ay1, ax2, ay2 = a
                bx1, by1, bx2, by2 = b
                return not (ax2 < bx1 or bx2 < ax1 or ay2 < by1 or by2 < ay1)
            tries = 0
            while any(intersects((x1, y1, x2, y2), nb) for nb in node_boxes.values()) and tries < 30:
                y1 -= (box_h // 8)
                y2 -= (box_h // 8)
                tries += 1
            draw.rectangle([x1, y1, x2, y2], fill=(248, 248, 248), outline=(180, 180, 180))
            ty = y1 + 6
            for ln in lines:
                draw.text((x1 + 12, ty), ln, fill=(10, 10, 10), font=small_font)
                ty += small_font.getbbox(ln)[3] - small_font.getbbox(ln)[1] + 4

    # Draw nodes on top (colored)
    for idx, node in enumerate(nodes):
        name = node['name']
        box = node_boxes.get(name)
        if not box:
            continue
        fill_color = palette[idx % len(palette)]
        # Highlight starting nodes with halo and badge
        is_start = name in start_nodes
        if is_start:
            hx1, hy1, hx2, hy2 = box[0] - 24, box[1] - 24, box[2] + 24, box[3] + 24
            draw.rounded_rectangle((hx1, hy1, hx2, hy2), radius=26, fill=(255, 250, 210), outline=(220, 170, 0), width=8)
        draw.rounded_rectangle(box, radius=18, fill=fill_color, outline=(220, 170, 0) if is_start else outline_color, width=7 if is_start else 5)
        x1, y1, x2, y2 = box
        inner_x = x1 + 20
        inner_w = x2 - x1 - 40
        ty = y1 + 16
        # START badge
        if is_start:
            badge_text = "START"
            bt_w = small_font.getbbox(badge_text)[2] - small_font.getbbox(badge_text)[0]
            bt_h = small_font.getbbox(badge_text)[3] - small_font.getbbox(badge_text)[1]
            bx1, by1 = x1 - 6, y1 - bt_h - 18
            bx2, by2 = bx1 + bt_w + 28, by1 + bt_h + 14
            draw.rounded_rectangle((bx1, by1, bx2, by2), radius=10, fill=(255, 215, 0), outline=(200, 150, 0), width=3)
            draw.text((bx1 + 12, by1 + 6), badge_text, fill=(60, 40, 0), font=small_font)
        title = f"{name}"
        draw.text((inner_x, ty), title, fill=(20, 40, 90), font=title_font)
        ty += title_font.getbbox(title)[3] - title_font.getbbox(title)[1] + 10
        sid = ''
        if screen_nodes_map:
            key = normalize(name)
            mapped = screen_nodes_map.get(key)
            if isinstance(mapped, int):
                sid = str(mapped)
        if not sid:
            sid = str(node.get('id') or '')
        id_line = f"screen_nodes.id: {sid}"
        draw.text((inner_x, ty), id_line, fill=(40, 60, 110), font=label_font)
        ty += label_font.getbbox(id_line)[3] - label_font.getbbox(id_line)[1] + 12
        desc = node.get('description') or ''
        desc_lines = wrap_text(draw, desc, label_font, inner_w)
        desc_lines = desc_lines[:10]
        for ln in desc_lines:
            draw.text((inner_x, ty), ln, fill=(30, 30, 30), font=label_font)
            ty += label_font.getbbox(ln)[3] - label_font.getbbox(ln)[1] + 4

    img.save(out_path)


def main():
    parser = argparse.ArgumentParser(description='Build a detailed graph image from enriched links')
    parser.add_argument('--enriched', required=True, help='Path to prototype_links_enriched.json')
    parser.add_argument('--out', required=True, help='Output image path (PNG)')
    parser.add_argument('--layout', default='radial', choices=['radial', 'layered'], help='Graph layout')
    parser.add_argument('--screen-nodes', default=None, help='Optional path to this run\'s screen_nodes.json to use ids from there')
    args = parser.parse_args()

    enriched_path = pathlib.Path(args.enriched)
    out_path = pathlib.Path(args.out)
    screen_nodes_path = pathlib.Path(args.screen_nodes) if args.screen_nodes else None

    links = load_enriched(enriched_path)
    nodes, edges = collect_nodes_and_edges(links)
    screen_nodes_map = load_screen_node_id_map(screen_nodes_path)
    render_graph(nodes, edges, out_path, layout=args.layout, screen_nodes_map=screen_nodes_map)
    print(f"Graph image written → {out_path}")


if __name__ == '__main__':
    main()


