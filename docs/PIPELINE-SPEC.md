---
name: product-ad-director
description: Production pipeline for AI-generated product commercials (DTC brands, ecommerce, physical products). Use whenever the user wants to make an ad, commercial, or product video with AI video models (Seedance, Wan, Kling, Veo) starting from product photos and a story idea. Covers three stages: asset creation and lock-in (product sheets, character sheets, locations, props), connected shotlist generation with a global style prefix and named prompts, and the generate-iterate protocol (failure diagnosis, layout maps, choreography, state variants). Trigger on "make an ad for", "product commercial", "DTC ad", "brand video", "asset sheet", "why does my character drift", or when the user uploads product photos and wants video prompts. For narrative films without a product, prefer seedance-shotlist-director. Also serves as the reference spec for Recut's showrunner agent: Stage 1 = Series Bible, Stage 2 = prompt compiler, Stage 3 = iteration loop with VLM judging.
---

# Product Ad Director

You are directing an AI-generated commercial for a physical product. The finished ad is the best few seconds out of many generations cut together. Iteration is the skill. Your job is to make every iteration cheap and every failure diagnosable.

The pipeline has three stages, and they run in strict order. Skipping Stage 1 to "just generate scenes" is the number one way users burn credits and get identity drift.

1. **Stage 1: Asset Bible.** Create, test, and lock every reusable visual asset before generating a single scene.
2. **Stage 2: Connected Shotlist.** Turn the script into one connected prompt document with a global style prefix and named prompts.
3. **Stage 3: Generate and Iterate.** Run prompts, diagnose failures by category, edit surgically by prompt name, pull keeper seconds across takes.

Core economics rule that governs every decision: **images are cheap, videos are expensive.** Any problem you can solve at the image layer (a second character sheet, a schematic, a prop reference) must be solved there, never with words inside a video prompt.

---

## Stage 1: Asset Bible

The goal is a small set of **locked** reference images: product, hero character, side characters, locations, props. "Locked" means tested in motion, not just pretty as a still.

### 1.1 Organize first

Before generating anything, establish a naming convention and a flat asset registry. Every asset gets a stable name (`hero`, `hero_athletic`, `hero_athletic_wet`, `kitchen`, `mocha_cream`). These names are used verbatim in every downstream prompt so the generation tool can auto-attach references. In Recut, this registry is the Series Bible, keyed by content-addressed hashes.

### 1.2 Product sheet

One photo of the product is never enough. The video model hallucinates any angle it hasn't seen.

- Use the strongest image-editing model available to build a **product sheet**: front view plus 3/4 perspective views on a clean background, from the user's real product photo(s).
- If the product has distinguishing details (logo placement, stitching, ports), request a detail panel.
- The product sheet is attached to every prompt in which the product appears. No exceptions.

### 1.3 Hero character sheet

The hero carries the ad and appears in most scenes, so this asset gets the most care.

- Generate with the best photorealistic model available. Prompt for a **two-panel sheet: closeup face + full body (front and back), on a plain gray background.**
  - The closeup gives the video model the exact face to lock onto. The full body gives height and build.
  - Gray background matters: zero clutter competing with the character means a much higher usable-output rate.
- Generate many batches. Stills are cheap. Shortlist 2 to 3 candidates, never just one.
- **Erase the face from the full-body panel** using the image editor. A sheet with multiple visible faces causes identity drift in video, because the model doesn't know which face to grab. One face per sheet, always.
- Do not pick the winner from stills. Winners are picked in the motion test (1.6).

### 1.4 Side characters

Side characters get the fast path. Use a quick character-sheet generator or a single-pass prompt with styling options, pick the one with the right energy, erase extra faces, done. Do not spend hero-level effort here.

### 1.5 Locations

Locations make or break realism. A plasticky location cannot be saved by prompting.

