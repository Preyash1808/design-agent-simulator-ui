import os
import json
import time
import pathlib
import subprocess
import re
from typing import Optional, Dict, Any, List
import uuid

from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form, Depends, Header
from fastapi import Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .auth_utils import hash_password, verify_password, create_access_token, decode_access_token
from .db import fetchrow, execute, fetch
from .storage import (
    get_supabase,
    use_supabase_db,
    upload_log_to_supabase,
    upload_file_to_supabase,
    upload_run_artifacts,
)
from .models import PreprocessReq, TestsReq, AuthReq
from .utils import write_json, slugify, _severity_for_category
from . import metrics
from .metrics import get_run_metrics, get_run_metrics_public
from .ingest import _ingest_run_artifacts
from collections import Counter, defaultdict
from typing import Tuple
import uuid
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle
from reportlab.lib.units import mm
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Load environment from .env at process start so SUPABASE_* / USE_SUPABASE_DB are available
load_dotenv()
RUNS = ROOT / 'runs'
PROJECTS_JSON = RUNS / 'projects.json'
PYTHON = os.environ.get('PYTHON', str(ROOT / 'venv' / 'bin' / 'python'))

# Set paths in metrics and ingest modules
metrics.set_paths(ROOT, RUNS)
from . import ingest
ingest.set_root_path(ROOT)

