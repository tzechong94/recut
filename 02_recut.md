# Recut: Borrow the Format, Tell Your Story (Claude Code Build Brief)

Track 2: AI Showrunner. Qwen Cloud Hackathon.

Mission: a guided short-video studio for content creators. The creator drops one reel they love the format of; Recut analyses it into a reusable recipe (the beats, pacing, on-screen-text rhythm, never the content), co-writes the creator's own story onto those beats, generates a base cut that plays end to end immediately with stand-ins, and lets the creator swap in their real footage, restyle, pick a cover, and export. The thesis is "borrow the format, tell your story." The autonomous base-cut generation (reference to recipe to script-on-beats to assembled cut) is the AI Showrunner; the editor is the human control layer on top.

## Starting point: the prototype

The user provides `recut-prototype.html`, a clickable React prototype that defines the flow and the design system. Build the real frontend from it; keep its design language (Bricolage Grotesque, DM Sans, JetBrains Mono, the color tokens, the projects-to-editor structure, the five-stage rail). The flow is: projects, then Reference, Recipe, Script, Storyboard, Cover. Treat the prototype as the source of truth for UX and visuals, and replace its in-memory state and fake timers with the real backend.

## Product framing (so you make the right architecture calls)

- First principle: a short is mostly the creator's own footage in a proven structure, with AI filling the gaps. The creator's footage is the spine; generation (b-roll, text cards, voiceover) fills gaps only. This is cheaper on tokens, more authentic, and the whole point.
- The recipe is format-agnostic. A marketing reel and a narrative skit are just different beat structures, so Recut covers "drama" without a separate path. The demo includes one skit reference to show this.
- This is the one project where the frontend is the product, so invest in it. The other tracks are backend-heavy; Recut is an interactive editor.
- Reuse the Core conventions (Qwen client wrapper with retries, observability, eval scaffold, deploy template). The backend is Python, so mirror those conventions in Python rather than importing the TypeScript Core package.

## Locked decisions

- Single tenant for the demo. No auth or signup. Persist one creator's projects, but keep the data model clean so multi-tenant is a later add, not a rewrite.
- Reference ingestion: upload is the clean path; link-fetch is best-effort and grey on platform terms, isolated behind an adapter. Use uploads for the demo.
- Audio: export with voiceover plus an optional royalty-free bed. Do not bundle copyrighted trending sounds; prompt the creator to add the platform's trending sound in-app after upload.
- Generation is deferred, async, and only for slots the creator keeps. The base cut is instant with stand-ins; real Wan b-roll and voiceover render on commit, in the background.
- The agentic pipeline runs over MCP (analyse-reference, draft-script, generate-broll, render, and so on). It is the first thing to cut if time gets tight.
- v1 slot types: text card, talking head (you), camera roll (you), generated b-roll (auto). Drop illustration and generated face from v1. Generated face and voice cloning are consent-gated and post-v1.

## You are

A senior engineer shipping a production-grade product in about a week. Clean, typed, tested, modular, with real error handling on long async jobs. Move fast through parallel streams, but no fragile shortcuts and no overengineering. Log decisions in `ASSUMPTIONS.md`, ask only blocking questions, then proceed.

## Local-first development (how we work)

Run fully on the developer's machine first, then deploy the same code to Alibaba by swapping config. Config-driven via env vars, no hardcoded endpoints. A `docker-compose.yml` boots local stand-ins: Postgres, MinIO (S3-compatible, for OSS), and a worker with ffmpeg installed. Qwen, Wan, and CosyVoice run over the Model Studio API with an API key, identical from local and cloud. All infrastructure sits behind interfaces so deploying to Alibaba is a config change, not a rewrite. Do not deploy until it runs and passes the eval locally.

## Hard constraints (hackathon)

- The backend (analysis, generation, render, the API) runs on Alibaba Cloud. The deployment-proof recording covers it.
- Qwen and friends via Model Studio / DashScope (confirm exact IDs): Qwen-VL for shot, scene, and on-screen-text analysis; an ASR path (Qwen-Audio or Paraformer) for transcription; Qwen-Max for the recipe, the co-writing, the script-on-beats, captions and hashtags, and cover copy; Wan for generated b-roll; Qwen-Image for text-card backgrounds; CosyVoice for voiceover and optional, consent-gated voice cloning.
- Pipeline operations are exposed as MCP tools the co-writing agent calls. MCP usage is scored.
- Public repo, MIT license, `ARCHITECTURE.md` with a diagram, three-minute demo, deploy proof.

## Recommended stack

A monorepo. Frontend: React with Vite (TypeScript), built from the prototype, keeping its design system. Backend: Python (the multimodal analysis, generation orchestration, and ffmpeg render). Storage: Postgres for projects, slots, and the timeline; OSS (MinIO locally) for all media. Async: RocketMQ (or a local queue) for generation and render jobs with progress and resumability. Render: a worker with ffmpeg. Deploy the frontend as static on OSS plus CDN, the API and workers on SAE or Function Compute (use a container or ECS where ffmpeg needs the resources). SLS and ARMS for observability.

## Architecture

