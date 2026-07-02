"""Sprint 10 (crit round 5): re-run / regenerate idempotency.

A single-shot regenerate must NOT re-voice the whole film, double-count voice tokens, or
leave stale director-log entries — the token discipline is a scored axis."""
import shutil
import pytest

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource
from recut.worker.main import process_once
from recut.worker.registry import build_context


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_regenerate_is_idempotent_on_tokens_and_log():
    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "noir", style_name="noir"))
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    after1 = repo.get_production(p.id)
    voice1 = after1.token_ledger.voice_tokens
    log1 = len(after1.director_log)
    nshots = len(after1.shots)

    # retake ONE silent shot (contract: re-filming is an explicit FORCE, never a clear)
    target = next((s for s in after1.shots if not s.dialogue), after1.shots[0])
    queue.enqueue("produce_film", {"production_id": p.id, "force_ids": [target.id],
                                   "render": True})
    process_once(build_context())
    after2 = repo.get_production(p.id)

    # voice not re-synthesized for unchanged shots -> tokens unchanged
    assert after2.token_ledger.voice_tokens == voice1
    # one generation log entry per shot (no stale duplicates)
    gen_entries = [e for e in after2.director_log if not e["decision"].startswith("Editor:")]
    assert len(gen_entries) == nshots
    assert all(s.asset_id for s in after2.shots)  # every shot still resolved
    tgt = after2.find_shot(target.id)
    assert len(tgt.takes) == 2  # the old take survived the retake
    assert tgt.chosen_take_id == tgt.takes[-1].id  # retake auto-chose its result
