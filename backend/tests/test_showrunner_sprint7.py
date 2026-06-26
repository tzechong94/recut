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
