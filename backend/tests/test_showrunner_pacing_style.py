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


def test_fit_durations_scales_an_overlong_board_to_the_target():
    from recut.showrunner.pipeline.storyboard import _fit_durations

    p = _clay_prod(target_seconds=30)
    p.scenes = [Scene(heading="INT. KITCHEN", summary="x",
                      shots=[Shot(action=f"beat {i}", duration_s=8.0) for i in range(8)])]
    assert sum(s.duration_s for s in p.shots) == 64.0  # the 67s-for-a-30s-target bug
    _fit_durations(p)
    total = sum(s.duration_s for s in p.shots)
    assert total <= 30 * 1.15  # lands near the target…
    assert all(s.duration_s >= 3.0 for s in p.shots)  # …without starving any shot


def test_fit_durations_leaves_a_close_board_alone():
    from recut.showrunner.pipeline.storyboard import _fit_durations

    p = _clay_prod(target_seconds=30)
    p.scenes = [Scene(heading="INT. KITCHEN", summary="x",
                      shots=[Shot(action=f"beat {i}", duration_s=4.0) for i in range(8)])]
    _fit_durations(p)
    assert all(s.duration_s == 4.0 for s in p.shots)  # 32s vs 30s target: untouched


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


def test_keyframe_instruction_with_plate_references_both_images():
    p = _clay_prod()
    shot = Shot(action="Eli kneads dough", character_ids=[p.characters[0].id],
                location_id=p.locations[0].id)
    instr = build_keyframe_instruction(p, shot, has_plate=True)
    assert "Image 1 is the CHARACTER" in instr and "image 2 is the SET" in instr
    assert "SAME location layout" in instr  # lock the set across shots


def test_generate_shot_composes_character_plus_locked_location():
    from recut.core.models import get_models
    from recut.showrunner.pipeline.production import generate_shot

    p = _clay_prod()
    eli = p.characters[0]
    eli.reference_url = "https://example.com/eli.png"
    p.locations[0].reference_url = "https://example.com/kitchen.png"  # locked plate
    shot = Shot(action="Eli kneads dough", character_ids=[eli.id], location_id=p.locations[0].id)

    models = get_models()
    seen = {}
    orig = models.image.edit

    def rec(images, instruction):
        seen["images"] = images
        return orig(images[0] if isinstance(images, list) else images, instruction)

    models.image.edit = rec
    r = generate_shot(models, p, shot)
    assert r.tool == "generate_shot_keyframe_i2v"
    # both the character ref AND the locked location plate were fed to the edit
    assert seen["images"] == ["https://example.com/eli.png", "https://example.com/kitchen.png"]


def test_generate_shot_character_only_when_location_has_no_plate():
    from recut.core.models import get_models
    from recut.showrunner.pipeline.production import generate_shot

    p = _clay_prod()
    eli = p.characters[0]
    eli.reference_url = "https://example.com/eli.png"
    # location present but NOT cast (no reference_url) -> single-image edit
    shot = Shot(action="Eli kneads dough", character_ids=[eli.id], location_id=p.locations[0].id)
    models = get_models()
    seen = {}
    orig = models.image.edit

    def rec(images, instruction):
        seen["images"] = images
        return orig(images[0] if isinstance(images, list) else images, instruction)

    models.image.edit = rec
    generate_shot(models, p, shot)
    assert seen["images"] == "https://example.com/eli.png"


def test_character_reference_prompt_leads_with_style_and_takes_instruction():
    p = _clay_prod()
    eli = p.characters[0]
    base = character_reference_prompt(eli, p.style)
    assert base.startswith(p.style.prompt_suffix())
    assert "portrait" not in base.lower() and "design sheet" not in base.lower()  # no photoreal pull
    noted = character_reference_prompt(eli, p.style, "give him a red scarf")
    assert "red scarf" in noted
