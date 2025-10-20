#!/usr/bin/env python3
import argparse
import json
import pathlib
import subprocess
import os
import sys
import csv
import time
import shutil
from collections import Counter
from typing import Dict, Tuple, Optional, List
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNS = ROOT / 'runs'


# Ensure reasonable defaults for LLM calls and concurrency when not provided
# These propagate to child subprocesses (e.g., describe_screen_first_person.py)
os.environ.setdefault('LLM_TIMEOUT_SEC', os.getenv('LLM_TIMEOUT_SEC', '60'))

def load_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding='utf-8'))


def actions_to_path(actions):
    if not actions:
        return ''
    seq = []
    first = actions[0].get('from_id')
    if isinstance(first, int):
        seq.append(str(first))
    for a in actions:
        toid = a.get('to_id')
        if isinstance(toid, int):
            seq.append(str(toid))
    return ' -> '.join(seq)


def purge_old_runs(days: int = 3, verbose: bool = True) -> int:
    RUNS.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - days * 86400
    removed = 0
    for d in RUNS.iterdir():
        try:
            if d.is_dir() and d.stat().st_mtime < cutoff:
                shutil.rmtree(d)
                removed += 1
                if verbose:
                    print('[persona_runner] Purged old run:', d.name)
        except Exception as e:
            if verbose:
                print('[persona_runner] Warn: could not purge', d, e)
    return removed


# --- Helpers for image → screen id resolution (perceptual hash) ---
def average_hash(path: pathlib.Path, size: int = 8) -> Optional[int]:
    try:
        with Image.open(path) as im:
            im = im.convert('L').resize((size, size))
            pixels = list(im.getdata())
            avg = sum(pixels) / len(pixels)
            bits = 0
            for p in pixels:
                bits = (bits << 1) | (1 if p >= avg else 0)
            return bits
    except Exception:
        return None