app = FastAPI(title='Sparrow API', description='Preprocess and persona tests', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount('/runs-files', StaticFiles(directory=str(RUNS)), name='runs-files')
# Expose config assets (logos) to the UI
app.mount('/config', StaticFiles(directory=str(ROOT / 'config')), name='config')


# Import friction labels and heuristic groups from metrics module
FRICTION_LABELS = metrics.FRICTION_LABELS
HEURISTIC_GROUP = metrics.HEURISTIC_GROUP

# Models, storage utilities, and common utils now imported from modules

def read_projects() -> List[Dict[str, Any]]:
    if PROJECTS_JSON.exists():
        try:
            return json.loads(PROJECTS_JSON.read_text(encoding='utf-8'))
        except Exception:
            return []
    return []


def write_projects(items: List[Dict[str, Any]]) -> None:
    PROJECTS_JSON.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_JSON.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')



# Import routers
from .routes import health, status_full, runs

# Mount routers
app.include_router(health.router, tags=["health"])
app.include_router(status_full.router, tags=["status"])
app.include_router(runs.router, tags=["runs"])

# Set paths in route modules
status_full.set_runs_path(RUNS)
runs.set_paths(ROOT, RUNS, PYTHON)


# Note: Other routes (/projects, /runs, /status, /auth) will be extracted in next step
# For now, keeping them inline to ensure nothing breaks

# Large run routes moved to routes/runs.py


@app.get('/projects')
async def list_projects(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Return all projects for the current authenticated user, sorted by most recent."""
    email = get_current_user(authorization)
    if not email:
        raise HTTPException(status_code=401, detail="unauthorized")

    projects: List[Dict[str, Any]] = []

    if use_supabase_db():
        try:
            # get user id from email
            res = get_supabase().table("users").select("id").eq("email", email).limit(1).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="user not found")
            owner_id = str(res.data[0]['id'])

            # fetch projects belonging to this owner, sorted by created_at descending
            pr = (
                get_supabase()
                .table("projects")
                .select("id,name,created_at")
                .eq("owner_id", owner_id)
                .order("created_at", desc=True)
                .execute()
            )
            projects = [
                {
                    "id": p["id"],
                    "name": p.get("name"),
                    "created_at": p.get("created_at")
                }
                for p in (pr.data or [])
            ]
        except Exception as e:
            print(f"Supabase error fetching projects: {e}")
            raise HTTPException(status_code=500, detail="database error")
    else:
        try:
            row = await fetchrow("select id from users where email=$1", email)
            if not row:
                raise HTTPException(status_code=404, detail="user not found")
            owner_id = str(row["id"])

            rows = await fetch(
                "select id,name,extract(epoch from created_at) as created_at "
                "from projects where owner_id=$1 order by created_at desc",
                owner_id
            )
            projects = [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "created_at": float(r["created_at"]),
                }
                for r in rows
            ]
        except Exception as e:
            print(f"Postgres error fetching projects: {e}")
            raise HTTPException(status_code=500, detail="database error")

    return {"projects": projects}



import pathlib
import traceback
from typing import Any, Dict, List, Optional

from fastapi import Header, HTTPException, Query

# Assumes the following helpers/constants exist in your codebase:
# - get_current_user(authorization)
@app.get('/runs/{run_id}/status')
async def get_status(run_id: str) -> Dict[str, Any]:
    run_dir = RUNS / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail='run_id not found')
    status_path = run_dir / 'status.json'
    tests_status_path = run_dir / 'tests_status.json'
    out: Dict[str, Any] = {'run_id': run_id}
    if status_path.exists():
        try:
            out['preprocess'] = json.loads(status_path.read_text(encoding='utf-8'))
        except Exception:
            out['preprocess'] = {'status': 'UNKNOWN'}
    if tests_status_path.exists():
        try:
            out['tests'] = json.loads(tests_status_path.read_text(encoding='utf-8'))
        except Exception:
            out['tests'] = {'status': 'UNKNOWN'}
    return out


from fastapi import Header
from typing import Optional
import asyncio
import time
import re
import uuid
import random, string

from fastapi import Header
from typing import Optional
import asyncio
import time
import re
import uuid
import random, string


# /runs/preprocess moved to routes/runs.py

async def start_tests(req: TestsReq, bg: BackgroundTasks, authorization: Optional[str] = None):
    # Derive run_dir from project when not explicitly provided
    if req.run_dir:
        run_dir = pathlib.Path(req.run_dir)
        if not run_dir.is_absolute():
            run_dir = RUNS / req.run_dir
    else:
        run_dir = resolve_project_run_dir(req.project_id)
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail='run_dir not found')
    test_run_id = str(uuid.uuid4())
    # Insert run row (tests)
    db_run_id = None
    if use_supabase_db():
        try:
            project_db_id = None
            if req.project_id:
                r = get_supabase().table('projects').select('id').eq('id', req.project_id).limit(1).execute()
                if r.data:
                    project_db_id = str(r.data[0]['id'])
            if project_db_id:
                rr = get_supabase().table('runs').insert({
                    'project_id': project_db_id,
                    'kind': 'tests',
                    'status': 'INPROGRESS',
                    'goal': req.goal,
                    'log_path': f"/runs-files/{run_dir.name}/api_tests.log",
                    'run_dir': str(run_dir),
                }).select('id').limit(1).execute()
                if rr.data:
                    db_run_id = str(rr.data[0]['id'])
        except Exception:
            pass
    else:
        try:
            project_db_id = None
            if req.project_id:
                row = await fetchrow('select id from projects where id=$1', req.project_id)
                if row:
                    project_db_id = str(row['id'])
            if project_db_id:
                rrow = await fetchrow('insert into runs (project_id, kind, status, goal, log_path, run_dir) values ($1,$2,$3,$4,$5,$6) returning id',
                                      project_db_id, 'tests', 'INITIATED', req.goal, f"/runs-files/{run_dir.name}/api_tests.log", str(run_dir))
                db_run_id = str(rrow['id']) if rrow else None
                await execute('update runs set status=$1, started_at=now() where id=$2', 'INPROGRESS', db_run_id)
        except Exception:
            pass
    # mark INPROGRESS
    write_json(run_dir / 'tests_status.json', {
        'run_id': run_dir.name,
        'type': 'tests',
        'status': 'INPROGRESS',
        'test_run_id': test_run_id,
        'goal': req.goal,
        'started_at': time.time(),
        'updated_at': time.time(),
        'log': f"/runs-files/{run_dir.name}/api_tests.log",
    })
    import os as _os
    if _os.getenv('DISABLE_BACKGROUND', '').lower() in ('1','true','yes','y'):
        print("[RUNS] bg.add_task skipped (DISABLE_BACKGROUND)")
    else:
        bg.add_task(tests_job, str(run_dir), req.goal, int(req.max_minutes or 2), req.source_id, req.target_id, None, None, db_run_id)
    return {'accepted': True, 'run_dir': str(run_dir), 'test_run_id': test_run_id, 'status_url': f"/runs/{run_dir.name}/status", 'log': f"/runs-files/{run_dir.name}/api_tests.log", 'db': {'run_id': db_run_id}}



# /runs/tests-by-images moved to routes/runs.py

async def list_artifacts(run_id: str) -> Dict[str, Any]:
    run_dir = RUNS / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail='run_id not found')
    artifacts: List[Dict[str, str]] = []
    persona_csv_url = None
    for p in run_dir.rglob('*'):
        if p.is_file():
            rel = p.relative_to(RUNS)
            artifacts.append({'path': str(rel), 'url': f"/runs-files/{rel}"})
            if p.name == 'persona_summary.csv':
                # Upload persona_summary.csv to supabase and return signed url
                # project name via directory prefix of run_id (best-effort from DB or local mapping)
                proj_name = run_dir.name
                try:
                    row = await fetchrow('select p.name from runs r join projects p on r.project_id=p.id where r.run_dir=$1', str(run_dir))
                    if row:
                        proj_name = row['name']
                except Exception:
                    pass
                persona_csv_url = upload_log_to_supabase(p, proj_name, 'tests', run_id)
    return {'run_id': run_id, 'files': artifacts}


@app.get('/runs/{run_id}/metrics')
async def metrics_route(run_id: str):
    return await get_run_metrics(run_id)


@app.get('/api/metrics_public')
async def metrics_public_route(run_id: str):
    return await get_run_metrics_public(run_id)


@app.post('/api/auth/signup')
async def signup(req: AuthReq):
    # Check if registration is enabled
    registration_enabled = os.getenv('ENABLE_REGISTRATION', 'false').lower() in ('true', '1', 'yes')
    if not registration_enabled:
        raise HTTPException(status_code=403, detail='Registration is currently disabled')
    
    # Optional Supabase client path (no direct DB connection required)
    if use_supabase_db():
        client = get_supabase()
        try:
            res = client.table('users').select('id').eq('email', req.email).limit(1).execute()
            if (res.data or []):
                raise HTTPException(status_code=400, detail='email already registered')
            pw_hash = hash_password(req.password)
            client.table('users').insert({
                'email': req.email,
                'password_hash': pw_hash,
                'first_name': (req.first_name or ''),
                'last_name': (req.last_name or ''),
            }).execute()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail='database error')
        token = create_access_token({'sub': req.email})
        return {'access_token': token, 'token_type': 'bearer'}

    # Default: direct DB (asyncpg)
    row = await fetchrow('select id from users where email=$1', req.email)
    if row:
        raise HTTPException(status_code=400, detail='email already registered')
    pw_hash = hash_password(req.password)
    try:
        await execute('alter table users add column if not exists first_name text')
        await execute('alter table users add column if not exists last_name text')
    except Exception:
        pass
    await execute('insert into users (email, password_hash, first_name, last_name) values ($1,$2,$3,$4)', req.email, pw_hash, (req.first_name or ''), (req.last_name or ''))
    token = create_access_token({'sub': req.email})
    return {'access_token': token, 'token_type': 'bearer'}


@app.post('/login')
async def login(req: AuthReq):
    if use_supabase_db():
        client = get_supabase()
        try:
            res = client.table('users').select('id,password_hash,first_name,last_name').eq('email', req.email).limit(1).execute()
            row = (res.data or [None])[0]
            if not row or not verify_password(req.password, row.get('password_hash')):
                raise HTTPException(status_code=401, detail='invalid credentials')
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail='database error')
        token = create_access_token({'sub': req.email})
        return {'access_token': token, 'token_type': 'bearer', 'first_name': row.get('first_name') or '', 'last_name': row.get('last_name') or ''}

    row = await fetchrow('select id, password_hash, first_name, last_name from users where email=$1', req.email)
    if not row or not verify_password(req.password, row['password_hash']):
        raise HTTPException(status_code=401, detail='invalid credentials')
    token = create_access_token({'sub': req.email})
    return {'access_token': token, 'token_type': 'bearer', 'first_name': row.get('first_name') or '', 'last_name': row.get('last_name') or ''}


def get_current_user(authorization: Optional[str] = None):
    print(authorization)
    print(authorization.lower())
    print(authorization.lower().startswith('bearer '))
    print("Here here")
    if not authorization or not authorization.lower().startswith('bearer '):
        return None
    token = authorization.split(' ', 1)[1]
    print("Token: {0}".format(token))
    return decode_access_token(token)


@app.get('/me')
async def me(authorization: Optional[str] = Header(None)):
    email = get_current_user(authorization)
    if not email:
        raise HTTPException(status_code=401, detail='unauthorized')
    if use_supabase_db():
        client = get_supabase()
        try:
            res = client.table('users').select('id,email,created_at,first_name,last_name').eq('email', email).limit(1).execute()
            row = (res.data or [None])[0]
            if not row:
                raise HTTPException(status_code=404, detail='user not found')
            return {'id': str(row.get('id')), 'email': row.get('email'), 'created_at': row.get('created_at'), 'first_name': row.get('first_name') or '', 'last_name': row.get('last_name') or ''}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail='database error')
    row = await fetchrow('select id, email, created_at, first_name, last_name from users where email=$1', email)
    if not row:
        raise HTTPException(status_code=404, detail='user not found')
    return {'id': str(row['id']), 'email': row['email'], 'created_at': row['created_at'], 'first_name': row.get('first_name') or '', 'last_name': row.get('last_name') or ''}

@app.post('/logout')
async def logout():
    return {'ok': True}
