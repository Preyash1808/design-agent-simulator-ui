"""
Status routes for projects and runs.
Large aggregation endpoint that combines project and run data.
"""
import pathlib
import traceback
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Header, Query, Depends, HTTPException

from ..storage import get_supabase, use_supabase_db, upload_log_to_supabase, upload_tests_dir_zip
from ..db import fetchrow, fetch
from ..auth_utils import get_current_user

# Will be set by main.py
RUNS = None


def set_runs_path(runs: pathlib.Path):
    """Set the RUNS path from main.py"""
    global RUNS
    RUNS = runs


router = APIRouter()


@router.get('/status')
async def all_status(authorization: Optional[str] = Header(None),
    project_id: Optional[str] = Query(None),
    run_id: Optional[str] = Query(None),
    attach_signed_urls: Optional[bool] = Query(True)) -> Dict[str, Any]:
    """Aggregate preprocess (projects) and test runs (runs) ordered latest-first.
    Uses Supabase client when enabled; otherwise falls back to direct DB.
    Extensive debug logging added.
    """
    print("[ENTRY] /status called")
    print(f"[INPUT] authorization_present={bool(authorization)}, project_id={project_id}, run_id={run_id}")

    # Validate user & log
    try:
        email = get_current_user(authorization)
        print(f"[AUTH] resolved email: {email}")
    except Exception as e:
        print(f"[ERROR] get_current_user raised exception: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=401, detail="unauthorized")

    if not email:
        print("[AUTH] No email resolved -> unauthorized")
        raise HTTPException(status_code=401, detail="unauthorized")

    # Use Supabase path if enabled
    if use_supabase_db():
        print("[INFO] Running Supabase path for /status")
        client = get_supabase()
        items: List[Dict[str, Any]] = []
        owner_id = None

        # Re-resolve email (you did this in original code)
        try:
            email = get_current_user(authorization)
            print(f"[DEBUG] re-resolved email: {email}")
        except Exception as e:
            print(f"[WARN] re-get_current_user failed: {e}")
            traceback.print_exc()
            email = None

        # Resolve owner_id from users table
        try:
            if email:
                print(f"[DEBUG] Querying supabase users for email={email}")
                try:
                    r = client.table('users').select('id').eq('email', email).limit(1).execute()
                    print(f"[DEBUG] Supabase users query result object: {getattr(r, 'data', None)}")
                except Exception as e:
                    print(f"[ERROR] Supabase client.table('users') .execute() raised: {e}")
                    traceback.print_exc()
                    r = None

                if r and getattr(r, 'data', None):
                    owner_id = str(r.data[0].get('id'))
                    print(f"[OK] Resolved owner_id: {owner_id}")
                else:
                    print("[WARN] No user row returned from supabase for email")
            else:
                print("[WARN] email is falsy; cannot query users table")
        except Exception as e:
            owner_id = None
            print(f"[ERROR] Exception while resolving owner_id: {e}")
            traceback.print_exc()

        print(f"[INFO] owner_id after resolution attempt: {owner_id}")
        if not owner_id:
            print("[SECURITY] owner_id not resolved -> returning empty items to avoid leaking data")
            return {'items': []}

        # Fetch projects for this owner (with optional project_id filter)
        proj_rows: List[Dict[str, Any]] = []
        try:
            try:
                sel = 'id,name,status,created_at,updated_at,figma_url,figma_page,run_dir'
                q = client.table('projects').select(sel).eq('owner_id', owner_id)
                if project_id:
                    print(f"[DEBUG] Applying project_id filter: {project_id}")
                    q = q.eq('id', project_id)
                print(f"[DEBUG] Supabase projects query prepared: {q}")
            except Exception as e:
                print(f"[ERROR] Failed preparing supabase projects query: {e}")
                traceback.print_exc()
                q = None

            if q is not None:
                try:
                    pr = q.execute()
                    print(f"[DEBUG] Supabase projects execute returned: {getattr(pr, 'data', None)}")
                except Exception as e:
                    print(f"[ERROR] Exception executing projects query: {e}")
                    traceback.print_exc()
                    pr = None

                proj_rows = (pr.data or []) if pr else []
                print(f"[OK] proj_rows count: {len(proj_rows)}")
            else:
                print("[WARN] q is None; skipping projects fetch")
                proj_rows = []

            # Normalize project rows into items
            for p in proj_rows:
                try:
                    items.append({
                        'id': p.get('id'),
                        'name': p.get('name'),
                        'status': p.get('status'),
                        'created_at': p.get('created_at'),
                        'updated_at': p.get('updated_at'),
                        'figma_url': p.get('figma_url'),
                        'figma_page': p.get('figma_page'),
                        'type': 'project',
                        'project_id': p.get('id'),
                        'project_name': p.get('name'),
                        'kind': None,
                        'goal': None,
                        'finished_at': None,
                        'run_dir': p.get('run_dir'),
                    })
                except Exception as e:
                    print(f"[WARN] Failed to append project row to items: {e}, row={p}")
                    traceback.print_exc()
        except Exception as e:
            print(f"[ERROR] Unexpected exception while fetching/processing projects: {e}")
            traceback.print_exc()

        # Fetch runs limited to user's projects
        try:
            sel = 'id,project_id,kind,status,goal,finished_at,log_path,run_dir,started_at'
            rq = client.table('runs').select(sel)
            if project_id:
                print(f"[DEBUG] Applying project_id filter to runs: {project_id}")
                rq = rq.eq('project_id', project_id)
            if run_id:
                print(f"[DEBUG] Applying run_id filter to runs: {run_id}")
                rq = rq.eq('id', run_id)
            print(f"[DEBUG] Supabase runs query prepared: {rq}")
            try:
                rr = rq.execute()
                print(f"[DEBUG] Supabase runs execute returned: {getattr(rr, 'data', None)}")
            except Exception as e:
                print(f"[ERROR] Exception executing runs query: {e}")
                traceback.print_exc()
                rr = None

            proj_ids = {p.get('id') for p in proj_rows}
            proj_map = {p.get('id'): p.get('name') for p in proj_rows}
            print(f"[DEBUG] proj_ids: {proj_ids}")
            for r in (rr.data or []) if rr else []:
                try:
                    if r.get('project_id') not in proj_ids:
                        print(f"[TRACE] skipping run {r.get('id')} for project {r.get('project_id')} (not in user's projects)")
                        continue
                    items.append({
                        'id': r.get('id'),
                        'name': proj_map.get(r.get('project_id')),
                        'status': r.get('status'),
                        'created_at': r.get('started_at'),
                        'updated_at': r.get('finished_at'),
                        'figma_url': None,
                        'figma_page': None,
                        'type': 'run',
                        'project_id': r.get('project_id'),
                        'project_name': proj_map.get(r.get('project_id')),
                        'kind': r.get('kind'),
                        'goal': r.get('goal'),
                        'finished_at': r.get('finished_at'),
                        'log_path': r.get('log_path'),
                        'run_dir': r.get('run_dir'),
                    })
                except Exception as e:
                    print(f"[WARN] Failed to append run row to items: {e}, row={r}")
                    traceback.print_exc()
        except Exception as e:
            print(f"[ERROR] Unexpected exception while fetching/processing runs: {e}")
            traceback.print_exc()

        # Attach report_url logic (local files or Supabase signed URL)
        try:
            print(f"[INFO] Attaching report URLs for {len(items)} items (attach_signed_urls={attach_signed_urls})")
            for it in items:
                try:
                    if it.get('type') == 'run':
                        run_dir_str = it.get('run_dir') or ''
                        run_item_id = it.get('id')
                        proj_name = it.get('project_name') or it.get('name') or 'project'
                        print(f"[TRACE] Processing run item id={run_item_id}, run_dir={run_dir_str}, proj_name={proj_name}")

                        run_path = pathlib.Path(run_dir_str)
                        if not run_path.is_absolute():
                            run_path = RUNS / run_dir_str
                        print(f"[DEBUG] Resolved run_path: {run_path} (exists={run_path.exists()})")

                        csv_path = None
                        if run_path.exists():
                            try:
                                for p in run_path.rglob('persona_summary.csv'):
                                    csv_path = p
                                    print(f"[DEBUG] Found persona_summary.csv at: {csv_path}")
                                    break
                            except Exception as e:
                                print(f"[ERROR] Error while searching for persona_summary.csv under {run_path}: {e}")
                                traceback.print_exc()

                        if csv_path:
                            try:
                                if attach_signed_urls:
                                    # Prefer zipped tests folder; fallback to CSV
                                    zip_url = None
                                    try:
                                        zip_url = upload_tests_dir_zip(run_path, proj_name, run_item_id, 'tests.zip')
                                    except Exception:
                                        zip_url = None
                                    url = zip_url or upload_log_to_supabase(csv_path, proj_name, 'tests', run_item_id)
                                    print(f"[DEBUG] upload_log_to_supabase returned: {url} for csv_path={csv_path}")
                                    if url:
                                        it['report_url'] = url
                                    else:
                                        rel = csv_path.relative_to(RUNS)
                                        it['report_url'] = f"/runs-files/{rel}"
                                        print(f"[DEBUG] Fallback report_url: {it['report_url']}")
                                else:
                                    rel = csv_path.relative_to(RUNS)
                                    it['report_url'] = f"/runs-files/{rel}"
                                    print(f"[TRACE] attach_signed_urls is False; using local report_url: {it['report_url']}")
                            except Exception as e:
                                print(f"[ERROR] report_url build failed for {csv_path}: {e}")
                                traceback.print_exc()
                                try:
                                    rel = csv_path.relative_to(RUNS) if csv_path else None
                                    it['report_url'] = f"/runs-files/{rel}" if rel else None
                                except Exception:
                                    it['report_url'] = None
                        else:
                            # try zipping tests dir even if CSV missing
                            try:
                                tests_dir = run_path / 'tests'
                                if tests_dir.exists() and attach_signed_urls:
                                    url = upload_tests_dir_zip(run_path, proj_name, run_item_id, 'tests.zip')
                                    if url:
                                        it['report_url'] = url
                                    else:
                                        it['report_url'] = None
                                else:
                                    it['report_url'] = None
                                print(f"[TRACE] No persona_summary.csv; tests zip url: {it['report_url']}")
                            except Exception:
                                it['report_url'] = None
                                print(f"[TRACE] No persona_summary.csv found for run item id={run_item_id}")
                    else:
                        it['report_url'] = None
                except Exception as e:
                    print(f"[WARN] Exception handling report_url for item: {it}. Error: {e}")
                    traceback.print_exc()
        except Exception as e:
            print(f"[ERROR] Exception while attaching report URLs to items: {e}")
            traceback.print_exc()

        # Final sort and return
        try:
            items.sort(key=lambda x: x.get('created_at') or 0, reverse=True)
            print(f"[OK] Returning {len(items)} items (supabase path)")
        except Exception as e:
            print(f"[ERROR] Sorting items failed: {e}")
            traceback.print_exc()
        return {'items': items}

    # Default: direct DB
    print("[INFO] Running direct DB path for /status")
    try:
        email = get_current_user(authorization)
        print(f"[DEBUG] direct DB re-resolved email: {email}")
    except Exception as e:
        print(f"[ERROR] get_current_user (direct DB path) failed: {e}")
        traceback.print_exc()
        email = None

    where_projects = ''
    where_runs = ''
    args: List[Any] = []
    owner_id = None
    if email:
        try:
            row = await fetchrow('select id from users where email=$1', email)
            print(f"[DEBUG] fetchrow user by email returned: {row}")
            if row:
                owner_id = str(row['id'])
                where_projects = ' where p.owner_id = $1'
                where_runs = ' where p.owner_id = $1'
                args = [owner_id]
                print(f"[OK] direct DB owner_id: {owner_id}")
            else:
                print("[WARN] No user row found in direct DB for email")
        except Exception as e:
            print(f"[ERROR] Error fetching user id from direct DB: {e}")
            traceback.print_exc()

    q_projects = (
        'select p.id, p.name, p.status, p.created_at, p.updated_at, p.figma_url, p.figma_page, '
        "'project' as type, p.id as project_id, p.name as project_name, null::text as kind, null::text as goal, null::timestamptz as finished_at, coalesce(p.meta->>'log_url', null) as log_path, null::text as run_dir "
        'from projects p' + where_projects
    )
    q_runs = (
        'select r.id, p.name, r.status, r.started_at as created_at, r.finished_at as updated_at, p.figma_url, p.figma_page, '
        "'run' as type, p.id as project_id, p.name as project_name, r.kind, r.goal, r.finished_at, r.log_path, r.run_dir "
        'from runs r join projects p on r.project_id = p.id' + where_runs
    )

    print(f"[DEBUG] q_projects: {q_projects}")
    print(f"[DEBUG] q_runs: {q_runs}")
    print(f"[DEBUG] q args: {args}")

    try:
        rows_projects = await fetch(q_projects, *args)
        rows_runs = await fetch(q_runs, *args)
        print(f"[DEBUG] rows_projects count: {len(rows_projects)}, rows_runs count: {len(rows_runs)}")
    except Exception as e:
        print(f"[ERROR] Error executing direct DB fetch queries: {e}")
        traceback.print_exc()
        rows_projects = []
        rows_runs = []

    def to_dict(row):
        try:
            return {k: row[k] for k in row.keys()}
        except Exception:
            print(f"[ERROR] to_dict failed for row: {row}")
            traceback.print_exc()
            return {}

    items = [to_dict(r) for r in rows_projects] + [to_dict(r) for r in rows_runs]
    print(f"[INFO] Combined items length before attaching report_url: {len(items)}")

    # Attach report_url for runs by locating persona_summary.csv and generating a signed URL
    try:
        for it in items:
            try:
                if it.get('type') == 'run':
                    run_dir_str = it.get('run_dir') or ''
                    run_item_id = it.get('id')
                    proj_name = it.get('project_name') or it.get('name') or 'project'
                    run_path = pathlib.Path(run_dir_str)
                    if not run_path.is_absolute():
                        run_path = RUNS / run_dir_str
                    print(f"[TRACE] direct DB run item id={run_item_id} run_dir resolved to {run_path} (exists={run_path.exists()})")
                    csv_path = None
                    if run_path.exists():
                        try:
                            for p in run_path.rglob('persona_summary.csv'):
                                csv_path = p
                                print(f"[DEBUG] found persona_summary.csv at: {csv_path} for run {run_item_id}")
                                break
                        except Exception as e:
                            print(f"[ERROR] error scanning run_path {run_path}: {e}")
                            traceback.print_exc()

                    if csv_path:
                        try:
                            if attach_signed_urls:
                                url = upload_log_to_supabase(csv_path, proj_name, 'tests', run_item_id)
                                print(f"[DEBUG] upload_log_to_supabase returned: {url} for csv_path={csv_path}")
                                if url:
                                    it['report_url'] = url
                                else:
                                    rel = csv_path.relative_to(RUNS)
                                    it['report_url'] = f"/runs-files/{rel}"
                                    print(f"[DEBUG] fallback report_url: {it['report_url']}")
                            else:
                                rel = csv_path.relative_to(RUNS)
                                it['report_url'] = f"/runs-files/{rel}"
                                print(f"[TRACE] attach_signed_urls is False; using local report_url: {it['report_url']}")
                        except Exception as e:
                            print(f"[ERROR] report_url build failed for {csv_path}: {e}")
                            traceback.print_exc()
                            try:
                                rel = csv_path.relative_to(RUNS) if csv_path else None
                                it['report_url'] = f"/runs-files/{rel}" if rel else None
                            except Exception:
                                it['report_url'] = None
                    else:
                        it['report_url'] = None
                        print(f"[TRACE] No persona_summary.csv found for direct DB run item id={run_item_id}")
                else:
                    it['report_url'] = None
            except Exception as e:
                print(f"[WARN] Exception while attaching report_url for item {it}: {e}")
                traceback.print_exc()
    except Exception as e:
        print(f"[ERROR] Exception in report_url attachment loop for direct DB path: {e}")
        traceback.print_exc()

    # Final sort and return
    try:
        items.sort(key=lambda x: x.get('created_at') or 0, reverse=True)
        print(f"[OK] Returning {len(items)} items (direct DB path)")
    except Exception as e:
        print(f"[ERROR] Sorting items failed at end of /status: {e}")
        traceback.print_exc()

    print("[EXIT] /status completed")
    return {'items': items}