def hamming_distance(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count('1')


def build_id_to_file_maps(nodes_path: pathlib.Path) -> Tuple[Dict[int, str], Dict[str, int]]:
    """Return (id_to_file, figma_screenid_str_to_local_id)."""
    id_to_file: Dict[int, str] = {}
    figma_to_local: Dict[str, int] = {}
    nodes = load_json(nodes_path)
    for n in (nodes or []):
        try:
            lid = int(n.get('id'))
        except Exception:
            continue
        fn = str(n.get('file') or '')
        if fn:
            id_to_file[lid] = fn
        fsid = str(n.get('screen_id') or '')
        if fsid:
            figma_to_local[fsid] = lid
    return id_to_file, figma_to_local


def build_id_to_hash_map(screens_dir: pathlib.Path, id_to_file: Dict[int, str]) -> Dict[int, int]:
    out: Dict[int, int] = {}
    for sid, fname in id_to_file.items():
        p = screens_dir / fname
        if p.exists():
            ah = average_hash(p)
            if isinstance(ah, int):
                out[int(sid)] = ah
    return out


def resolve_image_to_id(img_path: pathlib.Path, id_to_hash: Dict[int, int]) -> Optional[int]:
    if not img_path or not img_path.exists():
        return None
    ah = average_hash(img_path)
    if not isinstance(ah, int) or not id_to_hash:
        return None
    best_sid = None
    best_d = 1 << 30
    for sid, h in id_to_hash.items():
        d = hamming_distance(ah, h)
        if d < best_d:
            best_d = d
            best_sid = sid
    return best_sid


def main():
    p = argparse.ArgumentParser(description='Run all personas in-place under a base run folder and write persona_summary.json/csv')
    p.add_argument('--run-dir', required=True, help='Base runs/<run_id> folder')
    p.add_argument('--persona-json', default=str(ROOT / 'users' / 'users.json'))
    p.add_argument('--persona-plan', required=False, help='Optional resolved persona plan JSON file (from server)')
    # IDs are optional now (images may be provided)
    p.add_argument('--source-id', type=int, required=False)
    p.add_argument('--target-id', type=int, required=False)
    # Optional image-based start/target
    p.add_argument('--source-image', required=False)
    p.add_argument('--target-image', required=False)
    p.add_argument('--goal', required=True)
    p.add_argument('--max-minutes', default='2')
    args = p.parse_args()

    purge_old_runs(days=3, verbose=True)

    run_dir = pathlib.Path(args.run_dir)
    tests_root = run_dir / 'tests'
    tests_root.mkdir(parents=True, exist_ok=True)
    personas = load_json(pathlib.Path(args.persona_json))
    plan = None
    if args.persona_plan:
        try:
            plan = load_json(pathlib.Path(args.persona_plan))
        except Exception:
            plan = None

    # Validate inputs
    use_images = bool(args.source_image and args.target_image)
    if not use_images and (args.source_id is None or args.target_id is None):
        print('Either provide --source-image/--target-image or --source-id/--target-id', file=sys.stderr)
        sys.exit(2)

    # If a resolved server-side plan exists, iterate that; else fall back to persona.json ids
    results = []
    # Require explicit persona plan; if empty or missing, fail fast (no fallback)
    if args.persona_plan:
        if not plan or not isinstance(plan.get('personas'), list) or len(plan.get('personas') or []) == 0:
            print('Persona plan is empty or invalid; at least one persona is required', file=sys.stderr)
            sys.exit(2)
        persona_iter = [{'id': int(p.get('slot')), 'name': str(p.get('name') or f"persona_{p.get('slot')}") } for p in plan['personas']]
    else:
        print('Missing --persona-plan; tests-by-images must provide a persona plan', file=sys.stderr)
        sys.exit(2)

    # Common artifacts needed for image-based journey
    preprocess_dir = run_dir / 'preprocess'
    nodes_path = preprocess_dir / 'screen_nodes.json'
    links_path = preprocess_dir / 'prototype_links_enriched.json'
    screens_dir = preprocess_dir / 'screens'
    if use_images:
        if not nodes_path.exists() or not links_path.exists() or not screens_dir.exists():
            print('Missing preprocess artifacts (screen_nodes.json, prototype_links_enriched.json, screens/) in run_dir', file=sys.stderr)
            sys.exit(2)
        id_to_file, figma_to_local = build_id_to_file_maps(nodes_path)
        id_to_hash = build_id_to_hash_map(screens_dir, id_to_file)
        # Resolve source/target numeric ids from uploaded images
        src_id_resolved = resolve_image_to_id(pathlib.Path(args.source_image), id_to_hash)
        tgt_id_resolved = resolve_image_to_id(pathlib.Path(args.target_image), id_to_hash)
        if not isinstance(src_id_resolved, int) or not isinstance(tgt_id_resolved, int):
            print('Could not resolve source/target images to known screens', file=sys.stderr)
            sys.exit(2)

    # Global parallelization across all personas
    jobs: List[tuple[int, str, int, Optional[int]]] = []
    persona_meta: Dict[int, dict] = {}
    resolution_path = run_dir / 'tests' / 'persona_resolution.json'
    # Wait until persona_resolution has all expected user_ids per persona_plan (up to timeout)
    wait_deadline = time.time() + float(os.getenv('TESTS_RESOLUTION_WAIT_SEC', '20'))
    expected_counts = {int(p.get('slot')): int(p.get('users') or 0) for p in (plan.get('personas') or [])}
    while True:
        resolved = load_json(resolution_path) if resolution_path.exists() else {}
        ok = True
        try:
            for p in (plan.get('personas') or []):
                pid = int(p.get('slot'))
                need = int(p.get('users') or 0)
                have = 0
                for rp in (resolved.get('personas') or []):
                    if int(rp.get('slot') or 0) == pid:
                        have = len(rp.get('user_ids') or [])
                        break
                if have < need:
                    ok = False
                    break
        except Exception:
            ok = False
        if ok or time.time() >= wait_deadline:
            break
        time.sleep(0.5)

    for pr in persona_iter:
        pid = int(pr.get('id'))
        name = str(pr.get('name') or f'persona_{pid}')
        persona_folder = tests_root / f'persona_{pid}'
        persona_folder.mkdir(parents=True, exist_ok=True)
        sims_root = persona_folder / 'simulations'
        sims_root.mkdir(parents=True, exist_ok=True)
        before_set = set()
        try:
            if sims_root.exists():
                before_set = {d.name for d in sims_root.iterdir() if d.is_dir()}
        except Exception:
            before_set = set()
        user_ids: list[int] = []
        try:
            for rp in (resolved.get('personas') or []):
                if int(rp.get('slot') or 0) == pid:
                    user_ids = [int(u) for u in (rp.get('user_ids') or []) if str(u).isdigit()]
                    break
        except Exception:
            user_ids = []
        run_count = max(1, len(user_ids) or 1)
        for i in range(run_count):
            resolved_uid = (user_ids[i] if i < len(user_ids) else None)
            jobs.append((pid, name, i, resolved_uid))
        persona_meta[pid] = {'name': name, 'folder': persona_folder, 'sims_root': sims_root, 'before_set': before_set}

    def _run_one_global(pid: int, name: str, index: int, resolved_uid_inner: Optional[int]) -> None:
        persona_id_for_sim = int(resolved_uid_inner) if isinstance(resolved_uid_inner, int) else int(pid)
        sims_root_local = persona_meta[pid]['sims_root']
        sim_dir_local = sims_root_local / f"{time.strftime('%Y%m%d_%H%M%S')}_{pid}_{index:02d}"
        sim_dir_local.mkdir(parents=True, exist_ok=True)
        if use_images:
            out_path = sim_dir_local / 'journey.json'
            cmd = [
                sys.executable, str(ROOT / 'scripts' / 'describe_screen_first_person.py'),
                '--source-screen-id', str(src_id_resolved),
                '--target-screen-id', str(tgt_id_resolved),
                '--screen-nodes', str(nodes_path),
                '--screens-dir', str(screens_dir),
                '--links-json', str(links_path),
                '--user-id', str(persona_id_for_sim),
                '--goal', args.goal,
                '--out', str(out_path),
            ]
            print('Running:', ' '.join(cmd))
            subprocess.run(cmd, check=True)
            j = load_json(out_path)
            steps_local: List[dict] = list(j.get('journey') or [])

            # Build traversal_log.jsonl with typed events and timestamps synthesized from time_on_screen
            traversal_log = sim_dir_local / 'traversal_log.jsonl'
            if traversal_log.exists():
                try:
                    traversal_log.unlink()
                except Exception:
                    pass
            ts = 0.0
            path_ids_local: List[int] = []
            visited_counts: Dict[int, int] = {}
            loop_emitted_ids: set[int] = set()
            friction_points_local: List[dict] = []

            def _append_event(ev: dict) -> None:
                try:
                    with traversal_log.open('a', encoding='utf-8') as f:
                        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
                except Exception:
                    pass

            for st in steps_local:
                fsid = str(st.get('screen_id') or '')
                lid = figma_to_local.get(fsid)
                if isinstance(lid, int):
                    path_ids_local.append(lid)
                # Synthesize typed log events for dwell calculation
                sid_int = int(lid) if isinstance(lid, int) else None
                dwell_sec = 0.0
                try:
                    dwell_sec = max(0.0, float(st.get('time_on_screen') or 0.0))
                except Exception:
                    dwell_sec = 0.0
                if sid_int is not None:
                    _append_event({'type': 'pre_action_thought', 'timestamp': ts, 'screen_id': sid_int})
                    _append_event({'type': 'action', 'timestamp': (ts + dwell_sec), 'screen_id': sid_int})
                ts += dwell_sec

                # Friction extraction heuristics
                if sid_int is not None:
                    visited_counts[sid_int] = visited_counts.get(sid_int, 0) + 1
                    # Back/close when returning to a previously seen screen
                    if bool(st.get('backtrack_flag')):
                        friction_points_local.append({
                            'type': 'back_or_close',
                            'screen_id': sid_int,
                            'description': 'User navigated back to a previously visited screen'
                        })
                    # Auto wait when dwell is high relative to typical step (~>3.5s)
                    if dwell_sec >= 3.5:
                        friction_points_local.append({
                            'type': 'auto_wait',
                            'screen_id': sid_int,
                            'description': f'Long hesitation on screen (~{round(dwell_sec,2)}s)'
                        })
                    # Loop detection: revisit same screen multiple times
                    if visited_counts[sid_int] >= 3 and sid_int not in loop_emitted_ids:
                        friction_points_local.append({
                            'type': 'loop_detected',
                            'screen_id': sid_int,
                            'description': 'Repeated visits indicate a potential loop'
                        })
                        loop_emitted_ids.add(sid_int)

                # Mark reached event when goal screen
                if sid_int is not None and bool(st.get('is_goal_screen')):
                    _append_event({'type': 'reached', 'timestamp': ts, 'screen_id': sid_int})

            # Determine status and actions
            status_local = 'completed' if (path_ids_local and isinstance(tgt_id_resolved, int) and path_ids_local[-1] == int(tgt_id_resolved)) else 'dropped'
            actions_local = []
            for a_idx in range(0, max(0, len(path_ids_local) - 1)):
                actions_local.append({'from_id': path_ids_local[a_idx], 'to_id': path_ids_local[a_idx + 1]})

            # Drop-off if not completed
            dropoffs_local = [] if status_local == 'completed' else [{'reason': 'not_reached_target', 'screen_id': (path_ids_local[-1] if path_ids_local else None)}]

            report_local = {
                'status': status_local,
                'steps': len(steps_local),
                'time_sec': round(ts, 3),
                'source_id': path_ids_local[0] if path_ids_local else None,
                'target_id': int(tgt_id_resolved),
                'user_id': int(persona_id_for_sim),
                'actions': actions_local,
                'friction_points': friction_points_local,
                'drop_off_points': dropoffs_local,
            }
            (sim_dir_local / 'user_report.json').write_text(json.dumps(report_local, ensure_ascii=False, indent=2), encoding='utf-8')
            (sim_dir_local / 'path.json').write_text(json.dumps({'screens': path_ids_local}, ensure_ascii=False, indent=2), encoding='utf-8')
        else:
            cmd = [
                sys.executable, str(ROOT / 'scripts' / 'simulate_user_traversal.py'),
                '--run-dir', str(run_dir),
                '--goal', args.goal,
                '--persona-json', str(pathlib.Path(args.persona_json)),
                '--persona-id', str(persona_id_for_sim),
                '--persona-folder-name', f'tests/persona_{pid}',
                '--max-minutes', str(args.max_minutes),
                '--append',
                '--source-id', str(args.source_id), '--target-id', str(args.target_id)
            ]
            print('Running:', ' '.join(cmd))
            subprocess.run(cmd, check=True)

    # Execute all persona-user jobs globally
    # Respect TESTS_MAX_WORKERS for accuracy‑neutral speedups; default higher to improve throughput
    max_workers = int(os.getenv('TESTS_MAX_WORKERS', '16'))
    errors: list[tuple[tuple[int,str,int,Optional[int]], BaseException]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_run_one_global, pid, name, idx, uid): (pid, name, idx, uid) for (pid, name, idx, uid) in jobs}
        for fut in as_completed(futs):
            exc = fut.exception()
            if exc:
                # collect but do not abort other jobs
                errors.append((futs[fut], exc))
                print(f"Job failed but continuing pid={futs[fut][0]} idx={futs[fut][2]}: {exc}", file=sys.stderr)

    # After all jobs complete, build persona-level summaries and results
    if errors:
        # Log a summary of failures; overall process continues to write summaries for successes
        try:
            (tests_root / 'errors.json').write_text(json.dumps([
                { 'pid': pid, 'persona': name, 'index': idx, 'user_id': uid, 'error': str(err) }
                for ((pid, name, idx, uid), err) in errors
            ], ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass
    results: List[dict] = []
    for pid, meta in persona_meta.items():
        name = meta['name']
        sims_root = meta['sims_root']
        before_set = meta['before_set']
        new_dirs = []
        try:
            current = {d.name for d in sims_root.iterdir() if d.is_dir()}
            new_dirs = [sims_root / d for d in sorted(current - before_set)]
        except Exception:
            new_dirs = []
        persona_results: List[dict] = []
        for simdir in new_dirs:
            rpt = simdir / 'user_report.json'
            if rpt.exists():
                data = load_json(rpt)
                rpt_path = simdir / 'user_report.txt'
                if rpt_path.exists():
                    try:
                        data['user_report_text'] = rpt_path.read_text(encoding='utf-8')
                    except Exception:
                        data['user_report_text'] = ''
                data['sim_dir'] = str(simdir)
                sim_persona = (data.get('persona') or {}) if isinstance(data.get('persona'), dict) else {}
                user_id = sim_persona.get('id') if sim_persona else None
                row = {'persona_id': pid, 'persona_name': name, 'user_id': user_id, **data}
                persona_results.append(row)
                results.append(row)
        try:
            p_total = len(persona_results)
            p_completed = sum(1 for r in persona_results if r.get('status') == 'completed')
            p_completion_rate = round((p_completed / p_total) * 100.0, 2) if p_total else 0.0
            p_avg_steps = round(sum(r.get('steps') or 0 for r in persona_results) / p_total, 2) if p_total else 0.0
            p_summary = {
                'persona_id': pid,
                'persona_name': name,
                'runs': persona_results,
                'aggregate': {
                    'completed_total': p_completed,
                    'total': p_total,
                    'completion_rate_pct': p_completion_rate,
                    'avg_steps': p_avg_steps,
                }
            }
            (tests_root / f'persona_{pid}' / 'summary.json').write_text(json.dumps(p_summary, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    # Aggregate summary
    total = len(results)
    completed = sum(1 for r in results if r.get('status') == 'completed')
    completion_rate = round((completed / total) * 100.0, 2) if total else 0.0
    avg_steps = round(sum(r.get('steps') or 0 for r in results) / total, 2) if total else 0.0
    avg_time = round(sum(r.get('time_sec') or 0.0 for r in results) / total, 2) if total else 0.0

    friction_counter = Counter()
    screen_counter = Counter()
    feedback_counter = Counter()
    not_completed = []

    for r in results:
        for fp in (r.get('friction_points') or []):
            ftype = fp.get('type') or 'unknown'
            friction_counter[ftype] += 1
            sid = fp.get('screen_id')
            if isinstance(sid, int):
                screen_counter[sid] += 1
        for fb in (r.get('feedback') or []):
            feedback_counter[fb] += 1
        if r.get('status') != 'completed':
            reason = (r.get('drop_off_points') or [{}])[-1].get('reason') if (r.get('drop_off_points') or []) else 'unknown'
            not_completed.append({'persona_id': r.get('persona_id'), 'persona_name': r.get('persona_name'), 'reason': reason})

    top_friction = friction_counter.most_common(5)
    top_feedback = feedback_counter.most_common(5)
    top_screens = screen_counter.most_common(5)

    aggregate = {
        'personas_total': total,
        'completed_total': completed,
        'completion_rate_pct': completion_rate,
        'avg_steps': avg_steps,
        'avg_time_sec': avg_time,
        'top_friction_types': [{'type': t, 'count': c} for (t, c) in top_friction],
        'top_feedback': [{'text': t, 'count': c} for (t, c) in top_feedback],
        'top_friction_screens': [{'screen_id': sid, 'count': c} for (sid, c) in top_screens],
        'not_completed': not_completed,
        'major_findings': {
            'crux': 'Focus on clarifying primary CTAs, reducing ambiguity and auto-advance confusion, and avoiding loops; consider progress cues and shorter paths.',
            'themes': [
                'Make primary next actions visually dominant and consistently labeled',
                'Provide progress indicators / reduce auto-advance ambiguity',
                'Prevent loops via clearer hierarchy and guardrails',
                'Shorten the critical path where possible'
            ]
        }
    }

    # write persona_summary.json at tests root
    summary_json = tests_root / 'persona_summary.json'
    summary = {'run_dir': str(run_dir), 'results': results, 'aggregate': aggregate}
    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    # write persona_summary.csv at tests root
    csv_path = tests_root / 'persona_summary.csv'
    fieldnames = [
        'persona_id', 'persona_name', 'status', 'steps', 'time_sec', 'source_id', 'target_id',
        'friction_count', 'dropoff_count', 'feedback_count', 'friction_types', 'dropoff_reasons', 'actions_path', 'user_report_text', 'sim_dir'
    ]
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in results:
            frictions = r.get('friction_points') or []
            friction_types = sorted({fp.get('type') or 'unknown' for fp in frictions})
            dropoffs = r.get('drop_off_points') or []
            drop_reasons = sorted({dp.get('reason') or '' for dp in dropoffs if dp})
            path_seq = actions_to_path(r.get('actions') or [])
            row = {
                'persona_id': r.get('persona_id') or (r.get('persona') or {}).get('id'),
                'persona_name': r.get('persona_name') or (r.get('persona') or {}).get('name'),
                'status': r.get('status'),
                'steps': r.get('steps'),
                'time_sec': r.get('time_sec'),
                'source_id': r.get('source_id'),
                'target_id': r.get('target_id'),
                'friction_count': len(frictions),
                'dropoff_count': len(dropoffs),
                'feedback_count': len(r.get('feedback') or []),
                'friction_types': '; '.join(friction_types),
                'dropoff_reasons': '; '.join(drop_reasons),
                'actions_path': path_seq,
                'user_report_text': r.get('user_report_text') or '',
                'sim_dir': r.get('sim_dir') or '',
            }
            w.writerow(row)
        summary_text = (
            f"Completion: {completed}/{total} ({completion_rate}%). "
            f"Avg steps: {avg_steps}, Avg time: {avg_time}s. "
            f"Top frictions: " + ', '.join(f"{t}:{c}" for (t, c) in top_friction) + ". "
            f"Top feedback: " + ' | '.join(f"{t}:{c}" for (t, c) in top_feedback) + ". "
            f"Themes: " + ' | '.join(aggregate.get('major_findings', {}).get('themes', []))
        )
        w.writerow({
            'persona_id': 'ALL',
            'persona_name': 'SUMMARY',
            'status': f'{completed}/{total} completed ({completion_rate}%)',
            'steps': avg_steps,
            'time_sec': avg_time,
            'source_id': args.source_id if not use_images else '',
            'target_id': args.target_id if not use_images else '',
            'friction_count': sum(len(r.get('friction_points') or []) for r in results),
            'dropoff_count': sum(len(r.get('drop_off_points') or []) for r in results),
            'feedback_count': sum(len(r.get('feedback') or []) for r in results),
            'friction_types': '; '.join(f"{t}:{c}" for (t, c) in top_friction),
            'dropoff_reasons': '; '.join(sorted({(r.get('drop_off_points') or [{}])[-1].get('reason') or '' for r in results if (r.get('drop_off_points') or [])})),
            'actions_path': '',
            'user_report_text': summary_text,
            'sim_dir': 'TopScreens: ' + ' | '.join(f"{sid}:{c}" for (sid, c) in top_screens),
        })

    print('Wrote:', summary_json)
    print('Wrote:', csv_path)


if __name__ == '__main__':
    main()
