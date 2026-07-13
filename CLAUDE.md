# Recut: AI Showrunner

> **How to use this file.** Save as `CLAUDE.md` in the repo root. Then give Claude Code exactly one instruction:
>
> ```
> Read CLAUDE.md. Run the sprint loop from Sprint 0.
> Do not stop for my approval between sprints. Stop only at a STOP GATE.
> ```
>
> It will build, self-verify, fix its own failures, and advance. It halts at the two STOP GATEs and nowhere else.

---

## The economics problem, and how we solve it

Inference costs money and I am not going to sit here manually eyeballing every iteration while credits burn. So:

**Everything runs in replay mode by default. Zero API calls.**

- Sprint 0 spends a controlled ~$5 **once** to generate a golden fixture set. That set is committed to the repo.
- `RECUT_MODE=replay` (the default, and what every sprint after 0 runs in): the gateway adapters resolve every request from `fixtures/` by content hash. They never touch the network. A cache miss is a hard error that names the missing hash and appends it to `fixtures/MISSING.md` so it can be batch-generated later.
- `RECUT_MODE=live`: real API calls. Requires `RECUT_BUDGET_USD` to be set, and the job submitter refuses to submit once spend crosses it. There is no way to overrun the cap.
- The replay layer is not a mock. It is the same content-addressed cache from `lib/gateway/jobs.ts`, keyed `sha256(modelId + serializedPayload + seed)`, configured to never miss to the network. So code that works in replay works live, unchanged.

**Consequence:** after Sprint 0, all UI, canvas, compiler, bible, agent-loop, and export work costs exactly nothing and can iterate freely. That is the whole point.

---

## The sprint loop protocol

For each sprint, in order:

```
1. Read the sprint's goal and exit gates below.
2. Implement.
3. Run ALL exit gates.
4. If a gate fails:
     read the failure, fix it, re-run the gates.
     Up to 5 attempts.
     If still failing after 5:
       - if the sprint is marked CRITICAL, halt and write docs/BLOCKED.md explaining precisely what is wrong.
       - otherwise, log it in docs/BLOCKED.md, descope that item, and advance.
5. When all gates pass:
     append a dated entry to docs/SPRINT_LOG.md (what shipped, what was cut, what broke, spend so far)
     git commit
     advance to the next sprint immediately, without asking me.
```

**You have my standing approval to advance between sprints.** Do not wait. Do not ask "shall I continue." The only two places you stop are the STOP GATEs.

**Never run a live API call outside Sprint 0 and Sprint 7 without saying so in the sprint log.**

---

## Self-verification gates

These scripts must exist by the end of Sprint 0. They are how you grade your own work.

| Command | What it proves |
|---|---|
| `pnpm typecheck && pnpm test && pnpm build` | It compiles and the units hold |
| `pnpm test:e2e` | Playwright: the demo script's happy path completes in a real browser |
| `pnpm eval:ui` | Screenshots every key screen, sends them to `qwen3-vl-plus` against the UI rubric below, prints a score per axis. **Runs live but costs pennies.** |
| `pnpm eval:continuity` | Runs the continuity critic over the fixture takes, prints the score matrix, asserts the deliberate-break tests fail correctly |
| `pnpm budget` | Prints cumulative spend and asserts it is under cap |

### UI rubric (for `pnpm eval:ui`)

The judge scores each screenshot 1 to 10 on each axis. **A sprint's UI gate passes at mean ≥ 7. Sprint 7's polish loop runs until mean ≥ 8.5.**

1. **Visual hierarchy.** Is the primary action obvious within one second?
2. **Density.** Professional-tool density, closer to Linear or Figma than to a consumer app. Not sparse, not cluttered.
3. **Typography.** Consistent scale, no more than 3 sizes on a screen, tabular numerals for costs and scores.
4. **Node legibility.** Can you read a node's capability, model, cost, and status at a glance without hovering?
5. **State clarity.** Are running, cached, stale, failed, and accepted visually distinct at a glance?
6. **Craft.** Alignment, spacing rhythm, no orphaned elements, no default browser chrome.
7. **Does this look like a tool a professional would trust with a paid job?**

Feed the judge the axis list verbatim and ask for strict JSON: `{ axis: score, ... , "worst_offender": "...", "single_highest_leverage_fix": "..." }`. Then fix the single highest leverage thing and re-run. That is the convergence loop.

