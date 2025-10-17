# design-agent-simulator

## Quick Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env  # add FIGMA_TOKEN and optionally MODEL_NAME

# For the UI (optional)
cd ui
cp env.example .env.local  # configure frontend settings
cd ..
```

## Registration Control

By default, user registration is **disabled**. To enable public registration:

**Backend:** Set in `.env`:
```bash
ENABLE_REGISTRATION=true
```

**Frontend:** Set in `ui/.env.local`:
```bash
NEXT_PUBLIC_ENABLE_REGISTRATION=true
```

When registration is disabled:
- The "Register" button is hidden from the login page
- The `/signup` route redirects to `/login`
- The backend API rejects signup requests with 403 Forbidden
- New users must be created manually via database or admin tools

## New Run Layout (parallel-safe)

Each job is isolated under `runs/<run_id>/`:
- `preprocess/`: screens, `screen_nodes.json`, `prototype_links*.json/csv`, `annotated/`, `graphs/`
- `tests/`: per-persona simulations `tests/persona_<id>/simulations/<ts>/...` and `tests/persona_summary.{json,csv}`
- `meta.json`, `.cache/`, `.lock`

Old folders under `runs/` older than 3 days are automatically purged on start of each run.

## One-step Preprocess (full pipeline)

Exports screens → generates screen nodes → extracts links → enriches links → adds linkIds → annotates → graph (PNG+PDF).

```bash
python scripts/run_one_step_extraction.py \
  --page "Arrows 2 - Interaction" \
  --figma-url "https://www.figma.com/design/<file>" \
  --out-dir arrows2_$(date +%s) \
  --verbose
```

Outputs under `runs/<run_id>/preprocess/`.

## Post-test: Run all personas in-place (goal-directed traversal)

```bash
python scripts/run_persona_inplace.py \
  --run-dir runs/<run_id> \
  --source-id 15 \
  --target-id 9 \
  --goal "Place an order and reach confirmation" \
  --max-minutes 2
```

- Results per persona under `runs/<run_id>/tests/persona_<id>/simulations/<ts>/`.
- Aggregates written to `runs/<run_id>/tests/persona_summary.{json,csv}`.

## Image-based start/target (optional)

Instead of IDs, you can provide reference screenshots:

```bash
python scripts/simulate_user_traversal.py \
  --run-dir runs/<run_id> \
  --source-image /absolute/path/to/source.png \
  --target-image /absolute/path/to/target.png \
  --goal "Reach confirmation" \
  --persona-folder-name tests/persona_1 \
  --max-minutes 2
```

The simulator matches images to `preprocess/screens/` using an average-hash.

## Notes
- `FIGMA_TOKEN` must be set in `.env` for Figma API.
- The pipeline is domain-agnostic (generic CTA/goal logic).
- All outputs are written inside the provided `--run-dir` to enable safe parallel runs.
