"""Sprint 7 — pacing: scene-boundary dip-to-black fades (crit round 3 #4)."""
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.schemas import Production, Scene, Shot


def test_scene_boundary_and_card_fades():
    p = Production(title="T", scenes=[
        Scene(shots=[Shot(action="a", duration_s=3), Shot(action="b", duration_s=3)]),
        Scene(shots=[Shot(action="c", duration_s=3)]),
    ])
    tl = compile_to_timeline(p)
    # [title, s1a, s1b, s2c, end]
    assert tl.slots[0].fade_in and tl.slots[-1].fade_out  # title in, end out
    s1a, s1b, s2c = tl.slots[1], tl.slots[2], tl.slots[3]
    assert s1a.fade_in and not s1a.fade_out         # scene 1 opens
    assert s1b.fade_out and not s1b.fade_in          # scene 1 closes
    assert s2c.fade_in and s2c.fade_out              # scene 2 opens AND closes (single shot)


def test_editor_pass_paces_silent_shots_and_logs():
    from recut.showrunner.pipeline.editor import edit_pass
    from recut.showrunner.schemas import DialogueLine, ShotType

    p = Production(title="T", scenes=[Scene(shots=[
        Shot(action="wide street", shot_type=ShotType.wide, duration_s=8.0),          # silent -> held to 3.2
        Shot(action="he speaks", duration_s=6.0, dialogue=[DialogueLine(character_name="A", line="hi")]),  # dialogue -> kept
        Shot(action="insert clock", shot_type=ShotType.insert, duration_s=5.0),        # silent -> tightened 1.8
    ])])
    edit_pass(p)
    durs = [s.duration_s for s in p.shots]
    assert durs[0] == 3.2 and durs[1] == 6.0 and durs[2] == 1.8
    assert any("Editor:" in e["decision"] for e in p.director_log)
