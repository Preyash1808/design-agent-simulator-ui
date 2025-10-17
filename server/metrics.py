"""
Metrics service for fetching and formatting run metrics.
Provides both internal and public-facing metric endpoints.
"""
import json
import pathlib
from typing import Dict, Any, List, Optional, Tuple
from collections import Counter
import re
from fastapi import HTTPException

from .storage import get_supabase, use_supabase_db, upload_file_to_supabase
from .db import fetchrow, fetch
from .utils import slugify


# Friendly labels for friction categories
FRICTION_LABELS = {
    'loop_detected': 'Users got stuck in a loop',
    'auto_wait': 'Auto-advancing screen confusion',
    'back_or_close': 'Users tried to go back/close',
    'unclear_primary_cta_persona': 'Primary action unclear',
    'choice_overload_persona': 'Too many choices on screen',
    'resistance_to_prompts_persona': 'Users resisted prompts/permissions',
    'anxiety_wait_persona': 'Long waits increased uncertainty',
    'too_many_steps_persona': 'Too many steps',
}

# Heuristic grouping for friction categories
HEURISTIC_GROUP = {
    'loop_detected': 'User control and freedom',
    'auto_wait': 'Visibility of system status',
    'back_or_close': 'User control and freedom',
    'unclear_primary_cta_persona': 'Recognition rather than recall',
    'choice_overload_persona': 'Aesthetic and minimalist design',
    'resistance_to_prompts_persona': 'Help users recognize, diagnose, recover',
    'anxiety_wait_persona': 'Visibility of system status',
    'too_many_steps_persona': 'Flexibility and efficiency of use',
}

# This will be set by main.py
ROOT = None
RUNS = None


def set_paths(root: pathlib.Path, runs: pathlib.Path):
    """Set the ROOT and RUNS paths from main.py"""
    global ROOT, RUNS
    ROOT = root
    RUNS = runs


# In-process recommendation text normalization cache (original -> cleaned)
_REC_NORMAL_CACHE: Dict[str, str] = {}
USE_LLM_PROOF: bool = False
try:
    import os
    USE_LLM_PROOF = str(os.environ.get('RECS_LLM_PROOFREAD', '0')).lower() in ('1', 'true', 'yes')
except Exception:
    USE_LLM_PROOF = False


