"""PUT autosave must never wipe generated state (the vanished-stills bug).

The browser autosaves the FULL production doc; if its copy is stale (fetched before a
worker landed stills/references), the PUT was silently regressing generation-owned
fields to empty. The route now merges: human edits win, generated state never regresses.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import repo
from recut.core.models import get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _seed():
    m = get_models().text
    p = develop_treatment(m, "a diver finds a door on the seafloor", target_seconds=20, style_name="noir")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    return p


def test_stale_autosave_cannot_wipe_stills_refs_or_ledger(client):
    p = _seed()
    stale = p.model_dump(mode="json")  # the browser's copy, BEFORE generation

    # a worker lands stills + a cast ref + spend after the browser fetched
    p.characters[0].reference_url = "https://example.com/ref.png"
    p.characters[0].reference_asset_id = "a_ref"
    p.characters[0].locked = True
    p.characters[0].identity_notes = "red scarf"
    first = p.shots[0]
    first.keyframe_url = "https://example.com/still.png"
    first.keyframe_asset_id = "a_still"
    first.keyframe_score = 0.9
    p.token_ledger.image_tokens = 900
    repo.save_production(p)

    # the stale autosave arrives, carrying a human edit
    stale["logline"] = "A sharper logline."
    saved = client.put(f"/api/productions/{p.id}", json=stale).json()

    assert saved["logline"] == "A sharper logline."  # human edit wins
    assert saved["characters"][0]["reference_url"] == "https://example.com/ref.png"  # not wiped
    assert saved["characters"][0]["identity_notes"] == "red scarf"
    shot = saved["scenes"][0]["shots"][0]
    assert shot["keyframe_url"] == "https://example.com/still.png"  # the vanished-stills bug
    assert shot["keyframe_score"] == 0.9
    assert saved["token_ledger"]["image_tokens"] == 900  # ledger is server-owned


def test_fresh_doc_edits_still_apply_normally(client):
    p = _seed()
    p.shots[0].keyframe_url = "https://example.com/still.png"
    repo.save_production(p)
    doc = repo.get_production(p.id).model_dump(mode="json")  # FRESH copy (has the still)
    doc["scenes"][0]["shots"][0]["action"] = "a rewritten beat"
    saved = client.put(f"/api/productions/{p.id}", json=doc).json()
    assert saved["scenes"][0]["shots"][0]["action"] == "a rewritten beat"
    assert saved["scenes"][0]["shots"][0]["keyframe_url"] == "https://example.com/still.png"


def test_removing_a_shot_via_put_still_works(client):
    p = _seed()
    doc = repo.get_production(p.id).model_dump(mode="json")
    n_before = sum(len(sc["shots"]) for sc in doc["scenes"])
    doc["scenes"][0]["shots"] = doc["scenes"][0]["shots"][1:]  # the human cuts a shot
    saved = client.put(f"/api/productions/{p.id}", json=doc).json()
    assert sum(len(sc["shots"]) for sc in saved["scenes"]) == n_before - 1