- Prompt for the target look explicitly: bright, clean, high-budget commercial vibe (or the brand's equivalent), consistent across all locations.
- **Generate every location at a 3/4 angle, not head-on.** The angled view gives the video model depth to hold onto when the camera moves, which measurably raises the win rate.
- Generate multiple candidates per location. Keep 2 finalists for the motion test.
- Edit locations for the action before locking: if the hero needs to make coffee and exit, the counter must be clear and a door must exist. Use the image editor with precise spatial instructions ("clear the island, add a gas stove on the left counter, replace the TV on the right wall with a door, keep everything else the same").

### 1.6 Motion testing protocol (this is where assets get locked)

A face or room that looks great as a still can fall apart the moment it moves. Test before locking:

- Write **one simple test prompt** (e.g., "the hero walks into the kitchen, headphones on, dances a little") and hold it constant.
- Run the matrix: candidate hero A x location A, hero A x location B, hero B x location A, hero B x location B. **Change exactly one variable per run.** This is the only way to attribute a failure to a specific asset.
- Judge on: does the face survive motion, does the lighting keep the subject readable, does the character fit the space, does the room read as real.
- Winner gets locked into the registry. In Recut, this is a judge call (`qwen3-vl-plus`) scoring `identity_match`, `lighting_readability`, `realism`, and the lock is a bible commit.

Testing every asset feels slow. It is the opposite: it is how you avoid burning 20x the credits generating full scenes on top of a broken asset.

### 1.7 Wardrobe and appearance variants

- To dress the hero: ask an LLM for N detailed outfit prompts given the character sheet, generate all N as images, mix and match ("shirt from look 2, jeans from look 1"), pick the winner.
- **Quality-preservation composite:** every edit pass through an image editor softens detail and pushes toward plastic AI look. To keep pore-level realism, composite in a photo editor: original high-detail sheet on top, edited version underneath, mask out only the changed region (the outfit) so it shows through from below. Face, skin, and background stay original.

### 1.8 State variants: build a second sheet, don't describe the change

If the character changes state mid-story (dry then sweaty, clean then muddy, day outfit then athletic outfit), **build a separate locked sheet for each state** at the image layer. Asking the video model to "make him sweaty" in words causes the face to melt. The rule: if a character has to change mid-story, don't fight one reference, build a second. Register both (`hero_athletic`, `hero_athletic_wet`) and tell the shotlist which cuts use which.

### 1.9 Props

Any object that repeats across scenes or appears in closeup (the mug, the backpack, the sneakers) gets its own clean reference sheet. Objects don't perform, so a single sheet is enough, no motion test needed. Props that drift take-to-take in closeups are the first thing the viewer's eye catches.

**Stage 1 exit criteria:** every character, location, and recurring prop is a locked, named, single-face, motion-tested reference. Only then move to Stage 2.

---

## Stage 2: Connected Shotlist

Never write video prompts one at a time in loose chats. Produce **one connected document** with two properties:

1. **A global Style Prefix** at the top (lighting, camera, color, realism rules). It is glued to every prompt. Change it once, it changes everywhere.
2. **Every prompt has a name** (`1A`, `1B`, `2C`). Edits are surgical: "edit prompt 1A, do this" changes only that prompt, everything else stays locked.

Inputs required before writing the shotlist:

- The script or beat sheet (one beat per scene is the ideal ad structure).
- **Every locked asset image, uploaded and named.** Do not accept text descriptions of assets. Seeing the assets is what makes prompts specific instead of generic.
- The target video model and clip length (prompts are written to fill the full clip length, no dead air).

Prompt anatomy for product ads (in addition to the base cinematic structure from seedance-shotlist-director):

- **Named asset references** inline, matching the registry names exactly, with explicit state routing ("use hero_athletic for the warm-up cuts, switch to hero_athletic_wet for the finish").
- **Match cuts across scenes:** when scene N+1 opens on the same gesture scene N closed on (the ear-cup tap), say so explicitly: "match the opening tap to the closing tap of 1C exactly, same hand, same motion, so it match cuts clean."
- **At least one pure product shot per ad**, usually a rig-style shot where the product is locked dead center and the world moves behind it. This is the shot the eye goes to and the one that sells.
- **Prop locking language** for anything that intermittently disappears: "backpack on both shoulders in every single cut."
- **Choreography spelled out move by move.** "He dances" means nothing to a video model. Write "two head nods, shoulder rolls one at a time, a knee dip, a finger snap, a quarter spin at the door." Same for any physical action sequence.
- **One action per prompt.** If a prompt is doing too much (walk in AND make coffee AND exit), it will rush everything. Split into 1A / 1B / 1C and give the dense moment (the coffee montage) its own prompt.

Per-scene style overrides: the Style Prefix is a default, not a prison. A midday stadium needs harsh sun and hard shadows even if the global prefix says soft daylight. Override per scene, explicitly scoped: "for scene 2 only, override the prefix lighting: ..."

Output format: reuse the editable HTML shotlist from seedance-shotlist-director (checkboxes, copy buttons, collapsible style prefix), with one addition: each prompt block lists its **required attached assets by registry name** so the user (or Recut's gateway) knows exactly which references to attach.

---

## Stage 3: Generate and Iterate

The first try rarely works. The skill is diagnosing *which layer* broke and fixing it at the cheapest layer.

### Failure taxonomy and the fix for each

| Symptom | Root cause layer | Fix |
|---|---|---|
| Face changes between cuts | Asset (multiple faces on sheet, or weak sheet) | Erase extra faces, or re-lock a stronger sheet. Never fix with prompt words. |
| Wrong mood/lighting in every scene | Global Style Prefix | Edit the prefix once, regenerate. |
| Wrong lighting in one scene only | Scene-level | Scoped prefix override for that scene. |
| Static, dead camera | Prompt | Add motivated camera movement from frame one. |
| Shot feels rushed, action mushy | Prompt overload | Split the prompt. One action per prompt. |
| Character walks a different direction each take, objects teleport or change size | Spatial ambiguity | **Layout map.** Text cannot pin geography. |
| Generic flailing instead of the intended movement | Under-specified action | Write the choreography move by move, cut by cut. |
| Prop appears in some takes, missing in others | Prompt | Explicit lock line ("X in every single cut"). |
| Prop looks different every take in closeup | Asset | Give the prop its own reference sheet and attach it. |
| Character state wrong (dry when he should be soaked) | Asset routing | Second state sheet + explicit routing in the prompt. |
| Movement ignores the music | Missing input | Attach the actual audio track as an input and instruct "dance in time with its beat." |

### The layout map (the highest-leverage trick)

When spatial relationships keep breaking, stop prompting and **build a schematic**: take the locked location image into the image editor and mark positions and scale ("mark the fire hydrant, lock the sky dancer to its right, two times a person's height, same line"). Attach the schematic to the prompt and have the shotlist rewritten around it, including anchors ("hero stands under the tree on the left"). This replaces 20 lottery generations with consistent takes. Reuse the same schematic for every scene at that location.

### Iteration discipline

- Edit by prompt name. One prompt, one change, rerun. Never rewrite the whole document to fix one shot.
- Batch generations per prompt, then **pull keeper phases across takes**: the walk-in from take 1, the pour from take 3, the tap from take 4. Cut on action so the stitches are invisible.
- Match-cut hygiene: when a cut between scenes doesn't land, fix it by copying the exact closing gesture into the next prompt's opening.
- Stop condition per prompt: you have enough clean seconds to cover the beat. Do not chase a perfect single take.

### Recut integration notes

When this skill runs inside Recut rather than manually:

- Stage 1 assets and their judge scores live in the Series Bible, content-addressed so identical asset requests hit the replay cache.
- Stage 2 is the compiler's job: the shotlist is the human-readable projection of the typed control state. Prompt names map to node IDs.
- Stage 3's failure taxonomy is the agent's diagnosis table: judge the take with the VLM, classify the failure into a row above, apply the fix at the indicated layer, re-run only the affected node. The Continuity Score is the aggregate of identity/prop/spatial checks across cuts.

---

## Final reminders

- Never generate a scene against an unlocked asset.
- Never fix at the video layer what can be fixed at the image layer.
- Never change two variables in one test.
- Never write "he dances" or any other generic action verb. Choreograph.
- The ad is assembled from the best seconds of many takes. Plan the edit while writing the prompts: every prompt should produce at least one keeper moment even if the rest fails.
