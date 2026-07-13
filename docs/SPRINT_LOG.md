# Sprint log

## 2026-07-13 — Sprint 0 (harness) — in progress

**Decision:** greenfield repo `~/recut-v3` on the plan's exact stack (Next 15 / pnpm /
TS strict / Tailwind). recut-v2 audited as the migration subject, not the build target
(see docs/MIGRATION.md — verdict: rewrite, cheaper by hours).

**Shipped (free, zero network):**
- Repo scaffold, pnpm, TS strict (`noUncheckedIndexedAccess`, `noImplicitOverride`).
- `lib/gateway/` harness: content-addressed cache (`hash.ts` = sha256(modelId+payload+seed),
  canonical/key-order-independent), `budget.ts` governor (persisted ledger, fails closed with
  no cap, refuses submit past cap), `jobs.ts` Gateway (replay resolves fixtures with zero
  network; miss throws `GatewayCacheMiss` + logs to `fixtures/MISSING.md`; live gates on the
  governor, records spend, captures fixtures).
- Named exceptions: `GatewayCacheMiss`, `BudgetExceeded`, `BudgetUnset`.
- Eval scripts exist and run: `pnpm budget`, `pnpm eval:ui`, `pnpm eval:continuity`
  (STAGED where screens/fixtures don't exist yet), Playwright wired for `pnpm test:e2e`.
- Harness tests: replay zero-network (asserts `live` never called on a hit), governor refuses
  past cap (asserts `live` never called), hash determinism, fail-closed with no cap.

**Gates verified green (2026-07-13):** `pnpm typecheck` clean · `pnpm test` 7/7
(replay zero-network asserts `live` never called on a hit; governor refuses past cap asserts
`live` never called; hash determinism; fail-closed with no cap) · `pnpm build` OK (Next 15,
static) · `pnpm test:e2e` 1/1 (landing renders) · `pnpm budget` / `eval:ui` / `eval:continuity`
all run (evals STAGED until screens/fixtures exist).

**Environment note:** `pnpm install` was initially blocked — the global `~/.npmrc` routed to the
corporate Synapxe Artifactory (401/403 on `next`, `picomatch`, …). User switched the registry to
public npm; installs then succeeded. Pinned exact versions (Next 15.5.4, React 19.1.1, TS 5.9.3,
Vitest 3.2.4, Tailwind 4.1.16, Playwright 1.56.1).

**Money step (0.1 spike): RUN — verdict HOLDS. Spend $1.14 of $8 cap.**
- Preflight found the plan's image models ABSENT on the intl key (`qwen-image-2.0-pro`,
  `wan2.7-image-pro` → empty). Confirmed working: `qwen-image-edit` (ref-based edit — the exact
  capability), `qwen-image-plus` (t2i), `qwen3-vl-plus` (judge). Model ids are a Sprint 3
  manifest concern; the spike tests the capability, so it ran on `qwen-image-edit`.
