"""Lane A — reference-to-recipe analysis tests.

The recipe is the scored technical artifact and the IP-safety story (learn the
STRUCTURE, never the content). The non-negotiable test here is recipe-fallback:
a model failure must still yield a usable recipe, never a blank.
"""

from __future__ import annotations

from recut.core.models import StubTranscriber, StubVision, VisionAnalyzer, VisionResult
from recut.core.schemas import SlotType, V1_SLOT_TYPES
from recut.pipeline.analyse import analyse_reference, classify_slot_type, detect_beats


class _BoomVision(VisionAnalyzer):
    def analyze(self, video_path: str, *, hint: str = "") -> VisionResult:
        raise RuntimeError("Qwen-VL timeout")


def test_analyse_produces_structured_recipe():
    r = analyse_reference("ref.mp4", vision=StubVision(), transcriber=StubTranscriber(), project_id="p1")
    assert r.shot_count == 7
    assert len(r.beats) == 7
    assert r.duration_s == 23.0
    assert all(b.slot_type in V1_SLOT_TYPES for b in r.beats)
    # the first beat is the hook (a text claim), the last is a CTA text card
    assert r.beats[0].slot_type == SlotType.text
    assert r.beats[0].label == "Hook"
    assert r.beats[-1].label == "CTA"
    # observations + hook transcript captured
    assert r.observations
    assert "cost" in r.hook_transcript.lower()
    assert r.analysis_meta.fallback_used is False


def test_recipe_fallback_on_vision_failure():
    r = analyse_reference("ref.mp4", vision=_BoomVision(), transcriber=StubTranscriber(), project_id="p1")
    assert r.analysis_meta.fallback_used is True
    assert len(r.beats) >= 5  # a usable recipe, never blank
    assert r.duration_s > 0
    assert all(b.slot_type in V1_SLOT_TYPES for b in r.beats)


def test_classify_slot_type_heuristics():
    from recut.core.models import Shot

    # classify on the visual description; on-screen captions don't make a text card
    assert classify_slot_type(Shot(0, 3, "Title card with text on a plain background", "Wait", "static")) == SlotType.text
    assert classify_slot_type(Shot(0, 3, "A person talking to camera, mid-shot", "", "static")) == SlotType.talk
    assert classify_slot_type(Shot(0, 3, "Wide establishing shot of a warehouse", "", "fast-cut")) == SlotType.broll
    assert classify_slot_type(Shot(0, 3, "A quiet detail shot of a marble slab", "", "slow")) == SlotType.roll
    # footage WITH burned captions is NOT a text card
    assert classify_slot_type(Shot(0, 3, "A person speaking to camera", "some caption text here", "static")) == SlotType.talk


def test_detect_beats_maps_transcript_to_beats():
    beats = detect_beats(StubVision().analyze("x"), StubTranscriber().transcribe("x"))
    # the setup beat (around 3-7s) should carry transcript text
    setup = beats[1]
    assert setup.transcript_excerpt
    # sequential, non-overlapping, positive durations
    assert all(b.duration_s > 0 for b in beats)


def test_analyse_endpoint(tmp_path):
    from fastapi.testclient import TestClient

    from recut.api.main import create_app
    from recut.core import repo

    client = TestClient(create_app())
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    # create a reference asset row (bytes content irrelevant for the stub analyzer)
    files = {"file": ("ref.mp4", b"\x00\x00fake", "video/mp4")}
    aid = client.post(f"/api/projects/{pid}/assets", params={"kind": "reference"}, files=files).json()["id"]

    r = client.post(f"/api/projects/{pid}/analyse", json={"asset_id": aid})
    assert r.status_code == 201, r.text
    recipe = r.json()
    assert recipe["beats"] and recipe["shot_count"] >= 5
    # recipe persisted + fetchable
    assert client.get(f"/api/recipes/{recipe['recipe_id']}").status_code == 200
    # project advanced to the Recipe stage
    assert client.get(f"/api/projects/{pid}").json()["stage"] == 1
