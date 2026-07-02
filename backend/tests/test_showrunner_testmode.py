"""TEST MODE — walk the entire flow for zero provider tokens.

A production created with test_mode=True runs every model call (writers' room,
storyboard, stills, shots, critic, voice) on the deterministic stubs, even when the
server/worker is configured for the live backend. Proven here by POISONING the live
model handles: if any test-mode path touched them, these tests would explode.
Also covers the gallery summaries (cover still, logline, episode) the home screen needs.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import queue, repo
from recut.worker.main import process_once
from recut.worker.registry import build_context


class _Poison:
    """Stands in for the live model clients; any attribute access is a failure."""

    def __getattr__(self, name):  # noqa: D105
        raise AssertionError("test-mode production touched the LIVE model backend")


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _create_test_production(client) -> dict:
    r = client.post("/api/productions", json={
        "premise": "a courier must deliver a heart across a flooded city",
        "target_seconds": 20, "style": "noir", "test_mode": True,
    })
    assert r.status_code == 201
    return r.json()


def test_create_flags_and_persists_test_mode(client):
    p = _create_test_production(client)
    assert p["test_mode"] is True
    assert repo.get_production(p["id"]).test_mode is True
    # the gallery summary carries the flag for the home-screen badge
    listed = next(x for x in client.get("/api/productions").json() if x["id"] == p["id"])
    assert listed["test_mode"] is True and "logline" in listed and listed["episode"] == 1


def test_storyboard_on_test_production_never_touches_live_models(client, monkeypatch):
    p = _create_test_production(client)
    import recut.api.routers.productions as router_mod

    monkeypatch.setattr(router_mod, "models", lambda: _Poison())  # live handle poisoned
    r = client.post(f"/api/productions/{p['id']}/storyboard")
    assert r.status_code == 200 and any(sc["shots"] for sc in r.json()["scenes"])


def test_worker_jobs_on_test_production_swap_to_stubs(client, monkeypatch):
    p = _create_test_production(client)
    client.post(f"/api/productions/{p['id']}/storyboard")
    ctx = build_context()
    ctx.models = _Poison()  # a live-backend worker context

    prod = repo.get_production(p["id"])
    cid = prod.characters[0].id
    queue.enqueue("cast_reference", {"production_id": p["id"], "target": "character", "target_id": cid})
    assert process_once(ctx)
    assert repo.get_production(p["id"]).character(cid).reference_url

    queue.enqueue("board_stills", {"production_id": p["id"]})
    assert process_once(ctx)
    updated = repo.get_production(p["id"])
    assert all(s.keyframe_url for s in updated.shots)


def test_next_episode_inherits_test_mode(client, monkeypatch):
    p = _create_test_production(client)
    import recut.api.routers.productions as router_mod

    monkeypatch.setattr(router_mod, "models", lambda: _Poison())
    nxt = client.post(f"/api/productions/{p['id']}/next-episode")
    assert nxt.status_code == 201
    assert nxt.json()["test_mode"] is True


def test_gallery_summary_includes_cover_after_stills(client):
    p = _create_test_production(client)
    client.post(f"/api/productions/{p['id']}/storyboard")
    queue.enqueue("board_stills", {"production_id": p["id"]})
    process_once(build_context())
    listed = next(x for x in client.get("/api/productions").json() if x["id"] == p["id"])
    assert listed["cover_asset_id"]  # the home card shows the film's actual look
    assert listed["n_shots"] > 0
