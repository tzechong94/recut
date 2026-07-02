# Recut Showrunner

**An AI agent that writes and directs a short drama.** Type a premise; the agent runs a
writers' room, casts characters with a consistent look, storyboards, then autonomously
generates every shot (image-to-video from locked references, with a consistency critic
that re-rolls drift), voices the dialogue, edits the cut, and exports a 9:16 film.

Qwen Cloud Hackathon, **Track 2: AI Showrunner.** Built on Qwen-Max, Qwen-VL, Wan
(text-to-video + image-to-video), Qwen-Image, and CosyVoice via Alibaba Model Studio.

> Recut began as a "borrow the format" reel editor (still in git history / `main`); it was
> pivoted to the AI Showrunner. The render/queue/storage/model infra was reused; the
> creative layer + agent were rebuilt. See `docs/ai-showrunner-design.md`.

## The one elegant flow (editing optional at every stage)

```
premise ─▶ writers' room ─▶ cast & style ─▶ storyboard ─▶ [APPROVE] ─▶ produce ─▶ film
            writer+critic     gen/upload &     shot/reverse                autonomous   MP4
            (climbing score)  lock references   -shot, dialogue            i2v + critic
                                                                           + voice + edit
```

The agent generates each stage; you **approve to advance** and may edit anything. If you
just keep approving it feels automatic; tweak and you're directing. Nothing expensive
runs before you approve the plan — the token-budget discipline.

## What makes it competitive (the scored axes)

- **Narrative ability** — a multi-round writers' room (writer + critic, visible climbing
  score) with real dramatic structure, then a **dialogue pass that writes AND critiques
  the actual spoken lines** (not just a synopsis), scored by an independent rubric.
- **Multimodal orchestration** — character/world **consistency**: each shot is Wan
  image-to-video from a locked reference still; a Qwen-VL **consistency critic** scores
  every shot and **re-rolls drift with a new seed + the critic's specific correction**;
  shot/reverse-shot + last-frame continuity; an **editor pass** that makes (and logs) cut
  decisions. The agent's reasoning is shown live as a **director's log**. All exposed as
  **MCP tools**.
- **Quality per token** — plan is locked with cheap text/image tokens; **0 video tokens
  are spent before you approve**; the critic re-rolls only what drifted. The scoreboard
  reports honest, countable units.

## Quick start

```bash
cp .env.example .env            # defaults: offline stub models, sqlite, local storage

# backend (API + worker)
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
RECUT_MODEL_BACKEND=stub ../scripts/dev-local.sh      # or RECUT_MODEL_BACKEND=qwen for live

# frontend
cd web && npm install && npm run dev                  # → http://localhost:5173
```

Stub mode runs the whole flow offline (deterministic placeholder media) with zero keys.
For live generation set `RECUT_MODEL_BACKEND=qwen` + `RECUT_DASHSCOPE_API_KEY` in
`backend/.env` (Singapore/intl endpoint pre-configured). Validate first: `recut-doctor`.

## Tests
```bash
cd backend && . .venv/bin/activate && RECUT_MODEL_BACKEND=stub python -m pytest   # 126
cd web && npm test                                                                 # 52
```

## Docs
- `docs/ai-showrunner-design.md` — design + locked scope. `ARCHITECTURE.md` — system.
- `CLAUDE.md` — contracts + how to extend. `DEMO.md` — the 3-minute demo script.
- `SPRINTLOG.md` — the build→crit→fix loop history. MIT licensed.
