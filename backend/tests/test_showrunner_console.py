"""The Stage-4 producer console: money, draft tier, pilot shots, and the stop button.

Approval should feel like a producer's decision: dollars not tokens, a cheap rehearsal
tier, the option to film a pilot subset first, and a cancel that keeps finished work.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _seed():
    m = get_models().text
    p = develop_treatment(m, "a night nurse hears a heartbeat in an empty ward", target_seconds=20, style_name="noir")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def test_pricing_endpoint_exposes_the_editable_table(client):
    t = client.get("/api/pricing").json()
    assert t["video_second_final"] > t["video_second_draft"] > 0
    assert t["image"] > 0 and "estimate" in t["note"]


def test_video_quality_persists_and_scoreboard_speaks_dollars(client):
    p = _seed()
    doc = repo.get_production(p.id).model_dump(mode="json")
    doc["video_quality"] = "draft"
    saved = client.put(f"/api/productions/{p.id}", json=doc).json()
    assert saved["video_quality"] == "draft"
    sb = client.get(f"/api/productions/{p.id}/scoreboard").json()
    assert "est_cost_usd" in sb and sb["est_cost_usd"]["total"] >= 0


def test_pilot_pass_films_only_the_selected_shots_and_skips_the_render(client):
    p = _seed()
    picks = [s.id for s in p.shots[:2]]
    r = client.post(f"/api/productions/{p.id}/produce", json={"shot_ids": picks})
    assert r.status_code == 202
    process_once(build_context())
    job = client.get(f"/api/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "done" and job["result"]["pilot"] is True
    updated = repo.get_production(p.id)
    filmed = {s.id for s in updated.shots if s.asset_id}
    assert filmed == set(picks)  # ONLY the pilot shots
    assert updated.export_asset_id is None  # no final render on a pilot
    assert updated.stage.value == "production"  # still mid-flight, Action resumes


def test_cancel_keeps_finished_shots_and_returns_partial(client, monkeypatch):
    p = _seed()
    r = client.post(f"/api/productions/{p.id}/produce", json={})
    job_id = r.json()["job_id"]

    # cancel arrives after the first shot: is_cancelling flips true from call #2 on
    calls = {"n": 0}

    def fake_is_cancelling(jid):
        calls["n"] += 1
        return calls["n"] > 1

    monkeypatch.setattr(queue, "is_cancelling", fake_is_cancelling)
    process_once(build_context())
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "done" and job["result"]["cancelled"] is True
    updated = repo.get_production(p.id)
    assert sum(1 for s in updated.shots if s.asset_id) == 1  # the finished shot survived
    assert any("stopped by you" in w for w in updated.warnings)


def test_cancel_endpoint_flags_a_running_job(client):
    p = _seed()
    job_id = client.post(f"/api/productions/{p.id}/produce", json={}).json()["job_id"]
    # queued job → cancelled outright
    r = client.post(f"/api/jobs/{job_id}/cancel")
    assert r.status_code == 202 and r.json()["cancelling"] is True
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "failed"
