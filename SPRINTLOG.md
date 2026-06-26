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