---
---

# SPRINTS

## Sprint 0 — Harness. CRITICAL. Ends at STOP GATE 1.

The only sprint that spends money. Budget: **$8 hard cap.**

**0.1 The spike.** The entire architecture rests on one unverified assumption, so test it before building anything.

> Does `qwen-image-2.0-pro` preserve character identity through a camera-angle change when given reference images?

Script at `spikes/identity-spike.ts`:
1. Generate one canonical character portrait. This is the reference.
2. For 6 target camera states (frontal eye-level, three-quarter left low angle, profile, rear-three-quarter, high angle, 50mm-to-85mm lens change), call `qwen-image-2.0-pro` in edit mode with the reference plus a cinematography instruction. Comma-delimited grammar: shot size, angle, lens, lighting, then subject, matching Alibaba's Wan prompt guide.
3. Run each at 1, 2, and 3 reference images.
4. Score every output with `qwen3-vl-plus` as judge: strict JSON `{ identity_match, wardrobe_match, artifacts[], verdict }`, 0 to 1.
5. Repeat the 6 states against `wan2.7-image-pro` with 5 refs. That is the fallback path.

Write `spikes/RESULTS.md`: contact sheet, scores, mean `identity_match` per model per ref-count, cost and latency. Then a one-paragraph verdict, unsoftened: does the primary path hold at ≥ 0.8, does the fallback hold, or does the product need to change shape?

**0.2 The audit.** The repo is half-built against a different plan and I am not happy with it. Audit it against this file. Do not rewrite yet. Classify every module **KEEP / REFACTOR / DELETE** with a file path and a specific reason, not a vibe. Look for: hardcoded model ids outside a manifest layer, prompts built as strings in components, prompt logic mixed with I/O, any existing queue or cache worth keeping, anything resembling a Series Bible (almost certainly nothing; that is the main gap). Write `docs/MIGRATION.md` with an ordered migration sequence where every step leaves the repo building, honest hours per step, and an explicit verdict on **whether a rewrite is actually cheaper than a migration**, justified by hour count. Do not default to "keep the code" out of politeness or to "rewrite" out of enthusiasm.

**0.3 The replay harness.** This is what makes every later sprint free.
- `lib/gateway/jobs.ts` content-addressed cache, keyed `sha256(modelId + serializedPayload + seed)`.
- `RECUT_MODE=replay|live`. Replay resolves from `fixtures/` and never touches the network. A miss throws, names the hash, and appends to `fixtures/MISSING.md`.
- `RECUT_BUDGET_USD` governor. The submitter refuses to submit past the cap. Cumulative spend persisted, printed by `pnpm budget`.

**0.4 The golden fixture set.** Generate once, commit, never regenerate. Cover exactly what the demo needs and nothing more:
- 2 cast entities × 4 reference images
- 3 shots × 4 keyframe variants each (the batch-of-4 selection UI needs real grids)
- The same 3 shots re-rendered at 3 alternate camera states and 2 alternate light states (this is what makes rig iteration free)
- 1 wardrobe-changed variant per shot (red scarf → blue), for the stale-flag and auto-repair beat
- 3 animated clips, 5s each, from approved keyframes
- Every critic response for the above, cached too

**0.5 The eval scripts.** `pnpm eval:ui`, `pnpm eval:continuity`, `pnpm budget`, `pnpm test:e2e`. All five gates must exist and run before this sprint closes.

**Exit gates:** `spikes/RESULTS.md` written with a verdict · `docs/MIGRATION.md` written with a verdict · replay mode resolves a request with zero network calls (assert this in a test) · budget governor refuses a submit past cap (assert this in a test) · fixture set committed · all five gate scripts run.

> ## 🛑 STOP GATE 1
> Halt. Print the spike verdict and the migration verdict. Wait for me.
>
> If identity collapses on both the primary and fallback paths, the Series Bible premise is dead and every sprint below is wrong. I need to know that before you write another line.

---

## Sprint 1 — One shot, end to end. CRITICAL.

**Goal: a single shot travels the entire pipeline.** Not three shots. Not the agent. One shot, all the way through, so that every layer is proven to fit together before any of them is built out.

The vertical slice:

