# Recut Showrunner — Sprint Log

Autonomous build of the AI Showrunner (Track 2). Loop: **build → demanding-YC-CEO crit →
improve → repeat**, hourly sprints, until cutting-edge or out of tokens.

Design: `docs/ai-showrunner-design.md`. Branch: `showrunner`.

The crit bar (what "cutting-edge" means here): an autonomous agent that writes + directs
a short drama with **consistent characters across shots**, **visible multimodal
orchestration** (writers' room + consistency critic), **quality-per-token discipline**,
in **one elegant human-approved flow** (editing optional). Judged on narrative,
orchestration, token efficiency.

---

## Sprint 0 — Domain + de-risk (in progress)
Goal: drama domain schemas (Production/Character/Location/Scene/Shot/StyleLock) that
compile onto the reused render engine; fix image-gen size bug; add Wan i2v client.
Validated already: Wan i2v works (`wan2.2-i2v-plus`, `img_url`); image-gen needs a
supported size (1024*1024 / 720*1280, not 1080*1920).

### Sprint 0 result: backend pipeline complete, 104 tests, validated live.

## Sprint 1 — YC-CEO crit fixes (in progress)
Crit verdict: "well-engineered, but a toy that will lose — builds a pipeline, not a
director." Top gaps being fixed this sprint:
1. **Re-roll is theater** — seed never passed to Wan (re-roll = coin flip); critic
   returns 1.0 on failure (hides drift); scores midpoint not first frame; last-wins.
   FIX: plumb seed + randomize on re-roll; feed critic reason back as corrective; keep
   best-of-N by score; critic failure → skip (None), never 1.0; score first frame.
2. **No continuity / multi-char** — every shot an island; two-shot seeds only first
   character. FIX: shot-reverse-shot storytelling for dialogue (single consistent face
   per shot, cinematically correct); light last-frame continuity. (Full multi-ref
   compositing deferred — noted.)
3. **Shallow narrative** — one writer→critic→revise round, critic swallowed by bare
   except, no arc/structure/genre-aware writing. FIX: multi-round to score threshold,
   never swallow, dramatic structure + per-character want/flaw, genre-aware register,
   distinct voices.
4. **Audio truncates** — VO trimmed to fixed shot duration cuts dialogue mid-word.
   FIX: synth line first, set shot duration to fit the line (clamped); never truncate.
5. **Scoreboard is circular** — fake ×3 baseline. FIX: honest headline ("0 video
   tokens until human approval; critic re-rolled N of M"), report real spent tokens.

### Sprint 1 result: all 5 crit fixes landed. 110 backend tests.

## Sprint 2 — continuity + frontend (done)
- shot/reverse-shot dialogue (single consistent face per shot) + last-frame→first-frame
  continuity chaining within scenes (t2v fallback if a frame isn't hostable).
- New Showrunner frontend replacing the reel editor: Premise → Script (writers' room) →
  Cast & Style (show bible) → Storyboard → Produce (live status + scoreboard) → Film.
  40 web tests + build green. export_asset_id persisted for revisits.

### Sprint 3 result: film polish (music/titles/captions) + eval harness. 118 tests.
### Sprint 4 result: frontend polish (writers'-room debate, shot badges, proof panel). 45 web tests.

## Sprint 5 — crit round 3 fixes (done). 124 backend tests.
- Dialogue WRITTEN + CRITIQUED (pipeline/dialogue.py) then placed into shots; narrative
  rubric now scores the actual lines (was grading a synopsis — the central hole).
- Director's decision log (visible agent reasoning per shot).
- Honest token counts (real units; estimates labeled). End card reprises title.
- Robustness: degenerate-treatment retry, dropped-scene warnings.

## Sprint 6 — frontend surfacing of Sprint 5 (in progress, background agent)
Surface director_log, written dialogue in Script, warnings banner.

### Crit themes addressed so far (rounds 1-3): functional re-roll, narrative depth +
### real dialogue, audio-fit, honest scoreboard, continuity, film polish, eval proof,
### visible agent reasoning. Remaining/deferred:

## Sprint 6 result: frontend surfacing (dialogue, director's log, warnings). 52 web tests.
## Sprint 7 result: scene-boundary dip-to-black fades. 125 backend tests.
## Sprint 8 — crit round 4 (done). 126 backend tests.
- Crit 4: substance CONVERGED; gaps were watchability + the "edit" stage.
- Editor pass (logged cut decisions), dialogue coverage reframe (OTS/profile so no
  lip-sync needed reads as craft), music = real assets only (no synthetic hum).

### NEXT: docs are STALE (README/ARCHITECTURE.md/CLAUDE.md still describe the old reel
### product) — update for the Showrunner before submission. Then crit round 5.

## Sprint 9 result: docs refreshed for the Showrunner (README/ARCHITECTURE/CLAUDE/DEMO).
## Sprint 10 — crit round 5 (done). 127 backend + 52 web tests.
- Crit 5 verdict: WINNER-GRADE on substance, CONVERGED. Fixed the one real bug:
  re-run/regenerate idempotency (voice cache keyed on caption content hash — no
  token double-count, but edited lines re-synth) + director-log dedupe (per-scene
  index collision found via the new test).

## ===== MORNING SUMMARY (for when you wake) =====
Reached your stated bar ("cutting edge"): two independent crit rounds (4 & 5) judged the
substance converged / winner-grade. **10 sprints + 5 YC-CEO crit rounds**, every fix
TDD'd and committed, **all offline (zero Qwen spend)**. State: backend 127 tests + web 52
tests + builds green, on branch `showrunner`.

The agent now: writes (multi-round writers' room w/ structure + genre), writes AND
critiques the actual dialogue, casts consistent characters (i2v from locked reference +
Qwen-VL consistency critic that re-rolls drift with a corrective note), storyboards
shot/reverse-shot, EDITS with logged cut decisions, voices + scores + renders a framed
9:16 film — with a visible director's log and an honest quality-per-token proof panel.
MCP tools expose the pipeline.

I shifted to low-frequency standby (not churning your Claude Code limit on diminishing
returns). When you're back, the high-value next steps need YOU: (1) live validation —
produce a real film end-to-end on your key (~$2-5) to confirm sprints 1-10 hold live;
(2) drop royalty-free loops in assets/music/{style}.mp3; (3) record the 3-min demo
(DEMO.md). Say the word and I'll do (1) and prep the deploy.

### Still open (next sprints / deferred)
- Update README / ARCHITECTURE.md / CLAUDE.md for the Showrunner pivot (currently reel).
- Write DEMO.md (the 3-min demo script).
- Lip-sync / talking avatars (needs a model; deferred — coverage reframe is the offline answer).
- Real DashScope billing units (needs live).
- Live validation of Sprint 1/2 on real Qwen (seed re-roll, i2v continuity) — costs $.
- Multi-reference compositing for true two-character single frames (currently solved via
  shot/reverse-shot, which is cinematically correct). 
- Music bed (needs a royalty-free asset to drop in).
- Real DashScope billing units in the scoreboard (currently duration*1800 estimate).
- Lip-sync / talking avatars (stretch).

## Sprint 11 (offline value): eval report artifact (eval/run_showrunner.py). 128 tests.
## Sprint 12 (offline value): robustness/edge-case tests (terse premise, single scene, all-narration film, casting-skipped t2v, edited-line vo re-synth). 136 tests.

## Overnight sprint 2026-07-03 (autonomous, user asleep) — "The Fidelity Contract"
Gauntlet: /office-hours (design doc rev3, 2 adversarial rounds, 33 fixes) →
/plan-ceo-review (SCOPE EXPANSION: +animatic +voice studio +take compare; season mode
+ export pack → TODOS) → /plan-eng-review (13 findings vs real code, all adopted).
Built: permanent Takes + chosen_take_id (upgrade-on-read migration), per-shot routing
(speaking→wan2.6-i2v + INPUT AUDIO [our TTS embedded, xcorr 0.998 → hard voice
consistency + lip-sync]; silent→flash/plus by draft|ship mode), master-cut (unchosen
append → picker), scope/force/render produce payload, server-owned takes in PUT merge,
$0-video ANIMATIC through the render engine, voice casting studio (audition real
lines), take picker + side-by-side compare UI, run-sheet model groups + re-film
preview, de-slop restyle (charcoal + film-amber). Live SHAKEDOWN passed 11/11 on
prod_b11d0ead8319 ("Time's Whisper"): contract held — pilot takes byte-untouched
through final render; avg consistency 0.974. Crit fixes from the shakedown: dialogue
line cap (≤12 words), ONE line per shot placement (killed caption walls + 3.7×
runtime blowout), wan2.6 portrait-via-prompt fact. 232 backend + 71 web tests.
