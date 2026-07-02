"""The shot board — per-shot stills generated at storyboard stage (LTX-style workbench).

Every shot gets a composed still (character + locked location + action + style) BEFORE
approval, so the human iterates on cheap images and produce animates the exact approved
frame. Covers: schema fields, still composition per shot kind, the board_stills job
(all shots + single shot with a steering note), produce reusing the approved still, and
the micro-drama beats (hook / cliffhanger) in the writing prompts.
"""

from __future__ import annotations

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.production import compose_shot_still, generate_shot
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import _REGISTER, _writer_sys, develop_treatment
from recut.showrunner.schemas import (
    Character,
    Location,
    Production,
    Scene,
    Shot,
    STYLE_PRESETS,
)
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _prod() -> Production:
    loc = Location(name="Cottage Kitchen", description="a cozy rustic kitchen with a wood stove")
    eli = Character(name="Eli", description="a kind middle-aged baker")
    return Production(
        title="Clay Days", logline="x", dramatic_question="?", target_seconds=20,
        style=STYLE_PRESETS["claymation"].model_copy(), characters=[eli], locations=[loc],
    )


def _seed_production():
    m = get_models().text
    p = develop_treatment(m, "a baker discovers her rival is her sister", target_seconds=20, style_name="claymation")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def test_shot_schema_has_board_still_fields():
    s = Shot(action="x")
    assert s.keyframe_url is None and s.keyframe_asset_id is None


def test_compose_still_character_plus_plate_uses_both_images():
    p = _prod()
    p.characters[0].reference_url = "https://example.com/eli.png"
    p.locations[0].reference_url = "https://example.com/kitchen.png"
    shot = Shot(action="Eli kneads dough", character_ids=[p.characters[0].id], location_id=p.locations[0].id)
    models = get_models()
    seen = {}
    orig = models.image.edit

    def rec(images, instruction):
        seen["images"], seen["instruction"] = images, instruction
        return orig(images[0] if isinstance(images, list) else images, instruction)

    models.image.edit = rec
    try:
        gen = compose_shot_still(models, p, shot, instruction="give him flour on his hands")
    finally:
        models.image.edit = orig
    assert gen.data
    assert seen["images"] == ["https://example.com/eli.png", "https://example.com/kitchen.png"]
    assert "flour on his hands" in seen["instruction"]  # the note steers the still


def test_compose_still_location_only_redresses_the_plate():
    p = _prod()
    p.locations[0].reference_url = "https://example.com/kitchen.png"
    shot = Shot(action="the oven door creaks open", location_id=p.locations[0].id)
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
    assert seen["images"] == "https://example.com/kitchen.png"
    assert "oven door" in seen["instruction"]


def test_compose_still_no_refs_falls_back_to_t2i():
    p = _prod()
    shot = Shot(action="storm clouds over the valley")
    gen = compose_shot_still(get_models(), p, shot)
    assert gen.data  # plain text-to-image still works with no references


def test_generate_shot_animates_the_approved_board_still():
    p = _prod()
    p.characters[0].reference_url = "https://example.com/eli.png"
    shot = Shot(action="Eli kneads dough", character_ids=[p.characters[0].id],
                keyframe_url="https://example.com/approved_still.png")
    models = get_models()
    calls = {"edit": 0}
    orig = models.image.edit

    def rec(images, instruction):
        calls["edit"] += 1
        return orig(images, instruction)

    models.image.edit = rec
    try:
        r = generate_shot(models, p, shot)
    finally:
        models.image.edit = orig
    assert r.tool == "generate_shot_board_i2v"
    assert calls["edit"] == 0  # no recompose — the human-approved frame is the frame
    assert r.reference_url == "https://example.com/eli.png"  # critic still checks identity


def test_generate_shot_recomposes_when_approved_still_url_expired():
    p = _prod()
    p.characters[0].reference_url = "https://example.com/eli.png"
    shot = Shot(action="Eli kneads dough", character_ids=[p.characters[0].id],
                keyframe_url="https://example.com/expired_still.png")
    models = get_models()
    orig = models.video.generate_from_image

    def flaky(url, prompt, **kw):
        if url == "https://example.com/expired_still.png":
            raise RuntimeError("URL expired")
        return orig(url, prompt, **kw)

    models.video.generate_from_image = flaky
    try:
        r = generate_shot(models, p, shot)
    finally:
        models.video.generate_from_image = orig
    # falls back to compose-from-reference — the film still gets its shot
    assert r.tool in ("generate_shot_keyframe_i2v", "generate_shot_i2v")
    assert r.asset.data


def test_board_stills_job_makes_a_still_for_every_shot():
    p = _seed_production()
    queue.enqueue("board_stills", {"production_id": p.id}, project_id=p.project_id)
    process_once(build_context())
    updated = repo.get_production(p.id)
    assert updated.shots and all(s.keyframe_url and s.keyframe_asset_id for s in updated.shots)
    assert updated.token_ledger.image_tokens > 0  # honest spend
    assert updated.token_ledger.video_tokens == 0  # still zero video pre-approval


def test_board_stills_job_single_shot_with_note():
    p = _seed_production()
    target = p.shots[0]
    queue.enqueue("board_stills", {"production_id": p.id, "shot_id": target.id,
                                   "instruction": "make it rain outside"}, project_id=p.project_id)
    process_once(build_context())
    updated = repo.get_production(p.id)
    assert updated.find_shot(target.id).keyframe_url
    # only the targeted shot got a still
    others = [s for s in updated.shots if s.id != target.id]
    assert all(not s.keyframe_url for s in others)


def test_writer_prompt_has_micro_drama_beats_and_stable_marker():
    sys = _writer_sys(_REGISTER["claymation"])
    assert sys.startswith("showrunner:treatment")  # stub routing marker unchanged
    assert "hook" in sys.lower() and "cliffhanger" in sys.lower()


def test_storyboard_prompts_place_hook_and_cliffhanger():
    p = _seed_production_raw()
    inner = get_models().text
    calls: list[tuple[str, str]] = []

    class Rec:
        def complete(self, sys, user, json_mode=False):
            calls.append((sys, user))
            return inner.complete(sys, user, json_mode=json_mode)

    build_storyboard(Rec(), p)
    board_calls = [u for s, u in calls if "showrunner:storyboard" in s]
    assert board_calls, "storyboard prompts were issued"
    assert "HOOK" in board_calls[0]
    assert "CLIFFHANGER" in board_calls[-1]


def _seed_production_raw():
    m = get_models().text
    return develop_treatment(m, "a baker discovers her rival is her sister", target_seconds=30, style_name="claymation")