- Result: 18/18 re-renders (6 camera states × 3 ref-counts) passed, mean identity 0.95–0.98,
  wardrobe ~1.00. `spikes/RESULTS.md` written with an unsoftened verdict + caveat (uniformly
  high scores may mean the edit under-applies angle / lenient judge — verified in Sprint 2's rig).
- Finding: 1 reference beats 2–3. Bible needs only ONE locked reference per entity.

**0.4 golden fixture set: SEQUENCING DEFERRED to Sprint 1 (logged in BLOCKED.md).**
- The cache key is `sha256(modelId + serializedPayload + seed)`; the serialized payload is
  produced by the compiler (Sprint 2) + serializer (Sprint 3), which don't exist yet. Fixture
  hashes can't be computed before payloads are defined. The replay harness + `MISSING.md` flow
  generates them on-demand as the first real compiled payloads appear (Sprint 1 vertical slice).
  Budget reserved: ~$6.86 remains under the cap.

**Spend so far: $1.14.**

## 2026-07-13 — Sprint 1 (one shot, end to end) — SHIPPED

Vertical slice proven: `script → Shot → SeriesBible(entity refs injected) → camera/light
defaults → compile() → CompiledPrompt → router → manifest → serializer → adapter(replay) →
4 keyframe candidates → canvas node → accept Take → provenance → export`.

- `lib/domain` (Project/Entity/Scene/Shot/Take/Provenance), `lib/bible/inject` (refs injected,
  weight-ordered, dangling-safe), `lib/compiler/compile` (PURE, byte-deterministic — Sprint 2
  hardens the cinematography math), gateway `router` + `manifests/` (model-ids confined here:
  qwen-image-edit, qwen-image-plus) + `serializers/dashscope` + `adapters/dashscope`,
  `lib/pipeline/keyframes` (4 candidates w/ full provenance; acceptTake never drops takes).
- UI: `app/produce` (server, runs pipeline in replay) + `components/canvas/ProduceBoard`
  (client: candidate grid, capability badge, cost, cached status, accept, provenance, export).
- **Golden fixtures generated live + committed** (0.4, previously deferred): Mei portrait +
  4 keyframes. Real images verified (on-brief: red scarf, charcoal jacket, cinematic). Take
  images stored locally under public/takes so replay renders offline.
- Import specifiers switched to extensionless (Next webpack can't resolve `.js`→`.ts`).

**Gates:** typecheck clean · test 15/15 · build OK (/produce dynamic) · test:e2e 2/2 (slice
walk asserts 4 candidates, capability badge not model-id, complete provenance, export link,
and aborts any external request = zero network).

**Spend so far: $1.39 of $8** (spike $1.14 + demo fixtures $0.25).

## 2026-07-13 — Sprint 2 (compiler + rigs) — compiler core + live rig preview SHIPPED

- Pure compiler core: camera.ts (vertical-FOV shot-size math), lighting.ts (named-setup
  detection + contrast + colour), lens.ts (body×family×stock table). 24 golden tests over
  every boundary. Byte-deterministic. compile() delegates to all three.
- Rig control surface (components/rigs/RigControls) with LIVE compiled-prompt preview —
  compile() runs client-side (pure, no node deps), so dragging a slider re-derives shot size,
  angle, DoF, lighting setup, and the cinematography sentence with zero server round-trip.
  This is the demo money shot.
- e2e rig.spec: dragging focal 50→200mm changes the prompt + detected shot size; moving the
  key light to 90° azimuth flips the detected setup to 'split'.

**Remaining in Sprint 2:** live eval:ui ≥7 on the rig screen (VLM screenshot scoring, pennies);
optional full R3F 3D draggable scene (sliders are the control surface today; 3D is a visual
layer on the same typed state). Gates green: typecheck, 39/39 unit, build, e2e 3/3.
**Spend $1.64/$8.**

## 2026-07-13 — Sprint 2 COMPLETE

- eval:ui now real + reliable: Playwright-managed screenshot capture (test/e2e/screens.spec)
  → qwen3-vl-plus scores each screen on the 7-axis rubric. Fixed a zombie-server race that
  produced blank captures. Applied the judge's highest-leverage fix to the rig (strict type
  scale + tabular numerals): rig 6.86 → **7.86 (gate ≥7 PASS)**. produce 7.43, landing 8.43,
  overall 7.90.
- Deferred (non-critical polish): full R3F 3D draggable scene. The rig is a working control
  surface (sliders → live compile, the money shot); 3D is a visual layer on the same typed
  state, revisitable in Sprint 7 convergence.

**Gates:** typecheck · 39/39 unit · build · e2e 3/3 + capture · eval:ui 7.90 PASS. Spend $1.69/$8.

## 2026-07-13 — Sprint 3 (gateway abstraction) — SHIPPED

- polyfills/inpaint (Qwen has no mask-inpaint): crop mask bbox + 25% context, edit the crop,
  feather-composite back — pixels OUTSIDE the feathered region are bit-identical (asserted).
- polyfills/outpaint: expand canvas + neutral-grey fill + "extend into the grey" instruction.
- Abstraction proof: manifests/_example-kling (fictional provider, NOT in the live registry —
  the disabled flag) + serializers/kling. Test shows selectModel routes to kling-v1 with zero
  changes outside those two files.
- Test asserts no model-id string appears in product code (lib/app/components/serializers/
  adapters) outside manifests/. (scripts/ + spikes/ are tooling and may name the VL judge; the
  Sprint 5 critic will route qwen3-vl-plus through a vision.critique manifest.)

Note: manifests/serializers/adapters/polyfills live at repo root (plan sketches them under
lib/gateway/); the single-source-of-model-ids contract holds either way.

**Gates:** typecheck · 45/45 unit · build. Spend $1.69/$8 (no live spend this sprint).

## 2026-07-13 — Sprint 4 (Series Bible) — SHIPPED (CRITICAL, the product)

- lib/bible/version: editEntity bumps bible version + stamps the entity; isTakeStale/staleTakeIds
  flag every take that compiled against an older version of a referenced entity — instantly.
- lib/bible/extract: VL attribute auto-extraction (injected vision fn, strict-JSON parse).
- lib/canvas/node: switchModel PRESERVES the CompiledPrompt (never a string), re-serialises via
  the new manifest — the thing TapNow gets wrong. Typed ports: canConnect refuses image→audio etc.
- UI: app/studio + components/canvas/StudioClient (React Flow, dark, entity + shot nodes,
  capability badges, cost, status) + bible panel. Demo beat: click scarf red→blue → bible v1→v2,
  all 4 takes flag stale, the accepted shot node turns amber — instantly.
- @xyflow/react 12.11.2 added.

**Gates:** typecheck · 51/51 unit (stale propagation, model-switch, typed ports, extract) ·
build · e2e 8/8 (studio stale beat) · eval:ui overall 7.75, studio 7.29 (≥7). Spend $1.71/$8.

## 2026-07-13 — Sprint 5 (agent + continuity critic) — SHIPPED (CRITICAL, the differentiator)

- lib/agent/critic: qwen3-vl-plus judges a take vs the bible refs + intent → schema-constrained
  ContinuityVerdict (6 axes); weighted composite = Continuity Score; NEVER fake-passes (parse
  fail → verdict "unknown", score 0). Model-id lives in manifests/qwen-vl-critic.
- lib/agent/repair: auto-repair loop — append the critic's repair instruction, re-render,
  re-critique, cap 2 retries, never regress.
- lib/agent/plan: coverage pass (editorial grammar: establishing/master/coverage/insert/reaction).
- lib/agent/agent: showrunner runner — state IS the graph; tools (create_scene/cast_entity/
  create_shot/set_camera/set_light/plan_coverage/delete_shot) mutate transactionally; guardrails
  = spend cap stops at 80%, NEVER deletes a user-accepted take.
- **Critic proven on REAL images** (committed fixtures, replay-free): good take wardrobe 1.00;
  scarf edited red→BLUE → wardrobe 0.30 (verified the image is genuinely blue, same pose);
  auto-repair back to red → wardrobe 1.00, score +0.21. eval:continuity PASS.
- Report card UI (app/report + components/canvas/ReportCard): per-take axis grid, colour-coded,
  Continuity Score column. The break row is visibly rose/off-model.

**Gates:** typecheck · 64/64 unit · build · e2e 10/10 · eval:continuity PASS · eval:ui 7.69
(report 7.57 ≥7). Spend $1.86/$8.

## 2026-07-13 — Sprint 6 (video, timeline, grade, export) — SHIPPED

- lib/post/lut: 8-LUT LookBook, each with a committed .cube (baked on export) + a CSS filter
  for INSTANT preview. scripts/gen-luts generated them (17^3 analytic looks).
- lib/post/export: ffmpeg arg builders — concat clips + lut3d + 1080p / 9:16 crop; Ken Burns
  keyframe→clip (video = animation of an approved keyframe, hard rule 6). No ffmpeg.wasm.
- Fixture clips: scripts/gen-clips animated the approved keyframes into 3×3s 1080p mp4s (video
  is never cold-called; the demo replays these).
- Timeline UI (app/timeline + components/timeline/Timeline): clip strip + LookBook selector.
  Changing the series LUT restyles every clip instantly via CSS filter — zero API calls.
- ffmpeg-gated test: assembles 3 clips + bakes teal-orange LUT → a real 1080p h264 mp4
  (ffprobe-verified). Pure arg-builder tests cover concat/lut3d/vertical.

Note: video.i2v manifest/adapter deferred (post-hackathon); the clip contract + post pipeline
are proven. Colour grading never touches a model (hard rule 5).

**Gates:** typecheck · 70/70 unit (incl. real ffmpeg export) · build · e2e 12/12 (timeline
LUT zero-network asserted) · eval:ui 7.69 (timeline 7.29 ≥7). Spend $1.89/$8.
