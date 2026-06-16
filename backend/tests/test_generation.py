"""Lane D — generation gap-fill + music beat-sync.

Discipline tests: gap-fill only kept auto slots, token cap enforced, music-sync never
mutates the core timeline.
"""

from __future__ import annotations

import pytest

from recut.core import queue, repo
from recut.core.schemas import Beat, Recipe, SlotSource, SlotType, TextRole, Timeline
from recut.core.timeline_ops import base_cut_from_recipe
from recut.pipeline.generate import TokenCapExceeded, generate_for_slot
from recut.pipeline.music import apply_music_sync, clear_music_sync, detect_beats, snap_duration
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _recipe(pid="p1") -> Recipe:
    r = Recipe(
        project_id=pid,
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=3, text_role=TextRole.on_screen_text, on_screen_text="Saved 60%"),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=4, transcript_excerpt="overpay"),
            Beat(index=0, label="B", slot_type=SlotType.broll, duration_s=3),
        ],
    )
    repo.save_recipe(r)
    return r


# ---- generation -----------------------------------------------------------------
def test_generate_for_slot_broll():
    from recut.core.models import get_models
    from recut.core.storage import get_storage

    tl = base_cut_from_recipe(_recipe())
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    gen = generate_for_slot(broll, models=get_models(), storage=get_storage(), project_id="p1", tokens_already_spent=0, token_cap=200000)
    assert gen.tokens > 0 and gen.storage_key


def test_token_cap_blocks_generation():
    from recut.core.models import get_models
    from recut.core.storage import get_storage

    tl = base_cut_from_recipe(_recipe())
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    with pytest.raises(TokenCapExceeded):
        generate_for_slot(broll, models=get_models(), storage=get_storage(), project_id="p1", tokens_already_spent=199990, token_cap=200000)


def test_generate_slot_handler_marks_generated():
    p = repo.create_project(name="gen")
    tl = base_cut_from_recipe(_recipe(p["id"]), project_id=p["id"])
    repo.save_timeline(tl)
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    queue.enqueue("generate_slot", {"timeline_id": tl.timeline_id, "slot_id": broll.id}, project_id=p["id"])
    process_once(build_context())

    updated = repo.get_timeline(tl.timeline_id)
    gen_slot = next(s for s in updated.slots if s.id == broll.id)
    assert gen_slot.source == SlotSource.generated
    assert gen_slot.asset_id
    assert updated.token_ledger.generated_s == 3.0
    assert updated.token_ledger.tokens_spent > 0


def test_generate_slot_skips_non_kept():
    p = repo.create_project(name="gen2")
    tl = base_cut_from_recipe(_recipe(p["id"]), project_id=p["id"])
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    broll.kept = False
    repo.save_timeline(tl)
    jid = queue.enqueue("generate_slot", {"timeline_id": tl.timeline_id, "slot_id": broll.id})
    process_once(build_context())
    assert queue.get_job(jid).result.get("skipped") is True


def test_token_cap_handler_marks_failed_not_crash():
    p = repo.create_project(name="capped")
    repo.update_project(p["id"], token_cap=100)  # tiny cap
    tl = base_cut_from_recipe(_recipe(p["id"]), project_id=p["id"])
    repo.save_timeline(tl)
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    jid = queue.enqueue("generate_slot", {"timeline_id": tl.timeline_id, "slot_id": broll.id}, project_id=p["id"])
    process_once(build_context())
    job = queue.get_job(jid)
    assert job.status == "done" and job.result.get("skipped") is True
    updated = repo.get_timeline(tl.timeline_id)
    assert next(s for s in updated.slots if s.id == broll.id).status.value == "failed"


def test_generate_voiceover_handler():
    p = repo.create_project(name="vo")
    tl = base_cut_from_recipe(_recipe(p["id"]), project_id=p["id"])
    repo.save_timeline(tl)
    jid = queue.enqueue("generate_voiceover", {"timeline_id": tl.timeline_id}, project_id=p["id"])
    process_once(build_context())
    assert queue.get_job(jid).status == "done"
    updated = repo.get_timeline(tl.timeline_id)
    assert updated.audio.voiceover.enabled and updated.audio.voiceover.asset_id


# ---- music beat-sync ------------------------------------------------------------
def test_snap_duration_to_beats():
    grid = detect_beats(None, default_bpm=120.0)  # 0.5s/beat
    assert grid.beat_interval_s == 0.5
    assert snap_duration(3.2, grid) == 3.0  # nearest 6 beats
    assert snap_duration(3.4, grid) == 3.5  # nearest 7 beats
    assert snap_duration(0.1, grid) == 0.5  # min one beat


def test_music_sync_does_not_mutate_core():
    tl = base_cut_from_recipe(_recipe())
    original = [s.duration_s for s in tl.slots]
    grid = detect_beats(None, default_bpm=90.0)
    synced = apply_music_sync(tl, grid)
    # core untouched
    assert [s.duration_s for s in tl.slots] == original
    assert tl.music_sync is None
    # synced is a new version with music_sync on
    assert synced.version == tl.version + 1
    assert synced.music_sync.enabled and synced.music_sync.bpm == 90.0


def test_clear_music_sync():
    tl = base_cut_from_recipe(_recipe())
    synced = apply_music_sync(tl, detect_beats(None))
    cleared = clear_music_sync(synced)
    assert cleared.music_sync.enabled is False


def test_generation_endpoints():
    from fastapi.testclient import TestClient

    from recut.api.main import create_app

    client = TestClient(create_app())
    p = client.post("/api/projects", json={"name": "p"}).json()
    r = _recipe(p["id"])
    tl = client.post(f"/api/projects/{p['id']}/base-cut", json={"recipe_id": r.recipe_id}).json()
    tid = tl["timeline_id"]
    # queue generation for all kept auto slots
    g = client.post(f"/api/timelines/{tid}/generate", json={"voiceover": True})
    assert g.status_code == 202 and g.json()["queued"] >= 1
    # music sync produces a new version
    ms = client.post(f"/api/timelines/{tid}/music-sync", json={"enabled": True, "bpm": 100})
    assert ms.status_code == 200 and ms.json()["music_sync"]["enabled"]
    assert ms.json()["version"] == tl["version"] + 1
