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

### Crit findings (filled at end of each sprint)
- _pending_
