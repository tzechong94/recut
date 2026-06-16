# Recut

**Borrow the format, tell your story.** A guided short-video studio. Drop one reel you
love the format of; Recut analyses it into a reusable recipe (beats, pacing, on-screen-text
rhythm — never the content), co-writes your story onto those beats, generates a base cut
that plays end to end immediately with stand-ins, then lets you swap in real footage,
restyle, pick a cover, and export a 9:16 MP4.

The creator's footage is the spine; AI fills the gaps only. That's cheaper on tokens, more
authentic, and the whole point. Built for the Qwen Cloud Hackathon, Track 2 (AI Showrunner).

## Quick start (local, no keys)

```bash
cp .env.example .env          # defaults run fully offline with stub models

# Option A — everything in Docker
docker compose up             # Postgres + MinIO + API (:8000) + worker

# Option B — run pieces directly
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
recut-api          # API on :8000   (separate shell)
recut-worker       # render/generation worker
recut-mcp          # MCP server (stdio)

cd ../web && npm install && npm run dev   # editor on :5173
```

Stub models give a high-fidelity offline demo. To go live on Alibaba Model Studio, set
`RECUT_MODEL_BACKEND=qwen` and `RECUT_DASHSCOPE_API_KEY` in `.env`. Deploying to Alibaba
is a config change, not a rewrite (storage, queue, and models all sit behind interfaces).

## Tests

```bash
cd backend && . .venv/bin/activate && python -m pytest -q   # offline; ffmpeg tests skip if absent
cd web && npm test                                          # Vitest
```

## Eval (the headline)

```bash
cd backend && . .venv/bin/activate && python -m eval.run    # recipe quality + token budget + time-to-first-cut
```

## Docs
- `ARCHITECTURE.md` — system diagram, the canonical timeline, the two render surfaces.
- `CLAUDE.md` — contracts and how to extend each lane.
- `ASSUMPTIONS.md` — decisions log. `TODOS.md` — deferred work.

MIT licensed.
