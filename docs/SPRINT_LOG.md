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