```
script text
  → one Shot record
  → Series Bible with one cast entity, refs auto-injected
  → CameraRigState + LightRigState (defaults, no UI yet)
  → compile() → CompiledPrompt
  → router → manifest → serializer → adapter (replay)
  → 4 keyframe candidates back
  → rendered on a canvas node with capability badge, cost, status
  → user accepts one as the Take
  → provenance written
  → the accepted frame exports
```

Every layer here is deliberately thin. `compile()` can produce a crude prompt. The canvas can have one node type. The bible can have one entity. **The point is that the seams hold.** If the seams are wrong, they are wrong now, cheaply, on day 2, rather than on day 6 with five tracks merged on top.

**Exit gates:** `pnpm typecheck && pnpm test && pnpm build` · `pnpm test:e2e` walks the slice above in a real browser and passes · zero network calls occur (assert it) · the accepted Take has complete provenance: model id, seed, exact `CompiledPrompt`, serialized payload, params, latency, cost.

**Do not proceed to Sprint 2 until the slice is green.** Everything after this is widening a pipe that is already known to carry water.

---

## Sprint 2 — Compiler and rigs

Widen the compile layer. This is the spine; everything downstream reads these types.

`lib/compiler/` is **pure**: no network, no React, no I/O, no imports from `app/` or `components/`. Enforce it.

- **`camera.ts`** from `{ azimuthDeg, elevationDeg, distanceM, rollDeg, focalMm, aperture, subjectHeightM, move }`:
  - **shot size** from distance, focal, subject height via vertical FOV coverage → ECU/CU/MCU/MS/MLS/WS/EWS. Get the boundaries right; this is the function most likely to be subtly wrong.
  - **angle name** from elevation (low/eye/high/overhead) and azimuth (frontal/three-quarter/profile/rear-three-quarter/rear)
  - **lens character** from focal: 14-24mm wide with edge distortion, 35mm natural, 50mm neutral, 85mm portrait compression, 135mm+ heavy telephoto compression
  - **depth of field** from aperture, focal, distance → shallow/medium/deep, with bokeh language
- **`lighting.ts`** from `Light { role, azimuthDeg, elevationDeg, intensity, kelvin, hardness }[]`:
  - key-to-fill ratio → contrast (1:1 flat, 2:1 soft, 4:1 dramatic, 8:1+ low-key)
  - key position relative to camera → **auto-detect the named setup**: Rembrandt, split, butterfly, loop, short, broad
  - kelvin → colour language (3200K tungsten warm, 5600K daylight, 6500K cool)
- **`lens.ts`** — body × lens × stock preset table. Bodies (ARRI ALEXA 35, Sony VENICE, RED Komodo, Bolex 16mm, iPhone), lens families (spherical, anamorphic, vintage, macro), stocks (Kodak 2383, Fuji 3510, Ektachrome). Anamorphic adds an aspect hint. Set at series level, overridable per shot.

Calibration example of the output: `"85mm portrait lens on ARRI ALEXA 35, medium close-up, low angle 20 degrees below eye level, three-quarter left, shallow depth of field at f/1.8, background falls away into soft bokeh"`

`components/rigs/`:
- **`CameraRig.tsx`** — three.js / R3F. Stand-in humanoid, draggable camera, target. Sliders and 3D drag are **bidirectionally bound**: drag the camera and the sliders move, move a slider and the camera moves.
- **`LightRig.tsx`** — same scene, draggable light handles orbiting the subject. Show the detected setup name live ("this is Rembrandt"). Preset dropdown snaps the rig.
- Both render a **live compiled-prompt preview panel.** The user drags, and cinematography vocabulary appears from nothing. This is the demo money shot.

**Exit gates:** all standard · ≥ 20 golden snapshot tests covering every shot-size boundary, every angle bucket, every named lighting setup · compiler is byte-deterministic (identical state, identical output) · a Playwright test drags the camera rig and asserts the compiled prompt text changes · `pnpm eval:ui` ≥ 7 on the rig screen.

Because the fixture set contains alternate camera and light states, **rig iteration costs nothing.** Iterate freely.

---

## Sprint 3 — Gateway, and prove the abstraction

After the hackathon I add Sora, Kling, Veo, and Runway. Each must cost **one manifest file plus one serializer file, with zero changes anywhere else.**

