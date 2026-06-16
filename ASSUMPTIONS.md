# Assumptions & Decisions Log

Running log of decisions made while building Recut. Newest first.

## Locked from the brief
- Single tenant for the demo. No auth/signup. Data model stays clean (every query is
  trivially scopeable by a future `tenant_id`) so multi-tenant is a later add.
- Reference ingestion: **upload-first**. Link-fetch is best-effort, isolated behind an
  adapter, not used in the demo.
- Audio: voiceover + optional royalty-free bed. No bundled copyrighted trending sounds;
  the creator adds the platform's trending sound in-app after export.
- Generation is **deferred, async, gap-fill only**, and runs **only for kept slots**.
  The base cut is instant with stand-ins.
- v1 slot types: text card, talking head, camera roll, generated b-roll. Illustration
  dropped; generated face + voice cloning are consent-gated, post-v1. (Enum values are
  reserved in `schemas.py` but coerced to v1 types on recipe ingest.)

## CEO review (full scope expansion) — accepted into scope
1. **Provenance / IP-safety + token-meter panel** — on-screen, makes the headline
   metric and the "structure-only, your footage is the spine" thesis visible.
2. **Agent-driven beat refine + add-slot via MCP** — wires the prototype's Refine /
   "describe it for the agent" buttons to real MCP tools.
3. **Recipe library** — save & reuse extracted recipes (`recipes.saved` flag + library
   endpoints).
4. **Music beat-sync** — slots snapped to the audio bed's grid. **Isolated and
   toggleable**: writes a separate timeline version; off = zero effect on the core cut.
   Flagged as the highest deadline risk; built so it can never threaten the demo.
5. **Direct text editing of script beats** — the creator types over any beat line, not
   only AI refine.

## CTO / eng review — architecture locks
- **Canonical timeline = one JSONB document, versioned.** Both preview and export read
  it. Not normalized into slot rows (avoids drift, fewer joins).
- **Anti-drift keystone:** `shared/caption-style.json` is the single source of truth for
  caption geometry. React preview reads it directly; Python render generates ASS from
  the same numbers. Pinned by the caption-parity test (`canvas_px == preview_px * 4`).
- **Job queue = Postgres-backed** (`jobs` table + `FOR UPDATE SKIP LOCKED`). No Redis /
  RocketMQ locally; one fewer container. Behind a module boundary so Alibaba can swap to
  RocketMQ as a config change. Degrades to a guarded UPDATE on SQLite for offline tests.
- **Render = ffmpeg concat + ASS subtitles**, per-slot clips cached by content hash for
  resumability. PNG-overlay path kept as a fallback for styles ASS can't express.
- **Model layer behind interfaces** (`core/models.py`) with high-fidelity deterministic
  stubs (default). Real DashScope clients (`core/qwen_clients.py`) swap in via
  `RECUT_MODEL_BACKEND=qwen` — a config flip, not a rewrite.
- **Build order:** spine-first (schemas + caption spec + storage/queue/model interfaces +
  export skeleton that renders a real MP4), then parallel lanes against frozen contracts.

## Engineering choices not in the brief
- One Python package (`backend/recut`) with four entrypoints (api, worker, mcp, eval)
  instead of separate packages — fewer venvs, one schema source.
- DB schema created via `Base.metadata.create_all` for the demo (Alembic dir scaffolded
  for prod migrations later). Single-tenant + JSON documents make this safe.
- Tests run fully offline: SQLite + local filesystem storage + stub models. ffmpeg-gated
  integration tests skip cleanly when ffmpeg is absent.
- `GET /api/assets/{id}/raw` streams bytes so the browser can load media in local dev
  without a public MinIO URL.

## Open / deferred (see TODOS.md)
- Teleprompter in-browser capture for talking-head slots (upload-only for v1).
- Link-fetch ingestion adapter (upload-first for the demo).
- Real Alembic migrations (currently create_all).
