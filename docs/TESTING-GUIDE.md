# Recut v4 self-testing guide

How to test the three-stage pipeline yourself, find the rough edges, and know what "good" should look like. Written for the product owner, not CI.

**Setup:** v4 runs at `http://127.0.0.1:4800` (start: `cd ~/recut-v4 && RECUT_MODE=live RECUT_BUDGET_USD=<cap> pnpm exec next dev -p 4800`). The spend meter is top-right in the wizard; the governor hard-refuses past the cap, so you can't overrun by accident. Images ~$0.05, judge ~$0.005, 5s clip ~$0.50, plan ~$0.01. Every scenario below says what it should cost.

---

## Scenario A: product ad, end to end (~$1.50, 15 min)

The bread-and-butter DTC flow. Pick a real product you have a photo of.

1. New project from the home page. You land in **1 · Assets**.
2. In the generator: kind `product`, **📎 photo** (attach your real product photo), ×4, prompt like `two-panel product sheet: front view and three-quarter view on a clean studio background`. Generate.
3. **Judge yourself:** do the 4 candidates keep your product's actual identity (shape, logo, materials)? This is the #1 quality question in the whole product.
4. Drag the best one onto the board. The original should stay in the tray with a `✓ on board` badge. Rename the slug (e.g. `my_bottle`), **🔒 Lock**.
5. Add a `character` and a `location` (3/4 angle!) the same way. Lock both.
6. **2 · Scenes**: write a 4-beat sheet, hit Draft. Check: did the planner reference your slugs? Are the camera dropdowns pre-set? Is the prompt language *directing* (blocking + acting beats) rather than summarizing?
7. Pick a cut, set variations ×3, hit **▶ Takes**. Compare the 3 keyframes: which respects the refs best?
8. **◎ Judge** your favorite. If it scores < 0.7, read the diagnosis card: does the named layer match what YOU think is wrong? Hit **⚡ Fix** and see if the score recovers.
9. **🎬 Animate** the keeper. Then **3 · Film**: star it, export with a LUT.

**What to note:** ref fidelity per model call, whether the taxonomy diagnosis agrees with your eye, and any spot where you felt lost about what to do next.

## Scenario B: drama with dialogue (~$2 with 2-3 clips)

1. New project. Skip assets at first: go straight to Scenes… you can't (gated). Note whether the gate message tells you *why* clearly enough.
2. Make one quick character (×2 candidates, no photo), lock it.
3. Draft from a one-line premise, e.g. `A lighthouse keeper finds a letter from her past.` The planner should CAST missing characters as unlocked stubs back in Assets. Go check they appeared.
4. Generate images for the stubs, lock, return to Scenes.
5. A cut should have a spoken line in the pink field. Hit **🔊 Voice**, play the audio take.
6. `＋ coverage (new angle)` on a scene: does the new cut's preset make editorial sense?
7. Animate two keepers, export, listen: is the voice mixed over the cut sensibly?

## Scenario C: the curation board (~$0.30)

- Generate ×6 character candidates in one go. Drag 3 onto the board, discard 2, leave 1 in the tray.
- Drag the same candidate onto the board twice: you should get two independently named assets (`hero`, `hero_2`).
- Move cards around, then immediately hit the browser back button and return: positions must survive (autosave flush).
- Reload mid-generation: the batch stops, already-generated candidates should still be there.

## Scenario D: break it on purpose (free to cheap)

- Delete a scene that has takes: its takes must vanish, other scenes renumber (2A becomes 1A), and their takes/scores must follow the rename. Check the Film tab still assembles.
- Move a scene up/down: the film order follows unless you've manually dragged clips in Film (manual order wins).
- Set an absurd scene override (`neon cyberpunk`) on one scene of a soft watercolor film: only that scene's compiled preview should change.
- Type garbage in the beat sheet (`asdf qwerty`): the planner should fail gracefully with an error bar, not a blank screen.
- Set the budget cap to just above current spend, then batch ×4: it should stop at the refusal, showing the error, not loop.

## Scenario E: the artifacts (free)

- **⬇ Shotlist.html** from Scenes: open it, tick a scene checkbox, reload (state persists), copy a prompt (Style Prefix must be glued on top).
- Export the film twice with different LUTs: second export should reflect the change; no model calls should occur (spend meter unchanged).

---

## How to log what you find

For each observation, capture: **project id** (in the URL), **stage + cut name** (e.g. `Scenes/2B`), a screenshot, and one line on severity:
- `blocker` (can't continue), `wrong` (does the wrong thing), `friction` (works but felt confusing), `polish` (visual).

The friction notes are the most valuable ones: "I didn't know I had to lock the asset before Scenes unlocked" beats ten pixel nits.

## Known rough edges (already on the list, don't burn time re-finding)

- The live generate path bypasses the content-addressed cache (Gateway rewiring is planned): re-running an identical prompt re-bills.
- Lock is a plain toggle; the motion-test lock flow (test clip + judged identity/lighting/realism) is planned.
- Candidate/take thumbnails render as a black frame until video metadata loads in some cases.
- `wan2.7-i2v` needs a different request shape on the intl key; we ship `wan2.6-i2v` (native audio) deliberately.
- The `canvas ↗` escape hatch still opens the old node canvas; it is scheduled for deletion at freeze.
