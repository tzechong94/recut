# Audit: codebase vs the three-stage pipeline (PIPELINE-SPEC.md)

Date: July 16. Scope: Task 1 of HANDOFF.md. No code changed.

## 0. The one finding that frames everything

This repo contains **two parallel stacks that do not talk to each other**:

- **Stack A, the engine** (~1.6k LOC, 87 passing tests): `lib/domain` (Project > SeriesBible > Scene > Shot > Take with full Provenance), `lib/bible` (ref injection, VL attribute extraction, versioning + stale propagation), `lib/compiler` (camera/lighting/lens state > `CompiledPrompt`, byte-deterministic, golden-tested), `lib/gateway` (content-addressed replay cache keyed `sha256(model+payload+seed)`, budget governor, capability router), `serializers/`, `adapters/`, `manifests/` (the only place model ids live), `lib/agent` (VLM critic with schema-hardened verdicts, auto-repair loop, coverage planner). It is exactly the shape the spec calls "Recut integration": Stage 1 = Series Bible, Stage 2 = compiler, Stage 3 = judge loop. **It is only reachable from fixture-driven testbed pages.**
- **Stack B, the live product** (~2.1k LOC UI + 590 LOC store): the node canvas (`lib/canvas/store.ts`, `components/canvas/*`) and `app/api/generate`, which **builds prompt strings inline in the route handler, calls DashScope directly, and bypasses the Gateway cache, the compiler, the router, and provenance entirely.** It violates hard rules 2 (typed prompt) and 8 (cache everything); every live image we generated this week is uncached and unreproducible.

The pivot is therefore not "re-skin the canvas". It is: **promote Stack A to be the live path, put the three-stage wizard on top of it, and demote/delete Stack B's UI.** That is still re-skin-scale work, because the hard parts (compiler, cache, judge, bible) already exist and are tested.

## 1. Inventory

| Area | LOC | What it is | Health |
|---|---|---|---|
| `lib/domain` | 136 | Project/Bible/Scene/Shot/Take/Provenance types | Typed, tested, matches spec vocabulary |
| `lib/bible` | 120 | injectRefs, attribute extraction, versioning/stale | Tested (6 tests) |
| `lib/compiler` | 241 | camera/lighting/lens > CompiledPrompt | 24 golden tests, deterministic |
| `lib/gateway` | 367 | replay cache, budget governor, router, hash | 13 tests; budget refusal asserted |
| `serializers`, `adapters`, `manifests` | 410 | DashScope dialect, sync image + async i2v submit/poll, 6 model manifests | Model ids only in manifests (verified by test) |
| `lib/agent` | 474 | critic (strict-JSON verdict, never fake-passes), repair loop, coverage planner, premise planner | 16 tests + eval:continuity gate passes |
| `lib/pipeline` | 70 | generateKeyframes (batch-of-4 via Gateway), acceptTake | Tested, fixture-backed |
| `lib/canvas` (store) | 590 | zustand node graph: string prompts + preset strings, runNode > `/api/generate`, styleAnchor, continuity check, undo | Works live, but is a second, untyped prompt model |
| `components/canvas` | 1506 | Editor, RecutNode, ShowrunBar, NodeInspector, AddNodeMenu, TimelinePanel (product) + StudioClient, ProduceBoard, DemoCanvas, ReportCard (testbeds) | Product UI polished this week; testbeds fixture-only |
| `app/api/generate` | 180 | kind-switched route: builds strings, direct DashScope, no cache | **The bypass.** Biggest ADAPT |
| `app/api/agent/plan`, `assemble`, `export`, `projects` | ~200 | premise>plan, ffmpeg concat+LUT, file-backed project store | Fine as-is |
| Testbed pages `app/{demo,produce,studio,report,timeline}` | ~470 | Sprint gate screens on fixture data | Dead weight after pivot |
| `components/editor/FilmEditor` + `/edit` route | 178 | mini-NLE finish stage (reorder, LUT, export) | Keep; it is Stage 3's harvest surface |
| `components/rigs/RigControls` | 111 | slider rig, **orphaned** (nothing imports it) | Dead already |
| `lib/post`, `scripts/` | 635 | LUTs, ffmpeg args, eval:ui / eval:continuity / budget gates | Keep; gates are our depth story |
| `fixtures/` | 40K | content-addressed golden set incl. continuity break/repair cases | Keep; feeds eval + replay |

Model integrations: `qwen-image-plus` (t2i), `qwen-image-edit` (edit/compose, 3 refs), `wan2.6-i2v` (async submit/poll), `qwen3-vl-plus` (judge), `qwen3-tts-flash`, `qwen-max` (planner). All intl-endpoint verified this week. Spend ledger at $4.96 of $8.

## 2. Four-way classification per stage

### Stage 1: Assets (Series Bible)

| Verdict | What |
|---|---|
| KEEP | `lib/domain` Entity/SeriesBible; `lib/bible` injectRefs + extract + version/stale; content-addressed cache for asset gen; `qwen-image-edit` ref-based generation path (proven: Style Anchor A/B, Mr Bean logo > on-model character) |
| ADAPT | Entity needs a **stable registry slug** (`hero`, `hero_wet`) used verbatim in prompts, and a **state-variant link** (parent entity + state label, spec 1.8). Asset creation UI: the canvas Canon node concept survives as a form, not a node. `app/api/generate` edit/compose calls become Gateway jobs so asset gen hits the replay cache |
| DELETE | Nothing bible-side; `components/bible/` is an empty directory (never built) |
| MISSING | **Lock flow with motion test** (spec 1.6): generate test clip, judge `identity/lighting/realism`, lock = bible commit storing the judge score. Product sheet + character sheet composers (multi-view, erase-extra-faces instruction). Asset gallery UI (Stage 1 wizard screen) |

