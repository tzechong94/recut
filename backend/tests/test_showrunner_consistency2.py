"""Consistency harness v2 — catch drift at IMAGE price, verify at video price.

The board's still gate scores every composed still against the character reference
(identity) AND the location plate (setting) and recomposes failures with the critic's
note — a still re-roll costs ~1/50th of a video re-roll. Identity anchors (VL-described
at cast time) ride every compose; two-character shots feed both refs; the video critic
verifies faithfulness to the APPROVED still.
"""

from __future__ import annotations

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.production import build_keyframe_instruction, compose_shot_still, generate_shot
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import Character, Location, Production, Scene, Shot, STYLE_PRESETS
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _prod() -> Production:
    loc = Location(name="Cottage Kitchen", description="a cozy rustic kitchen with a wood stove",
                   reference_url="https://example.com/kitchen.png")
    eli = Character(name="Eli", description="a kind middle-aged baker",
                    reference_url="https://example.com/eli.png", identity_notes="flour-dusted apron, round glasses")
    mara = Character(name="Mara", description="a sharp-eyed rival",
                     reference_url="https://example.com/mara.png")
    p = Production(title="x", logline="x", target_seconds=20,
                   style=STYLE_PRESETS["claymation"].model_copy(),
                   characters=[eli, mara], locations=[loc])
    p.scenes = [Scene(heading="INT. COTTAGE KITCHEN - NIGHT", summary="the rivalry boils over", shots=[])]
    return p


def _seed_boarded():
    m = get_models().text
    p = develop_treatment(m, "a baker discovers her rival is her sister", target_seconds=20, style_name="claymation")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    for c in p.characters:
        c.reference_url = f"https://example.com/{c.id}.png"
    repo.save_production(p)
    return p


def test_schema_fields_exist():
    assert Shot(action="x").setting_score is None
    assert Shot(action="x").keyframe_score is None
    assert Character(name="A").identity_notes == ""
    assert Production(title="t", logline="l").token_ledger.still_rerolls == 0


def test_two_shot_composes_both_character_refs():
    p = _prod()
    eli, mara = p.characters
    shot = Shot(action="Eli and Mara square off across the counter", shot_type="two_shot",
                character_ids=[eli.id, mara.id], location_id=p.locations[0].id)
    p.scenes[0].shots = [shot]
    models = get_models()
    seen = {}
    orig = models.image.edit

    def rec(images, instruction):
        seen["images"], seen["instruction"] = images, instruction
        return orig(images[0] if isinstance(images, list) else images, instruction)

    models.image.edit = rec
    try:
        compose_shot_still(models, p, shot)
    finally:
        models.image.edit = orig
    assert seen["images"][:3] == ["https://example.com/eli.png", "https://example.com/mara.png",
                                  "https://example.com/kitchen.png"]
    assert "BOTH" in seen["instruction"]


def test_identity_anchors_and_time_of_day_ride_the_compose():
    p = _prod()
    eli = p.characters[0]
    shot = Shot(action="Eli kneads dough", character_ids=[eli.id], location_id=p.locations[0].id)
    p.scenes[0].shots = [shot]
    models = get_models()
    seen = {}
    orig = models.image.edit

    def rec(images, instruction):
        seen["instruction"] = instruction
        return orig(images[0] if isinstance(images, list) else images, instruction)

    models.image.edit = rec
    try:
        compose_shot_still(models, p, shot)
    finally:
        models.image.edit = orig
    assert "flour-dusted apron" in seen["instruction"]  # anchors injected
    assert "night" in seen["instruction"].lower()  # scene heading time-of-day


def test_keyframe_instruction_two_char_phrasing_kept_backward_compatible():
    p = _prod()
    shot = Shot(action="x", character_ids=[p.characters[0].id], location_id=p.locations[0].id)
    p.scenes[0].shots = [shot]
    single = build_keyframe_instruction(p, shot, has_plate=True)
    assert "Image 1 is the CHARACTER; image 2 is the SET" in single  # existing contract
    duo = build_keyframe_instruction(p, shot, has_plate=True, n_chars=2)
    assert "BOTH" in duo and "SET" in duo


def test_board_still_gate_scores_identity_and_setting_and_rerolls_once():
    p = _seed_boarded()
    queue.enqueue("board_stills", {"production_id": p.id}, project_id=p.project_id)
    process_once(build_context())
    updated = repo.get_production(p.id)
    gated = [s for s in updated.shots if s.character_ids]
    assert gated, "seeded storyboard has character shots"
    for s in gated:
        assert s.keyframe_score is not None and s.keyframe_score >= 0.6  # gate passed
    # stub critic fails attempt 0 → exactly one still re-roll per gated shot, at image price
    assert updated.token_ledger.still_rerolls >= 1
    assert updated.token_ledger.video_tokens == 0


def test_video_critic_checks_faithfulness_to_the_approved_still():
    p = _prod()
    shot = Shot(action="Eli kneads dough", character_ids=[p.characters[0].id],
                keyframe_url="https://example.com/approved.png", keyframe_score=0.9)
    p.scenes[0].shots = [shot]
    r = generate_shot(get_models(), p, shot)
    assert r.reference_url == "https://example.com/approved.png"  # verify against the still
    ungated = Shot(action="x", character_ids=[p.characters[0].id],
                   keyframe_url="https://example.com/unchecked.png")  # no gate score
    p.scenes[0].shots = [ungated]
    r2 = generate_shot(get_models(), p, ungated)
    assert r2.reference_url == "https://example.com/eli.png"  # fall back to identity ref


def test_cast_reference_writes_identity_anchors():
    m = get_models().text
    p = develop_treatment(m, "a courier crosses a flooded city", target_seconds=20, style_name="noir")
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    cid = p.characters[0].id
    queue.enqueue("cast_reference", {"production_id": p.id, "target": "character", "target_id": cid})
    process_once(build_context())
    c = repo.get_production(p.id).character(cid)
    assert c.locked and c.identity_notes  # VL wrote the anchors at cast time
