# TODOs

Deferred work, with enough context to pick up cold.

## Showrunner (deferred at 2026-07-02 CEO review — fidelity-contract plan)
- **Season mode** (P1, L→CC:M) — one click from a finished film queues episodes N+1..N+k:
  write → cast-carry (built: `showrunner/series.py`) → board → DRAFT-produce, each episode
  stopping at its own approval gate (0-video-pre-approval invariant holds). Resumable
  queue chain; gallery groups the season as a shelf. Why: loudest autonomous-agent demo
  beat; Episode-2 + carryover already exist — this is orchestration + UI grouping. Build
  the day after the fidelity-contract shakedown passes, not before (competes for the
  live-test window). Depends on: takes/routing landing first.
- **Premiere export pack** (P2, M→CC:S) — "Download film" becomes a zip: MP4 + .srt
  (line timings already in the timeline) + poster (best gated still, titled) + metadata
  JSON (title/logline/episode/credits). Why: the "start shipping" distribution endcap.
  Start: a `publish_pack` worker job + one endpoint; all data already exists.

## Post-v1 (consent-gated)
- **Generated face** (slot type `face`) — generate the creator to camera from a photo.
  Consent gate required. Enum reserved in `schemas.py`; coerced to `talk` on recipe ingest.
- **Voice cloning** (CosyVoice) — clone the creator's voice for voiceover. Consent gate.

## Ingestion
- **Link-fetch adapter** — best-effort fetch of a reel/carousel from a pasted URL.
  Isolated behind an adapter; grey on platform terms. Upload-first for the demo. Start at
  `pipeline/ingest_link.py` (new) behind a feature flag.
- **In-browser teleprompter capture** — record a talking-head slot with `getUserMedia` and
  a teleprompter overlay scrolling the beat's script line. Upload-only for v1. Edge cases:
  permissions, codecs, mobile Safari. Frontend-heavy.

## Infra / hardening
- **Real Alembic migrations** — currently `Base.metadata.create_all`. Fine single-tenant;
  needed before multi-tenant or schema evolution. Alembic dir scaffolded.
- **Multi-tenant** — add `tenant_id` to tables + scope every repo query. Data model is
  already clean for this.
- **Content-safety filter** on generated assets before they enter a timeline.
- **SLS / ARMS** structured logs + traces wiring for the Alibaba deploy.
