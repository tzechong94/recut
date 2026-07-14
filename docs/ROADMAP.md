# Recut — product roadmap

**Goal:** a real startup product — Qwen hackathon-ready first, and genuinely usable to make
videos. Comprehensive; no deadline; build against replay fixtures (live budget $8, ~$5.6 left).

**Naming:** the locked-reference system is **"Canon"** (not "Bible") — the canonical
characters / locations / props / styles that lock across a film. Rename everywhere user-facing.

**Agent modes:** the Showrunner is **step-by-step by default** — it proposes each node/step and
waits for the user to approve / edit / regenerate (TapNow-style, user controls every node). A
**"Fully autonomous"** toggle lets it build and run the whole graph unattended.

---

## Phase A — Canvas parity & Canon
- **S1 Node system parity.** Delete / duplicate / copy-paste, undo-redo, multi-input handles,
  per-node params (model select, seed, negative, aspect). New node kinds: **compose**
  (multi-image → 1), **inpaint** (image + mask → image, uses the polyfill), **outpaint**,
  **upscale**, **dialogue/TTS** (text → audio). Node inspector drawer.
- **S2 Canon woven in.** A Canon panel + **canon-entity nodes** (character/location/prop/style)
  that lock references; downstream nodes inherit them; edit a canon entity → **stale flags**
  propagate across the graph; a **continuity** node scores any image against the canon.

## Phase B — Showrunner agent
- **S3 Agent core.** Premise/script box → `qwen3-max` tool-calling plans scenes/shots/cast and
  **streams nodes onto the canvas**. Step-by-step approval gates (approve/edit/regenerate each)
  vs. the autonomous toggle.
- **S4 Agent execution.** PLAN→COMPILE→RENDER→CRITIQUE→REPAIR→ANIMATE→ASSEMBLE, live, with the
  continuity auto-repair loop, a budget bar that stops at 80%, transactional undoable steps.

## Phase C — Finish & export
- **S5 Timeline & shots.** Multi-shot timeline from accepted takes; real i2v per shot with
  **continuation chaining** (last frame of shot N → first of N+1); dialogue/TTS onto shots.
- **S6 Grade & export.** LUT grade at series level; ffmpeg assembly → 1080p + 9:16 export of a
  finished multi-shot short with audio.

## Phase D — Startup-grade
- **S7 Persistence & robustness.** Server-side projects/assets (durable, shareable), resumable
  async jobs (i2v runs in the background, non-blocking), runtime budget controls + errors.
- **S8 Polish & submission.** eval:ui convergence, onboarding, landing, the hackathon EVAL/writeup.

Each sprint: build → verify (typecheck · unit · e2e · replay) → commit. Live spend only for
essential fixture generation, logged in SPRINT_LOG.md. Stop only at genuine decision gates.