- **`manifests/`** — one file per model, covering every row of the routing table below. Each declares capability, `supports` block, cost per unit, p50 latency. **This is the only place in the entire codebase where a model id string may appear.** Grep for violations and fix them.
- **`serializers/dashscope.ts`** — pure function, `CompiledPrompt` → Wan/Qwen dialect.
- **`adapters/dashscope.ts`** — sync for images, async submit-and-poll for video.
- **`polyfills/`** — Qwen has **no mask-inpaint image API**.
  - *inpaint*: crop the mask bbox with ~25% context padding, instruction-edit the crop with the original as reference, feather-composite back. Pixels outside the feathered region must be **bit-identical** to the input. Assert this in a test.
  - *outpaint*: expand canvas, neutral-grey fill, "extend the scene naturally into the grey borders, matching lighting and perspective", recrop.
- **`router.ts`** — `selectModel(capability, constraints, preference: 'quality'|'speed'|'cost')`. Filter by capability and `supports` satisfaction, rank by preference, fall back on 4xx/5xx/timeout.

**Proof of the abstraction, and this is an exit gate:** write `manifests/_example-kling.ts`, a stub manifest for a provider that does not exist, plus a stub serializer. Show the router picks it up and routes to it with **zero changes to any other file.** Leave it behind a disabled flag. If making this work requires touching anything outside `manifests/` and `serializers/`, the abstraction is wrong and you must fix the abstraction, not the test.

**Exit gates:** all standard · the Kling stub routes with zero changes outside its two files · a test asserts no model id string appears outside `manifests/` · inpaint polyfill leaves outside-mask pixels bit-identical.

---

## Sprint 4 — Series Bible. CRITICAL. This is the product.

`components/bible/`, `lib/bible/`. A side panel, not a node.

- Cast an entity: 1 to 5 reference images, name, description. Kind is character, prop, location, or vehicle. `qwen3-vl-plus` auto-extracts attributes (hair, wardrobe, age, distinguishing features) into a typed block the user edits.
- Entities are **referenced** by shots, never copied. Edit Mei's jacket in the bible and every future shot inherits it, with no user action.
- The bible is **versioned**. Every take records which version it compiled against. Editing an entity attribute flags every take compiled against the old version as **stale**, visibly and immediately, on the canvas.

That stale-flag propagation is a demo beat. Make it obvious and instant.

Also widen the canvas here (`components/canvas/`): React Flow, infinite, 60fps at 100+ nodes, typed ports (an `image` output cannot connect to an `audio` input; refuse invalid connections at drag time with a visible reason), graph serializes to JSON and rehydrates losslessly. Every node shows its **capability badge** (never a raw model id), the resolved model, the **estimated cost before you press run**, and live status over SSE.

**Where TapNow is weak, and we must not copy it: changing the model inside a node must not clear the prompt.** Their prompts are strings, so switching models degrades them. Ours holds a `CompiledPrompt` and recompiles. Make the node state model reflect that, and assert it in a test.

**Exit gates:** all standard · a test asserts that adding an entity to a shot injects its refs into `CompiledPrompt` with zero user action · a test asserts that editing an entity attribute flags prior takes stale · `pnpm eval:ui` ≥ 7 on the canvas and bible screens.

---

## Sprint 5 — Showrunner agent and continuity critic. CRITICAL. This is the differentiator.

**Agent** (`lib/agent/`): `qwen3-max` with tool calling. **Its state is the graph, not a chat log.** It does not narrate what it would do. It calls tools that mutate the canvas, and the user watches nodes appear in real time.

Tools: `create_scene`, `cast_entity`, `create_shot`, `set_camera`, `set_light`, `render_keyframe`, `animate_shot`, `critique`, `revise`.

Loop: **PLAN → COMPILE → RENDER → CRITIQUE → REPAIR → ANIMATE → ASSEMBLE.**

In PLAN, add an explicit **coverage** pass. TapNow's own reviewers say their scene segmentation is conservative: long monologues become a single node and rapid cuts must be split by hand. Our planner decides, per story beat, the shot count and shot sizes following standard editorial grammar (establishing, master, coverage, insert, reaction). This alone produces a visibly better shot list, and it is a thing we point at on stage.

