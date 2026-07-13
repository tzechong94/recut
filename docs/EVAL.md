# Recut — evaluation

We measured our own system. Two evals, both reproducible from the committed fixtures.

## 1. Continuity critic (the differentiator)

`qwen3-vl-plus` judges each take against the Series Bible's locked references and the shot's
intent, returning a schema-constrained verdict on six axes. The weighted composite is the
**Continuity Score**.

**Weights** (identity dominates): identity 0.35 · wardrobe 0.20 · framing 0.15 · prop 0.10 ·
location 0.10 · palette 0.10. **Threshold: 0.70.**

**Never fake-passes:** unparseable critic output → verdict `unknown`, score 0 — never 1.0.
100% of critic calls returned schema-valid verdicts in the eval set.

### Deliberate-break test (run entirely against fixtures — free)

We took the accepted take (red scarf) and edited ONLY the scarf to blue — same person, pose,
jacket, background (verified by eye). The critic caught it:

| take | identity | wardrobe | palette | Continuity Score | verdict |
|---|---|---|---|---|---|
| good (red) | 0.95 | **1.00** | 0.98 | **0.88** | pass-grade |
| break (blue scarf) | 1.00 | **0.30** | 0.20 | **0.67** | reject |
| repaired (→ red) | 0.95 | **1.00** | 0.98 | **0.88** | pass-grade |

The wardrobe axis drops from 1.00 → **0.30** on the break (well below the 0.5 bar), and palette
follows (0.98 → 0.20). The break is unmissable on the report card.

### Auto-repair

The failing blue take was auto-repaired (append the critic's repair instruction → re-render →
re-critique, capped at 2 retries). It recovered to wardrobe 1.00, Continuity Score **+0.21 to
0.88**, back above threshold. Success: **1/1 within 1 retry** in this set. `pnpm eval:continuity`
asserts all of the above and PASSES.

## 2. UI quality (self-scored)

`pnpm eval:ui` screenshots every screen and scores it 1–10 on a 7-axis rubric with the same VLM.
Latest run: **overall 7.7**, every screen ≥ 7 (landing 8.4, rig 8.1, produce 7.4, studio 7.4,
report 7.6, timeline 7.3). The score converged — run-to-run judge variance (~±0.2) exceeds the
per-iteration deltas, which is the documented stop condition, so we stopped iterating at ~7.7
rather than chase a stochastic 8.5.

## Honest caveats

- The identity spike (`spikes/RESULTS.md`) scored uniformly high (~0.98) across camera angles;
  we flagged that the edit model may under-apply extreme angle changes — the camera rig is where
  angle becomes a directly controllable, visible input.
- The plan's named image models (`qwen-image-2.0-pro`, `wan2.7-image-pro`) do not exist on the
  intl key; we route `image.edit`→`qwen-image-edit` (spike-validated) via the manifest layer.
- Video is animation of an approved keyframe (Ken Burns for the demo clips); the video.i2v
  adapter is post-hackathon. Colour grading and export never touch a model.

## Spend

Total live spend across all evals + the golden fixtures: **~$1.9 of the $8 hard cap**. Everything
after Sprint 0 runs in replay (zero network) and is free to re-run.
