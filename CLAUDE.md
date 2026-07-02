# Recut Showrunner — project guide for Claude

An AI agent that writes + directs a short drama (Qwen Cloud Hackathon Track 2). Read this
before touching code. Design: `docs/ai-showrunner-design.md`; full system: `ARCHITECTURE.md`;
loop history + decisions: `SPRINTLOG.md`. Active branch: `showrunner`.

## Layout
```
web/                          React+Vite+TS — one flow: Premise→Script→Cast&Style→Storyboard→Produce→Film
backend/recut/
  showrunner/                 THE DRAMA PRODUCT
    schemas.py                Production · Character · Location · Scene · Shot · StyleLock · TokenLedger
    compile.py                Production → render Timeline (+ title/end cards, scene fades)
    eval.py                   narrative rubric · consistency separation · honest token facts
    pipeline/                 writers_room · dialogue · storyboard · casting · production · editor · assemble
  core/                       reused spine: schemas(Timeline/Slot), models(iface+stubs), qwen_clients,
                              storage, queue, db, repo, caption, config
  pipeline/render.py          ffmpeg render (reused unchanged), shots.py (ffmpeg shot detection/keyframes)
  worker/handlers/showrunner.py   cast_reference · produce_film (the autonomous loop)
  api/routers/productions.py  the Showrunner API
  mcp/                        MCP server + tools (showrunner_* + pipeline ops) — scored
```

## Contracts (don't break)
1. **`recut.showrunner.schemas.Production`** is the canonical drama doc (persisted JSON).
   Validate every write through the model. `compile_to_timeline` is the only bridge to the
   render `Timeline` — keep the render engine reuse intact.
2. **Model access only via `recut.core.models` interfaces** (VisionAnalyzer incl.
   `score_consistency` → `ConsistencyVerdict`, TextLLM, VideoGen incl.
   `generate_from_image`, ImageGen, VoiceGen). Real impls in `core/qwen_clients.py`; stubs
   are deterministic for offline tests/demo. Never call DashScope elsewhere.
3. **Stage flow is human-approved**: premise→script→cast_style→storyboard→[approve]→
   production→export. NO video tokens before approval. Generation is async via the queue.

## Invariants
- Consistency: a shot with a character → i2v from that character's locked reference, and
  the consistency critic verifies it (re-roll drift with a NEW seed + the critic's reason,
  best-of-N, bounded). Never fake-pass: critic failure → score None (skip), never 1.0.
- Dialogue is WRITTEN + CRITIQUED (pipeline/dialogue.py) then PLACED into shots; the
  narrative rubric scores the actual lines.
- No model failure yields a blank/500: deterministic fallbacks; render failure → partial
  film with ready shots preserved.
- Token discipline: 0 video tokens pre-approval; re-roll only what drifts; honest counts.
- LLM markers: stub routing keys on `showrunner:*` markers in the system prompt — keep
  prompts' markers stable when editing pipeline prompts (and update the stub if adding one).

## Testing (TDD)
- `cd backend && . .venv/bin/activate && RECUT_MODEL_BACKEND=stub python -m pytest` (126).
  Offline: sqlite + local storage + stub models. ffmpeg-gated tests skip without ffmpeg.
- `cd web && npm test` (52) · `npm run build`.

## Run
- `RECUT_MODEL_BACKEND=stub ./scripts/dev-local.sh` (api+worker) + `cd web && npm run dev`.
- Live: `RECUT_MODEL_BACKEND=qwen` + `RECUT_DASHSCOPE_API_KEY` in backend/.env; `recut-doctor` first.

## Live model facts (validated on the Singapore/intl key)
Wan t2v `wan2.2-t2v-plus` (size 1080*1920), Wan i2v `wan2.2-i2v-plus` (img_url + seed),
image `wan2.2-t2i-flash` (sizes 1024*1024/720*1280/1280*720, NOT 1080*1920), Qwen-VL,
Qwen-Max, CosyVoice v2 (needs `dashscope.base_websocket_api_url` for intl). certifi CA
bundle set for the websocket.

## Style
Typed, pydantic v2, explicit over clever, named exceptions (no bare except outside the
worker boundary), minimal diff. ASCII diagrams for pipelines. Keep diagrams/docs accurate.