Guardrails: hard spend cap per run, surfaced as a budget bar, agent stops and asks at 80%. Every mutation is a single undoable canvas transaction. The agent never deletes a user-accepted take.

**Critic** (`lib/agent/critic.ts`): `qwen3-vl-plus` as judge. Input: the take, the bible entity refs, the shot intent. Output: strict JSON, schema-constrained, retry on parse failure, hard-fail to `verdict: "unknown"` rather than crash.

```json
{ "identity_match": 0.0, "wardrobe_match": 0.0, "prop_match": 0.0,
  "location_match": 0.0, "palette_match": 0.0, "framing_match": 0.0,
  "artifacts": [], "verdict": "pass|repair|reject",
  "repair_instruction": "Mei's scarf is blue; it must be red. Preserve pose and lighting." }
```

Weighted composite is the **Continuity Score**. Below threshold triggers auto-repair: append the repair instruction, strengthen the reference images, re-render. Cap at 2 retries.

**Report card UI:** a grid of every shot, coloured score per axis. One glance tells you shot 7 is off-model. Nobody else ships this and it is on screen during the demo, so make it look good.

**Exit gates:** all standard · `pnpm eval:continuity` passes, meaning: the critic returns schema-valid JSON on 100% of calls; the deliberate-break tests (swap a ref, change a wardrobe attribute) drop the relevant axis below 0.5; auto-repair lifts a failing take above threshold in ≥ 60% of cases within 2 retries · `pnpm eval:ui` ≥ 7 on the report card.

The break tests run entirely against fixtures. Free.

---

## Sprint 6 — Video, timeline, grade, export

**Video** per hard rule 6: fine control lives at the image layer. Video nodes prefer `video.i2v` from an **approved keyframe**. Never burn a 3-minute video call to discover the framing is wrong. `wan2.7-i2v` supports video **continuation**, so chain shots: the last frame of shot N conditions shot N+1. That is free continuity, use it.

**Colour grading**, post only, zero inference. WebGL fragment shader sampling a 3D LUT texture for preview (sub-frame latency), ffmpeg `lut3d` on export. Ship 8 to 10 curated `.cube` LUTs: teal-orange, bleach bypass, warm film, cold noir, Kodak 2383. The LUT lives at the **series** level in the LookBook with per-shot override. Changing the series LUT restyles every clip **instantly, with zero API calls.** A demo beat, so make it visibly instant.

**Timeline**: strip below the canvas. Ordered accepted takes, drag to reorder, trim handles, audio tracks, transitions.

**Export**: ffmpeg on Function Compute, never ffmpeg.wasm (too slow at 1080p). Bake the LUT. 1080p MP4 plus a 9:16 vertical crop. A 60-second cut exports in under 60 seconds.

**Exit gates:** all standard · export produces a graded MP4 from the fixture clips · changing the series LUT triggers zero network calls (assert it) · `pnpm eval:ui` ≥ 7 on the timeline.

---

## Sprint 7 — The convergence loop. Run until it stops improving.

This is the sprint you asked for: **keep iterating until it looks like a real product.**

Loop, autonomously, no approval needed between iterations:

```
1. pnpm test:e2e   → walk the full demo script in a real browser
2. pnpm eval:ui    → screenshot every screen, judge against the rubric
3. Read "single_highest_leverage_fix" from the judge output.
4. Fix exactly that one thing. Not five things. One.
5. Commit. Log the score delta in docs/SPRINT_LOG.md.
6. Repeat.

Exit when: mean UI score ≥ 8.5 across all screens
        OR three consecutive iterations move the mean by < 0.2
           (you have converged; further iteration is noise, stop)
```

`pnpm eval:ui` is a live call, but it is one VLM call per screenshot. Pennies. Spend them.

Then, and only then, harden the demo:

1. **Pre-cache the demo path.** The fixture set already covers it. Verify every beat is a cache hit. On stage, only image nodes run live, and **video is never cold-called**: it takes 1 to 3 minutes and it will kill the room.
2. Landing page. Linear-inspired, light mode. Above the fold: *"Every other tool gives you shots. Recut gives you a series."*
3. Write `docs/EVAL.md`: the continuity rubric, the deliberate-break results, the auto-repair success rate. Judges reward a team that measured its own system, and this is a publishable artifact regardless of the outcome.
4. Run the demo three times, cold, timing each.

