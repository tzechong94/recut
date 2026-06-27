"""Showrunner production E2E: premise -> script -> storyboard -> cast -> produce -> MP4.

Non-render parts run anywhere; the full produce asserts only with ffmpeg.
"""

from __future__ import annotations

import shutil

import pytest

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.production import build_shot_prompt, generate_shot, should_reroll
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource, ShotStatus
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _seed_production():
    m = get_models().text
    p = develop_treatment(m, "a detective realizes her partner is the killer", target_seconds=30, style_name="noir")
    p = build_storyboard(m, p)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def test_production_persists_and_loads():
    p = _seed_production()
    again = repo.get_production(p.id)
    assert again and again.title == p.title and len(again.shots) == len(p.shots)
    assert any(x["id"] == p.id for x in repo.list_productions())


def test_build_shot_prompt_includes_style_and_action():
    p = _seed_production()
    shot = p.shots[0]
    prompt = build_shot_prompt(p, shot)
    assert p.style.name in prompt or "noir" in prompt.lower()
    assert shot.action.split()[0].lower() in prompt.lower()


def test_should_reroll_logic():
    assert should_reroll(0.4, threshold=0.6, rerolls_done=0, max_rerolls=1) is True
    assert should_reroll(0.4, threshold=0.6, rerolls_done=1, max_rerolls=1) is False  # bounded
    assert should_reroll(0.9, threshold=0.6, rerolls_done=0) is False
    assert should_reroll(None, threshold=0.6, rerolls_done=0) is False


def test_cast_reference_locks_character():
    p = _seed_production()
    char = p.characters[0]
    queue.enqueue("cast_reference", {"production_id": p.id, "target": "character", "target_id": char.id})
    process_once(build_context())
    updated = repo.get_production(p.id)
    c = updated.character(char.id)
    assert c.locked and c.source == AssetSource.generated
    assert c.reference_asset_id and c.reference_url


def test_generate_shot_uses_keyframe_i2v_when_character_present():
    p = _seed_production()
    # give a character a reference, put them in shot 0
    c = p.characters[0]
    c.reference_url = "https://example.com/ref.png"
    shot = p.shots[0]
    shot.character_ids = [c.id]
    r = generate_shot(get_models(), p, shot)
    # keyframe-first: compose the character INTO the scene, then animate it; the critic
    # still compares against the LOCKED character reference (identity), and we keep the
    # composed keyframe still.
    assert r.tool == "generate_shot_keyframe_i2v" and r.reference_url == c.reference_url
    assert r.keyframe is not None
    # no reference -> t2v
    shot.character_ids = []
    shot.location_id = None
    assert generate_shot(get_models(), p, shot).tool == "generate_shot_t2v"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_full_produce_film_exports_mp4():
    p = _seed_production()
    # cast all characters first (locks references so shots use i2v)
    for c in p.characters:
        queue.enqueue("cast_reference", {"production_id": p.id, "target": "character", "target_id": c.id})
        process_once(build_context())

    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    job = queue.get_job(jid)
    assert job.status == "done", job.error
    assert job.result["export_asset_id"]

    final = repo.get_production(p.id)
    assert final.stage.value == "export"
    assert all(s.status == ShotStatus.ready and s.asset_id for s in final.shots)
    assert final.token_ledger.video_tokens > 0
    # consistency critic ran on i2v shots
    assert any(s.critic_score is not None for s in final.shots)
    asset = repo.get_asset(job.result["export_asset_id"])
    assert asset["mime"] == "video/mp4"
