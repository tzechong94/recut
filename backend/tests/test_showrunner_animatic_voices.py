"""Animatic ($0-video film preview), voice casting, choose-take + master-cut endpoints.

The animatic renders the whole film from board stills + real voices through the
existing ffmpeg engine — durations fit job-locally, the Production untouched. The
voice studio auditions a character's actual line. The picker and master-cut endpoints
enforce the contract at the API layer.
"""

from __future__ import annotations

import shutil

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


def _boarded():
    m = get_models().text
    p = develop_treatment(m, "a locksmith opens a door that was never locked", target_seconds=20, style_name="noir")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    queue.enqueue("board_stills", {"production_id": p.id}, project_id=p.project_id)
    process_once(build_context())
    return repo.get_production(p.id)


def test_animatic_requires_stills(client):
    m = get_models().text
    p = develop_treatment(m, "x premise for gating", target_seconds=20, style_name="noir")
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    assert client.post(f"/api/productions/{p.id}/animatic").status_code == 409


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_animatic_renders_a_real_mp4_with_zero_video_tokens(client):
    p = _boarded()
    video_before = p.token_ledger.video_tokens
    durations_before = [s.duration_s for s in p.shots]
    r = client.post(f"/api/productions/{p.id}/animatic")
    assert r.status_code == 202
    process_once(build_context())
    job = client.get(f"/api/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "done", job["error"]
    assert job["result"]["animatic_asset_id"]
    a = repo.get_asset(job["result"]["animatic_asset_id"])
    assert a and a["mime"] == "video/mp4" and a["kind"] == "animatic"
    after = repo.get_production(p.id)
    assert after.token_ledger.video_tokens == video_before  # $0 video — the whole point
    assert [s.duration_s for s in after.shots] == durations_before  # job-local fit only
    assert after.token_ledger.voice_tokens > 0  # honest tts accounting


def test_voice_roster_and_audition(client):
    p = _boarded()
    voices = client.get("/api/voices").json()
    assert {v["name"] for v in voices} >= {"Cherry", "Ethan"}
    speaker = next(c for c in p.characters if any(
        d.character_id == c.id and d.line.strip() for sc in p.scenes for sh in sc.shots for d in sh.dialogue))
    r = client.post(f"/api/productions/{p.id}/characters/{speaker.id}/audition", json={"voice": "Ethan"})
    assert r.status_code == 200
    body = r.json()
    assert body["asset_id"] and body["voice"] == "Ethan" and body["line"].strip()
    assert repo.get_asset(body["asset_id"])  # playable


def test_choose_take_switches_the_slot_and_master_cut_appends_unchosen(client):
    p = _boarded()
    # film everything (draft mode, stub)
    client.post(f"/api/productions/{p.id}/produce", json={})
    process_once(build_context())
    p1 = repo.get_production(p.id)
    shot = p1.shots[0]
    assert shot.chosen_take_id and len(shot.takes) == 1
    first_take = shot.takes[0]

    # master-cut that shot → new take appends UNCHOSEN
    r = client.post(f"/api/productions/{p.id}/master-cut", json={"shot_ids": [shot.id]})
    assert r.status_code == 202
    process_once(build_context())
    p2 = repo.get_production(p.id)
    shot2 = p2.find_shot(shot.id)
    assert len(shot2.takes) == 2
    assert shot2.chosen_take_id == first_take.id  # the master take did NOT steal the slot
    master_take = shot2.takes[-1]
    assert master_take.model and master_take.model != first_take.model  # routed to a master model

    # the picker chooses the master take
    r = client.post(f"/api/productions/{p.id}/shots/{shot.id}/take", json={"take_id": master_take.id})
    assert r.status_code == 200
    p3 = repo.get_production(p.id)
    shot3 = p3.find_shot(shot.id)
    assert shot3.chosen_take_id == master_take.id
    assert shot3.asset_id == master_take.asset_id  # dual-written
    assert shot3.duration_s == master_take.duration_s

    # choosing a bogus take is a named error
    assert client.post(f"/api/productions/{p.id}/shots/{shot.id}/take", json={"take_id": "take_nope"}).status_code == 404