**Demo script, three minutes:**

| Time | Beat |
|---|---|
| 0:00 | Paste a 150-word micro-drama script. Hit **Showrun**. |
| 0:15 | The agent populates the canvas: 1 scene, 3 shots, 2 cast entities, camera and light state per shot. Nodes appear as tool calls land. |
| 0:45 | Open shot 2. **Drag the camera rig.** The compiled prompt updates live. Regenerate. Same character, new angle. |
| 1:15 | **Drag the key light** from front to hard side. Regenerate. Same character, new mood. |
| 1:35 | **Change the wardrobe in the bible:** red scarf to blue. Every existing take flags stale. |
| 1:50 | Hit **Continuity check**. Report card renders. Shot 3 fails `wardrobe_match: 0.31`. **Auto-repair fires.** Shot 3 comes back green. |
| 2:20 | Animate the approved keyframes. Apply the series LUT. All three clips restyle instantly, zero API calls. |
| 2:40 | Export. Play the 20-second cut. Three shots, one cast, one look, no drift. |
| 2:55 | *"Every other tool gives you shots. Recut gives you a series."* |

The two beats that must land are the **rig-to-prompt compile** (visible cause and effect) and the **auto-repair** (visible agency). If a polish decision trades against either, protect them. If the demo does not land under three minutes, cut a feature, not the rehearsal.

> ## 🛑 STOP GATE 2
> Halt when the demo runs clean three times under three minutes. Print the final UI scores, the continuity eval results, the total spend, and everything in `docs/BLOCKED.md`.

---
---

# REFERENCE

## Hard rules

1. **Nodes declare capabilities, never model ids.** A hardcoded model id outside `lib/gateway/manifests/` is a bug.
2. **The prompt is a typed object, not a string.** Never concatenate a prompt in a component or a route handler.
3. **The compiler is pure.** Zero network, zero React, zero I/O in `lib/compiler/`.
4. **The 3D rigs are control surfaces, not renderers.** They emit typed state and never call a model. Nothing anywhere does 3D reconstruction.
5. **Colour grading never touches a model.**
6. **Fine control lives at the image layer.** Video is animation of an approved keyframe.
7. **Every asset carries provenance**: model id, seed, exact `CompiledPrompt`, serialized payload, params, latency, cost.
8. **Cache everything by content hash.**
9. **Never delete a user-accepted take.** Agent mutations are transactional and undoable.

## Stack

Next.js 15 App Router, TypeScript strict, Tailwind. React Flow, Zustand, three.js / R3F. Postgres on ApsaraDB RDS via Prisma. Alibaba Cloud OSS, Function Compute (workers and ffmpeg), Model Studio / DashScope. Region `ap-southeast-1`. SSE for job status. Playwright for E2E.

```
app/api/jobs/          submit, poll, SSE
app/api/agent/         showrunner tool-calling endpoint
components/canvas/     React Flow graph, nodes, typed ports
components/rigs/       CameraRig, LightRig
components/bible/      Series Bible panel
components/timeline/   timeline, export
lib/compiler/          PURE. types, camera, lighting, lens, compile + __tests__
lib/gateway/           registry, manifests/, serializers/, adapters/, polyfills/, router, jobs
lib/bible/             SeriesBible types, entity injection
lib/agent/             tools, planner, critic, repair loop
lib/post/              LUT shader, ffmpeg assembly
fixtures/              golden fixture set (committed)
spikes/                throwaway
scripts/               eval:ui, eval:continuity, budget
docs/                  SPRINT_LOG.md, MIGRATION.md, BLOCKED.md, EVAL.md
```

## Core types

