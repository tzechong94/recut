"""Workbench pass — stale-still signatures, free re-renders, and serialized episodes.

Covers: still_signature (the board flags a stale still when the filmable fields change),
board job stamping the signature, produce re-render bumping the export version (a recut
is free — no regeneration), and continue_series carrying the LOCKED cast + sets into the
next episode so identity is preserved across the serial.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.production import still_signature
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import Shot
from recut.showrunner.series import continue_series
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _seed_production():
    m = get_models().text
    p = develop_treatment(m, "a baker discovers her rival is her sister", target_seconds=20, style_name="claymation")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def test_still_signature_tracks_the_filmable_fields():
    s = Shot(action="Eli kneads dough", character_ids=["b", "a"], location_id="loc1")
    sig = still_signature(s)
    assert still_signature(s) == sig  # stable
    assert "a,b" in sig  # character order doesn't matter
    s2 = s.model_copy(update={"action": "Eli burns the dough"})
    assert still_signature(s2) != sig  # action change -> stale
    s3 = s.model_copy(update={"character_ids": ["a"]})
    assert still_signature(s3) != sig  # cast change -> stale


def test_board_job_stamps_the_signature():
    p = _seed_production()
    queue.enqueue("board_stills", {"production_id": p.id}, project_id=p.project_id)
    process_once(build_context())
    updated = repo.get_production(p.id)
    for sh in updated.shots:
        assert sh.keyframe_sig == still_signature(sh)


def test_continue_series_carries_locked_cast_and_sets():
    prev = _seed_production()
    prev.episode = 1
    for c in prev.characters:
        c.reference_url = f"https://example.com/{c.id}.png"
        c.locked = True
    for l in prev.locations:
        l.reference_url = f"https://example.com/{l.id}.png"
        l.locked = True
    repo.save_production(prev)

    nxt = continue_series(get_models().text, prev)
    assert nxt.episode == 2
    assert nxt.previous_production_id == prev.id
    assert nxt.style.name == prev.style.name
    assert nxt.project_id == prev.project_id
    # returning characters (matched by name) keep their locked reference — identity is
    # free in episode 2; the premise recap names the cliffhanger
    carried = [c for c in nxt.characters if c.reference_url]
    assert carried, "at least one returning character kept their locked look"
    for c in carried:
        old = next(o for o in prev.characters if o.name.strip().lower() == c.name.strip().lower())
        assert c.reference_url == old.reference_url and c.locked and c.voice == old.voice
    assert nxt.token_ledger.video_tokens == 0  # a fresh episode starts clean


def test_next_episode_endpoint_creates_linked_production(client):
    prev = _seed_production()
    r = client.post(f"/api/productions/{prev.id}/next-episode")
    assert r.status_code == 201
    nxt = r.json()
    assert nxt["previous_production_id"] == prev.id
    assert nxt["episode"] == 2
    assert nxt["stage"] == "script"
    # it's a real persisted production
    assert client.get(f"/api/productions/{nxt['id']}").status_code == 200


def test_produce_rerender_bumps_the_export_version(client):
    p = _seed_production()
    # simulate a finished film: an export exists, then the human recuts + re-renders
    p.export_asset_id = "asset_fake_export"
    p.version = 1
    repo.save_production(p)
    r = client.post(f"/api/productions/{p.id}/produce")
    assert r.status_code == 202
    assert repo.get_production(p.id).version == 2  # new cut -> new film file
    # first-time produce does NOT bump
    q = _seed_production()
    client.post(f"/api/productions/{q.id}/produce")
    assert repo.get_production(q.id).version == 1
