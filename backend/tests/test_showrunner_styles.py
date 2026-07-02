"""Custom styles (LTX-style 'style elements'), tone decoupling, richer presets.

A style can now be created from the user's own description (text → StyleLock) or
reference images (Qwen-VL distillation), and the reference image ANCHORS every keyframe
composition. Tone is a separate axis from the look. Presets grew and their thumbnails
come from free online images (no generation credits).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core.models import get_models
from recut.showrunner.pipeline.production import compose_shot_still, style_anchor_url
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import (
    Character,
    Location,
    Production,
    Shot,
    STYLE_PRESETS,
    StyleLock,
    TONE_REGISTERS,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_preset_gallery_grew_and_new_presets_use_online_thumbnails(client):
    styles = client.get("/api/styles").json()
    names = {s["name"] for s in styles}
    assert {"ink_wash", "comic", "pixel", "cyberpunk", "retro_film", "paper_craft"} <= names
    by_name = {s["name"]: s for s in styles}
    assert by_name["ink_wash"]["image"].startswith("https://")  # online, zero credits
    assert by_name["noir"]["image"].startswith("/styles/")  # originals keep local stills


def test_tones_endpoint_lists_registers(client):
    tones = {t["name"] for t in client.get("/api/tones").json()}
    assert {"thriller", "heartfelt", "comedy"} <= tones


def test_custom_style_from_text(client):
    r = client.post("/api/styles/custom", json={
        "description": "1970s Kodachrome road movie, dust and lens flare", "test_mode": True,
    })
    assert r.status_code == 200
    s = r.json()
    assert s["name"] == "custom"
    assert "kodachrome" in s["descriptors"].lower()  # the description LEADS
    assert s["palette"]


def test_custom_style_from_reference_images(client):
    r = client.post("/api/styles/custom", json={
        "image_urls": ["https://example.com/moodboard.jpg"], "test_mode": True,
    })
    assert r.status_code == 200
    s = r.json()
    assert s["reference_urls"] == ["https://example.com/moodboard.jpg"]
    assert s["descriptors"]  # VL distillation produced style cues


def test_custom_style_requires_something(client):
    assert client.post("/api/styles/custom", json={"test_mode": True}).status_code == 400


def test_style_reference_anchors_the_keyframe_composition():
    loc = Location(name="Kitchen", description="rustic kitchen", reference_url="https://example.com/kitchen.png")
    eli = Character(name="Eli", description="a baker", reference_url="https://example.com/eli.png")
    p = Production(
        title="x", logline="x", target_seconds=20,
        style=StyleLock(name="custom", descriptors="gouache, soft light",
                        reference_urls=["https://example.com/style.png"]),
        characters=[eli], locations=[loc],
    )
    assert style_anchor_url(p) == "https://example.com/style.png"
    shot = Shot(action="Eli kneads dough", character_ids=[eli.id], location_id=loc.id)
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
    # character + locked set + STYLE anchor, style last
    assert seen["images"] == ["https://example.com/eli.png", "https://example.com/kitchen.png",
                              "https://example.com/style.png"]
    assert "STYLE reference" in seen["instruction"]


def test_local_only_style_ref_still_styles_via_words():
    p = Production(
        title="x", logline="x", target_seconds=20,
        style=StyleLock(name="custom", descriptors="gouache", reference_urls=["file:///tmp/ref.png"]),
    )
    assert style_anchor_url(p) is None  # not hosted → words only, no broken edit call


def test_tone_overrides_the_style_register():
    m = get_models().text
    calls = []

    class Rec:
        def complete(self, sys, user, json_mode=False):
            calls.append(sys)
            return m.complete(sys, user, json_mode=json_mode)

    develop_treatment(Rec(), "a quiet baker hides a fortune", target_seconds=20,
                      style_name="claymation", tone="thriller")
    writer_sys = next(s for s in calls if "showrunner:treatment" in s)
    assert TONE_REGISTERS["thriller"].split(":")[0] in writer_sys  # thriller register won
    assert "Whimsical" not in writer_sys  # claymation's default register displaced


def test_create_production_with_custom_style_and_tone(client):
    style = client.post("/api/styles/custom", json={
        "description": "hand-painted gouache storybook", "test_mode": True,
    }).json()
    r = client.post("/api/productions", json={
        "premise": "a mapmaker draws a street that doesn't exist yet",
        "target_seconds": 20, "test_mode": True, "tone": "heartfelt", "custom_style": style,
    })
    assert r.status_code == 201
    p = r.json()
    assert p["style"]["name"] == "custom"
    assert "gouache" in p["style"]["descriptors"]
    assert p["style"]["tone"] == "heartfelt"
