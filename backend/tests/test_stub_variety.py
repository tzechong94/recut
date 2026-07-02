"""Test mode must not read as a broken record.

The stub writers' room / storyboard / dialogue are seeded on the PROMPT: the same
premise always yields the same story (deterministic — tests and resume stay stable),
but different premises yield different titles/casts/lines, storyboards reflect the
scene they were asked to board, and dialogue differs scene to scene.
"""

from __future__ import annotations

from recut.core.models import get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment


def _treat(premise: str):
    return develop_treatment(get_models().text, premise, target_seconds=20, style_name="noir")


def test_different_premises_get_different_stories():
    a = _treat("a courier must deliver a heart across a flooded city before dawn")
    b = _treat("a lighthouse keeper finds a letter addressed to someone dead a century")
    assert a.title != b.title
    assert {c.name for c in a.characters} != {c.name for c in b.characters}
    assert a.scenes[0].summary != b.scenes[0].summary


def test_same_premise_is_deterministic():
    a = _treat("a courier must deliver a heart across a flooded city before dawn")
    b = _treat("a courier must deliver a heart across a flooded city before dawn")
    assert a.title == b.title
    assert [c.name for c in a.characters] == [c.name for c in b.characters]


def test_logline_echoes_the_premise():
    p = _treat("a violinist discovers her rival tuned her strings to fail on stage")
    assert "violinist" in p.logline.lower()


def test_storyboard_uses_the_actual_cast_and_varies_by_scene():
    p = _treat("a courier must deliver a heart across a flooded city before dawn")
    p = build_storyboard(get_models().text, p)
    names = {c.name for c in p.characters}
    boarded = [sh for sc in p.scenes for sh in sc.shots]
    assert boarded
    # shots reference the real cast (identity mapping works), not a canned "Mara"
    named = [n for sh in boarded for cid in sh.character_ids for n in names
             if p.character(cid) and p.character(cid).name == n]
    assert named, "at least one shot features a real cast member"
    # scenes board differently (no copy-paste board)
    actions = [tuple(sh.action for sh in sc.shots) for sc in p.scenes if sc.shots]
    assert len(set(actions)) > 1


def test_dialogue_differs_scene_to_scene():
    p = _treat("a courier must deliver a heart across a flooded city before dawn")
    p = build_storyboard(get_models().text, p)
    scripts = [tuple(l.line for l in sc.script) for sc in p.scenes if sc.script]
    assert len(scripts) >= 2
    assert len(set(scripts)) > 1  # not the same three canned lines everywhere
    # every line is attributed to a real cast member
    names = {c.name for c in p.characters}
    for sc in p.scenes:
        for line in sc.script:
            assert line.character_name in names
