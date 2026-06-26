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
