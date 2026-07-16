# PLAN: pipeline pivot, July 16 to freeze July 20

Task 2 of HANDOFF.md. Assumes AUDIT.md's verdict (re-skin on the existing engine). Work happens on the `pivot` branch in the `~/recut-v4` worktree; `~/recut` (main) stays runnable throughout for comparison. Ports: main 4700, pivot 4800.

Judging lens for every choice: Innovation 30 (layout map, taxonomy repair loop), Technical Depth 30 (deterministic compiler, content-addressed cache, judge loop, Continuity Score), Problem Value 25 (DTC product ads end to end), Presentation 15 (sub-3-minute demo of a 30s furniture ad).

## Day 1 (Jul 16): the spine walks end to end

Goal per HANDOFF: pipeline walking end to end, stubs allowed. One worktree, no parallelism yet.

1. **Type additions** (engine, tested): `Entity.slug` + `Entity.variantOf/state`; `Project.stylePrefix`; `Scene.styleOverride`; `Take.verdict/score`. `compile()` merge order: project prefix > scene override > shot. New golden snapshots; existing 24 stay green byte-for-byte except where the merge is explicitly exercised.
2. **Pipeline document store**: server-backed pipeline doc per project (`assets[]`, `scenes[] > prompts[]` named `1A/1B`, `takes[] keyed by prompt name`). File-backed like projects.
3. **Wizard shell**: `/project/[id]/pipeline` with three tabs (Assets, Shotlist, Takes) in the existing design system. Stage gating: Shotlist locked until >= 1 locked asset; Takes locked until shotlist compiled.
4. **Stage 1 minimal**: create asset from upload or prompt (routes through existing image endpoints), name it with a registry slug, LOCK button (no motion test yet, that is Day 2). Locked = immutable + badge.
5. **Stage 2 minimal**: global Style Prefix textarea, planner (`qwen-max`) drafts scenes/prompts from a beat sheet, per-prompt editor listing required assets by slug (chips), compile preview per prompt via the real compiler.
6. **Stage 3 minimal**: run one named prompt (image first, i2v on demand), takes gallery per prompt, judge button > verdict + Continuity Score chip on the take.

Demoable: furniture-ad walkthrough on stubs/replay, all three tabs, one prompt run + judged.

## Day 2 (Jul 17): the depth story

Two worktrees if needed: `pivot` (A) and `pivot-gateway` (B); B rebases onto A nightly.

- A1 **Motion-test lock flow** (spec 1.6): from an asset, run the constant test prompt through i2v, judge identity/lighting/realism, show matrix, lock writes judge scores into the bible commit.
- A2 **Failure-taxonomy classifier**: map judge verdict axes onto the spec table rows; takes panel shows "symptom > layer > fix" with a one-click apply (edit prefix / scoped override / split prompt / attach sheet / route state variant) that re-runs only that prompt.
- B1 **Gateway rewiring**: `/api/generate` becomes compile > serialize > `Gateway.runJob` so every live call is content-addressed, budgeted, provenance-stamped. Replay tests assert zero network. This closes the audit's bypass finding.

Demoable: break a take on purpose, classifier names the layer, one click fixes it, Continuity Score recovers.

## Day 3 (Jul 18): the ad itself + innovation slot

- **Produce the 30s furniture ad** through the pipeline for real (live spend, budget-capped): product sheet from real photos, hero, location at 3/4 angle, shotlist with match cuts + one pure product rig shot, iterate to keeper takes, assemble in FilmEditor with LUT.
- **Layout map** (innovation story, FIRST TO CUT): compiler emits a schematic from scene state (image-edit annotates the locked location with position marks), attached as a reference to spatially ambiguous prompts. If Day 3 noon status is red, cut and spend the time on ad quality.
- Cut order if behind (from HANDOFF): layout map > keeper-harvest UI > state-variant tooling > side-character fast path. Never cut: asset lock, shotlist compile, iterate-with-judge.

Demoable: the actual ad, rough cut.

## Day 4 (Jul 19): polish + submission artifacts

- Morning: UI polish pass on the wizard (eval:ui gate >= 7 per tab), delete the node canvas + testbeds (audit's DELETE list), README rewrite.
- Afternoon, submission logistics (due artifacts, not afterthoughts):
  - Public repo + license (MIT), scrub keys, push.
  - Alibaba Cloud deploy proof (Function Compute or ECS serving the app; screenshot + URL).
  - Architecture diagram (three stages over the engine: compiler, cache, judge).
  - Demo video: script the sub-3-minute walkthrough (hook: product photo in > 30s ad out; show the taxonomy repair beat and the Continuity Score beat by name).
  - English description + track ID form fields drafted.

## Day 5 (Jul 20): freeze

- Record the demo video against the deployed app, three cold runs, keep the best.
- Final eval:continuity + golden tests green; tag `v4-freeze`.
- Buffer: nothing new after noon; only demo-blocking fixes.

## Risks

- **Live-spend ceiling** ($8 cap, ~$5 spent): Day 3 ad production is the only heavy spend; replay covers everything else. If the cap nears, raise it deliberately or reuse takes.
- **i2v latency** (1 to 3 min/clip): batch Day 3 generations early, never demo a cold video call (pre-cache the demo path).
- **Scope creep in the wizard**: the takes panel inherits node-card concepts (thumbs, model badge, cost) but NOT the graph. Any edges/ports work is a red flag.

Stopping per HANDOFF: this plan awaits review before Task 3 execution. Given the user's instruction to build v4 for self-testing, Day 1 execution proceeds immediately after this file lands, and review can happen against running software.