### Stage 2: Shotlist (compiler)

| Verdict | What |
|---|---|
| KEEP | The compiler itself (`deriveCamera`, `deriveLighting`, lens presets, `compile()`), CompiledPrompt type, serializers, router, golden tests |
| ADAPT | `compile()` takes per-shot input today; add a merge order: **global Style Prefix (project) > scene override > shot**. Shot ids become **named prompts** (display names `1A`, `2C` = scene index + shot letter). `lib/agent/planner` (premise > characters/shots JSON) retargets to emit the shotlist document instead of canvas nodes; `build-graph.ts` is the piece that turns plans into canvas nodes and goes away |
| DELETE | `build-graph.ts` (plan > node-graph shim), ShowrunBar's node-placement logic |
| MISSING | The **shotlist document model** (ordered scenes > named prompts, each listing required assets by registry slug + per-scene override block) and its UI (Stage 2 wizard screen: editable prefix, per-prompt copy/run, attached-asset chips). Small: it is a projection of Shot[] + Scene[] that already exist |

### Stage 3: Takes (iterate loop)

| Verdict | What |
|---|---|
| KEEP | `lib/agent/critic` (strict verdict, weighted Continuity Score, never fake-passes), `repair.ts` (2-retry lift, 60%+ proven in eval), `Take` + `Provenance` types, async i2v submit/poll adapter, `FilmEditor` as the keeper/finish surface, eval:continuity gate |
| ADAPT | `app/api/generate` becomes thin: resolve prompt by name > compile > serialize > **Gateway.runJob** (cache + budget + provenance in one move). Canvas store's runNode/continuity-check logic moves to a takes-panel store keyed by prompt name, not node id |
| DELETE | Nothing engine-side |
| MISSING | **Failure-taxonomy classifier**: map a judge verdict onto the spec's table rows (asset / prefix / scene / prompt / spatial / routing) and surface "fix at layer X" with a one-click action. Take history per prompt (domain type exists; no storage of multiple takes per shot in the live path yet). Layout-map generator (innovation story; explicitly first to cut) |

### Cross-cutting UI

| Verdict | What |
|---|---|
| KEEP | Design system (globals.css tokens, brand), `ProjectsHome` gallery, `/edit` FilmEditor, ReportCard component (restyled this week), project store + isolated test store |
| ADAPT | NodeInspector's controls (camera/light presets, seed/aspect/negative) become the per-prompt editor in Stage 2/3 panels |
| DELETE | The five testbed pages + their components (StudioClient, ProduceBoard, DemoCanvas, Nav), `RigControls` (already orphaned), `lib/demo`. The canvas itself (Editor, RecutNode, AddNodeMenu, TimelinePanel, edges/ports/drag): demote behind a `/project/[id]/canvas` escape hatch during the transition, delete before freeze if untouched. Sunk-cost honesty: ~2.3k LOC of this week's polish (node cards, add-menu, sticky-drag fixes) does not survive as UI. Its *concepts* (input thumbs, model badge, pre-run cost, regenerate affordance) port into the takes panel |

## 3. Can the typed control state represent the spec?

The engine's control state (`CompiledPrompt` + domain types) is the right substrate; the canvas store is not (freeform strings; ignore it for the pivot).

1. **Named assets with state variants**: NEARLY. Entity has id/kind/name/refs/attributes/version. Add `slug` (registry name used verbatim in prompts) and `variantOf?: entityId` + `state?: string`. Two fields, no migration pain (file-backed store).
2. **Global style prefix with scene-scoped overrides**: NO today, cheap to add. `CompiledPrompt.style` exists per prompt; add `stylePrefix` to Project and `styleOverride?` to Scene, and make `compile()` merge project > scene > shot. The compiler is pure and golden-tested, so the merge is a few lines plus new snapshots.
3. **Named prompts with asset references**: YES structurally. Shot.id is the stable name (spec: prompt names map to node ids); Shot.entityIds + `injectRefs()` already resolve to ordered refs at compile time with zero copying. Needs only a human-facing name scheme (`1A`) and slug display.
4. **Judge scores per take**: HALF. Take carries full Provenance; critic returns `ContinuityVerdict` + score. Add `verdict?` and `score?` to Take and store them at judge time. The canvas already proved the wiring (continuity check writes scores onto nodes).

## 4. Verdict

**Re-skin, days, proceed.** The three-stage pipeline's hard interior (deterministic compiler, content-addressed replay cache, budget governor, capability router, ref-injecting Series Bible with versioning, schema-hardened VLM judge with a proven repair loop) already exists as a tested engine; the spec's own "Recut integration notes" read like a description of `lib/`. What the pivot actually requires is: three wizard screens (asset gallery + lock flow, shotlist document, takes panel), roughly six small type additions (slug, variant link, style prefix/override, take verdict), one honest rewiring (route `/api/generate` through compile > serialize > Gateway so the live path stops bypassing the cache and provenance), and a deletion pass (testbeds, node-graph UI, build-graph shim). The genuinely new builds are the motion-test lock flow, the taxonomy classifier, and the layout map, in that priority order, and each sits on an existing primitive (i2v adapter + critic, verdict > table mapping, image-edit + schematic prompt). A rebuild is neither needed nor justifiable before July 20; the risk is not engine work but UI scope, which the descoping ladder in HANDOFF already covers.

Stopping here per HANDOFF. Awaiting review before Task 2.