```ts
type Capability =
  | 'text.plan' | 'image.generate' | 'image.edit'
  | 'video.t2v' | 'video.i2v' | 'video.r2v' | 'video.edit' | 'video.animate'
  | 'audio.tts' | 'audio.asr' | 'vision.critique';

interface CompiledPrompt {
  subject:  { entityIds: string[]; description: string };
  action:   string;
  camera: {
    shotSize: 'ECU'|'CU'|'MCU'|'MS'|'MLS'|'WS'|'EWS';
    angle:  { elevation: 'low'|'eye'|'high'|'overhead';
              azimuth: 'frontal'|'three-quarter'|'profile'|'rear-three-quarter'|'rear';
              degrees: [number, number] };
    lens:   { focalMm: number; aperture: number; body?: string; character: string };
    dof:    'shallow'|'medium'|'deep';
    move?:  'static'|'push-in'|'pull-out'|'pan'|'tilt'|'orbit'|'handheld'|'crane';
  };
  lighting: {
    setup: 'rembrandt'|'split'|'butterfly'|'loop'|'broad'|'short'|'practical'|'natural';
    key:   { azimuth: number; elevation: number; hardness: 'hard'|'soft'; kelvin: number };
    fill?: { ratio: number };
    rim?:  { azimuth: number; kelvin: number };
    mood:  'high-key'|'low-key'|'neutral';
  };
  palette:  { name: string; hexes: string[] };
  style:    string;
  negative: string;
  refs:     AssetRef[];      // bible-injected, ordered by importance
  seed?:    number;
}

interface ModelManifest {
  id: string;
  provider: 'dashscope' | 'kling' | 'runway' | 'openai';
  capability: Capability;
  region: string;
  supports: {
    nativeAudio?: boolean; firstFrame?: boolean; lastFrame?: boolean;
    continuation?: boolean; maskInpaint?: boolean; bboxEdit?: boolean;
    maxRefImages?: number; maxOutputs?: number; negativePrompt?: boolean;
    seed?: boolean; resolutions: string[]; durationRange?: [number, number];
  };
  cost: { unit: 'image' | 'second' | 'token'; amount: number };
  latencyP50Sec: number;
  serializer: (p: CompiledPrompt) => ProviderPayload;
  polyfills?: Capability[];
}
```

**Data model.** `Project → SeriesBible (Entity[], LookBook, Style) + Canvas (Node[], Edge[]) + Scene[] → Shot[] → Take[] + Timeline`. The **Shot** is the unit of work, the **Take** the unit of iteration: many takes, one accepted. Entities are referenced, never copied. The bible is versioned; every take records which version it compiled against.

## Model routing (ap-southeast-1)

Referenced only inside `lib/gateway/manifests/`.

| Capability | Primary | Cheap |
|---|---|---|
| `text.plan` | `qwen3-max` (tool calling) | `qwen-plus` |
| `vision.critique` | `qwen3-vl-plus` | |
| `image.generate` | `qwen-image-2.0-pro` | `qwen-image-2.0` |
| `image.edit` | `qwen-image-2.0-pro` (1-3 refs, instruction, 1-6 out, negative prompt, seed) | |
| `image.edit` multi-ref / bbox | `wan2.7-image-pro` (up to 9 refs, bbox edit, character-consistent) | |
| `video.i2v` | `wan2.7-i2v` (2-15s, native audio, first / first+last / **continuation**) | `wan2.6-i2v-flash` |
| `video.i2v` first+last, silent | `wan2.2-kf2v-flash` | |
| `video.t2v` | `wan2.7-t2v` | `wan2.2-t2v-plus` |
| `video.r2v` | `wan2.7-r2v` (multi-entity refs, **per-entity voice timbre**) | `wan2.6-r2v-flash` |
| `video.edit` instruction | `wan2.7-videoedit` | |
| `video.edit` mask / extend / frame-expand | `wan2.1-vace-plus` | |
| `video.animate` | `wan2.2-animate-move` / `wan2.2-animate-mix` | |
| `audio.tts` / `audio.asr` | Qwen TTS / Qwen ASR (verify ids in console) | |

## Do not

- Do not add a non-Qwen provider before 21 July. The abstraction exists so we can add them after.
- Do not build a full NLE, multiplayer, mobile, a community feed, or fine-tuning.
- Do not call a video model to test a prompt. Test at the image layer.
- Do not put prompt-building logic in a React component.
- Do not skip provenance to "move faster."
- Do not run live API calls outside Sprint 0 and the eval scripts.

## Cut order if behind

Cut from the top, and do not renegotiate mid-week: draw-to-video, share and clone, outpainting, auto-repair (keep the score, drop the repair), exotic video models.

**Never cut:** the Series Bible, the Continuity Score, the camera rig. Those three *are* the product. Everything else is a node canvas that somebody already built better.
