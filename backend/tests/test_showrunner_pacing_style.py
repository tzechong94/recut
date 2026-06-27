"""Pacing (shot budget), keyframe-first composition, and style-leading prompts.

These cover the four live-quality fixes: a 20s film gets ~6 shots not 22; the per-shot
keyframe places the character in the location; prompts LEAD with the medium so the style
lands; and the cast regenerate note flows into the reference prompt."""
from recut.showrunner.pipeline.casting import character_reference_prompt
from recut.showrunner.pipeline.production import build_keyframe_instruction, build_shot_prompt
from recut.showrunner.pipeline.storyboard import _enforce_budget, _shot_budget
from recut.showrunner.schemas import (
    Character,
    DialogueLine,
    Location,
    Production,
    Scene,
    Shot,
    STYLE_PRESETS,
)


def _clay_prod(target_seconds: int = 20) -> Production:
    loc = Location(name="Cottage Kitchen", description="a cozy rustic kitchen with a wood stove")
    eli = Character(name="Eli", description="a kind middle-aged baker")
    return Production(
        title="Clay Days", logline="x", dramatic_question="?", target_seconds=target_seconds,
        style=STYLE_PRESETS["claymation"].model_copy(), characters=[eli], locations=[loc],
    )


def test_shot_budget_scales_with_runtime():
    assert _shot_budget(_clay_prod(20)) <= 7  # ~6 for 20s, not 22
    assert _shot_budget(_clay_prod(60)) > _shot_budget(_clay_prod(20))  # longer film, more shots
    assert _shot_budget(_clay_prod(5)) >= 3  # floor


def test_enforce_budget_trims_silent_shots_first_and_keeps_a_shot_per_scene():
    p = _clay_prod(20)
    eli = p.characters[0]
    line = DialogueLine(character_id=eli.id, character_name="Eli", line="The cake is ready.")
    p.scenes = [Scene(heading="INT. KITCHEN", summary="Eli bakes",
                      script=[line],
                      shots=[
                          Shot(action="establishing kitchen"),  # silent
                          Shot(action="Eli at the table", character_ids=[eli.id], dialogue=[line]),
                          Shot(action="insert of the cake"),  # silent
                          Shot(action="wide of the room"),  # silent
                      ])]
    _enforce_budget(p, budget=2)
    shots = p.scenes[0].shots
    assert len(shots) == 2
    assert any(s.dialogue for s in shots)  # the line survived (re-placed)
    assert all(p.scenes[0].shots)  # scene not emptied


def test_shot_prompt_leads_with_style():
    p = _clay_prod()
    shot = Shot(action="Eli stirs batter")
    prompt = build_shot_prompt(p, shot)
    assert prompt.startswith(p.style.prompt_suffix())  # medium first, not buried


def test_keyframe_instruction_places_character_in_location_and_style():
    p = _clay_prod()
    shot = Shot(action="Eli pulls a cake from the oven", character_ids=[p.characters[0].id],
                location_id=p.locations[0].id)
    instr = build_keyframe_instruction(p, shot)
    assert "claymation" in instr.lower()
    assert "Cottage Kitchen" in instr and "wood stove" in instr  # the location landed
    assert "SAME character" in instr  # identity preserved
    assert "cake" in instr.lower()  # the action


def test_character_reference_prompt_leads_with_style_and_takes_instruction():
    p = _clay_prod()
    eli = p.characters[0]
    base = character_reference_prompt(eli, p.style)
    assert base.startswith(p.style.prompt_suffix())
    assert "portrait" not in base.lower() and "design sheet" not in base.lower()  # no photoreal pull
    noted = character_reference_prompt(eli, p.style, "give him a red scarf")
    assert "red scarf" in noted