def _normalize_recommendation_text(text: str) -> str:
    """Rule-based, deterministic normalization to imperative, user-centric style.
    This is intentionally conservative and fast; it can be augmented by an LLM
    gate later. Results are cached for consistency.
    """
    try:
        raw = (text or "").strip()
        if not raw:
            return ""
        if raw in _REC_NORMAL_CACHE:
            return _REC_NORMAL_CACHE[raw]

        s = raw
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"\s+,", ",", s)

        # Screen-focus phrasing first
        s = re.sub(r"^i\s+wish\s+(?:this|the)\s+screen\s+would\s+just\s+focus\s+on\s+",
                   "Focus this screen on ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+(?:this|the)\s+screen\s+would\s+focus\s+on\s+",
                   "Focus this screen on ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+(?:this|the)\s+screen\s+would\s+",
                   "Make this screen ", s, flags=re.I)

        # There was/is only/just one -> Use a single
        s = re.sub(r"\bthere\s+(?:was|is)\s+(?:only|just)\s+one\b", "use a single", s, flags=re.I)

        # Common lead-ins
        s = re.sub(r"^i\s+wish\s+there\s+was\s+a\s+clear\s+", "Add a clear ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+there\s+was\s+only\s+one\b", "Use a single", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+there\s+were\s+", "Add ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+the\s+app\s+would\s+just\s+present\s+", "Present ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+the\s+app\s+would\s+", "Make the app ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+this\s+list\s+was\s+", "Group this list ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+the\s+list\s+was\s+", "Group the list ", s, flags=re.I)
        s = re.sub(r"^i\s+wish\s+", "Add ", s, flags=re.I)

        # It would help if -> Ensure, keep present tense
        s = re.sub(r"^it\s+would\s+help\s+if\s+the\s+", "Ensure the ", s, flags=re.I)
        s = re.sub(r"^it\s+would\s+help\s+if\s+", "Ensure ", s, flags=re.I)
        s = re.sub(r"\bwere\s+placed\b", "are placed", s, flags=re.I)
        s = re.sub(r"\bhad\b", "have", s, flags=re.I)

        # Timing: "was only requested after I hit the 'Checkout' button"
        m = re.match(r"^(?:Ensure\s+)?(.+?)\s+was\s+only\s+requested\s+after\s+I\s+(?:hit|click|tap|press)\s+(?:the\s+)?'?(checkout|pay|buy now)'?\s+button\.?$",
                     s, flags=re.I)
        if m:
            what = m.group(1)
            btn = m.group(2)
            s = f"Request {what} only after users click '{btn.capitalize()}'."

        # First-person -> user-centric
        s = re.sub(r"\bso\s+i\s+can\b", "so users can", s, flags=re.I)
        s = re.sub(r"\bso\s+i\s+could\b", "so users can", s, flags=re.I)
        s = re.sub(r"\bi\'?m\b", "users are", s, flags=re.I)
        s = re.sub(r"\bi\s+am\b", "users are", s, flags=re.I)
        s = re.sub(r"\bi\s+don'?t\s+have\s+to\b", "users don't have to", s, flags=re.I)
        s = re.sub(r"\bmy\s+(cart\s+summary|order\s+summary|cart|order|wishlist|account|address|profile)\b",
                   r"the \1", s, flags=re.I)
        s = re.sub(r"\bmy\s+(favorites?)\b", r"\1", s, flags=re.I)

        # Fix leading 'Add there ...'
        s = re.sub(r"^Add\s+there\s+(?:was|is)\b", "Use ", s, flags=re.I)
        # Fix double-verb like 'Add use a single ...'
        s = re.sub(r"^Add\s+use\s+a\s+single", "Use a single", s, flags=re.I)

        # Cleanup
        s = re.sub(r"\s{2,}", " ", s).strip()
        if s and not re.search(r"[.!?]$", s):
            s += "."
        # Capitalize
        if s:
            s = s[0].upper() + s[1:]

        cleaned = s

        # Optional LLM proofread pass
        if USE_LLM_PROOF:
            try:
                from google.generativeai import configure, GenerativeModel
                api_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')
                if api_key:
                    configure(api_key=api_key)
                    model = GenerativeModel('gemini-1.5-flash')
                    prompt = (
                        "Rewrite the sentence for a product design recommendation panel. "
                        "Constraints: imperative voice, present tense, concise, clear, no first person, "
                        "no added facts, <=160 chars. Return only the sentence.\n" 
                        f"Sentence: {cleaned}"
                    )
                    resp = model.generate_content(prompt)
                    cand = (getattr(resp, 'text', None) or '').strip()
                    if cand and 4 <= len(cand) <= 200:
                        cleaned = cand
            except Exception:
                pass

        _REC_NORMAL_CACHE[raw] = cleaned
        return cleaned
    except Exception:
        return (text or "").strip()


async def get_run_metrics(run_id: str) -> Dict[str, Any]:
    """Return consolidated metrics for a run from Supabase tables."""
    if use_supabase_db():
        client = get_supabase()
        # Validate run
        rr = client.table('runs').select('id').eq('id', run_id).limit(1).execute()
        if not (rr.data or []):
            raise HTTPException(status_code=404, detail='run not found')
        # Fetch related
        def one(tbl):
            try:
                r = client.table(tbl).select('*').eq('run_id', run_id).limit(1).execute()
                return (r.data or [None])[0]
            except Exception:
                return None
        def many(tbl, order=None, limit=None):
            try:
                q = client.table(tbl).select('*').eq('run_id', run_id)
                if order:
                    # order example: ('dwell_time_ms', 'desc')
                    q = q.order(order[0], desc=(order[1].lower()=='desc'))
                if limit:
                    q = q.limit(limit)
                r = q.execute()
                return r.data or []
            except Exception:
                return []
        rm = one('run_metrics')
        screens = many('run_screen_metrics', order=('dwell_time_ms','desc'), limit=200)
        frictions = many('friction_points', order=('severity','desc'))
        rper = one('run_persona')
        rfb = many('run_feedback', order=('id','asc'))
        ins = one('llm_run_insights')
        def idict(x):
            return x
        return {
            'run_id': run_id,
            'run_metrics': idict(rm),
            'screen_metrics': [idict(x) for x in screens],
            'friction_points': [idict(x) for x in frictions],
            'run_persona': idict(rper),
            'run_feedback': [idict(x) for x in rfb],
            'llm_run_insights': idict(ins),
        }
    # Default: DB path
    row = await fetchrow('select id from runs where id=$1', run_id)
    if not row:
        raise HTTPException(status_code=404, detail='run not found')
    rm = await fetchrow('select * from run_metrics where run_id=$1', run_id)
    screens = await fetch('select * from run_screen_metrics where run_id=$1 order by dwell_time_ms desc nulls last limit 200', run_id)
    frictions = await fetch('select * from friction_points where run_id=$1 order by severity desc, created_at asc', run_id)
    rper = await fetchrow('select * from run_persona where run_id=$1', run_id)
    rfb = await fetch('select * from run_feedback where run_id=$1 order by id asc', run_id)
    ins = await fetchrow('select * from llm_run_insights where run_id=$1', run_id)

    def to_dict(x):
        return {k: x[k] for k in x.keys()} if x else None
    return {
        'run_id': run_id,
        'run_metrics': to_dict(rm),
        'screen_metrics': [to_dict(x) for x in screens],
        'friction_points': [to_dict(x) for x in frictions],
        'run_persona': to_dict(rper),
        'run_feedback': [to_dict(x) for x in rfb],
        'llm_run_insights': to_dict(ins),
    }


async def get_run_metrics_public(run_id: str) -> Dict[str, Any]:
    """Sanitized, user-friendly metrics for public consumption.
    Returns only allowlisted, human-readable fields.
    """
    def friendly_label(k: str) -> str:
        return FRICTION_LABELS.get(k, (k or '').replace('_', ' ').title())

    def humanize_theme_label(raw: str) -> str:
        """Make LLM theme labels human friendly and UI‑consistent.
        - replace underscores/dashes with spaces
        - collapse whitespace and Title‑case
        - keep common acronyms readable (CTA, UI, API)
        """
        s = (raw or '')
        s = re.sub(r"[_\-]+", " ", s).strip()
        s = " ".join(s.split())
        # Title case for UI parity
        s = s.title()
        # Restore common acronyms
        s = re.sub(r"\bCta\b", "CTA", s)
        s = re.sub(r"\bUi\b", "UI", s)
        s = re.sub(r"\bApi\b", "API", s)
        return s

    def heuristic_for(k: str) -> str:
        return HEURISTIC_GROUP.get(k, 'General usability')

    if use_supabase_db():
        client = get_supabase()
        rr = client.table('runs').select('id').eq('id', run_id).limit(1).execute()
        if not (rr.data or []):
            raise HTTPException(status_code=404, detail='run not found')
        # Fetch run_dir for screen image lookup
        try:
            rpath = client.table('runs').select('run_dir').eq('id', run_id).limit(1).execute()
            run_dir_str = (rpath.data or [{}])[0].get('run_dir') or ''
        except Exception:
            run_dir_str = ''
        # Resolve run_path early for local artifact fallbacks
        run_path = pathlib.Path(run_dir_str) if run_dir_str else None
        if run_path and not run_path.is_absolute():
            run_path = RUNS / (run_dir_str or run_id)
        # Fetch project name for storage path prefix
        project_name = 'project'
        try:
            rproj = client.table('runs').select('project_id').eq('id', run_id).limit(1).execute()
            pid = (rproj.data or [{}])[0].get('project_id')
            if pid:
                pres = client.table('projects').select('name').eq('id', pid).limit(1).execute()
                if pres.data:
                    project_name = pres.data[0].get('name') or project_name
        except Exception:
            pass
        def one(tbl):
            try:
                r = client.table(tbl).select('*').eq('run_id', run_id).limit(1).execute()
                return (r.data or [None])[0]
            except Exception:
                return None
        def many(tbl, order=None, limit=None):
            try:
                q = client.table(tbl).select('*').eq('run_id', run_id)
                if order:
                    q = q.order(order[0], desc=(order[1].lower()=='desc'))
                if limit:
                    q = q.limit(limit)
                r = q.execute()
                return r.data or []
            except Exception:
                return []
        rm = one('run_metrics') or {}
        ins = one('llm_run_insights') or {}
        rper = one('run_persona') or {}
        rfb = many('run_feedback', order=('id','asc'))
        fps = many('friction_points')
        rres = many('run_results', order=('steps','asc'))

        personas_total = (rm.get('personas_total') if isinstance(rm.get('personas_total'), (int, float)) else (rper.get('extra') or {}).get('personas_total')) or 0
        completed_total = (rm.get('completed_total') if isinstance(rm.get('completed_total'), (int, float)) else (rper.get('extra') or {}).get('completed_total')) or 0
        completion_rate_pct = (rm.get('completion_rate_pct') if isinstance(rm.get('completion_rate_pct'), (int, float)) else (ins.get('goal_alignment_0_1') or 0.0) * 100.0)
        early_exit_pct = 100.0 - float(completion_rate_pct or 0.0)
        total_steps = rm.get('total_steps') or 0
        avg_steps = (float(total_steps) / float(personas_total or 1)) if personas_total else None
        ideal_steps = rm.get('shortest_path_steps')
        if not isinstance(ideal_steps, int):
            try:
                # Fallback: best observed completed path length
                completed = [int(x.get('steps') or 0) for x in (rres or []) if str(x.get('status') or '').lower() == 'completed' and int(x.get('steps') or 0) > 0]
                if completed:
                    ideal_steps = int(min(completed))
            except Exception:
                ideal_steps = None
        friction_index = rm.get('friction_index_severity')
        backtrack_rate = rm.get('backtrack_rate')
        hesitation = rm.get('avg_wait_per_step_sec')

        cat_map = {}
        if isinstance((ins or {}).get('friction_categories'), dict):
            cat_map = dict(ins.get('friction_categories'))
        total_friction = sum(int(v) for v in cat_map.values()) or 1
        issues = [
            {
                'key': k,
                'label': friendly_label(k),
                'heuristic': heuristic_for(k),
                'count': int(v),
                'sharePct': int(round(100.0 * (float(v) / float(total_friction or 1))))
            }
            for k, v in sorted(cat_map.items(), key=lambda kv: int(kv[1]), reverse=True)
        ][:6]

        # Helper: aggregate UX audit issues & recommendations directly from journey logs
        def _derive_ux_from_journeys(rp: pathlib.Path | None):
            try:
                if not rp:
                    return [], [], []
                tests_root = rp / 'tests'
                if not tests_root.exists():
                    return [], [], []
                # Attempt to read cached recommendations if available
                recs_cached: List[Dict[str, Any]] | None = None
                groups_cached: List[Dict[str, Any]] | None = None
                try:
                    derived_dir = rp / 'derived'
                    recs_path = derived_dir / 'recommendations.json'
                    groups_path = derived_dir / 'recommendations_by_screen.json'
                    if recs_path.exists():
                        recs_cached = json.loads(recs_path.read_text(encoding='utf-8'))
                    if groups_path.exists():
                        groups_cached = json.loads(groups_path.read_text(encoding='utf-8'))
                except Exception:
                    recs_cached = None
                    groups_cached = None
                
                # If both caches exist, return immediately (fast path)
                if recs_cached is not None and groups_cached is not None:
                    # Still need to derive issues for the overview
                    arr: List[Dict[str, Any]] = []
                    counts: Dict[str, int] = {}
                    sev_sum: Dict[str, float] = {}
                    sev_cnt: Dict[str, int] = {}
                    def persona_from_path(p: pathlib.Path) -> Optional[str]:
                        try:
                            m = re.search(r"persona_(\d+)", str(p))
                            return m.group(1) if m else None
                        except Exception:
                            return None
                    # Quick scan for issues only (skip recommendations processing)
                    for jpath in tests_root.rglob('journey.json'):
                        try:
                            data = json.loads(jpath.read_text(encoding='utf-8'))
                            for step in (data.get('journey') or []):
                                issues_arr = ((step.get('ux_audit') or {}).get('issues') or [])
                                for it in issues_arr:
                                    raw_label = str(it.get('heuristic') or it.get('problem_my_experience') or '').strip()
                                    if not raw_label:
                                        continue
                                    label = raw_label
                                    counts[label] = counts.get(label, 0) + 1
                                    try:
                                        s = float(it.get('severity_0_1') or 0.0)
                                    except Exception:
                                        s = 0.0
                                    s = max(0.0, min(1.0, s))
                                    sev_sum[label] = sev_sum.get(label, 0.0) + s
                                    sev_cnt[label] = sev_cnt.get(label, 0) + 1
                        except Exception:
                            continue
                    for jpath in tests_root.rglob('journey.jsonl'):
                        try:
                            lines = jpath.read_text(encoding='utf-8').splitlines()
                            for ln in lines:
                                if not ln.strip():
                                    continue
                                step = json.loads(ln)
                                issues_arr = ((step.get('ux_audit') or {}).get('issues') or [])
                                for it in issues_arr:
                                    raw_label = str(it.get('heuristic') or it.get('problem_my_experience') or '').strip()
                                    if not raw_label:
                                        continue
                                    label = raw_label
                                    counts[label] = counts.get(label, 0) + 1
                                    try:
                                        s = float(it.get('severity_0_1') or 0.0)
                                    except Exception:
                                        s = 0.0
                                    s = max(0.0, min(1.0, s))
                                    sev_sum[label] = sev_sum.get(label, 0.0) + s
                                    sev_cnt[label] = sev_cnt.get(label, 0) + 1
                        except Exception:
                            continue
                    # Build issues array
                    for label, cnt in sorted(counts.items(), key=lambda kv: kv[1], reverse=True):
                        avg_sev = (sev_sum.get(label, 0.0) / sev_cnt.get(label, 1)) if sev_cnt.get(label, 0) > 0 else 0.0
                        arr.append({
                            'label': label,
                            'count': cnt,
                            'avgSeverity': round(avg_sev, 3),
                        })
                    return arr[:6], recs_cached, groups_cached
                
                # Build screen_id(string)->file/image map from screen_nodes.json
                figma_to_file: Dict[str, str] = {}
                figma_to_name: Dict[str, str] = {}
                # Persona id -> persona name map from tests/persona_summary.json
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
                try:
                    nodes_path = rp / 'preprocess' / 'screen_nodes.json'
                    if nodes_path.exists():
                        nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
                        for n in (nodes or []):
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
                counts: Dict[str, int] = {}
                rec_counts: Dict[str, int] = {}
                rec_image: Dict[str, str] = {}
                # Grouped recommendations by screen
                per_screen_map: Dict[str, Dict[str, Any]] = {}
                sev_sum: Dict[str, float] = {}
                sev_cnt: Dict[str, int] = {}
                def persona_from_path(p: pathlib.Path) -> Optional[str]:
                    try:
                        m = re.search(r"persona_(\d+)", str(p))
                        return m.group(1) if m else None
                    except Exception:
                        return None
                # Support both json and jsonl
                for jpath in tests_root.rglob('journey.json'):
                    try:
                        data = json.loads(jpath.read_text(encoding='utf-8'))
                        pid = persona_from_path(jpath)
                        pname = persona_names.get(pid, (f"Persona {pid}" if pid else None))
                        for step in (data.get('journey') or []):
                            issues_arr = ((step.get('ux_audit') or {}).get('issues') or [])
                            for it in issues_arr:
                                raw_label = str(it.get('heuristic') or it.get('problem_my_experience') or '').strip()
                                if not raw_label:
                                    continue
                                label = raw_label
                                counts[label] = counts.get(label, 0) + 1
                                try:
                                    s = float(it.get('severity_0_1') or 0.0)
                                except Exception:
                                    s = 0.0
                                s = max(0.0, min(1.0, s))
                                sev_sum[label] = sev_sum.get(label, 0.0) + s
                                sev_cnt[label] = sev_cnt.get(label, 0) + 1
                                rec = str(it.get('recommendation_user_voice') or '').strip()
                                if rec:
                                    rec_counts[rec] = rec_counts.get(rec, 0) + 1
                                    if rec not in rec_image:
                                        sid = str(step.get('screen_id') or '')
                                        fn = figma_to_file.get(sid)
                                        if fn:
                                            rec_image[rec] = f"/runs-files/{(rp / 'preprocess' / 'screens' / fn).relative_to(RUNS)}" if RUNS else ''
                                    # per-screen grouping
                                    sid = str(step.get('screen_id') or '')
                                    if sid:
                                        g = per_screen_map.setdefault(sid, {
                                            'screenId': sid,
                                            'name': figma_to_name.get(sid) or f"Screen {sid}",
                                            'image': (f"/runs-files/{(rp / 'preprocess' / 'screens' / figma_to_file.get(sid)).relative_to(RUNS)}" if RUNS and figma_to_file.get(sid) else None),
                                            'items': {},
                                        })
                                        item = g['items'].setdefault(rec, { 'count': 0, 'persona_counts': {} })
                                        item['count'] = int(item.get('count', 0)) + 1
                                        if pname:
                                            pc = item.get('persona_counts') or {}
                                            try:
                                                pc[pname] = int(pc.get(pname, 0)) + 1
                                            except Exception:
                                                pc = {pname: 1}
                                            item['persona_counts'] = pc
                    except Exception:
                        continue
                for jpathl in tests_root.rglob('journey.jsonl'):
                    try:
                        pid = persona_from_path(jpathl)
                        pname = persona_names.get(pid, (f"Persona {pid}" if pid else None))
                        for line in jpathl.read_text(encoding='utf-8').splitlines():
                            try:
                                step = json.loads(line)
                            except Exception:
                                continue
                            issues_arr = ((step.get('ux_audit') or {}).get('issues') or [])
                            for it in issues_arr:
                                raw_label = str(it.get('heuristic') or it.get('problem_my_experience') or '').strip()
                                if not raw_label:
                                    continue
                                counts[raw_label] = counts.get(raw_label, 0) + 1
                                try:
                                    s = float(it.get('severity_0_1') or 0.0)
                                except Exception:
                                    s = 0.0
                                s = max(0.0, min(1.0, s))
                                sev_sum[raw_label] = sev_sum.get(raw_label, 0.0) + s
                                sev_cnt[raw_label] = sev_cnt.get(raw_label, 0) + 1
                                rec = str(it.get('recommendation_user_voice') or '').strip()
                                if rec:
                                    rec_counts[rec] = rec_counts.get(rec, 0) + 1
                                    if rec not in rec_image:
                                        sid = str(step.get('screen_id') or '')
                                        fn = figma_to_file.get(sid)
                                        if fn:
                                            rec_image[rec] = f"/runs-files/{(rp / 'preprocess' / 'screens' / fn).relative_to(RUNS)}" if RUNS else ''
                                    # per-screen grouping
                                    sid = str(step.get('screen_id') or '')
                                    if sid:
                                        g = per_screen_map.setdefault(sid, {
                                            'screenId': sid,
                                            'name': figma_to_name.get(sid) or f"Screen {sid}",
                                            'image': (f"/runs-files/{(rp / 'preprocess' / 'screens' / figma_to_file.get(sid)).relative_to(RUNS)}" if RUNS and figma_to_file.get(sid) else None),
                                            'items': {},
                                        })
                                        item = g['items'].setdefault(rec, { 'count': 0, 'persona_counts': {} })
                                        item['count'] = int(item.get('count', 0)) + 1
                                        if pname:
                                            pc = item.get('persona_counts') or {}
                                            try:
                                                pc[pname] = int(pc.get(pname, 0)) + 1
                                            except Exception:
                                                pc = {pname: 1}
                                            item['persona_counts'] = pc
                    except Exception:
                        continue
                arr = []
                total = 0
                for label, cnt in counts.items():
                    total += int(cnt)
                for label, cnt in counts.items():
                    avg = (sev_sum.get(label, 0.0) / float(max(1, sev_cnt.get(label, 0)))) if sev_cnt.get(label, 0) else 0.0
                    arr.append({
                        'key': label,
                        'label': label,
                        'heuristic': label,
                        'count': int(cnt),
                        'sharePct': int(round(100.0 * (float(cnt) / float(max(1, total))))),
                        'severity_1_5': int(max(1, min(5, round(1.0 + 4.0 * avg))))
                    })
                arr.sort(key=lambda x: int(x.get('count') or 0), reverse=True)
                # If cached recommendations exist, use them directly (already normalized); otherwise compute and write cache
                if isinstance(recs_cached, list):
                    # Use cached data as-is (already normalized during ingestion)
                    recs = recs_cached
                else:
                    recs = []
                    for k, v in sorted(rec_counts.items(), key=lambda kv: int(kv[1]), reverse=True)[:6]:
                        recs.append({ 'text': _normalize_recommendation_text(k), 'text_raw': k, 'count': int(v), 'image': rec_image.get(k) })
                # build grouped list
                groups: List[Dict[str, Any]] = []
                try:
                    if isinstance(groups_cached, list):
                        # Use cached grouped data as-is (already normalized during ingestion)
                        groups = groups_cached
                    else:
                        for sid, g in per_screen_map.items():
                            items_map: Dict[str, Any] = g.get('items') or {}
                            # Convert to list with persona names
                            conv: List[Dict[str, Any]] = []
                            for t, info in items_map.items():
                                # Robust count extraction without nested try/except
                                raw_count = 0
                                if isinstance(info, dict):
                                    try:
                                        raw_count = info.get('count') or 0
                                    except Exception:
                                        raw_count = 0
                                else:
                                    raw_count = info or 0
                                try:
                                    cnt = int(raw_count)
                                except Exception:
                                    cnt = 0
                                pc_map = (info or {}).get('persona_counts') or {}
                                try:
                                    personas = [k for k, _ in sorted(pc_map.items(), key=lambda kv: int(kv[1]), reverse=True)]
                                except Exception:
                                    personas = []
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
                except Exception:
                    groups = []
                # Write cache if we computed fresh results
                try:
                    if recs_cached is None or groups_cached is None:
                        derived_dir = rp / 'derived'
                        derived_dir.mkdir(parents=True, exist_ok=True)
                        if recs_cached is None:
                            (derived_dir / 'recommendations.json').write_text(json.dumps(recs, ensure_ascii=False, indent=2), encoding='utf-8')
                        if groups_cached is None:
                            (derived_dir / 'recommendations_by_screen.json').write_text(json.dumps(groups, ensure_ascii=False, indent=2), encoding='utf-8')
                except Exception:
                    pass
                return arr[:6], recs, groups
            except Exception:
                return [], [], []

        derived_issues: List[Dict[str, Any]] = []
        derived_recs: List[Dict[str, Any]] = []
        recs_by_screen: List[Dict[str, Any]] = []
        try:
            derived_issues, derived_recs, recs_by_screen = _derive_ux_from_journeys(run_path)
        except Exception:
            derived_issues, derived_recs, recs_by_screen = [], [], []

        if not issues and derived_issues:
            try:
                issues = derived_issues
            except Exception:
                pass

        summary = None
        for x in (rfb or []):
            if str(x.get('kind')).lower() == 'summary' and x.get('content'):
                summary = str(x.get('content'))
                break
        recommendations = (ins.get('recommendations') or {}).get('prioritized_actions') or []
        # Drop-off reasons (themes/backtrack/friction categories)
        drop_reasons: List[Dict[str, Any]] = []
        try:
            th = (ins.get('themes') or []) if isinstance(ins, dict) else []
            if isinstance(th, list) and th:
                drop_reasons = [
                    {
                        'label': humanize_theme_label(str(t.get('label') or '')),
                        'count': int(t.get('frequency') or 0),
                    }
                    for t in th
                ]
            elif isinstance(ins.get('backtrack_reasons') if isinstance(ins, dict) else {}, dict) and ins.get('backtrack_reasons'):
                br = dict(ins.get('backtrack_reasons'))
                drop_reasons = [
                    {'label': FRICTION_LABELS.get(k, k.replace('_',' ').title()), 'count': int(v or 0)}
                    for k, v in br.items()
                ]
            elif isinstance(ins.get('friction_categories') if isinstance(ins, dict) else {}, dict) and ins.get('friction_categories'):
                fc = dict(ins.get('friction_categories'))
                drop_reasons = [
                    {'label': FRICTION_LABELS.get(k, k.replace('_',' ').title()), 'count': int(v or 0)}
                    for k, v in fc.items()
                ]
        except Exception:
            drop_reasons = []
        drop_reasons = sorted(drop_reasons, key=lambda x: int(x.get('count') or 0), reverse=True)[:3]

        # Build problem screens with names/images from screen_nodes.json
        problem_screens: List[Dict[str, Any]] = []
        try:
            nodes_path = (run_path / 'preprocess' / 'screen_nodes.json') if run_path else None
            nodes = []
            if nodes_path and nodes_path.exists():
                try:
                    nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
                except Exception:
                    nodes = []
            id_to_node: Dict[str, Dict[str, Any]] = {}
            for n in (nodes or []):
                try:
                    nid = str(int(n.get('id')))
                    id_to_node[nid] = n
                except Exception:
                    pass
            # Load screen metrics map for enriched descriptions
            scr_metrics: Dict[str, Dict[str, Any]] = {}
            dwell_values: List[int] = []
            try:
                scr = client.table('run_screen_metrics').select('screen_id,dwell_time_ms,exits,enters').eq('run_id', run_id).limit(500).execute()
                for s in (scr.data or []):
                    sid = str(s.get('screen_id') or '')
                    if not sid:
                        continue
                    dm = int(s.get('dwell_time_ms') or 0)
                    scr_metrics[sid] = {
                        'dwellMs': dm,
                        'exits': int(s.get('exits') or 0),
                        'enters': int(s.get('enters') or 0),
                    }
                    dwell_values.append(dm)
            except Exception:
                scr_metrics = {}
                dwell_values = []

            def _median(vals: List[int]) -> float:
                try:
                    if not vals:
                        return 0.0
                    v = sorted(vals)
                    n = len(v)
                    return (v[n//2] if n % 2 == 1 else (v[n//2-1] + v[n//2]) / 2.0)
                except Exception:
                    return 0.0

            dwell_med = _median(dwell_values)

            def enrich_desc(sid: str, base_desc: Optional[str]) -> str:
                """Compose a short, natural language summary (~30–35 words).
                Uses dwell vs median, exits/enters and component signals when available.
                """
                row = scr_metrics.get(sid) or {}
                exits = int(row.get('exits') or 0)
                enters = int(row.get('enters') or 0)
                dwell_ms = int(row.get('dwellMs') or 0)
                # Base sentiment
                base = (base_desc or '').strip()
                if not base or base.lower().startswith('users encountered friction'):
                    base = 'People hesitate and feel uncertain on this screen'
                # Evidence snippets
                evid: List[str] = []
                try:
                    if dwell_med > 0 and dwell_ms >= 1.5 * dwell_med:
                        evid.append(f"dwell time is high ({dwell_ms}ms vs ~{int(dwell_med)}ms median)")
                except Exception:
                    pass
                if enters > 0 and exits > 0:
                    try:
                        rate = int(round(100.0 * (float(exits) / float(max(1, enters)))))
                        if rate > 0:
                            evid.append(f"about {rate}% exit here")
                    except Exception:
                        pass
                elif exits > 0:
                    evid.append(f"exits observed ×{exits}")
                # Component signals
                comp = (comp_by_sid.get(sid) or {}) if 'comp_by_sid' in locals() else {}
                try:
                    if float(comp.get('backtracks') or 0) > 0:
                        evid.append('back/close actions suggest doubt')
                    if float(comp.get('auto_wait') or 0) > 0:
                        evid.append('people expect auto‑advance')
                    if float(comp.get('loops') or 0) > 0:
                        evid.append('looping between screens occurs')
                except Exception:
                    pass
                # Compose paragraph
                details = ''
                if evid:
                    details = '; '.join(evid)
                text = f"{base}. {details}. Clarify the next step with a prominent primary action and reduce dead ends so people proceed confidently."
                # Trim to ~30–35 words
                words = text.split()
                if len(words) > 36:
                    words = words[:36]
                    if words[-1].endswith(','):
                        words[-1] = words[-1].rstrip(',')
                    text = ' '.join(words).rstrip('.') + '.'
                return text

            # Prefer algorithmic scores if available
            try:
                rsps = client.table('run_screen_problem_scores').select('*').eq('run_id', run_id).order('score', desc=True).limit(5).execute()
            except Exception:
                rsps = type('X', (), {'data': []})
            comp_by_sid: Dict[str, Dict[str, Any]] = {}
            try:
                for r in (rsps.data or []):
                    sid = str(r.get('screen_id') or '')
                    if sid:
                        comp_by_sid[sid] = (r.get('components') or {})
            except Exception:
                comp_by_sid = {}

            # Aggregate severity by screen and keep per-screen lists for descriptions
            sev_map: Dict[str, int] = {}
            fps_by_sid: Dict[str, List[Dict[str, Any]]] = {}
            for fp in (fps or []):
                sid = str(fp.get('screen_id') or '')
                if not sid:
                    continue
                sev = int(fp.get('severity') or 1)
                sev_map[sid] = sev_map.get(sid, 0) + max(1, min(5, sev))
                fps_by_sid.setdefault(sid, []).append(fp)
            # Fallback to dropoff screen if no frictions
            if not sev_map and rm.get('dropoff_screen_id'):
                sev_map[str(rm.get('dropoff_screen_id'))] = 1
            # Build items sorted by score (prefer rsps) with robust fallbacks
            if rsps.data:
                items: List[Tuple[str, int]] = [(str(r.get('screen_id')), int(float(r.get('score') or 0))) for r in (rsps.data or [])]
            elif sev_map:
                items = sorted(sev_map.items(), key=lambda kv: kv[1], reverse=True)[:5]
            else:
                # No explicit frictions: fall back to top dwell/exits from screen metrics
                try:
                    sm = client.table('run_screen_metrics').select('screen_id,dwell_time_ms,exits').eq('run_id', run_id).order('dwell_time_ms', desc=True).limit(5).execute()
                    items = [(str(s.get('screen_id')), int(s.get('dwell_time_ms') or 0) + int(s.get('exits') or 0)*1000) for s in (sm.data or [])]
                except Exception:
                    items = []
            def best_problem(sid: str) -> Tuple[Optional[str], Optional[str]]:
                arr = fps_by_sid.get(sid) or []
                if not arr:
                    # Attempt to derive from algorithmic components
                    comp = comp_by_sid.get(sid) or {}
                    if comp:
                        try:
                            d = float(comp.get('dropoffs') or 0.0)
                        except Exception:
                            d = 0.0
                        try:
                            b = float(comp.get('backtracks') or 0.0)
                        except Exception:
                            b = 0.0
                        try:
                            a = float(comp.get('auto_wait') or 0.0)
                        except Exception:
                            a = 0.0
                        try:
                            l = float(comp.get('loops') or 0.0)
                        except Exception:
                            l = 0.0
                        try:
                            dz = float(comp.get('dwell_z') or 0.0)
                        except Exception:
                            dz = 0.0
                        # choose the dominant signal
                        key = None
                        val = 0.0
                        for k, v in [('dropoff', d), ('back_or_close', b), ('auto_wait', a), ('loop_detected', l)]:
                            if v > val:
                                key, val = k, v
                        # craft a natural-language description
                        if key is None and dz > 1.0:
                            key, val = 'auto_wait', a
                        if key:
                            pct = int(round((val or 0.0) * 100))
                            if key == 'dropoff':
                                details = f"Users often exit from this screen ({pct}% of visits)."
                            elif key == 'back_or_close':
                                details = f"Users hit back/close on this screen in about {pct}% of visits."
                            elif key == 'auto_wait':
                                if dz > 0.8:
                                    details = f"Users hesitate here (≈{pct}% of visits) with longer‑than‑typical dwell (z≈{dz:.1f})."
                                else:
                                    details = f"Users hesitate here (≈{pct}% of visits)."
                            elif key == 'loop_detected':
                                details = f"Users loop between screens from here in ~{pct}% of visits."
                            else:
                                details = None
                            if details:
                                return details, key
                    return None, None
                # Pick highest severity, then first
                arr.sort(key=lambda x: int(x.get('severity') or 0), reverse=True)
                top = arr[0]
                details = str(top.get('details') or '').strip()
                cat = str(top.get('category') or '')
                if details:
                    return details, cat
                return FRICTION_LABELS.get(cat, (cat or '').replace('_', ' ').title()), cat

            def humanize_problem(cat: Optional[str], raw: Optional[str]) -> str:
                key = (cat or '').lower()
                # Opinionated, concise, 2-sentence guidance
                if key in ('dropoff','drop_off'):
                    return (
                        'Users frequently exit here, indicating a drop‑off point. '
                        'Make the next step clear and lower the cost of trying.'
                    )
                if key == 'back_or_close':
                    return (
                        'Users tried to go back or close this screen, suggesting doubt or confusion. '
                        'Clarify the next step and reduce commitment anxiety with clear copy.'
                    )
                if key == 'auto_wait':
                    return (
                        'Users paused here waiting for the UI to advance, which reads as uncertainty. '
                        'Add visible progress cues or a clear primary action to proceed.'
                    )
                if key == 'unclear_primary_cta_persona':
                    return (
                        "The primary action isn't obvious at a glance. "
                        'Emphasize the main button and de-emphasize secondary options.'
                    )
                if key == 'loop_detected':
                    return (
                        'Users looped between screens without making progress. '
                        'Offer a direct path forward and prevent dead‑end navigation.'
                    )
                if key == 'too_many_steps_persona':
                    return (
                        'Observed paths are longer than the ideal shortest path. '
                        'Provide a more direct route or combine steps to reduce effort.'
                    )
                # Fallback: turn any label or detail into a sentence
                base = (raw or '').strip()
                if not base:
                    return 'Users encountered friction here. Provide a clearer next step.'
                # Ensure sentence casing and final period
                try:
                    s = base[0].upper() + base[1:]
                except Exception:
                    s = base
                if not s.endswith(('.', '!', '?')):
                    s = s + '.'
                return s

            for sid, score in items:
                node = id_to_node.get(sid)
                name = (node or {}).get('name') or f"Screen #{sid}"
                # Prefer explicit problem detail; otherwise use drop-off/friction theme; finally fallback to screen description
                desc_text, desc_cat = best_problem(sid)
                desc = humanize_problem(desc_cat, desc_text)
                desc = enrich_desc(sid, desc)
                if not desc:
                    try:
                        if str(sid) == str(rm.get('dropoff_screen_id')):
                            desc = 'Users frequently exit here, indicating a drop‑off point. Make the next step clear and lower the cost of trying.'
                        elif isinstance((ins or {}).get('friction_categories'), dict) and (ins.get('friction_categories') or {}):
                            # Pick top friction category overall and use friendly label
                            k, _ = sorted(((k, int(v)) for k, v in (ins.get('friction_categories') or {}).items()), key=lambda kv: kv[1], reverse=True)[0]
                            desc = humanize_problem(k, FRICTION_LABELS.get(k, (k or '').replace('_',' ').title()))
                    except Exception:
                        pass
                if not desc:
                    # Final fallback to screen description in sentence form
                    fallback = (node or {}).get('description') or ''
                    desc = humanize_problem(None, fallback)

                # Build problems list for this screen (top 3 by severity)
                problems: List[Dict[str, Any]] = []
                try:
                    arr = sorted((fps_by_sid.get(sid) or []), key=lambda x: int(x.get('severity') or 0), reverse=True)[:3]
                    for fp in arr:
                        cat_k = str(fp.get('category') or '')
                        problems.append({
                            'category': cat_k,
                            'label': FRICTION_LABELS.get(cat_k, (cat_k or '').replace('_', ' ').title()),
                            'description': str(fp.get('details') or '').strip() or FRICTION_LABELS.get(cat_k, (cat_k or '').replace('_', ' ').title()),
                            'severity': int(fp.get('severity') or 1),
                        })
                    # If no explicit friction points available, derive a short list from components
                    if not problems:
                        comp = comp_by_sid.get(sid) or {}
                        for cat_k, v in [('dropoff', comp.get('dropoffs')), ('back_or_close', comp.get('backtracks')), ('auto_wait', comp.get('auto_wait')), ('loop_detected', comp.get('loops'))]:
                            try:
                                if float(v or 0) > 0:
                                    problems.append({
                                        'category': cat_k,
                                        'label': FRICTION_LABELS.get(cat_k, (cat_k or '').replace('_', ' ').title()),
                                        'description': FRICTION_LABELS.get(cat_k, (cat_k or '').replace('_', ' ').title()),
                                        'severity': 1,
                                    })
                            except Exception:
                                continue
                except Exception:
                    problems = []

                file_name = (node or {}).get('file')
                img_url = None
                if file_name and run_path:
                    p = run_path / 'preprocess' / 'screens' / str(file_name)
                    if p.exists():
                        try:
                            # Prefer Supabase signed URL; fallback to local runs-files
                            proj_slug = slugify(project_name)
                            storage_path = f"{proj_slug}/runs/{run_id}/preprocess/screens/{file_name}"
                            supa_url = upload_file_to_supabase(p, storage_path)
                            if supa_url:
                                img_url = supa_url
                            else:
                                rel = p.relative_to(RUNS)
                                img_url = f"/runs-files/{rel}"
                        except Exception:
                            try:
                                rel = p.relative_to(RUNS)
                                img_url = f"/runs-files/{rel}"
                            except Exception:
                                img_url = None
                problem_screens.append({
                    'screenId': sid,
                    'name': name,
                    'description': desc,
                    'image': img_url,
                    'score': int(score),
                    'problems': problems,
                })
        except Exception:
            problem_screens = []

        # Build audit rows/details using available data (screen_metrics + friction_points)
        audit_rows: List[Dict[str, Any]] = []
        try:
            # Map screen_id -> basic stats
            smap: Dict[str, Dict[str, Any]] = {}
            try:
                screens = client.table('run_screen_metrics').select('*').eq('run_id', run_id).limit(500).execute()
                for s in (screens.data or []):
                    sid = str(s.get('screen_id') or '')
                    if not sid:
                        continue
                    smap[sid] = {
                        'screenId': sid,
                        'enters': int(s.get('enters') or 0),
                        'exits': int(s.get('exits') or 0),
                        'dwellMs': int(s.get('dwell_time_ms') or 0),
                        'severity': {'S1':0,'S2':0,'S3':0,'S4':0,'S5':0},
                        'categories': {},
                    }
            except Exception:
                smap = {}
            for fp in (fps or []):
                sid = str(fp.get('screen_id') or '')
                if not sid:
                    continue
                row = smap.setdefault(sid, {'screenId': sid, 'enters':0,'exits':0,'dwellMs':0,'severity':{'S1':0,'S2':0,'S3':0,'S4':0,'S5':0}, 'categories': {}})
                sev = int(fp.get('severity') or 1)
                key = f"S{max(1,min(5,sev))}"
                row['severity'][key] = int(row['severity'].get(key, 0)) + 1
                cat = str(fp.get('category') or '')
                row['categories'][cat] = int(row['categories'].get(cat, 0)) + 1
            # Enrich with names/images
            for sid, row in smap.items():
                n = id_to_node.get(sid)
                row['name'] = (n or {}).get('name') or f"Screen #{sid}"
                file_name = (n or {}).get('file')
                img_url = None
                if run_path and file_name:
                    p = run_path / 'preprocess' / 'screens' / str(file_name)
                    if p.exists():
                        try:
                            proj_slug = slugify(project_name)
                            storage_path = f"{proj_slug}/runs/{run_id}/preprocess/screens/{file_name}"
                            img_url = upload_file_to_supabase(p, storage_path) or None
                        except Exception:
                            img_url = None
                        if not img_url:
                            try:
                                img_url = f"/runs-files/{p.relative_to(RUNS)}"
                            except Exception:
                                img_url = None
                row['image'] = img_url
                audit_rows.append(row)
            # Sort by combined severity then dwell
            audit_rows.sort(key=lambda r: (sum(int(v or 0) for v in r.get('severity',{}).values()), int(r.get('dwellMs') or 0)), reverse=True)
        except Exception:
            audit_rows = []

        # Build recent signals stream (last N friction points)
        audit_signals: List[Dict[str, Any]] = []
        try:
            recent = sorted((fps or []), key=lambda x: str(x.get('created_at') or ''))[-20:]
            for fp in recent:
                sid = str(fp.get('screen_id') or '')
                n = id_to_node.get(sid)
                audit_signals.append({
                    'screenId': sid,
                    'screen': (n or {}).get('name') or f"Screen #{sid}",
                    'category': str(fp.get('category') or ''),
                    'severity': int(fp.get('severity') or 1),
                    'details': str(fp.get('details') or ''),
                    'at': str(fp.get('created_at') or ''),
                })
        except Exception:
            audit_signals = []

        return {
            'run_id': run_id,
            'headline': {
                'completionRatePct': (float(completion_rate_pct) if completion_rate_pct is not None else None),
                'earlyExitPct': float(early_exit_pct),
                'avgSteps': (float(avg_steps) if avg_steps is not None else None),
                'idealSteps': (int(ideal_steps) if isinstance(ideal_steps, int) else None),
                'frictionIndex': (float(friction_index) if friction_index is not None else None),
                'backtrackRate': (float(backtrack_rate) if backtrack_rate is not None else None),
                'hesitationSecPerStep': (float(hesitation) if hesitation is not None else None),
            },
            'issues': issues,
            'mostProblematicScreen': ('A screen with frequent exits' if rm.get('dropoff_screen_id') else None),
            'problemScreens': problem_screens,
            'dropoffReasons': drop_reasons,
            'summary': summary,
            'recommendations': recommendations,
            'derived_ux_issues': derived_issues,
            'derived_recommendations': derived_recs,
            'recommendations_by_screen': recs_by_screen,
        }
    # Fallback for direct DB: reuse internal endpoint and sanitize client-side if needed
    data = await get_run_metrics(run_id)
    ins = data.get('llm_run_insights') or {}
    rper = data.get('run_persona') or {}
    rm = data.get('run_metrics') or {}
    rfb = data.get('run_feedback') or []
    # Try to query run_results directly if available (DB path)
    try:
        rows = await fetch('select status, steps from run_results where run_id=$1 order by steps asc', run_id)
    except Exception:
        rows = []
    personas_total = (rm.get('personas_total') if isinstance(rm.get('personas_total'), (int, float)) else (rper.get('extra') or {}).get('personas_total')) or 0
    completed_total = (rm.get('completed_total') if isinstance(rm.get('completed_total'), (int, float)) else (rper.get('extra') or {}).get('completed_total')) or 0
    completion_rate_pct = (rm.get('completion_rate_pct') if isinstance(rm.get('completion_rate_pct'), (int, float)) else (ins.get('goal_alignment_0_1') or 0.0) * 100.0)
    early_exit_pct = 100.0 - float(completion_rate_pct or 0.0)
    total_steps = rm.get('total_steps') or 0
    avg_steps = (float(total_steps) / float(personas_total or 1)) if personas_total else None
    ideal_steps = rm.get('shortest_path_steps')
    if not isinstance(ideal_steps, int):
        try:
            completed = [int(r['steps']) for r in (rows or []) if str(r.get('status') or r['status']).lower() == 'completed' and int(r.get('steps') or r['steps'] or 0) > 0]
            if completed:
                ideal_steps = int(min(completed))
        except Exception:
            ideal_steps = None
    friction_index = rm.get('friction_index_severity')
    backtrack_rate = rm.get('backtrack_rate')
    hesitation = rm.get('avg_wait_per_step_sec')
    cat_map = dict((ins.get('friction_categories') or {}))
    total_friction = sum(int(v) for v in cat_map.values()) or 1
    issues = [
        {
            'key': k,
            'label': friendly_label(k),
            'heuristic': heuristic_for(k),
            'count': int(v),
            'sharePct': int(round(100.0 * (float(v) / float(total_friction or 1))))
        }
        for k, v in sorted(cat_map.items(), key=lambda kv: int(kv[1]), reverse=True)
    ][:6]
    summary = None
    for x in (rfb or []):
        if str(x.get('kind')).lower() == 'summary' and x.get('content'):
            summary = str(x.get('content'))
            break
    recommendations = (ins.get('recommendations') or {}).get('prioritized_actions') or []
    # Drop-off reasons builder for direct DB path
    def build_reasons() -> List[Dict[str, Any]]:
        try:
            th = (ins.get('themes') or []) if isinstance(ins, dict) else []
            if isinstance(th, list) and th:
                return [ {'label': str(t.get('label') or ''), 'count': int(t.get('frequency') or 0)} for t in th ]
            br = dict(ins.get('backtrack_reasons') or {}) if isinstance(ins, dict) else {}
            if br:
                return [ {'label': FRICTION_LABELS.get(k, k.replace('_',' ').title()), 'count': int(v or 0)} for k, v in br.items() ]
            fc = dict(ins.get('friction_categories') or {}) if isinstance(ins, dict) else {}
            if fc:
                return [ {'label': FRICTION_LABELS.get(k, k.replace('_',' ').title()), 'count': int(v or 0)} for k, v in fc.items() ]
        except Exception:
            return []
        return []
    drop_reasons = sorted(build_reasons(), key=lambda x: int(x.get('count') or 0), reverse=True)[:3]

    # Build problem screens (direct DB path)
    problem_screens: List[Dict[str, Any]] = []
    try:
        run_dir_row = await fetchrow('select run_dir from runs where id=$1', run_id)
        run_dir_str = run_dir_row['run_dir'] if run_dir_row else None
        run_path = pathlib.Path(run_dir_str) if run_dir_str else None
        if run_path and not run_path.is_absolute():
            run_path = RUNS / (run_dir_str or run_id)
        # Resolve project name for storage URLs (if needed)
        proj_name = 'project'
        try:
            proj_row = await fetchrow('select project_id from runs where id=$1', run_id)
            pid = proj_row['project_id'] if proj_row else None
            if pid:
                name_row = await fetchrow('select name from projects where id=$1', pid)
                if name_row and name_row.get('name'):
                    proj_name = name_row['name']
        except Exception:
            pass
        nodes_path = (run_path / 'preprocess' / 'screen_nodes.json') if run_path else None
        nodes = []
        if nodes_path and nodes_path.exists():
            try:
                nodes = json.loads(nodes_path.read_text(encoding='utf-8'))
            except Exception:
                nodes = []
        id_to_node: Dict[str, Dict[str, Any]] = {}
        for n in (nodes or []):
            try:
                nid = str(int(n.get('id')))
                id_to_node[nid] = n
            except Exception:
                pass
        sev_map: Dict[str, int] = {}
        for fp in (data.get('friction_points') or []):
            try:
                sid = str(fp.get('screen_id') or '')
                if not sid:
                    continue
                sev = int(fp.get('severity') or 1)
                sev_map[sid] = sev_map.get(sid, 0) + max(1, min(5, sev))
            except Exception:
                pass
        if not sev_map and rm.get('dropoff_screen_id'):
            sev_map[str(rm.get('dropoff_screen_id'))] = 1
        items: List[Tuple[str, int]] = sorted(sev_map.items(), key=lambda kv: kv[1], reverse=True)[:5]
        for sid, score in items:
            node = id_to_node.get(sid)
            name = (node or {}).get('name') or f"Screen #{sid}"
            desc = (node or {}).get('description') or ''
            file_name = (node or {}).get('file')
            img_url = None
            if file_name and run_path:
                p = run_path / 'preprocess' / 'screens' / str(file_name)
                if p.exists():
                    try:
                        # Prefer Supabase signed URL; fallback to local runs-files
                        proj_slug = slugify(proj_name)
                        storage_path = f"{proj_slug}/runs/{run_id}/preprocess/screens/{file_name}"
                        supa_url = upload_file_to_supabase(p, storage_path)
                        if supa_url:
                            img_url = supa_url
                        else:
                            rel = p.relative_to(RUNS)
                            img_url = f"/runs-files/{rel}"
                    except Exception:
                        try:
                            rel = p.relative_to(RUNS)
                            img_url = f"/runs-files/{rel}"
                        except Exception:
                            img_url = None
            problem_screens.append({'screenId': sid, 'name': name, 'description': desc, 'image': img_url, 'score': int(score)})
    except Exception:
        problem_screens = []

    return {
        'run_id': run_id,
        'headline': {
            'completionRatePct': (float(completion_rate_pct) if completion_rate_pct is not None else None),
            'earlyExitPct': float(early_exit_pct),
            'avgSteps': (float(avg_steps) if avg_steps is not None else None),
            'idealSteps': (int(ideal_steps) if isinstance(ideal_steps, int) else None),
            'frictionIndex': (float(friction_index) if friction_index is not None else None),
            'backtrackRate': (float(backtrack_rate) if backtrack_rate is not None else None),
            'hesitationSecPerStep': (float(hesitation) if hesitation is not None else None),
        },
        'issues': issues,
        'mostProblematicScreen': ('A screen with frequent exits' if rm.get('dropoff_screen_id') else None),
        'problemScreens': problem_screens,
            'audit': {
                'rows': audit_rows,
                'signals': audit_signals,
            },
        'dropoffReasons': drop_reasons,
        'summary': summary,
        'recommendations': recommendations,
    }
