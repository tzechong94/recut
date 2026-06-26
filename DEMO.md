# Recut Showrunner — 3-minute demo script

Goal: prove the three scored axes are real, not asserted — **narrative ability**,
**multimodal orchestration** (esp. character consistency), and **quality per token** —
and that it produces a watchable short film, autonomously, with the human in control.

Pre-demo: have one finished film pre-generated (live Qwen) to play instantly, AND run the
agent live on a short slice so judges see real autonomy without the ~90s/clip wait. Boot:
`RECUT_MODEL_BACKEND=qwen ./scripts/dev-local.sh` + `cd web && npm run dev`. Sanity:
`recut-doctor`.

## Beat sheet

**0:00–0:25 — The premise.** Type one line: *"A detective realizes the partner she trusts
is the killer she's hunted all night."* Pick the **noir** style. Hit "Start the writers'
room." One sentence in.

**0:25–1:00 — Narrative, visibly.** The **writers' room** runs: writer drafts a treatment,
the critic gives specific notes, the writer revises — the **critic score climbs on screen**
(e.g. 0.66 → 0.78 → 0.86) across rounds. Then the **dialogue pass** writes and critiques
the actual spoken lines (shown as a screenplay block). Tweak one line to show editing is
optional, not required. → "Approve."

**1:00–1:30 — Consistency (the show bible).** Cast the two leads: **generate** one
reference still from a description, **upload** your own image for the other — both lock.
This is the consistency anchor every shot will use. Pick/confirm the style. → "Approve."
Storyboard appears (shot/reverse-shot). → **"Action!"** (the gate before any video spend).

**1:30–2:30 — Autonomous production + the "whoa".** The agent generates each shot live.
Watch the **director's log** stream real decisions: *"Shot 3 — image-to-video from locked
reference; consistency 0.42 < 0.6 → re-rolled ×1 with corrective note → 0.84."* The
**consistency critic catching drift and fixing it** is the headline moment — it's real and
visible. Per-shot badges show i2v/t2v + score. Then cut to the **pre-generated finished
film**: a coherent noir scene, the **same faces across shots**, dialogue in distinct
voices, scene-boundary fades, title + end cards.

**2:30–3:00 — The proof.** Open the **proof panel**: narrative rubric (overall + sub-scores),
avg consistency score, and the honest token facts — **"0 video tokens spent before you
approved; the critic re-rolled 1 of N shots."** Close with a **second premise in a
different genre** (e.g. storybook/anime) to show range — type it, show the writers' room
start, then stop. Range proven.

## One-liner
"You give it a sentence. It runs a writers' room, casts a consistent cast, directs and
edits a short film shot by shot — re-rolling any shot that drifts — and spends zero video
tokens until you say go."

## If something breaks live
- A shot fails → it degrades to a stand-in; the film still plays (graceful render).
- Generation is slow → narrate the director's log; the pre-generated film is the payoff.
- Live model hiccup → `RECUT_MODEL_BACKEND=stub` runs the entire flow offline, deterministically.
