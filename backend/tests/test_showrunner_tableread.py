"""Table read + voice resolution — the script judged by ear, pre-video.

Also covers the live-TTS voice fix: characters carry legacy CosyVoice ids that
qwen3-tts-flash doesn't know; resolve_tts_voice maps them deterministically onto the
qwen roster so dialogue never silently fails to synthesize.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import queue, repo
from recut.core.models import get_models
from recut.core.qwen_clients import _QWEN_TTS_VOICES, resolve_tts_voice
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def _seed():
    m = get_models().text
    p = develop_treatment(m, "a baker discovers her rival is her sister", target_seconds=20, style_name="claymation")
    p = build_storyboard(m, p)  # writes + places the dialogue
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def test_resolve_tts_voice_passthrough_default_and_legacy_mapping():
    assert resolve_tts_voice("", "Cherry") == "Cherry"
    assert resolve_tts_voice("default", "Serena") == "Serena"
    assert resolve_tts_voice("Ethan", "Cherry") == "Ethan"  # roster names pass through
    mapped = resolve_tts_voice("longxiaochun_v2", "Cherry")
    assert mapped in _QWEN_TTS_VOICES  # legacy CosyVoice id lands on the roster
    assert resolve_tts_voice("longxiaochun_v2", "Cherry") == mapped  # stable per id


def test_table_read_synthesizes_each_line_in_character(client):
    p = _seed()
    r = client.post(f"/api/productions/{p.id}/table-read")
    assert r.status_code == 202
    process_once(build_context())
    job = client.get(f"/api/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "done"
    lines = job["result"]["lines"]
    assert lines, "the read produced audio lines"
    names = {c.name for c in p.characters}
    for ln in lines:
        assert ln["asset_id"] and ln["line"]
        assert ln["character"] in names
    assert repo.get_production(p.id).token_ledger.voice_tokens > 0  # honest spend


def test_table_read_requires_written_dialogue(client):
    m = get_models().text
    p = develop_treatment(m, "a mute lighthouse keeper", target_seconds=20, style_name="noir")
    p.scenes = p.scenes[:1]
    p.scenes[0].script = []
    p.scenes[0].shots = []
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    assert client.post(f"/api/productions/{p.id}/table-read").status_code == 409
