from __future__ import annotations

import shutil

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_styles_endpoint(client):
    styles = client.get("/api/styles").json()
    names = {s["name"] for s in styles}
    assert {"noir", "anime", "cinematic"} <= names


def test_create_production_runs_writers_room(client):
    r = client.post("/api/productions", json={"premise": "a detective realizes her partner is the killer", "style": "noir"})
    assert r.status_code == 201
    p = r.json()
    assert p["stage"] == "script"
    assert p["title"] and p["logline"]
    assert len(p["characters"]) >= 2
    assert any(m["role"] == "critic" for m in p["writers_room"])
    assert client.get("/api/productions").json()[0]["id"] == p["id"]


def test_edit_then_storyboard(client):
    p = client.post("/api/productions", json={"premise": "noir betrayal"}).json()
    # human edits the logline
    p["logline"] = "A sharper logline."
    saved = client.put(f"/api/productions/{p['id']}", json=p).json()
    assert saved["logline"] == "A sharper logline."
    sb = client.post(f"/api/productions/{p['id']}/storyboard").json()
    assert sb["stage"] == "storyboard" and len(sb["scenes"][0]["shots"]) >= 1


def test_cast_then_scoreboard(client):
    p = client.post("/api/productions", json={"premise": "x"}).json()
    cid = p["characters"][0]["id"]
    job = client.post(f"/api/productions/{p['id']}/cast", json={"target": "character", "target_id": cid})
    assert job.status_code == 202
    process_once(build_context())
    updated = client.get(f"/api/productions/{p['id']}").json()
    c = next(c for c in updated["characters"] if c["id"] == cid)
    assert c["locked"] and c["reference_asset_id"]
    sb = client.get(f"/api/productions/{p['id']}/scoreboard").json()
    assert sb["shots_total"] >= 0 and "tokens" in sb


def test_produce_requires_shots(client):
    p = client.post("/api/productions", json={"premise": "x"}).json()
    # no storyboard yet -> produce should 409
    assert client.post(f"/api/productions/{p['id']}/produce").status_code == 409


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_full_flow_to_export(client):
    p = client.post("/api/productions", json={"premise": "a detective realizes her partner is the killer", "style": "noir"}).json()
    client.post(f"/api/productions/{p['id']}/storyboard")
    p2 = client.get(f"/api/productions/{p['id']}").json()
    for c in p2["characters"]:
        client.post(f"/api/productions/{p['id']}/cast", json={"target": "character", "target_id": c["id"]})
        process_once(build_context())
    job = client.post(f"/api/productions/{p['id']}/produce").json()
    assert job["status"] == "queued"
    process_once(build_context())
    j = client.get(f"/api/jobs/{job['job_id']}").json()
    assert j["status"] == "done", j
    sb = client.get(f"/api/productions/{p['id']}/scoreboard").json()
    assert sb["shots_ready"] == sb["shots_total"] and sb["shots_total"] > 0
    assert sb["tokens"]["video"] > 0


def test_mcp_showrunner_tools_registered():
    from recut.mcp import tools as mcp_tools
    from recut.mcp.server import build_server
    import anyio

    assert {"showrunner_develop", "showrunner_storyboard", "showrunner_cast", "showrunner_produce"} <= set(mcp_tools.TOOLS)
    names = {t.name for t in anyio.run(build_server().list_tools)}
    assert "showrunner_develop" in names and "showrunner_produce" in names


def test_mcp_agentic_pipeline():
    from recut.mcp import tools as t
    prod = t.showrunner_develop("a heist goes wrong", target_seconds=30, style="noir")
    pid = prod["production_id"] if "production_id" in prod else prod["id"]
    sb = t.showrunner_storyboard(pid)
    assert sb["scenes"][0]["shots"]
    cid = prod["characters"][0]["id"]
    assert t.showrunner_cast(pid, cid)["job_id"]
    assert t.showrunner_produce(pid)["job_id"]


def test_suggest_premise_generate_and_refine(client):
    gen = client.post("/api/premise/suggest", json={"premise": ""}).json()
    assert gen["premise"] and len(gen["premise"]) > 10
    ref = client.post("/api/premise/suggest", json={"premise": "a guy finds a dog"}).json()
    assert ref["premise"]  # returns a sharpened premise
