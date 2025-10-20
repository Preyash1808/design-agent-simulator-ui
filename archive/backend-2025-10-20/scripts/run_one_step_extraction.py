#!/usr/bin/env python3
import os
import sys
import json
import time
import shutil
import pathlib
import subprocess
import argparse

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNS = ROOT / 'runs'
SCREENS_DIR = ROOT / 'figma_screens'


from typing import List, Dict, Optional


def run(cmd: List[str], env: Optional[Dict] = None, verbose: bool = False, label: Optional[str] = None) -> None:
    if verbose:
        print(f"[runner] START {label or cmd[0]}:\n  cmd: {' '.join(cmd)}", flush=True)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env)
    dt = time.perf_counter() - t0
    if verbose:
        print(f"[runner] END   {label or cmd[0]} (took {dt:.2f}s)\n", flush=True)
    if proc.returncode != 0:
        print(f"[runner] ERROR: command failed with exit code {proc.returncode}")
        sys.exit(proc.returncode)


def copy_page_screens(page_name: str, out_screens_dir: pathlib.Path) -> int:
    out_screens_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"{page_name}__"
    count = 0
    for p in SCREENS_DIR.glob('*.png'):
        if p.name.startswith(prefix):
            shutil.copy2(p, out_screens_dir / p.name)
            count += 1
    return count


def purge_old_runs(days: int = 3, verbose: bool = False) -> int:
    RUNS.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - days * 86400
    removed = 0
    for d in RUNS.iterdir():
        try:
            if d.is_dir() and d.stat().st_mtime < cutoff:
                shutil.rmtree(d)
                removed += 1
                if verbose:
                    print(f"[runner] Purged old run: {d.name}", flush=True)
        except Exception as e:
            if verbose:
                print(f"[runner] Warn: could not purge {d}: {e}", flush=True)
    return removed


