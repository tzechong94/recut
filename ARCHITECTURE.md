# Recut Architecture

**Borrow the format, tell your story.** Recut analyses one reel into a reusable *recipe*
(beats, pacing, on-screen-text rhythm — never the content), co-writes the creator's story
onto those beats, generates a base cut that plays instantly with stand-ins, and lets the
creator swap in real footage, restyle, pick a cover, and export. Generation is gap-fill
only; the creator's footage is the spine.

## System diagram

```
                              ┌───────────────────────────────────────────┐
                              │  React + Vite editor (web/)                 │
                              │  projects → Reference → Recipe → Script →   │
                              │  Storyboard → Cover                         │
                              │  live preview player (reads timeline +      │
                              │  shared/caption-style.json)                 │
                              └───────────────┬─────────────────────────────┘
                                              │ REST / SSE
                                              ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │  FastAPI (recut.api)                                              │
        │  projects · assets · recipes · timelines · jobs · analyse ·       │
        │  agent · generation                                              │
        └───┬───────────────┬───────────────┬───────────────┬─────────────┘
            │               │               │ enqueue       │ calls
            ▼               ▼               ▼               ▼
      ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────────┐
      │ Postgres │   │ OSS / MinIO│   │  jobs    │   │ MCP server   │
      │ projects │   │ all media  │   │ (queue,  │   │ (recut.mcp)  │
      │ assets   │   │            │   │  SKIP    │   │ pipeline ops │
      │ recipes  │   │            │   │  LOCKED) │   │ as tools     │
      │ timelines│   └────────────┘   └────┬─────┘   └──────┬───────┘
      │ jobs     │                         │ claim          │
      └──────────┘                         ▼                ▼
                                  ┌────────────────────────────────────┐
                                  │  Worker (recut.worker) — resumable  │
                                  │  handlers: render_export,           │
                                  │  generate_broll/text/voiceover      │
                                  └───────────────┬─────────────────────┘
                                                  │ uses
                                                  ▼
        ┌──────────────────────── pipeline (recut.pipeline) ───────────────────────┐
        │ analyse_reference   draft_script   generate_*   render(ffmpeg)  music-sync│
        └──────────────────────────────┬───────────────────────────────────────────┘
                                        │ via interfaces (recut.core.models)
                                        ▼
        ┌──────────────────────────────────────────────────────────────────────────┐
        │ Model Studio / DashScope:  Qwen-VL · ASR · Qwen-Max · Wan · Qwen-Image ·   │
        │ CosyVoice         (RECUT_MODEL_BACKEND=stub | qwen)                         │
        └──────────────────────────────────────────────────────────────────────────┘
```

## Two cross-cutting cores

### 1. The canonical timeline JSON (single source of truth)
`recut.core.schemas.Timeline` — slots, durations, resolved assets, captions, styles,
audio, and a `token_ledger`. Stored as one versioned JSONB document. **Both** the live
preview and the export read it, so they never drift.

### 2. The render has two surfaces, one spec
- **Live preview** — a pure React player (no ffmpeg in the browser): sequences slots,
  overlays captions with the chosen style, advances per duration, plays audio.
- **Export** — `recut.pipeline.render`: per-slot normalize to 9:16, burn ASS captions,
  concat, mix voiceover + bed, write MP4 to OSS. Per-slot clips are cached by content
  hash → the render is resumable.

Both compute caption geometry from **one** file, `shared/caption-style.json` (the
anti-drift keystone). `canvas_px == preview_px * scale_factor` is pinned by a test on
both sides.

## Data flow: reference → exported MP4

```
upload ──▶ analyse_reference (Qwen-VL + ASR + OCR + beat detection)
   │            │ failure → deterministic fallback recipe (never blank)
   │            ▼
   │        Recipe JSON  ──▶ draft_script_on_beats (Qwen-Max)  ──▶ beats with lines
   │                                                                  │
   ▼                                                                  ▼
 base_cut_from_recipe  ──▶  Timeline (all stand-ins, plays instantly)
                                  │ creator swaps real footage / keeps auto slots
                                  ▼
                         generation gap-fill (kept slots only, async, token-capped)
                                  │
                                  ▼
                         render_export (ffmpeg) ──▶ MP4 in OSS
```

## Token-budget discipline (the headline metric)
`recut.core.timeline_ops.recompute_ledger` keeps `token_ledger` honest from slot state:
real-footage seconds vs generated vs stand-in, tokens spent vs a naive
full-generation baseline. The on-screen provenance panel and the `eval/` report read the
same numbers.

## IP-safety, enforced in code
- Recipes carry **structure only** (beats, durations, patterns) — never the reference's
  footage. Reserved face/illustration slot types are coerced out of v1 recipes.
- Upload-first ingestion; no source-footage reuse.
- No bundled copyrighted audio; trending sound is added by the creator post-export.
- Generated-face and voice cloning are consent-gated (post-v1).

## Local-first → Alibaba
Everything sits behind interfaces (`core/storage.py`, `core/queue.py`, `core/models.py`).
Local: Postgres + MinIO + stub (or real) models via `docker-compose`. Alibaba: RDS + OSS
+ Model Studio + (optionally) RocketMQ — a `.env` change, not a rewrite.
