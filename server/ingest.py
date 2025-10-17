"""
Data ingestion service for processing test run artifacts.
Parses simulation results and populates database metrics tables.
"""
import json
import pathlib
import uuid
import traceback
from collections import Counter, defaultdict, deque
from typing import Optional, Dict, List, Tuple, Any

# Import from other modules
from .storage import get_supabase, use_supabase_db, upload_log_to_supabase
from .db import fetchrow, execute
from .utils import _severity_for_category
from .metrics import _normalize_recommendation_text

# Will be set by main.py
ROOT = None


def set_root_path(root: pathlib.Path):
    """Set the ROOT path from main.py"""
    global ROOT
    ROOT = root


def _precompute_recommendations(run_dir: pathlib.Path) -> None:
    """Scan journey logs and write normalized recommendations to derived/*.json.
    This is executed once at the end of a run so the metrics API can serve
    precomputed results without heavy processing or LLM calls.
    """
    try:
        tests_root = run_dir / 'tests'
        if not tests_root.exists():
            return
        derived_dir = run_dir / 'derived'
        derived_dir.mkdir(parents=True, exist_ok=True)

        # Map screen_id -> filename/name for images and labels
        figma_to_file: Dict[str, str] = {}
        figma_to_name: Dict[str, str] = {}
        try:
            nodes_path = run_dir / 'preprocess' / 'screen_nodes.json'
            if nodes_path.exists():
                nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
                for n in nodes or []:
                    try:
                        fid = str(n.get('screen_id') or '')
                        fn = str(n.get('file') or '')
                        if fid and fn:
                            figma_to_file[fid] = fn
                        if fid:
                            figma_to_name[fid] = str(n.get('name') or '')
                    except Exception:
                        continue
        except Exception:
            figma_to_file = {}
            figma_to_name = {}

        # Persona id -> name mapping (if available)
        persona_names: Dict[str, str] = {}
        try:
            ps = tests_root / 'persona_summary.json'
            if ps.exists():
                pdata = json.loads(ps.read_text(encoding='utf-8'))
                for res in (pdata.get('results') or []):
                    try:
                        pid = str(res.get('persona_id') or '')
                        nm = str(res.get('persona_name') or '').strip() or (f"Persona {pid}" if pid else '')
                        if pid:
                            persona_names[pid] = nm
                    except Exception:
                        continue
        except Exception:
            persona_names = {}

        # Accumulators
        rec_counts: Dict[str, int] = {}
        rec_image: Dict[str, str] = {}
        per_screen_map: Dict[str, Dict[str, Any]] = {}

        def _touch(step: Dict[str, Any], persona_id: Optional[str]):
            issues_arr = ((step.get('ux_audit') or {}).get('issues') or [])
            for it in issues_arr:
                rec_raw = str(it.get('recommendation_user_voice') or '').strip()
                if not rec_raw:
                    continue
                rec_counts[rec_raw] = rec_counts.get(rec_raw, 0) + 1
                sid = str(step.get('screen_id') or '')
                if sid:
                    g = per_screen_map.setdefault(sid, {
                        'screenId': sid,
                        'name': figma_to_name.get(sid) or f"Screen {sid}",
                        'image': (f"/runs-files/{(run_dir / 'preprocess' / 'screens' / figma_to_file.get(sid)).relative_to(ROOT / 'runs')}" if ROOT and figma_to_file.get(sid) else None),
                        'items': {},
                    })
                    item = g['items'].setdefault(rec_raw, {'count': 0, 'personas': set()})
                    item['count'] = int(item.get('count', 0)) + 1
                    if persona_id and persona_id in persona_names:
                        try:
                            item['personas'].add(persona_names[persona_id])
                        except Exception:
                            item['personas'] = set([persona_names[persona_id]])
                # best-effort image for flat list
                if sid and rec_raw not in rec_image:
                    fn = figma_to_file.get(sid)
                    if fn:
                        try:
                            rec_image[rec_raw] = f"/runs-files/{(run_dir / 'preprocess' / 'screens' / fn).relative_to(ROOT / 'runs')}"
                        except Exception:
                            pass

        # Walk persona/*/simulations and capture journey steps
        for persona_dir in sorted(tests_root.glob('persona_*')):
            pid = None
            try:
                pid = str(int(persona_dir.name.split('_', 1)[1]))
            except Exception:
                pid = None
            sims_root = persona_dir / 'simulations'
            if not sims_root.exists():
                continue
            for simdir in sorted([p for p in sims_root.iterdir() if p.is_dir()]):
                # journey.json first
                jpath = simdir / 'journey.json'
                if jpath.exists():
                    try:
                        data = json.loads(jpath.read_text(encoding='utf-8'))
                        for step in (data.get('journey') or []):
                            _touch(step, pid)
                    except Exception:
                        pass
                # journey.jsonl
                jpathl = simdir / 'journey.jsonl'
                if jpathl.exists():
                    try:
                        for line in jpathl.read_text(encoding='utf-8').splitlines():
                            try:
                                step = json.loads(line)
                            except Exception:
                                continue
                            _touch(step, pid)
                    except Exception:
                        pass

        # Build flat recommendations (top 6)
        recs = []
        for k, v in sorted(rec_counts.items(), key=lambda kv: int(kv[1]), reverse=True)[:6]:
            recs.append({
                'text': _normalize_recommendation_text(k),
                'text_raw': k,
                'count': int(v),
                'image': rec_image.get(k)
            })

        # Build grouped recommendations by screen
        groups: List[Dict[str, Any]] = []
        for sid, g in per_screen_map.items():
            items_map: Dict[str, Any] = g.get('items') or {}
            conv: List[Dict[str, Any]] = []
            for t, info in items_map.items():
                cnt = int((info or {}).get('count') or 0)
                personas = sorted(list((info or {}).get('personas') or []))
                conv.append({'text': _normalize_recommendation_text(t), 'text_raw': t, 'count': cnt, 'personas': personas})
            conv.sort(key=lambda it: int(it.get('count') or 0), reverse=True)
            total_c = sum(int(it.get('count') or 0) for it in conv)
            groups.append({
                'screenId': sid,
                'name': g.get('name'),
                'image': g.get('image'),
                'totalCount': int(total_c),
                'items': conv,
            })
        groups.sort(key=lambda x: int(x.get('totalCount') or 0), reverse=True)

        # Write files
        (derived_dir / 'recommendations.json').write_text(json.dumps(recs, ensure_ascii=False, indent=2), encoding='utf-8')
        (derived_dir / 'recommendations_by_screen.json').write_text(json.dumps(groups, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        # Do not fail the run; just skip caching if anything goes wrong
        traceback.print_exc()


async def _aggregate_tea_data(run_dir: pathlib.Path, db_run_id: str) -> None:
    """Aggregate TEA (Thoughts, Emotions, Actions) data from simulation logs.
    
    Parses traversal_log.jsonl files from persona simulation folders and aggregates:
    - Emotion counts by persona (for Emotion Mix chart)
    - Sentiment start/end values (for Sentiment Drift chart)
    - Thoughts, hesitations, actions data
    """
    try:
        tests_root = run_dir / 'tests'
        if not tests_root.exists():
            print(f"[SKIP] No tests directory found: {tests_root}")
            return

        # Find all persona directories
        persona_dirs = [d for d in tests_root.iterdir() if d.is_dir() and d.name.startswith('persona_')]
        if not persona_dirs:
            print("[SKIP] No persona directories found")
            return

        print(f"[INFO] Found {len(persona_dirs)} persona directories")

        for persona_dir in persona_dirs:
            try:
                # Extract persona_id from directory name (e.g., "persona_1" -> 1)
                persona_id = int(persona_dir.name.split('_')[1])
                print(f"[INFO] Processing persona {persona_id}")

                # Find all simulation directories
                sims_root = persona_dir / 'simulations'
                if not sims_root.exists():
                    print(f"[SKIP] No simulations directory for persona {persona_id}")
                    continue

                sim_dirs = [d for d in sims_root.iterdir() if d.is_dir()]
                if not sim_dirs:
                    print(f"[SKIP] No simulation directories for persona {persona_id}")
                    continue

                print(f"[INFO] Found {len(sim_dirs)} simulations for persona {persona_id}")

                # Aggregate data from all simulations for this persona
                emotions = Counter()
                thoughts = Counter()
                hesitations = Counter()
                actions = Counter()
                sentiment_values = []

                for sim_dir in sim_dirs:
                    log_path = sim_dir / 'traversal_log.jsonl'
                    if not log_path.exists():
                        continue

                    try:
                        # Parse the simulation log
                        with open(log_path, 'r', encoding='utf-8') as f:
                            for line in f:
                                if not line.strip():
                                    continue
                                try:
                                    event = json.loads(line.strip())
                                    
                                    # Collect emotion data
                                    if event.get('type') == 'emotion' and 'emotion' in event:
                                        emotion_data = event['emotion']
                                        emotion_label = emotion_data.get('label', 'Unknown')
                                        emotions[emotion_label] += 1
                                        
                                        # Collect sentiment values (valence as proxy for sentiment)
                                        valence = emotion_data.get('valence', 0.0)
                                        sentiment_values.append(valence)
                                    
                                    # Collect thought data (from pre_action_thought events)
                                    elif event.get('type') == 'pre_action_thought':
                                        # Simple thought categorization based on available actions
                                        available_actions = event.get('available_actions', [])
                                        if len(available_actions) == 1:
                                            thoughts['Clear Path'] += 1
                                        elif len(available_actions) <= 3:
                                            thoughts['Few Options'] += 1
                                        else:
                                            thoughts['Many Options'] += 1
                                    
                                    # Collect hesitation data (from wait events or unclear actions)
                                    elif event.get('type') == 'wait' or (event.get('type') == 'action' and 'hesitation' in str(event)):
                                        hesitations['Hesitation'] += 1
                                    
                                    # Collect action data
                                    elif event.get('type') == 'action':
                                        action_type = 'Direct Action'
                                        if 'chosen_user_intent' in event:
                                            intent = event['chosen_user_intent'].lower()
                                            if 'confident' in intent or 'ready' in intent:
                                                action_type = 'Confident Action'
                                            elif 'trying' in intent or 'attempt' in intent:
                                                action_type = 'Tentative Action'
                                        actions[action_type] += 1

                                except json.JSONDecodeError:
                                    continue

                    except Exception as e:
                        print(f"[WARN] Error parsing log {log_path}: {e}")
                        continue

                # Calculate sentiment start/end
                sentiment_start = sentiment_values[0] if sentiment_values else 0.0
                sentiment_end = sentiment_values[-1] if sentiment_values else 0.0

                # Convert counters to dictionaries
                emotions_dict = dict(emotions)
                thoughts_dict = dict(thoughts)
                hesitations_dict = dict(hesitations)
                actions_dict = dict(actions)

                print(f"[INFO] Aggregated TEA data for persona {persona_id}:")
                print(f"  Emotions: {emotions_dict}")
                print(f"  Thoughts: {thoughts_dict}")
                print(f"  Hesitations: {hesitations_dict}")
                print(f"  Actions: {actions_dict}")
                print(f"  Sentiment: {sentiment_start:.3f} -> {sentiment_end:.3f}")

                # Store in database
                tea_data = {
                    'run_id': db_run_id,
                    'persona_id': str(persona_id),
                    'thoughts': thoughts_dict,
                    'emotions': emotions_dict,
                    'hesitations': hesitations_dict,
                    'actions': actions_dict,
                    'sentiment_start': float(sentiment_start),
                    'sentiment_end': float(sentiment_end),
                }

                if use_supabase_db():
                    try:
                        client = get_supabase()
                        # Delete existing record for this persona
                        client.table('run_persona_teas').delete().eq('run_id', db_run_id).eq('persona_id', str(persona_id)).execute()
                        # Insert new record
                        client.table('run_persona_teas').insert(tea_data).execute()
                        print(f"[OK] Stored TEA data for persona {persona_id} (supabase)")
                    except Exception as e:
                        print(f"[ERROR] Failed to store TEA data for persona {persona_id} (supabase): {e}")
                else:
                    try:
                        # Delete existing record
                        await execute('delete from run_persona_teas where run_id=$1 and persona_id=$2', db_run_id, str(persona_id))
                        # Insert new record
                        await execute(
                            'insert into run_persona_teas (run_id, persona_id, thoughts, emotions, hesitations, actions, sentiment_start, sentiment_end) values ($1,$2,$3,$4,$5,$6,$7,$8)',
                            db_run_id, str(persona_id), json.dumps(thoughts_dict), json.dumps(emotions_dict), 
                            json.dumps(hesitations_dict), json.dumps(actions_dict), float(sentiment_start), float(sentiment_end)
                        )
                        print(f"[OK] Stored TEA data for persona {persona_id} (db)")
                    except Exception as e:
                        print(f"[ERROR] Failed to store TEA data for persona {persona_id} (db): {e}")

            except Exception as e:
                print(f"[ERROR] Failed to process persona {persona_id}: {e}")
                continue

    except Exception as e:
        print(f"[ERROR] TEA aggregation failed: {e}")
        raise


async def _ingest_run_artifacts(run_dir: pathlib.Path, db_run_id: Optional[str]) -> None:
    """Parse simulation artifacts under run_dir/tests and populate metrics tables.
    Safe no-op if db_run_id is None or artifacts missing.
    Detailed logs added for debugging.
    """
    try:
        print(f"[START] _ingest_run_artifacts run_dir={run_dir} db_run_id={db_run_id}")
        if not db_run_id:
            print("[SKIP] db_run_id is falsy; nothing to ingest.")
            return
        tests_root = run_dir / 'tests'
        if not tests_root.exists():
            print(f"[SKIP] tests root does not exist: {tests_root}")
            return

        # Load summary (if present)
        summary_path = tests_root / 'persona_summary.json'
        results = []
        aggregate = {}
        print(f"[INFO] summary_path exists: {summary_path.exists()} -> {summary_path}")
        if summary_path.exists():
            try:
                text = summary_path.read_text(encoding='utf-8')
                print(f"[DEBUG] persona_summary.json size={len(text)}")
                data = json.loads(text)
                results = list(data.get('results') or [])
                aggregate = dict(data.get('aggregate') or {})
                print(f"[OK] Loaded persona_summary: results={len(results)}, aggregate_keys={list(aggregate.keys())}")
            except Exception:
                print("[ERROR] Failed to read/parse persona_summary.json")
                traceback.print_exc()
                results = []
                aggregate = {}

        # Compute headline metrics
        try:
            total_steps = sum(int(r.get('steps') or 0) for r in results)
            total_time_sec = sum(float(r.get('time_sec') or 0.0) for r in results)
            personas_total = len(results)
            completed_total = sum(1 for r in results if (r.get('status') == 'completed'))
            if isinstance(aggregate.get('completion_rate_pct'), (int, float)):
                completion_rate_pct = aggregate.get('completion_rate_pct')
            else:
                completion_rate_pct = (round((completed_total / personas_total) * 100.0, 2) if personas_total else 0.0)
            print(f"[METRICS] total_steps={total_steps}, total_time_sec={total_time_sec}, personas_total={personas_total}, completed_total={completed_total}, completion_rate_pct={completion_rate_pct}")
        except Exception:
            print("[ERROR] Error computing headline metrics")
            traceback.print_exc()
            total_steps = 0
            total_time_sec = 0.0
            personas_total = 0
            completed_total = 0
            completion_rate_pct = 0.0

        # Parse traversal logs for screen metrics and dwell/wait time
        enters = Counter()      # screen_id -> enters
        exits = Counter()       # screen_id -> exits
        dwell_ms = Counter()    # screen_id -> dwell total ms
        # Per‑screen counters for problem scoring
        per_screen = defaultdict(lambda: {
            'dropoffs': 0,
            'backtracks': 0,
            'auto_wait': 0,
            'loops': 0,
        })
        auto_advances = 0
        total_wait_time_sec = 0.0
        backtracks = 0
        dropoff_counter = Counter()
        friction_counter = Counter()  # category -> count

        print("[INFO] Walking persona simulation folders to collect frictions, dropoffs, traversal logs")
        try:
            persona_glob = sorted(tests_root.glob('persona_*'))
            print(f"[DEBUG] Found persona dirs: {len(persona_glob)}")
        except Exception:
            print("[ERROR] Error listing persona_* under tests")
            traceback.print_exc()
            persona_glob = []

        for persona_dir in persona_glob:
            try:
                print(f"[INFO] Processing persona directory: {persona_dir}")
                sims_root = persona_dir / 'simulations'
                if not sims_root.exists():
                    print(f"  [WARN] simulations root missing: {sims_root}")
                    continue
                sim_dirs = [p for p in sims_root.iterdir() if p.is_dir()]
                print(f"  [DEBUG] found {len(sim_dirs)} sim dirs")
                if not sim_dirs:
                    continue
                latest = sorted(sim_dirs)[-1]
                print(f"  [INFO] Using latest simulation folder: {latest}")

                # Frictions and drop-offs from user_report.json
                rpt = latest / 'user_report.json'
                if rpt.exists():
                    try:
                        rpt_text = rpt.read_text(encoding='utf-8')
                        print(f"    [DEBUG] user_report.json size={len(rpt_text)}")
                        j = json.loads(rpt_text)
                        fr_list = j.get('friction_points') or []
                        dp_list = j.get('drop_off_points') or []
                        print(f"    [OK] user_report.json: frictions={len(fr_list)}, drop_offs={len(dp_list)}")
                        for fp in fr_list:
                            try:
                                typ = str(fp.get('type') or 'unknown')
                                friction_counter[typ] += 1
                                if typ.lower() == 'auto_wait':
                                    auto_advances += 1
                                if typ.lower() == 'back_or_close':
                                    backtracks += 1
                                sid = fp.get('screen_id')
                                if sid is not None:
                                    key = typ.lower()
                                    if key == 'back_or_close':
                                        per_screen[str(sid)]['backtracks'] += 1
                                    elif key == 'auto_wait':
                                        per_screen[str(sid)]['auto_wait'] += 1
                                    elif key == 'loop_detected':
                                        per_screen[str(sid)]['loops'] += 1
                            except Exception:
                                print("    [ERROR] error processing friction point entry")
                                traceback.print_exc()
                        for dp in dp_list:
                            try:
                                sid = dp.get('screen_id')
                                if sid is not None:
                                    dropoff_counter[str(sid)] += 1
                                    per_screen[str(sid)]['dropoffs'] += 1
                            except Exception:
                                print("    [ERROR] error processing dropoff entry")
                                traceback.print_exc()
                    except Exception:
                        print("    [ERROR] Failed to parse user_report.json")
                        traceback.print_exc()

                # Dwell from traversal_log.jsonl
                log_path = latest / 'traversal_log.jsonl'
                if log_path.exists():
                    try:
                        last_pre_ts: Optional[float] = None
                        last_pre_screen: Optional[int] = None
                        with open(log_path, 'r', encoding='utf-8') as f:
                            line_no = 0
                            for line in f:
                                line_no += 1
                                try:
                                    line = line.strip()
                                    if not line:
                                        continue
                                    ev = json.loads(line)
                                    typ = ev.get('type')
                                    if typ == 'pre_action_thought':
                                        try:
                                            last_pre_ts = float(ev.get('timestamp') or 0.0)
                                        except Exception:
                                            last_pre_ts = None
                                        sid = ev.get('screen_id')
                                        if isinstance(sid, int):
                                            enters[str(sid)] += 1
                                            last_pre_screen = sid
                                        print(f"      [TRACE] line={line_no} type=pre_action_thought sid={sid} ts={last_pre_ts}")
                                    elif typ == 'waiting':
                                        print(f"      [TRACE] line={line_no} type=waiting (ignored for dwell calc)")
                                    elif typ == 'action':
                                        sid = ev.get('screen_id')
                                        ts = None
                                        try:
                                            ts = float(ev.get('timestamp') or 0.0)
                                        except Exception:
                                            ts = None
                                        if isinstance(sid, int):
                                            exits[str(sid)] += 1
                                            if last_pre_ts and last_pre_screen is not None and ts is not None:
                                                try:
                                                    delta = max(0.0, ts - last_pre_ts)
                                                    total_wait_time_sec += delta
                                                    dwell_ms[str(last_pre_screen)] += int(delta * 1000.0)
                                                    print(f"      [TRACE] line={line_no} action: computed dwell for screen={last_pre_screen} delta={delta}s dwell_ms={dwell_ms[str(last_pre_screen)]}")
                                                except Exception:
                                                    print("      [ERROR] Failed to compute delta for action event")
                                                    traceback.print_exc()
                                            last_pre_ts = None
                                            last_pre_screen = None
                                    else:
                                        print(f"      [TRACE] line={line_no} type={typ} (unhandled)")
                                except json.JSONDecodeError:
                                    print(f"      [WARN] Malformed JSON at {log_path}:{line_no}")
                                except Exception:
                                    print(f"      [ERROR] Exception processing line {line_no} in {log_path}")
                                    traceback.print_exc()
                        print(f"    [OK] Parsed traversal_log ({log_path.name}) enters={sum(enters.values())} exits={sum(exits.values())} dwell_entries={len(dwell_ms)}")
                    except Exception:
                        print(f"    [ERROR] Failed to process traversal_log.jsonl")
                        traceback.print_exc()
                else:
                    print(f"    [DEBUG] traversal_log.jsonl not found at {log_path}")

            except Exception:
                print(f"  [ERROR] Unexpected error processing persona_dir: {persona_dir}")
                traceback.print_exc()

        print(f"[INFO] After walking personas: total_frictions={sum(friction_counter.values())} auto_advances={auto_advances} backtracks={backtracks} total_wait_time_sec={total_wait_time_sec} dropoff_count={sum(dropoff_counter.values())}")

        # Friction score heuristic: average frictions per persona
        try:
            total_frictions = sum(friction_counter.values())
            friction_score = float(total_frictions) / float(personas_total or 1)
            print(f"[METRIC] friction_score={friction_score} (total_frictions={total_frictions})")
        except Exception:
            print("[ERROR] computing friction_score failed")
            traceback.print_exc()
            friction_score = 0.0

        # Severity-weighted friction index (avg per persona)
        severity_sum = 0.0
        try:
            for k, v in friction_counter.items():
                try:
                    severity_sum += float(_severity_for_category(k)) * float(v)
                except Exception:
                    print(f"[WARN] severity lookup failed for category={k}")
                    traceback.print_exc()
            friction_index_severity = float(severity_sum) / float(personas_total or 1)
            print(f"[METRIC] friction_index_severity={friction_index_severity} severity_sum={severity_sum}")
        except Exception:
            print("[ERROR] computing friction_index_severity failed")
            traceback.print_exc()
            friction_index_severity = 0.0

        # Choose most frequent drop-off screen
        dropoff_screen_id = (dropoff_counter.most_common(1)[0][0] if dropoff_counter else None)
        print(f"[INFO] dropoff_screen_id resolved to: {dropoff_screen_id}")

        # Upload persona_summary.csv and capture signed URL
        report_csv_url = None
        csv_path = tests_root / 'persona_summary.csv'
        print(f"[INFO] Checking persona_summary.csv: exists={csv_path.exists()} -> {csv_path}")
        if csv_path.exists():
            try:
                proj_name = None
                if use_supabase_db():
                    print("[INFO] use_supabase_db() -> True, trying to resolve project name via supabase")
                    try:
                        rr = get_supabase().table('runs').select('project_id').eq('id', db_run_id).limit(1).execute()
                        print(f"  [DEBUG] Supabase runs select returned {getattr(rr, 'data', None)}")
                        if getattr(rr, 'data', None):
                            pid = rr.data[0]['project_id']
                            pr = get_supabase().table('projects').select('name').eq('id', pid).limit(1).execute()
                            print(f"  [DEBUG] Supabase projects select returned {getattr(pr, 'data', None)}")
                            if getattr(pr, 'data', None):
                                proj_name = pr.data[0]['name']
                    except Exception:
                        print("[ERROR] Querying Supabase for project name failed")
                        traceback.print_exc()
                else:
                    print("[INFO] using direct DB fetchrow to get project name")
                try:
                    row = await fetchrow('select p.name from runs r join projects p on r.project_id=p.id where r.id=$1', db_run_id)
                    if row:
                        proj_name = row['name']
                        print(f"[DEBUG] fetched project name via fetchrow: {proj_name}")
                except Exception:
                    print("[WARN] fetchrow for project name failed or returned nothing")
                    traceback.print_exc()

                if proj_name:
                    print(f"[INFO] Uploading persona_summary.csv to supabase logs for project {proj_name}")
                    try:
                        report_csv_url = upload_log_to_supabase(csv_path, proj_name, 'tests', run_dir.name)
                        print(f"[OK] Uploaded CSV; report_csv_url={report_csv_url}")
                    except Exception:
                        print("[ERROR] upload_log_to_supabase failed")
                        traceback.print_exc()
                else:
                    print("[WARN] proj_name not resolved; skipping CSV upload")
            except Exception:
                print("[ERROR] Unexpected error while handling persona_summary.csv")
                traceback.print_exc()

        # Compute additional headline metrics
        completed_steps_sum = 0
        try:
            completed_steps_sum = sum(int(r.get('steps') or 0) for r in results if str(r.get('status')).lower() == 'completed')
        except Exception:
            print("[ERROR] computing completed_steps_sum")
            traceback.print_exc()
            completed_steps_sum = 0
        avg_completed_steps = (float(completed_steps_sum) / float(completed_total or 1)) if completed_total else None
        avg_wait_per_step_sec = (float(total_wait_time_sec) / float(total_steps or 1)) if total_steps else None
        backtrack_rate = (float(backtracks) / float(total_steps or 1)) if total_steps else None
        print(f"[METRIC] completed_steps_sum={completed_steps_sum}, avg_completed_steps={avg_completed_steps}, avg_wait_per_step_sec={avg_wait_per_step_sec}, backtrack_rate={backtrack_rate}")

        # Compute shortest path (ideal steps) from graph if possible
        shortest_path_steps: Optional[int] = None
        try:
            print("[INFO] Attempting to compute shortest path from graph files")
            # Resolve source/target ids from results (assumed consistent across personas)
            src_id = None
            tgt_id = None
            for r in results:
                if src_id is None and isinstance(r.get('source_id'), int):
                    src_id = int(r.get('source_id'))
                if tgt_id is None and isinstance(r.get('target_id'), int):
                    tgt_id = int(r.get('target_id'))
                if isinstance(src_id, int) and isinstance(tgt_id, int):
                    break
            print(f"[DEBUG] candidate src_id={src_id}, tgt_id={tgt_id}")

            edges_path = run_dir / 'preprocess' / 'prototype_links_enriched.json'
            nodes_path = run_dir / 'preprocess' / 'screen_nodes.json'
            print(f"[DEBUG] edges_path={edges_path.exists()}, nodes_path={nodes_path.exists()}")

            if edges_path.exists() and isinstance(src_id, int) and isinstance(tgt_id, int):
                try:
                    edges_text = edges_path.read_text(encoding='utf-8')
                    print(f"[DEBUG] edges file size={len(edges_text)}")
                    edges = json.loads(edges_text)
                except Exception:
                    print("[WARN] Failed to parse edges file; defaulting edges=[]")
                    traceback.print_exc()
                    edges = []

                # Build fallbacks using screen_nodes.json
                name_to_id: Dict[str, int] = {}
                screenid_to_id: Dict[str, int] = {}
                try:
                    if nodes_path.exists():
                        nodes_text = nodes_path.read_text(encoding='utf-8')
                        print(f"[DEBUG] nodes file size={len(nodes_text)}")
                        nodes = json.loads(nodes_text)
                        for n in nodes or []:
                            try:
                                nid = int(n.get('id'))
                                nm = str(n.get('name') or '')
                                sid = str(n.get('screen_id') or '')
                                if nm:
                                    name_to_id[nm] = nid
                                if sid:
                                    screenid_to_id[sid] = nid
                            except Exception:
                                # tolerate bad node entries
                                traceback.print_exc()
                        print(f"[OK] Loaded nodes count={len(nodes or [])}, name_to_id size={len(name_to_id)}, screenid_to_id size={len(screenid_to_id)}")
                except Exception:
                    print("[WARN] reading nodes file failed")
                    traceback.print_exc()

                # Build adjacency
                adj: Dict[int, List[int]] = {}
                for e in edges or []:
                    try:
                        s: Optional[int] = e.get('screen_node_id') if isinstance(e.get('screen_node_id'), int) else None
                        d: Optional[int] = e.get('dest_node_id') if isinstance(e.get('dest_node_id'), int) else None
                        if not isinstance(s, int):
                            sid = str(e.get('source_screen_id') or '')
                            if sid and sid in screenid_to_id:
                                s = int(screenid_to_id[sid])
                        if not isinstance(d, int):
                            did = str(e.get('destination_screen_id') or '')
                            if did and did in screenid_to_id:
                                d = int(screenid_to_id[did])
                        if not isinstance(s, int):
                            nm = str(e.get('source_screen_name') or '')
                            if nm and nm in name_to_id:
                                s = int(name_to_id[nm])
                        if not isinstance(d, int):
                            nm = str(e.get('destination_screen_name') or '')
                            if nm and nm in name_to_id:
                                d = int(name_to_id[nm])
                        if isinstance(s, int) and isinstance(d, int):
                            adj.setdefault(int(s), []).append(int(d))
                    except Exception:
                        print("[WARN] error processing edge entry")
                        traceback.print_exc()

                print(f"[DEBUG] adjacency built nodes={len(adj)} (sample keys={list(adj.keys())[:5]})")
                # BFS
                from collections import deque
                dq = deque([(int(src_id), 0)])
                seen = set([int(src_id)])
                found = None
                print(f"[TRACE] Starting BFS from {src_id} -> {tgt_id}")
                while dq:
                    node, dist = dq.popleft()
                    # Log occasionally
                    if dist % 50 == 0:
                        print(f"[TRACE] BFS visiting node={node} dist={dist} queue_len={len(dq)}")
                    if node == int(tgt_id):
                        found = dist
                        print(f"[OK] BFS found target {tgt_id} at distance {found}")
                        break
                    for nxt in adj.get(node, []):
                        if nxt not in seen:
                            seen.add(nxt)
                            dq.append((nxt, dist + 1))
                if isinstance(found, int):
                    shortest_path_steps = int(found)
                    print(f"[INFO] shortest_path_steps set from BFS = {shortest_path_steps}")
                else:
                    print("[WARN] BFS did not find a path")
            else:
                print("[WARN] edges file missing or src/tgt not present; skipping BFS")
        except Exception as e:
            print(f"[ERROR] Error calculating shortest path: {e}")
            traceback.print_exc()
            shortest_path_steps = None

        # Fallback: if BFS could not resolve, use the best observed completed path length
        if shortest_path_steps is None:
            try:
                print("[INFO] Falling back to observed completed path lengths")
                completed_steps = [int(r.get('steps') or 0) for r in results if str(r.get('status')).lower() == 'completed' and int(r.get('steps') or 0) > 0]
                print(f"[DEBUG] completed_steps samples={completed_steps[:10]} count={len(completed_steps)}")
                if completed_steps:
                    shortest_path_steps = int(min(completed_steps))
                    print(f"[OK] shortest_path_steps set from observed completed min = {shortest_path_steps}")
                else:
                    print("[WARN] No completed_steps available for fallback")
            except Exception as e:
                print(f"[ERROR] Fallback calculating shortest path failed: {e}")
                traceback.print_exc()

        print(f"[RESULT] Final shortest_path_steps={shortest_path_steps}")

        # Upsert run_metrics
        try:
            print("[INFO] Preparing run_metrics data")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Querying existing run_metrics entry (supabase)")
                    existing = client.table('run_metrics').select('run_id').eq('run_id', db_run_id).limit(1).execute()
                    metrics_data = {
                    'run_id': db_run_id,
                    'success': bool(completed_total and completed_total == personas_total),
                    'completion_time_sec': int(round((aggregate.get('avg_time_sec') or (total_time_sec / float(personas_total or 1))) or 0.0)),
                    'total_steps': int(total_steps),
                    'backtracks': int(backtracks),
                    'auto_advances': int(auto_advances),
                    'total_wait_time_sec': int(round(total_wait_time_sec)),
                    'dropoff_screen_id': dropoff_screen_id,
                    'friction_score': float(friction_score),
                    'report_csv_url': report_csv_url or None,
                        # New extended fields
                        'personas_total': int(personas_total),
                        'completed_total': int(completed_total),
                        'completion_rate_pct': float(completion_rate_pct or 0.0),
                        'completed_total_steps': int(completed_steps_sum),
                        'avg_completed_steps': (float(avg_completed_steps) if avg_completed_steps is not None else None),
                        'shortest_path_steps': (int(shortest_path_steps) if isinstance(shortest_path_steps, int) else None),
                        'avg_wait_per_step_sec': (float(avg_wait_per_step_sec) if avg_wait_per_step_sec is not None else None),
                        'backtrack_rate': (float(backtrack_rate) if backtrack_rate is not None else None),
                        'friction_index_severity': float(friction_index_severity),
                        'decision_volatility_rate': None,
                    }
                    print(f"[DEBUG] metrics_data prepared: {metrics_data}")
                    if getattr(existing, 'data', None):
                        print("[DEBUG] run_metrics exists; performing update")
                        client.table('run_metrics').update(metrics_data).eq('run_id', db_run_id).execute()
                    else:
                        print("[DEBUG] run_metrics does not exist; performing insert")
                        client.table('run_metrics').insert(metrics_data).execute()
                    print("[OK] Supabase run_metrics upsert done")
                except Exception:
                    print("[ERROR] Supabase run_metrics upsert failed")
                    traceback.print_exc()
            else:
                print("[INFO] Using direct DB execute for run_metrics upsert")
                try:
                    await execute(
                    'insert into run_metrics (run_id, success, completion_time_sec, total_steps, backtracks, auto_advances, total_wait_time_sec, dropoff_screen_id, friction_score, report_csv_url) '
                    'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '
                    'on conflict (run_id) do update set success=excluded.success, completion_time_sec=excluded.completion_time_sec, total_steps=excluded.total_steps, backtracks=excluded.backtracks, auto_advances=excluded.auto_advances, total_wait_time_sec=excluded.total_wait_time_sec, dropoff_screen_id=excluded.dropoff_screen_id, friction_score=excluded.friction_score, report_csv_url=excluded.report_csv_url',
                    db_run_id,
                    bool(completed_total and completed_total == personas_total),
                    int(round((aggregate.get('avg_time_sec') or (total_time_sec / float(personas_total or 1))) or 0.0)),
                    int(total_steps),
                    int(backtracks),
                    int(auto_advances),
                    int(round(total_wait_time_sec)),
                    dropoff_screen_id,
                    float(friction_score),
                    report_csv_url or None,
                    )
                    print("[OK] Direct DB run_metrics upsert done")
                except Exception:
                    print("[ERROR] Direct DB run_metrics upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception preparing/upserting run_metrics")
            traceback.print_exc()

        # Upsert run_screen_metrics: clear then insert
        try:
            print("[INFO] Upserting run_screen_metrics")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Deleting existing run_screen_metrics (supabase)")
                    client.table('run_screen_metrics').delete().eq('run_id', db_run_id).execute()
                    screen_metrics_data = []
                    # overall aggregates (existing behavior)
                    for sid in set(list(enters.keys()) + list(exits.keys()) + list(dwell_ms.keys())):
                        screen_metrics_data.append({
                        'run_id': db_run_id,
                        'screen_id': str(sid),
                        'enters': int(enters.get(sid, 0)),
                        'exits': int(exits.get(sid, 0)),
                        'dwell_time_ms': int(dwell_ms.get(sid, 0)),
                    })
                    # per-user rows (optional) – iterate simulation folders
                    for persona_dir in sorted((tests_root.glob('persona_*'))):
                        pid = None
                        try:
                            pid = str(int(str(persona_dir.name).split('_', 1)[1]))
                        except Exception:
                            pid = None
                        sims_root = persona_dir / 'simulations'
                        if not sims_root.exists():
                            continue
                        for simdir in sorted([p for p in sims_root.rglob('*') if p.is_dir() and (p / 'traversal_log.jsonl').exists()]):
                            uid = None
                            try:
                                for seg in simdir.parts:
                                    if isinstance(seg, str) and seg.startswith('user_'):
                                        val = seg.split('_', 1)[1]
                                        if val.isdigit():
                                            uid = val
                                            break
                            except Exception:
                                uid = None
                            # parse traversal_log.jsonl to compute per-user enters/exits/dwell
                            try:
                                import json as _json
                                log_path = simdir / 'traversal_log.jsonl'
                                if not log_path.exists():
                                    continue
                                enters_u, exits_u, dwell_u = {}, {}, {}
                                last_screen = None
                                last_ts = None
                                for line in log_path.read_text(encoding='utf-8').splitlines():
                                    try:
                                        ev = _json.loads(line)
                                    except Exception:
                                        continue
                                    t = ev.get('type')
                                    if t == 'pre_action_thought':
                                        sid = ev.get('screen_id')
                                        if isinstance(sid, int):
                                            enters_u[str(sid)] = enters_u.get(str(sid), 0) + 1
                                        last_screen = sid
                                        last_ts = ev.get('timestamp')
                                    elif t == 'action' or t == 'reached' or t == 'end':
                                        sid = ev.get('screen_id')
                                        if isinstance(sid, int):
                                            exits_u[str(sid)] = exits_u.get(str(sid), 0) + 1
                                        ts = ev.get('timestamp')
                                        if isinstance(last_screen, int) and isinstance(last_ts, (int, float)) and isinstance(ts, (int, float)):
                                            dwell_u[str(last_screen)] = dwell_u.get(str(last_screen), 0) + int(round((ts - last_ts) * 1000.0))
                                        last_screen = sid
                                        last_ts = ts
                                if enters_u or exits_u or dwell_u:
                                    for sid in set(list(enters_u.keys()) + list(exits_u.keys()) + list(dwell_u.keys())):
                                        screen_metrics_data.append({
                                            'run_id': db_run_id,
                                            'persona_id': (pid or None),
                                            'user_id': uid,
                                            'screen_id': str(sid),
                                            'enters': int(enters_u.get(str(sid), 0)),
                                            'exits': int(exits_u.get(str(sid), 0)),
                                            'dwell_time_ms': int(dwell_u.get(str(sid), 0)),
                                        })
                            except Exception:
                                pass
                    print(f"[DEBUG] supabase will insert {len(screen_metrics_data)} run_screen_metrics rows")
                    if screen_metrics_data:
                        client.table('run_screen_metrics').insert(screen_metrics_data).execute()
                    print("[OK] Supabase run_screen_metrics upsert done")
                except Exception:
                    print("[ERROR] Supabase run_screen_metrics upsert failed")
                    traceback.print_exc()
            else:
                print("[INFO] Using direct DB to upsert run_screen_metrics")
                try:
                    await execute('delete from run_screen_metrics where run_id=$1', db_run_id)
                    for sid in set(list(enters.keys()) + list(exits.keys()) + list(dwell_ms.keys())):
                        await execute(
                            'insert into run_screen_metrics (run_id, screen_id, enters, exits, dwell_time_ms) values ($1,$2,$3,$4,$5)',
                            db_run_id,
                            str(sid),
                            int(enters.get(sid, 0)),
                            int(exits.get(sid, 0)),
                            int(dwell_ms.get(sid, 0)),
                        )
                    print("[OK] Direct DB run_screen_metrics upsert done")
                except Exception:
                    print("[ERROR] Direct DB run_screen_metrics upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception upserting run_screen_metrics")
            traceback.print_exc()

        # Upsert friction_points: clear then insert (per-user rows when available)
        try:
            print("[INFO] Upserting friction_points")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Deleting existing friction_points (supabase)")
                    client.table('friction_points').delete().eq('run_id', db_run_id).execute()
                    friction_points_data = []
                    for persona_dir in sorted((tests_root.glob('persona_*'))):
                        # extract persona slot id
                        pid = None
                        try:
                            pid = str(int(str(persona_dir.name).split('_', 1)[1]))
                        except Exception:
                            pid = None
                        sims_root = persona_dir / 'simulations'
                        if not sims_root.exists():
                            continue
                        for simdir in sorted([p for p in sims_root.rglob('*') if p.is_dir() and (p / 'user_report.json').exists()]):
                            # optional user id from path segment 'user_<id>'
                            uid = None
                            parts = simdir.parts
                            try:
                                for seg in parts:
                                    if isinstance(seg, str) and seg.startswith('user_'):
                                        val = seg.split('_', 1)[1]
                                        if val.isdigit():
                                            uid = val
                                            break
                            except Exception:
                                uid = None
                            rpt = simdir / 'user_report.json'
                            try:
                                j = json.loads(rpt.read_text(encoding='utf-8'))
                                for fp in (j.get('friction_points') or []):
                                    try:
                                        friction_points_data.append({
                                            'run_id': db_run_id,
                                            'persona_id': (pid or None),
                                            'user_id': (str(j.get('user_id')) if j.get('user_id') is not None else uid),
                                            'screen_id': (str(fp.get('screen_id')) if (fp.get('screen_id') is not None) else None),
                                            'category': str(fp.get('type') or 'unknown'),
                                            'severity': int(_severity_for_category(str(fp.get('type') or 'unknown'))),
                                            'details': str(fp.get('description') or fp.get('note') or ''),
                                        })
                                    except Exception:
                                        print("[WARN] Skipping bad friction point entry during supabase aggregation")
                                        traceback.print_exc()
                            except Exception:
                                print("[WARN] Failed reading/parsing user_report.json during supabase friction_points build")
                                traceback.print_exc()
                    print(f"[DEBUG] supabase will insert {len(friction_points_data)} friction_points entries")
                    if friction_points_data:
                        client.table('friction_points').insert(friction_points_data).execute()
                    print("[OK] Supabase friction_points upsert done")
                except Exception:
                    print("[ERROR] Supabase friction_points upsert failed")
                    traceback.print_exc()
            else:
                print("[INFO] Using direct DB to upsert friction_points")
                try:
                    await execute('delete from friction_points where run_id=$1', db_run_id)
                    for persona_dir in sorted((tests_root.glob('persona_*'))):
                        pid = None
                        try:
                            pid = str(int(str(persona_dir.name).split('_', 1)[1]))
                        except Exception:
                            pid = None
                        sims_root = persona_dir / 'simulations'
                        if not sims_root.exists():
                            continue
                        for simdir in sorted([p for p in sims_root.rglob('*') if p.is_dir() and (p / 'user_report.json').exists()]):
                            uid = None
                            parts = simdir.parts
                            try:
                                for seg in parts:
                                    if isinstance(seg, str) and seg.startswith('user_'):
                                        val = seg.split('_', 1)[1]
                                        if val.isdigit():
                                            uid = val
                                            break
                            except Exception:
                                uid = None
                            rpt = simdir / 'user_report.json'
                        if rpt.exists():
                            try:
                                j = json.loads(rpt.read_text(encoding='utf-8'))
                                for fp in (j.get('friction_points') or []):
                                    try:
                                        await execute(
                                                'insert into friction_points (run_id, persona_id, user_id, screen_id, type, severity, details) values ($1,$2,$3,$4,$5,$6,$7)',
                                            db_run_id,
                                                (pid or None),
                                                (str(j.get('user_id')) if j.get('user_id') is not None else uid),
                                            (str(fp.get('screen_id')) if (fp.get('screen_id') is not None) else None),
                                            str(fp.get('type') or 'unknown'),
                                            int(_severity_for_category(str(fp.get('type') or 'unknown'))),
                                            str(fp.get('description') or fp.get('note') or ''),
                                        )
                                    except Exception:
                                        print("[WARN] Skipping bad friction point entry during direct DB insertion")
                                        traceback.print_exc()
                            except Exception:
                                print("[WARN] Failed reading/parsing user_report.json during direct DB friction_points build")
                                traceback.print_exc()
                    print("[OK] Direct DB friction_points upsert done")
                except Exception:
                    print("[ERROR] Direct DB friction_points delete/insert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception upserting friction_points")
            traceback.print_exc()

        # Insert/Upsert run_results per persona (Supabase only for now)
        try:
            print("[INFO] Upserting run_results (Supabase path)")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Deleting existing run_results (supabase)")
                    client.table('run_results').delete().eq('run_id', db_run_id).execute()
                    rows = []
                    for r in results:
                        dropoffs = (r.get('drop_off_points') or [])
                        last_dp = dropoffs[-1] if dropoffs else {}
                        try:
                            # Extract thoughts from user_report.json if available
                            thoughts = r.get('thoughts') or []
                            
                            rows.append({
                                'run_id': db_run_id,
                                'persona_id': str(r.get('persona_id') or ''),
                                'user_id': (str(r.get('user_id')) if r.get('user_id') is not None else None),
                                'status': str(r.get('status') or ''),
                                'steps': int(r.get('steps') or 0),
                                'time_sec': float(r.get('time_sec') or 0.0),
                                'dropoff_screen_id': (str(last_dp.get('screen_id')) if (last_dp.get('screen_id') is not None) else None),
                                'dropoff_reason': (str(last_dp.get('reason') or r.get('status') or '')),
                                'thoughts': json.dumps(thoughts) if thoughts else None,
                            })
                        except Exception:
                            print("[WARN] Skipping bad result row while building supabase run_results")
                            traceback.print_exc()
                    print(f"[DEBUG] supabase will insert {len(rows)} run_results rows")
                    if rows:
                        client.table('run_results').insert(rows).execute()
                    print("[OK] Supabase run_results upsert done")
                except Exception:
                    print("[ERROR] Supabase run_results upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception in run_results supabase block")
            traceback.print_exc()

        # Aggregate and upsert run_dropoffs (Supabase only for now)
        try:
            print("[INFO] Aggregating run_dropoffs")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Deleting existing run_dropoffs (supabase)")
                    client.table('run_dropoffs').delete().eq('run_id', db_run_id).execute()
                    rows = []
                    for r in results:
                        pid = str(r.get('persona_id') or '')
                        uid = (str(r.get('user_id')) if r.get('user_id') is not None else None)
                        for dp in (r.get('drop_off_points') or []):
                            sid = dp.get('screen_id')
                            reason = dp.get('reason') or r.get('status') or 'unknown'
                        rows.append({
                            'run_id': db_run_id,
                                'persona_id': pid or None,
                                'user_id': uid,
                                'screen_id': (str(sid) if (sid is not None) else None),
                            'reason': reason,
                        })
                    print(f"[DEBUG] supabase will insert {len(rows)} run_dropoffs rows")
                    if rows:
                        client.table('run_dropoffs').insert(rows).execute()
                    print("[OK] Supabase run_dropoffs upsert done")
                except Exception:
                    print("[ERROR] Supabase run_dropoffs upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception in run_dropoffs aggregation block")
            traceback.print_exc()

        # run_persona: aggregate per persona slot (slot display name sourced from runs.meta persona_plan if available)
        try:
            print("[INFO] Aggregating run_persona per persona slot")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    # Clear existing persona rows for this run
                    client.table('run_persona').delete().eq('run_id', db_run_id).execute()
                    # Try to fetch persona_plan for slot names
                    plan_map = {}
                    try:
                        meta_row = client.table('runs').select('meta').eq('id', db_run_id).limit(1).execute()
                        if meta_row.data:
                            meta = meta_row.data[0].get('meta') or {}
                            plist = (meta.get('persona_plan') or {}).get('personas') or []
                            for pr in plist:
                                pid = str(pr.get('slot') or pr.get('id') or '')
                                nm = str(pr.get('name') or '')
                                if pid and nm:
                                    plan_map[pid] = nm
                    except Exception:
                        plan_map = {}
                    per = {}
                    for r in results:
                        pid = str(r.get('persona_id') or '')
                        if not pid:
                            continue
                        o = per.setdefault(pid, {'steps': 0, 'time': 0.0, 'runs': 0, 'completed': 0, 'frictions': 0, 'name': plan_map.get(pid) or None})
                        o['steps'] += int(r.get('steps') or 0)
                        o['time'] += float(r.get('time_sec') or 0.0)
                        o['runs'] += 1
                        if str(r.get('status') or '').lower() == 'completed':
                            o['completed'] += 1
                        o['frictions'] += len(r.get('friction_points') or [])
                    rows = []
                    for pid, o in per.items():
                        runs_cnt = max(1, int(o['runs']))
                        rows.append({
                        'run_id': db_run_id,
                            'persona_id': pid,
                            'name': o.get('name'),  # may be None; UI will default to 'Persona {slot}'
                            'users_total': int(o['runs']),
                            'users_completed': int(o['completed']),
                            # store numeric aggregates inside extra to avoid column mismatches
                            'extra': {
                                'avg_steps': float(o['steps']) / float(runs_cnt),
                                'avg_time_sec': float(o['time']) / float(runs_cnt),
                                'friction_index': (float(o['frictions']) / float(max(1, o['steps']))),
                                'completion_rate_pct': (100.0 * float(o['completed']) / float(runs_cnt)),
                            },
                        })
                    if rows:
                        client.table('run_persona').insert(rows).execute()
                    print("[OK] Supabase run_persona per-slot insert done")
                except Exception:
                    print("[ERROR] Supabase run_persona per-slot upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception aggregating run_persona")
            traceback.print_exc()

        # run_feedback: write summary and top feedback items
        try:
            print("[INFO] Upserting run_feedback (summary + top items)")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    print("[DEBUG] Deleting existing run_feedback (supabase)")
                    client.table('run_feedback').delete().eq('run_id', db_run_id).execute()
                    
                    feedback_data = []
                    # Summary text
                    summary_bits = []
                    if personas_total:
                        summary_bits.append(f"Completion: {completed_total}/{personas_total} ({completion_rate_pct}%).")
                    if aggregate.get('avg_steps') is not None:
                        summary_bits.append(f"Avg steps: {aggregate.get('avg_steps')}")
                    if aggregate.get('avg_time_sec') is not None:
                        summary_bits.append(f"Avg time: {aggregate.get('avg_time_sec')}s")
                    if friction_counter:
                        tf = ', '.join(f"{k}:{v}" for k, v in friction_counter.most_common(5))
                        summary_bits.append(f"Top frictions: {tf}")
                    if summary_bits:
                        feedback_data.append({
                            'run_id': db_run_id,
                            'kind': 'summary',
                            'content': ' '.join(summary_bits)
                        })
                    
                    # Feedback items from results
                    fb_added = 0
                    for r in results:
                        for fb in (r.get('feedback') or [])[:3]:
                            feedback_data.append({
                                'run_id': db_run_id,
                                'kind': 'feedback',
                                'content': str(fb)
                            })
                            fb_added += 1
                        if fb_added >= 8:
                            break
                    
                    print(f"[DEBUG] supabase will insert {len(feedback_data)} run_feedback rows")
                    if feedback_data:
                        client.table('run_feedback').insert(feedback_data).execute()
                    print("[OK] Supabase run_feedback upsert done")
                except Exception:
                    print("[ERROR] Supabase run_feedback upsert failed")
                    traceback.print_exc()

            else:
                # Direct DB path
                try:
                    await execute('delete from run_feedback where run_id=$1', db_run_id)
                    # Summary text
                    summary_bits = []
                    if personas_total:
                        summary_bits.append(f"Completion: {completed_total}/{personas_total} ({completion_rate_pct}%).")
                    if aggregate.get('avg_steps') is not None:
                        summary_bits.append(f"Avg steps: {aggregate.get('avg_steps')}")
                    if aggregate.get('avg_time_sec') is not None:
                        summary_bits.append(f"Avg time: {aggregate.get('avg_time_sec')}s")
                    if friction_counter:
                        tf = ', '.join(f"{k}:{v}" for k, v in friction_counter.most_common(5))
                        summary_bits.append(f"Top frictions: {tf}")
                    if summary_bits:
                        await execute('insert into run_feedback (run_id, kind, content) values ($1,$2,$3)', db_run_id, 'summary', ' '.join(summary_bits))
                    # Feedback items from results
                    fb_added = 0
                    for r in results:
                        for fb in (r.get('feedback') or [])[:3]:
                            await execute('insert into run_feedback (run_id, kind, content) values ($1,$2,$3)', db_run_id, 'feedback', str(fb))
                            fb_added += 1
                        if fb_added >= 8:
                            break
                    print("[OK] Direct DB run_feedback upsert done")
                except Exception:
                    print("[ERROR] Direct DB run_feedback upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception in run_feedback block")
            traceback.print_exc()

        # llm_run_insights – heuristic fill (no external LLM call yet)
        try:
            print("[INFO] Computing heuristic llm_run_insights")
            emotions = {'frustration': round(min(1.0, (sum(friction_counter.values()) / float(personas_total or 1)) / 8.0), 3)}
            friction_categories = {k: v for k, v in friction_counter.items()}
            themes = [
                {'label': k, 'frequency': v, 'severity_1_5': min(5, max(1, _severity_for_category(k) + (1 if v > 3 else 0))), 'examples': []}
                for k, v in friction_counter.most_common(5)
            ]
            detours_count = int(backtracks)
            backtrack_reasons = {'back_or_close': backtracks}
            copy_ia_issues = {
                'ambiguous_labels': friction_counter.get('unclear_primary_cta_persona', 0),
                'missing_context': friction_counter.get('auto_wait', 0),
                'redundant_steps': friction_counter.get('loop_detected', 0),
            }
            recommendations = {
                'prioritized_actions': aggregate.get('major_findings', {}).get('themes', [
                    'Make primary next actions visually dominant and consistently labeled',
                    'Provide progress indicators / reduce auto-advance ambiguity',
                    'Prevent loops via clearer hierarchy and guardrails'
                ])
            }
            goal_alignment = round((completed_total / float(personas_total or 1)), 3)
            csat = round(1.0 + 4.0 * goal_alignment - min(1.0, sum(friction_counter.values()) / float((personas_total or 1) * 5)), 2)
            confidence = 0.6
            
            if use_supabase_db():
                try:
                    client = get_supabase()
                    insights_data = {
                        'run_id': db_run_id,
                        'sentiment_score': float(round(goal_alignment - (sum(friction_counter.values()) / float((personas_total or 1) * 10)), 3)),
                        'csat_1_5': float(csat),
                        'emotions': emotions,
                        'themes': themes,
                        'friction_categories': friction_categories,
                        'goal_alignment_0_1': float(goal_alignment),
                        'detours_count': int(detours_count),
                        'backtrack_reasons': backtrack_reasons,
                        'copy_ia_issues': copy_ia_issues,
                        'recommendations': recommendations,
                        'persona_effects': {'ocean_avg': aggregate.get('ocean_avg') or None},
                        'confidence_0_1': float(confidence),
                        'evidence_spans': {'samples': []},
                    }
                    print(f"[DEBUG] supabase will upsert llm_run_insights: keys={list(insights_data.keys())}")
                    existing = client.table('llm_run_insights').select('run_id').eq('run_id', db_run_id).limit(1).execute()
                    if getattr(existing, 'data', None):
                        client.table('llm_run_insights').update(insights_data).eq('run_id', db_run_id).execute()
                    else:
                        client.table('llm_run_insights').insert(insights_data).execute()
                    print("[OK] Supabase llm_run_insights upsert done")
                except Exception:
                    print("[ERROR] Supabase llm_run_insights upsert failed")
                    traceback.print_exc()
            else:
                print("[INFO] Using direct DB for llm_run_insights upsert")
                try:
                    await execute(
                        'insert into llm_run_insights (run_id, sentiment_score, csat_1_5, emotions, themes, friction_categories, goal_alignment_0_1, detours_count, backtrack_reasons, copy_ia_issues, recommendations, persona_effects, confidence_0_1, evidence_spans) '
                        'values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb) '
                        'on conflict (run_id) do update set sentiment_score=excluded.sentiment_score, csat_1_5=excluded.csat_1_5, emotions=excluded.emotions, themes=excluded.themes, friction_categories=excluded.friction_categories, goal_alignment_0_1=excluded.goal_alignment_0_1, detours_count=excluded.detours_count, backtrack_reasons=excluded.backtrack_reasons, copy_ia_issues=excluded.copy_ia_issues, recommendations=excluded.recommendations, persona_effects=excluded.persona_effects, confidence_0_1=excluded.confidence_0_1, evidence_spans=excluded.evidence_spans',
                        db_run_id,
                        float(round(goal_alignment - (sum(friction_counter.values()) / float((personas_total or 1) * 10)), 3)),
                        float(csat),
                        json.dumps(emotions),
                        json.dumps(themes),
                        json.dumps(friction_categories),
                        float(goal_alignment),
                        int(detours_count),
                        json.dumps(backtrack_reasons),
                        json.dumps(copy_ia_issues),
                        json.dumps(recommendations),
                        json.dumps({'ocean_avg': aggregate.get('ocean_avg') or None}),
                        float(confidence),
                        json.dumps({'samples': []}),
                    )
                    print("[OK] Direct DB llm_run_insights upsert done")
                except Exception:
                    print("[ERROR] Direct DB llm_run_insights upsert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception computing/inserting llm_run_insights")
            traceback.print_exc()

        # llm_jobs – record a completed heuristic job entry
        try:
            print("[INFO] Inserting llm_jobs entry (heuristic job)")
            if use_supabase_db():
                try:
                    client = get_supabase()
                    job_data = {
                        'id': str(uuid.uuid4()),
                        'run_id': db_run_id,
                        'status': 'COMPLETED',
                        'model': 'heuristic-v1',
                        'error': None,
                    }
                    client.table('llm_jobs').insert(job_data).execute()
                    print("[OK] Supabase llm_jobs insert done")
                except Exception:
                    print("[ERROR] Supabase llm_jobs insert failed")
                    traceback.print_exc()
            else:
                print("[INFO] Using direct DB for llm_jobs insert")
                try:
                    await execute(
                        'insert into llm_jobs (id, run_id, status, model, error) values (uuid_generate_v4(), $1, $2, $3, $4)',
                        db_run_id,
                        'COMPLETED',
                        'heuristic-v1',
                        None,
                    )
                    print("[OK] Direct DB llm_jobs insert done")
                except Exception:
                    print("[ERROR] Direct DB llm_jobs insert failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception inserting llm_jobs")
            traceback.print_exc()

        # Algorithmic problem screen scoring -> run_screen_problem_scores
        try:
            print("[INFO] Computing run_screen_problem_scores")
            # Dwell distribution for z-scores
            try:
                vals = sorted([int(v) for v in dwell_ms.values() if int(v) > 0])
                median = (vals[len(vals)//2] if vals else 0)
                mad_src = sorted([abs(int(v) - int(median)) for v in vals])
                mad = (mad_src[len(mad_src)//2] if mad_src else 1) or 1
            except Exception:
                median, mad = 0, 1

            def dwell_z(v: int) -> float:
                try:
                    z = (float(v) - float(median)) / float(mad or 1)
                except Exception:
                    z = 0.0
                if z < 0:
                    z = 0.0
                if z > 3:
                    z = 3.0
                return z

            rows_scored = []
            for sid in set(list(per_screen.keys()) + list(dwell_ms.keys()) + list(enters.keys())):
                s = str(sid)
                ev = per_screen.get(s, {})
                touches = int(enters.get(s, 0)) or 1
                z = dwell_z(int(dwell_ms.get(s, 0)))
                drop_r = float(ev.get('dropoffs', 0)) / float(touches)
                back_r = float(ev.get('backtracks', 0)) / float(touches)
                auto_r = float(ev.get('auto_wait', 0)) / float(touches)
                loop_r = float(ev.get('loops', 0)) / float(touches)
                score = (4.0 * drop_r) + (3.0 * back_r) + (2.0 * auto_r) + (2.0 * loop_r) + (1.0 * z)
                if score <= 0:
                    continue
                comp = {
                    'dropoffs': round(drop_r, 4),
                    'backtracks': round(back_r, 4),
                    'auto_wait': round(auto_r, 4),
                    'loops': round(loop_r, 4),
                    'dwell_z': round(z, 3),
                }
                rows_scored.append({'run_id': db_run_id, 'screen_id': s, 'score': float(round(score, 4)), 'components': comp})

            if use_supabase_db():
                try:
                    client = get_supabase()
                    client.table('run_screen_problem_scores').delete().eq('run_id', db_run_id).execute()
                    if rows_scored:
                        client.table('run_screen_problem_scores').insert(rows_scored).execute()
                    print(f"[OK] Upserted {len(rows_scored)} run_screen_problem_scores rows (supabase)")
                except Exception:
                    print("[ERROR] Upsert run_screen_problem_scores (supabase) failed")
                    traceback.print_exc()
            else:
                try:
                    await execute('delete from run_screen_problem_scores where run_id=$1', db_run_id)
                    for r in rows_scored:
                        await execute('insert into run_screen_problem_scores (run_id, screen_id, score, components) values ($1,$2,$3,$4)', r['run_id'], r['screen_id'], float(r['score']), json.dumps(r['components']))
                    print(f"[OK] Upserted {len(rows_scored)} run_screen_problem_scores rows (db)")
                except Exception:
                    print("[ERROR] Upsert run_screen_problem_scores (db) failed")
                    traceback.print_exc()
        except Exception:
            print("[ERROR] Exception computing run_screen_problem_scores")
            traceback.print_exc()

        # TEA data aggregation - parse simulation logs and aggregate emotion data
        try:
            print("[INFO] Starting TEA data aggregation from simulation logs")
            await _aggregate_tea_data(run_dir, db_run_id)
        except Exception as e:
            print(f"[ERROR] TEA aggregation failed: {e}")
            traceback.print_exc()

        # Precompute recommendations artifacts for fast metrics
        try:
            print("[INFO] Precomputing recommendations artifacts for metrics")
            _precompute_recommendations(run_dir)
            print("[OK] Precomputed recommendations written under derived/")
        except Exception:
            print("[WARN] Precomputing recommendations failed; metrics will compute on first request")
            traceback.print_exc()

        print(f"[DONE] _ingest_run_artifacts completed for run_id={db_run_id}")
    except Exception:
        print(f"[ERROR] Exception in _ingest_run_artifacts for run_id={db_run_id}")
        traceback.print_exc()