def main():
    parser = argparse.ArgumentParser(description='One-step: export screens, nodes, links, enriched outputs into a run folder')
    parser.add_argument('--page', required=True, help='Exact Figma page name, e.g., "Arrows 2 - Interaction"')
    parser.add_argument('--figma-url', required=True, help='Figma file URL to process')
    parser.add_argument('--out-dir', default=None, help='Run folder under runs/. If not provided, a timestamped folder is used.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    parser.add_argument('--purge-logs', action='store_true', help='Legacy flag (no-op): kept for compatibility, does nothing now')
    args = parser.parse_args()

    RUNS.mkdir(parents=True, exist_ok=True)
    # Purge runs older than 3 days
    purged = purge_old_runs(days=3, verbose=bool(args.verbose))
    if args.verbose and purged:
        print(f"[runner] Purged {purged} old runs (>3 days)", flush=True)

    ts = time.strftime('%Y%m%d_%H%M%S')
    slug = args.page.replace(' ', '_')
    run_dir = RUNS / (args.out_dir or f"{slug}_{ts}")
    preprocess_dir = run_dir / 'preprocess'
    graphs_dir = preprocess_dir / 'graphs'
    screens_out = preprocess_dir / 'screens'
    cache_dir = run_dir / '.cache'
    run_dir.mkdir(parents=True, exist_ok=True)
    preprocess_dir.mkdir(parents=True, exist_ok=True)
    graphs_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    verbose = bool(args.verbose)
    if verbose:
        print('[runner] One-step extraction started', flush=True)
        print(f"[runner] Inputs:\n  page: {args.page}\n  figma_url: {args.figma_url}\n  out_dir: {run_dir}", flush=True)

    # Simple per-run lock
    lock_path = run_dir / '.lock'
    if lock_path.exists():
        print(f"[runner] ERROR: lock exists at {lock_path}. Another job may be using this run_dir.")
        sys.exit(1)
    lock_path.write_text(json.dumps({'pid': os.getpid(), 'created_at': time.time()}), encoding='utf-8')

    try:
        # 1) Export screens for the page
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        env['FIGMA_PAGE'] = args.page
        if verbose:
            print('[runner] Step 1/7 - Export Figma screens', flush=True)
            print('  file: scripts/export_figma_screens.py', flush=True)
            print('  desc: Downloads PNGs for all top-level frames on the specified Figma page.', flush=True)
        python_cmd = os.environ.get('PYTHON', sys.executable)
        # Export directly into this run's preprocess/screens folder to avoid global shared state
        run([python_cmd, 'scripts/export_figma_screens.py', '--page', args.page, '--figma-url', args.figma_url, '--out-dir', str(screens_out)], env, verbose, label='export_figma_screens')

        # If the export wrote to screens_out already, count files; otherwise fallback to copying existing cached screens
        copied = 0
        try:
            copied = len(list(screens_out.glob('*.png')))
        except Exception:
            copied = 0
        if copied == 0:
            copied = copy_page_screens(args.page, screens_out)

        # 2) Analyze screens to build screen_nodes.json (writes to logs/) then copy into the run
        if verbose:
            print('[runner] Step 2/7 - Generate screen nodes (descriptions)', flush=True)
            print('  file: scripts/analyze_screens_generate_nodes.py', flush=True)
            print('  desc: Creates screen_nodes.json by describing each exported screen (LLM-based).', flush=True)
        run([python_cmd, 'scripts/analyze_screens_generate_nodes.py', '--screens-dir', str(screens_out), '--out', str(preprocess_dir / 'screen_nodes.json')], env, verbose, label='analyze_screens_generate_nodes')
        # Analyzer wrote directly to preprocess_dir/screen_nodes.json
        nodes_dst = preprocess_dir / 'screen_nodes.json'
        if not nodes_dst.exists():
            raise SystemExit('screen_nodes.json not generated by analyzer')

        # 3) Extract prototype links into the run folder (preprocess)
        if verbose:
            print('[runner] Step 3/7 - Extract prototype links', flush=True)
            print('  file: scripts/extract_links.py', flush=True)
            print('  desc: Reads Figma nodes API for the page to find element→screen prototype links and deduplicates them.', flush=True)
        run([
            python_cmd, 'scripts/extract_links.py',
            '--figma-url', args.figma_url,
            '--page', args.page,
            '--out-dir', str(preprocess_dir),
            '--verbose'
        ], env, verbose, label='extract_links')

        # 4) Enrich links using this run's nodes file and screens folder
        protos = preprocess_dir / 'prototype_links.json'
        enriched = preprocess_dir / 'prototype_links_enriched.json'
        if verbose:
            print('[runner] Step 4/7 - Enrich links', flush=True)
            print('  file: scripts/enrich_prototype_links.py', flush=True)
            print('  desc: Adds click_target and user_intent; uses screen images and nodes for context.', flush=True)
        run([
            python_cmd, 'scripts/enrich_prototype_links.py',
            '--input', str(protos),
            '--out', str(enriched),
            '--screens-dir', str(screens_out),
            '--verbose'
        ], env, verbose, label='enrich_prototype_links')

        # 5) Sort and add linkId
        if verbose:
            print('[runner] Step 5/7 - Assign sorted link IDs', flush=True)
            print('  file: scripts/sort_and_add_link_ids.py', flush=True)
            print('  desc: Sorts links deterministically and adds incremental linkId for stable referencing.', flush=True)
        run([
            python_cmd, 'scripts/sort_and_add_link_ids.py',
            '--input', str(enriched),
            '--out', str(enriched),
        ], env, verbose, label='sort_and_add_link_ids')

        # 6) Annotate click targets onto screen images
        annot_dir = preprocess_dir / 'annotated'
        if verbose:
            print('[runner] Step 6/7 - Annotate screens', flush=True)
            print('  file: scripts/annotate_click_targets.py', flush=True)
            print('  desc: Draws red dots (or blue border for wait actions) to mark click targets.', flush=True)
        run([
            python_cmd, 'scripts/annotate_click_targets.py',
            '--enriched', str(enriched),
            '--screens-dir', str(screens_out),
            '--out-dir', str(annot_dir),
            '--nodes-json', str(nodes_dst),
        ], env, verbose, label='annotate_click_targets')

        # 7) Build graph (image + PDF) at the end
        graph_png = graphs_dir / 'graph_radial_colored_ids_typed_start.png'
        if verbose:
            print('[runner] Step 7/7 - Build graph image and PDF', flush=True)
            print('  file: scripts/build_graph.py', flush=True)
            print('  desc: Generates a radial colored graph with START highlights and exports PNG+PDF.', flush=True)
        run([
            python_cmd, 'scripts/build_graph.py',
            '--enriched', str(enriched),
            '--screen-nodes', str(nodes_dst),
            '--out', str(graph_png),
            '--layout', 'radial'
        ], env, verbose, label='build_graph')
        # Convert PNG to PDF
        pycode = f"from PIL import Image; p=r'{graph_png}'; Image.open(p).convert('RGB').save(p.replace('.png','.pdf'), 'PDF')"
        run([python_cmd, '-c', pycode], env, verbose, label='graph_png_to_pdf')

        # meta + summary
        meta = {
            'page': args.page,
            'figma_url': args.figma_url,
            'created_at': ts,
            'run_dir': str(run_dir),
            'layout': 'radial',
        }
        (run_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')

        summary = {
            'run_dir': str(run_dir),
            'preprocess': {
                'screens_copied': copied,
                'screen_nodes': str(nodes_dst),
                'prototype_links': str(preprocess_dir / 'prototype_links.json'),
                'prototype_links_enriched': str(enriched),
                'prototype_links_csv': str(preprocess_dir / 'prototype_links.csv'),
                'annotated_dir': str(annot_dir),
                'graph_png': str(graph_png),
                'graph_pdf': str(graph_png).replace('.png', '.pdf'),
            }
        }
        print(json.dumps(summary, indent=2))
        if verbose:
            print('[runner] One-step extraction complete', flush=True)
    finally:
        try:
            if lock_path.exists():
                lock_path.unlink()
        except Exception:
            pass


if __name__ == '__main__':
    main()