The flow and its stages:
- Projects: a single-tenant list of the creator's projects, each with a stage and a saved timeline.
- 01 Reference: upload a reel or carousel (link-fetch best-effort). Store the asset in OSS.
- 02 Recipe: the analysis pipeline watches the reference shot by shot, transcribes audio, reads on-screen text, detects beats, and emits a structured recipe JSON (ordered beats, each with a type, duration, and the noticed pattern). This recipe becomes the template.
- 03 Script: a co-writing agent asks about the creator's story and maps it onto the recipe's beats, then drafts a line per beat (on-screen text or voiceover).
- 04 Storyboard: the base cut. Every beat becomes a slot with a stand-in so the cut plays end to end immediately. The creator swaps stand-ins for real footage (film a talking head with a teleprompter, or upload a clip), restyles font, size, and alignment, and adds, duplicates, or deletes slots, manually or by asking the agent.
- 05 Cover: pick a cover, the agent drafts caption and hashtags, export.

Two cross-cutting cores:
- The canonical timeline JSON (slots, durations, resolved assets, captions, styles, audio) is the single source of truth that both the preview and the export read, so they never drift.
- The render has two surfaces: a live preview that is a pure React player (no ffmpeg in the browser; it sequences slots, overlays captions with the chosen style, advances per duration, plays audio), and a final export that is a server-side ffmpeg worker job (resolves each slot's asset, normalizes to 9:16, fits to the beat duration, burns captions as ASS subtitles or pre-rendered PNG overlays, mixes voiceover and bed, concatenates, writes the MP4 to OSS).

## The hard problems to nail (this is the score)

1. Reference-to-recipe analysis. Turn a video into a transferable recipe across vision, audio transcription, on-screen-text OCR, and temporal beat detection. The most defensible technical artifact, and the IP-safety story (learn the structure, never reuse the footage).
2. The render engine. The two surfaces plus the one canonical timeline JSON. Build the export skeleton end to end early (reference to base cut to exported MP4 with stand-ins only) to de-risk the hardest part first.
3. The slot and stand-in system. Every beat plays immediately with a stand-in; the creator's footage replaces it; generation fills only what is kept.
4. The token-budget discipline. Generation is gap-fill only, deferred, and only for kept slots. This is the direct answer to maximizing quality under a limited token budget, and it is your headline metric.
5. The co-writing agent. Maps the creator's story onto the beats, back and forth, until it sounds like them, then drafts the lines.

## Build plan (phases; stream letters can run in parallel)

- Phase 0, Scaffold (local): monorepo (React frontend from the prototype, Python backend, shared conventions), `CLAUDE.md`, `ARCHITECTURE.md` stub, MIT, `.env.example`, CI, docker-compose (Postgres, MinIO, ffmpeg worker), single-tenant store, and the export skeleton end to end (a stubbed recipe to a base cut to an exported MP4 with stand-ins). Done when a stand-in-only project renders to an MP4 locally.
- Phase 1, Reference-to-recipe analysis (Stream A): ingestion, the multimodal pipeline, the recipe JSON.
- Phase 2, Editor frontend (Stream B): projects, the five-stage flow, the slot system, the live preview player, wired to the real backend. The largest stream.
- Phase 3, Co-writing and MCP (Stream C): the co-writing agent, script-on-beats, caption and cover copy, all pipeline ops exposed as MCP tools.
- Phase 4, Generation gap-fill (Stream D): Wan b-roll, text cards, CosyVoice voiceover, deferred and async, only for kept slots.
- Phase 5, Render hardening: ASS captions, audio mix, 9:16 fit, progress and resumability, cost and token caps.
- Phase 6, Deploy to Alibaba, capture the proof, run the eval, record the demo.

## Eval harness and headline metric

Build `eval/`. Recipe quality: does the extracted recipe match the reference's actual structure (beats and shot count detected). Token budget: the share of the final video that is the creator's real footage versus generated, and generation tokens spent versus a naive full-generation baseline. Experience: time-to-first-playable-cut. Headline: the token-budget slide plus the base cut playing instantly. Emit a JSON report and a markdown table.

## Production hardening

Async render and generation jobs with progress and resumability, cost and token caps per project, a content-safety filter on generated assets, the IP-safety rules enforced in code (no source-footage reuse, upload-first, no bundled copyrighted audio), the consent gate for face and voice, retries with backoff on every model and media step, structured logs to SLS, traces to ARMS.

## Demo (three minutes)

Open projects, drop a reference reel, analyse it into a seven-beat recipe, co-write the story, generate the base cut that plays instantly with stand-ins, swap in real footage on a couple of slots and restyle, pick a cover and let the agent draft the caption, export the MP4. Feed a second narrative skit reference to show the recipe handles drama too. Close on the token-budget and real-footage-share numbers.

## Submission

Public repo plus MIT (visible in About), Alibaba deploy proof for the backend and Model Studio usage, `ARCHITECTURE.md` diagram (frontend to the API on Alibaba to Qwen, Wan, and CosyVoice, to the render worker and OSS), three-minute video, text description, Track 2.

## Start now

Review `recut-prototype.html`. Propose the monorepo structure, the recipe JSON schema and the canonical timeline JSON, the v1 slot-type set, the MCP tool list, and the render pipeline. List blocking questions only. Then build Phase 0 locally, including the export skeleton.
