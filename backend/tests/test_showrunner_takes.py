"""The fidelity contract's foundation: permanent takes + per-shot routing.

Every generation is a Take; a shot's CHOSEN take is the sole video source for its slot
and can never be replaced implicitly. Legacy productions upgrade on read (their single
asset becomes a chosen take; old quality tiers map to draft/ship). Routing sends
speaking shots to the dialogue model and silent shots to Wan by mode.
"""

from __future__ import annotations

from recut.core.config import get_settings
from recut.showrunner.pipeline.production import (
    build_shot_prompt,
    route_shot_model,
    speaking,
    take_is_stale,
)
from recut.showrunner.schemas import (
    Character,
    DialogueLine,
    Production,
    Scene,
    Shot,
    STYLE_PRESETS,
    Take,
    caption_fingerprint,
)


def _prod(quality: str = "ship") -> Production:
    eli = Character(name="Eliot", description="a magician")
    line = DialogueLine(character_id=eli.id, character_name="Eliot", line="Lena, where are you?")
    p = Production(title="x", logline="x", target_seconds=20,
                   style=STYLE_PRESETS["claymation"].model_copy(),
                   characters=[eli], video_quality=quality)
    p.scenes = [Scene(heading="INT. STAGE - NIGHT", summary="s", shots=[
        Shot(action="Eliot searches backstage", character_ids=[eli.id], dialogue=[line]),
        Shot(action="empty stage, dust in the light"),
    ])]
    return p


def test_take_schema_and_shot_fields():
    t = Take(asset_id="a_1")
    assert t.model is None and t.seed is None and t.audio_kind == "silent"
    s = Shot(action="x")
    assert s.takes == [] and s.chosen_take_id is None


def test_legacy_production_upgrades_on_read():
    doc = _prod().model_dump(mode="json")
    doc["video_quality"] = "happyhorse"  # legacy tier
    sh = doc["scenes"][0]["shots"][0]
    sh["asset_id"] = "a_old"
    sh["takes"] = []
    sh["chosen_take_id"] = None
    up = Production.model_validate(doc)
    assert up.video_quality == "ship"  # legacy tier mapped
    shot = up.shots[0]
    assert len(shot.takes) == 1
    take = shot.takes[0]
    assert take.asset_id == "a_old" and take.model is None and take.seed is None
    assert take.audio_kind == "native"  # happyhorse legacy + dialogue
    assert shot.chosen_take_id == take.id  # WITHOUT this, produce would re-film day one
    # idempotent: validating again must not duplicate the take
    again = Production.model_validate(up.model_dump(mode="json"))
    assert len(again.shots[0].takes) == 1


def test_legacy_final_maps_to_ship_with_tts_audio():
    doc = _prod().model_dump(mode="json")
    doc["video_quality"] = "final"
    doc["scenes"][0]["shots"][0]["asset_id"] = "a_old"
    up = Production.model_validate(doc)
    assert up.video_quality == "ship"
    assert up.shots[0].takes[0].audio_kind == "tts"  # has a caption, wan tier


def test_speaking_predicate_ignores_blank_lines():
    p = _prod()
    assert speaking(p.shots[0]) is True
    blank = Shot(action="x", dialogue=[DialogueLine(character_name="A", line="   ")])
    assert speaking(blank) is False
    assert speaking(p.shots[1]) is False  # silent shot


def test_routing_speaking_to_dialogue_model_and_silent_by_mode():
    s = get_settings()
    p = _prod("draft")
    assert route_shot_model(p.shots[0], p, s) == s.dialogue_i2v_model  # both modes
    assert route_shot_model(p.shots[1], p, s) == s.wan_i2v_draft_model
    p2 = _prod("ship")
    assert route_shot_model(p2.shots[0], p2, s) == s.dialogue_i2v_model
    assert route_shot_model(p2.shots[1], p2, s) == s.wan_i2v_model
    # master promotion: speaking shots must go to a model that SPEAKS
    assert route_shot_model(p2.shots[0], p2, s, master=True) == s.master_dialogue_i2v_model
    assert route_shot_model(p2.shots[1], p2, s, master=True) == s.master_i2v_model


def test_speech_clause_follows_routing_not_legacy_tier():
    p = _prod("ship")
    prompt = build_shot_prompt(p, p.shots[0], speak=True)
    assert "speaks these exact words aloud" in prompt and "Lena" in prompt
    assert "speaks these exact words" not in build_shot_prompt(p, p.shots[0], speak=False)


def test_take_staleness_triple():
    from recut.showrunner.pipeline.production import still_signature

    p = _prod()
    shot = p.shots[0]
    shot.keyframe_asset_id = "still_A"
    take = Take(asset_id="a1", keyframe_asset_id="still_A", keyframe_sig=still_signature(shot),
                caption_hash=caption_fingerprint(shot.caption))
    assert take_is_stale(shot, take) is False
    shot.keyframe_asset_id = "still_B"  # still REGENERATED (same fields)
    assert take_is_stale(shot, take) is True
    shot.keyframe_asset_id = "still_A"
    shot.dialogue[0].line = "A new line entirely."  # edited dialogue
    assert take_is_stale(shot, take) is True
