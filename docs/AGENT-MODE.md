# Agent mode — the autonomous film recipe

**What it does.** Given a premise, the agent builds the whole node graph AND generates every node
on its own, then you export the film. In the UI: type a premise → tick **Agent mode** → **Showrun**.
(Un-ticked = step mode: it proposes each node for approve/edit/skip, TapNow-style.)

Under the hood agent mode = **plan → build graph → Run All (topological, budget-guarded)**. The
canonical, proven end-to-end recipe is the Mr Bean ad — reference implementation:
**`scripts/mrbean-ad.ts`** (committed). It hits the same live endpoints the canvas uses.

## The recipe (reproduce this for any brief)

1. **Canon (lock the characters/style first).**
   - From a **brand asset**: `edit` the uploaded logo/art to *"isolate ONLY the character, full body,
     centered, white background, keep its exact design"* → that clean sheet is the locked reference.
   - Or **generated**: `text2image` a character on a white background.
   - Every later shot inherits Canon by wiring the canon node → the shot node.

2. **A "style spine" appended to EVERY prompt** for consistency, e.g.
   *"Studio Ghibli style, soft hand-painted watercolor, warm cinematic light, widescreen 16:9."*

3. **One shot per beat, each a DIFFERENT camera angle** — this is what sells it:
   - WS establishing (eye level) · MCU three-quarter · CU low-angle · profile two-shot · high-angle hero.
   - Image step: `text2image` (no character) / `edit(canon)` (one character) / `compose(canonA, canonB)`
     (two characters). Always add *"keep the character's exact design"* to hold identity.

4. **Animate each shot** with `video` (real `wan2.6-i2v`, async submit → poll). Motion hint per shot.

5. **Voice** with `dialogue` (`qwen3-tts-flash`), a short line.

6. **Assemble** (Timeline → Export / `/api/assemble`): concat clips + bake a LUT + lay the VO →
   1080p or 9:16 MP4. Clips are auto-normalized to one frame size before concat (i2v sizes vary).

## Cost / time knobs
Each i2v clip ≈ $0.30 and ~40s. A 4–5 shot ad ≈ $1.3–1.9 and ~7–10 min. The budget guard pauses
Run All at 80% of `RECUT_BUDGET_USD`. Cap videos to bound cost.

## For Claude, reproducing on a new brief
Copy `scripts/mrbean-ad.ts`, swap: the Canon source (uploaded asset vs generated), the STYLE spine,
and the per-shot {angle, image-op, i2v-motion}. Run `RECUT_PORT=<port> tsx scripts/<brief>.ts`. To
land it as an editable project on the homepage, POST `/api/projects` + PUT the node graph (see how
the Mr Bean project was reconstructed).
