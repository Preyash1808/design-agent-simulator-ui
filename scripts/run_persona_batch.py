#!/usr/bin/env python3
import argparse
import json
import pathlib
import shutil
import subprocess
import time
import sys
import csv

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    p = argparse.ArgumentParser(description='Run traversal for all personas with per-persona run folders and a summary')
    p.add_argument('--base-run-dir', required=True, help='Path to the base logs/run_* folder to copy for each persona')
    p.add_argument('--persona-json', default=str(ROOT / 'users' / 'users.json'))
    p.add_argument('--source-id', type=int, required=True)
    p.add_argument('--target-id', type=int, required=True)
    p.add_argument('--goal', required=True)
    args = p.parse_args()

    base = pathlib.Path(args.base_run_dir)
    persona_path = pathlib.Path(args.persona_json)
    personas = load_json(persona_path)
    batch_root = base.parent / f"persona_runs_{time.strftime('%Y%m%d_%H%M%S') }"
    batch_root.mkdir(parents=True, exist_ok=True)

    results = []
    for pr in personas:
        pid = int(pr.get('id'))
        name = str(pr.get('name') or f'persona_{pid}')
        dest = batch_root / f"persona_{pid}"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(base, dest)
        cmd = [
            sys.executable, str(ROOT / 'scripts' / 'simulate_user_traversal.py'),
            '--run-dir', str(dest),
            '--source-id', str(args.source_id),
            '--target-id', str(args.target_id),
            '--goal', args.goal,
            '--persona-json', str(persona_path),
            '--persona-id', str(pid),
            '--max-minutes', '2'
        ]
        print('Running:', ' '.join(cmd))
        subprocess.run(cmd, check=True)
        # Collect summary
        sims = (dest / 'simulations')
        sim_dirs = sorted([d for d in sims.iterdir() if d.is_dir()])
        latest = sim_dirs[-1] if sim_dirs else None
        if latest:
            report = latest / 'user_report.json'
            if report.exists():
                data = load_json(report)
                data['sim_dir'] = str(latest)
                results.append({'persona_id': pid, 'persona_name': name, **data})

    # Write JSON summary
    summary = {
        'base_run': str(base),
        'batch_root': str(batch_root),
        'results': results,
    }
    (batch_root / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    # Write CSV summary
    csv_path = batch_root / 'summary.csv'
    fieldnames = [
        'persona_id', 'persona_name', 'status', 'steps', 'time_sec', 'source_id', 'target_id',
        'friction_count', 'dropoff_count', 'feedback_count', 'sim_dir'
    ]
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in results:
            row = {
                'persona_id': r.get('persona_id') or (r.get('persona') or {}).get('id'),
                'persona_name': r.get('persona_name') or (r.get('persona') or {}).get('name'),
                'status': r.get('status'),
                'steps': r.get('steps'),
                'time_sec': r.get('time_sec'),
                'source_id': r.get('source_id'),
                'target_id': r.get('target_id'),
                'friction_count': len(r.get('friction_points') or []),
                'dropoff_count': len(r.get('drop_off_points') or []),
                'feedback_count': len(r.get('feedback') or []),
                'sim_dir': r.get('sim_dir') or '',
            }
            w.writerow(row)

    print('Summary written →', batch_root / 'summary.json')
    print('CSV summary written →', csv_path)


if __name__ == '__main__':
    main()


