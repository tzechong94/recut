# Recut — project guide for Claude

Guided short-video studio: borrow a reel's format, tell your story. Read this before
touching code. Full design in `ARCHITECTURE.md`; decisions in `ASSUMPTIONS.md`.

## Layout
```
web/                      React + Vite + TS editor (built from recut-prototype.html)
backend/recut/
  core/      schemas (Recipe, Timeline), caption geometry, config, models(iface+stubs),
             storage(iface), queue(Postgres), db (SQLAlchemy), repo, timeline_ops
  pipeline/  analyse, draft_script, generate_*, render(ffmpeg), caption_ass, music sync
  api/       FastAPI app + routers (projects/assets/recipes/timelines/jobs/analyse/agent/generation)
  worker/    queue loop + handler registry (handlers/render.py, handlers/generate.py)
  mcp/       MCP server exposing pipeline ops as tools
shared/caption-style.json   anti-drift keystone (web + python both read this)
eval/        recipe-quality + token-budget + time-to-first-cut harness
```

## The two contracts everything depends on (do not break)
1. **`recut.core.schemas.Recipe` / `Timeline`** — the canonical documents. The timeline
   is the single source of truth read by both preview and export. Validate every write
   through these models.
2. **`shared/caption-style.json`** — caption geometry. The React preview and the Python
   render BOTH derive positions from it. Invariant `canvas_px == preview_px * scale_factor`
   is pinned by `tests/test_caption_parity.py` and `web` mirror test. Never hardcode
   caption sizes/positions elsewhere.

## How to extend (per lane)
- **New job type:** write `recut/worker/handlers/<x>.py`, decorate with
  `@register("<type>")`, import it in `worker/handlers/__init__.py`. Enqueue via
  `recut.core.queue.enqueue`.
- **New API endpoints:** add `recut/api/routers/<x>.py` exporting `router`. Spine routers
  are always mounted; `analyse`, `agent`, `generation` are auto-mounted if present
  (see `api/main.py`). Don't edit other routers.
- **New model call:** go through `recut.core.models` interfaces; add a stub + the real
  DashScope impl in `core/qwen_clients.py`. Never call DashScope directly elsewhere.
- **Timeline edits:** use `recut.core.timeline_ops` (it keeps the token ledger honest).

## Invariants
- Generation is gap-fill only, async, **kept slots only**, token-capped
  (`settings.project_token_cap`). Use `timeline_ops.slots_to_generate`.
- No model failure may produce a blank frame or a 500. Every gap → stand-in or last-good
  value. Recipes always return (deterministic fallback on analysis failure).
- v1 slot types only: text, talk, roll, broll. face/illus reserved but gated off.
- IP-safety: recipes are structure-only; upload-first; no bundled copyrighted audio.

## Testing
- `cd backend && . .venv/bin/activate && python -m pytest -q`
- TDD: write the test first. Tests run offline (SQLite + local storage + stub models).
- ffmpeg-gated tests skip cleanly without ffmpeg; keep them that way.
- Web: `cd web && npm test` (Vitest). Mirror the caption-parity test there.

## Run locally
- `docker compose up` (Postgres + MinIO + api + worker), or run pieces directly:
  `recut-api`, `recut-worker`, `recut-mcp`. Frontend: `cd web && npm run dev`.
- Stub models need no keys. For real Qwen: set `RECUT_MODEL_BACKEND=qwen` +
  `RECUT_DASHSCOPE_API_KEY` in `.env`.

## Style
- Python: typed, pydantic v2, explicit over clever, named exceptions (no bare
  `except Exception` except top-level worker boundary). Keep diffs minimal.
- Comments: ASCII diagrams for pipelines/state machines. Keep them accurate.
