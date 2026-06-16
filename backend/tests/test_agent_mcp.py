"""Lane C — co-writing agent, caption/cover, and the MCP toolset.

The MCP tools wrap the same pipeline the REST API uses; the agentic loop test drives
analyse -> base cut -> draft -> refine -> caption -> render entirely through MCP tools.
"""

from __future__ import annotations

import shutil

import pytest

from recut.core import repo
from recut.core.models import get_models
from recut.core.schemas import Beat, Recipe, SlotType, TextRole
from recut.mcp import tools
from recut.pipeline.draft_script import draft_caption_and_cover, draft_script_on_beats, refine_beat


def _recipe(pid: str = "p1") -> Recipe:
    r = Recipe(
        project_id=pid, name="demo",
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=3, text_role=TextRole.on_screen_text),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=4, text_role=TextRole.voiceover),
            Beat(index=0, label="CTA", slot_type=SlotType.text, duration_s=2, text_role=TextRole.on_screen_text),
        ],
    )
    repo.save_recipe(r)
    return r


def test_draft_script_writes_lines_onto_beats():
    r = _recipe()
    drafted = draft_script_on_beats(get_models().text, r, "I flew to Foshan and bought marble direct.")
    # text beats get on_screen_text; voiceover beats get transcript_excerpt
    assert drafted.beats[0].on_screen_text
    assert drafted.beats[1].transcript_excerpt


def test_refine_returns_text():
    out = refine_beat(get_models().text, "old line", "make it punchier")
    assert isinstance(out, str) and out


def test_caption_cover_shape():
    out = draft_caption_and_cover(get_models().text, ["I saved 60%", "No middleman"])
    assert "caption" in out and isinstance(out["hashtags"], list) and out["covers"]


def test_mcp_server_registers_expected_tools():
    from recut.mcp.server import build_server
    import anyio

    srv = build_server()
    listed = anyio.run(srv.list_tools)
    names = {t.name for t in listed}
    for expected in ("analyse_reference", "build_base_cut", "draft_script_on_beats", "refine_beat", "render_export"):
        assert expected in names


def test_mcp_toolset_keys_match_registry():
    assert set(tools.TOOLS) >= {
        "analyse_reference", "build_base_cut", "draft_script_on_beats", "refine_beat",
        "add_slot_from_prompt", "draft_caption_and_cover", "generate_broll", "render_export",
    }


def test_agentic_loop_through_mcp_tools():
    """The whole pipeline driven through MCP tool functions, as the agent would."""
    p = repo.create_project(name="agent run")
    pid = p["id"]
    # a reference asset to analyse
    from recut.core.storage import get_storage

    get_storage().put("ref/x.mp4", b"\x00fake")
    asset = repo.create_asset(kind="reference", storage_key="ref/x.mp4", project_id=pid, mime="video/mp4")

    recipe = tools.analyse_reference(pid, asset["id"])
    assert recipe["beats"]

    tl = tools.build_base_cut(pid, recipe["recipe_id"])
    tid = tl["timeline_id"]
    assert all(s["source"] == "standin" for s in tl["slots"])

    tools.draft_script_on_beats(recipe["recipe_id"], "my story about sourcing direct")
    first_slot = tl["slots"][0]["id"]
    refined = tools.refine_beat(tid, first_slot, "punchier")
    assert refined["text"]

    added = tools.add_slot_from_prompt(tid, "aerial of the harbour at dusk")
    assert added["slot_id"]

    cc = tools.draft_caption_and_cover(tid)
    assert cc["caption"]

    job = tools.render_export(tid)
    assert job["job_id"] and job["status"] == "queued"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_render_via_mcp_completes():
    from recut.worker.main import process_once
    from recut.worker.registry import build_context

    p = repo.create_project(name="render via mcp")
    r = _recipe(p["id"])
    tl = tools.build_base_cut(p["id"], r.recipe_id)
    job = tools.render_export(tl["timeline_id"])
    process_once(build_context())
    status = tools.job_status(job["job_id"])
    assert status["status"] == "done", status


def test_agent_endpoints():
    from fastapi.testclient import TestClient

    from recut.api.main import create_app

    client = TestClient(create_app())
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    r = _recipe(pid)
    # cowrite chat turn
    reply = client.post(f"/api/projects/{pid}/cowrite", json={"message": "hi", "recipe_id": r.recipe_id})
    assert reply.status_code == 200 and reply.json()["reply"]
    # draft script
    d = client.post(f"/api/projects/{pid}/draft-script", json={"recipe_id": r.recipe_id, "story": "x"})
    assert d.status_code == 200 and d.json()["beats"]
    assert client.get(f"/api/projects/{pid}").json()["stage"] == 2
