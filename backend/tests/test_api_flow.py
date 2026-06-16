"""Spine integration: project -> recipe -> base cut -> export -> worker -> MP4.

The non-render parts run anywhere; the full export asserts only when ffmpeg exists.
"""

from __future__ import annotations

import shutil

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import repo
from recut.core.schemas import Beat, Recipe, SlotType, TextRole
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _seed_recipe(project_id: str) -> Recipe:
    r = Recipe(
        project_id=project_id,
        name="demo",
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=2, text_role=TextRole.on_screen_text, on_screen_text="Saved 60%"),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=2),
            Beat(index=0, label="B", slot_type=SlotType.broll, duration_s=1),
        ],
    )
    repo.save_recipe(r)
    return r


def test_project_crud(client):
    r = client.post("/api/projects", json={"name": "Marble reel"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.get("/api/projects").json()[0]["id"] == pid
    client.patch(f"/api/projects/{pid}", json={"stage": 2})
    assert client.get(f"/api/projects/{pid}").json()["stage"] == 2
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_asset_upload_and_raw(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    files = {"file": ("clip.bin", b"hello-bytes", "application/octet-stream")}
    r = client.post(f"/api/projects/{pid}/assets", files=files)
    assert r.status_code == 201
    aid = r.json()["id"]
    raw = client.get(f"/api/assets/{aid}/raw")
    assert raw.status_code == 200 and raw.content == b"hello-bytes"


def test_base_cut_endpoint_creates_playable_timeline(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    recipe = _seed_recipe(pid)
    r = client.post(f"/api/projects/{pid}/base-cut", json={"recipe_id": recipe.recipe_id})
    assert r.status_code == 201
    tl = r.json()
    assert len(tl["slots"]) == 3
    assert all(s["source"] == "standin" for s in tl["slots"])
    assert tl["token_ledger"]["standin_s"] == 5.0
    # project advanced to storyboard stage
    assert client.get(f"/api/projects/{pid}").json()["stage"] == 3


def test_timeline_autosave_recomputes_ledger(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    recipe = _seed_recipe(pid)
    tl = client.post(f"/api/projects/{pid}/base-cut", json={"recipe_id": recipe.recipe_id}).json()
    # mark the talk slot as the creator's footage, autosave
    for s in tl["slots"]:
        if s["type"] == "talk":
            s["source"] = "user_upload"
            s["asset_id"] = "a_fake"
    saved = client.put(f"/api/timelines/{tl['timeline_id']}", json=tl).json()
    assert saved["token_ledger"]["real_footage_s"] == 2.0


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_full_export_flow(client):
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    recipe = _seed_recipe(pid)
    tl = client.post(f"/api/projects/{pid}/base-cut", json={"recipe_id": recipe.recipe_id}).json()

    exp = client.post(f"/api/timelines/{tl['timeline_id']}/export")
    assert exp.status_code == 202
    job_id = exp.json()["job_id"]

    # drive the worker synchronously
    processed = process_once(build_context())
    assert processed == job_id

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "done", job
    assert job["result"]["asset_id"]
    # the export asset is retrievable
    asset = client.get(f"/api/assets/{job['result']['asset_id']}").json()
    assert asset["mime"] == "video/mp4"
