# TODOs

Deferred work, with enough context to pick up cold.

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
