from recut.core.models import get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import Stage


def test_develop_treatment_builds_production_with_transcript():
    p = develop_treatment(get_models().text, "a detective realizes her partner is the killer", target_seconds=45)
    assert p.stage == Stage.script
    assert p.title and p.logline
    assert len(p.characters) >= 2
    assert len(p.locations) >= 1
    assert len(p.scenes) >= 2
    # writers' room transcript captured (writer -> critic -> revise)
    roles = [m["role"] for m in p.writers_room]
    assert "writer" in roles and "critic" in roles
    assert p.token_ledger.text_tokens > 0
    # voice assigned per character
    assert all(c.voice for c in p.characters)


def test_build_storyboard_populates_shots():
    p = develop_treatment(get_models().text, "noir detective betrayal", target_seconds=45)
    p2 = build_storyboard(get_models().text, p)
    assert p2.stage == Stage.storyboard
    assert len(p2.shots) >= 2
    sh = p2.shots[0]
    assert sh.action  # a visual action line (the gen prompt source)
    assert sh.duration_s > 0
    # shots are indexed across scenes
    assert [s.index for s in p2.scenes[0].shots] == list(range(len(p2.scenes[0].shots)))


def test_storyboard_maps_dialogue_to_character_ids():
    p = develop_treatment(get_models().text, "x", target_seconds=30)
    p2 = build_storyboard(get_models().text, p)
    names = {c.name for c in p2.characters}
    for sh in p2.shots:
        for d in sh.dialogue:
            if d.character_name in names:
                assert d.character_id is not None  # resolved to a real character
