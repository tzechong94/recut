# Recut Showrunner — Architecture

An autonomous short-drama agent. The **creative layer** (drama domain + pipeline + agent)
sits on a reused **infra spine** (model clients, render engine, queue, worker, storage,
MCP, FastAPI). The drama model compiles down to the existing render Timeline so the
validated ffmpeg engine is reused unchanged.

## System

```
                         React app (web/) — one flow:
        Premise · Script (writers' room) · Cast & Style · Storyboard · Produce · Film
                         live: per-shot status · director's log · proof panel
                                   │ REST  (GET/PUT/POST /api/productions/...)
                                   ▼
        FastAPI (recut.api)  productions · assets · jobs · styles · eval · scoreboard
              │ sync (cheap text/image, human-approved)     │ enqueue (expensive, async)
              ▼                                              ▼
   pipeline (recut.showrunner.pipeline)              jobs (Postgres queue, SKIP LOCKED)
   writers_room → dialogue → storyboard → casting          │ claim
   production(i2v/t2v) · editor · assemble                  ▼
              │ via interfaces (recut.core.models)   Worker (recut.worker) — resumable
              ▼                                       handlers: cast_reference, produce_film
   Model Studio: Qwen-Max · Qwen-VL · Wan t2v/i2v ·         │ produces shots, voice, render
   Qwen-Image · CosyVoice   (stub | qwen)                   ▼
                                              render (recut.pipeline.render) → MP4 → OSS/MinIO
   MCP server (recut.mcp): showrunner_develop/storyboard/cast/produce/scoreboard + pipeline tools
```

## Two cores

### 1. The drama document → the render timeline
`recut.showrunner.schemas.Production` holds the `StyleLock`, `Character`/`Location`
(each with a locked reference image = the consistency anchor), and `Scene`s of `Shot`s
(the unit of generation, with written `script` dialogue placed into them). It's persisted
as one JSON doc (`productions` table). `recut.showrunner.compile.compile_to_timeline`
maps each Shot → a render `Slot` (+ title/end cards, scene-boundary fades), so the
existing render (9:16, ASS captions, concat, audio mix, resumable) runs unchanged.

### 2. The autonomous production loop (the orchestration centerpiece)
`worker/handlers/showrunner.py:produce_film`, post-approval, async:
```
audio-fit (synth each line, set shot duration to fit it)        ── no truncated dialogue
  ▼
editor pass (pace silent shots; LOG cut decisions)              ── the "edit" stage
  ▼  per shot:
generate (i2v from locked character ref | continuity-chain | t2v)
  ▼
consistency critic (Qwen-VL: score vs reference; reason)
  ▼  if drift: re-roll with NEW seed + corrective note (best-of-N, bounded)
store shot · append director's-log decision · update scoreboard
  ▼  then: per-shot voiceover → concat (aligned) → music bed → render → MP4
```
Resumable (done shots skipped), token-capped, and **render failure degrades gracefully**
(generated shots stay playable; job returns a partial result).

## Narrative pipeline (cheap, human-approved, before any video)
`writers_room` (writer+critic, multi-round to a quality bar, climbing score) → `dialogue`
(writer + dialogue critic writes/critiques the actual lines) → `storyboard` (beats → shots,
shot/reverse-shot, dialogue placed) → `casting` (generate or upload + lock references).

## Consistency (the hard problem), solved by
locked reference still (generate via Qwen-Image OR upload) → Wan **image-to-video** seeds
every shot from it → Qwen-VL **consistency critic** verifies identity per shot and
re-rolls drift with a changed seed + the critic's specific correction → shot/reverse-shot
keeps one consistent face per shot → last-frame chaining carries continuity across cuts.

## Quality-per-token
Plan locked with text/image only; **0 video tokens before human approval** (true by
construction); critic re-rolls only drifted shots. `recut.showrunner.eval` + the
`/eval` + `/scoreboard` endpoints report honest, countable units (video-seconds, shots,
reference images, tts chars, re-rolls).

## Local-first → Alibaba
All I/O behind interfaces (`core/storage.py`, `core/queue.py`, `core/models.py`). Local:
Postgres + MinIO + stub/qwen via docker-compose. Alibaba: RDS + OSS + Model Studio +
(optionally) RocketMQ — a `.env` change, not a rewrite.
