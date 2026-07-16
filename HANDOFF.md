# Recut Handoff: Pipeline Pivot

**Context for Claude Code.** Read this file and `docs/PIPELINE-SPEC.md` (the product-ad-director skill) before doing anything. Also read `CLAUDE.md` and `docs/PRD.md` if present.

**Dates that matter:** today is July 16. Feature freeze July 20. Qwen Cloud Hackathon Track 2 (AI Showrunner) submission July 21. Everything below is scoped to that.

## The pivot thesis

Recut is currently a node-and-edges canvas (TapNow-style). We are pivoting the interface, not the engine, to a linear three-stage pipeline matching `docs/PIPELINE-SPEC.md`:

1. **Assets** (Series Bible): create, motion-test, and lock product sheets, character sheets, locations, props. Locked assets are content-addressed and cached.
2. **Shotlist** (compiler output): one connected document. Global Style Prefix, named prompts (1A, 1B, 2C), per-prompt asset references by registry name, per-scene prefix overrides.
3. **Takes** (iteration loop): run a prompt, judge the take with the VLM, classify the failure against the taxonomy table in the spec, apply the fix at the indicated layer, re-run only that node. Harvest keeper phases.

The node graph stays as the internal typed control state. Prompt names are node IDs. The canvas UI is demoted or deleted. The wizard is the product.

Non-negotiables that survive any cut: Series Bible, Continuity Score, the deterministic compiler, the replay/content-addressed cache.

## Task 1: Audit (plan mode, no code changes)

Map the current codebase against the three stages:

1. Inventory what exists: modules, data models, UI surfaces, model integrations (Qwen/Wan/judge), the cache, the compiler if any.
2. For each stage of the spec, classify existing code as: KEEP (already fits), ADAPT (right engine, wrong shape), DELETE (canvas-only, no longer needed), MISSING (must be built).
3. Identify the current typed control state (or its closest equivalent) and say whether it can represent: named assets with state variants, a global style prefix with scene-scoped overrides, named prompts with asset references, judge scores per take.
4. Be honest about DELETE. Do not preserve the canvas out of sunk cost. If most of the canvas code is dead weight, say so.

Output: `docs/AUDIT.md` with the four-way classification and a one-paragraph verdict on whether this is a re-skin (days) or a rebuild (do not attempt before the deadline, descope instead).

Stop after Task 1. Wait for review.

## Task 2: The 4-day plan (plan mode)

Given the audit, produce `docs/PLAN.md`: a day-by-day plan from July 16 to freeze on July 20, with parallel git worktrees where work is genuinely disjoint. Constraints:

- The demo is the spec: a 30-second product ad (furniture, matching our ecommerce wedge) produced end to end through the three stages, shown in a sub-3-minute video.
- Judging weights: Innovation & AI Creativity 30%, Technical Depth 30%, Problem Value 25%, Presentation 15%. The failure-taxonomy repair loop and the Continuity Score are our depth story. The layout-map feature (compiler emits a spatial schematic from scene state and attaches it as a reference) is our innovation story if it fits; it is the first thing to cut if time runs out.
- Ruthless descoping order (cut from the bottom): layout-map generation, multi-take keeper harvesting UI, wardrobe/state-variant tooling, side-character fast path. Never cut: asset lock flow, shotlist compile, single-prompt iterate-with-judge loop.
- Each day ends with something demoable. Day 1 must end with the pipeline walking end to end on stubs if necessary.
- Include submission logistics in the plan: public repo with license, Alibaba Cloud deploy proof, architecture diagram, demo video script, English description, track ID. These are due artifacts, not afterthoughts; assign them a day.

Stop after Task 2. Wait for review.

## Task 3+: Execute

Only after PLAN.md is approved. One Claude Code session per worktree if parallelizing. Every task in the plan references the spec section it implements. Golden tests on the compiler stay green; a silently changed snapshot is a bug.

## Working rules

- Fix at the cheapest layer (image before video, prompt before regenerate-all), same principle as the spec.
- One variable per change when debugging generation quality.
- When in doubt about scope, choose the smaller thing that still demos the full three-stage loop.
